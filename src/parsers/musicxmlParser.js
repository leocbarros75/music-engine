import { DOMParser } from "@xmldom/xmldom";
function textOf(el) {
    if (!el)
        return "";
    return String(el.textContent ?? "").trim();
}
function intOf(el, fallback = 0) {
    const s = textOf(el);
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : fallback;
}
function firstChild(el, tag) {
    const xs = el.getElementsByTagName(tag);
    if (!xs || xs.length === 0)
        return null;
    return xs.item(0);
}
function stepToPc(step) {
    const s = String(step ?? "").toUpperCase();
    if (s === "C")
        return 0;
    if (s === "D")
        return 2;
    if (s === "E")
        return 4;
    if (s === "F")
        return 5;
    if (s === "G")
        return 7;
    if (s === "A")
        return 9;
    if (s === "B")
        return 11;
    return 0;
}
function pitchToMidi(p) {
    const pc = stepToPc(p.step) + (p.alter ?? 0);
    return (p.octave + 1) * 12 + pc;
}
/**
 * Important MusicXML rule:
 * If a <note> contains a <chord/> tag, it shares the SAME start time
 * as the previous non-chord note (in that voice).
 *
 * Our earlier parser always advanced time, which destroys chords.
 * This fix preserves chord stacks so harmony detection works.
 */
export function parseMusicXMLToScoreModel(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const scorePartwise = doc.getElementsByTagName("score-partwise").item(0);
    if (!scorePartwise)
        return { parts: [] };
    const partList = scorePartwise.getElementsByTagName("part-list").item(0);
    const partNames = new Map();
    if (partList) {
        const scoreParts = partList.getElementsByTagName("score-part");
        for (let i = 0; i < scoreParts.length; i++) {
            const sp = scoreParts.item(i);
            const id = String(sp.getAttribute("id") ?? "");
            const pn = firstChild(sp, "part-name");
            const name = textOf(pn);
            if (id)
                partNames.set(id, name);
        }
    }
    const parts = [];
    const partEls = scorePartwise.getElementsByTagName("part");
    for (let pi = 0; pi < partEls.length; pi++) {
        const partEl = partEls.item(pi);
        const partId = String(partEl.getAttribute("id") ?? `P${pi + 1}`);
        const measures = [];
        const measureEls = partEl.getElementsByTagName("measure");
        let curDivisions = 480;
        for (let mi = 0; mi < measureEls.length; mi++) {
            const mEl = measureEls.item(mi);
            const mNumber = intOf({ textContent: mEl.getAttribute("number") }, mi + 1);
            const attrsEl = firstChild(mEl, "attributes");
            if (attrsEl) {
                const divEl = firstChild(attrsEl, "divisions");
                const d = intOf(divEl, curDivisions);
                if (d > 0)
                    curDivisions = d;
            }
            const events = [];
            // time cursor for this measure
            let t = 0;
            // last start time of a non-chord note (used by <chord/> tones)
            let lastNonChordStartT = 0;
            const childNodes = mEl.childNodes;
            for (let ci = 0; ci < childNodes.length; ci++) {
                const node = childNodes.item(ci);
                if (!node || node.nodeType !== 1)
                    continue;
                const el = node;
                if (el.tagName === "note") {
                    const isChordTone = !!firstChild(el, "chord");
                    const restEl = firstChild(el, "rest");
                    const durEl = firstChild(el, "duration");
                    const dur = intOf(durEl, curDivisions);
                    // MusicXML chord tones reuse the previous non-chord note start time
                    const noteT = isChordTone ? lastNonChordStartT : t;
                    const pitchEl = firstChild(el, "pitch");
                    let pitch = null;
                    let midi = undefined;
                    if (!restEl && pitchEl) {
                        const step = textOf(firstChild(pitchEl, "step"));
                        const alter = intOf(firstChild(pitchEl, "alter"), 0);
                        const octave = intOf(firstChild(pitchEl, "octave"), 4);
                        pitch = { step, alter, octave };
                        midi = pitchToMidi(pitch);
                    }
                    events.push({
                        type: "note",
                        t: noteT,
                        dur,
                        pitch,
                        midi
                    });
                    // only advance the time cursor on non-chord notes
                    if (!isChordTone) {
                        lastNonChordStartT = t;
                        t += dur;
                    }
                    continue;
                }
                if (el.tagName === "backup") {
                    const durEl = firstChild(el, "duration");
                    const dur = intOf(durEl, 0);
                    t -= dur;
                    if (t < 0)
                        t = 0;
                    // After backup/forward, chord anchoring should follow the new cursor
                    lastNonChordStartT = t;
                    continue;
                }
                if (el.tagName === "forward") {
                    const durEl = firstChild(el, "duration");
                    const dur = intOf(durEl, 0);
                    t += dur;
                    lastNonChordStartT = t;
                    continue;
                }
            }
            const attributes = {};
            if (attrsEl) {
                const divEl = firstChild(attrsEl, "divisions");
                const timeEl = firstChild(attrsEl, "time");
                const beatsEl = timeEl ? firstChild(timeEl, "beats") : null;
                const beatTypeEl = timeEl ? firstChild(timeEl, "beat-type") : null;
                if (divEl)
                    attributes.divisions = intOf(divEl, curDivisions);
                if (beatsEl && beatTypeEl) {
                    attributes.time = {
                        beats: intOf(beatsEl, 4),
                        beatType: intOf(beatTypeEl, 4)
                    };
                }
            }
            measures.push({
                number: mNumber,
                attributes: Object.keys(attributes).length ? attributes : undefined,
                events
            });
        }
        parts.push({
            part_id: partId,
            name: partNames.get(partId) ?? undefined,
            measures
        });
    }
    return {
        meta: {},
        parts
    };
}
//# sourceMappingURL=musicxmlParser.js.map