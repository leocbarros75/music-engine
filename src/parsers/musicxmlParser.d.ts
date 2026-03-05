type Pitch = {
    step: string;
    alter?: number;
    octave: number;
};
type NoteEvent = {
    type: "note";
    t: number;
    dur: number;
    pitch: Pitch | null;
    midi?: number;
};
type Measure = {
    number: number;
    attributes?: any;
    events: NoteEvent[];
};
type Part = {
    part_id: string;
    name?: string;
    measures: Measure[];
};
type ScoreModel = {
    meta?: any;
    parts: Part[];
};
/**
 * Important MusicXML rule:
 * If a <note> contains a <chord/> tag, it shares the SAME start time
 * as the previous non-chord note (in that voice).
 *
 * Our earlier parser always advanced time, which destroys chords.
 * This fix preserves chord stacks so harmony detection works.
 */
export declare function parseMusicXMLToScoreModel(xml: string): ScoreModel;
export {};
//# sourceMappingURL=musicxmlParser.d.ts.map