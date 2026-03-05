import { pitchToMidi } from "../instruments/instrumentCatalog";
export function extractOnsetChords(score) {
    const out = [];
    for (const part of score.parts) {
        for (const m of part.measures) {
            const byT = {};
            for (const ev of m.events) {
                if (ev.type !== "note")
                    continue;
                const t = ev.t ?? 0;
                if (!byT[t])
                    byT[t] = { measure: m.number, t, notes: [] };
                const p = { step: ev.pitch.step, alter: ev.pitch.alter, octave: ev.pitch.octave };
                const midi = pitchToMidi(p);
                byT[t].notes.push({
                    id: ev.id,
                    midi,
                    pitch: p,
                    staff: ev.staff ?? 1,
                    voice: ev.voice ?? 1
                });
            }
            const times = Object.keys(byT).map(Number).sort((a, b) => a - b);
            for (const t of times)
                out.push(byT[t]);
        }
    }
    return out;
}
//# sourceMappingURL=chordExtractor.js.map