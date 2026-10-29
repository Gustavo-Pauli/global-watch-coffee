"""Carrega a configuracao local do worker sem sobrescrever variaveis de producao."""

from dotenv import load_dotenv

from geo_worker.paths import WORKER_ROOT


def load_worker_env() -> bool:
    """Le apps/geo-worker/.env independentemente do diretorio de execucao."""
    return load_dotenv(dotenv_path=WORKER_ROOT / ".env", override=False)
