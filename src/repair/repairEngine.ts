import { validateScoreModelPiano } from "../validators";
import crypto from "crypto";
import type { ScoreModel, NoteEvent } from "../score/types";

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

type Issue = {
  severity: "error" | "warning";
  type: string;
  message: string;
  location?: any;
};

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function pitchToMidi(step: string, alter: number | undefined, octave: number): number {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const s = step.toUpperCase();
  const semis = (base[s] ?? 0) + (alter ?? 0);
  return (octave + 1) * 12 + semis;
}

function midiToPitch(midi: number) {
  // Chromatic spelling (simple). Later we can make this key-aware.
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

function getKeyFifthsFromScore(score: ScoreModel): number {
  for (const part of score.parts) {
    for (const m of part.measures) {
      if (m.attributes?.key_fifths !== undefined && m.attributes?.key_fifths !== null) {
        return m.attributes.key_fifths;
      }
    }
  }
  return 0; // default C
}

const FIFTHS_TO_MAJOR_TONIC: Record<string, string> = {
  "-7": "Cb", "-6": "Gb", "-5": "Db", "-4": "Ab", "-3": "Eb", "-2": "Bb", "-1": "F",
  "0": "C",
  "1": "G", "2": "D", "3": "A", "4": "E", "5": "B", "6": "F#", "7": "C#"
};

function tonicToPc(tonic: string): number {
  const map: Record<string, number> = {
    "C": 0, "C#": 1, "Db": 1,
    "D": 2, "D#": 3, "Eb": 3,
    "E": 4, "Fb": 4, "E#": 5,
    "F": 5, "F#": 6, "Gb": 6,
    "G": 7, "G#": 8, "Ab": 8,
    "A": 9, "A#": 10, "Bb": 10,
    "B": 11, "Cb": 11
  };
  return map[tonic] ?? 0;
}

const MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];

function buildMajorScalePcsFromFifths(fifths: number): number[] {
  const tonic = FIFTHS_TO_MAJOR_TONIC[String(fifths)] ?? "C";
  const tonicPc = tonicToPc(tonic);
  return MAJOR_SCALE_OFFSETS.map(off => (tonicPc + off) % 12);
}

function midiToPc(m: number) {
  return ((m % 12) + 12) % 12;
}

function isPcInScale(pc: number, scalePcs: number[]) {
  return scalePcs.includes(pc);
}

// Move one diatonic step up/down in the scale (snaps if outside scale)
function diatonicStepMidi(midi: number, scalePcs: number[], direction: 1 | -1): number {
  let cur = midi;

  if (!isPcInScale(midiToPc(cur), scalePcs)) {
    // snap to nearest scale tone within +-2 semitones
    let best = cur;
    let bestDist = Infinity;
    for (let d = -2; d <= 2; d++) {
      const cand = cur + d;
      if (isPcInScale(midiToPc(cand), scalePcs)) {
        const dist = Math.abs(d);
        if (dist < bestDist) { bestDist = dist; best = cand; }
      }
    }
    cur = best;
  }

  let next = cur;
  do {
    next += direction;
  } while (!isPcInScale(midiToPc(next), scalePcs));

  return next;
}

function findFirstMeasureWithRHNote(score: ScoreModel) {
  for (const part of score.parts) {
    for (const m of part.measures) {
      const rh = m.events.filter(e => e.type === "note" && e.staff === 1) as any[];
      if (rh.length > 0) return { part, measure: m, rh };
    }
  }
  return null;
}

function shiftSingleRHNoteAt(score: ScoreModel, measureNumber: number, t: number, direction: 1 | -1) {
  let changed = false;

  for (const part of score.parts) {
    for (const m of part.measures) {
      if (m.number !== measureNumber) continue;

      // Find RH notes at that exact onset
      for (const ev of m.events) {
        if (ev.type !== "note") continue;
        if (ev.staff !== 1) continue;
        if (ev.t !== t) continue;

        const midi = pitchToMidi(ev.pitch.step, ev.pitch.alter, ev.pitch.octave);
        const newMidi = midi + direction;
        const p = midiToPitch(newMidi);

        ev.pitch.step = p.step;
        if (p.alter === undefined) delete (ev.pitch as any).alter;
        else (ev.pitch as any).alter = p.alter;
        ev.pitch.octave = p.octave;

        changed = true;
      }
    }
  }

  return changed;
}

function shiftSingleRHNoteAtDiatonic(
  score: ScoreModel,
  measureNumber: number,
  t: number,
  direction: 1 | -1,
  scalePcs: number[]
) {
  let changed = false;

  for (const part of score.parts) {
    for (const m of part.measures) {
      if (m.number !== measureNumber) continue;

      for (const ev of m.events) {
        if (ev.type !== "note") continue;
        if (ev.staff !== 1) continue;
        if (ev.t !== t) continue;

        const midi = pitchToMidi(ev.pitch.step, ev.pitch.alter, ev.pitch.octave);
        const newMidi = diatonicStepMidi(midi, scalePcs, direction);
        const p = midiToPitch(newMidi);

        ev.pitch.step = p.step;
        if (p.alter === undefined) delete (ev.pitch as any).alter;
        else (ev.pitch as any).alter = p.alter;
        ev.pitch.octave = p.octave;

        changed = true;
      }
    }
  }

  return changed;
}

function addLHSupportFromRH(score: ScoreModel) {
  // Add a bass support note: take earliest RH note and add octave below to staff 2 at same onset.
  const found = findFirstMeasureWithRHNote(score);
  if (!found) return false;

  const { part, measure, rh } = found;
  const first = rh.sort((a, b) => a.t - b.t)[0];

  const midi = pitchToMidi(first.pitch.step, first.pitch.alter, first.pitch.octave);
  const bassMidi = midi - 12;

  const bassPitch = midiToPitch(bassMidi);

  const newEv: NoteEvent = {
    id: makeId(`LH_SUPPORT_M${measure.number}`),
    t: first.t,
    dur: first.dur,
    type: "note",
    pitch: bassPitch as any,
    voice: 2,
    staff: 2
  };

  measure.events.push(newEv);
  // keep events ordered by onset
  measure.events.sort((a: any, b: any) => a.t - b.t);
  return true;
}

function shiftLHDownOctave(score: ScoreModel) {
  let changed = false;
  for (const part of score.parts) {
    for (const m of part.measures) {
      for (const ev of m.events) {
        if (ev.type !== "note") continue;
        if (ev.staff !== 2) continue;

        const midi = pitchToMidi(ev.pitch.step, ev.pitch.alter, ev.pitch.octave);
        const newMidi = midi - 12;
        const p = midiToPitch(newMidi);
        ev.pitch.step = p.step;
        if (p.alter === undefined) delete (ev.pitch as any).alter;
        else (ev.pitch as any).alter = p.alter;
        ev.pitch.octave = p.octave;
        changed = true;
      }
    }
  }
  return changed;
}

function shiftRHByStep(score: ScoreModel, direction: 1 | -1) {
  // Shift all RH notes by one semitone in given direction (simple fix).
  // Later: target only offending events and make diatonic/key-aware.
  let changed = false;
  for (const part of score.parts) {
    for (const m of part.measures) {
      for (const ev of m.events) {
        if (ev.type !== "note") continue;
        if (ev.staff !== 1) continue;

        const midi = pitchToMidi(ev.pitch.step, ev.pitch.alter, ev.pitch.octave);
        const newMidi = midi + direction;
        const p = midiToPitch(newMidi);
        ev.pitch.step = p.step;
        if (p.alter === undefined) delete (ev.pitch as any).alter;
        else (ev.pitch as any).alter = p.alter;
        ev.pitch.octave = p.octave;
        changed = true;
      }
    }
  }
  return changed;
}

export function repairScoreModel(scoreModel: ScoreModel, issues: Issue[]) {
  // Clone scoreModel to avoid mutating caller
  const score: ScoreModel = JSON.parse(JSON.stringify(scoreModel));

  const applied: { type: string; changed: boolean; note?: string }[] = [];

  const hasEmptyLH = issues.some(i => i.type === "empty_staff_2");
  if (hasEmptyLH) {
    const ok = addLHSupportFromRH(score);
    applied.push({ type: "repair_empty_staff_2", changed: ok, note: "Added simple LH support note from earliest RH note." });
  }

  const hasHandCross = issues.some(i => i.type === "hand_crossing");
  if (hasHandCross) {
    const ok = shiftLHDownOctave(score);
    applied.push({ type: "repair_hand_crossing", changed: ok, note: "Shifted LH down an octave." });
  }

  const hasPar8 = issues.some(i => i.type === "parallel_8ves_outer_voices");
  const hasPar5 = issues.some(i => i.type === "parallel_5ths_outer_voices");
  const hasDirect8 = issues.some(i => i.type === "direct_8ves_outer_voices");
  const hasDirect5 = issues.some(i => i.type === "direct_5ths_outer_voices");

  if (hasPar8 || hasPar5) {
    const offending = issues.find(i =>
      i.type === "parallel_8ves_outer_voices" || i.type === "parallel_5ths_outer_voices"
    );

    const offendingType = offending?.type ?? "parallel_outer_voices";
    const measure = offending?.location?.measure;
    const t = offending?.location?.t;

    if (typeof measure === "number" && typeof t === "number") {
      // Try UP first
      const upAttempt = deepClone(score);
      const fifths = getKeyFifthsFromScore(score);
      const scalePcs = buildMajorScalePcsFromFifths(fifths);
      
      const upChanged = shiftSingleRHNoteAt(upAttempt, measure, t, 1, scalePcs);
      const upVal = validateScoreModelPiano(upAttempt);

      if (upChanged && upVal.ok) {
        Object.assign(score, upAttempt);
        applied.push({
          type: "repair_parallel_outer_voices_try_up",
          changed: true,
          note: `Fixed ${offendingType} at measure ${measure}, onset ${t} using +1 diatonic step (fifths=${fifths}).`
        });
      } else {
        // Try DOWN
        const downAttempt = deepClone(score);
        const downChanged = shiftSingleRHNoteAt(downAttempt, measure, t, -1, scalePcs);
        const downVal = validateScoreModelPiano(downAttempt);

        if (downChanged && downVal.ok) {
          Object.assign(score, downAttempt);
          applied.push({
            type: "repair_parallel_outer_voices_try_down",
            changed: true,
            note: `Fixed ${offendingType} at measure ${measure}, onset ${t} using -1 diatonic step (fifths=${fifths}).`
          });
        } else {
          // Keep the less-bad attempt (fewest errors)
          const upErrors = upVal.issues.filter(i => i.severity === "error").length;
          const downErrors = downVal.issues.filter(i => i.severity === "error").length;

          if (upChanged && upErrors <= downErrors) {
            Object.assign(score, upAttempt);
            applied.push({
              type: "repair_parallel_outer_voices_fallback_up",
              changed: true,
              note: `Neither direction fully fixed it; kept UP attempt (errors: ${upErrors}).`
            });
          } else if (downChanged) {
            Object.assign(score, downAttempt);
            applied.push({
              type: "repair_parallel_outer_voices_fallback_down",
              changed: true,
              note: `Neither direction fully fixed it; kept DOWN attempt (errors: ${downErrors}).`
            });
          } else {
            applied.push({
              type: "repair_parallel_outer_voices_failed",
              changed: false,
              note: "Could not find the target RH note to shift."
            });
          }
        }
      }
    } else {
      applied.push({
        type: "repair_parallel_outer_voices_failed",
        changed: false,
        note: "Missing location (measure/t) for parallel issue; cannot do targeted repair."
      });
    }
  }  // ===== Direct / Hidden perfect intervals repair =====
  if (hasDirect8 || hasDirect5) {
    const offending = issues.find(i =>
      i.type === "direct_8ves_outer_voices" ||
      i.type === "direct_5ths_outer_voices"
    );

    const offendingType = offending?.type ?? "direct_outer_voices";
    const measure = offending?.location?.measure;
    const t = offending?.location?.t;

    if (typeof measure === "number" && typeof t === "number") {
      const fifths = getKeyFifthsFromScore(score);
      const scalePcs = buildMajorScalePcsFromFifths(fifths);

      const upAttempt = deepClone(score);
      const upChanged = shiftSingleRHNoteAtDiatonic(
        upAttempt,
        measure,
        t,
        1,
        scalePcs
      );
      const upVal = validateScoreModelPiano(upAttempt);

      if (upChanged && upVal.ok) {
        Object.assign(score, upAttempt);
        applied.push({
          type: "repair_direct_outer_voices_try_up",
          changed: true,
          note: `Fixed ${offendingType} at measure ${measure}, onset ${t} using +1 diatonic step (fifths=${fifths}).`
        });
      } else {
        const downAttempt = deepClone(score);
        const downChanged = shiftSingleRHNoteAtDiatonic(
          downAttempt,
          measure,
          t,
          -1,
          scalePcs
        );
        const downVal = validateScoreModelPiano(downAttempt);

        if (downChanged && downVal.ok) {
          Object.assign(score, downAttempt);
          applied.push({
            type: "repair_direct_outer_voices_try_down",
            changed: true,
            note: `Fixed ${offendingType} at measure ${measure}, onset ${t} using -1 diatonic step (fifths=${fifths}).`
          });
        } else {
          applied.push({
            type: "repair_direct_outer_voices_failed",
            changed: false,
            note: `Could not fully fix ${offendingType} at measure ${measure}, onset ${t}.`
          });
        }
      }
    }
  }

  return { scoreModel: score, applied };
}