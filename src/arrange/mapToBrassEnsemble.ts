// src/arrange/mapToBrassEnsemble.ts
import type { ScoreModel } from "../score/types";
import { shiftOctavesIntoRange, midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
import { extractOnsetChords } from "../analyze/chordExtractor";
import { parseChordSymbol } from "../harmonize/satb/chordSymbol";

type ChordEvent = { measure: number; t: number; symbol: string };

function makePart(part_id: string, name: string, instrument: string, staves = 1) {
  return { part_id, name, instrument, staves, measures: [] as any[] };
}

function cloneMeasureShell(m: any) {
  return { number: m.number, attributes: { ...m.attributes }, events: [] as any[] };
}

function addNote(
  measure: any,
  t: number,
  dur: number,
  pitch: { step: string; alter?: number; octave: number },
  voice: number
) {
  const id = `EV_${measure.number}_${t}_${voice}_${Math.random().toString(16).slice(2, 10)}`;
  measure.events.push({ id, t, dur, type: "note", pitch, voice, staff: 1 });
}

/**
 * Shift by octaves to land as close as possible to a target center,
 * while staying within [lo, hi].
 */
function shiftOctavesToward(midi: number, lo: number, hi: number, center: number): number {
  // first make sure it's in range somehow
  let m = shiftOctavesIntoRange(midi, lo, hi);

  // now explore octave neighbors and choose the one closest to center
  const candidates: number[] = [];
  for (let k = -4; k <= 4; k++) {
    const c = m + 12 * k;
    if (c >= lo && c <= hi) candidates.push(c);
  }
  if (candidates.length === 0) return m;

  let best = candidates[0];
  let bestDist = Math.abs(best - center);
  for (const c of candidates) {
    const d = Math.abs(c - center);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

type BrassLevel = "beginner" | "intermediate" | "advanced" | "professional";

type BrassRange = {
  low: number;
  high: number;
  preferredLow: number;
  preferredHigh: number;
  center: number;
};

type BrassRangeProfile = {
  trumpet1: BrassRange;
  trumpet2: BrassRange;
  trombone: BrassRange;
  bassTrombone: BrassRange;
  tuba: BrassRange;
};

type BrassMapOptions = {
  level?: BrassLevel;
  accompaniment?: string;
  textureMode?: string;
  chords?: ChordEvent[];
  warnings?: string[];
};

function makeRange(low: number, high: number, preferredLow: number, preferredHigh: number, center: number): BrassRange {
  return { low, high, preferredLow, preferredHigh, center };
}

function normalizeBrassLevel(level: string | undefined): BrassLevel {
  const normalized = String(level ?? "intermediate").toLowerCase();
  if (normalized === "beginner" || normalized === "intermediate" || normalized === "advanced" || normalized === "professional") {
    return normalized as BrassLevel;
  }
  return "intermediate";
}

function getBrassRangeProfile(level: BrassLevel): BrassRangeProfile {
  switch (level) {
    case "beginner":
      return {
        trumpet1: makeRange(54, 72, 56, 69, 64), // F#3..C5
        trumpet2: makeRange(54, 72, 56, 67, 62),
        trombone: makeRange(40, 58, 43, 55, 50), // E2..Bb3
        bassTrombone: makeRange(34, 53, 36, 50, 45), // Bb1..F3
        tuba: makeRange(34, 53, 36, 50, 41) // Bb1..F3
      };
    case "advanced":
    case "professional":
      return {
        trumpet1: makeRange(50, 84, 52, 79, 72), // D3..C6
        trumpet2: makeRange(50, 84, 52, 77, 69),
        trombone: makeRange(34, 70, 38, 65, 57), // Bb1..Bb4
        bassTrombone: makeRange(29, 65, 31, 62, 50), // F1..F4
        tuba: makeRange(26, 65, 31, 58, 45) // D1..F4
      };
    case "intermediate":
    default:
      return {
        trumpet1: makeRange(52, 79, 54, 76, 69), // E3..G5
        trumpet2: makeRange(52, 79, 54, 74, 67),
        trombone: makeRange(38, 65, 41, 62, 53), // D2..F4
        bassTrombone: makeRange(31, 62, 34, 58, 48), // G1..D4
        tuba: makeRange(31, 58, 34, 55, 43) // G1..Bb3
      };
  }
}

function fitToBrassRange(midi: number, range: BrassRange): number {
  const preferred = shiftOctavesToward(midi, range.preferredLow, range.preferredHigh, range.center);
  if (preferred >= range.low && preferred <= range.high) return preferred;
  return shiftOctavesToward(midi, range.low, range.high, range.center);
}

function parsePcToken(tok: string): number | null {
  const m = String(tok ?? "").trim().match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const byStep: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const base = byStep[step];
  if (typeof base !== "number") return null;
  const alter = acc === "#" ? 1 : acc === "b" ? -1 : 0;
  return (base + alter + 12) % 12;
}

function parseBassPc(symbol: string): number | null {
  const s = String(symbol ?? "").trim();
  if (!s) return null;
  const slash = s.split("/");
  if (slash.length > 1) {
    const bass = parsePcToken(slash[1] ?? "");
    if (bass !== null) return bass;
  }
  const parsed = parseChordSymbol(s);
  if (parsed) return parsed.rootPc;
  return parsePcToken(s);
}

function pcOfMidi(midi: number | null | undefined): number | null {
  if (typeof midi !== "number" || !Number.isFinite(midi)) return null;
  return ((midi % 12) + 12) % 12;
}

function chooseMidiForPc(
  pc: number,
  range: BrassRange,
  params: { prev?: number | null; upper?: number | null; lower?: number | null }
): number | null {
  const candidates: number[] = [];
  for (let midi = range.low; midi <= range.high; midi++) {
    if (((midi % 12) + 12) % 12 !== ((pc % 12) + 12) % 12) continue;
    if (typeof params.upper === "number" && midi > params.upper) continue;
    if (typeof params.lower === "number" && midi < params.lower) continue;
    candidates.push(midi);
  }
  if (!candidates.length) return null;
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const moveScore = typeof params.prev === "number" ? Math.abs(candidate - params.prev) * 4 : 0;
    const centerScore = Math.abs(candidate - range.center);
    const score = moveScore + centerScore;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function extractTopMelodyByMeasure(srcPart: any): Record<string, Array<{ t: number; dur: number; midi: number }>> {
  const out: Record<string, Array<{ t: number; dur: number; midi: number }>> = {};
  for (const measure of srcPart?.measures ?? []) {
    const grouped = new Map<number, Array<{ midi: number; dur: number }>>();
    for (const ev of measure?.events ?? []) {
      if (ev?.type !== "note" || !ev?.pitch?.step) continue;
      const t = Number(ev?.t);
      const dur = Number(ev?.dur);
      if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) continue;
      const midi = pitchToMidi(ev.pitch);
      const list = grouped.get(t) ?? [];
      list.push({ midi, dur });
      grouped.set(t, list);
    }
    const melody = Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, notes]) => {
        const top = notes.slice().sort((a, b) => b.midi - a.midi || b.dur - a.dur)[0]!;
        return { t, dur: top.dur, midi: top.midi };
      });
    out[String(measure.number)] = melody;
  }
  return out;
}

function sourceChordPcsAt(measure: any, t: number): number[] {
  const pcs = new Set<number>();
  for (const ev of measure?.events ?? []) {
    if (ev?.type !== "note" || !ev?.pitch?.step) continue;
    const evT = Number(ev?.t);
    const evDur = Number(ev?.dur);
    if (!Number.isFinite(evT) || !Number.isFinite(evDur)) continue;
    if (Math.abs(evT - t) > 1e-6 && !(evT <= t && t < evT + evDur - 1e-6)) continue;
    pcs.add(((pitchToMidi(ev.pitch) % 12) + 12) % 12);
  }
  return Array.from(pcs);
}

function chordEventAt(chords: ChordEvent[], measureNumber: number, t: number): ChordEvent | null {
  let best: ChordEvent | null = null;
  for (const chord of chords) {
    if (Number(chord.measure) !== Number(measureNumber)) continue;
    const chordT = Number(chord.t ?? 0);
    if (chordT > t + 1e-9) continue;
    if (!best || chordT >= Number(best.t ?? 0)) best = chord;
  }
  return best;
}

function homophonicLevel(options: BrassMapOptions): BrassLevel | null {
  const level = String(options.level ?? "").toLowerCase();
  const accompaniment = String(options.accompaniment ?? "").toLowerCase();
  const textureMode = String(options.textureMode ?? "").toLowerCase();
  const isHomophonic =
    accompaniment === "homophonic" ||
    accompaniment === "chordal" ||
    textureMode === "homophony_homorhythmic" ||
    textureMode === "homophony_melody_accompaniment";
  if (!isHomophonic) return null;
  if (level === "beginner" || level === "intermediate" || level === "advanced" || level === "professional") {
    return level as BrassLevel;
  }
  return null;
}

function mapBrassHomophonic(
  score: ScoreModel,
  options: BrassMapOptions,
  profile: BrassRangeProfile,
  level: BrassLevel
): ScoreModel {
  const tpt1 = makePart("TPT1", "Trumpet 1", "trumpet_bb_1", 1);
  const tpt2 = makePart("TPT2", "Trumpet 2", "trumpet_bb_2", 1);
  const tbn = makePart("TBN", "Trombone", "trombone", 1);
  const btbn = makePart("BTBN", "Bass Trombone", "bass_trombone", 1);
  const tuba = makePart("TUBA", "Tuba", "tuba_c", 1);
  const partsOut = [tpt1, tpt2, tbn, btbn, tuba];

  const srcPart = score.parts?.[0];
  if (!srcPart || !Array.isArray(srcPart.measures)) {
    return {
      score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
      meta: { ensemble: "brass_ensemble", brassLevel: level, texture: "homophonic" },
      global: { ...score.global },
      parts: partsOut
    } as any;
  }

  const measureMap: Record<string, any[]> = {};
  for (const measure of srcPart.measures) {
    const shells = partsOut.map(() => cloneMeasureShell(measure));
    measureMap[String(measure.number)] = shells;
    tpt1.measures.push(shells[0]);
    tpt2.measures.push(shells[1]);
    tbn.measures.push(shells[2]);
    btbn.measures.push(shells[3]);
    tuba.measures.push(shells[4]);
  }

  const melodyByMeasure = extractTopMelodyByMeasure(srcPart);
  const chordEvents = options.chords ?? [];
  let prevTpt2: number | null = null;
  let prevTbn: number | null = null;
  let prevBTbn: number | null = null;
  let prevTuba: number | null = null;

  for (const measure of srcPart.measures) {
    const shells = measureMap[String(measure.number)];
    if (!shells) continue;
    const melody = melodyByMeasure[String(measure.number)] ?? [];
    let seq = 0;
    for (const note of melody) {
      const chord = chordEventAt(chordEvents, Number(measure.number), note.t);
      const parsed = chord?.symbol ? parseChordSymbol(chord.symbol) : null;
      const chordPcs = parsed?.pcs?.length ? parsed.pcs : sourceChordPcsAt(measure, note.t);
      const melodyMidi = fitToBrassRange(note.midi, profile.trumpet1);
      const melodyPc = pcOfMidi(melodyMidi);

      let tubaMidi: number | null = null;
      const bassPc = chord?.symbol ? parseBassPc(chord.symbol) : null;
      if (bassPc !== null) {
        tubaMidi = chooseMidiForPc(bassPc, profile.tuba, { prev: prevTuba });
      }
      if (tubaMidi === null && chordPcs.length) {
        tubaMidi = chooseMidiForPc(chordPcs[0]!, profile.tuba, { prev: prevTuba });
      }
      if (tubaMidi === null) {
        tubaMidi = fitToBrassRange(note.midi - 24, profile.tuba);
      }

      const uniquePcs = Array.from(new Set(chordPcs.map((pc) => ((pc % 12) + 12) % 12)));
      const missingPcs = uniquePcs.filter((pc) => pc !== melodyPc && pc !== pcOfMidi(tubaMidi));
      const fallbackPcs = uniquePcs.length ? uniquePcs : [pcOfMidi(tubaMidi) ?? 0, melodyPc ?? 0];
      const pitchCycle = [...missingPcs, ...fallbackPcs, pcOfMidi(tubaMidi) ?? 0];

      let tpt2Midi: number | null = null;
      for (const pc of pitchCycle) {
        tpt2Midi = chooseMidiForPc(pc, profile.trumpet2, {
          prev: prevTpt2,
          upper: melodyMidi,
          lower: profile.trombone.low + 12
        });
        if (tpt2Midi !== null) break;
      }
      if (tpt2Midi === null) tpt2Midi = fitToBrassRange(melodyMidi - 3, profile.trumpet2);

      let tbnMidi: number | null = null;
      for (const pc of pitchCycle) {
        tbnMidi = chooseMidiForPc(pc, profile.trombone, {
          prev: prevTbn,
          upper: tpt2Midi,
          lower: (tubaMidi ?? profile.tuba.low) + 5
        });
        if (tbnMidi !== null) break;
      }
      if (tbnMidi === null) tbnMidi = fitToBrassRange((tpt2Midi ?? melodyMidi) - 7, profile.trombone);

      let btbnMidi: number | null = null;
      const lowSupportPcs = [pcOfMidi(tubaMidi) ?? 0, ...pitchCycle];
      for (const pc of lowSupportPcs) {
        btbnMidi = chooseMidiForPc(pc, profile.bassTrombone, {
          prev: prevBTbn,
          upper: tbnMidi,
          lower: tubaMidi
        });
        if (btbnMidi !== null) break;
      }
      if (btbnMidi === null) btbnMidi = fitToBrassRange((tbnMidi ?? melodyMidi) - 7, profile.bassTrombone);

      if (btbnMidi < tubaMidi) btbnMidi = fitToBrassRange(btbnMidi + 12, profile.bassTrombone);
      if (tbnMidi < btbnMidi) tbnMidi = fitToBrassRange(tbnMidi + 12, profile.trombone);
      if (tpt2Midi < tbnMidi) tpt2Midi = fitToBrassRange(tpt2Midi + 12, profile.trumpet2);
      if (melodyMidi < tpt2Midi) {
        tpt2Midi = fitToBrassRange(tpt2Midi - 12, profile.trumpet2);
        if (tpt2Midi < tbnMidi) tpt2Midi = fitToBrassRange(tbnMidi, profile.trumpet2);
      }

      addNote(shells[0], note.t, note.dur, midiToPitch(melodyMidi), 1, "TPT1", seq);
      addNote(shells[1], note.t, note.dur, midiToPitch(tpt2Midi), 1, "TPT2", seq);
      addNote(shells[2], note.t, note.dur, midiToPitch(tbnMidi), 1, "TBN", seq);
      addNote(shells[3], note.t, note.dur, midiToPitch(btbnMidi), 1, "BTBN", seq);
      addNote(shells[4], note.t, note.dur, midiToPitch(tubaMidi), 1, "TUBA", seq);

      prevTpt2 = tpt2Midi;
      prevTbn = tbnMidi;
      prevBTbn = btbnMidi;
      prevTuba = tubaMidi;
      seq += 1;
    }
  }

  options.warnings?.push(
    `[brass] ${level[0]!.toUpperCase()}${level.slice(1)} homophonic brass applied: Trumpet 1 melody, Tuba chord bass, inner brass fill harmony.`
  );

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ensemble: "brass_ensemble", brassLevel: level, texture: "homophonic" },
    global: { ...score.global },
    parts: partsOut
  } as any;
}

/**
 * Keep the brass score in WRITTEN pitch (so MuseScore can toggle “Concert Pitch” correctly
 * using the MusicXML <transpose> tags you added in the exporter).
 *
 * This arranger now uses practical beginner/intermediate/advanced written ranges
 * so the app can stay player-friendly in church and student settings.
 */
export function mapPianoToBrassEnsembleOpen(
  score: ScoreModel,
  options: BrassMapOptions = {}
): ScoreModel {
  const level = normalizeBrassLevel(options.level);
  const profile = getBrassRangeProfile(level);
  const homophonic = homophonicLevel(options);

  if (homophonic) {
    return mapBrassHomophonic(score, options, profile, homophonic);
  }

  // Brass parts (written instruments)
  const tpt1 = makePart("TPT1", "Trumpet 1", "trumpet_bb_1", 1);
  const tpt2 = makePart("TPT2", "Trumpet 2", "trumpet_bb_2", 1);
  const tbn = makePart("TBN", "Trombone", "trombone", 1);
  const btbn = makePart("BTBN", "Bass Trombone", "bass_trombone", 1);
  const tuba = makePart("TUBA", "Tuba", "tuba_c", 1);

  const partsOut = [tpt1, tpt2, tbn, btbn, tuba];

  // measure shells from source part 0
  const srcPart = score.parts[0];
  const measureMap: Record<string, any[]> = {};
  for (const m of srcPart.measures) {
    const shells = partsOut.map(() => cloneMeasureShell(m));
    measureMap[String(m.number)] = shells;

    tpt1.measures.push(shells[0]);
    tpt2.measures.push(shells[1]);
    tbn.measures.push(shells[2]);
    btbn.measures.push(shells[3]);
    tuba.measures.push(shells[4]);
  }

  const chords = extractOnsetChords(score);

  for (const ch of chords) {
    const shells = measureMap[String(ch.measure)];
    if (!shells) continue;

    const notes = ch.notes.slice().sort((a, b) => a.midi - b.midi);
    if (notes.length === 0) continue;

    const t = ch.t;
    const dur = Math.max(...notes.map(n => (n as any).dur ?? 480), 1);

    // Basic spread across chord tones (allows doublings)
    const pick = (idx: number) => notes[Math.min(Math.max(idx, 0), notes.length - 1)].midi;

    const low = pick(0);
    const mid1 = pick(Math.floor((notes.length - 1) * 0.25));
    const mid2 = pick(Math.floor((notes.length - 1) * 0.5));
    const mid3 = pick(Math.floor((notes.length - 1) * 0.75));
    const high = pick(notes.length - 1);

    // Initial assignment (low->high conceptually)
    let mTU = low;
    let mBT = mid1;
    let mTB = mid2;
    let mT2 = mid3;
    let mT1 = high;

    mTU = fitToBrassRange(mTU, profile.tuba);
    mBT = fitToBrassRange(mBT, profile.bassTrombone);
    mTB = fitToBrassRange(mTB, profile.trombone);
    mT2 = fitToBrassRange(mT2, profile.trumpet2);
    mT1 = fitToBrassRange(mT1, profile.trumpet1);

    // Prevent crossings while still allowing doublings when the chord is small.
    if (mBT < mTU) mBT = fitToBrassRange(mBT + 12, profile.bassTrombone);
    if (mTB < mBT) mTB = fitToBrassRange(mTB + 12, profile.trombone);
    if (mT2 < mTB) mT2 = fitToBrassRange(mT2 + 12, profile.trumpet2);
    if (mT1 < mT2) mT1 = fitToBrassRange(mT1 + 12, profile.trumpet1);

    addNote(shells[0], t, dur, midiToPitch(mT1), 1); // TPT1 (written)
    addNote(shells[1], t, dur, midiToPitch(mT2), 1); // TPT2 (written)
    addNote(shells[2], t, dur, midiToPitch(mTB), 1); // TBN
    addNote(shells[3], t, dur, midiToPitch(mBT), 1); // Bass Trombone
    addNote(shells[4], t, dur, midiToPitch(mTU), 1); // TUBA (concert)
  }

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ensemble: "brass_ensemble", brassLevel: level },
    global: { ...score.global },
    parts: partsOut
  } as any;
}
