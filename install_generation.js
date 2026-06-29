// Heavy install: adds the audio generation stack (torch, torchaudio,
// transformers, diffusers, accelerate) on top of the Phase 1 deps.
// Required before any actual music can be generated. Safe to re-run.
//
// Note: we deliberately AVOID `audiocraft` (Meta's MusicGen library) because
// it pins old torch==2.1.0 and old xformers, which would downgrade and break
// half the env. transformers ships MusicGen directly so we use that path.
//
// Restart flow: the long-lived server must restart after the install, or its
// Python keeps the old sys.modules cache and never sees the freshly installed
// packages ("ModuleNotFoundError" even though pip succeeded). Two ways the server
// runs, both handled:
//   * Normal mode  — start.js runs the server. Stop before install, start after.
//   * Service mode — the launchd startup service (service/.installed marker) runs
//     the server, NOT start.js. Do NOT start start.js (it would fight the service
//     for the fixed port); restart the service after the install instead.
module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    // Normal mode only: stop the start.js server (no-op in service mode, where
    // start.js isn't the thing running the server).
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
    // Normal mode: bring the start.js server back up.
    {
      when: "{{!exists('service/.installed')}}",
      method: "script.start",
      params: { uri: "start.js" }
    },
    // Service mode: restart the launchd service so the running server reloads
    // Python and picks up the freshly installed packages.
    {
      when: "{{exists('service/.installed')}}",
      method: "shell.run",
      params: {
        message: [
          "bash restart_service.sh"
        ]
      }
    },
    {
      method: "notify",
      params: {
        html: "Music generation engine installed. Server restarted — Generate is ready."
      }
    }
  ]
}
