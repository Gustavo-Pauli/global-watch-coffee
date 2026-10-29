from geo_worker.paths import DATA_ROOT, MODELS_ROOT, REPO_ROOT, WORKER_ROOT


def test_monorepo_assets_are_referenced_by_absolute_paths():
    assert (REPO_ROOT / "pnpm-workspace.yaml").exists()
    assert (DATA_ROOT / "sample/imagem_multiespectral.tif").is_file()
    assert (DATA_ROOT / "additional/imagem_adicional_multiespectral.tif").is_file()
    assert (DATA_ROOT / "unseen/imagem_adicional_multiespectral.tif").is_file()
    assert (MODELS_ROOT / "v2/coffee_rf.joblib").is_file()
    assert (WORKER_ROOT / "pyproject.toml").is_file()
