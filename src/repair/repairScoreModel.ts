import type { ScoreModel } from "../score/types";

type Issue = {
  severity: "error" | "warning";
  type: string;
  message: string;
  location?: any;
};

type RepairAction = {
  type: string;
  changed: boolean;
  note?: string;
};

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function midiToPitch(midi: number) {
  // C4 = 60
  const steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
  const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

  const octave = Math.floor(midi / 12) - 1;
  const pc = ((midi % 12) + 12) % 12;

  return {
    step: steps[pc],
    alter: alters[pc] === 0 ? undefined : alters[pc],
    octave
  };
}

function pitchToMidi(step: string, alter: number | undefined, octave: number): number {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const s = step.toUpperCase();
  const semis = (base[s] ?? 0) + (alter ?? 0);
  return (octave + 1) * 12 + semis;
}

function findEventById(score: ScoreModel, id: string) {
  for (const p of score.parts ?? []) {
    for (const m of p.measures ?? []) {
      for (const ev of m.events ?? []) {
        if (ev.id === id) return ev;
      }
    }
  }
  return null;
}

function diatonicStepUp(midi: number, keyFifths: number) {
  // Simple, safe first version:
  // try semitone up; if that makes weird spelling later, we can improve with key-aware spelling.
  return midi + 1;
}

/**
 * repairScoreModel(score, issues)
 * Returns:
 *  { ok: true, scoreModel: repairedScore, applied: RepairAction[] }
 */
export function repairScoreModel(scoreModel: ScoreModel, issues: Issue[]) {
  const repaired = clone(scoreModel);
  const applied: RepairAction[] = [];

  // Only fix the problems we currently detect.
  const fixTypes = new Set([
    "parallel_8ves_outer_voices",
    "parallel_5ths_outer_voices",
    "direct_8ves_outer_voices",
    "direct_5ths_outer_voices"
  ]);

  for (const issue of issues ?? []) {
    if (issue.severity !== "error") continue;
    if (!fixTypes.has(issue.type)) continue;

    const loc = issue.location ?? {};
    const topId = loc.top_event_id as string | undefined;
    if (!topId) continue;

    const topEv = findEventById(repaired, topId);
    if (!topEv || topEv.type !== "note") continue;

    const keyFifths =
      (repaired.parts?.[0]?.measures?.[0]?.attributes as any)?.key_fifths ??
      (repaired.parts?.[0]?.measures?.[0]?.attributes as any)?.key_fifths ??
      0;

    const oldMidi = pitchToMidi(topEv.pitch.step, topEv.pitch.alter, topEv.pitch.octave);
    const newMidi = diatonicStepUp(oldMidi, Number(keyFifths));

    const p = midiToPitch(newMidi);
    topEv.pitch.step = p.step;
    topEv.pitch.octave = p.octave;
    if (p.alter == null) delete topEv.pitch.alter;
    else topEv.pitch.alter = p.alter;

    applied.push({
      type: "repair_parallel_outer_voices_try_up",
      changed: true,
      note: `Fixed ${issue.type} by shifting top voice +1 semitone at measure ${loc.measure ?? "?"}, onset ${loc.t ?? "?"}.`
    });
  }

  return { ok: true, scoreModel: repaired, applied };
}