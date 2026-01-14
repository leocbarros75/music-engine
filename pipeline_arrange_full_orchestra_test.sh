#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"

if [[ ! -f "$ROOT/package.json" ]]; then
  if [[ -f "$SCRIPT_DIR/../package.json" ]]; then
    ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  fi
fi

cd "$ROOT"

IN="$ROOT/in.musicxml"
OUT_XML="$ROOT/out_arranged_full_orchestra.musicxml"

echo "=== HEALTH ==="
curl -s http://localhost:3001/health | jq .

echo
echo "=== LOAD INPUT MUSICXML ==="
if [[ ! -f "$IN" ]]; then
  echo "Missing: $IN"
  echo "Put your source MusicXML in: $IN"
  exit 1
fi
BYTES="$(wc -c < "$IN" | tr -d ' ')"
echo "Loaded in.musicxml bytes: $BYTES"

MUSICXML="$(cat "$IN")"

# Use jq to build valid JSON
ARR_PAYLOAD="$(jq -nc --arg musicxml "$MUSICXML" \
  '{musicxml:$musicxml, intent:"new_arrangement", target:{ensemble:"full_orchestra", spacing:"open_classical"}}')"

echo
echo "=== ARRANGE (FULL ORCHESTRA) ==="
RESP="$(curl -s -X POST http://localhost:3001/arrange \
  -H "Content-Type: application/json" \
  -d "$ARR_PAYLOAD")"

echo "RAW /arrange response:"
echo "$RESP"

OK="$(echo "$RESP" | jq -r '.ok // false' 2>/dev/null || echo "false")"
if [[ "$OK" != "true" ]]; then
  echo
  echo "Arrange failed:"
  echo "$RESP"
  exit 1
fi

echo
echo "$RESP" | jq '{ok, ensemble: .scoreModel.meta.ensemble, partCount: (.scoreModel.parts|length), partIds: [.scoreModel.parts[].part_id]}'

echo
echo "=== EXPORT MUSICXML (FULL ORCHESTRA) ==="
echo "$RESP" | jq -c '{scoreModel:.scoreModel}' \
  | curl -s -X POST http://localhost:3001/export_musicxml \
      -H "Content-Type: application/json" \
      --data-binary @- \
  > "$OUT_XML"

# Quick sanity check: confirm MusicXML
if ! grep -q "<score-partwise" "$OUT_XML" 2>/dev/null; then
  echo
  echo "Export did not look like MusicXML. First 60 lines:"
  head -n 60 "$OUT_XML" || true
  exit 1
fi

echo "Saved: $OUT_XML"
ls -la "$OUT_XML"

echo
echo "=== CONFIRM MULTI-PART IN EXPORTED FILE ==="
echo "score-part count:"
grep -o "<score-part " "$OUT_XML" | wc -l
echo "part id count:"
grep -o "<part id=" "$OUT_XML" | wc -l

echo
echo "=== QUICK PART LIST (score-part ids) ==="
grep -n "<score-part id=" "$OUT_XML" | head -n 80 || true

echo
echo "=== OPEN IN MUSESCORE (optional) ==="
echo "open -a \"MuseScore 4\" \"$OUT_XML\""