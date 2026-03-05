// src/exporters/musicxmlExporter.ts
import { midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
function getTransposeForInstrument(instrument) {
    if (!instrument)
        return null;
    const id = instrument.toLowerCase();
    if (id === "trumpet_bb" ||
        id === "trumpet_bb_1" ||
        id === "trumpet_bb_2" ||
        id === "clarinet_bb" ||
        id === "clarinet_in_bb") {
        return { diatonic: -1, chromatic: -2, octaveChange: 0 };
    }
    if (id === "tenor_sax_bb" || id === "tenor_sax" || id === "tenor_saxophone_bb") {
        return { diatonic: -1, chromatic: -2, octaveChange: -1 };
    }
    if (id === "alto_sax_eb" || id === "alto_sax" || id === "alto_saxophone_eb") {
        return { diatonic: -5, chromatic: -9, octaveChange: 0 };
    }
    if (id === "horn_f" || id === "f_horn" || id === "horn") {
        return { diatonic: -4, chromatic: -7, octaveChange: 0 };
    }
    if (id === "bass" || id === "electric_bass" || id === "contrabass" || id === "double_bass") {
        return { diatonic: 0, chromatic: 0, octaveChange: -1 };
    }
    return null;
}
function isConcertKeyInstrument(instrument) {
    const id = (instrument ?? "").toLowerCase();
    if (id === "trombone" || id === "tuba" || id === "tuba_c" || id === "bassoon")
        return true;
    return false;
}
function isDrums(instrument) {
    const id = (instrument ?? "").toLowerCase();
    return id === "drums" || id === "drumset" || id === "kit" || id === "drum_set";
}
function mod(n, m) {
    return ((n % m) + m) % m;
}
function transposeKeyFifths(concertFifths, semitoneShift) {
    const targetPc = mod(7 * concertFifths + semitoneShift, 12);
    let best = 0;
    let bestAbs = 999;
    for (let f = -7; f <= 7; f++) {
        const pc = mod(7 * f, 12);
        if (pc !== targetPc)
            continue;
        const abs = Math.abs(f);
        if (abs < bestAbs) {
            best = f;
            bestAbs = abs;
        }
    }
    return best;
}
function xmlEscape(s) {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
function durToType(divisions, dur) {
    if (!divisions || divisions <= 0)
        return null;
    if (dur === divisions * 4)
        return "whole";
    if (dur === divisions * 2)
        return "half";
    if (dur === divisions)
        return "quarter";
    if (dur === divisions / 2)
        return "eighth";
    if (dur === divisions / 4)
        return "16th";
    return null;
}
function clefForPart(p, fallback = "G") {
    const s = `${p.instrument ?? ""} ${p.part_id ?? ""} ${p.name ?? ""}`.toLowerCase();
    if (isDrums(p.instrument) || s.includes("drums") || s.includes("drumset") || s.includes("percussion")) {
        return { sign: "percussion", line: 2 };
    }
    // Strings: enforce correct clefs even if p.instrument is generic (ex: "strings")
    if (s.includes("viola") || s.includes("vla")) {
        return { sign: "C", line: 3 }; // Alto clef
    }
    if (s.includes("cello") || s.includes("vlc") || s.includes("violoncello")) {
        return { sign: "F", line: 4 }; // Bass clef
    }
    if (s.includes("contrabass") ||
        s.includes("double_bass") ||
        s.includes("double bass") ||
        (s.includes("bass") && !s.includes("bassoon"))) {
        return { sign: "F", line: 4 };
    }
    // Pitched percussion
    if (s.includes("timpani")) {
        return { sign: "F", line: 4 };
    }
    // Other bass clef instruments
    if (s.includes("trombone") || s.includes("tuba") || s.includes("tuba_c") || s.includes("bassoon")) {
        return { sign: "F", line: 4 };
    }
    return fallback === "F" ? { sign: "F", line: 4 } : { sign: "G", line: 2 };
}
function writtenToSoundingSemis(transpose) {
    const oct = transpose.octaveChange ?? 0;
    return transpose.chromatic + 12 * oct;
}
function toWrittenPitch(p, transpose, instrument) {
    if (!transpose)
        return p;
    if (isConcertKeyInstrument(instrument))
        return p;
    const shift = -writtenToSoundingSemis(transpose);
    const m = pitchToMidi(p);
    return midiToPitch(m + shift);
}
function isPiano(instrument) {
    const id = (instrument ?? "").toLowerCase();
    return id === "piano" || id === "acoustic_piano" || id === "grand_piano";
}
/**
 * Orchestra order sorting (standard):
 *   1) Woodwinds
 *   2) Brass
 *   3) Percussion
 *   4) Strings
 * Anything unknown falls after, preserving original order.
 */
function orchestraGroupRank(p) {
    const s = `${p.instrument ?? ""} ${p.part_id ?? ""} ${p.name ?? ""}`.toLowerCase();
    const isWoodwind = s.includes("flute") ||
        s.includes("piccolo") ||
        s.includes("oboe") ||
        s.includes("english_horn") ||
        s.includes("cor_anglais") ||
        s.includes("clarinet") ||
        s.includes("bass_clarinet") ||
        s.includes("bass clarinet") ||
        s.includes("sax") ||
        s.includes("bassoon") ||
        s.includes("contrabassoon");
    const isBrass = s.includes("trumpet") ||
        s.includes("cornet") ||
        s.includes("horn") ||
        s.includes("f_horn") ||
        s.includes("trombone") ||
        s.includes("tuba") ||
        s.includes("euphonium") ||
        s.includes("baritone") ||
        s.includes("tbn");
    const isPerc = isDrums(p.instrument) ||
        s.includes("percussion") ||
        s.includes("timpani") ||
        s.includes("glockenspiel") ||
        s.includes("tubular_bells") ||
        s.includes("tubular bells") ||
        s.includes("chimes") ||
        s.includes("bells") ||
        s.includes("vibraphone") ||
        s.includes("marimba") ||
        s.includes("xylophone") ||
        s.includes("cymbal") ||
        s.includes("triangle") ||
        s.includes("tambourine") ||
        s.includes("snare") ||
        s.includes("kick") ||
        s.includes("drum");
    const isString = s.includes("violin") ||
        s.includes("viola") ||
        s.includes("cello") ||
        s.includes("contrabass") ||
        s.includes("double_bass") ||
        s.includes("double bass") ||
        s.includes("string");
    if (isWoodwind)
        return 10;
    if (isBrass)
        return 20;
    if (isPerc)
        return 30;
    if (isString)
        return 40;
    return 90;
}
function orchestraWithinGroupRank(p) {
    const s = `${p.instrument ?? ""} ${p.part_id ?? ""} ${p.name ?? ""}`.toLowerCase();
    // Woodwinds
    if (s.includes("piccolo"))
        return 1;
    if (s.includes("flute"))
        return 2;
    if (s.includes("oboe") || s.includes("english_horn") || s.includes("cor_anglais"))
        return 3;
    if (s.includes("clarinet"))
        return 4;
    if (s.includes("bassoon") || s.includes("contrabassoon"))
        return 5;
    // Brass
    if (s.includes("trumpet") || s.includes("cornet"))
        return 1;
    if (s.includes("horn"))
        return 2;
    if (s.includes("trombone"))
        return 3;
    if (s.includes("tuba") || s.includes("euphonium") || s.includes("baritone"))
        return 4;
    // Percussion
    if (s.includes("timpani"))
        return 1;
    if (isDrums(p.instrument) || s.includes("drum"))
        return 2;
    if (s.includes("glockenspiel") || s.includes("xylophone") || s.includes("marimba") || s.includes("vibraphone"))
        return 3;
    if (s.includes("tubular_bells") || s.includes("tubular bells") || s.includes("chimes") || s.includes("bells"))
        return 4;
    if (s.includes("cymbal") || s.includes("triangle") || s.includes("tambourine"))
        return 5;
    // Strings
    if (s.includes("violin_1") || s.includes("violin i") || s.includes("violin 1"))
        return 1;
    if (s.includes("violin_2") || s.includes("violin ii") || s.includes("violin 2"))
        return 2;
    if (s.includes("viola"))
        return 3;
    if (s.includes("cello"))
        return 4;
    if (s.includes("contrabass") || s.includes("double_bass") || s.includes("double bass") || s.includes("bass"))
        return 5;
    return 999;
}
function sortPartsOrchestrally(parts) {
    const tagged = parts.map((p, idx) => ({
        p,
        idx,
        g: orchestraGroupRank(p),
        w: orchestraWithinGroupRank(p)
    }));
    tagged.sort((a, b) => {
        if (a.g !== b.g)
            return a.g - b.g;
        if (a.w !== b.w)
            return a.w - b.w;
        return a.idx - b.idx;
    });
    return tagged.map((t) => t.p);
}
/**
 * Unpitched percussion map (expanded).
 * instrumentId is what your arranger writes into ev.instrumentId.
 */
function getPercussionMap(instrumentId) {
    const id = (instrumentId ?? "").toLowerCase();
    if (id === "kick" || id === "bd" || id === "bass_drum") {
        return { instrumentId: "kick", midiUnpitched: 36, displayStep: "C", displayOctave: 3, notehead: "normal" };
    }
    if (id === "snare" || id === "sd" || id === "snare_drum") {
        return { instrumentId: "snare", midiUnpitched: 38, displayStep: "E", displayOctave: 4, notehead: "normal" };
    }
    if (id === "hihat" || id === "hi_hat" || id === "hihat_closed" || id === "hhc") {
        return { instrumentId: "hihat_closed", midiUnpitched: 42, displayStep: "G", displayOctave: 5, notehead: "x" };
    }
    if (id === "hihat_open" || id === "hho") {
        return { instrumentId: "hihat_open", midiUnpitched: 46, displayStep: "G", displayOctave: 5, notehead: "x" };
    }
    if (id === "ride" || id === "rc" || id === "ride_cymbal") {
        return { instrumentId: "ride", midiUnpitched: 51, displayStep: "F", displayOctave: 5, notehead: "x" };
    }
    if (id === "crash" || id === "cc" || id === "crash_cymbal") {
        return { instrumentId: "crash", midiUnpitched: 49, displayStep: "A", displayOctave: 5, notehead: "x" };
    }
    if (id === "suspended_cymbal" || id === "sus_cymbal" || id === "suspended cymbal" || id === "susp_cymbal") {
        return {
            instrumentId: "suspended_cymbal",
            midiUnpitched: 57,
            displayStep: "A",
            displayOctave: 5,
            notehead: "x"
        };
    }
    if (id === "mallets" || id === "mallet") {
        return { instrumentId: "mallets", midiUnpitched: 81, displayStep: "C", displayOctave: 5, notehead: "diamond" };
    }
    if (id === "bells" || id === "jingle_bell" || id === "sleigh_bells" || id === "sleighbells") {
        return { instrumentId: "bells", midiUnpitched: 83, displayStep: "E", displayOctave: 5, notehead: "x" };
    }
    if (id === "chimes" || id === "wind_chimes" || id === "bell_tree" || id === "belltree") {
        return { instrumentId: "chimes", midiUnpitched: 84, displayStep: "F", displayOctave: 5, notehead: "x" };
    }
    if (id === "tambourine" || id === "tambo") {
        return { instrumentId: "tambourine", midiUnpitched: 54, displayStep: "D", displayOctave: 5, notehead: "x" };
    }
    if (id === "shaker" || id === "maraca" || id === "maracas") {
        if (id === "shaker") {
            return { instrumentId: "shaker", midiUnpitched: 82, displayStep: "E", displayOctave: 5, notehead: "x" };
        }
        return { instrumentId: "maracas", midiUnpitched: 70, displayStep: "E", displayOctave: 5, notehead: "x" };
    }
    if (id === "claves" || id === "clave") {
        return { instrumentId: "claves", midiUnpitched: 75, displayStep: "A", displayOctave: 4, notehead: "normal" };
    }
    if (id === "triangle" || id === "tri") {
        return { instrumentId: "triangle", midiUnpitched: 81, displayStep: "B", displayOctave: 5, notehead: "diamond" };
    }
    if (id === "cabasa") {
        return { instrumentId: "cabasa", midiUnpitched: 69, displayStep: "D", displayOctave: 5, notehead: "x" };
    }
    if (id === "cowbell") {
        return { instrumentId: "cowbell", midiUnpitched: 56, displayStep: "G", displayOctave: 4, notehead: "normal" };
    }
    if (id === "woodblock" || id === "wood_block") {
        return { instrumentId: "woodblock", midiUnpitched: 76, displayStep: "F", displayOctave: 4, notehead: "normal" };
    }
    return null;
}
function scoreInstrumentXml(partId, pm) {
    const instXmlId = `${partId}-I${pm.midiUnpitched}`;
    const safeName = xmlEscape(pm.instrumentId);
    const score = `<score-instrument id="${xmlEscape(instXmlId)}">` +
        `<instrument-name>${safeName}</instrument-name>` +
        `</score-instrument>`;
    const midi = `<midi-instrument id="${xmlEscape(instXmlId)}">` +
        `<midi-channel>10</midi-channel>` +
        `<midi-unpitched>${pm.midiUnpitched}</midi-unpitched>` +
        `<volume>78.7402</volume>` +
        `<pan>0</pan>` +
        `</midi-instrument>`;
    return { score, midi };
}
export function exportScoreModelToMusicXML(scoreModel) {
    const workTitle = xmlEscape(scoreModel?.meta?.ensemble ?? "ensemble");
    const partsRaw = scoreModel?.parts ?? [];
    const parts = sortPartsOrchestrally(partsRaw);
    const percUsedByPart = {};
    for (const p of parts) {
        const pid = xmlEscape(p.part_id ?? "P1");
        if (!isDrums(p.instrument))
            continue;
        const used = new Map();
        for (const m of p.measures ?? []) {
            for (const ev of m?.events ?? []) {
                if (ev?.type !== "unpitched")
                    continue;
                const pm = getPercussionMap(ev.instrumentId ?? "");
                if (!pm)
                    continue;
                used.set(pm.midiUnpitched, pm);
            }
        }
        if (used.size > 0)
            percUsedByPart[pid] = used;
    }
    let out = "";
    out += `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n`;
    out += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"\n`;
    out += `  "http://www.musicxml.org/dtds/partwise.dtd">\n`;
    out += `<score-partwise version="3.1">\n`;
    out += `  <work><work-title>${workTitle}</work-title></work>\n`;
    out += `  <part-list>`;
    for (const p of parts) {
        const pid = xmlEscape(p.part_id ?? "P1");
        const pname = xmlEscape(p.name ?? pid);
        out += `<score-part id="${pid}">`;
        out += `<part-name>${pname}</part-name>`;
        const used = percUsedByPart[pid];
        if (used && used.size > 0) {
            for (const pm of used.values()) {
                const blocks = scoreInstrumentXml(pid, pm);
                out += blocks.score;
                out += blocks.midi;
            }
        }
        out += `</score-part>`;
    }
    out += `</part-list>\n`;
    for (const p of parts) {
        const pid = xmlEscape(p.part_id ?? "P1");
        const transpose = getTransposeForInstrument(p.instrument);
        out += `  <part id="${pid}">\n`;
        for (const m of p.measures ?? []) {
            const mNum = m.number ?? 1;
            const divisions = m?.attributes?.divisions ?? scoreModel?.global?.divisions ?? 480;
            const concertFifths = m?.attributes?.key_fifths ?? 0;
            const timeBeats = m?.attributes?.time?.beats ?? 4;
            const timeBeatType = m?.attributes?.time?.beat_type ?? 4;
            const concert = isConcertKeyInstrument(p.instrument);
            const semisWritten = transpose && !concert ? -writtenToSoundingSemis(transpose) : 0;
            const semisForKey = mod(semisWritten, 12);
            const fifthsToWrite = semisForKey === 0 ? concertFifths : transposeKeyFifths(concertFifths, semisForKey);
            const staves = Number(p.staves ?? 1);
            const piano = isPiano(p.instrument);
            const isGrandStaff = piano || staves === 2;
            out += `    <measure number="${mNum}">`;
            out += `<attributes>`;
            out += `<divisions>${divisions}</divisions>`;
            out += `<key><fifths>${fifthsToWrite}</fifths></key>`;
            out += `<time><beats>${timeBeats}</beats><beat-type>${timeBeatType}</beat-type></time>`;
            if (isGrandStaff)
                out += `<staves>2</staves>`;
            if (transpose && !concert) {
                out += `<transpose>`;
                out += `<diatonic>${transpose.diatonic}</diatonic>`;
                out += `<chromatic>${transpose.chromatic}</chromatic>`;
                const oc = transpose.octaveChange ?? 0;
                if (oc !== 0)
                    out += `<octave-change>${oc}</octave-change>`;
                out += `</transpose>`;
            }
            if (isGrandStaff) {
                out += `<clef number="1"><sign>G</sign><line>2</line></clef>`;
                out += `<clef number="2"><sign>F</sign><line>4</line></clef>`;
            }
            else {
                const clef = clefForPart(p);
                if (clef.sign === "percussion") {
                    out += `<clef><sign>percussion</sign><line>2</line></clef>`;
                }
                else if (clef.sign === "C") {
                    out += `<clef><sign>C</sign><line>3</line></clef>`;
                }
                else {
                    out += `<clef><sign>${clef.sign}</sign><line>${clef.line}</line></clef>`;
                }
            }
            out += `</attributes>`;
            const events = (m.events ?? []).slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
            for (const ev of events) {
                const dur = ev.dur ?? divisions;
                const voice = ev.voice ?? 1;
                const staff = isGrandStaff ? (ev.staff ?? 1) : 1;
                const type = durToType(divisions, dur);
                if (ev.type === "rest") {
                    out += `<note><rest/><duration>${dur}</duration><voice>${voice}</voice>`;
                    if (type)
                        out += `<type>${type}</type>`;
                    out += `<staff>${staff}</staff></note>`;
                    continue;
                }
                if (ev.type === "unpitched") {
                    const pm = getPercussionMap(ev.instrumentId ?? "");
                    if (!pm) {
                        out += `<note><rest/><duration>${dur}</duration><voice>${voice}</voice>`;
                        if (type)
                            out += `<type>${type}</type>`;
                        out += `<staff>${staff}</staff></note>`;
                        continue;
                    }
                    const instXmlId = `${pid}-I${pm.midiUnpitched}`;
                    out += `<note>`;
                    out += `<unpitched><display-step>${pm.displayStep}</display-step><display-octave>${pm.displayOctave}</display-octave></unpitched>`;
                    out += `<duration>${dur}</duration>`;
                    out += `<instrument id="${xmlEscape(instXmlId)}"/>`;
                    out += `<voice>${voice}</voice>`;
                    if (type)
                        out += `<type>${type}</type>`;
                    if (pm.notehead && pm.notehead !== "normal")
                        out += `<notehead>${pm.notehead}</notehead>`;
                    out += `<staff>${staff}</staff>`;
                    out += `</note>`;
                    continue;
                }
                if (ev.type === "note" && ev.pitch?.step) {
                    const wp = toWrittenPitch(ev.pitch, transpose, p.instrument);
                    out += `<note><pitch><step>${xmlEscape(wp.step)}</step>`;
                    if (typeof wp.alter === "number" && wp.alter !== 0)
                        out += `<alter>${wp.alter}</alter>`;
                    out += `<octave>${wp.octave}</octave></pitch>`;
                    out += `<duration>${dur}</duration><voice>${voice}</voice>`;
                    if (type)
                        out += `<type>${type}</type>`;
                    out += `<staff>${staff}</staff></note>`;
                    continue;
                }
            }
            out += `</measure>\n`;
        }
        out += `  </part>\n`;
    }
    out += `</score-partwise>\n`;
    return out;
}
//# sourceMappingURL=musicxmlExporter.js.map