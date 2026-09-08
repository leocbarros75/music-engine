import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { server } from '../../src/server';
import { normalizeAppSettings } from '../../src/app/normalizeAppSettings';
import { generateArrangement } from '../../src/app/generateArrangement';
import { arrangeRhythmChart } from '../../src/app/arrangeRhythmChart';
import { generationRequest, requireGeneratedMusicxml } from '../../apps/electron/shared/generation';
import { buildNoteTimeline } from '../../src/score/standard';
import { exportMidi } from '../../src/score/midi';

const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Unused</part-name></score-part><score-part id="P2"><part-name>Melody</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><rest/><duration>4</duration></note></measure></part>
<part id="P2"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><harmony><root><root-step>C</root-step></root><kind>major</kind></harmony><note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><lyric><text>Holy</text></lyric></note></measure></part></score-partwise>`;
const settings = { ensemble: 'string_ensemble', keySignature: 'original', timeSignature: 'original', preserveSource: true };
let serial = 0;
function request(url: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req: any = new PassThrough();
    Object.assign(req, { url, method: 'POST', headers: {}, socket: { remoteAddress: `paths-${serial++}` } });
    let status = 0;
    const res: any = { writeHead: (value: number) => status = value, end: (value: string) => {
      try { resolve({ status, body: JSON.parse(value) }); } catch (error) { reject(error); }
    } };
    server.emit('request', req, res); req.end(JSON.stringify(body));
  });
}
const signature = (score: any) => buildNoteTimeline(score).map(n => [n.partIdx, n.midi, n.startBeat, n.durationBeats]);

test('all three MusicXML routes apply source selection and return matching score, MIDI and reports', async () => {
  const responses = [];
  for (const url of ['/generate', '/arrange_musicxml', '/harmonize_satb_from_chords']) {
    const r = await request(url, { musicxml: xml, settings, partIds: ['P2'] });
    assert.equal(r.status, 200, r.body.error);
    assert.equal(r.body.meta.preservation.status, 'verified');
    assert.equal(r.body.meta.preservation.notes, 1);
    assert.equal(r.body.meta.performance.status, 'ready');
    assert(r.body.musicxml.includes('<text>Holy</text>'));
    assert.deepEqual(Buffer.from(r.body.midiBase64, 'base64'), Buffer.from(exportMidi(r.body.scoreModel)));
    responses.push(r.body);
  }
  for (const result of responses.slice(1)) {
    assert.deepEqual(signature(result.scoreModel), signature(responses[0].scoreModel));
    assert.equal(result.midiBase64, responses[0].midiBase64);
    assert.deepEqual(result.meta, responses[0].meta);
  }
});
test('compatibility alias without settings uses the current default pipeline', async () => {
  const r = await request('/harmonize_satb_from_chords', { musicxml: xml, partIds: ['P2'] });
  assert.equal(r.status, 200, r.body.error);
  assert.equal(r.body.meta.performance.status, 'ready');
  assert(r.body.midiBase64);
});
test('all aliases reject malformed input and absent selected parts consistently', async () => {
  for (const route of ['/generate', '/arrange_musicxml', '/harmonize_satb_from_chords']) {
    for (const body of [{ musicxml: 'not XML' }, { musicxml: xml, settings, partIds: ['missing'] }]) {
      const r = await request(route, body);
      assert.equal(r.status, 400, r.body.error);
      assert.equal(r.body.ok, false);
      assert(Array.isArray(r.body.warnings));
    }
  }
});
test('server owns mode inference and keeps explicit settings and source defaults', () => {
  assert.equal(normalizeAppSettings(undefined).preserveSource, true);
  assert.equal(normalizeAppSettings(settings).keySignatureMode, 'original');
  const manual = normalizeAppSettings({ keySignature: 'G', timeSignature: '3/4', preserveSource: false });
  assert.equal(manual.keySignatureMode, 'manual'); assert.equal(manual.timeSignatureMode, 'manual');
  assert.equal(manual.preserveSource, false);
  assert.equal(normalizeAppSettings({ ...settings, keySignatureMode: 'manual' }).keySignatureMode, 'manual');
});
test('desktop sends the original XML and settings without extracting chords or rewriting modes', () => {
  const request = generationRequest(xml, settings as any);
  assert.equal(request.musicxml, xml); assert.deepEqual(request.settings, settings);
  assert(!('chords' in request));
  assert.deepEqual(request.options, { keepMelodyInSoprano: true });
  for (const response of [{ ok: true, scoreModel: {} }, { ok: false, musicxml: xml }, { ok: true, musicxml: '' }]) {
    assert.throws(() => requireGeneratedMusicxml(response), /no MusicXML/);
  }
  requireGeneratedMusicxml({ ok: true, musicxml: xml });
});
test('raw UI settings and explicit legacy mode settings produce the same arrangement', () => {
  const raw = generateArrangement({ musicxml: xml, partIds: ['P2'], settings });
  const legacy = generateArrangement({ musicxml: xml, partIds: ['P2'], settings: { ...settings, keySignatureMode: 'original', timeSignatureMode: 'original', targetKey: 'original' } });
  assert(raw.ok && legacy.ok);
  assert.deepEqual(signature(raw.scoreModel), signature(legacy.scoreModel));
  assert.equal(raw.midiBase64, legacy.midiBase64);
});
for (const ensemble of ['string_ensemble', 'orchestra']) {
  test(`rhythm chart ${ensemble} returns matching MusicXML/model/MIDI and playback status`, () => {
    const chart = { title: 'Chart test', tempoBpm: 72, beats: 4, beatType: 4, keyFifths: 0, warnings: ['import warning'],
      measures: [ { number: 1, chords: [{ t: 0, symbol: 'C' }], kicks: [0, 2], section: 'VERSE' },
        { number: 2, chords: [{ t: 0, symbol: 'G7' }], kicks: null } ] };
    const result = arrangeRhythmChart(chart, { ensemble, orchestraParts: ['P_VLN1', 'P_VLN2', 'P_VLA', 'P_CELBS'] });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.meta.performance.status, 'ready');
    assert.equal(result.meta.chordSource, 'rhythm_chart_pdf');
    assert.equal(result.meta.preservation.status, 'not_applicable');
    assert.deepEqual(result.meta.preservation, result.scoreModel.meta.sourcePreservation);
    assert.equal(result.meta.chordEventCount, 2);
    assert.deepEqual(result.meta.sections, ['VERSE@m1']);
    assert(result.warnings.includes('import warning'));
    assert.deepEqual(Buffer.from(result.midiBase64, 'base64'), Buffer.from(exportMidi(result.scoreModel)));
    assert.equal(result.scoreModel.meta.performance.status, 'ready');
  });
}
test('web proxy covers every API endpoint used by the web client', () => {
  const config = readFileSync(new URL('../../apps/web/vite.config.ts', import.meta.url), 'utf8');
  for (const route of ['/generate', '/generate_from_chords', '/generate_from_rhythm_pdf', '/parse_prompt', '/parse_pdf', '/omr_to_musicxml', '/health', '/list_parts', '/extract_part']) {
    assert(config.includes(`"${route}"`), `Missing proxy for ${route}`);
  }
});

test('full rhythm orchestra reports unsupported percussion playback instead of claiming MIDI parity', () => {
  const result = arrangeRhythmChart({ beats: 4, beatType: 4, keyFifths: 0, warnings: [],
    measures: [{ number: 1, chords: [{ t: 0, symbol: 'C' }], kicks: [0] }] }, { ensemble: 'orchestra' });
  assert.equal(result.ok, true);
  assert.equal(result.meta.performance.status, 'unsupported');
  assert.match(result.meta.performance.reason, /percussion.*mapping/i);
  assert.equal(result.midiBase64, undefined);
  assert(result.musicxml.includes('<unpitched>'));
});

test('chord-text generation uses the same application output contract', async () => {
  const result = await request('/generate_from_chords', { chords: 'C | G7 | C', settings: { ensemble: 'string_ensemble' } });
  assert.equal(result.status, 200, result.body.error);
  assert.equal(result.body.meta.performance.status, 'ready');
  assert(result.body.musicxml.includes('<score-partwise'));
  assert.deepEqual(Buffer.from(result.body.midiBase64, 'base64'), Buffer.from(exportMidi(result.body.scoreModel)));
});
