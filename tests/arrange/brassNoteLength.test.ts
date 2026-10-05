import assert from "node:assert/strict";
import { arrangeBrassEnsemble } from "../../src/arrange/brass/brassArranger";

/**
 * How long a brass note lasts, and why it differs by instrument.
 *
 * The defect: every note was given the distance to the next onset, so each
 * butted against the one after it and all five parts sounded 92-95% of every
 * bar they played. The reference edition's parts are nothing like that, and
 * nothing like each other — measured within the bars each actually plays, its
 * horn runs ~81%, tuba ~70%, trombone ~59%, second trumpet ~53%, and its first
 * trumpet ~92% because it is dense when it plays at all and simply plays rarely.
 *
 * The wind arranger's single three-quarter share does not port: reading agility
 * the way the winds do would make the TUBA the sustained pad at 0.45 and hold
 * it near 100%, when a brass bass pulses rather than drones.
 */

const KEY = { fifths: 0, mode: "major" as const };

/** A melody source: continuous eighths, so nothing here supplies its own air. */
function source(bars: number) {
  const steps = ["C", "D", "E", "F", "G", "A", "B", "C"];
  return {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: Array.from({ length: bars }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events: Array.from({ length: 8 }, (_, k) => ({
          type: "note", t: k * 0.5, dur: 0.5,
          pitch: { step: steps[k], octave: 5, alter: 0 }, id: `n${i}-${k}`,
        })),
      })),
    }],
    meta: {},
  } as any;
}

const chords = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ measure: i + 1, t: 0, symbol: "C" })) as any;

function stats(part: any) {
  let snd = 0, bars = 0, notes = 0;
  const durs = new Map<number, number>();
  for (const m of part.measures ?? []) {
    bars++;
    for (const e of (m.events ?? [])) {
      if (e?.type !== "note" || e.grace) continue;
      notes++; snd += Number(e.dur);
      durs.set(Number(e.dur), (durs.get(Number(e.dur)) ?? 0) + 1);
    }
  }
  return { ratio: snd / (bars * 4), notes, bars, durs };
}

const BARS = 16;
const res = arrangeBrassEnsemble(source(BARS), chords(BARS), { key: KEY });
const parts: any[] = (res.scoreModel as any).parts ?? [];
const find = (re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

const tuba = find(/^tuba/i);
const tbn = find(/^trombone/i);
const hn = find(/^horn/i);
const tpt2 = find(/^trumpet 2/i);
assert.ok(tuba && tbn && hn && tpt2, "a brass quintet came back");

// ── Nobody is a wall of sound any more ─────────────────────────────────────
for (const p of [tuba, tbn, hn, tpt2]) {
  const r = stats(p).ratio;
  assert.ok(r < 0.85,
    `${p.name} sounds ${(100 * r).toFixed(0)}% of the time; butting notes together gave 92-95%`);
}

// ── The section is a hierarchy, not one density ─────────────────────────────
{
  // Horn is the most sustained of the accompanying voices; the trombone is the
  // most detached. That ordering is the reference's (81% / 59%).
  const h = stats(hn).ratio, t = stats(tbn).ratio;
  assert.ok(h > t + 0.1,
    `the horn should sustain well above the trombone's attacks, got horn ${(100 * h).toFixed(0)}% vs trombone ${(100 * t).toFixed(0)}%`);
}

// ── The trombone plays short attacks ───────────────────────────────────────
{
  const s = stats(tbn);
  const short = (s.durs.get(0.5) ?? 0) + (s.durs.get(0.25) ?? 0);
  assert.ok(short / s.notes > 0.6,
    `the trombone should be mostly eighths or shorter, got ${Math.round(100 * short / s.notes)}%`);
}

// ── The tuba pulses; it does not drone ─────────────────────────────────────
{
  const s = stats(tuba);
  assert.ok(s.ratio < 0.7,
    `the tuba should leave air between its attacks, got ${(100 * s.ratio).toFixed(0)}%`);
  // Two attacks a bar, on beats 1 and 3 — the half-time pulse.
  assert.ok(s.notes / s.bars <= 2.5,
    `the tuba should pulse, not run, got ${(s.notes / s.bars).toFixed(1)} attacks a bar`);
  const onsets = new Set<number>();
  for (const m of tuba.measures ?? []) {
    for (const e of (m.events ?? [])) {
      if (e?.type === "note" && !e.grace) onsets.add(Number(e.t));
    }
  }
  assert.deepEqual([...onsets].sort((a, b) => a - b), [0, 2],
    "the tuba's pulse falls on beats 1 and 3");
  // And no attack swallows the gap to the next one.
  assert.equal(s.durs.get(2) ?? 0, 0, "a two-beat tuba note is a drone, not a pulse");
}

// ── A sustained source is still left sustaining ────────────────────────────
{
  const slow: any = {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: Array.from({ length: 8 }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events: [{ type: "note", t: 0, dur: 4, pitch: { step: "C", octave: 5, alter: 0 }, id: `w${i}` }],
      })),
    }],
    meta: {},
  };
  const r = arrangeBrassEnsemble(slow, chords(8), { key: KEY });
  const ps: any[] = (r.scoreModel as any).parts ?? [];
  const lead = ps.find((p) => /^trumpet 1/i.test(String(p.name)))!;
  assert.ok(stats(lead).ratio > 0.9,
    `whole notes in, whole notes out — got ${(100 * stats(lead).ratio).toFixed(0)}%`);
}

console.log("PASS brass note length");
