import assert from "node:assert/strict";
import {
  gateBrassParticipation,
  participationSentence,
} from "../../src/arrange/brass/participation";

/**
 * Who plays this bar.
 *
 * The defect: all five brass parts sounded in all 124 bars of a chart, zero
 * whole-bar rests, the trumpets working exactly as hard as the tuba. The
 * reference edition is a hierarchy — tuba silent in 1 bar of 124, Horn 1 in 17,
 * Trombone 1 in 22, Trumpet 2 in 69, Trumpet 1 in 84 with rests of 20 and 28
 * bars. Brass endurance is a physical constraint, and the edition's own notes
 * call "keep every player sounding" the tempting wrong answer.
 *
 * The two invariants that keep this safe are asserted below: the tuba never
 * stops, so the bass is always present; and the trumpet keeps every bar where
 * the chart has a tune, so silencing it can never delete the melody.
 */

const NAMES = ["Trumpet 1", "Trumpet 2", "Horn in F", "Trombone", "Tuba"];

/** kinds: "M" melody, "S" slash (a groove), "E" empty. */
function sourceOf(kinds: string): any {
  return {
    measures: [...kinds].map((k, i) => ({
      number: i + 1,
      events:
        k === "E" ? []
        : k === "S"
          ? [{ type: "note", t: 0, dur: 1, notehead: "slash", pitch: { step: "C", octave: 5 } }]
          : [{ type: "note", t: 0, dur: 1, pitch: { step: "C", octave: 5 } }],
    })),
  };
}

/** Five brass parts, every bar carrying one note — the "everyone always" start. */
function brassParts(bars: number): any[] {
  return NAMES.map((name, p) => ({
    part_id: `P${p}`,
    name,
    measures: Array.from({ length: bars }, (_, i) => ({
      number: i + 1,
      events: [{ type: "note", t: 0, dur: 4, pitch: { step: "C", octave: 4 }, id: `${name}-${i}` }],
    })),
  }));
}

const sounds = (part: any, i: number) =>
  (part.measures?.[i]?.events ?? []).some((e: any) => e?.type === "note" && !e.grace);

const silentBars = (part: any) =>
  (part.measures ?? []).reduce((n: number, _m: any, i: number) => n + (sounds(part, i) ? 0 : 1), 0);

const find = (parts: any[], re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

// A tune, then a 6-bar instrumental passage, then a tune again.
const KINDS = "MMMMMMMM" + "SSSEEE" + "MMMMMMMM";

// ── The foundation never stops, and the tune is never deleted ───────────────
{
  const parts = brassParts(KINDS.length);
  gateBrassParticipation(parts, sourceOf(KINDS));

  const tuba = find(parts, /^tuba/i);
  assert.equal(silentBars(tuba), 0, "the tuba carries the piece and never rests");

  // Every melody bar still has the trumpet: it is our only melody carrier.
  const tpt1 = find(parts, /^trumpet 1/i);
  for (let i = 0; i < KINDS.length; i++) {
    if (KINDS[i] !== "M") continue;
    assert.ok(sounds(tpt1, i),
      `bar ${i + 1} has a tune and Trumpet 1 is silent — that deletes the melody`);
  }

  // And something is always playing.
  for (let i = 0; i < KINDS.length; i++) {
    assert.ok(parts.some((p) => sounds(p, i)), `bar ${i + 1} is completely empty`);
  }
}

// ── The trumpets sit out a tune-less passage; the second answers first ──────
{
  const parts = brassParts(KINDS.length);
  gateBrassParticipation(parts, sourceOf(KINDS));
  const tpt1 = find(parts, /^trumpet 1/i);
  const tpt2 = find(parts, /^trumpet 2/i);

  // Bars 8..13 (0-indexed) are the instrumental passage.
  for (let i = 8; i < 14; i++) {
    assert.ok(!sounds(tpt1, i), `Trumpet 1 should be out for bar ${i + 1} of the passage`);
  }
  // Trumpet 2 answers the phrase that just ended, then drops out.
  assert.ok(sounds(tpt2, 8) && sounds(tpt2, 9), "Trumpet 2 answers the first two bars");
  for (let i = 10; i < 14; i++) {
    assert.ok(!sounds(tpt2, i), `Trumpet 2 should be out by bar ${i + 1}`);
  }
}

// ── A one- or two-bar gap is a hiccup, not a rest ───────────────────────────
{
  // Two-bar tune-less gaps only: below the minimum, so nobody drops out for them.
  const kinds = "MMMMMMMM" + "SS" + "MMMMMMMM" + "E" + "MMMMMMMM";
  const parts = brassParts(kinds.length);
  gateBrassParticipation(parts, sourceOf(kinds));
  const tpt1 = find(parts, /^trumpet 1/i);
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === "M") continue;
    assert.ok(sounds(tpt1, i),
      `bar ${i + 1} is a ${kinds[i]} bar in a gap too short to leave; Trumpet 1 dropped out anyway`);
  }
}

// ── The horn breathes a bar at a time, never two running ────────────────────
{
  const kinds = "M".repeat(40);
  const parts = brassParts(kinds.length);
  gateBrassParticipation(parts, sourceOf(kinds));
  const hn = find(parts, /^horn/i);
  const rested = silentBars(hn);
  assert.ok(rested >= 3 && rested <= 8,
    `the horn should take a handful of single bars off over 40, got ${rested}`);
  for (let i = 1; i < kinds.length; i++) {
    assert.ok(sounds(hn, i) || sounds(hn, i - 1),
      `the horn rests two bars running at ${i + 1}; its breath is one bar`);
  }
}

// ── The trombone recedes under the tune, and holds the groove without one ───
{
  const kinds = "M".repeat(16) + "S".repeat(6);
  const parts = brassParts(kinds.length);
  gateBrassParticipation(parts, sourceOf(kinds));
  const tbn = find(parts, /^trombone/i);
  let underTune = 0;
  for (let i = 0; i < 16; i++) if (!sounds(tbn, i)) underTune++;
  assert.ok(underTune > 0, "the trombone should give way under the melody");
  for (let i = 16; i < kinds.length; i++) {
    assert.ok(sounds(tbn, i), `the trombone holds the groove at bar ${i + 1}`);
  }
}

// ── Reporting, and the degenerate cases ─────────────────────────────────────
{
  assert.equal(participationSentence([]), null, "no claim when nobody rests");
  const line = participationSentence([{ part: "Trumpet 1", rested: 61, blocks: 8 }]);
  assert.ok(line && /Trumpet 1 61/.test(line));

  assert.deepEqual(gateBrassParticipation([], sourceOf("MMM")), []);
  assert.deepEqual(gateBrassParticipation(brassParts(3), { measures: [] }), [],
    "no source, no plan");
}

console.log("PASS brass participation");
