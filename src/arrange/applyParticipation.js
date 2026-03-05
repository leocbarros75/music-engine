function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function clamp01(x) {
    if (Number.isNaN(x))
        return 0;
    if (x < 0)
        return 0;
    if (x > 1)
        return 1;
    return x;
}
function classifyFamily(instrument) {
    const id = (instrument ?? "").toLowerCase();
    // Strings
    if (id.includes("violin") || id === "viola" || id === "cello" || id.includes("bass"))
        return "strings";
    // Woodwinds
    if (id === "flute" || id === "oboe" || id.includes("clarinet") || id === "bassoon" || id.includes("sax")) {
        return "woodwinds";
    }
    // Brass
    if (id.includes("trumpet") || id.includes("horn") || id.includes("trombone") || id.includes("tuba"))
        return "brass";
    // Percussion
    if (id === "drums" || id === "drumset" || id === "kit" || id === "drum_set" || id === "timpani")
        return "percussion";
    return "other";
}
function measureDur(divisions, beats, beatType) {
    const q = beats * (4 / beatType);
    return Math.round(divisions * q);
}
function getMeasureCount(score) {
    const parts = score.parts ?? [];
    let max = 0;
    for (const p of parts)
        max = Math.max(max, (p.measures ?? []).length);
    return max;
}
function pickActiveParts(rng, partIndices, baseProb, cap, lastActive, repeatPenalty) {
    // Score each part by a random draw weighted by prob (and penalty if it played last phrase)
    const scored = partIndices.map((idx) => {
        const p = lastActive.has(idx) ? baseProb * repeatPenalty : baseProb;
        const prob = clamp01(p);
        const r = rng();
        // higher "priority" means more likely to be selected
        const priority = r * prob;
        return { idx, priority, prob };
    });
    // Filter out very low-prob picks to avoid selecting everyone when cap is high
    scored.sort((a, b) => b.priority - a.priority);
    const active = new Set();
    for (const s of scored) {
        if (active.size >= cap)
            break;
        // enforce a minimum probability gate so tiny probs do not win by chance too often
        if (s.prob <= 0.01)
            continue;
        // 50/50 secondary gate improves musical spacing
        if (rng() < 0.5 && s.prob < 0.25)
            continue;
        active.add(s.idx);
    }
    return active;
}
/**
 * Phase 2: phrase-based participation (now supports per-measure when phraseLen = 1)
 * - Choose active instruments per block (1/2/4/8 measures).
 * - Apply caps per family and rotation penalty across blocks.
 * - If a part is inactive for a measure, replace it with a full-measure rest (keeps exporter simple).
 */
export function applyParticipationByPhrase(score, rules, seed = 12345) {
    const phraseLen = rules.phraseLen ?? 1;
    const weights = {
        strings: clamp01(rules.weights.strings ?? 0.9),
        woodwinds: clamp01(rules.weights.woodwinds ?? 0.4),
        brass: clamp01(rules.weights.brass ?? 0.3),
        percussion: clamp01(rules.weights.percussion ?? 0.2)
    };
    const maxActive = {
        strings: rules.maxActive?.strings ?? 4, // quartet right now
        woodwinds: rules.maxActive?.woodwinds ?? 2, // typical color layer
        brass: rules.maxActive?.brass ?? 2,
        percussion: rules.maxActive?.percussion ?? 1
    };
    const repeatPenalty = clamp01(rules.rotation?.repeatPenalty ?? 0.45);
    const parts = score.parts ?? [];
    const measureCount = getMeasureCount(score);
    // Build family -> partIndices map
    const familyMap = {
        strings: [],
        woodwinds: [],
        brass: [],
        percussion: [],
        other: []
    };
    parts.forEach((p, idx) => {
        const fam = classifyFamily(p.instrument);
        familyMap[fam].push(idx);
    });
    // Block plan: for each block, which part indices are active
    const phraseActive = [];
    const lastActiveByFamily = {
        strings: new Set(),
        woodwinds: new Set(),
        brass: new Set(),
        percussion: new Set()
    };
    const phraseCount = Math.max(1, Math.ceil(measureCount / phraseLen));
    for (let ph = 0; ph < phraseCount; ph++) {
        const rng = mulberry32(seed + ph * 999);
        const active = new Set();
        const aStrings = pickActiveParts(rng, familyMap.strings, weights.strings, maxActive.strings, lastActiveByFamily.strings, repeatPenalty);
        const aWinds = pickActiveParts(rng, familyMap.woodwinds, weights.woodwinds, maxActive.woodwinds, lastActiveByFamily.woodwinds, repeatPenalty);
        const aBrass = pickActiveParts(rng, familyMap.brass, weights.brass, maxActive.brass, lastActiveByFamily.brass, repeatPenalty);
        const aPerc = pickActiveParts(rng, familyMap.percussion, weights.percussion, maxActive.percussion, lastActiveByFamily.percussion, repeatPenalty);
        for (const s of aStrings)
            active.add(s);
        for (const s of aWinds)
            active.add(s);
        for (const s of aBrass)
            active.add(s);
        for (const s of aPerc)
            active.add(s);
        phraseActive.push(active);
        lastActiveByFamily.strings = aStrings;
        lastActiveByFamily.woodwinds = aWinds;
        lastActiveByFamily.brass = aBrass;
        lastActiveByFamily.percussion = aPerc;
    }
    const outParts = parts.map((p, partIndex) => {
        const newMeasures = (p.measures ?? []).map((m, mi) => {
            const divisions = m?.attributes?.divisions ?? score.global?.divisions ?? 480;
            const beats = m?.attributes?.time?.beats ?? 4;
            const beatType = m?.attributes?.time?.beat_type ?? 4;
            const dur = measureDur(divisions, beats, beatType);
            const ph = Math.floor(mi / phraseLen);
            const activeSet = phraseActive[ph] ?? new Set();
            const play = activeSet.has(partIndex) || classifyFamily(p.instrument) === "other";
            if (play)
                return m;
            return {
                ...m,
                events: [
                    {
                        id: `REST_${m.number ?? mi + 1}_P${partIndex}`,
                        t: 0,
                        dur,
                        type: "rest",
                        voice: 1,
                        staff: 1
                    }
                ]
            };
        });
        return { ...p, measures: newMeasures };
    });
    return { ...score, parts: outParts };
}
//# sourceMappingURL=applyParticipation.js.map