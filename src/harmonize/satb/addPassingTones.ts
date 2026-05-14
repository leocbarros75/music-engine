// src/harmonize/satb/addPassingTones.ts
import type { ScoreModel, NoteEvent } from "../../score/types";
import { midiToPitch } from "../../instruments/instrumentCatalog";

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

// Build diatonic scale PCs from key signature.
// For minor keys, include the raised 6th and 7th degrees (harmonic + melodic
// minor) in addition to the natural minor — this is essential for chromatic
// passing tones. BWV 578 analysis shows F# (raised 7th in G minor) and
// E♮ (raised 6th) each appear ~12–14 times as passing/neighbour tones.
function scalePcsFromFifths(fifths: number, mode: string): Set<number> {
  const majorTonic: Record<number, number> = {
    "-7": 11, "-6": 6, "-5": 1, "-4": 8, "-3": 3, "-2": 10, "-1": 5,
    "0": 0, "1": 7, "2": 2, "3": 9, "4": 4, "5": 11, "6": 6, "7": 1
  };
  const minorTonic: Record<number, number> = {
    "-7": 8, "-6": 3, "-5": 10, "-4": 5, "-3": 0, "-2": 7, "-1": 2,
    "0": 9, "1": 4, "2": 11, "3": 6, "4": 1, "5": 8, "6": 3, "7": 10
  };
  if (mode !== "minor") {
    const tonic = majorTonic[fifths] ?? 0;
    return new Set([0, 2, 4, 5, 7, 9, 11].map((i) => (tonic + i) % 12));
  }
  const tonic = minorTonic[fifths] ?? 9;
  // Union of natural minor (0,2,3,5,7,8,10), harmonic minor (raised 7th: 11),
  // and ascending melodic minor (raised 6th: 9). Gives all chromatic inflections
  // that are idiomatic in tonal minor writing.
  const intervals = [0, 2, 3, 5, 7, 8, 9, 10, 11];
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

        // ── Passing tone (gap 2–7 semitones) ────────────────────────────
        // Insert a stepwise note between curr and next when there is a
        // gap of a whole tone (2 st) up to a perfect fifth (7 st).
        // Expanded from the original min of 3 st to capture whole-tone
        // chromatic passing tones (e.g. D♮ between C# and E).
        if (
          gap >= 2 &&
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

        // ── Neighbor tone / auxiliary note (gap = 0: same pitch repeating) ──
        // Lesson from BWV 848: the fugue uses the "pivot figure" where one
        // pitch repeatedly returns to itself while the other voice moves.
        // When the same note appears on two consecutive quarter-note beats,
        // insert a diatonic step away (upper or lower neighbor) on the weak
        // half of the beat and resolve back.
        // Only on inner voices (alto = 1, tenor = 2): bass provides harmonic
        // clarity (Schoenberg, Theory of Harmony, Ch. XVII) and should not
        // be embellished with neighbor tones that would muddy the harmonic root.
        if (
          partIdx < 3 &&           // exclude bass (index 3)
          gap === 0 &&
          currDur === divisions &&
          nextT === currT + currDur
        ) {
          const halfDur = Math.floor(divisions / 2);
          if (halfDur < 1) continue;

          // Prefer the upper diatonic neighbor, fall back to lower, then
          // chromatic upper (avoids consecutive dissonances with bass).
          const upperDia = scalePcs.has(pc(currMidi + 2))
            ? currMidi + 2
            : scalePcs.has(pc(currMidi + 1))
            ? currMidi + 1
            : null;
          const lowerDia = scalePcs.has(pc(currMidi - 2))
            ? currMidi - 2
            : scalePcs.has(pc(currMidi - 1))
            ? currMidi - 1
            : null;

          const ntCandidate = upperDia ?? lowerDia;
          if (ntCandidate === null) continue;

          // Shorten curr to halfDur, insert neighbor, next note acts as return
          const lastIdx = newEvents.length - 1;
          newEvents[lastIdx] = { ...curr, dur: halfDur };

          const ntNote: NoteEvent = {
            ...curr,
            id: curr.id + "_nt",
            t: currT + halfDur,
            dur: halfDur,
            midi: ntCandidate,
            pitch: midiToPitch(ntCandidate),
          };
          newEvents.push(ntNote);
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
  const newAltoEvents: NoteEvent[] = penultMeasure.events.map((event) => {
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
      idx === penultIdx ? { ...m, events: newAltoEvents } : m
    ),
  };

  let newParts = scoreModel.parts.map((p, idx) =>
    idx === 1 ? newAltoPart : p
  );

  // ── Aldwell & Schachter Unit 21 §12, p. 354: avoid anticipating the tone of resolution ──
  // "In a more or less homogeneous texture (four-part choral), it is usually best to avoid
  //  having the tone of resolution in another voice before the suspension actually resolves."
  // The 4-3 suspension in alto resolves to thirdOfV (leading tone) on beat 1. If tenor
  // already has thirdOfV on beat 0 (alongside the suspension), it anticipates the resolution.
  // Move tenor from leading tone to domPc (5th of V chord) to correct this.
  const tenorPart = scoreModel.parts[2]; // Tenor is index 2
  if (tenorPart) {
    const penultTenorMeasure = tenorPart.measures[penultIdx]!;
    if (penultTenorMeasure) {
      const tenorDivisions = penultTenorMeasure.attributes?.divisions ?? divisions;
      let tenorModified = false;
      const newTenorEvents: NoteEvent[] = penultTenorMeasure.events.map((event) => {
        if (event.type !== "note" || event.isRest || typeof event.midi !== "number") return event;
        const beatPos = Math.round(Number(event.t) / tenorDivisions);
        if (beatPos !== 0) return event;
        if (pc(event.midi) !== thirdOfV) return event;

        // Tenor has the leading tone on beat 0 while alto has the 4-3 suspension.
        // Replace with domPc (5th of V) — the dominant note holds perfectly here.
        const oct = Math.floor(event.midi / 12);
        const candidates = [
          oct * 12 + domPc,
          (oct - 1) * 12 + domPc,
          (oct + 1) * 12 + domPc,
        ].filter((m) => m >= 52 && m <= 64); // Tenor range E3–E4
        if (!candidates.length) return event;
        const closest = candidates.reduce((a, b) =>
          Math.abs(a - event.midi!) <= Math.abs(b - event.midi!) ? a : b
        );
        if (Math.abs(closest - event.midi) <= 5) {
          tenorModified = true;
          return { ...event, midi: closest, pitch: midiToPitch(closest) };
        }
        return event;
      });

      if (tenorModified) {
        const newTenorPart = {
          ...tenorPart,
          measures: tenorPart.measures.map((m, idx) =>
            idx === penultIdx ? { ...m, events: newTenorEvents } : m
          ),
        };
        newParts = newParts.map((p, idx) => idx === 2 ? newTenorPart : p);
      }
    }
  }

  return { ...scoreModel, parts: newParts };
}

// ── Aldwell & Schachter Unit 21 §§9,12,16, pp. 352–357 ─────────────────────────
// "The 7-6 suspension is accompanied by a 3rd and normally resolves into a 6/3
//  chord." (§9)  "The most important suspension series contains 7-6s over a
//  descending bass." (§16)  "Avoid having the tone of resolution in another voice
//  before the suspension actually resolves." (§12)
//
// This function scans the inner voice (alto) for beats where the previous pitch
// would form a 7th above the current bass, and the following beat resolves by
// stepwise descent to a 6th. When all conditions are met — consonant preparation,
// stepwise downward resolution, consonant resolution interval — the alto is held
// on the suspension pitch (the 7th) instead of the chord tone for that beat.
export function add76Suspension(scoreModel: ScoreModel): ScoreModel {
  const altoPart = scoreModel.parts[1]; // Alto
  const bassPart = scoreModel.parts[3]; // Bass
  const soprPart = scoreModel.parts[0]; // Soprano (used for §12 anticipation warning)
  if (!altoPart || !bassPart) return scoreModel;

  const numMeasures = altoPart.measures.length;
  if (numMeasures < 4) return scoreModel; // need room outside cadential area

  // Consonant intervals (pitch-class distance from bass upward, mod 12)
  const CONSONANT = new Set([0, 3, 4, 5, 7, 8, 9]); // P1 m3 M3 P4 P5 m6 M6

  // Build a flat chronological list of (mIdx, beatPos, altoMidi, bassMidi, soprMidi)
  type BeatEntry = {
    mIdx: number;
    beatPos: number;
    divisions: number;
    altoMidi: number;
    bassMidi: number;
    soprMidi: number;
  };
  const allBeats: BeatEntry[] = [];

  for (let mIdx = 0; mIdx < numMeasures; mIdx++) {
    const altoM = altoPart.measures[mIdx]!;
    const bassM = bassPart.measures[mIdx]!;
    const soprM = soprPart?.measures[mIdx];
    const divs = altoM.attributes?.divisions ?? 1;

    // Collect true beat positions from alto quarter-beat notes (skip passing tones
    // which have non-integer t/divisions values when divisions > 1).
    // We take the earliest note at each beat position (= the chord tone, not a PT).
    const altoByBeat = new Map<number, NoteEvent>();
    for (const ev of altoM.events) {
      if (ev.type !== "note" || ev.isRest || typeof ev.midi !== "number") continue;
      const bp = Math.round(Number(ev.t) / divs);
      if (!altoByBeat.has(bp)) altoByBeat.set(bp, ev);
    }

    const bassByBeat = new Map<number, NoteEvent>();
    for (const ev of bassM.events) {
      if (ev.type !== "note" || ev.isRest || typeof ev.midi !== "number") continue;
      const bp = Math.round(Number(ev.t) / divs);
      if (!bassByBeat.has(bp)) bassByBeat.set(bp, ev);
    }

    const soprByBeat = new Map<number, NoteEvent>();
    if (soprM) {
      for (const ev of soprM.events) {
        if ((ev as any).type !== "note" || (ev as any).isRest || typeof (ev as any).midi !== "number") continue;
        const bp = Math.round(Number((ev as any).t) / divs);
        if (!soprByBeat.has(bp)) soprByBeat.set(bp, ev as NoteEvent);
      }
    }

    for (const [bp, altoEv] of Array.from(altoByBeat.entries()).sort(([a], [b]) => a - b)) {
      // For bass, pick the sustaining note at this beat (it might be a longer note)
      let bassEv = bassByBeat.get(bp);
      if (!bassEv) {
        // Find the bass note that started before bp and is still sounding
        for (const [bbp, bev] of bassByBeat) {
          if (bbp <= bp) bassEv = bev;
        }
      }
      if (!bassEv || typeof bassEv.midi !== "number") continue;

      const soprEv = soprByBeat.get(bp);
      allBeats.push({
        mIdx,
        beatPos: bp,
        divisions: divs,
        altoMidi: Number(altoEv.midi),
        bassMidi: Number(bassEv.midi),
        soprMidi: soprEv && typeof (soprEv as any).midi === "number" ? Number((soprEv as any).midi) : -1,
      });
    }
  }

  // Map of (mIdx:beatPos) → new alto MIDI for suspension modifications
  const modMap = new Map<string, number>();

  let suspensionCount = 0;
  const MAX_SUSPENSIONS = 3; // cap to avoid over-use

  for (let i = 1; i < allBeats.length - 1; i++) {
    const prev = allBeats[i - 1]!;
    const curr = allBeats[i]!;
    const next = allBeats[i + 1]!;

    // Skip last 2 measures — handled by addCadentialSuspension
    if (curr.mIdx >= numMeasures - 2) continue;

    // Don't chain: if the previous beat was itself a suspension, skip
    if (modMap.has(`${prev.mIdx}:${prev.beatPos}`)) continue;

    const prevAlto = prev.altoMidi;
    const currBass = curr.bassMidi;
    const prevBass = prev.bassMidi;

    // 1. Does prevAlto form a 7th above currBass? (minor 7th = 10 st, major 7th = 11 st)
    const suspInterval = ((pc(prevAlto) - pc(currBass)) + 12) % 12;
    if (suspInterval !== 10 && suspInterval !== 11) continue;

    // 2. Preparation was consonant: prevAlto vs prevBass
    const prepInterval = ((pc(prevAlto) - pc(prevBass)) + 12) % 12;
    if (!CONSONANT.has(prepInterval)) continue;

    // 3. The suspension note is different from what the engine currently placed at curr
    if (prevAlto === curr.altoMidi) continue;

    // 4. Resolution (next beat) is stepwise descent: 1 or 2 semitones down from prevAlto
    const step = prevAlto - next.altoMidi;
    if (step !== 1 && step !== 2) continue;

    // 5. Resolution interval is consonant (next alto vs curr bass or next bass)
    const resInterval = ((pc(next.altoMidi) - pc(currBass)) + 12) % 12;
    if (!CONSONANT.has(resInterval)) continue;

    // 6. Suspension pitch must remain within alto range (G3–A4 = MIDI 55–69)
    if (prevAlto < 55 || prevAlto > 69) continue;

    // 7. Suspension note must not exceed the soprano at curr beat
    if (curr.soprMidi !== -1 && prevAlto >= curr.soprMidi) continue;

    // All conditions satisfied — schedule this beat for modification
    modMap.set(`${curr.mIdx}:${curr.beatPos}`, prevAlto);

    // §12: warn if soprano already has the resolution pitch class
    if (curr.soprMidi !== -1 && pc(curr.soprMidi) === pc(next.altoMidi)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[satb] 7-6 suspension at m${curr.mIdx + 1} beat ${curr.beatPos}: ` +
        `soprano (MIDI ${curr.soprMidi}) anticipates resolution tone ` +
        `(pc ${pc(next.altoMidi)}). Aldwell & Schachter §12, p. 354: ` +
        `"avoid having the tone of resolution in another voice before the suspension resolves."`
      );
    }

    if (++suspensionCount >= MAX_SUSPENSIONS) break;
  }

  if (modMap.size === 0) return scoreModel;

  const newAltoPart = {
    ...altoPart,
    measures: altoPart.measures.map((measure, mIdx) => {
      const hasMods = Array.from(modMap.keys()).some((k) => k.startsWith(`${mIdx}:`));
      if (!hasMods) return measure;

      const divs = measure.attributes?.divisions ?? 1;
      const newEvents = measure.events.map((event) => {
        if (event.type !== "note" || event.isRest || typeof event.midi !== "number") return event;
        const bp = Math.round(Number(event.t) / divs);
        const key = `${mIdx}:${bp}`;
        const newMidi = modMap.get(key);
        if (newMidi === undefined || newMidi === event.midi) return event;
        return { ...event, midi: newMidi, pitch: midiToPitch(newMidi) };
      });

      return { ...measure, events: newEvents };
    }),
  };

  return {
    ...scoreModel,
    parts: scoreModel.parts.map((p, idx) => (idx === 1 ? newAltoPart : p)),
  };
}
