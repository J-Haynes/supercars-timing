"""
Scores map placement strategies against F1's real car positions (Position.z) from archived races: the map only
gets mini-sector crossings (like the live app), the archive also has where each car really was.

Usage: python3 tools/F1MapEval/evalmap.py <race folder> [<race folder> ...] [config name ...] [--per-race]
  A race folder holds Heartbeat, TimingData, Position.z, TrackStatus, SessionStatus (.jsonStream) and
  SessionInfo.json from livetiming.formula1.com/static/<year>/<race>/; the circuit's track file must exist.
  Configs are in CONFIGS (a port of map/carPosition.ts as `current`; keep it in step when the app changes).
  Results are cached next to this script as <folder>.pkl (git-ignored).

For every car, every 0.25 s while it's on track: where would the map draw it (from mini-sector crossings only, as
the live app sees them), vs where it really was (its position, shifted by the timing delay)?
"""
import bisect, json, math, os, statistics, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'tools', 'F1TrackBuilder'))
import build_track as bt  # noqa: E402
DT = 0.25


# ---------------------------------------------------------------- track
class Track:
    def __init__(self, d):
        self.path, self.step, self.length = d['path'], d['step'], d['length']
        self.sim = d['simTime']
        self.lap_sim = self.sim[-1]
        self.points = {p['id']: p['distance'] for p in d['timingPoints']}
        self.baseline = [s['seconds'] for s in d['segmentSeconds']]

    def wrap(self, x):
        return x % self.length

    def sim_at(self, d):
        f = min(max(d, 0), self.length) / self.step
        i = min(int(f), len(self.sim) - 2)
        return self.sim[i] + (f - i) * (self.sim[i + 1] - self.sim[i])

    def dist_at_sim(self, t):
        i = bisect.bisect_right(self.sim, t) - 1
        i = min(max(i, 0), len(self.sim) - 2)
        span = (self.sim[i + 1] - self.sim[i]) or 1
        return min((i + (t - self.sim[i]) / span) * self.step, self.length)

    def place(self, frm, to, fraction):
        """carPosition's shaping: same fraction of the simulated time through the stretch."""
        if to <= frm:
            to += self.length
        t0 = self.sim_at(frm)
        t1 = self.lap_sim + self.sim_at(to - self.length) if to > self.length else self.sim_at(to)
        target = t0 + fraction * (t1 - t0)
        d = self.length + self.dist_at_sim(target - self.lap_sim) if target > self.lap_sim else self.dist_at_sim(target)
        return self.wrap(d)


def loop_diff(a, b, length):
    d = (a - b) % length
    if d > length / 2:
        d -= length
    return d


# ---------------------------------------------------------------- data
def load_race(folder):
    info = json.load(open(os.path.join(folder, 'SessionInfo.json'), encoding='utf-8-sig'))
    key = info['Meeting']['Circuit']['Key']
    track = Track(json.load(open(f'{REPO}/src/web/src/tracks/F1-{key}.json')))
    start, pos, crossings, laps, pit, seg_counts = bt.load(folder)
    total = sum(seg_counts)
    order = ['M'] + [f'{s + 1}.{i + 1}' for s in range(len(seg_counts)) for i in range(seg_counts[s])][:-1]
    point_of_flat = lambda f: 0 if f == total - 1 else f + 1

    status = [(t, json.loads(raw).get('Status')) for t, raw in bt.lines(os.path.join(folder, 'TrackStatus.jsonStream'))]
    sess = [(t, json.loads(raw).get('Status')) for t, raw in bt.lines(os.path.join(folder, 'SessionStatus.jsonStream'))]
    t_start = next(t for t, s in sess if s == 'Started')
    t_end = next((t for t, s in sess if s == 'Finished'), 1e9)
    return dict(track=track, pos=pos, crossings={c: [(t, point_of_flat(f)) for t, f in cs] for c, cs in crossings.items()},
                pit=pit, order=order, status=status, t_start=t_start, t_end=t_end, key=key)


def find_delay(race):
    """Timing delay vs positions: where crossings of each point line up with the track file's points."""
    tr = race['track']
    best = None
    for d10 in range(0, 50, 2):
        delay = d10 / 10
        errs = []
        for car, cs in list(race['crossings'].items())[:8]:
            proj = race['proj'].get(car)
            if not proj:
                continue
            for t, p in cs[::7]:
                d = truth_at(proj, t - delay)
                if d is not None:
                    errs.append(abs(loop_diff(d, tr.points[race['order'][p]], tr.length)))
        e = statistics.median(errs)
        if best is None or e < best[1]:
            best = (delay, e)
    return best


def project_all(race):
    """Each car's positions as distance along the lap (local search from the last match)."""
    tr = race['track']
    path = tr.path
    n = len(path)
    out = {}
    for car, samples in race['pos'].items():
        res, k, last_t = [], None, None
        for t, x, y in samples:
            if k is None or t - last_t > 5:
                cand = range(n)
            else:
                cand = [(k + j) % n for j in range(-6, 40)]
            k = min(cand, key=lambda i: (path[i][0] - x) ** 2 + (path[i][1] - y) ** 2)
            off = math.hypot(path[k][0] - x, path[k][1] - y)
            # Refine along the segment to the next sample.
            j = (k + 1) % n
            ax, ay = path[j][0] - path[k][0], path[j][1] - path[k][1]
            f = max(0.0, min(1.0, ((x - path[k][0]) * ax + (y - path[k][1]) * ay) / ((ax * ax + ay * ay) or 1)))
            res.append((t, tr.wrap((k + f) * tr.step), off))
            last_t = t
        out[car] = res
    return out


def truth_at(proj, t, length=None):
    i = bisect.bisect_left(proj, (t,))
    if i == 0 or i >= len(proj):
        return None
    (t0, d0, o0), (t1, d1, o1) = proj[i - 1], proj[i]
    if t1 - t0 > 1.5 or o0 > 25 or o1 > 25:
        return None
    L = length or TRACK_LEN[0]
    return (d0 + (t - t0) / (t1 - t0) * loop_diff(d1, d0, L)) % L


TRACK_LEN = [0.0]


# ---------------------------------------------------------------- history available to predictors
class History:
    """Completed stretches: per car (list by time) and per stretch (by end time), as the app would know them."""

    def __init__(self, race):
        self.race = race
        self.n = len(race['order'])
        self.by_car = {}
        self.by_stretch = [[] for _ in range(self.n)]
        for car, cs in race['crossings'].items():
            lst = []
            for (t0, p0), (t1, p1) in zip(cs, cs[1:]):
                if p1 == (p0 + 1) % self.n and 0.5 <= t1 - t0 < 120:
                    lst.append((t1, p0, t1 - t0, t0))
            self.by_car[car] = lst
            for e in lst:
                self.by_stretch[e[1]].append((e[0], e[2], car, e[3]))
        for s in self.by_stretch:
            s.sort()
        self.car_end_times = {c: [e[0] for e in l] for c, l in self.by_car.items()}
        self.stretch_end_times = [[e[0] for e in s] for s in self.by_stretch]
        self.status = race['status']
        self.status_t = [t for t, _ in race['status']]

    def flag(self, t):
        i = bisect.bisect_right(self.status_t, t) - 1
        return self.status[i][1] if i >= 0 else '1'

    def caution_since(self, t):
        """Start of the caution in force at t (SC 4, VSC 6/7), or None."""
        i = bisect.bisect_right(self.status_t, t) - 1
        if i < 0 or self.status[i][1] not in ('4', '6', '7'):
            return None
        while i > 0 and self.status[i - 1][1] in ('4', '6', '7'):
            i -= 1
        return self.status[i][0]

    def own(self, car, t):
        """The car's completed stretches up to t, most recent last."""
        lst = self.by_car.get(car, [])
        return lst[:bisect.bisect_right(self.car_end_times.get(car, []), t)]

    def field(self, stretch, t, window):
        """Times through `stretch` finished in (t - window, t]: (end, seconds, car, start)."""
        s, ends = self.by_stretch[stretch], self.stretch_end_times[stretch]
        return s[bisect.bisect_left(ends, t - window):bisect.bisect_right(ends, t)]


# ---------------------------------------------------------------- strategies: expected seconds for the stretch from point i, starting at t
def own_last_through(hist, car, i, t):
    for e in reversed(hist.own(car, t)):
        if e[1] == i:
            return e
    return None


def s_current(hist, car, i, t, base):
    """Port of carPosition.ts (race, green): the car's latest time through this stretch; caution handling."""
    last = own_last_through(hist, car, i, t)
    expected = last[2] if last else base[i]
    since = hist.caution_since(t)
    if since is not None:
        field = [e for e in hist.field(i, t, 90) if e[3] >= since]
        if len(field) >= 2:
            secs = sorted(e[1] for e in field)
            same = secs[int(len(secs) * 0.75)]
            own = hist.own(car, t)
            prev = (i - 1) % hist.n
            own_prev = own[-1][2] if own and own[-1][1] == prev else 0
            fprev = [e[1] for e in hist.field(prev, t, 90) if e[3] >= since]
            fp = sorted(fprev)[int(len(fprev) * 0.75)] if len(fprev) >= 2 else 0
            rel = min(max(own_prev / fp, 0.5), 1.5) if own_prev and fp else 1
            expected = max(expected, same * rel)
        else:
            own = hist.own(car, t)
            ratio = own[-1][2] / base[own[-1][1]] if own and own[-1][3] >= since else 1.3
            expected = max(expected, base[i] * min(max(ratio, 1), 3))
    return expected


def ratio_of(e, base):
    return e[2] / base[e[1]]


def s_pace(k=1, field_mix=0.0, ref='lastlap'):
    """
    Pace-adjusted: the reference time for this stretch (own last lap through it, or the track baseline) times the
    car's current pace = recent stretches vs their references (last k stretches, time-weighted).
    """
    def f(hist, car, i, t, base):
        own = hist.own(car, t)
        last_same = own_last_through(hist, car, i, t)
        if ref == 'lastlap' and last_same:
            reference = last_same[2]
            # pace now vs the same stretches last lap
            ratios = []
            for e in own[-k:]:
                prev_same = None
                for g in reversed(own[:own.index(e)]):
                    if g[1] == e[1]:
                        prev_same = g
                        break
                if prev_same and e[0] - prev_same[0] < 400:
                    ratios.append(e[2] / prev_same[2])
            r = statistics.mean(ratios) if ratios else 1.0
        else:
            reference = base[i]
            rs = [ratio_of(e, base) for e in own[-k:] if t - e[0] < 60]
            r = statistics.mean(rs) if rs else 1.15
        exp = reference * r
        if field_mix > 0:
            fr = hist.field(i, t, 30)
            if fr:
                # Cars that just did this stretch, scaled by how this car compared with them on the stretch before.
                fexp = statistics.median(e[1] for e in fr[-3:])
                exp = (1 - field_mix) * exp + field_mix * fexp
        return exp
    return f


def s_ahead(fallback):
    """
    The car just ahead on the road: it did this stretch a moment ago in the same conditions. If it went through
    within the last 3 s, expect its time (scaled by how the two compared on the stretch before), else fallback.
    """
    def f(hist, car, i, t, base):
        fr = hist.field(i, t, 40)
        cands = [e for e in fr if e[2] != car and t - e[3] < 6]
        if cands:
            e = cands[-1]
            prev = (i - 1) % hist.n
            mine = [g for g in hist.own(car, t)[-1:] if g[1] == prev]
            theirs = [g for g in hist.own(e[2], e[3])[-1:] if g[1] == prev]
            rel = min(max(mine[0][2] / theirs[0][2], 0.8), 1.25) if mine and theirs else 1
            return 0.5 * e[1] * rel + 0.5 * fallback(hist, car, i, t, base)
        return fallback(hist, car, i, t, base)
    return f


# ---------------------------------------------------------------- display models
def simulate(race, hist, strategy, slack=1.04, cap=0.99, tau=0.3, lookahead=0.0, creep=None, hold=None):
    """
    Draws every car every DT seconds, like the app: position from the last known crossing and the expected time for
    the stretch (strategy); at each new crossing the jump fades over tau.
      creep: from this fraction on, a late car eases in towards the next point instead of running at full speed.
      hold:  None = a late car waits just short of the next point until its crossing arrives (the app today).
             h = after waiting until (1 + h) x the expected time, assume the crossing was never sent (F1 skips ~4 %)
             and carry on into the next stretch.
      lookahead: broadcast delay in seconds: the map shows `now - lookahead`, so crossings up to `now` are known and
             the stretch the car is in can be interpolated when its end is already in hand (even across a skipped point).
    Metrics: position error vs the real position; per second of motion: frozen (dot still, car moving),
    spikes (dot speed off the real speed by > 25 m/s over 1 s); the size of the jump at each crossing.
    """
    tr, order = race['track'], race['order']
    base = tr.baseline
    pts = [tr.points[p] for p in order]
    n = len(order)
    L = tr.length
    errs = {'green': [], 'caution': []}
    steps, frozen, spikes, total = [], 0, 0, 0
    for car, cs in race['crossings'].items():
        proj = race['proj'].get(car)
        if not proj or len(cs) < 10:
            continue
        times = [c[0] for c in cs]
        pit = race['pit'].get(car, [])
        pit_t = [p[0] for p in pit]
        exp_cache = {}

        def expected(k, p, at):
            key = (k, p)
            if key not in exp_cache:
                exp_cache[key] = strategy(hist, car, p, at, base)
            return exp_cache[key]

        def shape(raw):
            if creep is not None and raw > creep:
                return min(creep + (cap - creep) * (1 - math.exp(-(raw - creep) / (cap - creep))), cap)
            return min(raw, cap)

        def predict(k, view, now):
            tk, p = cs[k]
            # Known end of this stretch (delay): interpolate to the next crossing, across skipped points too.
            if k + 1 < len(cs) and cs[k + 1][0] <= now:
                t1, p1 = cs[k + 1]
                span = (p1 - p) % n or n
                d0, d1 = pts[p], pts[p1]
                if d1 <= d0:
                    d1 += L
                f = (view - tk) / (t1 - tk)
                if span == 1:
                    return tr.place(pts[p], pts[p1], f)
                return (d0 + f * (d1 - d0)) % L
            e1 = expected(k, p, tk) * slack
            raw = (view - tk) / e1
            if hold is None or raw < 1 + hold:
                return tr.place(pts[p], pts[(p + 1) % n], shape(raw))
            # Assume the next point's crossing was skipped: carry on through the stretch after it.
            t2 = tk + e1 * (1 + hold)
            q = (p + 1) % n
            e2 = expected(k, q, tk) * slack
            return tr.place(pts[q], pts[(q + 1) % n], shape((view - t2) / e2))

        key_prev, off0, t0 = None, 0.0, 0.0
        hist_pos = []  # (t, shown, truth) for the last second
        t = race['t_start'] + 60
        while t < race['t_end']:
            view = t - lookahead
            k = bisect.bisect_right(times, view) - 1
            ip = bisect.bisect_right(pit_t, view) - 1
            in_pit = ip >= 0 and pit[ip][1]
            if k < 0 or in_pit or view - cs[k][0] > 30:
                key_prev, hist_pos = None, []
                t += DT
                continue
            target = predict(k, view, t)
            if key_prev is None:
                off0, t0 = 0.0, t
            elif key_prev != k:
                old = (predict(key_prev, view, t) + off0 * math.exp(-(t - t0) / tau)) % L
                off0 = loop_diff(old, target, L)
                if abs(off0) > 200:
                    off0 = 0
                steps.append(abs(off0))
                t0 = t
            shown = (target + off0 * math.exp(-(t - t0) / tau)) % L
            key_prev = k
            truth = truth_at(proj, view - race['delay'], L)
            if truth is not None:
                kind = 'caution' if hist.flag(view) in ('4', '6', '7') else 'green'
                errs[kind].append(loop_diff(shown, truth, L))
                hist_pos.append((t, shown, truth))
                while hist_pos and t - hist_pos[0][0] > 1.0001:
                    hist_pos.pop(0)
                if t - hist_pos[0][0] > 0.99:
                    vs = loop_diff(shown, hist_pos[0][1], L)
                    vt = loop_diff(truth, hist_pos[0][2], L)
                    total += 1
                    if abs(vs) < 3 and vt > 15:
                        frozen += 1
                    if abs(vs - vt) > 25:
                        spikes += 1
            else:
                hist_pos = []
            t += DT

    def mean_abs(xs):
        return statistics.mean(abs(x) for x in xs) if xs else float('nan')

    def p90(xs):
        a = sorted(abs(x) for x in xs)
        return a[int(len(a) * .9)] if a else float('nan')
    return {
        'err_green': mean_abs(errs['green']), 'p90_green': p90(errs['green']),
        'bias_green': statistics.mean(errs['green']) if errs['green'] else float('nan'),
        'err_caution': mean_abs(errs['caution']), 'p90_caution': p90(errs['caution']),
        'step': statistics.mean(steps) if steps else 0,
        'frozen%': 100 * frozen / max(total, 1), 'spike%': 100 * spikes / max(total, 1),
    }


def prepare(folder):
    race = load_race(folder)
    TRACK_LEN[0] = race['track'].length
    race['proj'] = project_all(race)
    race['delay'], e = find_delay(race)
    print(f"{os.path.basename(folder.rstrip('/'))}: circuit {race['key']}, delay {race['delay']:.1f} s (median point error {e:.1f} m)", flush=True)
    return race, History(race)


CONFIGS = {
    'current (app today)': dict(strategy=s_current),
    'slack 1.00': dict(strategy=s_current, slack=1.0),
    'slack 0.97': dict(strategy=s_current, slack=0.97),
    'hold 0.3 (carry on past a silent point)': dict(strategy=s_current, hold=0.3),
    'hold 0.6': dict(strategy=s_current, hold=0.6),
    'hold 1.0': dict(strategy=s_current, hold=1.0),
    'slack 1.0, hold 0.6': dict(strategy=s_current, slack=1.0, hold=0.6),
    'slack 1.0, hold 0.6, creep .85': dict(strategy=s_current, slack=1.0, hold=0.6, creep=0.85),
    'pace k2, slack 1.0, hold 0.6': dict(strategy=s_pace(2), slack=1.0, hold=0.6),
    'field mix, slack 1.0, hold 0.6': dict(strategy=s_pace(2, field_mix=0.5), slack=1.0, hold=0.6),
    'tau 0.8, slack 1.0, hold 0.6': dict(strategy=s_current, slack=1.0, hold=0.6, tau=0.8),
    'delay 2s': dict(strategy=s_current, lookahead=2, slack=1.0, hold=0.6),
    'delay 4s': dict(strategy=s_current, lookahead=4, slack=1.0, hold=0.6),
    'delay 8s': dict(strategy=s_current, lookahead=8, slack=1.0, hold=0.6),
    'delay 30s (floor)': dict(strategy=s_current, lookahead=30),
    'slack 1.0, hold 0.3': dict(strategy=s_current, slack=1.0, hold=0.3),
    'slack 1.0, hold 0.3, creep .85': dict(strategy=s_current, slack=1.0, hold=0.3, creep=0.85),
    'slack 1.0, hold 0.3, creep .9': dict(strategy=s_current, slack=1.0, hold=0.3, creep=0.9),
    'slack 1.0, hold 0.3, creep .85, delay 1s': dict(strategy=s_current, slack=1.0, hold=0.3, creep=0.85, lookahead=1),
    'slack 1.0, hold 0.3, creep .85, delay 3s': dict(strategy=s_current, slack=1.0, hold=0.3, creep=0.85, lookahead=3),
}


def load_cached(folder):
    import pickle
    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.path.basename(folder.rstrip('/')) + '.pkl')
    if os.path.exists(cache):
        race, hist = pickle.load(open(cache, 'rb'))
    else:
        race, hist = prepare(folder)
        pickle.dump((race, hist), open(cache, 'wb'))
    TRACK_LEN[0] = race['track'].length
    return race, hist


if __name__ == '__main__':
    folders = [a for a in sys.argv[1:] if os.path.isdir(a)]
    names = [a for a in sys.argv[1:] if not os.path.isdir(a) and a not in ('--noheader', '--per-race')] or list(CONFIGS)
    races = [(os.path.basename(f.rstrip('/'))[:10], *load_cached(f)) for f in folders]
    for name in names:
        rs = [simulate(r, h, **CONFIGS[name]) for _, r, h in races]
        def avg(key):
            v = [x[key] for x in rs if x[key] == x[key]]
            return statistics.mean(v) if v else float('nan')
        if '--per-race' in sys.argv:
            for (rn, _, _), x in zip(races, rs):
                print(f"   {rn:10} green {x['err_green']:5.1f} SC {x['err_caution']:5.1f} frozen {x['frozen%']:4.1f} spikes {x['spike%']:4.1f}")
        print(f"{name:42} {avg('err_green'):6.1f} {avg('p90_green'):6.1f} {avg('bias_green'):6.1f} | {avg('err_caution'):6.1f} {avg('p90_caution'):6.1f} | {avg('step'):6.1f} {avg('frozen%'):6.1f} {avg('spike%'):6.1f}", flush=True)
