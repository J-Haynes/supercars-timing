# Natsoft live timing protocol (as observed)

Reverse-engineered from Natsoft's browser client and a capture of the 2026 Bathurst 1000 weekend
(Practice 5 plus the SuperUte Series Race 3 that followed it, 10 Oct 2026). Anything marked
*unconfirmed* is a best guess; update this file as more sessions are captured.

## Where it comes from

Supercars.com's "classic" live timing page embeds Natsoft's client in an iframe:
`https://server.natsoft.com.au:8080/LiveMeeting/V8SUPER`. That page opens a WebSocket to the same
path. The paid MySupercars+ features use a separate Firebase backend (`supercars-production`) and
are not covered here.

## Transport

- `wss://server.natsoft.com.au:8080/LiveMeeting/{meeting}`. Supercars weekends use `V8SUPER`.
- **A token, since the Gold Coast 500 (23 Oct 2026; Bathurst didn't need one).** The meeting page
  (`https://server.natsoft.com.au:8080/LiveMeeting/V8SUPER`) sets `var gsLiveToken="..."` (~300 chars, new on
  every load) and Natsoft's script opens the WebSocket as `.../LiveMeeting/V8SUPER?Token=<token>`. Without the
  token the server answers `<NotFound />` even while cars are on track (Practice 1 was missed until we fixed it).
  The token only works with the **same User-Agent** as the page request: same UA -> `<New>`, no UA on the
  WebSocket -> `<NotFound />` (tested one connection at a time). No cookies are involved. `NatsoftClient` loads the
  page for each new connection (keeping the token across a `<Redirect>`) and sends one User-Agent on both.
- Frames came as plain XML with the token at the Gold Coast (the decoder passes plain XML through).
- The browser sends an `Origin: https://server.natsoft.com.au:8080` header; the client never sends a message.
- The Gold Coast's track code is `SPSC` ("SURFERS PARADISE STREET CIRCUIT"); the map file is `SPSC` since Practice 1.
- **Gold Coast timing points** (Practice 1, 23 Oct 2026): 7 points, `Pos1`, `Pos2`, `Int1`, `Pos3`, `Pos4`, `Int2`, `Pos5`
  (IDs 1-7, `PI1="3" PI2="6"`), rebuilt map: 544, 688, 896, 1216, 1774, 2036, 2755 m of 2985 m. Speed trap `SP` was 0 all
  session (no trap). **Pits:** the pit lane crosses the control line, so a stop starts with the line crossing itself
  (`LP="M"` and `P="Y" PF="P"` in one message); `P="N"` comes from inside the pit lane, a median 10.3 s before the car
  reaches Pos1 (15 stops, 9.0-10.8 s; a flying lap takes 9.1 s from the line to Pos1), and no point is crossed in between.
- On connect the server sends a full snapshot (`<New>`), then incremental updates.
- `<NotFound />` = the meeting isn't live. The browser client waits and retries; we retry every 30 s.
- `<Redirect URL="..." />` = reconnect to that URL.
- **A connection can stall without closing.** Gold Coast, Race 32 Q1 (25 Oct 2026): nothing at all (not even the
  1 s clock `<C>`) from 12:23:40 to a manual reconnect at 12:27:40, the socket still open; a red flag came and went
  in that time, and the snapshot on reconnecting only had the current flag (Green). While a session runs Natsoft sends
  every second (longest gap in our recordings under Green/Yellow/Red: 11 s; under the Bathurst Practice 6 red
  flag 264 messages in 2 minutes), so `NatsoftClient.StallTimeout` (30 s, only while the last flag is Green, Yellow
  or Red) drops and reconnects. Between sessions minutes of silence are normal.
- Latency from Natsoft timestamp to receipt is about 0.02 s.
- **The meeting follows the track, not the category.** Support categories (e.g. SuperUtes) run on the
  same `V8SUPER` feed, each session starting with its own `<New>` snapshot.

## Frame encoding

Frames starting with `<` are plain XML. Otherwise each character is XORed with the previous
*decoded* character (seed `0x7F`), and decoded values 22–31 expand to XML fragments:

| Code | Expands to | Code | Expands to |
|---|---|---|---|
| 22 | `><` | 27 | `" /><` |
| 23 | ` T="` | 28 | `"><` |
| 24 | `="0.0000" ` | 29 | `" />` |
| 25 | `="0" ` | 30 | `="` |
| 26 | `="" ` | 31 | `" ` |

Implemented in `src/SupercarsTiming.Natsoft/NatsoftDecoder.cs`.

## Timestamps

Every root element has `T` in seconds, but it is the **track's local wall clock encoded as if it
were UTC**: AEDT at Bathurst means Unix time + 39600. Treat it as a session clock, or subtract the
track's UTC offset to get real Unix time.

### Estimated timing point positions

Natsoft doesn't say where timing points are. `tools/TrackBuilder` estimates them from measured pace and a lap
simulation. Bathurst (from Practice 5), in metres from the Finish Line, on a 6,196 m OSM centreline:

| Point | Name | Distance | Near |
|---|---|---|---|
| M | Control line | 0 | Finish Line, Pit Straight |
| 1 | Pos1 | 548 | Start of Mountain Straight, after Hell Corner |
| 2 | Pos2 | 1,478 | Approaching Griffins Bend |
| 3 | Int1 | 2,522 | Reid Park |
| 4 | Pos3 | 3,332 | Brock's Skyline |
| 5 | Int2 | 3,963 | Exit of Forrest's Elbow |
| 6 | Pos4 | 5,049 | Mid-Conrod Straight (speed trap, `SP` arrives just after) |
| 7 | Pos5 | 5,800 | Between The Chase and Murray's Corner |

## Message types

Counts are from Practice 5 (63 minutes, 8,844 messages).

| Root | Count | Meaning |
|---|---|---|
| `L` | 5,287 | Leaderboard. `Y="f"` full, `Y="p"` partial. A `<P>` per car, each with an optional `<D>` of changed fields |
| `C` | 3,488 | Session clock, about once a second. `C` = seconds remaining, `E` = elapsed, `Y="T"` = timed session. `Y="L"` = lap race: `C` = **laps** remaining, `E` = laps done (Bathurst 1000: `C="161" E="0"` before the start) |
| `A` | 52 | Session best: `I` lap, `C` car, `I1`/`I2` intermediates, `S1`–`S3` sectors |
| `H` | 10 | Heartbeat |
| `S` | 3 | Session status: `S` = flag, `E` = session code, `I` = time of the change (the green flag time = race start) |
| `F` | 2 | Flag echo (`S` = Green / Yellow / Checkered / End) |
| `G` | 3 | **Race control messages.** `R` = the text, `C` = empty so far. Bathurst 1000, 11 Oct 2026: `Race Control: Turn 19.2 Incident Cars 19 & 48 noted`, `Stewards: Turn 19.2 Incident under investigation Cars 19 & 48`, `Stewards: Penalty Car 19 - 5 seconds - driving infringement`. Free text only: no penalty field, and time penalties don't change the car's timing data. Nothing is sent when a penalty is served |
| `New` | 1 | Full snapshot, sent per session |

Session types seen in `<E Y>`: `Practice`, `Race`, and `OverrideQual` for the Bathurst Top Ten Shootout
(`D="2026 Repco Supercars Championship - Top Ten Shootout Race 30"`). In the Shootout, cars appear in the
leaderboard as they come out rather than all at once.

Flags seen in `S`: `WaitStart`, `Green`, `Yellow`, `Red`, `Checkered`, `Ended`. **At a race start Natsoft re-sends the session**: Gold Coast Race 31 (24 Oct 2026, started behind the safety car) sent a fresh `<New>` of the same session at the start, then `<S S="Yellow">`, then the cars in `<L Y="f">`; another `<New>` came at 05:27 mid-race. Natsoft sends no grid positions: the official order (`<P L>`) while `WaitStart` is the grid with grid penalties applied (#888's two-place penalty was in it); `TimingState.TakeGrid` keeps it as each car's `GridPosition`. `Yellow` and `Red` were seen in support races on 10 Oct; the session flag is the only safety car / full-course yellow signal found so far.

## Snapshot (`<New>`) children

- `M`: meeting. `D` = name, `Y` = category.
- `T`: track. `C` = code, `N` = name, `P` = number of timing points, `I` = number of intermediates,
  `PI1`/`PI2` = which timing points the exact intermediate times `I1`/`I2` are measured at (Bathurst: 3 and 5). `<TP ID Y>` lists timing points in lap order.
  Bathurst: `1=Pos1, 2=Pos2, 3=Int1, 4=Pos3, 5=Int2, 6=Pos4, 7=Pos5`. The control line is `M`, so a
  lap is M → 1 → … → 7 → M: 8 crossings per lap, 15–25 s apart at Bathurst.
- `E`: session. `C` = code (e.g. `P12`), `D` = name, `Y` = type (`Practice`, `Race`), `RI`/`RC`/`RV`/`RY` = lap record
  time / driver / car / session type (Bathurst 1000: `126.7265`, William Brown, Chev Camaro ZL1, Race). `RD` looks like a
  day number (739901 = days since 0001-01-01, i.e. a 2026 date). `<O>` repeats the record for the meeting.
  `L` = scheduled laps: `161` for the Bathurst 1000 (Race 30, 11 Oct 2026), `1` for the Top Ten Shootout, `0` for
  timed races (`<C Y="T">`).
- `OL`: other categories at the meeting.
- `RL`: entry list. `<R ID N V>` = Natsoft's internal car ID, car number, vehicle. `<V ID N>` = drivers; `_` stands for a space in surnames.
  Driver `ID="1"` is the primary (full-time) driver and `2` the co-driver in every Bathurst 2026 entry; `B` matched `ID`.

## Per-car fields (`<L><P><D>`)

`<P>` attributes: `L` = position, `C` = **internal car ID (R ID), not the car number**, `D` = driver index (`1`/`2`).
`LP` (and `LL`, same value so far) = **road position at the last timing point**. `L` (official) only changes at the
control line; `LP` changes at every timing point, including passes mid-lap and pitting cars dropping as the field
passes the pit lane (Bathurst 1000, car 9's stop: `LP` 18 -> 24 within 32 s, `L` stayed 18 for ~130 s). `P` = `L`.
`LGI`/`LGNI` (per-car `<D>`) are ordered by `LP`, not `L`: 44 inversions in 6,342 pairs sorted by `LP` vs 247 by `L`.

`<D>` attributes. Partials only include fields that changed.

| Attr | Meaning |
|---|---|
| `LP` | **Last timing point passed** (`M`, `1`–`7`). The most frequent update and the basis for a track map. In a `<New>` snapshot it says where each car is but not when it crossed, so the car's next stretch can't be timed from it |
| `L` | Laps completed |
| `I` | Last lap time (s) |
| `T` | Timestamp of the last control-line crossing |
| `I1`, `I2` | Intermediate times from lap start |
| `S1`–`S3` | Sector times for the current lap; later sectors reset to 0 when S1 arrives |
| `SP` | Speed trap km/h. Sent as `0` then the value, after TP6 at Bathurst |
| `FI`, `FL`, `FT` | Best lap time, lap number, timestamp |
| `F1`, `F2`, `FS1`–`FS3` | Best intermediates and sectors |
| `GI`, `GL` | Gap to leader (time / laps). Practice: gap to fastest lap |
| `GNI`, `GNL` | Interval to car ahead (time / laps) |
| `LGI`, `LGL` | *Unconfirmed.* Updates more often than `GI` in races, but is frequently out of order with positions (up to 7 inversions in a 21-car field in the SuperUte race, vs 0–1 for `GI`). Use `GI` |
| `LGNI`, `LGNL` | *Unconfirmed.* Companion of `LGI` |
| `P` | `Y` = in pit lane, `N` = out. Sent in matching pairs at Bathurst (98 of each in Practice 5, 145 in Practice 6). Points crossed while `Y` include pit-lane lines, so don't time stretches from them |
| `PS` | Pit stop count |
| `LCD` | **Laps by the current driver** this session. Cumulative per driver: after swapping back it resumes from that driver's earlier total (Practice 6, car 10: driver 2 back in at lap 12 with `LCD=3`). Sent in snapshots too |
| `LDC` | Lap of the last driver change; `0` before any |
| `LLP` | Lap of the last pit entry |
| `PI`, `PT`, `PF` | Pit stops. Entering: `P="Y" PF="P" PI=<pit-in time>`. Leaving: `P="N" PF="T" PI="0" PT=<seconds in pit lane>` (support races, 10 Oct: 32–91 s; a red-flag stop gave 684 s) |
| `LL` | Last line: `1`, `2` (intermediates), `M` (control line) |
| `SC` | *Unconfirmed:* `Y`/`N` per car. **Not the safety car:** it's `Y` for one car at a time under green (support races, 10 Oct). Use the session flag for safety car / full-course yellow |
| `GL`, `GNL` | Can be `?` before a gap in laps is known |
| `FT` | Time the best lap was set |
| `PN` | `0` -> `1` once per car at its first line crossing in the race; meaning unclear |
| `I="?"` | **Lap time withheld.** At the line, with `S3="?"` (and `I1`/`I2`/`S1`/`S2` if not reached). On a lap that isn't an in- or out-lap it's a **deleted lap**: Gold Coast 2026, 21 of 210 laps in Supercars Practice 1 and 10 of 101 in SuperUte qualifying, complete laps through all 7 points at full pace (#19 lap 11: 77.5 s), i.e. kerb hops / chicane cuts, which delete the lap in practice and qualifying. At Bathurst `?` came almost only on in- and out-laps (≤ 0.7 % of other laps). Natsoft sends nothing else about it (no race control text). **Three forms** (Gold Coast Practice 2/Qualifying, Shootout, 24 Oct 2026): `I="?"` at the line; only `S3="?"` at the line with **no `I` at all** (the lap still counts up); or `I1`/`I2`="?" mid-lap as soon as the lap is deleted, usually followed by `I="?"` at the line, sometimes by the car pitting before the line (#2 Wood, Top Ten Shootout: `I2="?"` at Int2, then `P="Y"`, no lap time ever sent). Deleted laps run at full pace (qualifying: median 71.9 s line to line vs 72.4 s timed). A **red flag** also sends `?` for every lap in progress (Bathurst Practice 6, ~20 cars): not deletions. `TimingState` marks a lap deleted at its first `?` on a flying lap outside a red flag (`CurrentLapDeleted`, counted once), sets `LastLap` and those sectors to 0 and `LastLapDeleted` |
| `TY`, `TSL`, `SN`, `LT`, `FTY` | Not yet identified (constant in the Bathurst 1000; `FTY="S"` when a best lap is set). `TY` isn't the tyre: at the Gold Coast it went `S` -> `W` for two cars after the chequered flag, on track |

## Open questions

- What `LGI`/`LGNI` actually represent (gap at the last timing point crossed?).
- Safety car and red flag representation (`S` values, `SC` field).
- Driver changes mid-race (`D` index switching).
- Qualifying session type (not yet seen; the 2026 timetable names sessions "Qualifying (Race 31)").
- **No per-car "finished" (took the chequered flag) field is known.** `TY`, `TSL`, `SN`, `LT`, `FTY` and `PN` are
  unidentified: check a recording of a practice or qualifying chequered flag for any of them changing as cars cross
  the line. Until then the app works it out from each car's line crossing time `T` vs the flag's change time.
