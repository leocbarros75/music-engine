/**
 * MIDI → lead sheet: a monophonic melody plus chord symbols.
 *
 * The transcription in ./midiTranscribe answers "what was played". The arrangers
 * want something different: a LEAD SHEET — one singable line and the harmony under
 * it — from which they write an idiomatic part. Handing them the transcription
 * directly does not work, because `getSopranoSource` picks a whole part and the
 * transcription's only part is polyphonic piano, so the entire texture (bass notes
 * included) arrives labelled "melody".
 *
 * This module bridges the two. Its output goes straight into the existing pipeline
 * as `{ musicxml, chords }` — melody-only MusicXML carries no <harmony>, so the
 * source-preservation guard against conflicting chords never fires, and nothing in
 * the arrangers, exporter or pipeline needs to change.
 *
 * Not every file HAS a melody. A piano accompaniment part is harmony all the way
 * down, and squeezing a tune out of it produces a line that leaps about the
 * keyboard and means nothing. So extraction reports its confidence and declines
 * rather than inventing one — the chords are still worth having on their own.
 */

import type { ScoreModel, NoteEvent } from "../score/types";
import type { MidiFile } from "./midiFile";
import { transcribeMidiToScore, type TranscribeOptions, type TranscriptionReport } from "./midiTranscribe";
import { exportScoreModelToMusicXML } from "../exporters/musicxmlExporter";
import { parseMusicXMLToScoreModel } from "../parsers/musicxmlParser";
import { inferChordsFromAllVoices } from "../harmonize/satb/inferChordsFromMelody";

export type ChordEvent = { measure: number; t: number; symbol: string };

export type MelodyConfidence = {
    /** Whether the top line looks like a tune rather than the top of an accompaniment. */
    hasMelody: boolean;
    reason: string;
    notes: number;
    /** Share of sounding bars that contain melody. */
    coverage: number;
    /** Distance from lowest to highest melody note, in semitones. */
    range: number;
    /** Share of steps that move by a tone or less — melodies mostly move stepwise. */
    stepwise: number;
    /** Leaps wider than an octave. */
    bigLeaps: number;
};

export type LeadSheet = {
    /** One part, "Melody", monophonic. */
    score: ScoreModel;
    musicxml: string;
    chords: ChordEvent[];
    confidence: MelodyConfidence;
    transcription: TranscriptionReport;
    warnings: string[];
};

/**
 * A tune moves mostly by step, stays inside a range a voice could sing, and rarely
 * jumps more than an octave. An accompaniment figure does none of those things.
 * These thresholds are deliberately loose: the aim is to catch a part with no
 * melody at all, not to grade the melodies of parts that have one.
 */
const MAX_SINGABLE_RANGE = 26; // just over two octaves
const MIN_STEPWISE = 0.3;
const MAX_BIG_LEAP_SHARE = 0.06;

function assess(midis: number[], coverage: number): MelodyConfidence {
    const notes = midis.length;
    if (notes < 8)
        return { hasMelody: false, reason: "Too few notes in the top line to be a melody.", notes, coverage, range: 0, stepwise: 0, bigLeaps: 0 };

    let steps = 0;
    let bigLeaps = 0;
    for (let i = 1; i < midis.length; i++) {
        const interval = Math.abs(midis[i]! - midis[i - 1]!);
        if (interval <= 2) steps++;
        if (interval > 12) bigLeaps++;
    }
    const stepwise = steps / (midis.length - 1);
    const range = Math.max(...midis) - Math.min(...midis);
    const leapShare = bigLeaps / (midis.length - 1);

    const faults: string[] = [];
    if (range > MAX_SINGABLE_RANGE) faults.push(`it spans ${range} semitones`);
    if (stepwise < MIN_STEPWISE) faults.push(`only ${Math.round(stepwise * 100)}% of its steps move by a tone or less`);
    if (leapShare > MAX_BIG_LEAP_SHARE) faults.push(`${bigLeaps} leaps are wider than an octave`);

    return {
        hasMelody: faults.length === 0,
        reason: faults.length
            ? `The top line does not look like a melody: ${faults.join(", ")}. This is probably an accompaniment part — use its chords and supply the tune separately.`
            : "The top line reads as a melody.",
        notes,
        coverage,
        range,
        stepwise,
        bigLeaps
    };
}

/**
 * Pull the melody out of a transcription: at every attack point on the upper staff,
 * the highest note sounding.
 *
 * Taken per bar from the notes actually present, not from a voice number — voices
 * are numbered across the whole hand, so "voice 1" is simply absent from bars where
 * the top line rests, and following it there would silently promote an inner part.
 */
function topLine(score: ScoreModel): { events: NoteEvent[][]; midis: number[]; coverage: number } {
    const bars = (score.parts[0]?.measures ?? []) as any[];
    const events: NoteEvent[][] = [];
    const midis: number[] = [];
    let sounding = 0;
    let withMelody = 0;

    for (const bar of bars) {
        const upper = (bar.events ?? []).filter((e: any) => e.staff === 1 && e.type === "note");
        if ((bar.events ?? []).length) sounding++;
        if (!upper.length) { events.push([]); continue; }
        withMelody++;

        const highest = new Map<number, any>();
        for (const e of upper) {
            const held = highest.get(e.t);
            if (!held || e.midi > held.midi) highest.set(e.t, e);
        }
        const line = [...highest.values()].sort((a, b) => a.t - b.t);
        // One line, so nothing may overlap: each note stops where the next begins.
        for (let i = 0; i < line.length - 1; i++)
            line[i]!.dur = Math.min(line[i]!.dur, line[i + 1]!.t - line[i]!.t);

        const kept = line
            .filter((e) => e.dur > 1e-9)
            .map((e, i) => ({
                ...e,
                id: `mel-${bar.number}-${i}`,
                voice: 1,
                staff: 1,
                // A tie only means something once both halves are in one line; the
                // melody is rebuilt from scratch, so any inherited ties are dropped.
                tieStart: undefined,
                tieStop: undefined
            })) as NoteEvent[];
        events.push(kept);
        for (const e of kept) midis.push((e as any).midi);
    }
    return { events, midis, coverage: sounding ? withMelody / sounding : 0 };
}

export function extractLeadSheet(file: MidiFile, options: TranscribeOptions = {}): LeadSheet {
    const { score: full, report } = transcribeMidiToScore(file, options);
    const warnings = [...report.warnings];

    const { events, midis, coverage } = topLine(full);
    const confidence = assess(midis, coverage);
    if (!confidence.hasMelody) warnings.push(confidence.reason);

    const sourceBars = (full.parts[0]?.measures ?? []) as any[];
    const melodyScore: ScoreModel = {
        meta: { ...(full.meta as any), ensemble: "lead_sheet" },
        parts: [{
            part_id: "P_MEL",
            name: "Melody",
            instrument: "voice",
            staves: 1,
            pitchSpace: "sounding",
            measures: sourceBars.map((bar, i) => ({
                ...bar,
                events: events[i] ?? []
            }))
        }]
    } as any;

    // Chords come from the WHOLE texture, not the melody alone — the harmony is in
    // the notes underneath. Bars with nothing sounding get no chord: an empty bar is
    // silence, not a chord that happens to have no notes in it.
    const roundTripped = parseMusicXMLToScoreModel(exportScoreModelToMusicXML(full));
    const soundingBars = new Set(
        sourceBars.filter((b: any) => (b.events ?? []).length).map((b: any) => Number(b.number))
    );
    const chords = (inferChordsFromAllVoices(roundTripped as any) as ChordEvent[])
        .filter((c) => soundingBars.has(Number(c.measure)));

    return {
        score: melodyScore,
        musicxml: exportScoreModelToMusicXML(melodyScore),
        chords,
        confidence,
        transcription: report,
        warnings
    };
}
