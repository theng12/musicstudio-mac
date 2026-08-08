"""
Music generation manager.

Wraps `transformers.MusicgenForConditionalGeneration`,
`diffusers.StableAudioPipeline`, and `transformers.BarkModel` in a
thread-per-job pattern that mirrors the ImageStudio download / generation
manager.

Worker dispatch is keyed off `model.family`:
- musicgen           → MusicgenForConditionalGeneration via transformers
- stable-audio       → StableAudioPipeline via diffusers
- bark               → BarkModel via transformers

Outputs land in `app/output/<job_id>.wav` and are persisted to
`app/output/.history.json` (same shape as ImageStudio's gen history) so they
survive server restarts.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from . import catalog, cache


# ───────────── module-level state ─────────────

# Music generation in transformers/MPS is not always thread-safe and loading
# multiple models simultaneously easily OOMs Apple Silicon's unified memory.
# Serialize all generations.
_GEN_LOCK = threading.Lock()

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
HISTORY_FILE = OUTPUT_DIR / ".history.json"
HISTORY_MAX = 200
MEMORY_RETRY_LIMIT = 1
MEMORY_RESTART_FAILURES = 2


def _memory_snapshot() -> Optional[dict]:
    try:
        import psutil
        vm = psutil.virtual_memory()
        return {
            "total_gb": round(vm.total / 1e9, 2),
            "available_gb": round(vm.available / 1e9, 2),
            "used_gb": round(vm.used / 1e9, 2),
            "percent": float(vm.percent),
        }
    except Exception:
        return None


def _is_memory_failure(exc: BaseException) -> bool:
    """Recognize allocator exhaustion without misclassifying ordinary errors."""
    if isinstance(exc, MemoryError):
        return True
    message = f"{type(exc).__name__}: {exc}".lower()
    return any(
        marker in message
        for marker in (
            "out of memory",
            "out-of-memory",
            "mps backend out of memory",
            "cannot allocate memory",
            "failed to allocate memory",
            "metal allocation failed",
            "mlx allocation failed",
            "std::bad_alloc",
        )
    )


# ───────────── soft imports of heavy deps ─────────────

MUSIC_GEN_AVAILABLE = False
MUSIC_GEN_IMPORT_ERROR: Optional[str] = None
try:
    import torch  # noqa: F401
    import transformers  # noqa: F401
    # diffusers is optional — only needed for Stable Audio
    try:
        import diffusers  # noqa: F401
        _HAVE_DIFFUSERS = True
    except Exception:
        _HAVE_DIFFUSERS = False
    MUSIC_GEN_AVAILABLE = True
except Exception as e:
    MUSIC_GEN_IMPORT_ERROR = f"{type(e).__name__}: {e}"
    _HAVE_DIFFUSERS = False


def availability() -> dict:
    return {
        "available": MUSIC_GEN_AVAILABLE,
        "diffusers_available": _HAVE_DIFFUSERS,
        "error": MUSIC_GEN_IMPORT_ERROR,
        "duration_presets": [
            {"seconds": 5,  "label": "5s — quick test"},
            {"seconds": 10, "label": "10s — short loop"},
            {"seconds": 15, "label": "15s — standard"},
            {"seconds": 30, "label": "30s — full clip"},
        ],
        "device": _detect_device() if MUSIC_GEN_AVAILABLE else None,
    }


def _detect_device() -> str:
    """Pick the best torch device available. MPS on Apple Silicon, else CPU."""
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


# ───────────── diagnostics ─────────────

# Per-package metadata for the "what's installed" checklist surfaced in the UI.
# Keep this in sync with requirements-generation.txt — if we add a dep there,
# it should also show up here so the user can see whether it loaded.
_PACKAGE_CHECKLIST = [
    ("torch",         "Core ML framework + MPS device support"),
    ("transformers",  "MusicGen and Bark model architectures"),
    ("diffusers",     "Stable Audio Open pipeline"),
    ("accelerate",    "Multi-device model loading (transformers needs it)"),
    ("soundfile",     "WAV file writing (libsndfile)"),
    ("numpy",         "Tensor numerics"),
    ("sentencepiece", "Tokenizer backend for some text encoders"),
]

# Per-engine dependency requirements. When the user looks at the Generate tab,
# the UI shows which engines are ready and which are blocked.
_ENGINE_REQUIREMENTS = {
    "musicgen":     ["torch", "transformers", "soundfile", "accelerate"],
    "stable-audio": ["torch", "diffusers", "soundfile", "accelerate"],
    "bark":         ["torch", "transformers", "soundfile"],
}

_WIRED_FAMILIES = {"musicgen", "stable-audio", "bark"}


# ───────────── Bark preset metadata (shared with VoiceStudio) ─────────────
# In MusicStudio Bark is interesting for [singing], [MUSIC] tags rather than
# plain speech, but the underlying engine is identical to VoiceStudio's.
BARK_VOICE_PRESETS = [
    {"id": "v2/en_speaker_0", "lang": "en", "label": "English · Speaker 0"},
    {"id": "v2/en_speaker_1", "lang": "en", "label": "English · Speaker 1"},
    {"id": "v2/en_speaker_2", "lang": "en", "label": "English · Speaker 2"},
    {"id": "v2/en_speaker_3", "lang": "en", "label": "English · Speaker 3"},
    {"id": "v2/en_speaker_4", "lang": "en", "label": "English · Speaker 4"},
    {"id": "v2/en_speaker_5", "lang": "en", "label": "English · Speaker 5"},
    {"id": "v2/en_speaker_6", "lang": "en", "label": "English · Speaker 6 (popular)"},
    {"id": "v2/en_speaker_7", "lang": "en", "label": "English · Speaker 7"},
    {"id": "v2/en_speaker_8", "lang": "en", "label": "English · Speaker 8"},
    {"id": "v2/en_speaker_9", "lang": "en", "label": "English · Speaker 9"},
    {"id": "v2/zh_speaker_0", "lang": "zh", "label": "Chinese · Speaker 0"},
    {"id": "v2/ja_speaker_0", "lang": "ja", "label": "Japanese · Speaker 0"},
    {"id": "v2/ko_speaker_0", "lang": "ko", "label": "Korean · Speaker 0"},
]

BARK_TAGS = [
    {"tag": "[laughter]",       "label": "Laughter",       "group": "non-verbal"},
    {"tag": "[sighs]",          "label": "Sighs",          "group": "non-verbal"},
    {"tag": "[gasps]",          "label": "Gasps",          "group": "non-verbal"},
    {"tag": "[MUSIC]",          "label": "[MUSIC] — instrumental", "group": "musical"},
    {"tag": "[singing]",        "label": "[singing] — sung lyric", "group": "musical"},
    {"tag": "♪ ♪",              "label": "♪ ♪ — musical phrase",   "group": "musical"},
]


def _have_bark() -> bool:
    try:
        from transformers import BarkModel  # noqa: F401
        return True
    except Exception:
        return False


def _probe_package(name: str) -> dict:
    """Try to import a package, report its version + status."""
    try:
        import importlib
        mod = importlib.import_module(name)
        version = getattr(mod, "__version__", None)
        return {"installed": True, "version": version, "error": None}
    except Exception as e:
        return {"installed": False, "version": None, "error": f"{type(e).__name__}: {e}"}


def diagnostics() -> dict:
    """
    Per-package + per-engine health check the frontend can display so the user
    sees what's missing BEFORE they hit a generation and get cryptic errors.
    Cheap enough to run on every Generate tab focus.
    """
    pkg_results = []
    pkg_status_by_name: dict[str, bool] = {}
    for pkg, role in _PACKAGE_CHECKLIST:
        probe = _probe_package(pkg)
        pkg_results.append({
            "package": pkg,
            "role": role,
            **probe,
        })
        pkg_status_by_name[pkg] = probe["installed"]

    engine_results = []
    for family, requires in _ENGINE_REQUIREMENTS.items():
        missing = [p for p in requires if not pkg_status_by_name.get(p)]
        deps_ok = not missing
        wired = family in _WIRED_FAMILIES
        engine_results.append({
            "family": family,
            "requires": requires,
            "missing": missing,
            "deps_ok": deps_ok,           # all packages importable?
            "wired": wired,               # backend has a worker for this family?
            "ready": deps_ok and wired,   # both — only "ready" engines can generate
        })

    return {
        "device": _detect_device() if MUSIC_GEN_AVAILABLE else None,
        "packages": pkg_results,
        "engines": engine_results,
        "any_missing": any(not p["installed"] for p in pkg_results),
        "ready_count": sum(1 for e in engine_results if e["ready"]),
        "total_engines": len(engine_results),
    }


def _release_device_memory(device: str) -> None:
    """Hint the GPU/MPS allocator to release memory between generations.
    Called in finally blocks after deleting the model object — without this,
    Apple Silicon unified memory stays pinned to the previous generation's
    weights and the next load can OOM."""
    try:
        import gc
        gc.collect()
    except Exception:
        pass
    try:
        import mlx.core as mx
        mx.clear_cache()
    except Exception:
        pass
    try:
        import torch
        if device == "mps":
            torch.mps.empty_cache()
        elif device == "cuda":
            torch.cuda.empty_cache()
    except Exception:
        pass


def _concat_with_crossfade(chunks, sr: int, crossfade_s: float):
    """Concatenate a list of audio arrays with an optional linear crossfade.

    Each chunk has shape (samples, channels) or (samples,). Returns a single
    array of the same shape family. crossfade_s=0 → straight concat.
    """
    import numpy as np
    if not chunks:
        return None
    if len(chunks) == 1:
        return chunks[0]
    cf = int(max(0.0, float(crossfade_s)) * int(sr))
    result = chunks[0]
    for nxt in chunks[1:]:
        if cf > 0 and result.shape[0] >= cf and nxt.shape[0] >= cf:
            dtype = result.dtype
            fade_out = np.linspace(1.0, 0.0, cf, dtype=dtype)
            fade_in = np.linspace(0.0, 1.0, cf, dtype=dtype)
            if result.ndim == 2:
                fade_out = fade_out[:, None]
                fade_in = fade_in[:, None]
            mixed = result[-cf:] * fade_out + nxt[:cf] * fade_in
            result = np.concatenate([result[:-cf], mixed, nxt[cf:]], axis=0)
        else:
            result = np.concatenate([result, nxt], axis=0)
    return result


# ───────────── job model ─────────────

@dataclass
class GenerationJob:
    job_id: str
    mode: str                            # "txt2music" (for now)
    params: dict
    state: str = "queued"
    progress: float = 0.0
    output_path: Optional[str] = None
    resolved_seed: Optional[int] = None
    error: Optional[str] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    thread: Optional[threading.Thread] = None

    def serialize(self) -> dict:
        duration = None
        if self.started_at is not None:
            end = self.finished_at if self.finished_at is not None else time.time()
            duration = max(0.0, end - self.started_at)
        return {
            "id": self.job_id,
            "mode": self.mode,
            "state": self.state,
            "progress": self.progress,
            "params": self.params,
            "output_path": self.output_path,
            "output_url": f"/api/generate/jobs/{self.job_id}/audio" if self.output_path else None,
            "resolved_seed": self.resolved_seed,
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_seconds": duration,
        }


# ───────────── manager ─────────────

class GenerationManager:
    @staticmethod
    def is_family_wired(family: str) -> bool:
        return family in _WIRED_FAMILIES

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, GenerationJob] = {}
        self._musicgen_model = None
        self._musicgen_processor = None
        self._musicgen_repo: Optional[str] = None
        self._stable_audio_pipe = None
        self._stable_audio_repo: Optional[str] = None
        # Bark model cache — same lazy-load + repo-switch eviction pattern as
        # VoiceStudio so unified memory only holds one Bark model at a time.
        self._bark_model = None
        self._bark_processor = None
        self._bark_model_repo: Optional[str] = None
        self._last_model_activity_at: Optional[float] = None
        self._consecutive_memory_failures = 0
        self._last_memory_event: Optional[dict] = None
        self._restart_scheduled = False
        self._restart_timer_started = False
        self._load_history()

    def is_available(self) -> bool:
        return MUSIC_GEN_AVAILABLE

    def list_jobs(self) -> list[GenerationJob]:
        return list(self._jobs.values())

    def get(self, job_id: str) -> Optional[GenerationJob]:
        return self._jobs.get(job_id)

    def has_active_jobs(self) -> bool:
        return any(job.state in ("queued", "running", "cancelling") for job in self._jobs.values())

    def loaded_model_key(self) -> Optional[tuple[str, str]]:
        if self._musicgen_model is not None and self._musicgen_repo:
            return (self._musicgen_repo, "musicgen")
        if self._stable_audio_pipe is not None and self._stable_audio_repo:
            return (self._stable_audio_repo, "stable-audio")
        if self._bark_model is not None and self._bark_model_repo:
            return (self._bark_model_repo, "bark")
        return None

    def has_loaded_model(self) -> bool:
        return self.loaded_model_key() is not None

    def last_activity_at(self) -> Optional[float]:
        return self._last_model_activity_at

    def idle_seconds(self, now: Optional[float] = None) -> Optional[float]:
        if not self.has_loaded_model() or self._last_model_activity_at is None:
            return None
        return max(0.0, (time.time() if now is None else float(now)) - self._last_model_activity_at)

    def memory_status(self) -> dict:
        return {
            "snapshot": _memory_snapshot(),
            "consecutive_failures": self._consecutive_memory_failures,
            "restart_scheduled": self._restart_scheduled,
            "last_event": self._last_memory_event,
            "service_supervised": self._service_installed(),
        }

    def _release_cached_models(self, reason: str) -> dict:
        """Drop every in-process model reference. Caller must hold `_GEN_LOCK`."""
        key = self.loaded_model_key()
        actions: list[str] = []
        for attr in ("_musicgen_model", "_musicgen_processor", "_stable_audio_pipe",
                     "_bark_model", "_bark_processor"):
            value = getattr(self, attr, None)
            if value is not None:
                setattr(self, attr, None)
                actions.append(f"cleared {attr.removeprefix('_')}")
            value = None
        self._musicgen_repo = None
        self._stable_audio_repo = None
        self._bark_model_repo = None
        _release_device_memory(_detect_device())
        actions.append("cleared Python, PyTorch, MLX and Metal allocator caches")
        return {
            "released": key is not None,
            "model": list(key) if key else None,
            "reason": reason,
            "actions": actions,
        }

    def release_memory(self, reason: str = "manual") -> dict:
        if self.has_active_jobs():
            raise RuntimeError("music generation is queued or running")
        with _GEN_LOCK:
            if self.has_active_jobs():
                raise RuntimeError("music generation started before memory could be released")
            return self._release_cached_models(reason)

    @staticmethod
    def _service_installed() -> bool:
        root = Path(__file__).resolve().parents[2]
        return (root / "service" / ".installed").is_file()

    def _record_memory_failure(self, exc: BaseException) -> None:
        self._consecutive_memory_failures += 1
        self._last_memory_event = {
            "time": time.time(),
            "error_type": type(exc).__name__,
            "snapshot": _memory_snapshot(),
        }
        self._release_cached_models("verified-memory-failure")
        print(
            f"[gen] verified memory failure {self._consecutive_memory_failures}/"
            f"{MEMORY_RESTART_FAILURES}; cached models and allocators evicted",
            file=sys.stderr,
            flush=True,
        )
        if (
            self._consecutive_memory_failures < MEMORY_RESTART_FAILURES
            or self._restart_scheduled
        ):
            return
        if not self._service_installed():
            print(
                "[gen] repeated memory failures detected without startup-service "
                "supervision; keeping Music Studio alive",
                file=sys.stderr,
                flush=True,
            )
            return
        self._restart_scheduled = True

    def _start_scheduled_restart(self) -> None:
        """Exit only after the terminal job record has been persisted."""
        if not self._restart_scheduled or self._restart_timer_started:
            return
        self._restart_timer_started = True

        def _exit_for_launchd() -> None:
            print(
                "[gen] restarting Music Studio after repeated memory failures; "
                "launchd KeepAlive will restore it",
                file=sys.stderr,
                flush=True,
            )
            os._exit(75)

        timer = threading.Timer(0.75, _exit_for_launchd)
        timer.daemon = True
        timer.start()

    def _dispatch_with_memory_recovery(
        self,
        job: GenerationJob,
        output_path: Path,
    ) -> None:
        retries = 0
        while True:
            try:
                self._dispatch_txt2music(job, output_path)
                self._consecutive_memory_failures = 0
                return
            except Exception as exc:
                try:
                    output_path.unlink(missing_ok=True)
                except OSError:
                    pass
                if _is_memory_failure(exc):
                    self._record_memory_failure(exc)
                    if retries < MEMORY_RETRY_LIMIT and not self._restart_scheduled:
                        retries += 1
                        if job.resolved_seed is not None:
                            job.params["seed"] = job.resolved_seed
                        print(
                            f"[gen] retrying once with the same seed after memory "
                            f"recovery ({retries}/{MEMORY_RETRY_LIMIT})",
                            file=sys.stderr,
                            flush=True,
                        )
                        continue
                else:
                    self._consecutive_memory_failures = 0
                if self._restart_scheduled:
                    raise RuntimeError(
                        "Repeated memory failures; Music Studio is restarting "
                        "automatically under launchd supervision."
                    ) from exc
                raise

    def _prepare_model_cache(self, repo: str, family: str) -> None:
        current = self.loaded_model_key()
        if current is not None and current != (repo, family):
            print(f"[gen] switching model; evicting {current[0]} ({current[1]})", flush=True)
            self._release_cached_models("model-switch")

    def _musicgen_get_model(self, repo: str, device: str):
        self._prepare_model_cache(repo, "musicgen")
        if self._musicgen_model is not None and self._musicgen_repo == repo:
            return self._musicgen_model, self._musicgen_processor
        from transformers import AutoProcessor, MusicgenForConditionalGeneration
        print(f"[gen] loading MusicGen on {device}: {repo}", flush=True)
        processor = AutoProcessor.from_pretrained(repo)
        model = MusicgenForConditionalGeneration.from_pretrained(repo).to(device)
        model.eval()
        self._musicgen_model = model
        self._musicgen_processor = processor
        self._musicgen_repo = repo
        self._last_model_activity_at = time.time()
        return model, processor

    def _stable_audio_get_pipe(self, repo: str, device: str):
        self._prepare_model_cache(repo, "stable-audio")
        if self._stable_audio_pipe is not None and self._stable_audio_repo == repo:
            return self._stable_audio_pipe
        import torch
        from diffusers import StableAudioPipeline
        print(f"[gen] loading Stable Audio on {device}: {repo}", flush=True)
        pipe = StableAudioPipeline.from_pretrained(repo, torch_dtype=torch.float32).to(device)
        self._stable_audio_pipe = pipe
        self._stable_audio_repo = repo
        self._last_model_activity_at = time.time()
        return pipe

    def cancel(self, job_id: str) -> bool:
        """
        Queued jobs are blocked on `_GEN_LOCK` and can't check cancel_event
        until they acquire the lock. Flip queued → cancelled immediately so
        the UI reacts instantly. Running jobs only get the signal — MusicGen /
        Stable Audio / Bark don't honor mid-generation cancellation, so the
        worker discards the result after generation completes.
        """
        job = self._jobs.get(job_id)
        if job is None or job.state in ("done", "error", "cancelled"):
            return False
        job.cancel_event.set()
        if job.state == "queued":
            job.state = "cancelled"
            job.finished_at = time.time()
            try:
                self._persist()
            except Exception:
                pass
        return True

    def clear_history(self) -> int:
        with self._lock:
            terminal = [jid for jid, j in self._jobs.items()
                        if j.state in ("done", "error", "cancelled")]
            for jid in terminal:
                self._jobs.pop(jid, None)
        self._persist()
        return len(terminal)

    def delete_job(self, job_id: str) -> bool:
        """Remove one finished job from history AND delete its audio file from
        disk. (The DELETE .../jobs/{id} route only cancels active jobs; this is
        for a finished job the user wants gone.)"""
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            return False
        if job.output_path:
            try:
                Path(job.output_path).unlink()
            except FileNotFoundError:
                pass
            except Exception as e:
                print(f"[gen] delete_job unlink failed: {e}", file=sys.stderr, flush=True)
        self._persist()
        return True

    def output_stats(self) -> dict:
        """Total size + count of generated WAVs in the outputs folder — so the UI
        can show how much disk the outputs are using (history index and the files
        on disk can diverge)."""
        total = 0
        count = 0
        if OUTPUT_DIR.exists():
            for p in OUTPUT_DIR.glob("*.wav"):
                try:
                    total += p.stat().st_size
                    count += 1
                except OSError:
                    pass
        return {"bytes": total, "count": count, "dir": str(OUTPUT_DIR.resolve())}

    def prune_outputs(self, keep_last: int = 0, older_than_days: float = 0.0) -> dict:
        """Delete WAV files to reclaim disk. Exactly one mode:
          - keep_last > 0: keep the newest N, delete the rest.
          - older_than_days > 0: delete files older than that many days.
        History entries for deleted files are trimmed too."""
        if not OUTPUT_DIR.exists():
            return {"deleted": 0, "freed_bytes": 0}
        wavs = sorted(OUTPUT_DIR.glob("*.wav"),
                      key=lambda p: p.stat().st_mtime, reverse=True)
        if keep_last > 0:
            to_delete = wavs[keep_last:]
        elif older_than_days > 0:
            cutoff = time.time() - older_than_days * 86400
            to_delete = [p for p in wavs if p.stat().st_mtime < cutoff]
        else:
            return {"deleted": 0, "freed_bytes": 0}
        freed = 0
        deleted = 0
        stems = set()
        for p in to_delete:
            try:
                sz = p.stat().st_size
                p.unlink()
                freed += sz
                deleted += 1
                stems.add(p.stem)
            except OSError:
                pass
        if stems:
            with self._lock:
                for jid in [j for j in self._jobs if j in stems]:
                    self._jobs.pop(jid, None)
            self._persist()
        return {"deleted": deleted, "freed_bytes": freed}

    def start_txt2music(self, params: dict) -> GenerationJob:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        job = GenerationJob(
            job_id=uuid.uuid4().hex[:12],
            mode="txt2music",
            params=params,
        )
        self._jobs[job.job_id] = job
        job.thread = threading.Thread(
            target=self._run_txt2music,
            args=(job,),
            name=f"gen-{job.job_id}",
            daemon=True,
        )
        job.thread.start()
        return job

    # ----- worker -----

    def _run_txt2music(self, job: GenerationJob) -> None:
        # NOTE: don't re-set `job.state = "queued"` here. The dataclass default
        # already initialised it to "queued", and `cancel()` may legitimately
        # have flipped it to "cancelled" between submit_job() and this thread
        # being scheduled. Re-asserting "queued" outside the lock clobbers that
        # cancel decision — the cancel_event flag still survives, but the UI
        # would see the job pop back to "queued" until the worker eventually
        # acquired the lock (potentially minutes later).
        with _GEN_LOCK:
            if job.cancel_event.is_set():
                job.state = "cancelled"
                job.finished_at = time.time()
                self._persist()
                return

            job.state = "running"
            job.started_at = time.time()
            self._last_model_activity_at = job.started_at
            job.progress = 0.05          # move the bar off zero the moment work starts
            print(f"[gen] starting {job.job_id}: {job.params}", flush=True)

            if not MUSIC_GEN_AVAILABLE:
                job.state = "error"
                job.error = f"Generation engine not installed: {MUSIC_GEN_IMPORT_ERROR}"
                job.finished_at = time.time()
                self._persist()
                return

            try:
                output_path = OUTPUT_DIR / f"{job.job_id}.wav"
                self._dispatch_with_memory_recovery(job, output_path)
                if job.cancel_event.is_set():
                    job.state = "cancelled"
                else:
                    job.output_path = str(output_path.resolve())
                    job.progress = 1.0
                    job.state = "done"
                    print(f"[gen] done {job.job_id} → {output_path}", flush=True)
            except Exception as e:
                if job.cancel_event.is_set():
                    job.state = "cancelled"
                else:
                    job.state = "error"
                    job.error = f"{type(e).__name__}: {e}"
                    print(f"[gen] error {job.job_id}: {job.error}", file=sys.stderr, flush=True)
                    traceback.print_exc()
                try:
                    output_path.unlink(missing_ok=True)
                except OSError:
                    pass
            finally:
                job.finished_at = time.time()
                self._last_model_activity_at = job.finished_at
                if job.state != "done":
                    self._release_cached_models("failed-or-cancelled-generation")
                self._persist()
                self._start_scheduled_restart()

    def _dispatch_txt2music(self, job: GenerationJob, output_path: Path) -> None:
        """Pick the right backend pipeline based on model family."""
        params = job.params
        repo = params["repo"]
        model = catalog.get_model(repo)
        if model is None:
            raise ValueError(f"Repo {repo} is not in the catalog")
        if cache.cache_state(repo) != "cached":
            raise ValueError(f"Model {repo} is not fully cached locally — download it first")

        family = model.family
        if family == "musicgen":
            self._generate_musicgen(job, model, output_path)
        elif family == "stable-audio":
            if not _HAVE_DIFFUSERS:
                raise RuntimeError("diffusers is required for Stable Audio. Reinstall Generation.")
            self._generate_stable_audio(job, model, output_path)
        elif family == "bark":
            if not _have_bark():
                raise RuntimeError(
                    "BarkModel isn't importable from your installed transformers. "
                    "Run 'Install Generation' from the Pinokio sidebar to upgrade."
                )
            self._generate_bark(job, model, output_path)
        else:
            raise NotImplementedError(f"No worker implemented for family '{family}'.")

    # ----- MusicGen -----

    def _generate_musicgen(self, job: GenerationJob, model_entry, output_path: Path) -> None:
        """
        Run MusicGen via transformers. Output is a 32 kHz waveform saved as WAV.

        ~50 audio tokens per second of output, so duration_s * 50 ≈ max_new_tokens.
        """
        import torch
        # soundfile writes WAV directly without another PyTorch companion package.
        import soundfile as sf

        params = job.params
        device = _detect_device()
        model, processor = self._musicgen_get_model(model_entry.repo, device)

        try:
            base_seed = params.get("seed")
            if base_seed is None or base_seed < 0:
                import random
                base_seed = random.randint(0, 2**32 - 1)
            job.resolved_seed = int(base_seed)

            duration_s = int(params.get("duration", 10))
            duration_s = max(1, min(duration_s, model_entry.max_duration_seconds))
            # MusicGen audio frame rate is 50 Hz (tokens per second) — confirmed
            # by the model config. So tokens needed ≈ duration_s * 50.
            max_new_tokens = duration_s * 50

            guidance = float(params.get("guidance", 3.0))
            temperature = float(params.get("temperature", 1.0))
            chain_count = max(1, min(int(params.get("chain_count", 1)), 8))
            crossfade_s = max(0.0, float(params.get("crossfade_seconds", 0.0)))

            prompt = params["prompt"].strip()
            if not prompt:
                raise ValueError("prompt is required")

            inputs = processor(
                text=[prompt],
                padding=True,
                return_tensors="pt",
            ).to(device)

            sr = (
                getattr(getattr(model.config, "audio_encoder", None), "sampling_rate", None)
                or getattr(model.config, "sampling_rate", None)
                or model_entry.sample_rate_hz
            )

            chunks = []
            for i in range(chain_count):
                if job.cancel_event.is_set():
                    return
                seed_i = int(base_seed) + i
                torch.manual_seed(seed_i)
                if device == "mps":
                    try:
                        torch.mps.manual_seed(seed_i)
                    except Exception:
                        pass

                print(f"[gen] clip {i+1}/{chain_count}: {duration_s}s ({max_new_tokens} tokens) "
                      f"guidance={guidance} temp={temperature} seed={seed_i}", flush=True)
                with torch.no_grad():
                    audio_values = model.generate(
                        **inputs,
                        max_new_tokens=max_new_tokens,
                        do_sample=True,
                        guidance_scale=guidance,
                        temperature=temperature,
                    )
                tensor = audio_values[0].detach().cpu().to(torch.float32)
                if tensor.ndim == 1:
                    tensor = tensor.unsqueeze(0)   # ensure (channels, samples)
                # soundfile expects (samples, channels), torch gives (channels, samples).
                chunks.append(tensor.numpy().T)
                job.progress = (i + 1) / chain_count

            combined = _concat_with_crossfade(chunks, int(sr), crossfade_s)
            sf.write(str(output_path), combined, int(sr), subtype="PCM_16")
            total_s = (combined.shape[0] if combined.ndim >= 1 else 0) / max(1, int(sr))
            print(f"[gen] saved {chain_count}-clip WAV ({total_s:.1f}s, crossfade={crossfade_s}s) "
                  f"at {sr} Hz: {output_path}", flush=True)
        finally:
            self._last_model_activity_at = time.time()

    # ----- Stable Audio Open -----

    def _generate_stable_audio(self, job: GenerationJob, model_entry, output_path: Path) -> None:
        """
        Stable Audio Open via diffusers. Produces 44.1 kHz audio up to ~47 seconds.
        Uses classifier-free guidance with negative prompts.
        """
        import torch
        import soundfile as sf

        params = job.params
        device = _detect_device()
        # float32 on MPS — float16 is faster but MPS support for sd-style fp16 audio
        # pipelines was flaky as of mid-2025. Keep it safe.
        pipe = self._stable_audio_get_pipe(model_entry.repo, device)

        try:
            base_seed = params.get("seed")
            if base_seed is None or base_seed < 0:
                import random
                base_seed = random.randint(0, 2**32 - 1)
            job.resolved_seed = int(base_seed)

            duration_s = float(params.get("duration", 10))
            duration_s = max(1.0, min(duration_s, float(model_entry.max_duration_seconds)))
            steps = int(params.get("steps", 100))
            guidance = float(params.get("guidance", 7.0))
            chain_count = max(1, min(int(params.get("chain_count", 1)), 8))
            crossfade_s = max(0.0, float(params.get("crossfade_seconds", 0.0)))

            prompt = params["prompt"].strip()
            negative = (params.get("negative_prompt") or "").strip() or None

            # Sample-rate attribute path varies across diffusers versions:
            # - diffusers >= 0.30:  pipe.vae.config.sampling_rate (often)
            # - newer:              pipe.transformer.config.sample_rate
            # - some builds:        no attribute at all
            # Fall back to the catalog entry (44100 for stable-audio-open).
            sr = (
                getattr(getattr(pipe, "vae", None), "config", None) and
                getattr(pipe.vae.config, "sampling_rate", None)
            ) or (
                getattr(getattr(pipe, "transformer", None), "config", None) and
                getattr(pipe.transformer.config, "sample_rate", None)
            ) or model_entry.sample_rate_hz

            chunks = []
            for i in range(chain_count):
                if job.cancel_event.is_set():
                    return
                seed_i = int(base_seed) + i
                # torch.Generator on MPS landed in torch 2.0, but on some torch+macOS
                # combos it still falls back to CPU seeds. Use CPU generator as a
                # fallback — the actual diffusion is still on MPS, only the initial
                # noise sampling differs. Safer than crashing.
                try:
                    generator = torch.Generator(device=device).manual_seed(seed_i)
                except Exception:
                    generator = torch.Generator(device="cpu").manual_seed(seed_i)

                print(f"[gen] clip {i+1}/{chain_count}: {duration_s}s, {steps} steps, "
                      f"guidance={guidance}, seed={seed_i}", flush=True)
                result = pipe(
                    prompt=prompt,
                    negative_prompt=negative,
                    num_inference_steps=steps,
                    audio_end_in_s=duration_s,
                    num_waveforms_per_prompt=1,
                    generator=generator,
                )
                audio = result.audios[0]   # (channels, samples) float32 tensor
                if audio.ndim == 1:
                    audio = audio.unsqueeze(0)
                # → (samples, channels)
                chunks.append(audio.detach().cpu().to(torch.float32).numpy().T)
                job.progress = (i + 1) / chain_count

            combined = _concat_with_crossfade(chunks, int(sr), crossfade_s)
            sf.write(str(output_path), combined, int(sr), subtype="PCM_16")
            total_s = (combined.shape[0] if combined.ndim >= 1 else 0) / max(1, int(sr))
            print(f"[gen] saved {chain_count}-clip WAV ({total_s:.1f}s, crossfade={crossfade_s}s) "
                  f"at {sr} Hz: {output_path}", flush=True)
        finally:
            self._last_model_activity_at = time.time()

    # ----- Bark (Suno via transformers) -----

    def _bark_get_model(self, repo: str, device: str):
        self._prepare_model_cache(repo, "bark")
        if self._bark_model_repo == repo and self._bark_model is not None:
            return self._bark_model, self._bark_processor

        from transformers import AutoProcessor, BarkModel
        print(f"[gen] loading Bark from HF hub: {repo} on {device}", flush=True)
        processor = AutoProcessor.from_pretrained(repo)
        model = BarkModel.from_pretrained(repo)
        model = model.to(device)
        model.eval()
        self._bark_model = model
        self._bark_processor = processor
        self._bark_model_repo = repo
        self._last_model_activity_at = time.time()
        return model, processor

    def _generate_bark(self, job: GenerationJob, model_entry, output_path: Path) -> None:
        """
        Bark for MusicStudio — used primarily for musical/expressive output via
        [singing], [MUSIC], and ♪ tags. The prompt field is reused for the text
        Bark synthesizes; a voice_preset chooses the speaker.
        """
        import torch
        import soundfile as sf

        params = job.params
        device = _detect_device()

        # MusicStudio uses `prompt`; if `text` is also set, accept that.
        prompt = (params.get("prompt") or params.get("text") or "").strip()
        if not prompt:
            raise ValueError("prompt is required")

        seed = params.get("seed")
        if seed is None or seed < 0:
            import random
            seed = random.randint(0, 2**32 - 1)
        job.resolved_seed = int(seed)
        try:
            torch.manual_seed(int(seed))
            if device == "mps":
                try:
                    torch.mps.manual_seed(int(seed))
                except Exception:
                    pass
        except Exception:
            pass

        voice_preset = (params.get("bark_voice_preset") or "").strip() or None
        if voice_preset:
            print(f"[gen] bark voice_preset={voice_preset}", flush=True)
        else:
            print(f"[gen] bark random voice (no preset)", flush=True)

        if job.cancel_event.is_set():
            return

        model, processor = self._bark_get_model(model_entry.repo, device)

        proc_kwargs = {"text": prompt, "return_tensors": "pt"}
        if voice_preset:
            proc_kwargs["voice_preset"] = voice_preset
        try:
            inputs = processor(**proc_kwargs)
        except Exception as e:
            raise RuntimeError(
                f"Bark processor rejected the input ({e}). "
                "If you used a voice_preset, double-check the id (e.g. 'v2/en_speaker_6')."
            )
        if hasattr(inputs, "to"):
            inputs = inputs.to(device)
        else:
            inputs = {k: (v.to(device) if hasattr(v, "to") else v) for k, v in inputs.items()}

        print(f"[gen] bark generating ({len(prompt)} chars)", flush=True)
        with torch.no_grad():
            audio_array = model.generate(**inputs)

        audio_np = audio_array.detach().cpu().to(torch.float32).numpy()
        if audio_np.ndim > 1:
            audio_np = audio_np.squeeze()

        sr = int(getattr(getattr(model, "generation_config", None), "sample_rate", 24000) or 24000)
        sf.write(str(output_path), audio_np, sr, format="WAV", subtype="PCM_16")
        self._last_model_activity_at = time.time()
        print(f"[gen] bark saved WAV at {sr} Hz, {len(audio_np)/sr:.2f}s: {output_path}", flush=True)

    # ----- persistence -----

    def _persist(self) -> None:
        try:
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            terminal = [j for j in self._jobs.values()
                        if j.state in ("done", "error", "cancelled")]
            terminal.sort(key=lambda j: j.finished_at or 0, reverse=True)
            terminal = terminal[:HISTORY_MAX]
            payload = {"jobs": [self._to_disk(j) for j in terminal]}
            tmp = HISTORY_FILE.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, default=str))
            os.replace(tmp, HISTORY_FILE)
        except Exception as e:
            print(f"[gen] persist failed: {e}", file=sys.stderr, flush=True)

    def _load_history(self) -> None:
        if not HISTORY_FILE.exists():
            return
        try:
            payload = json.loads(HISTORY_FILE.read_text())
            for raw in payload.get("jobs", []):
                job = self._from_disk(raw)
                if job is not None:
                    self._jobs[job.job_id] = job
            print(f"[gen] loaded {len(self._jobs)} jobs from history", flush=True)
        except Exception as e:
            print(f"[gen] load history failed: {e}", file=sys.stderr, flush=True)

    @staticmethod
    def _to_disk(job: GenerationJob) -> dict:
        return {
            "job_id": job.job_id,
            "mode": job.mode,
            "state": job.state,
            "progress": job.progress,
            "params": job.params,
            "output_path": job.output_path,
            "resolved_seed": job.resolved_seed,
            "error": job.error,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
        }

    @staticmethod
    def _from_disk(raw: dict) -> Optional["GenerationJob"]:
        try:
            output_path = raw.get("output_path")
            if output_path and not Path(output_path).exists():
                output_path = None
            return GenerationJob(
                job_id=raw["job_id"],
                mode=raw.get("mode", "txt2music"),
                params=raw.get("params") or {},
                state=raw.get("state", "done"),
                progress=raw.get("progress", 1.0),
                output_path=output_path,
                resolved_seed=raw.get("resolved_seed"),
                error=raw.get("error"),
                started_at=raw.get("started_at"),
                finished_at=raw.get("finished_at"),
            )
        except Exception:
            return None


manager = GenerationManager()
