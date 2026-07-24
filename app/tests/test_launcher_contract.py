from __future__ import annotations

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]


def test_all_launcher_stops_use_canonical_app_local_uris() -> None:
    for name in ("update.js", "install_generation.js"):
        source = (ROOT / name).read_text(encoding="utf-8")
        assert 'uri: "{{path.resolve(cwd, \'start.js\')}}"' in source
        assert not re.search(
            r'method:\s*"script\.stop",\s*params:\s*\{\s*uri:\s*"start\.js"',
            source,
        )


def test_current_version_has_a_changelog_entry() -> None:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    assert f"## [{version}]" in changelog
