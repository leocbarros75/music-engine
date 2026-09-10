/**
 * MIDI transcription — step 2. Timed note events in, a notated piano grand staff out.
 *
 * This is where the musical judgement lives. Step 1 (./midiFile) either decodes a
 * file correctly or it does not; this stage has to *choose*, because a performance
 * does not determine a notation. The same recording has several defensible
 * readings, so every choice here is stated, measured and reported rather than
 * hidden: the result carries a TranscriptionReport saying what it decided and how
 * far the performance sat from the grid it snapped to.
 *
 * The output is an ordinary ScoreModel, so it leaves through the same MusicXML
 * exporter as everything else in the engine.
 */

import type { ScoreModel, Measure, NoteEvent, Pitch } from "../score/types";
import type { MidiFile, MidiNote } from "./midiFile";

export type TranscribeOptions = {
    /** Grid the performance is snapped to, as a note value: 8, 16, 32… Default 16. */
    grid?: number;
    /** Pitch at or above which a note is written in the right hand. Default 60 (C4). */
    handSplit?: number;
    /** Track to transcribe. Default: the track with the most notes. */
    trackIndex?: number;
    /** Independent voices allowed per hand. Default 2. */
    maxVoices?: number;
};

export type TranscriptionReport = {
    grid: number;
    trackIndex: number;
    trackName?: string;
    notes: number;
    measures: number;
    pickup: boolean;
    keyFifths: number;
    keyMode: "major" | "minor";
    /** How far the performance sat from the grid, in grid steps. */
    fit: { median: number; p95: number; worst: number };
    /** Notes whose sounding length was cut back to the next chord in the same hand. */
    clamped: number;
    /** Notes shorter than one grid step, which were lengthened to be notatable. */
    widened: number;
    /** Notes written as tied notes because they cross a bar line. */
    tied: number;
    /** Voices actually used in each hand. */
    voices: { rightHand: number; leftHand: number };
    /** Tempo marks carried over from the recording. */
    tempoMarks: number;
    /** Dynamic marks written, one per change rather than one per bar. */
    dynamicMarks: number;
    /** True when the key signature came from the notes rather than the file. */
    keyInferred: boolean;
    handSplit: number;
    rightHandNotes: number;
    leftHandNotes: number;
    warnings: string[];
};

// ── Pitch spelling ───────────────────────────────────────────────────────────
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
/** Sharps appear in the order F C G D A E B; flats in the reverse order. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];

/** Alteration each letter carries in a key, from the key signature alone. */
function keyAlterations(fifths: number): number[] {
    const alter = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < Math.min(Math.abs(fifths), 7); i++)
        alter[SHARP_ORDER[fifths >= 0 ? i : 6 - i]!] = fifths >= 0 ? 1 : -1;
    return alter;
}

/**
 * Spell a MIDI number in a key.
 *
 * Chooses the letter whose accidental the key already implies, so a note in the
 * key prints with no accidental at all; failing that, the spelling needing the
 * smallest accidental, leaning the way the key leans. In B major that writes
 * pitch class 1 as C#, already in the signature, and pitch class 0 as C natural
 * rather than B#.
 */
function spell(midi: number, fifths: number): Pitch {
    const keyAlter = keyAlterations(fifths);
    const pc = ((midi % 12) + 12) % 12;
    let best: { step: string; alter: number; cost: number } | null = null;
    for (let i = 0; i < 7; i++) {
        let alter = pc - NATURAL_PC[i]!;
        if (alter > 6) alter -= 12;
        if (alter < -6) alter += 12;
        if (Math.abs(alter) > 2) continue;
        const diatonic = alter === keyAlter[i];
        let cost = diatonic ? 0 : 4 + Math.abs(alter);
        if (!diatonic && ((fifths >= 0 && alter > 0) || (fifths < 0 && alter < 0))) cost -= 0.5;
        if (!best || cost < best.cost) best = { step: LETTERS[i]!, alter, cost };
    }
    const chosen = best ?? { step: "C", alter: 0 };
    // The octave belongs to the letter, not the pitch class: B#3 and C4 sound alike.
    return {
        step: chosen.step,
        alter: chosen.alter,
        octave: Math.floor((midi - chosen.alter) / 12) - 1
    } as Pitch;
}

// ── Key inference ────────────────────────────────────────────────────────────
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
/** Tonic pitch class of the major key with this many sharps (negative = flats). */
const TONIC_OF_FIFTHS = (fifths: number) => ((fifths * 7) % 12 + 12) % 12;

/**
 * Work out the key signature from what was actually played.
 *
 * A declared key signature cannot be trusted: writers and keyboards emit 0 sharps
 * by default, so a piece plainly in D major arrives claiming C major and every F#
 * and C# then prints as an accidental. So the notes get a vote. The declared
 * signature is kept when it fits the music as well as the best alternative —
 * genuine C major still reads as C major — and overruled only when the music
 * clearly disagrees.
 */
function inferKey(
    notes: MidiNote[],
    declared: { fifths: number; mode: "major" | "minor" } | undefined
): { fifths: number; mode: "major" | "minor"; inferred: boolean; fit: number } {
    const weight = new Array(12).fill(0);
    for (const n of notes) weight[n.midi % 12] += n.durationTick;
    const total = weight.reduce((a: number, b: number) => a + b, 0);
    if (!total) return { fifths: declared?.fifths ?? 0, mode: declared?.mode ?? "major", inferred: false, fit: 0 };

    const fitOf = (fifths: number) => {
        const tonic = TONIC_OF_FIFTHS(fifths);
        return MAJOR_SCALE.reduce((s, d) => s + weight[(tonic + d) % 12]!, 0) / total;
    };
    let best = { fifths: 0, fit: -1 };
    for (let fifths = -7; fifths <= 7; fifths++) {
        const fit = fitOf(fifths);
        // Prefer the simpler signature when two fit equally (D major over its enharmonics).
        if (fit > best.fit + 1e-9 || (Math.abs(fit - best.fit) <= 1e-9 && Math.abs(fifths) < Math.abs(best.fifths)))
            best = { fifths, fit };
    }

    const declaredFit = declared ? fitOf(declared.fifths) : -1;
    // Only overrule a declared signature when the music clearly disagrees with it.
    if (declared && declaredFit >= best.fit - 0.02)
        return { fifths: declared.fifths, mode: declared.mode, inferred: false, fit: declaredFit };

    // Major or its relative minor share a signature; the tonic that carries more
    // sounding weight decides which to name.
    const majorTonic = TONIC_OF_FIFTHS(best.fifths);
    const minorTonic = (majorTonic + 9) % 12;
    const mode = weight[minorTonic]! > weight[majorTonic]! ? "minor" : "major";
    return { fifths: best.fifths, mode, inferred: true, fit: best.fit };
}

// ── Bar grid ─────────────────────────────────────────────────────────────────
type Bar = { number: number; startTick: number; ticks: number; beats: number; beatType: number; pickup: boolean };

/**
 * Lay out bars from the time-signature map.
 *
 * A short opening bar is a pickup, not a bar in its own meter: writers export it
 * with its own brief time signature (Dorico writes 1/4 before the real 4/4), but
 * it should be notated in the prevailing meter as an incomplete first bar.
 */
function buildBars(file: MidiFile, endTick: number): Bar[] {
    const sigs = file.timeSigs.length ? file.timeSigs : [{ tick: 0, beats: 4, beatType: 4 }];
    const bars: Bar[] = [];
    const ticksOf = (beats: number, beatType: number) => (beats * 4 / beatType) * file.ppq;

    let pickup = false;
    let start = 0;
    let number = 1;
    if (sigs.length > 1 && sigs[0]!.tick === 0) {
        const first = ticksOf(sigs[0]!.beats, sigs[0]!.beatType);
        const next = sigs[1]!;
        if (sigs[1]!.tick === first && first < ticksOf(next.beats, next.beatType)) {
            bars.push({ number: 0, startTick: 0, ticks: first, beats: next.beats, beatType: next.beatType, pickup: true });
            pickup = true;
            start = first;
        }
    }

    const sigAt = (tick: number) => {
        let s = sigs[0]!;
        for (const x of sigs) if (x.tick <= tick) s = x;
        return s;
    };
    let guard = 0;
    for (let tick = start; tick < endTick && guard++ < 10000; ) {
        const s = sigAt(tick);
        const ticks = ticksOf(s.beats, s.beatType);
        bars.push({ number: number++, startTick: tick, ticks, beats: s.beats, beatType: s.beatType, pickup: false });
        tick += ticks;
    }
    if (pickup) bars[0]!.number = 0;
    return bars;
}

// ── Transcription ────────────────────────────────────────────────────────────
type Placed = { midi: number; startTick: number; endTick: number; staff: 1 | 2; voice: number; velocity: number };

/** Split one simultaneity between the hands, at its widest interior gap. */
function splitChord(pitches: number[], handSplit: number): { rh: number[]; lh: number[] } {
    const sorted = [...pitches].sort((a, b) => a - b);
    if (sorted[0]! >= handSplit) return { rh: sorted, lh: [] };
    if (sorted[sorted.length - 1]! < handSplit) return { rh: [], lh: sorted };
    // Straddles the split point: prefer a real gap in the chord over the nominal
    // boundary, so a voicing is not sliced through the middle of a cluster. Where
    // several gaps are equally wide, take the one nearest where the hands actually
    // divide — F#1 F#2 F#3 A#3 B3 C#4 has a twelve-semitone gap in two places, and
    // cutting at the lower one strands F#2 in the right hand instead of keeping the
    // octave bass together.
    let cut = sorted.findIndex((p) => p >= handSplit);
    let bestScore = -Infinity;
    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i]! - sorted[i - 1]!;
        if (gap < 5) continue;
        const middle = (sorted[i - 1]! + sorted[i]!) / 2;
        const score = gap - 0.5 * Math.abs(middle - handSplit);
        if (score > bestScore) {
            bestScore = score;
            cut = i;
        }
    }
    return { rh: sorted.slice(cut), lh: sorted.slice(0, cut) };
}

// ── Voice separation ─────────────────────────────────────────────────────────
/**
 * Split one hand into independent voices.
 *
 * Two notes in a single voice may not overlap, so with one voice per hand a note
 * held under moving notes has to be cut back to the next chord — which is exactly
 * how a pianist's sustained inner line disappears. Giving the hand a second voice
 * lets the held note keep its length while the others move underneath it.
 *
 * Notes that begin AND end together are one chord in one voice; a note of a chord
 * held longer than its neighbours becomes its own voice. Each chord goes to the
 * free voice whose previous note was nearest in pitch, which keeps a line in a
 * consistent register instead of letting voices swap places. Only when every voice
 * is busy and none may be opened does a note get shortened, so clamping becomes
 * the last resort rather than the rule.
 */
type Chord = { start: number; end: number; top: number; notes: Placed[] };

function assignVoices(notes: Placed[], maxVoices: number): number {
    const chords = new Map<string, Placed[]>();
    for (const n of notes) {
        const key = `${n.startTick}:${n.endTick}`;
        const list = chords.get(key) ?? [];
        list.push(n);
        chords.set(key, list);
    }
    const events: Chord[] = [...chords.values()]
        .map((g) => ({ start: g[0]!.startTick, end: g[0]!.endTick, top: Math.max(...g.map((x) => x.midi)), notes: g }))
        .sort((a, b) => a.start - b.start || b.top - a.top);

    const voices: Array<{ lastEnd: number; lastPitch: number; last: Chord | null; sum: number; count: number }> = [];
    let clamped = 0;

    for (const ev of events) {
        let pick = -1;
        let nearest = Infinity;
        for (let i = 0; i < voices.length; i++) {
            if (voices[i]!.lastEnd > ev.start) continue; // still sounding
            const distance = Math.abs(voices[i]!.lastPitch - ev.top);
            if (distance < nearest) { nearest = distance; pick = i; }
        }
        if (pick < 0 && voices.length < maxVoices) {
            voices.push({ lastEnd: -Infinity, lastPitch: ev.top, last: null, sum: 0, count: 0 });
            pick = voices.length - 1;
        }
        if (pick < 0) {
            // Every voice is busy and no more may be opened. Fall back to the voice
            // whose line this chord continues most naturally.
            let closest = Infinity;
            pick = 0;
            for (let i = 0; i < voices.length; i++) {
                const distance = Math.abs(voices[i]!.lastPitch - ev.top);
                if (distance < closest) { closest = distance; pick = i; }
            }
            const blocking = voices[pick]!.last;
            if (blocking && blocking.start === ev.start) {
                // Same onset, different lengths, nowhere left to put it: merge into
                // that chord and adopt its length. Shortening to the other note's
                // start would give this one zero length and lose it altogether.
                for (const n of ev.notes) { n.endTick = blocking.end; n.voice = pick; }
                blocking.notes.push(...ev.notes);
                clamped += ev.notes.length;
                continue;
            }
            // The blocker began earlier, so cutting it back here still leaves it a
            // positive length.
            if (blocking) for (const n of blocking.notes) {
                if (n.endTick > ev.start) { n.endTick = ev.start; clamped++; }
            }
        }
        const voice = voices[pick]!;
        for (const n of ev.notes) n.voice = pick;
        voice.lastEnd = ev.end;
        voice.lastPitch = ev.top;
        voice.last = ev;
        voice.sum += ev.top;
        voice.count++;
    }

    // Number the voices from the top down, as piano notation expects: voice 1 above
    // voice 2, so stems and rests fall the conventional way.
    const order = voices
        .map((v, i) => ({ i, average: v.count ? v.sum / v.count : 0 }))
        .sort((a, b) => b.average - a.average)
        .map((x, rank) => [x.i, rank] as const);
    const rankOf = new Map(order);
    for (const n of notes) n.voice = rankOf.get(n.voice) ?? 0;
    return clamped;
}

export function transcribeMidiToScore(
    file: MidiFile,
    options: TranscribeOptions = {}
): { score: ScoreModel; report: TranscriptionReport } {
    const warnings: string[] = [...file.warnings];
    const grid = options.grid ?? 16;
    const handSplit = options.handSplit ?? 60;
    const maxVoices = Math.max(1, options.maxVoices ?? 2);
    const step = (file.ppq * 4) / grid; // ticks per grid step

    const candidates = file.tracks.filter((t) => t.notes.length && !t.isDrums);
    if (!candidates.length) throw new Error("This MIDI file contains no pitched notes to transcribe.");
    const track =
        options.trackIndex !== undefined
            ? file.tracks.find((t) => t.index === options.trackIndex) ?? candidates[0]!
            : candidates.reduce((a, b) => (b.notes.length > a.notes.length ? b : a));
    if (candidates.length > 1)
        warnings.push(
            `The file has ${candidates.length} pitched tracks; transcribed "${track.name ?? `track ${track.index}`}". Choose another with trackIndex.`
        );

    // 1. How well does the performance fit the grid it is about to be snapped to?
    const deviations = track.notes
        .map((n) => Math.abs(n.startTick / step - Math.round(n.startTick / step)))
        .sort((a, b) => a - b);
    const at = (q: number) => deviations[Math.min(deviations.length - 1, Math.floor(deviations.length * q))] ?? 0;
    const fit = { median: at(0.5), p95: at(0.95), worst: deviations[deviations.length - 1] ?? 0 };
    if (fit.p95 > 0.25)
        warnings.push(
            `The performance does not sit cleanly on a 1/${grid} grid (95% of notes within ${fit.p95.toFixed(2)} of a step). It may use triplets, a different subdivision, or free timing.`
        );

    // 2. Snap onsets and lengths to the grid.
    let widened = 0;
    const snapped = track.notes.map((n: MidiNote) => {
        const start = Math.round(n.startTick / step) * step;
        let end = Math.round((n.startTick + n.durationTick) / step) * step;
        if (end <= start) {
            end = start + step; // Too short to notate; give it the shortest value on the grid.
            widened++;
        }
        return { midi: n.midi, startTick: start, endTick: end, velocity: n.velocity };
    });

    // 3. Split the hands, one simultaneity at a time.
    const byOnset = new Map<number, number[]>();
    for (const n of snapped) byOnset.set(n.startTick, [...(byOnset.get(n.startTick) ?? []), n.midi]);
    const staffOf = new Map<string, 1 | 2>();
    for (const [tick, pitches] of byOnset) {
        const { rh, lh } = splitChord(pitches, handSplit);
        for (const p of rh) staffOf.set(`${tick}:${p}`, 1);
        for (const p of lh) staffOf.set(`${tick}:${p}`, 2);
    }
    const placed: Placed[] = snapped.map((n) => ({ ...n, staff: staffOf.get(`${n.startTick}:${n.midi}`) ?? 1, voice: 0 }));

    // 4. One voice per hand: a chord lasts until the next chord in that hand. Without
    //    real voice separation two notes in one voice must not overlap, so a sustained
    //    note under moving ones is cut back rather than written as a second voice.
    let clamped = 0;
    const voicesPerHand: Record<1 | 2, number> = { 1: 0, 2: 0 };
    for (const staff of [1, 2] as const) {
        const hand = placed.filter((p) => p.staff === staff);
        if (!hand.length) continue;
        clamped += assignVoices(hand, maxVoices);
        voicesPerHand[staff] = new Set(hand.map((p) => p.voice)).size;
    }

    // 5. Lay the notes into bars.
    const endTick = Math.max(file.totalTicks, ...placed.map((p) => p.endTick), 1);
    const bars = buildBars(file, endTick);
    const key = inferKey(track.notes, file.keySigs[0]);
    if (key.inferred)
        warnings.push(
            `The file declares ${file.keySigs[0]?.fifths ?? 0} sharps/flats, but the notes fit ${key.fifths} far better; written in ${key.fifths} (${key.mode}).`
        );
    const measures: Measure[] = bars.map((bar) => ({
        number: bar.number,
        ...(bar.pickup ? { implicit: true, durationBeats: bar.ticks / file.ppq } : {}),
        attributes: {
            divisions: 4,
            key_fifths: key.fifths,
            key_mode: key.mode,
            time: { beats: bar.beats, beat_type: bar.beatType }
        },
        events: [] as NoteEvent[]
    }));

    let id = 0;
    let dropped = 0;
    let tied = 0;
    for (const p of placed) {
        let bi = bars.findIndex((b) => p.startTick >= b.startTick && p.startTick < b.startTick + b.ticks);
        if (bi < 0) { dropped++; continue; }
        // Belt and braces: nothing may reach the page with no length, or the loop
        // below would emit nothing at all and the note would silently disappear.
        if (p.endTick <= p.startTick) p.endTick = p.startTick + step;
        // A note running past the bar line is written as tied notes, one per bar it
        // crosses — not cut short at the line. Truncating loses real music: the
        // opening chord of a performance that begins on the last sixteenth of a bar
        // is a whole note, and clipping would leave a sixteenth of it.
        const pitch = spell(p.midi, key.fifths);
        let cursor = p.startTick;
        while (cursor < p.endTick && bi < bars.length) {
            const bar = bars[bi]!;
            const barEnd = bar.startTick + bar.ticks;
            const segmentEnd = Math.min(p.endTick, barEnd);
            const continues = segmentEnd < p.endTick && bi + 1 < bars.length;
            measures[bi]!.events.push({
                id: `midi-${id++}`,
                type: "note",
                t: (cursor - bar.startTick) / file.ppq,
                dur: Math.max(step / file.ppq, (segmentEnd - cursor) / file.ppq),
                pitch: { ...pitch },
                midi: p.midi,
                voice: (p.staff === 1 ? 1 : 5) + p.voice,
                staff: p.staff,
                ...(continues ? { tieStart: true } : {}),
                ...(cursor > p.startTick ? { tieStop: true } : {})
            } as NoteEvent);
            if (continues) tied++;
            cursor = segmentEnd;
            bi++;
        }
    }
    if (dropped) warnings.push(`${dropped} note(s) fell outside the bar grid and were dropped.`);
    for (const m of measures) m.events.sort((a, b) => a.t - b.t || (a.staff ?? 1) - (b.staff ?? 1));

    // 6. Tempo and dynamics.
    //
    // These go into `measure.performance`, which writePerformanceNotation already
    // turns into <direction> marks for every ensemble — the velocity-to-ppp..fff
    // mapping is already written there. Nothing was filling those fields for an
    // imported score, so a recording made at 67bpm was being printed as the 120bpm
    // default with no dynamics at all.
    for (const t of file.tempos) {
        const bi = bars.findIndex((b) => t.tick >= b.startTick && t.tick < b.startTick + b.ticks);
        if (bi < 0) continue;
        const at = (t.tick - bars[bi]!.startTick) / file.ppq;
        const perf = (measures[bi]!.performance ??= {});
        (perf.tempos ??= []).push({ t: at, bpm: Math.round(t.bpm * 10) / 10 });
    }

    // One dynamic per bar would be unreadable — a performance varies every note.
    // So each bar is reduced to the mark its average velocity would print, and a
    // mark is written only where that changes.
    const LEVELS = [32, 44, 56, 68, 80, 96, 112, 124];
    const markOf = (velocity: number) =>
        LEVELS.reduce((best, v, i) => (Math.abs(v - velocity) < Math.abs(LEVELS[best]! - velocity) ? i : best), 0);
    // Even per bar this flickers: a player's touch varies constantly, so the average
    // crosses a boundary every couple of bars and the page fills with marks nobody
    // would write. A new mark therefore has to earn its place — either the level has
    // held long enough to be a real change of intent, or it has jumped far enough
    // that it plainly is one.
    const MIN_BARS_BETWEEN = 4;
    const JUMP_REGARDLESS = 2;
    const levelOfBar = bars.map((bar, bi) => {
        const inBar = placed.filter((p) => p.startTick >= bar.startTick && p.startTick < bar.startTick + bar.ticks);
        return inBar.length ? markOf(inBar.reduce((s, p) => s + p.velocity, 0) / inBar.length) : null;
    });
    let lastMark = -1;
    let lastBar = -Infinity;
    for (let bi = 0; bi < bars.length; bi++) {
        const mark = levelOfBar[bi];
        if (mark === null || mark === lastMark) continue;
        const jump = lastMark < 0 ? Infinity : Math.abs(mark - lastMark);
        if (bi - lastBar < MIN_BARS_BETWEEN && jump < JUMP_REGARDLESS) continue;
        lastMark = mark;
        lastBar = bi;
        const perf = (measures[bi]!.performance ??= {});
        (perf.dynamics ??= []).push({ t: 0, velocity: LEVELS[mark]! });
    }

    const score: ScoreModel = {
        meta: {
            ensemble: "piano",
            title: track.name ?? "Transcription",
            inputKeyFifths: key.fifths,
            // The opening tempo, so a score with no tempo map still carries the
            // recording's speed rather than falling back to the 120bpm default.
            tempo_bpm: Math.round((file.tempos[0]?.bpm ?? 120) * 10) / 10
        },
        parts: [{
            part_id: "P_PNO",
            name: "Piano",
            instrument: "piano",
            staves: 2,
            pitchSpace: "sounding",
            measures
        }]
    } as any;

    return {
        score,
        report: {
            grid,
            trackIndex: track.index,
            trackName: track.name,
            notes: placed.length,
            measures: measures.length,
            pickup: bars[0]?.pickup ?? false,
            keyFifths: key.fifths,
            keyMode: key.mode,
            fit,
            clamped,
            widened,
            tied,
            keyInferred: key.inferred,
            voices: { rightHand: voicesPerHand[1], leftHand: voicesPerHand[2] },
            tempoMarks: measures.reduce((n, m) => n + (m.performance?.tempos?.length ?? 0), 0),
            dynamicMarks: measures.reduce((n, m) => n + (m.performance?.dynamics?.length ?? 0), 0),
            handSplit,
            rightHandNotes: placed.filter((p) => p.staff === 1).length,
            leftHandNotes: placed.filter((p) => p.staff === 2).length,
            warnings
        }
    };
}
