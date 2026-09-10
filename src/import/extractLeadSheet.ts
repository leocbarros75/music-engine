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

export type LeadSheetOptions = TranscribeOptions & {
    /**
     * Silence up to this many quarter-note beats is absorbed into the note before
     * it, rather than printed as a rest. A performance releases each note a little
     * early, and writing every one of those as a short rest is what makes a
     * transcription unreadable. Longer silences are phrasing and are kept.
     * Default: half a beat.
     */
    closeGaps?: number;
    /** Mark legato groups with slurs. Default on. */
    slurs?: boolean;
};

export type LeadSheet = {
    /** One part, "Melody", monophonic. */
    score: ScoreModel;
    musicxml: string;
    chords: ChordEvent[];
    confidence: MelodyConfidence;
    transcription: TranscriptionReport;
    /** Legato groups marked on the melody. */
    slurs: number;
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
function topLine(score: ScoreModel, closeGaps: number): { events: NoteEvent[][]; midis: number[]; coverage: number } {
    const bars = (score.parts[0]?.measures ?? []) as any[];
    const events: NoteEvent[][] = [];
    const midis: number[] = [];
    let sounding = 0;
    let withMelody = 0;

    for (const bar of bars) {
        const barBeats = bar.durationBeats
            ?? ((bar.attributes?.time?.beats ?? 4) * 4 / (bar.attributes?.time?.beat_type ?? 4));
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
        // Where it stops SHORT of the next, a rest appears — and a performance leaves
        // hundreds of them, because a player lifts a finger a little early every time.
        // Printing each of those as a sixteenth rest is what makes a transcription
        // unreadable, so a gap up to `closeGaps` is absorbed into the note before it.
        // Longer silences are real phrasing and stay.
        for (let i = 0; i < line.length - 1; i++) {
            const span = line[i + 1]!.t - line[i]!.t;
            const gap = span - line[i]!.dur;
            line[i]!.dur = gap > 0 && gap <= closeGaps ? span : Math.min(line[i]!.dur, span);
        }
        // The same at the end of a bar, where a short gap before the bar line is the
        // same artefact and prints as a trailing rest.
        const last = line[line.length - 1];
        if (last) {
            const toBarEnd = barBeats - last.t;
            const gap = toBarEnd - last.dur;
            if (gap > 0 && gap <= closeGaps) last.dur = toBarEnd;
        }

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

/**
 * Mark legato groups on the melody with slurs.
 *
 * A slur is a breath, or a bow: the run of notes a player takes in one gesture. So
 * a group runs until the line stops or settles — at a silence, at a note long
 * enough to be an arrival rather than a passing note, and at the end of the piece.
 * A group of one note is not a gesture and gets nothing.
 *
 * There is also a ceiling. Without one, a melody that never rests would carry a
 * single slur from the first bar to the last, which tells a player nothing; real
 * phrasing breathes every few bars.
 */
const PHRASE_END_NOTE = 2;   // a note this long, in beats, ends the gesture
const MAX_SLUR_BARS = 2;     // and nothing runs longer than this without a breath

function markSlurs(events: NoteEvent[][], bars: any[], enabled: boolean): number {
    if (!enabled) return 0;
    // Flatten to one line, remembering which bar each note came from.
    const line: Array<{ e: any; bar: number; endsBar: boolean }> = [];
    events.forEach((barEvents, i) => {
        const capacity = bars[i]?.durationBeats
            ?? ((bars[i]?.attributes?.time?.beats ?? 4) * 4 / (bars[i]?.attributes?.time?.beat_type ?? 4));
        barEvents.forEach((e: any) => line.push({ e, bar: i, endsBar: e.t + e.dur >= capacity - 1e-9 }));
    });

    let count = 0;
    let start = 0;
    const close = (end: number) => {
        if (end > start) {
            (line[start]!.e as any).slurStart = true;
            (line[end]!.e as any).slurStop = true;
            count++;
        }
        start = end + 1;
    };

    for (let i = 0; i < line.length; i++) {
        const here = line[i]!;
        const next = line[i + 1];
        const silenceFollows = !next || next.bar !== here.bar
            ? !here.endsBar                     // the line stops before the bar line
            : next.e.t > here.e.t + here.e.dur + 1e-9;
        const arrival = here.e.dur >= PHRASE_END_NOTE;
        const tooLong = here.bar - line[start]!.bar >= MAX_SLUR_BARS;
        if (!next || silenceFollows || arrival || tooLong) close(i);
    }
    return count;
}

/**
 * Chord qualities this writes. Anything else falls back to a plain triad, which is
 * honest — better a correct root with a missing colour than a wrong chord.
 */
const KINDS: Array<[RegExp, string]> = [
    // Case is NOT ignored here: in a chord symbol "M7" is major and "m7" is minor,
    // so a case-insensitive pattern silently turns every minor seventh into a major
    // one. Only the qualities where case carries no meaning use the i flag.
    [/^(maj7|Maj7|MAJ7|ma7|M7|Δ7?)$/, "major-seventh"],
    [/^(m7|min7|Min7|-7)$/, "minor-seventh"],
    [/^(m6|min6|Min6|-6)$/, "minor-sixth"],
    [/^6$/, "major-sixth"],
    [/^9$/, "dominant-ninth"],
    [/^7$/, "dominant"],
    [/^(m|min|Min|-)$/, "minor"],
    [/^(dim|o|°)$/i, "diminished"],
    [/^(aug|\+)$/i, "augmented"],
    [/^(sus4|sus)$/i, "suspended-fourth"],
    [/^sus2$/i, "suspended-second"],
    [/^(|maj|Maj|M)$/, "major"]
];

/**
 * One chord symbol as a MusicXML <harmony> element.
 *
 * Written from the symbol's own TEXT rather than from a parsed pitch class, so the
 * letter the harmony analysis chose survives — F sharp minor stays F sharp minor
 * and is not respelled G flat. The slash bass is read from the symbol directly too:
 * splitting on "/" and parsing each side separately is what keeps D/F# from
 * becoming two unrelated chords.
 */
function harmonyXml(symbol: string, offsetDivisions: number): string | null {
    const [main, slash] = symbol.split("/");
    const m = /^([A-G])([#b]?)(.*)$/.exec((main ?? "").trim());
    if (!m) return null;
    const quality = (m[3] ?? "").trim();
    const kind = KINDS.find(([re]) => re.test(quality))?.[1] ?? "major";
    const alter = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;

    let out = "<harmony>";
    out += `<root><root-step>${m[1]}</root-step>${alter ? `<root-alter>${alter}</root-alter>` : ""}</root>`;
    out += `<kind text="${quality.replace(/[<>&"]/g, "")}">${kind}</kind>`;
    if (slash) {
        const b = /^([A-G])([#b]?)$/.exec(slash.trim());
        if (b) {
            const bAlter = b[2] === "#" ? 1 : b[2] === "b" ? -1 : 0;
            out += `<bass><bass-step>${b[1]}</bass-step>${bAlter ? `<bass-alter>${bAlter}</bass-alter>` : ""}</bass>`;
        }
    }
    if (offsetDivisions) out += `<offset>${offsetDivisions}</offset>`;
    return out + "</harmony>";
}

/**
 * Put the chord symbols into the melody's MusicXML, so what leaves here is a real
 * lead sheet: one file carrying both the tune and its harmony. The parser reads
 * <harmony> back into the chord list, so the arrangers need nothing else, and a
 * person opening the file in Dorico sees chord symbols above the staff.
 */
export function embedChords(musicxml: string, chords: ChordEvent[], divisions = 4): string {
    const byMeasure = new Map<string, ChordEvent[]>();
    for (const c of chords) {
        const key = String(c.measure);
        byMeasure.set(key, [...(byMeasure.get(key) ?? []), c]);
    }
    return musicxml.replace(/(<measure number="([^"]+)">)([\s\S]*?)(<\/measure>)/g,
        (whole, open: string, number: string, body: string, close: string) => {
            const here = byMeasure.get(number);
            if (!here?.length) return whole;
            const marks = here
                .slice()
                .sort((a, b) => a.t - b.t)
                .map((c) => harmonyXml(c.symbol, Math.round(c.t * divisions)))
                .filter(Boolean)
                .join("");
            if (!marks) return whole;
            // A <harmony> belongs before the note it sits over, and after the
            // measure's <attributes> if it has any.
            const afterAttrs = body.indexOf("</attributes>");
            return afterAttrs >= 0
                ? open + body.slice(0, afterAttrs + 13) + marks + body.slice(afterAttrs + 13) + close
                : open + marks + body + close;
        });
}

export function extractLeadSheet(file: MidiFile, options: LeadSheetOptions = {}): LeadSheet {
    const { score: full, report } = transcribeMidiToScore(file, options);
    const warnings = [...report.warnings];

    const { events, midis, coverage } = topLine(full, options.closeGaps ?? 0.5);
    const confidence = assess(midis, coverage);
    if (!confidence.hasMelody) warnings.push(confidence.reason);

    const slurs = markSlurs(events, (full.parts[0]?.measures ?? []) as any[], options.slurs !== false);
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
        musicxml: embedChords(exportScoreModelToMusicXML(melodyScore), chords),
        chords,
        confidence,
        transcription: report,
        slurs,
        warnings
    };
}