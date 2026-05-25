// Heavy install: adds the audio generation stack (torch, torchaudio,
// transformers, diffusers, accelerate) on top of the Phase 1 deps.
// Required before any actual music can be generated. Safe to re-run.
//
// Note: we deliberately AVOID `audiocraft` (Meta's MusicGen library) because
// it pins old torch==2.1.0 and old xformers, which would downgrade and break
// half the env. transformers ships MusicGen directly so we use that path.
module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
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
      method: "notify",
      params: {
        html: "Music generation engine installed. Restart the server (Stop → Start) to enable the Generate tab."
      }
    }
  ]
}
