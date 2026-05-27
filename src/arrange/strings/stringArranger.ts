import type { NoteEvent, ScoreModel } from "../../score/types";
import type { Slice, StringArrangerOptions, StringArrangerResult, StringEnsembleArrangement, VoiceId, Voicing } from "./types";
import { buildCandidatesForSlice, buildVoicingStates } from "./candidates";
import { runDp } from "./dp";
import { STRING_RANGES } from "./ranges";
import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";

type ChordEvent = { measure: number; t: number; symbol: string };

const VOICES: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

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

function clampMidiToRangeByOctave(midi: number, range: { absMin: number; absMax: number }): number {
  let out = midi;
  while (out < range.absMin) out += 12;
  while (out > range.absMax) out -= 12;
  return out;
}

function getKeyInfo(score: ScoreModel): { fifths: number; mode: "major" | "minor" } {
  const first = score.parts?.[0]?.measures?.[0]?.attributes;
  const fifths = typeof first?.key_fifths === "number" ? first.key_fifths : 0;
  const mode = String(first?.key_mode ?? "major").toLowerCase() === "minor" ? "minor" : "major";
  return { fifths, mode };
}

function measureLengthBeats(measure: any): number {
  const beats = Number(measure?.attributes?.time?.beats ?? 4);
  const beatType = Number(measure?.attributes?.time?.beat_type ?? 4);
  return beats * (4 / beatType);
}

function findMelodyPart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes("soprano") || n.includes("melody") || n.includes("voice")) return p;
  }
  return parts[0] ?? null;
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

function buildSlices(melodyPart: any, chords: ChordEvent[]): Slice[] {
  const slices: Slice[] = [];
  const measures = melodyPart?.measures ?? [];
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    const mNum = Number(m?.number) || i + 1;
    const measureLen = measureLengthBeats(m);
    const melEvents = (m?.events ?? []).filter(isNoteOrRest).sort((a: any, b: any) => Number(a.t) - Number(b.t));
    const times = new Set<number>();
    // Only add time points within the measure — values beyond measureLen would
    // create extra slices after the barline, producing "17/16" MuseScore errors.
    for (const ev of melEvents) {
      const et = Number(ev.t ?? 0);
      if (et >= 0 && et <= measureLen) times.add(et);
    }
    for (const c of chords) {
      if (Number(c.measure) === mNum) {
        const ct = Number(c.t);
        // Strict < measureLen: a chord landing exactly on the barline belongs
        // to the next measure and must not be added to this one's grid.
        if (ct >= 0 && ct < measureLen) times.add(ct);
      }
    }
    times.add(0);
    times.add(measureLen);
    // Re-filter after the forced adds to keep the set clean, then sort.
    const ordered = Array.from(times).filter(t => t >= 0 && t <= measureLen).sort((a, b) => a - b);
    for (let tIdx = 0; tIdx < ordered.length - 1; tIdx++) {
      const t = ordered[tIdx]!;
      const next = ordered[tIdx + 1]!;
      // Cap at (measureLen - t) so the minimum-duration floor can never push
      // a note past the barline (e.g. last 16th-grid slot → 0.125 raw →
      // Math.max(0.25, 0.125) = 0.25 would overflow by 0.125 beats).
      const capDur = measureLen - t;
      if (capDur <= 0) continue;
      const dur = Math.min(capDur, Math.max(0.25, next - t));
      const active = melEvents.find((e: any) => e.type === "note" && Number(e.t) <= t && t < Number(e.t) + Number(e.dur));
      const melodyMidi = active ? eventMidi(active) : null;
      slices.push({
        measure: mNum,
        t,
        dur,
        melodyMidi: melodyMidi === null ? null : melodyMidi,
        chordSymbol: pickChordForTime(chords, mNum, t)
      });
    }
  }
  return slices;
}

function makeEventsFromVoicing(
  slices: Slice[],
  voicings: Voicing[],
  voice: VoiceId
): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    let midi = voicings[i]?.[voice] ?? null;
    if (midi === null) {
      out.push({
        id: `${voice}-${slice.measure}-${slice.t}`,
        t: slice.t,
        dur: slice.dur,
        type: "rest",
        voice: 1,
        staff: 1,
        isRest: true
      });
      continue;
    }
    const range = STRING_RANGES[voice];
    midi = clampMidiToRangeByOctave(midi, range);
    out.push({
      id: `${voice}-${slice.measure}-${slice.t}`,
      t: slice.t,
      dur: slice.dur,
      type: "note",
      pitch: midiToPitch(midi),
      voice: 1,
      staff: 1
    });
  }
  return out;
}

function groupEventsByMeasure(events: NoteEvent[], template: any[]): any[] {
  const byMeasure: Record<number, NoteEvent[]> = {};
  for (const ev of events) {
    const m = Number(ev.id.split("-")[1]) || 1;
    if (!byMeasure[m]) byMeasure[m] = [];
    byMeasure[m].push(ev);
  }
  return template.map((m) => ({
    number: m.number,
    attributes: m.attributes ? clone(m.attributes) : undefined,
    events: (byMeasure[m.number] ?? []).sort((a, b) => a.t - b.t)
  }));
}

function buildPart(
  template: any[],
  voiceEvents: NoteEvent[],
  part_id: string,
  name: string,
  instrument: string
): any {
  return {
    part_id,
    name,
    instrument,
    staves: 1,
    measures: groupEventsByMeasure(voiceEvents, template)
  };
}

export function arrangeStringEnsemble(
  score: ScoreModel,
  chords: ChordEvent[],
  options: StringArrangerOptions = {}
): StringArrangerResult {
  const warnings: string[] = [];
  const melodyPart = findMelodyPart(score);
  if (!melodyPart) {
    warnings.push("[strings] Missing melody part; returning original score.");
    return { scoreModel: score, arrangement: { parts: { vln1: [], vln2: [], vla: [], vc: [], cb: [] } }, warnings };
  }

  const slices = buildSlices(melodyPart, chords);
  const key = getKeyInfo(score);

  const profile = options.profile ?? "melody_harmony";
  const candidatesBySlice: Voicing[][] = [];
  let prevVoicing: Voicing | null = null;
  for (const slice of slices) {
    const candidateMap = buildCandidatesForSlice({ slice, prevVoicing, keyFifths: key.fifths, keyMode: key.mode, profileId: profile });
    const voicings = buildVoicingStates(candidateMap);
    candidatesBySlice.push(voicings);
    prevVoicing = voicings[0] ?? null;
  }

  const dpResult = runDp({ slices, candidatesBySlice, profileId: profile });
  const bestStates = dpResult.best;
  const bestVoicings = bestStates.map((s) => s.voicing);

  const vln1 = makeEventsFromVoicing(slices, bestVoicings, "vln1");
  const vln2 = makeEventsFromVoicing(slices, bestVoicings, "vln2");
  const vla = makeEventsFromVoicing(slices, bestVoicings, "vla");
  const vc = makeEventsFromVoicing(slices, bestVoicings, "vc");
  const cb = makeEventsFromVoicing(slices, bestVoicings, "cb");

  const measuresTemplate = (melodyPart.measures ?? []).map((m: any) => ({
    number: m.number,
    attributes: m.attributes ? clone(m.attributes) : undefined
  }));

  const parts = [
    buildPart(measuresTemplate, vln1, "P_V1", "Violin I", "violin_1"),
    buildPart(measuresTemplate, vln2, "P_V2", "Violin II", "violin_2"),
    buildPart(measuresTemplate, vla, "P_VA", "Viola", "viola"),
    buildPart(measuresTemplate, vc, "P_VC", "Cello", "cello"),
    buildPart(measuresTemplate, cb, "P_DB", "Double Bass", "double_bass")
  ];

  // melody_pizzicato: Vln I arco; all others pizzicato
  const baseArticulations: StringEnsembleArrangement["articulations"] = [{ measure: 1, t: 0, type: "legato" }];
  const pizzicatoMeta = profile === "melody_pizzicato"
    ? { pizzicato_voices: ["vln2", "vla", "vc", "cb"] as const }
    : undefined;

  const arrangement: StringEnsembleArrangement = {
    parts: { vln1, vln2, vla, vc, cb },
    dynamics: [{ measure: 1, value: profile === "cello_melody" ? "mp" : "mf" }],
    articulations: baseArticulations,
    phrasing: [{ startMeasure: 1, endMeasure: measuresTemplate.length }],
    debug: {
      transitionPenalties: dpResult.penalties,
      ...(pizzicatoMeta as any)
    }
  };

  const scoreModel: ScoreModel = {
    ...(score as any),
    meta: { ...(score as any).meta, ensemble: "string_ensemble" },
    parts
  };

  return { scoreModel, arrangement, warnings };
}
