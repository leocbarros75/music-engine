import type { NoteEvent, ScoreModel } from "../../../score/types";
import { midiToPitch, pitchToMidi } from "../../../instruments/instrumentCatalog";
import { loadCounterpointRules, scoreTransition } from "./counterpointScoring";
import { enforceHierarchyAcrossScore, resolveVoiceCrossing } from "./voiceCrossing";
import { STRING_RANGES } from "./ranges";
import { captureMotif, scheduleImitation } from "./motifs";
import { buildCandidateMap } from "./pathfinding";
import { initRhythmState } from "./rhythmStratification";
import type { BeamState, MotifEntry, Slice, StringPolyphonicResult, VoiceId, Voicing } from "./types";

type ChordEvent = { measure: number; t: number; symbol: string };

const VOICES: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];

function isNoteOrRest(ev: any): boolean {
  return ev && (ev.type === "note" || ev.type === "rest");
}

function eventMidi(ev: any): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) {
    try {
      return pitchToMidi(ev.pitch);
    } catch {
      return null;
    }
  }
  return null;
}

function clampPc(pc: number): number {
  const v = pc % 12;
  return v < 0 ? v + 12 : v;
}

function majorScalePcs(fifths: number): number[] {
  const base = [0, 2, 4, 5, 7, 9, 11];
  const root = clampPc(fifths * 7);
  return base.map((pc) => clampPc(root + pc));
}

function inferMajorKeyFromMelody(melodyPart: any): number | null {
  if (!melodyPart) return null;
  const pcs: number[] = [];
  const measures = melodyPart?.measures ?? [];
  for (const measure of measures) {
    const events = Array.isArray(measure?.events) ? measure.events : [];
    for (const ev of events) {
      if (ev?.type !== "note") continue;
      const midi = eventMidi(ev);
      if (midi === null) continue;
      pcs.push(clampPc(midi));
    }
  }
  if (pcs.length < 4) return null;
  let bestFifths: number | null = null;
  let bestScore = -1;
  for (let fifths = -7; fifths <= 7; fifths++) {
    const scale = majorScalePcs(fifths);
    let score = 0;
    for (const pc of pcs) {
      if (scale.includes(pc)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestFifths = fifths;
    }
  }
  return bestFifths;
}

function getKeyInfo(score: ScoreModel, preferPart?: any): { fifths: number; mode: "major" | "minor" } {
  const parts = score.parts ?? [];
  const ordered = preferPart ? [preferPart, ...parts.filter((p) => p !== preferPart)] : parts;
  for (const part of ordered) {
    const attrs = part?.measures?.[0]?.attributes;
    const fifths = attrs?.key_fifths;
    if (typeof fifths === "number" && Number.isFinite(fifths)) {
      const mode = String(attrs?.key_mode ?? "major").toLowerCase() === "minor" ? "minor" : "major";
      return { fifths, mode };
    }
  }
  const inferred = inferMajorKeyFromMelody(preferPart ?? parts[0]);
  if (typeof inferred === "number" && Number.isFinite(inferred)) {
    return { fifths: inferred, mode: "major" };
  }
  return { fifths: 0, mode: "major" };
}

function measureLengthTicks(measure: any): number {
  const beats = Number(measure?.attributes?.time?.beats ?? 4);
  const beatType = Number(measure?.attributes?.time?.beat_type ?? 4);
  const divisions = Number(measure?.attributes?.divisions ?? 1);
  return beats * divisions * (4 / beatType);
}

function findMelodyPart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes("soprano") || n.includes("melody") || n.includes("voice")) return p;
  }
  let best: any | null = null;
  let bestAvg = -Infinity;
  for (const p of parts) {
    const vals: number[] = [];
    for (const m of p?.measures ?? []) {
      for (const e of m?.events ?? []) {
        if (e?.type !== "note") continue;
        const midi = eventMidi(e);
        if (midi !== null) vals.push(midi);
      }
    }
    if (!vals.length) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg > bestAvg) {
      bestAvg = avg;
      best = p;
    }
  }
  return best ?? parts[0] ?? null;
}

function pickChordForTime(chords: ChordEvent[], measure: number, t: number): string | null {
  const events = chords.filter((c) => Number(c.measure) === Number(measure));
  if (!events.length) return null;
  let best: ChordEvent | null = null;
  for (const c of events) {
    if (Number(c.t) <= t) best = c;
  }
  return best?.symbol ?? events[0]?.symbol ?? null;
}

function buildSlices(melodyPart: any, chords: ChordEvent[], melodyShift = 0): Slice[] {
  const slices: Slice[] = [];
  const measures = melodyPart?.measures ?? [];
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    const mNum = Number(m?.number) || i + 1;
    const divisions = Number(m?.attributes?.divisions ?? 1);
    const beatType = Number(m?.attributes?.time?.beat_type ?? 4);
    const beatUnit = divisions * (4 / beatType);
    const measureLen = measureLengthTicks(m);
    const melEvents = (m?.events ?? []).filter(isNoteOrRest).sort((a: any, b: any) => Number(a.t) - Number(b.t));
    const times = new Set<number>();
    for (const ev of melEvents) times.add(Number(ev.t ?? 0));
    for (const c of chords) {
      if (Number(c.measure) === mNum) times.add(Number(c.t));
    }
    times.add(0);
    times.add(measureLen);
    const ordered = Array.from(times).sort((a, b) => a - b);
    for (let tIdx = 0; tIdx < ordered.length - 1; tIdx++) {
      const t = ordered[tIdx]!;
      const next = ordered[tIdx + 1]!;
      const dur = Math.max(1, next - t);
      const active = melEvents.find((e: any) => e.type === "note" && Number(e.t) <= t && t < Number(e.t) + Number(e.dur));
      const melodyMidi = active ? eventMidi(active) : null;
      slices.push({
        index: slices.length,
        measure: mNum,
        t,
        dur,
        melodyMidi: melodyMidi === null ? null : melodyMidi + melodyShift,
        chordSymbol: pickChordForTime(chords, mNum, t),
        isStrongBeat: beatUnit > 0 ? Math.abs(t % beatUnit) < 1e-6 : Math.abs(t - Math.round(t)) < 1e-6
      });
    }
  }
  return slices;
}

function addRestsOnWeakBeats(candidateMap: Record<VoiceId, number[]>, slice: Slice): void {
  if (slice.isStrongBeat) return;
  // vln1 is always the locked melody — never silenced.
  // vln2 through cb all get a rest candidate on weak beats so the beam search
  // can stagger entries and produce genuine counterpoint rather than block chords.
  for (const v of VOICES) {
    if (v === "vln1") continue;
    if (!candidateMap[v].includes(null as any)) {
      candidateMap[v] = [null as any, ...candidateMap[v]];
    }
  }
}

function buildVoicingCombos(candidateMap: Record<VoiceId, number[]>, cap = 120): Voicing[] {
  const v1 = candidateMap.vln1.length ? candidateMap.vln1 : [null];
  const v2 = candidateMap.vln2.length ? candidateMap.vln2 : [null];
  const va = candidateMap.vla.length ? candidateMap.vla : [null];
  const vc = candidateMap.vc.length ? candidateMap.vc : [null];
  const cb = candidateMap.cb.length ? candidateMap.cb : [null];
  const out: Voicing[] = [];
  for (const a of v1) {
    for (const b of v2) {
      for (const c of va) {
        for (const d of vc) {
          for (const e of cb) {
            out.push({ vln1: a, vln2: b, vla: c, vc: d, cb: e });
            if (out.length >= cap) return out;
          }
        }
      }
    }
  }
  return out;
}

function makeEventsFromVoicing(slices: Slice[], voicings: Voicing[], voice: VoiceId): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    const midi = voicings[i]?.[voice] ?? null;
    if (midi === null) {
      out.push({
        id: `${voice}-${slice.measure}-${slice.t}`,
        t: slice.t,
        dur: slice.dur,
        type: "rest",
        voice: 1,
        staff: 1,
        isRest: true
      } as any);
      continue;
    }
    out.push({
      id: `${voice}-${slice.measure}-${slice.t}`,
      t: slice.t,
      dur: slice.dur,
      type: "note",
      pitch: midiToPitch(midi),
      voice: 1,
      staff: 1
    } as any);
  }
  return out;
}

function buildPart(template: any[], events: NoteEvent[], part_id: string, name: string, instrument: string): any {
  const byMeasure: Record<number, NoteEvent[]> = {};
  for (const ev of events) {
    const m = Number(ev.id?.split("-")[1]) || 1;
    if (!byMeasure[m]) byMeasure[m] = [];
    byMeasure[m].push(ev);
  }
  return {
    part_id,
    name,
    instrument,
    staves: 1,
    measures: template.map((m) => ({
      number: m.number,
      attributes: m.attributes ? JSON.parse(JSON.stringify(m.attributes)) : undefined,
      events: (byMeasure[m.number] ?? []).sort((a, b) => a.t - b.t)
    }))
  };
}

function buildMelodyEvents(melodyPart: any, octaveShift = 0): Record<number, NoteEvent[]> {
  const out: Record<number, NoteEvent[]> = {};
  const measures = melodyPart?.measures ?? [];
  for (const m of measures) {
    const mNum = Number(m?.number) || 1;
    const events: NoteEvent[] = [];
    for (const ev of m?.events ?? []) {
      if (!ev || (ev.type !== "note" && ev.type !== "rest")) continue;
      const baseMidi = ev.type === "note" ? eventMidi(ev) : null;
      if (ev.type === "note" && baseMidi === null) continue;
      const midi = baseMidi !== null ? baseMidi + octaveShift : null;
      events.push({
        id: `vln1-mel-${mNum}-${ev.t}`,
        t: Number(ev.t ?? 0),
        dur: Number(ev.dur ?? 0),
        type: ev.type,
        pitch: midi !== null ? midiToPitch(midi) : undefined,
        voice: 1,
        staff: 1
      } as any);
    }
    out[mNum] = events;
  }
  return out;
}

export function arrangeBrassPolyphonic(
  score: ScoreModel,
  chords: ChordEvent[] = [],
  options: { level?: string } = {}
): StringPolyphonicResult {
  const warnings: string[] = [];
  const melodyPart = findMelodyPart(score);
  if (!melodyPart) {
    warnings.push("[strings-poly] Missing melody part; returning original score.");
    return { scoreModel: score as any, warnings, debug: { ruleHits: [], motifEvents: [], rhythmDecisions: [] } };
  }

  const level = String(options.level ?? "").toLowerCase();
  // Melody shift: all levels except beginner push the melody up an octave so
  // inner voices have space beneath it. Professional was previously excluded
  // (bug — matched beginner's 0-shift path); now fixed.
  const melodyShift = level !== "beginner" ? 12 : 0;
  const slices = buildSlices(melodyPart, chords, melodyShift);
  const key = getKeyInfo(score, melodyPart);
  const rules = loadCounterpointRules();
  const motif = captureMotif(slices);
  const motifEntries: MotifEntry[] = scheduleImitation(motif, rules.polyphony.imitation, slices);
  // All levels use the full instrument ranges. Level controls rule strictness
  // and rhythm-pattern complexity, not how high each voice can play.
  const ranges = STRING_RANGES;

  const beamWidth = 30;
  let beam: BeamState[] = [];
  const debugHits: any[] = [];
  const rhythmDecisions: any[] = [];

  const initialState: BeamState = {
    voicing: { vln1: null, vln2: null, vla: null, vc: null, cb: null },
    history: [],
    pendingRecovery: { vln1: null, vln2: null, vla: null, vc: null, cb: null },
    pendingResolution: [],
    rhythmState: initRhythmState(),
    parallelPerfectCounts: {},
    crossingCounts: {},
    cost: 0,
    debug: []
  };
  beam = [initialState];

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i]!;
    const nextBeam: BeamState[] = [];
    for (const state of beam) {
      const candidates = buildCandidateMap({
        slice,
        prevVoicing: state.voicing,
        keyFifths: key.fifths,
        keyMode: key.mode,
        motif,
        motifEntries,
        rules,
        rhythmState: state.rhythmState,
        ranges
      });
      addRestsOnWeakBeats(candidates, slice);
      const voicings = buildVoicingCombos(candidates);
      for (const v of voicings) {
        const locks = {
          vln1: slice.melodyMidi !== null,
          vln2: false,
          vla: false,
          vc: false,
          cb: false
        };
        const crossingRes = resolveVoiceCrossing({
          slice,
          voicing: v,
          prevVoicing: state.voicing,
          rules,
          ranges,
          locked: locks,
          crossingCounts: state.crossingCounts
        });
        const fixed = crossingRes.voicing;
        const scoreResult = scoreTransition(
          state.voicing,
          fixed,
          rules,
          slice.isStrongBeat,
          state.rhythmState,
          state.pendingRecovery,
          state.pendingResolution,
          state.parallelPerfectCounts
        );
        const total = state.cost + scoreResult.cost + crossingRes.cost;
        nextBeam.push({
          voicing: fixed,
          history: [...state.history, fixed],
          pendingRecovery: scoreResult.pendingRecovery,
          pendingResolution: scoreResult.pendingResolution,
          rhythmState: scoreResult.rhythmState,
          parallelPerfectCounts: scoreResult.parallelPerfectCounts,
          crossingCounts: crossingRes.crossingCounts,
          cost: total,
          debug: [...state.debug, ...crossingRes.ruleHits, ...scoreResult.ruleHits]
        });
      }
    }
    nextBeam.sort((a, b) => a.cost - b.cost);
    beam = nextBeam.slice(0, beamWidth);
    if (beam[0]?.debug) debugHits.push(...beam[0].debug);
    if (beam[0]?.rhythmState) {
      rhythmDecisions.push({ slice: i, ...beam[0].rhythmState });
    }
  }

  const best = beam[0] ?? initialState;
  const bestVoicings = best.history.length ? best.history : slices.map(() => best.voicing);
  const hierarchyPass = enforceHierarchyAcrossScore({ slices, voicings: bestVoicings, rules, ranges });
  const finalVoicings = hierarchyPass.voicings;

  const vln1 = makeEventsFromVoicing(slices, finalVoicings, "vln1");
  const vln2 = makeEventsFromVoicing(slices, finalVoicings, "vln2");
  const vla = makeEventsFromVoicing(slices, finalVoicings, "vla");
  const vc = makeEventsFromVoicing(slices, finalVoicings, "vc");
  const cb = makeEventsFromVoicing(slices, finalVoicings, "cb");

  const measuresTemplate = (melodyPart.measures ?? []).map((m: any) => ({
    number: m.number,
    attributes: m.attributes ? JSON.parse(JSON.stringify(m.attributes)) : undefined
  }));

  const parts = [
    buildPart(measuresTemplate, vln1, "P_V1", "Violin I", "violin_1"),
    buildPart(measuresTemplate, vln2, "P_V2", "Violin II", "violin_2"),
    buildPart(measuresTemplate, vla, "P_VA", "Viola", "viola"),
    buildPart(measuresTemplate, vc, "P_VC", "Cello", "cello"),
    buildPart(measuresTemplate, cb, "P_DB", "Double Bass", "double_bass")
  ];

  const melodyEvents = buildMelodyEvents(melodyPart, melodyShift);
  const vln1Part = parts.find((p) => p.part_id === "P_V1");
  if (vln1Part) {
    vln1Part.measures = vln1Part.measures.map((m: any) => ({
      ...m,
      events: (melodyEvents[m.number] ?? m.events ?? []).sort((a, b) => Number(a.t) - Number(b.t))
    }));
  }

  const scoreModel: ScoreModel = {
    ...(score as any),
    meta: { ...(score as any).meta, ensemble: "string_ensemble" },
    parts
  };

  return {
    scoreModel: scoreModel as any,
    warnings,
    debug: { ruleHits: [...debugHits, ...hierarchyPass.ruleHits], motifEvents: motifEntries, rhythmDecisions }
  };
}
