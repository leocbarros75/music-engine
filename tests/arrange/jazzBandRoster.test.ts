import assert from "node:assert/strict";
import { mapPianoToJazzBandOpen } from "../../src/arrange/mapToJazzBand";
import { punchBars, chooseOctave } from "../../src/arrange/jazz/expandSections";
import { exportScoreModelToMusicXML } from "../../src/exporters/musicxmlExporter";

/**
 * Seventeen chairs, and the two sections scored differently.
 *
 * Our jazz route built an octet where the reference edition of this chart is a
 * big band of seventeen. The nine derived chairs have to come out with the
 * reference's SHAPE, not just its headcount, and the measurement that made that
 * shape plain was this: its saxophones carry (56-67% sounding, at most one bar
 * off in 124) while its brass punctuates (5-16%, silent in 90 to 108). Nine
 * more parts at the donors' own 66% would be a wall of sound.
 *
 * Two of these tests exist because the first implementation failed them.
 *
 * Picking, of the chord tones available, the one nearest the middle of a chair's
 * measured register collapsed the Baritone Sax to THREE SEMITONES across 124
 * bars, where the reference's spans twelve: asking every note to sit near one
 * pitch puts every note on that pitch. A section chair takes the next chord
 * tone below the chair above it, so it follows the lead's contour, and the
 * register is chosen once for the whole line.
 *
 * And the brass could only play where its donor played. All four of our horns
 * are written from one set of onsets, so they rest in the same 31 bars, which
 * cluster at 67-104 and swallowed six of the thirteen punches. The reference's
 * brass is busiest in exactly that stretch, because a big band's brass answers
 * the holes rather than shadowing the line, so a punch bar whose lead is silent
 * takes the piano's comp rhythm instead.
 */

const MAP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (e: any): number | null => {
  const p = e?.pitch;
  if (!p) return null;
  const s = MAP[String(p.step).toUpperCase()];
  if (s === undefined) return null;
  return 12 * (Number(p.octave) + 1) + s + Number(p.alter ?? 0);
};

/**
 * A chart long enough to have punches, with a lead line that MOVES and a
 * stretch where the horns rest.
 *
 * Every one of those three properties is load-bearing:
 *
 *  - 40 bars, because the trumpets enter a quarter of the way in and a short
 *    fixture would silence them entirely and pass every brass assertion
 *    vacuously.
 *  - a melody that climbs and falls across two octaves, because a flattened
 *    derivation is invisible under a static lead — the first version of this
 *    fixture repeated one bar and the centre-seeking bug passed it.
 *  - bars 24-31 empty, so some punch bar has no donor note and the piano
 *    fallback is actually exercised.
 */
const BARS = 40;
const QUIET_FROM = 24;
const QUIET_TO = 32;

function chartScore(): any {
  // A rising-then-falling line, so the derived chairs have a contour to follow.
  const shape = (bar: number) => {
    const span = 24;
    const up = bar % (span * 2);
    return 48 + (up <= span ? up : span * 2 - up);
  };
  const n = (t: number, midi: number, id: string) => ({
    type: "note", t, dur: 1, staff: 1, voice: 1,
    pitch: { step: ["C", "D", "E", "F", "G", "A", "B"][((midi % 7) + 7) % 7], octave: Math.floor(midi / 7) + 1, alter: 0 },
    id,
  });
  const mk = (pid: string, name: string, staves: number, lift: number) => ({
    part_id: pid, name, staves,
    measures: Array.from({ length: BARS }, (_, i) => ({
      number: i + 1,
      attributes: { time: { beats: 4, beat_type: 4 }, divisions: 480 },
      events: i >= QUIET_FROM && i < QUIET_TO ? [] : [
        n(0, shape(i) + lift, `${pid}a${i}`),
        n(1, shape(i) + lift + 2, `${pid}b${i}`),
        n(2, shape(i) + lift + 1, `${pid}c${i}`),
        n(3, shape(i) + lift + 3, `${pid}d${i}`),
      ],
    })),
  });
  // Two parts, so the extractor reports chords rather than single notes.
  return {
    score_id: "T", meta: {}, global: { divisions: 480 },
    parts: [mk("P1", "Piano", 2, 0), mk("P2", "Voice", 1, 7)],
  };
}

// Symbols give the bar a real chord to draw tones from; without them the
// harmony is whatever two notes happen to sound and nothing sits below a donor.
const SYMBOLS = Array.from({ length: BARS }, (_, i) => ({
  measure: i + 1, t: 0, symbol: ["C", "F", "G", "Am"][i % 4],
}));

const out: any = mapPianoToJazzBandOpen(chartScore() as any, undefined, SYMBOLS);
const parts: any[] = out.parts ?? [];
const byName = (re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

function notesIn(part: any, bar: number) {
  return (part?.measures?.[bar]?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
}
function rangeOf(part: any) {
  const ms: number[] = [];
  for (let b = 0; b < BARS; b++) for (const e of notesIn(part, b)) {
    const v = midiOf(e);
    if (v !== null) ms.push(v);
  }
  return { lo: Math.min(...ms), hi: Math.max(...ms), count: ms.length };
}
function barsPlayed(part: any) {
  let n = 0;
  for (let b = 0; b < BARS; b++) if (notesIn(part, b).length) n++;
  return n;
}

const DERIVED = [
  "Alto Sax 2", "Tenor Sax 2", "Baritone Sax",
  "Trumpet 2", "Trumpet 3", "Trumpet 4",
  "Trombone 2", "Trombone 3", "Bass Trombone",
];

// ── Seventeen chairs, in big-band score order ──
{
  assert.equal(parts.length, 17, `a big band is seventeen parts, got ${parts.length}`);
  for (const name of DERIVED) {
    assert.ok(
      parts.some((p) => String(p.name) === name),
      `${name} is missing from the roster`
    );
  }
  // Sections from the top down: saxes, trumpets, trombones, then rhythm. The
  // exporter's generic orchestral sort put the Baritone Sax ABOVE the first alto
  // because the catalog gives it a bass clef, which is why jazz_band now keeps
  // the order the mapper emits.
  const order = parts.map((p) => String(p.name));
  const at = (n: string) => order.indexOf(n);
  for (const [a, b] of [
    ["Alto Sax", "Alto Sax 2"], ["Alto Sax 2", "Tenor Sax"],
    ["Tenor Sax", "Tenor Sax 2"], ["Tenor Sax 2", "Baritone Sax"],
    ["Baritone Sax", "Trumpet"], ["Trumpet", "Trumpet 2"],
    ["Trumpet 2", "Trumpet 3"], ["Trumpet 3", "Trumpet 4"],
    ["Trumpet 4", "Trombone"], ["Trombone", "Trombone 2"],
    ["Trombone 2", "Trombone 3"], ["Trombone 3", "Bass Trombone"],
    ["Bass Trombone", "Piano"],
  ] as const) {
    assert.ok(at(a) < at(b), `${a} should come above ${b} in the score`);
  }
}

// ── The saxophones carry; the brass punctuates ──
{
  const sax = ["Alto Sax 2", "Tenor Sax 2", "Baritone Sax"];
  const brass = ["Trumpet 2", "Trumpet 3", "Trumpet 4", "Trombone 2", "Trombone 3", "Bass Trombone"];

  // The source itself is empty for 8 of the 40 bars, so a carrying part plays
  // the other 32.
  const playable = BARS - (QUIET_TO - QUIET_FROM);
  for (const name of sax) {
    const n = barsPlayed(byName(new RegExp(`^${name}$`, "i")));
    assert.ok(
      n >= playable * 0.9,
      `${name} carries the chart: expected about ${playable} bars, got ${n}`
    );
  }
  for (const name of brass) {
    const n = barsPlayed(byName(new RegExp(`^${name}$`, "i")));
    assert.ok(n > 0, `${name} never plays at all`);
    assert.ok(
      n <= BARS * 0.45,
      `${name} punctuates, it does not carry: ${n} of ${BARS} bars`
    );
  }
}

// ── The derived line follows the lead, rather than collapsing onto a centre ──
{
  // The lead moves across two octaves in this fixture, so every chair under it
  // must move too. Three semitones is what the centre-seeking bug produced on
  // the real chart against the reference's twelve.
  for (const name of ["Alto Sax 2", "Tenor Sax 2", "Baritone Sax"]) {
    const r = rangeOf(byName(new RegExp(`^${name}$`, "i")));
    assert.ok(
      r.hi - r.lo >= 10,
      `${name} should follow the lead's contour, but spans only ${r.hi - r.lo} semitones`
    );
  }

  // And it must move the same WAY: a part that merely jitters widely is not
  // following anything. Compare bar by bar against the donor it sits under.
  for (const [chair, donor] of [
    ["Alto Sax 2", "Alto Sax"], ["Tenor Sax 2", "Tenor Sax"], ["Baritone Sax", "Tenor Sax 2"],
  ] as const) {
    const a = byName(new RegExp(`^${chair}$`, "i"));
    const d = byName(new RegExp(`^${donor}$`, "i"));
    let agree = 0, seen = 0;
    let prevA: number | null = null, prevD: number | null = null;
    for (let b = 0; b < BARS; b++) {
      const na = notesIn(a, b).map(midiOf).filter((v): v is number => v !== null);
      const nd = notesIn(d, b).map(midiOf).filter((v): v is number => v !== null);
      if (!na.length || !nd.length) continue;
      const ma = na.reduce((x, y) => x + y, 0) / na.length;
      const md = nd.reduce((x, y) => x + y, 0) / nd.length;
      if (prevA !== null && prevD !== null && Math.abs(md - prevD) > 0.01) {
        seen++;
        if (Math.sign(ma - prevA) === Math.sign(md - prevD)) agree++;
      }
      prevA = ma; prevD = md;
    }
    assert.ok(seen >= 10, `not enough movement in ${donor} to judge ${chair} (${seen})`);
    assert.ok(
      agree / seen >= 0.7,
      `${chair} should move with ${donor}: agreed on ${agree} of ${seen} bar-to-bar moves`
    );
  }
}

// ── A chair never rises above the chair it harmonises ──
{
  for (const [chair, donor] of [
    ["Alto Sax 2", "Alto Sax"], ["Tenor Sax 2", "Tenor Sax"], ["Baritone Sax", "Tenor Sax 2"],
    ["Trumpet 3", "Trumpet 2"], ["Trumpet 4", "Trumpet 3"],
    ["Trombone 3", "Trombone 2"], ["Bass Trombone", "Trombone 3"],
  ] as const) {
    const a = byName(new RegExp(`^${chair}$`, "i"));
    const d = byName(new RegExp(`^${donor}$`, "i"));
    for (let b = 0; b < BARS; b++) {
      const na = notesIn(a, b).map(midiOf).filter((v): v is number => v !== null);
      const nd = notesIn(d, b).map(midiOf).filter((v): v is number => v !== null);
      if (!na.length || !nd.length) continue;
      assert.ok(
        Math.max(...na) <= Math.max(...nd),
        `${chair} rises above ${donor} in bar ${b + 1}: ${Math.max(...na)} over ${Math.max(...nd)}`
      );
    }
  }
}

// ── Every derived note is a chord tone the band is already sounding ──
{
  for (const name of DERIVED) {
    const part = byName(new RegExp(`^${name}$`, "i"));
    for (let b = 0; b < BARS; b++) {
      const mine = notesIn(part, b);
      if (!mine.length) continue;
      const pcs = new Set<number>();
      for (const p of parts) {
        if (String(p.name) === name) continue;
        for (const e of notesIn(p, b)) {
          const v = midiOf(e);
          if (v !== null) pcs.add(((v % 12) + 12) % 12);
        }
      }
      for (const e of mine) {
        const v = midiOf(e);
        if (v === null) continue;
        assert.ok(
          pcs.has(((v % 12) + 12) % 12),
          `${name} bar ${b + 1}: ${v} is not a chord tone the band is sounding`
        );
      }
    }
  }
}

// ── The brass punches where the lead rests, off the piano's rhythm ──
{
  // Asserting only that the brass plays "within" the punch bars would pass if
  // the fallback were deleted — the surviving bars are a subset. So assert the
  // fallback is USED: there is a punch bar where the lead trumpet is silent and
  // Trumpet 2 is not.
  const tpt = byName(/^trumpet$/i);
  const tpt2 = byName(/^trumpet 2$/i);
  const punch = punchBars("trumpet", BARS);

  let coveredRests = 0;
  for (const b of punch) {
    if (notesIn(tpt, b).length === 0 && notesIn(tpt2, b).length > 0) coveredRests++;
  }
  assert.ok(
    coveredRests > 0,
    "Trumpet 2 should punch in a punch bar where the lead trumpet rests"
  );

  // And it never plays outside the punch bars.
  for (let b = 0; b < BARS; b++) {
    if (punch.has(b)) continue;
    assert.equal(
      notesIn(tpt2, b).length, 0,
      `Trumpet 2 plays in bar ${b + 1}, which is not a punch bar`
    );
  }

  // The brass enters late and lands on the final bar, as the reference's does.
  const first = Math.min(...punch);
  assert.ok(first >= BARS * 0.2, `the trumpets enter late, not at bar ${first + 1}`);
  assert.ok(punch.has(BARS - 1), "every brass part takes the final tutti chord");
  assert.ok(
    punchBars("trombone", BARS).size > punch.size,
    "the trombones come in before the trumpets, so they punch more bars"
  );
}

// ── The register is chosen for the line, not for a note ──
{
  // Six notes must not decide where two hundred go — the same fault the brass
  // arranger's sweet-spot pass had. A line that sits squarely in the band stays
  // put even with a couple of stragglers far below it.
  const band = { lo: 60, hi: 72 };
  const chair = { band, instrument: "trumpet_bb_2" };
  const settled = Array.from({ length: 200 }, (_, i) => 62 + (i % 8));
  assert.equal(chooseOctave(settled, chair), 0, "a line inside its band should not move");
  assert.equal(
    chooseOctave([...settled, 38, 39, 40, 41, 42, 43], chair), 0,
    "six outliers must not drag two hundred notes down an octave"
  );
  // But a line that genuinely sits an octave high does move.
  const high = Array.from({ length: 200 }, (_, i) => 74 + (i % 8));
  assert.equal(chooseOctave(high, chair), -12, "a line above its band should drop an octave");

  // And a handful of notes that would fall off the bottom of the instrument
  // must not veto the octave the rest of the line belongs in. This was a real
  // fault: scoring an unplayable note as disqualifying left the Baritone Sax's
  // 392 notes a whole octave above its register because 14 of them would have
  // dropped under the horn. Those 14 are pulled back when they are written; the
  // other 378 are in the right place.
  const bari = { band: { lo: 40, hi: 52 }, instrument: "baritone_sax_eb" };  // plays 37-68
  const mostlyLow = [
    ...Array.from({ length: 180 }, (_, i) => 52 + (i % 8)),   // 52-59 → 40-47 an octave down
    ...Array.from({ length: 14 }, () => 48),                  // → 36, just under the horn
  ];
  assert.equal(
    chooseOctave(mostlyLow, bari), -12,
    "fourteen notes off the end of the instrument must not strand 180 an octave high"
  );
}

// ── The score the exporter writes keeps that order ──
{
  // The order assertion above only tests the mapper, and the mapper was never
  // wrong: the EXPORTER re-sorted the parts. Its generic orchestral sort reads
  // clef as depth, and the catalog gives the baritone saxophone a bass clef, so
  // the Baritone Sax came out at the very top of the score, above the first
  // alto, with the Drums lifted above the Piano. A big band is laid out by
  // section from the top down, so jazz_band now keeps the order it emits.
  const xml = exportScoreModelToMusicXML(out as any);
  const names = [...xml.matchAll(/<part-name>([^<]*)<\/part-name>/g)].map((m) => m[1]!);
  assert.equal(names.length, 17, `17 parts in the exported score, got ${names.length}`);
  assert.deepEqual(
    names,
    [
      "Alto Sax", "Alto Sax 2", "Tenor Sax", "Tenor Sax 2", "Baritone Sax",
      "Trumpet", "Trumpet 2", "Trumpet 3", "Trumpet 4",
      "Trombone", "Trombone 2", "Trombone 3", "Bass Trombone",
      "Piano", "Rhythm Guitar", "Bass", "Drums",
    ],
    "the exported score should be in big-band order"
  );
}

// ── The chosen octave actually reaches the written part ──
{
  // chooseOctave can be right and still never be applied: setting the shift to
  // a constant zero passed every other test here, because a flattened or
  // unshifted line is still wide, still follows the lead and still sits under
  // its donor. What it is NOT is in the chair's register.
  //
  // Scoped to the Baritone Sax on purpose. It is the one chair in this fixture
  // whose line needs the octave (its raw chord tones land at 48-60 against a
  // register of 40-52), and the trombones' registers are bounded by our lead
  // trombone, which sits about twelve semitones below the reference's — a real
  // upstream fault that this test must not pretend is fixed.
  const bari = byName(/^baritone sax$/i);
  const all: number[] = [];
  for (let b = 0; b < BARS; b++) for (const e of notesIn(bari, b)) {
    const v = midiOf(e);
    if (v !== null) all.push(v);
  }
  all.sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)]!;
  // No tolerance on the median: individual notes may stray outside a register,
  // but the middle of the line is the register. A ±3 tolerance was the first
  // attempt and the unshifted line's median of 54 slipped through it.
  assert.ok(
    median >= 40 && median <= 52,
    `the Baritone Sax should sit in its register: median ${median} against a band of 40-52`
  );
}

// ── Turning the roster off leaves the octet alone ──
{
  const octet: any = mapPianoToJazzBandOpen(chartScore() as any, { sections: false }, SYMBOLS);
  assert.equal((octet.parts ?? []).length, 8, "sections: false writes the eight-piece band");
  for (const name of DERIVED) {
    assert.ok(
      !(octet.parts ?? []).some((p: any) => String(p.name) === name),
      `${name} should not be there with sections off`
    );
  }
}

console.log("jazzBandRoster: ok");
