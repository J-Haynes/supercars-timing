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
- No auth. The browser sends an `Origin: https://server.natsoft.com.au:8080` header; the client never sends a message.
- On connect the server sends a full snapshot (`<New>`), then incremental updates.
- `<NotFound />` = the meeting isn't live. The browser client waits and retries; we retry every 30 s.
- `<Redirect URL="..." />` = reconnect to that URL.
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

Flags seen in `S`: `WaitStart`, `Green`, `Yellow`, `Red`, `Checkered`, `Ended`. `Yellow` and `Red` were seen in support races on 10 Oct; the session flag is the only safety car / full-course yellow signal found so far.

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
| `TY`, `TSL`, `SN`, `LT`, `FTY` | Not yet identified (constant in the Bathurst 1000 so far; `FTY="S"` when a best lap is set) |

## Open questions

- What `LGI`/`LGNI` actually represent (gap at the last timing point crossed?).
- Safety car and red flag representation (`S` values, `SC` field).
- Driver changes mid-race (`D` index switching).
- Qualifying session type (not yet seen).
