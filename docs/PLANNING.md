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
- **Estimating from the map doesn't work well enough:** pit lanes drawn in our track files are 461 m (SURF) to 744 m
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
  don't settle our guessed `SURF`/`SAND`/`ADEL` codes (the map loader falls back to names anyway).
- F1: `tools/PitLoss/f1_archive.py <year>` downloads PitStopSeries and TimingData for each circuit we have a map for
  (cached in `data/recordings/f1-archive/`) and prints the table above.

## Ideas not built yet

From the Bathurst brainstorm (built: safety car mode, charts, battle graph, finals ladder, phone layout, regression
tests, results pages, replay):
- Pit windows: stint lengths so far → "due in ~N laps", stops remaining.
- Follow a driver: a card with gaps ahead/behind, stint, pit window, penalties; optional browser notifications.
- Co-driver planner: the lap by which a driver must be in the car to reach the minimum.
- Pit stop leaderboard: fastest stops and team averages.
- Starting grid and championship standings from the feed/recordings instead of hand-entered data.
