#!/usr/bin/env bash
set -euo pipefail

echo "== harmony tests =="

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "root: $ROOT"

cd "$ROOT"

GRANULARITY="${1:-beat}"
if [[ "$GRANULARITY" != "beat" && "$GRANULARITY" != "measure" ]]; then
  GRANULARITY="beat"
fi

run_one () {
  local xml="$1"
  echo ""
  echo "-> $xml ($GRANULARITY)"
  npx tsx tests/harmony/runHarmonyTest.ts "$xml" "$GRANULARITY"
}

run_one "tests/musicxml/test_am_i64_v7_i.xml"
run_one "tests/musicxml/test_c_major_plagal_4bars.xml"
run_one "tests/musicxml/test_c_major_backdoor_plagal_2bars.xml"
run_one "tests/musicxml/test_c_major_applied_dominant_deceptive.xml"
run_one "tests/musicxml/test_c_major_v7_i_2bars.xml"
run_one "tests/musicxml/test_c_major_half_cadence_2bars.xml"

echo ""
echo "== done =="