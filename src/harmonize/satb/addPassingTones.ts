// src/harmonize/satb/addPassingTones.ts
import type { ScoreModel, NoteEvent } from "../../score/types";
import { midiToPitch } from "../../instruments/instrumentCatalog";

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

// Build diatonic scale PCs from key signature
function scalePcsFromFifths(fifths: number, mode: string): Set<number> {
  const majorTonic: Record<number, number> = {
    "-7": 11, "-6": 6, "-5": 1, "-4": 8, "-3": 3, "-2": 10, "-1": 5,
    "0": 0, "1": 7, "2": 2, "3": 9, "4": 4, "5": 11, "6": 6, "7": 1
  };
  const minorTonic: Record<number, number> = {
    "-7": 8, "-6": 3, "-5": 10, "-4": 5, "-3": 0, "-2": 7, "-1": 2,
    "0": 9, "1": 4, "2": 11, "3": 6, "4": 1, "5": 8, "6": 3, "7": 10
  };
  const tonic =
    mode === "minor" ? (minorTonic[fifths] ?? 9) : (majorTonic[fifths] ?? 0);
  const intervals =
    mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return new Set(intervals.map((i) => (tonic + i) % 12));
}

export function addPassingTones(scoreModel: ScoreModel): ScoreModel {
  const keyFifths =
    (scoreModel.parts?.[0]?.measures?.[0]?.attributes?.key_fifths) ?? 0;
  const keyMode =
    (scoreModel.parts?.[0]?.measures?.[0]?.attributes?.key_mode) ?? "major";
  const scalePcs = scalePcsFromFifths(keyFifths, keyMode);

  // Only process Alto (index 1), Tenor (index 2), Bass (index 3)
  const processedParts = scoreModel.parts.map((part, partIdx) => {
    if (partIdx === 0) return part; // skip soprano (it's the melody)

    const processedMeasures = part.measures.map((measure, mIdx) => {
      const divisions = measure.attributes?.divisions ?? 2;
      const isLastMeasure = mIdx === part.measures.length - 1;
      const isPenultMeasure = mIdx === part.measures.length - 2;

      // Don't add passing tones in final 2 measures (cadential area)
      if (isLastMeasure || isPenultMeasure) return measure;

      const notes = measure.events.filter(
        (e): e is NoteEvent & { type: "note"; isRest?: false } =>
          e.type === "note" && !e.isRest
      );
      if (notes.length < 2) return measure;

      // Sort by onset
      notes.sort((a, b) => Number(a.t) - Number(b.t));

      const newEvents: NoteEvent[] = [
        ...measure.events.filter((e) => e.type === "rest"),
      ];

      for (let i = 0; i < notes.length; i++) {
        const curr = notes[i]!;
        const next = notes[i + 1];

        newEvents.push({ ...curr });

        if (!next) continue;

        const currMidi = curr.midi;
        const nextMidi = next.midi;
        if (typeof currMidi !== "number" || typeof nextMidi !== "number")
          continue;

        const gap = Math.abs(nextMidi - currMidi);
        const currDur = Number(curr.dur);
        const nextT = Number(next.t);
        const currT = Number(curr.t);

        // Only insert PT if:
        // - gap is between 3 and 7 semitones (minor 3rd to perfect 5th)
        // - current note is a quarter note (dur === divisions)
        // - notes are adjacent (next.t === curr.t + curr.dur)
        if (
          gap >= 3 &&
          gap <= 7 &&
          currDur === divisions &&
          nextT === currT + currDur
        ) {
          const direction = nextMidi > currMidi ? 1 : -1;

          // Find first diatonic step toward nextMidi
          let ptCandidate = currMidi + direction;
          while (Math.abs(ptCandidate - currMidi) < gap) {
            if (scalePcs.has(pc(ptCandidate))) break;
            ptCandidate += direction;
          }

          // Chromatic fallback: if no diatonic step is available (or the
          // diatonic step overshoots), use the chromatic semitone step
          // nearest to the midpoint between curr and next. This allows
          // D natural in E major (e.g., C#→E via D♮ as chromatic PT).
          const diatonicFound =
            scalePcs.has(pc(ptCandidate)) &&
            Math.abs(ptCandidate - currMidi) < gap &&
            Math.abs(ptCandidate - nextMidi) < gap;

          if (!diatonicFound) {
            // Try the chromatic note one step away from curr
            const chromatic = currMidi + direction;
            if (
              Math.abs(chromatic - currMidi) < gap &&
              Math.abs(chromatic - nextMidi) < gap
            ) {
              ptCandidate = chromatic;
            }
          }

          // Only insert if ptCandidate is truly between curr and next
          if (
            Math.abs(ptCandidate - currMidi) < gap &&
            Math.abs(ptCandidate - nextMidi) < gap
          ) {
            const halfDur = Math.floor(divisions / 2);
            if (halfDur < 1) continue;

            // Shorten curr to halfDur
            const lastIdx = newEvents.length - 1;
            newEvents[lastIdx] = { ...curr, dur: halfDur };

            // Insert passing tone
            const ptT = currT + halfDur;
            const ptNote: NoteEvent = {
              ...curr,
              id: curr.id + "_pt",
              t: ptT,
              dur: halfDur,
              midi: ptCandidate,
              pitch: midiToPitch(ptCandidate),
            };
            newEvents.push(ptNote);
          }
        }
      }

      // Sort by onset
      newEvents.sort((a, b) => Number(a.t) - Number(b.t));

      return { ...measure, events: newEvents };
    });

    return { ...part, measures: processedMeasures };
  });

  return { ...scoreModel, parts: processedParts };
}

export function addCadentialSuspension(scoreModel: ScoreModel): ScoreModel {
  const keyFifths =
    (scoreModel.parts?.[0]?.measures?.[0]?.attributes?.key_fifths) ?? 0;
  const keyMode =
    (scoreModel.parts?.[0]?.measures?.[0]?.attributes?.key_mode) ?? "major";

  const majorTonic: Record<number, number> = {
    "-7": 11, "-6": 6, "-5": 1, "-4": 8, "-3": 3, "-2": 10, "-1": 5,
    "0": 0, "1": 7, "2": 2, "3": 9, "4": 4, "5": 11, "6": 6, "7": 1
  };
  const minorTonic: Record<number, number> = {
    "-7": 8, "-6": 3, "-5": 10, "-4": 5, "-3": 0, "-2": 7, "-1": 2,
    "0": 9, "1": 4, "2": 11, "3": 6, "4": 1, "5": 8, "6": 3, "7": 10
  };

  const tonicPc =
    keyMode === "minor"
      ? (minorTonic[keyFifths] ?? 9)
      : (majorTonic[keyFifths] ?? 0);
  const domPc = (tonicPc + 7) % 12;
  const thirdOfV = (domPc + 4) % 12; // major 3rd = leading tone in major
  const suspensionPc = tonicPc; // the 4th above dominant = tonic

  const altoPart = scoreModel.parts[1]; // Alto is index 1
  if (!altoPart) return scoreModel;

  const penultIdx = altoPart.measures.length - 2;
  if (penultIdx < 0) return scoreModel;

  const penultMeasure = altoPart.measures[penultIdx]!;
  const divisions = penultMeasure.attributes?.divisions ?? 2;

  // Find alto notes on beat 0 and beat 1 in the penultimate measure
  const newEvents: NoteEvent[] = penultMeasure.events.map((event) => {
    if (event.type !== "note" || event.isRest) return event;
    if (typeof event.midi !== "number") return event;

    const beatPos = Math.round(Number(event.t) / divisions);

    if (beatPos === 0) {
      // Suspension note: move to closest tonic note
      const currentOctave = Math.floor(event.midi / 12);
      const candidates = [
        currentOctave * 12 + suspensionPc,
        (currentOctave - 1) * 12 + suspensionPc,
        (currentOctave + 1) * 12 + suspensionPc,
      ];
      const closest = candidates.reduce((a, b) =>
        Math.abs(a - event.midi!) <= Math.abs(b - event.midi!) ? a : b
      );
      // Only adjust if within 4 semitones (don't make large leaps)
      if (Math.abs(closest - event.midi) <= 4) {
        return { ...event, midi: closest, pitch: midiToPitch(closest) };
      }
    }

    if (beatPos === 1) {
      // Resolution: leading tone (3rd of V)
      const currentOctave = Math.floor(event.midi / 12);
      const candidates = [
        currentOctave * 12 + thirdOfV,
        (currentOctave - 1) * 12 + thirdOfV,
        (currentOctave + 1) * 12 + thirdOfV,
      ];
      const closest = candidates.reduce((a, b) =>
        Math.abs(a - event.midi!) <= Math.abs(b - event.midi!) ? a : b
      );
      if (Math.abs(closest - event.midi) <= 4) {
        return { ...event, midi: closest, pitch: midiToPitch(closest) };
      }
    }

    return event;
  });

  const newAltoPart = {
    ...altoPart,
    measures: altoPart.measures.map((m, idx) =>
      idx === penultIdx ? { ...m, events: newEvents } : m
    ),
  };

  const newParts = scoreModel.parts.map((p, idx) =>
    idx === 1 ? newAltoPart : p
  );
  return { ...scoreModel, parts: newParts };
}
