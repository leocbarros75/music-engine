import assert from 'node:assert/strict';
import { parseMusicXMLToScoreModel as parse } from '../../src/parsers/musicxmlParser.ts';
import { toSoundingScore } from '../../src/score/pitch.ts';
import { buildPerformance } from '../../src/score/performance.ts';
import { exportScoreModelToMusicXML as exportXml } from '../../src/exporters/musicxmlExporter.ts';
import { exportSatbScoreModelToMusicXML as exportSatb } from '../../src/exporters/satbMusicxmlExporter.ts';
import { synchronizePerformance } from '../../src/exporters/synchronizePerformance.ts';
import { exportMidi } from '../../apps/web/src/utils/midiExporter.ts';
import { buildPlaybackSchedule, resumeSchedule, scheduleInstrumentNotes } from '../../apps/web/src/utils/playbackSchedule.ts';
import { instrumentPlayback } from '../../src/score/instrumentPlayback.ts';
import { pipelineMusicxmlToArrangedMusicxml as pipeline } from '../../src/pipeline/pipelineMusicxmlToArrangedMusicxml.ts';
import { readFileSync } from 'node:fs';
let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }
const attrs = (beats = 1) => `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time></attributes>`;
const note = (step = 'C', duration = 4, extra = '') => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${extra}<voice>1</voice></note>`;
const tempo = (bpm: number, offset = 0) => `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><offset>${offset}</offset><sound tempo="${bpm}"/></direction>`;
const wrap = (bars: string) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1">${bars}</part></score-partwise>`;
const model = (xml: string) => toSoundingScore(parse(xml));
const repeatStart = '<barline location="left"><repeat direction="forward"/></barline>';
const repeatEnd = (times = 2) => `<barline location="right"><repeat direction="backward" times="${times}"/></barline>`;
const end = (number: number, type = 'start', location = 'left') => `<barline location="${location}"><ending number="${number}" type="${type}"/></barline>`;
const ties = wrap(`<measure number="1">${attrs()}${tempo(60)}${note('C', 4, '<tie type="start"/>')}</measure><measure number="2">${note('C', 4, '<tie type="stop"/><tie type="start"/>')}</measure><measure number="3">${note('C', 4, '<tie type="stop"/>')}</measure>`);
const repeats = wrap(`<measure number="1">${attrs()}${tempo(60)}${repeatStart}${note()}</measure><measure number="2">${note('D')}${repeatEnd()}</measure><measure number="3">${note('E')}</measure>`);
const signature = (p: any) => p.notes.map((n: any) => [n.midi, n.startBeat, n.durationBeats, n.velocity, n.startSec, n.durationSec]);
/** Decode real MIDI bytes, integrating its conductor tempo events independently. */
function decode(bytes: Uint8Array) {
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
                const type = bytes[pos++], len = vlq();
                events.push({ tick, type, data: [...bytes.slice(pos, pos + len)] });
                pos += len;
            }
            else if ((status & 240) === 192)
                events.push({ tick, status, program: bytes[pos++] });
            else
                events.push({ tick, status, pitch: bytes[pos++], velocity: bytes[pos++] });
        }
        tracks.push(events);
    }
    const tempos = tracks[0].filter(e => e.type === 81).map(e => ({ tick: e.tick, micros: e.data[0] * 65536 + e.data[1] * 256 + e.data[2] }));
    const seconds = (tick: number) => { let sec = 0, last = 0, micros = 500000; for (const t of tempos) {
        if (t.tick > tick)
            break;
        sec += (t.tick - last) * micros / 480e6;
        last = t.tick;
        micros = t.micros;
    } return sec + (tick - last) * micros / 480e6; };
    return { tracks, seconds };
}
test('ties across three bars produce one sustained attack', () => { const p = buildPerformance(model(ties)); assert.deepEqual(signature(p), [[60, 0, 3, 80, 0, 3]]); });
test('repeated same pitches without ties are separate attacks', () => { const p = buildPerformance(model(ties.replace(/<tie[^>]*\/>/g, ''))); assert.equal(p.notes.length, 3); assert.deepEqual(p.notes.map(n => n.startSec), [0, 1, 2]); });
test('basic repeats unfold into the same audible order', () => { const p = buildPerformance(model(repeats)); assert.deepEqual(p.notes.map(n => n.midi), [60, 62, 60, 62, 64]); assert.equal(p.durationSec, 5); });
test('first and second endings choose the correct pass', () => { const xml = wrap(`<measure number="1">${attrs()}${tempo(60)}${repeatStart}${note()}</measure><measure number="2">${end(1)}${note('D')}${end(1, 'stop', 'right')}${repeatEnd()}</measure><measure number="3">${end(2)}${note('E')}${end(2, 'discontinue', 'right')}</measure>`); assert.deepEqual(buildPerformance(model(xml)).notes.map(n => n.midi), [60, 62, 60, 64]); });
test('nested repeats reset on the next outer pass', () => { const xml = wrap(`<measure number="1">${attrs()}${repeatStart}${note()}</measure><measure number="2">${repeatStart}${note('D')}${repeatEnd()}</measure><measure number="3">${note('E')}${repeatEnd()}</measure>`); assert.deepEqual(buildPerformance(model(xml)).notes.map(n => n.midi), [60, 62, 62, 64, 60, 62, 62, 64]); });
test('tempo changes integrate across a held note', () => { const xml = wrap(`<measure number="1">${attrs(4)}${tempo(60)}${tempo(120, 8)}${note('C', 16)}</measure>`); const p = buildPerformance(model(xml)); assert.equal(p.durationSec, 3); assert.equal(p.notes[0].durationSec, 3); assert.deepEqual(p.tempos.map(t => [t.beat, t.bpm]), [[0, 60], [2, 120]]); });
test('dotted metronome units become quarter-note BPM', () => { const xml = wrap(`<measure number="1">${attrs(3)}<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>${note('C', 12)}</measure>`); assert.ok(Math.abs(buildPerformance(model(xml)).durationSec - 2) < .00001); });
test('repeat restores its written starting tempo', () => { const xml = repeats.replace(`${note('D')}${repeatEnd()}`, `${tempo(120)}${note('D')}${repeatEnd()}`); const p = buildPerformance(model(xml)); assert.deepEqual(p.tempos.map(t => [t.beat, t.bpm]), [[0, 60], [1, 120], [2, 60], [3, 120]]); assert.equal(p.durationSec, 3.5); });
test('explicit tempo override scales, rather than erases, tempo changes', () => { const xml = wrap(`<measure number="1">${attrs(2)}${tempo(60)}${note()}${tempo(120)}${note('D')}</measure>`); const p = buildPerformance(model(xml), 120); assert.deepEqual(p.tempos.map(t => t.bpm), [120, 240]); assert.equal(p.durationSec, .75); });
test('grace notes steal a bounded amount from the principal note', () => { const xml = wrap(`<measure number="1">${attrs()}${tempo(60)}<note><grace slash="yes"/><pitch><step>B</step><octave>3</octave></pitch></note>${note()}</measure>`); const p = buildPerformance(model(xml)); assert.deepEqual(p.notes.map(n => [n.midi, n.startBeat, n.durationBeats]), [[59, 0, .25], [60, .25, .75]]); assert.equal(p.durationSec, 1); assert.ok(p.warnings.length); });
test('dynamics and staccato use the same velocity and duration', () => { const xml = wrap(`<measure number="1">${attrs()}${tempo(60)}<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>${note('C', 4, '<notations><articulations><staccato/></articulations></notations>')}</measure>`); assert.deepEqual(signature(buildPerformance(model(xml))), [[60, 0, .5, 56, 0, .5]]); });
test('MIDI bytes and audio agree on ties, repeats, tempo and duration', () => { for (const xml of [ties, repeats]) {
    const score = model(xml), schedule = buildPlaybackSchedule(score), midi = decode(exportMidi(score));
    const events = midi.tracks[1].filter(e => e.status !== undefined && (e.status & 240) !== 192);
    assert.equal(events.length, schedule.length * 2);
    for (const [i, n] of schedule.entries()) {
        assert.equal(events[i * 2].pitch, n.midi);
        assert.equal(events[i * 2].velocity, n.velocity);
        assert.equal(midi.seconds(events[i * 2].tick), n.startSec);
        assert.equal(midi.seconds(events[i * 2 + 1].tick) - n.startSec, n.durSec);
    }
} });
test('trailing rests remain in MIDI and playback duration', () => { const xml = wrap(`<measure number="1">${attrs(2)}${tempo(60)}${note()}<note><rest/><duration>4</duration></note></measure>`); const score = model(xml), midi = decode(exportMidi(score)); assert.equal(buildPlaybackSchedule(score).durationSec, 2); assert.equal(midi.seconds(midi.tracks[0].at(-1).tick), 2); });
test('resume retains the remainder of a sustained note', () => { const p = buildPlaybackSchedule(model(ties)); assert.deepEqual(resumeSchedule(p, 1.25).map(n => [n.startSec, n.durSec]), [[1.25, 1.75]]); });
test('SATB and instrumental export retain performance notation', () => { for (const xml of [ties, repeats])
    for (const exporter of [exportXml, exportSatb]) {
        const s = model(xml);
        assert.deepEqual(signature(buildPerformance(model(exporter(s)))), signature(buildPerformance(s)));
    } });
test('grace and dynamic metadata survive notation round trip', () => { const xml = wrap(`<measure number="1">${attrs()}${tempo(60)}<direction><direction-type><dynamics><f/></dynamics></direction-type></direction><note><grace/><pitch><step>B</step><octave>3</octave></pitch></note>${note('C', 4, '<notations><articulations><accent/></articulations></notations>')}</measure>`); const s = model(xml); assert.deepEqual(signature(buildPerformance(model(exportXml(s)))), signature(buildPerformance(s))); });
test('instrument identity does not confuse bassoon with bass', () => { assert.equal(instrumentPlayback({ instrument: 'bassoon' }).soundfont, 'bassoon'); assert.equal(instrumentPlayback({ instrument: 'double_bass' }).program, 43); assert.equal(instrumentPlayback({ instrument: 'soprano' }).soundfont, 'choir_aahs'); });
test('large MIDI scores use ports instead of conflicting channel programs', () => { const s = model(ties); s.parts = Array.from({ length: 16 }, (_, i) => ({ ...structuredClone(s.parts[0]), part_id: `P${i}` })); const m = decode(exportMidi(s)); assert.deepEqual(m.tracks[1].find(e => e.type === 33).data, [0]); assert.deepEqual(m.tracks[16].find(e => e.type === 33).data, [1]); });
test('unsupported jumps fail explicitly in both MIDI and playback', () => { const xml = ties.replace('</measure>', '<direction><direction-type><words>D.C.</words></direction-type><sound dacapo="yes"/></direction></measure>'); const s = model(xml); assert.throws(() => exportMidi(s), /D.C./); assert.throws(() => buildPlaybackSchedule(s), /D.C./); });
test('source and final synchronized score perform identically', () => { const s = model(ties); const r = synchronizePerformance(ties, { ...s, meta: { ...s.meta, tempo_bpm: 120 } }); assert.equal(r.report.status, 'ready'); assert.equal(r.scoreModel.meta.tempo_bpm, 60); assert.deepEqual(signature(buildPerformance(r.scoreModel)), signature(buildPerformance(model(r.musicxml)))); });
test('Holy Holy Holy pipeline returns the actual exported performance', () => { const xml = readFileSync(new URL('../preservation/fixtures/holy-holy-holy.musicxml', import.meta.url), 'utf8'); const r = pipeline({ musicxml: xml, settings: { ensemble: 'string_ensemble', style: 'worship', level: 'intermediate', tempo: 72 } }); assert.ok(r.ok, !r.ok ? r.error : ''); if (!r.ok)
    return; assert.equal(r.meta.performance?.status, 'ready'); assert.deepEqual(signature(buildPerformance(r.scoreModel as any)), signature(buildPerformance(model(r.musicxml)))); });
test('nested alternate endings belong to the inner repeat', () => { const xml = wrap(`<measure number="1">${attrs()}${repeatStart}${note('C')}</measure><measure number="2">${repeatStart}${note('D')}</measure><measure number="3">${end(1)}${note('E')}${end(1, 'stop', 'right')}${repeatEnd()}</measure><measure number="4">${end(2)}${note('F')}${end(2, 'discontinue', 'right')}</measure><measure number="5">${note('G')}${repeatEnd()}</measure>`); assert.deepEqual(buildPerformance(model(xml)).notes.map(n => n.midi), [60, 62, 64, 62, 65, 67, 60, 62, 64, 62, 65, 67]); });
test('metadata-only tempo is visible and audible after export', () => { const s = model(ties.replace(/<direction>[\s\S]*?<\/direction>/g, '')); s.meta.tempo_bpm = 75; assert.deepEqual(signature(buildPerformance(model(exportXml(s)))), signature(buildPerformance(s))); });
test('player uses the correct library API, duration and velocity', () => { const calls: any[] = [], stops: any[] = []; const instrument = { play: (...args: any[]) => { calls.push(args); return { stop: (t: number) => stops.push(t) }; } }; const stop = scheduleInstrumentNotes([instrument], [{ partIdx: 0, midi: 60, startSec: 1, durSec: 2, velocity: 64 }], 10); assert.deepEqual(calls, [[60, 11, { duration: 2, gain: 64 / 127 }]]); stop(); assert.deepEqual(stops, [0]); });
test('grace chord members sound simultaneously', () => { const xml = wrap(`<measure number="1">${attrs()}<note><grace/><pitch><step>B</step><octave>3</octave></pitch></note><note><grace/><chord/><pitch><step>D</step><octave>4</octave></pitch></note>${note()}</measure>`); const s = model(xml); assert.deepEqual(buildPerformance(s).notes.map(n => [n.midi, n.startBeat, n.durationBeats]), [[59, 0, .25], [62, 0, .25], [60, .25, .75]]); assert.deepEqual(signature(buildPerformance(model(exportXml(s)))), signature(buildPerformance(s))); });
test('server MIDI is byte-identical to browser MIDI for the final score', () => { const s = model(ties); const r = synchronizePerformance(ties, s); assert.deepEqual(Buffer.from(r.midiBase64!, 'base64'), Buffer.from(exportMidi(r.scoreModel))); });
test('written clarinet and octave-transposing bass share sounding pitch across formats', () => { for (const [chromatic, diatonic, octave, expected] of [[-2, -1, 0, 58], [0, 0, -1, 48]]) {
    const xml = wrap(`<measure number="1">${attrs().replace('</attributes>', `<transpose><diatonic>${diatonic}</diatonic><chromatic>${chromatic}</chromatic><octave-change>${octave}</octave-change></transpose></attributes>`)}${note()}</measure>`);
    const s = model(xml);
    s.parts[0].instrument = octave ? 'double_bass' : 'clarinet_bb';
    assert.equal(buildPlaybackSchedule(s)[0].midi, expected);
    assert.equal(decode(exportMidi(s)).tracks[1].find(e => (e.status & 240) === 144).pitch, expected);
    assert.equal(buildPerformance(model(exportXml(s))).notes[0].midi, expected);
} });
test('invalid tempo, dynamics and repeat loops are rejected', () => { const s = model(ties); s.parts[0].measures[0].performance!.tempos![0].bpm = 0; assert.throws(() => buildPerformance(s), /Invalid tempo/); const invalid = model(repeats); invalid.parts[0].measures[1].performance!.repeatEnd = 999; assert.throws(() => buildPerformance(invalid), /Repeat count/); const badDynamic = model(ties); badDynamic.parts[0].measures[0].performance!.dynamics = [{ t: 0, velocity: NaN }]; assert.throws(() => buildPerformance(badDynamic), /Invalid dynamic/); });
test('fractional rhythms use exactly the same clock in MIDI and audio', () => { const xml = wrap(`<measure number="1">${attrs().replace('<divisions>4', '<divisions>7')}${tempo(60)}${note('C', 1)}${note('D', 6)}</measure>`); const score = model(xml), schedule = buildPlaybackSchedule(score), midi = decode(exportMidi(score)); const starts = midi.tracks[1].filter(e => (e.status & 240) === 144); for (const [i, n] of schedule.entries())
    assert.equal(midi.seconds(starts[i].tick), n.startSec); assert.ok(schedule.warnings.some(w => w.includes('480-tick'))); });
test('explicit preservation opt-out makes the chosen tempo audible and visible', () => { const r = pipeline({ musicxml: ties, settings: { ensemble: 'string_ensemble', preserveSource: false, tempo: 90 } }); assert.ok(r.ok, !r.ok ? r.error : ''); if (!r.ok)
    return; assert.ok(Math.abs(buildPerformance(model(r.musicxml)).tempos[0].bpm - 90) < .0001); assert.deepEqual(signature(buildPerformance(r.scoreModel as any)), signature(buildPerformance(model(r.musicxml)))); });
test('piano lower-staff rests retain their staff on round trip', () => {
    const xml = wrap(`<measure number="1">${attrs()}${note().replace('</note>', '<staff>1</staff></note>')}<backup><duration>4</duration></backup><note><rest/><duration>4</duration><voice>2</voice><staff>2</staff></note></measure>`);
    const score = model(xml); score.parts[0].instrument = 'piano'; score.parts[0].name = 'Piano'; score.parts[0].staves = 2;
    assert.equal(model(exportXml(score)).parts[0].measures[0].events.find(e => e.type === 'rest')?.staff, 2);
});
console.log(`${passed} performance tests passed.`);
