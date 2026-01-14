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
OUT_XML="$ROOT/out_arranged_percussion.musicxml"

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

# Enable the new layers explicitly
ARR_PAYLOAD="$(jq -nc --arg musicxml "$MUSICXML" '
  {
    musicxml: $musicxml,
    intent: "new_arrangement",
    target: { ensemble: "percussion" },
    options: {
      style: "swing",
      enableSwingSkip: true,
      includeSnareBackbeat: false,
      includeHiHatBackbeat: true,
      kickOnChordOnsets: true,
      hitDurFraction: 8,

      includeTimpani: true,
      includeSuspendedCymbal: true,
      includeMallets: true,
      includeBells: true,
      includeChimes: true,
      colorEveryNMeasures: 1
    }
  }'
)"

echo
echo "=== ARRANGE (PERCUSSION) ==="
RESP="$(curl -s -X POST http://localhost:3001/arrange \
  -H "Content-Type: application/json" \
  -d "$ARR_PAYLOAD")"

echo "RAW /arrange response:"
echo "$RESP"

OK="$(echo "$RESP" | jq -r '.ok // false' 2>/dev/null || echo "false")"
if [[ "$OK" != "true" ]]; then
  echo
  echo "Arrange failed (server did not return ok:true)."
  echo "$RESP"
  exit 1
fi

echo
echo "=== PART SUMMARY ==="
echo "$RESP" | jq '{ok, ensemble: .scoreModel.meta.ensemble, partCount: (.scoreModel.parts|length), partIds: [.scoreModel.parts[].part_id], instruments: [.scoreModel.parts[].instrument]}'

echo
echo "=== CHECK INSTRUMENT IDS IN SCOREMODEL (should include colors) ==="
echo "$RESP" | jq -r '
  .scoreModel.parts[]
  | .measures[]
  | .events[]
  | select(.type=="unpitched")
  | .instrumentId
' | sort | uniq -c | sort -nr

echo
echo "=== EXPORT MUSICXML (PERCUSSION) ==="
echo "$RESP" | jq -c '{scoreModel:.scoreModel}' \
  | curl -s -X POST http://localhost:3001/export_musicxml \
      -H "Content-Type: application/json" \
      --data-binary @- \
  > "$OUT_XML"

if ! grep -q "<score-partwise" "$OUT_XML" 2>/dev/null; then
  echo
  echo "Export did not look like MusicXML. First 60 lines:"
  head -n 60 "$OUT_XML" || true
  exit 1
fi

echo "Saved: $OUT_XML"
ls -la "$OUT_XML"

echo
echo "=== CONFIRM PARTS IN EXPORTED FILE ==="
echo "score-part count:"
grep -o "<score-part " "$OUT_XML" | wc -l
echo "part id count:"
grep -o "<part id=" "$OUT_XML" | wc -l

echo
echo "=== QUICK SCAN FOR SUSPENDED/MALLETS/BELLS/CHIMES ==="
grep -n "DRUMS-I57\|DRUMS-I81\|DRUMS-I83\|DRUMS-I84" "$OUT_XML" | head -n 50 || true

echo
echo "=== OPEN IN MUSESCORE (optional) ==="
echo "open -a \"MuseScore 4\" \"$OUT_XML\""