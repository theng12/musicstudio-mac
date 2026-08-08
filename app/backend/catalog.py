"""
Static catalog of music / audio generation models for MusicStudio (Mac).

Each entry describes a Hugging Face repo plus metadata the UI uses: download
size, gating status, hardware floor, capabilities (text-to-music /
sound-effects / vocal / stereo), and a long-form
"best for" description.

Capability vocabulary:
- "text-to-music"        — generates music from a text prompt
- "sound-effects"        — non-music audio (footsteps, doors, etc.)
- "vocal"                — supports vocals / singing (limited in open source)
- "stereo"               — produces stereo output (instead of mono)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class Family:
    id: str
    label: str
    summary: str
    how_to_use: str


FAMILIES: dict[str, Family] = {
    "musicgen": Family(
        id="musicgen",
        label="MusicGen",
        summary=(
            "Meta AI's text-conditioned music transformer. The most mature open-source "
            "music generator. Generates instrumental music in 32 kHz with classifier-free "
            "guidance. Has mono and stereo variants."
        ),
        how_to_use=(
            "Prompt with genre + instrumentation + mood + tempo. Example: "
            "'lo-fi hip-hop with mellow piano and soft drums, 80 bpm'. "
            "Duration typically 5–30 seconds. Higher guidance (3.0–5.0) follows the "
            "prompt more strictly; lower (1.0–3.0) is more creative."
        ),
    ),
    "stable-audio": Family(
        id="stable-audio",
        label="Stable Audio",
        summary=(
            "Stability AI's diffusion-based audio model. Generates longer clips (up to "
            "~47 seconds) of both music and sound effects. Higher fidelity ceiling than "
            "MusicGen for some prompt styles."
        ),
        how_to_use=(
            "Works best with rich descriptive prompts including instruments, BPM, mood. "
            "Stability Community License — fine for personal and most non-commercial "
            "use; check the license page for redistribution / commercial details."
        ),
    ),
    "bark": Family(
        id="bark",
        label="Suno Bark",
        summary=(
            "Suno's text-to-audio model. Primarily designed for speech but can produce "
            "singing, music snippets, and sound effects. Open-source MIT-licensed."
        ),
        how_to_use=(
            "Embed special tags in the prompt: [MUSIC], [singing], etc. Quality of pure "
            "music output is limited — Bark shines for vocal/musical hybrids and short "
            "expressive snippets, not full instrumental tracks."
        ),
    ),
}


@dataclass(frozen=True)
class ModelEntry:
    repo: str
    label: str
    family: str
    size_gb: float                       # approximate on-disk size AFTER filtering
    gated: bool
    min_unified_memory_gb: int = 8
    recommended_hardware: str = ""
    capabilities: tuple[str, ...] = ("text-to-music",)
    best_for: str = ""
    sample_rate_hz: int = 32000           # default sample rate for output
    max_duration_seconds: int = 30        # safe upper bound for generation duration
    # huggingface_hub-style glob patterns of files to SKIP during download.
    # Many HF repos ship redundant weight formats (pytorch_model.bin AND
    # model.safetensors, or audiocraft state_dict.bin alongside the
    # transformers-format weights, or legacy single-file .ckpt next to a
    # diffusers component dir). We only want the format our backend actually
    # loads. Pattern syntax is fnmatch — '*' matches anything, paths use '/'.
    ignore_patterns: tuple[str, ...] = ()
    # Structured per-model use cases — each entry is (kind, text) where kind is
    # one of "good" / "weak" / "avoid". The UI renders these as ✅ / ⚠️ / ❌
    # bullets so users can set realistic expectations BEFORE submitting.
    use_cases: tuple[tuple[str, str], ...] = field(default_factory=tuple)
    # Compact comparison metadata for the family-first Models UI. These fields
    # describe the option; generation and download routing still use repo/family.
    variant_label: str = ""
    quality_label: str = ""
    speed_label: str = ""
    runtime: str = "PyTorch / MPS"
    format_label: str = ""


# Common ignore patterns for transformers-loadable MusicGen repos.
# These repos all ship audiocraft-format checkpoints (state_dict.bin /
# compression_state_dict.bin) alongside the transformers-format weights we
# actually use. Skip the audiocraft side.
_AUDIOCRAFT_LEGACY = ("state_dict.bin", "compression_state_dict.bin")


CATALOG: tuple[ModelEntry, ...] = (
    # ──────────── MusicGen family ────────────
    ModelEntry(
        repo="facebook/musicgen-small",
        label="MusicGen small (300M)",
        family="musicgen",
        # Repo is 5.41 GB total: model.safetensors (2.25) + pytorch_model.bin
        # (2.25, dupe) + state_dict.bin (0.8, audiocraft) + encodec (0.2).
        # We only need safetensors + tokenizer/config → ~2.3 GB.
        size_gb=2.3,
        gated=False,
        min_unified_memory_gb=8,
        recommended_hardware="Any Apple Silicon Mac with 8 GB unified memory. Fast.",
        capabilities=("text-to-music",),
        best_for="The recommended starter — smallest, fastest, runs on any M-series Mac. Great for instrumental ambient / background loops. ~5–10 seconds per generation.",
        sample_rate_hz=32000,
        max_duration_seconds=30,
        variant_label="Small · 300M",
        quality_label="Starter",
        speed_label="Fast",
        format_label="Transformers",
        ignore_patterns=(*_AUDIOCRAFT_LEGACY, "pytorch_model.bin"),
        use_cases=(
            ("good",  "Background loops, ambient pads, scene-setting music for video"),
            ("good",  "Quick prompt iteration — 5-10 sec per generation"),
            ("good",  "Instrumental electronica, lo-fi, cinematic textures"),
            ("good",  "8 GB Mac friendly"),
            ("weak",  "Mono only — for stereo width, use MusicGen stereo small"),
            ("weak",  "Lower musical detail than medium/large — chord progressions can feel generic"),
            ("avoid", "Vocals / lyrics — MusicGen doesn't sing. Use Bark for vocal snippets"),
            ("avoid", "Acoustic / orchestral solo instruments — output leans synthesized"),
        ),
    ),
    ModelEntry(
        repo="facebook/musicgen-medium",
        label="MusicGen medium (1.5B)",
        family="musicgen",
        # Repo is 11.14 GB. No safetensors; only pytorch_model.bin (7.7) +
        # audiocraft files (3.7). Skip audiocraft → ~7.7 GB.
        size_gb=7.7,
        gated=False,
        min_unified_memory_gb=16,
        recommended_hardware="M2 Pro / M3 16 GB unified memory recommended.",
        capabilities=("text-to-music",),
        best_for="The quality sweet spot for MusicGen. Noticeably more detailed than small. Pick this when 16 GB+ is available and you want better musicality.",
        variant_label="Medium · 1.5B",
        quality_label="Balanced",
        speed_label="Medium",
        format_label="Transformers",
        ignore_patterns=_AUDIOCRAFT_LEGACY,
        use_cases=(
            ("good",  "Quality sweet spot — most users should pick this if they have 16 GB"),
            ("good",  "More coherent chord progressions + clearer melodic motifs than small"),
            ("good",  "Genre-specific prompts work better ('bossa nova', 'IDM glitch')"),
            ("weak",  "Slower per-clip than small (~20-30 sec)"),
            ("weak",  "Mono only — for stereo use musicgen-stereo-medium"),
            ("avoid", "Vocals / lyrics — instrumental only"),
        ),
    ),
    ModelEntry(
        repo="facebook/musicgen-large",
        label="MusicGen large (3.3B)",
        family="musicgen",
        # Repo is 19.07 GB. Only .bin shards exist (no safetensors). Skip
        # audiocraft state_dict.bin (6.2) → ~13.1 GB.
        size_gb=13.1,
        gated=False,
        min_unified_memory_gb=32,
        recommended_hardware="M2 Pro 32 GB+ / M2 Max / M3 Max for comfortable generation.",
        capabilities=("text-to-music",),
        best_for="Highest-quality MusicGen. Substantially slower per clip but worth it for final renders. Needs serious memory.",
        variant_label="Large · 3.3B",
        quality_label="Highest detail",
        speed_label="Slow",
        format_label="Transformers",
        ignore_patterns=_AUDIOCRAFT_LEGACY,
        use_cases=(
            ("good",  "Final renders where musical detail matters most"),
            ("good",  "Complex genre fusion prompts ('synthwave meets jazz fusion')"),
            ("good",  "Long-form compositions (close to the 30-sec ceiling)"),
            ("weak",  "Slowest MusicGen — 60+ sec per clip on M-series"),
            ("avoid", "16 GB Macs — needs 32 GB+ to load comfortably"),
            ("avoid", "Quick iteration — use small/medium for prompt scouting first"),
        ),
    ),
    ModelEntry(
        repo="facebook/musicgen-stereo-small",
        label="MusicGen stereo small (300M)",
        family="musicgen",
        # Repo is 7.61 GB — has fp32 AND fp16 weights in BOTH .bin and
        # .safetensors. Keep only fp16 safetensors (1.16 GB) + configs.
        size_gb=1.2,
        gated=False,
        min_unified_memory_gb=8,
        recommended_hardware="Any Apple Silicon Mac with 8 GB.",
        capabilities=("text-to-music", "stereo"),
        best_for="Like small but outputs stereo. Pick this over mono small when you specifically want stereo width for headphones / spatial mixes.",
        variant_label="Stereo small · 300M",
        quality_label="Fast stereo",
        speed_label="Fast",
        format_label="Transformers",
        ignore_patterns=(*_AUDIOCRAFT_LEGACY, "pytorch_model.bin", "*.fp32.bin", "*.fp32.safetensors"),
        use_cases=(
            ("good",  "Stereo output for headphone mixes + spatial sound design"),
            ("good",  "Faster iteration than stereo medium/large"),
            ("good",  "8 GB Mac friendly + smallest stereo MusicGen"),
            ("weak",  "Same musical-detail ceiling as mono small"),
        ),
    ),
    ModelEntry(
        repo="facebook/musicgen-stereo-medium",
        label="MusicGen stereo medium (1.5B)",
        family="musicgen",
        # Repo is 11.06 GB. Keep model.safetensors (3.9), skip pytorch_model.bin
        # (3.9 dupe) + audiocraft (3.5) → ~3.9 GB.
        size_gb=3.9,
        gated=False,
        min_unified_memory_gb=16,
        recommended_hardware="M2 Pro / M3 16 GB.",
        capabilities=("text-to-music", "stereo"),
        best_for="Stereo version of medium. The all-around best balance of quality + stereo width on 16 GB Macs.",
        variant_label="Stereo medium · 1.5B",
        quality_label="Balanced stereo",
        speed_label="Medium",
        format_label="Transformers",
        ignore_patterns=(*_AUDIOCRAFT_LEGACY, "pytorch_model.bin"),
        use_cases=(
            ("good",  "Best stereo MusicGen for most 16 GB Mac users"),
            ("good",  "Production-grade stereo for video soundtracks + podcasts"),
            ("good",  "Genre fusion + detailed arrangements"),
            ("weak",  "Slower than stereo small"),
        ),
    ),
    ModelEntry(
        repo="facebook/musicgen-stereo-large",
        label="MusicGen stereo large (3.3B)",
        family="musicgen",
        # Repo is 19.04 GB. Safetensors shards (6.6) + .bin shards (dupe, 6.6)
        # + audiocraft (6.3). Keep safetensors only → ~6.6 GB.
        size_gb=6.6,
        gated=False,
        min_unified_memory_gb=32,
        recommended_hardware="M2 Max 32 GB+ recommended.",
        capabilities=("text-to-music", "stereo"),
        best_for="Best mainstream MusicGen output. Slow per clip, stereo, top quality. Use for final renders on capable hardware.",
        variant_label="Stereo large · 3.3B",
        quality_label="Best stereo",
        speed_label="Slow",
        format_label="Transformers",
        ignore_patterns=(*_AUDIOCRAFT_LEGACY, "pytorch_model-*.bin"),
        use_cases=(
            ("good",  "Highest-quality stereo MusicGen — reference output"),
            ("good",  "Commercial production where every detail matters"),
            ("weak",  "Slowest stereo MusicGen — 60+ sec per clip"),
            ("avoid", "16 GB Macs — needs 32 GB+ headroom"),
        ),
    ),

    # ──────────── Stable Audio Open ────────────
    ModelEntry(
        repo="stabilityai/stable-audio-open-1.0",
        label="Stable Audio Open 1.0",
        family="stable-audio",
        # Repo is 14.6 GB — has the legacy top-level model.ckpt (4.6) and
        # model.safetensors (4.6) AND the diffusers component directories
        # (transformer/, vae/, text_encoder/ ≈ 5 GB). Diffusers only needs
        # the component dirs, so skip the top-level legacy weights →
        # ~5.1 GB.
        size_gb=5.1,
        gated=True,    # license acceptance required even though weights are open
        min_unified_memory_gb=16,
        recommended_hardware="M2 Pro / M3 16 GB. License acceptance required on HF.",
        capabilities=("text-to-music", "sound-effects"),
        best_for="Longer clips (up to ~47s) and high-fidelity output for both music and sound effects. Different aesthetic than MusicGen — try both and see which suits your prompts. Accept license on the HF page once.",
        sample_rate_hz=44100,
        max_duration_seconds=47,
        variant_label="Open 1.0",
        quality_label="High fidelity",
        speed_label="Slow",
        format_label="Diffusers",
        ignore_patterns=("model.ckpt", "model.safetensors", "vae_model.ckpt", "*.csv"),
        use_cases=(
            ("good",  "Longer clips (up to 47 sec vs MusicGen's 30 sec ceiling)"),
            ("good",  "Higher sample rate (44.1 kHz vs MusicGen's 32 kHz)"),
            ("good",  "Both music AND sound-effects modes from one model"),
            ("good",  "Different aesthetic from MusicGen — try both, pick what suits the prompt"),
            ("weak",  "Requires HF license acceptance even though weights are 'open'"),
            ("weak",  "Slower per-clip than MusicGen on M-series Macs"),
            ("avoid", "Quick prompt scouting — MusicGen small is faster for iteration"),
        ),
    ),
    # ──────────── Bark ────────────
    ModelEntry(
        repo="suno/bark",
        label="Suno Bark (full)",
        family="bark",
        # Repo is 20.68 GB — has both transformers-format pytorch_model.bin
        # (4.3) AND the original .pt checkpoints (16+ GB). Skip the .pt
        # files → ~4.3 GB.
        size_gb=4.3,
        gated=False,
        min_unified_memory_gb=12,
        recommended_hardware="M1 Pro / M2 16 GB recommended.",
        capabilities=("text-to-music", "sound-effects", "vocal"),
        best_for="Vocal/musical hybrids and short expressive audio. Bark embeds tags like [MUSIC] [singing] [laughter] in prompts. Not the right pick for pure instrumental music — use MusicGen for that — but unique for vocal snippets.",
        sample_rate_hz=24000,
        max_duration_seconds=14,
        variant_label="Full",
        quality_label="Most expressive",
        speed_label="Medium",
        format_label="Transformers",
        ignore_patterns=("*.pt",),
        use_cases=(
            ("good",  "Vocal snippets + musical hybrids ([MUSIC], [singing], [♪♪])"),
            ("good",  "Expressive audio with inline tags ([laughter], [sighs], [gasps])"),
            ("good",  "Character voice clips for podcasts + games"),
            ("good",  "MIT licensed"),
            ("weak",  "SLOW — 30-60 sec per clip on M-series Macs"),
            ("weak",  "Short ceiling (14 sec per clip) — not for long compositions"),
            ("avoid", "Pure instrumental music — MusicGen is the right tool"),
            ("avoid", "Precise lip-sync / timing — Bark's pacing varies"),
        ),
    ),
    ModelEntry(
        repo="suno/bark-small",
        label="Suno Bark small",
        family="bark",
        # Repo is just pytorch_model.bin at 1.57 GB.
        size_gb=1.6,
        gated=False,
        min_unified_memory_gb=8,
        recommended_hardware="Any 8 GB+ Mac.",
        capabilities=("text-to-music", "sound-effects", "vocal"),
        best_for="Half-size Bark with most of the capability at lower fidelity. Good for experimenting with vocal/music hybrids on small hardware.",
        sample_rate_hz=24000,
        max_duration_seconds=14,
        variant_label="Small",
        quality_label="Lightweight",
        speed_label="Fast",
        format_label="Transformers",
        use_cases=(
            ("good",  "Try Bark's tag system on 8 GB Macs"),
            ("good",  "Quicker iteration on Bark prompts before committing to full Bark"),
            ("weak",  "Lower fidelity than full Bark — final renders should use the full variant"),
        ),
    ),

)


def get_model(repo: str) -> Optional[ModelEntry]:
    for m in CATALOG:
        if m.repo == repo:
            return m
    return None


def ignore_patterns_for(repo: str) -> tuple[str, ...]:
    """Return the per-repo download skip-list, or () if the repo is unknown
    or has no filtering. Used by downloads.py to thin out huge HF repos that
    ship redundant weight formats."""
    m = get_model(repo)
    if m is None:
        return ()
    return m.ignore_patterns


def serialize_model(m: ModelEntry) -> dict:
    # Per-model hardware-fit verdict against the running Mac's detected RAM.
    # Lazy import avoids any potential cycle at module-load.
    try:
        from . import system_info
        fit = system_info.fit_for(m.min_unified_memory_gb)
    except Exception:
        fit = None
    return {
        "repo": m.repo,
        "label": m.label,
        "family": m.family,
        "family_label": FAMILIES[m.family].label,
        "size_gb": m.size_gb,
        "gated": m.gated,
        "min_unified_memory_gb": m.min_unified_memory_gb,
        "recommended_hardware": m.recommended_hardware,
        "capabilities": list(m.capabilities),
        "best_for": m.best_for,
        "sample_rate_hz": m.sample_rate_hz,
        "max_duration_seconds": m.max_duration_seconds,
        # Naming-compat with the imagestudio frontend code — "apple_optimized"
        # there refers to MLX. Music side has no MLX yet; report False.
        "apple_optimized": False,
        "quantization": None,
        "aliases": [],
        "ignore_patterns": list(m.ignore_patterns),
        # New in v1.1 — structured use cases + hardware fit verdict.
        "use_cases": [{"kind": k, "text": t} for k, t in m.use_cases],
        "fit": fit,
        "variant_label": m.variant_label or m.label,
        "quality_label": m.quality_label,
        "speed_label": m.speed_label,
        "runtime": m.runtime,
        "format_label": m.format_label,
    }


def serialize_family(f: Family) -> dict:
    return {
        "id": f.id,
        "label": f.label,
        "summary": f.summary,
        "how_to_use": f.how_to_use,
    }
