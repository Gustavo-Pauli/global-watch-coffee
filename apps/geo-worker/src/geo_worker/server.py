"""Execute: uvicorn geo_worker.server:app --host 127.0.0.1 --port 8000"""

from geo_worker.config import load_worker_env
from geo_worker.api.worker import create_worker

# Funciona com `pnpm dev:worker` no Git Bash, PowerShell e em producao.
# Variaveis de ambiente existentes tem prioridade sobre o .env local.
load_worker_env()
app = create_worker()
