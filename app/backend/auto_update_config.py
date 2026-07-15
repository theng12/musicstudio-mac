"""Music Studio's fixed, non-user-editable updater identity."""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional

from .auto_update import AutoUpdater


ROOT = Path(__file__).resolve().parents[2]
SPEC = {
    "root": str(ROOT),
    "title": "Music Studio KH",
    "slug": "musicstudio",
    "expected_remote": "https://github.com/theng12/musicstudio-mac.git",
    "branch": "main",
    "port": 47869,
    "server_label": "com.kh.musicstudio.server",
    "watchdog_label": "com.kh.musicstudio.watchdog",
    "default_hour": 5,
    "default_weekday": 6,
    "verify_module": "backend.main",
    "generation_marker": "transformers",
    "generation_requirements": "requirements-generation.txt",
}


def create_updater(readiness: Optional[Callable[[], list[str]]] = None, **kwargs) -> AutoUpdater:
    return AutoUpdater(SPEC, readiness=readiness, **kwargs)
