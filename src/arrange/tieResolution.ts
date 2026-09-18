/**
 * Make every tie in a part resolve to a real note.
 *
 * A tie is a bind between two notes of the same pitch in the same part. When a
 * piano chord is split across monophonic instruments, that bind can be broken
 * in two ways, and both were reaching the page.
 *
 * A held pitch changes rank as the harmony moves under it — a source D that is
 * the top note of one chord is an inner note of the next — so per-onset
 * assignment hands it to a different instrument halfway through. And a
 * continuation can simply be dropped by the caps, four players being fewer than
 * six. Either way the first note keeps its `tieStart` and nothing ever stops
 * it: the reference piano-to-woodwind arrangement had 151 tie starts against
 * 143 stops, eight ties hanging into nothing.
 *
 * The alternative — pinning a whole tie chain to one instrument so the sustain
 * never moves — is what a transcription with divisi does, and it is right for
 * one: a section can hold the tie and take the new note at the same time. Four
 * monophonic winds cannot, so pinning there would only displace the notes that
 * were going to the instrument it occupies. What a wind section actually does
 * is re-attack: the note passes to another player and is struck again.
 *
 * So the tie is dropped rather than the note moved. Nothing is added, nothing
 * is repitched; a bind that no longer describes the music stops claiming to.
 */

type EventLike = any;
type PartLike = any;

const EPS = 1e-9;

function midiOf(ev: EventLike, pitchToMidi: (p: any) => number): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (!ev?.pitch) return null;
  try {
    return pitchToMidi(ev.pitch);
  } catch {
    return null;
  }
}

/**
 * Drop every tie in `part` that does not bind two notes of the same pitch,
 * adjacent in time, in the same voice. Returns how many were removed.
 */
export function resolveTiesWithinPart(
  part: PartLike,
  pitchToMidi: (p: any) => number
): number {
  // One flat, ordered stream per voice: a tie crosses barlines, so a
  // measure-at-a-time walk cannot see the note that resolves it.
  const byVoice = new Map<number, Array<{ ev: EventLike; start: number; end: number; midi: number }>>();
  let elapsed = 0;
  for (const measure of part?.measures ?? []) {
    let measureLength = 0;
    for (const ev of measure?.events ?? []) {
      const t = Number(ev?.t);
      const dur = Number(ev?.dur);
      if (!Number.isFinite(t) || !Number.isFinite(dur)) continue;
      measureLength = Math.max(measureLength, t + dur);
      if (ev?.type !== "note" || !ev.pitch) continue;
      const midi = midiOf(ev, pitchToMidi);
      if (midi === null) continue;
      const v = Number(ev?.voice ?? 1) || 1;
      const list = byVoice.get(v) ?? [];
      list.push({ ev, start: elapsed + t, end: elapsed + t + dur, midi });
      byVoice.set(v, list);
    }
    // Bars are not always four beats, and a bar the arranger left empty still
    // occupies time. Fall back to the measure's own attributes, then to 4.
    const attrs = (measure as any)?.attributes;
    const beats = Number(attrs?.time?.beats);
    const beatType = Number(attrs?.time?.beat_type);
    const declared = Number.isFinite(beats) && Number.isFinite(beatType)
      ? beats * (4 / beatType)
      : NaN;
    elapsed += Math.max(measureLength, Number.isFinite(declared) ? declared : 4);
  }

  let dropped = 0;
  for (const notes of byVoice.values()) {
    notes.sort((a, b) => (Math.abs(a.start - b.start) > EPS ? a.start - b.start : a.midi - b.midi));
    for (let i = 0; i < notes.length; i++) {
      const cur = notes[i]!;
      if (cur.ev.tieStart === true) {
        const continues = notes.some(
          (n) => n !== cur && n.midi === cur.midi && Math.abs(n.start - cur.end) < EPS && n.ev.tieStop === true
        );
        if (!continues) { delete cur.ev.tieStart; dropped++; }
      }
      if (cur.ev.tieStop === true) {
        const precedes = notes.some(
          (n) => n !== cur && n.midi === cur.midi && Math.abs(cur.start - n.end) < EPS && n.ev.tieStart === true
        );
        if (!precedes) { delete cur.ev.tieStop; dropped++; }
      }
    }
  }
  return dropped;
}

/** Apply `resolveTiesWithinPart` to every part; returns the total dropped. */
export function resolveTies(parts: PartLike[], pitchToMidi: (p: any) => number): number {
  let dropped = 0;
  for (const part of parts) dropped += resolveTiesWithinPart(part, pitchToMidi);
  return dropped;
}
