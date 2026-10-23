# Planning notes

Longer-term considerations and research, recorded so they survive between sessions. Current behaviour and how to
work in the repo are in `CLAUDE.md`; the feed itself in `docs/PROTOCOL.md`.

## Using Natsoft's data responsibly (Oct 2026)

The owner asked how our use looks from Natsoft's side, not ours: request costs, rate limiting and visibility, as a
company with a public API would see it.

**What Natsoft sees from us.** One long-lived WebSocket to `server.natsoft.com.au:8080/LiveMeeting/V8SUPER` from one
IP, the same endpoint a browser on supercars.com's classic timing uses. During a session it pushes updates to us like
to any viewer; our cost to them then is about one viewer's bandwidth, however many of our own browsers watch,
because our server fans out to them. That part is the polite design.

**Where we differ from a normal viewer.** The service runs 24/7. When no meeting is live, Natsoft answers
`<NotFound/>` and we reconnect every 30 s: about 120 handshakes an hour, ~2,900 a day, every day, from one IP. Each
is cheap, but a browser tab doesn't sit doing that for weeks, so it's the most visible and least necessary part of
our traffic. The .NET `ClientWebSocket` also doesn't identify the app.

**Decision (11 Oct 2026):** the owner chose option 1, extended: plan the connection schedule ahead and automate it
from session times fetched from the racing series' websites (not only the hand-kept `calendar.ts`).

**Built (12 Oct 2026), first half:** the server connects only from 30 minutes before each scheduled Supercars session
to 30 minutes after it (the owner's choice of 30 min), and is fully disconnected otherwise: no off-weekend handshakes
at all. Times come from `src/web/src/schedule/supercars.json`, shared with the event pages. Events whose timetable is
incomplete are covered 07:00-19:00 on event days. Not built yet: fetching the times automatically from the series'
websites; until then the JSON is kept by hand, and a session missing from it isn't recorded.

**Options considered:**
1. **Calendar-aware connection:** connect normally from ~1 hour before the first session of an event day
   (`calendar.ts` has the times) to the end of the day; otherwise check rarely (every 15-30 min) or not at all.
   That removes almost all of the off-weekend handshakes. Risk: an unlisted or rescheduled session is missed, so
   keep a slow background check.
2. **Identify the client:** a descriptive User-Agent (e.g. app name and a contact address) is common courtesy for
   automated clients and lets an operator contact rather than block. Trade-off: it's less anonymous.
3. **Keep it private:** recording and analysing for personal use is far less of a concern than republishing.
   Public deployment would mean redistributing Natsoft/Supercars timing data and needs their permission. The app
   stays on the tailnet (no Funnel) until that's decided.
4. **Never multiply connections:** extra viewers, tests and replays must never open their own Natsoft connection.
   Tests and replays use recordings; the test server runs in replay mode.

We haven't found published terms for the feed. If Natsoft or Supercars ask us to stop or change how we connect, do it.

## Deployment (not planned yet; personal app for now)

**Built (19 Oct 2026):** remote access from this laptop through a Cloudflare Tunnel (`deploy/README.md`): live timing,
results and upcoming events, no replays (they cost the laptop CPU per viewer and ~3 Mbit/s each; measured on Race 30:
a new cursor near the end 0.55 s, a backwards seek 0.2 s, a snapshot 56 KB, 11 KB gzipped). Still worth doing before
many remote viewers: response compression (the server sends JSON uncompressed) and a slower or delta live feed for
remote viewers (~1.6 Mbit/s each today). racinglive.app, for comparison, polls a compact snapshot every 2 s.
Vercel, Oracle Cloud and Cloudflare Workers/Containers were looked at and not chosen (always-on process, disk).

- **Frontend:** a static site (Vite build), fits Vercel/Netlify/Cloudflare Pages.
- **Live backend:** needs an always-on process holding the Natsoft WebSocket and pushing updates (SignalR). Not a fit
  for serverless functions. Options: a small container/VPS (Fly.io, Railway, ~$5/month), or this machine behind a
  tunnel. Only one instance may connect to Natsoft.
- **Storage:** no database needed. A Bathurst race-day recording is 9.1 MB raw, 0.5 MB gzipped; a season is roughly
  100-200 MB gzipped. Plan: generate a small per-session archive (results, lap history, a compact replay timeline)
  from each recording and keep those in object storage (Cloudflare R2, S3, Vercel Blob). Results, charts and replay
  could then run entirely in the browser with no backend. SQL only if cross-season queries are wanted.
- **Prerequisites:** permission for the data (above), and authentication if anything is ever public.
- Doing this would also solve the recordings backup gap.

## F1 (added 11 Oct 2026, Singapore GP)

The app has a second, separate F1 app at `/f1` on F1's public live timing (`docs/PROTOCOL-F1.md`). Notes:

- **Car positions need F1 TV.** Anonymous connections get all the timing topics but not `Position.z` (real x/y,
  ~4 Hz) or `CarData.z` (telemetry). With an F1 TV subscription token they'd be available and the map could show true
  positions instead of placing cars between mini-sectors. Guides say the cheaper **F1 TV Access** tier includes live
  timing (Pro adds video; F1 TV Pro is US$10.99/month in the US). We couldn't confirm the Australian price or
  whether Access is sold here (Kayo/Foxtel hold the TV rights): check https://f1tv.formula1.com before deciding.
  It's a paid service, so discuss before building on it (same rule as MySupercars+). Implementation would mean
  storing the token on the server and sending it with the negotiate/WebSocket (FastF1 does this).
- **Same data-use rules as Natsoft:** one connection, slow reconnects, personal use, our server fans out.
- **Not built yet for F1:** results/replay pages (the menu has Live and Upcoming only), championship standings,
  maps for 2027 circuits not raced in 2025/2026 (run `tools/F1TrackBuilder` on an archived session there), team
  radio, weather.

## Pit strategy features (being considered, 12 Oct 2026)

The owner likes all of these. Built so far: 1 (13 Oct 2026, experimental). Ideas, in the suggested order:

1. **"If they pitted now" ghost** (built: `src/web/src/pit/`, CLAUDE.md "Pit rejoin ghost"): pick a car and a violet
   ring on the 2D/3D maps shows where it would rejoin, with the likely range as a band and a card under the map.
   Backtest (`tools/PitLoss/backtest.mts`, prediction from just before pit entry, checked 60 s after the exit):
   - Bathurst 1000 Race 30, 165 stops: right position 43%, within one 73%; gap to the car ahead off by 3.4 s
     (median). Given each stop's real cost: 49% / 80% and 1.1 s, so most of the error is the unknown stop cost;
     the rest is other cars stopping meanwhile (with no other stops: 70% exact). Checked 20 s after the exit, the
     car was still accelerating out of the pit lane and looked ~2.7 s closer than it was.
   - Ranges: ±1.5 s around this race's median caught the real cost 38% of the time, ±3 s about half (used).
   - 2025 Singapore GP (F1 archive replayed on the demo server, snapshots saved every 0.25 s), 23 stops: 57% / 83%;
     in-sample, as the Singapore prior comes from the same race. Our in-pit times match F1's PitLaneTime (24.1 vs 24.0 s).
   - Under a caution it pauses: 2025 Gold Coast stops under the safety car cost ~3-9 s (vs ~45 s green), compared
     with cars that stayed out, but too few and too noisy to predict from.
2. **"Circle of Doom" view:** the track as a ring spaced by gap (time), not distance, with battles and the chosen
   car's pit window. The name comes from timing tools, not confirmed as a team term: MultiViewer
   (https://www.patreon.com/multiviewer/posts/circle-of-doom-164858438) and OneTiming
   (https://support.paceteq.com/onetiming/circle-of-doom; its window runs from a fuel-only stop to full service).
3. **Undercut and clear-air alerts** in the ticker: "#17 could undercut #8, rejoins in clear air", "#8 must
   respond", and afterwards whether it worked. Out-lap gain measured from earlier stops in the same race.
   Undercut/overcut background: https://www.gpfans.com/en/f1-news/1016512/f1-undercut-overcut-explained/ ,
   https://www.catapult.com/blog/motorsports-race-strategy-undercut-overcut
4. **Cheap stop under a caution:** who would lose the fewest places pitting now.
5. **Stops remaining / pit windows** (below, "Ideas not built yet"). 2026 Finals races have two compulsory stops
   (https://www.supercars.com/news/supercars-news-2026-tasmania-strategy-three-stop-change-rules-explained-chaz-mostert).
6. **Race history chart:** each car's gap to the leader's average pace by lap (undercuts show as crossing lines).

All but 6 are predictions: label them as such and keep them out of Focus/Compare (measured data only).
Before showing 1-4, backtest on Bathurst Race 30: predict each real stop from the stops before it, compare with
where the car really rejoined.

**What a stop costs is two numbers.** (a) Driving the pit lane instead of the track: fixed per track (until the
pit lane or its limit changes). (b) Stationary time: F1 ~2.5-3 s, nearly constant; Supercars mostly **refuelling**,
a team's plan we can't see (a four-tyre change takes ~7-10 s; Gold Coast 2024 needed ~21 s of fuel over two stops,
https://supercars.com/news/2024-gold-coast-500-strategy-guide-supercars-news-tyres-fuel ; Gold Coast 2025 finale:
Feeney stationary 22 s vs Mostert 19 s,
https://www.supercars.com/news/supercars-news-2025-mark-skaife-gold-coast-500-wau-triple-eight-pit-call-gold-coast-500-mostert-feeney).
So for Supercars the prediction is a range even with perfect history.

**Measured (12 Oct 2026):**
- **Supercars, Bathurst Race 30:** time lost per stop (in-lap + out-lap minus two typical laps, 155 green-flag
  stops) = Natsoft's `PT` minus ~2.7 s (half within 1.4-3.6 s). So each stop's cost is known when the car leaves the
  pits. Payne's drive-through: `PT` 32.6 s, cost 27.3 s (the pit-lane part). Typical stop cost 66 s; stationary
  roughly `PT` - 32.6 s, 18-100+ s (fuel). The loss lands on the out-lap (the pit lane passes the line).
- **F1:** the feed's `PitStopSeries` topic has pit-lane time and stationary time per stop, live and in F1's public
  archive. 2025 races, median time lost per green-flag stop: Singapore 22.9 s, Austin 20.7, Mexico City 22.2,
  Interlagos 21.7, Las Vegas 22.1, Lusail 25.2, Yas Marina 22.7. Singapore checks out (~22 s after 2025's 60 -> 80 km/h
  pit limit change, https://www.motorsport.com/f1/live-text/f1-singapore-gp-live-coverage-and-updates-race/1125751/?p=3 ),
  which also shows last year's figure is only a starting point.
- **Estimating from the map doesn't work well enough:** pit lanes drawn in our track files are 461 m (SPSC) to 744 m
  (MOUN), but the speed limit varies by event and isn't found for 2026 (40 km/h at the Gold Coast in 2010; Rule
  D11.4.2 40 km/h at The Bend 2025, https://speedcafe.com/supercars-news-2025-the-bend-500-craig-lowndes-speeding-fine-pit-lane-details-stewards-report/ ;
  Bathurst's 32.6 s over 744 m suggests ~80 km/h), and where Natsoft's pit-in/out lines sit is unknown.

**Where each track's numbers come from (best first):** stops already made in this race (`PT`, live) -> the other
race of the same weekend (Gold Coast, Sandown, Adelaide: Saturday for Sunday) -> last year's recordings (Bathurst
2027 can use Race 30; F1 has the archive) -> before any stop: a wide range marked as an estimate. For 2026 the
Finals tracks are covered by 2025's reports (below). Rules can change
between years (number of stops, fuel drop), the pit-lane part rarely does.

**Last year's Finals tracks, from Natsoft's results site** (looked at by hand with the owner's OK, 12 Oct 2026).
http://racing.natsoft.com.au/results/ (a JavaScript app: Circuit Racing -> track and year -> View -> "Times") has
every race's "Sector and Lap Times" report: sectors and lap times per car, in-laps marked "p". Saved as text under
`data/recordings/natsoft-results/` (Natsoft's data: git-ignored) and measured with `tools/PitLoss/natsoft_report.py`
(time lost = in-lap + out-lap - 2 x the car's median lap; green-flag stops only). 2025 used the same formats as 2026:

| 2025 race | 1st stop (median, middle half) | 2nd stop | Green-flag stops |
|---|---|---|---|
| Gold Coast Race 28 (85 laps) | (most stopped under the lap-12 safety car) | 46.6 s (44.4-48.6) | 19 |
| Gold Coast Race 29 (85 laps) | 38.8 s (37.7-44.8) | 52.0 s (48.8-55.3) | 46 |
| Sandown Race 30 (81 laps) | 37.7 s (36.5-39.8) | 47.8 s (46.0-49.1) | 45 |
| Sandown Race 31 (81 laps) | (safety cars: 3 green-flag stops) | | 3 |
| Adelaide Race 32 (32 laps) | 25.8 s (24.1-27.4) | | 9 |
| Adelaide Race 33 (78 laps) | 28.6 s (27.4-31.6) | 43.0 s (40.6-45.0) | 47 |
| Adelaide Race 34 (78 laps) | 28.2 s (27.2-31.1) | 44.0 s (43.3-46.1) | 44 |

- **Each stop number is consistent; the second costs 10-15 s more** (more fuel). So the model should predict per
  stop number, not one range: "stop 2 at the Gold Coast: ~48-55 s" is much tighter than "38-55 s".
- Most cars at the Gold Coast (Race 28) and Sandown (Race 31) stopped under safety cars: what a caution stop costs
  isn't measured yet (to do: compare with cars that stayed out on the same laps).
- The results site's track codes (SPSC, SIMR, APC, and MPB2 for Bathurst) aren't the live feed's (`MOUN`), so they
  don't settle our guessed `SAND`/`ADEL` codes (the Gold Coast's live code did turn out to be `SPSC`) (the map loader falls back to names anyway).
- F1: `tools/PitLoss/f1_archive.py <year>` downloads PitStopSeries and TimingData for each circuit we have a map for
  (cached in `data/recordings/f1-archive/`) and prints the table above.

**Loose ends (12 Oct 2026):**
- F1 `PRIORS` come from 2025. The 2026 Singapore GP is in our own recording (`data/recordings/f1/`): replay it on the
  demo server, save snapshots and update `F1-61`; do the same for each 2026 race as it's run.
- The server doesn't read F1's `PitStopSeries` (pit-lane and stationary time per stop, live): it would give exact F1
  stop costs and stationary times for a pit stop leaderboard. A server change (restart needed).
- Pit lane speed limits for the Finals tracks weren't found for 2026; they'd allow an estimate before any stop.
- The demo server (:5081) isn't on the tailnet; `tailscale serve --https=8443 http://localhost:5081` would add it
  (the owner's call).

## Known limits of the 3D maps (12 Oct 2026)

- OSM landmark names are imperfect (Singapore's "Samsung" and "HSBC" are signs on buildings); Austin, Interlagos,
  Lusail and Sandown have none.
- Bathurst's trees are only what OSM maps (97 trees, tree rows, 13 woods): the real mountain has more cover. The
  hillside sign reads MOUNT PANORAMA (OSM's 13 letters); grandstand heights are assumed (9 m).
- Not yet tried: the Follow camera at the Gold Coast, the 3D map on a real phone's GPU.

## Modular layout: plan and backlog (13 Oct 2026, not built)

Asked for by the owner: as panels keep being added, viewers should be able to **hide and reorder** them. **The tower
(leaderboard) is fixed**: it can't be moved or hidden. Moving is drag and drop; hiding works on the panel itself and in
the settings menu, which gets fleshed out.

**Today:** App.tsx places panels by hand. Left column (sticks to the bottom on wide screens, `useStickToBottom`): safety
car banner, race feed, tower, tips. Right column (`aside.map-panel`): map (+ pit ghost card), championship and Finals
ladders, charts, race control, pit log, each wrapped in `panel-map` / `panel-race` / `panel-charts` for the phone tabs.
The replay page has its own subset. Settings hold only tower columns (with a drag/arrow reorder list we can reuse).

**Design:**
- A **panel registry** (`panels.ts`): id, title, the component, which pages it can appear on (live / replay / results),
  when it applies (races only, Supercars only, has data), default column and order, and its phone tab. App and
  ReplayView render columns from it instead of by hand. The tower and the safety car banner aren't in the registry
  (fixed); the race feed is (above the tower by default, can be hidden or moved).
- **Layout state** in settings: `layout: { left: string[]; right: string[]; hidden: string[] }` per series (settings
  are already per series). New panels added later appear in their default place for viewers with a saved layout (merge:
  unknown ids go to their default slot). A new key name, not a reuse, so old saved settings can't fight the default.
- **A panel shell** (`Panel.tsx`): one header for every panel: title, a drag handle, and a ⋯ menu (Hide, Move to other
  column, Move up / down). Panels with their own options (map view, chart tabs) keep them in their own toolbar.
- **Drag and drop:** pointer events (not the HTML5 drag API: it doesn't work on touch) on the handle; a placeholder
  shows where the panel will land, within or across the two columns. Keyboard: the ⋯ menu's Move items. Phones: no
  drag; the settings list's arrows, and each panel's phone tab (Leaderboard | Map | Race | Charts) is a setting.
- **Settings drawer** grows sections: *Layout* (every panel with a show toggle, drag/arrows to reorder, which column,
  reset), *Leaderboard* (today's column list, simple mode, the new signals on/off: battles, net leader, undercuts),
  *Map* (view, corners, battles, landmarks, buildings, pit rejoin car), *Timing* (broadcast delay, time zone), *About*
  (data sources, what's an estimate). Controls bar keeps the quick ones (simple mode, delay).
- **Sticky left column:** it sticks to the bottom; a tall panel moved into it (charts) would make it long. Only allow
  the short ones there (feed, ladders, race control, pit log) or switch stickiness off when it's taller than the screen.

**Backlog** (each a branch and commit; check at 1600 px and 390 px):
1. Panel registry + shell, same layout as today (no behaviour change): every panel gets the header and a Hide action;
   hidden panels come back from settings. *Done when* the live page, replay and results look as before and each
   panel hides and returns.
2. Settings drawer sections (Layout, Leaderboard, Map, Timing, About) with Layout listing panels (toggle + arrows +
   column) and Reset. Move the existing column editor under Leaderboard.
3. Drag and drop on wide screens (pointer events, placeholder, both columns), saved to settings; keyboard Move items.
4. Phones: per-panel tab choice; the tab bar only shows tabs that have panels.
5. Toggles for the tower signals (battle brackets, net P1, undercut tags) and the race feed's two halves.
6. Replay and results pages use the same registry and layout (their own subset of panels).

## Map with a broadcast delay (13 Oct 2026)

Question: watching with a 20-40 s delay (a stream), is the map free of dots waiting at timing points or jumping
forward? By then the live feed already has each car's next crossing, so `knownPosition` can place it exactly.

**Supercars** (`tools/MapDelaySim/delay-sim.mts`, Race 30 through the replay endpoint, the app's own placement code at
60 frames a second, car-frames after a 60 s warm-up):

| window | delay | position known | > 100 m/s | backwards | stalled (green) |
|---|---|---|---|---|---|
| green, stops (15 min) | 0 s | 0 % | 1.4 % | 0 | 0.14 % → 0 |
| | 5 s | 31 % | 1.0 % | 0 | |
| | 20 s | 96.3 % | 0.04 % | 0 | 0.13 % → 0 |
| | 40 s | 100 % | 0.03 % | 0 | 0.13 % → 0 |
| safety car + restart (20 min) | 20 s | 93 % green, 72 % under the SC | 0.17 % | 0.07 % | car #1 only |
| | 40 s | 97 % green, 94 % under the SC | 0.07 % | 0.03 % | car #1 only |

(→ = after the fix below.) The only stalls were cars leaving the pits: their last crossing was the line, passed in the
pit lane ~70 s earlier, so they looked overdue and waited just short of point 1 until they crossed it (and with a
delay the 70 s "stretch" was over `knownPosition`'s 60 s limit). Fixed: `rejoined()` in `useCarPlacement.ts` starts the
stretch at Natsoft's pit-out time. Left: (a) the car now starts from the line, not the real pit exit, so it can run a
little fast to point 1 (the 0.03-0.07 % above); placing it from the pit lane's end would fix that. (b) Under a safety car
some stretches take longer than the delay, so ~6 % (40 s) to ~28 % (20 s) of positions are still `cautionPace`
estimates (smooth, no jumps). Car #1 really stopped on track (it caused the safety car).

**F1** (`tools/F1MapEval/evalmap.py`, 2025 Singapore GP race, scored against F1's real car positions from the archive;
configs "app, delay Ns" = the app's `F1_PACING`):

| delay | error (green) mean / p90 | frozen | speed off by > 25 m/s (per second) |
|---|---|---|---|
| 0 s | 21.5 / 55.3 m | 0.1 % | 7.6 % |
| 5 s | 20.0 / 47.4 m | 0.0 % | 5.1 % |
| 20 s | 20.0 / 47.3 m | 0.0 % | 5.1 % |
| 40 s | 20.0 / 47.4 m | 0.0 % | 5.1 % |

So F1 dots never wait at a mini-sector once there's a few seconds of delay, and the step at each crossing is 2.6 m.
What's left is speed wobble *between* crossings, not helped by more delay. Interpolating linearly in metres instead of
along the track's speed profile is worse (6.8 %). Smoothing each crossing's time with a straight-line fit through its
neighbours (real time vs the profile's simulated time, ±2 crossings, possible with a delay) halves it (2.4 %) but
puts dots further off (p90 47 → 69 m, bias -12 → -17 m): **backlog**, needs a decision on smooth vs accurate (and a
look at where the -12 m bias comes from).

## What commentators talk about (13 Oct 2026)

Auto-generated YouTube captions (yt-dlp `--write-auto-subs`, no video), read for what the broadcast talks about and
what it has to work out by hand. Supercars' official channel posts full races: 2024 Townsville 500 Race 13
(https://www.youtube.com/watch?v=6RgkMPGtsA4, read in full), 2025 Taupō Race 10 (V0uH-0u13xc) and the 2023 Bathurst
1000 (TnXjXkZPvAo), both scanned by theme. Formula 1's channel has no full races (other uploads are unofficial), so for
F1: the 2026 Singapore GP highlights (ohgEehLtucc) and the 2025 season's highlights compilation (IiaVcT3SZv0).
Captions only, kept out of the repo. Theme counts (Townsville / Bathurst 2023): tyres 116 / 224, pit stops and strategy
75 / 207, battles and pressure 71 / 117, gaps and margins 38 / 128, "fastest on track" 33 / 48, laps to go 33 / 77.

**What they keep reading out, often by hand (we have the data):**
- **Who was fastest on track last lap**, and where the leaders rank on pace ("the three at the front were only 16th,
  20th and 22nd fastest"). Repeated every few laps at Townsville. Built: "Fastest on track last lap" in the race feed.
  Not built: a pace-rank column (rank of each car's last lap).
- **The gap between the leaders lap by lap, and its trend** ("the elastic band"), plus **where on the lap each car is
  stronger** (one quicker through turns 8-10, giving it back in 12-13). Mini-sector times per car already exist: a
  Compare view of mini-sector deltas over the last few laps would show it directly.
- **Tyre age difference in a battle** ("a five-lap difference in tyre age"), F1 too (fresh softs vs worn mediums).
  Built: battles in the feed say "stint 18 vs 4 laps" (Supercars) or "tyres M 20 vs S 4" (F1) when 5+ laps apart.
- **The corrected order during the pit cycle.** At Townsville they read it out once ("the corrected order would be…")
  and promised to "crystallise those numbers as soon as we can"; at Bathurst, who is leading "on the road" vs in
  effect. We already estimate a stop's cost (pit/): a **net order** (each car's gap plus stops still owed × stop cost)
  would answer this continuously. Strongest gap found.
- **The spread across the top cars** ("6 seconds covers the top six"). Built: "Top N covered by X s" in the feed.
- **A third car catching a fight** ("Davidson could be the ultimate beneficiary"). Not built: a feed line when the car
  behind a battle is closing (we have both parts: battles and the interval trend).
- **Positions made since the grid** (the TV tower's green/red arrows) and **who is still to stop**. Already built.
- **Stewards' decisions** (penalty, investigation, "no further action"). Already in race control and the feed's log.
- **Laps to go and minimum co-driver laps** (Bathurst). Already built.

**What they guess at or can't see (gaps we could fill):**
- **Net order / virtual lead** during stops (above).
- **Pace in this stint vs the last** (they compare "the end of each stint" from memory): stint-by-stint median pace per
  car, from the lap history we already have.
- **Track change** (rain at Townsville: lap times jumped ~3 s across the field). A field-wide lap-time jump is easy to
  detect and could be a feed event ("lap times up 3 s across the field: conditions?").
- **Cheap stops under the safety car / VSC**: called out each time in F1. The feed lists who pitted under the caution;
  the pit ghost is paused then. An estimate of a caution stop's cost would need more measured caution stops.
- **Primary vs co-driver** (Bathurst: "only Randle is a primary driver in the top 10"): the tower has the markers; a
  count in the feed would be easy.

**Not measurable from the feed:** fuel loads and fuel windows (litres per stop, "can get to lap 142"), tyre compounds
and new vs used sets in Supercars, damage, radio. Leave these to the broadcast.

## Race feed: strategy insights (14 Oct 2026)

The owner asked for insights that go beyond numbers: undercuts (pit-adjusted position, what they gained) and other
timely information, from the full Natsoft data, race strategy and what commentators say. Built in
`src/web/src/strategyInsights.ts` (see CLAUDE.md, "Race feed"). Background: the undercut is the main way places change
at stops where old tyres have dropped off, the overcut (staying out) works when they haven't, and slow stops, traffic
and safety cars spoil both (https://www.gpfans.com/en/f1-news/1016512/f1-undercut-overcut-explained/ ,
https://www.formula1.com/en/latest/article/undercut-vs-overcut-why-tyre-strategy-was-so-finely-poised-in-monaco-and-why.1YYMDkEBnFols8bDWtSXiz ).

Measured by running the feed code over whole races (5 s steps; "% of updates" = how often an item is up):

| Item | Bathurst Race 30 | Gold Coast 2025 R28 | R29 | First version (Bathurst) |
|---|---|---|---|---|
| Undercut in progress | 21% | 0% | 7% | 65% (whole field) |
| Undercut results logged | 7 | 0 | 0 | 34 (whole field, any margin) |
| Stops logged | 72 | 20 | 23 | 107 (top 10) |
| Net order | 7% | 0% | 8% | 6% (29% at R28, wrong: cars with extra stops on top) |
| Traffic | 10% | 10% | 26% | 23% (59% at R29: top 5, 2 s) |
| Tyre fall-off | 8% | 12% | 19% | 41% at R28 |
| Conditions | 0 | 0 | 0 | 6 false alarms (restarts, an incident) |

Checks on what they said: Bathurst's net order during the stops named #17, #10 and #888 at the top, the cars that
finished 1-3 (#17, #888, #10); R29's named Feeney and Mostert (2nd and 1st). Hamilton "losing 5 s a lap" in the 2025
Singapore GP was his brake failure. Fixes found on the way: a car parked in the pits kept "moving" in the progress
estimate (P23 Murray topped the net order); the stop number the field is on now comes from the top 10 and recent
stops, not old extra stops further back (an early stopper keeps its net place: Wood net P9 from P23); Payne's 32.6 s
drive-through came up as the quickest stop. Known limit: the tower's undercut detection (unchanged) doesn't find
Mostert's undercut on Waters in the rebuilt R29 that the broadcast talked about (it finds Kostecki's on Payne).

**Caveats:** at the Gold Coast the stop cost estimate (63-75 s) looks too high: cars that stopped cheaply under a
caution came out ahead of leaders in the net order, yet Mostert stopped on lap 61 and stayed P1. The rebuilt races'
pit times are estimates too. Check against Race 31's real stops (CLAUDE.md, "Next round").

**More ideas, not built:**
- Pit windows: "due in ~N laps" from stint lengths so far (Bathurst: fuel; Gold Coast: 2 compulsory stops per race,
  window rules from the event's sporting supplement).
- Stint pace vs the car's last stint, and a pace rank per lap (who's fastest of the top 10 over the last 5 laps).
- Mini-sector strengths in a battle ("quicker through turns 8-10, gives it back in 12-13"): the data is there.
- Safety car winners and losers: who stopped under it and how many places it gained them, logged at the restart.
- After the flag: how the race was won (the stop that made the difference, laps led, the biggest gainer through the
  stops) on the results Summary and as the feed's last item.
- Finals: when a driver's live position moves them across the elimination cut (FinalsStandings has it).

## Ideas not built yet

From the Bathurst brainstorm (built: safety car mode, charts, battle graph, finals ladder, phone layout, regression
tests, results pages, replay):
- Pit windows: stint lengths so far → "due in ~N laps", stops remaining.
- From the commentary study above: pace rank per lap, mini-sector strengths in Compare, stint pace vs the last
  stint (built since: net order through the pit cycle, third car closing on a battle, a track-change alert).
- Follow a driver: a card with gaps ahead/behind, stint, pit window, penalties; optional browser notifications.
- Co-driver planner: the lap by which a driver must be in the car to reach the minimum.
- Pit stop leaderboard: fastest stops and team averages.
- Starting grid and championship standings from the feed/recordings instead of hand-entered data.
