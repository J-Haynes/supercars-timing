#!/usr/bin/env python3
"""
Builds an F1 track file for the map (src/web/src/tracks/F1-<circuit key>.json, same format as tools/TrackBuilder's)
from a session downloaded from F1's public archive (https://livetiming.formula1.com/static/<year>/...).

Unlike Supercars, F1's archive has every car's x/y position (Position.z, ~4 per second), so no OpenStreetMap is
needed:
  * the centreline and the speed profile (simTime) come from the fastest lap in the session;
  * the timing points are F1's mini-sectors (TimingData segments): each car's crossing time, looked up in its own
    positions and projected onto the centreline, median over every crossing in the session.

Timing messages reach the feed a little later than the moment the car crossed (positions carry their own
timestamps), so the script tries delays from -2 to +6 s and keeps the one where all cars' crossings of a point land
in the same place.

Usage (folder with Heartbeat, SessionInfo, DriverList, TimingData and Position.z .jsonStream/.json files):
  python3 tools/F1TrackBuilder/build_track.py <archive folder> [--out src/web/src/tracks]
"""
import argparse, base64, bisect, json, math, os, statistics, zlib
from datetime import datetime, timedelta, timezone

STEP = 5.0  # metres between path samples (same as TrackBuilder)


def offset(s):
    h, m, r = s.split(':')
    return int(h) * 3600 + int(m) * 60 + float(r)


def lines(path):
    with open(path, encoding='utf-8-sig') as f:
        for line in f:
            if len(line) > 12:
                yield offset(line[:12]), line[12:]


def utc(s):
    s = s.rstrip('Z')
    if '.' in s:
        head, frac = s.split('.')
        s = f'{head}.{frac[:6]}'
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def load(folder):
    hb_off, hb = next(lines(os.path.join(folder, 'Heartbeat.jsonStream')))
    start = utc(json.loads(hb)['Utc']) - timedelta(seconds=hb_off)

    # Positions per car: sorted (t, x, y) with t in seconds since the stream start, x/y in metres (F1 sends 1/10 m).
    pos = {}
    for _, raw in lines(os.path.join(folder, 'Position.z.jsonStream')):
        data = json.loads(zlib.decompress(base64.b64decode(json.loads(raw)), -15))
        for sample in data['Position']:
            t = (utc(sample['Timestamp']) - start).total_seconds()
            for car, e in sample['Entries'].items():
                if e.get('Status') == 'OnTrack':
                    pos.setdefault(car, []).append((t, e['X'] / 10, e['Y'] / 10))
    for p in pos.values():
        p.sort()

    # Crossings per car: (t, flat segment index) in order, forward moves only (colours are re-sent later in a lap),
    # and line crossings (lap count up).
    # Mini-sectors per sector differ by circuit (8/8/8 at Singapore): the highest segment index seen in each sector.
    highest = {}
    for _, raw in lines(os.path.join(folder, 'TimingData.jsonStream')):
        for line in json.loads(raw).get('Lines', {}).values():
            sectors = line.get('Sectors') if isinstance(line, dict) else None
            items = sectors.items() if isinstance(sectors, dict) else enumerate(sectors or [])
            for si, sec in items:
                segs = (sec or {}).get('Segments') if isinstance(sec, dict) else None
                keys = segs.keys() if isinstance(segs, dict) else range(len(segs or []))
                for k in keys:
                    highest[int(si)] = max(highest.get(int(si), 0), int(k))
    seg_counts = [highest[si] + 1 for si in sorted(highest)] or None
    seg_counts = seg_counts or [8, 8, 8]
    total = sum(seg_counts)
    crossings, laps, pit = {}, {}, {}
    last_flat = {}
    for t, raw in lines(os.path.join(folder, 'TimingData.jsonStream')):
        for car, line in json.loads(raw).get('Lines', {}).items():
            if not isinstance(line, dict):
                continue
            if 'NumberOfLaps' in line:
                laps.setdefault(car, []).append((t, line['NumberOfLaps']))
            if 'InPit' in line:
                pit.setdefault(car, []).append((t, bool(line['InPit'])))
            sectors = line.get('Sectors')
            if not sectors:
                continue
            items = sectors.items() if isinstance(sectors, dict) else enumerate(sectors)
            for s, sec in items:
                segs = (sec or {}).get('Segments')
                if not segs:
                    continue
                seg_items = segs.items() if isinstance(segs, dict) else enumerate(segs)
                for i, seg in seg_items:
                    if (seg or {}).get('Status', 0) > 0:
                        flat = sum(seg_counts[:int(s)]) + int(i)
                        prev = last_flat.get(car, -1)
                        fwd = (flat - prev) % total
                        if prev < 0 or 0 < fwd <= total // 2:
                            crossings.setdefault(car, []).append((t, flat))
                            last_flat[car] = flat
    return start, pos, crossings, laps, pit, seg_counts


def at(samples, t):
    """Interpolated (x, y) of a car at time t, or None outside its samples / across a gap."""
    i = bisect.bisect_left(samples, (t,))
    if i == 0 or i >= len(samples):
        return None
    (t0, x0, y0), (t1, x1, y1) = samples[i - 1], samples[i]
    if t1 - t0 > 2:
        return None
    f = (t - t0) / (t1 - t0)
    return x0 + f * (x1 - x0), y0 + f * (y1 - y0)


def best_lap(laps):
    """(car, start, end) of the quickest lap from lap-count changes (stream-clock times)."""
    best = None
    for car, changes in laps.items():
        for (t0, n0), (t1, n1) in zip(changes, changes[1:]):
            if n1 == n0 + 1 and 60 < t1 - t0 and (best is None or t1 - t0 < best[2] - best[1]):
                best = (car, t0, t1)
    return best


def build_pit_lane(pos, pit, delay, path, length):
    """
    The pit lane: every position sample taken while a car was in the pit lane (TimingData InPit, shifted by the
    timing delay) and away from the track, ordered by where it sits alongside the track (unwrapped around the
    line, since the lane crosses it), then the median position every 10 m. Garages and the odd stray sample
    average out; bins with few samples are dropped.
    """
    samples = []
    for car, changes in pit.items():
        if car not in pos:
            continue
        windows, start = [], None
        for t, inside in changes:
            if inside and start is None:
                start = t
            elif not inside and start is not None:
                windows.append((start - delay, t - delay))
                start = None
        for t0, t1 in windows:
            samples += [(x, y) for t, x, y in pos[car] if t0 <= t <= t1]
    bins = {}
    for x, y in samples:
        k = min(range(0, len(path), 2), key=lambda i: (path[i][0] - x) ** 2 + (path[i][1] - y) ** 2)
        off = math.hypot(path[k][0] - x, path[k][1] - y)
        if off < 6 or off > 200:
            continue  # on the track itself (entry/exit merges) or nowhere near it
        d = k * STEP
        if d > length / 2:
            d -= length  # the lane runs across the line: entry before it (negative), exit after it
        bins.setdefault(round(d / 10), []).append((x, y))
    if not bins:
        return []
    need = max(5, statistics.median(len(v) for v in bins.values()) * 0.2)
    lane = [[round(statistics.median(p[0] for p in v), 1), round(statistics.median(p[1] for p in v), 1)]
            for k, v in sorted(bins.items()) if len(v) >= need]
    # Light smoothing (garages pull the medians sideways a little).
    return [[round(sum(q[0] for q in lane[max(0, i - 2):i + 3]) / len(lane[max(0, i - 2):i + 3]), 1),
             round(sum(q[1] for q in lane[max(0, i - 2):i + 3]) / len(lane[max(0, i - 2):i + 3]), 1)] for i in range(len(lane))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--out', default='src/web/src/tracks')
    args = ap.parse_args()

    with open(os.path.join(args.folder, 'SessionInfo.json'), encoding='utf-8-sig') as f:
        info = json.load(f)
    circuit = info['Meeting']['Circuit']
    code = f"F1-{circuit['Key']}"
    name = info['Meeting'].get('Location') or circuit['ShortName']

    start, pos, crossings, laps, pit, seg_counts = load(args.folder)
    n_points = sum(seg_counts) - 1  # the last mini-sector ends at the line

    car, lap_start, lap_end = best_lap(laps)
    print(f'Fastest lap: car {car}, {lap_end - lap_start:.3f} s')

    # Delay of timing messages: the one that makes every car's crossing of each point land closest together.
    def spread(delay):
        total, n = 0.0, 0
        for flat in range(n_points):
            pts = [at(pos[c], t - delay) for c, cs in crossings.items() if c in pos for t, f in cs if f == flat]
            pts = [p for p in pts if p]
            if len(pts) < 10:
                continue
            mx, my = statistics.median(p[0] for p in pts), statistics.median(p[1] for p in pts)
            total += statistics.median(math.hypot(p[0] - mx, p[1] - my) for p in pts)
            n += 1
        return total / max(n, 1)

    delay = min((d / 10 for d in range(-20, 61, 2)), key=spread)
    print(f'Timing delay vs positions: {delay:.1f} s (median spread {spread(delay):.1f} m; at 0 s: {spread(0):.1f} m)')

    # Centreline and timeline of the fastest lap (lap start/end are timing messages, so shift them too).
    t0, t1 = lap_start - delay, lap_end - delay
    samples = [(t, x, y) for t, x, y in pos[car] if t0 - 1 <= t <= t1 + 1]
    lap = [(t0, *at(pos[car], t0))] + [s for s in samples if t0 < s[0] < t1] + [(t1, *at(pos[car], t1))]
    cum = [0.0]
    for a, b in zip(lap, lap[1:]):
        cum.append(cum[-1] + math.hypot(b[1] - a[1], b[2] - a[2]))
    length = cum[-1]
    print(f'Lap length {length:.0f} m ({len(lap)} samples)')

    def along(d):
        i = min(max(bisect.bisect_right(cum, d) - 1, 0), len(lap) - 2)
        f = (d - cum[i]) / ((cum[i + 1] - cum[i]) or 1)
        a, b = lap[i], lap[i + 1]
        return a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])

    count = int(length // STEP)
    path, sim = [], []
    for k in range(count):
        t, x, y = along(k * STEP)
        path.append([round(x, 1), round(y, 1)])
        sim.append(round(t - t0, 3))
    sim.append(round(t1 - t0, 3))

    def project(p):
        best = min(range(len(path)), key=lambda k: (path[k][0] - p[0]) ** 2 + (path[k][1] - p[1]) ** 2)
        return best * STEP

    points = []
    for flat in range(n_points):
        ds = []
        for c, cs in crossings.items():
            if c not in pos:
                continue
            for t, f in cs:
                if f == flat and (p := at(pos[c], t - delay)):
                    ds.append(project(p))
        s = next(i for i in range(len(seg_counts)) if flat < sum(seg_counts[:i + 1]))
        i = flat - sum(seg_counts[:s])
        points.append({'id': f'{s + 1}.{i + 1}', 'name': f'Sector {s + 1} · {i + 1}', 'distance': round(statistics.median(ds), 1)})
    points.sort(key=lambda p: p['distance'])

    def sim_at(d):
        k = min(int(d // STEP), len(sim) - 2)
        return sim[k] + (d / STEP - k) * (sim[k + 1] - sim[k])

    ids = ['M'] + [p['id'] for p in points]
    dists = [0.0] + [p['distance'] for p in points] + [length]
    segment_seconds = [{'from': ids[i], 'seconds': round(sim_at(min(dists[i + 1], length - 0.01)) - sim_at(dists[i]), 3)} for i in range(len(ids))]

    pit_lane = build_pit_lane(pos, pit, delay, path, length)
    print(f'Pit lane: {len(pit_lane)} points')

    track = {
        'code': code, 'name': name, 'match': [], 'provisional': False, 'controlLineEstimated': False,
        'source': {'attribution': 'Positions from F1 live timing (livetiming.formula1.com)', 'osmRelation': 0,
                   'recording': info.get('Path', ''), 'built': datetime.now().strftime('%Y-%m-%d')},
        'length': round(length, 1), 'step': STEP, 'path': path, 'simTime': sim,
        # The control line must be a timing point too: the map looks up where 'M' is to place a car on the last
        # stretch of the lap (without it, that stretch was taken as a whole lap and cars zipped round at the line).
        'timingPoints': [{'id': 'M', 'name': 'Control line', 'distance': 0}] + points, 'segmentSeconds': segment_seconds, 'labels': [], 'pitLane': pit_lane,
    }
    out = os.path.join(args.out, f'{code}.json')
    with open(out, 'w') as f:
        json.dump(track, f, separators=(',', ':'))
    manifest_path = os.path.join(args.out, 'manifest.json')
    with open(manifest_path) as f:
        manifest = json.load(f)
    manifest[code] = {'name': name, 'match': [], 'provisional': False}
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print(f'Wrote {out}: {len(points)} timing points')
    for p in points:
        print(f"  {p['id']:>5} {p['distance']:7.1f} m")


if __name__ == '__main__':
    main()
