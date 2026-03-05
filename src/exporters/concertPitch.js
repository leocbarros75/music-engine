import { pitchToMidi, midiToPitch } from "../instruments/instrumentCatalog";
/**
 * Written → Concert pitch offsets (in semitones)
 *
 * Example:
 * Trumpet in Bb:
 *   written C sounds Bb → concert = written - 2
 *
 * Horn in F:
 *   written C sounds F → concert = written - 7
 */
const WRITTEN_TO_CONCERT = {
    // Brass
    trumpet_bb: -2,
    trumpet_bb_1: -2,
    trumpet_bb_2: -2,
    horn_f: -7,
    // Non-transposing
    trombone: 0,
    tuba: 0,
    tuba_c: 0,
    // Strings / keyboard
    piano: 0,
    violin: 0,
    violin_1: 0,
    violin_2: 0,
    viola: 0,
    cello: 0
};
function getSemitoneShift(instrument) {
    if (typeof instrument !== "string")
        return 0;
    return WRITTEN_TO_CONCERT[instrument] ?? 0;
}
/**
 * Returns a NEW ScoreModel converted to concert pitch.
 * Original scoreModel is untouched.
 */
export function scoreModelToConcertPitch(score) {
    const out = {
        score_id: score.score_id,
        meta: { ...score.meta, view: "concert_pitch" },
        global: { ...score.global },
        parts: []
    };
    for (const part of score.parts ?? []) {
        const shift = getSemitoneShift(part.instrument);
        const partOut = {
            part_id: part.part_id,
            name: part.name,
            instrument: part.instrument,
            staves: part.staves ?? 1,
            measures: []
        };
        for (const m of part.measures ?? []) {
            const mOut = {
                number: m.number,
                attributes: { ...(m.attributes ?? {}) },
                events: []
            };
            for (const ev of m.events ?? []) {
                if (ev.type !== "note") {
                    // Rest or non-note event
                    mOut.events.push({ ...ev });
                    continue;
                }
                const p = ev.pitch;
                if (!p || typeof p.step !== "string" || typeof p.octave !== "number") {
                    // Defensive: malformed pitch, copy unchanged
                    mOut.events.push({ ...ev });
                    continue;
                }
                if (shift === 0) {
                    // No transposition needed
                    mOut.events.push({
                        ...ev,
                        pitch: { ...p }
                    });
                    continue;
                }
                const midiWritten = pitchToMidi({
                    step: p.step,
                    alter: p.alter,
                    octave: p.octave
                });
                const midiConcert = midiWritten + shift;
                const pConcert = midiToPitch(midiConcert);
                mOut.events.push({
                    ...ev,
                    pitch: {
                        step: pConcert.step,
                        alter: pConcert.alter,
                        octave: pConcert.octave
                    }
                });
            }
            partOut.measures.push(mOut);
        }
        out.parts.push(partOut);
    }
    return out;
}
//# sourceMappingURL=concertPitch.js.map