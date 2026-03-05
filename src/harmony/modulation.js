// src/harmony/modulation.ts
import { keyFromMetaOrBestGuess } from "./keyEstimate";
function sameKey(a, b) {
    return a.tonic === b.tonic && a.mode === b.mode;
}
function histAdd(hist, pcs) {
    for (const pc of pcs) {
        const i = ((pc % 12) + 12) % 12;
        hist[i] = (hist[i] ?? 0) + 1;
    }
}
function histForWindow(getMeasurePcs, startMi, endMi) {
    const hist = new Array(12).fill(0);
    for (let i = startMi; i <= endMi; i++)
        histAdd(hist, getMeasurePcs(i));
    return hist;
}
/**
 * Simple key-change detector:
 * - Uses a sliding window histogram
 * - Picks a best-guess key per window
 * - Emits a change when the guess differs from the previous stable key
 *
 * Conservative on purpose.
 */
export function detectKeyChanges(params) {
    const { measureCount, getMeasurePcs, baseKey } = params;
    const windowSize = typeof params.windowSize === "number" && params.windowSize >= 2 ? params.windowSize : 4;
    const minConfidence = typeof params.minConfidence === "number" ? params.minConfidence : 0.82;
    if (measureCount <= windowSize)
        return [];
    let current = baseKey;
    const changes = [];
    for (let start = 0; start <= measureCount - windowSize; start++) {
        const end = start + windowSize - 1;
        const hist = histForWindow(getMeasurePcs, start, end);
        const guess = keyFromMetaOrBestGuess(null, hist, true);
        if (!guess?.tonic || (guess.mode !== "major" && guess.mode !== "minor"))
            continue;
        if (typeof guess.confidence !== "number")
            continue;
        // Only consider confident guesses
        if (guess.confidence < minConfidence)
            continue;
        if (!sameKey(guess, current)) {
            const atMeasure = start + 1;
            changes.push({
                atMeasure,
                from: current,
                to: guess,
                confidence: guess.confidence,
                reason: `Window ${atMeasure}-${end + 1} suggests new key center.`
            });
            current = guess;
        }
    }
    return changes;
}
//# sourceMappingURL=modulation.js.map