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
  - `SessionIndex`: finds sessions in recordings (split at `<New>`/`<NotFound>`, merged across restarts), computes
    results, and `IsSupercarsChampionship()` (support categories share the feed; the app only shows Supercars)
  - `TimingState`: applies XML messages to an in-memory model (`Entries`, `Cars`, flag, clock). A `<New>` snapshot of
    the *same* session (reconnect, restart) keeps each car's history (`CarState.CarryHistoryFrom`): laps per driver,
    pit log, mini-sector bests. Live snapshots don't list the cars (they follow in an `<L Y="f">`), so each car's old
    state waits in `_carryFrom` until the car reappears. A different session starts from scratch.
  - `TimingSnapshot`: flat, serialisable view of `TimingState` sent to the UI
- `src/SupercarsTiming.Server`: ASP.NET Core minimal API + SignalR.
  - `Feed/TimingFeedService`: background service, live or replay → `TimingStore`. Live mode records to
    `Feed:RecordDirectory` (`data/recordings` by default) and, on start-up, replays a session recorded in the last
    15 minutes first (`WarmStart`), so restarting mid-race keeps driver laps and the pit log.
  - `Feed/TimingStore`: lock-protected `TimingState`, rebuilds snapshots only when dirty
  - `Feed/SnapshotBroadcaster`: pushes `TimingUpdate` to `/hubs/timing` at most every `BroadcastIntervalMs`
  - Endpoints: `GET /api/health`, `GET /api/snapshot`, `GET /api/sessions`, hub `/hubs/timing` (method `snapshot`)
  - `Sessions/SessionCatalog`: recorded sessions in data/recordings (via `SessionIndex` in the Natsoft library) and
    their results (final `TimingSnapshot`, cached). `GET /api/sessions` lists Supercars Championship sessions only
    (`?all=true` for support categories too); `GET /api/sessions/{id}/results` returns the classification.
- `src/web`: React 19 + Vite + TypeScript. `src/types.ts` mirrors the C# DTOs and must be kept in sync
  by hand. `useTiming.ts` handles the SignalR connection.
  - `src/tracks/<CODE>.json`: generated track files (don't hand-edit; rerun TrackBuilder). `tracks/index.ts` lazy-loads them
    by Natsoft track code, falling back to name fragments in `tracks/manifest.json` (also written by TrackBuilder).
    Provisional tracks (no recording yet, e.g. `SURF` for the Gold Coast) are calibrated in the browser from live pace
    (`map/calibrate.ts`). Track codes other than `MOUN` are guesses until we see them in the feed.
  - `src/map/`: `trackModel.ts` (geometry, sim-time ↔ distance), `carPosition.ts` (where a car is between timing points),
    `useSessionClock.ts` (smooth session time between server updates).
  - `src/components/TrackMap.tsx`: the SVG map. Wrapped in an `ErrorBoundary` so a map bug can't take down the tower.
- `deploy/`: systemd user service for the live server and its README (install, logs, Tailscale).
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
dotnet run --project src/SupercarsTiming.Server                          # live (stop the service first)
systemctl --user restart supercars-timing                                 # the live service (see deploy/README.md)
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
- Gaps: practice/qualifying show `GI`/`GNI` (gap to the fastest lap). `GI` only changes at the control line, so in
  races the frontend works out live gaps at every timing point (`liveGaps.ts`): each car's crossing time is
  `lapStartAt` + its split (this lap or last lap), compared with the leader's / car ahead's crossing of the same
  point on the same lap. Matches `GI` exactly at the line; falls back to `GI` for lapped cars or after a pit stop.
  `LGI`/`LGNI` also update per timing point but are often out of order with the positions (2.2 vs 0.2 inversions per
  check, Bathurst 1000 2026), so they're kept in the model but not shown.
- Sector fields reset to 0 at the start of a lap. 0 means "no time yet" everywhere.

## Track map essentials

- Natsoft only gives the **last timing point** each car passed (`LP`) and when. Everything between points is estimated.
- `TimingState` records each car's latest time per segment (`CarState.SegmentSeconds`), skipping pit-lane and
  non-consecutive crossings, out-laps, and stretches that start at a snapshot `LP` (`CarState.SegmentStartAt` = 0).
  `TimingSnapshot` sends a per-car expected time per segment (own pace if it's within 0.8–1.6× the field median,
  otherwise the field median) plus `SegmentReference`.
- The frontend moves a car the same fraction through the *simulated* segment time as it is through the expected
  real time, which makes cars slow for corners. Cars that are late hold at 99% of the segment, and dim once
  they're 2.5× overdue. On out-laps the expected time is the track's typical time × the car's pace through its
  previous stretch (1.3× before it has one), so cars in the pit-exit queue keep moving.
- Timing point positions per track are estimates from TrackBuilder's lap simulation. If they look wrong on a
  track, fix the inputs (OSM relation, control-line node, recording) and rebuild rather than hand-editing the JSON.
- `FeedStatus.ClockRate` (replay speed) drives the client-side clock, so replays at 10× animate correctly.

## UI essentials

- Tower column cells are defined once in `TimingTower.tsx` (`COLUMNS`). Which show and in what order lives in
  `towerLayout.ts`: `DEFAULT_LAYOUTS` per session kind and mode (practice/qualifying lead with Best then Gap; races
  with Gap then Int; `isRace()` decides), `COLUMN_LABELS` (add new columns here too). Detailed mode is configurable
  in the Settings drawer (`SettingsPanel.tsx`, ⚙ in the controls bar): order and hidden columns per session kind,
  saved in `settings.columns`. `columnPrefs()` merges saved prefs with columns added later. Simple mode is fixed.
- Viewer preferences (`settings.ts`: simple mode, broadcast delay, highlighted car numbers, tip dismissed) live in
  localStorage, wrapped in try/catch so the app still works where storage is blocked.
- Broadcast delay (`useDelayedUpdate.ts`) buffers updates client-side and shows the one from N seconds ago.
  The whole UI reads the delayed update; only the connection/feed indicator uses the live one.
- Highlights are keyed by car number (stable across sessions), hover by Natsoft car ID.
- Co-driver events: `CarRow.Drivers` lists every driver; `Driver`/`DriverIndex` is who's in the car (Natsoft `<P D>`).
  `DriverChangedAt` marks a swap; the tower shows the other driver(s) in detailed mode and a SWAP badge for 3 minutes.
  Natsoft driver `1` is the primary (full-time) driver in every entry. As on the broadcast, the tower marks who's in
  the car, left of the name: hollow white circle = primary, green dot = co-driver (`DriverMarker`).
- Race order: Natsoft only re-orders `Position` at the control line, so the race tower uses `roadOrder()`
  (`liveGaps.ts`). It uses Natsoft's own road position (`CarRow.RoadPosition`, `<P LP>`) when every car has a unique
  one; otherwise it works it out: laps, then furthest timing point, then who reached it first (exact times at the
  line and I1/I2).
  Pit stops: a car that crossed the line in the pit lane is "parked" there (`parkedAtLine`) until its next timing
  point, so it drops as each car passes (Natsoft holds it until they complete another lap, ~2 min later). At the line
  it agrees with Natsoft except next to a pit stop (444/468, all 24 misses pit-related). Pos and +/− show road rank.
- Position changes animate (`useRowMoves.ts`, FLIP): the whole row slides to its new place and pulses green (gained)
  or red (lost). Reduced-motion users get the pulse only. The tint is on the row (not its cells) and a timer clears
  the class and inline styles afterwards; otherwise rows could stay tinted until hovered (stale repaint).
- Positions gained/lost (`posChange`, races): from `startingGrid.ts`, a hand-made grid per session taken from our
  recording (Natsoft's order before the green). Stopgap: the server should send each car's grid position instead.
- Manufacturer colours (CSS vars): Ford blue, Chevrolet orange, Toyota red; `ManufacturerKey` in the controls bar.
- Menu (`Menu.tsx`, ☰ in the header): live, results of previous Supercars sessions (`ResultsView.tsx`), upcoming
  events from `calendar.ts` with countdowns and map status from `tracks/manifest.json`. Update `calendar.ts` when
  Supercars publishes changes. There's no replay: previous sessions show results only (owner's call).
- Live view hides support-category sessions (`isSupercarsSession()` in `session.ts`): the header shows "Waiting for
  the next Supercars session". They're still recorded.
- Mini-sectors (`MiniSectors.tsx`, the tower's last column): one block per stretch between timing points, from
  `CarRow.CurrentSegments`/`LastLapSegments`/`BestSegments` and `TimingSnapshot.SegmentBest`. Purple = session
  best, green = personal best, yellow = slower; faded = previous lap; outlined = stretch the car is in. Stretch
  times quicker than 0.8× the field median are rejected (`IsPlausibleSegment`): pit-lane timing lines produce them.
  The median comes from `RawSegmentSeconds` (timed laps, before the check). Never base it on accepted times: the
  slow first out-lap at Bathurst once pushed it so high that every real time was rejected and blocks stayed empty.
- Flags: a red or yellow session flag frames the whole screen (`.flag-frame` on `.app`). The session flag is the only
  safety-car signal; the per-car `SC` attribute is something else (see PROTOCOL.md).
- Laps to go (header, next to the live indicator): `raceLaps()` in `session.ts` uses Natsoft's `<E L>` when it's set,
  else `KNOWN_RACE_LAPS` (Bathurst 1000 = 161). Hidden when unknown (timed races).
- Endurance races: Driver laps column (`DriverLaps` in `TimingTower.tsx`) from `CarRow.DriverLaps`, which comes from
  Natsoft's `LCD` (current driver's laps, cumulative per driver) with our own count as the fallback.
  `minDriverLaps()` = 60 at the Bathurst 1000 (2026) (check the regulations each year); red when a driver can't reach it.
  `UnattributedLaps` = laps before we connected that no one has claimed yet. Stint column = laps since the pit exit.
- Pit stop log (`PitLog.tsx`, under the map in races): from `CarRow.PitLog` (`PI` in, `PT` = pit-lane seconds out,
  driver swap attached to the stop if it arrives up to 120 s after the exit).
- Race control (`RaceControl.tsx`, under the map): `TimingSnapshot.RaceControl` from `<G R>` (newest first, last 50),
  with the lap record (`SessionInfo.LapRecord`, from `<E RI RC RV>`) on top, purple if beaten. Penalties are parsed
  from the text (`TimingSnapshot.Penalty()`, best effort) into `CarRow.Penalties` and badged in the tower ("+5s").
  Race time in the header = now − `SessionInfo.GreenAt` (first green flag).
- Tips live in `tips.ts` (one string each) and render in `TipsPanel` at the bottom of the page; closing is remembered.
- Shootout: the map shows cars on out-lap, flying lap and in-lap, and hides them once they're in the pits. Natsoft
  doesn't flag that pit entry: an in-lap car past the last timing point and overdue at the line is treated as in
  the pit lane. The card's mini-sector bars are purple (fastest of anyone through that stretch), green (faster
  than the named reference driver) or yellow (slower).
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
2. Race-specific handling once a full Supercars race is captured: check `<E L>` and the flag values in a real
   Supercars race (Bathurst 1000 recording, 11 Oct 2026), laps-down gaps.
3. Lap time, position and gap charts from recorded history (needs per-lap history in `TimingState`).
4. Broadcast-delay slider and scrubbable replay.
5. Persist sessions (SQL) instead of only JSONL.
