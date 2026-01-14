#!/usr/bin/env bash
set -euo pipefail

BASE="http://localhost:3001"

# ---------- 1) MusicXML test (2-staff piano, should parse staff 1+2) ----------
MUSICXML='<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>480</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>C</step><octave>3</octave></pitch><duration>480</duration><voice>2</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>D</step><octave>3</octave></pitch><duration>480</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure></part></score-partwise>'

echo "=== PARSE ==="
PARSE_PAYLOAD=$(jq -nc --arg musicxml "$MUSICXML" '{musicxml:$musicxml}')

PARSED=$(curl -sS -X POST "$BASE/parse" \
  -H "Content-Type: application/json" \
  -d "$PARSE_PAYLOAD")

# If PARSE is not JSON, show it and stop
if ! echo "$PARSED" | jq -e . >/dev/null 2>&1; then
  echo "RAW /parse (not JSON):"
  echo "$PARSED" | head -n 40
  exit 1
fi

echo "$PARSED" | jq '{ok, score_id: .scoreModel.score_id, parts: (.scoreModel.parts|length)}'

SCORE=$(echo "$PARSED" | jq -c '.scoreModel')

echo "=== VALIDATE (BEFORE) ==="
VAL_BEFORE_PAYLOAD=$(jq -nc --argjson scoreModel "$SCORE" '{scoreModel:$scoreModel}')

VAL_BEFORE=$(curl -sS -X POST "$BASE/validate_scoremodel" \
  -H "Content-Type: application/json" \
  -d "$VAL_BEFORE_PAYLOAD")

if ! echo "$VAL_BEFORE" | jq -e . >/dev/null 2>&1; then
  echo "RAW /validate_scoremodel (not JSON):"
  echo "$VAL_BEFORE" | head -n 40
  exit 1
fi

echo "$VAL_BEFORE" | jq

ISSUES=$(echo "$VAL_BEFORE" | jq -c '.issues')

echo "=== REPAIR ==="
REPAIR_PAYLOAD=$(jq -nc --argjson scoreModel "$SCORE" --argjson issues "$ISSUES" '{scoreModel:$scoreModel, issues:$issues}')

REPAIRED=$(curl -sS -X POST "$BASE/repair_scoremodel" \
  -H "Content-Type: application/json" \
  -d "$REPAIR_PAYLOAD")

if ! echo "$REPAIRED" | jq -e . >/dev/null 2>&1; then
  echo "RAW /repair_scoremodel (not JSON):"
  echo "$REPAIRED" | head -n 40
  exit 1
fi

echo "$REPAIRED" | jq '.applied'

NEW_SCORE=$(echo "$REPAIRED" | jq -c '.scoreModel')

echo "=== VALIDATE (AFTER) ==="
VAL_AFTER_PAYLOAD=$(jq -nc --argjson scoreModel "$NEW_SCORE" '{scoreModel:$scoreModel}')

VAL_AFTER=$(curl -sS -X POST "$BASE/validate_scoremodel" \
  -H "Content-Type: application/json" \
  -d "$VAL_AFTER_PAYLOAD")

if ! echo "$VAL_AFTER" | jq -e . >/dev/null 2>&1; then
  echo "RAW /validate_scoremodel AFTER (not JSON):"
  echo "$VAL_AFTER" | head -n 40
  exit 1
fi

echo "$VAL_AFTER" | jq

echo "=== EXPORT MUSICXML (AFTER) ==="
EXPORT_PAYLOAD=$(jq -nc --argjson scoreModel "$NEW_SCORE" '{scoreModel:$scoreModel}')

# /export_musicxml returns raw XML (not JSON). Save it directly.
curl -sS -X POST "$BASE/export_musicxml" \
  -H "Content-Type: application/json" \
  -d "$EXPORT_PAYLOAD" > out_repaired.musicxml

echo "Saved: $(pwd)/out_repaired.musicxml"
ls -la out_repaired.musicxml