"""Paths consistent regardless of current working directory."""
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = WORKER_ROOT.parents[1]
DATA_ROOT = REPO_ROOT / 'data'
MODELS_ROOT = WORKER_ROOT / 'models'
EXPERIMENTS_ROOT = REPO_ROOT / 'experiments'
