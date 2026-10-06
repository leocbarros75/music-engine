import assert from "node:assert/strict";
import { mapPianoToJazzBandOpen } from "../../src/arrange/mapToJazzBand";

/**
 * A saxophone plays one note at a time.
 *
 * Two faults made the jazz band's parts unplayable as written, both measured
 * against the reference edition of the same chart.
 *
 * Every note was given `n.dur ?? 480`, and extractOnsetChords supplies no
 * duration at all — so n.dur was undefined for all 672 of them and each note
 * was written 480 BEATS long, a hundred and twenty bars. The fallback was in
 * divisions and read as beats. The breathing audit had been reporting it all
 * along, as "longest stretch without air now 483 beats", and nobody read it as
 * the symptom it was.
 *
 * And the writer put one note per chord EVENT into each single-line part, while
 * 169 of the chart's onsets carry between two and eight events. A saxophone
 * came out holding eight simultaneous notes; 62 of 95 onsets carried more than
 * three and 49 carried the same pitch twice, and two pairs of players —
 * Tenor Sax with Trumpet, Trombone with Bass — were byte-identical.
 */

const SINGLE_LINE = [/^alto sax/i, /^tenor sax/i, /^trumpet/i, /^trombone/i, /^bass$/i];

/**
 * A source with TWO parts sounding together.
 *
 * That is what makes the extractor report more than one chord event on an
 * onset, which is the situation the merge exists for — and a single piano part
 * does NOT reproduce it, because the extractor already folds one part's
 * simultaneous notes into a single event. The first version of this fixture was
 * one piano part, and both the pile and the dedupe breaks passed against it.
 *
 * Two parts here give 16 events over 8 onsets, every one carrying two.
 */
function pianoScore(bars: number): any {
  const n = (t: number, midi: number, id: string) => ({
    type: "note", t, dur: 1, staff: 1, voice: 1,
    pitch: { step: ["C", "D", "E", "F", "G", "A", "B"][midi % 7], octave: Math.floor(midi / 7) + 1, alter: 0 },
    id,
  });
  const mk = (pid: string, name: string, staves: number, base: number) => ({
    part_id: pid, name, staves,
    measures: Array.from({ length: bars }, (_, i) => ({
      number: i + 1,
      attributes: { time: { beats: 4, beat_type: 4 }, divisions: 480 },
      // The same pitch twice on one onset, so a merge that does not deduplicate
      // hands a player the same note twice.
      events: [
        n(0, base, `${pid}a${i}`), n(0, base + 2, `${pid}b${i}`), n(0, base, `${pid}c${i}`),
        n(1, base + 1, `${pid}d${i}`),
        n(2, base + 3, `${pid}e${i}`), n(2, base + 1, `${pid}f${i}`),
      ],
    })),
  });
  return {
    score_id: "T", meta: {}, global: { divisions: 480 },
    parts: [mk("P1", "Piano", 2, 30), mk("P2", "Voice", 1, 37)],
  };
}

const BARS = 8;
const out: any = mapPianoToJazzBandOpen(pianoScore(BARS) as any);
const parts: any[] = out.parts ?? [];
const line = (re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

function notesIn(part: any, bar: number) {
  return (part.measures?.[bar]?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
}

// ── One note at a time, per player ────────────────────────────────────────
for (const re of SINGLE_LINE) {
  const p = line(re);
  assert.ok(p, `${re} is in the band`);
  for (let bar = 0; bar < BARS; bar++) {
    const byT = new Map<number, number>();
    for (const e of notesIn(p, bar)) byT.set(Number(e.t), (byT.get(Number(e.t)) ?? 0) + 1);
    for (const [t, n] of byT) {
      assert.equal(n, 1,
        `${p.name} bar ${bar + 1} has ${n} notes at beat ${t}; this instrument plays one at a time`);
    }
  }
}

// ── Durations are real, and never run past the bar ───────────────────────
for (const re of SINGLE_LINE) {
  const p = line(re);
  for (let bar = 0; bar < BARS; bar++) {
    for (const e of notesIn(p, bar)) {
      const d = Number(e.dur);
      assert.ok(Number.isFinite(d) && d > 0,
        `${p.name}: duration ${e.dur} is not a real length`);
      assert.ok(d <= 4,
        `${p.name}: a ${d}-beat note in a 4/4 bar — the 480 fallback is back`);
      assert.ok(Number(e.t) + d <= 4 + 1e-9,
        `${p.name}: a note at ${e.t} lasting ${d} runs past the barline`);
    }
  }
}

// ── Nothing overlaps within a part ───────────────────────────────────────
for (const re of SINGLE_LINE) {
  const p = line(re);
  for (let bar = 0; bar < BARS; bar++) {
    const es = notesIn(p, bar).sort((a: any, b: any) => Number(a.t) - Number(b.t));
    for (let i = 1; i < es.length; i++) {
      const prev = es[i - 1]!;
      assert.ok(Number(es[i]!.t) >= Number(prev.t) + Number(prev.dur) - 1e-9,
        `${p.name} bar ${bar + 1}: ${es[i]!.t} starts before the previous note ends`);
    }
  }
}

// ── No two players are given the same line ───────────────────────────────
{
  const sig = new Map<string, string[]>();
  for (const re of SINGLE_LINE) {
    const p = line(re);
    const s = (p.measures ?? []).map((m: any) =>
      (m.events ?? [])
        .filter((e: any) => e?.type === "note")
        .map((e: any) => `${e.t}:${e.pitch?.step}${e.pitch?.octave}`)
        .join(",")).join("/");
    if (!sig.has(s)) sig.set(s, []);
    sig.get(s)!.push(String(p.name));
  }
  for (const [, names] of sig) {
    assert.equal(names.length, 1,
      `${names.join(" and ")} were handed the same line`);
  }
}

// ── Everyone is actually playing ─────────────────────────────────────────
for (const re of SINGLE_LINE) {
  const p = line(re);
  let n = 0;
  for (let bar = 0; bar < BARS; bar++) n += notesIn(p, bar).length;
  assert.ok(n > 0, `${p.name} never plays`);
}

// ── The rhythm section comps: guitar on the backbeat ups, piano in eighths ──
{
  // Voiced from the chart's chord SYMBOLS. Without them the mapper can only
  // derive harmony from notes, and extractOnsetChords on a single-line chart
  // returns one note per onset — so the bar's "chord" was a single pitch, the
  // piano could only reach 2.5 notes an onset against the reference's 5, and
  // the guitar never reached three at all and sat silent in all 124 bars.
  const bars = 8;
  const symbols = Array.from({ length: bars }, (_, i) => ({
    measure: i + 1, t: 0, symbol: "C",
  }));
  const withSym: any = mapPianoToJazzBandOpen(pianoScore(bars) as any, undefined, symbols);
  const ps: any[] = withSym.parts ?? [];
  const gtr = ps.find((p) => /^rhythm guitar$/i.test(String(p.name)))!;
  const pno = ps.find((p) => /^piano$/i.test(String(p.name)))!;
  assert.ok(gtr, "there is a rhythm guitar in the band");

  // The reference's guitar plays on the and of 2 and the and of 4, 50% each,
  // and nowhere else — a funk upstroke.
  let gtrOnsets = 0;
  for (let bar = 0; bar < bars; bar++) {
    const byT = new Map<number, number>();
    for (const e of notesIn(gtr, bar)) byT.set(Number(e.t), (byT.get(Number(e.t)) ?? 0) + 1);
    for (const [t, n] of byT) {
      gtrOnsets++;
      assert.ok(t === 1.5 || t === 3.5,
        `the guitar struck beat ${t}; it plays the and of 2 and the and of 4`);
      assert.equal(n, 3, `a guitar voicing is three notes, got ${n}`);
    }
  }
  assert.ok(gtrOnsets > 0, "the guitar must actually play");

  // The piano comps in eighths on beat 1, the and of 1, the and of 3 and the
  // and of 4, with a hand's worth of notes rather than one.
  for (let bar = 0; bar < bars; bar++) {
    const byT = new Map<number, number>();
    for (const e of notesIn(pno, bar)) {
      byT.set(Number(e.t), (byT.get(Number(e.t)) ?? 0) + 1);
      assert.equal(Number(e.dur), 0.5, "the comp is in eighths");
    }
    for (const [t, n] of byT) {
      assert.ok([0, 0.5, 2.5, 3.5].includes(t),
        `the piano struck beat ${t}, off the comping pattern`);
      assert.ok(n >= 3, `a comping voicing is a handful of notes, got ${n} at beat ${t}`);
    }
    // It must USE the pattern, not merely stay inside it. Asserting only that
    // each onset is one of the four passed with the piano back on beat 1 alone,
    // which is the whole-note-per-bar fault this replaced; the reference comps
    // 3.1 onsets a bar.
    assert.ok(byT.size >= 3,
      `bar ${bar + 1}: the piano comps ${byT.size} onset(s); the pattern has four`);
  }

  // Every comped pitch is a chord tone of the symbol — C major here.
  const MAJ = new Set([0, 4, 7]);
  const STEPS: Record<string, number> = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 };
  for (const p of [gtr, pno]) {
    for (let bar = 0; bar < bars; bar++) {
      for (const e of notesIn(p, bar)) {
        const pc = ((STEPS[String(e.pitch?.step)] ?? 0) + Number(e.pitch?.alter ?? 0) + 12) % 12;
        assert.ok(MAJ.has(pc),
          `${p.name}: ${e.pitch?.step}${e.pitch?.octave} is not a chord tone of C`);
      }
    }
  }
}

console.log("PASS jazz band playable");
