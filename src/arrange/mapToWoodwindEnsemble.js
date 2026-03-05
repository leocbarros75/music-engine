// src/arrange/mapToWoodwindEnsemble.ts
import { InstrumentCatalog, shiftOctavesIntoRange, midiToPitch } from "../instruments/instrumentCatalog";
import { extractOnsetChords } from "../analyze/chordExtractor";
function makePart(part_id, name, instrument, staves = 1) {
    return { part_id, name, instrument, staves, measures: [] };
}
function cloneMeasureShell(m) {
    return { number: m.number, attributes: { ...m.attributes }, events: [] };
}
function addNote(measure, t, dur, pitch, voice) {
    const id = `EV_${measure.number}_${t}_${voice}_${Math.random().toString(16).slice(2, 10)}`;
    measure.events.push({ id, t, dur, type: "note", pitch, voice, staff: 1 });
}
/**
 * Shift by octaves to land as close as possible to a target center,
 * while staying within [lo, hi].
 */
function shiftOctavesToward(midi, lo, hi, center) {
    let m = shiftOctavesIntoRange(midi, lo, hi);
    const candidates = [];
    for (let k = -4; k <= 4; k++) {
        const c = m + 12 * k;
        if (c >= lo && c <= hi)
            candidates.push(c);
    }
    if (candidates.length === 0)
        return m;
    let best = candidates[0];
    let bestDist = Math.abs(best - center);
    for (const c of candidates) {
        const d = Math.abs(c - center);
        if (d < bestDist) {
            best = c;
            bestDist = d;
        }
    }
    return best;
}
/**
 * Woodwind ensemble mapping (Option 1, Concert Pitch View):
 * Flute (C), Oboe (C), Clarinet in Bb (shows concert pitch), Bassoon (C)
 *
 * IMPORTANT:
 * - Because you chose concert pitch view, we store + export concert pitches.
 * - The exporter should NOT emit <transpose> tags for this view.
 */
export function mapPianoToWoodwindEnsembleOpen(score) {
    const fl = makePart("FL", "Flute", "flute", 1);
    const ob = makePart("OB", "Oboe", "oboe", 1);
    const cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
    const bn = makePart("BN", "Bassoon", "bassoon", 1);
    const partsOut = [fl, ob, cl, bn];
    const srcPart = score.parts[0];
    const measureMap = {};
    for (const m of srcPart.measures) {
        const shells = partsOut.map(() => cloneMeasureShell(m));
        measureMap[String(m.number)] = shells;
        fl.measures.push(shells[0]);
        ob.measures.push(shells[1]);
        cl.measures.push(shells[2]);
        bn.measures.push(shells[3]);
    }
    const chords = extractOnsetChords(score);
    // Use catalog ranges so exporter + mapper stay aligned
    const rFL = InstrumentCatalog.flute;
    const rOB = InstrumentCatalog.oboe;
    const rCL = InstrumentCatalog.clarinet_bb;
    const rBN = InstrumentCatalog.bassoon;
    // Centers to avoid octave “ladder” results (concert pitch view)
    const CENTER_FL = 79; // ~G5
    const CENTER_OB = 74; // ~D5
    const CENTER_CL = 69; // ~A4
    const CENTER_BN = 46; // ~Bb2
    for (const ch of chords) {
        const shells = measureMap[String(ch.measure)];
        if (!shells)
            continue;
        const notes = ch.notes.slice().sort((a, b) => a.midi - b.midi);
        if (notes.length === 0)
            continue;
        const t = ch.t;
        const dur = Math.max(...notes.map(n => n.dur ?? 480), 1);
        const pick = (idx) => notes[Math.min(Math.max(idx, 0), notes.length - 1)].midi;
        const low = pick(0);
        const mid1 = pick(Math.floor((notes.length - 1) * 0.33));
        const mid2 = pick(Math.floor((notes.length - 1) * 0.66));
        const high = pick(notes.length - 1);
        // Assign low->high: BN, CL, OB, FL
        let mBN = low;
        let mCL = mid1;
        let mOB = mid2;
        let mFL = high;
        // Pull toward centers and into catalog ranges
        mBN = shiftOctavesToward(mBN, rBN.midi_low, rBN.midi_high, CENTER_BN);
        mCL = shiftOctavesToward(mCL, rCL.midi_low, rCL.midi_high, CENTER_CL);
        mOB = shiftOctavesToward(mOB, rOB.midi_low, rOB.midi_high, CENTER_OB);
        mFL = shiftOctavesToward(mFL, rFL.midi_low, rFL.midi_high, CENTER_FL);
        // Prevent crossings: BN <= CL <= OB <= FL
        if (mCL < mBN)
            mCL = shiftOctavesToward(mCL + 12, rCL.midi_low, rCL.midi_high, CENTER_CL);
        if (mOB < mCL)
            mOB = shiftOctavesToward(mOB + 12, rOB.midi_low, rOB.midi_high, CENTER_OB);
        if (mFL < mOB)
            mFL = shiftOctavesToward(mFL + 12, rFL.midi_low, rFL.midi_high, CENTER_FL);
        addNote(shells[0], t, dur, midiToPitch(mFL), 1); // Flute
        addNote(shells[1], t, dur, midiToPitch(mOB), 1); // Oboe
        addNote(shells[2], t, dur, midiToPitch(mCL), 1); // Clarinet (concert pitch view)
        addNote(shells[3], t, dur, midiToPitch(mBN), 1); // Bassoon
    }
    return {
        score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
        meta: { ensemble: "woodwind_ensemble" },
        global: { ...score.global },
        parts: partsOut
    };
}
//# sourceMappingURL=mapToWoodwindEnsemble.js.map