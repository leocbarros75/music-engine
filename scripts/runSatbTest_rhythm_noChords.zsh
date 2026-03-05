#!/bin/zsh
set -euo pipefail

cd ~/Desktop/music-engine
mkdir -p tmp

# Usage:
#   ./scripts/runSatbTest_rhythm_noChords.zsh [style]
# style: classical | pop | rock | funk | samba
STYLE_IN="${1:-classical}"

VALID_STYLES=("classical" "pop" "rock" "funk" "samba")
STYLE="classical"
for s in "${VALID_STYLES[@]}"; do
  if [[ "$STYLE_IN" == "$s" ]]; then
    STYLE="$STYLE_IN"
    break
  fi
done

if [[ "$STYLE_IN" != "$STYLE" ]]; then
  echo "[warn] Unknown style: '$STYLE_IN'. Defaulting to 'classical'. Allowed: classical|pop|rock|funk|samba"
fi

export XML="${XML:-./tests/musicxml/test_polyphonic_overlap.xml}"

# Build request JSON
node <<'NODE' > ./tmp/request.json
const fs = require("fs");
const xml = fs.readFileSync(process.env.XML, "utf8");
const body = {
  musicxml: xml,
  chords: [],
  options: { keepMelodyInSoprano: true },
  settings: { accompanimentType: "polyphonic", style: "classical" }
};
process.stdout.write(JSON.stringify(body));
NODE

tmp_json="./tmp/satb_response.json.tmp"
out_json="./tmp/satb_response.json"

rm -f "$tmp_json" "$out_json"

curl -sS -f -X POST "http://localhost:3001/harmonize_satb_from_chords" \
  -H "Content-Type: application/json" \
  -d @./tmp/request.json \
  -o "$tmp_json"

# Validate response JSON
node -e 'const fs=require("fs"); const s=fs.readFileSync(process.argv[1],"utf8"); if(!s || !s.trim()) throw new Error("Empty response JSON"); JSON.parse(s);' "$tmp_json"
mv -f "$tmp_json" "$out_json"

# Apply rhythm (final cadence only) -> new json
# Style options: classical | pop | rock | funk | samba
npx tsx scripts/applyRhythmToSatbResponse.ts ./tmp/satb_response.json ./tmp/satb_response_rhythm.json "$STYLE"

# Export SATB scoreModel -> MusicXML using the SATB exporter
npx tsx scripts/exportSatbResponseToMusicxml.ts ./tmp/satb_response_rhythm.json ./tmp/satb_out_rhythm.musicxml

# Run voicing integrity check (no missing inner voices)
npx tsx scripts/checkSatbVoicingIntegrity.ts ./tmp/satb_response_rhythm.json || true

open ./tmp/satb_out_rhythm.musicxml
echo "DONE: opened ./tmp/satb_out_rhythm.musicxml"
