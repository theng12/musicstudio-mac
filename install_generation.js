// Heavy install: adds the audio generation stack (torch, torchaudio,
// transformers, diffusers, accelerate) on top of the Phase 1 deps.
// Required before any actual music can be generated. Safe to re-run.
//
// Note: we deliberately AVOID `audiocraft` (Meta's MusicGen library) because
// it pins old torch==2.1.0 and old xformers, which would downgrade and break
// half the env. transformers ships MusicGen directly so we use that path.
//
// Restart flow: if start.js is running when this script fires, we stop
// it first so its Python process exits, then run the install, then start
// it back up. Without the stop+start the long-lived uvicorn worker keeps
// the old sys.modules cache and never sees the freshly installed torch —
// the UI then surfaces "ModuleNotFoundError: No module named 'torch'"
// even though pip succeeded. Auto-restarting removes the manual
// "Stop → Start" step users used to have to remember.
module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    {
      when: "{{running('start.js')}}",
      method: "script.stop",
      params: { uri: "start.js" }
    },
    {
      method: "shell.run",
      params: {
        path: "app",
        conda: {
          "path": "{{path.resolve(cwd, 'conda_env')}}"
        },
        message: [
          "uv pip install -r requirements-generation.txt"
        ]
      }
    },
    {
      method: "script.start",
      params: { uri: "start.js" }
    },
    {
      method: "notify",
      params: {
        html: "Music generation engine installed. Server restarted — Generate is ready."
      }
    }
  ]
}
