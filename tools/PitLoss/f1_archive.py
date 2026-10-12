#!/usr/bin/env python3
"""
Time lost per pit stop at F1 circuits, from F1's public live timing archive (livetiming.formula1.com/static).

Each race's archive has a PitStopSeries topic: per stop, the time in the pit lane and the time stationary (both are
in the live feed too). Time lost = in-lap + out-lap - 2 x the car's median lap (from TimingData), counted only for
green-flag stops (laps either side within 4% of the median) with a normal stationary time (under 6 s).

Downloads the three topics it needs once per race into data/recordings/f1-archive/<circuit key>/ (git-ignored).

  python3 tools/PitLoss/f1_archive.py 2025     # every race we have a map for
"""
import json
import os
import statistics as st
import sys
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, 'data', 'recordings', 'f1-archive')
BASE = 'https://livetiming.formula1.com/static/'
CIRCUITS = {61: 'Singapore', 9: 'Austin', 65: 'Mexico City', 14: 'Interlagos', 152: 'Las Vegas', 150: 'Lusail', 70: 'Yas Marina'}
TOPICS = ('PitStopSeries', 'TimingData')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'supercars-timing (personal hobby project)'})
    return urllib.request.urlopen(req, timeout=60).read().decode('utf-8-sig')


def stream(path):
    """A .jsonStream file: one "HH:MM:SS.mmm{json}" message per line."""
    for line in open(path, encoding='utf-8-sig'):
        brace = line.find('{')
        if brace > 0:
            yield json.loads(line[brace:])


def seconds(text):
    parts = text.split(':')
    return float(parts[-1]) + (60 * int(parts[0]) if len(parts) == 2 else 0)


def race_folders(year):
    """{circuit key: archive path of its race}, for the circuits we have maps for."""
    index = json.loads(get(f'{BASE}{year}/Index.json'))
    return {m['Circuit']['Key']: s['Path'] for m in index['Meetings'] for s in m['Sessions']
            if s['Name'] == 'Race' and m['Circuit']['Key'] in CIRCUITS}


def download(key, path):
    folder = os.path.join(CACHE, f'{key}-{path.split("/")[0]}')
    os.makedirs(folder, exist_ok=True)
    for topic in TOPICS:
        file = os.path.join(folder, f'{topic}.jsonStream')
        if not os.path.exists(file):
            with open(file, 'w', encoding='utf-8') as f:
                f.write(get(BASE + urllib.parse.quote(path) + f'{topic}.jsonStream'))
    return folder


def measure(folder):
    laps, count = {}, {}  # laps[car][lap number] = seconds
    for msg in stream(os.path.join(folder, 'TimingData.jsonStream')):
        for car, line in msg.get('Lines', {}).items():
            if not isinstance(line, dict):
                continue
            if 'NumberOfLaps' in line:
                count[car] = line['NumberOfLaps']
            last = line.get('LastLapTime', {})
            if isinstance(last, dict) and last.get('Value'):
                laps.setdefault(car, {})[count.get(car, 0)] = seconds(last['Value'])
    lane, stationary, lost = [], [], []
    for msg in stream(os.path.join(folder, 'PitStopSeries.jsonStream')):
        for car, entries in msg.get('PitTimes', {}).items():
            for entry in (entries if isinstance(entries, list) else entries.values()):
                stop = entry['PitStop']
                lap, still, in_lane = int(stop['Lap']), float(stop['PitStopTime'] or 0), float(stop['PitLaneTime'] or 0)
                times = laps.get(car, {})
                normal = [t for t in times.values() if t > 0]
                if len(normal) < 10 or in_lane <= 0:
                    continue
                lane.append(in_lane)
                stationary.append(still)
                median = st.median(normal)
                before, inlap, outlap, after = (times.get(x, 0) for x in (lap - 1, lap, lap + 1, lap + 2))
                if all((before, inlap, outlap, after)) and before < median * 1.04 and after < median * 1.04 and still < 6:
                    lost.append(inlap + outlap - 2 * median)
    return lane, stationary, lost


def main(year):
    for key, path in race_folders(year).items():
        lane, stationary, lost = measure(download(key, path))
        print(f'{CIRCUITS[key]:12} pit lane {st.median(lane):5.1f}s  stationary {st.median(stationary):4.1f}s  '
              f'time lost (green flag, n={len(lost)}) median {st.median(lost):5.1f}s, middle half '
              f'{st.quantiles(lost, n=4)[0]:.1f}-{st.quantiles(lost, n=4)[2]:.1f}s, range {min(lost):.1f}-{max(lost):.1f}s')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '2025')
