import { percussionMidi } from './percussionMidi';
/** Shared, browser-safe score contract. No filesystem or UI dependencies. */
export const SCORE_STANDARD_VERSION = 1 as const;
export const DEFAULT_TIME = { beats: 4, beat_type: 4 };
export type TimeSignature = { beats: number; beat_type: number };
export type PitchSpace = 'written' | 'sounding';
export type Transposition = { diatonic: number; chromatic: number; octaveChange: number };

export function divisionsToBeats(duration: number, divisions: number): number {
  if (!Number.isFinite(duration) || !Number.isFinite(divisions) || divisions <= 0)
    throw new Error('Invalid MusicXML duration/divisions.');
  return duration / divisions;
}

export function resolveTimeSignature(raw: any, previous: TimeSignature = DEFAULT_TIME): TimeSignature {
  if (!raw) return { ...previous };
  const beats = Number(raw.beats ?? previous.beats);
  const beat_type = Number(raw.beat_type ?? raw.beatType ?? previous.beat_type);
  if (!(beats > 0) || !Number.isFinite(beats) || !(beat_type > 0) || !Number.isFinite(beat_type))
    throw new Error('Invalid time signature.');
  return { beats, beat_type };
}

export function measureLengthBeats(time: TimeSignature): number {
  return time.beats * 4 / time.beat_type;
}

export type MeasurePosition = {
  index: number; number: number; startBeat: number; durationBeats: number; time: TimeSignature;
};

/**
 * One score-wide clock, aligned by measure index (printed numbers are labels).
 * Explicit durationBeats identifies pickups/irregular bars. Overfull events are
 * errors, not permission to delay every later bar in just one instrument.
 */
export function buildMeasureTimeline(score: { parts: any[]; meta?: any }): MeasurePosition[] {
  const parts = score.parts ?? [];
  const count = Math.max(0, ...parts.map(p => (p.measures ?? []).length));
  let time = resolveTimeSignature(score.meta?.inputTime);
  let startBeat = 0;
  const result: MeasurePosition[] = [];
  for (let index = 0; index < count; index++) {
    const measures = parts.map(p => p.measures?.[index]).filter(Boolean);
    const declarations = measures.map(m => m.attributes?.time).filter(Boolean).map(t => resolveTimeSignature(t, time));
    if (declarations.some(t => t.beats !== declarations[0].beats || t.beat_type !== declarations[0].beat_type))
      throw new Error(`Conflicting time signatures at measure index ${index}.`);
    time = declarations[0] ?? time;
    const durations = measures.map(m => m.durationBeats).filter(v => v !== undefined);
    if (durations.some(v => !Number.isFinite(v) || v <= 0 || Math.abs(v - durations[0]) > 1e-7))
      throw new Error(`Conflicting or invalid measure durations at measure index ${index}.`);
    const durationBeats = durations[0] ?? measureLengthBeats(time);
    result.push({ index, number: measures[0]?.number ?? index + 1, startBeat, durationBeats, time: { ...time } });
    startBeat += durationBeats;
  }
  return result;
}

export function pitchToMidi(pitch: { step: string; octave: number; alter?: number }): number {
  const pc = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[pitch.step.toUpperCase()];
  if (pc === undefined || !Number.isFinite(pitch.octave)) throw new Error('Invalid pitch.');
  return (pitch.octave + 1) * 12 + pc + (pitch.alter ?? 0);
}

/** Legacy parsed parts have transpose; legacy generated parts do not. */
export function partPitchSpace(part: { pitchSpace?: PitchSpace; transpose?: unknown }): PitchSpace {
  return part.pitchSpace ?? (part.transpose ? 'written' : 'sounding');
}
export function writtenToSoundingOffset(part: { pitchSpace?: PitchSpace; transpose?: Partial<Transposition> }): number {
  if (partPitchSpace(part) === 'sounding') return 0;
  return (part.transpose?.chromatic ?? 0) + 12 * (part.transpose?.octaveChange ?? 0);
}

/** Pitch spelling is authoritative; cached MIDI must describe the same space. */
export function soundingMidi(part: any, event: any): number | null {
  if (event.type !== 'note') return null;
  const stored = event.pitch ? pitchToMidi(event.pitch) : event.midi;
  return Number.isFinite(stored) ? stored + writtenToSoundingOffset(part) : null;
}

/**
 * What a part SOUNDS at playback, including the drums.
 *
 * `soundingMidi` answers a question about pitch, and a drum has none — it
 * returns null for anything that is not `type: 'note'`. Percussion is written
 * as `type: 'unpitched'`, so the jazz band's 1499 drum events produced exactly
 * zero playable notes: both the browser player and the MIDI export scheduled
 * the whole kit as silence.
 *
 * The number a drum needs is already on the event. The parser reads it back
 * from the instrument id the exporter writes ("<part>-I<midiUnpitched>") and
 * stores it as `midiUnpitched`, which is a General MIDI percussion key — 36 is
 * the kick, 38 the snare, 42 the hi-hat. It is an identity, not a pitch, so no
 * transposition is applied to it.
 *
 * This is kept separate from `soundingMidi` on purpose: that function also
 * feeds `buildNoteTimeline`, which the preservation checks use to compare a
 * source against an arrangement, and drums are not notes there.
 */
export function playbackMidi(part: any, event: any): number | null {
  if (event?.type === 'unpitched') {
    // Two shapes reach this. An arranger's own score model — which is what the
    // app plays — carries the drum as a NAME in `instrumentId`; a score parsed
    // back from MusicXML carries the number the exporter wrote, as
    // `midiUnpitched`. Taking only the second would have left the app silent
    // while every file-based check passed.
    const stored = Number(event.midiUnpitched);
    const drum = Number.isInteger(stored) ? stored : percussionMidi(event.instrumentId);
    return drum !== null && Number.isInteger(drum) && drum >= 0 && drum <= 127 ? drum : null;
  }
  return soundingMidi(part, event);
}

export type TimedNote = { partIdx: number; measureIndex: number; startBeat: number; durationBeats: number; midi: number };
export function buildNoteTimeline(score: { parts: any[]; meta?: any }): TimedNote[] {
  const measures = buildMeasureTimeline(score);
  const notes: TimedNote[] = [];
  score.parts.forEach((part, partIdx) => (part.measures ?? []).forEach((measure: any, measureIndex: number) => {
    const clock = measures[measureIndex];
    for (const event of measure.events ?? []) {
      if (event.grace) continue; // ornamental scheduling is a separate performance decision
      const t = Number(event.t), dur = Number(event.dur);
      if (!Number.isFinite(t) || !Number.isFinite(dur) || t < 0 || dur <= 0 || t + dur > clock.durationBeats + 1e-7)
        throw new Error(`Invalid event timing in ${part.name ?? part.part_id}, measure ${measure.number}.`);
      const midi = soundingMidi(part, event);
      if (midi !== null && midi >= 0 && midi <= 127)
        notes.push({ partIdx, measureIndex, startBeat: clock.startBeat + t, durationBeats: dur, midi });
    }
  }));
  return notes.sort((a, b) => a.startBeat - b.startBeat || a.partIdx - b.partIdx);
}
