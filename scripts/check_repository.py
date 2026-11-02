"""Check runtime assets and sample-data integrity without external services."""
from pathlib import Path
import hashlib
import sys

root = Path(__file__).resolve().parents[1]
required = [
    'LICENSE', 'README.md',
    'apps/web/package.json', 'apps/web/app/page.tsx', 'apps/web/lib/auth.ts',
    'apps/geo-worker/pyproject.toml', 'apps/geo-worker/src/geo_worker/worker.py',
    'apps/geo-worker/models/v2/coffee_rf.joblib',
    'apps/geo-worker/models/v2/treinamento_v2.json',
    'data/sample/imagem_multiespectral.tif', 'data/sample/qualidade_scl.tif',
    'data/additional/imagem_adicional_multiespectral.tif',
    'data/unseen/imagem_adicional_multiespectral.tif',
    'data/reference/mapbiomas_2025_recorte_30m.tif',
    'turbo.json', 'pnpm-workspace.yaml',
]
failed = False
for relative in required:
    exists = (root / relative).is_file()
    print('OK   ' if exists else 'MISSING', relative)
    failed |= not exists

manifest = root / 'data/sample/SHA256SUMS.txt'
if not manifest.is_file():
    print('MISSING', manifest.relative_to(root))
    failed = True
else:
    for line in manifest.read_text(encoding='utf-8').splitlines():
        expected, name = line.split('  ', 1)
        path = manifest.parent / name
        matches = path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == expected
        print('OK   ' if matches else 'INVALID', f'data/sample/{name}')
        failed |= not matches

sys.exit(bool(failed))
