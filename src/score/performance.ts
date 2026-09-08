import { buildMeasureTimeline, soundingMidi, type MeasurePosition } from './standard';
export type MeasurePerformance = {
    tempos?: Array<{
        t: number;
        bpm: number;
    }>;
    dynamics?: Array<{
        t: number;
        velocity: number;
    }>;
    repeatStart?: boolean;
    repeatEnd?: number;
    endings?: Array<{
        numbers: number[];
        type: 'start' | 'stop' | 'discontinue';
    }>;
    issues?: string[];
};
export type PerformanceNote = {
    partIdx: number;
    measureIndex: number;
    startBeat: number;
    durationBeats: number;
    midi: number;
    velocity: number;
    startSec: number;
    durationSec: number;
};
export type Performance = {
    notes: PerformanceNote[];
    measures: MeasurePosition[];
    tempos: Array<{
        beat: number;
        bpm: number;
        seconds: number;
    }>;
    durationBeats: number;
    durationSec: number;
    warnings: string[];
};
export const PERFORMANCE_PPQ = 480;
const quantize = (beat: number) => Math.round(beat * PERFORMANCE_PPQ) / PERFORMANCE_PPQ;
const EPS = 1e-7;
const equal = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
/** Score-wide markings must agree when duplicated across staves. */
function declarations(score: any, count: number): MeasurePerformance[] {
    return Array.from({ length: count }, (_, i) => {
        const marks = score.parts.map((p: any) => p.measures?.[i]?.performance ?? {});
        const result: MeasurePerformance = {};
        for (const field of ['repeatStart', 'repeatEnd', 'endings'] as const) {
            const values = marks.map((m: any) => m[field]).filter((x: any) => x !== undefined);
            if (values.some((x: any) => !equal(x, values[0])))
                throw Error(`Conflicting ${field} at measure ${i + 1}.`);
            if (values.length)
                (result as any)[field] = values[0];
        }
        const tempos = new Map<number, number>();
        for (const mark of marks) {
            if (mark.issues?.length)
                throw Error(`Cannot perform measure ${i + 1}: ${mark.issues.join('; ')}`);
            for (const tempo of mark.tempos ?? []) {
                if (tempos.has(tempo.t) && Math.abs(tempos.get(tempo.t)! - tempo.bpm) > EPS)
                    throw Error(`Conflicting tempos at measure ${i + 1}, beat ${tempo.t}.`);
                tempos.set(tempo.t, tempo.bpm);
            }
        }
        result.tempos = [...tempos].map(([t, bpm]) => ({ t, bpm })).sort((a, b) => a.t - b.t);
        return result;
    });
}
/** Expand bounded repeats, including nested repeats and numbered endings. */
function visits(clock: MeasurePosition[], marks: MeasurePerformance[]): MeasurePosition[] {
    const stack: number[] = [], regions: Array<{
        start: number;
        end: number;
        times: number;
    }> = [];
    const endings: number[][] = [];
    let activeEnding: number[] = [];
    marks.forEach((m, i) => {
        if (m.repeatStart)
            stack.push(i);
        for (const e of m.endings ?? [])
            if (e.type === 'start')
                activeEnding = e.numbers;
        endings[i] = activeEnding;
        for (const e of m.endings ?? [])
            if (e.type !== 'start')
                activeEnding = [];
        if (m.repeatEnd !== undefined) {
            if (!Number.isInteger(m.repeatEnd) || m.repeatEnd < 1 || m.repeatEnd > 16)
                throw Error('Repeat count must be between 1 and 16.');
            regions.push({ start: stack.pop() ?? 0, end: i, times: m.repeatEnd });
        }
    });
    if (stack.length)
        throw Error('Forward repeat has no matching backward repeat.');
    const endingOwners: Array<number | undefined> = [];
    let owner: number | undefined;
    marks.forEach((m, index) => {
        const start = m.endings?.find(e => e.type === 'start');
        if (start && (start.numbers.includes(1) || owner === undefined)) {
            owner = regions.filter(r => r.start <= index && r.end >= index).sort((a, b) => b.start - a.start || a.end - b.end)[0]?.end;
            if (owner === undefined)
                throw Error('Numbered ending has no associated repeat.');
        }
        endingOwners[index] = owner;
    });
    const passes = new Map<number, number>();
    let lastPass = 1, i = 0, beat = 0, steps = 0;
    const result: MeasurePosition[] = [];
    while (i < clock.length) {
        if (++steps > 10000)
            throw Error('Repeat expansion exceeds 10,000 measures.');
        const region = regions.filter(r => r.start <= i && i <= r.end).sort((a, b) => b.start - a.start || a.end - b.end)[0];
        const pass = endings[i].length && endingOwners[i] !== undefined ? passes.get(endingOwners[i]!) ?? 1 : region ? passes.get(region.end) ?? 1 : lastPass;
        if (!endings[i].length || endings[i].includes(pass)) {
            result.push({ ...clock[i], startBeat: beat });
            beat += clock[i].durationBeats;
        }
        const closing = regions.find(r => r.end === i);
        if (closing) {
            const current = passes.get(i) ?? 1;
            if (current < closing.times) {
                passes.set(i, current + 1);
                for (const inner of regions)
                    if (inner.start >= closing.start && inner.end < closing.end)
                        passes.delete(inner.end);
                i = closing.start;
                continue;
            }
            lastPass = current;
        }
        i++;
    }
    return result;
}
/** One deterministic interpretation consumed by MIDI and the audio player. */
export function buildPerformance(score: {
    parts: any[];
    meta?: any;
}, bpmOverride?: number): Performance {
    const clock = buildMeasureTimeline(score), marks = declarations(score, clock.length);
    const measures = visits(clock, marks), warnings = new Set<string>();
    const fallback = Number(score.meta?.tempo_bpm ?? score.meta?.bpm ?? score.meta?.tempo ?? 120);
    if (!Number.isFinite(fallback) || fallback <= 0)
        throw Error('Tempo must be positive.');
    if (bpmOverride !== undefined && (!Number.isFinite(bpmOverride) || bpmOverride <= 0))
        throw Error('Tempo must be positive.');
    let inherited = fallback;
    const tempoAtStart = marks.map((m, i) => {
        const start = m.tempos?.find(t => t.t === 0)?.bpm ?? inherited;
        for (const t of m.tempos ?? []) {
            if (!Number.isFinite(t.bpm) || t.bpm <= 0 || !Number.isFinite(t.t) || t.t < 0 || t.t > clock[i].durationBeats)
                throw Error(`Invalid tempo in measure ${i + 1}.`);
            inherited = t.bpm;
        }
        return start;
    });
    // An explicit audition/export override scales the whole tempo map, retaining its relationships.
    const scale = bpmOverride === undefined ? 1 : bpmOverride / (tempoAtStart[0] ?? fallback);
    const rawTempos: Array<{
        beat: number;
        bpm: number;
    }> = [];
    for (const m of measures) {
        rawTempos.push({ beat: m.startBeat, bpm: tempoAtStart[m.index] * scale });
        for (const t of marks[m.index].tempos ?? [])
            rawTempos.push({ beat: m.startBeat + t.t, bpm: t.bpm * scale });
    }
    if (!rawTempos.length)
        rawTempos.push({ beat: 0, bpm: fallback * scale });
    const tempos: Performance['tempos'] = [];
    for (const raw of rawTempos) {
        const t = { ...raw, beat: quantize(raw.beat) };
        // Use precisely the tempo representable in MIDI, so audio and MIDI clocks agree.
        const micros = Math.round(60000000 / t.bpm);
        if (micros < 1 || micros > 0xffffff)
            throw Error('Tempo is outside the MIDI tempo range.');
        const bpm = 60000000 / micros;
        const previous = tempos[tempos.length - 1];
        if (previous?.beat === t.beat) {
            previous.bpm = bpm;
            continue;
        }
        if (previous && previous.bpm === bpm)
            continue;
        tempos.push({ beat: t.beat, bpm, seconds: previous ? previous.seconds + (t.beat - previous.beat) * 60 / previous.bpm : 0 });
    }
    const secondsAt = (beat: number) => {
        let t = tempos[0];
        for (const next of tempos) {
            if (next.beat > beat)
                break;
            t = next;
        }
        return t.seconds + (beat - t.beat) * 60 / t.bpm;
    };
    const notes: PerformanceNote[] = [];
    score.parts.forEach((part: any, partIdx: number) => {
        let velocity = 80;
        const velocities = clock.map((_, i) => {
            const before = velocity;
            for (const d of part.measures?.[i]?.performance?.dynamics ?? []) {
                if (!Number.isFinite(d.t) || d.t < 0 || d.t > clock[i].durationBeats || !Number.isFinite(d.velocity) || d.velocity < 1 || d.velocity > 127)
                    throw Error(`Invalid dynamic in measure ${i + 1}.`);
                velocity = d.velocity;
            }
            return before;
        });
        const ties = new Map<string, PerformanceNote>();
        for (const visit of measures) {
            const bar = part.measures?.[visit.index];
            if (!bar)
                continue;
            const events = [...bar.events].sort((a: any, b: any) => a.t - b.t);
            const graceGroups = new Map<string, any[]>();
            const voiceKey = (e: any) => `${e.staff ?? 1}:${e.voice ?? 1}`;
            for (const e of events) {
                if (e.grace) {
                    const k = `${voiceKey(e)}:${e.t}`;
                    graceGroups.set(k, [...(graceGroups.get(k) ?? []), e]);
                }
            }
            const playedGrace = new Set<string>();
            for (const e of events) {
                if (e.grace)
                    continue;
                if (!Number.isFinite(e.t) || !Number.isFinite(e.dur) || e.t < 0 || e.dur <= 0 || e.t + e.dur > visit.durationBeats + EPS)
                    throw Error(`Invalid event timing in ${part.name}, measure ${bar.number}.`);
                const midi = soundingMidi(part, e);
                if (midi === null)
                    continue;
                if (!Number.isInteger(midi) || midi < 0 || midi > 127)
                    throw Error('MIDI/playback requires integral pitches between 0 and 127.');
                let vel = velocities[visit.index];
                for (const d of bar.performance?.dynamics ?? [])
                    if (d.t <= e.t)
                        vel = d.velocity;
                const articulations: string[] = e.articulations ?? [];
                vel = Math.max(1, Math.min(127, Math.round(vel + (articulations.includes('accent') ? 12 : 0))));
                const key = `${voiceKey(e)}:${midi}`;
                const startBeat = visit.startBeat + e.t;
                const previous = ties.get(key);
                if (e.tieStop && previous && Math.abs(previous.startBeat + previous.durationBeats - startBeat) < EPS) {
                    previous.durationBeats += e.dur;
                    if (!e.tieStart)
                        ties.delete(key);
                    continue;
                }
                if (e.tieStop)
                    warnings.add('An unmatched tie stop was played as a fresh note.');
                const graceKey = `${voiceKey(e)}:${e.t}`, group = graceGroups.get(graceKey) ?? [];
                const steal = group.length ? Math.min(0.25, e.dur / 2) : 0;
                if (group.length && !playedGrace.has(graceKey)) {
                    warnings.add('Grace notes use an on-beat realization shared by MIDI and playback.');
                    let slot = -1;
                    const slots = group.map(g => { if (!g.chord || slot < 0)
                        slot++; return slot; });
                    const slotCount = slot + 1;
                    group.forEach((g, n) => {
                        const pitch = soundingMidi(part, g)!;
                        if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127)
                            throw Error('Invalid grace-note pitch.');
                        notes.push({ partIdx, measureIndex: visit.index, startBeat: startBeat + slots[n] * steal / slotCount, durationBeats: steal / slotCount, midi: pitch, velocity: vel, startSec: 0, durationSec: 0 });
                    });
                    playedGrace.add(graceKey);
                }
                const gate = articulations.includes('staccatissimo') ? 0.25 : articulations.includes('staccato') ? 0.5 : 1;
                const note: PerformanceNote = { partIdx, measureIndex: visit.index, startBeat: startBeat + steal, durationBeats: (e.dur - steal) * (e.tieStart ? 1 : gate), midi, velocity: vel, startSec: 0, durationSec: 0 };
                notes.push(note);
                if (e.tieStart)
                    ties.set(key, note);
                else
                    ties.delete(key);
            }
            for (const k of graceGroups.keys())
                if (!playedGrace.has(k))
                    throw Error(`Grace notes without a following principal note in measure ${bar.number} are not supported.`);
        }
    });
    for (const note of notes) {
        const start = quantize(note.startBeat), end = Math.max(start + 1 / PERFORMANCE_PPQ, quantize(note.startBeat + note.durationBeats));
        if (Math.abs(start - note.startBeat) > EPS || Math.abs(end - note.startBeat - note.durationBeats) > EPS)
            warnings.add('Performance timing is rounded to the shared 480-tick quarter-note clock.');
        note.startBeat = start;
        note.durationBeats = end - start;
        note.startSec = secondsAt(note.startBeat);
        note.durationSec = secondsAt(note.startBeat + note.durationBeats) - note.startSec;
    }
    notes.sort((a, b) => a.startBeat - b.startBeat || a.partIdx - b.partIdx);
    const last = measures[measures.length - 1];
    const durationBeats = Math.max(last ? quantize(last.startBeat + last.durationBeats) : 0, ...notes.map(n => n.startBeat + n.durationBeats));
    const performedMeasures = measures.map(m => ({ ...m, startBeat: quantize(m.startBeat), durationBeats: quantize(m.startBeat + m.durationBeats) - quantize(m.startBeat) }));
    return { notes, measures: performedMeasures, tempos, durationBeats, durationSec: secondsAt(durationBeats), warnings: [...warnings] };
}
