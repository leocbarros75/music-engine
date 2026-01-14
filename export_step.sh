#!/usr/bin/env bash
set -euo pipefail

if [ ! -f /tmp/new_score.json ]; then
  echo "Missing: /tmp/new_score.json"
  echo "Run the repair pipeline first to generate it."
  exit 1
fi

NEW_SCORE=$(cat /tmp/new_score.json)

EXPORT_PAYLOAD=$(jq -nc --argjson scoreModel "$NEW_SCORE" '{scoreModel:$scoreModel}')
EXPORTED=$(curl -s -X POST http://localhost:3001/export_musicxml \
  -H "Content-Type: application/json" \
  -d "$EXPORT_PAYLOAD")

echo "$EXPORTED" | jq -r '.musicxml' > out_repaired.musicxml
echo "Saved: $(pwd)/out_repaired.musicxml"
ls -la out_repaired.musicxml
