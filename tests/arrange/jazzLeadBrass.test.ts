import assert from "node:assert/strict";
import { mapPianoToJazzBandOpen } from "../../src/arrange/mapToJazzBand";
import { leadBars } from "../../src/arrange/jazz/leadBrass";
import { punchBars } from "../../src/arrange/jazz/expandSections";

/**
 * The lead brass punctuates, and the lead trombone sits where a section can
 * hang beneath it.
 *
 * Getting the roster to seventeen left two things wrong, both measured against
 * the reference edition of this chart.
 *
 * The two LEAD brass parts were still scored like saxophones — 419 notes over
 * 93 of 124 bars each, where its lead trumpet plays 75 notes over 21 bars and
 * its lead trombone 106 over 34. Five times the material. A big band's brass
 * enters, punches, takes a passage of its own and sits out the rest; ours
 * played every bar the saxes played, which is what made eight brass against
 * five saxes a wall even once the derived six were correctly sparse.
 *
 * And both lead brass CENTRES were textbook rather than measured, and low: by
 * median concert pitch the reference's lead trumpet sits at 78 and ours at 71,
 * its lead trombone at 59 and ours at 49. The trombone's mattered twice over,
 * because the three derived trombones hang below it — with the lead at 49 there
 * was no room, so Trombone 2 came out at a median of 48 against the reference's
 * 59. Lifting the lead lifted the section: notes placed outside their measured
 * register fell from 228 to 50.
 */

const MAP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (e: any): number | null => {
  const p = e?.pitch;
  if (!p) return null;
  const s = MAP[String(p.step).toUpperCase()];
  if (s === undefined) return null;
  return 12 * (Number(p.octave) + 1) + s + Number(p.alter ?? 0);
};

const BARS = 40;
const QUIET_FROM = 24;
const QUIET_TO = 32;

function chartScore(): any {
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
  return {
    score_id: "T", meta: {}, global: { divisions: 480 },
    parts: [mk("P1", "Piano", 2, 0), mk("P2", "Voice", 1, 7)],
  };
}

const SYMBOLS = Array.from({ length: BARS }, (_, i) => ({
  measure: i + 1, t: 0, symbol: ["C", "F", "G", "Am"][i % 4],
}));

const out: any = mapPianoToJazzBandOpen(chartScore() as any, undefined, SYMBOLS);
const parts: any[] = out.parts ?? [];
const byName = (re: RegExp) => parts.find((p) => re.test(String(p.name)))!;

function notesIn(part: any, bar: number) {
  return (part?.measures?.[bar]?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace);
}
function barsPlayed(part: any) {
  let n = 0;
  for (let b = 0; b < BARS; b++) if (notesIn(part, b).length) n++;
  return n;
}
function pitches(part: any) {
  const vs: number[] = [];
  for (let b = 0; b < BARS; b++) for (const e of notesIn(part, b)) {
    const v = midiOf(e);
    if (v !== null) vs.push(v);
  }
  return vs.sort((a, b) => a - b);
}
const median = (vs: number[]) => vs[Math.floor(vs.length / 2)]!;

// ── A lead keeps every punch bar, so its chairs always find it ──
{
  // Load-bearing, not cosmetic: Trumpet 2 doubles the lead trumpet's rhythm on
  // the punch bars. If the gate could drop a punch bar, the chairs beneath the
  // lead would lose their donor exactly where the section is meant to hit.
  for (const kind of ["trumpet", "trombone"] as const) {
    const keep = leadBars(kind, BARS);
    for (const b of punchBars(kind, BARS)) {
      assert.ok(keep.has(b), `the lead ${kind} must keep punch bar ${b + 1}`);
    }
    // And it takes a passage that is its OWN, not only the section's punches.
    const own = [...keep].filter((b) => !punchBars(kind, BARS).has(b));
    assert.ok(own.length >= 3, `the lead ${kind} should have a passage of its own, got ${own.length} bars`);
    // Contiguous, as a passage is.
    own.sort((a, b) => a - b);
    assert.equal(
      own[own.length - 1]! - own[0]! + 1, own.length,
      `the lead ${kind}'s own passage should be contiguous: ${own.join(",")}`
    );
  }

  // The trombone takes its passage first and the trumpet near the end, so the
  // two leads do not compete — which is where the reference puts them, at bars
  // 37-51 and 90-99 of 124.
  const tbnOwn = [...leadBars("trombone", BARS)].filter((b) => !punchBars("trombone", BARS).has(b));
  const tptOwn = [...leadBars("trumpet", BARS)].filter((b) => !punchBars("trumpet", BARS).has(b));
  assert.ok(
    Math.max(...tbnOwn) < Math.min(...tptOwn),
    `the trombone's passage should come before the trumpet's: ${tbnOwn} then ${tptOwn}`
  );
}

// ── The leads punctuate; the saxes still carry ──
{
  const sax = barsPlayed(byName(/^alto sax$/i));
  for (const name of ["Trumpet", "Trombone"]) {
    const lead = barsPlayed(byName(new RegExp(`^${name}$`, "i")));
    assert.ok(lead > 0, `${name} never plays at all`);
    assert.ok(
      lead <= sax * 0.5,
      `${name} should punctuate, not carry: ${lead} bars against the alto's ${sax}`
    );
  }
  // The saxes are untouched by the gate.
  assert.ok(
    sax >= (BARS - (QUIET_TO - QUIET_FROM)) * 0.9,
    `the saxes should still carry the chart, got ${sax} bars`
  );
}

// ── The lead trombone sits high enough for a section to hang beneath it ──
{
  // Trombone 2's measured register is 54-59 concert. A lead at a median of 49,
  // which is where the textbook centre put it, leaves nothing underneath — the
  // whole trombone section then sits an octave low. This is the assertion that
  // the register constants are measured rather than assumed.
  const tbn = pitches(byName(/^trombone$/i));
  assert.ok(
    median(tbn) >= 56,
    `the lead trombone should sit near the reference's median of 59, got ${median(tbn)}`
  );

  // And the chairs below it reach their own registers rather than the floor.
  const tbn2 = pitches(byName(/^trombone 2$/i));
  assert.ok(
    median(tbn2) >= 54,
    `Trombone 2 should reach its register of 54-59, got a median of ${median(tbn2)}`
  );

  // The lead trumpet reaches the top of its range, where a lead punches.
  const tpt = pitches(byName(/^trumpet$/i));
  assert.ok(
    tpt[tpt.length - 1]! >= 78,
    `the lead trumpet should reach the reference's top of 78, got ${tpt[tpt.length - 1]}`
  );
  // But not past the register measured for it — 84 was an unplayable C6.
  assert.ok(
    tpt[tpt.length - 1]! <= 79,
    `the lead trumpet should stay inside 79, got ${tpt[tpt.length - 1]}`
  );
}

// ── Gating runs before derivation, so the chairs double a gated donor ──
{
  // If the chairs were derived first, Trumpet 2 would carry the ungated lead's
  // 93 bars of rhythm while the lead itself played 5.
  const tpt2 = barsPlayed(byName(/^trumpet 2$/i));
  const tbn2 = barsPlayed(byName(/^trombone 2$/i));
  for (const [name, n] of [["Trumpet 2", tpt2], ["Trombone 2", tbn2]] as const) {
    assert.ok(
      n <= BARS * 0.45,
      `${name} should stay sparse after the lead is gated: ${n} of ${BARS} bars`
    );
  }
}

// ── With the roster off, the leads are left alone ──
{
  const octet: any = mapPianoToJazzBandOpen(chartScore() as any, { sections: false }, SYMBOLS);
  const ps: any[] = octet.parts ?? [];
  const tpt = ps.find((p) => /^trumpet$/i.test(String(p.name)))!;
  let n = 0;
  for (let b = 0; b < BARS; b++) {
    if ((tpt.measures?.[b]?.events ?? []).filter((e: any) => e?.type === "note" && !e.grace).length) n++;
  }
  assert.ok(
    n >= (BARS - (QUIET_TO - QUIET_FROM)) * 0.9,
    `sections: false should leave the lead trumpet carrying, got ${n} bars`
  );
}

console.log("jazzLeadBrass: ok");
