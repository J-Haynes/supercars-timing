#!/usr/bin/env bash
# A second server on http://localhost:5081 that replays recorded races, to watch and tune the pit rejoin ghost (and
# anything else) between race weekends. It never contacts Natsoft or F1, and doesn't record: Supercars replays the
# Bathurst 1000 (Race 30), F1 replays an archived race downloaded from F1's live timing archive.
#
#   tools/PitLoss/demo-server.sh [F1 archive folder] [minutes to skip] [speed]
#   then open http://localhost:5081/ (Supercars) or http://localhost:5081/f1, pick a car in the map's "Pit rejoin" menu
#
# Default F1 race: the 2025 Singapore GP in data/recordings/f1-archive/ (download the topics listed in F1Client.Topics
# from livetiming.formula1.com/static/2025/2025-10-05_Singapore_Grand_Prix/2025-10-05_Race/<Topic>.jsonStream).
# The live service on :5080 keeps running; this is separate. Stop it with Ctrl+C.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHIVE="${1:-$ROOT/data/recordings/f1-archive/61-2025-10-05_Singapore_Grand_Prix-race}"
SKIP="${2:-75}"   # minutes into the archive: ~20 laps into the Singapore race, around the first stops
SPEED="${3:-2}"
dotnet build "$ROOT/src/SupercarsTiming.Server" -c Release -v quiet >/dev/null
exec dotnet "$ROOT/src/SupercarsTiming.Server/bin/Release/net10.0/SupercarsTiming.Server.dll" \
  --urls http://localhost:5081 --contentRoot "$ROOT/src/SupercarsTiming.Server" \
  --Feed:Mode=Replay --Feed:ReplaySpeed="$SPEED" --Feed:RecordDirectory= \
  --Feed:ReplayFile="$ROOT/data/recordings/V8SUPER_20261011_094535.jsonl" \
  --F1:Mode=Replay --F1:ReplayArchive="$ARCHIVE" --F1:ReplaySpeed="$SPEED" --F1:ReplaySkipMinutes="$SKIP" --F1:RecordDirectory=
