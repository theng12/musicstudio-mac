# MusicStudio (Mac)

Apple Silicon music generation studio — a sibling app to ImageStudio (Mac).
Catalog-driven local model management for MusicGen, Stable Audio Open, and
Bark.

Every model in the production catalog has a working local generation path.

## What it does today

- Browse a catalog of 9 runnable open-source music / audio models with capability
  chips and "Best for:" descriptions per entry
- Download models with live speed + ETA, resume on interrupt, parallel jobs
- Import weights you already have via symlink or move
- Settings: HF token (for gated models like Stable Audio Open's license-accept
  flow), persistent JSON config
- Network panel: detects your LAN + Tailscale IPs, shows direct API URLs,
  bind-port info, share-proxy state
- HTTP API on port `47869`, bound to all interfaces by default for direct
  loopback, LAN, and Tailscale access

## Why it's Mac-only

Currently uses PyTorch + MPS (Apple's Metal backend) for inference. No
native MLX equivalent of mflux exists for music yet, but MPS provides
respectable performance on M-series chips.

## Architecture notes for hackers

- `app/backend/cache.py / downloads.py / imports.py / settings.py` —
  identical to ImageStudio's. Shared infrastructure.
- `app/backend/catalog.py` — music-specific. Each model entry has
  `capabilities` (text-to-music / sound-effects /
  vocal / stereo), `sample_rate_hz`, and `max_duration_seconds`.
- `install_generation.js` deliberately does NOT install `audiocraft`
  (Meta's MusicGen library) because it pins old `torch==2.1.0`.
  We use `transformers.MusicgenForConditionalGeneration` directly instead.

## Generation

- Text → music generation via `transformers` (MusicGen and Bark) and
  `diffusers` (Stable Audio Open 1.0)
- Live queue/progress, chained clips with crossfade, reusable parameters,
  auto-play, WAV downloads, history, and output pruning

## Sidebar maintenance actions

- **Install/Reinstall Generation** stays available while Music Studio is
  stopped, running normally, or managed by its startup service. The existing
  installer verifies the heavy audio stack and refreshes the active server mode.
- **What's New · Updates & Details** is visible in every launcher state and
  opens the installed `CHANGELOG.md` in Pinokio's rendered Markdown view.

## Optional automatic updates

Settings includes a safe automatic updater that defaults to **Off**. It can
notify you or install verified updates daily or weekly, always waiting for music
generations and model downloads to finish. “Update after current work” retries
until the app is idle. Every update checks the expected repository, clean
fast-forward history, disk space, dependencies, imports, health, and the running
version; failed post-update verification triggers a bounded rollback.

Use `GET /api/auto-update/status` and `GET /api/auto-update/readiness` for
monitoring. Configuration, checks, updates, and retry use POST endpoints under
`/api/auto-update/`. Logs live in `logs/auto_update/`, and turning the feature
Off unloads its schedule immediately.

Settings also includes model-memory controls. Fresh installs choose a
fleet-safe default from host memory: Macs below 12 GB use **Memory Saver** and
unload after 2 idle minutes; larger Macs use **Balanced** and unload after 10
idle minutes. An explicitly saved operator choice always wins. **Performance**
keeps the latest model loaded, and **Immediate** unloads after each completed
generation. Use **Release
Memory / Unload Model** at any time when no generation is queued or running.
This only releases process and accelerator memory; downloaded models and WAV
outputs remain on disk. The same controls are available over
`GET/PUT /api/memory-policy` and `POST /api/memory/release`.

## Local output retention

Completed music files are temporary local backups. Automatic cleanup is enabled
by default, keeps them for 30 days, and enforces an 80 GB hard cap by deleting
the oldest completed WAVs first. Active jobs, models, imports, uploads,
credentials, and settings are excluded. Controls are available on Generate.

```text
GET  /api/storage-policy
PUT  /api/storage-policy          # { enabled, retention_days, max_gb }
POST /api/storage-policy/cleanup  # optional { target_bytes }
```

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

Local music generation has verified memory self-protection. A genuine allocator
failure unloads cached engines, clears device memory, removes incomplete WAV
output, and retries once with the same resolved seed. A second allocator
failure requests a supervised restart only when the startup service is
installed and only after the terminal job state is saved. Health and diagnostics
also expose privacy-safe memory and watchdog restart-rate evidence for Studio
Hub alerts.

## API

Endpoints:

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
GET    /api/generate/availability
GET    /api/generate/diagnostics
POST   /api/generate/txt2music
GET    /api/generate/jobs
GET    /api/generate/jobs/{id}
GET    /api/generate/jobs/{id}/audio
GET    /api/generate/stream
```

## Run as an always-on server (auto-start + self-healing)

By default you start the app by opening Pinokio and clicking **Start**. If instead you want this Mac to behave like a **server** — the API always up, started automatically on boot, and self-healing — use the one-click service.

### Turn it on
In the Pinokio sidebar click **❤️ Install as Startup Service**. It:

- Installs a macOS **launchd LaunchAgent** that runs the server (`serve.sh`) on **port 47869**.
- **Starts automatically** every time you log in (so it comes back after a reboot).
- **Restarts itself if it crashes** (launchd `KeepAlive`).
- Adds a **health watchdog** that pings `/api/health` every 60s and relaunches the server if it ever hangs.

No admin/sudo needed for this step. To remove it later, click **Startup Service: ON — click to remove**. Logs live in `logs/service/`. Reach the API over Tailscale/LAN at `http://<this-mac>:47869`.

> Use the **service OR** Pinokio's **Start** button — not both (they share port 47869).

### One-time Mac settings for full power-cut recovery (why they matter)
The service handles *software* restarts. To survive an actual **power outage** with zero human steps, each Mac also needs three system settings (admin-level, done once — the button does **not** change these):

1. **Power back on automatically when electricity returns**
   ```bash
   sudo pmset -a autorestart 1
   ```
   *Why:* otherwise the Mac stays off after the power drops. This boots it the moment power returns.

2. **Enable Automatic login** — System Settings ▸ Users & Groups ▸ *Automatically log in as …*
   *Why:* the Apple GPU (Metal / MLX) is **only available inside a logged-in session**. A service that starts before login can't use the GPU, so generation would fail or crawl on CPU.

3. **Turn FileVault OFF** — System Settings ▸ Privacy & Security ▸ FileVault
   *Why:* with FileVault on, a reboot stops at the encrypted-disk password screen and never reaches auto-login — so the server never comes back by itself.

With all three set **plus** the startup service: power returns → Mac powers on → auto-logs in → server + watchdog start with GPU access → crashes/hangs auto-recover. Fully hands-off.

### Rolling it out to many Macs
The service files ship inside this launcher, so on each Mac you just click **Install as Startup Service** once. Do the three system settings once per machine. Updates flow through the normal **Update** button.
