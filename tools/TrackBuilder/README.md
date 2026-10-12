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
  --control-way "Gold Coast Highway" --lap-time 71 --elevation none --scenery 900 \
  --official tools/TrackBuilder/official/SURF.json
```

Bathurst (from a recording):

```bash
dotnet run --project tools/TrackBuilder -- \
  --code MOUN --relation 6942508 --name "Mount Panorama" --match "MOUNT PANORAMA" \
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
| `--official` | Corners and pit lane from the official track map (`tools/TrackBuilder/official/<CODE>.json`, see `tools/OfficialMap`) |
| `--scenery` | Metres around the circuit to fetch scenery for the 3D map (e.g. `900`); see "Scenery" |
| `--elevation` | Height cache (default `tools/TrackBuilder/elevation/<CODE>.json`; looked up if missing), or `none` |
| `--out` | Output file (default `src/web/src/tracks/<CODE>.json`) |

Sandown and Adelaide (built 12 Oct 2026, no recordings, no official event maps yet):

```bash
dotnet run --project tools/TrackBuilder -- --code SAND --ways 25927060,770953497,770953498 \
  --pit-ways 25927062,770953500,770953499 --name "Sandown" --match SANDOWN --lap-time 67.2 \
  --control-node 6950626103 --turn-labels true --elevation none --scenery 900
dotnet run --project tools/TrackBuilder -- --code ADEL --relation 3121459 --name "Adelaide Parklands" --match ADELAIDE \
  --lap-time 78.7 --control-pit true --corners tools/TrackBuilder/corners/ADEL.json --elevation none --scenery 900
```

- `--lap-time` is each circuit's Supercars lap record (supercars.com event pages: 1:07.2078 and 1:18.6763); live
  calibration places the timing points from real pace anyway.
- Laps: Sandown 3,154 m (Wikipedia: 3.104 km), Adelaide 3,263 m (3.219 km): both ~1.5% long, where Bathurst and the
  Gold Coast were within 1%. Check the line and corner positions against the official map when it's published
  (`tools/OfficialMap`), and against the first session's pace.
- No elevation: SRTM gave 15-18 m of bumps at both (grandstands, park trees) with no published figure to check
  against. Wikipedia mentions Adelaide's Wakefield Road going uphill; add heights once there's a source to verify them.
- Natsoft track codes `SAND` and `ADEL` are guesses; the `--match` names find the files until the real codes are known.

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

## Elevation

Each track file gets `elevation`: the height at every sample in metres, relative to the lap's lowest point. The web
map draws it as a side view of the lap with the cars on it (`ElevationStrip.tsx`).

- Heights come from NASA's SRTM 30 m model through the public [OpenTopoData API](https://www.opentopodata.org/api/)
  (dataset `srtm30m`, at most 100 points a request and one request a second). One point every 20 m is looked up,
  then filled in between and smoothed (a 40 m moving average, twice), because single SRTM readings are off by a few
  metres. Answers are cached in `tools/TrackBuilder/elevation/<CODE>.json` (committed), so rebuilds don't ask again.
- **Check:** Mount Panorama comes out at 177 m from lowest (Murray's Corner) to highest (between Sulman Park and
  McPhillamy Park). Wikipedia gives a 174 m vertical difference between the highest and lowest points
  (https://en.wikipedia.org/wiki/Mount_Panorama_Circuit).
- **Street circuits:** SRTM measures the surface, rooftops and trees included. At Surfers Paradise it gave 0-23 m
  of bumps on a flat seaside course, so `SURF` is built with `--elevation none` and the map shows no strip there.
  Look at the raw cache before trusting heights on any circuit lined with buildings.
- F1 tracks have no heights yet: they aren't geolocated, so OpenTopoData can't be asked. F1's archived car
  positions may include a height (`Z`); `tools/F1TrackBuilder` could use that.

## Scenery (3D map)

With `--scenery <metres>`, TrackBuilder also writes `src/web/src/tracks/scenery/<CODE>.json`: buildings, water,
beaches and parks within that distance of the circuit, from OpenStreetMap through the Overpass API (with mirrors
if the main server is busy; the raw answer is cached in `tools/TrackBuilder/osm/<CODE>.scenery.osm.json`,
git-ignored, so delete it to fetch fresh data). The 3D map loads it only when it's showing that track.

- **Rings:** multipolygons (the Nerang River with the canal islands as holes) are joined from their member ways.
- **The sea:** OSM maps it only as a coastline line (land on the left, water on the right), so TrackBuilder closes
  the coastline round the box edge on its water side.
- **Heights:** OSM `height`, else `building:levels` × 3.2 m, else an assumed 2 storeys (`assumed: true`). At Surfers
  Paradise (Oct 2026): 2,052 buildings, 43 with a height, 1,069 with levels, 940 assumed (mostly canal-side houses).
  The council's open "building height" layer (data.gov.au) is a planning limit, not a measured height, so it isn't used.
- Scenery assumes a flat track (buildings stand at height 0). Add ground heights before using it with `elevation`.
- Checked against the circuit: our Surfers Paradise centreline is 2,985 m; snaplap gives "about 2.96 km"
  (https://www.snaplap.net/surfers-paradise-street-circuit/).

## F1 scenery (`--georef`)

F1 track files (from `tools/F1TrackBuilder`) are in F1's own x/y metres, not latitude/longitude. `--georef <CODE>
--relation <OSM circuit relation>` lines the track file up with the OSM circuit (rotation, scale, shift, possibly a
mirror; rotation sweep + iterative closest point against the relation's ways filled in every 5 m), refuses a fit worse
than 25 m on average, and writes `tracks/scenery/<CODE>.json` in the track file's coordinates, with OSM's "Turn N"
corners as `corners` (F1 track files have no labels). The track file itself isn't touched.

```bash
dotnet run --project tools/TrackBuilder -- --georef F1-61 --relation 421263 --scenery 800
```

| Track | OSM relation | Fit (mean / max) |
|---|---|---|
| F1-61 Marina Bay | 421263 | 3.8 m / 14.6 m (scale 0.999, rotated 0.4°: F1 x/y is north-up metres) |
| F1-9 Austin | 6537729 | 3.0 m / 9.5 m |
| F1-65 Mexico City | 16251935 (the Grand Prix relation, not the E-Prix one) | 3.0 m / 9.4 m |
| F1-14 Interlagos | 6781071 | 3.1 m / 10.2 m |
| F1-152 Las Vegas | 16696508 | 4.3 m / 14.8 m |
| F1-150 Lusail | 21297662 | 2.7 m / 9.1 m |
| F1-70 Yas Marina | 11378665 (20123689, "Grand Prix Corkscrew Circuit", is refused: 26 m out) | 3.3 m / 12.8 m |

```bash
for pair in F1-61:421263 F1-9:6537729 F1-65:16251935 F1-14:6781071 F1-152:16696508 F1-150:21297662 F1-70:11378665; do
  dotnet run --project tools/TrackBuilder -- --georef ${pair%%:*} --relation ${pair##*:} --scenery 800
done
# Las Vegas without landmark labels (the owner asked for none there):
dotnet run --project tools/TrackBuilder -- --georef F1-152 --relation 16696508 --scenery 800 --landmarks false
```

None of these relations has "Turn N" nodes, so F1 maps have no corner labels yet. Austin, Interlagos and Lusail have
no landmarks: nothing near them in OSM is linked to Wikipedia/Wikidata or tall enough. Overpass is often busy: the
mirrors are tried in turn, and a failed run can simply be repeated.

Scenery for every track also lists **landmarks**, drawn as ◆ labels in the 3D map (better ones win where labels
overlap). Candidates: attractions, museums, theme parks and stadiums with a Wikipedia/Wikidata link, named towers that
are observation towers, linked or 50 m+ (not lifeguard towers), and named buildings 60 m or taller. Up to 16 within
800 m of the track, scored by height, +300 for a linked attraction, +50 for a link (or 150 m+), -1 per 10 m from the
track, at least 200 m apart; "X Tower 2" counts as X; English names (`name:en`) where OSM has them. Tuned on Singapore
(bars and playgrounds, then no Marina Bay Sands), Austin (no observation tower) and the Gold Coast (lifeguard towers).
Spherical buildings (`shape=spherical*`: the Sphere in Las Vegas) are marked `shape: "sphere"` and drawn as spheres.
It's OSM's data: some tall buildings are named after a tenant ("Samsung", "HSBC" in Singapore).

## Adding a circuit

1. Find the circuit relation on openstreetmap.org (search the circuit name, look for a relation of type
   `circuit`). Check it has `circuit` members forming a closed loop in race direction.
2. Record a session there with `tools/NatsoftRecorder`.
3. Run TrackBuilder, check the console output looks sensible, and look at the map in replay mode.

Track geometry © OpenStreetMap contributors, available under the ODbL.

| Code | Circuit | OSM relation |
|---|---|---|
| `MOUN` | Mount Panorama, Bathurst | 6942508 |
| `SURF` | Surfers Paradise (Gold Coast 500). Provisional; control line estimated mid Gold Coast Highway; no elevation | 9325885 |
| `SAND` | Sandown (Sandown 500). Provisional. No circuit relation in OSM: built from ways (`--ways`); the line is OSM's "Supercars Start/Finish Line" node; corners T1-T13 from OSM's turn nodes | ways 25927060, 770953497, 770953498 |
| `ADEL` | Adelaide Parklands (Grand Final, 2026 layout). Provisional; line estimated level with the middle of the pit lane; corner names from Wikipedia, placed by hand (`corners/ADEL.json`) | 3121459 |

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
  --control-way "Gold Coast Highway" --elevation none --scenery 900 \
  --official tools/TrackBuilder/official/SURF.json --recording data/recordings/<P1 file>.jsonl

# 3. Build the site (the server serves it; no restart needed) and check the map during the next session
cd src/web && npm run build
```

Sanity-check the console output (lap time, where each timing point lands) and watch the map in the next session:
cars should cross timing points as the tower updates, and not bunch up or wait at points.
