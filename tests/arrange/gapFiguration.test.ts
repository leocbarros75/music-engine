import assert from "node:assert/strict";
import { breakChordsInGaps, gapFigurationSentence } from "../../src/arrange/strings/gapFiguration";
import { midiToPitch, pitchToMidi } from "../../src/instruments/instrumentCatalog";

/**
 * The violins break the chord where the tune stops.
 *
 * Giving a tune-less bar a real slice grid got the strings moving rhythmically
 * — four attacks instead of one held note — but on the SAME note each time: the
 * voicing search is rewarded for minimal motion and has no reason to go
 * anywhere inside a static chord.
 *
 * Measured across the reference edition's 30 such bars, moving pitch belongs to
 * the violins alone — Violin 1 moves in 22 of 30 bars with 2.1 distinct
 * pitches, Violin 2 in 20 of 30 with 2.3, while its viola and double bass stay
 * at 1.0 and hold.
 */

/** A C major triad across the section, one note a slice, four slices a bar. */
function section(bars: number, gapAt: number[]): any[] {
  const voices: Array<[string, number]> = [
    ["Violin I", 76], ["Violin II", 72], ["Viola", 67], ["Cello", 60], ["Double Bass", 48],
  ];
  return voices.map(([name, midi]) => ({
    part_id: name,
    name,
    measures: Array.from({ length: bars }, (_, i) => ({
      number: i + 1,
      events: Array.from({ length: 4 }, (_, k) => ({
        type: "note", t: k, dur: 0.75,
        pitch: midiToPitch(midi), id: `${name}-${i}-${k}`,
      })),
    })),
  }));
}

const midisIn = (part: any, bar: number) =>
  (part.measures?.[bar]?.events ?? [])
    .filter((e: any) => e?.type === "note")
    .map((e: any) => pitchToMidi(e.pitch));

const find = (parts: any[], re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

const BARS = 8;
const GAPS = [2, 3, 5];
const gapBars = Array.from({ length: BARS }, (_, i) => GAPS.includes(i));

// ── The violins move; nobody else does ────────────────────────────────────
{
  const parts = section(BARS, GAPS);
  const plans = breakChordsInGaps(parts, gapBars);

  for (const re of [/^violin i\b/i, /^violin ii\b/i]) {
    const p = find(parts, re);
    for (const bar of GAPS) {
      const distinct = new Set(midisIn(p, bar)).size;
      assert.ok(distinct >= 2,
        `${p.name} bar ${bar + 1} still holds one pitch (${distinct} distinct)`);
    }
  }
  for (const re of [/^viola/i, /^cello/i, /^double bass/i]) {
    const p = find(parts, re);
    for (const bar of GAPS) {
      assert.equal(new Set(midisIn(p, bar)).size, 1,
        `${p.name} should hold through a gap, as the reference's lower strings do`);
    }
  }
  assert.equal(plans.length, 2, "only the two violins are reported");
}

// ── Bars with a tune in them are untouched ────────────────────────────────
{
  const parts = section(BARS, GAPS);
  breakChordsInGaps(parts, gapBars);
  for (const re of [/^violin i\b/i, /^violin ii\b/i]) {
    const p = find(parts, re);
    for (let bar = 0; bar < BARS; bar++) {
      if (gapBars[bar]) continue;
      assert.equal(new Set(midisIn(p, bar)).size, 1,
        `${p.name} bar ${bar + 1} is not a gap and must not be figured`);
    }
  }
}

// ── Only chord tones, and only ones the section is sounding ───────────────
{
  const parts = section(BARS, GAPS);
  breakChordsInGaps(parts, gapBars);
  // The section voices C, E and G — pitch classes 0, 4, 7. Nothing else may appear.
  const allowed = new Set([0, 4, 7]);
  for (const re of [/^violin i\b/i, /^violin ii\b/i]) {
    const p = find(parts, re);
    for (const bar of GAPS) {
      for (const m of midisIn(p, bar)) {
        assert.ok(allowed.has(((m % 12) + 12) % 12),
          `${p.name} bar ${bar + 1}: ${m} is not a chord tone the section is holding`);
      }
    }
  }
}

// ── The second violin is never pushed above the first ─────────────────────
{
  const parts = section(BARS, GAPS);
  breakChordsInGaps(parts, gapBars);
  const v1 = find(parts, /^violin i\b/i);
  const v2 = find(parts, /^violin ii\b/i);
  for (const bar of GAPS) {
    const top = Math.max(...midisIn(v1, bar));
    for (const m of midisIn(v2, bar)) {
      assert.ok(m <= top,
        `bar ${bar + 1}: Violin II reached ${m}, above Violin I's ${top}`);
    }
  }
}

// ── On-beat attacks keep the pitch the voicing chose ──────────────────────
{
  const parts = section(BARS, GAPS);
  breakChordsInGaps(parts, gapBars);
  const v1 = find(parts, /^violin i\b/i);
  for (const bar of GAPS) {
    const ms = midisIn(v1, bar);
    assert.equal(ms[0], 76, "the first attack of the bar is the voicing's own note");
    assert.equal(ms[2], 76, "and so is the third — the figure alternates");
  }
}

// ── A unison section is nothing to break, and degenerate input is safe ────
{
  const unison = section(4, [0]).map((p: any) => ({
    ...p,
    measures: p.measures.map((m: any) => ({
      ...m,
      events: m.events.map((e: any) => ({ ...e, pitch: midiToPitch(60) })),
    })),
  }));
  assert.deepEqual(breakChordsInGaps(unison, [true, false, false, false]), [],
    "one pitch class across the section is not a chord");

  assert.deepEqual(breakChordsInGaps([], [true]), []);
  assert.deepEqual(breakChordsInGaps(section(2, []), []), [],
    "no gap bars, nothing to do");
  assert.equal(gapFigurationSentence([]), null);
  const line = gapFigurationSentence([{ part: "Violin I", bars: 27, notes: 54 }]);
  assert.ok(line && /Violin I 54 notes over 27 bars/.test(line));
}

console.log("PASS gap figuration");
