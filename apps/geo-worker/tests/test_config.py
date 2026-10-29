import os

from geo_worker import config


def test_load_worker_env_from_worker_root(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("WORKER_SECRET=abc123456789012345678901234567890xyz\n")
    monkeypatch.setattr(config, "WORKER_ROOT", tmp_path)
    monkeypatch.delenv("WORKER_SECRET", raising=False)
    assert config.load_worker_env() is True
    assert os.environ["WORKER_SECRET"] == "abc123456789012345678901234567890xyz"


def test_existing_secret_has_precedence_over_dotenv(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("WORKER_SECRET=wrong-secret-from-file\n")
    monkeypatch.setattr(config, "WORKER_ROOT", tmp_path)
    monkeypatch.setenv("WORKER_SECRET", "secure-secret-from-environment-with-32-chars")
    config.load_worker_env()
    assert os.environ["WORKER_SECRET"] == "secure-secret-from-environment-with-32-chars"
