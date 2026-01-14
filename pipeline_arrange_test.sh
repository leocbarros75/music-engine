#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://localhost:3001"

# --- Minimal MusicXML input (piano) ---
MUSICXML='<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>480</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>C</step><octave>3</octave></pitch><duration>480</duration><voice>2</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>D</step><octave>3</octave></pitch><duration>480</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure></part></score-partwise>'

echo "=== PARSE ==="
PARSE_PAYLOAD=$(jq -nc --arg musicxml "$MUSICXML" '{musicxml:$musicxml}')
PARSED=$(curl -s -X POST "$BASE_URL/parse" -H "Content-Type: application/json" -d "$PARSE_PAYLOAD")

echo "$PARSED" | jq -e . >/dev/null
echo "$PARSED" | jq -c "{ok, score_id: .scoreModel.score_id, parts: (.scoreModel.parts|length)}"

SCORE=$(echo "$PARSED" | jq -c '.scoreModel')

echo
echo "=== ARRANGE (full_orchestra) ==="
ARR_PAYLOAD=$(jq -nc \
  --arg mode "new_arrangement" \
  --arg target_ensemble "full_orchestra" \
  --arg musicxml "$MUSICXML" \
  '{mode:$mode, target_ensemble:$target_ensemble, musicxml:$musicxml}')

ARR_RESP=$(curl -s -X POST "$BASE_URL/arrange" -H "Content-Type: application/json" -d "$ARR_PAYLOAD")
echo "$ARR_RESP" | jq -e . >/dev/null

# OUT_ARRANGE = arranged scoreModel (THIS is what we export)
OUT_ARRANGE=$(echo "$ARR_RESP" | jq -c '.scoreModel')

echo "$ARR_RESP" | jq -c '{ok, arranged_parts: (.scoreModel.parts|length), part_ids: (.scoreModel.parts|map(.part_id))}'

echo
echo "=== VALIDATE (ARRANGED) ==="
VAL_OUT_PAYLOAD=$(jq -nc --argjson scoreModel "$OUT_ARRANGE" '{scoreModel:$scoreModel}')
VAL_OUT=$(curl -s -X POST "$BASE_URL/validate_scoremodel" -H "Content-Type: application/json" -d "$VAL_OUT_PAYLOAD")
echo "$VAL_OUT" | jq

echo
echo "=== EXPORT MUSICXML (ARRANGED) ==="
EXPORT_PAYLOAD=$(jq -nc --argjson scoreModel "$OUT_ARRANGE" '{scoreModel:$scoreModel}')
EXPORTED=$(curl -s -X POST "$BASE_URL/export_musicxml" -H "Content-Type: application/json" -d "$EXPORT_PAYLOAD")

# Handle both JSON or raw-XML responses
if echo "$EXPORTED" | jq -e . >/dev/null 2>&1; then
  echo "$EXPORTED" | jq -r '.musicxml' > out_arranged.musicxml
else
  printf "%s" "$EXPORTED" > out_arranged.musicxml
fi

echo "Saved: $(pwd)/out_arranged.musicxml"
ls -la out_arranged.musicxml

echo
echo "=== CONFIRM MULTI-PART IN EXPORTED FILE ==="
echo "score-part count:"
grep -n "<score-part " -n out_arranged.musicxml | wc -l
echo "part id count:"
grep -n "<part id=" -n out_arranged.musicxml | wc -l

echo
echo "=== OPEN IN MUSESCORE (optional) ==="
echo "open -a \"MuseScore 4\" \"$(pwd)/out_arranged.musicxml\""