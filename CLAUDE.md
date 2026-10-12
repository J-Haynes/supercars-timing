# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repo.

> **Keep this file current.** It's the first thing the next agent reads, often in a fresh session with none of the
> history. When you add a feature, learn something about the feed, change a workflow or make a decision with the
> owner, update the relevant section here in the same commit, and delete anything that's no longer true. Protocol
> findings go in `docs/PROTOCOL.md`; longer-term plans and research in `docs/PLANNING.md`.

## Project

Unofficial live timing dashboard for the Repco Supercars Championship (F1-dashboard style), for personal use.
Data comes from Natsoft's public live timing WebSocket, the same feed behind supercars.com's free "classic" live
timing. Since 11 Oct 2026 there's also a separate **F1 app** at `/f1` (see "F1" below) on F1's public live timing,
served by the same server and frontend build. The owner runs it as a systemd service on their laptop and views it on their tailnet (see `deploy/`).

Owner: a junior developer working in React, .NET/C# and SQL. Prefer clear, idiomatic code over clever code, and
explain non-obvious decisions in comments and commit messages.

**Status (11 Oct 2026):** the Bathurst 1000 (Race 30) was followed live end to end and is fully recorded,
including a safety car and two penalties. The F1 app was built the same evening for the Singapore GP and tested
on the replayed (wet, safety car) Sprint. Next round: Boost Mobile Gold Coast 500, 23-25 Oct (Finals round 1):
see "Next round" below.

## How we work

- **Branches:** work on a feature/fix branch, never straight on `main`. One commit per feature or fix, with a message
  that says what changed, why, and how it was checked. Merge to `main` (fast-forward) and push only when the owner says.
- **Commit trailer** (from the session's attribution settings): `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Frontend-only changes don't need a server restart:** `cd src/web && npm run build` writes into the server's
  `wwwroot`, which the running service serves; viewers refresh. **Server (C#) changes need a restart**: ask the owner
  first, especially during a session. A restart takes ~5 s and loses nothing (warm start, below).
- **Measure before fixing.** Many fixes this season started with a wrong guess. Reproduce with real data first
  (recordings, the live API, or the app's own code run in a script), then fix, then measure again.
- **Look at the page** for UI changes (headless browser, see "Verifying changes"), and check phone width (390 px).
- **Never fabricate facts about the sport:** standings, points scales, rules and schedules come from sources (cite
  them in code comments). If a source can't be found, say so and leave it configurable.

## Layout

- `src/SupercarsTiming.Natsoft` (no ASP.NET dependency; protocol and domain logic):
  - `NatsoftDecoder`: XOR-chain frame decoding. `NatsoftClient`: the WebSocket client (reconnects: 30 s while not
    live, 10 s after errors, immediately on `<Redirect/>`).
  - `Recording` (`RecordingWriter`, `RecordingReader`): JSON Lines recordings.
  - `SessionIndex`: finds sessions in recordings (split at `<New>`/`<NotFound>`, merged across restarts), `Replay()`
    (final `TimingState`), `Results()`, `IsSupercarsChampionship()`.
  - `SessionReplay`: plays a recorded session to any time t (forward incrementally, backward by rebuilding).
  - `TimingState`: applies XML messages to the model (`Entries`, `Cars`, flag, clock, race control, flag history,
    lap record). A `<New>` of the *same* session (reconnect, restart) keeps each car's history
    (`CarState.CarryHistoryFrom`); live snapshots don't list the cars (they follow in `<L Y="f">`), so old states wait
    in `_carryFrom` until each car reappears. A different session starts from scratch.
  - `TimingSnapshot`: the serialisable view sent to the UI (`CarRow`, `SessionInfo`, race control, flag history).
    `LapHistory` (per-car `LapEntry` list) is separate because it's large.
- `src/SupercarsTiming.Server` (ASP.NET Core minimal API + SignalR):
  - `Feed/TimingFeedService`: live (records to `Feed:RecordDirectory` = `data/recordings`) or replay mode. On start-up
    in live mode it first replays a session recorded in the last 15 min (`WarmStart`), so a restart mid-race keeps
    driver laps, the pit log, race control and history.
  - `Feed/TimingStore`: lock-protected `TimingState`; snapshots rebuilt only when dirty. `Feed/SnapshotBroadcaster`
    pushes to `/hubs/timing` at most every 250 ms.
  - `Sessions/SessionCatalog`: recorded sessions and their results + lap history (one cached replay per session).
    `Sessions/ReplayService`: one `SessionReplay` cursor per viewer and session (idle 10 min, max 16).
- `src/web` (React 19 + Vite + TypeScript, strict). `src/types.ts` mirrors the C# DTOs **by hand**: update it when
  `CarRow`/`TimingSnapshot`/`SessionInfo` change. Key modules:
  - Data/logic: `useTiming.ts` (SignalR), `useDelayedUpdate.ts` (broadcast delay), `liveGaps.ts` (live gaps, road
    order, `raceOrder`), `insights.ts`, `penalties.ts`, `championship.ts` + `finals.ts` (points data, cited),
    `startingGrid.ts`, `raceSummary.ts`, `chartData.ts`, `driverStats.ts` (stints, recent pace), `session.ts` (`isRace`, `flagKind`, `raceLaps`,
    `minDriverLaps`, `cautionPeriods`), `calendar.ts` (upcoming events and session times), `towerLayout.ts`.
  - Map: `map/trackModel.ts`, `map/carPosition.ts` (placement, out-lap and caution pacing), `map/smoothing.ts`,
    `map/sessionClock.ts` + `useSessionClock.ts`, `map/calibrate.ts`, `map/usePositionSync.ts`.
    `map/useCarPlacement.ts` places every car each frame (clock, calibration, crossing log, pacing, smoothing) for
    both maps: `MapView.tsx` shows the 2D `TrackMap` or the 3D `TrackMap3D` (lazy-loaded, three.js in
    `map/scene3d.ts`; the default view; Orbit and Follow cameras, heights ×2, cars are dots like the 2D map that
    grow with distance so they show in the overview).
  - Track files `src/tracks/<CODE>.json` are generated by TrackBuilder (never hand-edit); `tracks/index.ts` loads by
    Natsoft track code with name fallback (`tracks/manifest.json`). `MOUN` is real; `SURF` (Gold Coast), `SAND` (Sandown)
    and `ADEL` (Adelaide) are provisional (codes guessed, found by name). TrackBuilder README has how each was built.
    Track files may carry `elevation` (smoothed SRTM heights; `MOUN` only, see TrackBuilder README "Elevation"),
    drawn by `ElevationStrip.tsx` under the map with the cars the map placed that frame.
    `tracks/scenery/<CODE>.json` (TrackBuilder `--scenery`; `SURF` only): OSM buildings, water, beach, parks and the
    sea for the 3D map, loaded lazily by `useScenery`.
- `src/SupercarsTiming.Server/F1` (F1 lives in the server project): `F1Client` (SignalR to
  livetiming.formula1.com), `F1Message` + `F1Recording` (our JSONL recordings and F1's archive folders), `F1State`
  (merges F1's patches, works out mini-sector crossings, laps, pit stops, flags; builds the same `TimingSnapshot`),
  `F1FeedService` (+ `F1Store`, `F1Hub`, `F1Options`: live/replay, recording, warm start, broadcasting).
- `src/web/src/series.ts`: which app the page is (`/f1` = F1, else Supercars), its API base and hub, team colours.
- `deploy/`: the systemd user service and its README (install, logs, Tailscale serve).
- `tools/NatsoftRecorder` (console recorder/inspector), `tools/TrackBuilder` (track files from OSM + a recording;
  README has the Gold Coast checklist), `tools/OfficialMap` (corners and pit lane from Supercars' official track map
  PDFs, lined up with our track), `tools/F1TrackBuilder/build_track.py` (F1 track files from an archived
  session's car positions; see its docstring), `tools/F1MapEval/evalmap.py` (scores map placement against real positions).
- `tests/SupercarsTiming.Natsoft.Tests`: xUnit, including `RecordingRegressionTests` on real recordings.
- `docs/PROTOCOL.md` (the feed, field by field: **update it whenever you learn something**), `docs/PROTOCOL-F1.md`
  (the F1 feed), `docs/PLANNING.md`
  (data-use considerations, deployment, ideas).
- `data/recordings/f1/F1_*.jsonl`: F1 recordings (`{utc, topic, snapshot, data}` per line), a new file per start.
- `data/recordings/*.jsonl`: real captures, git-ignored, **only on this machine (no backup yet)**. Bathurst weekend:
  Practice 5, Practice 6 (red flag), Top Ten Shootout, Warm Up (last minutes only), Race 30 (complete), plus support races.

## Endpoints

`GET /api/health` · `GET /api/snapshot` (`TimingUpdate`) · `GET /api/laps` (live lap history) · hub `/hubs/timing`
(method `snapshot`) · `GET /api/sessions` (Supercars only; `?all=true` for support categories) ·
`GET /api/sessions/{id}/results` · `GET /api/sessions/{id}/laps` · `GET /api/sessions/{id}/replay/info` ·
`GET /api/sessions/{id}/replay?t=<natsoft time>&viewer=<id>`.
F1: `GET /api/f1/health` · `GET /api/f1/snapshot` · `GET /api/f1/laps` · hub `/hubs/f1` (same `snapshot` method).

## Commands

```bash
dotnet build && dotnet test                               # solution: SupercarsTiming.slnx
systemctl --user status|restart supercars-timing          # the live service (Release build, :5080); logs: journalctl --user -u supercars-timing -f
dotnet build src/SupercarsTiming.Server -c Release        # pre-build before a restart, so it's quick
cd src/web && npm run build                               # typecheck + build into wwwroot (live site updates, no restart)
cd src/web && npm run dev                                 # :5173, proxies /api and /hubs to :5080 (TIMING_SERVER overrides)
# A test server that never contacts Natsoft (replay mode; also serves results/replay from data/recordings):
dotnet run --project src/SupercarsTiming.Server --no-launch-profile -- --urls http://localhost:5081 \
  --Feed:Mode=Replay --Feed:ReplaySpeed=10 --Feed:RecordDirectory= --Feed:ReplayFile=<recording.jsonl>
TIMING_SERVER=http://localhost:5081 npx vite --port 5174   # preview the frontend against it
# F1 replay from an archive folder (download <Topic>.jsonStream files from livetiming.formula1.com/static/...):
#   add --F1:Mode=Replay --F1:ReplayArchive=<folder> --F1:ReplaySpeed=2 --F1:ReplaySkipMinutes=79, open /f1
python3 tools/F1TrackBuilder/build_track.py <qualifying archive folder>   # writes src/web/src/tracks/F1-<key>.json
dotnet run --project tools/TrackBuilder -- --code MOUN --relation 6942508 --name "Mount Panorama" --match "MOUNT PANORAMA" --recording data/recordings/<file>.jsonl
```

Only one process may hold port 5080 and only one connection to Natsoft may exist: stop the service before running
the server in live mode by hand.

## Verifying changes

- **Protocol/state:** unit test in `tests/` with trimmed real frames. When a live bug is fixed, add a
  `RecordingRegressionTests` case (they replay the real Bathurst race/Practice 6 and skip when recordings are absent).
  Check a test bites by temporarily undoing the fix.
- **UI:** run the test server (above) or point Vite at the live server, and look. Headless checks used this season:
  Firefox + `geckodriver` (both installed) driven over WebDriver HTTP from a small Python script: load the page,
  run JS to read the DOM, take screenshots, crop with PIL. Useful for timing-sensitive behaviour (sample positions
  every 50 ms) and phone width (`--width=390 --height=844`).
- **Map/clock behaviour:** import the app's own TS modules (`carPosition`, `smoothing`, `sessionClock`) into a script
  with `npx tsx` and run them on polled live snapshots or captured snapshot files. That's how stops/teleports and
  safety car pacing were measured and tuned.
- `npm run build` must pass (strict TS, no unused locals). `dotnet test` must pass.

## Protocol essentials (details in docs/PROTOCOL.md)

- `<P C>` is Natsoft's **internal car ID** (`R ID`), not the car number. Driver `ID="1"` is the primary (full-time)
  driver, `2` the co-driver.
- Partial `L` updates carry only changed fields. Never reset a field because it's missing. 0 = "no time yet".
- `T` timestamps are track-local wall-clock time encoded as Unix seconds (format as UTC to show track time).
- Each session starts with its own `<New>`, which resets state. Support categories share the `V8SUPER` feed.
- Positions: `<P L>` (official) only changes at the control line; `<P LP>` is Natsoft's road position at every timing
  point. `<D LP>` is the last timing point passed. `LGI`/`LGNI` follow `LP`, not `L`.
- `LCD` = laps by the current driver, cumulative per driver (in snapshots too). `PI`/`PT`/`PF` = pit in/time/flag.
- `<E L>` = scheduled laps (161 at Bathurst; 0 for timed races). In a lap race `<C Y="L" C E>` counts **laps**, not seconds.
- `<G R>` = race control text (incidents, penalties); free text in **varying formats** ("Penalty Car 19 - 5 seconds -
  …" and "Penalty Car 19  plp  pit stop infringement"). Nothing is sent when a penalty is served.
- Flags (`<S S>`): WaitStart, Green, **Yellow (= safety car / FCY, confirmed at the Bathurst 1000)**, Red, Checkered,
  Ended. `<S I>` is the change time for the first green only: after a safety car the green repeats the *first*
  green's I, so flag-change times use I only within 10 s of the message.
- After the chequered flag: lap counts stop at the distance, timing points keep coming from the cool-down lap, road
  positions of stopped cars stop updating, and cars entering the pit lane are not pit stops.
- The per-car `SC` attribute is not the safety car. `SP` (speed trap) is sent as 0, then the value.

## Live page essentials

- **Race order:** use `raceOrder(timing)` everywhere: road order while racing (Natsoft `LP` if unique, else our own:
  laps, furthest point, who got there first; pitting cars "park" at the line until their next point), Natsoft's
  official classification once the flag is chequered. **Gaps** in races are worked out per timing point
  (`liveGaps.ts`; matches `GI` exactly at the line; PIT/OUT while in/just out of the pits); practice/qualifying and
  finished races use Natsoft's official gaps.
- **Tower** columns: cells in `TimingTower.tsx` (`COLUMNS`), layouts in `towerLayout.ts`; detailed mode is
  configurable in ⚙ Settings (`SettingsPanel.tsx`, `settings.columns`). Rows slide and pulse on position changes
  (`useRowMoves.ts`, FLIP; tint on the row with a cleanup timer). Driver markers (hollow white = primary, green =
  co-driver), SWAP badge, PIT timer (smooth count from pit-in, then Natsoft's PT for 8 s), penalty badges (+5s, PLP;
  served ones leave the tower), fastest-lap stopwatch badge, positions gained (`startingGrid.ts`: hand-entered grid,
  stopgap until the server sends grid positions), driver laps vs the minimum (60 at the Bathurst 1000, 2026; from
  `LCD`), stint laps, mini-sectors.
- **Mini-sectors:** stretch times quicker than 0.8× the median of `RawSegmentSeconds` are rejected (pit-lane lines).
  Never base that median on accepted times (a slow out-lap once locked out every real time); out-laps don't count as
  pace; stretches starting at a snapshot `LP` or a pit crossing aren't timed.
- **Flags:** always via `flagKind()`. Caution/red: screen border, `SafetyCarBanner`, ticker items, "SC" tags on stops.
- **Focus / Compare** (`DriverDialog.tsx`): click a driver's name in the tower (live and replay). Focus: key numbers,
  sectors vs session best, lap times, stints (split at `pitted` laps; checked: stints ending in a stop = `pitStops`
  for all 26 cars in Race 30), pit stops, driver laps. Compare: gap at the line per lap with the trend since either
  car's last stop (`battlePoints`/`trendLaps`), side-by-side table, both cars' lap times. Measured data only, no
  estimates (no fuel or tyre guesses). In replay it only gets laps up to the replay time.
- **Penalties:** see "Decision" below. Race control panel shows "Penalty served" lines we work out ourselves.
- **Insights ticker** (`insights.ts` + `InsightsTicker.tsx`): battles, closing trends, pit-adjusted movers, minimum-lap
  risk, running long, fastest lap, lead changes, race control, caution events. News-ticker scrolling (items leave
  only when fully off screen, offset reduced in the same frame): never a CSS animation sized to the text (it jumped).
- **Championship ladder** (`Ladder.tsx`, data in `championship.ts`: standings after Round 10 + Enduro scale, cited)
  with the top 10 Finals cut in gold. **Finals ladder** (`FinalsLadder.tsx`, rules in `finals.ts`) for the Gold
  Coast: 3000 + 150/120/96/78 bonus, +25 cup winners, top 7 advance, bottom 3 eliminated.
- **Charts** (`RaceCharts.tsx`, `LineChart.tsx`, `ChartLab.tsx` large view; colours validated with the dataviz palette
  script against #12161b): gap, lap times, position, battle (trend only over laps since either car's last stop).
  Lap axis runs to the race distance.
- **Laps to go / race time** in the header (`raceLaps()`: `<E L>`, else `KNOWN_RACE_LAPS`: Bathurst 161, Gold Coast 85).
- **Layout:** wide screens: the left column (insights, tower, tips) sticks at the bottom of the screen while the
  right column scrolls (`useStickToBottom.ts`; don't make the right column sticky). Phones (< 760 px): `MobileTabs`
  (Leaderboard | Map | Race | Charts), sticky driver column, trimmed header.
- **Map with a broadcast delay** (both apps): the live feed is ahead of what's shown, so `map/crossingLog.ts` logs
  every crossing from the live update and the map places each car between the crossings either side of the time
  shown (`knownPosition`); it only estimates when the next crossing isn't in yet, and then from the newest crossing
  the log has (the delayed snapshot can be older). Live Singapore GP, 5 s delay: next crossing known 91 % of the time.
  The session clock slows down (never backwards) when it's > 2.5 s ahead of the data, until within 0.3 s: before
  that it stayed ~5 s ahead of the delayed data after a page load with a delay set.
- **Map:** cars are placed by fraction of the *simulated* stretch time vs expected real time (`carPosition.ts`). Visual
  only (never changes timing data): 4% slack on expected times, the step at each crossing fades out (0.3 s green,
  0.8 s caution, `smoothing.ts`), the clock blends server corrections over 0.5 s. Out-laps use the car's previous
  stretch pace. Under a caution, `cautionPace()` uses what cars took through the same stretch under this caution,
  scaled per car, only for stretches started after the caution (settings in `CAUTION_TUNING`, tuned on the replayed
  safety car). "Syncing car positions" greys the map after a page load. Outside races pace is capped at ~1.12×.
- **Map views:** one switch, 2D | 3D | Orbit | Follow | Free (Free: click the map, WASD/arrows move, Q/E down/up,
  Shift faster, +/- zoom; keys only while the canvas has focus) (`MapView.tsx`; `settings.mapView`, `camera3d`, `followCar`).
  "3D" (a still 3D view you can drag) is the default. Settings were renamed (`mapMode` -> `mapView`, `mapCamera` ->
  `camera3d`) each time the default changed, because settings are saved whole and old values would win. Tracks with
  scenery have a Buildings toggle (`flatBuildings`: footprints only). Event pages use it too.
- **Ended sessions:** `useCarPlacement` puts no cars on track once the flag is Ended (F1's hub sends the last
  session's state on connecting; it looked like the field racing for ~10 s). The chequered flag still shows cars. Never place cars in the
  3D code: it draws `useCarPlacement`'s placements, so 2D, 3D and the elevation strip always agree. Follow locks
  the camera to the car and eases only its heading (an eased position trailed by hundreds of metres at 10× replay).
- Live view hides support categories (`isSupercarsSession()`); they're still recorded.

## Results, replay and event pages

- **Results** (`ResultsView.tsx`, from the menu): Classification (positions gained, laps down, badges, driver laps),
  Summary (`raceSummary.ts`: winner and race time, laps led, lead changes, safety cars, movers, fastest stop,
  penalties, cars well down), Charts, Pit stops, Race control, Championship. Data: `/api/sessions/{id}/results` + `/laps`.
- **Replay** (`ReplayView.tsx`, "▶ Replay" on a results page): tower + map + banner + race control at any time, play/
  pause, 1-60×, scrubber with lap ticks and safety car bands; starts 20 s before the first green. The page moves the
  time and polls `/replay?t=` every 250 ms; the server keeps a cursor per viewer.
- **Upcoming events** (`EventPreview.tsx`, from the menu): session timetable from `calendar.ts` (local track time,
  provisional, source linked), "About the event" (`UpcomingEvent.info`: round, stakes, facts, last year, official
  map; every value from a listed source) and the track map with a work-in-progress note for provisional tracks.
  Session times show in the viewer's zone or track time (`timeZone.ts`: one site-wide choice in its own storage key,
  not per-series settings; default "your time" from the browser).
  Race distances for the header are in `KNOWN_RACE_LAPS` (`session.ts`; per race where they differ, as at Adelaide).

## F1

- **Two apps, one project:** Supercars at `/`, F1 at `/f1`; the header's switch (the two logos, `src/web/src/assets`,
  sources in `SessionHeader.tsx`) is a link (full page load) and `/` remembers the last choice. Keep the header
  identical in both apps (it always has three title lines; `scrollbar-gutter: stable`) so nothing moves on switching. Everything branches on `isF1` from `series.ts`; settings are stored
  per series. The F1 menu has Live and Upcoming (`F1_UPCOMING` in `calendar.ts`, from the Jolpica API, cited;
  `SERIES_UPCOMING` picks the series) but no Results yet (those come from Natsoft recordings). The F1 app hides
  the ladders and the manufacturer key; it adds team colours (`teamStyle`), a tyre column and grid positions (from `CarRow`'s
  optional F1 fields `Tyre`, `TyreLaps`, `TeamColour`, `GridPosition`, `Retired`; defaults keep Natsoft unchanged).
- **Server:** the F1 feed runs alongside Natsoft (config section `F1`, `F1:Enabled=false` turns it off). One
  connection to F1's hub, 10 s / 30 s reconnects. Recording, warm start (all F1 files from the last 3 h) and
  replay work like the Natsoft ones but in their own files.
- **Mini-sectors as timing points:** F1 sends 8 mini-sectors per sector; the end of each is a timing point
  `1.1`...`3.7` and the last one is the line (`M`), so `carPosition.ts` works unchanged. Only a segment further
  round the lap is a crossing (F1 re-sends earlier colours); stretches under 0.5 s are ignored (bursts on the grid
  and in the pit lane); the first lap count seen isn't a crossing. Tests: `F1StateTests`.
- **Gaps:** F1's `GapToLeader`/`IntervalToPositionAhead` are already live, so the tower uses them as sent.
  Flags: TrackStatus 4 = "Safety Car", 6/7 = "VSC" (both cautions in `flagKind`), 2 is a local yellow (green).
- **Maps:** `F1-<circuit key>.json`, built by `build_track.py` from archived qualifying positions: Marina Bay (61)
  from 2026; Austin (9), Mexico City (65), Interlagos (14), Las Vegas (152), Lusail (150), Yas Marina (70) from 2025.
  Mini-sectors per sector differ by circuit (read from the data). Like every track file, they need the control line as timing point `M` at distance 0 (without it cars zipped a whole lap at the line). The pit lane is traced from cars' positions while
  `InPit` (Interlagos has a stray branch into the infield). Cars in the pits are drawn along it. Rebuild a circuit
  from its Practice 1 archive if the 2026 mini-sectors differ from 2025's (tower ids won't match the map's).
- **Map pacing** (`F1_PACING` in `carPosition.ts`; Supercars keeps `SUPERCARS_PACING`): no slack, a car 30 % late
  is assumed past a skipped mini-sector (F1 skips ~4 % of crossings; they froze dots), late cars ease in under green
  too. Tuned with `tools/F1MapEval/evalmap.py`, which replays archived races (they include real positions) and scores
  placements against them: measure any map change there first. Findings: the car's own last time through a
  stretch beat smarter pace guesses; knowing the next crossing beats any guess (below).
- **Car positions (Position.z) need an F1 TV login:** not used; see `docs/PLANNING.md` before building on it.

## Next round: Gold Coast 500 (23-25 Oct 2026)

- Sessions and sources are in `calendar.ts` (Supercars schedule "correct as of 16 Sep"). Races 31 and 32, 85 laps.
- **Before the weekend:** set `FINALS_ROUNDS[0].cupWinners.enduro` in `finals.ts` (Enduro Cup winner, +25) and check the
  Bathurst result our Finals seeding uses against the official one (post-race penalties aren't in the feed). Add a
  `startingGrid.ts` entry for each race once the grid is known (or send grid positions from the server).
- **After Practice 1:** rebuild the `SURF` map from the recording (keep `--elevation none --scenery 900 --official ...`;
  command in the TrackBuilder README) (checklist in `tools/TrackBuilder/README.md`;
  Natsoft's track code there is still a guess). Check that the Gold Coast feed behaves like Bathurst (flags, `<E L>`).
- `championship.ts` only knows the Bathurst 1000; the Finals ladder takes over at Finals rounds.

## Decision: when a penalty counts as served

Decided with the owner during the Bathurst 1000. Natsoft only sends the penalty (`<G>`), never that it was served,
and pit-lane time can't show it (Payne's serving stop was a normal 66.1 s, yet the broadcast showed him held). So
`penalties.ts` follows the sporting rule:

- **Rule:** Supercars Operations Manual **B7.7.1.7** (Bathurst 2024 wording): "Unless otherwise directed by the
  Stewards, a Time Penalty imposed during a Race must be served at the Car's next Pit Stop." It "may not be served
  while the SC, FCY boards or Red Flag are displayed or while the Race is suspended" and "must be served after the
  completion of all work". Sources: https://www.supercars.com/news/bathurst-supercars-penalty-loophole-closed-with-regulations-tweak ,
  https://speedcafe.com/supercars-news-penalty-rule-loophole-bathurst-1000/ ,
  https://speedcafe.com/new-penalty-for-supercars-false-starts/ (unserved: carried over or added to race time).
- **Code:** served at the first completed pit stop that started after the penalty, skipping stops with a caution/red
  flag at any point (from `TimingSnapshot.FlagHistory`). Unserved time penalties are added to the ladder's projection.
- **PLP** (pit lane penalty = drive-through): served by the next trip through the pit lane (Payne's: 32.6 s);
  unserved counts as 25 s, the stewards' 2018 "drive-through equivalent"
  (https://www.supercars.com/news/championship/van-gisbergen-loses-win-with-pitstop-penalty/). Applying the no-SC
  rule to drive-throughs is an assumption.
- **Limits:** stewards' directions can't be seen in the data; the 2026 wording wasn't found. Re-check each season.

## Rules

- **One connection to Natsoft.** Never add polling, parallel connections or tighter retry loops; keep the 30 s
  retry while a meeting isn't live. Our server fans out to our own browsers. See `docs/PLANNING.md` on data use.
- **Never commit recordings or `.har` files** (git-ignored; recordings are Natsoft's data, HAR files contain login tokens).
- **Personal use only:** don't make the app public (no Tailscale Funnel, no public deploy) without the owner deciding,
  and permission for the data. The tailnet is fine.
- Keep the Natsoft library free of ASP.NET dependencies.
- When you add a field to `CarRow` / `TimingSnapshot` / `SessionInfo`, update `src/web/src/types.ts` too.
- Don't build on the paid MySupercars+ (Firebase) data, or F1 TV, without discussing it first.

## Roadmap

1. Gold Coast weekend (above), then Sandown and Adelaide entries in `finals.ts`. Their track maps exist (provisional):
   when Supercars publishes their event maps, run `tools/OfficialMap` for official corners and pit lanes.
2. Back up `data/recordings` (off the laptop; TrueNAS on the tailnet when it's online, or an external drive).
3. Grid positions from the server (replacing hand-entered `startingGrid.ts`); championship standings after each round.
4. Ideas not built yet: pit windows / stops remaining, follow-a-driver card with notifications, co-driver planner,
   pit stop leaderboard.
5. **Decided, next to plan:** connect to Natsoft only around scheduled sessions, with session times fetched
   automatically from the series' websites (`docs/PLANNING.md`, "Using Natsoft's data responsibly").
6. Persist sessions (SQL or static per-session archives) only if cross-season queries or deployment need it.
