/**
 * Standard MIDI File reader — bytes in, timed note events out.
 *
 * Step 1 of MIDI import. This module makes NO musical judgement: no quantization,
 * no hand splitting, no spelling, no notation. It either decodes the file
 * correctly or it does not, which is a property that can be tested rather than
 * argued about. Everything ambiguous belongs to the transcription stage above it.
 *
 * The engine's own writer (../score/midi.ts) emits a deliberately clean subset —
 * Type 1, explicit note-offs, one channel per track, no running status. Real files
 * from Dorico, Logic or Cubase use far more of the format, so this reader is
 * written against the spec rather than against our own output. In particular
 * RUNNING STATUS (a status byte omitted when it repeats) is near-universal in real
 * files and never appears in ours: decoding it wrongly corrupts every event after
 * the first occurrence, and a round-trip test against our writer would not notice.
 */

export type MidiNote = {
    midi: number;
    velocity: number;
    /** Absolute ticks from the start of the file. */
    startTick: number;
    durationTick: number;
    channel: number;
};

export type MidiTrack = {
    index: number;
    name?: string;
    /** Channels the track actually played on. Usually one; Type 0 files mix many. */
    channels: number[];
    program?: number;
    isDrums: boolean;
    notes: MidiNote[];
};

export type MidiFile = {
    format: number;
    /** Ticks per quarter note. */
    ppq: number;
    tracks: MidiTrack[];
    tempos: Array<{ tick: number; bpm: number }>;
    timeSigs: Array<{ tick: number; beats: number; beatType: number }>;
    keySigs: Array<{ tick: number; fifths: number; mode: "major" | "minor" }>;
    markers: Array<{ tick: number; text: string }>;
    /** Sustain pedal (CC64); unused until the transcription stage. */
    pedal: Array<{ tick: number; channel: number; down: boolean }>;
    totalTicks: number;
    warnings: string[];
};

class Reader {
    constructor(private readonly b: Uint8Array, public pos = 0) {}
    get done(): boolean {
        return this.pos >= this.b.length;
    }
    u8(): number {
        if (this.pos >= this.b.length) throw new Error("Unexpected end of MIDI data.");
        return this.b[this.pos++]!;
    }
    u16(): number {
        return (this.u8() << 8) | this.u8();
    }
    u32(): number {
        return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
    }
    bytes(n: number): Uint8Array {
        if (this.pos + n > this.b.length) throw new Error("Unexpected end of MIDI data.");
        const out = this.b.subarray(this.pos, this.pos + n);
        this.pos += n;
        return out;
    }
    /** Variable-length quantity: 7 bits per byte, high bit marks continuation. */
    vlq(): number {
        let value = 0;
        for (let i = 0; i < 4; i++) {
            const byte = this.u8();
            value = (value << 7) | (byte & 0x7f);
            if ((byte & 0x80) === 0) return value;
        }
        throw new Error("Malformed variable-length quantity in MIDI data.");
    }
    ascii(n: number): string {
        return new TextDecoder("latin1").decode(this.bytes(n));
    }
}

/** A note waiting for its note-off, keyed by channel and pitch. */
type Pending = { startTick: number; velocity: number };

function decodeTrack(
    data: Uint8Array,
    index: number,
    file: MidiFile
): MidiTrack {
    const r = new Reader(data);
    const track: MidiTrack = { index, channels: [], isDrums: false, notes: [] };
    // A pitch can legitimately sound twice before either releases (repeated notes
    // under a held pedal), so each channel/pitch keeps a stack rather than a slot.
    const pending = new Map<number, Pending[]>();
    let tick = 0;
    let runningStatus = 0;

    while (!r.done) {
        tick += r.vlq();
        let status = r.u8();
        if (status < 0x80) {
            // Running status: the status byte was omitted because it repeats. Rewind
            // — that byte was actually the first data byte.
            if (!runningStatus) throw new Error("MIDI data byte with no preceding status byte.");
            r.pos--;
            status = runningStatus;
        } else if (status < 0xf0) {
            runningStatus = status;
        }

        if (status === 0xff) {
            const type = r.u8();
            const len = r.vlq();
            const payload = r.bytes(len);
            switch (type) {
                case 0x2f:
                    file.totalTicks = Math.max(file.totalTicks, tick);
                    return finish(track, pending, tick, file);
                case 0x03:
                    if (!track.name) track.name = new TextDecoder("latin1").decode(payload).trim();
                    break;
                case 0x06:
                    file.markers.push({ tick, text: new TextDecoder("latin1").decode(payload).trim() });
                    break;
                case 0x51: {
                    if (len !== 3) break;
                    const us = (payload[0]! << 16) | (payload[1]! << 8) | payload[2]!;
                    if (us > 0) file.tempos.push({ tick, bpm: 60000000 / us });
                    break;
                }
                case 0x58:
                    if (len >= 2) file.timeSigs.push({ tick, beats: payload[0]!, beatType: 2 ** payload[1]! });
                    break;
                case 0x59:
                    if (len >= 2) {
                        // fifths is signed; mode 1 = minor.
                        const fifths = (payload[0]! << 24) >> 24;
                        file.keySigs.push({ tick, fifths, mode: payload[1] === 1 ? "minor" : "major" });
                    }
                    break;
                default:
                    break; // Unknown meta events are skipped by their declared length.
            }
            continue;
        }

        if (status === 0xf0 || status === 0xf7) {
            r.bytes(r.vlq()); // Sysex — skipped by declared length.
            runningStatus = 0; // Sysex cancels running status.
            continue;
        }

        const channel = status & 0x0f;
        const kind = status & 0xf0;
        if (!track.channels.includes(channel)) track.channels.push(channel);
        if (channel === 9) track.isDrums = true;

        switch (kind) {
            case 0x90: {
                const pitch = r.u8();
                const velocity = r.u8();
                if (velocity === 0) {
                    // A note-on with velocity 0 is a note-off. Universal in real files.
                    closeNote(track, pending, channel, pitch, tick);
                } else {
                    const key = channel * 128 + pitch;
                    const stack = pending.get(key) ?? [];
                    stack.push({ startTick: tick, velocity });
                    pending.set(key, stack);
                }
                break;
            }
            case 0x80: {
                const pitch = r.u8();
                r.u8();
                closeNote(track, pending, channel, pitch, tick);
                break;
            }
            case 0xb0: {
                const controller = r.u8();
                const value = r.u8();
                if (controller === 64) file.pedal.push({ tick, channel, down: value >= 64 });
                break;
            }
            case 0xc0:
                track.program = r.u8();
                break;
            case 0xd0:
                r.u8();
                break;
            case 0xa0:
            case 0xe0:
                r.u8();
                r.u8();
                break;
            default:
                throw new Error(`Unrecognised MIDI status byte 0x${status.toString(16)}.`);
        }
    }

    file.totalTicks = Math.max(file.totalTicks, tick);
    return finish(track, pending, tick, file);
}

function closeNote(
    track: MidiTrack,
    pending: Map<number, Pending[]>,
    channel: number,
    pitch: number,
    tick: number
): void {
    const key = channel * 128 + pitch;
    const stack = pending.get(key);
    if (!stack?.length) return; // Stray note-off; nothing to close.
    const open = stack.shift()!; // FIFO: the oldest sounding copy is the one released.
    track.notes.push({
        midi: pitch,
        velocity: open.velocity,
        startTick: open.startTick,
        durationTick: Math.max(1, tick - open.startTick),
        channel
    });
}

/** Close anything still sounding at the end of the track rather than dropping it. */
function finish(
    track: MidiTrack,
    pending: Map<number, Pending[]>,
    tick: number,
    file: MidiFile
): MidiTrack {
    let unclosed = 0;
    for (const [key, stack] of pending)
        for (const open of stack) {
            unclosed++;
            track.notes.push({
                midi: key % 128,
                velocity: open.velocity,
                startTick: open.startTick,
                durationTick: Math.max(1, tick - open.startTick),
                channel: Math.floor(key / 128)
            });
        }
    if (unclosed)
        file.warnings.push(
            `Track ${track.index}${track.name ? ` (${track.name})` : ""}: ${unclosed} note(s) had no note-off and were closed at the end of the track.`
        );
    track.notes.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi);
    track.channels.sort((a, b) => a - b);
    return track;
}

/**
 * Parse a Standard MIDI File. Throws on data this reader will not silently guess at.
 */
export function parseMidiFile(bytes: Uint8Array): MidiFile {
    const r = new Reader(bytes);
    if (r.ascii(4) !== "MThd") throw new Error("Not a MIDI file: missing MThd header.");
    const headerLength = r.u32();
    const format = r.u16();
    const declaredTracks = r.u16();
    const division = r.u16();
    if (headerLength > 6) r.bytes(headerLength - 6); // Forward-compatible header padding.

    if (format === 2)
        throw new Error(
            "Type 2 MIDI files hold independent sequences rather than one piece, and are not supported. Export as Type 0 or Type 1."
        );
    if (format !== 0 && format !== 1) throw new Error(`Unsupported MIDI file type ${format}.`);
    if (division & 0x8000)
        throw new Error(
            "This MIDI file is timed in SMPTE frames rather than ticks per quarter note, which carries no musical beat. Export it with a metrical (PPQ) time base."
        );
    if (division === 0) throw new Error("MIDI file declares a zero time base.");

    const file: MidiFile = {
        format,
        ppq: division,
        tracks: [],
        tempos: [],
        timeSigs: [],
        keySigs: [],
        markers: [],
        pedal: [],
        totalTicks: 0,
        warnings: []
    };

    let index = 0;
    while (!r.done) {
        const id = r.ascii(4);
        const length = r.u32();
        if (id !== "MTrk") {
            // Unknown chunk types are skipped by declared length, as the spec requires.
            r.bytes(length);
            continue;
        }
        file.tracks.push(decodeTrack(r.bytes(length), index++, file));
    }

    if (file.tracks.length !== declaredTracks)
        file.warnings.push(
            `Header declares ${declaredTracks} track(s) but ${file.tracks.length} were found.`
        );
    for (const list of [file.tempos, file.timeSigs, file.keySigs, file.markers, file.pedal])
        (list as Array<{ tick: number }>).sort((a, b) => a.tick - b.tick);
    if (!file.tempos.length) {
        file.tempos.push({ tick: 0, bpm: 120 });
        file.warnings.push("No tempo found; assuming 120 bpm, the MIDI default.");
    }
    if (!file.timeSigs.length) {
        file.timeSigs.push({ tick: 0, beats: 4, beatType: 4 });
        file.warnings.push("No time signature found; assuming 4/4, the MIDI default.");
    }
    return file;
}
