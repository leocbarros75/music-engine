import assert from "node:assert/strict";
import { arrangeBrassEnsemble, centreOnSweetSpot } from "../../src/arrange/brass/brassArranger";
import { BRASS_RANGES, BRASS_SWEET_SPOT } from "../../src/arrange/brass/brassRanges";
import { midiToPitch, pitchToMidi } from "../../src/instruments/instrumentCatalog";

/**
 * Where each brass voice sits.
 *
 * Two faults, one hiding the other.
 *
 * centreOnSweetSpot refused an octave shift if ANY note would leave the
 * instrument's range after it, so 6 of the tuba's 225 notes stopped the other
 * 219 from being placed: it read 37-52 with a median of 44 against the
 * reference edition's 30-40 and median 35. And the error propagated, because
 * the derived bass trombone keeps a clearance above the tuba and so had
 * nowhere to sit.
 *
 * Judging the shift on the line as a whole then exposed the second fault. The
 * sweet spots were read off the textbook register strings, and the horn's
 * "C3-G4" is six semitones below where that edition actually writes a horn
 * carrying lines — so once the veto stopped firing, the horn fell an octave to
 * 35-64 sounding against its 54-71. Both values are measured now.
 */

const VOICES: Array<[RegExp, keyof typeof BRASS_RANGES]> = [
  [/^trumpet 1/i, "tpt1"],
  [/^trumpet 2/i, "tpt2"],
  [/^horn/i, "hn"],
  [/^trombone$/i, "tbn"],
  [/^tuba/i, "tuba"],
];

/** A melody high enough that the low voices inherit a line above their register. */
function source(bars: number, from = 72): any {
  return {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: Array.from({ length: bars }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events: Array.from({ length: 4 }, (_, k) => ({
          type: "note", t: k, dur: 1,
          pitch: midiToPitch(from + ((i + k) % 8)), id: `n${i}-${k}`,
        })),
      })),
    }],
    meta: {},
  };
}

const chords = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ measure: i + 1, t: 0, symbol: "C" })) as any;
const KEY = { fifths: 0, mode: "major" as const };

function midisOf(part: any): number[] {
  const out: number[] = [];
  for (const m of part.measures ?? []) {
    for (const e of (m.events ?? [])) {
      if (e?.type !== "note" || e.grace) continue;
      try { out.push(pitchToMidi(e.pitch)); } catch { /* ignore */ }
    }
  }
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const BARS = 16;
const res = arrangeBrassEnsemble(source(BARS) as any, chords(BARS), { key: KEY });
const parts: any[] = (res.scoreModel as any).parts ?? [];
const find = (re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

// ── Nobody is left outside their instrument's range ───────────────────────
{
  // This has to hold whatever the placement decides — it is the point of
  // clamping the stragglers rather than abandoning the shift.
  for (const [re, key] of VOICES) {
    const p = find(re);
    assert.ok(p, `${re} is in the score`);
    const r = BRASS_RANGES[key];
    for (const m of midisOf(p)) {
      assert.ok(m >= r.absMin && m <= r.absMax,
        `${p.name}: ${m} is outside ${r.absMin}-${r.absMax}`);
    }
  }
}

// ── Each voice's tessitura lands in its own register ──────────────────────
{
  for (const [re, key] of VOICES) {
    const p = find(re);
    const ms = midisOf(p);
    if (ms.length < 4) continue;
    const spot = BRASS_SWEET_SPOT[key];
    const med = median(ms);
    // Within the sweet spot, or no more than a fifth outside it. A whole octave
    // out is the fault this guards: the tuba sat 9 above its band's centre and
    // the horn, once un-vetoed, fell 12 below where it belongs.
    assert.ok(med >= spot.lo - 7 && med <= spot.hi + 7,
      `${p.name} median ${med} is far outside its register ${spot.lo}-${spot.hi}`);
  }
}

// ── The tuba is a bass line, not a tenor one ──────────────────────────────
{
  const tuba = find(/^tuba/i);
  const med = median(midisOf(tuba));
  // The reference edition's tuba runs 30-40 with a median of 35. Its own
  // register says D3 is reachable; a bass line does not live there.
  assert.ok(med <= 44,
    `the tuba's median is ${med}; a bass line sits near the reference's 35`);
  assert.ok(BRASS_SWEET_SPOT.tuba.hi <= 44,
    "the tuba's sweet spot must not reach into the tenor register");
}

// ── The horn carries lines, so it sits above the textbook middle ──────────
{
  assert.ok(BRASS_SWEET_SPOT.hn.lo >= 52,
    "the horn's register was six semitones low and let it fall an octave");
  const hn = find(/^horn/i);
  const med = median(midisOf(hn));
  assert.ok(med >= 48,
    `the horn's median is ${med}; it has fallen out of its register`);
}

// ── A line genuinely in the wrong octave is still moved ───────────────────
{
  // A very high melody: the low voices inherit lines well above themselves and
  // must come down, which is the behaviour the outlier tolerance exists to allow.
  const high = arrangeBrassEnsemble(source(BARS, 84) as any, chords(BARS), { key: KEY });
  const hp: any[] = (high.scoreModel as any).parts ?? [];
  const tuba = hp.find((p) => /^tuba/i.test(String(p.name)))!;
  const r = BRASS_RANGES.tuba;
  for (const m of midisOf(tuba)) {
    assert.ok(m >= r.absMin && m <= r.absMax,
      `${m} is outside the tuba's range even after placement`);
  }
  assert.ok(median(midisOf(tuba)) <= 50,
    "a high inherited line must still be brought down into the tuba's register");
}

// ── The rule itself: a few outliers must not veto the whole line ──────────
{
  // Built to the shape that caused the fault: a tuba line sitting an octave
  // above its register, with a handful of notes low enough that shifting down
  // would push them under the instrument's floor. Six of 225 did that on the
  // real chart and blocked the other 219.
  //
  // Driving centreOnSweetSpot directly, because a synthetic melody put through
  // the whole arranger does not reliably reproduce it — the first version of
  // this test passed against the veto restored, which proved nothing.
  const r = BRASS_RANGES.tuba;
  const line: number[] = [];
  // 36, not 38: shifted down an octave 38 lands exactly ON the tuba's floor of
  // 26, so nothing is out of range and the strict veto passes too. The first
  // version of this test used 38 and so could not tell the two apart.
  for (let i = 0; i < 100; i++) line.push(i < 6 ? 36 : 44 + (i % 5));
  const score: any = {
    parts: [{
      part_id: "P_TUBA", name: "Tuba", instrument: "tuba_c",
      measures: line.map((m, i) => ({
        number: i + 1,
        events: [{ type: "note", t: 0, dur: 4, pitch: midiToPitch(m), id: `t${i}` }],
      })),
    }],
  };
  const shifted = centreOnSweetSpot(score, ["tuba"]);
  assert.ok(shifted > 0,
    "six notes near the floor must not stop a hundred-note line being placed");

  const after = midisOf(score.parts[0]);
  for (const m of after) {
    assert.ok(m >= r.absMin && m <= r.absMax,
      `${m} left the tuba's range; the stragglers must be clamped, not abandoned`);
  }
  assert.ok(median(after) <= 42,
    `the line should land in the tuba's register, median came out ${median(after)}`);
}

// ── Past a tenth of the part it is the wrong octave, not outliers ─────────
{
  // Half the line would leave the range: that is not a few stragglers, and
  // shifting would mangle it. The placement is refused.
  const line: number[] = [];
  for (let i = 0; i < 100; i++) line.push(i < 50 ? 30 : 50);
  const score: any = {
    parts: [{
      part_id: "P_TUBA", name: "Tuba", instrument: "tuba_c",
      measures: line.map((m, i) => ({
        number: i + 1,
        events: [{ type: "note", t: 0, dur: 4, pitch: midiToPitch(m), id: `t${i}` }],
      })),
    }],
  };
  const before = midisOf(score.parts[0]);
  centreOnSweetSpot(score, ["tuba"]);
  assert.deepEqual(midisOf(score.parts[0]), before,
    "a line half of which would leave the range must be left alone");
}

console.log("PASS brass register");
