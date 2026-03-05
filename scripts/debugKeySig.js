// scripts/debugKeySig.ts
import fs from "node:fs";
import path from "node:path";
import { parseMusicXMLToScoreModel } from "../src/parsers/musicxmlParser";
function isObj(x) {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}
function safeStr(x) {
    try {
        return JSON.stringify(x);
    }
    catch {
        return String(x);
    }
}
function shouldMatchKeyName(k) {
    const s = k.toLowerCase();
    return (s === "fifths" ||
        s === "mode" ||
        s.includes("keysig") ||
        s.includes("key_signature") ||
        s.includes("keysignature") ||
        s === "key" ||
        s.includes("attributes"));
}
function findPaths(node, pathSoFar, hits, maxHits) {
    if (hits.length >= maxHits)
        return;
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            findPaths(node[i], [...pathSoFar, i], hits, maxHits);
            if (hits.length >= maxHits)
                return;
        }
        return;
    }
    if (!isObj(node))
        return;
    for (const [k, v] of Object.entries(node)) {
        if (shouldMatchKeyName(k)) {
            // If this is a key-ish node, also try to pull likely subfields.
            hits.push({ path: [...pathSoFar, k], key: k, value: v });
            if (hits.length >= maxHits)
                return;
        }
        findPaths(v, [...pathSoFar, k], hits, maxHits);
        if (hits.length >= maxHits)
            return;
    }
}
function findDirectFifths(node, pathSoFar, hits, maxHits) {
    if (hits.length >= maxHits)
        return;
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            findDirectFifths(node[i], [...pathSoFar, i], hits, maxHits);
            if (hits.length >= maxHits)
                return;
        }
        return;
    }
    if (!isObj(node))
        return;
    for (const [k, v] of Object.entries(node)) {
        if (k === "fifths") {
            hits.push({ path: [...pathSoFar, k], value: v });
            if (hits.length >= maxHits)
                return;
        }
        findDirectFifths(v, [...pathSoFar, k], hits, maxHits);
        if (hits.length >= maxHits)
            return;
    }
}
function printMeasureAttributeSummary(score) {
    const parts = score?.parts ?? [];
    console.log("\n== parts/measures attribute snapshot (first 6 measures per part) ==\n");
    for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi];
        const measures = p?.measures ?? [];
        console.log(`PART[${pi}] name=${safeStr(p?.name ?? p?.part_id ?? null)} measures=${measures.length}`);
        for (let mi = 0; mi < Math.min(measures.length, 6); mi++) {
            const m = measures[mi];
            const attrs = m?.attributes ?? null;
            const keys = attrs && typeof attrs === "object" ? Object.keys(attrs) : [];
            console.log(`  measure ${mi + 1}: attributes keys = ${keys.length ? keys.join(", ") : "(none)"}`);
            // Try common key signature places for quick view
            const candidates = [
                ["attributes.key", attrs?.key],
                ["attributes.keySig", attrs?.keySig],
                ["attributes.keySignature", attrs?.keySignature],
                ["attributes.key_signature", attrs?.key_signature],
                ["attributes.fifths", attrs?.fifths]
            ];
            for (const [label, val] of candidates) {
                if (val !== undefined && val !== null) {
                    console.log(`    ${label} = ${safeStr(val)}`);
                }
            }
        }
        console.log("");
    }
}
function main() {
    const rel = process.argv[2];
    if (!rel) {
        console.error("Usage: npx tsx scripts/debugKeySig.ts <path-to-musicxml>");
        process.exit(1);
    }
    const filePath = path.resolve(process.cwd(), rel);
    const xml = fs.readFileSync(filePath, "utf8");
    const score = parseMusicXMLToScoreModel(xml);
    console.log("== parsed scoreModel summary ==");
    console.log(`parts: ${(score?.parts ?? []).length}`);
    console.log(`meta keys: ${score?.meta ? Object.keys(score.meta).join(", ") : "(none)"}`);
    printMeasureAttributeSummary(score);
    const hits = [];
    findPaths(score, [], hits, 80);
    console.log("\n== key-ish paths (up to 80) ==\n");
    for (const h of hits) {
        console.log(`${h.path.join(".")}  ->  ${safeStr(h.value)}`);
    }
    const fifthsHits = [];
    findDirectFifths(score, [], fifthsHits, 40);
    console.log("\n== direct 'fifths' hits (up to 40) ==\n");
    if (fifthsHits.length === 0) {
        console.log("(none)");
    }
    else {
        for (const h of fifthsHits) {
            console.log(`${h.path.join(".")}  ->  ${safeStr(h.value)}`);
        }
    }
}
main();
//# sourceMappingURL=debugKeySig.js.map