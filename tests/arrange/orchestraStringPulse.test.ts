import assert from "node:assert/strict";
import { arrangeStringEnsemble } from "../../src/arrange/orchestra/core/stringArranger";
import { pulseLowerStrings } from "../../src/arrange/strings/pulse";

/**
 * Under the groove the strings mark time; they do not play through it.
 *
 * Measured in the reference edition's 38 slash bars, its strings split into two
 * groups: the viola takes 2.1 attacks a bar at 91% eighths and the double bass
 * 3.3 at 100% eighths, while its violins and cello stay at 55-58% and are
 * carrying a line. Ours had all five at 66-83% of every slash bar.
 *
 * Its violins thin there too — Violin 1 runs 82% of an empty bar and 80% of a
 * melody bar but 58% of a slash bar — so the whole section gives more air where
 * the chart names a rhythm, not only the inner voices the pulse covers.
 */

const STEPS = ["C", "D", "E", "F", "G", "A", "B", "C"];

/**
 * A source built from a bar-kind string: "M" a tune, "S" a slash groove,
 * "E" nothing at all.
 */
function score(kinds: string): any {
  return {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: [...kinds].map((k, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events:
          k === "E" ? []
          : k === "S"
            // A groove the chart states, close-packed so the slices it makes
            // actually tile. A sparse figure like [0, 1, 3.5] leaves air of its
            // own, and then there is nothing for the groove share to take —
            // which is correct behaviour and tests nothing.
            ? [0, 0.5, 1].map((t, j) => ({
                type: "note", t, dur: 0.5, notehead: "slash",
                pitch: { step: "C", octave: 5, alter: 0 }, id: `s${i}-${j}`,
              }))
            : Array.from({ length: 4 }, (_, j) => ({
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

const find = (parts: any[], re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

/** Sounding share and attack count over a window of bars. */
function dens(part: any, from: number, to: number) {
  let snd = 0, notes = 0, bars = 0, longest = 0;
  for (const m of (part.measures ?? []).slice(from, to)) {
    bars++;
    for (const e of (m.events ?? [])) {
      if (e?.type !== "note" || e.grace) continue;
      notes++; snd += Number(e.dur); longest = Math.max(longest, Number(e.dur));
    }
  }
  return { ratio: snd / (bars * 4), perBar: notes / bars, longest };
}

// 8 melody bars, 8 slash bars, 8 empty bars.
const KINDS = "MMMMMMMM" + "SSSSSSSS" + "EEEEEEEE";
const res = arrangeStringEnsemble(score(KINDS) as any, chords(KINDS.length), {});
const parts: any[] = (res.scoreModel as any).parts ?? [];
const vla = find(parts, /^viola/i);
const cb = find(parts, /^double bass/i);
const v1 = find(parts, /^violin i\b/i);

// ── The inner and lowest strings mark the groove ───────────────────────────
{
  const groove = dens(vla, 8, 16);
  const tune = dens(vla, 0, 8);
  assert.ok(groove.ratio < tune.ratio,
    `the viola should thin under the groove: ${(100 * groove.ratio).toFixed(0)}% vs ${(100 * tune.ratio).toFixed(0)}% under the tune`);
  assert.ok(groove.perBar <= 3.5,
    `and mark the chart's rhythm, not run through it — got ${groove.perBar.toFixed(1)} attacks a bar`);
  assert.ok(groove.longest <= 0.5 + 1e-9,
    `its attacks should be eighths, longest was ${groove.longest}`);

  const bass = dens(cb, 8, 16);
  assert.ok(bass.longest <= 0.5 + 1e-9, "the bass pulses in eighths too");
}

// ── The violins keep the line, but give more air there ─────────────────────
{
  const groove = dens(v1, 8, 16);
  const tune = dens(v1, 0, 8);
  assert.ok(groove.ratio < tune.ratio,
    `Violin I should thin under the groove too: ${(100 * groove.ratio).toFixed(0)}% vs ${(100 * tune.ratio).toFixed(0)}%`);
  // But it is not pulsed down to the chart's bare rhythm — it is still a line.
  assert.ok(groove.ratio > dens(vla, 8, 16).ratio,
    "the violin carries more than the viola under the groove");
}

// ── A bar the source leaves empty is a gap, not a groove ───────────────────
{
  // Carrying the feel into empty bars thinned the orchestra's viola to 28% of
  // them, where the reference has it at 75% and sustaining.
  const gap = dens(vla, 16, 24);
  const groove = dens(vla, 8, 16);
  assert.ok(gap.ratio > groove.ratio,
    `the viola should be fuller in an instrumental gap (${(100 * gap.ratio).toFixed(0)}%) than under a groove (${(100 * groove.ratio).toFixed(0)}%)`);
  assert.ok(gap.longest > 0.5,
    "and it should be allowed a longer note there, not kept to pulse eighths");
}

// ── A score with no slashes is left alone ──────────────────────────────────
{
  const plain = arrangeStringEnsemble(score("M".repeat(16)) as any, chords(16), {});
  const ps: any[] = (plain.scoreModel as any).parts ?? [];
  assert.ok(!(plain.warnings ?? []).some((w: string) => /chart's own rhythm/.test(w)),
    "isChart should keep the pulse away from a written score");
  // The attacks stay on the slice grid — four a bar here — rather than being
  // replaced by a rhythm the source never wrote. (Their LENGTHS still come
  // from giveStringsAir; that is a different pass and not what this checks.)
  assert.ok(dens(find(ps, /^viola/i), 0, 16).perBar >= 4,
    "a written score keeps its own onsets; no groove was imposed on it");
}

// ── The ensemble route's own behaviour is unchanged ────────────────────────
{
  // Default: cello and bass only, and the feel DOES carry through empty bars —
  // that is the point there, and the new options must not alter it.
  const mk = (name: string) => ({
    part_id: name, name,
    measures: [...KINDS].map((_k, i) => ({
      number: i + 1,
      events: [{ type: "note", t: 0, dur: 4, pitch: { step: "C", octave: 3, alter: 0 }, id: `${name}-${i}` }],
    })),
  });
  const ps = [mk("Violin I"), mk("Viola"), mk("Cello"), mk("Double Bass")];
  const plans = pulseLowerStrings(ps, score(KINDS).parts[0]);
  const named = plans.map((p) => p.part).sort();
  assert.deepEqual(named, ["Cello", "Double Bass"],
    "by default only the cello and the bass pulse");
  // The feel carries past the slash bars into the empty ones.
  const bassPlan = plans.find((p) => p.part === "Double Bass")!;
  assert.ok(bassPlan.bars > 8,
    `the carried feel should reach past the 8 slash bars, got ${bassPlan.bars}`);
}

console.log("PASS orchestra string pulse");
