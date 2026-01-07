// src/harmony/analyzeHarmony.ts

import type { HarmonyAnalyzeRequest, HarmonyAnalysisError } from "./types";
import { pitchToMidi, midiToPc } from "./pitch";
import { detectChordFromPcs } from "./chordDetect";
import { keyFromMetaOrBestGuess } from "./keyEstimate";
import { analyzeRomanNumeral, chordNotesToNames } from "./roman";
import { detectCadences } from "./cadence";

type BeatHarmony = {
  measureNumber: number;
  beatNumber: number;
  chord: any;
  roman: any;
};

type MeasureHarmony = {
  measureNumber: number;
  chord: any;
  roman: any;
};

type HarmonyWarning = {
  atMeasure: number;
  atBeat?: number;
  type: "cadential64_skipped" | "secondary_resolution";
  message: string;
  expected?: string;
  found?: string;
};

function getMeasureCount(score: any): number {
  const parts = score?.parts ?? [];
  let max = 0;
  for (const p of parts) max = Math.max(max, (p?.measures ?? []).length);
  return max;
}

function isPercussionPart(p: any): boolean {
  const name = String(p?.name ?? p?.part_id ?? "").toLowerCase();
  if (name.includes("perc")) return true;
  if (name.includes("drum")) return true;
  if (name.includes("kit")) return true;
  return false;
}

function collectMeasureEvents(score: any, measureIndex: number, ignorePercussion: boolean): any[] {
  const out: any[] = [];
  const parts = score?.parts ?? [];
  for (const p of parts) {
    if (ignorePercussion && isPercussionPart(p)) continue;
    const m = p?.measures?.[measureIndex];
    const evs = m?.events ?? [];
    for (const ev of evs) out.push(ev);
  }
  return out;
}

function collectMeasurePcsAndBassPc(
  score: any,
  measureIndex: number,
  ignorePercussion: boolean
): { pcs: number[]; bassPc: number | null } {
  const pcs: number[] = [];
  let bassMidi: number | null = null;

  const evs = collectMeasureEvents(score, measureIndex, ignorePercussion);

  for (const ev of evs) {
    if (ev?.type !== "note") continue;
    if (!ev?.pitch?.step) continue;

    const midi = typeof ev?.midi === "number" ? ev.midi : pitchToMidi(ev.pitch);
    const pc = midiToPc(midi);

    pcs.push(pc);
    bassMidi = bassMidi === null ? midi : Math.min(bassMidi, midi);
  }

  const bassPc = bassMidi === null ? null : midiToPc(bassMidi);
  return { pcs, bassPc };
}

function collectHistogram(score: any, maxMeasures: number, ignorePercussion: boolean): number[] {
  const hist = new Array(12).fill(0);
  const mc = Math.min(getMeasureCount(score), maxMeasures);
  for (let i = 0; i < mc; i++) {
    const { pcs } = collectMeasurePcsAndBassPc(score, i, ignorePercussion);
    for (const pc of pcs) hist[pc] = (hist[pc] ?? 0) + 1;
  }
  return hist;
}

function getDivisionsForMeasure(score: any, measureIndex: number): number {
  const p0 = score?.parts?.[0];
  const m0 = p0?.measures?.[measureIndex];
  const div = m0?.attributes?.divisions;
  return typeof div === "number" && div > 0 ? div : 480;
}

function getBeatsPerMeasure(score: any, measureIndex: number): number {
  const p0 = score?.parts?.[0];
  const m0 = p0?.measures?.[measureIndex];
  const beats = m0?.attributes?.time?.beats;
  return typeof beats === "number" && beats > 0 ? beats : 4;
}

function noteOverlapsBeatWindow(t: number, dur: number, beatStart: number, beatEnd: number): boolean {
  const a0 = t ?? 0;
  const a1 = (t ?? 0) + (dur ?? 0);
  return a0 < beatEnd && a1 > beatStart;
}

function collectBeatPcsAndBassPc(
  score: any,
  measureIndex: number,
  beatNumber: number,
  ignorePercussion: boolean
): { pcs: number[]; bassPc: number | null } {
  const pcs: number[] = [];
  let bassMidi: number | null = null;

  const divisions = getDivisionsForMeasure(score, measureIndex);
  const beatStart = (beatNumber - 1) * divisions;
  const beatEnd = beatStart + divisions;

  const evs = collectMeasureEvents(score, measureIndex, ignorePercussion);

  for (const ev of evs) {
    if (ev?.type !== "note") continue;
    if (!ev?.pitch?.step) continue;

    const t = typeof ev?.t === "number" ? ev.t : 0;
    const dur = typeof ev?.dur === "number" ? ev.dur : divisions;

    if (!noteOverlapsBeatWindow(t, dur, beatStart, beatEnd)) continue;

    const midi = typeof ev?.midi === "number" ? ev.midi : pitchToMidi(ev.pitch);
    const pc = midiToPc(midi);

    pcs.push(pc);
    bassMidi = bassMidi === null ? midi : Math.min(bassMidi, midi);
  }

  const bassPc = bassMidi === null ? null : midiToPc(bassMidi);
  return { pcs, bassPc };
}

/**
 * Pitch-class helpers (small + local on purpose)
 */
function normPc(pc: number): number {
  const x = pc % 12;
  return x < 0 ? x + 12 : x;
}

function noteNameToPc(name: string): number | null {
  const s = String(name ?? "").trim().toUpperCase();
  if (!s) return null;

  // Accept things like: C, C#, Db, F♯, E♭
  const clean = s.replace("♯", "#").replace("♭", "B"); // use B for flat marker temporarily
  const m = clean.match(/^([A-G])([#B]{0,2})$/);
  if (!m) return null;

  const letter = m[1];
  const acc = m[2] ?? "";

  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[letter];
  if (pc === undefined) return null;

  // acc uses # and B (flat marker)
  for (const ch of acc.split("")) {
    if (ch === "#") pc += 1;
    if (ch === "B") pc -= 1;
  }
  return normPc(pc);
}

function dominantPcFromKey(key: any): number | null {
  const tonicPc = noteNameToPc(key?.tonic);
  if (tonicPc === null) return null;
  // Dominant is +7 semitones from tonic
  return normPc(tonicPc + 7);
}

function looksLikeI64(r: string): boolean {
  return r === "I64" || r === "i64";
}

function looksLikeN_C(r: string): boolean {
  return (r ?? "") === "N.C.";
}

function looksLikeVish(r: string): boolean {
  const u = (r ?? "").toUpperCase();
  return u.startsWith("V") || u.includes("V/") || u.startsWith("VII");
}

function relabelAsV64(x: any): void {
  x.roman = {
    ...(x.roman ?? {}),
    roman: "V64",
    degree: 5,
    functionTag: "dominant"
  };
}

function getBassPcFromItem(x: any): number | null {
  const b = x?.chord?.bassPc;
  return typeof b === "number" ? b : null;
}

/**
 * (1) Cadential 6/4 relabeling WITH bass check:
 * Only relabel I64/i64 -> V64 if bassPc == dominantPc(key).
 */
function applyCadential64LabelingBeatwise(beats: BeatHarmony[], key: any, warnings: HarmonyWarning[]): void {
  const domPc = dominantPcFromKey(key);

  const byMeasure = new Map<number, BeatHarmony[]>();
  for (const b of beats) {
    const arr = byMeasure.get(b.measureNumber) ?? [];
    arr.push(b);
    byMeasure.set(b.measureNumber, arr);
  }

  const measureNums = Array.from(byMeasure.keys()).sort((a, b) => a - b);

  for (let i = 0; i < measureNums.length - 1; i++) {
    const m = measureNums[i];
    const mNext = measureNums[i + 1];

    const cur = (byMeasure.get(m) ?? []).slice().sort((a, b) => a.beatNumber - b.beatNumber);
    const next = (byMeasure.get(mNext) ?? []).slice().sort((a, b) => a.beatNumber - b.beatNumber);

    if (cur.length === 0 || next.length === 0) continue;

    // last non-N.C. in current measure
    let lastNonNC: BeatHarmony | null = null;
    for (let k = cur.length - 1; k >= 0; k--) {
      const r = String(cur[k]?.roman?.roman ?? "");
      if (!looksLikeN_C(r)) {
        lastNonNC = cur[k];
        break;
      }
    }
    if (!lastNonNC) continue;

    const lastRoman = String(lastNonNC.roman?.roman ?? "");
    if (!looksLikeI64(lastRoman)) continue;

    // first non-N.C. in next measure
    let firstNonNCNext: BeatHarmony | null = null;
    for (let k = 0; k < next.length; k++) {
      const r = String(next[k]?.roman?.roman ?? "");
      if (!looksLikeN_C(r)) {
        firstNonNCNext = next[k];
        break;
      }
    }
    if (!firstNonNCNext) continue;

    const nextRoman = String(firstNonNCNext.roman?.roman ?? "");
    if (!looksLikeVish(nextRoman)) continue;

    // bass check: cadential 6/4 must sit over dominant in bass
    if (domPc !== null) {
      const bpc = getBassPcFromItem(lastNonNC);
      if (bpc === null || normPc(bpc) !== domPc) {
        warnings.push({
          atMeasure: m,
          type: "cadential64_skipped",
          message: `Skipped cadential 6/4 relabel at measure ${m}: bassPc is not dominant for key ${String(
            key?.tonic ?? "?"
          )}.`,
          expected: `bassPc=${domPc}`,
          found: bpc === null ? "bassPc=null" : `bassPc=${normPc(bpc)}`
        });
        continue;
      }
    }

    // relabel all I64/i64 beats in current measure
    for (const b of cur) {
      const r = String(b?.roman?.roman ?? "");
      if (looksLikeI64(r)) relabelAsV64(b);
    }
  }
}

function applyCadential64LabelingMeasurewise(measures: MeasureHarmony[], key: any, warnings: HarmonyWarning[]): void {
  const domPc = dominantPcFromKey(key);

  for (let i = 0; i < measures.length - 1; i++) {
    const cur = measures[i] as any;
    const next = measures[i + 1] as any;

    const curRoman = String(cur?.roman?.roman ?? "");
    const nextRoman = String(next?.roman?.roman ?? "");

    if (!looksLikeI64(curRoman)) continue;
    if (!looksLikeVish(nextRoman)) continue;

    if (domPc !== null) {
      const bpc = getBassPcFromItem(cur);
      if (bpc === null || normPc(bpc) !== domPc) {
        warnings.push({
          atMeasure: Number(cur?.measureNumber ?? i + 1),
          type: "cadential64_skipped",
          message: `Skipped cadential 6/4 relabel at measure ${Number(
            cur?.measureNumber ?? i + 1
          )}: bassPc is not dominant for key ${String(key?.tonic ?? "?")}.`,
          expected: `bassPc=${domPc}`,
          found: bpc === null ? "bassPc=null" : `bassPc=${normPc(bpc)}`
        });
        continue;
      }
    }

    relabelAsV64(cur);
  }
}

function buildMeasureSnapshotsFromBeats(beats: BeatHarmony[], measureCount: number): MeasureHarmony[] {
  const byMeasure = new Map<number, BeatHarmony[]>();
  for (const b of beats) {
    const arr = byMeasure.get(b.measureNumber) ?? [];
    arr.push(b);
    byMeasure.set(b.measureNumber, arr);
  }

  const out: MeasureHarmony[] = [];
  for (let m = 1; m <= measureCount; m++) {
    const arr = (byMeasure.get(m) ?? []).slice().sort((a, b) => a.beatNumber - b.beatNumber);
    if (arr.length === 0) continue;

    let pick: BeatHarmony | null = null;
    for (let k = arr.length - 1; k >= 0; k--) {
      const r = String(arr[k]?.roman?.roman ?? "");
      if (!looksLikeN_C(r)) {
        pick = arr[k];
        break;
      }
    }
    if (!pick) pick = arr[arr.length - 1];

    out.push({
      measureNumber: m,
      chord: pick.chord,
      roman: pick.roman
    });
  }

  return out;
}

/**
 * (2) Borrowed-mixture promotion in MAJOR:
 * - bIII: degree 3 but MAJOR triad/maj-quality
 * - iv: degree 4 but MINOR triad/min-quality
 * - bVI: degree 6 but MAJOR triad/maj-quality
 * - bVII: degree 7 but MAJOR triad/maj-quality
 *
 * This is intentionally conservative: only adjusts when degree is known and quality matches.
 */
function promoteBorrowedMixture(roman: any, chord: any, key: any): any {
  const mode = String(key?.mode ?? "").toLowerCase();
  if (mode !== "major") return roman;

  const degree = typeof roman?.degree === "number" ? roman.degree : null;
  const quality = String(chord?.quality ?? "").toLowerCase();

  if (!degree) return roman;

  // Triads
  if (degree === 3 && quality === "maj") {
    return { ...roman, roman: "bIII", functionTag: roman.functionTag ?? "tonic" };
  }
  if (degree === 4 && quality === "min") {
    return { ...roman, roman: "iv", functionTag: roman.functionTag ?? "predominant" };
  }
  if (degree === 6 && quality === "maj") {
    return { ...roman, roman: "bVI", functionTag: roman.functionTag ?? "predominant" };
  }
  if (degree === 7 && quality === "maj") {
    return { ...roman, roman: "bVII", functionTag: roman.functionTag ?? "predominant" };
  }

  return roman;
}

/**
 * (3) Secondary-dominant resolution tracking:
 * If we see roman.secondaryOf like "V" or "IV", we check next non-N.C. event.
 * If the next roman does not match the expected target, we add a warning.
 */
function expectedTargetFromSecondary(roman: any): string | null {
  const sec = String(roman?.secondaryOf ?? "").trim();
  if (!sec) return null;
  // normalize: V, IV, ii, etc. Just return as-is.
  return sec;
}

function romanMatchesTarget(r: string, target: string): boolean {
  const a = String(r ?? "").replace(/\s+/g, "");
  const t = String(target ?? "").replace(/\s+/g, "");
  if (!a || !t) return false;

  // Accept exact or prefix matches (e.g., V, V7, V65; IV, IV6; ii, ii6, ii°6)
  if (a === t) return true;
  if (a.startsWith(t)) return true;

  // Also accept something like "V/IV" resolving to "IV"
  if (a.includes("/") && a.split("/").pop() === t) return true;

  return false;
}

function trackSecondaryResolutionsBeatwise(beats: BeatHarmony[], warnings: HarmonyWarning[]): void {
  const isNC = (x: BeatHarmony) => looksLikeN_C(String(x?.roman?.roman ?? ""));

  for (let i = 0; i < beats.length; i++) {
    const cur = beats[i];
    const target = expectedTargetFromSecondary(cur?.roman);
    if (!target) continue;

    // find next non-NC
    let j = i + 1;
    while (j < beats.length && isNC(beats[j])) j++;

    if (j >= beats.length) {
      warnings.push({
        atMeasure: cur.measureNumber,
        atBeat: cur.beatNumber,
        type: "secondary_resolution",
        message: `Secondary function did not resolve: expected ${target}, but no next harmonic event found.`,
        expected: target,
        found: "end_of_sequence"
      });
      continue;
    }

    const nextRoman = String(beats[j]?.roman?.roman ?? "");
    if (!romanMatchesTarget(nextRoman, target)) {
      warnings.push({
        atMeasure: cur.measureNumber,
        atBeat: cur.beatNumber,
        type: "secondary_resolution",
        message: `Secondary function did not resolve as expected: expected ${target}, found ${nextRoman}.`,
        expected: target,
        found: nextRoman
      });
    }
  }
}

function trackSecondaryResolutionsMeasurewise(measures: MeasureHarmony[], warnings: HarmonyWarning[]): void {
  const isNC = (x: MeasureHarmony) => looksLikeN_C(String(x?.roman?.roman ?? ""));

  for (let i = 0; i < measures.length; i++) {
    const cur = measures[i];
    const target = expectedTargetFromSecondary(cur?.roman);
    if (!target) continue;

    let j = i + 1;
    while (j < measures.length && isNC(measures[j])) j++;

    if (j >= measures.length) {
      warnings.push({
        atMeasure: cur.measureNumber,
        type: "secondary_resolution",
        message: `Secondary function did not resolve: expected ${target}, but no next harmonic event found.`,
        expected: target,
        found: "end_of_sequence"
      });
      continue;
    }

    const nextRoman = String(measures[j]?.roman?.roman ?? "");
    if (!romanMatchesTarget(nextRoman, target)) {
      warnings.push({
        atMeasure: cur.measureNumber,
        type: "secondary_resolution",
        message: `Secondary function did not resolve as expected: expected ${target}, found ${nextRoman}.`,
        expected: target,
        found: nextRoman
      });
    }
  }
}

export function analyzeHarmony(req: HarmonyAnalyzeRequest): any | HarmonyAnalysisError {
  try {
    const score = req?.scoreModel;

    if (!score) {
      return { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." };
    }

    const options = req?.options ?? {};
    const granularity = options.granularity === "beat" ? "beat" : "measure";
    const maxMeasures = typeof options.maxMeasures === "number" ? options.maxMeasures : 128;
    const ignorePercussion = options.ignorePercussion === true;

    const measureCount = Math.min(getMeasureCount(score), maxMeasures);
    if (measureCount <= 0) {
      return { ok: false, error: "scoreModel has no measures in parts[0]. Harmony analysis requires measures." };
    }

    const warnings: HarmonyWarning[] = [];

    const hist = collectHistogram(score, measureCount, ignorePercussion);

    const metaKey = score?.meta?.harmony?.key ?? score?.meta?.key ?? null;
    const preferKeyFromMeta = options.preferKeyFromMeta !== false;

    let key = keyFromMetaOrBestGuess(preferKeyFromMeta ? metaKey : null, hist, true);

    if (options.forceKey?.tonic && (options.forceKey.mode === "major" || options.forceKey.mode === "minor")) {
      key = { tonic: options.forceKey.tonic, mode: options.forceKey.mode, confidence: 1 };
    }

    if (granularity === "measure") {
      const measures: MeasureHarmony[] = [];

      for (let mi = 0; mi < measureCount; mi++) {
        const { pcs, bassPc } = collectMeasurePcsAndBassPc(score, mi, ignorePercussion);
        const chord = detectChordFromPcs(pcs, true, bassPc);
        const notes = chordNotesToNames(chord.pcs, true);

        let roman = analyzeRomanNumeral(chord, key, notes);
        roman = promoteBorrowedMixture(roman, chord, key);

        measures.push({
          measureNumber: mi + 1,
          chord,
          roman
        });
      }

      applyCadential64LabelingMeasurewise(measures, key, warnings);

      // Track secondary resolution in measure space too
      trackSecondaryResolutionsMeasurewise(measures, warnings);

      const cadences = detectCadences(measures as any);

      return {
        ok: true,
        engine: {
          phase: "3.3",
          granularity: "measure",
          romanNumerals: true,
          tonicizations: "brief",
          sustainPolicy: "overlap"
        },
        key,
        measures,
        cadences,
        warnings
      };
    }

    // beat mode
    const beats: BeatHarmony[] = [];

    for (let mi = 0; mi < measureCount; mi++) {
      const beatsPerMeasure = getBeatsPerMeasure(score, mi);

      for (let b = 1; b <= beatsPerMeasure; b++) {
        const { pcs, bassPc } = collectBeatPcsAndBassPc(score, mi, b, ignorePercussion);
        const chord = detectChordFromPcs(pcs, true, bassPc);
        const preferSharps = key?.tonic === "G" || key?.tonic === "D" || key?.tonic === "A" || key?.tonic === "E" || key?.tonic === "B" || key?.tonic === "F#" || key?.tonic === "C#";
        const notes = chordNotesToNames(chord.pcs, preferSharps);

        let roman = analyzeRomanNumeral(chord, key, notes);
        roman = promoteBorrowedMixture(roman, chord, key);

        beats.push({
          measureNumber: mi + 1,
          beatNumber: b,
          chord,
          roman
        });
      }
    }

    applyCadential64LabelingBeatwise(beats, key, warnings);

    // Secondary resolution tracking on beat stream
    trackSecondaryResolutionsBeatwise(beats, warnings);

    const measureSnapshots = buildMeasureSnapshotsFromBeats(beats, measureCount);
    const cadences = detectCadences(measureSnapshots as any);

    return {
      ok: true,
      engine: {
        phase: "3.3",
        granularity: "beat",
        romanNumerals: true,
        tonicizations: "brief",
        sustainPolicy: "overlap"
      },
      key,
      beats,
      cadences,
      warnings
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}