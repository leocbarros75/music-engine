export function detectSimpleMelody(score) {
    // Minimal: choose the highest staff-1 note at each onset
    const melodyIds = new Set();
    for (const part of score.parts) {
        for (const m of part.measures) {
            const byT = {};
            for (const ev of m.events) {
                if (ev.type !== "note")
                    continue;
                const t = ev.t ?? 0;
                if (!byT[t])
                    byT[t] = [];
                byT[t].push(ev);
            }
            for (const tStr of Object.keys(byT)) {
                const t = Number(tStr);
                const staff1 = byT[t].filter(e => e.staff === 1);
                if (staff1.length === 0)
                    continue;
                // Pick the highest by octave then step (rough)
                staff1.sort((a, b) => {
                    const ao = a.pitch?.octave ?? 0;
                    const bo = b.pitch?.octave ?? 0;
                    if (ao !== bo)
                        return bo - ao;
                    return (String(b.pitch?.step ?? "")).localeCompare(String(a.pitch?.step ?? ""));
                });
                melodyIds.add(staff1[0].id);
            }
        }
    }
    return { melody_event_ids: Array.from(melodyIds) };
}
//# sourceMappingURL=melodyDetector.js.map