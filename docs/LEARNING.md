# Learning log

What the owner can explain about this project without opening the code. The `learn` skill
(`.claude/skills/learn/SKILL.md`) reads this before feature work and study sessions, and updates it afterwards.
One dated line per concept, in the owner's words where possible. Move lines between sections as things change.

## Can explain

- (2026-10-28) What the app shows: a timing tower with animated position changes and battles, and a 3D map built from
  OpenStreetMap with cars animated between timing points.

## Shaky

- (2026-10-28) The feed is a **WebSocket** that our client opens; Natsoft then pushes a full `<New>` snapshot followed
  by small updates, and the client never sends anything. (Described it as a "webhook" on 28 Oct: a webhook is the
  provider calling our URL, the opposite direction.)
- (2026-10-28) Why the map has to interpolate: Natsoft only reports when a car crosses one of a handful of timing
  points per lap, so each car moves at its own recent pace, slows for corners, and is paced differently under a
  safety car.

## Not yet

- (2026-10-28) How `NatsoftDecoder.cs` turns a frame into XML (XOR chain, seed `0x7F`, codes 22-31).
- (2026-10-28) Connecting: the page token and matching User-Agent, `<NotFound />` and `<Redirect />`, the stall
  timeout and the network-change reconnect in `NatsoftClient.cs`.
- (2026-10-28) The .NET server and SignalR: how a snapshot gets from `TimingState` to the React app.
- (2026-10-28) Recording and replay: what goes into `data/recordings/*.jsonl` and how `SessionReplay` plays it back.
- (2026-10-28) The two Gold Coast incidents in `docs/PROTOCOL.md` (token, stalled socket), told as interview stories.
