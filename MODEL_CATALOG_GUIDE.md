# Music Studio Model Catalog Guide

This guide is the source of truth for adding and maintaining model families in
Music Studio. The Models tab is family-first: users choose a family, then compare
the options inside it by task, quality, speed, maximum clip length, download size,
and unified-memory requirement.

## Where the catalog lives

- `app/backend/catalog.py` defines every family and model.
- `app/backend/main.py` serializes the catalog at `GET /api/catalog` and adds live
  cache/download state. Do not duplicate catalog entries in the frontend.
- `app/frontend/app.js` groups and filters the API response.
- `app/frontend/index.html` renders family panels and option rows.
- `app/backend/generation.py` determines which families can actually generate.
  A catalog entry does not automatically add a generation worker.

Repo IDs are behavior-critical. Downloads, cache detection, generation requests,
and saved user preferences all use `ModelEntry.repo`.

## Taxonomy

### Family

A family is an architecture or closely related product line, not a publisher.
Examples: `musicgen`, `stable-audio`, and `bark`. Variants that share a name but
need unrelated inference code should be separate families.

Each `Family` needs:

- `id`: stable lowercase slug; never rename it casually because diagnostics and
  generation dispatch use it.
- `label`: short user-facing family name.
- `summary`: what it makes and why a user would choose it.
- `how_to_use`: practical prompting advice and important limitations.

### Capabilities

Use only the established capability values unless the frontend and API behavior
are updated together:

| Value | Meaning |
| --- | --- |
| `text-to-music` | Creates music from a text prompt. |
| `melody-continuation` | Accepts or is designed for melody conditioning. |
| `sound-effects` | Creates ambience, foley, or non-musical audio. |
| `vocal` | Supports singing, lyrics, or vocal-style output. |
| `stereo` | Produces native stereo output. |

Capabilities must describe the weights honestly. If the current UI or worker
does not expose the capability yet, say so in `best_for` and `use_cases`.

### Comparison fields

Every `ModelEntry` must include these family-library fields:

- `variant_label`: concise name inside its family, such as `Stereo medium - 1.5B`.
- `quality_label`: the option's role, such as `Starter`, `Balanced`, `Best stereo`,
  `SFX specialist`, or `Full songs`. Do not claim an objective quality ranking
  without evidence.
- `speed_label`: one of `Fast`, `Medium`, `Slow`, or `Very slow`. This is a simple
  relative label for Apple Silicon, not a promised benchmark.
- `runtime`: the hardware/runtime layer. Current local entries use
  `PyTorch / MPS`; use `Apple MLX` only for a genuinely MLX-native worker.
- `format_label`: the loader ecosystem, such as `Transformers`, `Diffusers`,
  `Audiocraft`, `Stable Audio Tools`, or the model's native pipeline.

Also keep these existing values accurate:

- `size_gb`: expected on-disk download after `ignore_patterns` are applied.
- `min_unified_memory_gb`: practical loading floor, including enough runtime
  headroom to avoid immediate swapping or failure.
- `max_duration_seconds`: safe per-generation ceiling enforced by the backend.
- `sample_rate_hz`: native or intended output sample rate.
- `gated`: whether Hugging Face license acceptance/token access is required.
- `best_for`: one useful paragraph with tradeoffs and current worker status.
- `use_cases`: short `good`, `weak`, and `avoid` statements.

## Add a model to an existing family

1. Verify the Hugging Face repo ID, license/gating, architecture, weight formats,
   approximate download size, RAM needs, sample rate, and duration limit.
2. Confirm which files the actual worker loads. Add `ignore_patterns` only for
   duplicate or unused formats. Never exclude configs, tokenizers, codecs, VAEs,
   vocoders, or other required components.
3. Add one `ModelEntry` to `CATALOG` near the other variants in that family.
4. Preserve the full `label` for logs and selectors; make `variant_label` concise
   because the family name is already visible above it.
5. Set capabilities, comparison fields, `best_for`, and realistic use cases.
6. If the family worker is already wired, inspect `app/backend/generation.py` and
   confirm it can load this exact repo/format. Do not assume family membership is
   sufficient.
7. Run the verification checklist below.

Minimal shape:

```python
ModelEntry(
    repo="owner/model-repo",
    label="Family descriptive model name",
    family="existing-family-id",
    size_gb=4.2,
    gated=False,
    min_unified_memory_gb=16,
    recommended_hardware="16 GB Apple Silicon Mac or better.",
    capabilities=("text-to-music", "stereo"),
    best_for="A concise, honest description of strengths and limitations.",
    sample_rate_hz=44100,
    max_duration_seconds=30,
    ignore_patterns=("unused-duplicate.bin",),
    use_cases=(
        ("good", "The task this option handles well"),
        ("weak", "A real limitation"),
        ("avoid", "A task users should choose another family for"),
    ),
    variant_label="Balanced stereo - 1.2B",
    quality_label="Balanced stereo",
    speed_label="Medium",
    runtime="PyTorch / MPS",
    format_label="Transformers",
),
```

## Add a new family

1. Add one `Family` to `FAMILIES` with a stable ID, clear summary, and actionable
   prompting guidance.
2. Add its `ModelEntry` records to `CATALOG`.
3. Add the family to generation diagnostics and dispatch only if a real worker
   exists. Relevant files are `app/backend/generation.py` and the availability
   response in `app/backend/main.py`.
4. If no worker exists, downloads may still be useful, but `best_for` and at least
   one `avoid` use case must say `worker in roadmap`. The UI must not imply the
   cached model can generate.
5. If the new capability vocabulary is unavoidable, add a label and explanation
   in `capabilityLabel()` and `capabilityHint()` in `app/frontend/app.js`, then
   verify filtering and mobile layout.
6. Add a scoped family color in `familyTone()` only when the existing music, SFX,
   vocal, diffusion, and experimental tones cannot communicate the category.

## Update or remove an entry

- Treat `repo` and `family` as stable identifiers. Changing either can orphan a
  cached download or saved selection. Prefer adding a replacement and deprecating
  the old entry intentionally.
- Size corrections must match the files left after `ignore_patterns`.
- Do not mark a model ready in catalog metadata. Readiness is live and comes from
  cache state plus generation diagnostics.
- Before removal, search the repository for the repo ID and family ID. Check
  generation dispatch, tests, docs, and examples.

## Verification checklist

Run from the repository root:

```bash
python3 -m py_compile app/backend/*.py
node --check app/frontend/app.js
git diff --check
```

If `node` is not on the normal shell path, resolve Pinokio's bundled Node runtime
instead of hardcoding a machine-specific path.

Validate catalog invariants:

```bash
python3 - <<'PY'
import importlib.util
import sys

path = "app/backend/catalog.py"
spec = importlib.util.spec_from_file_location("music_catalog", path)
catalog = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = catalog
spec.loader.exec_module(catalog)

assert len({m.repo for m in catalog.CATALOG}) == len(catalog.CATALOG)
assert {m.family for m in catalog.CATALOG} <= set(catalog.FAMILIES)
for model in catalog.CATALOG:
    payload = catalog.serialize_model(model)
    for field in ("variant_label", "quality_label", "speed_label", "runtime", "format_label"):
        assert payload[field], (model.repo, field)
print(f"validated {len(catalog.CATALOG)} models")
PY
```

With the app running, verify:

1. `GET /api/catalog` returns the new entry and all comparison fields.
2. A fresh Models visit shows the full catalog with no hidden default filter.
3. Search matches the family, full label, repo, role, runtime, and use-case text.
4. Capability, download status, and RAM filters show only matching option rows.
5. The correct family opens and every row remains readable at desktop and mobile
   widths.
6. Download starts, progress renders, cancellation works, and completion updates
   the row without a page reload.
7. A cached model with a wired engine shows `Use model`; a cached unsupported
   family shows `Not ready` and explains its status under Details.
8. Existing generation still loads the same repo and obeys its duration ceiling.

Never edit Pinokio launcher scripts merely to add a catalog model. Launcher
changes are only needed when installation or runtime dependencies truly change.
