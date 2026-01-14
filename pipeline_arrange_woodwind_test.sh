#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

API="http://localhost:3001"
IN_XML="$ROOT_DIR/in.musicxml"
OUT_XML="$ROOT_DIR/out_arranged_woodwinds.musicxml"

echo "=== HEALTH ==="
curl -s "$API/health" | jq .
echo

echo "=== LOAD INPUT MUSICXML ==="
if [ ! -f "$IN_XML" ]; then
  echo "Missing: $IN_XML"
  echo "Put your source MusicXML in: $IN_XML"
  exit 1
fi

BYTES=$(wc -c < "$IN_XML" | tr -d ' ')
echo "Loaded in.musicxml bytes: $BYTES"
if [ "$BYTES" -lt 500 ]; then
  echo "Warning: in.musicxml is very small. It may be incomplete/truncated."
fi
echo

MUSICXML=$(cat "$IN_XML")

echo "=== ARRANGE (WOODWINDS) ==="
ARR_PAYLOAD=$(jq -nc --arg musicxml "$MUSICXML" \
  '{musicxml:$musicxml, intent:"instrumentation_only", target:{ensemble:"woodwind_ensemble", spacing:"open_classical"}}')

RESP=$(curl -s -X POST "$API/arrange" -H "Content-Type: application/json" -d "$ARR_PAYLOAD")
echo "RAW /arrange response:"
echo "$RESP"
echo

OK=$(echo "$RESP" | jq -r '.ok // false')
if [ "$OK" != "true" ]; then
  echo
  echo "Arrange failed:"
  echo "$RESP" | jq . || true
  exit 1
fi

echo "$RESP" | jq '{ok, ensemble: .scoreModel.meta.ensemble, partCount: (.scoreModel.parts|length), partIds: [.scoreModel.parts[].part_id]}'
echo

echo "=== EXPORT MUSICXML (WOODWINDS) ==="
EXPORT_PAYLOAD=$(echo "$RESP" | jq -c '{scoreModel:.scoreModel}')
curl -s -X POST "$API/export_musicxml" -H "Content-Type: application/json" -d "$EXPORT_PAYLOAD" > "$OUT_XML"

echo "Saved: $OUT_XML"
ls -la "$OUT_XML"
echo

echo "=== CONFIRM MULTI-PART IN EXPORTED FILE ==="
echo "score-part count:"
grep -o '<score-part ' "$OUT_XML" | wc -l
echo "part id count:"
grep -o '<part id=' "$OUT_XML" | wc -l
echo

echo "=== TRANSPOSE TAGS (if any) ==="
grep -n "<transpose>" -n "$OUT_XML" | head -n 20 || true
echo

echo "=== KEY TAGS (first measure attributes) ==="
grep -n "<key>" -n "$OUT_XML" | head -n 20 || true
echo

echo "=== OPEN IN MUSESCORE (optional) ==="
echo "open -a \"MuseScore 4\" \"$OUT_XML\""