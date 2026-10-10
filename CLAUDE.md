# CLAUDE.md

Guidance for Claude Code working in this repo.

## Project

Unofficial live timing dashboard for the Repco Supercars Championship (F1-dashboard style). Data
comes from Natsoft's public live timing WebSocket, the same feed behind supercars.com's free
"classic" live timing. Goals in order: timing tower → interpolated track map → charts and analysis
(lap times, gaps, stints, battles) → broadcast-delay sync and session replay.

Owner is a junior developer working in React, .NET/C# and SQL. Prefer clear, idiomatic code over
clever code, and explain non-obvious decisions in comments or the PR description.

## Layout

- `src/SupercarsTiming.Natsoft`: no ASP.NET dependency. Protocol and domain logic lives here.
  - `NatsoftDecoder`: XOR-chain frame decoding
  - `NatsoftClient`: WebSocket client with reconnect / NotFound / Redirect handling
  - `Recording` (`RecordingWriter`, `RecordingReader`): JSON Lines recordings, including timed replay
  - `TimingState`: applies XML messages to an in-memory model (`Entries`, `Cars`, flag, clock)
  - `TimingSnapshot`: flat, serialisable view of `TimingState` sent to the UI
- `src/SupercarsTiming.Server`: ASP.NET Core minimal API + SignalR.
  - `Feed/TimingFeedService`: background service, live or replay → `TimingStore`
  - `Feed/TimingStore`: lock-protected `TimingState`, rebuilds snapshots only when dirty
  - `Feed/SnapshotBroadcaster`: pushes `TimingUpdate` to `/hubs/timing` at most every `BroadcastIntervalMs`
  - Endpoints: `GET /api/health`, `GET /api/snapshot`, hub `/hubs/timing` (method `snapshot`)
- `src/web`: React 19 + Vite + TypeScript. `src/types.ts` mirrors the C# DTOs and must be kept in sync
  by hand. `useTiming.ts` handles the SignalR connection.
  - `src/tracks/<CODE>.json`: generated track files (don't hand-edit; rerun TrackBuilder). `tracks/index.ts` lazy-loads them by Natsoft track code.
  - `src/map/`: `trackModel.ts` (geometry, sim-time ↔ distance), `carPosition.ts` (where a car is between timing points),
    `useSessionClock.ts` (smooth session time between server updates).
  - `src/components/TrackMap.tsx`: the SVG map. Wrapped in an `ErrorBoundary` so a map bug can't take down the tower.
- `tools/NatsoftRecorder`: console recorder and inspector. References the Natsoft library.
- `tools/TrackBuilder`: builds track files from an OSM circuit relation + a recording (see its README).
- `tests/SupercarsTiming.Natsoft.Tests`: xUnit.
- `docs/PROTOCOL.md`: the protocol reference. **Update it whenever you learn something new about a field.**
- `data/recordings/*.jsonl`: real captures, git-ignored. Use them for development and debugging.

## Commands

```bash
dotnet build                      # whole solution (SupercarsTiming.slnx)
dotnet test
dotnet run --project src/SupercarsTiming.Server -- --Feed:Mode=Replay --Feed:ReplaySpeed=10
dotnet run --project src/SupercarsTiming.Server                          # live
dotnet run --project tools/NatsoftRecorder                               # record
dotnet run --project tools/NatsoftRecorder -- replay data/recordings/<file>.jsonl
dotnet run --project tools/TrackBuilder -- --code MOUN --relation 6942508 --name "Mount Panorama" --recording data/recordings/<file>.jsonl
cd src/web && npm run dev         # http://localhost:5173, proxies /api and /hubs to :5080
cd src/web && npm run build       # typecheck + build into the server's wwwroot
```

## Verifying changes

- Protocol or state changes: add or extend a test in `TimingStateTests` using trimmed real frames,
  then run `NatsoftRecorder replay` on a real recording and check the sheet looks sane.
- UI changes: run the server in replay mode plus `npm run dev`, and look at the page.
- `npm run build` must pass (TypeScript strict, no unused locals).

## Protocol essentials

Read `docs/PROTOCOL.md` before touching parsing. The traps:

- `<P C="...">` is Natsoft's **internal car ID** (`R ID` in the entry list), not the car number.
- Partial `L` updates only carry changed fields. Never reset a field because it's missing.
- `T` timestamps are track-local wall-clock time encoded as Unix seconds (AEDT = Unix + 39600).
- Each session starts with its own `<New>` snapshot, which must reset state. Support categories share the `V8SUPER` feed.
- `SP` (speed trap) is sent as `0` and then the real value. Ignore the zero.
- Use `GI`/`GNI` for gaps in every session type. `LGI`/`LGNI` update more often in races but are frequently out of
  order with Natsoft's positions (checked against the Bathurst SuperUte race), so they're kept in the model but not shown.
- Sector fields reset to 0 at the start of a lap. 0 means "no time yet" everywhere.

## Track map essentials

- Natsoft only gives the **last timing point** each car passed (`LP`) and when. Everything between points is estimated.
- `TimingState` records each car's latest time per segment (`CarState.SegmentSeconds`), skipping pit-lane and
  non-consecutive crossings. `TimingSnapshot` sends a per-car expected time per segment (own pace if it's within
  0.8–1.6× the field median, otherwise the field median) plus `SegmentReference`.
- The frontend moves a car the same fraction through the *simulated* segment time as it is through the expected
  real time, which makes cars slow for corners. Cars that are late hold at 99% of the segment, and dim once
  they're 2.5× overdue.
- Timing point positions per track are estimates from TrackBuilder's lap simulation. If they look wrong on a
  track, fix the inputs (OSM relation, control-line node, recording) and rebuild rather than hand-editing the JSON.
- `FeedStatus.ClockRate` (replay speed) drives the client-side clock, so replays at 10× animate correctly.

## UI essentials

- Tower columns are defined once in `TimingTower.tsx` (`COLUMNS`) and arranged per session kind and mode in `LAYOUTS`.
  Practice/qualifying ("timed") lead with Best then Gap; races lead with Gap then Int. `isRace()` decides.
- Viewer preferences (`settings.ts`: simple mode, broadcast delay, highlighted car numbers, tip dismissed) live in
  localStorage, wrapped in try/catch so the app still works where storage is blocked.
- Broadcast delay (`useDelayedUpdate.ts`) buffers updates client-side and shows the one from N seconds ago.
  The whole UI reads the delayed update; only the connection/feed indicator uses the live one.
- Highlights are keyed by car number (stable across sessions), hover by Natsoft car ID.
- On-track (Shootout) card (`ShootoutCard.tsx`): shown automatically when the session name/type matches
  `isShootout()` in `session.ts` (/shoot-out|top 10|top ten/), or forced On/Off from the controls bar. It focuses
  the car on its flying lap (`lapsSincePit === 1`), else the most recently active car on track, and compares its
  splits with provisional pole's best-lap splits at each timing point.
- Lap splits (`CarState.CurrentLapSplits/LastLapSplits/BestLapSplits`): seconds from the line at each timing point,
  "M" = lap time. Exact I1/I2 at the track's intermediate points (`<T PI1 PI2>`), Natsoft's lap time at the line,
  message time elsewhere. Snapshots send them as arrays `[TP1..TPn, lap]`; best splits fall back to F1/F2/FI.
  `LapsSincePit`: 0 out-lap, 1 first flying lap, resets on pit entry.
- Map view (`TrackMap.tsx`): everything is drawn in rotated screen coordinates (`makeView`) so text stays upright.
  Rotation is saved per track in settings; zoom/pan (wheel, pinch, drag, buttons) is per page view.
- Outside races, map pace is capped at ~1.12× the track file's typical segment time, so flying laps after slow
  out-laps animate smoothly.

## Rules

- **One connection to Natsoft.** Never add polling, parallel connections or tighter retry loops.
  Keep the 30 s retry while a meeting isn't live.
- **Never commit recordings or `.har` files.** They're git-ignored. Recordings are Natsoft's data, and
  HAR captures contain supercars.com login tokens.
- Keep the Natsoft library free of ASP.NET dependencies so tools and tests can use it.
- When you add a field to `CarRow` / `TimingSnapshot`, update `src/web/src/types.ts` too.
- Don't build features on the paid MySupercars+ (Firebase) data without discussing it first. It's behind a login and its terms are different.

## Roadmap / next steps

1. Track map polish: more circuits (Albert Park, Surfers Paradise, Sandown, Adelaide...), car trails, selecting
   a car to follow, gaps shown on the map, better pit lane handling. (Bathurst map done.)
2. Race-specific handling once a full Supercars race is captured: laps-down gaps, safety car, driver changes.
3. Lap time, position and gap charts from recorded history (needs per-lap history in `TimingState`).
4. Broadcast-delay slider and scrubbable replay.
5. Persist sessions (SQL) instead of only JSONL.
