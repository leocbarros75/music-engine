/**
 * Client-side MIDI Type 1 encoder for ScoreModel.
 *
 * UNITS: ScoreModel stores `t` and `dur` in QUARTER-NOTE BEATS, and `t` is
 * relative to the START OF ITS OWN MEASURE (a 4/4 whole note is t=0, dur=4 in
 * every bar). So a correct export has to do two things that are easy to miss:
 *   1. multiply beats by TICKS_PER_QUARTER — not by some "divisions" factor, or
 *      every note comes out a quarter of its written length;
 *   2. add the running measure offset — without it every bar lands on tick 0 and
 *      the whole piece collapses into a single stacked chord at the start.
 */

const TICKS_PER_QUARTER = 480;

type TimeSig = { beats: number; beatType: number };

/** Length of a measure in quarter-note beats, from its time signature. */
function measureLengthBeats(timeSig: { beats: number; beatType: number }): number {
  return timeSig.beats * (4 / (timeSig.beatType || 4));
}

// ── General MIDI program numbers (0-indexed) ─────────────────────────────────
const GM_PROGRAMS: [string, number][] = [
  ["piano",       0],
  ["harpsichord", 6],
  ["celesta",     8],
  ["organ",      19],
  ["violin",     40],
  ["viola",      41],
  ["cello",      42],
  ["contrabass", 43],
  ["harp",       46],
  ["timpani",    47],
  ["soprano",    52], // choir aahs
  ["mezzo",      52],
  ["alto",       52],
  ["tenor",      54],
  ["bass",       52],
  ["flute",      73],
  ["piccolo",    72],
  ["oboe",       68],
  ["cor anglais",69],
  ["clarinet",   71],
  ["bassoon",    70],
  ["horn",       60],
  ["trumpet",    56],
  ["cornet",     56],
  ["trombone",   57],
  ["tuba",       58],
  ["xylophone",  13],
  ["marimba",    12],
  ["glockenspiel",9],
];

function getProgram(instrument: string): number {
  const lower = (instrument ?? "").toLowerCase();
  for (const [key, prog] of GM_PROGRAMS) {
    if (lower.includes(key)) return prog;
  }
  return 0; // acoustic grand piano
}

// ── Binary helpers ────────────────────────────────────────────────────────────

/** Encode a value as a MIDI variable-length quantity (big-endian, 7-bit groups). */
function vlq(value: number): number[] {
  if (value < 0) value = 0;
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
function buildTempoTrack(bpm: number, time: TimeSig, title?: string): number[] {
  const usPerBeat = Math.round(60_000_000 / Math.max(1, bpm));
  const data: number[] = [];

  if (title) data.push(...metaText(0x03, title));   // sequence/track name
  if (title) data.push(...metaText(0x01, title));   // text event (for DAW display)

  // Time signature: MIDI stores the denominator as a power of two (4 → dd=2).
  const dd = Math.max(0, Math.round(Math.log2(time.beatType || 4)));
  data.push(0x00, 0xff, 0x58, 0x04, time.beats & 0x7f, dd, 0x18, 0x08);

  // Set tempo
  data.push(
    0x00, 0xff, 0x51, 0x03,
    (usPerBeat >> 16) & 0xff,
    (usPerBeat >> 8)  & 0xff,
     usPerBeat        & 0xff,
  );

  return wrapTrackChunk(data);
}

// ── Pitch conversion ──────────────────────────────────────────────────────────
const STEP_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function pitchToMidi(pitch: { step: string; octave: number; alter?: number }): number {
  const base = STEP_SEMITONE[pitch.step.toUpperCase()] ?? 0;
  return (pitch.octave + 1) * 12 + base + (pitch.alter ?? 0);
}

// ── Track N: one instrument part ──────────────────────────────────────────────
interface AbsEvent {
  tick: number;
  isOn: boolean;
  pitch: number;
  velocity: number;
}

function buildPartTrack(part: any, channel: number, defaultTime: TimeSig): number[] {
  const program = getProgram(part.instrument ?? part.name ?? "");
  const absEvents: AbsEvent[] = [];

  // `t` is measure-relative, so walk the bars and carry a running offset.
  // Only the first measure usually carries <attributes>, so the time signature
  // has to be carried forward too.
  let time: TimeSig = defaultTime;
  let measureStartBeats = 0;

  for (const measure of (part.measures ?? [])) {
    const ts = measure?.attributes?.time;
    if (ts) {
      time = {
        beats: Number(ts.beats ?? time.beats) || time.beats,
        beatType: Number(ts.beat_type ?? ts.beatType ?? time.beatType) || time.beatType,
      };
    }

    let spanBeats = measureLengthBeats(time);

    for (const ev of (measure.events ?? [])) {
      if (ev.isRest || ev.type === "rest") continue;

      let midiPitch: number;
      if (typeof ev.midi === "number") {
        midiPitch = ev.midi;
      } else if (ev.pitch) {
        midiPitch = pitchToMidi(ev.pitch);
      } else {
        continue;
      }

      if (midiPitch < 0 || midiPitch > 127) continue;

      const tBeats   = Number(ev.t ?? 0);
      const durBeats = Number(ev.dur ?? 1);
      if (tBeats + durBeats > spanBeats) spanBeats = tBeats + durBeats; // never truncate

      const startTick = Math.round((measureStartBeats + tBeats) * TICKS_PER_QUARTER);
      const rawDur    = Math.round(durBeats * TICKS_PER_QUARTER);
      // Shorten slightly to avoid legato bleed; minimum 1 tick
      const durTick   = Math.max(1, rawDur - Math.min(10, Math.floor(rawDur * 0.05)));

      absEvents.push({ tick: startTick,           isOn: true,  pitch: midiPitch, velocity: 80 });
      absEvents.push({ tick: startTick + durTick, isOn: false, pitch: midiPitch, velocity: 0 });
    }

    measureStartBeats += spanBeats;
  }

  // Sort: by tick, then note-offs before note-ons at same tick
  absEvents.sort((a, b) =>
    a.tick !== b.tick ? a.tick - b.tick : (a.isOn ? 1 : -1),
  );

  const data: number[] = [];
  const nameBytes = Array.from(new TextEncoder().encode(part.name ?? "Part"));
  // Track name
  data.push(0x00, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes);
  // Program change
  data.push(0x00, 0xc0 | (channel & 0x0f), program & 0x7f);

  let curTick = 0;
  for (const ev of absEvents) {
    const delta  = ev.tick - curTick;
    curTick      = ev.tick;
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
 * `bpm` should be the tempo the user chose; the ScoreModel itself carries no
 * tempo, so without it every export would silently land at 120.
 */
export function exportMidi(scoreModel: any, bpmOverride?: number): Uint8Array {
  const meta = scoreModel?.meta ?? {};
  const bpm = Number(bpmOverride ?? meta.tempo_bpm ?? meta.bpm ?? meta.tempo ?? 120) || 120;
  const title: string = meta.title ?? "";
  const parts: any[]  = scoreModel?.parts ?? [];

  // Score-wide time signature: first measure that declares one, else 4/4.
  let time: TimeSig = { beats: 4, beatType: 4 };
  const firstTs =
    parts.map((p) => p?.measures?.[0]?.attributes?.time).find(Boolean) ??
    meta.inputTime;
  if (firstTs) {
    time = {
      beats: Number(firstTs.beats ?? 4) || 4,
      beatType: Number(firstTs.beat_type ?? firstTs.beatType ?? 4) || 4,
    };
  }

  // Channel pool: 0-8 then 10-15 (skip 9 = General MIDI drums)
  const channelPool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

  const tracks: number[][] = [buildTempoTrack(bpm, time, title)];
  parts.forEach((part, i) => {
    const ch = channelPool[i % channelPool.length];
    tracks.push(buildPartTrack(part, ch, time));
  });

  // MThd header
  const header: number[] = [
    0x4d, 0x54, 0x68, 0x64,   // "MThd"
    0x00, 0x00, 0x00, 0x06,   // chunk length = 6
    0x00, 0x01,               // format: Type 1
    ...uint16(tracks.length),
    ...uint16(TICKS_PER_QUARTER),
  ];

  const bytes: number[] = [...header];
  for (const t of tracks) bytes.push(...t);
  return new Uint8Array(bytes);
}

/** Encode and immediately trigger a browser download. */
export function downloadMidi(scoreModel: any, filename: string, bpm?: number): void {
  const data = exportMidi(scoreModel, bpm);
  const blob = new Blob([data.buffer as ArrayBuffer], { type: "audio/midi" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename.endsWith(".mid") ? filename : `${filename}.mid`;
  a.click();
  URL.revokeObjectURL(url);
}
