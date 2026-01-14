#!/usr/bin/env bash
set -euo pipefail

IN="${1:-}"
if [ -z "$IN" ]; then
  echo "Usage: ./run_musicxml_file_pipeline.sh /full/path/to/input.musicxml"
  exit 1
fi

if [ ! -f "$IN" ]; then
  echo "File not found: $IN"
  exit 1
fi

echo "=== INPUT FILE ==="
echo "$IN"

MUSICXML=$(cat "$IN")

echo "=== PARSE ==="
PARSE_PAYLOAD=$(jq -nc --arg musicxml "$MUSICXML" '{musicxml:$musicxml}')
PARSED=$(curl -s -X POST http://localhost:3001/parse -H "Content-Type: application/json" -d "$PARSE_PAYLOAD")
echo "$PARSED" | jq -e . >/dev/null

SCORE=$(echo "$PARSED" | jq -c '.scoreModel')

echo "=== VALIDATE (BEFORE) ==="
VAL_BEFORE_PAYLOAD=$(jq -nc --argjson scoreModel "$SCORE" '{scoreModel:$scoreModel}')
VAL_BEFORE=$(curl -s -X POST http://localhost:3001/validate_scoremodel -H "Content-Type: application/json" -d "$VAL_BEFORE_PAYLOAD")
echo "$VAL_BEFORE" | jq

ISSUES=$(echo "$VAL_BEFORE" | jq -c '.issues')

echo "=== REPAIR ==="
REPAIR_PAYLOAD=$(jq -nc --argjson scoreModel "$SCORE" --argjson issues "$ISSUES" '{scoreModel:$scoreModel, issues:$issues}')
REPAIRED=$(curl -s -X POST http://localhost:3001/repair_scoremodel -H "Content-Type: application/json" -d "$REPAIR_PAYLOAD")
echo "$REPAIRED" | jq '.applied'

NEW_SCORE=$(echo "$REPAIRED" | jq -c '.scoreModel')

echo "=== VALIDATE (AFTER) ==="
VAL_AFTER_PAYLOAD=$(jq -nc --argjson scoreModel "$NEW_SCORE" '{scoreModel:$scoreModel}')
VAL_AFTER=$(curl -s -X POST http://localhost:3001/validate_scoremodel -H "Content-Type: application/json" -d "$VAL_AFTER_PAYLOAD")
echo "$VAL_AFTER" | jq

echo "=== EXPORT MUSICXML ==="
EXPORT_PAYLOAD=$(jq -nc --argjson scoreModel "$NEW_SCORE" '{scoreModel:$scoreModel}')
EXPORTED=$(curl -s -X POST http://localhost:3001/export_musicxml -H "Content-Type: application/json" -d "$EXPORT_PAYLOAD")

OUT="out_repaired_$(date +%Y%m%d_%H%M%S).musicxml"
echo "$EXPORTED" | jq -r '.musicxml' > "$OUT"

echo "Saved: $(pwd)/$OUT"
ls -la "$OUT"
