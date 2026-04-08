// src/server.ts
import http from "node:http";
import process from "node:process";
import type net from "node:net";
import fs from "node:fs";
import { parseMusicXMLToScoreModel } from "./parsers/musicxmlParser";

// v2 harmony
import { analyzeHarmony } from "./harmony";

// v1 legacy harmony
import { analyzeHarmonyPerMeasure, attachHarmonyToScore } from "./_legacy/analyze/harmonyAnalyzer";

// SATB harmonizer (new)
import { harmonizeSatbFromChords } from "./harmonize/satb/harmonizeSatbFromChords";
import { inferChordsFromMelody } from "./harmonize/satb/inferChordsFromMelody";
import { parseChordSymbol } from "./harmonize/satb/chordSymbol";
import { pitchToMidi } from "./instruments/instrumentCatalog";
import type { HarmonizeSatbFromChordsRequest } from "./harmonize/satb/harmonizeTypes";
import { applyAppSettings, type AppSettings } from "./app/applyAppSettings";
import { checkChoralRules } from "./rules/choral/checkChoralRules";

// NOTE: arrange pipeline temporarily disabled because the referenced module path does not exist
// import { pipelineMusicxmlToArrangedMusicxml } from "./pipeline/pipelineMusicxmlToArrangedMusicxml";

type Json = Record<string, unknown>;

type ChordEvent = { measure: number; t: number; symbol: string };

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
    useStringEnsembleArranger: typeof anyRaw.useStringEnsembleArranger === "boolean" ? anyRaw.useStringEnsembleArranger : undefined
  };
}

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

    // Health can be GET or POST
    if (url === "/health" && (req.method === "GET" || req.method === "POST")) {
      sendJson(res, 200, { ok: true, name: "music-engine", status: "up" });
      return;
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
      const wantsDirectSourceArrangement = wantsStrings || wantsWoodwinds;
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
          if (style === "baroque") options.styleProfile = "baroque";
          else if (style === "romantic") options.styleProfile = "romantic";
          else if (style === "classical" || style === "worship") options.styleProfile = "classical";
          else options.styleProfile = "modern";
        }
        if (String(options.styleProfile).toLowerCase() === "modern" && !options.modernMode) {
          options.modernMode = "modernTonal";
        }
      }

      const parsedChords = Array.isArray((score as any)?.meta?.inputChords) ? (score as any).meta.inputChords : [];
      const chordsToUse = chords.length ? chords : parsedChords;
      const inferredIfEmpty = !chordsToUse.length ? inferChordsFromMelody(score as any) : [];
      const chordSource = chords.length
        ? "request"
        : parsedChords.length
          ? "musicxml_harmony"
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
      const chordDebug = buildChordDebug(scoreModelOut, chordsForApp as any, inputChordWarnings, { pianoMode: isPiano });
      let ruleCheck = { rulesVersion: "choral-v1", violations: [], warnings: [] as string[] };
      if (!isPiano && !isStrings && !isWoodwinds) {
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

    // --- arrange pipeline (temporarily disabled) ---
    if (url === "/arrange_musicxml") {
      sendJson(res, 501, {
        ok: false,
        error:
          "Route /arrange_musicxml is temporarily disabled because pipelineMusicxmlToArrangedMusicxml is not wired to a valid file path."
      });
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
