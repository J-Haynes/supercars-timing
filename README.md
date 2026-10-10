# Supercars Timing

An unofficial live timing dashboard for the Repco Supercars Championship, in the spirit of the
open-source F1 dashboards (f1-dash, undercut-f1). It reads the same Natsoft timing feed that powers
the free "classic" live timing on supercars.com and shows it in a modern timing tower alongside a live
track map, with cars animated between Natsoft's timing points.

![Status: early prototype](https://img.shields.io/badge/status-prototype-orange)

## What's here

| Path | What it is |
|---|---|
| `src/SupercarsTiming.Natsoft` | Class library: feed decoder, WebSocket client, recording reader/writer, timing state model |
| `src/SupercarsTiming.Server` | ASP.NET Core server. Pulls the feed (live or from a recording) and pushes snapshots over SignalR |
| `src/web` | React + Vite + TypeScript frontend: session header, timing tower and track map |
| `tools/NatsoftRecorder` | Console tool that records the live feed to JSON Lines, decodes recordings, and prints timing sheets |
| `tools/TrackBuilder` | Builds track map files from OpenStreetMap geometry plus a recording |
| `tests/SupercarsTiming.Natsoft.Tests` | xUnit tests for the decoder, state model and recordings |
| `docs/PROTOCOL.md` | Everything known so far about the Natsoft protocol |
| `data/recordings` | Your recordings (git-ignored) |

## Prerequisites

- .NET SDK 10
- Node.js 22+

## Quick start

```bash
# 1. Build and test
dotnet build
dotnet test

# 2. Frontend dependencies
cd src/web && npm install && cd ../..

# 3. Run the server against a recording (newest file in data/recordings, 10x speed)
dotnet run --project src/SupercarsTiming.Server -- --Feed:Mode=Replay --Feed:ReplaySpeed=10

# 4. In another terminal, run the frontend and open http://localhost:5173
cd src/web && npm run dev
```

No recording yet? Record one during a session (below), or run the server in live mode.

## Live mode

```bash
dotnet run --project src/SupercarsTiming.Server
```

Connects to Natsoft and waits until a session goes live, checking every 30 seconds. Add
`--Feed:RecordDirectory=data/recordings` to save the feed while you watch.

## Recording sessions

```bash
dotnet run --project tools/NatsoftRecorder                     # record into data/recordings
dotnet run --project tools/NatsoftRecorder -- replay <file>    # print the final timing sheet
dotnet run --project tools/NatsoftRecorder -- decode <file>    # dump decoded XML
```

Start it a few minutes before a session and leave it running. It reconnects by itself and captures
every session on the feed (support categories included) into one file.

## Using the dashboard

- **Session-aware tower.** Practice and qualifying lead with each driver's best lap and the gap to the fastest;
  races lead with the gap to the leader and the interval to the car ahead.
- **Simple mode** (toggle above the tower) cuts the tower down to the essentials. Detailed is the default.
- **Broadcast delay** slider (0–120 s, with ± buttons for fine-tuning up to 300 s) holds the timing back so it
  matches your TV or stream. Find a moment you can see on both, like a car crossing the line, and nudge the delay
  until they line up. The app keeps a rolling buffer, so changing the delay takes effect immediately.
- **Highlight drivers** by double-clicking them in the tower or on the map. Highlights are remembered.
- **On-track card** for the Top Ten Shootout: the car on its lap, a running lap timer, and the gap to provisional
  pole at every timing point, plus where they're running in the order. It appears automatically for Shootout
  sessions; the "On-track card" control can force it on or off for any session.
- **Map controls:** rotate (remembered per track), zoom with the wheel, a pinch or the buttons, drag to pan.

## Track map

The map shows each car's estimated position. Natsoft only reports when a car passes one of a handful of
timing points (8 per lap at Bathurst), so the map moves each car towards the next point at its recent pace,
slowing for corners using a simulated speed profile. See [`tools/TrackBuilder`](tools/TrackBuilder/README.md)
for how track files are made and how to add a circuit. Available: Mount Panorama (Bathurst).

## Configuration

Server settings live in `src/SupercarsTiming.Server/appsettings.json` under `Feed`, and any of them
can be overridden on the command line (`--Feed:Mode=Replay`).

| Setting | Default | |
|---|---|---|
| `Mode` | `Live` | `Live` or `Replay` |
| `Meeting` | `V8SUPER` | Natsoft meeting ID |
| `RecordDirectory` | empty | Live mode: also save the feed here |
| `ReplayFile` | empty | Replay mode: file to play (empty = newest in `data/recordings`) |
| `ReplaySpeed` | `1` | Replay speed multiplier |
| `ReplayLoop` | `true` | Restart when the recording ends |
| `BroadcastIntervalMs` | `250` | Maximum update rate to clients |

## Production build

```bash
cd src/web && npm run build     # writes to src/SupercarsTiming.Server/wwwroot
cd ../.. && dotnet run --project src/SupercarsTiming.Server
# open http://localhost:5080
```

## Credits

Track geometry © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL.

## Disclaimer

This is an unofficial personal project. It is not affiliated with, endorsed by, or connected to
Supercars, Natsoft, or any team. Timing data belongs to its owners. Use it for personal,
non-commercial purposes, don't redistribute recordings, and keep to one connection to the feed.
