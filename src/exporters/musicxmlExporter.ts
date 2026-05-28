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

/** Returns true when the duration is a dotted note value (needs a <dot/> element). */
function durHasDot(divisions: number, dur: number): boolean {
  if (!divisions || divisions <= 0) return false;
  const d = divisions;
  return dur === d * 3 || dur === d * 3 / 2 || dur === d * 3 / 4;
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
  return 90;
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
  const tagged = parts.map((p, idx) => ({
    p,
    idx,
    g: orchestraGroupRank(p),
    w: orchestraWithinGroupRank(p)
  }));

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

export function exportScoreModelToMusicXML(scoreModel: ScoreModel): string {
  const workTitle = xmlEscape((scoreModel as any)?.meta?.ensemble ?? "ensemble");
  const partsRaw = scoreModel?.parts ?? [];
  const parts = sortPartsOrchestrally(partsRaw);

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
    const transpose = getTransposeForInstrument(p.instrument ?? p.name ?? p.part_id);

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

    for (const m of partMeasures) {
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

      out += `    <measure number="${mNum}">`;

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

        out += `</attributes>`;
      }

      currentDivisions = nextDivisions;
      currentKeyFifths = concertFifths;
      currentKeyMode = keyMode;
      currentTimeBeats = timeBeats;
      currentTimeBeatType = timeBeatType;
      lastAttrKey = attrKey;

      const measureBeats = (Number(timeBeats) || 4) * (4 / (Number(timeBeatType) || 4));
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

      const voiceNumbers = Array.from(byVoice.keys()).sort((a, b) => a - b);
      for (let vi = 0; vi < voiceNumbers.length; vi++) {
        const voice = voiceNumbers[vi] ?? 1;
        if (vi > 0) {
          out += `<backup><duration>${measureDur}</duration></backup>`;
        }

        const voiceEvents = (byVoice.get(voice) ?? [])
          .slice()
          .sort((a: any, b: any) => (a.t ?? 0) - (b.t ?? 0));
        let cursor = 0;
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

          let groupMaxDur = 0;
          for (let gi = 0; gi < useGroup.length; gi++) {
            const evAny: any = useGroup[gi] as any;
            // Safety clamp: a note must never extend past the end of its measure.
            // If insertApproachNotes or another function emits an oversized duration
            // (e.g. a sustained note whose dur spans multiple measures), cap it here
            // so the exported <duration> value never exceeds measureBeats.
            const rawDurBeats = Number.isFinite(evAny.dur) ? Number(evAny.dur) : 1;
            const durBeats = Math.min(rawDurBeats, Math.max(1 / currentDivisions, measureBeats - t));
            const dur = beatsToDivisionsDuration(durBeats, currentDivisions);
            if (durBeats > groupMaxDur) groupMaxDur = durBeats;
            const staff = isGrandStaff ? (evAny.staff ?? 1) : 1;
            const type = durToType(currentDivisions, dur);
            const dot  = durHasDot(currentDivisions, dur);

            if (evAny.type === "rest") {
              out += `<note><rest/><duration>${dur}</duration><voice>${voice}</voice>`;
              if (type) out += `<type>${type}</type>`;
              if (dot)  out += `<dot/>`;
              out += `<staff>${staff}</staff></note>`;
              continue;
            }

            if (evAny.type === "unpitched") {
              const pm = getPercussionMap(evAny.instrumentId ?? "");
              if (!pm) {
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
              const tieStart = evAny.tieStart === true;
              const tieStop = evAny.tieStop === true;
              out += `<note>`;
              if (gi > 0 || evAny.chord === true) out += `<chord/>`;
              out += `<pitch><step>${xmlEscape(wp.step)}</step>`;
              if (typeof wp.alter === "number" && wp.alter !== 0) out += `<alter>${wp.alter}</alter>`;
              out += `<octave>${wp.octave}</octave></pitch>`;
              if (tieStart) out += `<tie type="start"/>`;
              if (tieStop) out += `<tie type="stop"/>`;
              out += `<duration>${dur}</duration><voice>${voice}</voice>`;
              if (type) out += `<type>${type}</type>`;
              if (dot)  out += `<dot/>`;
              if (accidental) out += `<accidental>${accidental}</accidental>`;
              if (tieStart || tieStop) {
                out += `<notations>`;
                if (tieStart) out += `<tied type="start"/>`;
                if (tieStop) out += `<tied type="stop"/>`;
                out += `</notations>`;
              }
              out += `<staff>${staff}</staff></note>`;
              continue;
            }
          }
          cursor = Math.max(cursor, t + groupMaxDur);
        }

        // Trailing rest: fill any gap between the last note and the barline.
        // Without this, notes whose collective duration falls short of measureBeats
        // produce an invalid total (MusicXML players reject the file).
        if (cursor < measureBeats - EPS) {
          const tailBeats = measureBeats - cursor;
          const tailDur   = beatsToDivisionsDuration(tailBeats, currentDivisions);
          const tailType  = durToType(currentDivisions, tailDur);
          const tailDot   = durHasDot(currentDivisions, tailDur);
          out += `<note><rest/><duration>${tailDur}</duration><voice>${voice}</voice>`;
          if (tailType) out += `<type>${tailType}</type>`;
          if (tailDot)  out += `<dot/>`;
          out += `<staff>1</staff></note>`;
        }
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
