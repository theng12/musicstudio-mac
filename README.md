# MusicStudio (Mac)

Apple Silicon music generation studio — a sibling app to ImageStudio (Mac).
Catalog-driven model management for MusicGen, Stable Audio Open, AudioGen,
Riffusion, Bark, and ACE-Step.

> **Phase 1 status:** catalog browsing, downloads with resume, weight imports,
> HF token settings, network-access panel — all live. **Music generation
> lands in Phase 2.**

## What it does today

- Browse a catalog of 13 open-source music / audio models with capability
  chips and "Best for:" descriptions per entry
- Download models with live speed + ETA, resume on interrupt, parallel jobs
- Import weights you already have via symlink or move
- Settings: HF token (for gated models like Stable Audio Open's license-accept
  flow), persistent JSON config
- Network panel: detects your LAN + Tailscale IPs, shows direct API URLs,
  bind-port info, share-proxy state
- HTTP API on `127.0.0.1:47869` (bound to all interfaces by default for
  direct cross-device access)

## Why it's Mac-only

Currently uses PyTorch + MPS (Apple's Metal backend) for inference. No
native MLX equivalent of mflux exists for music yet, but MPS provides
respectable performance on M-series chips.

## Architecture notes for hackers

- `app/backend/cache.py / downloads.py / imports.py / settings.py` —
  identical to ImageStudio's. Shared infrastructure.
- `app/backend/catalog.py` — music-specific. Each model entry has
  `capabilities` (text-to-music / melody-continuation / sound-effects /
  vocal / stereo), `sample_rate_hz`, and `max_duration_seconds`.
- `install_generation.js` deliberately does NOT install `audiocraft`
  (Meta's MusicGen library) because it pins old `torch==2.1.0`.
  We use `transformers.MusicgenForConditionalGeneration` directly instead.

## Phase 2 — what's coming

- Text → Music generation via `transformers` (MusicGen) + `diffusers`
  (Stable Audio Open, Riffusion)
- Melody continuation tab (drop / paste / pick reference audio, use
  `MusicgenMelodyForConditionalGeneration`)
- Sound effects sub-mode for AudioGen models
- Audio player widget in the output area (HTML5 `<audio>`)
- Duration slider replacing aspect ratio
- Same recent grid + reuse-params + batch + toasts as ImageStudio

## Versioning

Music Studio KH uses [Semantic Versioning](https://semver.org/) with this project-specific interpretation:

- **MAJOR** (1.x.x → 2.x.x) — breaking change. Re-install required.
- **MINOR** (1.1.x → 1.2.x) — new engine / feature / model family. **Re-run "Install Generation"** to pick up any new Python deps.
- **PATCH** (1.2.0 → 1.2.1) — bugfix / UI tweak / catalog entry within an existing family. **Just run "Update"** from the Pinokio sidebar.

Current version is stored at the project root in [`VERSION`](VERSION). The full release history with what changed in each version lives in [`CHANGELOG.md`](CHANGELOG.md).

The WebUI footer shows the running version. The same value is also surfaced at:

- `GET /api/version` → `{"app_version": "1.0.0", "title": "Music Studio KH"}`
- `GET /api/health` → includes `app_version`
- `GET /api/generate/diagnostics` → includes `app_version`

## Truth audit (for contributors)

The Models tab shows a green "✓ engine ready" chip per model. That chip is driven by the `_WIRED_FAMILIES` set in `app/backend/generation.py`. If a family is in `_WIRED_FAMILIES` but its dispatch branch raises `NotImplementedError`, users see a green chip and then hit a wall when they click Generate.

To prevent that drift, run the truth audit before any release that touches `generation.py`:

```
python3 audit_truth.py            # human-readable report
python3 audit_truth.py --strict   # exits non-zero on drift (for CI)
```

The script reads `app/backend/catalog.py` + `app/backend/generation.py` via AST and reports four kinds of drift: commission lies, omission lies, orphan families, and phantom wires.

No deps beyond stdlib — runs without the venv.

## API

Phase 1 endpoints (all working):

```
GET    /api/health
GET    /api/catalog
GET    /api/cache/{repo}
GET    /api/downloads
POST   /api/downloads                 # { repo, token? }
DELETE /api/downloads
DELETE /api/downloads/{id}
GET    /api/downloads/stream          # SSE
GET    /api/imports/scan
POST   /api/imports                   # { source_path, repo?, mode: "link"|"move" }
POST   /api/reveal                    # { path }
GET    /api/settings
POST   /api/settings                  # { hf_token? }
POST   /api/settings/test-hf-token
GET    /api/connectivity
GET    /api/generate/availability     # currently { available: false }
```

Phase 2 endpoints (coming): `/api/generate/txt2music`, `/api/generate/melody`,
`/api/generate/sfx`, `/api/generate/jobs/*`, `/api/generate/stream`.
