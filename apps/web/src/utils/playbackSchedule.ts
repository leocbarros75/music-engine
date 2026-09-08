import { buildPerformance } from '../../../../src/score/performance';

export function buildPlaybackSchedule(score: { parts: any[]; meta?: any }, bpm?: number) {
  const performance = buildPerformance(score, bpm);
  return Object.assign(performance.notes.map(note => ({
    partIdx: note.partIdx, midi: note.midi, velocity: note.velocity,
    startSec: note.startSec, durSec: note.durationSec
  })), { durationSec: performance.durationSec, warnings: performance.warnings });
}

/** Resume sustained notes for their remaining duration instead of dropping them. */
export function resumeSchedule(schedule: ReturnType<typeof buildPlaybackSchedule>, offset: number) {
  return schedule.filter(n => n.startSec + n.durSec > offset).map(n => ({
    ...n, startSec: Math.max(offset, n.startSec),
    durSec: n.startSec + n.durSec - Math.max(offset, n.startSec)
  }));
}

/** Soundfont-player's single-note API is play(note, time, options). */
export function scheduleInstrumentNotes(instruments: any[], schedule: Array<{partIdx:number;midi:number;startSec:number;durSec:number;velocity:number}>, origin: number) {
  const nodes: any[] = [];
  for (const n of schedule) {
    const instrument = instruments[n.partIdx];
    if (!instrument) throw Error(`Missing playback instrument for part ${n.partIdx + 1}.`);
    const node = instrument.play(n.midi, origin + n.startSec, { duration: n.durSec, gain: n.velocity / 127 });
    if (node) nodes.push(node);
  }
  return () => nodes.forEach(n => { try { n.stop(0); } catch {} });
}
