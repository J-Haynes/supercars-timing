# Learning plan: running and investigating the live server

**Goal:** check on, investigate and fix the live timing server myself, from a terminal, without asking Claude Code
to do it for me. By the end I should be able to answer "is it up, what is it doing, and what went wrong at 2:14 pm?"
from the logs and the machine, and explain every command I used.

This plan is about **operations**: SSH, systemd, journald logs, disk, memory, the network, and a restart. How the
code works (decoder, timing state, the frontend) is a separate topic.

**How to use it:** work through the levels in order, one or two per sitting. Type every command yourself; don't paste
from here. Tick a level off only when you can do its **Check** from memory. If something here is wrong, fix this
file rather than working around it.

**When I ask Claude Code for help with this plan,** it should explain the command and what the output means, and
let me type it. It shouldn't run the investigation for me.

---

## Safety rules (read before every sitting)

- **Never stop or restart `supercars-timing` during a session** (a scheduled practice, qualifying or race, plus the
  30 minutes either side, when the server is connected to Natsoft). Check `src/web/src/schedule/supercars.json` or the
  site's upcoming events first. Do level 7 (restart) on a quiet weekday.
- **One Natsoft connection, ever.** Never start a live-mode server on the laptop or in `~/Code/supercars-timing`. The
  only live server is the service in `~/Dev/supercars-timing`.
- **Read-only first.** Every command in levels 1-6 only reads. Level 7 is the first one that changes anything.
- **Never edit or delete anything in `data/recordings/`.** They can't be re-recorded.
- `sudo` is only needed for `cloudflared` (a system service). Everything else is my user's.

## The setup in one paragraph

`homeserver` is a ThinkCentre M90q running **Ubuntu Server 26.04**, reached over Tailscale with a key-only SSH login
as `jack`. The timing app runs as a systemd **user** service called `supercars-timing` (so every `systemctl` and
`journalctl` command needs `--user`), from the live checkout `~/Dev/supercars-timing`, listening on `localhost:5080`
(me and the tailnet) and `localhost:5082` (the public site, through a Cloudflare Tunnel, no replays). `cloudflared`
is a **system** service (no `--user`, needs `sudo`). Recordings go to `~/Dev/supercars-timing/data/recordings`. The
unit file is `deploy/supercars-timing.service`; the full setup is in `deploy/README.md` and the `CLAUDE.md` section
"Where it runs".

---

## Level 1: get in and look around

```bash
ssh jack@homeserver          # from the laptop (Tailscale must be up: `tailscale status`)
whoami; hostname; uptime     # who am I, which machine, how long since the last reboot, and the load averages
pwd; ls ~/Dev/supercars-timing
cat /etc/os-release          # which Ubuntu
exit                         # back to the laptop
```

- **Learn:** what SSH is (an encrypted shell on another machine), why this one only accepts my key, and what the three
  load-average numbers in `uptime` mean (average busy processes over 1, 5 and 15 minutes; on this 6-core CPU, under 6
  is fine).
- **Check:** from memory, SSH in, say how long the server has been up, and get back out.

## Level 2: is the service running?

```bash
systemctl --user status supercars-timing      # the one-screen summary
systemctl --user is-active supercars-timing   # just "active" or not, handy in scripts
systemctl --user cat supercars-timing         # the unit file systemd is actually using
systemctl --user list-units --type=service    # every user service (supercars-timing, claude-rc)
```

- **Learn:** read every line of the `status` output: `Loaded` (where the unit file is, enabled at boot or not),
  `Active` (running, since when), `Main PID`, `Memory`, `CPU`, and the last few log lines under it.
- **Learn:** in the unit file, what `ExecStart`, `WorkingDirectory`, `Environment`, `Restart=on-failure` and
  `RestartSec=10` do, and why it's a *user* service with linger on (it keeps running when I'm logged out).
- **Check:** tell someone, from the `status` output alone, whether the server is up, since when, and how much memory
  it's using.

## Level 3: read the logs

```bash
journalctl --user -u supercars-timing -n 50 --no-pager      # the last 50 lines
journalctl --user -u supercars-timing -f                    # follow live (Ctrl+C to stop)
journalctl --user -u supercars-timing --since "1 hour ago"
journalctl --user -u supercars-timing --since "2026-11-08 13:00" --until "2026-11-08 15:00"
journalctl --user -u supercars-timing --since today | grep -A 1 -E "(warn|fail|crit):"   # warnings and errors
journalctl --user -u supercars-timing -b                    # since the last boot
journalctl --user -u supercars-timing -o short-iso          # full timestamps, good for notes
```

- **Learn:** journald keeps the service's console output with a timestamp on every line. `-u` picks the unit, `-n`
  the number of lines, `-f` follows, `--since/--until` take a time window, and `-b` limits it to the current boot.
- **Learn how this app's lines look.** .NET's console logger writes each entry as two lines: the level and the
  category first (`info: SupercarsTiming.Server.Feed.TimingFeedService[0]`), then the message, indented, on the
  next line. The levels are `info`, `warn` (the code's `LogWarning`), `fail` (`LogError`) and `crit`. That's why the
  warnings command above uses `grep -A 1`: it prints the level line and the message under it.
- **Why not `journalctl -p warning`?** That filters on journald's own priority, and this app doesn't set one (it
  doesn't use .NET's systemd logging integration), so every line is filed at the same priority and `-p warning`
  shows nothing. Worth knowing: on servers that do set priorities, `-p` is the quickest filter.
- **Learn:** pipe into `less` to scroll and search (`/` to search, `n` for the next match, `q` to quit).
- **Check:** show the warnings from yesterday, with their messages.

## Level 4: find things in the logs

The server writes these messages (from the C# code), so I know what to search for. Each one sits on the line under
its `info:`/`warn:` level line (level 3):

| Log line | Where it comes from | What it means |
|---|---|---|
| `Connecting to Natsoft for <session>, until <time>` | `Feed/TimingFeedService.cs` | a session window has opened |
| `Meeting <id> not live, checking again in 30s` | `NatsoftClient.cs` | connected to the schedule window, but Natsoft isn't live yet |
| `Connected to <uri>` | `NatsoftClient.cs` | the WebSocket is up |
| `Recording live feed to <path>` | `Feed/TimingFeedService.cs` | which recording file this session goes into |
| `Natsoft connection dropped` | `NatsoftClient.cs` | the connection broke (warning, with the exception) |
| `Network changed: this machine no longer has <address>` | `NatsoftClient.cs` | the network address went away, reconnecting |
| `No live timing token on the <meeting> page` | `NatsoftClient.cs` | the page token wasn't found (see docs/PROTOCOL.md) |
| `Restoring <session> from recordings (<n> messages)` | `Feed/TimingFeedService.cs` | warm start after a restart |
| `Disconnected from Natsoft: <session> is over` | `Feed/TimingFeedService.cs` | the window closed normally |

```bash
journalctl --user -u supercars-timing --since today | grep -i "natsoft"
journalctl --user -u supercars-timing --since "3 days ago" | grep -E "dropped|Network changed|token"
journalctl --user -u supercars-timing --since "3 days ago" | grep -c "Connected to"   # count the connections
journalctl --user -u supercars-timing --since today | grep -i -B 3 -A 10 "exception"  # lines around an error
```

- **Learn:** `grep -i` (any case), `-E` (several patterns with `|`), `-c` (count), `-B`/`-A` (lines before and after
  a match, which is where the useful context for an exception usually is).
- **Exercise: write the story of a session from its logs alone.** After the next practice or race, find when the
  window opened, when the connection came up, which file it recorded to, any drops, and when it disconnected. Write
  it in 5 lines with timestamps, then compare with what the site showed.
- **Check:** given a time someone says "the site froze", find what the server logged in the 5 minutes around it.

## Level 5: the machine

```bash
df -h                                          # disk space per filesystem (watch the root /)
du -sh ~/Dev/supercars-timing/data/recordings  # how much the recordings take
ls -lht ~/Dev/supercars-timing/data/recordings | head   # newest recordings first, with sizes
free -h                                        # memory: total, used, available
top                                            # live processes (q to quit; M sorts by memory, P by CPU)
ps aux | grep -i supercars                     # the server's process and its command line
```

- **Learn:** in `free -h`, *available* is the number that matters, not *free* (Linux uses spare memory as a disk
  cache). In `top`, find the dotnet process and read its `%CPU`, `%MEM` and `RES`.
- **Exercise:** work out roughly how much disk one race weekend of recordings takes, and how many weekends fit in
  what's left. Write the answer here.
- **Check:** answer "is the server short on disk or memory?" in under a minute.

## Level 6: the network path

How a public visitor reaches the app: browser → Cloudflare → `cloudflared` on the server → `localhost:5082` → the app.
How I reach it on the tailnet: `https://homeserver.tail138704.ts.net` → `tailscale serve` → `localhost:5080` → the app.

```bash
ss -tlnp | grep -E "5080|5082"                  # is something listening on both ports, and which process?
curl -s localhost:5080/api/features             # {"replay":true}: the local port
curl -s localhost:5082/api/features             # {"replay":false}: the tunnel's port
curl -sI localhost:5080 | head -1               # just the HTTP status line
tailscale status                                # devices on the tailnet and whether they're online
tailscale serve status                          # what's shared on the tailnet
sudo systemctl status cloudflared               # the tunnel (system service: no --user, needs sudo)
sudo journalctl -u cloudflared --since "1 hour ago"
```

- **Learn:** what "listening on a port" means, why the app only listens on `localhost` (nothing outside the machine can
  reach it directly; Tailscale and Cloudflare are the only ways in), and why the tunnel points at 5082 (no replays
  for the public, see `deploy/README.md`).
- **Exercise: find the broken link.** When the public site doesn't load, work along the path: is the app running
  (level 2)? Does `curl localhost:5082` answer? Is `cloudflared` running and connected (its logs)? Does the tailnet
  address work? The first link that fails is where to look.
- **Check:** explain, without notes, why the public site has no Replay button and which command proves it.

## Level 7: restart and watch it come back

Only outside a session (safety rules above).

```bash
journalctl --user -u supercars-timing -f       # in one SSH window
systemctl --user restart supercars-timing      # in a second SSH window
systemctl --user status supercars-timing       # active again? new PID? "since" just now?
curl -s localhost:5080/api/features
```

- **Learn:** watch the log window while it restarts: the old process stops, `dotnet run` builds and starts, and if a
  session was recorded in the last 15 minutes you'll see `Restoring ... from recordings` (the warm start). Time how
  long it takes.
- **Learn:** `Restart=on-failure` restarts the server by itself 10 s after a crash. Find a crash and an automatic
  restart in the logs if one has ever happened (`journalctl --user -u supercars-timing | grep -i -E "failed|restart"`).
- **Check:** restart the service and confirm it's healthy with three commands, from memory.

## Level 8: the incident drill

Next time something odd happens on the live site (a freeze, missing cars, the site down, a slow page), **investigate
it myself first** with levels 2-6, then compare notes with Claude Code. Write each one up in the log below:

```
### YYYY-MM-DD HH:MM: <one-line symptom>
- Noticed: what I saw, where, and when
- Checked: the commands I ran, in order
- Found: the evidence (log lines with timestamps, numbers)
- Cause: what actually went wrong (or "unknown", which is an allowed answer)
- Fixed: what I did, and how I confirmed it worked
- Next time: what I'd check first
```

When there's no real incident, make a harmless one on a quiet day: stop the service
(`systemctl --user stop supercars-timing`), then diagnose the public site from the outside in as level 6 describes,
and start it again (`systemctl --user start supercars-timing`).

## Cheat sheet

| I want to... | Command |
|---|---|
| Get on the server | `ssh jack@homeserver` |
| Is it running? | `systemctl --user status supercars-timing` |
| Follow the logs | `journalctl --user -u supercars-timing -f` |
| Logs in a window | `journalctl --user -u supercars-timing --since "..." --until "..."` |
| Only problems | `journalctl --user -u supercars-timing --since today \| grep -A 1 -E "(warn\|fail\|crit):"` |
| Search the logs | `journalctl --user -u supercars-timing --since today \| grep -i "<text>"` |
| Disk / memory / CPU | `df -h` / `free -h` / `top` |
| Ports listening | `ss -tlnp \| grep 508` |
| App answering? | `curl -s localhost:5080/api/features` |
| Tunnel | `sudo systemctl status cloudflared` |
| Restart (no session on!) | `systemctl --user restart supercars-timing` |

## Progress

- [ ] Level 1: get in and look around
- [ ] Level 2: is the service running?
- [ ] Level 3: read the logs
- [ ] Level 4: find things in the logs (and one session story written)
- [ ] Level 5: the machine (and the disk-per-weekend estimate)
- [ ] Level 6: the network path
- [ ] Level 7: restart and watch it come back
- [ ] Level 8: one real or practice incident written up

## Incident log

(none yet)
