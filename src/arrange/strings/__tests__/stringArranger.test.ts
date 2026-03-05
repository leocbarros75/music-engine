import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";
import { evaluateTransition, PROFILE_WEIGHTS } from "../constraints";
import { buildCandidatesForSlice, buildVoicingStates } from "../candidates";
import { arrangeStringEnsemble } from "../stringArranger";
import { parseChordSymbol } from "../../../harmonize/satb/chordSymbol";
import { pitchToMidi } from "../../../instruments/instrumentCatalog";
import type { ScoreModel } from "../../../score/types";

type Fixture =
  | {
      type: "transition";
      name: string;
      prev: Record<string, number | null>;
      next: Record<string, number | null>;
      pending: Record<string, "up" | "down" | null>;
      expectIds: string[];
    }
  | {
      type: "candidates";
      name: string;
      slice: any;
      keyFifths: number;
      keyMode: "major" | "minor";
      expectSingleNote: boolean;
    }
  | {
      type: "arranger";
      name: string;
      divisions: number;
      keyFifths: number;
      keyMode: "major" | "minor";
      melody: Array<{ measure: number; t: number; dur: number; midi: number }>;
      chords: Array<{ measure: number; t: number; symbol: string }>;
      expect: { finalChord: string };
    };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

function loadFixtures(): Fixture[] {
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(fixturesDir, f), "utf8")));
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
    meta: { ensemble: "satb" },
    global: { divisions: fx.divisions },
    parts: [
      {
        part_id: "P1",
        name: "Soprano",
        instrument: "voice",
        measures
      }
    ]
  };
}

function runTransitionFixture(fx: Extract<Fixture, { type: "transition" }>): void {
  const score = evaluateTransition(
    fx.prev as any,
    fx.next as any,
    { profile: PROFILE_WEIGHTS.hymn_support, pendingRecovery: fx.pending as any }
  );
  const ids = score.penalties.map((p) => p.id);
  for (const id of fx.expectIds) {
    assert(ids.includes(id), `${fx.name}: expected penalty ${id} not found`);
  }
}

function runCandidateFixture(fx: Extract<Fixture, { type: "candidates" }>): void {
  const candidates = buildCandidatesForSlice({
    slice: fx.slice,
    prevVoicing: null,
    keyFifths: fx.keyFifths,
    keyMode: fx.keyMode
  });
  const voicings = buildVoicingStates(candidates);
  assert(voicings.length > 0, `${fx.name}: no voicings created`);
  if (fx.expectSingleNote) {
    for (const v of voicings) {
      for (const key of Object.keys(v)) {
        assert(typeof (v as any)[key] !== "object", `${fx.name}: divisi not expected`);
      }
    }
  }
}

function runArrangerFixture(fx: Extract<Fixture, { type: "arranger" }>): void {
  const score = buildScoreFromFixture(fx);
  const result = arrangeStringEnsemble(score, fx.chords, { profile: "hymn_support" });
  const bassPart = result.scoreModel.parts.find((p) => p.name === "Double Bass");
  assert(bassPart, `${fx.name}: missing bass part`);
  const lastMeasure = bassPart!.measures[bassPart!.measures.length - 1];
  const lastNote = (lastMeasure.events ?? []).find((e: any) => e.type === "note");
  const parsed = parseChordSymbol(fx.expect.finalChord);
  assert(parsed, `${fx.name}: chord parse failed`);
  if (lastNote?.pitch && parsed) {
    const midi = pitchToMidi(lastNote.pitch);
    const pc = ((midi % 12) + 12) % 12;
    assert(parsed.pcs.includes(pc), `${fx.name}: bass not in chord pcs`);
  }
}

export function runStringArrangerTests(): void {
  const fixtures = loadFixtures();
  for (const fx of fixtures) {
    if (fx.type === "transition") runTransitionFixture(fx);
    if (fx.type === "candidates") runCandidateFixture(fx);
    if (fx.type === "arranger") runArrangerFixture(fx);
  }
}

if (process.argv[1] && process.argv[1].includes("stringArranger.test.ts")) {
  runStringArrangerTests();
  // eslint-disable-next-line no-console
  console.log("string arranger tests: ok");
}
