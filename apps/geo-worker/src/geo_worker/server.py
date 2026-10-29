"""Execute: uvicorn geo_worker.server:app --host 127.0.0.1 --port 8000"""
from geo_worker.worker import create_worker
app=create_worker()
