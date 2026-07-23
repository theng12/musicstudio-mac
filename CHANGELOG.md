# Changelog — Music Studio KH

All notable changes to Music Studio KH are documented here.

Versioning follows [Semantic Versioning](https://semver.org/) with this project-specific interpretation:

- **MAJOR** (1.x.x → 2.x.x) — breaking change. Re-install required.
- **MINOR** (1.1.x → 1.2.x) — new engine / new feature / new model family. **Re-run "Install Generation"** to pick up new Python deps.
- **PATCH** (1.2.0 → 1.2.1) — bugfix / UI tweak / catalog entry within an existing family. **Just run Update** from the Pinokio sidebar.

---

## [1.8.1] — 2026-07-23

### Changed — 30-day fleet backup retention

- Raised completed music-output backup retention from 3 days to 30 days while
  retaining the existing 80 GB hard cap and oldest-first emergency cleanup.
- Existing saved 3-day policies migrate automatically once during update.
  Explicit choices saved afterward remain respected, so offline and online
  workers require no individual configuration.

### Verification

- Added regression coverage for legacy migration and post-migration overrides.
  **Just run Update.**

## [1.8.0] — 2026-07-20

### Added — opt-in model memory controls

- Added Performance (default), Balanced (10 minutes), Memory Saver (2 minutes),
  and Immediate model-unload modes. Performance preserves the most recently
  used MusicGen, Stable Audio, or Bark model for faster repeat generations.
- Added a manual **Release Memory / Unload Model** action that safely rejects
  requests while music is queued or generating, then clears Python, PyTorch,
  MLX, and Metal allocator caches without deleting weights or WAV outputs.
- Added the friendly **Music Studio Mac** process title for Activity Monitor.

### Verification

- Added policy timing, active-job protection, model-retention, failure cleanup,
  API, UI, and process-title regression coverage. Full Python, JavaScript,
  dependency, and responsive WebUI checks pass.

---

## [1.7.3] — 2026-07-19

### Added — automatic local output protection

- Added enabled-by-default three-day retention and an 80 GB hard cap for
  generated WAV backups, enforced hourly with oldest-first eviction.
- Added modern in-app usage, retention, capacity, Save policy, and Clean now
  controls backed by the authenticated Studio Hub fleet API.
- Cleanup is restricted to completed WAVs in `app/output`; active jobs, model
  caches, imports, uploads, settings, and credentials are never eligible.

### Verification

- Added age, hard-cap, active-job, API, and scope-safety regression tests. The
  full test suite, Python compilation, and JavaScript syntax checks pass.
  Launchers and generation dependencies were left unchanged.

---

## [1.7.2] — 2026-07-19

### Improved — persistent generation install and release details

- Install/Reinstall Generation now remains available while the regular server
  is running, including the brief period before its Web UI URL is ready.
- Startup-service mode keeps the same action, so generation dependencies can be
  refreshed without manually stopping or uninstalling the service. The existing
  installer still verifies the stack and restarts the appropriate server mode.
- Added an always-visible **What's New · Updates & Details** launcher item that
  opens the installed `CHANGELOG.md` in Pinokio's rendered Markdown view.

### Verification

- Exercised mocked uninstalled, stopped, starting, running, service, install,
  generation-install, update, update-and-restart, and reset menu states.
- Confirmed the generation action appears in all server-running modes and the
  What's New item appears in every state. Launcher syntax and the full test
  suite pass; application and dependency code were left unchanged.

## [1.7.1] — 2026-07-18

### Fixed — automatic update settings no longer snap back

- Kept unsaved automatic-update choices in a separate form draft so the
  five-second status refresh cannot replace a newly selected mode, schedule,
  maintenance time, or idle-only preference with the last saved values.
- Saving now submits that draft and synchronizes the controls only after the
  server validates and persists the schedule.
- Reworked the Settings panel with clear mode cards, grouped schedule controls,
  an unsaved-changes indicator, and update actions that appear only when useful.

### Verification

- Verified that unsaved mode and maintenance-time changes survive multiple
  status polls at desktop and compact widths.
- JavaScript syntax, Python compilation, updater tests, dependency checks, and
  the full Music Studio test suite pass. No launcher or engine changes.

## [1.7.0] — 2026-07-15

### Added — safe optional automatic updates

- Added Off, Notify only, and Automatic modes in Settings, with daily or weekly
  schedules, visible status, manual checks, retry, and “Update after current work.”
- Updates defer while music generations or model downloads are active. They
  verify the fixed GitHub remote, clean `main` branch, fast-forward history,
  disk space, dependencies, imports, health, and the exact running version.
- Added a short-lived launchd scheduler, lock protection, retry/backoff,
  rotating redacted logs, notifications, restart recovery, and bounded rollback.
  The feature remains Off until explicitly enabled.

### Verification

- Added focused updater/readiness tests and verified scheduler installation and
  removal, APIs, launchers, dependencies, truth audit, and responsive Settings UI.

## [1.6.1] — 2026-07-13

### Fixed — saved fleet credentials apply without restarting Music Studio

- Protected requests now verify against the current owner-only fleet-token file instead of a startup snapshot. Studio Hub credential saves and rotations take effect immediately, and authenticated browser cookies follow the current value.

Verified with a live-rotation middleware regression test plus the full test suite. No launcher, engine, or dependency changes; **Just run Update**.

## [1.6.0] — 2026-07-12

### Added — secure fleet access and capability contract

- Remote API and output access now requires the automatically shared StudioHub fleet token; loopback Pinokio use remains passwordless.
- Browser writes are same-origin protected, authenticated browser sessions use an HttpOnly cookie, and remote Studio pages prompt once per tab when a token is needed.
- Added normalized `GET /api/capabilities` metadata for text-to-music, text-to-audio, and Bark speech generation.

### Verification

- Python and JavaScript syntax checks pass. Security-contract tests cover public health/capability routes, protected catalog access, accepted fleet credentials, cross-origin write rejection, and private token permissions.

## [1.5.1] — 2026-07-12

### Fixed — truthful engine readiness and bounded generation

- AudioLDM2, MAGNeT, and YuE are now represented in diagnostics and have explicit
  roadmap dispatch branches. Cached roadmap models no longer default to “ready,” and
  the API rejects them before creating a job. The strict generation truth audit is clean.
- Generate now requires an actual selected model and explains whether the missing input
  is a model, an engine worker, or a prompt. Failed jobs remove partial WAV files.
- Music-generation inputs now have explicit prompt, duration, chain, crossfade, sampling,
  and seed limits to prevent runaway work or memory use from malformed API requests.
- README status/API documentation now reflects the working MusicGen, Stable Audio, and
  Bark generation features instead of describing them as a future Phase 2.

### Security

- Hugging Face token storage is forced to owner-only (`0600`) permissions.
- Remote update-version metadata is rendered with `textContent`.
- FastAPI, Starlette, and python-multipart were raised to patched versions; an isolated
  install of the base lock reports no known vulnerabilities.

### Verification

- Python/JavaScript/HTML checks, request-boundary tests, the strict truth audit, an
  isolated dependency audit, and a stopped-app browser smoke test all pass. LAN
  bind/CORS remain unchanged as part of the documented server-mode contract.

## [1.5.0] — 2026-07-10

### Added — Audio-generator overhaul: live feedback, per-track actions, disk management

Carries the Voice Studio generator improvements to Music Studio (frontend live on reload; new endpoints activate after one **Update** — no new Python deps):

- **Live feedback** — fixed the "Generating… undefined/undefined" progress label (now real % + elapsed); the queue panel is sticky with a live progress bar on the running job.
- **Per-track actions** — each result now has **📂 Reveal** and two-click **🗑 Delete** (removes the track and its WAV) alongside Reuse/Download. *(Backend: `DELETE /api/generate/history/{id}`.)*
- **Disk management** — footer showing track count + disk used, with one-click prune ("keep newest 50" / "delete > 30 days"). *(Backend: `GET /api/output/stats`, `POST /api/output/prune`.)*
- **Auto-play** the newest result when a generation finishes; **friendlier empty state**.

### Fixed — Two native `confirm()` dialogs replaced with a webview-safe modal
Remove-token and Import-move used `window.confirm()`, which Pinokio's embedded webview silently blocks. Both now use an in-app confirm modal.

### Notes
- MINOR bump (1.4.8 → 1.5.0). Frontend live on reload; endpoints need one **Update** (restart) — UI degrades gracefully until then.

---
## [1.4.8] — 2026-07-10

### Added — "Open outputs folder" button (+ Clear-history fix)

- **Open outputs folder** — new button in the history header that reveals the folder holding every generated audio file in Finder, via the existing `/api/reveal`.
- **Clear history** used the native `window.confirm()` dialog, which Pinokio's embedded webview can silently block — so it did nothing. Replaced with a webview-safe two-click confirm (arm, then click again).

### Notes
- PATCH bump (1.4.7 → 1.4.8) — frontend only. Live on reload; no restart needed.

---
## [1.4.7] — 2026-07-10

### Fixed — download ETA settle-guard and duration rollup (catalog audited, already accurate)

**Absurd download ETA (`downloads.py`).** Same suite-wide fix: the speed EMA's first near-zero sample (taken before real bytes land) produced ETAs like "99679m 03s" seconds after clicking Download. `eta_seconds` is now suppressed until the job has ≥3 s of runtime so the rate settles first.

**Unreadable long durations (`app.js`).** `formatDuration()` gained hour/day rollup (`Xh YYm` / `Xd YYh`) instead of overflowing to `734m 12s`.

**Catalog audited — no changes needed.** As part of a suite-wide size/memory audit, every Music Studio entry was cross-checked against real Hugging Face download sizes (with `ignore_patterns` applied). All 18 were already accurate; no size or memory-floor corrections were required. `py_compile` clean.

## [1.4.6] — 2026-07-10

### Fixed — API and import flows now use music models and WAV output

Copied Image Studio defaults remained across the API tab, import hints, backend import
errors, and the fallback download filename. They pointed at FLUX, called `txt2img`, and
downloaded PNG files, so the generated examples could not work. Music Studio now uses
MusicGen, `txt2music`, duration/audio parameters, and WAV routes throughout.

### Verification

- Cross-checked request fields and routes against `backend/main.py`, compiled the changed
  Python module, validated JavaScript and HTML, and rendered the API/settings states.
- Duration and download-size formatting were checked and remain intentionally decimal;
  generation engines, model catalog entries, and download behavior are unchanged.

---

## [1.4.5] — 2026-07-10

### Changed — Generate opens with a focused music workspace overview

The Generate tab now establishes the active model, clip length, and compute target
before the detailed controls. This makes the first screen easier to scan and gives the
music workflow the same polished hierarchy as the sibling Studio apps, with a refined
header icon and active-tab treatment.

### Verification

- Validated Alpine expressions, JavaScript syntax, HTML parsing, responsive CSS, and
  launcher URL capture without installing the optional multi-gigabyte generation stack.
- Generation settings, catalog behavior, downloads, imports, engine installation, and
  API routes were checked and deliberately left unchanged.

---

## [1.4.4] — 2026-07-10

### Changed — Version now shown as a badge in the top-right header (consistent across all sibling apps)

The app version was displayed inconsistently across the Studio fleet (bottom footer on
some, top-right on Chat, missing on Video). It's now a small `v1.4.4`-style badge in the
top-right of the header on every app, matching Chat Studio — visible at a glance without
scrolling to a footer.

### Notes

- PATCH bump (1.4.3 → 1.4.4) — frontend only (`index.html` + `style.css`). Served with
  no-cache headers, so it appears on the next browser reload without a restart.

---
## [1.4.3] — 2026-07-10

### Fixed — Update reinstalls the service (rewrites the launchd plist) instead of kickstarting a stale one

The service scripts were renamed from generic `serve.sh` / `watchdog.sh` to
`<app>-serve.sh` / `<app>-watchdog.sh`, and the launchd plist's `ProgramArguments`
now points at the renamed script. A machine with the service already installed has
a plist pointing at the OLD `serve.sh` — so a plain **kickstart** (`restart_service.sh`)
would relaunch a plist pointing at a now-deleted path and the service would fail to
come back up after an update.

`update.js` (and `install_generation.js`) now restart the service with
**`install_service.sh`** instead of `restart_service.sh`. `install_service.sh`
regenerates the plist to match the current on-disk scripts *before* relaunching
(bootout → bootstrap → kickstart), so the rename is folded in automatically. It's
idempotent and safe to run on every update.

### Notes

- PATCH bump (1.4.2 → 1.4.3) — launcher scripts only. Applies only where the app
  runs as a launchd service (`service/.installed`); the `start.js` path is unchanged.

---
## [1.4.2] — 2026-07-10

### Added — In-app auto-check banner: tells you when to update instead of failing silently

On load the web UI checks `GET /api/update-status` and shows a dismissible banner when this install needs attention:

- **A newer version is published** — compares this install's VERSION against the repo's published VERSION (fetched from GitHub raw, cached ~6h, in a background thread so it never blocks). Banner: "⬆ Update available (vX → vY)", pointing at the one-click **Update** button in the Pinokio sidebar.
- **The generation engine isn't installed** — detects the missing stack directly. Banner: "⚠ Generation engine not installed — the Generate tab won't work", pointing at **Install Generation** (or **Update**) in the sidebar. This is the exact silent failure that let a broken generation install look fine before.

Detect-in-app, apply-via-sidebar: a sandboxed web page (external browser, Tailscale) can't reliably drive Pinokio's script runner, so the banner points at the sidebar's one-click Update rather than trying to self-update. The banner is self-contained (no framework coupling) and degrades silently if the endpoint isn't live yet (e.g. a running service that hasn't restarted onto the new build).

### Notes

- PATCH bump (1.4.1 → 1.4.2) — backend adds `GET /api/update-status`; frontend adds the banner to `index.html`. No change to existing features.

---
## [1.4.1] — 2026-07-10

### Fixed — One-click Update that actually works, and generation installs that don't silently fail

Overhauled the update/install flow. It was tedious and, worse, quietly broken:

- **One Update button, correct in every run mode.** The old "Update & Restart" was hardwired to stop/start `start.js`, but in production this app runs as an always-on launchd **service** — so it stopped nothing and then launched a *second* server that fought the service for the fixed port. The unified `update.js` now detects the mode and restarts the **real** server (kickstart the service **or** start `start.js` — never both), so updating no longer requires manually stopping production first.
- **Generation deps refresh on the same click.** `update.js` used to install only the base deps; heavy ML deps came from a separate "Reinstall Generation" button, so a release that bumped a model dependency silently didn't apply on Update. Update now refreshes generation deps too (when generation is installed) — no second button to hunt for.
- **Install from source, not a drifted lock.** `install_generation.js` (and Update) now install from `requirements-generation.txt`, the authoritative range file. The generation `.lock.txt` had drifted — on some machines it contained only base packages, so "Install Generation" installed nothing while the UI still reported success. Source-first can't have that failure mode.
- **Verify-then-notify.** After installing, the key modules are imported; a failure breaks the run and withholds the "installed" notification. The old script fired "Generation engine installed" unconditionally — even on total failure.
- **"Update & Restart" folded into "Update"** (kept as a back-compat alias that forwards to `update.js`).

### Notes

- PATCH bump (1.4.0 → 1.4.1) — launcher scripts only (`update.js`, `install_generation.js`, `update_and_restart.js`, `pinokio.js`). No app-code change.
- Verified: all launcher scripts load; the menu renders a single mode-aware "Update"; generation deps import in the env.

---
## [1.4.0] — 2026-07-09

### Added — dependency lockfiles: fresh installs are now reproducible forever

`requirements.txt` / `requirements-generation.txt` use version **floors** (`>=`), so a fresh install months from now would resolve to whatever PyPI serves that day — one breaking release in any dependency (torch, transformers, …) bricks the app on a new machine while existing installs keep working. Same fix as Chat Studio v1.19.0, Voice Studio v1.8.0, Image Studio v1.18.0.

- **`app/requirements.lock.txt`** — the pinned phase-1 set (36 packages, compiled from the floors constrained to the verified env's installed versions).
- **`app/requirements-generation.lock.txt`** — the FULL verified env (63 packages incl. the torch/transformers audio stack).
- `install.js`, `install_generation.js`, and `update.js` now install from the locks. Upgrade flow (edit floors → verify → regenerate both locks → commit) is documented in each lock's header.

Verified: both locks resolve all-satisfied against the live env (36 pkgs / 15 ms and 63 pkgs / 14 ms); all three launcher scripts pass `node --check`; python was already pinned (`python=3.12`).

### Notes

- MINOR bump (1.3.3 → 1.4.0) — install-pipeline change, no package versions changed (locks pin exactly what's installed and verified).

## [1.3.3] — 2026-07-08

### Fixed — Start now refuses to compete with startup service mode

The startup service owns port `47869` when installed, and the service-mode sidebar hides the normal Start button. But `start.js` itself still had no direct guard, so any stale menu, direct script launch, or automation path could still try to start a second Uvicorn server on the same fixed port and fail with "address already in use."

`start.js` now checks for `service/.installed` before launching the server. If service mode is active, it exits immediately with a clear message telling the user to use **Open UI (service)** or uninstall the startup service first. The existing Uvicorn URL capture and `local.set` behavior are unchanged.

**Verified:** `node --check start.js` and direct inspection against the required Pinokio URL-capture pattern (`input.event[1]`). Music Studio does not currently have service logs on this machine, so this was source-verified without starting or restarting the user's app.

### Notes

- PATCH bump (1.3.2 → 1.3.3) — launcher guard only, no app/backend change. **Just run Update**.

## [1.3.2] — 2026-07-01

### Fixed — Byte-size display split-brain (Models tab said 2.3 GB, download progress said 2.14 GB for the same file)

Same class of bug as Voice Studio KH 1.7.2/1.7.3. The Models tab displayed model sizes via `formatGb(size_gb)` using the catalog's decimal-GB values (matching HuggingFace's own reporting on the repo page), but the Downloads tab and inline `downloadCaption()` used `humanBytes()` which divided raw byte counts by **1024** while still labeling the result "KB / MB / GB". Same physical size, two different unit conventions, both labeled identically — so a model the Models tab called "2.3 GB" would show "2.14 GB / 2.14 GB" during download.

- **`app/frontend/app.js` — `humanBytes(n)`** now divides by 1000 (decimal, SI). Same labels, same call sites, correct math.
- **`app/frontend/app.js` — `formatGb(gb)`** sub-1GB branch changed from `Math.round(gb * 1024)` to `Math.round(gb * 1000)`. A catalog entry of `size_gb=0.5` now displays as "500 MB" (was "512 MB").
- Verified by simulating the helpers against the exact catalog values:
  - `humanBytes(2.3e9)` → "2.30 GB" (was "2.14 GB", now matches the Models tab card).
  - `humanBytes(2e7) + "/s"` → "20.0 MB/s" for a 20 MB/s download.
  - `formatGb(0.5)` → "500 MB" (was "512 MB").

### Fixed — Onboarding banner + primer said MusicGen small was 1.5 GB when the catalog says 2.3 GB

Two hardcoded strings in `app/frontend/index.html` claimed `facebook/musicgen-small` was "1.5 GB" — a stale copy that survived the catalog rewrite. Fixed to match the catalog's authoritative `size_gb=2.3`.

### Fixed — Three different "greens" for OK, three "ambers" for warn, two "reds" for bad (Models + Generate tabs)

The app already has canonical semantic-state variables (`--ok`, `--warn`, `--bad` in `:root`), but several rule sets defined their own hex colors for the same meaning:

- `.diag-ok` `#6ee7b7` / `.diag-warn` `#ffb347` / `.diag-bad` `#ff8a65` / `.diag-pending` `#fbbf24` (Dependency check panel).
- `.chip.fit-ok` `#34d399` / `.chip.fit-tight` `#fbbf24` / `.chip.fit-risky` `#f87171` (Models tab hardware-fit chips).

All were rendered simultaneously on the Models tab against the topbar `.dot.ok` (`--ok`) and cache chips (`--ok`/`--warn`/`--bad`), producing three visibly different "greens" for the same "OK/ready" state. Consolidated onto the canonical variables using the app's existing `color-mix()` tinting technique (already used by `.chip.fit-*`) — no new abstractions.

- `.chip.fit-unknown` also swapped to `var(--muted)` for the same treatment; it's a fourth neutral state, not part of the OK/WARN/BAD triad.

### Deliberately left unchanged

- **All unified-memory / RAM `GB` displays** stay as-is — those describe OS-reported RAM which is conventionally binary/GiB (macOS says "16 GB" for 16 GiB). Different domain from network/file-transfer bytes.
- **Sample rate `kHz`** — SI decimal by convention.
- **`capabilityLabel` / `capabilityHint`** — dead code carried over from an image-studio fork (maps `txt2img`/`img2img` on music-side capabilities); falls through to the raw capability string via `map[c] || c`, so no user-visible bug.
- **`min_unified_memory_gb * 1000` sort key** at `app.js:314` — a sort weight, not a display value.
- **`len(img)//1024 KB`** inside the Python `curl` example on the API tab — illustrative example code, not a display bug.
- **Terminology "cached" / "engine ready" / "fits"** — three DIFFERENT concepts (files on disk / files on disk AND engine deps installed / RAM check passes), not synonyms for the same state. No drift to consolidate.
- **`.btn` class parity across buttons** — checked selector specificity per skill discipline; buttons use `button.ghost`/`button.primary`/element-tag selectors, so `.btn`-vs-no-`.btn` in markup has no rendering effect.

### Note
- PATCH — frontend-only (`app/frontend/{app.js,index.html,style.css}`), no Python change. **Just Update** from the Pinokio sidebar.

---

## [1.3.1] — 2026-06-29

### Fixed — "Install/Reinstall Generation" was unreachable once the startup service was installed

Same fix as Image Studio KH 1.17.1. The audio generation stack (torch, torchaudio, transformers, diffusers, accelerate) is installed via **Install Generation** in the Pinokio sidebar — but that item only existed in the normal (non-service) menus. Once the **always-on startup service** was installed, the menu switched to "service mode" which omitted it, leaving no way to install the generation deps.

- **`pinokio.js`** — the service-mode menu now includes **Install/Reinstall Generation**.
- **`install_generation.js`** is now **service-aware**: in service mode it does NOT relaunch `start.js` (that would fight the launchd service for the fixed port) — it installs, then restarts the service (`restart_service.sh`) so the running server reloads Python and picks up the new packages.

### Note
- PATCH — launcher scripts only, no app/deps change. Just **Update**.

---

## [1.3.0] — 2026-06-26

### Added — RAM planner: interactive memory slider + live "Best for your RAM" picks (Models tab)

The Models tab gained a **hardware planner** so you can size models to a machine you don't own yet — set the unified-memory budget and every fit chip re-scores instantly.

- **RAM slider + numeric entry + tier presets** (8 / 16 / 24 / 32 / 48 / 64 / 128 / 256 / 512 GB). Defaults to your detected RAM; drag/type to *preview* a different Mac (e.g. plan an M3 Ultra 512 GB before buying it). A `↩ My Mac` button snaps back to detected. The chosen budget persists across reloads.
- **Live hardware fit** — per-card fit chips (✓ fits / ⚠ tight / ✗ over budget) are scored **client-side** against the slider value via `fitFor()`/`effectiveRam`, with no server round-trip.
- **✨ Best for your RAM** — surfaces the highest-quality model in each lane (overall / text-to-music / melody continuation / stereo / sound effects) that still fits the budget.
- **Segmented "RAM fit" filter** (All / ✓ Fits / ⚠ Tight / ✗ Over), mirroring the Chat Studio model-tab control for a consistent look across the suite. The old binary "Fits my Mac" chip is folded into this.

**Frontend-only — no new Python dependencies. A plain _Update_ from the Pinokio sidebar is enough (no re-install / Install Generation needed).**

---

## [1.2.2] — 2026-06-06

### Added — auto-restart on Update + "Repair · take over port" button
- **Update restarts the service:** `update.js` now ends with a `restart_service.sh` step gated on `{{exists('service/.installed')}}`, so an installed service picks up new backend code automatically after Update (no-op otherwise).
- **"Repair · take over port"** menu item (service mode) re-runs the installer to fix any wedged/conflicting state in one click.

### Fixed — take-over no longer risks killing connected clients
The v1.2.1 port take-over used `lsof -ti tcp:PORT`, which also matches connected clients (browser tab / Pinokio webview / SSE). Now filtered with `-sTCP:LISTEN` so only the listening server is targeted. Verified live.

### Notes
- PATCH — service scripts + update.js. Mirrored across all 3 KH apps (Image 1.4.2, Voice 1.6.2). `Update`, then re-run Install Service once.

---

## [1.2.1] — 2026-06-06

### Fixed — "Check Service Status" clarity + double-run conflict detection

- The watchdog is *periodic* (fires ~1s every 60s), so "not running" between checks is normal — the status now says so instead of a scary raw dump. Server line is now `✓ loaded · running (pid N)`.
- **Port-conflict detection:** if you run both Pinokio's **Start** and the service, they fight for port 47869 and the service crash-loops (`[Errno 48] address already in use`). The status script now detects this and explains it.
- **Install now takes over the port:** `Install as Startup Service` stops whatever's already on the port (your Pinokio "Start") before starting the service, so "Start, then Install Service" Just Works — no crash loop, no manual `pkill`. Uninstalling doesn't auto-restart the Pinokio instance.

### Notes
- PATCH — service scripts only. Mirrored across all 3 KH apps (Image 1.4.1, Voice 1.6.1). `Update`, then re-run Install Service once.

---

## [1.2.0] — 2026-06-06

### Added — one-click "Install as Startup Service" (always-on server + self-healing)

For running this on a headless/server Mac (e.g. a fleet reached over Tailscale), the app can now be a real background service instead of opening Pinokio and clicking Start each time.

New sidebar button **❤️ Install as Startup Service** installs a macOS **launchd LaunchAgent** that:

- runs the server (`serve.sh` → uvicorn on **47869**) **at login**, so it returns automatically after a reboot;
- **restarts on crash** via launchd `KeepAlive`;
- ships a **health watchdog** (`watchdog.sh`, every 60s) that hits `/api/health` and relaunches the server if it hangs.

No sudo needed. The button toggles to **Startup Service: ON — click to remove**. Service logs go to `logs/service/`.

New files: `serve.sh`, `watchdog.sh`, `install_service.sh`, `uninstall_service.sh`, `service.js`, `unservice.js` (self-locating; the per-machine `service/.installed` marker is gitignored).

### Service mode — manage it from the sidebar
Once installed, launchd owns the server (Pinokio doesn't see it as "running"), so the sidebar switches to a **service-mode menu** — no conflicting "Start" button:

- **Open UI / Open in Browser** — straight to the running server on port 47869 (no Pinokio Start needed).
- **Check Service Status** (`status_service.sh`) — launchd state + live `/api/health` + recent log, so you know it's actually up.
- **Restart Service** (`restart_service.sh`) — manual `launchctl kickstart -k`.
- **Service Logs** + **Uninstall Startup Service** (brings the normal Start button back).

Extra files: `status_service.sh`, `restart_service.sh`, `service_status.js`, `service_restart.js`.

### Docs — power-cut recovery, explained
The install button prints, and the README documents, the three one-time **admin** settings for full hands-off recovery after a power outage (you do these once per machine):
1. `sudo pmset -a autorestart 1` — power on automatically when electricity returns.
2. **Auto-login** — required so the Apple GPU (Metal/MLX) is available; a pre-login daemon can't use it.
3. **FileVault off** — otherwise reboot halts at the encrypted-disk password screen.

### Notes
- MINOR bump — new feature, no new deps. `Update` from the sidebar, then click **Install as Startup Service** on each Mac.
- Use the **service OR** Pinokio's **Start** — not both (they share port 47869).
- Mirrored across all 3 KH apps (Image 1.4.0, Voice 1.6.0).

---

## [1.1.9] — 2026-05-24

### Fixed — Cancelled queued jobs no longer pop back to "queued" in the UI

Follow-up to v1.1.8. Same race + same fix as ImageStudio v1.3.2. The worker entry (`_run_txt2music`) had a redundant `job.state = "queued"` BEFORE `with _GEN_LOCK:`. If the user clicked Cancel between `submit_job()` returning and the worker thread actually being scheduled, the worker would re-assert `state="queued"` and clobber the cancel decision. The `cancel_event` flag survived, so the worker eventually settled `state="cancelled"` once it acquired the lock — but by then the previous generation had finished and minutes had passed, during which the cancelled card was visibly stuck in the queue UI.

Removed the redundant assignment. The dataclass default already initializes `state="queued"`, so it was dead code — except in the cancel-race window where it was actively destructive.

### Notes

- PATCH bump — UX bugfix, no schema or dependency changes. Run `Update` from the Pinokio sidebar.

---

## [1.1.8] — 2026-05-24

### Fixed — Cancel button works for queued jobs (and explains itself for running jobs)

Mirrored from ImageStudio v1.3.1 (per the "apply UX wins to all 3 apps" rule). MusicStudio had the same latent bug: `manager.cancel()` only set `cancel_event`, so queued jobs blocked on `_GEN_LOCK` couldn't react until the running generation finished. Clicking ✕ Cancel on a queued job appeared to do nothing.

- **Backend (`generation.py`):** `manager.cancel()` immediately flips queued jobs to `state="cancelled"` + `finished_at` + persists. Worker still safely no-ops when it later wakes up and sees `cancel_event.is_set()`.
- **Frontend (`app.js`):** `cancelPending()` toasts differently depending on state:
  - **Queued** → "✓ Cancelled — Queued job removed." (instant)
  - **Running** → "⏸ Cancel signal sent" + honest about why: MusicGen, Stable Audio, and Bark are blocking generation calls that don't honor mid-flight cancellation. The result gets discarded after generation finishes.

### Notes

- PATCH bump — UX bugfix, no schema or dependency changes. Run `Update` from the Pinokio sidebar.

---

## [1.1.7] — 2026-05-24

### Fixed — Generate button no longer blocks queueing during a running job

Same bug + same fix as ImageStudio v1.2.3. The button was using `gen.busy` (true while ANY job is in flight) as part of its disabled condition, preventing the user from queueing a second job while the first ran. Now uses `canSubmit` getter + transient `gen.submitting` flag — you can queue back-to-back generations and the backend serializes execution via `_GEN_LOCK`.

### Notes

- PATCH bump — UX fix, no breaking changes.
- Voice already had this pattern correct from earlier; this brings Image + Music in line.

---

## [1.1.6] — 2026-05-24

### Changed — filter preferences persist across sessions

Mirrored from ImageStudio v1.2.2. If you toggle the `🖥 Fits my Mac` chip, your choice is saved to localStorage (`musicstudio.modelFilters.fitsMyMac`) and restored on next visit.

### Notes

- The MLX-default-on logic is present but harmless on Music (catalog has 0 MLX entries, so the chip stays hidden and the filter never auto-engages). Future-proof: if MLX music models ever land, Music will start defaulting MLX-only just like Image + Voice.
- Same code shipped to all 3 apps per the rule — judgment by catalog content, not by hardcoding.
- PATCH bump — `Update` from Pinokio.

---

## [1.1.5] — 2026-05-24

### Added — `audit_truth.py` script

Mirrors the v1.2.1 ImageStudio tool. AST-parses `catalog.py` + `generation.py` to detect drift between `_WIRED_FAMILIES` and actual dispatch coverage.

```
python3 audit_truth.py            # human report
python3 audit_truth.py --strict   # exit non-zero on drift
```

Result: `✓ NO DRIFT` — all 4 wired families (musicgen, audiogen, stable-audio, bark) verified against dispatch; 2 roadmap families (ace-step, riffusion) correctly raise NotImplementedError.

Documented in README "Truth audit (for contributors)" section.

### Notes

- PATCH bump — pure dev tooling, no runtime change.

---

## [1.1.4] — 2026-05-24

### Fixed — `audiogen` was incorrectly marked roadmap

The `_WIRED_FAMILIES` set didn't include `audiogen`, so AudioGen models showed the "🕓 worker in roadmap" chip in the UI. But the dispatch code's `if family in ("musicgen", "audiogen")` branch was already routing them to the working MusicGen worker. **Inverse lie** — the engine worked but the UI said it didn't.

### Changed

- `_WIRED_FAMILIES` now includes `audiogen`. AudioGen models will show "🚀 Ready to generate" once downloaded.

### Notes

- Part of the v1.2.0 ImageStudio truth audit — applied here to keep the 3-app rule.
- PATCH bump — pure status-display fix, no behavior change for users who tried to generate.
- Just run `Update` from the Pinokio sidebar.

---

## [1.1.3] — 2026-05-24

Mirrors v1.1.2 + v1.1.3 UX wins from ImageStudio (per the "apply UX wins across all 3 apps" rule).

### Added — collapse-by-default model cards (was v1.1.2 in ImageStudio)

- **Compact model cards** — cards default to showing only label + chips + repo + size + hardware + capabilities. The `best_for` line, use-case bullets, and "Saved at" path are hidden behind a per-card `▾ Show details` toggle.
- **Bulk expand/collapse** — `▾ Expand all` / `▴ Collapse all` toolbar buttons operate on the currently-filtered list.
- **Fits my Mac filter chip** — `🖥 Fits my Mac (16 GB)` toggle. On a 16 GB Mac this cuts MusicGen large, MusicGen stereo large, and ACE-Step (all need ≥24 GB).
- **MLX-only filter chip** — `🍎 Apple Silicon (MLX) only` toggle. **Auto-hidden in MusicStudio** because the catalog currently has 0 MLX models — the chip would always match nothing. If MLX music models get added later (the MLX music ecosystem is immature today), the chip auto-appears.

### Added — filter feedback clarity (was v1.1.3 in ImageStudio)

- **Active chips now announce themselves**: 2px bold border, 45% saturated background, white text, and a ✓ prefix.
- **Smart empty state**: when filters yield 0 results, you see a list of every active filter as red ✕ chips — click one to remove just that filter.

### Notes

- PATCH bump — pure UX additions, no breaking changes, no new Python deps.
- Just run `Update` from the Pinokio sidebar; no re-install needed.

---

## [1.1.1] — 2026-05-24

### Added

- **Sidebar port display + external-browser escape hatch.** The Pinokio sidebar now shows a `Port 47869 · Open in Browser` item whenever the server is running. Two benefits:
  - **Visibility**: the port number is always readable in the sidebar — if the embedded webview ever caches a black screen, you can read the port and type `localhost:47869` into Chrome / Safari instead of being stranded.
  - **One-click escape**: clicking the item opens the WebUI in your system default browser via `web.open` with `target="_blank"`.

### Why

The embedded webview occasionally caches a broken state across restarts. Hard-refresh inside the webview doesn't always help, and without knowing the port the user has no way out.

### Files

- New: `open_external.js` (5-line wrapper around `web.open`)
- Modified: `pinokio.js` adds the port display + escape-hatch item to the `running.start` menu branch

### Notes

- PATCH bump — pure UX addition, no breaking changes, no new Python deps.
- Just run `Update` from the Pinokio sidebar; no re-install needed.

---

## [1.1.0] — 2026-05-24

### Added

- **Hardware fit detection** per model card. Detects your Mac's chip + unified memory via sysctl and shows a color-coded chip on each model:
  - 🟢 **fits** — your RAM ≥ 1.5× the model's floor (plenty of headroom)
  - 🟡 **tight** — meets the floor but close other apps before generating
  - 🔴 **may not fit** — below the floor, will swap or OOM
- **"Your Mac" banner** at the top of the Models tab showing detected chip + RAM.
- **Structured use cases** per model — all 13 entries populated with ✅ "good at" / ⚠️ "weak at" / ❌ "avoid" bullets. Surfaces music-specific gotchas:
  - MusicGen **doesn't sing** — instrumental only. For vocals use ACE-Step or Bark
  - MusicGen leans **synthesized** — avoid for acoustic/orchestral solos
  - Stable Audio Open requires **HF license acceptance** even though weights are "open"
  - Bark is **slow** (30-60 sec) + ceiling is 14 sec per clip — not for long compositions
  - Riffusion outputs are short (~5 sec) — for textures + vibes, not full pieces
  - ACE-Step is the most interesting open music model in 2025 but worker isn't wired yet
- **`/api/system`** endpoint exposing the chip + RAM snapshot.
- **`fit` field** in `/api/catalog` per model — `{state, label, hint, actual_gb, required_gb}`.

### Notes

- No new Python dependencies — `system_info.py` uses stdlib `subprocess` + macOS's built-in `sysctl`.
- Mirrors the same Tier 1 hardware-fit pattern shipped in ImageStudio v1.1.0 and VoiceStudio v1.1.0.
- Just run `Update` from the Pinokio sidebar; no re-install needed.

---

## [1.0.0] — 2026-05-24

First versioned release.

### Engines wired (3 families)

- **MusicGen** (small / medium / large) — Meta's autoregressive music generation via `transformers.MusicgenForConditionalGeneration`
- **Stable Audio Open** — Stability AI's diffusion-based music generation via `diffusers.StableAudioPipeline`
- **Suno Bark** — for expressive vocals + sound effects via `transformers.BarkModel`

### Architecture

- **Per-family workers** keyed off `model.family` — `_generate_musicgen`, `_generate_stable_audio`, `_generate_bark`
- **3-state diagnostic system** — every engine reports `deps_ok` + `wired` + `ready`. UI shows which engines need install vs which are roadmap.
- **`/api/diagnostics`** endpoint surfaces package health + engine status to the frontend.
- **soundfile WAV output** — switched from torchaudio (which broke when torchcodec wasn't installed)

### Generate UX

- **Queue panel** — pending + running jobs visible with per-row cancel buttons
- **Batch counter** — submit N sequential generations with auto-incrementing seeds
- **History pagination** — per-row metadata (model, duration), paginated
- **Library filters** — search + family chips + status chips + capability chips + sort
- **Bark tag support** — `[laughter]` / `[MUSIC]` / `[singing]` etc. as inline tags
- **Diagnostic panel** — green/yellow/red per engine, with missing-dep details

### Frontend

- Alpine.js SPA (no build step), Alpine loaded locally
- Sticky topbar (z-index 20) + sticky library toolbar (`top: var(--topbar-height)`)
- Live SSE job stream + JS toast system
- NoCacheStaticMiddleware to prevent webview from holding old HTML

### Backend

- FastAPI + uvicorn, port 47869
- `_GEN_LOCK` serializes GPU-bound generations
- Job history persisted to `app/output/.history.json` (survives restarts)

---

## Format reference

```
## [X.Y.Z] — YYYY-MM-DD

### Added
- New engines / models / UI features

### Changed
- Behavior changes to existing features

### Fixed
- Bug fixes

### Removed
- Dropped engines / deprecated UI

### Notes
- Migration steps, breaking-change details, etc.
```
