# Running the live server as a service

The live server runs as a systemd **user** service, so it starts on boot, restarts if it crashes, and keeps
recording when no terminal is open. It listens on `localhost:5080`, which Tailscale shares with your tailnet, and on `localhost:5082` for remote access
through a Cloudflare Tunnel (below).

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

## Remote access (Cloudflare Tunnel)

Live timing, results and upcoming events are reachable from the internet through a Cloudflare Tunnel; **replays are
not** (owner's decision, Oct 2026: each replay viewer keeps server cursors, seeks rebuild state on this laptop's CPU,
and playing pulls ~3 Mbit/s over the home upload). Replays still work on `localhost:5080` and the tailnet.

How the server tells them apart: `cloudflared` connects from this machine, like `tailscale serve`, so the remote
address can't. The tunnel uses its own port instead, **5082** (`Remote:Port`, set in the service file); requests on
it get `403` from every replay endpoint (both series), and `GET /api/features` answers `{"replay":false}` there, so
the results page hides the Replay button (`src/web/src/features.ts`, `src/SupercarsTiming.Server/RemoteAccess.cs`).

Set up (once, dashboard-managed tunnel):

1. Optional but recommended: Zero Trust → Access → Applications → Self-hosted for the hostname first, so it's never
   open while you test (allow your email; session duration long, e.g. 1 month, or the live view can't reconnect
   until a reload when it expires).
2. Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared. Run the install commands it shows, including
   `sudo cloudflared service install <token>` (a system service, starts on boot).
3. Public hostname: e.g. `timing` on `example.com`, service **HTTP** `localhost:5082` (**not 5080**: that port has
   replays).
4. Check on mobile data: live view connects, results load, no Replay button; `curl -s localhost:5082/api/features`
   gives `{"replay":false}`.

Turn it off: delete the public hostname, or `sudo systemctl stop cloudflared`. The site is only up while this laptop
is (asleep or lid closed = down; `HandleLidSwitch=ignore` in `/etc/systemd/logind.conf` if needed).
