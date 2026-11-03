"""Acquire research comparison products without treating them as ground truth.

Public metadata is queried anonymously. Protected products are recorded as
unavailable; this module never creates accounts, signs in, or falls back to
another year without an explicit source selection.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window, from_bounds, transform as window_transform


MAPBIOMAS_10M_2025 = (
    'https://storage.googleapis.com/mapbiomas-public/initiatives/brasil/'
    'lulc_10m/collection4/coverage/brazil_coverage/brazil_coverage-col4_10m_2025.tif'
)
MAPBIOMAS_30M_2025 = (
    'https://storage.googleapis.com/mapbiomas-public/initiatives/brasil/'
    'collection11/lulc/coverage/brazil_coverage/brazil_coverage-col11_2025.tif'
)
CMR = 'https://cmr.earthdata.nasa.gov/search/granules.json'
ALERTA_API = 'https://plataforma.alerta.mapbiomas.org/api/v2/graphql'
DEFAULT_REGIONS = (
    {'id': 'novo_progresso', 'bbox': [-55.5, -7.2, -55.3, -7.0]},
    {'id': 'belterra', 'bbox': [-54.95, -3.4, -54.75, -3.2]},
)


def save_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n',
                    encoding='utf-8')


def public_url(url: str) -> str:
    """Reject credential-bearing URLs rather than persisting them in provenance."""
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('A public source must be an absolute HTTPS URL without credentials.')
    if parsed.query or parsed.fragment:
        raise ValueError('Use a permanent public source, not a signed/query-bearing URL.')
    return url


def probe_tiff(url: str, timeout: int = 20) -> dict:
    """Request a bounded byte range; a login HTML page is not raster access."""
    public_url(url)
    record = {'url': url, 'anonymous': True}
    request = Request(url, headers={'Range': 'bytes=0-511',
                                   'User-Agent': 'GlobalWatchResearch/0.1'})
    try:
        with urlopen(request, timeout=timeout) as response:
            head = response.read(512)
            is_tiff = head[:4] in (b'II*\x00', b'MM\x00*', b'II+\x00', b'MM\x00+')
            record.update(http_status=response.status,
                          content_type=response.headers.get('Content-Type'),
                          content_range=response.headers.get('Content-Range'),
                          available=is_tiff,
                          status='accessible' if is_tiff else 'not_a_tiff')
    except HTTPError as error:
        record.update(http_status=error.code, available=False,
                      status='authentication_required' if error.code == 401 else 'http_error')
    except (URLError, TimeoutError, OSError) as error:
        record.update(available=False, status='network_error', error_type=type(error).__name__)
    return record


def query_dist(region: dict, start: str, end: str) -> dict:
    """Get one recent candidate granule from public CMR; data can still require auth."""
    query = urlencode({
        'short_name': 'OPERA_L3_DIST-ALERT-HLS_V1',
        'bounding_box': ','.join(map(str, region['bbox'])),
        'temporal': f'{start}T00:00:00Z,{end}T23:59:59Z',
        'page_size': 1, 'sort_key': '-start_date',
    })
    record = {'region': region['id'], 'bbox': region['bbox'], 'start': start,
              'end': end, 'metadata_url': f'{CMR}?{query}'}
    try:
        with urlopen(f'{CMR}?{query}', timeout=20) as response:
            entries = json.load(response).get('feed', {}).get('entry', [])
        if not entries:
            return {**record, 'status': 'no_granule_in_period', 'available': False}
        item = entries[0]
        links = [link['href'] for link in item.get('links', [])
                 if link.get('href', '').startswith('https://')
                 and link['href'].endswith('_VEG-DIST-STATUS.tif')]
        record.update(granule_id=item['id'], title=item['title'],
                      acquisition_time=item.get('time_start'),
                      note='Disturbance status is not confirmed deforestation or causal attribution.')
        if not links:
            return {**record, 'status': 'no_raster_link', 'available': False}
        raster_probe = probe_tiff(links[0])
        return {**record, 'raster_probe': raster_probe,
                'available': raster_probe['available'], 'status': 'metadata_retrieved'}
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        return {**record, 'status': 'metadata_error', 'available': False,
                'error_type': type(error).__name__, 'http_status': getattr(error, 'code', None)}


def probe_alerta() -> dict:
    """A single read-only query, never an authentication mutation."""
    body = json.dumps({'query': 'query { lastAlertPublication { publishedAt total } }'}).encode()
    record = {'endpoint': ALERTA_API, 'anonymous': True,
              'documentation': 'https://docs.api.alerta.mapbiomas.org/pt-BR/',
              'documented_account_required': True}
    try:
        request = Request(ALERTA_API, data=body, headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=20) as response:
            data = json.load(response)
        # Preserve only public publication metadata, not arbitrary API payloads.
        publication = (data.get('data') or {}).get('lastAlertPublication')
        record.update(http_status=response.status,
                      status='publication_metadata_retrieved' if publication else 'no_anonymous_data',
                      publication=publication, available=False)
    except HTTPError as error:
        record.update(status='http_error', http_status=error.code, available=False)
    except (URLError, TimeoutError, OSError, ValueError) as error:
        record.update(status='network_error', error_type=type(error).__name__, available=False)
    return record


def clip_categorical(source: str | Path, image: Path, output: Path, *, year: int,
                     product: str = 'MapBiomas coverage') -> dict:
    """Read only the source window and align labels with nearest-neighbor.

    ``year`` is mandatory even for local files so that date mismatch cannot be
    concealed. The output preserves original class codes and is not a training
    label or accuracy reference merely because it aligns with a scene.
    """
    if str(source).startswith(('http:', 'https:')):
        public_url(str(source))
    with rasterio.open(image) as target:
        if target.crs is None or target.width * target.height > 16_000_000:
            raise ValueError('Target requires a CRS and at most 16 million pixels.')
        target_profile = target.profile.copy()
        target_crs, target_transform = target.crs, target.transform
        target_bounds = target.bounds
        height, width = target.height, target.width
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', GDAL_HTTP_TIMEOUT=20,
                      GDAL_HTTP_MAX_RETRY=1):
        with rasterio.open(source) as src:
            if src.count != 1 or src.crs is None or not np.issubdtype(np.dtype(src.dtypes[0]), np.integer):
                raise ValueError('Reference must be a categorical single-band integer raster with CRS.')
            bounds = transform_bounds(target_crs, src.crs, *target_bounds, densify_pts=21)
            window = from_bounds(*bounds, transform=src.transform)
            left, top = math.floor(window.col_off) - 1, math.floor(window.row_off) - 1
            right = math.ceil(window.col_off + window.width) + 1
            bottom = math.ceil(window.row_off + window.height) + 1
            window = Window(left, top, right - left, bottom - top).intersection(
                Window(0, 0, src.width, src.height))
            if window.width * window.height > 20_000_000:
                raise ValueError('Reference source window exceeds the bounded research budget.')
            labels = src.read(1, window=window)
            source_transform = window_transform(window, src.transform)
            source_crs = src.crs
            # Reserve a value outside every byte-valued MapBiomas category.
            nodata = 65535
            aligned = np.full((height, width), nodata, dtype=np.uint16)
            reproject(labels, aligned, src_transform=source_transform, src_crs=source_crs,
                      src_nodata=src.nodata, dst_transform=target_transform,
                      dst_crs=target_crs, dst_nodata=nodata, resampling=Resampling.nearest)
            native_resolution = list(src.res)
    output.parent.mkdir(parents=True, exist_ok=True)
    target_profile.update(driver='GTiff', count=1, dtype='uint16', nodata=nodata,
                          compress='deflate', tiled=True)
    with rasterio.open(output, 'w', **target_profile) as dest:
        dest.write(aligned, 1)
        dest.set_band_description(1, 'original_reference_class_code')
    document = {
        'product': product, 'reference_year': year, 'source': str(source),
        'accessed_at': datetime.now(timezone.utc).isoformat(),
        'aligned_to': str(image), 'output': str(output),
        'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'source_native_resolution': native_resolution, 'resampling': 'nearest',
        'counts': {str(code): int(count) for code, count in zip(*np.unique(aligned, return_counts=True))},
        'is_independent_ground_truth': False,
        'date_policy': 'Differences from a later scene may be updates; do not call them classification errors.',
        'license': 'CC BY 4.0' if product.startswith('MapBiomas coverage') else 'verify_source_license',
        'citation': f'Projeto MapBiomas, coverage reference year {year}; access date recorded above.',
        'license_evidence': 'https://brasil.mapbiomas.org/' if product.startswith('MapBiomas coverage') else None,
    }
    save_json(output.with_suffix('.json'), document)
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--output', type=Path, default=Path('experiments/outputs/land-change/references'))
    parser.add_argument('--start', default='2026-08-01')
    parser.add_argument('--end', default='2026-11-02')
    parser.add_argument('--audit-only', action='store_true')
    parser.add_argument('--image', type=Path, help='Align a selected source to this local scene.')
    parser.add_argument('--source', default=MAPBIOMAS_10M_2025)
    parser.add_argument('--year', type=int, default=2025)
    args = parser.parse_args()
    regions = json.loads(args.manifest.read_text(encoding='utf-8'))['regions'] if args.manifest else DEFAULT_REGIONS
    args.output.mkdir(parents=True, exist_ok=True)
    audit = {
        'accessed_at': datetime.now(timezone.utc).isoformat(),
        'reference_is_ground_truth': False,
        'mapbiomas_10m_2025': probe_tiff(MAPBIOMAS_10M_2025),
        'mapbiomas_30m_2025': probe_tiff(MAPBIOMAS_30M_2025),
        'mapbiomas_alerta': probe_alerta(),
        'dist_alert': [query_dist(region, args.start, args.end) for region in regions],
    }
    save_json(args.output / 'access-audit.json', audit)
    print(json.dumps(audit, ensure_ascii=False, indent=2))
    if args.audit_only:
        return
    targets = [('custom', args.image)] if args.image else [
        (region['id'], Path(region['scenes'][-1]['image']))
        for region in regions if region.get('scenes')]
    if not targets:
        parser.error('Provide --image or a manifest with acquired scene paths; use --audit-only for access checks.')
    failures = []
    for region_id, image in targets:
        try:
            clip_categorical(args.source, image,
                             args.output / region_id / f'mapbiomas_{args.year}_aligned.tif', year=args.year)
            print(f'Wrote categorical comparison clip for {region_id}.')
        except (rasterio.errors.RasterioError, ValueError, OSError) as error:
            failures.append({'region': region_id, 'status': 'unavailable', 'error_type': type(error).__name__})
    if failures:
        save_json(args.output / 'clip-errors.json', {'errors': failures})
        raise SystemExit(2)


if __name__ == '__main__':
    main()
