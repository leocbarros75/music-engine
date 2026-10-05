import assert from "node:assert/strict";
import { arrangeStringEnsemble } from "../../src/arrange/orchestra/core/stringArranger";

/**
 * The orchestra's strings need air between the notes.
 *
 * `buildSlices` tiles the bar and every voice took a note spanning each slice
 * to the next, so all five parts sounded exactly 100% of all 124 bars of a
 * chart — not one whole-bar rest and not one gap. The reference edition's
 * strings run 37-90%, and its mechanism is plain in the durations: eighths with
 * real rests between them, 204 gaps in its Violin 1 and 293 in its double bass.
 * Ours already had the duration mix about right and 0-2 gaps in the whole
 * piece. The notes were not too long; there was no air between them.
 *
 * Scope: this arranger belongs to the orchestra routes. `string_ensemble` has
 * its own under `src/arrange/strings/`, deliberately sustained, untouched.
 */

const STEPS = ["C", "D", "E", "F", "G", "A", "B", "C"];

/**
 * A melody whose onsets tile the bar, so every slice butts against the next.
 *
 * `step` sets the grid. Quarters are the interesting case: a quarter slice can
 * give up a quarter or an eighth of itself and still leave a note worth
 * writing. An eighth slice cannot — three-quarters of it snaps down to a
 * sixteenth — and is deliberately left alone.
 */
function score(bars: number, step = 1): any {
  const per = Math.round(4 / step);
  return {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: Array.from({ length: bars }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events: Array.from({ length: per }, (_, k) => ({
          type: "note", t: k * step, dur: step,
          pitch: { step: STEPS[k % STEPS.length], octave: 5, alter: 0 }, id: `n${i}-${k}`,
        })),
      })),
    }],
    meta: {},
  };
}

const chords = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ measure: i + 1, t: 0, symbol: "C" })) as any;

const BARS = 16;
const res = arrangeStringEnsemble(score(BARS) as any, chords(BARS), {});
const parts: any[] = (res.scoreModel as any).parts ?? [];
const find = (re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

/** Gaps, sounding share and the shortest note written. */
function stats(part: any) {
  let snd = 0, gaps = 0, shortest = Infinity, longest = 0, notes = 0;
  for (const m of part.measures ?? []) {
    const es = (m.events ?? [])
      .filter((e: any) => e?.type === "note" && !e.grace)
      .sort((a: any, b: any) => Number(a.t) - Number(b.t));
    let cursor = 0;
    for (const e of es) {
      notes++;
      const d = Number(e.dur);
      snd += d;
      shortest = Math.min(shortest, d);
      longest = Math.max(longest, d);
      if (Number(e.t) > cursor + 1e-9) gaps++;
      cursor = Math.max(cursor, Number(e.t) + d);
    }
    if (cursor < 4 - 1e-9 && es.length) gaps++;
  }
  const bars = (part.measures ?? []).length;
  return { ratio: snd / (bars * 4), gaps, shortest, longest, notes };
}

const NAMES = [/^violin i\b/i, /^violin ii\b/i, /^viola/i, /^cello/i, /^double bass/i];

// ── Every string part gets air, the lower ones included ────────────────────
for (const re of NAMES) {
  const p = find(re);
  assert.ok(p, `${re} is in the score`);
  const s = stats(p);
  assert.ok(s.gaps > 0,
    `${p.name} has no gap anywhere — the slice grid is still tiling the bar`);
  assert.ok(s.ratio < 0.95,
    `${p.name} sounds ${(100 * s.ratio).toFixed(0)}% of the time`);
}

// ── The cello and the bass are not forgotten ──────────────────────────────
{
  // partNameToVoiceId knows only the violins and the viola; using it left these
  // two tiling every beat while the upper three were fixed.
  for (const re of [/^cello/i, /^double bass/i]) {
    const s = stats(find(re));
    assert.ok(s.gaps > 0, `${re} must be given air too`);
  }
}

// ── Never a sixteenth merely to make air ──────────────────────────────────
{
  // An eighth slice times three-quarters snaps DOWN to a sixteenth. Applying
  // the share at emission made that the commonest value in every part — a
  // spiccato wash. So an eighth-note grid is left exactly as it is.
  for (const re of NAMES) {
    const s = stats(find(re));
    assert.ok(s.shortest >= 0.5 - 1e-9,
      `${find(re).name} writes a ${s.shortest}-beat note; nothing should fall below an eighth`);
  }

  const eighths = arrangeStringEnsemble(score(8, 0.5) as any, chords(8), {});
  for (const p of ((eighths.scoreModel as any).parts ?? [])) {
    if (!NAMES.some((re) => re.test(String(p.name)))) continue;
    const s = stats(p);
    assert.ok(s.shortest >= 0.5 - 1e-9,
      `${p.name} cut an eighth down to ${s.shortest}; an eighth grid has no room to give`);
  }
}

// ── It only shortens: nothing is added, nothing is re-timed ───────────────
{
  // This is what separates a post-pass from shortening at emission. Emitting
  // short notes removed the contiguity the merge pass looks for and destroyed
  // it, taking the viola from 258 notes to 499 and losing its pad. A pass that
  // runs last cannot do that, because it never touches an onset or a count.
  for (const re of NAMES) {
    const p = find(re);
    for (const m of p.measures ?? []) {
      const es = (m.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
      assert.ok(es.length <= 4,
        `${p.name} bar ${m.number} has ${es.length} notes on a 4-slice grid — notes were added`);
      for (const e of es) {
        assert.ok(Math.abs(Number(e.t) - Math.round(Number(e.t))) < 1e-9,
          `${p.name} bar ${m.number}: onset ${e.t} is off the slice grid — a note was re-timed`);
      }
    }
  }
}

// ── The upper strings hold more than the lower ones ───────────────────────
{
  const v1 = stats(find(/^violin i\b/i)).ratio;
  const cb = stats(find(/^double bass/i)).ratio;
  assert.ok(v1 > cb,
    `Violin I should carry more than the bass, got ${(100 * v1).toFixed(0)}% vs ${(100 * cb).toFixed(0)}%`);
}

// ── It says what it did ───────────────────────────────────────────────────
{
  assert.ok((res.warnings ?? []).some((w: string) => /released early/.test(w)),
    "the pass should report the count it changed");
}

console.log("PASS orchestra string air");
