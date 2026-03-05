import { clampPitchToInstrumentRange, pitchToMidi } from "../instruments/instrumentCatalog";
import { applyParticipationByPhrase } from "./applyParticipation";
import { enforceRanges } from "./enforceRanges";
function clone(x) {
    return JSON.parse(JSON.stringify(x));
}
function isNote(ev) {
    return ev && ev.type === "note" && ev.pitch && typeof ev.pitch.step === "string" && typeof ev.pitch.octave === "number";
}
function groupEventsByTime(events) {
    const m = new Map();
    for (const ev of events ?? []) {
        const t = typeof ev.t === "number" ? ev.t : 0;
        const arr = m.get(t) ?? [];
        arr.push(ev);
        m.set(t, arr);
    }
    return m;
}
function pickByRegister(eventsAtTime, which) {
    const notes = (eventsAtTime ?? []).filter(isNote);
    const others = (eventsAtTime ?? []).filter((e) => !isNote(e));
    if (notes.length === 0)
        return [...others];
    const sorted = [...notes].sort((a, b) => pitchToMidi(a.pitch) - pitchToMidi(b.pitch));
    let chosen;
    if (which === "low")
        chosen = sorted[0];
    else if (which === "high")
        chosen = sorted[sorted.length - 1];
    else
        chosen = sorted[Math.floor(sorted.length / 2)];
    return [chosen, ...others.filter((e) => e.type !== "rest")];
}
function mapMeasureEvents(srcEvents, instrumentId, role) {
    const byTime = groupEventsByTime(srcEvents ?? []);
    const out = [];
    const times = [...byTime.keys()].sort((a, b) => a - b);
    for (const t of times) {
        const slice = byTime.get(t) ?? [];
        const picked = role === "bass" ? pickByRegister(slice, "low") : role === "melody" ? pickByRegister(slice, "high") : pickByRegister(slice, "mid");
        for (const ev of picked) {
            if (isNote(ev)) {
                const p2 = clampPitchToInstrumentRange(ev.pitch, instrumentId);
                out.push({ ...ev, pitch: p2 });
            }
            else {
                out.push(ev);
            }
        }
    }
    return out;
}
function getFirstPart(score) {
    const parts = score?.parts ?? [];
    if (!Array.isArray(parts) || parts.length === 0)
        return null;
    return parts[0];
}
function buildPartFromSource(score, srcPart, part_id, name, instrument, role) {
    const srcMeasures = srcPart?.measures ?? [];
    const measures = (srcMeasures ?? []).map((m) => {
        const events = mapMeasureEvents(m?.events ?? [], instrument, role);
        return { ...clone(m), events };
    });
    return {
        part_id,
        name,
        instrument,
        staves: 1,
        measures
    };
}
/**
 * Map a piano (or any single source part) ScoreModel into a full orchestra scaffold,
 * then apply classical participation + range enforcement.
 *
 * - Concert pitch (no transposition handling yet)
 * - Participation only when profile === "classical"
 * - Phrase length uses blockMeasures (2/4/8), default 2
 */
export function mapPianoToFullOrchestraOpen(score, opts = {}) {
    const profile = opts.profile ?? "classical";
    const blockMeasures = opts.blockMeasures ?? 2;
    const targets = {
        strings: typeof opts.targets?.strings === "number" ? opts.targets.strings : 0.9,
        woodwinds: typeof opts.targets?.woodwinds === "number" ? opts.targets.woodwinds : 0.4,
        brass: typeof opts.targets?.brass === "number" ? opts.targets.brass : 0.3,
        percussion: typeof opts.targets?.percussion === "number" ? opts.targets.percussion : 0.2
    };
    const srcPart = getFirstPart(score);
    if (!srcPart)
        return score;
    // Desired internal part order (your pipeline output uses this order)
    const orchestraParts = [
        { id: "V1", name: "Violin I", instrument: "violin", role: "melody" },
        { id: "V2", name: "Violin II", instrument: "violin", role: "inner" },
        { id: "VA", name: "Viola", instrument: "viola", role: "inner" },
        { id: "VC", name: "Cello", instrument: "cello", role: "bass" },
        { id: "FL", name: "Flute", instrument: "flute", role: "melody" },
        { id: "OB", name: "Oboe", instrument: "oboe", role: "inner" },
        { id: "CL", name: "Clarinet in Bb", instrument: "clarinet_bb", role: "inner" },
        { id: "BN", name: "Bassoon", instrument: "bassoon", role: "bass" },
        { id: "TPT1", name: "Trumpet 1", instrument: "trumpet_bb_1", role: "inner" },
        { id: "TPT2", name: "Trumpet 2", instrument: "trumpet_bb_2", role: "inner" },
        { id: "HN", name: "Horn", instrument: "horn_f", role: "inner" },
        { id: "TBN", name: "Trombone", instrument: "trombone", role: "bass" },
        { id: "TUBA", name: "Tuba", instrument: "tuba_c", role: "bass" },
        // “DRUMS” in your system is an unpitched container; we keep it but it will likely rest in classical
        { id: "DRUMS", name: "Percussion", instrument: "drums", role: "inner" },
        { id: "TIMP", name: "Timpani", instrument: "timpani", role: "bass" }
    ];
    const mappedParts = orchestraParts.map((p) => buildPartFromSource(score, srcPart, p.id, p.name, p.instrument, p.role));
    let out = {
        ...score,
        meta: { ...score.meta, ensemble: "full_orchestra" },
        parts: mappedParts
    };
    // Participation (classical only)
    if (profile === "classical") {
        const rules = {
            weights: {
                strings: targets.strings,
                woodwinds: targets.woodwinds,
                brass: targets.brass,
                percussion: targets.percussion
            },
            phraseLen: (blockMeasures === 2 || blockMeasures === 4 || blockMeasures === 8 ? blockMeasures : 2),
            maxActive: {
                strings: 4,
                woodwinds: 2,
                brass: 2,
                percussion: 1
            },
            rotation: { repeatPenalty: 0.45 }
        };
        out = applyParticipationByPhrase(out, rules, 12345);
    }
    // Range enforcement (always safe, but you can later gate by profile if you want)
    out = enforceRanges(out);
    return out;
}
//# sourceMappingURL=mapToFullOrchestra.js.map