import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { ScoreModel, Part } from '../score/types';
import { parseMusicXMLToScoreModel } from '../parsers/musicxmlParser';
import { toSoundingScore, transposeWrittenPitch } from '../score/pitch';
import { buildMeasureTimeline, buildNoteTimeline, pitchToMidi } from '../score/standard';
import { getInstrumentSpec } from '../instruments/instrumentCatalog';
export type PreservationSettings = {
    preserveSource?: boolean;
    melodyOctaveShift?: number;
    sourceMelodyPartId?: string;
    ensemble?: string;
    keySignature?: string;
    keyFifths?: number;
    keySignatureMode?: string;
    targetKey?: string;
    timeSignature?: string;
    timeSignatureMode?: string;
    stringTexture?: string;
    instrumentation?: string;
    textureMode?: string;
    rhPattern?: string;
};
export type PreservationReport = {
    status: 'verified' | 'not_applicable' | 'disabled';
    reason?: string;
    sourcePartId?: string;
    targetPartId?: string;
    octaveShift?: number;
    measures?: number;
    notes?: number;
    chords?: number;
    checks?: string[];
};
export type SourceLock = {
    xml: string;
    partId: string;
    source: Part;
    expected: Part;
    shift: number;
    score: ScoreModel;
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const serializer = new XMLSerializer();
const children = (node: any, name?: string): any[] => Array.from(node.childNodes ?? []).filter((n: any) => n.nodeType === 1 && (!name || n.localName === name || n.nodeName === name));
const child = (node: any, name: string): any => children(node, name)[0];
const descendants = (node: any, name: string): any[] => Array.from(node.getElementsByTagNameNS('*', name));
const text = (node: any, name: string, fallback = '') => child(node, name)?.textContent ?? fallback;
function document(xml: string): any {
    const errors: string[] = [];
    const doc = new DOMParser({ errorHandler: { warning: () => { }, error: m => errors.push(m), fatalError: m => errors.push(m) } }).parseFromString(xml, 'application/xml');
    if (errors.length || !doc.documentElement || doc.documentElement.localName !== 'score-partwise')
        throw new Error('Source preservation requires valid score-partwise MusicXML.');
    return doc;
}
const xmlPart = (doc: any, id: string): any => children(doc.documentElement, 'part').find(p => p.getAttribute('id') === id);
/** Whitespace/layout-insensitive XML signature; retains musical content and attributes. */
function signature(node: any): any {
    if (!node)
        return null;
    const attrs = Array.from(node.attributes ?? []).filter((a: any) => !['default-x', 'default-y', 'relative-x', 'relative-y'].includes(a.name)).map((a: any) => [a.name, a.value]).sort();
    const elements = children(node);
    return [node.localName ?? node.nodeName, attrs, elements.length ? elements.map(signature) : String(node.textContent ?? '').trim()];
}
function isMonophonic(part: Part): boolean {
    return part.measures.every(m => {
        const notes = m.events.filter(e => e.type === 'note' && !e.grace).sort((a, b) => a.t - b.t);
        return notes.every((n, i) => i === 0 || n.t >= notes[i - 1].t + notes[i - 1].dur - 1e-7);
    });
}
const ENSEMBLES = new Set(['choral', 'satb', 'string_ensemble', 'strings', 'woodwind_ensemble', 'woodwinds', 'brass_ensemble', 'brass', 'orchestra', 'full_orchestra', 'symphonic_orchestra']);
const PIANO_ENSEMBLES = new Set(['piano', 'piano_with_melody', 'grand_piano', 'acoustic_piano']);
/**
 * Whether the arrangement will contain a part dedicated to the melody.
 *
 * Eligibility is really a property of the OUTPUT's shape, not of the ensemble's
 * name. The piano ensembles emit a part literally named "Melody", carrying the
 * source melody note for note, whenever the texture is melody + accompaniment —
 * unless the right hand is set to double the melody itself (melody_only), which
 * folds it back into the grand staff and leaves nothing separate to protect.
 * Every other piano texture merges the melody into the two staves.
 */
function hasProtectedMelodyPart(settings: PreservationSettings): boolean {
    const ensemble = String(settings.ensemble ?? '').toLowerCase();
    if (ENSEMBLES.has(ensemble))
        return true;
    if (!PIANO_ENSEMBLES.has(ensemble))
        return false;
    return String(settings.textureMode ?? '').toLowerCase() === 'homophony_melody_accompaniment'
        && String(settings.rhPattern ?? '').toLowerCase() !== 'melody_only';
}
/**
 * Whether two key signatures are the same key, allowing for enharmonic spelling.
 *
 * A transposing part's key may legitimately be respelled: the exporter writes a B
 * flat clarinet in D flat (-5) rather than C sharp (+7) against a concert B major,
 * because five flats read better than seven sharps. Undoing that transposition
 * arithmetically — fifths plus a fixed shift, as toSoundingScore does — then lands
 * on -7 instead of +5. Same key, different number.
 *
 * So keys are compared by the pitch class of their tonic, which the respelling does
 * not change, rather than by the signed count of accidentals, which it does.
 */
function sameKey(a: unknown, b: unknown): boolean {
    if (typeof a !== 'number' || typeof b !== 'number') return a === b;
    const tonicPc = (fifths: number) => ((fifths * 7) % 12 + 12) % 12;
    return tonicPc(a) === tonicPc(b);
}

export function prepareSourceLock(xml: string, input: ScoreModel, settings: PreservationSettings): {
    lock?: SourceLock;
    report?: PreservationReport;
} {
    const shift = settings.melodyOctaveShift ?? 0;
    const unavailable = (reason: string) => {
        if (shift) throw new Error(`Cannot apply the requested melody octave shift: ${reason}`);
        return { report: { status: 'not_applicable' as const, reason } };
    };
    if (![-1, 0, 1].includes(shift))
        throw new Error('Melody octave shift must be -1, 0, or 1.');
    if (settings.preserveSource === false && shift)
        throw new Error('An explicit melody octave shift requires source preservation to be enabled.');
    if (settings.preserveSource === false)
        return { report: { status: 'disabled', reason: 'Source preservation was explicitly disabled.' } };
    if (settings.instrumentation && settings.instrumentation !== 'auto')
        return unavailable('Copy instrumentation does not have a separately protected melody; preservation is not verified.');
    if (!hasProtectedMelodyPart(settings))
        return unavailable(PIANO_ENSEMBLES.has(String(settings.ensemble ?? '').toLowerCase())
            ? 'The melody is merged into the piano staves here, so there is no separate part to protect. Choose the "melody + accompaniment" texture (with a right-hand pattern other than melody_only) to get a verified melody part.'
            : 'This mode does not have a separately protected melody part; no preservation guarantee is made.');
    if ((settings.keyFifths !== undefined && settings.keySignatureMode !== 'original' && settings.keySignature !== 'original') || (settings.keySignatureMode === 'manual') || (settings.targetKey && settings.targetKey !== 'original') || (settings.keySignature && settings.keySignature !== 'original') || settings.timeSignatureMode === 'manual' || (settings.timeSignature && settings.timeSignature !== 'original')) {
        // The piano modes only became eligible for preservation here, and transposing
        // a piano arrangement is an everyday thing to do. Failing the whole render
        // with an error about a setting the user never turned on would be a plain
        // regression, so they decline instead and say why. The ensembles that have
        // always been eligible keep their long-standing hard guardrail — and an
        // explicit melody octave shift still errors either way, via unavailable().
        if (PIANO_ENSEMBLES.has(String(settings.ensemble ?? '').toLowerCase()))
            return unavailable('The key or meter was changed, so the melody is deliberately not the source melody and cannot be verified against it. Keep both at Original to get a verified melody.');
        throw new Error('Source preservation locks the original key and meter. Keep those settings at Original, or explicitly turn off source preservation.');
    }
    let part: Part | undefined;
    if (settings.sourceMelodyPartId) {
        part = input.parts.find(p => p.part_id === settings.sourceMelodyPartId);
        if (!part)
            throw new Error(`Source melody part "${settings.sourceMelodyPartId}" was not found.`);
    }
    else {
        const named = input.parts.filter(p => /^(melody|soprano|voice|vocal|violin i|violin 1)$/i.test(p.name.trim()));
        if (named.length > 1)
            throw new Error('Several possible melody parts were found. Select sourceMelodyPartId explicitly.');
        part = named[0] ?? (input.parts.length === 1 ? input.parts[0] : undefined);
    }
    if (!part || !part.measures.some(m => m.events.some(e => e.type === 'note')) || !isMonophonic(part))
        return unavailable('A single unambiguous monophonic melody is required. Select a melody part; no exact-preservation claim is made for this source.');
    const sourceDoc = document(xml), sourceXml = xmlPart(sourceDoc, part.part_id);
    if (children(sourceDoc.documentElement, 'part').some(p => p.getAttribute('id') !== part!.part_id && descendants(p, 'harmony').length))
        return unavailable('Chord symbols are distributed across source parts. Select a melody part containing the complete chord chart; preservation is not verified.');
    const transposes = descendants(sourceXml, 'transpose');
    if (new Set(transposes.map(t => JSON.stringify(signature(t)))).size > 1 || (transposes.length > 0 && !descendants(children(sourceXml, 'measure')[0], 'transpose').length) || descendants(sourceXml, 'staves').some(s => Number(s.textContent) > 1))
        return unavailable('Multiple staves or changing instrument transposition require a separate source-preservation check.');
    if (descendants(sourceXml, 'alter').some(a => !Number.isInteger(Number(a.textContent))) || descendants(sourceXml, 'unpitched').length)
        return unavailable('Microtonal or unpitched sources need a separate pitch-preservation model.');
    const expected = clone(part);
    for (const m of expected.measures)
        for (const e of m.events)
            if (e.type === 'note') {
                e.pitch.octave += shift;
                e.midi = pitchToMidi(e.pitch);
            }
    return { lock: { xml, partId: part.part_id, source: clone(part), expected, shift, score: clone(input) } };
}
export function chooseMelodyTarget(score: ScoreModel, settings: PreservationSettings): Part {
    const names = settings.stringTexture === 'cello_melody' ? ['cello', 'violoncello'] : ['melody', 'soprano', 'violin i', 'violin 1', 'flute', 'flute / oboe', 'flute & oboe', 'trumpet 1', 'trumpet i'];
    for (const name of names) {
        const p = score.parts.find(p => p.name.toLowerCase() === name);
        if (p)
            return p;
    }
    const candidate = score.parts.find(p => /^(flute|trumpet 1|violin i)\b/i.test(p.name));
    if (candidate)
        return candidate;
    throw new Error('Cannot identify a dedicated output melody part for source preservation.');
}
/** Restore immutable source events after all accompaniment passes; never shift to fit silently. */
export function lockSourceInModel(lock: SourceLock, score: ScoreModel, settings: PreservationSettings): string {
    const target = chooseMelodyTarget(score, settings);
    const spec = getInstrumentSpec(target.instrument);
    if (spec)
        for (const m of lock.expected.measures)
            for (const e of m.events)
                if (e.type === 'note') {
                    const midi = pitchToMidi(e.pitch);
                    if (midi < spec.midi_low || midi > spec.midi_high)
                        throw new Error(`Preserved melody is outside ${target.name}'s range at measure ${m.number}. Choose an explicit octave shift or another instrument.`);
                }
    const expectedClock = buildMeasureTimeline(lock.score);
    for (const p of score.parts) {
        if (p.measures.length !== expectedClock.length)
            throw new Error(`Source form changed: ${p.name} has ${p.measures.length} measures; expected ${expectedClock.length}.`);
        p.measures.forEach((m, i) => {
            const source = lock.expected.measures[i];
            m.number = source.number;
            m.implicit = source.implicit;
            m.durationBeats = source.durationBeats;
            m.attributes = { ...m.attributes, time: clone(expectedClock[i].time), key_fifths: source.attributes?.key_fifths, key_mode: source.attributes?.key_mode };
        });
    }
    target.pitchSpace = 'sounding';
    target.measures = clone(lock.expected.measures);
    (score.meta as any).inputChords = clone((lock.score.meta as any).inputChords ?? []);
    return target.part_id;
}
function setText(doc: any, parent: any, name: string, value: unknown) { let n = child(parent, name); if (!n) {
    n = doc.createElement(name);
    parent.appendChild(n);
} n.textContent = String(value); }
function transformSourcePart(source: any, output: any, sourceModel: Part, targetModel: Part, shift: number): any {
    const doc = output.ownerDocument;
    const result = doc.importNode(source, true);
    result.setAttribute('id', output.getAttribute('id'));
    const inverseTarget = { diatonic: -(targetModel.transpose?.diatonic ?? 0), chromatic: -(targetModel.transpose?.chromatic ?? 0), octaveChange: -(targetModel.transpose?.octaveChange ?? 0) };
    const srcTrans = sourceModel.transpose;
    const sourceFifths = 7 * (srcTrans?.chromatic ?? 0) - 12 * (srcTrans?.diatonic ?? 0);
    const targetFifths = 7 * inverseTarget.chromatic - 12 * inverseTarget.diatonic;
    const clef = descendants(output, 'clef')[0];
    const targetEntry = descendants(doc, 'score-part').find(p => p.getAttribute('id') === output.getAttribute('id'));
    const instrumentId = targetEntry && descendants(targetEntry, 'score-instrument')[0]?.getAttribute('id');
    for (const inst of descendants(result, 'instrument')) {
        if (instrumentId)
            inst.setAttribute('id', instrumentId);
        else
            inst.parentNode.removeChild(inst);
    }
    for (const m of children(result, 'measure')) {
        for (const print of children(m, 'print'))
            m.removeChild(print);
        for (const attrs of children(m, 'attributes')) {
            for (const tr of children(attrs, 'transpose'))
                attrs.removeChild(tr);
            for (const c of children(attrs, 'clef')) {
                if (clef)
                    attrs.replaceChild(doc.importNode(clef, true), c);
            }
            for (const key of children(attrs, 'key'))
                setText(doc, key, 'fifths', Number(text(key, 'fifths', '0')) + sourceFifths + targetFifths);
        }
        for (const n of children(m, 'note')) {
            const p = child(n, 'pitch');
            if (!p)
                continue;
            let pitch = { step: text(p, 'step'), alter: Number(text(p, 'alter', '0')), octave: Number(text(p, 'octave')) };
            pitch = transposeWrittenPitch(transposeWrittenPitch(pitch, srcTrans), inverseTarget);
            pitch.octave += shift;
            setText(doc, p, 'step', pitch.step);
            setText(doc, p, 'alter', pitch.alter);
            setText(doc, p, 'octave', pitch.octave);
            // MusicXML pitch children have a fixed order.
            for (const tag of ['step', 'alter', 'octave'])
                p.appendChild(child(p, tag));
            if (sourceFifths || targetFifths)
                for (const acc of children(n, 'accidental'))
                    n.removeChild(acc);
        }
        for (const harmony of children(m, 'harmony'))
            for (const kind of ['root', 'bass']) {
                const p = child(harmony, kind);
                if (!p)
                    continue;
                const pitch = transposeWrittenPitch(transposeWrittenPitch({ step: text(p, kind + '-step'), alter: Number(text(p, kind + '-alter', '0')), octave: 4 }, srcTrans), inverseTarget);
                setText(doc, p, kind + '-step', pitch.step);
                if (pitch.alter || child(p, kind + '-alter'))
                    setText(doc, p, kind + '-alter', pitch.alter);
            }
    }
    // Use target instrument clef/transposition, source divisions and source meter/key.
    const first = children(result, 'measure')[0];
    let attrs = child(first, 'attributes');
    if (!attrs) {
        attrs = doc.createElement('attributes');
        first.insertBefore(attrs, first.firstChild);
    }
    if (!child(attrs, 'clef') && clef)
        attrs.appendChild(doc.importNode(clef, true));
    const trans = descendants(output, 'transpose')[0];
    if (trans)
        attrs.appendChild(doc.importNode(trans, true));
    return result;
}
/** Canonical musical snapshot, intentionally independent of the engine's note parser. */
export function snapshotPartXml(xml: string, partId: string): any[] {
    const part = xmlPart(document(xml), partId);
    if (!part)
        throw new Error(`Missing part ${partId}.`);
    let divisions = 1, key: any = null, time: any = null;
    return children(part, 'measure').map(m => {
        let t = 0, last = 0;
        const events: any[] = [], chords: any[] = [], directions: any[] = [];
        for (const e of children(m)) {
            if (e.localName === 'attributes') {
                if (child(e, 'divisions'))
                    divisions = Number(text(e, 'divisions'));
                if (child(e, 'key'))
                    key = signature(child(e, 'key'));
                if (child(e, 'time'))
                    time = signature(child(e, 'time'));
            }
            else if (e.localName === 'backup')
                t -= Number(text(e, 'duration')) / divisions;
            else if (e.localName === 'forward')
                t += Number(text(e, 'duration')) / divisions;
            else if (e.localName === 'note') {
                const onset = child(e, 'chord') ? last : t;
                const dur = child(e, 'grace') ? 0 : Number(text(e, 'duration', '0')) / divisions;
                const p = child(e, 'pitch');
                events.push({ t: onset, dur, pitch: p ? [text(p, 'step'), Number(text(p, 'alter', '0')), Number(text(p, 'octave'))] : null,
                    grace: signature(child(e, 'grace')), ties: children(e, 'tie').map(signature), notations: children(e, 'notations').map(signature), lyrics: children(e, 'lyric').map(signature) });
                if (!child(e, 'chord')) {
                    last = t;
                    t += dur;
                }
            }
            else if (e.localName === 'harmony')
                chords.push({ t: t + Number(text(e, 'offset', '0')) / divisions, xml: signature(e) });
            else if (e.localName === 'direction')
                directions.push({ t: t + Number(text(e, 'offset', '0')) / divisions, xml: signature(e) });
        }
        return { number: m.getAttribute('number'), implicit: m.getAttribute('implicit') === 'yes', key, time, events, chords, directions, barlines: children(m, 'barline').map(signature) };
    });
}
export function compareSnapshots(expected: any[], actual: any[]): string[] {
    const issues: string[] = [];
    if (expected.length !== actual.length)
        issues.push(`form: expected ${expected.length} measures, received ${actual.length}`);
    expected.forEach((m, i) => {
        const a = actual[i];
        if (!a)
            return;
        for (const field of ['number', 'implicit', 'key', 'time', 'chords', 'directions', 'barlines'])
            if (JSON.stringify(m[field]) !== JSON.stringify(a[field]))
                issues.push(`measure ${m.number}: ${field} changed`);
        if (m.events.length !== a.events.length)
            issues.push(`measure ${m.number}: melody event count changed`);
        m.events.forEach((e: any, j: number) => { if (JSON.stringify(e) !== JSON.stringify(a.events[j]))
            issues.push(`measure ${m.number}, beat ${e.t}: melody event ${j + 1} changed`); });
    });
    return issues;
}
export function preserveAndVerifyXml(lock: SourceLock, score: ScoreModel, generatedXml: string, targetId: string): {
    xml: string;
    report: PreservationReport;
} {
    const srcDoc = document(lock.xml), doc = document(generatedXml);
    const source = xmlPart(srcDoc, lock.partId), target = xmlPart(doc, targetId);
    if (!source || !target)
        throw new Error('Missing protected melody part during export.');
    const sourceWritten = parseMusicXMLToScoreModel(lock.xml).parts.find(p => p.part_id === lock.partId)!;
    const targetWritten = parseMusicXMLToScoreModel(generatedXml).parts.find(p => p.part_id === targetId)!;
    const protectedPart = transformSourcePart(source, target, sourceWritten, targetWritten, lock.shift);
    target.parentNode.replaceChild(protectedPart, target);
    const sourceMeasures = children(protectedPart, 'measure');
    for (const p of children(doc.documentElement, 'part'))
        if (p.getAttribute('id') !== targetId) {
            children(p, 'measure').forEach((m, i) => {
                for (const b of children(m, 'barline'))
                    m.removeChild(b);
                for (const b of children(sourceMeasures[i], 'barline'))
                    m.appendChild(doc.importNode(b, true));
            });
        }
    const xml = serializer.serializeToString(doc);
    return { xml, report: verifySourceOutput(lock, score, xml, targetId) };
}
/** Independent verification entry point, also used by fault-injection regression tests. */
export function verifySourceOutput(lock: SourceLock, score: ScoreModel, xml: string, targetId: string): PreservationReport {
    const srcDoc = document(lock.xml), expectedDoc = document(xml);
    const source = xmlPart(srcDoc, lock.partId), actualPart = xmlPart(expectedDoc, targetId);
    if (!actualPart)
        throw new Error(`Source preservation failed: missing melody part ${targetId}.`);
    const sourceWritten = parseMusicXMLToScoreModel(lock.xml).parts.find(p => p.part_id === lock.partId)!;
    const targetWritten = parseMusicXMLToScoreModel(xml).parts.find(p => p.part_id === targetId)!;
    const expectedPart = transformSourcePart(source, actualPart, sourceWritten, targetWritten, lock.shift);
    actualPart.parentNode.replaceChild(expectedPart, actualPart);
    const issues = compareSnapshots(snapshotPartXml(serializer.serializeToString(expectedDoc), targetId), snapshotPartXml(xml, targetId));
    const actualScore = toSoundingScore(parseMusicXMLToScoreModel(xml));
    const actual = actualScore.parts.find(p => p.part_id === targetId)!;
    const eventSignature = (p: Part) => p.measures.map(m => m.events.map(e => [e.type, e.t, e.dur, e.type === 'note' ? pitchToMidi(e.pitch) : null]));
    if (JSON.stringify(eventSignature(actual)) !== JSON.stringify(eventSignature(lock.expected)))
        issues.push('Exported melody differs from the locked source pitches/rhythm.');
    const targetModel = score.parts.find(p => p.part_id === targetId);
    if (!targetModel || JSON.stringify(eventSignature(targetModel)) !== JSON.stringify(eventSignature(lock.expected)))
        issues.push('Internal melody differs from the locked source.');
    const expectedClock = buildMeasureTimeline(lock.score);
    try {
        const actualClock = buildMeasureTimeline(actualScore);
        buildNoteTimeline(actualScore);
        buildNoteTimeline(score);
        if (JSON.stringify(expectedClock.map(m => [m.startBeat, m.durationBeats, m.time])) !== JSON.stringify(actualClock.map(m => [m.startBeat, m.durationBeats, m.time])))
            issues.push('Exported measure timeline changed.');
    }
    catch (error) {
        issues.push(String((error as Error).message));
    }
    for (const p of actualScore.parts)
        p.measures.forEach((m, i) => {
            const src = lock.expected.measures[i];
            if (src && (m.number !== src.number || !sameKey(m.attributes?.key_fifths, src.attributes?.key_fifths) || m.attributes?.key_mode !== src.attributes?.key_mode))
                issues.push(`measure ${src.number}: source key or measure label changed in ${p.name}`);
        });
    const actualDoc = document(xml), expectedBars = children(expectedPart, 'measure');
    for (const part of children(actualDoc.documentElement, 'part')) {
        const bars = children(part, 'measure');
        if (bars.length !== expectedBars.length)
            issues.push(`form: ${part.getAttribute('id')} measure count changed`);
        bars.forEach((m, i) => { if (JSON.stringify(children(m, 'barline').map(signature)) !== JSON.stringify(children(expectedBars[i] ?? {}, 'barline').map(signature)))
            issues.push(`measure ${i + 1}: repeat/ending barlines changed in ${part.getAttribute('id')}`); });
    }
    if (issues.length)
        throw new Error(`Source preservation failed: ${issues.join('; ')}`);
    const snap = snapshotPartXml(xml, targetId);
    return { status: 'verified', sourcePartId: lock.partId, targetPartId: targetId, octaveShift: lock.shift, measures: snap.length, notes: lock.expected.measures.reduce((n, m) => n + m.events.filter(e => e.type === 'note').length, 0), chords: snap.reduce((n, m) => n + m.chords.length, 0), checks: ['melody pitches and register', 'note/rest timing', 'chord symbols and placement', 'measure order, meter and key', 'lyrics, ties, notation and source directions', 'repeat/ending barlines'] };
}
/** Filter the original XML directly, avoiding a destructive parse/re-export cycle. */
export function selectSourceParts(xml: string, ids: string[], preserveChords = true): string {
    if (!ids.length)
        return xml;
    const doc = document(xml);
    const parts = children(doc.documentElement, 'part');
    if (!parts.some(p => ids.includes(p.getAttribute('id'))))
        throw new Error('None of the selected source parts exists.');
    if (preserveChords) {
        const chart = (p: any) => snapshotPartXml(xml, p.getAttribute('id')).flatMap(m => m.chords.map((c: any) => JSON.stringify([m.number, c])));
        const kept = new Set(parts.filter(p => ids.includes(p.getAttribute('id'))).flatMap(chart));
        if (parts.filter(p => !ids.includes(p.getAttribute('id'))).flatMap(chart).some(c => !kept.has(c)))
            throw new Error('Part selection would discard source chord symbols. Include the part carrying those chords, or explicitly disable source preservation.');
    }
    for (const p of parts)
        if (!ids.includes(p.getAttribute('id')))
            p.parentNode.removeChild(p);
    const list = child(doc.documentElement, 'part-list');
    for (const p of children(list))
        if (p.localName === 'part-group' || !ids.includes(p.getAttribute('id')))
            list.removeChild(p);
    return serializer.serializeToString(doc);
}
