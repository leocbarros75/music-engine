import { pipelineMusicxmlToArrangedMusicxml as pipeline } from "../../src/pipeline/pipelineMusicxmlToArrangedMusicxml.ts";
import assert from 'node:assert/strict';
import { parseMusicXMLToScoreModel as parse } from '../../src/parsers/musicxmlParser.ts';
import { musicxmlToScoreModel as compatParse } from '../../src/score/musicxmlToScoreModel.ts';
import { buildMeasureTimeline, buildNoteTimeline, divisionsToBeats } from '../../src/score/standard.ts';
import { toSoundingScore } from '../../src/score/pitch.ts';
import { exportScoreModelToMusicXML as exportXml } from '../../src/exporters/musicxmlExporter.ts';
import { exportSatbScoreModelToMusicXML as exportSatb } from '../../src/exporters/satbMusicxmlExporter.ts';
import { exportMidi } from '../../apps/web/src/utils/midiExporter.ts';
import { buildPlaybackSchedule } from '../../apps/web/src/utils/playbackSchedule.ts';
import { applyReinstrumentation } from '../../src/arrange/reinstrument.ts';
import { arrangeStringEnsemble } from '../../src/arrange/strings/stringArranger.ts';

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }
const note = (duration: number, extra = '') => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration>${extra}</note>`;
const wrap = (measures: string) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const attrs = (div: number, beats = 3, beatType = 4) => `<attributes><divisions>${div}</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time></attributes>`;
const waltz = wrap(`<measure number="1">${attrs(12)}${note(36)}</measure><measure number="2">${note(36)}</measure>`);
function model(xml: string): any { return compatParse(xml); }

/** Decode real MIDI track bytes, rather than trusting the encoder's inputs. */
function decode(bytes: Uint8Array) {
  let pos = 14; const tracks: any[][] = [];
  const u32 = (p: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(p);
  while (pos < bytes.length) {
    assert.equal(new TextDecoder().decode(bytes.slice(pos, pos + 4)), 'MTrk');
    const end = pos + 8 + u32(pos + 4); pos += 8; let tick = 0; const events: any[] = [];
    const vlq = () => { let v = 0, b: number; do { b = bytes[pos++]; v = v * 128 + (b & 127); } while (b & 128); return v; };
    while (pos < end) {
      tick += vlq(); const status = bytes[pos++];
      if (status === 255) { const type = bytes[pos++], len = vlq(); events.push({ tick, type, data: [...bytes.slice(pos, pos + len)] }); pos += len; }
      else if ((status & 240) === 192) pos++;
      else { const pitch = bytes[pos++], velocity = bytes[pos++]; events.push({ tick, status, pitch, velocity }); }
    }
    assert.equal(pos, end); tracks.push(events);
  }
  return tracks;
}

test('all divisions map to quarter-note beats through both importers', () => {
  for (const d of [1, 4, 12, 480]) {
    const xml = wrap(`<measure number="1">${attrs(d)}${note(3*d)}</measure>`);
    assert.equal(divisionsToBeats(3*d, d), 3);
    assert.equal(parse(xml).parts[0].measures[0].events[0].dur, 3);
    assert.equal(compatParse(xml).parts[0].measures[0].events[0].dur, 3);
  }
});
test('inherited 3/4 survives string arrangement and MusicXML', () => {
  const score = model(waltz);
  const arranged = arrangeStringEnsemble(score, [{measure:1,t:0,symbol:'C'}, {measure:2,t:0,symbol:'C'}], {profile:'hymn_support'}).scoreModel;
  for (const part of arranged.parts) for (const bar of part.measures) assert.equal(Math.max(...bar.events.map(e => e.t+e.dur)), 3);
  for (const exporter of [exportXml, exportSatb]) {
    const reparsed = parse(exporter(arranged));
    assert.deepEqual(buildMeasureTimeline(reparsed).map(m=>m.durationBeats), [3,3]);
  }
});
test('6/8 then 2/4 share a clock across parts, audio, and MIDI', () => {
  const xml = wrap(`<measure number="1">${attrs(12,6,8)}${note(36)}</measure><measure number="2">${note(36)}</measure><measure number="3">${attrs(12,2,4)}${note(24)}</measure><measure number="4">${note(24)}</measure>`);
  const s = model(xml); s.parts.push({...s.parts[0],part_id:'P2',name:'Viola',instrument:'viola',measures:s.parts[0].measures.map((m:any)=>({...m,attributes:undefined}))});
  const starts=[0,3,6,8];
  assert.deepEqual(buildMeasureTimeline(s).map(m=>m.startBeat), starts);
  assert.deepEqual(buildPlaybackSchedule(s,60).filter(n=>n.partIdx===1).map(n=>n.startSec), starts);
  const tracks=decode(exportMidi(s,60));
  assert.deepEqual(tracks[1].filter(e=>(e.status&240)===144).map(e=>e.tick), starts.map(x=>x*480));
  assert.deepEqual(tracks[2].filter(e=>(e.status&240)===144).map(e=>e.tick), starts.map(x=>x*480));
  assert.deepEqual(tracks[0].filter(e=>e.type===88).map(e=>[e.tick,...e.data.slice(0,2)]),[[0,6,3],[2880,2,2]]);
});
test('explicit pickup numbered zero survives round trip', () => {
  const s=model(wrap(`<measure number="0" implicit="yes">${attrs(4,4)}${note(4)}</measure><measure number="1">${note(16)}</measure>`));
  assert.deepEqual(buildMeasureTimeline(s).map(m=>m.startBeat),[0,1]);
  for (const exporter of [exportXml,exportSatb]) assert.deepEqual(buildMeasureTimeline(parse(exporter(s))).map(m=>m.startBeat),[0,1]);
});
test('ordered backups, forward rests, chords, and divisions changes', () => {
  const xml=wrap(`<measure number="1">${attrs(12,4)}${note(12,'<voice>1</voice>')}<backup><duration>12</duration></backup><forward><duration>6</duration></forward>${note(6,'<voice>2</voice>')}${note(6,'<chord/><voice>2</voice>')}</measure><measure number="2"><attributes><divisions>4</divisions></attributes>${note(4)}</measure>`);
  const s=model(xml); assert.deepEqual(s.parts[0].measures[0].events.map((e:any)=>e.t),[0,.5,.5]);assert.equal(s.parts[0].measures[1].events[0].dur,1);
});
test('written clarinet and bass play at sounding pitch, conversion is idempotent', () => {
  for (const [chromatic,diatonic,octaveChange,expected] of [[-2,-1,0,58],[0,0,-1,48]]) {
    const xml=wrap(`<measure number="1">${attrs(4,4).replace('</attributes>',`<transpose><chromatic>${chromatic}</chromatic><diatonic>${diatonic}</diatonic><octave-change>${octaveChange}</octave-change></transpose></attributes>`)}${note(16)}</measure>`);
    const s=model(xml); s.parts[0].instrument=octaveChange?'double_bass':'clarinet_bb';
    assert.equal(buildNoteTimeline(s)[0].midi,expected);
    const concert=toSoundingScore(s);assert.equal(concert.parts[0].measures[0].events[0].midi,expected);
    assert.deepEqual(toSoundingScore(concert),concert);
    assert.equal(buildNoteTimeline(parse(exportXml(concert)))[0].midi,expected);
    assert.equal(buildNoteTimeline(applyReinstrumentation(concert,[{part:'P1',to:'viola'}]))[0].midi,expected);
    assert.equal(s.parts[0].measures[0].events[0].midi,60);
  }
});
test('pitch spelling wins over a stale MIDI cache', () => {
  const s=model(waltz);s.parts[0].measures[0].events[0].midi=90;assert.equal(buildNoteTimeline(s)[0].midi,60);
});
test('overfull part raises an error instead of desynchronizing instruments', () => {
  const s=model(waltz);s.parts[0].measures[0].events[0].dur=4;
  assert.throws(()=>buildNoteTimeline(s),/Invalid event timing/);
  assert.throws(()=>exportMidi(s),/Invalid event timing/);
});
test('grace notes do not consume a quarter-note beat', () => {
  const s=model(wrap(`<measure number="1">${attrs(4)}<note><grace/><pitch><step>B</step><octave>3</octave></pitch></note>${note(12)}</measure>`));
  assert.equal(s.parts[0].measures[0].events[0].dur,0);assert.equal(s.parts[0].measures[0].events[1].t,0);
  assert.equal(buildNoteTimeline(s).length,1);
});
test('arrangement pipeline shares changing-meter lengths', () => {
  const xml=wrap(`<measure number="1">${attrs(4,3)}${note(12)}</measure><measure number="2">${note(12)}</measure><measure number="3">${attrs(4,2)}${note(8)}</measure><measure number="4">${note(8)}</measure>`);
  for (const accompaniment of ['homophonic','polyphonic']) {
    const r=pipeline({musicxml:xml, chords:[1,2,3,4].map(measure=>({measure,t:0,symbol:'C'})),settings:{ensemble:'string_ensemble',style:'worship',level:'intermediate',accompaniment,textureMode:accompaniment==='polyphonic'?'polyphony':'homophony_homorhythmic'}});
    assert.equal(r.ok,true);if(!r.ok) return;
    assert.deepEqual(buildMeasureTimeline(r.scoreModel as any).map(m=>m.durationBeats),[3,3,2,2]);
    buildNoteTimeline(r.scoreModel as any);
  }
});
test('written harmony and key convert with the source and only once', () => {
  const xml=wrap(`<measure number="1">${attrs(4,4).replace('</attributes>','<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>')}<harmony><root><root-step>C</root-step></root><kind>major</kind><bass><bass-step>E</bass-step></bass></harmony>${note(16)}</measure>`);
  const s=toSoundingScore(parse(xml));
  assert.equal((s.meta as any).inputChords[0].symbol,'Bb/D');
  assert.equal(s.parts[0].measures[0].attributes?.key_fifths,-2);
  assert.deepEqual(toSoundingScore(s),s);
});
console.log(`${passed} score-standard tests passed.`);
