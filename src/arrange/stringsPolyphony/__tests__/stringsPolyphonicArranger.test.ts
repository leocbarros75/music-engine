import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";
import { loadCounterpointRules, scoreTransition } from "../counterpointScoring";
import { buildCandidateMap } from "../pathfinding";
import { captureMotif, scheduleImitation, motifMidiAtSlice } from "../motifs";
import { arrangeStringPolyphonic } from "../stringsPolyphonicArranger";
import { initRhythmState } from "../rhythmStratification";
import { pitchToMidi } from "../../../instruments/instrumentCatalog";
import type { ScoreModel } from "../../../score/types";
import type { MotifEntry, Slice, VoiceId, Voicing } from "../types";

type Fixture =
  | {
      type: "transition";
      name: string;
      isStrongBeat: boolean;
      prev: Voicing;
      next: Voicing;
      pendingRecovery?: Record<VoiceId, "up" | "down" | null>;
      pendingResolution?: string[];
      rhythmState?: { totalAttacks: number; perVoice: Record<VoiceId, number> };
      expectIds: string[];
    }
  | {
      type: "candidate";
      name: string;
      slice: Slice;
      prevVoicing: Voicing;
      keyFifths: number;
      keyMode: "major" | "minor";
      rhythmState: { totalAttacks: number; perVoice: Record<VoiceId, number> };
      expectVoice: VoiceId;
      expectMinMidi: number;
    }
  | {
      type: "imitation";
      name: string;
      keyFifths: number;
      keyMode: "major" | "minor";
      melody: Array<{ measure: number; t: number; dur: number; midi: number }>;
    }
  | {
      type: "arranger";
      name: string;
      divisions: number;
      keyFifths: number;
      keyMode: "major" | "minor";
      melody: Array<{ measure: number; t: number; dur: number; midi: number }>;
      chords: Array<{ measure: number; t: number; symbol: string }>;
      expectContraryMin: number;
    };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

function loadFixtures(): Fixture[] {
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(fixturesDir, f), "utf8")) as Fixture);
}

function buildScoreFromFixture(fx: Extract<Fixture, { type: "arranger" }>): ScoreModel {
  const measures: any[] = [];
  const measureCount = Math.max(...fx.melody.map((m) => m.measure));
  for (let i = 1; i <= measureCount; i++) {
    const events = fx.melody
      .filter((m) => m.measure === i)
      .map((m, idx) => ({
        id: `m${i}-${idx}`,
        t: m.t,
        dur: m.dur,
        type: "note",
        pitch: { step: "C", octave: 4 },
        midi: m.midi,
        voice: 1,
        staff: 1
      }));
    measures.push({
      number: i,
      attributes: {
        divisions: fx.divisions,
        key_fifths: fx.keyFifths,
        key_mode: fx.keyMode,
        time: { beats: 4, beat_type: 4 }
      },
      events
    });
  }

  return {
    score_id: "fixture",
    meta: { ensemble: "string_ensemble" },
    global: { divisions: fx.divisions },
    parts: [
      {
        part_id: "P1",
        name: "Melody",
        instrument: "voice",
        measures
      }
    ]
  };
}

function buildSlicesFromMelody(
  melody: Array<{ measure: number; t: number; dur: number; midi: number }>
): Slice[] {
  return melody.map((m, idx) => ({
    index: idx,
    measure: m.measure,
    t: m.t,
    dur: m.dur,
    melodyMidi: m.midi,
    chordSymbol: null,
    isStrongBeat: Math.abs(m.t - Math.round(m.t)) < 1e-6
  }));
}

function runTransitionFixture(fx: Extract<Fixture, { type: "transition" }>): void {
  const rules = loadCounterpointRules();
  const score = scoreTransition(
    fx.prev,
    fx.next,
    rules,
    fx.isStrongBeat,
    fx.rhythmState ?? initRhythmState(),
    fx.pendingRecovery ?? { vln1: null, vln2: null, vla: null, vc: null, cb: null },
    fx.pendingResolution ?? []
  );
  const ids = score.ruleHits.map((p) => p.id);
  for (const id of fx.expectIds) {
    assert(ids.includes(id), `${fx.name}: expected rule ${id} not found`);
  }
}

function runCandidateFixture(fx: Extract<Fixture, { type: "candidate" }>): void {
  const rules = loadCounterpointRules();
  const candidates = buildCandidateMap({
    slice: fx.slice,
    prevVoicing: fx.prevVoicing,
    keyFifths: fx.keyFifths,
    keyMode: fx.keyMode,
    motif: null,
    motifEntries: [],
    rules,
    rhythmState: fx.rhythmState
  });
  const list = candidates[fx.expectVoice] ?? [];
  const ok = list.some((m) => typeof m === "number" && m >= fx.expectMinMidi);
  assert(ok, `${fx.name}: expected ${fx.expectVoice} candidate >= ${fx.expectMinMidi}`);
}

function runImitationFixture(fx: Extract<Fixture, { type: "imitation" }>): void {
  const rules = loadCounterpointRules();
  const slices = buildSlicesFromMelody(fx.melody);
  const motif = captureMotif(slices);
  const motifEntries: MotifEntry[] = scheduleImitation(motif, rules.polyphony.imitation, slices);
  assert(motif, `${fx.name}: motif not captured`);
  assert(motifEntries.length > 0, `${fx.name}: no motif entries scheduled`);

  const entry = motifEntries[0]!;
  const targetSlice = slices[entry.startSlice]!;
  const expected = motifMidiAtSlice(motif!, entry, entry.startSlice);
  assert(typeof expected === "number", `${fx.name}: expected motif midi missing`);

  const candidates = buildCandidateMap({
    slice: targetSlice,
    prevVoicing: { vln1: null, vln2: null, vla: null, vc: null, cb: null },
    keyFifths: fx.keyFifths,
    keyMode: fx.keyMode,
    motif,
    motifEntries,
    rules,
    rhythmState: initRhythmState()
  });

  const list = candidates[entry.voice] ?? [];
  assert(list.includes(expected!), `${fx.name}: expected motif pitch not in candidates`);
}

function runArrangerFixture(fx: Extract<Fixture, { type: "arranger" }>): void {
  const score = buildScoreFromFixture(fx);
  const result = arrangeStringPolyphonic(score, fx.chords);
  const vln1 = result.scoreModel.parts.find((p: any) => p.name === "Violin I");
  const cb = result.scoreModel.parts.find((p: any) => p.name === "Double Bass");
  assert(vln1 && cb, `${fx.name}: missing parts`);

  const timeline = new Map<string, { vln1?: number; cb?: number }>();
  for (const part of [vln1, cb]) {
    for (const measure of part!.measures ?? []) {
      for (const ev of measure.events ?? []) {
        if (ev.type !== "note") continue;
        const key = `${measure.number}:${ev.t}`;
        const entry = timeline.get(key) ?? {};
        const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
        if (midi === null) continue;
        if (part!.name === "Violin I") entry.vln1 = midi;
        if (part!.name === "Double Bass") entry.cb = midi;
        timeline.set(key, entry);
      }
    }
  }

  const orderedKeys = Array.from(timeline.keys()).sort((a, b) => {
    const [am, at] = a.split(":").map(Number);
    const [bm, bt] = b.split(":").map(Number);
    if (am !== bm) return am - bm;
    return at - bt;
  });

  let contrary = 0;
  let prev: { vln1?: number; cb?: number } | null = null;
  for (const key of orderedKeys) {
    const cur = timeline.get(key)!;
    if (!cur.vln1 || !cur.cb) continue;
    if (prev && prev.vln1 !== undefined && prev.cb !== undefined) {
      const d1 = cur.vln1 - prev.vln1;
      const d2 = cur.cb - prev.cb;
      if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) contrary += 1;
    }
    prev = cur;
  }

  assert(
    contrary >= fx.expectContraryMin,
    `${fx.name}: expected contrary motions >= ${fx.expectContraryMin}, got ${contrary}`
  );
}

export function runStringPolyphonicTests(): void {
  const fixtures = loadFixtures();
  for (const fx of fixtures) {
    if (fx.type === "transition") runTransitionFixture(fx);
    if (fx.type === "candidate") runCandidateFixture(fx);
    if (fx.type === "imitation") runImitationFixture(fx);
    if (fx.type === "arranger") runArrangerFixture(fx);
  }
}

if (process.argv[1] && process.argv[1].includes("stringsPolyphonicArranger.test.ts")) {
  runStringPolyphonicTests();
  // eslint-disable-next-line no-console
  console.log("string polyphony tests: ok");
}
