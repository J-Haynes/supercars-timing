# F1 live timing feed

What we know about F1's live timing, the feed behind the official app (and FastF1/OpenF1). Checked on 11 Oct 2026
against the Singapore GP weekend. Update this whenever you learn something (the Natsoft feed is in `PROTOCOL.md`).

## Endpoints

- **Live hub:** `https://livetiming.formula1.com/signalrcore`: ASP.NET Core SignalR, JSON protocol.
  1. `POST /signalrcore/negotiate?negotiateVersion=1` gives a `connectionToken`, **and an `AWSALB` cookie**. Send
     the cookie with the WebSocket, or the connection may reach another server and get a 404.
  2. `wss://livetiming.formula1.com/signalrcore?id=<token>`, send `{"protocol":"json","version":1}\x1e`.
  3. Invoke `Subscribe` with a list of topics. The result (`type: 3`) is the **full current state** of every topic
     (even between sessions: the last session's). Then `type: 1` messages with `target: "feed"`,
     `arguments: [topic, patch, utcTimestamp]`.
  4. Send a ping (`{"type":6}`) every 15 s.
- The old `/signalr` (classic SignalR) endpoint now returns **401**.
- **Anonymous access** returns: Heartbeat, SessionInfo, SessionData, SessionStatus, TrackStatus,
  ExtrapolatedClock, LapCount, DriverList, TimingData, TimingDataF1, TimingAppData, TimingStats,
  RaceControlMessages, TyreStintSeries, CurrentTyres, DriverTracker, WeatherData.
  **Not** `Position.z` (car x/y/z) or `CarData.z` (telemetry): those need an F1 TV subscription token (the cheaper
  "Access" tier is said to include live timing; price in Australia not confirmed, see `PLANNING.md`).
- **Archive:** `https://livetiming.formula1.com/static/<year>/Index.json` lists meetings and sessions;
  `static/<session path>/Index.json` lists topics, each as `<Topic>.json` (final state) and `<Topic>.jsonStream`
  (lines `HH:MM:SS.fff{json}`: time since the stream started, then the patch). The archive **does** include
  `Position.z`. UTF-8 BOM at the start of files. `Heartbeat` carries UTC, which gives the stream's start time.

## Message format

- Patches carry only changed fields; merge them deeply. Lists are patched as objects keyed by index
  (`"Sectors": {"1": {...}}`), and an index one past the end appends (race control messages). Ignore `_deleted`.
- `.z` topics are base64 of raw deflate (`zlib.decompress(data, -15)`).
- `Position.z`: `{"Position":[{"Timestamp","Entries":{"<car>":{"Status":"OnTrack","X","Y","Z"}}}]}`, X/Y in
  1/10 m, about 4 samples a second. Timestamps are ~2.6 s ahead of when the matching timing messages arrive.

## Topics we use

- **SessionInfo:** `Meeting.Name`, `Meeting.Location`, `Meeting.Circuit.Key` (our track code is `F1-<key>`,
  Singapore = 61), `Key` (session id; a new key = a new session), `Type` (`Race` for races **and sprints**,
  `Qualifying`, `Practice`), `Name` ("Sprint", "Race", ...), `GmtOffset` ("08:00:00").
- **SessionStatus:** `Inactive` → `Started` → `Finished` (chequered) → `Finalised` → `Ends`. Also `Aborted`.
- **TrackStatus:** `1` AllClear, `2` Yellow (a **local** yellow, not a caution), `4` SCDeployed, `5` Red,
  `6` VSCDeployed, `7` VSCEnding.
- **ExtrapolatedClock:** `Remaining` ("01:00:00") at `Utc`; while `Extrapolating` it counts down from then.
- **LapCount:** `CurrentLap`, `TotalLaps` (races).
- **DriverList** (keyed by car number): `FirstName`, `LastName` (upper case), `Tla`, `TeamName`, `TeamColour`.
- **TimingData** `Lines.<car>`: `Position` (live, changes through the lap), `GapToLeader` ("+1.234", "1L", leader
  "LAP 20"), `IntervalToPositionAhead.Value`, `NumberOfLaps`, `LastLapTime.Value`, `BestLapTime.{Value,Lap}`,
  `Sectors[0..2].Value`, `Speeds.ST`, `InPit`, `PitOut`, `NumberOfPitStops`, `Retired`, `Stopped`. In practice and
  qualifying the gaps are `TimeDiffToFastest` / `Stats[]`.
- **TimingData, qualifying** (top level, beside `Lines`): `SessionPart` (1-3, patched alone as each part starts) and
  `NoEntries`, the cars in each part (`[22,16,10]` in 2026, United States GP), so Q1 cuts at
  `NoEntries[1]`, Q2 at `NoEntries[2]`; also `CutOffTime` and `CutOffPercentage` (the 107 % time). The server sends
  the part and cut as `SessionInfo.QualifyingPart`/`QualifyingCut` for the tower's cut-off line.
- **Mini-sectors:** `Sectors[s].Segments[i].Status` (8 per sector at Singapore; Monaco 6/10/5). In archive files
  the full state's `Sectors` is an object keyed `"0"`, `"1"`, `"2"`, not an array (read both; until Oct 2026 the
  server only read arrays and labelled Monaco's mini-sectors 8/8/8). Non-zero = the car has finished
  that mini-sector (2048 yellow, 2049 green, 2051 purple, others for the pit lane). Statuses arrive in order as the
  car goes round. At the start of a lap one message sets sector 1 segment 1 and clears the rest. **Colours of
  earlier segments are re-sent later in the lap** (2051 → 2049), so only a segment *further round the lap* is a
  crossing. The last segment of sector 3 ends ~0.1 s before `NumberOfLaps` goes up (the line).
- **TimingAppData** `Lines.<car>`: `GridPos`, `Stints[]` (`Compound`, `New`, `TotalLaps`, `StartLaps`).
- **TimingStats** `Lines.<car>`: `BestSectors[]`, `BestSpeeds`, `PersonalBestLapTime`.
- **RaceControlMessages** `Messages[]`: `Utc` (UTC, no `Z`), `Lap`, `Category`, `Flag`, `Scope`, `Message`.
  Penalties look like "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 87 (BEA) - ...".

### Red flag and restart (2024 Monaco GP race archive, checked against its car positions)

- Red: TrackStatus `5` and SessionStatus `Aborted`; cars wait in the pit lane (`InPit`). Race control then sends
  "ORDER FOR RESTART: 16, 81, ...", "RACE WILL RESUME AT 15:44", "... - STANDING START PROCEDURE" (2024 São Paulo:
  "ROLLING START PROCEDURE"), and "STANDING START" when the cars leave.
- SessionStatus goes back to `Started` when the **pit exit opens** for the formation lap behind the safety car, not
  at the restart: our flag reads Green, then Safety Car (TrackStatus `4` two seconds later), then Green again when the
  safety car goes in, 74 s before the lights. **Nothing marks the lights going out** except LapCount `CurrentLap`
  going up (exactly then) and each car's line crossing (`NumberOfLaps` + 1) a moment later: the pole car 0.1-1 s
  after, P16 ~5 s after. The cars stop on the grid (16 m behind the line at Monaco) after the last mini-sector, for
  up to 64 s. The map uses that (`map/standingRestart.ts`).
- Segment reference times include the stop: the session's time for the last stretch of the lap was 2012 s just
  after the restart (the lap the red flag stopped).
- The archive's `Position.z` timestamps are 31 s off its timing messages (other archives: 0-6 s);
  `tools/F1TrackBuilder` now searches -40..+6 s.

## How the app uses it

`src/SupercarsTiming.Server/F1/F1State.cs` turns this into the same `TimingSnapshot` as Natsoft: mini-sectors
become timing points `1.1` ... `3.7` (the last one is the line, `M`), so the map places cars the same way.
F1's gaps are already live, so the F1 tower uses them as they are (not `liveGaps.ts`).
