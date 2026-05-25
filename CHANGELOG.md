# Changelog — Music Studio KH

All notable changes to Music Studio KH are documented here.

Versioning follows [Semantic Versioning](https://semver.org/) with this project-specific interpretation:

- **MAJOR** (1.x.x → 2.x.x) — breaking change. Re-install required.
- **MINOR** (1.1.x → 1.2.x) — new engine / new feature / new model family. **Re-run "Install Generation"** to pick up new Python deps.
- **PATCH** (1.2.0 → 1.2.1) — bugfix / UI tweak / catalog entry within an existing family. **Just run Update** from the Pinokio sidebar.

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
