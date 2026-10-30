"""Reproducible processing metadata without credentials or user identifiers."""
import hashlib
import json
from pathlib import Path


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def processing_provenance(image: Path, scl: Path | None, model: Path, source: dict,
                          model_version: str, parameters: dict, date: str | None,
                          date_source: str) -> dict:
    if date_source not in ('sample_metadata', 'user_supplied', 'unknown'):
        raise ValueError('Origem da data inválida.')
    provenance = {
        **source,
        'model_version': model_version,
        'parameters': parameters,
        'input_sha256': file_sha256(image),
        'scl_sha256': file_sha256(scl) if scl else None,
        'model_sha256': file_sha256(model),
        'date_source': date_source if date else 'unknown',
        'area_method': 'geodesic_wgs84',
    }
    # Same inputs/configuration/date => same fingerprint, independent of job ID,
    # filesystem path, timestamp or which optional presentation PNGs were asked for.
    identity = {**provenance, 'acquisition_date': date}
    canonical = json.dumps(identity, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    provenance['analysis_fingerprint'] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    return provenance
