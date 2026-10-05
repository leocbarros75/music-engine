import assert from "node:assert/strict";
import { arrangeWoodwindEnsemble } from "../../src/arrange/woodwinds/woodwindArranger";

/**
 * The tune breathes at the end of the bar.
 *
 * This one deletes melody notes, so it is the most dangerous pass here and the
 * gate matters more than the effect.
 *
 * What the evidence supports: in the reference edition's 56 melody bars, beat 3
 * is silent in 44 of them and beat 3.5 in 35, against 6 at beat 1 — and it drops
 * whatever sits on the last beat about 69% of the time. What the evidence does
 * NOT support is a strong-beat rule: which onsets it keeps elsewhere is nearly
 * flat by position, 31% to 55%, so thinning mid-bar would be invention dressed
 * as measurement. Only the end-of-bar breath is implemented.
 *
 * The gate is "dense AND unbroken". A chart melody that runs wall to wall gives
 * the player no air; a hymn in whole notes is unbroken too but hands them one
 * note a bar to shape, and carving a beat out of every bar would mangle it.
 */

const KEY = { fifths: 0, mode: "major" as const };
const ACTIVITY = {
  fl: "active", ob: "less_active", cl: "less_active",
  hn: "grounded", bn: "less_active",
} as const;

const STEPS = ["C", "D", "E", "F", "G", "A", "B", "C"];

/** One source part, same bar repeated, built from explicit (t, dur) pairs. */
function source(bars: number, notes: Array<[number, number]>) {
  return {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: Array.from({ length: bars }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events: notes.map(([t, dur], k) => ({
          type: "note", t, dur,
          pitch: { step: STEPS[k % STEPS.length], octave: 5, alter: 0 },
          id: `n${i}-${k}`,
        })),
      })),
    }],
    meta: {},
  } as any;
}

const chords = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ measure: i + 1, t: 0, symbol: "C" })) as any;

function flute(score: any) {
  const r = arrangeWoodwindEnsemble(score, chords((score.parts[0].measures ?? []).length),
    { key: KEY, activity: ACTIVITY as any });
  return ((r.scoreModel as any).parts ?? []).find((p: any) => /^flute/i.test(String(p.name)));
}

/** Is anything sounding at time t in this bar? */
function soundingAt(measure: any, t: number): boolean {
  return (measure.events ?? []).some((e: any) =>
    e?.type === "note" && !e.grace &&
    Number(e.t) <= t + 1e-6 && t < Number(e.t) + Number(e.dur) - 1e-6);
}

function ratio(part: any, from: number, to: number) {
  let snd = 0, bars = 0;
  for (const m of (part.measures ?? []).slice(from, to)) {
    bars++;
    for (const e of (m.events ?? [])) {
      if (e?.type === "note" && !e.grace) snd += Number(e.dur);
    }
  }
  return snd / (bars * 4);
}

// Eight eighths: a tune that never stops. Bars 0-7 are the flute's own block.
const WALL: Array<[number, number]> = Array.from({ length: 8 }, (_, k) => [k * 0.5, 0.5]);

// ── A tune that never stops is given air at the end of the bar ──────────────
{
  const fl = flute(source(8, WALL));
  let breathed = 0;
  for (const m of (fl.measures ?? []).slice(0, 8)) {
    if (!soundingAt(m, 3.5)) breathed++;
  }
  assert.equal(breathed, 8, "every wall-to-wall bar should breathe before the barline");
  // The source sounds 100%; the breath must actually reduce that.
  const r = ratio(fl, 0, 8);
  assert.ok(r <= 0.80, `the flute should fall well under the source's 100%, got ${(100 * r).toFixed(0)}%`);
  assert.ok(r >= 0.55, `but it must still carry the tune, got ${(100 * r).toFixed(0)}%`);
}

// ── A note that began earlier does not sound through the breath ─────────────
{
  // Three attacks — a stream by the gate's reckoning — where the last is held
  // for three beats and runs right to the barline.
  const fl = flute(source(8, [[0, 0.5], [0.5, 0.5], [1, 3]]));
  for (const [i, m] of (fl.measures ?? []).slice(0, 8).entries()) {
    assert.ok(!soundingAt(m, 3.5),
      `bar ${i + 1}: a long note held straight through the breath`);
  }
}

// ── A source that already rests is phrased already: leave it alone ──────────
{
  // Two eighths, a long rest, then a pickup on the last beat. The player has
  // air without help, and that final note is exactly what an end-of-bar breath
  // would delete — so it is the note that proves the gate is doing its job.
  const notes: Array<[number, number]> = [[0, 0.5], [0.5, 0.5], [3, 0.5]];
  const fl = flute(source(8, notes));
  for (const m of (fl.measures ?? []).slice(0, 8)) {
    const onsets = (m.events ?? [])
      .filter((e: any) => e?.type === "note" && !e.grace)
      .map((e: any) => Number(e.t));
    assert.deepEqual(onsets.sort((a: number, b: number) => a - b), [0, 0.5, 3],
      "the melody keeps exactly the source's onsets when the source already rests");
  }
}

// ── A hymn in whole notes keeps its whole notes ─────────────────────────────
{
  const fl = flute(source(8, [[0, 4]]));
  const r = ratio(fl, 0, 8);
  assert.ok(r > 0.9,
    `whole notes in, whole notes out — got ${(100 * r).toFixed(0)}%. Unbroken is not the same as dense.`);
  for (const m of (fl.measures ?? []).slice(0, 8)) {
    assert.ok(soundingAt(m, 3.5), "a whole note must not be cut short at the barline");
  }
}

// ── Two half notes a bar is not a stream either ─────────────────────────────
{
  const fl = flute(source(8, [[0, 2], [2, 2]]));
  const r = ratio(fl, 0, 8);
  assert.ok(r > 0.9,
    `two half notes a bar should survive intact, got ${(100 * r).toFixed(0)}%`);
}

console.log("PASS wind phrasing");
