import { createHash } from 'node:crypto';
import { parseMusicXMLToScoreModel } from '../parsers/musicxmlParser';
import { toSoundingScore } from '../score/pitch';
import { buildMeasureTimeline, soundingMidi } from '../score/standard';
import { prepareSourceLock, snapshotPartXml } from '../preservation/sourcePreservation';
import { normalizeAppSettings } from '../app/normalizeAppSettings';
import type { AppSettings } from '../app/applyAppSettings';
import type { ScoreModel } from '../score/types';

export const ACCOMPANIMENT = ['violin2', 'viola', 'cello', 'bass'] as const;
export type Accompaniment = typeof ACCOMPANIMENT[number];
export const DYNAMICS = { pp: 40, p: 49, mp: 60, mf: 72 } as const;
export type PhraseDecision = { id: string; startBar: number; endBar: number; dynamic: keyof typeof DYNAMICS; activeParts: Accompaniment[]; reason: string };
export type PhrasePlan = { version: 1; sourceFingerprint: string; phrases: PhraseDecision[] };
export type PhraseContext = ReturnType<typeof inspectPhrases>;

export function inspectPhrases(xml: string, settings: AppSettings) {
  if (settings.ensemble !== 'string_ensemble' || settings.preserveSource === false ||
      (settings.instrumentation && settings.instrumentation !== 'auto')) {
    throw Error('Phrase collaboration currently requires string ensemble, automatic instrumentation and source preservation.');
  }
  const score = toSoundingScore(parseMusicXMLToScoreModel(xml));
  const { lock } = prepareSourceLock(xml, score, settings);
  if (!lock) throw Error('Phrase collaboration requires an unambiguous, preservable source melody.');
  const source = lock.source;
  const clock = buildMeasureTimeline({ ...score, parts: [source] });
  if (!clock.length || clock.length > 128) throw Error('Phrase collaboration supports 1–128 written measures.');
  const snapshots = snapshotPartXml(xml, lock.partId);
  let key = { fifths: 0, mode: 'major' };
  const bars = source.measures.map((m, i) => {
    if (m.attributes?.key_fifths !== undefined) key = { fifths: m.attributes.key_fifths, mode: m.attributes.key_mode ?? 'major' };
    return { bar: i + 1, printedNumber: m.number, beats: clock[i].durationBeats, meter: clock[i].time, key: { ...key },
      melody: m.events.map(e => ({ t: e.t, duration: e.dur, midi: e.type === 'note' ? soundingMidi(source, e) : null })),
      chords: snapshots[i].chords, lyrics: snapshots[i].events.flatMap((e: any) => e.lyrics),
      directions: snapshots[i].directions, form: m.performance };
  });
  const phrases: Array<{ id: string; startBar: number; endBar: number; evidence: string }> = [];
  let start = 1;
  source.measures.forEach((bar, i) => {
    const events = bar.events.filter(e => !e.grace);
    const last = events[events.length - 1];
    const rest = last?.type === 'rest' && last.dur >= 1;
    const form = bar.performance?.repeatEnd || source.measures[i + 1]?.performance?.repeatStart;
    const fermata = JSON.stringify(snapshots[i].events.map((e: any) => e.notations)).includes('fermata');
    const fallback = i + 2 - start >= 4 && !last?.tieStart;
    if (rest || form || fermata || fallback || i === source.measures.length - 1) {
      phrases.push({ id: `phrase-${phrases.length + 1}`, startBar: start, endBar: i + 1,
        evidence: rest ? 'melody rest' : form ? 'repeat boundary' : fermata ? 'fermata' : i === source.measures.length - 1 ? 'score end' : 'four-bar working group (heuristic)' });
      start = i + 2;
    }
  });
  const sourceFingerprint = createHash('sha256').update(xml).update(JSON.stringify(normalizeAppSettings(settings))).digest('hex');
  const context = { version: 1 as const, sourceFingerprint, sourcePartId: lock.partId, title: score.meta.title ?? '',
    boundaryPolicy: 'Written-measure groups using rests, fermatas and repeats; four-bar fallback. These are editable musical decisions, not certified phrase analysis.',
    controls: { activeParts: ACCOMPANIMENT, dynamics: Object.keys(DYNAMICS), alwaysActive: 'source melody and cello',
      notePolicy: 'Engine writes pitches/rhythms; plan controls accompaniment entrances and dynamics only.' }, bars, phrases };
  if (JSON.stringify(context).length > 180000) throw Error('Score summary is too large for phrase collaboration.');
  return context;
}
export function defaultPhrasePlan(context: PhraseContext): PhrasePlan {
  return { version: 1, sourceFingerprint: context.sourceFingerprint, phrases: context.phrases.map(p => ({ id: p.id, startBar: p.startBar, endBar: p.endBar,
    dynamic: 'mp', activeParts: [...ACCOMPANIMENT], reason: 'Editable starting plan; no AI has been called.' })) };
}
function exactKeys(value: any, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw Error('Phrase plan contains unsupported fields.');
}
export function validatePhrasePlan(value: unknown, context: PhraseContext): PhrasePlan {
  const plan = value as any;
  exactKeys(plan, ['version', 'sourceFingerprint', 'phrases']);
  if (plan.version !== 1 || plan.sourceFingerprint !== context.sourceFingerprint) throw Error('Phrase plan is stale or belongs to a different score/settings. Inspect the current score again.');
  if (!Array.isArray(plan.phrases) || plan.phrases.length !== context.phrases.length) throw Error('Phrase plan must cover every phrase exactly once.');
  plan.phrases.forEach((p: any, i: number) => {
    exactKeys(p, ['id', 'startBar', 'endBar', 'dynamic', 'activeParts', 'reason']);
    const expected = context.phrases[i];
    if (p.id !== expected.id || p.startBar !== expected.startBar || p.endBar !== expected.endBar) throw Error('Phrase boundaries/order must match the inspected score.');
    if (typeof p.dynamic !== "string" || !Object.hasOwn(DYNAMICS, p.dynamic)) throw Error('Unsupported phrase dynamic.');
    if (!Array.isArray(p.activeParts) || !p.activeParts.includes('cello') || p.activeParts.some((v: any) => !ACCOMPANIMENT.includes(v)) || new Set(p.activeParts).size !== p.activeParts.length) throw Error('Invalid accompaniment parts: retain cello and never target the source melody.');
    if (typeof p.reason !== 'string' || p.reason.length > 500) throw Error('Phrase explanation must be text of at most 500 characters.');
  });
  return JSON.parse(JSON.stringify(plan));
}

/** Apply a validated plan to accompaniment only, before the usual preservation/export checks. */
export function applyPhrasePlan(score: ScoreModel, plan: PhrasePlan, protectedId: string) {
  const names: Record<string, Accompaniment> = { 'Violin II': 'violin2', 'Viola': 'viola', 'Cello': 'cello', 'Double Bass': 'bass' };
  if (!protectedId || !score.parts.some(p => p.part_id === protectedId)) throw Error('Phrase application requires a protected melody part.');
  const clock = buildMeasureTimeline(score);
  if (clock.length !== plan.phrases.at(-1)?.endBar) throw Error('Arrangement length differs from the phrase plan.');
  for (const part of score.parts) {
    if (part.part_id === protectedId) continue;
    const role = names[part.name];
    if (!role) throw Error(`Phrase collaboration cannot control part ${part.name}.`);
    for (const phrase of plan.phrases) for (let i = phrase.startBar - 1; i < phrase.endBar; i++) {
      const bar = part.measures[i];
      if (!bar) throw Error('Arrangement is missing a planned measure.');
      bar.performance = { ...bar.performance, dynamics: [{ t: 0, velocity: DYNAMICS[phrase.dynamic] }] };
      if (!phrase.activeParts.includes(role)) bar.events = [{ id: `phrase-rest-${part.part_id}-${i}`, type: 'rest', isRest: true, t: 0, dur: clock[i].durationBeats, voice: 1, staff: 1 }];
    }
    // Drop only tie endpoints disconnected by an entrance/rest; keep valid internal ties.
    const notes = part.measures.flatMap((bar, i) => bar.events.filter(e => e.type === 'note' && !e.grace).map(e => ({ e, start: clock[i].startBeat + e.t, end: clock[i].startBeat + e.t + e.dur, midi: soundingMidi(part, e) })));
    for (const n of notes) {
      const sameVoice = (m: typeof n) => m.midi === n.midi && m.e.voice === n.e.voice && m.e.staff === n.e.staff;
      if (n.e.tieStart && !notes.some(m => sameVoice(m) && Math.abs(m.start - n.end) < 1e-7 && m.e.tieStop)) n.e.tieStart = false;
      if (n.e.tieStop && !notes.some(m => sameVoice(m) && Math.abs(m.end - n.start) < 1e-7 && m.e.tieStart)) n.e.tieStop = false;
    }
  }
}
