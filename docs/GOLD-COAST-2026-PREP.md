# Gold Coast 500, 23-25 Oct 2026: preparation

What last year's two races (2025, Races 28 and 29, both 85 laps) tell us about this year's, and what to check in the
app. Written 13 Oct 2026 from:

- **Timing data:** Natsoft's "Sector and Lap Times" reports for both races (`data/recordings/natsoft-results/`),
  rebuilt into replayable sessions with `tools/HistoricalRace` (menu → Past seasons → 2025 Boost Mobile Gold Coast
  500; tagged "rebuilt": lap 1 for cars off the lead lap, pit-lane times and safety car times are estimates).
- **Results:** https://en.wikipedia.org/wiki/2025_Gold_Coast_500 (citing Supercars' results pages R6 and R12), checked
  against the reports; the replays reproduce the on-road finishing order and lead-lap gaps exactly.
- **Commentary:** Supercars' official extended highlights, captions only: Race 28
  (https://www.youtube.com/watch?v=7R3VddAz7F0) and Race 29 (https://www.youtube.com/watch?v=OXRg9l2UCdU).

## What happened in 2025

**Race 28 (Saturday, Mostert won from 4th on the grid; Feeney 2nd, Allen 3rd from 12th).** Wood led from pole until a
fuel leak brought a mechanical black flag (he lost ~13 minutes in the garage). Three safety cars in the first 30 laps:
signage off the debris fence (laps ~13-16), then a heavy crash for Evans and Murray at the beach chicane (laps ~19-23),
then a tyre barrier (laps ~26-29). Under the first one **every front-runner stopped on lap 12** and the pit lane jammed:
the Gold Coast pit bays are small and teams double-stack, and Payne got a 15 s penalty for an unsafe release after
contact with Mostert, Waters and Courtney. The second stops came under green, laps 45-61, and the winner stopped last of
the front group (lap 61). Mostert won the race with passes into turn 11. Several track-limits penalties and warnings
(turns 8 and 10, the chicanes). De Pasquale crossed 6th and was classified 8th after a 5 s post-race penalty.

**Race 29 (Sunday, Mostert again, from 3rd; Feeney 2nd from pole, Heimgartner 3rd).** Contact at the first chicane on
lap 1 (Randle and Feeney; Davison in the wall; Fullwood got a drive-through). Wood and Kostecki stopped on lap 5 to get
clear air; the leaders' first stops were laps 23-28 and second stops laps 52-66, all under green. Commentators were
caught out by Mostert's second stop, calling it a big undercut on Waters that their numbers hadn't predicted; the data
shows Waters was ~8 s behind on the road when Mostert pitted, so Mostert simply kept the lead. One late safety car (laps
~79-81) after De Pasquale pushed Courtney into the tyres at turn 11 (15 s post-race penalty: 9th on the road, 16th
classified). The restart gave a last-lap fight: Feeney dived at Mostert, Heimgartner and Payne nearly got by.

## Numbers to expect

| | Race 28 | Race 29 |
|---|---|---|
| Race time | 1:53:27 (3 safety cars) | 1:43:39 (1 safety car) |
| Green lap, front-runners (median) | 1:09.6-1:10.4 | 1:09.7-1:10.1 |
| Fastest lap | 1:08.826 (Mostert) | 1:08.901 (De Pasquale) |
| Best sectors (S1 / S2 / S3) | 19.795 / 22.832 / 26.021 | 19.733 / 22.897 / 25.899 |
| Stops (front-runners) | 2: lap 12 (under SC) and laps 45-61 | 2: laps 23-37 and 52-66 |
| Safety car lap | ~2:10-2:17 | ~2:10-2:15 |

The front-runners' green pace was within ~0.2 s a lap of each other: stop timing, pit lane execution and track position
decided both races. 85 laps is ~1 h 40 min without cautions.

## What the commentary leaned on (and what the app can do better)

- **Pit lane chaos under the safety car** (double-stacking, unsafe releases): the race feed lists "pitted under
  caution"; the pit log and race control show the penalties. Nothing new needed; watch that "pitted under caution" with
  20+ cars stays readable (it lists names).
- **Undercuts and "where will he come out":** they got Race 29's wrong. The tower's undercut tags and the pit rejoin
  ghost answer this from data. These are the weekend's main thing to watch in the app (below).
- **Track limits and penalties** (turns 8 and 10): race control and the feed's log. Penalties applied after the race
  aren't in the feed; the classification won't show them (as with De Pasquale both days).
- **Restarts:** the races were decided after restarts (Race 28 three times, Race 29 on the last laps). The map and feed
  now stay quiet about battles for 2 laps after a restart (they'd have flagged the whole field).

## In the app, during the weekend

Existing checklist (CLAUDE.md, "Next round"), plus:

1. **Practice 1 (done, 23 Oct):** Natsoft's code is `SPSC` (not `SURF`): map rebuilt from the recording and renamed, as
   were the pit-loss figures. The live feed has 7 timing points (Pos1, Pos2, Int1, Pos3, Pos4, Int2, Pos5); the rebuilt
   2025 races have the two sector lines, now with the live IDs (3 and 6).
2. **Race 31 (Saturday):** watch the undercut tags and "net P1" in the first stop window (laps ~20-35 in a green race,
   or everyone under the first safety car). Note any tag that's clearly wrong, with the lap: they're tuned on Bathurst's
   long fuel stops and the rebuilt 2025 races, whose pit times are estimates.
3. **Pit rejoin ghost:** its Gold Coast stop cost is 2025's. Check the card switches to "this race" once 5 stops of a
   number are in (likely only under green, so maybe not on Saturday if the first stops come under a safety car).
4. **After the weekend:** run `tools/PitLoss/backtest.mts` on both races and update `PRIORS`; compare the live races
   with the rebuilt 2025 ones (`tools/HistoricalRace`) to see how good the rebuild was.
