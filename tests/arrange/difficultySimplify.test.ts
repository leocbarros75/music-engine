import assert from "node:assert/strict";
import { simplifyForLevel } from "../../src/arrange/difficulty/simplify";
import { bandFor, playableRange } from "../../src/arrange/difficulty/levels";
import { pitchToMidi, midiToPitch, getInstrumentSpec } from "../../src/instruments/instrumentCatalog";

/**
 * A part the player in front of you can actually read, beside the one written
 * for a professional.
 *
 * The `level` setting had been in the web UI for a long time and, measured
 * across four levels on the same source, changed nothing for seven of eight
 * ensembles. This is the pass that gives it a meaning, and it moves REGISTER
 * only: every note keeps its pitch class, its onset and its duration.
 *
 * The professional part is never touched — the simplified line is added beside
 * it, the way a publisher prints an alternate.
 */

const MAP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (e: any): number | null => {
  if (!e?.pitch) return null;
  const s = MAP[String(e.pitch.step).toUpperCase()];
  if (s === undefined) return null;
  return 12 * (Number(e.pitch.octave) + 1) + s + Number(e.pitch.alter ?? 0);
};

/** A part whose notes are exactly the midi values given, one per bar. */
function part(part_id: string, name: string, instrument: string, midis: number[]): any {
  return {
    part_id, name, instrument, staves: 1,
    measures: midis.map((m, i) => ({
      number: i + 1,
      attributes: { time: { beats: 4, beat_type: 4 }, divisions: 480 },
      events: [{ id: `${part_id}-${i}`, t: 0, dur: 4, type: "note", pitch: midiToPitch(m), voice: 1, staff: 1 }],
    })),
  };
}

function notesOf(p: any): number[] {
  const out: number[] = [];
  for (const m of p?.measures ?? []) for (const e of (m?.events ?? [])) {
    const v = midiOf(e);
    if (v !== null) out.push(v);
  }
  return out;
}
const find = (parts: any[], name: string) => parts.find((p) => String(p.name) === name);

// A first trumpet sitting well above a beginner's band (53-70 concert).
const HIGH_TRUMPET = [72, 74, 76, 75, 73, 72, 74, 76];
// A trombone already inside its beginner band (41-58).
const EASY_TROMBONE = [45, 47, 48, 50, 47, 45, 48, 50];

function score(): any[] {
  return [
    part("TPT1", "Trumpet 1", "trumpet_bb_1", HIGH_TRUMPET),
    part("TBN", "Trombone", "trombone", EASY_TROMBONE),
  ];
}

// ── professional, and no level at all, change nothing ──
{
  for (const levels of [{ default: "professional" as const }, {}, { default: undefined }]) {
    const parts = score();
    const before = JSON.stringify(parts);
    const plans = simplifyForLevel(parts, levels as any);
    assert.equal(plans.length, 0, "a professional part needs no alternate");
    assert.equal(parts.length, 2, "no part should be added");
    assert.equal(JSON.stringify(parts), before, "the score must be untouched");
  }
}

// ── A part that is too high gets an alternate; the original is untouched ──
{
  const parts = score();
  const plans = simplifyForLevel(parts, { default: "beginner" });

  assert.equal(plans.length, 1, `only the trumpet needs help, got ${plans.map((p) => p.part)}`);
  assert.equal(plans[0]!.part, "Trumpet 1");

  // The original is byte-for-byte what it was.
  assert.deepEqual(notesOf(find(parts, "Trumpet 1")), HIGH_TRUMPET, "the professional part must not move");

  const alt = find(parts, "Trumpet 1 (simplified)");
  assert.ok(alt, "an alternate part should have been added");
  assert.notEqual(alt.part_id, "TPT1", "the alternate needs its own part id");
  // Directly after the part it stands in for, as a publisher prints it.
  assert.equal(parts.indexOf(alt), parts.indexOf(find(parts, "Trumpet 1")) + 1);

  const band = bandFor("trumpet_bb_1", "beginner")!;
  for (const v of notesOf(alt)) {
    assert.ok(v >= band.lo && v <= band.hi, `${v} is outside the beginner band ${band.lo}-${band.hi}`);
  }
}

// ── A part already in its band gets nothing ──
{
  // Adding a copy of a part that needed no change would double the score for
  // no reason, and would tell the director something untrue about the part.
  const parts = score();
  simplifyForLevel(parts, { default: "beginner" });
  assert.equal(find(parts, "Trombone (simplified)"), undefined, "an easy part needs no alternate");
}

// ── Only the octave moves ──
{
  const parts = score();
  simplifyForLevel(parts, { default: "beginner" });
  const alt = notesOf(find(parts, "Trumpet 1 (simplified)"));
  assert.equal(alt.length, HIGH_TRUMPET.length, "no note may be added or dropped");
  alt.forEach((v, i) => {
    const was = HIGH_TRUMPET[i]!;
    assert.equal(
      ((v % 12) + 12) % 12, ((was % 12) + 12) % 12,
      `note ${i} changed pitch class: ${was} -> ${v}`
    );
    assert.equal((was - v) % 12, 0, `note ${i} moved by something other than an octave`);
  });
  // And every bar that sounded still sounds.
  const src = find(parts, "Trumpet 1");
  const altPart = find(parts, "Trumpet 1 (simplified)");
  for (let b = 0; b < src.measures.length; b++) {
    const had = (src.measures[b].events ?? []).filter((e: any) => e.type === "note").length;
    const has = (altPart.measures[b].events ?? []).filter((e: any) => e.type === "note").length;
    assert.equal(has, had, `bar ${b + 1} lost its notes`);
  }
}

// ── Never a note the instrument cannot play ──
{
  // The band is a target; the instrument's own range is a wall.
  //
  // It takes a line WIDER than the instrument to test the wall. The timpani
  // plays 38-57 — nineteen semitones — so a part spanning three octaves cannot
  // be brought inside by any single octave shift, and whatever is left over has
  // to be pulled back note by note. A part that fits would never reach the wall
  // at all and would pass this test with the wall deleted.
  const hard = playableRange("timpani")!;
  assert.ok(hard.hi - hard.lo < 24, "this test needs an instrument narrower than the line");
  const wide = [30, 42, 54, 66, 78, 48, 36, 72];
  const parts = [part("TIMP", "Timpani", "timpani", wide)];
  simplifyForLevel(parts, { default: "beginner" });
  const alt = find(parts, "Timpani (simplified)");
  assert.ok(alt, "a part this far outside the band should get an alternate");
  for (const v of notesOf(alt)) {
    assert.ok(v >= hard.lo && v <= hard.hi, `${v} is off the instrument (${hard.lo}-${hard.hi})`);
  }
}

// ── The octave is chosen for the LINE, not for each note ──
{
  // Two faults already made in this codebase: picking each note's octave
  // separately collapsed a derived saxophone line to three semitones, and
  // treating an out-of-range note as disqualifying stranded 392 notes an octave
  // high because 14 of them would have dropped under the horn. A line that
  // sits squarely in the band must not be dragged out of it by a few outliers.
  const settled = Array.from({ length: 40 }, (_, i) => 60 + (i % 8)); // 60-67, inside 53-70
  const parts = [part("T", "Trumpet 1", "trumpet_bb_1", [...settled, 84, 86])];
  const plans = simplifyForLevel(parts, { default: "beginner" });
  assert.equal(plans[0]?.lineShift, 0, "forty settled notes must not follow two outliers");
  const alt = find(parts, "Trumpet 1 (simplified)");
  const kept = notesOf(alt).slice(0, settled.length);
  assert.deepEqual(kept, settled, "the settled part of the line should not move at all");
}

// ── A per-part level overrides the score default ──
{
  // The real case is one weak player, not a weak orchestra.
  const parts = score();
  const plans = simplifyForLevel(parts, {
    default: "professional",
    byPart: { "Trumpet 1": "beginner" },
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0]!.part, "Trumpet 1");
  assert.ok(find(parts, "Trumpet 1 (simplified)"), "the named part should be simplified");
  assert.equal(find(parts, "Trombone (simplified)"), undefined, "others keep the default");

  // And by part_id, since that is what a UI table would send.
  const byId = score();
  assert.equal(simplifyForLevel(byId, { byPart: { TPT1: "beginner" } }).length, 1);
}

// ── Running twice does not stack alternates ──
{
  const parts = score();
  simplifyForLevel(parts, { default: "beginner" });
  const after = parts.length;
  simplifyForLevel(parts, { default: "beginner" });
  assert.equal(parts.length, after, "a second pass must not simplify the simplified part");
}

// ── The band narrows as the level drops ──
{
  const spec = getInstrumentSpec("trumpet_bb_1")!;
  const beg = bandFor("trumpet_bb_1", "beginner")!;
  const int = bandFor("trumpet_bb_1", "intermediate")!;
  const adv = bandFor("trumpet_bb_1", "advanced")!;
  assert.equal(bandFor("trumpet_bb_1", "professional"), null, "a professional has no ceiling");
  assert.ok(beg.hi < int.hi && int.hi <= adv.hi, `bands should widen: ${beg.hi} < ${int.hi} <= ${adv.hi}`);
  assert.ok(adv.hi <= spec.midi_high && adv.lo >= spec.midi_low, "even advanced stays on the instrument");
  // The piano has its own level handling inside applyAppSettings already.
  assert.equal(bandFor("piano", "beginner"), null, "the piano is excluded from this pass");
}

console.log("difficultySimplify: ok");
