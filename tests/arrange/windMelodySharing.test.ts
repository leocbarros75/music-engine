import assert from "node:assert/strict";
import { shareMelodyAmongWinds, shareMelodySentence } from "../../src/arrange/woodwinds/shareMelody";
import { midiToPitch, pitchToMidi } from "../../src/instruments/instrumentCatalog";

/**
 * The upper winds take turns with the melody.
 *
 * The defect these cover: the wind mapping is fixed, so the flute read the
 * melody for every bar of a 124-bar chart and the clarinet read an inner voice
 * for every bar of it, ending up inside eight semitones.
 */

/** A part whose every bar holds one note at `midi`. */
function part(name: string, midis: number[]): any {
  return {
    part_id: `P_${name.slice(0, 2).toUpperCase()}`,
    name,
    measures: midis.map((m, i) => ({
      number: i + 1,
      events: [{ type: "note", t: 0, dur: 4, pitch: midiToPitch(m), id: `${name}-${i}` }],
    })),
  };
}

function midisOf(p: any): number[] {
  return (p.measures ?? []).map((m: any) => {
    const n = (m.events ?? []).find((e: any) => e.type === "note");
    return n ? pitchToMidi(n.pitch) : NaN;
  });
}

const BARS = 24;

// ── The clarinet and oboe actually get the tune ──────────────────────────────
{
  // Melody climbs; the two inner lines sit still, as they did on the real chart.
  const melody = Array.from({ length: BARS }, (_, i) => 72 + (i % 12));
  const flute = part("Flute", melody);
  const oboe = part("Oboe", Array.from({ length: BARS }, () => 70));
  const clar = part("Clarinet in Bb", Array.from({ length: BARS }, () => 68));
  const bassoon = part("Bassoon", Array.from({ length: BARS }, () => 45));

  const plans = shareMelodyAmongWinds([flute, oboe, clar, bassoon]);
  const byName = new Map(plans.map((p) => [p.lead, p.blocks]));

  // Three 8-bar blocks over 24 bars; ROTATION is fl, ob, fl, ...
  assert.equal(byName.get("Flute"), 2, "the flute keeps the tune for two of three blocks");
  assert.equal(byName.get("Oboe"), 1, "the oboe takes one");

  // The oboe's block must now hold the MELODY, not its own held note.
  const ob = midisOf(oboe);
  assert.deepEqual(ob.slice(8, 16), melody.slice(8, 16),
    "the oboe reads the melody through its block");
  // And the flute reads the oboe's line there instead.
  const fl = midisOf(flute);
  assert.ok(fl.slice(8, 16).every((v) => v === 70),
    "the flute takes the line the oboe gave up");
  // Outside that block the flute still has the tune.
  assert.deepEqual(fl.slice(0, 8), melody.slice(0, 8));
  assert.deepEqual(fl.slice(16, 24), melody.slice(16, 24));

  // The bassoon is not in the rotation at all.
  assert.ok(midisOf(bassoon).every((v) => v === 45), "the bassoon is untouched");
}

// ── The range opens up: this is the measurement the defect was found by ──────
{
  const melody = Array.from({ length: 48 }, (_, i) => 72 + (i % 12));
  const flute = part("Flute", melody);
  const oboe = part("Oboe", Array.from({ length: 48 }, () => 70));
  const clar = part("Clarinet in Bb", Array.from({ length: 48 }, () => 68));

  const before = midisOf(clar);
  assert.equal(Math.max(...before) - Math.min(...before), 0, "the clarinet starts static");

  shareMelodyAmongWinds([flute, oboe, clar]);
  const after = midisOf(clar);
  assert.ok(Math.max(...after) - Math.min(...after) >= 11,
    `the clarinet should now cover a real range, got ${Math.max(...after) - Math.min(...after)}`);
}

// ── A grounded voice never takes the tune ───────────────────────────────────
{
  const melody = Array.from({ length: BARS }, (_, i) => 72 + (i % 12));
  const flute = part("Flute", melody);
  const oboe = part("Oboe", Array.from({ length: BARS }, () => 70));

  // With the oboe barred there is nobody to share with, so nothing happens.
  const plans = shareMelodyAmongWinds([flute, oboe], { eligible: (v) => v === "fl" });
  assert.deepEqual(plans, [], "no eligible partner means no sharing");
  assert.deepEqual(midisOf(flute), melody, "the flute keeps every bar");
  assert.ok(midisOf(oboe).every((v) => v === 70), "the oboe is untouched");
}

// ── A line too high for its new player comes down an octave ─────────────────
{
  // A melody at the top of the flute's range: 92–97 is inside the flute
  // (absMax 98) and above the oboe's ceiling of 93.
  const melody = Array.from({ length: 16 }, (_, i) => 92 + (i % 6));
  const flute = part("Flute", melody);
  const oboe = part("Oboe", Array.from({ length: 16 }, () => 70));

  shareMelodyAmongWinds([flute, oboe]);
  const ob = midisOf(oboe).slice(8, 16);
  assert.ok(ob.every((v) => v <= 93 && v >= 58),
    `the oboe's borrowed line must be inside its range, got ${ob.join(",")}`);
  // It is the same tune, an octave down — not a different one.
  assert.deepEqual(ob, melody.slice(8, 16).map((m) => m - 12),
    "the line moves by a whole octave, keeping its shape");
}

// ── A line the new player CAN reach is left alone ────────────────────────────
{
  // 66–88 is inside the oboe (58–93) though above its preferred 79. Dropping it
  // an octave would put the melody under the flute's accompanying line.
  const melody = Array.from({ length: 16 }, (_, i) => 66 + ((i * 3) % 23));
  const flute = part("Flute", melody);
  const oboe = part("Oboe", Array.from({ length: 16 }, () => 70));

  shareMelodyAmongWinds([flute, oboe]);
  assert.deepEqual(midisOf(oboe).slice(8, 16), melody.slice(8, 16),
    "a reachable line is not transposed, even above the preferred ceiling");
}

// ── The sentence only claims sharing when sharing happened ──────────────────
{
  assert.equal(shareMelodySentence([]), null);
  assert.equal(shareMelodySentence([{ lead: "Flute", blocks: 3 }]), null,
    "one leader is not sharing");
  const line = shareMelodySentence([{ lead: "Flute", blocks: 2 }, { lead: "Oboe", blocks: 1 }]);
  assert.ok(line && /Flute 2/.test(line) && /Oboe 1/.test(line));
}

// ── Short pieces and missing parts don't throw ──────────────────────────────
{
  assert.deepEqual(shareMelodyAmongWinds([]), []);
  assert.deepEqual(shareMelodyAmongWinds([part("Oboe", [70])]), [], "no flute, no plan");
  // Three bars: one block, the flute's own, so no swap and no claim of sharing.
  const flute = part("Flute", [72, 74, 76]);
  const oboe = part("Oboe", [70, 70, 70]);
  const plans = shareMelodyAmongWinds([flute, oboe]);
  assert.deepEqual(midisOf(flute), [72, 74, 76]);
  assert.equal(shareMelodySentence(plans), null, "a single block is not a rotation");
}

console.log("PASS wind melody sharing");
