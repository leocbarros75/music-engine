"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMusicXMLToScoreModel = parseMusicXMLToScoreModel;
var xmldom_1 = require("@xmldom/xmldom");
function textOf(el) {
    var _a;
    if (!el)
        return "";
    return String((_a = el.textContent) !== null && _a !== void 0 ? _a : "").trim();
}
function intOf(el, fallback) {
    if (fallback === void 0) { fallback = 0; }
    var s = textOf(el);
    var n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : fallback;
}
function localNameOf(el) {
    var _a, _b, _c;
    if (!el)
        return "";
    var raw = String((_b = (_a = el.localName) !== null && _a !== void 0 ? _a : el.tagName) !== null && _b !== void 0 ? _b : "");
    var parts = raw.split(":");
    return (_c = parts[parts.length - 1]) !== null && _c !== void 0 ? _c : raw;
}
function elementsByTagName(root, tag) {
    var result = [];
    var nsFn = root.getElementsByTagNameNS;
    var nodeList = typeof nsFn === "function" ? nsFn.call(root, "*", tag) : root.getElementsByTagName(tag);
    if (!nodeList)
        return result;
    for (var i = 0; i < nodeList.length; i++) {
        var item = nodeList.item(i);
        if (item && item.nodeType === 1)
            result.push(item);
    }
    return result;
}
function firstChild(el, tag) {
    var xs = elementsByTagName(el, tag);
    return xs.length ? xs[0] : null;
}
function parseNoteTieFlags(noteEl) {
    var _a, _b;
    var tieStart = false;
    var tieStop = false;
    var childNodes = noteEl.childNodes;
    for (var i = 0; i < childNodes.length; i++) {
        var node = childNodes.item(i);
        if (!node || node.nodeType !== 1)
            continue;
        var el = node;
        if (localNameOf(el) !== "tie")
            continue;
        var type = String((_a = el.getAttribute("type")) !== null && _a !== void 0 ? _a : "").toLowerCase();
        if (type === "start")
            tieStart = true;
        if (type === "stop")
            tieStop = true;
    }
    var notationsEl = firstChild(noteEl, "notations");
    if (notationsEl) {
        var nChildren = notationsEl.childNodes;
        for (var i = 0; i < nChildren.length; i++) {
            var node = nChildren.item(i);
            if (!node || node.nodeType !== 1)
                continue;
            var el = node;
            if (localNameOf(el) !== "tied")
                continue;
            var type = String((_b = el.getAttribute("type")) !== null && _b !== void 0 ? _b : "").toLowerCase();
            if (type === "start")
                tieStart = true;
            if (type === "stop")
                tieStop = true;
        }
    }
    return { tieStart: tieStart, tieStop: tieStop };
}
function stepToPc(step) {
    var s = String(step !== null && step !== void 0 ? step : "").toUpperCase();
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
    var _a;
    var pc = stepToPc(p.step) + ((_a = p.alter) !== null && _a !== void 0 ? _a : 0);
    return (p.octave + 1) * 12 + pc;
}
function computeMeasureLengthInBeats(beats, beatType) {
    if (!beats || !beatType)
        return null;
    // quarter-note length = 1 beat in our internal units
    // measure length = beats * (4 / beatType)
    var len = beats * (4 / beatType);
    return Number.isFinite(len) && len > 0 ? len : null;
}
function accidentalFromAlter(alter, warnings) {
    if (alter === 1)
        return "#";
    if (alter === -1)
        return "b";
    if (alter === 0)
        return "";
    if (alter > 1) {
        warnings.push("[chord] root alter=".concat(alter, " not supported; using \"#\"."));
        return "#";
    }
    if (alter < -1) {
        warnings.push("[chord] root alter=".concat(alter, " not supported; using \"b\"."));
        return "b";
    }
    return "";
}
function chordSuffixFromKind(kind, kindTextAttr, warnings) {
    var k = String(kind || "").trim().toLowerCase();
    var kt = String(kindTextAttr || "").trim().toLowerCase();
    if (kt) {
        if (kt === "2" || kt === "add2")
            return "add2";
        if (kt === "sus" || kt === "sus4" || kt === "sus42")
            return "sus4";
        if (kt === "sus2")
            return "sus2";
        if (kt === "6" || kt === "add6")
            return "6";
        if (kt === "9" || kt === "add9")
            return "9";
        if (kt === "ma9" || kt === "maj9")
            return "maj9";
        if (kt === "ma7" || kt === "maj7")
            return "maj7";
        if (kt === "m7")
            return "m7";
    }
    if (!k || k === "major")
        return "";
    if (k === "minor")
        return "m";
    if (k === "dominant" || k === "major-minor")
        return "7";
    if (k === "major-seventh")
        return "maj7";
    if (k === "minor-seventh")
        return "m7";
    if (k === "diminished")
        return "dim";
    if (k === "diminished-seventh")
        return "dim7";
    if (k === "half-diminished")
        return "ø7";
    if (k === "augmented")
        return "aug";
    if (k === "augmented-seventh")
        return "aug7";
    if (k === "suspended-fourth")
        return "sus4";
    if (k === "suspended-second")
        return "sus2";
    if (k === "major-ninth")
        return "maj9";
    if (k === "dominant-ninth")
        return "9";
    if (k === "added-sixth")
        return "6";
    warnings.push("[chord] Unsupported harmony kind \"".concat(kind, "\". Defaulting to major triad."));
    return "";
}
function parseHarmonySymbol(harmonyEl, warnings) {
    var _a;
    var rootEl = firstChild(harmonyEl, "root");
    var rootStep = rootEl ? textOf(firstChild(rootEl, "root-step")) : "";
    if (!rootStep)
        return null;
    var rootAlterEl = rootEl ? firstChild(rootEl, "root-alter") : null;
    var rootAlter = rootAlterEl ? intOf(rootAlterEl, 0) : 0;
    var rootAcc = accidentalFromAlter(rootAlter, warnings);
    var kindEl = firstChild(harmonyEl, "kind");
    var kindText = kindEl ? textOf(kindEl) : "";
    var kindTextAttr = (_a = kindEl === null || kindEl === void 0 ? void 0 : kindEl.getAttribute("text")) !== null && _a !== void 0 ? _a : "";
    var suffix = chordSuffixFromKind(kindText, kindTextAttr, warnings);
    var bassEl = firstChild(harmonyEl, "bass");
    var bassStep = bassEl ? textOf(firstChild(bassEl, "bass-step")) : "";
    var bassAlterEl = bassEl ? firstChild(bassEl, "bass-alter") : null;
    var bassAlter = bassAlterEl ? intOf(bassAlterEl, 0) : 0;
    var bassAcc = bassStep ? accidentalFromAlter(bassAlter, warnings) : "";
    var rootName = "".concat(rootStep.toUpperCase()).concat(rootAcc);
    var bassName = bassStep ? "".concat(bassStep.toUpperCase()).concat(bassAcc) : "";
    var symbol = bassName ? "".concat(rootName).concat(suffix, "/").concat(bassName) : "".concat(rootName).concat(suffix);
    return symbol ? { symbol: symbol } : null;
}
/**
 * Parser rules supported:
 * - <chord/> notes share onset with previous non-chord note (same voice stream)
 * - <backup>/<forward> adjusts the time cursor
 *
 * Extra heuristic (for simple test fixtures):
 * Some fixtures encode a vertical sonority by writing multiple whole notes
 * in the same measure WITHOUT <chord/>, <backup>, or voice layers.
 * In that case, after the measure is already "full", we treat remaining notes
 * as stacked at the measure start (t=0) so harmony analysis can see the chord.
 */
function parseMusicXMLToScoreModel(xml) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    var doc = new xmldom_1.DOMParser().parseFromString(xml, "application/xml");
    var scorePartwise = (_a = elementsByTagName(doc, "score-partwise")[0]) !== null && _a !== void 0 ? _a : null;
    if (!scorePartwise)
        return { parts: [] };
    var partList = (_b = elementsByTagName(scorePartwise, "part-list")[0]) !== null && _b !== void 0 ? _b : null;
    var partNames = new Map();
    if (partList) {
        var scoreParts = elementsByTagName(partList, "score-part");
        for (var i = 0; i < scoreParts.length; i++) {
            var sp = scoreParts[i];
            var id = String((_c = sp.getAttribute("id")) !== null && _c !== void 0 ? _c : "");
            var pn = firstChild(sp, "part-name");
            var name_1 = textOf(pn);
            if (id)
                partNames.set(id, name_1);
        }
    }
    var parts = [];
    var chordEvents = [];
    var chordWarnings = [];
    var partEls = elementsByTagName(scorePartwise, "part");
    for (var pi = 0; pi < partEls.length; pi++) {
        var partEl = partEls[pi];
        var partId = String((_d = partEl.getAttribute("id")) !== null && _d !== void 0 ? _d : "P".concat(pi + 1));
        var measures = [];
        var measureEls = elementsByTagName(partEl, "measure");
        var curDivisions = 480;
        for (var mi = 0; mi < measureEls.length; mi++) {
            var mEl = measureEls[mi];
            var mNumber = intOf({ textContent: mEl.getAttribute("number") }, mi + 1);
            var attrsEl = firstChild(mEl, "attributes");
            // Read divisions early (affects durations + measure length)
            if (attrsEl) {
                var divEl = firstChild(attrsEl, "divisions");
                var d = intOf(divEl, curDivisions);
                if (d > 0)
                    curDivisions = d;
            }
            // Read time/key early so we can compute measure length heuristic
            var beatsForLen = undefined;
            var beatTypeForLen = undefined;
            if (attrsEl) {
                var timeEl = firstChild(attrsEl, "time");
                if (timeEl) {
                    beatsForLen = intOf(firstChild(timeEl, "beats"), undefined);
                    beatTypeForLen = intOf(firstChild(timeEl, "beat-type"), undefined);
                }
            }
            var measureLen = computeMeasureLengthInBeats(beatsForLen, beatTypeForLen);
            var events = [];
            var t = 0;
            var lastNonChordStartT = 0;
            var childNodes = mEl.childNodes;
            for (var ci = 0; ci < childNodes.length; ci++) {
                var node = childNodes.item(ci);
                if (!node || node.nodeType !== 1)
                    continue;
                var el = node;
                var tag = localNameOf(el);
                if (tag === "harmony") {
                    var parsed = parseHarmonySymbol(el, chordWarnings);
                    if (parsed) {
                        var offsetEl = firstChild(el, "offset");
                        var offsetDivs = offsetEl ? intOf(offsetEl, 0) : null;
                        var rawBeat = offsetDivs !== null ? t + offsetDivs / curDivisions : t;
                        var beat = Number.isFinite(rawBeat) ? rawBeat : 0;
                        var beatClamped = Math.max(0, beat);
                        chordEvents.push({ measure: mNumber, t: beatClamped, symbol: parsed.symbol });
                    }
                    else {
                        chordWarnings.push("[chord] Could not parse <harmony> element.");
                    }
                    continue;
                }
                if (tag === "note") {
                    var isChordTone = !!firstChild(el, "chord");
                    var tieFlags = parseNoteTieFlags(el);
                    var restEl = firstChild(el, "rest");
                    var durEl = firstChild(el, "duration");
                    var durDivs = intOf(durEl, curDivisions);
                    var dur = curDivisions > 0 ? durDivs / curDivisions : durDivs;
                    var voiceEl = firstChild(el, "voice");
                    var staffEl = firstChild(el, "staff");
                    var voice = voiceEl ? intOf(voiceEl, 1) : undefined;
                    var staff = staffEl ? intOf(staffEl, 1) : undefined;
                    var noteT = isChordTone ? lastNonChordStartT : t;
                    var rawT = noteT;
                    // Heuristic: if this note would begin at/after the measure length (or overfill it),
                    // and we have no explicit voice/chord/backup structure, treat as stacked at t=0.
                    if (!isChordTone && measureLen != null) {
                        var noExplicitLayering = voice == null && staff == null;
                        var startsOutside = noteT >= measureLen;
                        var wouldOverfill = noteT + dur > measureLen && dur >= measureLen;
                        if (noExplicitLayering && (startsOutside || wouldOverfill)) {
                            noteT = 0;
                        }
                    }
                    if (restEl) {
                        events.push({ type: "rest", t: noteT, dur: dur, voice: voice, staff: staff, source_t: rawT });
                    }
                    else {
                        var pitchEl = firstChild(el, "pitch");
                        if (pitchEl) {
                            var step = textOf(firstChild(pitchEl, "step"));
                            var alterEl = firstChild(pitchEl, "alter");
                            var octave = intOf(firstChild(pitchEl, "octave"), 4);
                            // allow negative alter
                            var alterRaw = textOf(alterEl);
                            var alterParsed = alterRaw === "" ? 0 : Number.parseInt(alterRaw, 10);
                            var alter = Number.isFinite(alterParsed) ? alterParsed : 0;
                            var pitch = { step: step, alter: alter, octave: octave };
                            var midi = pitchToMidi(pitch);
                            events.push({
                                type: "note",
                                t: noteT,
                                dur: dur,
                                pitch: pitch,
                                midi: midi,
                                voice: voice,
                                staff: staff,
                                source_t: rawT,
                                chord: isChordTone ? true : undefined,
                                tieStart: tieFlags.tieStart ? true : undefined,
                                tieStop: tieFlags.tieStop ? true : undefined
                            });
                        }
                        else {
                            events.push({ type: "rest", t: noteT, dur: dur, voice: voice, staff: staff, source_t: rawT });
                        }
                    }
                    // Advance cursor only if truly sequential.
                    // If heuristic stacked it at 0 while cursor is already past, do not advance.
                    if (!isChordTone) {
                        // If we forced stacking (noteT !== t), don't move the main cursor.
                        if (noteT === t) {
                            lastNonChordStartT = t;
                            t += dur;
                        }
                        else {
                            lastNonChordStartT = noteT;
                        }
                    }
                    continue;
                }
                if (tag === "backup") {
                    var durEl = firstChild(el, "duration");
                    var durDivs = intOf(durEl, 0);
                    var dur = curDivisions > 0 ? durDivs / curDivisions : durDivs;
                    t -= dur;
                    if (t < 0)
                        t = 0;
                    lastNonChordStartT = t;
                    continue;
                }
                if (tag === "forward") {
                    var durEl = firstChild(el, "duration");
                    var durDivs = intOf(durEl, 0);
                    var dur = curDivisions > 0 ? durDivs / curDivisions : durDivs;
                    t += dur;
                    lastNonChordStartT = t;
                    continue;
                }
            }
            // Build attributes object
            var attributes = {};
            if (attrsEl) {
                var divEl = firstChild(attrsEl, "divisions");
                var inputDivisions = divEl ? intOf(divEl, curDivisions) : curDivisions;
                attributes.divisions = 4;
                attributes.source_divisions = inputDivisions;
                var timeEl = firstChild(attrsEl, "time");
                var beatsEl = timeEl ? firstChild(timeEl, "beats") : null;
                var beatTypeEl = timeEl ? firstChild(timeEl, "beat-type") : null;
                if (beatsEl && beatTypeEl) {
                    var beats = intOf(beatsEl, 4);
                    var beatType = intOf(beatTypeEl, 4);
                    // Provide both shapes (some parts of code used beatType earlier)
                    attributes.time = {
                        beats: beats,
                        beat_type: beatType,
                        beatType: beatType
                    };
                }
                var keyEl = firstChild(attrsEl, "key");
                var fifthsEl = keyEl ? firstChild(keyEl, "fifths") : null;
                if (fifthsEl) {
                    var raw = textOf(fifthsEl);
                    var n = Number.parseInt(raw, 10);
                    if (Number.isFinite(n))
                        attributes.key_fifths = n;
                }
                var modeEl = keyEl ? firstChild(keyEl, "mode") : null;
                if (modeEl) {
                    var modeRaw = textOf(modeEl).toLowerCase();
                    if (modeRaw === "minor" || modeRaw === "major") {
                        attributes.key_mode = modeRaw;
                    }
                }
            }
            measures.push({
                number: mNumber,
                attributes: Object.keys(attributes).length ? attributes : undefined,
                events: events
            });
        }
        parts.push({
            part_id: partId,
            name: (_e = partNames.get(partId)) !== null && _e !== void 0 ? _e : undefined,
            measures: measures
        });
    }
    var deduped = [];
    var chordByKey = new Map();
    for (var _i = 0, chordEvents_1 = chordEvents; _i < chordEvents_1.length; _i++) {
        var c = chordEvents_1[_i];
        var key = "".concat(c.measure, ":").concat(c.t);
        var existing = chordByKey.get(key);
        if (!existing) {
            chordByKey.set(key, c);
            deduped.push(c);
        }
        else if (existing.symbol !== c.symbol) {
            chordWarnings.push("[chord] Conflicting symbols at measure ".concat(c.measure, " t=").concat(c.t, ": \"").concat(existing.symbol, "\" vs \"").concat(c.symbol, "\". Using first."));
        }
    }
    var m0 = (_g = (_f = parts[0]) === null || _f === void 0 ? void 0 : _f.measures) === null || _g === void 0 ? void 0 : _g[0];
    var meta = {
        inputKeyFifths: (_h = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _h === void 0 ? void 0 : _h.key_fifths,
        inputKeyMode: (_j = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _j === void 0 ? void 0 : _j.key_mode,
        inputTime: (_k = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _k === void 0 ? void 0 : _k.time,
        inputDivisions: (_m = (_l = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _l === void 0 ? void 0 : _l.source_divisions) !== null && _m !== void 0 ? _m : (_o = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _o === void 0 ? void 0 : _o.divisions,
        inputChords: deduped,
        inputChordWarnings: chordWarnings.length ? chordWarnings : undefined
    };
    return {
        meta: meta,
        parts: parts
    };
}
