import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bandFor } from "../../src/arrange/difficulty/levels";
import { getInstrumentSpec } from "../../src/instruments/instrumentCatalog";

/**
 * The wind and brass bands must stay tied to the chart they came from.
 *
 * They are not measured — no publisher issues a wind part at two levels that we
 * have — but they are no longer mine either. They are the UIL's own statement
 * of what a player at each contest level is asked to read, converted from
 * written to concert pitch. `tools/calibration/graded-band-ranges.json` records
 * the written range, the transposition and the level mapping for every one.
 *
 * A constant lifted from a source and then edited away from it is worse than a
 * guess, because it still cites the source. This re-derives each band from the
 * record and fails when the table and the record disagree.
 */

const DATA = "tools/calibration/graded-band-ranges.json";
const record = JSON.parse(readFileSync(DATA, "utf8"));
const instruments: Record<string, any> = record.instruments;

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const nm = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

/** "Bb3" -> midi. The record keeps the written range so the maths is checkable. */
function parse(spelled: string): number {
  const step: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let i = 1, alter = 0;
  for (; i < spelled.length && (spelled[i] === "b" || spelled[i] === "#"); i++) {
    alter += spelled[i] === "b" ? -1 : 1;
  }
  return (Number(spelled.slice(i)) + 1) * 12 + step[spelled[0]!]! + alter;
}

// The source must still say it is guidance, not measurement. If that ever gets
// edited into a claim of calibration, this is where it should stop.
assert.equal(record.source.kind, "sourced-pedagogy", "the record no longer calls itself pedagogy");
assert.ok(/WRITTEN/.test(record.source.pitch), "the record must state the pitch convention");

// Only instruments the engine actually knows about are worth asserting on.
const applicable = Object.keys(instruments).filter((id) => getInstrumentSpec(id));
assert.ok(applicable.length >= 12, `only ${applicable.length} sourced instruments reach the catalog`);

for (const id of applicable) {
  const entry = instruments[id];
  const shift = entry.transpose;

  for (const level of ["beginner", "intermediate"] as const) {
    const row = entry[level];

    // Re-derive concert pitch from the written range the record quotes, rather
    // than trusting the concert numbers beside it. A wrong transposition is the
    // single most likely error in this whole exercise and it is silent.
    const [wLo, wHi] = String(row.written).split("-");
    assert.equal(parse(wLo!) + shift, row.lo, `${id}/${level}: written ${wLo} + ${shift} != ${row.lo}`);
    assert.equal(parse(wHi!) + shift, row.hi, `${id}/${level}: written ${wHi} + ${shift} != ${row.hi}`);

    const band = bandFor(id, level);
    assert.ok(band, `${id} has no ${level} band`);
    assert.equal(
      band!.hi, row.hi,
      `${id}: ${level} ceiling is ${nm(band!.hi)} but the chart says ${nm(row.hi)} ` +
      `(written ${row.written}${shift ? `, transposed ${shift}` : ""}). Update ${DATA} ` +
      `or do not cite it.`,
    );
  }

  // The beginner floor is taken from the chart too; intermediate's floor is
  // still the midpoint, so only beginner is pinned.
  assert.equal(
    bandFor(id, "beginner")!.lo, entry.beginner.lo,
    `${id}: beginner floor does not match the chart`,
  );

  // No band may ask for a note the instrument cannot play. This is the check
  // that would catch a misread staff position, which is the other silent error.
  const spec: any = getInstrumentSpec(id);
  for (const level of ["beginner", "intermediate", "advanced"] as const) {
    const b = bandFor(id, level)!;
    assert.ok(
      b.lo >= spec.midi_low && b.hi <= spec.midi_high,
      `${id}/${level}: ${nm(b.lo)}-${nm(b.hi)} falls outside the instrument ` +
      `(${nm(spec.midi_low)}-${nm(spec.midi_high)})`,
    );
    assert.ok(b.lo < b.hi, `${id}/${level}: empty band`);
  }

  // Levels must widen, never narrow.
  const beg = bandFor(id, "beginner")!, int = bandFor(id, "intermediate")!, adv = bandFor(id, "advanced")!;
  assert.ok(
    beg.hi <= int.hi && int.hi <= adv.hi,
    `${id}: ceilings out of order — ${beg.hi} / ${int.hi} / ${adv.hi}`,
  );
}

// The three instruments the chart does not cover must still be reachable, so a
// part for one of them is not silently left unconstrained.
for (const id of ["soprano_sax_bb", "bass_trombone"]) {
  assert.ok(bandFor(id, "beginner"), `${id} lost its band entirely`);
}

console.log(`ok sourcedBands (${applicable.length} instruments)`);
