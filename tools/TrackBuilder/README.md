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

```bash
dotnet run --project tools/TrackBuilder -- \
  --code MOUN --relation 6942508 --name "Mount Panorama" \
  --recording data/recordings/V8SUPER_20261010_100653.jsonl
```

| Option | |
|---|---|
| `--code` | Natsoft track code (from the `<T C="...">` element, e.g. `MOUN`) |
| `--relation` | OSM relation ID of `type=circuit` |
| `--recording` | A recording with at least one session at this track |
| `--name` | Display name (default: the OSM relation name) |
| `--sessions` | Only learn pace from sessions whose name contains this (default `Supercars`) |
| `--control-node` | OSM node ID for the control line if there's no `Finish Line`/`Start Line` node |
| `--osm` | OSM cache file (default `tools/TrackBuilder/osm/<CODE>.osm.json`; downloaded if missing) |
| `--out` | Output file (default `src/web/src/tracks/<CODE>.json`) |

## Adding a circuit

1. Find the circuit relation on openstreetmap.org (search the circuit name, look for a relation of type
   `circuit`). Check it has `circuit` members forming a closed loop in race direction.
2. Record a session there with `tools/NatsoftRecorder`.
3. Run TrackBuilder, check the console output looks sensible, and look at the map in replay mode.

Track geometry © OpenStreetMap contributors, available under the ODbL.

| Code | Circuit | OSM relation |
|---|---|---|
| `MOUN` | Mount Panorama, Bathurst | 6942508 |
