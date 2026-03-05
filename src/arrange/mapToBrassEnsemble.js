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
    // first make sure it's in range somehow
    let m = shiftOctavesIntoRange(midi, lo, hi);
    // now explore octave neighbors and choose the one closest to center
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
 * Keep the brass score in WRITTEN pitch (so MuseScore can toggle “Concert Pitch” correctly
 * using the MusicXML <transpose> tags you added in the exporter).
 *
 * Key tweak here:
 * - Trumpets were drifting up an octave because the target centers were too high.
 * - Horn was landing too low in CONCERT terms (written too low) — raise its written center.
 */
export function mapPianoToBrassEnsembleOpen(score) {
    // Brass parts (written instruments)
    const tpt1 = makePart("TPT1", "Trumpet 1", "trumpet_bb_1", 1);
    const tpt2 = makePart("TPT2", "Trumpet 2", "trumpet_bb_2", 1);
    const hn = makePart("HN", "Horn", "horn_f", 1);
    const tbn = makePart("TBN", "Trombone", "trombone", 1);
    const tuba = makePart("TUBA", "Tuba", "tuba_c", 1);
    const partsOut = [tpt1, tpt2, hn, tbn, tuba];
    // measure shells from source part 0
    const srcPart = score.parts[0];
    const measureMap = {};
    for (const m of srcPart.measures) {
        const shells = partsOut.map(() => cloneMeasureShell(m));
        measureMap[String(m.number)] = shells;
        tpt1.measures.push(shells[0]);
        tpt2.measures.push(shells[1]);
        hn.measures.push(shells[2]);
        tbn.measures.push(shells[3]);
        tuba.measures.push(shells[4]);
    }
    const chords = extractOnsetChords(score);
    // Must exist in InstrumentCatalog (if any is undefined, the arranger will crash)
    const rT1 = InstrumentCatalog.trumpet_bb_1;
    const rT2 = InstrumentCatalog.trumpet_bb_2;
    const rHN = InstrumentCatalog.horn_f;
    const rTB = InstrumentCatalog.trombone;
    const rTU = InstrumentCatalog.tuba_c;
    // Target “centers” (WRITTEN MIDI) to prevent octave drift.
    //
    // Important: transposing instruments sound lower than written.
    // - Trumpet in Bb sounds M2 lower => written center slightly ABOVE desired concert center
    // - Horn in F sounds P5 lower => written center notably ABOVE desired concert center
    //
    // If you want the brass to *look* like it lives around “middle staff”,
    // keep trumpet written centers around D4/C4-ish, and horn around G4-ish.
    const CENTER_TPT1_WR = 62; // D4 (concert ~ C4)
    const CENTER_TPT2_WR = 57; // A3 (concert ~ G3)
    const CENTER_HORN_WR = 67; // G4 (concert ~ C4)
    const CENTER_TBN_WR = 52; // E3-ish
    const CENTER_TUBA_WR = 40; // E2-ish
    for (const ch of chords) {
        const shells = measureMap[String(ch.measure)];
        if (!shells)
            continue;
        const notes = ch.notes.slice().sort((a, b) => a.midi - b.midi);
        if (notes.length === 0)
            continue;
        const t = ch.t;
        const dur = Math.max(...notes.map(n => n.dur ?? 480), 1);
        // Basic spread across chord tones (allows doublings)
        const pick = (idx) => notes[Math.min(Math.max(idx, 0), notes.length - 1)].midi;
        const low = pick(0);
        const mid1 = pick(Math.floor((notes.length - 1) * 0.25));
        const mid2 = pick(Math.floor((notes.length - 1) * 0.5));
        const mid3 = pick(Math.floor((notes.length - 1) * 0.75));
        const high = pick(notes.length - 1);
        // Initial assignment (low->high conceptually)
        let mTU = low;
        let mTB = mid1;
        let mHN = mid2;
        let mT2 = mid3;
        let mT1 = high;
        // Pull each part toward its center (prevents the “everything jumped up an octave” feel)
        mTU = shiftOctavesToward(mTU, rTU.midi_low, rTU.midi_high, CENTER_TUBA_WR);
        mTB = shiftOctavesToward(mTB, rTB.midi_low, rTB.midi_high, CENTER_TBN_WR);
        mHN = shiftOctavesToward(mHN, rHN.midi_low, rHN.midi_high, CENTER_HORN_WR);
        mT2 = shiftOctavesToward(mT2, rT2.midi_low, rT2.midi_high, CENTER_TPT2_WR);
        mT1 = shiftOctavesToward(mT1, rT1.midi_low, rT1.midi_high, CENTER_TPT1_WR);
        // Prevent crossings only (allow unisons/doublings)
        // Guarantee: TUBA <= TBN <= HN <= TPT2 <= TPT1
        if (mTB < mTU)
            mTB = shiftOctavesToward(mTB + 12, rTB.midi_low, rTB.midi_high, CENTER_TBN_WR);
        if (mHN < mTB)
            mHN = shiftOctavesToward(mHN + 12, rHN.midi_low, rHN.midi_high, CENTER_HORN_WR);
        if (mT2 < mHN)
            mT2 = shiftOctavesToward(mT2 + 12, rT2.midi_low, rT2.midi_high, CENTER_TPT2_WR);
        if (mT1 < mT2)
            mT1 = shiftOctavesToward(mT1 + 12, rT1.midi_low, rT1.midi_high, CENTER_TPT1_WR);
        // Extra: keep Horn from dipping into “mud” even if still technically in range.
        // If horn ends up below a comfortable written floor, bump an octave.
        // (Adjust 55->60 if you want it consistently higher.)
        const HORN_COMFORT_FLOOR_WR = 55; // G3 written (concert ~ C3)
        if (mHN < HORN_COMFORT_FLOOR_WR) {
            mHN = shiftOctavesToward(mHN + 12, rHN.midi_low, rHN.midi_high, CENTER_HORN_WR);
            if (mT2 < mHN)
                mT2 = shiftOctavesToward(mT2 + 12, rT2.midi_low, rT2.midi_high, CENTER_TPT2_WR);
            if (mT1 < mT2)
                mT1 = shiftOctavesToward(mT1 + 12, rT1.midi_low, rT1.midi_high, CENTER_TPT1_WR);
        }
        addNote(shells[0], t, dur, midiToPitch(mT1), 1); // TPT1 (written)
        addNote(shells[1], t, dur, midiToPitch(mT2), 1); // TPT2 (written)
        addNote(shells[2], t, dur, midiToPitch(mHN), 1); // HN (written, Horn in F)
        addNote(shells[3], t, dur, midiToPitch(mTB), 1); // TBN (concert)
        addNote(shells[4], t, dur, midiToPitch(mTU), 1); // TUBA (concert)
    }
    return {
        score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
        meta: { ensemble: "brass_ensemble" },
        global: { ...score.global },
        parts: partsOut
    };
}
//# sourceMappingURL=mapToBrassEnsemble.js.map