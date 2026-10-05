import assert from "node:assert/strict";
import { expandBrassSection, expandSectionSentence } from "../../src/arrange/brass/expandSection";
import { midiToPitch, pitchToMidi } from "../../src/instruments/instrumentCatalog";
import { BRASS_RANGES } from "../../src/arrange/brass/brassRanges";

/**
 * Eight players, not five.
 *
 * Our brass route builds a quintet, which is a real chamber ensemble and stays
 * reachable; the reference edition of this chart is an orchestral section of
 * eight, and the missing three are a second horn, a second trombone and a bass
 * trombone.
 *
 * Nothing is composed: each new part doubles its donor's rhythm exactly and
 * takes a chord tone the section is already sounding at that instant, so the
 * harmony stays the voicing's and only the spacing is new. The spacing rules
 * are the reference's own — the horns ascend Horn 2 to Horn 1, the trombones
 * ascend Bass Trombone to Trombone 2 to Trombone 1, and the bass trombone keeps
 * clear of the tuba.
 */

/** A quintet voicing a C major triad, one note a beat. */
function quintet(bars: number, pitches?: Partial<Record<string, number>>): any {
  const base: Array<[string, string, number]> = [
    ["P_TP1", "Trumpet 1", 79],
    ["P_TP2", "Trumpet 2", 76],
    ["P_HN", "Horn in F", 72],
    ["P_TBN", "Trombone", 60],
    ["P_TUBA", "Tuba", 36],
  ];
  return {
    parts: base.map(([id, name, midi]) => ({
      part_id: id,
      name,
      measures: Array.from({ length: bars }, (_, i) => ({
        number: i + 1,
        events: Array.from({ length: 4 }, (_, k) => ({
          type: "note", t: k, dur: 1,
          pitch: midiToPitch(pitches?.[name] ?? midi), id: `${name}-${i}-${k}`,
        })),
      })),
    })),
  };
}

const find = (score: any, re: RegExp) =>
  (score.parts ?? []).find((p: any) => re.test(String(p?.name ?? "")));
const midisIn = (part: any, bar: number) =>
  (part.measures?.[bar]?.events ?? [])
    .filter((e: any) => e?.type === "note")
    .map((e: any) => pitchToMidi(e.pitch));

const BARS = 6;

// ── Three players are added, and the roster is eight ──────────────────────
{
  const score = quintet(BARS);
  const plans = expandBrassSection(score);
  assert.equal(score.parts.length, 8, "a brass section is eight players");
  assert.deepEqual(plans.map((p) => p.part).sort(),
    ["Bass Trombone", "Horn 2", "Trombone 2"]);
  for (const name of ["Horn 2", "Trombone 2", "Bass Trombone"]) {
    const p = find(score, new RegExp(`^${name}$`, "i"));
    assert.ok(p, `${name} is in the score`);
    assert.ok(midisIn(p, 0).length > 0, `${name} actually plays`);
  }
}

// ── The donor's rhythm is doubled exactly — no new onsets ─────────────────
{
  const score = quintet(BARS);
  expandBrassSection(score);
  const pairs: Array<[RegExp, RegExp]> = [
    [/^horn 2$/i, /^horn in f$/i],
    [/^trombone 2$/i, /^trombone$/i],
  ];
  for (const [derivedRe, donorRe] of pairs) {
    const d = find(score, derivedRe), donor = find(score, donorRe);
    for (let bar = 0; bar < BARS; bar++) {
      const dOn = (d.measures[bar].events ?? []).filter((e: any) => e.type === "note").map((e: any) => Number(e.t));
      const oOn = (donor.measures[bar].events ?? []).filter((e: any) => e.type === "note").map((e: any) => Number(e.t));
      assert.deepEqual(dOn.sort(), oOn.sort(),
        `${d.name} bar ${bar + 1}: its rhythm must be the donor's exactly`);
    }
  }
}

// ── The section ascends, as the reference's does ──────────────────────────
{
  const score = quintet(BARS);
  expandBrassSection(score);
  const below = (lowRe: RegExp, highRe: RegExp) => {
    const lo = find(score, lowRe), hi = find(score, highRe);
    for (let bar = 0; bar < BARS; bar++) {
      const l = Math.max(...midisIn(lo, bar));
      const h = Math.min(...midisIn(hi, bar));
      assert.ok(l < h,
        `${lo.name} (${l}) must sit below ${hi.name} (${h}) in bar ${bar + 1}`);
    }
  };
  below(/^horn 2$/i, /^horn in f$/i);
  below(/^trombone 2$/i, /^trombone$/i);
  below(/^bass trombone$/i, /^trombone 2$/i);
}

// ── Only chord tones the section is already sounding ──────────────────────
{
  const score = quintet(BARS);
  expandBrassSection(score);
  const allowed = new Set([0, 4, 7]);          // C E G
  for (const name of [/^horn 2$/i, /^trombone 2$/i, /^bass trombone$/i]) {
    const p = find(score, name);
    for (let bar = 0; bar < BARS; bar++) {
      for (const m of midisIn(p, bar)) {
        assert.ok(allowed.has(((m % 12) + 12) % 12),
          `${p.name}: ${m} is not a chord tone the section is holding`);
      }
    }
  }
}

// ── Everyone stays inside their instrument's range ────────────────────────
{
  const score = quintet(BARS);
  expandBrassSection(score);
  for (const [re, key] of [[/^horn 2$/i, "hn"], [/^trombone 2$/i, "tbn"], [/^bass trombone$/i, "tbn"]] as const) {
    const p = find(score, re);
    const r = BRASS_RANGES[key];
    for (let bar = 0; bar < BARS; bar++) {
      for (const m of midisIn(p, bar)) {
        assert.ok(m >= r.absMin && m <= r.absMax,
          `${p.name}: ${m} is outside ${r.absMin}-${r.absMax}`);
      }
    }
  }
}

// ── Already a section: adding again is a no-op ────────────────────────────
{
  const score = quintet(BARS);
  expandBrassSection(score);
  const before = score.parts.length;
  const again = expandBrassSection(score);
  assert.deepEqual(again, [], "a second pass adds nobody");
  assert.equal(score.parts.length, before, "and changes no part count");
}

// ── A route that does not ask for a section does not get one ─────────────
{
  // The arranger requires an explicit opt-in. Defaulting it on expanded every
  // caller that did not mention it, and the sweep caught piano_with_brass
  // growing to eight players while the claim was that it stays a quintet.
  const { arrangeBrassEnsemble } = require("../../src/arrange/brass/brassArranger");
  const src: any = {
    parts: [{
      part_id: "P1", name: "Melody", staves: 1,
      measures: Array.from({ length: 8 }, (_, i) => ({
        number: i + 1,
        attributes: { time: { beats: 4, beat_type: 4 }, divisions: 4 },
        events: Array.from({ length: 4 }, (_, k) => ({
          type: "note", t: k, dur: 1,
          pitch: midiToPitch(72 + k), id: `m${i}-${k}`,
        })),
      })),
    }],
    meta: {},
  };
  const chords = Array.from({ length: 8 }, (_, i) => ({ measure: i + 1, t: 0, symbol: "C" }));
  const key = { fifths: 0, mode: "major" as const };

  const silent = arrangeBrassEnsemble(src, chords, { key });
  assert.equal(((silent.scoreModel as any).parts ?? []).length, 5,
    "no section flag means the quintet is left alone");

  const asked = arrangeBrassEnsemble(src, chords, { key, section: true });
  assert.equal(((asked.scoreModel as any).parts ?? []).length, 8,
    "asking for a section gives eight");

  const refused = arrangeBrassEnsemble(src, chords, { key, section: false });
  assert.equal(((refused.scoreModel as any).parts ?? []).length, 5,
    "and refusing it keeps five");
}

// ── Degenerate input is safe ──────────────────────────────────────────────
{
  assert.deepEqual(expandBrassSection({ parts: [] }), []);
  assert.deepEqual(expandBrassSection({}), []);
  assert.equal(expandSectionSentence([]), null);
  const line = expandSectionSentence([{ part: "Horn 2", from: "Horn in F", notes: 373 }]);
  assert.ok(line && /Horn 2 from Horn in F/.test(line));
  // The crowding note only appears when the clearance actually gave way.
  assert.ok(!/closer than seven/.test(line!));
  const crowdedLine = expandSectionSentence([
    { part: "Bass Trombone", from: "Trombone 2", notes: 184, crowded: 12 },
  ]);
  assert.ok(crowdedLine && /closer than seven semitones/.test(crowdedLine));
}

console.log("PASS brass section roster");
