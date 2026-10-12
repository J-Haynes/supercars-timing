#!/usr/bin/env python3
"""
Time lost per pit stop in a Supercars race, from Natsoft's "Sector and Lap Times" report.

Where the reports come from: Natsoft's public results site (http://racing.natsoft.com.au/results/) -> Circuit Racing
-> pick the track and year -> View the meeting -> "Times" next to the race. The report opens in a new window as plain
text; save the page text (select all, copy, paste into a file). It's Natsoft's data, so keep the files under
data/recordings/ (git-ignored), e.g. data/recordings/natsoft-results/gc2025_r28.txt. Load pages by hand: no scraping.

The report lists each car's laps three to a line: sector 1, 2, 3 and the lap time, with "p" on the in-lap ("pit
stop") and "*" on fastest times. In-laps have no lap time ("-:--.----p"), but their sectors are there, so the lap is
the sum of the sectors.

Time lost = in-lap + out-lap - 2 x the car's median lap. Only stops with racing-speed laps either side (within 3% of
the median) count as green-flag stops: stops under a safety car are much cheaper and are listed separately.

  python3 tools/PitLoss/natsoft_report.py data/recordings/natsoft-results/gc2025_r28.txt ...
"""
import re
import statistics as st
import sys

# A time like 0:20.6355; "-:--.----" is no time and "*:**.****" a time Natsoft hides. A trailing * or p is a flag.
TIME = re.compile(r'([-\d*]+:[-\d*]{2}\.[-\d*]{4})([*p]?)')
GREEN = 1.03  # laps either side of a stop must be within 3% of the car's median lap


def seconds(text):
    if '-' in text or '*' in text:
        return None
    minutes, secs = text.split(':')
    return int(minutes) * 60 + float(secs)


def read_report(path):
    """{car: [{'lap', 'time', 'pit'}]} from the report text."""
    cars, car = {}, None
    for line in open(path, encoding='utf-8'):
        header = re.match(r'^\s*(\d+) ([A-Za-z].*?)\s*$', line)  # "  1 William Brown"
        if header and not TIME.search(line):
            car = f'#{header.group(1)} {header.group(2)}'
            cars[car] = []
            continue
        first_lap = re.match(r'^\s*(\d+) ', line)
        times = TIME.findall(line)
        if car is None or not first_lap or not times:
            continue
        for k in range(0, len(times) - 3, 4):  # four times per lap
            sectors = [seconds(t) for t, _ in times[k:k + 3]]
            lap_time = seconds(times[k + 3][0])
            if lap_time is None and None not in sectors:
                lap_time = sum(sectors)  # in-laps: the lap time is blank, the sectors aren't
            pitted = any(flag == 'p' for _, flag in times[k:k + 4])
            cars[car].append({'lap': int(first_lap.group(1)) + k // 4, 'time': lap_time, 'pit': pitted})
    return cars


def stops(cars):
    """Every stop: (car, stop number, in-lap, time lost or None, green flag?)."""
    out = []
    for car, laps in cars.items():
        times = [l['time'] for l in laps if l['time']]
        if len(times) < 20:
            continue  # retired early: no reliable median
        median = st.median(times)
        by_lap = {l['lap']: l['time'] for l in laps}
        number = 0
        for l in laps:
            if not l['pit']:
                continue
            number += 1
            n = l['lap']
            before, inlap, outlap, after = (by_lap.get(x) for x in (n - 1, n, n + 1, n + 2))
            lost = round(inlap + outlap - 2 * median, 1) if inlap and outlap else None
            green = all((before, inlap, outlap, after)) and before < median * GREEN and after < median * GREEN
            out.append((car, number, n, lost, green))
    return out


def summary(values):
    if len(values) < 4:
        return f'n={len(values)} {values}'
    q1, median, q3 = st.quantiles(values, n=4)
    return f'n={len(values)} median {median:.1f}s, middle half {q1:.1f}-{q3:.1f}s, range {min(values):.1f}-{max(values):.1f}s'


def main(paths):
    for path in paths:
        all_stops = stops(read_report(path))
        # A car that sat in the pits (repairs) isn't a pit stop worth learning from: cap at 3 minutes.
        green = [s for s in all_stops if s[4] and s[3] is not None and 0 < s[3] < 180]
        print(path)
        print(f'  green-flag stops: {summary([s[3] for s in green])}')
        for number in (1, 2, 3):
            values = [s[3] for s in green if s[1] == number]
            if values:
                print(f'    stop {number}: {summary(values)}')
        print(f'  other stops (caution, unclear): {len(all_stops) - len(green)}')


if __name__ == '__main__':
    main(sys.argv[1:])
