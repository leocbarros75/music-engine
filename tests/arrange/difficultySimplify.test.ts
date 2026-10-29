import assert from "node:assert/strict";
import { simplifyForLevel } from "../../src/arrange/difficulty/simplify";
import { quantizeToGrid } from "../../src/arrange/difficulty/rhythm";
import { bandFor, playableRange, gridFor, breathCapFor } from "../../src/arrange/difficulty/levels";
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

  // The trombone may also get an alternate — it holds whole notes for eight
  // bars and Phase 2 gives it air — so this is about CAUSE, not count: only
  // the trumpet should have been re-octaved.
  const tpt = plans.find((p) => p.part === "Trumpet 1");
  const tbn = plans.find((p) => p.part === "Trombone");
  assert.ok(tpt && tpt.moved > 0, "the high trumpet should be brought down");
  assert.equal(tbn?.moved ?? 0, 0, "a trombone already in its band must not be re-octaved");

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
  //
  // It has to be a part that needs nothing on ANY of the three counts: in its
  // band, already on the grid, and not an instrument anyone blows into — a
  // violist does not run out of breath. The trombone of the other fixtures
  // fails the third and rightly gets air.
  const easy = [part("VLA", "Viola", "viola", [50, 52, 54, 55, 54, 52, 50, 52])];
  const plans = simplifyForLevel(easy, { default: "beginner" });
  assert.deepEqual(plans, [], `a part needing nothing should get no alternate, got ${plans.map((p) => p.part)}`);
  assert.equal(easy.length, 1, "no part should have been added");
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
  assert.equal(plans.length, 1, `only the named part should be simplified, got ${plans.map((p) => p.part)}`);
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

// ── PHASE 2: rhythm goes on a grid ──
{
  // A grid, not a minimum note length. Measured on the real output a
  // minimum-length rule would have done almost nothing — sixteenths are 1% of
  // the notes — while dotted eighths are a fifth of the brass and orchestra and
  // 36% of the jazz band's onsets fall off the beat. A grid catches a note that
  // is too short, one that starts off the beat, and a dotted figure, together.
  const bar = (events: any[]) => ({
    number: 1,
    attributes: { time: { beats: 4, beat_type: 4 }, divisions: 480 },
    events,
  });
  const n = (t: number, dur: number, midi: number, id: string) =>
    ({ id, t, dur, type: "note", pitch: midiToPitch(midi), voice: 1, staff: 1 });

  // Beat 1 dotted-eighth + sixteenth, beat 2 off-beat eighth, beat 3 a quarter.
  const p = {
    part_id: "X", name: "Viola", instrument: "viola", staves: 1,
    measures: [bar([n(0, 0.75, 55, "a"), n(0.75, 0.25, 57, "b"), n(1.5, 0.5, 59, "c"), n(3, 1, 60, "d")])],
  };
  const plan = quantizeToGrid(p, 1);
  const ev = (p.measures[0].events as any[]).slice().sort((x, y) => x.t - y.t);

  assert.deepEqual(ev.map((e) => e.t), [0, 1, 3], "every attack should land on a beat");
  assert.equal(plan.dropped, 1, "the sixteenth inside beat 1 is absorbed by the note that began it");
  assert.deepEqual(ev.map((e) => midiOf(e)), [55, 59, 60], "the note that began each slot survives");
  for (const e of ev) {
    assert.ok(Number.isInteger(e.t), `onset ${e.t} is not on the beat`);
    assert.ok(e.dur >= 1 - 1e-9, `duration ${e.dur} is shorter than the grid`);
  }
  // Nothing may overlap the next attack.
  for (let i = 0; i < ev.length - 1; i++) {
    assert.ok(ev[i]!.t + ev[i]!.dur <= ev[i + 1]!.t + 1e-9, "a simplified part must not overlap itself");
  }
}

// ── Quantizing never silences a bar that sounded ──
{
  const bar = (events: any[]) => ({
    number: 1, attributes: { time: { beats: 4, beat_type: 4 }, divisions: 480 }, events,
  });
  const n = (t: number, dur: number, midi: number, id: string) =>
    ({ id, t, dur, type: "note", pitch: midiToPitch(midi), voice: 1, staff: 1 });
  // Everything crammed into the first beat: the whole bar maps to one slot.
  const p = {
    part_id: "Y", name: "Viola", instrument: "viola", staves: 1,
    measures: [bar([n(0, 0.25, 55, "a"), n(0.25, 0.25, 56, "b"), n(0.5, 0.25, 57, "c")])],
  };
  quantizeToGrid(p, 1);
  assert.equal((p.measures[0].events as any[]).length, 1, "one slot, one attack");
  assert.ok((p.measures[0].events as any[]).length > 0, "a bar that sounded must still sound");
}

// ── A chord keeps all of its notes ──
{
  // Thinning a chord is a question about harmony, not about rhythm.
  const bar = (events: any[]) => ({
    number: 1, attributes: { time: { beats: 4, beat_type: 4 }, divisions: 480 }, events,
  });
  const n = (t: number, dur: number, midi: number, id: string) =>
    ({ id, t, dur, type: "note", pitch: midiToPitch(midi), voice: 1, staff: 1 });
  const p = {
    part_id: "Z", name: "Viola", instrument: "viola", staves: 1,
    measures: [bar([n(0, 1, 55, "a"), n(0, 1, 59, "b"), n(0, 1, 62, "c")])],
  };
  quantizeToGrid(p, 1);
  assert.equal((p.measures[0].events as any[]).length, 3, "a chord is one attack, not one note");
}

// ── The grid widens as the level rises, and a professional has none ──
{
  assert.equal(gridFor("professional"), null, "a professional reads what is written");
  assert.equal(breathCapFor("professional"), null);
  const b = gridFor("beginner")!, i = gridFor("intermediate")!, a = gridFor("advanced")!;
  assert.ok(b > i && i > a, `the grid should get finer with level: ${b} > ${i} > ${a}`);
  assert.ok(breathCapFor("beginner")! < breathCapFor("advanced")!, "a beginner needs air sooner");
}

// ── PHASE 2: a part that never stops is given air ──
{
  // Eight bars of whole notes is 32 beats without a breath. A trombonist at
  // beginner may be asked for four.
  const parts = [part("TBN", "Trombone", "trombone", [45, 47, 48, 50, 47, 45, 48, 50])
    ];
  for (const m of parts[0]!.measures) m.events[0].dur = 4;
  const plans = simplifyForLevel(parts, { default: "beginner" });
  const plan = plans.find((p) => p.part === "Trombone");
  assert.ok(plan, "a part holding 32 beats should get an alternate");
  assert.ok(plan!.breaths > 0, "it should be given breath rests");
  assert.ok(
    plan!.longestHold <= breathCapFor("beginner")! + 1e-6,
    `longest hold ${plan!.longestHold} exceeds the beginner cap of ${breathCapFor("beginner")}`
  );
  assert.equal(plan!.moved, 0, "its register was already fine — this alternate is about air");
}

// ── The grid is actually WIRED INTO the pass, not just unit-tested ──
{
  // Every grid test above calls quantizeToGrid directly, so deleting the call
  // inside simplifyForLevel passed all of them. This is the one that fails.
  const off = {
    part_id: "VL", name: "Violin I", instrument: "violin_1", staves: 1,
    measures: Array.from({ length: 4 }, (_, i) => ({
      number: i + 1,
      attributes: { time: { beats: 4, beat_type: 4 }, divisions: 480 },
      events: [
        { id: `a${i}`, t: 0, dur: 0.75, type: "note", pitch: midiToPitch(62), voice: 1, staff: 1 },
        { id: `b${i}`, t: 0.75, dur: 0.25, type: "note", pitch: midiToPitch(64), voice: 1, staff: 1 },
        { id: `c${i}`, t: 1.5, dur: 0.5, type: "note", pitch: midiToPitch(66), voice: 1, staff: 1 },
        { id: `d${i}`, t: 2.5, dur: 1.5, type: "note", pitch: midiToPitch(67), voice: 1, staff: 1 },
      ],
    })),
  };
  const parts: any[] = [off];
  const plans = simplifyForLevel(parts, { default: "beginner" });
  const plan = plans.find((p) => p.part === "Violin I");
  assert.ok(plan, "an off-grid part should get an alternate");
  assert.equal(plan!.grid, 1, "a beginner counts beats");
  assert.ok(plan!.requantized > 0, "the grid should have moved something");
  assert.ok(plan!.dropped > 0, "the sixteenth inside beat 1 should have been absorbed");

  const alt = parts.find((p) => String(p.name) === "Violin I (simplified)");
  assert.ok(alt, "the alternate should have been added");
  for (const m of alt.measures) {
    for (const e of (m.events ?? [])) {
      if (e.type !== "note") continue;
      assert.ok(Number.isInteger(Number(e.t)), `onset ${e.t} is not on the beat`);
    }
  }
  // And the original is still off the grid, untouched.
  assert.equal(Number(off.measures[0]!.events[1]!.t), 0.75, "the professional part must not move");
}

// ── A string part is not asked to breathe ──
{
  // A violist tires; she does not run out of breath. Writing breath rests into
  // a string part would be describing a problem that instrument does not have.
  const parts = [part("VLA", "Viola", "viola", [50, 52, 54, 55, 54, 52, 50, 52])];
  for (const m of parts[0]!.measures) m.events[0].dur = 4;
  const plans = simplifyForLevel(parts, { default: "beginner" });
  assert.equal(plans.find((p) => p.part === "Viola")?.breaths ?? 0, 0, "strings do not breathe");
}

console.log("difficultySimplify: ok");
