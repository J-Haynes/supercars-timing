# TrackBuilder

Builds a track file for the web map (`src/web/src/tracks/<CODE>.json`) from:

1. **An OpenStreetMap circuit relation**: the centreline (members with role `circuit`), the pit lane
   (`pit_lane`), corner names, and the `Finish Line` node used as the timing control line.
2. **A timing recording**: how long cars take between Natsoft timing points.

Natsoft doesn't publish where its timing points are, so TrackBuilder works it out:

- It runs a simple lap simulation on the OSM centreline (corner speed limited by grip, plus
  acceleration and braking limits), tuning grip until the simulated lap matches the real one.
- Each timing point is placed where the simulated car is at the measured time into the lap.
- The simulated time profile is written into the track file, so the map can slow cars for corners
  when it animates them between points.

The results are estimates. Sanity-check the console output: at Bathurst the speed-trap point (`Pos4`)
lands mid-Conrod Straight at ~295 km/h simulated, which matches the real speed trap (~285 km/h).

## Usage

Gold Coast (no recording yet, so provisional):

```bash
dotnet run --project tools/TrackBuilder -- \
  --code SURF --relation 9325885 --name "Surfers Paradise" --match SURFERS \
  --control-way "Gold Coast Highway" --lap-time 71
```

Bathurst (from a recording):

```bash
dotnet run --project tools/TrackBuilder -- \
  --code MOUN --relation 6942508 --name "Mount Panorama" \
  --recording data/recordings/V8SUPER_20261010_100653.jsonl
```

| Option | |
|---|---|
| `--code` | Natsoft track code (from the `<T C="...">` element, e.g. `MOUN`) |
| `--relation` | OSM relation ID of `type=circuit` |
| `--recording` | A recording with at least one session at this track (omit for a provisional track) |
| `--name` | Display name (default: the OSM relation name) |
| `--match` | Natsoft track-name fragment for name-based lookup (e.g. `SURFERS`) |
| `--control-way` | Road name; control line placed mid-way along it (when there's no Finish Line node) |
| `--lap-time` | Provisional tracks: typical lap time to fit the speed profile to |
| `--sessions` | Only learn pace from sessions whose name contains this (default `Supercars`) |
| `--control-node` | OSM node ID for the control line if there's no `Finish Line`/`Start Line` node |
| `--osm` | OSM cache file (default `tools/TrackBuilder/osm/<CODE>.osm.json`; downloaded if missing) |
| `--out` | Output file (default `src/web/src/tracks/<CODE>.json`) |

## Street circuits and provisional tracks

Some circuits are mapped in OSM as a `type=route` relation of public roads rather than a `type=circuit`
relation. TrackBuilder handles both: road members keep their `forward`/`backward` direction, they're joined in
whatever order they're listed, and small gaps are bridged with a warning. OSM maps the roads, not the
temporary chicanes, so the speed profile is rougher on street circuits.

Without `--recording`, TrackBuilder writes a **provisional** track (`"provisional": true`, no timing points).
The web map then places the timing points itself from live pace, a lap or two into the first session, using
the same method. On Bathurst, live calibration from Practice 6 landed within 2 m of the recording-based
positions. After the event, rebuild with a recording to make it permanent.

If there's no `Finish Line`/`Start Line` node, use `--control-node <id>`, or `--control-way <road name>` to put
the control line in the middle of that road (marked `controlLineEstimated`). Calibration can't fix a wrong
control line, so check it once real timing is available.

Each run also updates `src/web/src/tracks/manifest.json` (track code → `--match` name fragments), which lets
the app find a track by Natsoft's track name when the code isn't known yet.

## Adding a circuit

1. Find the circuit relation on openstreetmap.org (search the circuit name, look for a relation of type
   `circuit`). Check it has `circuit` members forming a closed loop in race direction.
2. Record a session there with `tools/NatsoftRecorder`.
3. Run TrackBuilder, check the console output looks sensible, and look at the map in replay mode.

Track geometry © OpenStreetMap contributors, available under the ODbL.

| Code | Circuit | OSM relation |
|---|---|---|
| `MOUN` | Mount Panorama, Bathurst | 6942508 |
| `SURF` | Surfers Paradise (Gold Coast 500). Provisional; control line estimated mid Gold Coast Highway | 9325885 |

## Gold Coast weekend checklist (23-25 Oct 2026)

The Gold Coast track file (`SURF`) is provisional: no recording at Surfers Paradise exists yet, so the web map places
the timing points itself from live pace a lap or two into the first session (`map/calibrate.ts`).

**How good is that?** Checked at Bathurst on 11 Oct 2026: a provisional Mount Panorama built the same way (no
recording, `--lap-time 128`), calibrated from the race's live pace, put every timing point within 4 m of the
recording-based positions (0.1% of a lap). Both use the same lap simulation, so this shows live calibration matches
what a recording would give, not that the simulation is perfect.

**Risks at the Gold Coast:**
- Natsoft's track code is a guess (`SURF`). If the feed's `<T C="...">` differs, the map still matches on the track
  name (`SURFERS`), but rename the file and `--code` to the real code when rebuilding.
- The control line is estimated (middle of the Gold Coast Highway section, `controlLineEstimated`). If cars visibly
  cross the line in the wrong place, find the Finish Line node in OSM and pass `--control-node`.
- OSM has no pit lane for the circuit and doesn't map the temporary chicanes, so pit cars sit beside the track and the
  speed profile is rougher.

**After Practice 1 (Friday):**

```bash
# 1. Find the recording and the real track code
ls -t data/recordings | head -3
grep -o 'T C=\\u0022[A-Z]*' data/recordings/<P1 file>.jsonl | head -1   # recordings store quotes as \u0022

# 2. Rebuild from the recording (replace SURF with the real code if it differs)
dotnet run --project tools/TrackBuilder -- \
  --code SURF --relation 9325885 --name "Surfers Paradise" --match SURFERS \
  --control-way "Gold Coast Highway" --recording data/recordings/<P1 file>.jsonl

# 3. Build the site (the server serves it; no restart needed) and check the map during the next session
cd src/web && npm run build
```

Sanity-check the console output (lap time, where each timing point lands) and watch the map in the next session:
cars should cross timing points as the tower updates, and not bunch up or wait at points.
