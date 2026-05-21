// src/server.ts
import http from "node:http";
import process from "node:process";
import type net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
// pdf-parse is CJS; use createRequire so it works under both tsx (ESM loader) and tsc (CJS output).
// Calling require() (not dynamic import) ensures module.parent is set, avoiding pdf-parse's debug mode.
const _cjsRequire = createRequire(path.resolve("package.json"));
const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> = _cjsRequire("pdf-parse");
import { parseMusicXMLToScoreModel } from "./parsers/musicxmlParser";

// v2 harmony
import { analyzeHarmony } from "./harmony";

// v1 legacy harmony
import { analyzeHarmonyPerMeasure, attachHarmonyToScore } from "./_legacy/analyze/harmonyAnalyzer";

// SATB harmonizer (new)
import { harmonizeSatbFromChords } from "./harmonize/satb/harmonizeSatbFromChords";
import { inferChordsFromMelody } from "./harmonize/satb/inferChordsFromMelody";
import { parseChordSymbol } from "./harmonize/satb/chordSymbol";
// Melody-only harmonizer
import { harmonizeMelody, extractMelodyFromScore } from "./harmonize/melodic/melodyHarmonizer";
import { pitchToMidi } from "./instruments/instrumentCatalog";
import type { HarmonizeSatbFromChordsRequest } from "./harmonize/satb/harmonizeTypes";
import { applyAppSettings, type AppSettings } from "./app/applyAppSettings";
import { checkChoralRules } from "./rules/choral/checkChoralRules";

import { pipelineMusicxmlToArrangedMusicxml } from "./pipeline/pipelineMusicxmlToArrangedMusicxml";
import { exportScoreModelToMusicXML } from "./exporters/musicxmlExporter";
import { exportSatbScoreModelToMusicXML } from "./exporters/satbMusicxmlExporter";
import { extractChordEventsFromMusicXml } from "./extract/chordEventsFromMusicXml";
import { chordTextToMusicxml } from "./utils/chordTextToMusicxml";

type Json = Record<string, unknown>;

type ChordEvent = { measure: number; t: number; symbol: string };

// ── MusicXML validation ────────────────────────────────────────────────────
function validateMusicXml(xml: string): { ok: true } | { ok: false; error: string } {
  if (!xml || typeof xml !== "string") return { ok: false, error: "No MusicXML content provided." };
  const trimmed = xml.trimStart();
  if (!trimmed.startsWith("<?xml") && !trimmed.startsWith("<score")) {
    return { ok: false, error: "File does not appear to be an XML document." };
  }
  if (!/<score-partwise|<score-timewise/i.test(xml)) {
    return {
      ok: false,
      error: "File is not a valid MusicXML document — missing <score-partwise> or <score-timewise> root element."
    };
  }
  if (!/<part[\s>]/i.test(xml)) {
    return { ok: false, error: "MusicXML file contains no parts. Please upload a score with at least one instrument." };
  }
  if (!/<measure[\s>]/i.test(xml)) {
    return { ok: false, error: "MusicXML file contains no measures. The score appears to be empty." };
  }
  return { ok: true };
}

function chordPcsFromSymbolLoose(symbol: string): number[] | null {
  const raw = String(symbol || "").trim();
  if (!raw) return null;
  const main = raw.split("/")[0] ?? raw;
  const parsed = parseChordSymbol(String(main));
  if (!parsed) return null;
  return parsed.pcs ?? null;
}

function extractSonorityPcs(score: any, measureNumber: number, t: number): number[] {
  const out: number[] = [];
  const parts = score?.parts ?? [];
  for (const part of parts) {
    const measures = part?.measures ?? [];
    const measure = measures.find((m: any) => Number(m?.number) === Number(measureNumber));
    if (!measure) continue;
    const events = Array.isArray(measure?.events) ? measure.events : [];
    let note: any | null = null;
    for (const e of events) {
      if (e?.type !== "note") continue;
      const et = Number(e?.t);
      const ed = Number(e?.dur);
      if (!Number.isFinite(et) || !Number.isFinite(ed)) continue;
      if (et <= t && t < et + ed) {
        note = e;
        break;
      }
    }
    if (!note) {
      note = events.find((e: any) => e?.type === "note" && Number(e?.t) === t) ?? null;
    }
    if (!note) continue;
    const midi =
      typeof note?.midi === "number"
        ? Number(note.midi)
        : note?.pitch
          ? pitchToMidi(note.pitch)
          : null;
    if (typeof midi === "number" && Number.isFinite(midi)) {
      out.push(((midi % 12) + 12) % 12);
    }
  }
  return Array.from(new Set(out));
}

function pitchNameFromPitch(pitch: any): string | null {
  if (!pitch?.step) return null;
  const step = String(pitch.step).toUpperCase();
  const alter = Number.isFinite(pitch.alter) ? Number(pitch.alter) : 0;
  if (alter === 1) return `${step}#`;
  if (alter === -1) return `${step}b`;
  if (alter === 2) return `${step}##`;
  if (alter === -2) return `${step}bb`;
  return step;
}

function findBassPitchAt(score: any, measureNumber: number, t: number): any | null {
  const parts = score?.parts ?? [];
  const pianoPart =
    parts.find((p: any) => String(p?.part_id ?? "").toLowerCase() === "p_pno") ??
    parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("piano")) ??
    null;

  const pickLowestPitchAtTime = (events: any[]): any | null => {
    let best: any | null = null;
    let bestMidi: number | null = null;
    for (const e of events) {
      if (e?.type !== "note") continue;
      const et = Number(e?.t);
      const ed = Number(e?.dur);
      if (!Number.isFinite(et) || !Number.isFinite(ed)) continue;
      if (!(et <= t && t < et + ed)) continue;
      const midi =
        typeof e?.midi === "number"
          ? Number(e.midi)
          : e?.pitch
            ? pitchToMidi(e.pitch)
            : null;
      if (typeof midi !== "number" || !Number.isFinite(midi)) continue;
      if (bestMidi === null || midi < bestMidi) {
        bestMidi = midi;
        best = e;
      }
    }
    return best?.pitch ?? null;
  };

  if (pianoPart) {
    const measures = pianoPart?.measures ?? [];
    const measure = measures.find((m: any) => Number(m?.number) === Number(measureNumber));
    if (!measure) return null;
    const events = Array.isArray(measure?.events) ? measure.events : [];
    const staff2 = events.filter((e: any) => Number(e?.staff) === 2);
    const pitch = pickLowestPitchAtTime(staff2);
    if (pitch) return pitch;
  }

  let bassPart =
    parts.find((p: any) => String(p?.part_id ?? "").toLowerCase() === "p_b") ??
    parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("bass")) ??
    parts[parts.length - 1];

  if (!bassPart) return null;
  const measures = bassPart?.measures ?? [];
  const measure = measures.find((m: any) => Number(m?.number) === Number(measureNumber));
  if (!measure) return null;
  const events = Array.isArray(measure?.events) ? measure.events : [];

  let note: any | null = null;
  for (const e of events) {
    if (e?.type !== "note") continue;
    const et = Number(e?.t);
    const ed = Number(e?.dur);
    if (!Number.isFinite(et) || !Number.isFinite(ed)) continue;
    if (et <= t && t < et + ed) {
      note = e;
      break;
    }
  }
  if (!note) {
    note = events.find((e: any) => e?.type === "note" && Number(e?.t) === t) ?? null;
  }
  return note?.pitch ?? null;
}

function parseChordRootAndBass(symbolRaw: string): { root: string; bass: string } | null {
  const s = String(symbolRaw ?? "").trim();
  if (!s) return null;
  const parts = s.split("/");
  const rootPart = String(parts[0] ?? "").trim();
  const bassPart = String(parts[1] ?? "").trim();
  const rootMatch = rootPart.match(/^([A-Ga-g])([#b]?)/);
  if (!rootMatch) return null;
  const root = `${rootMatch[1]!.toUpperCase()}${rootMatch[2] ?? ""}`;
  if (!bassPart) return { root, bass: root };
  const bassMatch = bassPart.match(/^([A-Ga-g])([#b]?)/);
  if (!bassMatch) return { root, bass: root };
  const bass = `${bassMatch[1]!.toUpperCase()}${bassMatch[2] ?? ""}`;
  return { root, bass };
}

function voiceKeyFromPart(part: any, index: number): string {
  const name = String(part?.name ?? part?.part_name ?? "").toLowerCase();
  if (name.includes("soprano")) return "soprano";
  if (name.includes("alto")) return "alto";
  if (name.includes("tenor")) return "tenor";
  if (name.includes("bass")) return "bass";
  return `part${index + 1}`;
}

function computeRhythmDensity(score: any) {
  const voices: Record<
    string,
    {
      avgNotesPerMeasure: number;
      totalNotes: number;
      measures: Array<{ measure: number; notes: number }>;
    }
  > = {};
  const parts = Array.isArray(score?.parts) ? score.parts : [];
  parts.forEach((part, index) => {
    const key = voiceKeyFromPart(part, index);
    const measures = Array.isArray(part?.measures) ? part.measures : [];
    const measureData = measures.map((m: any, i: number) => {
      const evs = Array.isArray(m?.events) ? m.events : [];
      const notes = evs.filter((e: any) => e?.type === "note").length;
      const measureNum = Number(m?.number) || i + 1;
      return { measure: measureNum, notes };
    });
    const totalNotes = measureData.reduce((sum, m) => sum + m.notes, 0);
    const avgNotesPerMeasure = measureData.length ? totalNotes / measureData.length : 0;
    voices[key] = { avgNotesPerMeasure, totalNotes, measures: measureData };
  });
  return { voices };
}

const PC_BY_NAME: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11
};

function buildChordDebug(
  score: any,
  chords: ChordEvent[],
  inputChordWarnings: string[],
  options?: { pianoMode?: boolean }
) {
  const pianoMode = options?.pianoMode === true;
  const warnings: string[] = [];
  const byMeasure = new Map<number, ChordEvent[]>();
  for (const c of chords) {
    const measure = Number(c.measure);
    const t = typeof c.t === "number" ? c.t : 0;
    if (!Number.isFinite(measure)) continue;
    const list = byMeasure.get(measure) ?? [];
    list.push({ measure, t, symbol: String(c.symbol ?? "") });
    byMeasure.set(measure, list);
  }
  for (const list of byMeasure.values()) {
    list.sort((a, b) => Number(a.t) - Number(b.t));
  }

  const mismatches: Array<{ measure: number; chord: string; chordPcs: number[]; outputPcs: number[] }> = [];
  const eventMismatches: Array<{
    measure: number;
    t: number;
    chord: string;
    chordPcs: number[];
    outputPcs: number[];
    extraPcs: number[];
  }> = [];
  const spellingSample: Array<{
    measure: number;
    t: number;
    chord: string;
    expectedBass: string | null;
    actualBass: string | null;
  }> = [];
  const spellingMismatches: Array<{
    measure: number;
    t: number;
    chord: string;
    expectedBass: string;
    actualBass: string;
  }> = [];
  const eventBassMismatches: Array<{
    measure: number;
    t: number;
    chord: string;
    expectedBass: string;
    actualBass: string | null;
  }> = [];

  if (!pianoMode) {
    for (const [measure, list] of byMeasure.entries()) {
      if (!list.length) continue;
      const chord = list[0]!;
      const chordPcs = chordPcsFromSymbolLoose(chord.symbol);
      if (!chordPcs) {
        warnings.push(`[chord-check] Could not parse chord symbol "${chord.symbol}" at measure ${measure}.`);
        continue;
      }
      const outputPcs = extractSonorityPcs(score, measure, 0);
      if (!outputPcs.length) continue;
      const bad = outputPcs.filter((pc) => !chordPcs.includes(pc));
      if (bad.length) {
        mismatches.push({ measure, chord: chord.symbol, chordPcs, outputPcs });
      }
    }
  }

  const chordEventsSorted = chords
    .map((c) => ({ measure: Number(c.measure), t: Number(c.t ?? 0), symbol: String(c.symbol ?? "") }))
    .filter((c) => Number.isFinite(c.measure) && Number.isFinite(c.t))
    .sort((a, b) => (a.measure - b.measure) || (a.t - b.t));

  for (const c of chordEventsSorted) {
    const parsed = parseChordRootAndBass(c.symbol);
    const chordPcs = chordPcsFromSymbolLoose(c.symbol);
    if (chordPcs) {
      if (!pianoMode) {
        const outputPcs = extractSonorityPcs(score, c.measure, c.t);
        if (outputPcs.length) {
          const extraPcs = outputPcs.filter((pc) => !chordPcs.includes(pc));
          if (extraPcs.length) {
            eventMismatches.push({
              measure: c.measure,
              t: c.t,
              chord: c.symbol,
              chordPcs,
              outputPcs,
              extraPcs
            });
          }
        }
      }
    } else {
      warnings.push(`[chord-check] Could not parse chord symbol "${c.symbol}" at m${c.measure} t=${c.t}.`);
    }
    if (!parsed) continue;
    const expectedBass = parsed.bass;
    const expectedPc = PC_BY_NAME[expectedBass];
    const pitch = findBassPitchAt(score, c.measure, c.t);
    const actualBass = pitchNameFromPitch(pitch);
    if (spellingSample.length < 20) {
      spellingSample.push({
        measure: c.measure,
        t: c.t,
        chord: c.symbol,
        expectedBass,
        actualBass: actualBass ?? null
      });
    }
    if (typeof expectedPc !== "number") continue;
    if (!actualBass) {
      eventBassMismatches.push({
        measure: c.measure,
        t: c.t,
        chord: c.symbol,
        expectedBass,
        actualBass: null
      });
      continue;
    }
    const actualPc = pitch ? ((pitchToMidi(pitch) % 12) + 12) % 12 : null;
    if (actualPc === null || actualPc !== expectedPc) {
      eventBassMismatches.push({
        measure: c.measure,
        t: c.t,
        chord: c.symbol,
        expectedBass,
        actualBass
      });
      continue;
    }
    if (expectedBass !== actualBass && (expectedBass.includes("b") || expectedBass.includes("#"))) {
      spellingMismatches.push({
        measure: c.measure,
        t: c.t,
        chord: c.symbol,
        expectedBass,
        actualBass
      });
    }
  }

  if (inputChordWarnings?.length) warnings.push(...inputChordWarnings);
  if (mismatches.length) {
    warnings.push(`[chord-check] ${mismatches.length} measure(s) do not match chord tones at t=0.`);
  }
  if (eventBassMismatches.length) {
    warnings.push(`[chord-check] ${eventBassMismatches.length} chord event(s) have bass pitch mismatches.`);
  }
  if (spellingMismatches.length) {
    warnings.push(`[chord-check] ${spellingMismatches.length} chord event(s) have bass spelling mismatches.`);
  }
  if (eventMismatches.length) {
    warnings.push(`[chord-check] ${eventMismatches.length} chord event(s) include non-chord tones at their onset.`);
  }

  return {
    chordEventCount: chords.length,
    chordEventSample: chords.slice(0, 20),
    chordWarnings: inputChordWarnings.length ? inputChordWarnings : undefined,
    chordCheck: {
      measuresChecked: byMeasure.size,
      mismatches,
      eventMismatches: eventMismatches.slice(0, 50),
      eventBassMismatches,
      spellingMismatches,
      spellingSample
    },
    warnings
  };
}

function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += String(chunk)));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function isObject(x: unknown): x is Json {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function asArray(x: unknown): any[] | null {
  if (!Array.isArray(x)) return null;
  return x;
}

function normalizeHarmonizeReturn(x: any): any {
  // Accept both:
  // - { ok: true, scoreModel }
  // - scoreModel directly
  if (x && typeof x === "object" && "scoreModel" in x) return (x as any).scoreModel;
  return x;
}

/**
 * Given raw text extracted from a PDF chord chart, detects chord symbol lines
 * (lines where most tokens are valid chord symbols) and returns them joined
 * with " | " bar separators as a single chord string ready for the engine.
 *
 * Returns null if no chords are found.
 */
/**
 * Strict regex for a chord symbol token.
 * Covers: root (A-G + optional #/b), optional quality suffix (m/min/maj/dim/aug/sus2/sus4/
 * ø/°/M/△), optional extension digits (7/9/11/13), optional alteration (#/b + digit),
 * and optional slash bass note (/[A-G][#b]?).
 *
 * Deliberately rejects plain English words that happen to start with A-G.
 */
const CHORD_TOKEN_RE =
  /^[A-G][#b]?(m(?:aj|in|M)?|dim|aug|sus[24]?|[øØ°△ΔM^])?(\d{1,2}([#b]\d{1,2})?)?(\s*\/\s*[A-G][#b]?)?$/;

function isStrictChordToken(token: string): boolean {
  // Must start with uppercase A-G and be short (longest realistic: Cmaj13/Gb = 9 chars)
  if (!/^[A-G]/.test(token) || token.length > 12) return false;
  return CHORD_TOKEN_RE.test(token) && parseChordSymbol(token) !== null;
}

function extractChordsFromPdfText(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const chordLines: string[] = [];

  for (const line of lines) {
    // Strip leading/trailing whitespace and common non-chord punctuation
    const cleaned = line.replace(/[|:,;.!?(){}\[\]"']/g, " ").trim();
    if (!cleaned) continue;

    // Tokenize by whitespace
    const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) continue;

    // Count how many tokens are strict chord symbols
    const validChords = tokens.filter(isStrictChordToken);
    const ratio = validChords.length / tokens.length;

    // A chord line: at least 2 chords (or 1 if the line has ≤ 2 tokens),
    // and ≥ 60% of tokens are chords
    const minChords = tokens.length <= 2 ? 1 : 2;
    if (validChords.length >= minChords && ratio >= 0.6) {
      chordLines.push(validChords.join(" "));
    }
  }

  if (chordLines.length === 0) return null;

  // Join chord lines with " | " so each line becomes a "measure group"
  return chordLines.join(" | ");
}

function normalizeAppSettings(raw: unknown): AppSettings {
  if (!isObject(raw)) return {};
  const anyRaw = raw as Record<string, unknown>;
  const keyFifths = typeof anyRaw.keyFifths === "number" ? anyRaw.keyFifths : undefined;
  const accompanimentType =
    typeof anyRaw.accompanimentType === "string"
      ? anyRaw.accompanimentType
      : typeof anyRaw.accompaniment === "string"
        ? anyRaw.accompaniment
        : undefined;
  const keySignatureMode =
    anyRaw.keySignatureMode === "original" || anyRaw.keySignatureMode === "manual"
      ? (anyRaw.keySignatureMode as AppSettings["keySignatureMode"])
      : undefined;
  const timeSignatureMode =
    anyRaw.timeSignatureMode === "original" || anyRaw.timeSignatureMode === "manual"
      ? (anyRaw.timeSignatureMode as AppSettings["timeSignatureMode"])
      : undefined;

  return {
    title: typeof anyRaw.title === "string" ? anyRaw.title : undefined,
    ensemble: typeof anyRaw.ensemble === "string" ? anyRaw.ensemble : undefined,
    keySignature: typeof anyRaw.keySignature === "string" ? anyRaw.keySignature : undefined,
    keyFifths,
    keySignatureMode,
    targetKey: typeof anyRaw.targetKey === "string" ? anyRaw.targetKey : undefined,
    timeSignature: typeof anyRaw.timeSignature === "string" ? anyRaw.timeSignature : undefined,
    timeSignatureMode,
    tempo: typeof anyRaw.tempo === "number" ? anyRaw.tempo : undefined,
    style: typeof anyRaw.style === "string" ? anyRaw.style : undefined,
    level: typeof anyRaw.level === "string" ? (anyRaw.level as AppSettings["level"]) : undefined,
    accompanimentType,
    accompaniment: typeof anyRaw.accompaniment === "string" ? anyRaw.accompaniment : undefined,
    ruleStrictness:
      anyRaw.ruleStrictness === "relaxed" || anyRaw.ruleStrictness === "standard" || anyRaw.ruleStrictness === "strict"
        ? (anyRaw.ruleStrictness as AppSettings["ruleStrictness"])
        : undefined,
    textureMode: typeof anyRaw.textureMode === "string" ? anyRaw.textureMode : undefined,
    styleProfile: typeof anyRaw.styleProfile === "string" ? anyRaw.styleProfile : undefined,
    modernMode: typeof anyRaw.modernMode === "string" ? anyRaw.modernMode : undefined,
    bassActivity:
      anyRaw.bassActivity === "grounded" ||
      anyRaw.bassActivity === "less_active" ||
      anyRaw.bassActivity === "active" ||
      anyRaw.bassActivity === "high_active"
        ? (anyRaw.bassActivity as AppSettings["bassActivity"])
        : undefined,
    tenorActivity:
      anyRaw.tenorActivity === "grounded" ||
      anyRaw.tenorActivity === "less_active" ||
      anyRaw.tenorActivity === "active" ||
      anyRaw.tenorActivity === "high_active"
        ? (anyRaw.tenorActivity as AppSettings["tenorActivity"])
        : undefined,
    altoActivity:
      anyRaw.altoActivity === "grounded" ||
      anyRaw.altoActivity === "less_active" ||
      anyRaw.altoActivity === "active" ||
      anyRaw.altoActivity === "high_active"
        ? (anyRaw.altoActivity as AppSettings["altoActivity"])
        : undefined,
    sopranoActivity:
      anyRaw.sopranoActivity === "grounded" ||
      anyRaw.sopranoActivity === "less_active" ||
      anyRaw.sopranoActivity === "active" ||
      anyRaw.sopranoActivity === "high_active"
        ? (anyRaw.sopranoActivity as AppSettings["sopranoActivity"])
        : undefined,
    vln1Activity:
      anyRaw.vln1Activity === "grounded" ||
      anyRaw.vln1Activity === "less_active" ||
      anyRaw.vln1Activity === "active" ||
      anyRaw.vln1Activity === "high_active"
        ? (anyRaw.vln1Activity as AppSettings["vln1Activity"])
        : undefined,
    vln2Activity:
      anyRaw.vln2Activity === "grounded" ||
      anyRaw.vln2Activity === "less_active" ||
      anyRaw.vln2Activity === "active" ||
      anyRaw.vln2Activity === "high_active"
        ? (anyRaw.vln2Activity as AppSettings["vln2Activity"])
        : undefined,
    vlaActivity:
      anyRaw.vlaActivity === "grounded" ||
      anyRaw.vlaActivity === "less_active" ||
      anyRaw.vlaActivity === "active" ||
      anyRaw.vlaActivity === "high_active"
        ? (anyRaw.vlaActivity as AppSettings["vlaActivity"])
        : undefined,
    vcActivity:
      anyRaw.vcActivity === "grounded" ||
      anyRaw.vcActivity === "less_active" ||
      anyRaw.vcActivity === "active" ||
      anyRaw.vcActivity === "high_active"
        ? (anyRaw.vcActivity as AppSettings["vcActivity"])
        : undefined,
    cbActivity:
      anyRaw.cbActivity === "grounded" ||
      anyRaw.cbActivity === "less_active" ||
      anyRaw.cbActivity === "active" ||
      anyRaw.cbActivity === "high_active"
        ? (anyRaw.cbActivity as AppSettings["cbActivity"])
        : undefined,
    instrumentation:
      anyRaw.instrumentation === "auto" ||
      anyRaw.instrumentation === "piano_copy_to_string_quartet" ||
      anyRaw.instrumentation === "satb_to_string_quartet" ||
      anyRaw.instrumentation === "piano_copy_to_woodwind_quartet" ||
      anyRaw.instrumentation === "satb_to_woodwind_quartet"
        ? (anyRaw.instrumentation as AppSettings["instrumentation"])
        : undefined,
    sopranoMelodyShare:
      typeof anyRaw.sopranoMelodyShare === "number" && Number.isFinite(anyRaw.sopranoMelodyShare)
        ? anyRaw.sopranoMelodyShare
        : undefined,
    randomizeOffsets: typeof anyRaw.randomizeOffsets === "boolean" ? anyRaw.randomizeOffsets : undefined,
    pianoStylePreset: typeof anyRaw.pianoStylePreset === "string" ? anyRaw.pianoStylePreset : undefined,
    pianoStylePresetPath: typeof anyRaw.pianoStylePresetPath === "string" ? anyRaw.pianoStylePresetPath : undefined,
    useStringEnsembleArranger: typeof anyRaw.useStringEnsembleArranger === "boolean" ? anyRaw.useStringEnsembleArranger : undefined,
    lhPattern: typeof anyRaw.lhPattern === "string" ? anyRaw.lhPattern : undefined,
    suzukiVolume:
      typeof anyRaw.suzukiVolume === "number" && Number.isInteger(anyRaw.suzukiVolume) && anyRaw.suzukiVolume >= 1
        ? (anyRaw.suzukiVolume as number)
        : typeof anyRaw.suzukiVolume === "string" && /^\d+$/.test(anyRaw.suzukiVolume)
          ? parseInt(anyRaw.suzukiVolume, 10)
          : undefined,
  };
}

// ── Simple in-memory rate limiter ────────────────────────────────────────────
// Heavy arrangement endpoints: max 12 requests per IP per 60 seconds.
// Lightweight (health, static assets) are not counted.
const RATE_WINDOW_MS   = 60_000;
const RATE_MAX_HEAVY   = 12;
const HEAVY_ENDPOINTS  = new Set(["/generate", "/generate_from_chords", "/arrange_musicxml"]);
const rateBuckets      = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, url: string): boolean {
  if (!HEAVY_ENDPOINTS.has(url)) return true; // not a heavy endpoint, always allow
  const now  = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_MAX_HEAVY;
}

// Prune stale buckets every minute so the map doesn't grow unboundedly
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (now > b.resetAt) rateBuckets.delete(ip);
  }
}, RATE_WINDOW_MS);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    const url = req.url ?? "/";
    const ip  = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
                ?? (req.socket as net.Socket).remoteAddress
                ?? "unknown";

    if (!checkRateLimit(ip, url)) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
      res.end(JSON.stringify({ ok: false, error: "Too many requests. Please wait a minute and try again." }));
      return;
    }

    // Health can be GET or POST
    if (url === "/health" && (req.method === "GET" || req.method === "POST")) {
      sendJson(res, 200, { ok: true, name: "music-engine", status: "up", deploy: "2026-05-21-v8" });
      return;
    }

    // ── Static file serving for GET requests (production web app) ────────────
    if (req.method === "GET") {
      const publicDir = path.join(process.cwd(), "public");
      if (fs.existsSync(publicDir)) {
        const ext = path.extname(url);
        const MIME: Record<string, string> = {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
          ".woff2": "font/woff2",
          ".woff": "font/woff",
        };
        const filePath = ext
          ? path.join(publicDir, url)
          : path.join(publicDir, "index.html");
        if (fs.existsSync(filePath)) {
          const mime = ext ? (MIME[ext] ?? "application/octet-stream") : "text/html";
          res.writeHead(200, { "Content-Type": mime });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        // SPA fallback — serve index.html for any unknown path
        const indexPath = path.join(publicDir, "index.html");
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, { "Content-Type": "text/html" });
          fs.createReadStream(indexPath).pipe(res);
          return;
        }
      }
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    if (!isObject(body)) {
      sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }

    // ----------------------------
    // v1 analyze harmony (legacy)
    // ----------------------------
    if (url === "/analyze_harmony_v1") {
      const musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
      const scoreModel = body.scoreModel ?? null;

      let score: any = null;
      if (scoreModel) score = scoreModel;
      if (!score && musicxml) score = parseMusicXMLToScoreModel(musicxml);

      if (!score) {
        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
        return;
      }

      const out = analyzeHarmonyPerMeasure(score);
      sendJson(res, 200, out);
      return;
    }

    if (url === "/attach_harmony_v1") {
      const musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
      const scoreModel = body.scoreModel ?? null;

      let score: any = null;
      if (scoreModel) score = scoreModel;
      if (!score && musicxml) score = parseMusicXMLToScoreModel(musicxml);

      if (!score) {
        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
        return;
      }

      const out = attachHarmonyToScore(score);
      sendJson(res, 200, { ok: true, scoreModel: out });
      return;
    }

    // ----------------------------
    // v2 analyze harmony
    // ----------------------------
    if (url === "/analyze_harmony") {
      const musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
      const scoreModel = body.scoreModel ?? null;

      let score: any = null;
      if (scoreModel) score = scoreModel;
      if (!score && musicxml) score = parseMusicXMLToScoreModel(musicxml);

      if (!score) {
        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
        return;
      }

      const options = isObject(body.options) ? body.options : {};
      const out = analyzeHarmony({ scoreModel: score, options } as any);

      sendJson(res, 200, out);
      return;
    }

    if (url === "/attach_harmony") {
      const musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
      const scoreModel = body.scoreModel ?? null;

      let score: any = null;
      if (scoreModel) score = scoreModel;
      if (!score && musicxml) score = parseMusicXMLToScoreModel(musicxml);

      if (!score) {
        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
        return;
      }

      const options = isObject(body.options) ? body.options : {};
      const out = analyzeHarmony({ scoreModel: score, options } as any);

      const meta = {
        ...(score.meta ?? {}),
        ensemble: (score.meta as any)?.ensemble ?? "unknown",
        harmony: out
      };

      sendJson(res, 200, { ok: true, scoreModel: { ...score, meta } });
      return;
    }

    // ----------------------------
    // SATB harmonize from chords (new)
    // ----------------------------
    if (url === "/harmonize_satb_from_chords") {
      const reqBody = body as unknown as HarmonizeSatbFromChordsRequest;

      let musicxml = typeof (reqBody as any).musicxml === "string" ? (reqBody as any).musicxml : null;
      const scoreModel = (reqBody as any).scoreModel ?? null;
      const settings = normalizeAppSettings((reqBody as any).settings);
      const filePath = typeof (reqBody as any).filePath === "string" ? (reqBody as any).filePath : null;

      // Accept chords as an array (can be empty). Empty triggers melody-based inference downstream.
      const chords = asArray((reqBody as any).chords);
      if (!chords) {
        sendJson(res, 400, { ok: false, error: "Provide 'chords' as an array (can be empty)." });
        return;
      }

      const options = isObject((reqBody as any).options) ? ((reqBody as any).options as any) : {};
      const accompaniment =
        settings.accompanimentType ?? settings.accompaniment ?? (reqBody as any).accompaniment ?? "";
      const accompanimentLower = String(accompaniment).toLowerCase();
      const wantsStrings =
        String(settings.ensemble ?? "").toLowerCase() === "string_ensemble" ||
        String(settings.ensemble ?? "").toLowerCase() === "strings";
      const wantsWoodwinds =
        String(settings.ensemble ?? "").toLowerCase() === "woodwind_ensemble" ||
        String(settings.ensemble ?? "").toLowerCase() === "woodwinds";
      const wantsBrass =
        String(settings.ensemble ?? "").toLowerCase() === "brass_ensemble" ||
        String(settings.ensemble ?? "").toLowerCase() === "brass";
      const wantsDirectSourceArrangement = wantsStrings || wantsWoodwinds || wantsBrass;
      if (wantsDirectSourceArrangement && !musicxml && filePath) {
        try {
          musicxml = fs.readFileSync(filePath, "utf8");
        } catch {
          // ignore, fallback to scoreModel if provided
        }
      }
      const textureMode = String(settings.textureMode ?? "").toLowerCase();
      if (textureMode === "polyphony") {
        options.accompanimentType = "polyphonic";
      } else if (textureMode === "homophony_homorhythmic" || textureMode === "homophony_melody_accompaniment") {
        options.accompanimentType = "homophonic";
      }
      if (!options.accompanimentType && accompanimentLower) {
        options.accompanimentType = accompanimentLower;
      }
      if (!options.styleProfile && typeof settings.styleProfile === "string") {
        options.styleProfile = settings.styleProfile;
      }
      if (!options.modernMode && typeof settings.modernMode === "string") {
        options.modernMode = settings.modernMode;
      }
      if (String(settings.level ?? "").toLowerCase() === "advanced") {
        options.tenorMinOverride = 50; // D3
      }

      let score: any = null;
      if (wantsDirectSourceArrangement && musicxml) {
        score = parseMusicXMLToScoreModel(musicxml);
      } else {
        if (scoreModel) score = scoreModel;
        if (!score && musicxml) score = parseMusicXMLToScoreModel(musicxml);
      }

      if (!score) {
        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
        return;
      }
      if (accompanimentLower === "homophonic") {
        options.tenorRangeOverride = { min: 57, max: 62 }; // A3..D4
      }
      if (accompanimentLower === "polyphonic") {
        if (typeof options.styleProfile !== "string" || !options.styleProfile) {
          const style = String(settings.style ?? "").toLowerCase();
          if (style === "baroque")   options.styleProfile = "baroque";
          else if (style === "romantic") options.styleProfile = "romantic";
          else if (style === "modern")   options.styleProfile = "modern";
          else if (style === "classical" || style === "worship") options.styleProfile = "classical";
          else options.styleProfile = "classical"; // pop/funk/samba → classical voice-leading
        }
        if (String(options.styleProfile).toLowerCase() === "modern" && !options.modernMode) {
          options.modernMode = "modernTonal";
        }
      }

      const parsedChords = Array.isArray((score as any)?.meta?.inputChords) ? (score as any).meta.inputChords : [];
      const chordsToUse = chords.length ? chords : parsedChords;

      // Melody-only mode: use Krumhansl-Schmuckler key detection + scale-degree harmonizer
      // when no chords are supplied and settings.melodyOnly is enabled.
      const isMelodyOnly = (settings as any).melodyOnly === true;
      let melodyHarmonizationResult: ReturnType<typeof harmonizeMelody> | null = null;
      if (!chordsToUse.length && isMelodyOnly) {
        const melodyNotes = extractMelodyFromScore(score);
        if (melodyNotes.length) {
          melodyHarmonizationResult = harmonizeMelody(melodyNotes, {
            style: String(settings.style ?? "classical"),
          });
          // Patch detected key into settings so the arranger uses the right key
          if (melodyHarmonizationResult.key) {
            (settings as any).keyFifths = melodyHarmonizationResult.key.fifths;
            (settings as any).detectedKeyMode = melodyHarmonizationResult.key.mode;
          }
        }
      }

      const inferredIfEmpty = !chordsToUse.length
        ? (melodyHarmonizationResult?.chordEvents ?? inferChordsFromMelody(score as any))
        : [];
      const chordSource = chords.length
        ? "request"
        : parsedChords.length
          ? "musicxml_harmony"
          : melodyHarmonizationResult
            ? "melody_harmonized"
            : inferredIfEmpty.length
              ? "inferred"
              : "none";

      let normalized: any;
      if (wantsDirectSourceArrangement) {
        normalized = score;
      } else {
        // Support BOTH harmonizer call styles:
        // 1) harmonizeSatbFromChords(scoreModel, chords, options)
        // 2) harmonizeSatbFromChords({ scoreModel, chords, options })
        let outScore: any;
        try {
          // Try style (1) first
          outScore = (harmonizeSatbFromChords as any)(score, chordsToUse, options);
        } catch {
          // Fallback to style (2)
          outScore = (harmonizeSatbFromChords as any)({
            scoreModel: score,
            chords: chordsToUse,
            options
          });
        }
        normalized = normalizeHarmonizeReturn(outScore);
      }

      if (!normalized || typeof normalized !== "object") {
        sendJson(res, 500, { ok: false, error: "Harmonizer returned an invalid scoreModel." });
        return;
      }

      const inferredChords = Array.isArray((normalized as any)?.meta?.harmonize?.chords)
        ? ((normalized as any).meta.harmonize.chords as any[])
        : inferredIfEmpty;
      const chordsForApp = chordsToUse.length ? chordsToUse : inferredChords;

      const appResult = applyAppSettings(normalized, settings, chordsForApp as any);
      const scoreModelOut = appResult.scoreModel;
      const prevMeta = (scoreModelOut as any).meta ?? {};
      const inputChordWarnings = Array.isArray((score as any)?.meta?.inputChordWarnings)
        ? (score as any).meta.inputChordWarnings
        : [];
      const ensembleRaw = String(settings.ensemble ?? prevMeta.ensemble ?? "").toLowerCase();
      const isPiano =
        ensembleRaw === "piano" ||
        ensembleRaw === "piano_with_melody" ||
        ensembleRaw === "grand_piano" ||
        ensembleRaw === "acoustic_piano";
      const isStrings = ensembleRaw === "string_ensemble" || ensembleRaw === "strings";
      const isWoodwinds = ensembleRaw === "woodwind_ensemble" || ensembleRaw === "woodwinds";
      const isBrass = ensembleRaw === "brass_ensemble" || ensembleRaw === "brass";
      const chordDebug = buildChordDebug(scoreModelOut, chordsForApp as any, inputChordWarnings, { pianoMode: isPiano });
      let ruleCheck = { rulesVersion: "choral-v1", violations: [], warnings: [] as string[] };
      if (!isPiano && !isStrings && !isWoodwinds && !isBrass) {
        try {
          ruleCheck = checkChoralRules(scoreModelOut, chordsForApp as any, {
            strictness: settings.ruleStrictness,
            level: settings.level
          });
        } catch (err: any) {
          ruleCheck.warnings.push(`[rules] Rule check failed: ${err?.message ?? String(err)}`);
        }
      }

      const combinedWarnings = [
        ...(appResult.warnings ?? []),
        ...(chordDebug.warnings ?? []),
        ...(ruleCheck.warnings ?? [])
      ];
      const harmonizeDebug = (scoreModelOut as any)?.meta?.harmonize?.debug ?? {};
      const timeSig =
        settings.timeSignatureMode === "manual" ? settings.timeSignature : prevMeta.time_signature;
      const keySig =
        settings.keySignatureMode === "manual" ? settings.keySignature : prevMeta.key;

      const meta = {
        ...prevMeta,
        title: settings.title ?? prevMeta.title,
        ensemble: settings.ensemble ?? prevMeta.ensemble ?? "satb",
        key: keySig ?? prevMeta.key,
        time_signature: timeSig ?? prevMeta.time_signature,
        tempo_bpm: typeof settings.tempo === "number" ? settings.tempo : prevMeta.tempo_bpm,
        app: {
          settingsUsed: settings,
          detectedInputKeyFifths: appResult.detectedInputKeyFifths,
          detectedInputKeyMode: (score as any)?.meta?.inputKeyMode,
          appliedTransposeSemitones: appResult.appliedTransposeSemitones,
          exporterDivisions: 4,
          warnings: combinedWarnings,
          styleUsed: appResult.styleUsed,
          cadenceMeasures: appResult.cadenceMeasures,
          chordSource,
          debug: {
            melodyPartName: harmonizeDebug?.melodySource?.partName,
            melodyPartId: harmonizeDebug?.melodySource?.partId,
            melodyVoice: harmonizeDebug?.melodySource?.voice ?? null,
            melodyNoteCount: harmonizeDebug?.melodyNoteCount ?? null,
            chordEventCount: chordDebug.chordEventCount,
            chordEventSample: chordDebug.chordEventSample,
            chordWarnings: chordDebug.chordWarnings,
            chordCheck: chordDebug.chordCheck,
            ruleViolations: ruleCheck.violations,
            ruleWarnings: ruleCheck.warnings,
            rulesVersion: ruleCheck.rulesVersion,
            textureAnalysis: (scoreModelOut as any)?.meta?.textureAnalysis ?? null,
            rhythmDensity: computeRhythmDensity(scoreModelOut)
          }
        }
      };

      (scoreModelOut as any).meta = meta;

      sendJson(res, 200, { ok: true, scoreModel: scoreModelOut });
      return;
    }

    // ----------------------------
    // List parts from a MusicXML score
    // ----------------------------
    if (url === "/list_parts") {
      const musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
      if (!musicxml) {
        sendJson(res, 400, { ok: false, error: "Provide 'musicxml' as a string in the request body." });
        return;
      }
      const xmlValidation = validateMusicXml(musicxml);
      if (!xmlValidation.ok) {
        sendJson(res, 400, { ok: false, error: (xmlValidation as { ok: false; error: string }).error });
        return;
      }

      let score: any;
      try {
        score = parseMusicXMLToScoreModel(musicxml);
      } catch (e: any) {
        sendJson(res, 400, { ok: false, error: `Failed to parse MusicXML: ${e?.message ?? String(e)}` });
        return;
      }

      const parts = (score.parts ?? []).map((p: any) => {
        const notes = (p.measures ?? []).reduce((sum: number, m: any) => {
          return sum + (m.events ?? []).filter((e: any) => e.type === "note").length;
        }, 0);
        return {
          id:         String(p.part_id ?? ""),
          name:       String(p.name ?? ""),
          instrument: String(p.instrument ?? p.name ?? ""),
          staves:     Number(p.staves ?? 1),
          measures:   (p.measures ?? []).length,
          noteCount:  notes
        };
      });

      sendJson(res, 200, {
        ok: true,
        title: score.meta?.title ?? "",
        ensemble: score.meta?.ensemble ?? "",
        partCount: parts.length,
        parts
      });
      return;
    }

    // ----------------------------
    // Extract specific parts from a MusicXML score
    // ----------------------------
    if (url === "/extract_part") {
      const musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
      const partIds  = asArray(body.partIds)?.map(String) ?? [];
      if (!musicxml) {
        sendJson(res, 400, { ok: false, error: "Provide 'musicxml' as a string in the request body." });
        return;
      }
      if (!partIds.length) {
        sendJson(res, 400, { ok: false, error: "Provide 'partIds' as a non-empty array of part id strings." });
        return;
      }

      let score: any;
      try {
        score = parseMusicXMLToScoreModel(musicxml);
      } catch (e: any) {
        sendJson(res, 400, { ok: false, error: `Failed to parse MusicXML: ${e?.message ?? String(e)}` });
        return;
      }

      const filtered = (score.parts ?? []).filter((p: any) => partIds.includes(String(p.part_id ?? "")));
      if (!filtered.length) {
        sendJson(res, 400, {
          ok: false,
          error: `None of the requested partIds found. Available: ${(score.parts ?? []).map((p: any) => p.part_id).join(", ")}`
        });
        return;
      }

      const filteredScore = { ...score, parts: filtered };

      // Choose exporter: use general exporter if any part has grand staff, piano,
      // or double bass (which requires written-pitch transposition up one octave).
      const hasPianoOrBass = filtered.some((p: any) => {
        const s = `${p.instrument ?? ""} ${p.name ?? ""}`.toLowerCase();
        return s.includes("piano") || Number(p.staves) === 2 ||
          s.includes("double_bass") || s.includes("double bass") || s.includes("contrabass");
      });
      const outputXml = hasPianoOrBass
        ? exportScoreModelToMusicXML(filteredScore)
        : exportSatbScoreModelToMusicXML(filteredScore);

      sendJson(res, 200, {
        ok: true,
        musicxml: outputXml,
        scoreModel: filteredScore,
        extractedParts: filtered.map((p: any) => ({ id: p.part_id, name: p.name, instrument: p.instrument }))
      });
      return;
    }

    // --- full arrange pipeline ---
    if (url === "/arrange_musicxml" || url === "/generate") {
      const musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
      if (!musicxml) {
        sendJson(res, 400, { ok: false, error: "Provide 'musicxml' as a string in the request body." });
        return;
      }
      const xmlValidation = validateMusicXml(musicxml);
      if (!xmlValidation.ok) {
        sendJson(res, 400, { ok: false, error: (xmlValidation as { ok: false; error: string }).error });
        return;
      }
      const settings = normalizeAppSettings(isObject(body.settings) ? body.settings : {});
      const chords   = Array.isArray(body.chords) ? body.chords : undefined;
      const options  = isObject(body.options) ? (body.options as Record<string, unknown>) : {};
      // Optional: filter to specific parts before arranging
      const partIds  = asArray(body.partIds)?.map(String) ?? [];

      // If partIds provided, extract those parts first.
      // IMPORTANT: Re-exporting to MusicXML strips <harmony> tags, so we must extract
      // chord events from the ORIGINAL XML before re-exporting and pass them explicitly.
      let workingXml = musicxml;
      let chordsFromPartFilter: ChordEvent[] | undefined;
      if (partIds.length) {
        // Extract chord events from original before re-export strips <harmony> tags
        try {
          const { chords: origChords } = extractChordEventsFromMusicXml(musicxml);
          if (origChords.length) chordsFromPartFilter = origChords;
        } catch {
          // ignore — pipeline will fall back to inference
        }

        try {
          const score: any = parseMusicXMLToScoreModel(musicxml);
          const filtered = (score.parts ?? []).filter((p: any) => partIds.includes(String(p.part_id ?? "")));
          if (filtered.length) {
            const filteredScore = { ...score, parts: filtered };
            workingXml = exportSatbScoreModelToMusicXML(filteredScore);
          }
        } catch {
          // fall through — use original xml
        }
      }

      // Merge: explicit body chords take priority, then chords rescued from original XML
      const resolvedChords = chords ?? chordsFromPartFilter;

      const result = pipelineMusicxmlToArrangedMusicxml({ musicxml: workingXml, settings, chords: resolvedChords, options });

      if (!result.ok) {
        const errResult = result as import("./pipeline/pipelineMusicxmlToArrangedMusicxml").PipelineError;
        sendJson(res, 500, { ok: false, error: errResult.error, warnings: errResult.warnings });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        musicxml:   result.musicxml,
        scoreModel: result.scoreModel,
        warnings:   result.warnings,
        meta:       result.meta
      });
      return;
    }

    // ----------------------------
    // Generate arrangement from chord progression text
    // ----------------------------
    if (url === "/generate_from_chords") {
      const chordText = typeof body.chords === "string" ? body.chords.trim() : null;
      if (!chordText) {
        sendJson(res, 400, { ok: false, error: "Provide 'chords' as a string (e.g. \"C Am F G\")." });
        return;
      }
      const settings = normalizeAppSettings(isObject(body.settings) ? body.settings : {});
      const options  = isObject(body.options) ? (body.options as Record<string, unknown>) : {};

      const { musicxml: generatedXml, warnings: genWarnings, chords: parsedChords } = chordTextToMusicxml(chordText, {
        title: typeof settings.title === "string" && settings.title ? settings.title : "Chord Progression",
        beatsPerMeasure: 4,
      });

      if (!generatedXml) {
        sendJson(res, 400, { ok: false, error: genWarnings.join(" ") || "Could not parse chord progression." });
        return;
      }

      // Convert to server ChordEvent format for the pipeline
      const chordEvents = parsedChords.map((c) => ({
        measure: c.measure,
        t: c.beat,
        symbol: c.symbol,
      }));

      const result = pipelineMusicxmlToArrangedMusicxml({
        musicxml: generatedXml,
        settings,
        chords: chordEvents,
        options: { ...options, keepMelodyInSoprano: true },
      });

      if (!result.ok) {
        const errResult = result as import("./pipeline/pipelineMusicxmlToArrangedMusicxml").PipelineError;
        const allWarnings = [...genWarnings, ...errResult.warnings];
        sendJson(res, 500, { ok: false, error: errResult.error, warnings: allWarnings });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        musicxml:   result.musicxml,
        scoreModel: result.scoreModel,
        warnings:   [...genWarnings, ...result.warnings],
        meta:       result.meta
      });
      return;
    }

    // ── Parse PDF chord sheet ─────────────────────────────────────────────
    if (url === "/parse_pdf") {
      const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : null;
      if (!pdfBase64) {
        sendJson(res, 400, { ok: false, error: "Provide 'pdfBase64' as a base64-encoded PDF string." });
        return;
      }

      let pdfBuffer: Buffer;
      try {
        pdfBuffer = Buffer.from(pdfBase64, "base64");
      } catch {
        sendJson(res, 400, { ok: false, error: "Invalid base64 data." });
        return;
      }

      let rawText: string;
      try {
        const parsed = await pdfParse(pdfBuffer);
        rawText = parsed.text;
      } catch (err: any) {
        sendJson(res, 400, { ok: false, error: `Could not parse PDF: ${err?.message ?? "unknown error"}` });
        return;
      }

      const chords = extractChordsFromPdfText(rawText);
      if (!chords) {
        sendJson(res, 200, { ok: false, error: "No chord symbols found in the PDF. Make sure it contains a text-based chord chart (not a scanned image)." });
        return;
      }

      sendJson(res, 200, { ok: true, chords });
      return;
    }

    sendJson(res, 404, { ok: false, error: `Unknown route: ${url}` });
  } catch (e: any) {
    sendJson(res, 500, { ok: false, error: e?.message ?? String(e) });
  }
});

/**
 * Graceful shutdown for dev watcher:
 * - close HTTP server
 * - destroy keep-alive sockets
 * - then exit immediately so tsx watch doesn't force-kill
 */
const sockets = new Set<net.Socket>();

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  // eslint-disable-next-line no-console
  console.log(`[server] received ${signal}, shutting down...`);

  // Stop accepting new connections
  server.close((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("[server] error during server.close:", err);
      process.exit(1);
      return;
    }

    // eslint-disable-next-line no-console
    console.log("[server] http server closed");
    process.exit(0);
  });

  for (const s of sockets) {
    try {
      s.end();
      s.destroy();
    } catch {
      // ignore
    }
  }

  setTimeout(() => {
    process.exit(0);
  }, 250).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const PORT = Number(process.env.PORT ?? 3001);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`music-engine server listening on http://localhost:${PORT}`);
});
