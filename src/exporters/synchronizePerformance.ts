import { exportMidi } from "../score/midi";
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseMusicXMLToScoreModel } from '../parsers/musicxmlParser';
import { toSoundingScore } from '../score/pitch';
import { buildPerformance, readableTempo } from '../score/performance';
/** Final notation is authoritative: never audition the pre-export approximation. */
export function synchronizePerformance(xml: string, model: any, protectedPartId?: string) {
    let parsed = toSoundingScore(parseMusicXMLToScoreModel(xml));
    const hasInitialTempo = parsed.parts.some(p => p.measures[0]?.performance?.tempos?.some(t => t.t === 0));
    if (!hasInitialTempo && parsed.parts.length) {
        const bpm = Number(model.meta?.tempo_bpm ?? 120);
        if (!Number.isFinite(bpm) || bpm <= 0)
            throw Error('Tempo must be positive.');
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const parts = Array.from(doc.getElementsByTagName('part'));
        // Preserve the protected source staff verbatim; a score-wide tempo can live on another staff.
        const part = parts.find(p => p.getAttribute('id') !== protectedPartId) ?? parts[0];
        const measure = part.getElementsByTagName('measure')[0];
        const directionDoc = new DOMParser().parseFromString(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${readableTempo(bpm)}</per-minute></metronome></direction-type><sound tempo="${readableTempo(bpm)}"/></direction>`, 'application/xml');
        const attrs = measure.getElementsByTagName('attributes')[0];
        measure.insertBefore(doc.importNode(directionDoc.documentElement, true), attrs ? attrs.nextSibling : measure.firstChild);
        xml = new XMLSerializer().serializeToString(doc);
        parsed = toSoundingScore(parseMusicXMLToScoreModel(xml));
    }
    const scoreModel: any = {
        ...model, ...parsed,
        meta: { ...model.meta, inputChords: parsed.meta.inputChords },
        parts: parsed.parts.map(part => {
            const original = model.parts.find((p: any) => p.part_id === part.part_id);
            return { ...original, ...part, instrument: original?.instrument ?? part.instrument };
        }),
    };
    let report: any;
    let midiBase64: string | undefined;
    try {
        const performance = buildPerformance(scoreModel);
        // Rounded here, where the artefact is manufactured: buildPerformance
        // converts the tempo to ticks and back, so 67 returns as 67.0000290 and
        // is written into the model every caller reads afterwards.
        scoreModel.meta.tempo_bpm = readableTempo(performance.tempos[0]?.bpm ?? 120);
        midiBase64 = Buffer.from(exportMidi(scoreModel)).toString('base64');
        report = { status: 'ready', measuresPlayed: performance.measures.length, notesPlayed: performance.notes.length, durationSeconds: performance.durationSec, tempoChanges: performance.tempos.length, warnings: performance.warnings };
    }
    catch (error) {
        report = { status: 'unsupported', reason: (error as Error).message };
    }
    scoreModel.meta.performance = report;
    return { musicxml: xml, scoreModel, report, midiBase64 };
}
