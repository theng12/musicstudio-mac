from pathlib import Path

from backend import catalog, generation


ROOT = Path(__file__).resolve().parents[2]


def test_every_catalog_model_has_a_runnable_local_worker():
    families = {model.family for model in catalog.CATALOG}

    assert families == set(catalog.FAMILIES)
    assert families == generation._WIRED_FAMILIES
    assert families == set(generation._ENGINE_REQUIREMENTS)
    assert all(model.format_label in {"Transformers", "Diffusers"} for model in catalog.CATALOG)
    assert all("melody-continuation" not in model.capabilities for model in catalog.CATALOG)


def test_unused_torchaudio_is_not_installed_or_verified():
    requirement_paths = (
        "app/requirements-generation.txt",
        "app/requirements-generation.lock.txt",
    )
    assert all("torchaudio" not in (ROOT / path).read_text() for path in requirement_paths)
    for path in ("install_generation.js", "update.js"):
        source = (ROOT / path).read_text()
        assert "import torch, transformers, diffusers" in source
        assert "uv pip uninstall torchaudio || true" in source
