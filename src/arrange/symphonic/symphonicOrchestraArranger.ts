// src/arrange/symphonic/symphonicOrchestraArranger.ts
//
// SYMPHONIC ORCHESTRA (Classical / Romantic) — a sibling of, and fully isolated
// from, the worship orchestra. Nothing here imports a worship file, and no
// worship file imports this; the DP core is its own fork under ./core.
//
// Why it is a different engine, not a re-skin of the worship orchestra:
//
//   • WHO CARRIES THE MUSIC. In worship the band + congregation carry the song
//     and the orchestra is a cushion that must not compete (brass-forward,
//     strings as pad). Here the orchestra IS the music: the STRINGS are the
//     protagonist, winds are colour and solo voices, brass is reserved power.
//
//   • TEXTURE. Worship is a homophonic pad plus unison hits, deliberately
//     leaving space for the rhythm section. Symphonic writing wants layered
//     roles, octave doubling across families, and tutti/solo opposition
//     (Tovey): the orchestra recedes for a solo line and swells between phrases.
//
//   • DYNAMIC ARCHITECTURE. Worship builds by adding players toward the final
//     chorus. A symphony builds by ACCUMULATION AND COLOUR: transparent
//     exposition → fuller middle → tutti climax, brass entering last.
//
//   • HARMONY. The symphonic core deliberately drops the worship post-processing
//     (forced bass roots, automatic add9/m7 triad colour) — see ./core/stringArranger.
//
// Period ("classical" | "romantic") switches BOTH the roster and the scoring:
//   classical → Fl Ob Cl Bsn · Hn 1-2 · Tpt 1-2 · Timp · Vln I/II Vla Vc Cb  (12)
//   romantic  → + Piccolo · Hn 3-4 · Tbn 1-2 · Tbn 3/Tuba                    (16)

import type { ScoreModel } from "../../score/types";
import { arrangeStringEnsemble } from "./core/stringArranger";
import { getInstrumentSpec, midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";

type ChordEvent = { measure: number; t: number; symbol: string };
export type SymphonicPeriod = "classical" | "romantic";
type CoreVoice = "vln1" | "vln2" | "vla" | "vc" | "cb";

/** Family, used for balance reporting and for tutti/solo decisions. */
type Family = "ww" | "brass" | "perc" | "str";

type PartDef = {
  partId: string;
  name: string;
  instrument: string;
  family: Family;
  /** Which core voice this part draws from. */
  src: CoreVoice;
  /** Octave shift applied to the core voice (e.g. piccolo +12, bass -12). */
  octave?: number;
  /** Phrase intensity (0..1) at or above which this part plays. */
  enterAt: number;
  /** Romantic-only parts are dropped for the classical roster. */
  romanticOnly?: boolean;
  /** Timpani: only tonic/dominant, only on strong beats. */
  timpani?: boolean;
};

/**
 * The ~16-part practical symphonic roster (Romantic); the classical period uses
 * the 12 non-`romanticOnly` parts. Score order is standard: woodwinds → brass →
 * percussion → strings, which the exporter preserves.
 *
 * enterAt encodes the dynamic architecture — strings play essentially always,
 * winds join as the music fills out, brass and timpani are held for climaxes.
 */
// CALIBRATED 2026-08-03 against real scores supplied by the user, measured as
// "share of measures in which the part sounds":
//
//                        strings   winds   brass   timpani
//   Brahms 3, mvt I        93%      66%     33%      12%     (lyrical sonata)
//   Dvořák 9, finale       86%      67%     51%      44%     (climactic finale)
//
// Within the brass the split is emphatic and consistent: HORNS play far more
// than trumpets/trombones (Brahms 50-54% vs 15-29%; Dvořák 64% vs 44-49%) —
// horns really are the harmonic glue, the rest is reserved weight.
//
// (Two supplied files were deliberately NOT used for these targets: the
// Beethoven 9 "Ode" file is a fully-tutti excerpt where every part plays every
// bar, and the Tchaikovsky is a CONCERTO — its orchestra drops to 51/39/14%
// because it must stay under the soloist. That concerto profile is a good
// future mode, but it is not symphonic default behaviour.)
//
// enterAt is the phrase-intensity at which a part joins; with the curve below it
// yields roughly: strings 100%, winds ~70%, brass ~37%, timpani ~24%.
const SYMPHONIC_PARTS: PartDef[] = [
  // ── Woodwinds — colour and solo lines (target ~70% of measures) ──
  // Thresholds are 0.06 below the 2026-08-03 calibration (Fl .52 Ob .50 Cl .49
  // Bsn .47). The solo pass below rests two of the three melodic winds whenever
  // one takes a line, which cost 8 points of wind participation — 68% measured
  // against the real scores, 60% once solos were added. Lowering entry by 0.06
  // buys those bars back and lands on 68% again. The winds are not playing more
  // than they were; they are playing the same amount, differently arranged.
  { partId: "SY_FL",   name: "Flute",           instrument: "flute",        family: "ww",    src: "vln1", enterAt: 0.46 },
  { partId: "SY_OB",   name: "Oboe",            instrument: "oboe",         family: "ww",    src: "vln2", enterAt: 0.44 },
  { partId: "SY_CL",   name: "Clarinet in Bb",  instrument: "clarinet_bb",  family: "ww",    src: "vla",  enterAt: 0.43 },
  // Bassoon doubles the CELLO line (its Romantic role), not the double bass —
  // that independence is exactly what the worship roster collapses into one part.
  { partId: "SY_BSN",  name: "Bassoon",         instrument: "bassoon",      family: "ww",    src: "vc",   enterAt: 0.41 },

  // ── Brass — horns are the glue (~55%), trumpets/trombones reserved (~20-33%) ──
  { partId: "SY_HN12", name: "Horn 1-2",        instrument: "horn_f",       family: "brass", src: "vla",  enterAt: 0.56 },
  { partId: "SY_HN34", name: "Horn 3-4",        instrument: "horn_f",       family: "brass", src: "vc",   enterAt: 0.60, romanticOnly: true },
  { partId: "SY_TPT",  name: "Trumpet 1-2",     instrument: "trumpet_bb_1", family: "brass", src: "vln2", enterAt: 0.69 },
  { partId: "SY_TBN12",name: "Trombone 1-2",    instrument: "trombone",     family: "brass", src: "vla",  enterAt: 0.75, romanticOnly: true },
  { partId: "SY_TBN3", name: "Trombone 3/Tuba", instrument: "tuba_c",       family: "brass", src: "cb",   enterAt: 0.76, romanticOnly: true },

  // ── Percussion ──
  { partId: "SY_TIMP", name: "Timpani",         instrument: "timpani",      family: "perc",  src: "cb",   enterAt: 0.72, timpani: true },

  // ── Strings — the protagonist: present throughout ──
  { partId: "SY_VLN1", name: "Violin I",        instrument: "violin_1",     family: "str",   src: "vln1", enterAt: 0.00 },
  { partId: "SY_VLN2", name: "Violin II",       instrument: "violin_2",     family: "str",   src: "vln2", enterAt: 0.00 },
  { partId: "SY_VLA",  name: "Viola",           instrument: "viola",        family: "str",   src: "vla",  enterAt: 0.00 },
  { partId: "SY_VC",   name: "Cello",           instrument: "cello",        family: "str",   src: "vc",   enterAt: 0.00 },
  // Contrabass sounds 8vb below the cello line (the exporter writes it 8va).
  { partId: "SY_CB",   name: "Contrabass",      instrument: "contrabass",   family: "str",   src: "cb",   octave: -12, enterAt: 0.39 },
];

/** Below C3 no interval tighter than a 5th (Forsyth/Adler) — acoustics, not style. */
const LOW_LIMIT_MIDI = 48;
const PHRASE_LEN = 4;

export type SymphonicIntensity = "build" | "tutti";
export type SymphonicBalance = "default" | "more_strings" | "more_winds" | "more_brass";
/** Manual per-instrument participation: measure ranges in which a part may play. */
export type PartRange = { part: string; ranges: Array<[number, number]> };

/**
 * Family balance bias. A part joins when phrase intensity ≥ its enterAt, so
 * RAISING a family's threshold makes it recede and lowering it brings it
 * forward. Strings sit at 0.00 (saturated), so "more strings" has to work by
 * pushing winds and brass back rather than by pulling strings further in.
 */
const BALANCE_ADJ: Record<SymphonicBalance, { ww: number; brass: number; str: number }> = {
  default:      { ww:  0.00, brass:  0.00, str:  0.00 },
  more_strings: { ww: +0.20, brass: +0.15, str: -0.10 },
  more_winds:   { ww: -0.22, brass: +0.10, str: +0.06 },
  more_brass:   { ww: +0.10, brass: -0.18, str: +0.05 },
};

function adjustedEnterAt(def: PartDef, balance: SymphonicBalance): number {
  const adj = BALANCE_ADJ[balance];
  const d = def.family === "ww" ? adj.ww : def.family === "brass" ? adj.brass : def.family === "str" ? adj.str : 0;
  return Math.max(0, Math.min(1, def.enterAt + d));
}

function inAnyRange(measureNumber: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([a, b]) => measureNumber >= Math.min(a, b) && measureNumber <= Math.max(a, b));
}

/** Silence a part outside its user-specified measure ranges (advanced control). */
function applyManualRanges(score: ScoreModel, partRanges?: PartRange[]): void {
  if (!Array.isArray(partRanges) || !partRanges.length) return;
  const parts: any[] = (score as any).parts ?? [];
  for (const { part: pid, ranges } of partRanges) {
    if (!Array.isArray(ranges) || !ranges.length) continue;
    const part = parts.find((p) => p.part_id === pid);
    if (!part) continue;
    for (const m of part.measures ?? []) {
      if (inAnyRange(Number(m?.number), ranges)) continue;
      m.events = [];
    }
  }
}

function eventMidi(ev: any): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) { try { return pitchToMidi(ev.pitch); } catch { return null; } }
  return null;
}

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** Clamp into the instrument's real range by octave displacement. */
function clampToInstrument(midi: number, instrument: string): number | null {
  const spec = getInstrumentSpec(instrument);
  if (!spec) return midi;
  const lo = Number(spec.midi_low), hi = Number(spec.midi_high);
  let out = midi;
  while (out < lo) out += 12;
  while (out > hi) out -= 12;
  return out >= lo && out <= hi ? out : null;
}

/**
 * Per-phrase intensity curve: a symphonic arc rather than a worship build.
 * Transparent opening, a fuller middle, and the peak saved for the final third
 * — brass and timpani ride on top of this via each part's enterAt.
 */
function phraseIntensities(nMeasures: number): number[] {
  const nPhrases = Math.max(1, Math.ceil(nMeasures / PHRASE_LEN));
  const out: number[] = [];
  for (let i = 0; i < nPhrases; i++) {
    const pos = nPhrases === 1 ? 1 : i / (nPhrases - 1); // 0..1 through the piece
    // Rise to a broad plateau, then a final lift for the climax.
    let v = 0.30 + 0.55 * Math.pow(pos, 0.85);
    if (pos > 0.80) v = Math.min(1, v + 0.12);           // final climax
    if (i === 0) v = Math.min(v, 0.34);                   // transparent opening
    out.push(Math.max(0, Math.min(1, v)));
  }
  return out;
}

/**
 * Widen muddy low intervals: below C3, nothing tighter than a 5th. Identical
 * acoustics rule to the worship engine, re-implemented here so the two stay
 * completely independent.
 */
function refineLowSpacing(score: ScoreModel): void {
  const parts = (score.parts ?? []).filter((p: any) => p.part_id !== "SY_TIMP");
  const loOf = new Map<string, number>();
  for (const p of parts as any[]) {
    const spec = getInstrumentSpec(p.instrument);
    loOf.set(p.part_id, spec ? Number(spec.midi_low) : 0);
  }
  const nM = Math.max(0, ...parts.map((p: any) => (p.measures ?? []).length));
  for (let mi = 0; mi < nM; mi++) {
    const byOnset = new Map<string, Array<{ ev: any; lo: number }>>();
    for (const p of parts as any[]) {
      const lo = loOf.get(p.part_id) ?? 0;
      for (const ev of (p.measures?.[mi]?.events ?? [])) {
        if (ev?.type !== "note" || !ev.pitch) continue;
        const k = String(Math.round(Number(ev.t ?? 0) * 1000));
        const arr = byOnset.get(k) ?? [];
        arr.push({ ev, lo });
        byOnset.set(k, arr);
      }
    }
    for (const grp of byOnset.values()) {
      const occ = new Map<number, number>();
      for (const g of grp) { const m = eventMidi(g.ev); if (m !== null) occ.set(m, (occ.get(m) ?? 0) + 1); }
      const sorted = grp.map((g) => ({ g, m: eventMidi(g.ev) ?? 0 })).sort((a, b) => a.m - b.m);
      for (let i = 1; i < sorted.length; i++) {
        const lo = sorted[i - 1]!, hi = sorted[i]!;
        const gap = hi.m - lo.m;
        if (hi.m < LOW_LIMIT_MIDI && gap > 0 && gap < 7) {
          const down = lo.m - 12;
          if (down >= lo.g.lo && (occ.get(down) ?? 0) === 0) {
            occ.set(lo.m, (occ.get(lo.m) ?? 1) - 1);
            occ.set(down, 1);
            lo.g.ev.midi = down;
            lo.g.ev.pitch = midiToPitch(down);
            lo.m = down;
          }
        }
      }
    }
  }
}

export type SymphonicOptions = {
  period?: SymphonicPeriod;
  warnings?: string[];
  profile?: string;
  /** Restrict to these part ids (empty/undefined = the whole period roster). */
  parts?: string[];
  /** "build" follows the symphonic arc; "tutti" keeps everyone playing throughout. */
  intensity?: SymphonicIntensity;
  /** Bias the family balance (strings/winds/brass). */
  balance?: SymphonicBalance;
  /** Advanced: restrict individual parts to explicit measure ranges. */
  partRanges?: PartRange[];
};

/**
 * Arrange a lead sheet + chords as a symphonic orchestra.
 * Runs this module's own DP fork for a 5-voice core, then scores it across the
 * period roster with strings leading and brass reserved for climaxes.
 */
/**
 * Fill a melodic third with the step between it.
 *
 * The plainest wind decoration there is, and the one that most separates a
 * wind line from a string line: where the violins sustain, the winds run. Our
 * winds were reading a string voice and playing its rhythm exactly, so they
 * moved like violins — independent in pitch after the source remap, still
 * string-shaped in motion.
 *
 * Only thirds, and only from a note long enough to give up half its length.
 * A passing tone between two chord tones on a weak division is safe against
 * any harmony underneath, which is why it needs no chord lookup to be correct.
 * Wider gaps would want two or three notes and a decision about which, and
 * that is a scale run — a real device, but not this one.
 *
 * Applied where the texture is thin enough to hear it: under a solo, or in a
 * quiet phrase. In a tutti the winds are reinforcement and a decorated line
 * there is just more noise.
 */
function scalePitchClasses(fifths: number): Set<number> {
  const tonic = ((fifths * 7) % 12 + 12) % 12;
  return new Set([0, 2, 4, 5, 7, 9, 11].map((s) => (tonic + s) % 12));
}

const FIGURATION_WINDS = ["SY_FL", "SY_OB", "SY_CL"] as const;
/** Below this the phrase is transparent enough for decoration to read. */
const FIGURATION_MAX_INTENSITY = 0.72;
/** A note must be at least this long to give up half of itself. */
const FIGURATION_MIN_DUR = 0.5;

/**
 * Hold the note instead of striking it again.
 *
 * The figuration below turned out to have almost nothing to work on: of 655
 * adjacent pairs in the wind parts, 573 were the SAME PITCH — 87% repeated
 * notes, and the same on every source tested (84%, 84%, 72%). The wind lines
 * were not melodies to decorate, they were one pitch hammered six times a bar.
 *
 * That is an artefact of the voicing grid rather than a decision: the DP gives
 * each voice a pitch per slice, and a voice that holds its note across four
 * slices comes out as four identical notes. Strings can live with that — a
 * section re-bows a held chord all the time. A wind player does not tongue the
 * same note six times to sustain it; they hold it and breathe.
 *
 * So: merge runs of the same pitch into one note, within the bar. This makes
 * the winds sound like winds, and it lowers their note count — away from the
 * 38-43% note-share the real scores show. That target is not reachable by
 * post-processing and chasing it here would be backwards: real winds hit it by
 * playing figuration, and ours have no melodic motion to figure. Fixing that
 * means composing the wind lines differently, upstream in the voicing.
 */
function holdRepeatedWindNotes(outParts: any[], nMeasures: number): number {
  const byId = new Map<string, any>(outParts.map((p) => [p.part_id, p]));
  let merged = 0;
  for (const id of FIGURATION_WINDS) {
    const part = byId.get(id);
    if (!part) continue;
    for (let mi = 0; mi < nMeasures; mi++) {
      const bar = part.measures?.[mi];
      const notes = (bar?.events ?? [])
        .filter((e: any) => e?.type === "note")
        .sort((a: any, b: any) => Number(a.t) - Number(b.t));
      if (notes.length < 2) continue;
      const out: any[] = [];
      for (const n of notes) {
        const prev = out[out.length - 1];
        const touches = prev && Math.abs(Number(prev.t) + Number(prev.dur) - Number(n.t)) < 1e-9;
        if (prev && touches && Number(prev.midi) === Number(n.midi)) {
          prev.dur = Number(prev.dur) + Number(n.dur);
          merged++;
          continue;
        }
        out.push(n);
      }
      bar.events = out;
    }
  }
  return merged;
}

function addWindFiguration(
  outParts: any[],
  intens: number[],
  nMeasures: number,
  fifths: number
): number {
  const scale = scalePitchClasses(fifths);
  const byId = new Map<string, any>(outParts.map((p) => [p.part_id, p]));
  let added = 0;

  for (const id of FIGURATION_WINDS) {
    const part = byId.get(id);
    if (!part) continue;
    for (let mi = 0; mi < nMeasures; mi++) {
      if ((intens[Math.floor(mi / PHRASE_LEN)] ?? 1) > FIGURATION_MAX_INTENSITY) continue;
      const bar = part.measures?.[mi];
      const notes = (bar?.events ?? [])
        .filter((e: any) => e?.type === "note")
        .sort((a: any, b: any) => Number(a.t) - Number(b.t));
      if (notes.length < 2) continue;

      const out: any[] = [];
      for (let i = 0; i < notes.length; i++) {
        const a = notes[i];
        const b = notes[i + 1];
        out.push(a);
        if (!b) continue;
        // Only between notes that actually touch — a gap is a rest, and a rest
        // is there to be heard.
        if (Math.abs(Number(a.t) + Number(a.dur) - Number(b.t)) > 1e-9) continue;
        if (Number(a.dur) < FIGURATION_MIN_DUR) continue;
        const from = Number(a.midi), to = Number(b.midi);
        const gap = Math.abs(to - from);
        if (gap !== 3 && gap !== 4) continue;
        const step = to > from ? 1 : -1;
        // The scale tone strictly between them; a third spans one or two, and
        // only one of those belongs to the key.
        let passing: number | null = null;
        for (let m = from + step; m !== to; m += step) {
          if (scale.has(((m % 12) + 12) % 12)) { passing = m; break; }
        }
        if (passing === null) continue;
        const placed = clampToInstrument(passing, part.instrument);
        if (placed === null || placed !== passing) continue;

        const half = Number(a.dur) / 2;
        a.dur = half;
        out.push({
          ...a,
          id: `${part.part_id}-${mi + 1}-${Number(a.t) + half}-pass`,
          t: Number(a.t) + half,
          dur: half,
          midi: placed,
          pitch: midiToPitch(placed),
        });
        added++;
      }
      bar.events = out.sort((x: any, y: any) => Number(x.t) - Number(y.t));
    }
  }
  return added;
}

/** The winds that carry a melodic line, in the order a solo passes between them. */
const SOLO_WINDS = ["SY_OB", "SY_FL", "SY_CL"] as const;
/** Fewer distinct pitches than this over the phrase is a drone, not a melody. */
const SOLO_MIN_DISTINCT_PITCHES = 3;
/** A phrase quiet enough for one player to be heard, and not yet the climax. */
const SOLO_MIN_INTENSITY = 0.40;
const SOLO_MAX_INTENSITY = 0.72;

/**
 * Give a wind the line on its own, and get the orchestra out of its way.
 *
 * Flute, oboe, trumpet and the first violins all read the same core voice, so
 * by construction they play the same tune: measured against Violin I, the oboe
 * was identical in 90% of its bars and the flute in 76%. That is doubling, not
 * scoring. A symphony's winds are not a brighter layer of the violins — they
 * step out, take the tune alone, and hand it back.
 *
 * So in a few middle phrases — past the transparent opening, short of the
 * climax where everyone belongs — one wind keeps its line while the other
 * melodic winds rest and the first violins fall back to a held note. The
 * bassoon stays: it reads the cello and is accompaniment here, not a rival.
 * This is Tovey's opposition, which this file's own header has always claimed
 * and never did: the orchestra recedes for a solo line.
 *
 * Returns what it placed, so the arrangement can say who plays where.
 */
function applyWindSolos(
  outParts: any[],
  intens: number[],
  nMeasures: number
): Array<{ partId: string; name: string; fromBar: number }> {
  const byId = new Map<string, any>(outParts.map((p) => [p.part_id, p]));
  const vln1 = byId.get("SY_VLN1");
  const placed: Array<{ partId: string; name: string; fromBar: number }> = [];
  const nPhrases = Math.ceil(nMeasures / PHRASE_LEN);
  if (nPhrases < 4 || !vln1) return placed;

  const sounds = (part: any, mi: number) =>
    (part?.measures?.[mi]?.events ?? []).some((e: any) => e?.type === "note");

  let turn = 0;
  // Never the first phrase (the opening is thin already) nor the last (the
  // close is everyone's), and never two in a row — a solo answered by another
  // solo is a duet, and the texture stops being an opposition.
  for (let pi = 1; pi < nPhrases - 1; pi++) {
    const intensity = intens[pi] ?? 0.5;
    if (intensity < SOLO_MIN_INTENSITY || intensity > SOLO_MAX_INTENSITY) continue;
    if (placed.length && pi - (placed[placed.length - 1]!.fromBar - 1) / PHRASE_LEN < 2) continue;

    const bars: number[] = [];
    for (let mi = pi * PHRASE_LEN; mi < Math.min((pi + 1) * PHRASE_LEN, nMeasures); mi++) bars.push(mi);

    // Whoever is actually playing here takes it; a rest cannot have a solo —
    // and neither can a drone. Exposing a line that holds one pitch for four
    // bars does not make a solo of it, it makes the flaw audible: strings drop
    // away, everyone looks at the oboe, and the oboe has nothing to say. The
    // first version of this shipped without the test and did exactly that.
    const melodic = (id: string) => {
      const pitches = new Set<number>();
      for (const mi of bars) {
        for (const e of (byId.get(id)?.measures?.[mi]?.events ?? [])) {
          if (e?.type === "note") pitches.add(Number(e.midi));
        }
      }
      return pitches.size >= SOLO_MIN_DISTINCT_PITCHES;
    };
    const candidates = SOLO_WINDS.filter(
      (id) => bars.some((mi) => sounds(byId.get(id), mi)) && melodic(id)
    );
    if (!candidates.length) continue;
    const soloId = candidates[turn % candidates.length]!;
    const solo = byId.get(soloId);
    turn++;

    for (const mi of bars) {
      for (const id of SOLO_WINDS) {
        if (id === soloId) continue;
        const p = byId.get(id);
        if (p?.measures?.[mi]) p.measures[mi].events = [];
      }
      // The first violins hold instead of moving: the harmony stays, the
      // competition for the ear goes.
      const bar = vln1.measures?.[mi];
      const notes = (bar?.events ?? []).filter((e: any) => e?.type === "note");
      if (!bar || !notes.length) continue;
      const barBeats = notes.reduce((m: number, e: any) => Math.max(m, Number(e.t) + Number(e.dur)), 0);
      const first = notes[0];
      bar.events = [{
        ...first,
        id: `${vln1.part_id}-${mi + 1}-sustain`,
        t: 0,
        dur: barBeats,
      }];
    }
    placed.push({ partId: soloId, name: solo.name, fromBar: bars[0]! + 1 });
  }
  return placed;
}

export function arrangeSymphonicOrchestra(
  score: ScoreModel,
  chords: ChordEvent[],
  options: SymphonicOptions = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const period: SymphonicPeriod = options.period === "classical" ? "classical" : "romantic";

  // 1) Voice-leading core (symphonic fork: no worship harmony post-processing).
  const core = arrangeStringEnsemble(score, chords, {
    profile: (options.profile ?? "melody_harmony") as any,
  }).scoreModel as ScoreModel;

  const coreByVoice = new Map<CoreVoice, any>();
  const CORE_NAMES: Record<CoreVoice, RegExp> = {
    vln1: /violin i\b|violin 1/i, vln2: /violin ii\b|violin 2/i,
    vla: /viola/i, vc: /cello/i, cb: /bass/i,
  };
  for (const v of ["vln1", "vln2", "vla", "vc", "cb"] as CoreVoice[]) {
    const p = (core.parts ?? []).find((x: any) => CORE_NAMES[v].test(String(x?.name ?? "")));
    if (p) coreByVoice.set(v, p);
  }
  if (!coreByVoice.size) {
    warnings.push("[symphonic] Could not read the voice core — returning the core score.");
    return { scoreModel: core, warnings };
  }

  // 2) Roster for the period, optionally filtered by the caller.
  let roster = SYMPHONIC_PARTS.filter((p) => period === "romantic" || !p.romanticOnly);
  if (options.parts?.length) {
    const want = new Set(options.parts);
    const filtered = roster.filter((p) => want.has(p.partId));
    if (filtered.length) roster = filtered;
  }

  const nM = Math.max(0, ...[...coreByVoice.values()].map((p: any) => (p.measures ?? []).length));
  const balance: SymphonicBalance = options.balance ?? "default";
  // "tutti": every phrase is full, so the whole roster plays throughout.
  const intens = options.intensity === "tutti"
    ? new Array(Math.max(1, Math.ceil(nM / PHRASE_LEN))).fill(1)
    : phraseIntensities(nM);

  // Tonic pitch class for the timpani (tonic/dominant only).
  const firstAttrs: any = (core.parts?.[0]?.measures?.[0] as any)?.attributes;
  const fifths = Number(firstAttrs?.key_fifths ?? 0);
  const tonicPc = ((fifths * 7) % 12 + 12) % 12;
  const dominantPc = (tonicPc + 7) % 12;

  // 3) Score each part from its core voice, gated by the intensity curve.
  const outParts: any[] = [];
  for (const def of roster) {
    const srcPart = coreByVoice.get(def.src);
    if (!srcPart) continue;
    const measures: any[] = [];
    for (let mi = 0; mi < nM; mi++) {
      const srcM = srcPart.measures?.[mi];
      const intensity = intens[Math.floor(mi / PHRASE_LEN)] ?? 0.5;
      const plays = intensity >= adjustedEnterAt(def, balance);
      const events: any[] = [];
      if (plays) {
        for (const ev of (srcM?.events ?? [])) {
          if (ev?.type !== "note" || !ev.pitch) continue;
          let midi = eventMidi(ev);
          if (midi === null) continue;
          midi += def.octave ?? 0;
          if (def.timpani) {
            // Timpani: tonic/dominant only, and only on the downbeat.
            const pc = ((midi % 12) + 12) % 12;
            if (Number(ev.t ?? 0) > 0.01) continue;
            if (pc !== tonicPc && pc !== dominantPc) continue;
          }
          const placed = clampToInstrument(midi, def.instrument);
          if (placed === null) continue;
          events.push({
            id: `${def.partId}-${mi + 1}-${ev.t}`,
            t: ev.t, dur: ev.dur, type: "note",
            pitch: midiToPitch(placed), midi: placed,
            voice: 1, staff: 1,
          });
        }
      }
      measures.push({
        number: srcM?.number ?? mi + 1,
        ...(srcM?.attributes ? { attributes: clone(srcM.attributes) } : {}),
        events,
      });
    }
    outParts.push({
      part_id: def.partId, name: def.name, instrument: def.instrument,
      staves: 1, measures,
    });
  }

  const out: any = {
    ...core,
    parts: outParts,
    meta: { ...(core as any).meta, ensemble: "symphonic_orchestra", symphonicPeriod: period },
  };

  const solos = applyWindSolos(outParts, intens, nM);
  // Hold before decorating: a run of repeated notes offers no interval to fill,
  // and merging them first is what turns the line into one that can be figured.
  const held = holdRepeatedWindNotes(outParts, nM);
  if (held) {
    warnings.push(
      `[symphonic] Wind lines: ${held} repeated note${held === 1 ? "" : "s"} held rather than re-tongued — ` +
      "a wind sustains a pitch, it does not restrike it."
    );
  }
  const figured = addWindFiguration(outParts, intens, nM, fifths);
  if (figured) {
    warnings.push(
      `[symphonic] Wind figuration: ${figured} passing tone${figured === 1 ? "" : "s"} filling melodic ` +
      "thirds in the transparent phrases — where the strings sustain, the winds move."
    );
  }
  if (solos.length) {
    warnings.push(
      `[symphonic] Wind solos: ${solos.map((s) => `${s.name} from bar ${s.fromBar}`).join(", ")} — ` +
      "the other winds rest and the first violins sustain under them."
    );
  }

  // Advanced: honour explicit per-instrument measure ranges before spacing.
  applyManualRanges(out as ScoreModel, options.partRanges);

  refineLowSpacing(out as ScoreModel);

  // Family balance report — the symphonic target inverts the worship one
  // (strings-led rather than brass-forward).
  const count = (fam: Family) => outParts
    .filter((p) => roster.find((d) => d.partId === p.part_id)?.family === fam)
    .reduce((a, p) => a + (p.measures ?? []).reduce((b: number, m: any) => b + (m.events ?? []).length, 0), 0);
  const ww = count("ww"), br = count("brass"), st = count("str");
  const tot = ww + br + st || 1;
  warnings.push(
    `[symphonic] ${period} roster: ${outParts.length} parts · balance strings ${Math.round(100 * st / tot)}% / ` +
    `winds ${Math.round(100 * ww / tot)}% / brass ${Math.round(100 * br / tot)}% (strings-led, brass reserved).`
  );

  return { scoreModel: out as ScoreModel, warnings };
}

export { SYMPHONIC_PARTS };
