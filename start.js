module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        path: "app",
        conda: {
          "path": "{{path.resolve(cwd, 'conda_env')}}"
        },
        env: {
          "PYTHONUNBUFFERED": "1"
        },
        message: [
          // Binds on every interface (LAN, Tailscale, loopback) at a fixed
          // port so other devices can hit the API directly. We picked 47869
          // so it doesn't clash with ImageStudio's 47868.
          "python -m uvicorn backend.main:app --host 0.0.0.0 --port 47869"
        ],
        on: [{
          event: "/Uvicorn running on (http:\\/\\/[0-9.:]+)/",
          done: true
        }, {
          event: "/error:/i",
          break: false
        }]
      }
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}"
      }
    }
  ]
}
