#!/usr/bin/env python3
"""
Adds numbered corners (T1, T2, ...) to F1 track files (src/web/src/tracks/F1-<circuit key>.json), for the 2D and 3D maps.

Source: MultiViewer's circuit API (https://api.multiviewer.app/api/v1/circuits/<circuit key>/<year>), from the
community F1 live timing app. Its corner positions are in the same coordinates as F1's car positions (1/10 m), which
our track files come from (build_track.py), so they need no fitting: checked 12 Oct 2026, every corner of all seven
circuits is within 6 m of our centreline (mean 1-2 m), and the counts match the official turn numbers.

Run it after build_track.py (which writes the file without labels). Answers are cached in tools/F1TrackBuilder/corners/.

  python3 tools/F1TrackBuilder/corners.py 61:2026 9:2025 65:2025 14:2025 152:2025 150:2025 70:2025
"""
import json, math, os, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(os.path.dirname(__file__), 'corners')
MAX_OFF_TRACK = 20.0  # metres: further than this and the corner doesn't belong to this layout


def fetch(key, year):
    path = os.path.join(CACHE, f'{key}-{year}.json')
    if not os.path.exists(path):
        url = f'https://api.multiviewer.app/api/v1/circuits/{key}/{year}'
        req = urllib.request.Request(url, headers={'User-Agent': 'supercars-timing (personal hobby project)'})
        data = json.load(urllib.request.urlopen(req, timeout=30))
        os.makedirs(CACHE, exist_ok=True)
        with open(path, 'w') as f:
            json.dump({'source': url, 'corners': [{'number': c['number'], 'x': c['trackPosition']['x'], 'y': c['trackPosition']['y']}
                                                  for c in data['corners']]}, f, indent=1)
    with open(path) as f:
        return json.load(f)


def main(pairs):
    for pair in pairs:
        key, year = pair.split(':')
        track_file = os.path.join(ROOT, 'src', 'web', 'src', 'tracks', f'F1-{key}.json')
        with open(track_file) as f:
            track = json.load(f)
        path, step = track['path'], track['step']
        labels = []
        for c in fetch(key, year)['corners']:
            x, y = c['x'] / 10, c['y'] / 10  # F1 position units are 1/10 m, like build_track.py
            i = min(range(len(path)), key=lambda k: (path[k][0] - x) ** 2 + (path[k][1] - y) ** 2)
            off = math.hypot(path[i][0] - x, path[i][1] - y)
            if off > MAX_OFF_TRACK:
                sys.exit(f'F1-{key}: T{c["number"]} is {off:.0f} m off our track: wrong year or layout?')
            labels.append({'name': f'T{c["number"]}', 'distance': round(i * step, 1)})
        track['labels'] = sorted(labels, key=lambda l: l['distance'])
        track['source']['corners'] = f'Corner numbers from MultiViewer (api.multiviewer.app), {year}'
        credit = ' · corner numbers from MultiViewer'
        if credit not in track['source']['attribution']:
            track['source']['attribution'] += credit  # shown in the map caption
        with open(track_file, 'w') as f:
            json.dump(track, f, separators=(',', ':'), ensure_ascii=False)
            f.write('\n')
        print(f'F1-{key} {track["name"]}: {len(labels)} corners')


if __name__ == '__main__':
    main(sys.argv[1:])
