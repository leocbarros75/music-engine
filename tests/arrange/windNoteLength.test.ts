import assert from "node:assert/strict";
import { arrangeWoodwindEnsemble } from "../../src/arrange/woodwinds/woodwindArranger";

/**
 * A wind part's rests are its phrasing.
 *
 * The defect these cover: every note was given the distance to the NEXT onset
 * as its duration, so notes butted against each other and the source's silence
 * vanished. A chart written 71% in eighths, silent 42% of its length, came out
 * 57-74% in quarters and sounding 92% of the time. On top of that, the gap-fill
 * invented a quarter-note attack inside every rest longer than a beat — in the
 * melody carrier too, where the rest IS the tune.
 */

const KEY = { fifths: 0, mode: "major" as const };

/**
 * A one-part source: detached eighths on beats 1 and 2, then silence. Each bar
 * is a quarter of sound and three quarters of air.
 */
function source(bars: number) {
  return {
    parts: [{
      part_id: "P1",
      name: "Melody",
      staves: 1,
      measures: Array.from({ length: bars }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 2 },
        events: [
          { type: "note", t: 0,   dur: 0.5, pitch: { step: "C", octave: 5, alter: 0 }, id: `a${i}` },
          { type: "note", t: 0.5, dur: 0.5, pitch: { step: "E", octave: 5, alter: 0 }, id: `b${i}` },
        ],
      })),
    }],
    meta: {},
  } as any;
}

function chordsFor(bars: number) {
  return Array.from({ length: bars }, (_, i) => ({ measure: i + 1, t: 0, symbol: "C" })) as any;
}

/**
 * Counts over a window of bars. A window matters because the upper winds trade
 * the melody every 8 bars, so the flute's own line is only the blocks it keeps.
 */
function stats(part: any, from = 0, to = Infinity) {
  let notes = 0, sounding = 0, total = 0;
  const durs = new Map<number, number>();
  for (const m of (part.measures ?? []).slice(from, to)) {
    for (const e of (m.events ?? [])) {
      if (e?.type !== "note" || e.grace) continue;
      notes++;
      const d = Number(e.dur);
      sounding += d;
      durs.set(d, (durs.get(d) ?? 0) + 1);
    }
    total += 4;
  }
  return { notes, sounding, total, durs, ratio: sounding / total };
}

const BARS = 16;
const res = arrangeWoodwindEnsemble(source(BARS), chordsFor(BARS), { key: KEY });
const parts: any[] = (res.scoreModel as any).parts ?? [];
assert.ok(parts.length >= 4, "a quartet came back");

// ── Nobody sounds through the source's silence ──────────────────────────────
for (const p of parts) {
  const s = stats(p);
  assert.ok(s.ratio < 0.80,
    `${p.name} sounds ${(100 * s.ratio).toFixed(0)}% of the time; the source sounds 25%`);
  // Butting every note against the next gave a solid wall; that must be gone.
  assert.ok(s.ratio < 0.99, `${p.name} is a continuous wall of sound`);
}

// ── The eighths stay eighths ────────────────────────────────────────────────
{
  // The melody carrier follows the source exactly: two eighths a bar, no more.
  // Bars 0-7 are the flute's own block; it lends bars 8-15 to the oboe.
  const flute = parts.find((p) => /^flute/i.test(String(p.name)));
  assert.ok(flute, "there is a flute");
  const s = stats(flute, 0, 8);
  assert.equal(s.notes, 16,
    `the flute should play the source's 2 notes a bar, got ${s.notes / 8}`);
  assert.equal(s.durs.get(0.5), 16, "and every one of them an eighth");
  assert.ok(Math.abs(s.ratio - 0.25) < 1e-6,
    `the flute should sound a quarter of the time like its source, got ${(100 * s.ratio).toFixed(0)}%`);
}

// ── An accompanying voice keeps the harmony present, but detached ───────────
{
  const oboe = parts.find((p) => /^oboe/i.test(String(p.name)));
  assert.ok(oboe, "there is an oboe");
  // Bars 0-7: the oboe is accompanying here, before it borrows the tune.
  const s = stats(oboe, 0, 8);
  // It fills the long rest so the harmony does not disappear ...
  assert.ok(s.notes > 16,
    `the oboe should keep the harmony going through the rest, got ${s.notes}`);
  // ... but each filled attack is short, not stretched to the next one.
  const long = [...s.durs.entries()].filter(([d]) => d >= 1).reduce((n, [, c]) => n + c, 0);
  assert.equal(long, 0, "no filled attack sustains a beat or more");
  // Stretching each attack to the next onset filled the bar completely; the
  // detached version has to leave audible air.
  assert.ok(s.ratio <= 0.75,
    `the oboe should still breathe, got ${(100 * s.ratio).toFixed(0)}%`);
}

// ── A source that sustains is left sustaining ───────────────────────────────
{
  // Whole notes in, whole-ish notes out — the fix must not shorten a slow source.
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
  const r = arrangeWoodwindEnsemble(slow, chordsFor(8), { key: KEY });
  const flute = ((r.scoreModel as any).parts ?? []).find((p: any) => /^flute/i.test(String(p.name)));
  const s = stats(flute);
  assert.ok(s.ratio > 0.9,
    `a sustained source must stay sustained, got ${(100 * s.ratio).toFixed(0)}%`);
  assert.equal(s.durs.get(4), 8, "eight whole notes, one a bar");
}

console.log("PASS wind note length");
