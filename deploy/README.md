# Running the live server as a service

The live server runs as a systemd **user** service, so it starts on boot, restarts if it crashes, and keeps
recording when no terminal is open. It listens on `localhost:5080` only; Tailscale shares it with your tailnet.

```bash
# Install (once) or after editing the unit file
systemctl --user link ~/Dev/supercars-timing/deploy/supercars-timing.service
systemctl --user daemon-reload
systemctl --user enable --now supercars-timing
loginctl enable-linger $USER          # keep user services running when you're logged out (once)

# Day to day
systemctl --user status supercars-timing
systemctl --user restart supercars-timing   # pick up backend changes (rebuilds on start)
journalctl --user -u supercars-timing -f    # logs

# Share on the tailnet (once; persists across reboots)
tailscale serve --bg 5080
```

- **Frontend changes:** the service serves the built site, so run `cd src/web && npm run build`. No restart needed.
- **Restarting mid-session is safe:** on start-up the server replays the current session from `data/recordings`,
  so driver laps and the pit log carry on.
- **Development:** stop the service first (`systemctl --user stop supercars-timing`); only one process can use
  port 5080, and there must only ever be one connection to Natsoft.
