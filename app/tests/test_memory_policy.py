from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend import generation, memory_policy
from backend.main import FLEET_TOKEN, app
from backend.process_title import PROCESS_TITLE


class Manager:
    def __init__(self, loaded=True, idle=0.0, active=False):
        self.loaded = loaded
        self.idle = idle
        self.active = active
        self.releases = 0
        self.activity = 100.0

    def has_active_jobs(self):
        return self.active

    def has_loaded_model(self):
        return self.loaded

    def loaded_model_key(self):
        return ("local/test-music", "musicgen") if self.loaded else None

    def idle_seconds(self, now=None):
        return self.idle if self.loaded else None

    def last_activity_at(self):
        return self.activity

    def release_memory(self, reason="manual"):
        self.releases += 1
        was_loaded, self.loaded = self.loaded, False
        return {"released": was_loaded, "model": ["local/test-music", "musicgen"], "actions": ["test cache cleared"]}


def _reset(monkeypatch, tmp_path, manager=None):
    monkeypatch.setattr(memory_policy, "SETTINGS_FILE", tmp_path / "memory_policy.json")
    monkeypatch.setattr(memory_policy, "_MANAGER", manager or Manager())
    monkeypatch.setattr(memory_policy, "_LAST_RELEASE_AT", None)
    monkeypatch.setattr(memory_policy, "_LAST_RELEASE_REASON", None)
    monkeypatch.setattr(memory_policy, "_LAST_RELEASE_DETAILS", None)
    monkeypatch.setattr(memory_policy, "_LAST_ERROR", None)
    monkeypatch.setattr(memory_policy, "_RELEASE_COUNT", 0)
    monkeypatch.setattr(memory_policy, "_RELEASING", False)


def test_explicit_performance_mode_keeps_model_loaded(tmp_path, monkeypatch):
    """`performance` must still pin the model when an operator asks for it.
    What changed is that it is no longer the *default* — see
    test_default_mode_is_no_longer_the_one_that_never_releases below."""
    manager = Manager(idle=99_999)
    _reset(monkeypatch, tmp_path, manager)
    memory_policy.save("performance")
    assert memory_policy.status()["mode"] == "performance"
    assert memory_policy.run_due_release(now=100_000) is None
    assert manager.releases == 0


def test_default_mode_is_no_longer_the_one_that_never_releases(tmp_path, monkeypatch):
    """With no operator choice on disk, an idle model must eventually be freed.
    Previously the default was `performance` (idle_seconds=None), so the
    release thread ran forever and did nothing."""
    manager = Manager(idle=99_999)
    _reset(monkeypatch, tmp_path, manager)
    assert memory_policy.status()["mode"] != "performance"
    assert memory_policy.run_due_release(now=100_000) is not None
    assert manager.releases == 1


def test_balanced_releases_at_ten_minutes(tmp_path, monkeypatch):
    manager = Manager(idle=599)
    _reset(monkeypatch, tmp_path, manager)
    memory_policy.save("balanced")
    assert memory_policy.run_due_release(now=699) is None
    manager.idle = 600
    released = memory_policy.run_due_release(now=700)
    assert released["last_release_reason"] == "automatic:balanced"
    assert released["busy"] is False
    assert manager.releases == 1


def test_active_generation_blocks_manual_release(tmp_path, monkeypatch):
    _reset(monkeypatch, tmp_path, Manager(active=True))
    client = TestClient(app, headers={"X-Studio-Token": FLEET_TOKEN})
    response = client.post("/api/memory/release")
    assert response.status_code == 409


def test_success_keeps_model_but_failure_releases(tmp_path, monkeypatch):
    output = tmp_path / "output"
    output.mkdir()
    monkeypatch.setattr(generation, "OUTPUT_DIR", output)
    monkeypatch.setattr(generation, "HISTORY_FILE", output / ".history.json")
    monkeypatch.setattr(generation, "MUSIC_GEN_AVAILABLE", True)

    manager = generation.GenerationManager()
    manager._bark_model = object()
    manager._bark_processor = object()
    manager._bark_model_repo = "suno/bark-small"

    good = generation.GenerationJob("good", "txt2music", {})
    manager._jobs[good.job_id] = good
    monkeypatch.setattr(manager, "_dispatch_txt2music", lambda _job, path: path.write_bytes(b"wav"))
    manager._run_txt2music(good)
    assert good.state == "done"
    assert manager.has_loaded_model() is True

    bad = generation.GenerationJob("bad", "txt2music", {})
    manager._jobs[bad.job_id] = bad
    monkeypatch.setattr(manager, "_dispatch_txt2music", lambda *_args: (_ for _ in ()).throw(RuntimeError("boom")))
    manager._run_txt2music(bad)
    assert bad.state == "error"
    assert manager.has_loaded_model() is False


def test_memory_api_frontend_and_process_title(tmp_path, monkeypatch):
    _reset(monkeypatch, tmp_path)
    client = TestClient(app, headers={"X-Studio-Token": FLEET_TOKEN})
    saved = client.put("/api/memory-policy", json={"mode": "memory_saver"})
    assert saved.status_code == 200
    assert saved.json()["idle_seconds"] == 120
    released = client.post("/api/memory/release")
    assert released.status_code == 200
    assert released.json()["last_release_details"]["released"] is True

    root = Path(__file__).parents[1]
    html = (root / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (root / "frontend" / "app.js").read_text(encoding="utf-8")
    assert "Release Memory / Unload Model" in html
    assert "Performance · default" in html
    assert 'fetch("/api/memory-policy"' in script
    assert 'fetch("/api/memory/release"' in script
    assert PROCESS_TITLE == "Music Studio Mac"


def test_shipped_default_actually_releases_on_idle(monkeypatch) -> None:
    """The idle-release thread ran on every fleet machine and did nothing,
    because the shipped default was "performance" (idle_seconds=None). Each
    Studio ships this same skeleton, so on a shared 8 GB Mac 3-5 of them each
    independently pinned a model forever: 16 of 19 machines could not start a
    job. A default that never releases is not a default."""
    assert memory_policy.MODES[memory_policy.DEFAULT_MODE]["idle_seconds"] is not None
    assert (
        memory_policy.MODES[memory_policy.SMALL_MACHINE_DEFAULT_MODE]["idle_seconds"]
        is not None
    )

    # Small machines get the tighter budget; roomy ones keep a model warm longer.
    monkeypatch.setattr(memory_policy, "_SMALL_MACHINE_GB", 12, raising=False)
    import psutil

    monkeypatch.setattr(
        psutil, "virtual_memory",
        lambda: SimpleNamespace(total=int(8.6e9), available=int(4e9),
                                used=int(4.6e9), percent=53.0),
    )
    assert memory_policy.default_mode() == "memory_saver"

    monkeypatch.setattr(
        psutil, "virtual_memory",
        lambda: SimpleNamespace(total=int(25.8e9), available=int(18e9),
                                used=int(7.8e9), percent=30.0),
    )
    assert memory_policy.default_mode() == "balanced"


def test_operator_choice_still_wins_over_the_machine_default(monkeypatch, tmp_path) -> None:
    """An explicit mode is persisted and must survive; the memory-aware default
    only applies when nobody has chosen."""
    settings = tmp_path / "memory_policy.json"
    settings.write_text('{"mode": "performance"}\n', encoding="utf-8")
    monkeypatch.setattr(memory_policy, "SETTINGS_FILE", settings)
    assert memory_policy._read()["mode"] == "performance"
