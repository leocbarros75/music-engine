import assert from "node:assert/strict";
import { arrangeStringEnsemble } from "../../src/arrange/symphonic/core/stringArranger";

/**
 * The symphonic engine's own copy of the string arranger had the same wall.
 *
 * Four of its five string parts sounded 100% of all 124 bars of a chart. Its
 * slice grid tiles the bar and each voice took a note spanning every slice, the
 * same fault fixed for the worship orchestra in 3f4ee54 — this is that fix in
 * the copy symphonic actually uses.
 *
 * The thing to protect while doing it: symphonic's enterAt table is calibrated
 * against real classical scores and states its targets in PARTICIPATION —
 * strings ~100% of measures, winds ~70%, brass ~37%. Shortening notes must not
 * touch that. It changes how much of a bar a part sounds, not how many bars it
 * plays in, and the two must not be confused: a pass that reduced participation
 * would silently undo a calibration that currently lands on its numbers.
 */

const STEPS = ["C", "D", "E", "F", "G", "A", "B", "C"];

/** Quarter-note melody: a grid whose slices tile the bar. */
function score(bars: number): any {
  return {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: Array.from({ length: bars }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events: Array.from({ length: 4 }, (_, k) => ({
          type: "note", t: k, dur: 1,
          pitch: { step: STEPS[k], octave: 5, alter: 0 }, id: `n${i}-${k}`,
        })),
      })),
    }],
    meta: {},
  };
}

const chords = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ measure: i + 1, t: 0, symbol: "C" })) as any;

const STRINGS = [/^violin i\b/i, /^violin ii\b/i, /^viola/i, /^cello/i, /^(double bass|contrabass)/i];

function stats(part: any) {
  let snd = 0, barsPlayed = 0, bars = 0, shortest = Infinity, gaps = 0;
  for (const m of part.measures ?? []) {
    bars++;
    const es = (m.events ?? [])
      .filter((e: any) => e?.type === "note" && !e.grace)
      .sort((a: any, b: any) => Number(a.t) - Number(b.t));
    if (es.length) barsPlayed++;
    let cursor = 0;
    for (const e of es) {
      const d = Number(e.dur);
      snd += d;
      shortest = Math.min(shortest, d);
      if (Number(e.t) > cursor + 1e-9) gaps++;
      cursor = Math.max(cursor, Number(e.t) + d);
    }
    if (es.length && cursor < 4 - 1e-9) gaps++;
  }
  return { ratio: snd / (bars * 4), participation: barsPlayed / bars, shortest, gaps };
}

const BARS = 16;
const res = arrangeStringEnsemble(score(BARS) as any, chords(BARS), {});
const parts: any[] = (res.scoreModel as any).parts ?? [];
const find = (re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

// ── The wall is gone ───────────────────────────────────────────────────────
for (const re of STRINGS) {
  const p = find(re);
  assert.ok(p, `${re} is in the symphonic score`);
  const s = stats(p);
  assert.ok(s.ratio < 0.95,
    `${p.name} sounds ${(100 * s.ratio).toFixed(0)}% of the time; four of five parts were at 100%`);
  assert.ok(s.gaps > 0, `${p.name} has no gap anywhere`);
}

// ── Participation is untouched: the calibration is in bars, not beats ──────
for (const re of STRINGS) {
  const p = find(re);
  const s = stats(p);
  assert.equal(s.participation, 1,
    `${p.name} plays in ${(100 * s.participation).toFixed(0)}% of bars; shortening notes must not change which bars a part appears in — symphonic's enterAt table targets strings at ~100% of measures`);
}

// ── Still no sixteenths written merely to make air ─────────────────────────
{
  for (const re of STRINGS) {
    const s = stats(find(re));
    assert.ok(s.shortest >= 0.5 - 1e-9,
      `${find(re).name} writes a ${s.shortest}-beat note`);
  }

  // The floor only bites on an EIGHTH grid, where three-quarters of a slice
  // snaps down to a sixteenth. A quarter grid cannot show it: half of a quarter
  // is already an eighth, so the quarter-note case above passes with or without
  // the floor and proves nothing about it.
  const eighths: any = {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: Array.from({ length: 8 }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events: Array.from({ length: 8 }, (_, k) => ({
          type: "note", t: k * 0.5, dur: 0.5,
          pitch: { step: STEPS[k], octave: 5, alter: 0 }, id: `e${i}-${k}`,
        })),
      })),
    }],
    meta: {},
  };
  const r = arrangeStringEnsemble(eighths, chords(8), {});
  for (const p of ((r.scoreModel as any).parts ?? [])) {
    if (!STRINGS.some((re) => re.test(String(p.name)))) continue;
    const s = stats(p);
    assert.ok(s.shortest >= 0.5 - 1e-9,
      `${p.name} cut an eighth down to ${s.shortest}; an eighth grid has no room to give`);
  }
}

// ── The upper strings carry more than the bass ─────────────────────────────
{
  const v1 = stats(find(/^violin i\b/i)).ratio;
  const cb = stats(find(/^(double bass|contrabass)/i)).ratio;
  assert.ok(v1 > cb,
    `Violin I should carry more than the bass, got ${(100 * v1).toFixed(0)}% vs ${(100 * cb).toFixed(0)}%`);
}

// ── A bar where the melody rests is played, not held ───────────────────────
{
  const withGap: any = score(8);
  withGap.parts[0].measures[4].events = [];
  const r = arrangeStringEnsemble(withGap, chords(8), {});
  const ps: any[] = (r.scoreModel as any).parts ?? [];
  const v1 = ps.find((p) => /^violin i\b/i.test(String(p.name)))!;
  const es = (v1.measures?.[4]?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
  assert.ok(es.length > 1,
    `a gap bar has ${es.length} attack(s) — one note held through it means no grid`);
}

console.log("PASS symphonic string air");
