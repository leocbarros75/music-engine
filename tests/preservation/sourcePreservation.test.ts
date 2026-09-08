import { buildPerformance } from "../../src/score/performance.ts";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { pipelineMusicxmlToArrangedMusicxml as pipeline } from '../../src/pipeline/pipelineMusicxmlToArrangedMusicxml.ts';
import { parseMusicXMLToScoreModel as parse } from '../../src/parsers/musicxmlParser.ts';
import { toSoundingScore } from '../../src/score/pitch.ts';
import { prepareSourceLock, verifySourceOutput, snapshotPartXml, compareSnapshots, selectSourceParts } from '../../src/preservation/sourcePreservation.ts';
import { extractChordEventsFromMusicXml as chords } from '../../src/extract/chordEventsFromMusicXml.ts';
import { buildNoteTimeline } from '../../src/score/standard.ts';
import { exportMidi } from '../../apps/web/src/utils/midiExporter.ts';
const hymn = readFileSync(new URL('./fixtures/holy-holy-holy.musicxml', import.meta.url), 'utf8');
const settings: any = { ensemble: 'string_ensemble', style: 'worship', level: 'intermediate', accompaniment: 'homophonic', keySignature: 'original', timeSignature: 'original' };
const clone = <T>(x: T): T => structuredClone(x);
let passed = 0;
function test(name: string, fn: () => void) { fn(); console.log(`PASS ${name}`); passed++; }
function arrange(xml = hymn, extra: any = {}) { const r = pipeline({ musicxml: xml, settings: { ...settings, ...extra } }); assert.equal(r.ok, true, !r.ok ? r.error : ''); if (!r.ok)
    throw Error(r.error); return r; }
function lock(xml = hymn, extra: any = {}) { const r = prepareSourceLock(xml, toSoundingScore(parse(xml)), { ...settings, ...extra }); assert.ok(r.lock); return r.lock; }
function mutate(xml: string, id: string, edit: (p: any) => void) { const doc = new DOMParser().parseFromString(xml, 'application/xml'); const p = Array.from(doc.getElementsByTagName('part')).find(p => p.getAttribute('id') === id)!; edit(p); return new XMLSerializer().serializeToString(doc); }
const attrs = '<attributes><divisions>4</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const note = (step = 'C', dur = 4, extra = '') => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${dur}</duration>${extra}</note>`;
const harmony = '<harmony><root><root-step>C</root-step></root><kind>major</kind><bass><bass-step>E</bass-step></bass></harmony>';
const wrap = (bars: string) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1">${bars}</part></score-partwise>`;
const rich = wrap(`<measure number="0" implicit="yes">${attrs}<direction><direction-type><words>Verse 1</words></direction-type><sound tempo="72"/></direction>${harmony}${note('C', 4, '<tie type="start"/><type>quarter</type><notations><tied type="start"/></notations><lyric number="1"><syllabic>single</syllabic><text>Holy</text></lyric>')}</measure><measure number="1"><barline location="left"><repeat direction="forward"/></barline>${harmony}${note('C', 4, '<tie type="stop"/><notations><tied type="stop"/><articulations><tenuto/></articulations></notations>')}<note><grace slash="yes"/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>${note('E', 8)}<note><rest/><duration>4</duration><type>quarter</type></note><barline location="right"><ending number="1" type="start"/><repeat direction="backward"/></barline></measure><measure number="2"><attributes><divisions>12</divisions><key><fifths>1</fifths><mode>major</mode></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><words>Chorus</words></direction-type><sound tempo="84"/></direction><harmony><root><root-step>G</root-step></root><kind>dominant</kind></harmony>${note('G', 36)}<barline location="right"><ending number="1" type="stop"/><bar-style>light-heavy</bar-style></barline></measure>`);
const normal = arrange();
test('Holy Holy Holy: 45 notes, 33 chords, 16 bars in original octave', () => {
    const report = normal.meta.preservation!;
    assert.equal(report.status, 'verified');
    assert.equal(report.notes, 45);
    assert.equal(report.chords, 33);
    assert.equal(report.measures, 16);
    assert.equal(report.octaveShift, 0);
    assert.deepEqual(compareSnapshots(snapshotPartXml(hymn, 'P1'), snapshotPartXml(normal.musicxml, report.targetPartId!)), []);
    assert.deepEqual(buildNoteTimeline(normal.scoreModel as any).filter(n => n.partIdx === 0).map(n => n.midi), buildNoteTimeline(toSoundingScore(parse(hymn))).map(n => n.midi));
    exportMidi(normal.scoreModel as any);
});
test('polyphonic accompaniment also preserves exact melody', () => { const r = arrange(hymn, { accompaniment: 'polyphonic', textureMode: 'polyphony' }); assert.equal(r.meta.preservation?.status, 'verified'); assert.deepEqual(compareSnapshots(snapshotPartXml(hymn, 'P1'), snapshotPartXml(r.musicxml, r.meta.preservation!.targetPartId!)), []); });
test('explicit upper octave changes pitch only and leaves source immutable', () => { const original = toSoundingScore(parse(hymn)); const before = clone(original); prepareSourceLock(hymn, original, { ...settings, melodyOctaveShift: 1 }); assert.deepEqual(original, before); const r = arrange(hymn, { melodyOctaveShift: 1 }); const expected = snapshotPartXml(hymn, 'P1'); for (const m of expected)
    for (const e of m.events)
        if (e.pitch)
            e.pitch[2]++; assert.deepEqual(compareSnapshots(expected, snapshotPartXml(r.musicxml, r.meta.preservation!.targetPartId!)), []); });
test('pickup, key/meter changes, rests, grace, lyrics, ties, directions and repeats survive', () => { const r = arrange(rich); assert.deepEqual(compareSnapshots(snapshotPartXml(rich, 'P1'), snapshotPartXml(r.musicxml, r.meta.preservation!.targetPartId!)), []); buildNoteTimeline(r.scoreModel as any); exportMidi(r.scoreModel as any); });
for (const [name, tag, change] of [
    ['pitch', 'step', (n: any) => { n.textContent = 'A'; }],
    ['rhythm', 'duration', (n: any) => { n.textContent = '3'; }],
    ['chord', 'kind', (n: any) => { n.textContent = 'minor'; }],
    ['slash bass', 'bass-step', (n: any) => { n.textContent = 'B'; }],
    ['key', 'fifths', (n: any) => { n.textContent = '-2'; }],
    ['meter', 'beats', (n: any) => { n.textContent = '5'; }],
    ['missing note', 'note', (n: any) => { n.parentNode.removeChild(n); }]
] as const)
    test(`independent check rejects corrupted ${name}`, () => { const id = normal.meta.preservation!.targetPartId!; const bad = mutate(normal.musicxml, id, p => change(p.getElementsByTagName(tag)[0])); assert.throws(() => verifySourceOutput(lock(), normal.scoreModel as any, bad, id), /Source preservation failed|Invalid event timing/); });
test('independent check rejects lost lyrics, ties, tempo, repeats and accompaniment ending', () => { const r = arrange(rich), id = r.meta.preservation!.targetPartId!; for (const tag of ['lyric', 'tie', 'sound', 'repeat']) {
    const bad = mutate(r.musicxml, id, p => { const n = p.getElementsByTagName(tag)[0]; n.parentNode.removeChild(n); });
    assert.throws(() => verifySourceOutput(lock(rich), r.scoreModel as any, bad, id), /Source preservation failed/);
} const bad = mutate(r.musicxml, (r.scoreModel as any).parts[1].part_id, p => { const n = p.getElementsByTagName('repeat')[0]; n.parentNode.removeChild(n); }); assert.throws(() => verifySourceOutput(lock(rich), r.scoreModel as any, bad, id), /repeat\/ending/); });
test('independent check rejects internal model mutation', () => { const model = clone(normal.scoreModel) as any; model.parts[0].measures[0].events.find((e: any) => e.type === 'note').pitch.octave++; assert.throws(() => verifySourceOutput(lock(), model, normal.musicxml, normal.meta.preservation!.targetPartId!), /Internal melody/); });
test('no implicit pitch correction for an unplayable register', () => { const low = wrap(`<measure number="1">${attrs}${note('C', 16).replace('<octave>4', '<octave>3')}</measure>`); const r = pipeline({ musicxml: low, settings }); assert.equal(r.ok, false); assert.match((r as any).error, /outside .*range/); assert.equal(arrange(low, { melodyOctaveShift: 1 }).meta.preservation?.status, 'verified'); });
test('key, meter and conflicting chord edits require explicit opt-out', () => { for (const extra of [{ keySignature: 'G' }, { timeSignature: '3/4' }, { melodyOctaveShift: 2 }]) {
    assert.equal(pipeline({ musicxml: hymn, settings: { ...settings, ...extra } }).ok, false);
} const r = pipeline({ musicxml: hymn, settings, chords: [{ measure: 1, t: 0, symbol: 'Am' }] }); assert.equal(r.ok, false); assert.match((r as any).error, /chords differ/); assert.equal(arrange(hymn, { preserveSource: false }).meta.preservation?.status, 'disabled'); });
test('equivalent request chords can be supplied without false mismatch', () => { const r = pipeline({ musicxml: hymn, settings, chords: chords(hymn).chords.map(c => ({ symbol: c.symbol, t: c.t, measure: c.measure })) }); assert.equal(r.ok, true); });
test('polyphonic source and copy modes are never falsely verified', () => { const poly = wrap(`<measure number="1">${attrs}${note('C', 16)}<backup><duration>16</duration></backup>${note('E', 16)}</measure>`); assert.equal(prepareSourceLock(poly, toSoundingScore(parse(poly)), settings).report?.status, 'not_applicable'); assert.equal(prepareSourceLock(hymn, toSoundingScore(parse(hymn)), { ...settings, ensemble: 'piano_string_quartet' }).report?.status, 'not_applicable'); });
test('part filtering preserves original source notation', () => { const two = rich.replace('</part-list>', '<score-part id="P2"><part-name>Bass</part-name></score-part></part-list>').replace('</score-partwise>', `<part id="P2"><measure number="1">${attrs}${note('C', 16)}</measure></part></score-partwise>`); assert.deepEqual(snapshotPartXml(selectSourceParts(two, ['P1']), 'P1'), snapshotPartXml(rich, 'P1')); assert.throws(() => selectSourceParts(two, ['absent']), /None/); });
test('harmony offsets are relative to cursor and grace consumes no beat', () => { const xml = wrap(`<measure number="1">${attrs}${note('C', 4)}<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>${harmony.replace('</harmony>', '<offset>4</offset></harmony>')}${note('E', 12)}</measure>`); assert.equal(chords(xml).chords[0].t, 2); });
for (const ensemble of ['choral', 'woodwind_ensemble', 'brass_ensemble', 'orchestra', 'symphonic_orchestra'])
    test(`${ensemble}: source sounds at original pitch after written export`, () => {
        const r = arrange(hymn, { ensemble });
        assert.equal(r.meta.preservation?.status, 'verified');
        const output = toSoundingScore(parse(r.musicxml));
        const id = r.meta.preservation!.targetPartId!;
        assert.deepEqual(buildNoteTimeline({ ...output, parts: output.parts.filter(p => p.part_id === id) }).map(n => [n.startBeat, n.durationBeats, n.midi]), buildNoteTimeline(toSoundingScore(parse(hymn))).map(n => [n.startBeat, n.durationBeats, n.midi]));
    });
test('transposing source keeps concert pitch, written spelling and slash chords consistent', () => {
    const xml = wrap(`<measure number="1">${attrs.replace('</attributes>', '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>')}${harmony}${note('C', 16)}</measure>`);
    const r = arrange(xml);
    const p = (r.scoreModel as any).parts[0];
    assert.equal(p.measures[0].events[0].midi, 58);
    assert.equal((r.scoreModel as any).meta.inputChords[0].symbol, 'Bb/D');
    assert.equal(chords(r.musicxml).chords[0].symbol, 'Bb/D');
});
test('explicit selection controls harmonization and the protected output', () => {
    const xml = wrap(`<measure number="1">${attrs}${harmony}${note('C', 16)}</measure>`).replace('</part-list>', '<score-part id="P2"><part-name>Solo</part-name></score-part></part-list>').replace('</score-partwise>', `<part id="P2"><measure number="1">${attrs}${note('E', 16)}</measure></part></score-partwise>`);
    const r = arrange(xml, { sourceMelodyPartId: 'P1' });
    assert.equal((r.scoreModel as any).parts[0].measures[0].events[0].midi, 60);
    assert.equal(r.meta.preservation?.status, 'verified');
    assert.throws(() => prepareSourceLock(xml, toSoundingScore(parse(xml)), { ...settings, sourceMelodyPartId: 'missing' }), /not found/);
});
test('independent check catches accompaniment key and meter corruption', () => {
    const id = normal.meta.preservation!.targetPartId!, other = (normal.scoreModel as any).parts[1].part_id;
    for (const tag of ['fifths', 'beats']) {
        const bad = mutate(normal.musicxml, other, p => { p.getElementsByTagName(tag)[0].textContent = '3'; });
        assert.throws(() => verifySourceOutput(lock(), normal.scoreModel as any, bad, id), /Source preservation failed/);
    }
});
/** Read the actual MIDI bytes: a score-model assertion alone cannot catch an export regression. */
function midiNotes(bytes: Uint8Array) {
    const tracks: any[][] = [];
    let pos = 14;
    while (pos < bytes.length) {
        const end = pos + 8 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(pos + 4);
        pos += 8;
        let tick = 0;
        const events: any[] = [];
        const vlq = () => { let v = 0, b: number; do {
            b = bytes[pos++];
            v = v * 128 + (b & 127);
        } while (b & 128); return v; };
        while (pos < end) {
            tick += vlq();
            const status = bytes[pos++];
            if (status === 255) {
                pos++;
                const len = vlq();
                pos += len;
            }
            else if ((status & 240) === 192)
                pos++;
            else {
                const pitch = bytes[pos++], velocity = bytes[pos++];
                if ((status & 240) === 144 || (status & 240) === 128)
                    events.push([tick, (status & 240) === 144 && velocity > 0 ? 'on' : 'off', pitch]);
            }
        }
        tracks.push(events);
    }
    return tracks;
}
test('MIDI melody note-on and note-off bytes match the source performed timeline', () => {
    const expected = buildPerformance(toSoundingScore(parse(hymn))).notes.flatMap(n => [[Math.round(n.startBeat * 480), 'on', n.midi], [Math.round((n.startBeat + n.durationBeats) * 480), 'off', n.midi]]);
    const sort = (xs: any[]) => xs.sort((a, b) => a[0] - b[0] || String(a[1]).localeCompare(String(b[1])) || a[2] - b[2]);
    assert.deepEqual(sort(midiNotes(exportMidi(normal.scoreModel as any))[1]), sort(expected));
});
test('unsupported octave requests fail explicitly instead of being ignored', () => {
    assert.throws(() => prepareSourceLock(hymn, toSoundingScore(parse(hymn)), { ...settings, ensemble: 'piano', melodyOctaveShift: 1 }), /Cannot apply/);
    assert.throws(() => prepareSourceLock(hymn, toSoundingScore(parse(hymn)), { ...settings, preserveSource: false, melodyOctaveShift: 1 }), /requires source preservation/);
});
test('part selection cannot silently discard a separate chord chart', () => {
    const two = rich.replace('</part-list>', '<score-part id="P2"><part-name>Solo</part-name></score-part></part-list>').replace('</score-partwise>', `<part id="P2"><measure number="1">${attrs}${note('E', 16)}</measure></part></score-partwise>`);
    assert.throws(() => selectSourceParts(two, ['P2']), /discard source chord symbols/);
    assert.equal(parse(selectSourceParts(two, ['P2'], false)).parts.length, 1);
});
console.log(`${passed} source-preservation tests passed.`);
