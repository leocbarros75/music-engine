import { partPitchSpace, pitchToMidi, writtenToSoundingOffset, type Transposition } from './standard';

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Preserve diatonic spelling, including octave-transposing bass instruments. */
export function transposeWrittenPitch(pitch: any, transpose?: Partial<Transposition>) {
  const chromatic = (transpose?.chromatic ?? 0) + 12 * (transpose?.octaveChange ?? 0);
  const diatonic = (transpose?.diatonic ?? 0) + 7 * (transpose?.octaveChange ?? 0);
  const index = pitch.octave * 7 + STEPS.indexOf(pitch.step.toUpperCase()) + diatonic;
  const octave = Math.floor(index / 7);
  const step = STEPS[((index % 7) + 7) % 7];
  const alter = pitchToMidi(pitch) + chromatic - pitchToMidi({ step, octave });
  return { step, octave, alter };
}

export function transposeChordSymbol(symbol: string, transpose?: Partial<Transposition>): string {
  const convert = (token: string) => {
    const match = /^([A-G])([#b]*)(.*)$/.exec(token);
    if (!match) return token;
    const alter = [...match[2]].reduce((n, c) => n + (c === '#' ? 1 : -1), 0);
    const p = transposeWrittenPitch({ step: match[1], octave: 4, alter }, transpose);
    return p.step + (p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter)) + match[3];
  };
  return symbol.split('/').map(convert).join('/');
}

/** Immutable boundary conversion. Calling twice does not transpose twice. */
export function toSoundingScore<T extends { parts: any[]; meta?: any }>(score: T): T {
  const parts = score.parts.map(part => {
    if (partPitchSpace(part) === 'sounding') return part;
    const shift = writtenToSoundingOffset(part);
    const fifthShift = 7 * (part.transpose?.chromatic ?? 0) - 12 * (part.transpose?.diatonic ?? 0);
    return {
      ...part, pitchSpace: 'sounding' as const,
      measures: part.measures.map((m: any) => ({
        ...m,
        attributes: m.attributes ? {
          ...m.attributes,
          ...(typeof m.attributes.key_fifths === 'number' ? { key_fifths: m.attributes.key_fifths + fifthShift } : {})
        } : undefined,
        events: m.events.map((e: any) => {
          if (e.type !== 'note') return e;
          const pitch = e.pitch ? (shift ? transposeWrittenPitch(e.pitch, part.transpose) : { ...e.pitch }) : undefined;
          return { ...e, ...(pitch ? { pitch, midi: pitchToMidi(pitch) } : typeof e.midi === 'number' ? { midi: e.midi + shift } : {}) };
        })
      }))
    };
  });
  const source = score.parts[0];
  const transpose = source && partPitchSpace(source) === 'written' ? source.transpose : undefined;
  const meta = score.meta ? { ...score.meta,
    ...(Array.isArray(score.meta.inputChords) ? { inputChords: score.meta.inputChords.map((c: any) => ({ ...c, symbol: transposeChordSymbol(c.symbol, transpose) })) } : {}),
    ...(parts[0]?.measures[0]?.attributes?.key_fifths !== undefined ? { inputKeyFifths: parts[0].measures[0].attributes.key_fifths } : {})
  } : undefined;
  return { ...score, ...(meta ? { meta } : {}), parts };
}
