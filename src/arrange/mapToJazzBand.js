// src/arrange/mapToJazzBand.ts
import { shiftOctavesIntoRange, midiToPitch } from "../instruments/instrumentCatalog";
import { extractOnsetChords } from "../analyze/chordExtractor";
const STYLE_PRESETS = {
    swing: {
        style: "swing",
        pianoAddBeat4: true,
        pianoAddAnticipation: true,
        drumEnableSwingOffbeats: true,
        drumAddSnareComping: true,
        drumCrashOnSectionStarts: true
    },
    bossa: {
        style: "bossa",
        pianoAddBeat4: true,
        pianoAddAnticipation: false,
        drumEnableSwingOffbeats: false,
        drumAddSnareComping: true,
        drumCrashOnSectionStarts: true
    },
    ballad: {
        style: "ballad",
        pianoAddBeat4: false,
        pianoAddAnticipation: false,
        drumEnableSwingOffbeats: false,
        drumAddSnareComping: false,
        drumCrashOnSectionStarts: true
    }
};
function resolveOptions(opts) {
    const style = opts?.style ?? "swing";
    const preset = STYLE_PRESETS[style];
    return {
        style,
        pianoAddBeat4: opts?.pianoAddBeat4 ?? preset.pianoAddBeat4,
        pianoAddAnticipation: opts?.pianoAddAnticipation ?? preset.pianoAddAnticipation,
        drumEnableSwingOffbeats: opts?.drumEnableSwingOffbeats ?? preset.drumEnableSwingOffbeats,
        drumAddSnareComping: opts?.drumAddSnareComping ?? preset.drumAddSnareComping,
        drumCrashOnSectionStarts: opts?.drumCrashOnSectionStarts ?? preset.drumCrashOnSectionStarts
    };
}
function makePart(part_id, name, instrument, staves = 1) {
    return { part_id, name, instrument, staves, measures: [] };
}
function cloneMeasureShell(m) {
    return { number: m.number, attributes: { ...m.attributes }, events: [] };
}
function addNote(measure, t, dur, pitch, voice, staff) {
    const id = `EV_${measure.number}_${t}_${voice}_${staff}_${Math.random().toString(16).slice(2, 10)}`;
    measure.events.push({ id, t, dur, type: "note", pitch, voice, staff });
}
function addRest(measure, t, dur, voice, staff = 1) {
    const id = `REST_${measure.number}_${t}_${voice}_${staff}_${Math.random().toString(16).slice(2, 10)}`;
    measure.events.push({ id, t, dur, type: "rest", voice, staff });
}
/**
 * Unpitched drum event writer.
 * Uses canonical instrumentId strings that match the exporter map.
 */
function addUnpitched(measure, t, dur, instrumentId, voice, staff = 1) {
    const id = `UP_${measure.number}_${t}_${voice}_${staff}_${instrumentId}_${Math.random().toString(16).slice(2, 10)}`;
    measure.events.push({ id, t, dur, type: "unpitched", instrumentId, voice, staff });
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
function clampInt(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
function pickChordMidiNotes(ch) {
    const notes = (ch?.notes ?? []).slice().sort((a, b) => (a.midi ?? 0) - (b.midi ?? 0));
    return notes.map((n) => n.midi).filter((m) => typeof m === "number");
}
function chooseChordForTime(chordsInMeasure, targetT) {
    if (!chordsInMeasure || chordsInMeasure.length === 0)
        return null;
    const sorted = chordsInMeasure.slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    // Prefer the last chord at or before targetT
    let best = null;
    for (const ch of sorted) {
        const t = ch.t ?? 0;
        if (t <= targetT)
            best = ch;
        if (t > targetT)
            break;
    }
    return best ?? sorted[0] ?? null;
}
function unique2(a, b) {
    if (a === b)
        return [b, null];
    return a <= b ? [a, b] : [b, a];
}
function drumId(kind) {
    return kind;
}
/**
 * Rhythm patterns
 * Intentionally simple and readable.
 */
const DRUM_HIT_DUR_FRACTION = 8; // dur = divisions / 8 (short hits)
/**
 * Write drums for the chosen style.
 * Uses unpitched events with canonical instrumentId values.
 */
function writeDrumsForStyle(measure, divisions, beats, preset, isSectionStart) {
    const beatDur = divisions;
    const hitDur = Math.max(Math.floor(divisions / DRUM_HIT_DUR_FRACTION), 1);
    const barDur = beats * beatDur;
    const addAtBeat = (beatIndex0, kind) => {
        const t = beatIndex0 * beatDur;
        if (t >= 0 && t < barDur)
            addUnpitched(measure, t, hitDur, drumId(kind), 1, 1);
    };
    const addAtOffset = (t, kind, durOverride) => {
        if (t >= 0 && t < barDur)
            addUnpitched(measure, t, durOverride ?? hitDur, drumId(kind), 1, 1);
    };
    // Crash on section starts (very light marker)
    if (preset.drumCrashOnSectionStarts && isSectionStart) {
        addAtOffset(0, "crash");
    }
    if (preset.style === "swing") {
        // Ride quarters
        for (let b = 0; b < beats; b++)
            addAtBeat(b, "ride");
        // Hi-hat on 2 and 4
        if (beats >= 2)
            addAtBeat(1, "hihat_closed");
        if (beats >= 4)
            addAtBeat(3, "hihat_closed");
        // Kick on 1 (light)
        addAtBeat(0, "kick");
        // Optional light snare comping (keep it simple)
        // Add soft snare on 2 and 4, plus a tiny ghost on "and of 2" for motion.
        if (preset.drumAddSnareComping) {
            if (beats >= 2)
                addAtBeat(1, "snare");
            if (beats >= 4)
                addAtBeat(3, "snare");
            // Ghost: "and of 2" (beat 2 + eighth)
            const ghostDur = Math.max(Math.floor(hitDur / 2), 1);
            const tAndOf2 = 1 * beatDur + Math.floor(beatDur / 2);
            addAtOffset(tAndOf2, "snare", ghostDur);
        }
        // Optional light swing skip offbeats (triplet-ish placement): 2/3 of a beat
        if (preset.drumEnableSwingOffbeats) {
            const swingOffset = Math.round((2 * beatDur) / 3);
            addAtOffset(0 + swingOffset, "ride");
            if (beats >= 3)
                addAtOffset(2 * beatDur + swingOffset, "ride");
        }
        return;
    }
    if (preset.style === "bossa") {
        // Simple bossa-ish: kick on 1 and 3, snare on 2 and 4, light hat on all beats
        addAtBeat(0, "kick");
        if (beats >= 3)
            addAtBeat(2, "kick");
        if (beats >= 2)
            addAtBeat(1, "snare");
        if (beats >= 4)
            addAtBeat(3, "snare");
        for (let b = 0; b < beats; b++)
            addAtBeat(b, "hihat_closed");
        // Optional extra comping: small snare pickup on "and of 4"
        if (preset.drumAddSnareComping && beats >= 4) {
            const ghostDur = Math.max(Math.floor(hitDur / 2), 1);
            const tAndOf4 = 3 * beatDur + Math.floor(beatDur / 2);
            addAtOffset(tAndOf4, "snare", ghostDur);
        }
        return;
    }
    // ballad
    {
        // Very light: ride on 1 (and optionally 3), soft kick on 1, hat on 3 when present
        addAtBeat(0, "kick");
        addAtBeat(0, "ride");
        if (beats >= 3)
            addAtBeat(2, "ride");
        if (beats >= 3)
            addAtBeat(2, "hihat_closed");
        // Optional very gentle snare on 3 (only if enabled)
        if (preset.drumAddSnareComping && beats >= 3) {
            addAtBeat(2, "snare");
        }
    }
}
/**
 * Jazz Band mapping:
 * Alto Sax (Eb), Tenor Sax (Bb), Trumpet (Bb), Trombone (C), Piano (C), Bass (C), Drums (style preset)
 *
 * Notes:
 * - We store pitches in concert in the ScoreModel.
 * - The exporter handles written pitch/key for transposing parts via <transpose>.
 * - Bass stays as-is per your request.
 */
export function mapPianoToJazzBandOpen(score, options) {
    const preset = resolveOptions(options);
    const asx = makePart("ASX", "Alto Sax", "alto_sax_eb", 1);
    const tsx = makePart("TSX", "Tenor Sax", "tenor_sax_bb", 1);
    const tpt = makePart("TPT", "Trumpet", "trumpet_bb", 1);
    const tbn = makePart("TBN", "Trombone", "trombone", 1);
    const pno = makePart("PNO", "Piano", "piano", 2);
    const bas = makePart("BASS", "Bass", "bass", 1);
    const drm = makePart("DRUMS", "Drums", "drums", 1);
    const partsOut = [asx, tsx, tpt, tbn, pno, bas, drm];
    const srcPart = score.parts?.[0];
    if (!srcPart?.measures || srcPart.measures.length === 0) {
        throw new Error("Parsed scoreModel has no measures in parts[0]. Check parser output.");
    }
    const chords = extractOnsetChords(score);
    // Group chords by measure number for measure-based piano comping + section-start heuristics
    const chordsByMeasure = {};
    for (const ch of chords) {
        const key = String(ch.measure);
        if (!chordsByMeasure[key])
            chordsByMeasure[key] = [];
        chordsByMeasure[key].push(ch);
    }
    const measureMap = {};
    for (let i = 0; i < srcPart.measures.length; i++) {
        const m = srcPart.measures[i];
        const shells = partsOut.map(() => cloneMeasureShell(m));
        measureMap[String(m.number)] = shells;
        asx.measures.push(shells[0]);
        tsx.measures.push(shells[1]);
        tpt.measures.push(shells[2]);
        tbn.measures.push(shells[3]);
        pno.measures.push(shells[4]);
        bas.measures.push(shells[5]);
        drm.measures.push(shells[6]);
        const divisions = m?.attributes?.divisions ?? score?.global?.divisions ?? 480;
        const beats = m?.attributes?.time?.beats ?? 4;
        // Section start heuristic:
        // - measure 1 is always a section start
        // - any measure that has chords, but the previous measure had none, is treated as a new section
        const chordsHere = chordsByMeasure[String(m.number)] ?? [];
        const prevMeasure = i > 0 ? srcPart.measures[i - 1] : null;
        const prevChords = prevMeasure ? (chordsByMeasure[String(prevMeasure.number)] ?? []) : [];
        const isSectionStart = m.number === 1 || (chordsHere.length > 0 && prevChords.length === 0);
        // Drums once per measure
        writeDrumsForStyle(shells[6], divisions, beats, preset, isSectionStart);
        // Piano RH comping per measure (beat 2 only, optional beat 4 and anticipation)
        const beatDur = divisions;
        const tBeat2 = 1 * beatDur;
        const tBeat4 = 3 * beatDur;
        const tAntic = 3 * beatDur + Math.floor(beatDur / 2); // "and of 4"
        const refChord = chooseChordForTime(chordsHere, tBeat2) ?? chooseChordForTime(chordsHere, 0);
        const chordMidis = refChord ? pickChordMidiNotes(refChord) : [];
        if (chordMidis.length > 0) {
            const notesSorted = chordMidis.slice().sort((a, b) => a - b);
            const pick = (idx) => notesSorted[clampInt(idx, 0, notesSorted.length - 1)];
            const low = pick(0);
            const mid2 = pick(Math.floor((notesSorted.length - 1) * 0.5));
            const high = pick(notesSorted.length - 1);
            // Piano ranges (concert)
            const PNO_LH_LO = 36, PNO_LH_HI = 60; // C2..C4
            const PNO_RH_LO = 55, PNO_RH_HI = 88; // G3..E6
            const C_PNO_LH = 45; // A2
            const C_PNO_RH = 67; // G4
            // LH anchor: one low note at beat 1 only
            const mPNO_LH = shiftOctavesToward(low, PNO_LH_LO, PNO_LH_HI, C_PNO_LH);
            // RH 2-note voicing (avoid duplicates)
            let mPNO_RH1 = shiftOctavesToward(mid2, PNO_RH_LO, PNO_RH_HI, C_PNO_RH);
            let mPNO_RH2 = shiftOctavesToward(high, PNO_RH_LO, PNO_RH_HI, C_PNO_RH);
            const [r1, r2] = unique2(mPNO_RH1, mPNO_RH2);
            mPNO_RH1 = r1;
            mPNO_RH2 = r2 ?? r1;
            // LH on staff 2 at beat 1 (voice 2)
            addNote(shells[4], 0, beatDur, midiToPitch(mPNO_LH), 2, 2);
            // RH ONLY on beat 2 (voice 1, staff 1)
            addNote(shells[4], tBeat2, beatDur, midiToPitch(mPNO_RH1), 1, 1);
            if (mPNO_RH2 !== mPNO_RH1)
                addNote(shells[4], tBeat2, beatDur, midiToPitch(mPNO_RH2), 1, 1);
            // Optional beat 4
            if (preset.pianoAddBeat4 && beats >= 4) {
                addNote(shells[4], tBeat4, beatDur, midiToPitch(mPNO_RH1), 1, 1);
                if (mPNO_RH2 !== mPNO_RH1)
                    addNote(shells[4], tBeat4, beatDur, midiToPitch(mPNO_RH2), 1, 1);
            }
            // Optional anticipation ("and of 4")
            if (preset.pianoAddAnticipation && beats >= 4) {
                const anticDur = Math.max(Math.floor(beatDur / 2), 1);
                addNote(shells[4], tAntic, anticDur, midiToPitch(mPNO_RH1), 1, 1);
                if (mPNO_RH2 !== mPNO_RH1)
                    addNote(shells[4], tAntic, anticDur, midiToPitch(mPNO_RH2), 1, 1);
            }
        }
    }
    // Ranges in MIDI (concert). Exporter writes transposed instruments as needed.
    const ASX_LO = 49, ASX_HI = 80; // Alto Sax concert
    const TSX_LO = 44, TSX_HI = 75; // Tenor Sax concert
    const TPT_LO = 54, TPT_HI = 84; // Trumpet concert
    const TBN_LO = 40, TBN_HI = 70; // Trombone concert
    const BAS_LO = 28, BAS_HI = 60; // Bass concert
    // Centers (stability)
    const C_ASX = 69; // A4
    const C_TSX = 60; // C4
    const C_TPT = 72; // C5
    const C_TBN = 52; // E3
    const C_BAS = 40; // E2
    for (const ch of chords) {
        const shells = measureMap[String(ch.measure)];
        if (!shells)
            continue;
        const notes = ch.notes.slice().sort((a, b) => a.midi - b.midi);
        if (notes.length === 0)
            continue;
        const t = ch.t;
        const dur = Math.max(...notes.map((n) => n.dur ?? 480), 1);
        const pick = (idx) => notes[Math.min(Math.max(idx, 0), notes.length - 1)].midi;
        const low = pick(0);
        const mid1 = pick(Math.floor((notes.length - 1) * 0.25));
        const mid2 = pick(Math.floor((notes.length - 1) * 0.5));
        const mid3 = pick(Math.floor((notes.length - 1) * 0.75));
        const high = pick(notes.length - 1);
        // Rhythm section anchors
        let mBAS = low;
        let mTBN = mid1;
        // Horns
        let mTSX = mid2;
        let mASX = mid3;
        let mTPT = high;
        // Shift into ranges
        mBAS = shiftOctavesToward(mBAS, BAS_LO, BAS_HI, C_BAS);
        mTBN = shiftOctavesToward(mTBN, TBN_LO, TBN_HI, C_TBN);
        mTSX = shiftOctavesToward(mTSX, TSX_LO, TSX_HI, C_TSX);
        mASX = shiftOctavesToward(mASX, ASX_LO, ASX_HI, C_ASX);
        mTPT = shiftOctavesToward(mTPT, TPT_LO, TPT_HI, C_TPT);
        // Prevent crossings in horn line direction (bass up)
        if (mTBN < mBAS)
            mTBN = shiftOctavesToward(mTBN + 12, TBN_LO, TBN_HI, C_TBN);
        if (mTSX < mTBN)
            mTSX = shiftOctavesToward(mTSX + 12, TSX_LO, TSX_HI, C_TSX);
        if (mASX < mTSX)
            mASX = shiftOctavesToward(mASX + 12, ASX_LO, ASX_HI, C_ASX);
        if (mTPT < mASX)
            mTPT = shiftOctavesToward(mTPT + 12, TPT_LO, TPT_HI, C_TPT);
        // Write horns
        addNote(shells[0], t, dur, midiToPitch(mASX), 1, 1); // Alto Sax
        addNote(shells[1], t, dur, midiToPitch(mTSX), 1, 1); // Tenor Sax
        addNote(shells[2], t, dur, midiToPitch(mTPT), 1, 1); // Trumpet
        addNote(shells[3], t, dur, midiToPitch(mTBN), 1, 1); // Trombone
        // Bass stays as-is (your requirement)
        addNote(shells[5], t, dur, midiToPitch(mBAS), 1, 1);
        // Piano and drums are measure-based now.
    }
    return {
        score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
        meta: { ensemble: "jazz_band" },
        global: { ...score.global },
        parts: partsOut
    };
}
//# sourceMappingURL=mapToJazzBand.js.map