#!/usr/bin/env python3
"""
A past race as a replayable recording, rebuilt from Natsoft's published "Sector and Lap Times" report.

The app's results, replay, charts and pit tools all read recordings (data/recordings/*.jsonl: Natsoft messages as the
live feed sent them). For races from before we recorded anything, this writes the messages the live feed would have
sent, from each car's sector and lap times, so the same pages work on them:

  python3 tools/HistoricalRace/report_to_recording.py tools/HistoricalRace/gc2025.json R28 R29

Writes data/recordings/V8SUPER_<UTC start>_hist-<race>.jsonl (git-ignored: built from Natsoft's data). The event file
says where each report is and adds what reports don't have (see gc2025.json): grid, the winner's time and lead-lap
gaps, vehicles, post-race penalties.

What's real and what's rebuilt (also sent as the session's first race control message, so the pages say so):
- Timing points are the report's sector lines: 1 = end of sector 1, 2 = end of sector 2, M = control line. Every
  crossing time is exact relative to the car's start of lap 2 (sums of Natsoft's sector times).
- Lap 1 has no sector 1 time (timing starts at the line). For cars on the lead lap at the finish it comes from the
  classification: total race time minus the car's other laps (post-race penalties removed: the report is on-road).
  Others (lapped, retired) get the median of those, nudged by grid slot. Checked: every derived sector 1 must be
  plausible for a standing start, else it's estimated too.
- Pit stops: the report marks the in-lap. Pit entry is put 8 s before that lap's line crossing and pit exit at
  55 % of the car's usual sector 1 before the end of the out-lap's sector 1, so pit-lane times are estimates.
- Safety cars aren't in the report: a caution is when at least half the cars on track are in a sector 30 % slower
  than their usual time, for a minute or more.
"""
import datetime as dt
import json
import os
import re
import statistics as st
import sys
from xml.sax.saxutils import quoteattr

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'tools', 'PitLoss'))
from natsoft_report import TIME, seconds  # noqa: E402  (same report format as the pit loss tool)

PIT_ENTRY_BEFORE_LINE = 8.0   # seconds from pit entry to the line crossing in the pit lane (estimate)
PIT_EXIT_SHARE_OF_S1 = 0.55   # pit exit to the end of sector 1, as a share of the car's usual sector 1 (estimate)
SLOW = 1.30                   # a sector this much slower than the car's median is "slow"
CAUTION_SHARE = 0.5           # share of cars on track in a slow sector for a caution
CAUTION_MIN_SECONDS = 60


def read_report(path):
    """{car number: {'name', 'laps': [[s1, s2, s3, lap_time, pit]]}}; missing times are None."""
    cars, car = {}, None
    for line in open(os.path.join(REPO, path), encoding='utf-8'):
        header = re.match(r'^\s*(\d+) ([A-Za-z].*?)\s*$', line)
        if header and not TIME.search(line):
            car = header.group(1)
            cars[car] = {'name': header.group(2), 'laps': []}
            continue
        times = TIME.findall(line)
        if car is None or not re.match(r'^\s*\d+ ', line) or not times:
            continue
        for k in range(0, len(times) - 3, 4):
            s1, s2, s3 = (seconds(t) for t, _ in times[k:k + 3])
            cars[car]['laps'].append([s1, s2, s3, seconds(times[k + 3][0]), times[k + 3][1] == 'p'])
    return cars


def race_seconds(text):
    """'1:53:27.795' -> seconds; '+7.609' -> 7.609; anything else (laps down, retired) -> None."""
    m = re.fullmatch(r'(\d+):(\d+):(\d+(?:\.\d+)?)', text.strip())
    if m:
        return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    m = re.fullmatch(r'\+(\d+(?:\.\d+)?)', text.strip())
    return float(m[1]) if m else None


def build(event, key):
    race = event['races'][key]
    # Cars without a lap (didn't start) aren't in the race.
    report = {no: car for no, car in read_report(race['report']).items() if car['laps']}
    entries = {r['number']: r for r in race['classification']}
    penalties = {p['number']: p['seconds'] for p in race['penalties']}
    start = dt.datetime.fromisoformat(race['start']).replace(tzinfo=dt.timezone.utc).timestamp()  # track time "as UTC"
    offset = event['utcOffsetHours'] * 3600
    notes = []

    # Sector times per car, with gaps filled from the lap time or the car's median.
    med = {}
    for no, car in report.items():
        laps = car['laps']
        # A lap with no sector 1 right after a pit lap started in the garage (see "Garage visits" below).
        car['garage'] = [i for i in range(1, len(laps)) if laps[i][0] is None and laps[i - 1][4]]
        med[no] = [st.median([l[i] for l in laps if l[i]] or [30.0]) for i in range(3)]
        for i, l in enumerate(laps):
            for s in range(3):
                if l[s] is None and not (i == 0 and s == 0):
                    known = [l[x] for x in range(3) if x != s and l[x]]
                    l[s] = l[3] - sum(known) if l[3] and len(known) == 2 else med[no][s]

    # Lap 1's sector 1 from the classification where it's exact (lead lap at the finish), else estimated.
    winner = race_seconds(race['classification'][0]['result'])
    exact = {}
    for no, car in report.items():
        e = entries.get(no)
        gap = race_seconds(e['result']) if e and e is not race['classification'][0] else 0.0
        if not e or e['laps'] != race['laps'] or gap is None or len(car['laps']) != race['laps']:
            continue
        total = winner + gap - penalties.get(no, 0)
        rest = sum(sum(l[:3]) for l in car['laps'][1:])
        s1 = total - rest - car['laps'][0][1] - car['laps'][0][2]
        if 10 < s1 < 60:
            exact[no] = s1
        else:
            notes.append(f'#{no}: lap 1 from the classification gives a {s1:.1f} s first sector; estimated instead')
    base = st.median(exact.values())
    grids = [entries[n]['grid'] for n in exact if entries[n].get('grid')]
    mid_grid = st.median(grids) if grids else 12
    for no, car in report.items():
        grid = (entries.get(no) or {}).get('grid') or mid_grid
        car['laps'][0][0] = exact.get(no, base + 0.15 * (grid - mid_grid))
        if no not in exact:
            notes.append(f'#{no}: lap 1 estimated (not on the lead lap at the finish)')

    # Garage visits: the report restarts the lap when a car comes back out of the garage, with no sector 1 time, so the
    # time in there is in no sector (2025 Gold Coast: Wood's lap 10 in Race 28 has 52.5 s of sectors 2 and 3 after an
    # in-lap, Percat's lap 34 in Race 29 the same). For a car still running at the finish (classified "+N laps") the
    # missing time is what puts its last crossing half a typical lap after the winner's; it goes into that lap's
    # sector 1 (a long pit stop).
    winner_end = start + winner
    for no, car in report.items():
        laps = car['laps']
        lap_med = st.median(sum(l[:3]) for l in laps[1:]) if len(laps) > 2 else 0
        short = car['garage']
        if not short:
            continue
        result = (entries.get(no) or {}).get('result', '')
        if re.fullmatch(r'\+\d+ laps?', result.strip()):
            missing = winner_end + 0.5 * lap_med - (start + sum(sum(l[:3]) for l in laps))
            if missing > 0:
                laps[short[0]][0] += missing
                notes.append(f'#{no}: {missing / 60:.1f} min in the garage added before lap {short[0] + 1} (estimated)')
        else:
            notes.append(f'#{no}: lap {short[0] + 1} looks like a return from the garage, but the car retired: garage time unknown, left out')

    # Every crossing: (time, car, point, lap) with point in '1', '2', 'M'.
    crossings, pits = [], []
    for no, car in report.items():
        t = start
        for n, (s1, s2, s3, _, pit) in enumerate(car['laps'], start=1):
            crossings += [(t + s1, no, '1', n, s1), (t + s1 + s2, no, '2', n, s2), (t + s1 + s2 + s3, no, 'M', n, s3)]
            line = t + s1 + s2 + s3
            if pit and n < len(car['laps']):
                out_s1_end = line + car['laps'][n][0]
                pit_in = max(line - PIT_ENTRY_BEFORE_LINE, t + s1 + s2 + 1)
                pit_out = max(out_s1_end - PIT_EXIT_SHARE_OF_S1 * med[no][0], line + 5)
                pits.append((pit_in, no, 'in', n))
                pits.append((pit_out, no, 'out', n))
            t = line

    cautions = find_cautions(report, start, med, pits)
    return report, entries, crossings, pits, cautions, start, offset, notes


def find_cautions(report, start, med, pits):
    """[(start, end)] when at least half the cars on track are in a slow sector (pit in/out laps left out)."""
    pit_laps = {(no, n) for _, no, kind, n in pits for n in ((n, n + 1) if kind == 'in' else ())}
    spans = []  # (from, to, slow) per car sector
    for no, car in report.items():
        t = start
        for n, lap in enumerate(car['laps'], start=1):
            for s in range(3):
                spans.append((t, t + lap[s], lap[s] > med[no][s] * SLOW and (no, n) not in pit_laps and n > 1))
                t += lap[s]
    end = max(b for _, b, _ in spans)
    out, open_at, t = [], None, start + 60
    while t < end:
        on = [slow for a, b, slow in spans if a <= t < b]
        caution = len(on) >= 5 and sum(on) / len(on) >= CAUTION_SHARE
        if caution and open_at is None:
            open_at = t
        elif not caution and open_at is not None:
            if t - open_at >= CAUTION_MIN_SECONDS:
                out.append((open_at, t))
            open_at = None
        t += 1
    return out


def messages(event, key, built):
    """The recording's messages, in time order: (track time, xml)."""
    race = event['races'][key]
    report, entries, crossings, pits, cautions, start, offset, notes = built
    ids = {no: str(i + 1) for i, no in enumerate(sorted(report, key=lambda n: int(n)))}
    out = []
    f = lambda x: f'{x:.4f}'  # noqa: E731

    def vehicle(no):
        car = (entries.get(no) or {}).get('car', '')
        return 'Ford Mustang GT' if 'Ford' in car else 'Chev Camaro ZL1' if 'Chev' in car else car

    def name(no):
        first, _, last = report[no]['name'].partition(' ')
        return f'{first} {last.replace(" ", "_")}'

    t0 = start - 600
    rl = ''.join(f'<R ID="{ids[no]}" CC="0" C="{no}" S="" N="{no}" V={quoteattr(vehicle(no))}><V ID="1" B="1" N={quoteattr(name(no))} /></R>'
                 for no in sorted(report, key=lambda n: int(n)))
    out.append((t0, f'<New T="{f(t0)}" Seq="1"><M D={quoteattr(event["meeting"])} Y="Cars" />'
                    f'<T C="{event["trackCode"]}" N={quoteattr(event["trackName"])} I="2" P="2" PI1="1" PI2="2"><TP ID="1" Y="Int1" /><TP ID="2" Y="Int2" /></T>'
                    f'<E C="{race["code"]}" D={quoteattr(race["session"])} Y="Race" MP="N" MPD="0" L="{race["laps"]}" TY="S" ST="0" RY="Race" />'
                    f'<RL>{rl}</RL></New>'))
    grid = sorted(report, key=lambda no: (entries.get(no) or {}).get('grid') or 99)
    full = ''.join(f'<P L="{i + 1}" LL="{i + 1}" P="{i + 1}" LP="{i + 1}" C="{ids[no]}" D="1"><D L="0" I="0.0000" T="0.0000" LL="M" LP="M" P="N" LCD="0" GL="0" GI="0.0000" GNL="0" GNI="0.0000" /></P>'
                   for i, no in enumerate(grid))
    out.append((t0, f'<L T="{f(t0)}" Y="f" L="{len(report)}">{full}</L>'))
    out.append((t0, f'<C T="{f(t0)}" Y="L" C="{race["laps"]}" E="0" />'))
    out.append((t0, f'<S T="{f(t0)}" S="WaitStart" I="0.0000" R="0" E="{race["code"]}" P="1" SN="0" />'))
    note = ('Race Control: Rebuilt from Natsoft\'s published sector and lap times (tools/HistoricalRace). Crossings at '
            'the sector lines are exact; lap 1 for cars off the lead lap, pit-lane times and safety car times are estimates.')
    out.append((t0 + 1, f'<G T="{f(t0 + 1)}" R={quoteattr(note)} C="" />'))
    out.append((start, f'<S T="{f(start)}" S="Green" I="{f(start)}" R="0" E="{race["code"]}" P="1" SN="0" />'))
    for a, b in cautions:
        out.append((a, f'<S T="{f(a)}" S="Yellow" I="0.0000" R="0" E="{race["code"]}" P="1" SN="0" />'))
        out.append((b, f'<S T="{f(b)}" S="Green" I="{f(start)}" R="0" E="{race["code"]}" P="1" SN="0" />'))

    # Walk the crossings in time order, keeping positions, gaps and bests as Natsoft would send them.
    events = sorted([(t, 'x', no, p, n, s) for t, no, p, n, s in crossings] + [(t, 'pit', no, kind, n, 0) for t, no, kind, n in pits])
    laps = {no: 0 for no in report}
    line_times = {no: {} for no in report}
    progress = {no: (0, 0.0) for no in report}  # (crossings made, time of the latest)
    best, best_car, finished, stops = {}, None, False, {no: 0 for no in report}
    lap_split = {no: [0.0, 0.0] for no in report}
    session_best = None
    sent_pos = {no: i + 1 for i, no in enumerate(grid)}
    for t, kind, no, point, n, sector in events:
        cid = ids[no]
        if kind == 'pit':
            if point == 'in':
                stops[no] += 1
                d = f'P="Y" PF="P" PI="{f(t)}" LLP="{n}" PS="{stops[no]}"'
            else:
                pit_in = max(p[0] for p in pits if p[1] == no and p[2] == 'in' and p[0] < t)
                d = f'P="N" PF="T" PI="0" PT="{f(t - pit_in)}"'
            out.append((t, f'<L T="{f(t)}" Y="p" L="{len(report)}"><P C="{cid}" D="1"><D {d} /></P></L>'))
            continue
        count = progress[no][0] + 1
        progress[no] = (count, t)
        road = 1 + sum(1 for o, (c, at) in progress.items() if o != no and (c > count or (c == count and at < t)))
        if point == '1':
            lap_split[no] = [sector, 0.0]
            d = f'I1="{f(sector)}" I2="0.0000" S1="{f(sector)}" S2="0.0000" S3="0.0000" LL="1" LP="1"'
        elif point == '2':
            lap_split[no][1] = sector
            d = f'I2="{f(lap_split[no][0] + sector)}" S2="{f(sector)}" LL="2" LP="2"'
        else:
            laps[no] = n
            line_times[no][n] = t
            lap_time = lap_split[no][0] + lap_split[no][1] + sector
            # Official order at the line: laps, then who crossed first.
            order = sorted(report, key=lambda o: (-laps[o], line_times[o].get(laps[o], 1e12)))
            pos = order.index(no) + 1
            leader = order[0]
            ahead = order[pos - 2] if pos > 1 else None
            def gap_to(other):
                if other is None:
                    return 0, 0.0
                if n in line_times[other]:
                    lapped = laps[other] - n
                    return (lapped, 0.0) if lapped > 0 and line_times[other].get(n + 1, 1e12) < t else (0, t - line_times[other][n])
                return 0, 0.0
            gl, gi = gap_to(leader)
            gnl, gni = gap_to(ahead)
            d = (f'L="{n}" I="{f(lap_time)}" T="{f(t)}" S3="{f(sector)}" LL="M" LP="M" LCD="{n}" '
                 f'GL="{gl}" GI="{f(gi)}" GNL="{gnl}" GNI="{f(gni)}"')
            if lap_time > 0 and n > 1 and (no not in best or lap_time < best[no][0]):
                best[no] = (lap_time, n)
                d += f' FI="{f(lap_time)}" FL="{n}" FT="{f(t)}"'
                if session_best is None or lap_time < session_best:
                    session_best, best_car = lap_time, no
                    out.append((t, f'<A T="{f(t)}" Y="p" C="{ids[no]}" I="{f(lap_time)}" />'))
            # Natsoft re-sends the position of every car whose place changed (else retired cars kept theirs).
            others = ''
            for i, o in enumerate(order, start=1):
                if o != no and sent_pos.get(o) != i:
                    others += f'<P L="{i}" LL="{i}" P="{i}" C="{ids[o]}" D="1" />'
                sent_pos[o] = i
            out.append((t, f'<L T="{f(t)}" Y="p" L="{len(report)}"><P L="{pos}" LL="{pos}" P="{pos}" LP="{road}" C="{cid}" D="1"><D {d} /></P>{others}</L>'))
            if no == leader and pos == 1:
                out.append((t, f'<C T="{f(t)}" Y="L" C="{max(0, race["laps"] - n)}" E="{n}" />'))
                if n == race['laps'] and not finished:
                    finished = True
                    out.append((t, f'<S T="{f(t)}" S="Checkered" I="0.0000" R="0" E="{race["code"]}" P="1" SN="0" />'))
            continue
        out.append((t, f'<L T="{f(t)}" Y="p" L="{len(report)}"><P LP="{road}" C="{cid}" D="1"><D {d} /></P></L>'))

    end = max(t for t, _ in out) + 120
    for p in race['penalties']:
        out.append((end - 60, f'<G T="{f(end - 60)}" R={quoteattr(p["text"])} C="" />'))
    out.append((end, f'<S T="{f(end)}" S="Ended" I="0.0000" R="0" E="{race["code"]}" P="1" SN="0" />'))
    return sorted(out, key=lambda x: x[0])


def write(event, key):
    built = build(event, key)
    msgs = messages(event, key, built)
    start, offset = built[5], built[6]
    stamp = dt.datetime.fromtimestamp(start - offset, dt.timezone.utc).strftime('%Y%m%d_%H%M%S')
    path = os.path.join(REPO, 'data', 'recordings', f'V8SUPER_{stamp}_hist-{key.lower()}.jsonl')
    with open(path, 'w', encoding='utf-8') as fh:
        for i, (t, xml) in enumerate(msgs):
            # Receive time: real UTC (track time minus the track's offset), a microsecond apart to keep the order.
            received = dt.datetime.fromtimestamp(t - offset, dt.timezone.utc) + dt.timedelta(microseconds=i % 1000)
            fh.write(json.dumps({'t': received.isoformat(), 'kind': 'msg', 'raw': xml, 'xml': xml}) + '\n')
    print(f'{key}: {len(msgs)} messages -> {os.path.relpath(path, REPO)}')
    print(f'  cautions (inferred): {[(fmt(a), round(b - a)) for a, b in built[4]]}')
    for n in built[7]:
        print('  ' + n)


def fmt(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%H:%M:%S')


if __name__ == '__main__':
    event = json.load(open(sys.argv[1]))
    for key in sys.argv[2:] or list(event['races']):
        write(event, key)
