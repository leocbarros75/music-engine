// src/arrange/mapPianoToBrassEnsemble.ts

import type { ScoreModel } from "../score/types";
import { BRASS_ENSEMBLE_PARTS } from "../instruments/brassEnsemble";
import { InstrumentCatalog, shiftOctavesIntoRange, midiToPitch } from "../instruments/instrumentCatalog";
import { extractOnsetChords } from "../analyze/chordExtractor";

function makePart(part_id: string, name: string, instrument: string, staves = 1) {
  return {
    part_id,
    name,
    instrument,
    staves,
    measures: [] as any[]
  };
}

function cloneMeasureShell(m: any) {
  return {
    number: m.number,
    attributes: { ...m.attributes },
    events: [] as any[]
  };
}

function addNote(
  measure: any,
  t: number,
  dur: number,
  pitch: { step: string; alter?: number; octave: number },
  voice: number,
  staff: number
) {
  const id = `EV_${measure.number}_${t}_${staff}_${voice}_${Math.random().toString(16).slice(2, 10)}`;
  measure.events.push({
    id,
    t,
    dur,
    type: "note",
    pitch: { step: pitch.step, alter: pitch.alter, octave: pitch.octave },
    voice,
    staff
  });
}

/**
 * Simple “open” brass voicing from piano chord onsets:
 * - Tuba gets root (lowest note)
 * - Trombone gets 3rd/5th region (next low)
 * - Bass trombone supports low harmony (optional: 5th/root)
 * - Horn sits mid
 * - Trumpets take top two notes
 *
 * This is a FIRST PASS arrangement for testing pipeline integrity.
 * Later we’ll add idiomatic brass ranges/articulations, transposition, and voice-leading.
 */
export function mapPianoToBrassEnsembleOpen(score: ScoreModel): ScoreModel {
  const partsOut = BRASS_ENSEMBLE_PARTS.map((p) => makePart(p.part_id, p.name, p.instrument, p.staves));

  const srcPart = score.parts?.[0];
  if (!srcPart || !Array.isArray(srcPart.measures)) {
    return {
      score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
      meta: { ensemble: "brass_ensemble" },
      global: { ...score.global },
      parts: partsOut
    } as any;
  }

  const measureMap: Record<number, any[]> = {};

  for (const m of srcPart.measures) {
    const shells = partsOut.map(() => cloneMeasureShell(m));
    const mNum = Number(m.number ?? 1);
    measureMap[mNum] = shells;
    for (let i = 0; i < partsOut.length; i++) partsOut[i].measures.push(shells[i]);
  }

  const chords = extractOnsetChords(score);

  // Use a safe view for catalog lookups (avoids TS property errors)
  const CATALOG: any = InstrumentCatalog as any;

  for (const ch of chords) {
    const mNum = Number(ch.measure ?? 1);
    const mShells = measureMap[mNum];
    if (!mShells) continue;

    const notes = (ch.notes ?? []).slice().sort((a: any, b: any) => a.midi - b.midi);
    if (notes.length === 0) continue;

    const t = Number(ch.t ?? 0);
    const dur = Math.max(...notes.map((n: any) => Number(n.dur ?? 480)), 1);

    const low = notes[0].midi;
    const high = notes[notes.length - 1].midi;

    // pick helper mids
    const mid1 = notes[Math.min(1, notes.length - 1)].midi;
    const mid2 = notes[Math.min(2, notes.length - 1)].midi;

    // Assign raw midis (we’ll range-fit per instrument)
    let mTuba = low;
    let mTbn = mid1;
    let mBTbn = low + 7; // support tone (approx 5th above tuba)
    let mHorn = mid2;
    let mTpt2 = high - 7; // below top
    let mTpt1 = high;

    // Range enforcement using your InstrumentCatalog
    const rTpt = CATALOG.trumpet ?? CATALOG.trumpet_bb ?? CATALOG.trumpetBb;
    const rHorn = CATALOG.horn ?? CATALOG.horn_f ?? CATALOG.f_horn;
    const rTbn = CATALOG.trombone;
    const rBTbn = CATALOG.bass_trombone ?? CATALOG.bassTrombone ?? CATALOG.trombone;
    const rTuba = CATALOG.tuba;

    if (rTpt) {
      mTpt1 = shiftOctavesIntoRange(mTpt1, rTpt.midi_low, rTpt.midi_high);
      mTpt2 = shiftOctavesIntoRange(mTpt2, rTpt.midi_low, rTpt.midi_high);
    }
    if (rHorn) mHorn = shiftOctavesIntoRange(mHorn, rHorn.midi_low, rHorn.midi_high);
    if (rTbn) mTbn = shiftOctavesIntoRange(mTbn, rTbn.midi_low, rTbn.midi_high);
    if (rBTbn) mBTbn = shiftOctavesIntoRange(mBTbn, rBTbn.midi_low, rBTbn.midi_high);
    if (rTuba) mTuba = shiftOctavesIntoRange(mTuba, rTuba.midi_low, rTuba.midi_high);

    // Write notes into the proper measure shells
    // Order matches BRASS_ENSEMBLE_PARTS
    addNote(mShells[0], t, dur, midiToPitch(mTpt1), 1, 1); // TPT1
    addNote(mShells[1], t, dur, midiToPitch(mTpt2), 1, 1); // TPT2
    addNote(mShells[2], t, dur, midiToPitch(mHorn), 1, 1); // HN
    addNote(mShells[3], t, dur, midiToPitch(mTbn), 1, 1); // TBN
    addNote(mShells[4], t, dur, midiToPitch(mBTbn), 1, 1); // BTBN
    addNote(mShells[5], t, dur, midiToPitch(mTuba), 1, 1); // TUBA
  }

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ensemble: "brass_ensemble" },
    global: { ...score.global },
    parts: partsOut
  } as any;
}