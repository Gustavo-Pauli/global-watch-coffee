"""Verifica arquivos essenciais antes de enviar ao GitHub."""
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
required=[
 'apps/web/package.json', 'apps/web/app/page.tsx', 'apps/web/lib/auth.ts',
 'apps/geo-worker/pyproject.toml', 'apps/geo-worker/src/geo_worker/worker.py',
 'apps/geo-worker/models/v2/coffee_rf.joblib',
 'data/sample/imagem_multiespectral.tif','data/sample/qualidade_scl.tif',
 'data/additional/imagem_adicional_multiespectral.tif',
 'data/unseen/imagem_adicional_multiespectral.tif',
 'data/reference/mapbiomas_2025_recorte_30m.tif',
 'docs/research/NOTA_PESQUISA_FINAL.pdf',
 'docs/delivery/ROTEIRO_VIDEO.md', 'turbo.json', 'pnpm-workspace.yaml'
]
missing=[p for p in required if not (root/p).is_file()]
for p in required:print(('FALTA' if p in missing else 'OK   '),p)
sys.exit(bool(missing))
