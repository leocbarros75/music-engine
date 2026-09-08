import { buildPerformance, PERFORMANCE_PPQ, type Performance, type PerformanceNote } from "./performance";
import { instrumentPlayback } from "./instrumentPlayback";
const TICKS_PER_QUARTER = PERFORMANCE_PPQ;
// ── Binary helpers ────────────────────────────────────────────────────────────
/** Encode a value as a MIDI variable-length quantity (big-endian, 7-bit groups). */
function vlq(value: number): number[] {
    if (value < 0)
        value = 0;
    const bytes: number[] = [];
    bytes.push(value & 0x7f);
    value >>>= 7;
    while (value > 0) {
        bytes.unshift((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    return bytes;
}
function uint16(v: number): number[] {
    return [(v >> 8) & 0xff, v & 0xff];
}
function uint32(v: number): number[] {
    return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}
/** Wrap raw event bytes in an MTrk chunk. Appends end-of-track. */
function wrapTrackChunk(data: number[]): number[] {
    const body = [...data, 0x00, 0xff, 0x2f, 0x00]; // end-of-track
    return [0x4d, 0x54, 0x72, 0x6b, ...uint32(body.length), ...body];
}
// ── Text meta helper ──────────────────────────────────────────────────────────
function metaText(type: number, text: string): number[] {
    const bytes = Array.from(new TextEncoder().encode(text));
    return [0x00, 0xff, type, ...vlq(bytes.length), ...bytes];
}
// ── Track 0: tempo + time signature ──────────────────────────────────────────
function buildTempoTrack(performance: Performance, title?: string): number[] {
    const data: number[] = [];
    if (title)
        data.push(...metaText(0x03, title));
    const events: Array<{
        tick: number;
        data: number[];
    }> = performance.tempos.map(t => {
        const us = Math.round(60000000 / t.bpm);
        return { tick: Math.round(t.beat * TICKS_PER_QUARTER), data: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] };
    });
    let previous = '';
    for (const m of performance.measures) {
        const signature = `${m.time.beats}/${m.time.beat_type}`;
        if (signature === previous)
            continue;
        if (!Number.isInteger(Math.log2(m.time.beat_type)) || m.time.beats > 255)
            throw Error('Time signature is not representable in MIDI.');
        events.push({ tick: Math.round(m.startBeat * TICKS_PER_QUARTER), data: [0xff, 0x58, 4, m.time.beats, Math.log2(m.time.beat_type), 24, 8] });
        previous = signature;
    }
    let tick = 0;
    for (const event of events.sort((a, b) => a.tick - b.tick)) {
        data.push(...vlq(event.tick - tick), ...event.data);
        tick = event.tick;
    }
    // The conductor track includes trailing rests in the total duration.
    const end = Math.round(performance.durationBeats * TICKS_PER_QUARTER);
    data.push(...vlq(end - tick), 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, ...uint32(data.length), ...data];
}
// ── Track N: one instrument part ──────────────────────────────────────────────
interface AbsEvent {
    tick: number;
    isOn: boolean;
    pitch: number;
    velocity: number;
}
function buildPartTrack(part: any, channel: number, notes: PerformanceNote[], port: number): number[] {
    const program = instrumentPlayback(part).program;
    const absEvents: AbsEvent[] = [];
    for (const note of notes) {
        const startTick = Math.round(note.startBeat * TICKS_PER_QUARTER);
        // Preserve score duration in the editable MIDI. Playback articulation belongs to the player.
        const endTick = Math.max(startTick + 1, Math.round((note.startBeat + note.durationBeats) * TICKS_PER_QUARTER));
        absEvents.push({ tick: startTick, isOn: true, pitch: note.midi, velocity: note.velocity });
        absEvents.push({ tick: endTick, isOn: false, pitch: note.midi, velocity: 0 });
    }
    // Sort: by tick, then note-offs before note-ons at same tick
    absEvents.sort((a, b) => a.tick !== b.tick ? a.tick - b.tick : (Number(a.isOn) - Number(b.isOn)));
    const data: number[] = [];
    const nameBytes = Array.from(new TextEncoder().encode(part.name ?? "Part"));
    // Track name
    data.push(0x00, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes);
    // MIDI ports keep large orchestras from sharing incompatible channel programs.
    data.push(0x00, 0xff, 0x21, 0x01, port);
    // Program change
    data.push(0x00, 0xc0 | (channel & 0x0f), program & 0x7f);
    let curTick = 0;
    for (const ev of absEvents) {
        const delta = ev.tick - curTick;
        curTick = ev.tick;
        const status = ev.isOn
            ? 0x90 | (channel & 0x0f)
            : 0x80 | (channel & 0x0f);
        data.push(...vlq(delta), status, ev.pitch & 0x7f, ev.velocity & 0x7f);
    }
    return wrapTrackChunk(data);
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Encode a ScoreModel into a MIDI Type 1 blob — one track per part.
 * An explicit BPM scales the score tempo map for audition/export.
 */
export function exportMidi(scoreModel: any, bpmOverride?: number): Uint8Array {
    const meta = scoreModel?.meta ?? {};
    const title: string = meta.title ?? "";
    const parts: any[] = scoreModel?.parts ?? [];
    const performance = buildPerformance(scoreModel, bpmOverride);
    const notes = performance.notes;
    // Channel pool: 0-8 then 10-15 (skip 9 = General MIDI drums)
    const channelPool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
    const tracks: number[][] = [buildTempoTrack(performance, title)];
    parts.forEach((part, i) => {
        const ch = channelPool[i % channelPool.length];
        tracks.push(buildPartTrack(part, ch, notes.filter(n => n.partIdx === i), Math.floor(i / channelPool.length)));
    });
    // MThd header
    const header: number[] = [
        0x4d, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06, // chunk length = 6
        0x00, 0x01, // format: Type 1
        ...uint16(tracks.length),
        ...uint16(TICKS_PER_QUARTER),
    ];
    const bytes: number[] = [...header];
    for (const t of tracks)
        bytes.push(...t);
    return new Uint8Array(bytes);
}
