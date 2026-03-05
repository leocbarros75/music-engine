// src/arrange/mapToEnsemble.ts
// src/arrange/mapToEnsemble.ts
import { FULL_ORCHESTRA_PARTS } from "../instruments/fullOrchestra";
import { InstrumentCatalog, shiftOctavesIntoRange, midiToPitch } from "../instruments/instrumentCatalog";
import { extractOnsetChords } from "../analyze/chordExtractor";
function makePart(part_id, name, instrument, staves = 1) {
    return {
        part_id,
        name,
        instrument,
        staves,
        measures: []
    };
}
function cloneMeasureShell(m) {
    return {
        number: m.number,
        attributes: { ...m.attributes },
        events: []
    };
}
function addNote(measure, t, dur, pitch, voice, staff) {
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
function addRest(measure, t, dur, voice, staff) {
    const id = `REST_${measure.number}_${t}_${staff}_${voice}_${Math.random().toString(16).slice(2, 10)}`;
    measure.events.push({
        id,
        t,
        dur,
        type: "rest",
        voice,
        staff
    });
}
/**
 * Existing mapping you already had.
 * Keeps string quartet open spacing heuristics.
 */
export function mapPianoToStringQuartetOpen(score) {
    const v1 = makePart("V1", "Violin I", "violin", 1);
    const v2 = makePart("V2", "Violin II", "violin", 1);
    const va = makePart("VA", "Viola", "viola", 1);
    const vc = makePart("VC", "Cello", "cello", 1);
    const partsOut = [v1, v2, va, vc];
    const srcPart = score.parts[0];
    const measureMap = {};
    for (const m of srcPart.measures) {
        const shells = partsOut.map(() => cloneMeasureShell(m));
        measureMap[String(m.number)] = shells;
        v1.measures.push(shells[0]);
        v2.measures.push(shells[1]);
        va.measures.push(shells[2]);
        vc.measures.push(shells[3]);
    }
    const chords = extractOnsetChords(score);
    for (const ch of chords) {
        const mNum = ch.measure;
        const mShells = measureMap[String(mNum)];
        if (!mShells)
            continue;
        const notes = ch.notes.slice().sort((a, b) => a.midi - b.midi);
        if (notes.length === 0)
            continue;
        const t = ch.t;
        const dur = Math.max(...notes.map(n => n.dur ?? 480), 1);
        const low = notes[0];
        const high = notes[notes.length - 1];
        const inner = notes.slice(1, Math.max(1, notes.length - 1));
        let midLow = inner.length > 0 ? inner[0] : null;
        let midHigh = inner.length > 1 ? inner[inner.length - 1] : null;
        if (!midLow && notes.length >= 2)
            midLow = notes[0];
        if (!midHigh && notes.length >= 2)
            midHigh = notes[1] ?? notes[0];
        let mV1 = high.midi;
        let mVC = low.midi;
        let mVA = midLow ? midLow.midi : low.midi;
        let mV2 = midHigh ? midHigh.midi : high.midi;
        while (mV2 >= mV1 - 3)
            mV2 -= 12;
        while (mVA >= mV2 - 3)
            mVA -= 12;
        while (mVC >= mVA - 7)
            mVC -= 12;
        const rV1 = InstrumentCatalog.violin_1;
        const rV2 = InstrumentCatalog.violin_2;
        const rVA = InstrumentCatalog.viola;
        const rVC = InstrumentCatalog.cello;
        mV1 = shiftOctavesIntoRange(mV1, rV1.midi_low, rV1.midi_high);
        mV2 = shiftOctavesIntoRange(mV2, rV2.midi_low, rV2.midi_high);
        mVA = shiftOctavesIntoRange(mVA, rVA.midi_low, rVA.midi_high);
        mVC = shiftOctavesIntoRange(mVC, rVC.midi_low, rVC.midi_high);
        if (mV2 >= mV1)
            mV2 = shiftOctavesIntoRange(mV2 - 12, rV2.midi_low, rV2.midi_high);
        if (mVA >= mV2)
            mVA = shiftOctavesIntoRange(mVA - 12, rVA.midi_low, rVA.midi_high);
        if (mVC >= mVA)
            mVC = shiftOctavesIntoRange(mVC - 12, rVC.midi_low, rVC.midi_high);
        addNote(mShells[0], t, dur, midiToPitch(mV1), 1, 1);
        addNote(mShells[1], t, dur, midiToPitch(mV2), 1, 1);
        addNote(mShells[2], t, dur, midiToPitch(mVA), 1, 1);
        addNote(mShells[3], t, dur, midiToPitch(mVC), 1, 1);
    }
    return {
        score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
        meta: { ensemble: "string_quartet" },
        global: { ...score.global },
        parts: partsOut
    };
}
/**
 * NEW: Basic "full_orchestra" mapping.
 * Goal: get a valid multi-part score, preserve rhythm on onsets, keep notes in range.
 * This is intentionally simple and conservative.
 */
export function mapPianoToFullOrchestraBasic(score) {
    const srcPart = score.parts[0];
    const chords = extractOnsetChords(score);
    // Build output parts from FULL_ORCHESTRA_PARTS
    const partsOut = FULL_ORCHESTRA_PARTS.map(p => makePart(p.part_id, p.name, p.instrument, p.staves));
    const partById = {};
    for (const p of partsOut)
        partById[p.part_id] = p;
    // Create measure shells for every part
    const measureShellsByPartAndNum = {};
    for (const p of partsOut)
        measureShellsByPartAndNum[p.part_id] = {};
    for (const m of srcPart.measures) {
        for (const p of partsOut) {
            const shell = cloneMeasureShell(m);
            p.measures.push(shell);
            measureShellsByPartAndNum[p.part_id][String(m.number)] = shell;
        }
    }
    // Helpers
    const pickRange = (instrument) => {
        const key = instrument;
        const found = InstrumentCatalog[key];
        if (found)
            return found;
        // fallback to a safe violin-like range if unknown
        return { midi_low: 55, midi_high: 103 };
    };
    const putNote = (partId, measureNum, t, dur, midi, voice) => {
        const m = measureShellsByPartAndNum[partId]?.[String(measureNum)];
        if (!m)
            return;
        const inst = partById[partId]?.instrument ?? "violin";
        const r = pickRange(inst);
        const mm = shiftOctavesIntoRange(midi, r.midi_low, r.midi_high);
        addNote(m, t, dur, midiToPitch(mm), voice, 1);
    };
    // Part IDs (match fullOrchestra.ts)
    const P_VN1 = "P1";
    const P_VN2 = "P2";
    const P_VLA = "P3";
    const P_VC = "P4";
    const P_CB = "P5";
    const P_FL = "P6";
    const P_OB = "P7";
    const P_CL = "P8";
    const P_BN = "P9";
    const P_HN = "P10";
    const P_TPT = "P11";
    const P_TBN = "P12";
    const P_TBA = "P13";
    const P_TIMP = "P14";
    // Simple distribution:
    // - Strings carry main 4 voices (vn1 high, vn2 upper-mid, vla lower-mid, vc low)
    // - Bass doubles cello down an octave when possible
    // - Winds lightly double vn1 or inner tones
    // - Brass sustain roots/fifths on strong beats only
    // - Timpani hits root on strong beats only
    for (const ch of chords) {
        const mNum = ch.measure;
        const notes = ch.notes.slice().sort((a, b) => a.midi - b.midi);
        if (notes.length === 0)
            continue;
        const t = ch.t;
        const dur = Math.max(...notes.map(n => n.dur ?? 480), 1);
        const low = notes[0].midi;
        const high = notes[notes.length - 1].midi;
        const inner = notes.slice(1, Math.max(1, notes.length - 1)).map(n => n.midi);
        // choose two inner tones
        const mid1 = inner.length > 0 ? inner[0] : low;
        const mid2 = inner.length > 1 ? inner[inner.length - 1] : high;
        // Strings
        putNote(P_VN1, mNum, t, dur, high, 1);
        putNote(P_VN2, mNum, t, dur, mid2, 1);
        putNote(P_VLA, mNum, t, dur, mid1, 1);
        putNote(P_VC, mNum, t, dur, low, 1);
        // Bass, usually octave below cello
        putNote(P_CB, mNum, t, dur, low - 12, 1);
        // Winds: gentle doubling (keep thin)
        if (t % (score.global?.divisions ?? 480) === 0) {
            putNote(P_FL, mNum, t, dur, high + 12, 1);
            putNote(P_OB, mNum, t, dur, high, 1);
            putNote(P_CL, mNum, t, dur, mid2, 1);
            putNote(P_BN, mNum, t, dur, low, 1);
        }
        // Brass and timp: only on strong beats (downbeat or halfway)
        const div = score.global?.divisions ?? 480;
        const strong = (t % (div * 2) === 0);
        if (strong) {
            // root approximation: use low note as root proxy (good enough for now)
            putNote(P_HN, mNum, t, dur, mid1, 1);
            putNote(P_TPT, mNum, t, dur, mid2, 1);
            putNote(P_TBN, mNum, t, dur, low, 1);
            putNote(P_TBA, mNum, t, dur, low - 12, 1);
            putNote(P_TIMP, mNum, t, dur, low, 1);
        }
        else {
            // optional rests to keep parts valid, but not required
            // we leave events empty for lighter texture
        }
    }
    return {
        score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
        meta: { ensemble: "full_orchestra" },
        global: { ...score.global },
        parts: partsOut
    };
}
/**
 * Dispatcher. This is the piece you were missing.
 * Your arrange endpoint should call this.
 */
export function mapToEnsemble(score, ensemble) {
    if (ensemble === "string_quartet")
        return mapPianoToStringQuartetOpen(score);
    if (ensemble === "full_orchestra")
        return mapPianoToFullOrchestraBasic(score);
    throw new Error(`Unsupported target ensemble: ${ensemble}`);
}
//# sourceMappingURL=mapToEnsemble.js.map