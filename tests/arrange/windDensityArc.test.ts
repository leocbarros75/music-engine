import assert from "node:assert/strict";
import { arrangeWoodwindEnsemble } from "../../src/arrange/woodwinds/woodwindArranger";

/**
 * Density follows context, not one constant.
 *
 * Measured per bar type against the reference edition of a 124-bar chart, its
 * wind parts are not uniformly dense — they invert by role. Where the chart
 * gives nothing, the flute leads (72% of the bar sounding) and the oboe recedes
 * (52%). Where the music is, the accompanying voices support (66-76%).
 *
 * Ours had the arc backwards: 94-95% in every part through the 30 bars the
 * source leaves empty — four quarter-notes jammed together, 4.0 a bar, in all
 * four parts at once — and 53-58% where the music actually was. The overall
 * figure hid it: the oboe's 65% against the reference's 70% looked like a small
 * shortfall and was really two opposite errors cancelling.
 */

const KEY = { fifths: 0, mode: "major" as const };

/**
 * The default wind texture's activity levels. These matter here: "less_active"
 * thins a voice to the on-beat grid, and it is only on that coarser grid that
 * copying the melody's eighth-note lengths into the harmony shows up as a
 * shortfall. Leaving them out gives every voice the melody's own dense grid,
 * where the bug is invisible.
 */
const ACTIVITY = {
  fl: "active", ob: "less_active", cl: "less_active",
  hn: "grounded", bn: "less_active",
} as const;

type Bar = { kind: "empty" | "melody" | "slash" };

function source(bars: Bar[]) {
  return {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: bars.map((b, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 2 },
        events:
          b.kind === "empty" ? []
          : b.kind === "melody"
            // a continuous tune: eighths all the way across
            ? Array.from({ length: 8 }, (_, k) => ({
                type: "note", t: k * 0.5, dur: 0.5,
                pitch: { step: ["C","D","E","F","G","A","B","C"][k], octave: 5, alter: 0 },
                id: `m${i}-${k}`,
              }))
            // a slash bar: the chart naming a groove, four chord hits
            : Array.from({ length: 4 }, (_, k) => ({
                type: "note", t: k, dur: 0.5, notehead: "slash",
                pitch: { step: "C", octave: 5, alter: 0 },
                id: `s${i}-${k}`,
              })),
      })),
    }],
    meta: {},
  } as any;
}

const chords = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ measure: i + 1, t: 0, symbol: "C" })) as any;

/** Sounding share of time, and notes per bar, over a window. */
function density(part: any, from: number, to: number) {
  let notes = 0, snd = 0, bars = 0, longest = 0;
  for (const m of (part.measures ?? []).slice(from, to)) {
    bars++;
    for (const e of (m.events ?? [])) {
      if (e?.type !== "note" || e.grace) continue;
      notes++; snd += Number(e.dur);
      longest = Math.max(longest, Number(e.dur));
    }
  }
  return { ratio: snd / (bars * 4), perBar: notes / bars, longest };
}

// 8 empty bars, then 8 melody bars, then 8 slash bars. Blocks of 8 line up with
// the melody rotation, so the flute keeps the first block and lends the second.
const BARS: Bar[] = [
  ...Array.from({ length: 8 }, () => ({ kind: "empty" as const })),
  ...Array.from({ length: 8 }, () => ({ kind: "melody" as const })),
  ...Array.from({ length: 8 }, () => ({ kind: "slash" as const })),
];
const res = arrangeWoodwindEnsemble(source(BARS), chords(BARS.length), { key: KEY, activity: ACTIVITY as any });
const parts: any[] = (res.scoreModel as any).parts ?? [];
const flute = parts.find((p) => /^flute/i.test(String(p.name)));
const oboe = parts.find((p) => /^oboe/i.test(String(p.name)));
const bassoon = parts.find((p) => /^bassoon/i.test(String(p.name)));
assert.ok(flute && oboe && bassoon, "a quartet came back");

// ── Where the source is silent, nobody plays a wall of quarters ─────────────
for (const p of [flute, oboe, bassoon]) {
  const d = density(p, 0, 8);
  assert.ok(d.ratio < 0.85,
    `${p.name} sounds ${(100 * d.ratio).toFixed(0)}% of an empty bar; that is a wall`);
  assert.ok(d.longest < 1.0,
    `${p.name} holds a ${d.longest}-beat note in a gap; filled attacks must stay detached`);
}

// ── In that gap the roles invert: the melody leads, the others recede ───────
{
  const lead = density(flute, 0, 8);
  const acc = density(oboe, 0, 8);
  assert.ok(lead.ratio > acc.ratio + 0.1,
    `the flute should lead the instrumental gap: flute ${(100 * lead.ratio).toFixed(0)}% vs oboe ${(100 * acc.ratio).toFixed(0)}%`);
  // The reference's figures for an empty bar: flute 72%, oboe 52%.
  assert.ok(lead.ratio >= 0.6 && lead.ratio <= 0.85,
    `the flute's gap density should sit near the reference's 72%, got ${(100 * lead.ratio).toFixed(0)}%`);
  assert.ok(acc.ratio >= 0.35 && acc.ratio <= 0.65,
    `the oboe should recede to near the reference's 52%, got ${(100 * acc.ratio).toFixed(0)}%`);
}

// ── Where the music is, the accompanying voices support rather than thin ────
{
  // The BASSOON, because it is never in the melody rotation. Asserting on the
  // oboe here measured nothing: bars 8-15 are the block the flute lends it, so
  // the oboe is holding the tune there, not accompanying, and it read 100% both
  // with this rule and without it.
  const inGap = density(bassoon, 0, 8);
  const underMusic = density(bassoon, 8, 16);
  assert.ok(underMusic.ratio > inGap.ratio,
    `the bassoon should be fuller under the music (${(100 * underMusic.ratio).toFixed(0)}%) than in a gap (${(100 * inGap.ratio).toFixed(0)}%)`);
  // The reference's accompanying voices run 66-76% where the music is; copying
  // the melody's own short note lengths into the harmony left ours at 53-58%.
  assert.ok(underMusic.ratio >= 0.6,
    `the bassoon should support near the reference's 71%, got ${(100 * underMusic.ratio).toFixed(0)}%`);
}

// ── Over a groove the melody holds a note; it does not drum along ───────────
{
  // Bars 16-23 are slash bars, and bar 16 starts a block the flute keeps.
  const d = density(flute, 16, 24);
  assert.ok(d.perBar <= 2.5,
    `the flute should thin over a groove, got ${d.perBar.toFixed(1)} attacks a bar against the chart's 4`);
  assert.ok(d.longest >= 1.0,
    `and hold them: longest note ${d.longest} beats`);
}

// ── A sustained source is still left sustaining ─────────────────────────────
{
  const slow: any = {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: Array.from({ length: 8 }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 2 },
        events: [{ type: "note", t: 0, dur: 4, pitch: { step: "C", octave: 5, alter: 0 }, id: `w${i}` }],
      })),
    }],
    meta: {},
  };
  const r = arrangeWoodwindEnsemble(slow, chords(8), { key: KEY, activity: ACTIVITY as any });
  const fl = ((r.scoreModel as any).parts ?? []).find((p: any) => /^flute/i.test(String(p.name)));
  assert.ok(density(fl, 0, 8).ratio > 0.9, "whole notes in, whole notes out");
}

console.log("PASS wind density arc");
