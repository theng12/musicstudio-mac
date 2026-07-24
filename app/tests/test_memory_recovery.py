from datetime import datetime
import os
from pathlib import Path
import subprocess

import pytest

from backend import generation
from backend.generation import GenerationJob, GenerationManager
from backend.restart_health import restart_rate_snapshot


ROOT = Path(__file__).resolve().parents[2]
WATCHDOG = ROOT / "musicstudio-watchdog.sh"


def _job() -> GenerationJob:
    return GenerationJob(
        job_id="music-test",
        mode="txt2music",
        params={"repo": "owner/model", "seed": None},
    )


def test_verified_memory_failure_retries_once_with_same_seed(tmp_path, monkeypatch):
    manager = GenerationManager()
    job = _job()
    attempts = []
    releases = []

    monkeypatch.setattr(
        manager,
        "_release_cached_models",
        lambda reason: releases.append(reason) or {"released": True},
    )
    monkeypatch.setattr(manager, "_service_installed", lambda: False)

    def dispatch(current, output):
        attempts.append(current.params.get("seed"))
        if len(attempts) == 1:
            current.resolved_seed = 4242
            output.write_bytes(b"partial")
            raise RuntimeError("MPS backend out of memory")
        output.write_bytes(b"wav")

    monkeypatch.setattr(manager, "_dispatch_txt2music", dispatch)
    output = tmp_path / "music.wav"
    manager._dispatch_with_memory_recovery(job, output)

    assert attempts == [None, 4242]
    assert output.read_bytes() == b"wav"
    assert releases == ["verified-memory-failure"]
    assert manager.memory_status()["consecutive_failures"] == 0
    assert manager.memory_status()["last_event"]["error_type"] == "RuntimeError"
    assert "job_id" not in manager.memory_status()["last_event"]


def test_second_memory_failure_schedules_restart_after_persistence(
        tmp_path, monkeypatch):
    manager = GenerationManager()
    started = []

    class FakeTimer:
        def __init__(self, interval, callback):
            self.interval = interval
            self.callback = callback
            self.daemon = False

        def start(self):
            started.append(self.interval)

    monkeypatch.setattr(manager, "_release_cached_models", lambda _reason: {})
    monkeypatch.setattr(manager, "_service_installed", lambda: True)
    monkeypatch.setattr(generation.threading, "Timer", FakeTimer)
    monkeypatch.setattr(
        manager,
        "_dispatch_txt2music",
        lambda *_args: (_ for _ in ()).throw(MemoryError()),
    )

    with pytest.raises(RuntimeError, match="restarting automatically"):
        manager._dispatch_with_memory_recovery(_job(), tmp_path / "music.wav")

    assert manager.memory_status()["consecutive_failures"] == 2
    assert manager.memory_status()["restart_scheduled"] is True
    assert started == []
    manager._start_scheduled_restart()
    assert started == [0.75]


def test_normal_failures_do_not_retry_or_trigger_restart(tmp_path, monkeypatch):
    manager = GenerationManager()
    attempts = 0
    monkeypatch.setattr(
        manager,
        "_record_memory_failure",
        lambda *_args: pytest.fail("normal failures must not count as OOM"),
    )

    def fail(*_args):
        nonlocal attempts
        attempts += 1
        raise ValueError("prompt is required")

    monkeypatch.setattr(manager, "_dispatch_txt2music", fail)
    with pytest.raises(ValueError, match="prompt is required"):
        manager._dispatch_with_memory_recovery(_job(), tmp_path / "music.wav")

    assert attempts == 1
    assert generation._is_memory_failure(MemoryError())
    assert generation._is_memory_failure(RuntimeError("std::bad_alloc"))
    assert not generation._is_memory_failure(RuntimeError("resource limit exceeded"))
    assert not generation._is_memory_failure(RuntimeError("provider timed out"))


def test_restart_rate_snapshot_reports_repeated_restarts(tmp_path):
    log = tmp_path / "watchdog.log"
    log.write_text(
        "[watchdog] 2026-07-24 08:00:00 health probe failed 3 consecutive times — restarting\n"
        "[watchdog] 2026-07-24 09:00:00 no /api/health — restarting\n",
        encoding="utf-8",
    )
    data = restart_rate_snapshot(log, now=datetime(2026, 7, 24, 10, 0, 0))
    assert data["status"] == "warning"
    assert data["restarts_24h"] == 2


def _write_executable(path: Path, source: str) -> None:
    path.write_text(source, encoding="utf-8")
    path.chmod(0o755)


def _watchdog_env(tmp_path, *, healthy: bool):
    curl = tmp_path / "curl"
    launchctl = tmp_path / "launchctl"
    state = tmp_path / "watchdog-state"
    launches = tmp_path / "launches.log"
    _write_executable(curl, f"#!/bin/sh\nexit {0 if healthy else 1}\n")
    _write_executable(
        launchctl,
        "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$WATCHDOG_LAUNCH_LOG\"\n",
    )
    return {
        **os.environ,
        "MUSICSTUDIO_WATCHDOG_CURL_BIN": str(curl),
        "MUSICSTUDIO_WATCHDOG_LAUNCHCTL_BIN": str(launchctl),
        "MUSICSTUDIO_WATCHDOG_STATE_FILE": str(state),
        "MUSICSTUDIO_WATCHDOG_FAILURES_REQUIRED": "3",
        "WATCHDOG_LAUNCH_LOG": str(launches),
    }, state, launches


def _run_watchdog(env):
    return subprocess.run(
        ["/bin/bash", str(WATCHDOG)],
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )


def test_watchdog_requires_three_failures_and_success_resets(tmp_path):
    env, state, launches = _watchdog_env(tmp_path, healthy=False)
    assert "(1/3)" in _run_watchdog(env).stdout
    assert "(2/3)" in _run_watchdog(env).stdout
    assert not launches.exists()
    assert "failed 3 consecutive times" in _run_watchdog(env).stdout
    assert "kickstart -k" in launches.read_text(encoding="utf-8")

    healthy, _, _ = _watchdog_env(tmp_path, healthy=True)
    _run_watchdog(healthy)
    assert not state.exists()
