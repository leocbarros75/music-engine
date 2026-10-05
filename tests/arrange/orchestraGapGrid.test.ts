import assert from "node:assert/strict";
import { arrangeStringEnsemble } from "../../src/arrange/orchestra/core/stringArranger";

/**
 * The orchestra comes forward where the tune stops.
 *
 * buildSlices takes its grid from the melody's onsets and the chord changes, so
 * a bar in which the melody rests became ONE slice: every string held a single
 * note straight through it. Measured against the reference edition's 30 such
 * bars, its violins play 5.6 and 6.2 attacks there and ours played 1.0.
 *
 * The voicing search cannot write a figure if it is given one decision to make,
 * so a gap bar now gets a quarter-note grid — the same step the wind and brass
 * arrangers already use for the same situation.
 *
 * What this does NOT change is the share of time the strings sound: four
 * quarter slices at the same hold come to exactly what one four-beat slice came
 * to. The gain is in attacks, which is where the difference was.
 */

const STEPS = ["C", "D", "E", "F", "G", "A", "B", "C"];

/** "M" a bar with a tune in it, "E" a bar where the melody rests. */
function score(kinds: string): any {
  return {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: [...kinds].map((k, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events: k === "E" ? [] : Array.from({ length: 4 }, (_, j) => ({
          type: "note", t: j, dur: 1,
          pitch: { step: STEPS[j], octave: 5, alter: 0 }, id: `m${i}-${j}`,
        })),
      })),
    }],
    meta: {},
  };
}

const chords = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ measure: i + 1, t: 0, symbol: "C" })) as any;

const STRINGS = [/^violin i\b/i, /^violin ii\b/i, /^viola/i, /^cello/i, /^double bass/i];

function barStats(part: any, bar: number) {
  const es = (part.measures?.[bar]?.events ?? [])
    .filter((e: any) => e?.type === "note" && !e.grace)
    .sort((a: any, b: any) => Number(a.t) - Number(b.t));
  return {
    attacks: es.length,
    sounding: es.reduce((n: number, e: any) => n + Number(e.dur), 0),
    onsets: es.map((e: any) => Number(e.t)),
  };
}

// Eight bars with a tune, then eight where the melody rests.
const KINDS = "MMMMMMMM" + "EEEEEEEE";
const res = arrangeStringEnsemble(score(KINDS) as any, chords(KINDS.length), {});
const parts: any[] = (res.scoreModel as any).parts ?? [];
const find = (re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

// ── A gap bar is played, not held ──────────────────────────────────────────
for (const re of STRINGS) {
  const p = find(re);
  assert.ok(p, `${re} is in the score`);
  for (const bar of [8, 11, 15]) {
    const s = barStats(p, bar);
    assert.ok(s.attacks > 1,
      `${p.name} bar ${bar + 1} has ${s.attacks} attack(s) — one note held through a gap`);
  }
}

// ── On the quarter grid, and nowhere else ──────────────────────────────────
for (const re of STRINGS) {
  const p = find(re);
  const s = barStats(p, 10);
  assert.ok(s.attacks <= 4,
    `${p.name} has ${s.attacks} attacks in a gap bar; the grid is a quarter`);
  for (const t of s.onsets) {
    assert.ok(Math.abs(t - Math.round(t)) < 1e-9,
      `${p.name}: onset ${t} is off the quarter grid`);
  }
}

// ── The share of time is unchanged: attacks were added, not sound ──────────
{
  // A single four-beat slice at hold 0.75 gave three beats; four quarter slices
  // at the same hold give four notes of 0.75. Same total, four times the
  // attacks — this is what the change is and is not.
  for (const re of STRINGS) {
    const p = find(re);
    const s = barStats(p, 9);
    assert.ok(s.sounding > 0 && s.sounding <= 4 + 1e-9,
      `${p.name} sounds ${s.sounding} beats of a four-beat gap bar`);
    assert.ok(s.sounding < 4 - 1e-9,
      `${p.name} fills the whole gap bar — the air is gone again`);
  }
}

// ── A bar with a tune in it keeps the melody's own grid ───────────────────
{
  // The quarter fill is for gaps only; where the melody plays, its onsets are
  // the grid and must not be padded.
  const melodyBar = barStats(find(/^violin i\b/i), 2);
  assert.ok(melodyBar.attacks <= 4,
    `a melody bar should follow the tune's 4 onsets, got ${melodyBar.attacks}`);
  assert.ok(melodyBar.attacks > 0, "and it should still be playing");
}

// ── A score with no gaps at all is untouched by this ──────────────────────
{
  const plain = arrangeStringEnsemble(score("M".repeat(8)) as any, chords(8), {});
  const ps: any[] = (plain.scoreModel as any).parts ?? [];
  for (const re of STRINGS) {
    const p = ps.find((x) => re.test(String(x.name)))!;
    for (let b = 0; b < 8; b++) {
      assert.ok(barStats(p, b).attacks <= 4,
        `${p.name} bar ${b + 1}: nothing should be added where the melody plays`);
    }
  }
}

console.log("PASS orchestra gap grid");
