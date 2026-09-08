import { exportMidi } from "../../src/score/midi.ts";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { server } from '../../src/server.ts';
import { snapshotPartXml, compareSnapshots } from '../../src/preservation/sourcePreservation.ts';
const xml = readFileSync(new URL('./fixtures/holy-holy-holy.musicxml', import.meta.url), 'utf8');
// Exercise the real request handler without opening a network port.
function request(url: string, body: any): Promise<{
    status: number;
    body: any;
}> {
    return new Promise((resolve, reject) => {
        const req: any = new PassThrough();
        req.url = url;
        req.method = 'POST';
        req.headers = {};
        req.socket = { remoteAddress: 'preservation-test' };
        let status = 0;
        const res: any = { writeHead: (value: number) => { status = value; }, end: (value: string) => { try {
                resolve({ status, body: JSON.parse(value) });
            }
            catch (e) {
                reject(e);
            } } };
        server.emit('request', req, res);
        req.end(JSON.stringify(body));
    });
}
async function main() {
    for (const route of ['/generate', '/arrange_musicxml', '/harmonize_satb_from_chords']) {
        const r = await request(route, { musicxml: xml, partIds: ['P1'], settings: { ensemble: 'string_ensemble', style: 'worship', level: 'intermediate', preserveSource: true, melodyOctaveShift: 0 } });
        assert.equal(r.status, 200, r.body.error);
        assert.equal(r.body.meta.preservation.status, 'verified');
        assert.equal(r.body.meta.performance.status, 'ready');
        assert.deepEqual(Buffer.from(r.body.midiBase64, 'base64'), Buffer.from(exportMidi(r.body.scoreModel)));
        assert.equal(r.body.meta.preservation.notes, 45);
        assert.equal(r.body.meta.preservation.chords, 33);
        assert.deepEqual(compareSnapshots(snapshotPartXml(xml, 'P1'), snapshotPartXml(r.body.musicxml, r.body.meta.preservation.targetPartId)), []);
        console.log(`PASS ${route}: verified MusicXML and report survive request handling`);
    }
    const shifted = await request('/generate', { musicxml: xml, settings: { ensemble: 'string_ensemble', melodyOctaveShift: 1 } });
    assert.equal(shifted.status, 200, shifted.body.error);
    assert.equal(shifted.body.meta.preservation.octaveShift, 1);
    const conflict = await request('/generate', { musicxml: xml, settings: { ensemble: 'string_ensemble', keySignature: 'G' } });
    assert.equal(conflict.status, 400);
    assert.match(conflict.body.error, /original key and meter/);
    console.log('PASS request settings: octave forwarded and conflicting key rejected');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
