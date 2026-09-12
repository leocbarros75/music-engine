import { writePerformanceNotation } from "./performanceNotation";
import { buildMeasureTimeline } from "../score/standard";
import { toSoundingScore } from "../score/pitch";
// src/exporters/musicxmlExporter.ts

import type { ScoreModel } from "../score/types";
import { midiToPitch, pitchToMidi, type Pitch } from "../instruments/instrumentCatalog";

type TransposeSpec = { diatonic: number; chromatic: number; octaveChange?: number };

type ClefSpec =
  | { sign: "G" | "F"; line: 2 | 4 }
  | { sign: "C"; line: 3 }
  | { sign: "percussion"; line: 2 };

type PercMap = {
  instrumentId: string;
  midiUnpitched: number; // General MIDI drum number
  displayStep: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  displayOctave: number;
  notehead?: "x" | "normal" | "diamond";
};

/**
 * Choral voice names, used only to veto the part-NAME fallback when resolving
 * transposition (see the call site). A part that explicitly declares
 * `instrument: "bass"` is a bass guitar and still transposes; a part that merely
 * happens to be *named* "Bass" is the choral voice and must not.
 */
const CHORAL_VOICE_NAMES = new Set(["soprano", "alto", "tenor", "bass"]);

/** Family rank for a part the orchestral families do not recognise (voices, "Melody", …). */
const UNKNOWN_GROUP_RANK = 90;

function multiRestXml(count: number): string {
  return `<measure-style><multiple-rest>${count}</multiple-rest></measure-style>`;
}

/**
 * Runs of silent bars a player should be able to count as one.
 *
 * The symphonic orchestra stages its entries — timpani rest for fourteen of
 * fifteen bars, trumpets and trombones for twelve — and a part printing twelve
 * separate whole rests is a part nobody can keep their place in.
 *
 * PARTS ONLY, never a full score. A multi-measure rest compresses one staff's
 * bars into a single numbered box; do that to the timpani while the violins
 * play and every system below it loses its vertical alignment. The convention
 * belongs to extracted parts, which is why this is keyed on the export holding
 * exactly one part.
 *
 * A run breaks wherever the player needs to see the bar go by: a meter, key or
 * divisions change, a tempo or dynamic mark, a cadence annotation. Runs of one
 * stay as an ordinary bar's rest.
 */
function findMultiMeasureRests(
  measures: any[],
  cadenceTextByMeasure: Record<number, string>,
  enabled: boolean
): Map<number, number> {
  const out = new Map<number, number>();
  if (!enabled) return out;

  const silent = (m: any) => !(m?.events ?? []).some((e: any) => e?.type === "note");
  const shape = (m: any) =>
    [
      m?.attributes?.divisions,
      m?.attributes?.key_fifths,
      m?.attributes?.key_mode,
      m?.attributes?.time?.beats,
      m?.attributes?.time?.beat_type
    ].join("|");
  const marked = (m: any) => {
    const perf = m?.performance;
    return (
      !!cadenceTextByMeasure[Number(m?.number)] ||
      !!perf?.tempos?.length ||
      !!perf?.dynamics?.length ||
      !!perf?.repeatStart ||
      !!perf?.repeatEnd ||
      !!perf?.endings?.length
    );
  };

  let i = 0;
  while (i < measures.length) {
    if (!silent(measures[i]) || marked(measures[i])) { i++; continue; }
    let j = i + 1;
    while (
      j < measures.length &&
      silent(measures[j]) &&
      !marked(measures[j]) &&
      shape(measures[j]) === shape(measures[i])
    ) j++;
    const count = j - i;
    if (count >= 2) out.set(i, count);
    i = j;
  }
  return out;
}

/** The dedicated melody/lead staff the piano ensembles emit above the grand staff. */
function isMelodyPart(p: { part_id?: string; name?: string }): boolean {
  return (
    String(p.part_id ?? "") === "P_MEL" ||
    String(p.name ?? "").trim().toLowerCase() === "melody"
  );
}

function getTransposeForInstrument(instrument: string | undefined): TransposeSpec | null {
  if (!instrument) return null;
  const id = instrument.toLowerCase().replace(/\s+/g, "_");

  if (
    id === "trumpet_bb" ||
    id === "trumpet_bb_1" ||
    id === "trumpet_bb_2" ||
    id === "clarinet_bb" ||
    id === "clarinet_in_bb"
  ) {
    return { diatonic: -1, chromatic: -2, octaveChange: 0 };
  }

  if (id === "tenor_sax_bb" || id === "tenor_sax" || id === "tenor_saxophone_bb") {
    return { diatonic: -1, chromatic: -2, octaveChange: -1 };
  }

  if (id === "alto_sax_eb" || id === "alto_sax" || id === "alto_saxophone_eb") {
    return { diatonic: -5, chromatic: -9, octaveChange: 0 };
  }

  if (id === "soprano_sax_bb" || id === "soprano_sax" || id === "soprano_saxophone_bb") {
    return { diatonic: -1, chromatic: -2, octaveChange: 0 };
  }

  if (id === "baritone_sax_eb" || id === "bari_sax_eb" || id === "baritone_sax" || id === "baritone_saxophone_eb") {
    return { diatonic: -5, chromatic: -9, octaveChange: -1 };
  }

  if (id === "horn_f" || id === "f_horn" || id === "horn") {
    return { diatonic: -4, chromatic: -7, octaveChange: 0 };
  }

  if (id === "contrabass" || id === "double_bass") {
    // Traditional notation: write one octave higher than sounding.
    return { diatonic: 0, chromatic: 0, octaveChange: -1 };
  }

  if (id === "bass" || id === "electric_bass") {
    return { diatonic: 0, chromatic: 0, octaveChange: -1 };
  }

  return null;
}

function isConcertKeyInstrument(instrument: string | undefined): boolean {
  const id = (instrument ?? "").toLowerCase();
  if (id === "trombone" || id === "tuba" || id === "tuba_c" || id === "bassoon") return true;
  return false;
}

function isDrums(instrument: string | undefined): boolean {
  const id = (instrument ?? "").toLowerCase();
  return id === "drums" || id === "drumset" || id === "kit" || id === "drum_set";
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function transposeKeyFifths(concertFifths: number, semitoneShift: number): number {
  const targetPc = mod(7 * concertFifths + semitoneShift, 12);

  let best = 0;
  let bestAbs = 999;

  for (let f = -7; f <= 7; f++) {
    const pc = mod(7 * f, 12);
    if (pc !== targetPc) continue;
    const abs = Math.abs(f);
    if (abs < bestAbs) {
      best = f;
      bestAbs = abs;
    }
  }

  return best;
}

function xmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function durToType(divisions: number, dur: number): string | null {
  if (!divisions || divisions <= 0) return null;
  const d = divisions;
  if (dur === d * 4)     return "whole";
  if (dur === d * 3)     return "half";     // dotted half
  if (dur === d * 2)     return "half";
  if (dur === d * 3 / 2) return "quarter";  // dotted quarter (e.g. dur=6 at div=4)
  if (dur === d)         return "quarter";
  if (dur === d * 3 / 4) return "eighth";   // dotted eighth (e.g. dur=3 at div=4)
  if (dur === d / 2)     return "eighth";
  if (dur === d / 4)     return "16th";
  if (dur === d / 8)     return "32nd";
  return null;
}

/**
 * Snap a duration (in divisions) DOWN to the nearest standard note value.
 * Non-standard values (e.g. 13 divisions = 3.25 beats, 5 divisions = 1.25 beats)
 * produce null from durToType, which means no <type> element is written.
 * MuseScore then misinterprets the note and inserts a ghost rest → "17/16" error.
 *
 * By snapping here (at the exporter boundary), we guarantee every note that
 * leaves the engine has a valid displayable type regardless of what any upstream
 * generator produced.  The exporter's existing trailing-rest logic fills the
 * small remaining gap at the barline.
 */
function snapDurToStandard(divisions: number, dur: number): number {
  if (!divisions || divisions <= 0) return dur;
  // Standard multiples in descending order
  const mults = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25, 0.125];
  for (const m of mults) {
    const candidate = Math.round(divisions * m); // avoid float drift
    if (candidate > 0 && candidate <= dur + 0.5) return candidate;
  }
  return Math.max(1, dur);
}

/** Returns true when the duration is a dotted note value (needs a <dot/> element). */
function durHasDot(divisions: number, dur: number): boolean {
  if (!divisions || divisions <= 0) return false;
  const d = divisions;
  return dur === d * 3 || dur === d * 3 / 2 || dur === d * 3 / 4;
}

/**
 * Decompose an arbitrary duration (in divisions) into a sequence of STANDARD
 * note values that sum to it — the readable rhythm vocabulary:
 *   whole, dotted-half, half, dotted-quarter, quarter, dotted-eighth, eighth,
 *   16th, 32nd. (From the user's "Rhythm examples" reference.)
 *
 * A non-standard duration like 1.25 beats (quarter + 16th) becomes two values
 * [quarter, 16th] which the caller renders as TIED notes (for pitches) or as
 * separate rests. This guarantees every emitted note/rest has a valid <type>,
 * eliminating the type-less notes that MuseScore turns into ghost rests, and
 * never silently drops or overflows beats.
 *
 * Greedy largest-first; each component is guaranteed to have a valid durToType.
 */
function decomposeToStandardDivs(divisions: number, totalDivs: number): number[] {
  if (!divisions || divisions <= 0 || totalDivs <= 0) return [];
  // Standard multiples of a quarter (divisions), descending. Dotted values
  // included so e.g. 3 beats → one dotted-half, not half+quarter.
  const mults = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25, 0.125];
  const standard = mults.map((m) => Math.round(divisions * m)).filter((v) => v > 0);
  const out: number[] = [];
  let remaining = Math.round(totalDivs);
  let guard = 0;
  while (remaining > 0 && guard++ < 64) {
    const next = standard.find((v) => v <= remaining);
    if (next === undefined) break; // remaining smaller than a 32nd — drop the sliver
    out.push(next);
    remaining -= next;
  }
  return out.length ? out : [Math.max(1, Math.round(totalDivs))];
}

function beatsToDivisionsDuration(durBeats: number, divisions: number): number {
  if (!Number.isFinite(durBeats) || durBeats <= 0) return Math.max(1, divisions);
  if (!Number.isFinite(divisions) || divisions <= 0) return Math.max(1, Math.round(durBeats));
  const raw = durBeats * divisions;
  const rounded = Math.round(raw);
  const epsilon = 1e-6;
  if (Math.abs(raw - rounded) < epsilon) return Math.max(1, rounded);
  return Math.max(1, rounded);
}

const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

function keySignatureAlter(step: string, keyFifths: number): number {
  const s = String(step || "").toUpperCase();
  if (!s) return 0;
  if (keyFifths > 0) {
    const idx = Math.min(keyFifths, 7);
    return SHARP_ORDER.slice(0, idx).includes(s) ? 1 : 0;
  }
  if (keyFifths < 0) {
    const idx = Math.min(Math.abs(keyFifths), 7);
    return FLAT_ORDER.slice(0, idx).includes(s) ? -1 : 0;
  }
  return 0;
}

function accidentalFromAlterForDisplay(alter: number): string | null {
  if (alter === 0) return "natural";
  if (alter === 1) return "sharp";
  if (alter === -1) return "flat";
  if (alter === 2) return "double-sharp";
  if (alter === -2) return "double-flat";
  return null;
}

function normalizePitchForKey(p: Pitch, keyFifths: number): Pitch {
  const pc = mod(pitchToMidi(p), 12);

  const flatTargets = [
    [],
    [10],
    [10, 3],
    [10, 3, 8],
    [10, 3, 8, 1],
    [10, 3, 8, 1, 6],
    [10, 3, 8, 1, 6, 11],
    [10, 3, 8, 1, 6, 11, 4]
  ];

  const sharpTargets = [
    [],
    [6],
    [6, 1],
    [6, 1, 8],
    [6, 1, 8, 3],
    [6, 1, 8, 3, 10],
    [6, 1, 8, 3, 10, 5],
    [6, 1, 8, 3, 10, 5, 0]
  ];

  const flatsByPc: Record<number, { step: string; alter: number }> = {
    10: { step: "B", alter: -1 },
    3: { step: "E", alter: -1 },
    8: { step: "A", alter: -1 },
    1: { step: "D", alter: -1 },
    6: { step: "G", alter: -1 },
    11: { step: "C", alter: -1 },
    4: { step: "F", alter: -1 }
  };

  const sharpsByPc: Record<number, { step: string; alter: number }> = {
    6: { step: "F", alter: 1 },
    1: { step: "C", alter: 1 },
    8: { step: "G", alter: 1 },
    3: { step: "D", alter: 1 },
    10: { step: "A", alter: 1 },
    5: { step: "E", alter: 1 },
    0: { step: "B", alter: 1 }
  };

  if (keyFifths < 0) {
    const idx = Math.min(Math.abs(keyFifths), 7);
    if (flatTargets[idx]?.includes(pc)) {
      const mapped = flatsByPc[pc];
      if (mapped) return { ...p, step: mapped.step, alter: mapped.alter };
    }
    return p;
  }

  if (keyFifths > 0) {
    const idx = Math.min(Math.abs(keyFifths), 7);
    if (sharpTargets[idx]?.includes(pc)) {
      const mapped = sharpsByPc[pc];
      if (mapped) return { ...p, step: mapped.step, alter: mapped.alter };
    }
    return p;
  }

  return p;
}

function clefForPart(p: { instrument?: string; part_id?: string; name?: string }, fallback: "G" | "F" = "G"): ClefSpec {
  const s = `${p.instrument ?? ""} ${p.part_id ?? ""} ${p.name ?? ""}`.toLowerCase();

  if (isDrums(p.instrument) || s.includes("drums") || s.includes("drumset") || s.includes("percussion")) {
    return { sign: "percussion", line: 2 };
  }

  // Strings: enforce correct clefs even if p.instrument is generic (ex: "strings")
  if (s.includes("viola") || s.includes("vla")) {
    return { sign: "C", line: 3 }; // Alto clef
  }
  if (s.includes("cello") || s.includes("vlc") || s.includes("violoncello")) {
    return { sign: "F", line: 4 }; // Bass clef
  }
  if (
    s.includes("contrabass") ||
    s.includes("double_bass") ||
    s.includes("double bass") ||
    (s.includes("bass") && !s.includes("bassoon"))
  ) {
    return { sign: "F", line: 4 };
  }

  // Pitched percussion
  if (s.includes("timpani")) {
    return { sign: "F", line: 4 };
  }

  // Other bass clef instruments
  if (s.includes("trombone") || s.includes("tuba") || s.includes("tuba_c") || s.includes("bassoon")) {
    return { sign: "F", line: 4 };
  }

  return fallback === "F" ? { sign: "F", line: 4 } : { sign: "G", line: 2 };
}

function writtenToSoundingSemis(transpose: TransposeSpec): number {
  const oct = transpose.octaveChange ?? 0;
  return transpose.chromatic + 12 * oct;
}

function toWrittenPitch(p: Pitch, transpose: TransposeSpec | null, instrument: string | undefined): Pitch {
  if (!transpose) return p;
  if (isConcertKeyInstrument(instrument)) return p;

  const shift = -writtenToSoundingSemis(transpose);
  const m = pitchToMidi(p);
  return midiToPitch(m + shift);
}

function isPiano(instrument: string | undefined): boolean {
  const id = (instrument ?? "").toLowerCase();
  return id === "piano" || id === "acoustic_piano" || id === "grand_piano";
}

/**
 * Orchestra order sorting (standard):
 *   1) Woodwinds
 *   2) Brass
 *   3) Percussion
 *   4) Strings
 * Anything unknown falls after, preserving original order.
 */
function orchestraGroupRank(p: { instrument?: string; part_id?: string; name?: string }): number {
  const s = `${p.instrument ?? ""} ${p.part_id ?? ""} ${p.name ?? ""}`.toLowerCase();

  // A dedicated melody/lead staff belongs ON TOP of whatever accompanies it, as in
  // any lead + piano score. Without this it falls into the unknown group (90) and
  // sorts UNDER the piano (35) — the plain "piano" ensemble emits a Melody part too,
  // not just piano_with_melody, and its melody was landing below the grand staff.
  //
  // Matched exactly, never as a substring: "melody" inside some other part's name
  // must not hoist that part to the top of an orchestral score.
  if (isMelodyPart(p)) return 0;

  const isWoodwind =
    s.includes("flute") ||
    s.includes("piccolo") ||
    s.includes("oboe") ||
    s.includes("english_horn") ||
    s.includes("cor_anglais") ||
    s.includes("clarinet") ||
    s.includes("bass_clarinet") ||
    s.includes("bass clarinet") ||
    s.includes("sax") ||
    s.includes("bassoon") ||
    s.includes("contrabassoon");

  const isBrass =
    s.includes("trumpet") ||
    s.includes("cornet") ||
    s.includes("horn") ||
    s.includes("f_horn") ||
    s.includes("trombone") ||
    s.includes("tuba") ||
    s.includes("euphonium") ||
    s.includes("baritone") ||
    s.includes("tbn");

  const isPerc =
    isDrums(p.instrument) ||
    s.includes("percussion") ||
    s.includes("timpani") ||
    s.includes("glockenspiel") ||
    s.includes("tubular_bells") ||
    s.includes("tubular bells") ||
    s.includes("chimes") ||
    s.includes("bells") ||
    s.includes("vibraphone") ||
    s.includes("marimba") ||
    s.includes("xylophone") ||
    s.includes("cymbal") ||
    s.includes("triangle") ||
    s.includes("tambourine") ||
    s.includes("snare") ||
    s.includes("kick") ||
    s.includes("drum");

  const isString =
    s.includes("violin") ||
    s.includes("viola") ||
    s.includes("cello") ||
    s.includes("contrabass") ||
    s.includes("double_bass") ||
    s.includes("double bass") ||
    s.includes("string");

  // Piano/keyboard: appears just before strings (rank 35) so that in a
  // piano_with_strings score the piano is listed at the top, above the strings.
  const isPiano =
    s.includes("piano") ||
    s.includes("keyboard") ||
    s.includes("harpsichord") ||
    s.includes("organ") ||
    s.includes("celesta");

  if (isWoodwind) return 10;
  if (isBrass) return 20;
  if (isPerc) return 30;
  if (isPiano) return 35;
  if (isString) return 40;
  return UNKNOWN_GROUP_RANK;
}

function orchestraWithinGroupRank(p: { instrument?: string; part_id?: string; name?: string }): number {
  const s = `${p.instrument ?? ""} ${p.part_id ?? ""} ${p.name ?? ""}`.toLowerCase();

  // Woodwinds
  if (s.includes("piccolo")) return 1;
  if (s.includes("flute")) return 2;
  if (s.includes("oboe") || s.includes("english_horn") || s.includes("cor_anglais")) return 3;
  if (s.includes("clarinet")) return 4;
  if (s.includes("bassoon") || s.includes("contrabassoon")) return 5;

  // Brass
  if (s.includes("trumpet") || s.includes("cornet")) return 1;
  if (s.includes("horn")) return 2;
  if (s.includes("trombone")) return 3;
  if (s.includes("tuba") || s.includes("euphonium") || s.includes("baritone")) return 4;

  // Percussion
  if (s.includes("timpani")) return 1;
  if (isDrums(p.instrument) || s.includes("drum")) return 2;
  if (s.includes("glockenspiel") || s.includes("xylophone") || s.includes("marimba") || s.includes("vibraphone"))
    return 3;
  if (s.includes("tubular_bells") || s.includes("tubular bells") || s.includes("chimes") || s.includes("bells"))
    return 4;
  if (s.includes("cymbal") || s.includes("triangle") || s.includes("tambourine")) return 5;

  // Strings
  if (s.includes("violin_1") || s.includes("violin i") || s.includes("violin 1")) return 1;
  if (s.includes("violin_2") || s.includes("violin ii") || s.includes("violin 2")) return 2;
  if (s.includes("viola")) return 3;
  if (s.includes("cello")) return 4;
  if (s.includes("contrabass") || s.includes("double_bass") || s.includes("double bass") || s.includes("bass"))
    return 5;

  return 999;
}

function sortPartsOrchestrally<T extends { instrument?: string; part_id?: string; name?: string }>(parts: T[]): T[] {
  const tagged = parts.map((p, idx) => {
    const g = orchestraGroupRank(p);
    // orchestraWithinGroupRank matches instrument keywords without checking the
    // family it just ranked, so it is only meaningful inside a KNOWN family.
    // Applied to the unknown group it mis-ranks parts by accidental substrings:
    // a choral "Bass" hits the contrabass branch (5) while Soprano/Alto/Tenor
    // stay at 999, hoisting the bass to the top of the score. Unknown parts keep
    // the order the arranger emitted them in.
    return { p, idx, g, w: g === UNKNOWN_GROUP_RANK ? 0 : orchestraWithinGroupRank(p) };
  });

  tagged.sort((a, b) => {
    if (a.g !== b.g) return a.g - b.g;
    if (a.w !== b.w) return a.w - b.w;
    return a.idx - b.idx;
  });

  return tagged.map((t) => t.p);
}

/**
 * Unpitched percussion map (expanded).
 * instrumentId is what your arranger writes into ev.instrumentId.
 */
function getPercussionMap(instrumentId: string): PercMap | null {
  const id = (instrumentId ?? "").toLowerCase();

  if (id === "kick" || id === "bd" || id === "bass_drum") {
    return { instrumentId: "kick", midiUnpitched: 36, displayStep: "C", displayOctave: 3, notehead: "normal" };
  }
  if (id === "snare" || id === "sd" || id === "snare_drum") {
    return { instrumentId: "snare", midiUnpitched: 38, displayStep: "E", displayOctave: 4, notehead: "normal" };
  }
  if (id === "hihat" || id === "hi_hat" || id === "hihat_closed" || id === "hhc") {
    return { instrumentId: "hihat_closed", midiUnpitched: 42, displayStep: "G", displayOctave: 5, notehead: "x" };
  }
  if (id === "hihat_open" || id === "hho") {
    return { instrumentId: "hihat_open", midiUnpitched: 46, displayStep: "G", displayOctave: 5, notehead: "x" };
  }
  if (id === "ride" || id === "rc" || id === "ride_cymbal") {
    return { instrumentId: "ride", midiUnpitched: 51, displayStep: "F", displayOctave: 5, notehead: "x" };
  }
  if (id === "crash" || id === "cc" || id === "crash_cymbal") {
    return { instrumentId: "crash", midiUnpitched: 49, displayStep: "A", displayOctave: 5, notehead: "x" };
  }

  if (id === "suspended_cymbal" || id === "sus_cymbal" || id === "suspended cymbal" || id === "susp_cymbal") {
    return {
      instrumentId: "suspended_cymbal",
      midiUnpitched: 57,
      displayStep: "A",
      displayOctave: 5,
      notehead: "x"
    };
  }

  if (id === "mallets" || id === "mallet") {
    return { instrumentId: "mallets", midiUnpitched: 81, displayStep: "C", displayOctave: 5, notehead: "diamond" };
  }

  if (id === "bells" || id === "jingle_bell" || id === "sleigh_bells" || id === "sleighbells") {
    return { instrumentId: "bells", midiUnpitched: 83, displayStep: "E", displayOctave: 5, notehead: "x" };
  }

  if (id === "chimes" || id === "wind_chimes" || id === "bell_tree" || id === "belltree") {
    return { instrumentId: "chimes", midiUnpitched: 84, displayStep: "F", displayOctave: 5, notehead: "x" };
  }

  if (id === "tambourine" || id === "tambo") {
    return { instrumentId: "tambourine", midiUnpitched: 54, displayStep: "D", displayOctave: 5, notehead: "x" };
  }
  if (id === "shaker" || id === "maraca" || id === "maracas") {
    if (id === "shaker") {
      return { instrumentId: "shaker", midiUnpitched: 82, displayStep: "E", displayOctave: 5, notehead: "x" };
    }
    return { instrumentId: "maracas", midiUnpitched: 70, displayStep: "E", displayOctave: 5, notehead: "x" };
  }
  if (id === "claves" || id === "clave") {
    return { instrumentId: "claves", midiUnpitched: 75, displayStep: "A", displayOctave: 4, notehead: "normal" };
  }
  if (id === "triangle" || id === "tri") {
    return { instrumentId: "triangle", midiUnpitched: 81, displayStep: "B", displayOctave: 5, notehead: "diamond" };
  }
  if (id === "cabasa") {
    return { instrumentId: "cabasa", midiUnpitched: 69, displayStep: "D", displayOctave: 5, notehead: "x" };
  }
  if (id === "cowbell") {
    return { instrumentId: "cowbell", midiUnpitched: 56, displayStep: "G", displayOctave: 4, notehead: "normal" };
  }
  if (id === "woodblock" || id === "wood_block") {
    return { instrumentId: "woodblock", midiUnpitched: 76, displayStep: "F", displayOctave: 4, notehead: "normal" };
  }

  return null;
}

function scoreInstrumentXml(partId: string, pm: PercMap): { score: string; midi: string } {
  const instXmlId = `${partId}-I${pm.midiUnpitched}`;
  const safeName = xmlEscape(pm.instrumentId);

  const score =
    `<score-instrument id="${xmlEscape(instXmlId)}">` +
    `<instrument-name>${safeName}</instrument-name>` +
    `</score-instrument>`;

  const midi =
    `<midi-instrument id="${xmlEscape(instXmlId)}">` +
    `<midi-channel>10</midi-channel>` +
    `<midi-unpitched>${pm.midiUnpitched}</midi-unpitched>` +
    `<volume>78.7402</volume>` +
    `<pan>0</pan>` +
    `</midi-instrument>`;

  return { score, midi };
}

function cadenceTypeToLabel(type: string): string {
  const t = String(type ?? "").toLowerCase();
  if (t === "authentic_perfect") return "PAC";
  if (t === "authentic_imperfect") return "IAC";
  if (t === "half") return "HC";
  if (t === "plagal") return "PL";
  if (t === "deceptive") return "DC";
  if (t === "phrygian") return "Phryg";
  if (t === "none") return "None";
  return String(type ?? "Cadence");
}

function buildCadenceTextByMeasure(scoreModel: ScoreModel): Record<number, string> {
  const out: Record<number, string> = {};

  const cadences = (scoreModel as any)?.meta?.harmony?.cadences ?? (scoreModel as any)?.meta?.cadences ?? [];
  if (!Array.isArray(cadences)) return out;

  for (const c of cadences) {
    const m = typeof c?.atMeasure === "number" ? c.atMeasure : null;
    const type = typeof c?.type === "string" ? c.type : null;
    if (!m || !type) continue;

    const label = cadenceTypeToLabel(type);

    const prev = String(c?.evidence?.prevRoman ?? "").trim();
    const last = String(c?.evidence?.lastRoman ?? "").trim();
    const ev = prev && last ? ` (${prev}→${last})` : "";

    out[m] = `${label}${ev}`;
  }

  return out;
}

/**
 * Guarantee a closing double bar on the last measure of every part.
 *
 * Source preservation copies a barline across when the uploaded file has one, so
 * scores exported from Dorico/Finale/Sibelius keep theirs. But engine-generated
 * sources — a rhythm-chart PDF skeleton, or a typed chord progression — have no
 * barline to copy, and a finished arrangement should still end with a double bar.
 *
 * Applied AFTER synchronizePerformance, which rebuilds the document and would
 * otherwise discard anything added earlier. Idempotent: a part whose final
 * measure already carries a right-hand barline is left untouched.
 */
export function ensureFinalBarlines(xml: string): string {
  return xml.replace(/([\s\S]*?)(<\/part>)/g, (whole, body: string, close: string) => {
    const lastMeasureStart = body.lastIndexOf("<measure");
    const lastMeasureClose = body.lastIndexOf("</measure>");
    if (lastMeasureStart < 0 || lastMeasureClose < lastMeasureStart) return whole;
    if (/<barline[^>]*location="right"/.test(body.slice(lastMeasureStart))) return whole;
    return (
      body.slice(0, lastMeasureClose) +
      `<barline location="right"><bar-style>light-heavy</bar-style></barline>` +
      body.slice(lastMeasureClose) +
      close
    );
  });
}

export function exportScoreModelToMusicXML(scoreModel: ScoreModel): string {
  const notationModel = { ...scoreModel, parts: scoreModel.parts.map(p => ({ ...p, measures: p.measures.map(m => ({ ...m, events: m.events.filter(e => !e.grace) })) })) };
  return writePerformanceNotation(renderMusicXML(notationModel), scoreModel);
}

function renderMusicXML(scoreModel: ScoreModel): string {
  scoreModel = toSoundingScore(scoreModel);
  const timeline = buildMeasureTimeline(scoreModel);
  const workTitle = xmlEscape((scoreModel as any)?.meta?.ensemble ?? "ensemble");
  const partsRaw = scoreModel?.parts ?? [];
  // The worship orchestra already emits its parts in deliberate score order
  // (woodwinds → horn → brass → percussion → strings); preserve it. The generic
  // orchestral sort is for scores assembled in arbitrary order.
  //
  // piano_with_melody likewise emits [Melody, Piano] deliberately: the melody
  // belongs ON TOP of the piano grand staff, as in any vocal/lead + piano score.
  // Without this the generic sort ranks Piano (35) above an unrecognised
  // "Melody" part (90) and flips the melody underneath the piano.
  const ensembleTag = String((scoreModel as any)?.meta?.ensemble ?? "").toLowerCase();
  // symphonic_orchestra also emits deliberate score order (Fl Ob Cl Bsn | Hn Tpt
  // Tbn Tuba | Timp | strings). The generic sort ranks Trumpet above Horn, which
  // is wrong for an orchestral score.
  const preserveOrder = ensembleTag === "orchestra" || ensembleTag === "full_orchestra" ||
    ensembleTag === "piano_with_melody" || ensembleTag === "symphonic_orchestra";
  const parts = preserveOrder ? partsRaw : sortPartsOrchestrally(partsRaw);
  // One part means an extracted part, where multi-measure rests belong; a full
  // score keeps every bar so the staves stay aligned.
  const isSinglePartExport = parts.length === 1;

  const cadenceTextByMeasure = buildCadenceTextByMeasure(scoreModel);
  const fallbackKeyFifths =
    (scoreModel as any)?.meta?.inputKeyFifths ??
    (scoreModel as any)?.meta?.app?.detectedInputKeyFifths;
  let warnedMissingKey = false;

  const percUsedByPart: Record<string, Map<number, PercMap>> = {};
  for (const p of parts) {
    const pid = xmlEscape(p.part_id ?? "P1");
    if (!isDrums(p.instrument)) continue;

    const used = new Map<number, PercMap>();
    for (const m of p.measures ?? []) {
      for (const ev of m?.events ?? []) {
        const evAny: any = ev as any;
        if (evAny?.type !== "unpitched") continue;
        const pm = getPercussionMap(evAny.instrumentId ?? "");
        if (!pm) continue;
        used.set(pm.midiUnpitched, pm);
      }
    }

    if (used.size > 0) percUsedByPart[pid] = used;
  }

  let out = "";
  out += `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n`;
  out += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"\n`;
  out += `  "http://www.musicxml.org/dtds/partwise.dtd">\n`;
  out += `<score-partwise version="3.1">\n`;
  out += `  <work><work-title>${workTitle}</work-title></work>\n`;

  out += `  <part-list>`;
  for (const p of parts) {
    const pid = xmlEscape(p.part_id ?? "P1");
    const pname = xmlEscape(p.name ?? pid);

    out += `<score-part id="${pid}">`;
    out += `<part-name>${pname}</part-name>`;

    const used = percUsedByPart[pid];
    if (used && used.size > 0) {
      for (const pm of used.values()) {
        const blocks = scoreInstrumentXml(pid, pm);
        out += blocks.score;
        out += blocks.midi;
      }
    }

    out += `</score-part>`;
  }
  out += `</part-list>\n`;

  for (const p of parts) {
    const pid = xmlEscape(p.part_id ?? "P1");
    // Fall back to the part name only when it is not a choral voice: the SATB
    // parts carry no `instrument`, and "Bass" would otherwise resolve to the
    // bass-guitar entry (sounds an octave below written), writing the choral
    // bass an octave high and printing it above the tenor.
    const nameFallback =
      CHORAL_VOICE_NAMES.has(String(p.name ?? "").toLowerCase().replace(/\s+/g, "_"))
        ? undefined
        : (p.name ?? p.part_id);
    const transpose = getTransposeForInstrument(p.instrument ?? nameFallback);

    out += `  <part id="${pid}">\n`;

    const partMeasures = p.measures ?? [];
    const lastMeasureNumber = partMeasures.length > 0 ? (partMeasures[partMeasures.length - 1]?.number ?? partMeasures.length) : 0;

    const defaultDivisions =
      (scoreModel as any)?.global?.divisions ??
      (partMeasures[0]?.attributes?.divisions ?? 480);
    let currentDivisions = Number.isFinite(defaultDivisions) ? Number(defaultDivisions) : 480;
    let currentKeyFifths: number | undefined = undefined;
    let currentKeyMode = "";
    let currentTimeBeats = 4;
    let currentTimeBeatType = 4;
    let lastAttrKey: string | null = null;

    const multiRestAt = findMultiMeasureRests(partMeasures, cadenceTextByMeasure, isSinglePartExport);

    for (const [measureIndex, m] of partMeasures.entries()) {
      const mNum = m.number ?? 1;
      const attrs = m?.attributes ?? {};
      const hasDivisionsAttr = Number.isFinite((attrs as any)?.divisions);
      const nextDivisions = hasDivisionsAttr ? Number((attrs as any).divisions) : currentDivisions;

      let concertFifths = typeof (attrs as any)?.key_fifths === "number" ? (attrs as any).key_fifths : currentKeyFifths;
      if (typeof concertFifths !== "number" && typeof fallbackKeyFifths === "number") {
        concertFifths = fallbackKeyFifths;
        if (!warnedMissingKey) {
          warnedMissingKey = true;
          // eslint-disable-next-line no-console
          console.warn("[export] Missing key_fifths on measures; using inputKeyFifths fallback.");
        }
      }
      if (typeof concertFifths !== "number") concertFifths = 0;

      const timeBeats = Number.isFinite((attrs as any)?.time?.beats)
        ? Number((attrs as any).time.beats)
        : currentTimeBeats;
      const timeBeatType = Number.isFinite((attrs as any)?.time?.beat_type)
        ? Number((attrs as any).time.beat_type)
        : currentTimeBeatType;

      const rawMode = String((attrs as any)?.key_mode ?? currentKeyMode ?? "").toLowerCase();
      const keyMode = rawMode === "minor" || rawMode === "major" ? rawMode : (currentKeyMode || "");

      const concert = isConcertKeyInstrument(p.instrument);

      const semisWritten = transpose && !concert ? -writtenToSoundingSemis(transpose) : 0;
      const semisForKey = mod(semisWritten, 12);
      const fifthsToWrite = semisForKey === 0 ? concertFifths : transposeKeyFifths(concertFifths, semisForKey);

      const staves = Number(p.staves ?? 1);
      const piano = isPiano(p.instrument);
      const isGrandStaff = piano || staves === 2;

      out += `    <measure number="${mNum}"${m.implicit || m.durationBeats !== undefined ? ' implicit="yes"' : ""}>`;

      // Optional cadence annotation (placed near top of the measure)
      const cadText = cadenceTextByMeasure[mNum];
      if (cadText) {
        out += `<direction placement="above"><direction-type><words>${xmlEscape(cadText)}</words></direction-type></direction>`;
      }

      const clefKey = isGrandStaff
        ? "G2|F4"
        : (() => {
            const clef = clefForPart(p);
            if (clef.sign === "percussion") return "PERC2";
            if (clef.sign === "C") return "C3";
            return `${clef.sign}${clef.line}`;
          })();
      const transposeKey = transpose ? `${transpose.diatonic},${transpose.chromatic},${transpose.octaveChange ?? 0}` : "0,0,0";
      const attrKey = [
        nextDivisions,
        fifthsToWrite,
        keyMode,
        timeBeats,
        timeBeatType,
        isGrandStaff ? 2 : 1,
        clefKey,
        transposeKey
      ].join("|");

      const attrChanged = lastAttrKey === null || attrKey !== lastAttrKey;
      if (attrChanged) {
        out += `<attributes>`;
        out += `<divisions>${nextDivisions}</divisions>`;
        if (keyMode) {
          out += `<key><fifths>${fifthsToWrite}</fifths><mode>${keyMode}</mode></key>`;
        } else {
          out += `<key><fifths>${fifthsToWrite}</fifths></key>`;
        }
        out += `<time><beats>${timeBeats}</beats><beat-type>${timeBeatType}</beat-type></time>`;

        if (isGrandStaff) out += `<staves>2</staves>`;

        if (transpose && !concert) {
          out += `<transpose>`;
          out += `<diatonic>${transpose.diatonic}</diatonic>`;
          out += `<chromatic>${transpose.chromatic}</chromatic>`;
          const oc = transpose.octaveChange ?? 0;
          if (oc !== 0) out += `<octave-change>${oc}</octave-change>`;
          out += `</transpose>`;
        }

        if (isGrandStaff) {
          out += `<clef number="1"><sign>G</sign><line>2</line></clef>`;
          out += `<clef number="2"><sign>F</sign><line>4</line></clef>`;
        } else {
          const clef = clefForPart(p);
          if (clef.sign === "percussion") {
            out += `<clef><sign>percussion</sign><line>2</line></clef>`;
          } else if (clef.sign === "C") {
            out += `<clef><sign>C</sign><line>3</line></clef>`;
          } else {
            out += `<clef><sign>${clef.sign}</sign><line>${clef.line}</line></clef>`;
          }
        }

        if (multiRestAt.has(measureIndex)) out += multiRestXml(multiRestAt.get(measureIndex)!);
        out += `</attributes>`;
      } else if (multiRestAt.has(measureIndex)) {
        // Nothing else about the bar changed, but the multi-rest still has to be
        // announced, and <measure-style> lives in <attributes>.
        out += `<attributes>${multiRestXml(multiRestAt.get(measureIndex)!)}</attributes>`;
      }

      currentDivisions = nextDivisions;
      currentKeyFifths = concertFifths;
      currentKeyMode = keyMode;
      currentTimeBeats = timeBeats;
      currentTimeBeatType = timeBeatType;
      lastAttrKey = attrKey;

      const measureBeats = timeline[measureIndex].durationBeats;
      const measureDur = beatsToDivisionsDuration(measureBeats, currentDivisions);
      // Discard any events that start at or past the measure boundary; they
      // would cause the exporter's gap-fill code to emit rests extending well
      // beyond the barline and produce invalid <duration> totals.
      const events = (m.events ?? []).filter(
        (ev: any) => Number.isFinite(ev?.t) && Number(ev.t) < measureBeats - 1e-9
      );
      const byVoice = new Map<number, any[]>();

      for (const ev of events) {
        const v = (ev as any).voice ?? 1;
        const list = byVoice.get(v) ?? [];
        list.push(ev);
        byVoice.set(v, list);
      }

      // A measure with nothing in it still has to be a measure. The per-voice
      // loop below is what writes rests, so with no voices it wrote nothing at
      // all and the bar came out as <measure><barline/></measure> — no notes,
      // no rests, not a valid measure in any reader, and the shape MuseScore
      // reports as an incomplete measure. Give it one silent voice and the
      // trailing-rest logic fills the bar.
      if (!byVoice.size) byVoice.set(1, []);

      const voiceNumbers = Array.from(byVoice.keys()).sort((a, b) => a - b);
      let previousVoiceDivs = measureDur;
      for (let vi = 0; vi < voiceNumbers.length; vi++) {
        const voice = voiceNumbers[vi] ?? 1;
        if (vi > 0) {
          // Rewind by what the PREVIOUS voice actually wrote. Rewinding by the bar's
          // nominal length assumes every voice filled it exactly, and a chord whose
          // duration is not a standard note value does not — it prints snapped down,
          // leaving the voice short, and the next voice then starts before the bar
          // line. Washed had 36 bars like that.
          out += `<backup><duration>${previousVoiceDivs}</duration></backup>`;
        }

        const voiceEvents = (byVoice.get(voice) ?? [])
          .slice()
          .sort((a: any, b: any) => (a.t ?? 0) - (b.t ?? 0));
        // A rest belongs on the staff its voice lives on; hardcoding staff 1 puts a
        // left-hand voice's rest on the treble.
        const staffOfVoice = Number((byVoice.get(voice) ?? [])[0]?.staff ?? 1) || 1;
        let cursor = 0;
        // Divisions this voice has actually WRITTEN. Not the same as `cursor`, which
        // tracks musical time: a chord whose duration is not a standard note value is
        // printed snapped DOWN to one that is, so the two can drift apart. The
        // <backup> below has to rewind by what was written, or the next voice starts
        // before the bar line.
        let writtenDivs = 0;
        let idx = 0;
        const EPS = 1e-6;
        while (idx < voiceEvents.length) {
          const ev0: any = voiceEvents[idx] as any;
          const rawT = Number(ev0?.t ?? cursor);
          let t = Number.isFinite(rawT) ? rawT : cursor;
          if (t < cursor - EPS) t = cursor;
          if (t > cursor + EPS) {
            const gapBeats = t - cursor;
            const gapDur = beatsToDivisionsDuration(gapBeats, currentDivisions);
            const restType = durToType(currentDivisions, gapDur);
            const restDot  = durHasDot(currentDivisions, gapDur);
            const gapStaff = isGrandStaff ? (ev0?.staff ?? 1) : 1;
            writtenDivs += gapDur;
            out += `<note><rest/><duration>${gapDur}</duration><voice>${voice}</voice>`;
            if (restType) out += `<type>${restType}</type>`;
            if (restDot)  out += `<dot/>`;
            out += `<staff>${gapStaff}</staff></note>`;
            cursor = t;
          }

          const group: any[] = [];
          while (idx < voiceEvents.length) {
            const candidate: any = voiceEvents[idx] as any;
            const ct = Number(candidate?.t ?? cursor);
            if (!Number.isFinite(ct)) break;
            if (Math.abs(ct - t) > EPS) break;
            group.push(candidate);
            idx += 1;
          }

          if (!group.length) {
            idx += 1;
            continue;
          }

          const notes = group.filter((g) => g?.type === "note" || g?.type === "unpitched");
          const rests = group.filter((g) => g?.type === "rest");
          const useGroup = notes.length ? notes : rests;
          // Chord = multiple simultaneous noteheads sharing one duration.
          const isChordGroup = useGroup.length > 1;

          const clampDur = (evAny: any) => {
            const raw = Number.isFinite(evAny?.dur) ? Number(evAny.dur) : 1;
            return Math.min(raw, Math.max(1 / currentDivisions, measureBeats - t));
          };

          // ── A chord whose length needs more than one note value ─────────────
          // A single note of 3.5 beats is written as a dotted half tied to an
          // eighth. A CHORD of 3.5 beats used to be snapped down to the dotted
          // half and the eighth simply vanished — the MIDI transcription of
          // test 4.mid produces exactly that, losing half a beat and shifting
          // everything after it in the voice until the bar's trailing rest.
          //
          // It could not be decomposed before because this loop runs note by
          // note, and <chord/> attaches a note to whatever precedes it in
          // document order: emitting each note's tied pieces in turn would
          // interleave the stacks into nonsense. Tied chords have to be written
          // piece by piece, each piece a complete stack of noteheads.
          //
          // Members must agree on a length — MusicXML gives a chord one duration
          // — so a group that disagrees falls through to the old path rather
          // than having a length chosen for it.
          const chordDurBeats = useGroup.length ? clampDur(useGroup[0]) : 0;
          const pitchedTiedChord =
            isChordGroup &&
            useGroup.every((g: any) => g?.type === "note" && g?.pitch?.step) &&
            useGroup.every((g: any) => Math.abs(clampDur(g) - chordDurBeats) < EPS);

          if (pitchedTiedChord) {
            const totalDivs = beatsToDivisionsDuration(chordDurBeats, currentDivisions);
            const comps = decomposeToStandardDivs(currentDivisions, totalDivs);
            const members = useGroup.map((evAny: any) => {
              const wpBase = toWrittenPitch(evAny.pitch, transpose, p.instrument);
              const wp = evAny.preserveSpelling ? wpBase : normalizePitchForKey(wpBase, fifthsToWrite);
              const alterVal = typeof wp.alter === "number" ? wp.alter : 0;
              return {
                pitchXml:
                  `<pitch><step>${xmlEscape(wp.step)}</step>` +
                  (typeof wp.alter === "number" && wp.alter !== 0 ? `<alter>${wp.alter}</alter>` : "") +
                  `<octave>${wp.octave}</octave></pitch>`,
                accidental:
                  alterVal === keySignatureAlter(wp.step, fifthsToWrite)
                    ? null
                    : accidentalFromAlterForDisplay(alterVal),
                origTieStart: evAny.tieStart === true,
                origTieStop: evAny.tieStop === true,
                slurStart: evAny.slurStart === true,
                slurStop: evAny.slurStop === true,
                staff: isGrandStaff ? (evAny.staff ?? 1) : 1
              };
            });

            for (let ci = 0; ci < comps.length; ci++) {
              const cd = comps[ci]!;
              const ct2 = durToType(currentDivisions, cd);
              const cdot = durHasDot(currentDivisions, cd);
              const firstPiece = ci === 0;
              const lastPiece = ci === comps.length - 1;
              for (let mi = 0; mi < members.length; mi++) {
                const mem = members[mi]!;
                const tieStart = !lastPiece || (mem.origTieStart && lastPiece);
                const tieStop = !firstPiece || (mem.origTieStop && firstPiece);
                out += `<note>`;
                // The stack's first note opens a new time slot; the rest attach to it.
                if (mi > 0) out += `<chord/>`;
                out += mem.pitchXml;
                out += `<duration>${cd}</duration>`;
                if (tieStart) out += `<tie type="start"/>`;
                if (tieStop) out += `<tie type="stop"/>`;
                out += `<voice>${voice}</voice>`;
                if (ct2) out += `<type>${ct2}</type>`;
                if (cdot) out += `<dot/>`;
                if (mem.accidental && firstPiece) out += `<accidental>${mem.accidental}</accidental>`;
                out += `<staff>${mem.staff}</staff>`;
                const slurHere = (mem.slurStart && firstPiece) || (mem.slurStop && lastPiece);
                if (tieStart || tieStop || slurHere) {
                  out += `<notations>`;
                  if (tieStart) out += `<tied type="start"/>`;
                  if (tieStop) out += `<tied type="stop"/>`;
                  if (mem.slurStart && firstPiece) out += `<slur type="start" number="1"/>`;
                  if (mem.slurStop && lastPiece) out += `<slur type="stop" number="1"/>`;
                  out += `</notations>`;
                }
                out += `</note>`;
              }
              // One stack occupies one slot however many noteheads it has.
              writtenDivs += cd;
            }
            cursor = Math.max(cursor, t + chordDurBeats);
            continue;
          }

          let groupMaxDur = 0;
          for (let gi = 0; gi < useGroup.length; gi++) {
            const evAny: any = useGroup[gi] as any;
            // Safety clamp: a note must never extend past the end of its measure.
            // If insertApproachNotes or another function emits an oversized duration
            // (e.g. a sustained note whose dur spans multiple measures), cap it here
            // so the exported <duration> value never exceeds measureBeats.
            const rawDurBeats = Number.isFinite(evAny.dur) ? Number(evAny.dur) : 1;
            const durBeats = Math.min(rawDurBeats, Math.max(1 / currentDivisions, measureBeats - t));
            // Snap to nearest standard note value so durToType always returns a
            // valid <type>. Non-standard values (e.g. 13 divisions = 3.25 beats)
            // produce null → no <type> → MuseScore adds a ghost rest → "17/16".
            const dur = snapDurToStandard(currentDivisions, beatsToDivisionsDuration(durBeats, currentDivisions));
            // Cursor advances by the original (pre-snap) duration so the trailing-
            // rest logic fills any gap the snap left at the barline.
            if (durBeats > groupMaxDur) groupMaxDur = durBeats;
            const staff = isGrandStaff ? (evAny.staff ?? 1) : 1;
            const type = durToType(currentDivisions, dur);
            const dot  = durHasDot(currentDivisions, dur);

            if (evAny.type === "rest") {
              // Decompose into standard-valued rests so each has a valid <type>
              // (no type-less rests → no MuseScore ghost rests) and the measure
              // stays exactly filled.
              const totalDivs = beatsToDivisionsDuration(durBeats, currentDivisions);
              for (const cd of decomposeToStandardDivs(currentDivisions, totalDivs)) {
                const ct = durToType(currentDivisions, cd);
                writtenDivs += cd;
                out += `<note><rest/><duration>${cd}</duration><voice>${voice}</voice>`;
                if (ct) out += `<type>${ct}</type>`;
                if (durHasDot(currentDivisions, cd)) out += `<dot/>`;
                out += `<staff>${staff}</staff></note>`;
              }
              continue;
            }

            if (evAny.type === "unpitched") {
              const pm = getPercussionMap(evAny.instrumentId ?? "");
              if (!pm) {
                writtenDivs += dur;
                out += `<note><rest/><duration>${dur}</duration><voice>${voice}</voice>`;
                if (type) out += `<type>${type}</type>`;
                if (dot)  out += `<dot/>`;
                out += `<staff>${staff}</staff></note>`;
                continue;
              }

              const instXmlId = `${pid}-I${pm.midiUnpitched}`;

              out += `<note>`;
              if (gi > 0) out += `<chord/>`;
              out += `<unpitched><display-step>${pm.displayStep}</display-step><display-octave>${pm.displayOctave}</display-octave></unpitched>`;
              out += `<duration>${dur}</duration>`;
              out += `<instrument id="${xmlEscape(instXmlId)}"/>`;
              out += `<voice>${voice}</voice>`;
              if (type) out += `<type>${type}</type>`;
              if (dot)  out += `<dot/>`;
              if (pm.notehead && pm.notehead !== "normal") out += `<notehead>${pm.notehead}</notehead>`;
              out += `<staff>${staff}</staff>`;
              out += `</note>`;
              continue;
            }

            if (evAny.type === "note" && evAny.pitch?.step) {
              const wpBase = toWrittenPitch(evAny.pitch, transpose, p.instrument);
              const wp = evAny.preserveSpelling ? wpBase : normalizePitchForKey(wpBase, fifthsToWrite);
              const alterVal = typeof wp.alter === "number" ? wp.alter : 0;
              const expectedAlter = keySignatureAlter(wp.step, fifthsToWrite);
              const accidental =
                alterVal === expectedAlter ? null : accidentalFromAlterForDisplay(alterVal);
              const origTieStart = evAny.tieStart === true;
              // Slurs mark a legato group — a breath or bow. Only scores that set
              // these carry them (today, a melody extracted from MIDI); every other
              // ensemble leaves them undefined and its output is unchanged.
              const slurStart = evAny.slurStart === true;
              const slurStop = evAny.slurStop === true;
              const origTieStop = evAny.tieStop === true;
              const pitchXml =
                `<pitch><step>${xmlEscape(wp.step)}</step>` +
                (typeof wp.alter === "number" && wp.alter !== 0 ? `<alter>${wp.alter}</alter>` : "") +
                `<octave>${wp.octave}</octave></pitch>`;

              // Single notes: decompose a non-standard / multi-value duration into
              // TIED standard note values (readable rhythm vocabulary). Chord
              // members keep one snapped duration.
              const comps = isChordGroup
                ? [dur]
                : decomposeToStandardDivs(currentDivisions, beatsToDivisionsDuration(durBeats, currentDivisions));

              for (let ci = 0; ci < comps.length; ci++) {
                const cd = comps[ci]!;
                const ct = durToType(currentDivisions, cd);
                const cdot = durHasDot(currentDivisions, cd);
                const firstPiece = ci === 0;
                const lastPiece  = ci === comps.length - 1;
                // Internal ties bind the pieces together; preserve the event's
                // original tie state on the outer edges.
                const tieStart = (!lastPiece)  || (origTieStart && lastPiece);
                const tieStop  = (!firstPiece) || (origTieStop && firstPiece);

                // A chord member sounds WITH the note before it, so it does not
                // advance the cursor and its duration is not "written" time.
                const isChordMember = (gi > 0 || evAny.chord === true);
                if (!isChordMember) writtenDivs += cd;

                out += `<note>`;
                if (isChordMember && firstPiece) out += `<chord/>`;
                out += pitchXml;
                out += `<duration>${cd}</duration>`;
                if (tieStart) out += `<tie type="start"/>`;
                if (tieStop) out += `<tie type="stop"/>`;
                out += `<voice>${voice}</voice>`;
                if (ct) out += `<type>${ct}</type>`;
                if (cdot) out += `<dot/>`;
                if (accidental && firstPiece) out += `<accidental>${accidental}</accidental>`;
                out += `<staff>${staff}</staff>`;
                // A note written as several tied pieces is one note musically, so a
                // slur begins on its first piece and ends on its last.
                const slurHere = (slurStart && firstPiece) || (slurStop && lastPiece);
                if (tieStart || tieStop || slurHere) {
                  out += `<notations>`;
                  if (tieStart) out += `<tied type="start"/>`;
                  if (tieStop) out += `<tied type="stop"/>`;
                  if (slurStart && firstPiece) out += `<slur type="start" number="1"/>`;
                  if (slurStop && lastPiece) out += `<slur type="stop" number="1"/>`;
                  out += `</notations>`;
                }
                out += `</note>`;
              }
              continue;
            }
          }
          cursor = Math.max(cursor, t + groupMaxDur);
        }

        // Trailing rest: fill any gap between the last note and the barline,
        // decomposed into standard-valued rests so each has a valid <type> and
        // the measure is exactly complete (no missing beats, no ghost rests).
        if (cursor < measureBeats - EPS) {
          const tailBeats = measureBeats - cursor;
          const tailDur   = beatsToDivisionsDuration(tailBeats, currentDivisions);
          for (const cd of decomposeToStandardDivs(currentDivisions, tailDur)) {
            const ct = durToType(currentDivisions, cd);
            writtenDivs += cd;
            out += `<note><rest/><duration>${cd}</duration><voice>${voice}</voice>`;
            if (ct) out += `<type>${ct}</type>`;
            if (durHasDot(currentDivisions, cd)) out += `<dot/>`;
            out += `<staff>${staffOfVoice}</staff></note>`;
          }
        }
        previousVoiceDivs = writtenDivs;
      }

      // Final barline on the last measure of the part
      if (mNum === lastMeasureNumber) {
        out += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
      }

      out += `</measure>\n`;
    }

    out += `  </part>\n`;
  }

  out += `</score-partwise>\n`;
  return out;
}
