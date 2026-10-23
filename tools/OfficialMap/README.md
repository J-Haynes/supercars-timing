# OfficialMap

Lines up an official Supercars track map (the PDF on each event's "getting around" page) with our track file and
writes what's race-relevant on it, the numbered corners and the pit lane, to `tools/TrackBuilder/official/<CODE>.json`.
TrackBuilder reads that with `--official`: the corners replace OSM's road-name labels and the pit lane replaces
OSM's (or fills in a missing one). Visitor things on the map (gates, toilets, bars, grandstands, screens) are left out.

```bash
pdftocairo -v                                   # needs poppler-utils
cd src/web && npx tsx ../../tools/OfficialMap/official-map.ts <map.pdf> SPSC          # lists the round markers
cd src/web && npx tsx ../../tools/OfficialMap/official-map.ts <map.pdf> SPSC ../../tools/TrackBuilder/official/SPSC.corners.json
dotnet run --project tools/TrackBuilder -- <the track's usual options> --official tools/TrackBuilder/official/SPSC.json
```

- The track file needs `origin` (TrackBuilder writes it since Oct 2026) to convert back to latitude/longitude.
- These maps draw the track and the pit lane as a dark stroke over a wider white one; the longest pair is the track,
  the next the pit lane. The track is fitted to ours (rotation, one scale, shift) and the script refuses a fit that's
  more than 15 m out on average: the maps say "not to scale".
- `<CODE>.corners.json` is written by hand: each corner's name as printed, and the centre of its round marker in PDF
  points (run once without it to list the markers and where they fall on our lap).
- Don't commit the PDFs (Supercars' material). The `source` URL is kept in the output.

| Track | Map | Fit (mean / max) | Lap (official / ours) |
|---|---|---|---|
| SPSC | SC26-GC-Track_Map-5 (Gold Coast 500, 2026) | 2.8 m / 8.4 m | 2,986 m / 2,985 m |
