# Running the live server as a service

The live server runs on the home server `homeserver` (since 27 Oct 2026; it was the laptop before, issue #36) as a
systemd **user** service, so it starts on boot, restarts if it crashes, and keeps recording when nobody is logged in.
It listens on `localhost:5080`, which Tailscale shares with the tailnet, and on `localhost:5082` for remote access
through a Cloudflare Tunnel (below).

## The two checkouts

- `~/Dev/supercars-timing`: the **live site**. Always on `main`; only `git pull` and deploy here. The service runs this
  checkout (it builds whatever is checked out), its `wwwroot` is what viewers get, and `data/recordings` lives here.
- `~/Code/supercars-timing`: **development** (branches, Claude, VS Code Remote-SSH). `data/recordings` is a symlink to
  the live checkout's. Servers run here only in replay mode on :5081, never live (one Natsoft connection).

```bash
# Development checkout (once)
mkdir -p ~/Code && cd ~/Code && gh repo clone J-Haynes/supercars-timing
ln -s ~/Dev/supercars-timing/data/recordings ~/Code/supercars-timing/data/recordings
```

## The timing service

```bash
# Install (once) or after editing the unit file
systemctl --user link ~/Dev/supercars-timing/deploy/supercars-timing.service
systemctl --user daemon-reload
systemctl --user enable --now supercars-timing
sudo loginctl enable-linger $USER     # keep user services running when you're logged out (once)

# Day to day
systemctl --user status supercars-timing
systemctl --user restart supercars-timing   # pick up backend changes (rebuilds on start)
journalctl --user -u supercars-timing -f    # logs

# Share on the tailnet (once; persists across reboots): https://homeserver.tail138704.ts.net
sudo tailscale serve --bg 5080
```

- **Deploy after a merge:** `cd ~/Dev/supercars-timing && git pull`, then `cd src/web && npm run build` for frontend
  changes (no restart; viewers refresh) and/or `dotnet build src/SupercarsTiming.Server -c Release` and a restart for
  C# changes (ask the owner first during a session).
- **Restarting mid-session is safe:** on start-up the server replays the current session from `data/recordings`,
  so driver laps and the pit log carry on.
- Requirements: Ubuntu's `dotnet-sdk-10.0`, `nodejs` (22) and `npm` packages.

## Remote access (Cloudflare Tunnel)

Live timing, results and upcoming events are reachable from the internet through a Cloudflare Tunnel
(timing.jackhaynes.nz); **replays are not** (owner's decision, Oct 2026: each replay viewer keeps server cursors,
seeks rebuild state on the server's CPU, and playing pulls ~3 Mbit/s over the home upload). Replays still work on
`localhost:5080` and the tailnet.

How the server tells them apart: `cloudflared` connects from this machine, like `tailscale serve`, so the remote
address can't. The tunnel uses its own port instead, **5082** (`Remote:Port`, set in the service file); requests on
it get `403` from every replay endpoint (both series), and `GET /api/features` answers `{"replay":false}` there, so
the results page hides the Replay button (`src/web/src/features.ts`, `src/SupercarsTiming.Server/RemoteAccess.cs`).
A request carrying Cloudflare's `CF-Connecting-IP` header counts as remote on any port too, so a tunnel pointed at
5080 by mistake (it happened on the first setup) still can't replay. Point it at 5082 anyway.

Set up (once, dashboard-managed tunnel):

1. Optional but recommended: Zero Trust → Access → Applications → Self-hosted for the hostname first, so it's never
   open while you test (allow your email; session duration long, e.g. 1 month, or the live view can't reconnect
   until a reload when it expires).
2. Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared. Install `cloudflared` from Cloudflare's apt
   repository (pkg.cloudflare.com) and run it as a system service with the tunnel's token in a root-only file:
   `/etc/cloudflared/token` (mode 600) and `ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token-file
   /etc/cloudflared/token` in `/etc/systemd/system/cloudflared.service`. Moving the tunnel to another machine is
   just copying that file: the dashboard doesn't change.
3. Public hostname: e.g. `timing` on `example.com`, service **HTTP** `localhost:5082` (**not 5080**: that port has
   replays).
4. Check on mobile data: live view connects, results load, no Replay button; `curl -s localhost:5082/api/features`
   gives `{"replay":false}`.

Turn it off: delete the public hostname, or `sudo systemctl stop cloudflared`.

Not built (owner's call, 27 Oct 2026): public SSH to the server through the tunnel. Tailscale covers the laptop and
the phone without anything public; if it's ever needed, put it behind Cloudflare Access with "Protect with Access"
(JWT enforcement) on the route.

## Other services on the server

- **Claude Code Remote Control** (`~/.config/systemd/user/claude-rc.service`): `claude remote-control --name
  homeserver` in a tmux session `claude`, working directory `~/server`; `Restart=always`, so it comes back after a
  network outage. Reach it at claude.ai/code or in the Claude app; `tmux attach -t claude` on the server.
- **Recordings backup** (on the laptop, `~/.config/systemd/user/recordings-backup.{service,timer}`): daily
  `rsync -a jack@homeserver:Dev/supercars-timing/data/recordings/ ~/Dev/supercars-timing/data/recordings/`
  (`Persistent=true`, so a missed run happens when the laptop wakes). No `--delete`: a file lost on the server stays
  on the laptop.
