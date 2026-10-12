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

## Ideas not built yet

From the Bathurst brainstorm (built: safety car mode, charts, battle graph, finals ladder, phone layout, regression
tests, results pages, replay):
- Pit windows: stint lengths so far → "due in ~N laps", stops remaining.
- Follow a driver: a card with gaps ahead/behind, stint, pit window, penalties; optional browser notifications.
- Co-driver planner: the lap by which a driver must be in the car to reach the minimum.
- Pit stop leaderboard: fastest stops and team averages.
- Starting grid and championship standings from the feed/recordings instead of hand-entered data.
