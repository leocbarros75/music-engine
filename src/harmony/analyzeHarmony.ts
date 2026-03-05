// src/harmony/analyzeHarmony.ts

import type { HarmonyAnalyzeRequest, HarmonyAnalysisError } from "./types";
import { pitchToMidi, midiToPc, pcToName } from "./pitch";
import { detectChordFromPcs } from "./chordDetect";
import { keyFromMetaOrBestGuess } from "./keyEstimate";
import { analyzeRomanNumeral, chordNotesToNames } from "./roman";
import { detectCadences } from "./cadence";

type Json = Record<string, unknown>;

type BeatHarmony = {
  measureNumber: number;
  beatNumber: number;
  chord: any;
  roman: any;
  // internal flag so sustain carry does not overwrite a suppressed roman
  __romanSuppressed?: boolean;
};

type MeasureHarmony = {
  measureNumber: number;
  chord: any;
  roman: any;
  __romanSuppressed?: boolean;
};

type HarmonyWarning = {
  atMeasure: number;
  atBeat?: number;
  type: "cadential64_skipped" | "secondary_resolution" | "low_confidence_roman_suppressed";
  message: string;
  expected?: string;
  found?: string;
};

type SustainPolicy = "none" | "carry" | "overlap";

function sendSustainPolicy(x: unknown): SustainPolicy {
  const s = String(x ?? "").toLowerCase().trim();
  if (s === "carry") return "carry";
  if (s === "overlap") return "overlap";
  if (s === "none") return "none";
  return "overlap";
}

function getMeasureCount(score: any): number {
  const parts = score?.parts ?? [];
  let max = 0;
  for (const p of parts) max = Math.max(max, (p?.measures ?? []).length);
  return max;
}

function isPercussionPart(p: any): boolean {
  const name = String(p?.name ?? p?.part_id ?? "").toLowerCase();
  return name.includes("perc") || name.includes("drum") || name.includes("kit");
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
 * Small helpers
 */
function normPc(pc: number): number {
  const x = pc % 12;
  return x < 0 ? x + 12 : x;
}

function noteNameToPc(name: string): number | null {
  const s = String(name ?? "").trim().toUpperCase();
  if (!s) return null;

  // normalize unicode accidental chars
  const clean = s.replace("♯", "#").replace("♭", "B");
  const m = clean.match(/^([A-G])([#B]{0,2})$/);
  if (!m) return null;

  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[m[1]];
  const acc = m[2] ?? "";

  for (const ch of acc.split("")) {
    if (ch === "#") pc += 1;
    if (ch === "B") pc -= 1;
  }
  return normPc(pc);
}

function dominantPcFromKey(key: any): number | null {
  const tonicPc = noteNameToPc(key?.tonic);
  if (tonicPc === null) return null;
  return normPc(tonicPc + 7);
}

function looksLikeI64(r: string): boolean {
  return r === "I64" || r === "i64";
}

function looksLikeNC(r: string): boolean {
  return (r ?? "") === "N.C.";
}

function looksLikeVish(r: string): boolean {
  const u = (r ?? "").toUpperCase();
  return u.startsWith("V") || u.includes("V/") || u.startsWith("VII");
}

function relabelAsV64(x: any): void {
  x.roman = { ...(x.roman ?? {}), roman: "V64", degree: 5, functionTag: "dominant" };
}

function getBassPcFromItem(x: any): number | null {
  const b = x?.chord?.bassPc;
  return typeof b === "number" ? b : null;
}

function getByPath(obj: any, path: string[]): unknown {
  let cur = obj;
  for (const k of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

function asFiniteNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function asMode(x: unknown): "major" | "minor" | null {
  const s = String(x ?? "").toLowerCase();
  if (s === "major") return "major";
  if (s === "minor") return "minor";
  return null;
}

function preferSharpsFromTonicName(tonic: string | null): boolean {
  const t = String(tonic ?? "").trim();
  return t === "G" || t === "D" || t === "A" || t === "E" || t === "B" || t === "F#" || t === "C#";
}

function preferSharpsFromKeySigOrTonic(
  keySig: { fifths: number; mode: "major" | "minor" | null } | null,
  tonic: string | null
): boolean {
  const fifths = keySig?.fifths;
  if (typeof fifths === "number" && Number.isFinite(fifths)) {
    if (fifths > 0) return true;
    if (fifths < 0) return false;
    return preferSharpsFromTonicName(tonic);
  }
  return preferSharpsFromTonicName(tonic);
}

/**
 * Robust key signature extraction (because parsers store it differently).
 * Scans first few measures across parts and tries multiple common paths.
 */
function findFirstKeySig(score: any): { fifths: number; mode: "major" | "minor" | null } | null {
  const parts = score?.parts ?? [];
  const maxMeasureScan = 8;

  const PATHS: string[][] = [
    ["attributes", "key", "fifths"],
    ["attributes", "keySig", "fifths"],
    ["attributes", "keySignature", "fifths"],
    ["attributes", "key_signature", "fifths"],

    // IMPORTANT: our MusicXML parser stores <fifths> here
    ["attributes", "key_fifths"],

    ["attributes", "fifths"],
    ["attributes", "fifthsNumber"],
    ["attributes", "key", "fifthsNumber"],
    ["attributes", "key", "fifths_value"],

    ["key", "fifths"],
    ["keySig", "fifths"],
    ["keySignature", "fifths"],
    ["key_signature", "fifths"]
  ];

  const MODE_PATHS: string[][] = [
    ["attributes", "key", "mode"],
    ["attributes", "keySig", "mode"],
    ["attributes", "keySignature", "mode"],
    ["attributes", "key_signature", "mode"],

    // sometimes normalized into attributes
    ["attributes", "key_mode"],
    ["attributes", "mode"],

    ["key", "mode"],
    ["keySig", "mode"],
    ["keySignature", "mode"],
    ["key_signature", "mode"]
  ];

  for (const p of parts) {
    const measures = p?.measures ?? [];
    for (let mi = 0; mi < Math.min(measures.length, maxMeasureScan); mi++) {
      const m = measures[mi];

      let fifths: number | null = null;
      for (const path of PATHS) {
        fifths = asFiniteNumber(getByPath(m, path));
        if (fifths !== null) break;
      }
      if (fifths === null) continue;

      let mode: "major" | "minor" | null = null;
      for (const path of MODE_PATHS) {
        mode = asMode(getByPath(m, path));
        if (mode) break;
      }

      return { fifths, mode };
    }
  }

  return null;
}

function keyFromFifths(
  fifths: number,
  mode: "major" | "minor"
): { tonic: string; mode: "major" | "minor"; confidence: number } | null {
  const MAJOR_BY_FIFTHS: Record<number, string> = {
    [-7]: "Cb",
    [-6]: "Gb",
    [-5]: "Db",
    [-4]: "Ab",
    [-3]: "Eb",
    [-2]: "Bb",
    [-1]: "F",
    [0]: "C",
    [1]: "G",
    [2]: "D",
    [3]: "A",
    [4]: "E",
    [5]: "B",
    [6]: "F#",
    [7]: "C#"
  };

  const MINOR_BY_FIFTHS: Record<number, string> = {
    [-7]: "Ab",
    [-6]: "Eb",
    [-5]: "Bb",
    [-4]: "F",
    [-3]: "C",
    [-2]: "G",
    [-1]: "D",
    [0]: "A",
    [1]: "E",
    [2]: "B",
    [3]: "F#",
    [4]: "C#",
    [5]: "G#",
    [6]: "D#",
    [7]: "A#"
  };

  const tonic = mode === "major" ? MAJOR_BY_FIFTHS[fifths] : MINOR_BY_FIFTHS[fifths];
  if (!tonic) return null;
  return { tonic, mode, confidence: 1 };
}

/**
 * Use key signature if present. If key signature has no mode, choose major vs minor using histogram fit.
 */
function keyFromScoreModelKeySignature(
  score: any,
  hist: number[]
): { tonic: string; mode: string; confidence: number } | null {
  const ks = findFirstKeySig(score);
  if (!ks) return null;

  const fifths = ks.fifths;
  const mode = ks.mode;

  if (mode) {
    const k = keyFromFifths(fifths, mode);
    return k ? { ...k } : null;
  }

  const maj = keyFromFifths(fifths, "major");
  const min = keyFromFifths(fifths, "minor");
  if (!maj || !min) return maj ? { ...maj } : min ? { ...min } : null;

  const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
  const HARM_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 11];

  const majPc = noteNameToPc(maj.tonic);
  const minPc = noteNameToPc(min.tonic);
  if (majPc === null || minPc === null) return { ...maj };

  function fit(tonicPc: number, rel: number[]): number {
    const allowed = new Set<number>(rel.map((d) => normPc(tonicPc + d)));
    let inside = 0;
    let outside = 0;
    for (let pc = 0; pc < 12; pc++) {
      const c = hist[pc] ?? 0;
      if (allowed.has(pc)) inside += c;
      else outside += c;
    }
    return inside - outside * 0.75;
  }

  const sMaj = fit(majPc, MAJOR_SCALE);
  const sMin = fit(minPc, HARM_MINOR_SCALE);

  return sMin > sMaj ? { ...min } : { ...maj };
}

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

    let lastNonNC: BeatHarmony | null = null;
    for (let k = cur.length - 1; k >= 0; k--) {
      const r = String(cur[k]?.roman?.roman ?? "");
      if (!looksLikeNC(r)) {
        lastNonNC = cur[k];
        break;
      }
    }
    if (!lastNonNC) continue;

    const lastRoman = String(lastNonNC.roman?.roman ?? "");
    if (!looksLikeI64(lastRoman)) continue;

    let firstNonNCNext: BeatHarmony | null = null;
    for (let k = 0; k < next.length; k++) {
      const r = String(next[k]?.roman?.roman ?? "");
      if (!looksLikeNC(r)) {
        firstNonNCNext = next[k];
        break;
      }
    }
    if (!firstNonNCNext) continue;

    const nextRoman = String(firstNonNCNext.roman?.roman ?? "");
    if (!looksLikeVish(nextRoman)) continue;

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
      if (!looksLikeNC(r)) {
        pick = arr[k];
        break;
      }
    }
    if (!pick) pick = arr[arr.length - 1];

    out.push({ measureNumber: m, chord: pick.chord, roman: pick.roman, __romanSuppressed: pick.__romanSuppressed });
  }

  return out;
}

function promoteBorrowedMixture(roman: any, chord: any, key: any): any {
  const mode = String(key?.mode ?? "").toLowerCase();
  if (mode !== "major") return roman;

  const degree = typeof roman?.degree === "number" ? roman.degree : null;
  const quality = String(chord?.quality ?? "").toLowerCase();
  if (!degree) return roman;

  if (degree === 3 && quality === "maj") return { ...roman, roman: "bIII", functionTag: roman.functionTag ?? "tonic" };
  if (degree === 4 && quality === "min") return { ...roman, roman: "iv", functionTag: roman.functionTag ?? "predominant" };
  if (degree === 6 && quality === "maj") return { ...roman, roman: "bVI", functionTag: roman.functionTag ?? "predominant" };
  if (degree === 7 && quality === "maj") return { ...roman, roman: "bVII", functionTag: roman.functionTag ?? "predominant" };

  return roman;
}

function expectedTargetFromSecondary(roman: any): string | null {
  const sec = String(roman?.secondaryOf ?? "").trim();
  return sec ? sec : null;
}

function romanMatchesTarget(r: string, target: string): boolean {
  const a = String(r ?? "").replace(/\s+/g, "");
  const t = String(target ?? "").replace(/\s+/g, "");
  if (!a || !t) return false;
  if (a === t) return true;
  if (a.startsWith(t)) return true;
  if (a.includes("/") && a.split("/").pop() === t) return true;
  return false;
}

function isAllowedSecondaryRedirect(curRoman: string, target: string, nextRoman: string, key: any): boolean {
  const mode = String(key?.mode ?? "").toLowerCase();
  if (mode !== "major") return false;

  const cur = String(curRoman ?? "").replace(/\s+/g, "");
  const tgt = String(target ?? "").replace(/\s+/g, "");
  const nxt = String(nextRoman ?? "").replace(/\s+/g, "");

  if (tgt === "V" && cur.startsWith("V") && nxt.startsWith("vi")) return true;
  return false;
}

function trackSecondaryResolutionsBeatwise(beats: BeatHarmony[], key: any, warnings: HarmonyWarning[]): void {
  const isNC = (x: BeatHarmony) => looksLikeNC(String(x?.roman?.roman ?? ""));

  for (let i = 0; i < beats.length; i++) {
    const cur = beats[i];
    const target = expectedTargetFromSecondary(cur?.roman);
    if (!target) continue;

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
      const curRoman = String(cur?.roman?.roman ?? "");
      if (isAllowedSecondaryRedirect(curRoman, target, nextRoman, key)) continue;

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

function trackSecondaryResolutionsMeasurewise(measures: MeasureHarmony[], key: any, warnings: HarmonyWarning[]): void {
  const isNC = (x: MeasureHarmony) => looksLikeNC(String(x?.roman?.roman ?? ""));

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
      const curRoman = String(cur?.roman?.roman ?? "");
      if (isAllowedSecondaryRedirect(curRoman, target, nextRoman, key)) continue;

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

function applySustainCarryToBeats(beats: BeatHarmony[], sustainPolicy: SustainPolicy): void {
  if (sustainPolicy === "none") return;

  let lastNonNC: BeatHarmony | null = null;

  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const r = String(b?.roman?.roman ?? "");
    if (!looksLikeNC(r)) {
      lastNonNC = b;
      continue;
    }

    // Do not overwrite a roman that we intentionally suppressed.
    if (b.__romanSuppressed) continue;

    if (!lastNonNC) continue;

    b.chord = lastNonNC.chord;
    b.roman = lastNonNC.roman;
  }
}

function isTriadQuality(q: string): boolean {
  const x = String(q ?? "").toLowerCase();
  return x === "maj" || x === "min";
}

function isDominantOf(domRootPc: number, tonicRootPc: number): boolean {
  return normPc(domRootPc) === normPc(tonicRootPc + 7);
}

/**
 * Confidence helpers (Roman suppression)
 *
 * We use chord.detect confidence if present.
 * Fallback rules are conservative: only mark low confidence when the chord is obviously ambiguous.
 */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function chordConfidence(chord: any): number {
  const c1 = typeof chord?.confidence === "number" ? chord.confidence : null;
  const c2 = typeof chord?.score === "number" ? chord.score : null;
  const c3 = typeof chord?.matchScore === "number" ? chord.matchScore : null;

  if (c1 !== null) return clamp01(c1);
  if (c2 !== null) return clamp01(c2);
  if (c3 !== null) return clamp01(c3);

  const qSeen = String(chord?.quality ?? "").toLowerCase();
  const rootOk = typeof chord?.rootPc === "number" && Number.isFinite(chord.rootPc);
  const pcs = Array.isArray(chord?.pcs) ? chord.pcs : [];

  // If detectChord couldn't really decide, treat as low confidence
  if (!rootOk) return 0.2;
  if (qSeen === "unknown") return 0.25;
  if (pcs.length <= 1) return 0.25;

  // If we have a named, rooted chord, assume reasonable confidence
  return 0.9;
}

function makeNCRoman(notes: string[]): any {
  return {
    roman: "N.C.",
    degree: null,
    functionTag: "other",
    notes: Array.isArray(notes) ? notes : []
  };
}

function maybeSuppressRoman(params: {
  chord: any;
  roman: any;
  notes: string[];
  minConfidence: number;
  enable: boolean;
  warnings: HarmonyWarning[];
  atMeasure: number;
  atBeat?: number;
}): { roman: any; suppressed: boolean } {
  const { chord, roman, notes, minConfidence, enable, warnings, atMeasure, atBeat } = params;

  if (!enable) return { roman, suppressed: false };

  const r = String(roman?.roman ?? "");
  if (!r || looksLikeNC(r)) return { roman, suppressed: false };

  const conf = chordConfidence(chord);
  if (conf >= minConfidence) return { roman, suppressed: false };

  const chordName = String(chord?.name ?? "");
  const quality = String(chord?.quality ?? "");
  const pcs = Array.isArray(chord?.pcs) ? chord.pcs : [];

  warnings.push({
    atMeasure,
    atBeat,
    type: "low_confidence_roman_suppressed",
    message: `Suppressed roman numeral due to low chord confidence (${conf.toFixed(3)} < ${minConfidence.toFixed(3)}).`,
    expected: `confidence>=${minConfidence.toFixed(3)}`,
    found: `confidence=${conf.toFixed(3)} roman=${r} chord=${chordName || "?"} quality=${quality || "?"} pcs=${JSON.stringify(
      pcs
    )}`
  });

  return { roman: makeNCRoman(notes), suppressed: true };
}

/**
 * Phase 4 key stabilizer:
 * If the ending shows a dominant -> tonic cadence (by chord roots), anchor the key to that tonic.
 * This uses chord roots + quality only, so it does not depend on roman output.
 */
function anchorKeyFromCadenceIfNeeded(params: {
  score: any;
  measureCount: number;
  ignorePercussion: boolean;
  key: any;
  keySig: { fifths: number; mode: "major" | "minor" | null } | null;
  hadKeySig: boolean;
  hadMetaKey: boolean;
  hadForceKey: boolean;
}): any {
  const { score, measureCount, ignorePercussion, key, keySig, hadKeySig, hadMetaKey, hadForceKey } = params;

  if (hadForceKey) return key;
  if (hadMetaKey) return key;
  if (hadKeySig) return key;

  const curConf = typeof key?.confidence === "number" ? key.confidence : 0;
  if (curConf >= 0.995) return key;

  const lastChords: any[] = [];
  for (let mi = measureCount - 1; mi >= 0 && lastChords.length < 6; mi--) {
    const { pcs, bassPc } = collectMeasurePcsAndBassPc(score, mi, ignorePercussion);
    if (!pcs || pcs.length === 0) continue;

    const chord = detectChordFromPcs(pcs, true, bassPc);
    if (!chord) continue;
    if (typeof chord?.rootPc !== "number") continue;

    lastChords.push(chord);
  }

  if (lastChords.length < 2) return key;

  const last = lastChords[0];
  const prev = lastChords[1];

  const lastQ = String(last?.quality ?? "").toLowerCase();
  const prevQ = String(prev?.quality ?? "").toLowerCase();

  const lastRoot = typeof last?.rootPc === "number" ? last.rootPc : null;
  const prevRoot = typeof prev?.rootPc === "number" ? prev.rootPc : null;

  if (lastRoot === null || prevRoot === null) return key;

  if (!isTriadQuality(lastQ)) return key;

  const prevIsDom7 = prevQ === "dom7";
  const prevIsTriad = isTriadQuality(prevQ);

  if (!(prevIsDom7 || prevIsTriad)) return key;
  if (!isDominantOf(prevRoot, lastRoot)) return key;

  const preferSharps = preferSharpsFromKeySigOrTonic(keySig, key?.tonic ?? null);
  const tonicName = pcToName(lastRoot, preferSharps);
  const mode = lastQ === "maj" ? "major" : "minor";

  return {
    tonic: tonicName,
    mode,
    confidence: Math.max(curConf, 0.995)
  };
}

/**
 * Phase 0 key stabilizer for short excerpts with no key signature/meta.
 * (Only runs when hadKeySig/hadMetaKey/hadForceKey are false.)
 */
function anchorKeyToFinalTriadIfNeeded(params: {
  score: any;
  measureCount: number;
  ignorePercussion: boolean;
  key: any;
  keySig: { fifths: number; mode: "major" | "minor" | null } | null;
  hadKeySig: boolean;
  hadMetaKey: boolean;
  hadForceKey: boolean;
}): any {
  const { score, measureCount, ignorePercussion, key, keySig, hadKeySig, hadMetaKey, hadForceKey } = params;
  if (hadForceKey) return key;
  if (hadMetaKey) return key;
  if (hadKeySig) return key;

  const curConf = typeof key?.confidence === "number" ? key.confidence : 0;
  if (curConf >= 0.98) return key;

  let lastTriadRoot: number | null = null;
  let lastTriadQuality: "maj" | "min" | null = null;

  for (let mi = measureCount - 1; mi >= 0; mi--) {
    const { pcs, bassPc } = collectMeasurePcsAndBassPc(score, mi, ignorePercussion);
    if (!pcs || pcs.length === 0) continue;

    const chord = detectChordFromPcs(pcs, true, bassPc);
    const q = String(chord?.quality ?? "").toLowerCase();
    const rootPc = typeof chord?.rootPc === "number" ? chord.rootPc : null;
    if (rootPc === null) continue;

    if (q !== "maj" && q !== "min") continue;

    lastTriadRoot = rootPc;
    lastTriadQuality = q as any;
    break;
  }

  if (lastTriadRoot === null || lastTriadQuality === null) return key;

  // Also find the triad immediately before the last triad (for short-excerpt cadence heuristics).
  let prevTriadRoot: number | null = null;
  let prevTriadQuality: "maj" | "min" | null = null;

  let seenLast = false;
  for (let mi = measureCount - 1; mi >= 0; mi--) {
    const { pcs, bassPc } = collectMeasurePcsAndBassPc(score, mi, ignorePercussion);
    if (!pcs || pcs.length === 0) continue;

    const chord = detectChordFromPcs(pcs, true, bassPc);
    const q = String(chord?.quality ?? "").toLowerCase();
    const rootPc = typeof chord?.rootPc === "number" ? chord.rootPc : null;
    if (rootPc === null) continue;

    if (q !== "maj" && q !== "min") continue;

    if (!seenLast) {
      seenLast = true;
      continue;
    }

    prevTriadRoot = rootPc;
    prevTriadQuality = q as any;
    break;
  }

  let firstTriadRoot: number | null = null;
  let firstTriadQuality: "maj" | "min" | null = null;

  for (let mi = 0; mi < measureCount; mi++) {
    const { pcs, bassPc } = collectMeasurePcsAndBassPc(score, mi, ignorePercussion);
    if (!pcs || pcs.length === 0) continue;

    const chord = detectChordFromPcs(pcs, true, bassPc);
    const q = String(chord?.quality ?? "").toLowerCase();
    const rootPc = typeof chord?.rootPc === "number" ? chord.rootPc : null;
    if (rootPc === null) continue;

    if (q !== "maj" && q !== "min") continue;

    firstTriadRoot = rootPc;
    firstTriadQuality = q as any;
    break;
  }

  // Applied dominant to dominant (V/V -> V) at the end of a short excerpt.
  // If prev triad is dominant of last triad, treat last triad as V and infer tonic a fifth below.
  if (
    measureCount <= 4 &&
    prevTriadRoot !== null &&
    prevTriadQuality !== null &&
    lastTriadQuality === "maj" &&
    isDominantOf(prevTriadRoot, lastTriadRoot)
  ) {
    const preferSharps = preferSharpsFromKeySigOrTonic(keySig, key?.tonic ?? null);
    const inferredTonicPc = normPc(lastTriadRoot - 7); // a fifth below last
    const tonicName = pcToName(inferredTonicPc, preferSharps);

    return {
      tonic: tonicName,
      mode: "major",
      confidence: Math.max(curConf, 0.99)
    };
  }

  // Short excerpt that ends on V of the opening triad -> anchor to opening triad (half cadence).
  if (
    firstTriadRoot !== null &&
    firstTriadQuality !== null &&
    measureCount <= 4 &&
    isDominantOf(lastTriadRoot, firstTriadRoot)
  ) {
    const preferSharps = preferSharpsFromKeySigOrTonic(keySig, key?.tonic ?? null);
    const tonicName = pcToName(firstTriadRoot, preferSharps);
    return {
      tonic: tonicName,
      mode: firstTriadQuality === "maj" ? "major" : "minor",
      confidence: Math.max(curConf, 0.99)
    };
  }

  const preferSharps = preferSharpsFromKeySigOrTonic(keySig, key?.tonic ?? null);
  const tonicName = pcToName(lastTriadRoot, preferSharps);

  return {
    tonic: tonicName,
    mode: lastTriadQuality === "maj" ? "major" : "minor",
    confidence: Math.max(curConf, 0.99)
  };
}

export function analyzeHarmony(req: HarmonyAnalyzeRequest): any | HarmonyAnalysisError {
  try {
    const score = req?.scoreModel;
    if (!score) return { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." };

    const options = (req?.options ?? {}) as any;
    const granularity = options.granularity === "beat" ? "beat" : "measure";
    const maxMeasures = typeof options.maxMeasures === "number" ? options.maxMeasures : 128;
    const ignorePercussion = options.ignorePercussion === true;
    const sustainPolicy = sendSustainPolicy(options.sustainPolicy);

    const romanMinConfidence =
      typeof options.romanMinConfidence === "number" && Number.isFinite(options.romanMinConfidence)
        ? clamp01(options.romanMinConfidence)
        : 0.55;

    const suppressLowConfidenceRoman = options.suppressLowConfidenceRoman !== false;

    const measureCount = Math.min(getMeasureCount(score), maxMeasures);
    if (measureCount <= 0) {
      return { ok: false, error: "scoreModel has no measures in parts[0]. Harmony analysis requires measures." };
    }

    const warnings: HarmonyWarning[] = [];
    const hist = collectHistogram(score, measureCount, ignorePercussion);

    const metaKey = score?.meta?.harmony?.key ?? score?.meta?.key ?? null;
    const preferKeyFromMeta = options.preferKeyFromMeta !== false;

    const hadForceKey =
      !!(options.forceKey?.tonic && (options.forceKey.mode === "major" || options.forceKey.mode === "minor"));
    const hadMetaKey = !!(preferKeyFromMeta && metaKey);

    // IMPORTANT: compute keySig first and use it for hadKeySig.
    const keySig = findFirstKeySig(score);
    const hadKeySig = !!keySig;

    let key: any = null;

    // If there is an explicit key signature with mode, lock to it.
    if (!hadForceKey && !hadMetaKey && hadKeySig && keySig?.mode) {
      const k = keyFromFifths(keySig.fifths, keySig.mode);
      key = k ? { ...k } : null;
    }

    if (hadForceKey) {
      key = { tonic: options.forceKey.tonic, mode: options.forceKey.mode, confidence: 1 };
    } else if (hadMetaKey) {
      key = keyFromMetaOrBestGuess(metaKey, hist, true);
    } else if (!key) {
      // If signature exists but mode unknown, fall back to histogram fit between relative major/minor for that signature.
      key = keyFromScoreModelKeySignature(score, hist) ?? keyFromMetaOrBestGuess(null, hist, true);
    }

    // Only run stabilizers if we do NOT have a real key signature/meta/force.
    key = anchorKeyFromCadenceIfNeeded({
      score,
      measureCount,
      ignorePercussion,
      key,
      keySig,
      hadKeySig,
      hadMetaKey,
      hadForceKey
    });

    key = anchorKeyToFinalTriadIfNeeded({
      score,
      measureCount,
      ignorePercussion,
      key,
      keySig,
      hadKeySig,
      hadMetaKey,
      hadForceKey
    });

    const preferSharps = preferSharpsFromKeySigOrTonic(keySig, key?.tonic ?? null);

    if (granularity === "measure") {
      const measures: MeasureHarmony[] = [];

      for (let mi = 0; mi < measureCount; mi++) {
        const { pcs, bassPc } = collectMeasurePcsAndBassPc(score, mi, ignorePercussion);
        const chord = detectChordFromPcs(pcs, preferSharps, bassPc);
        const notes = chordNotesToNames(chord.pcs, preferSharps);

        let roman = analyzeRomanNumeral(chord, key, notes);
        roman = promoteBorrowedMixture(roman, chord, key);

        const maybe = maybeSuppressRoman({
          chord,
          roman,
          notes,
          minConfidence: romanMinConfidence,
          enable: suppressLowConfidenceRoman,
          warnings,
          atMeasure: mi + 1
        });

        measures.push({
          measureNumber: mi + 1,
          chord,
          roman: maybe.roman,
          __romanSuppressed: maybe.suppressed
        });
      }

      applyCadential64LabelingMeasurewise(measures, key, warnings);
      trackSecondaryResolutionsMeasurewise(measures, key, warnings);

      const cadences = detectCadences(measures as any);

      return {
        ok: true,
        engine: {
          phase: "4.2",
          granularity: "measure",
          romanNumerals: true,
          tonicizations: "brief",
          sustainPolicy,
          romanMinConfidence,
          suppressLowConfidenceRoman
        },
        key,
        measures,
        cadences,
        warnings
      };
    }

    const beats: BeatHarmony[] = [];

    for (let mi = 0; mi < measureCount; mi++) {
      const beatsPerMeasure = getBeatsPerMeasure(score, mi);

      for (let b = 1; b <= beatsPerMeasure; b++) {
        const { pcs, bassPc } = collectBeatPcsAndBassPc(score, mi, b, ignorePercussion);
        const chord = detectChordFromPcs(pcs, preferSharps, bassPc);
        const notes = chordNotesToNames(chord.pcs, preferSharps);

        let roman = analyzeRomanNumeral(chord, key, notes);
        roman = promoteBorrowedMixture(roman, chord, key);

        const maybe = maybeSuppressRoman({
          chord,
          roman,
          notes,
          minConfidence: romanMinConfidence,
          enable: suppressLowConfidenceRoman,
          warnings,
          atMeasure: mi + 1,
          atBeat: b
        });

        beats.push({
          measureNumber: mi + 1,
          beatNumber: b,
          chord,
          roman: maybe.roman,
          __romanSuppressed: maybe.suppressed
        });
      }
    }

    applySustainCarryToBeats(beats, sustainPolicy);

    applyCadential64LabelingBeatwise(beats, key, warnings);
    trackSecondaryResolutionsBeatwise(beats, key, warnings);

    const measureSnapshots = buildMeasureSnapshotsFromBeats(beats, measureCount);
    const cadences = detectCadences(measureSnapshots as any);

    return {
      ok: true,
      engine: {
        phase: "4.2",
        granularity: "beat",
        romanNumerals: true,
        tonicizations: "brief",
        sustainPolicy,
        romanMinConfidence,
        suppressLowConfidenceRoman
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