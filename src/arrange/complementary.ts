/**
 * The complementary ensembles: a piano part that stays, and players added
 * around it.
 *
 * These are not transcriptions. The pianist keeps the music — the recognisable
 * material is already theirs — and the added instruments supply continuity,
 * colour and a rise in intensity. That makes two things true that are not true
 * of a transcription, and the engine was getting both of them wrong.
 *
 * FIRST, the piano belongs in the score. `piano_with_strings` and its siblings
 * used the piano as a harmony and rhythm source and then dropped it, emitting
 * only the new parts. The ensemble whose name promises a combined score was the
 * one thing that could not produce one.
 *
 * SECOND, the added players do not all play all the time. A reference edition
 * of the same 62-bar song rests its first violin for 15 bars and its double
 * bass for 24 — more than a third of the piece — bringing them in as the music
 * opens up. Ours played every part in every bar, entering together in bar 1,
 * under a piano that was already carrying the song. Restraint is an arranging
 * parameter, and the engine had no way to express it.
 */

type PartLike = any;
type MeasureLike = any;

/** Score order: added players above, the piano they accompany at the foot. */
export function withPianoPart(arrangedParts: PartLike[], pianoPart: PartLike | null): PartLike[] {
  if (!pianoPart) return arrangedParts;
  const already = arrangedParts.some((p) => p === pianoPart || String(p?.part_id) === String(pianoPart?.part_id));
  return already ? arrangedParts : [...arrangedParts, pianoPart];
}

// ── The arc ─────────────────────────────────────────────────────────────────

export type ArcOptions = {
  /**
   * Voices from the top of the ensemble down. The order matters: the top voice
   * is the one held back longest, because it is the one the ear takes as a
   * second melody against the piano's.
   */
  voicesTopDown: string[];
  /** Bars to leave to the piano entirely before anyone joins. */
  openBars?: number;
};

export type ArcDecision = {
  /** Part ids that should sound in this bar. */
  playing: Set<string>;
  /** Where the density sits relative to the piece: 0 thinnest, 1 fullest. */
  intensity: number;
};

/**
 * How busy each bar of the source is, as a fraction of the piece's own busiest.
 *
 * Measured rather than assumed: a verse and a chorus differ in how much the
 * pianist is playing, and that is the signal already present in the file. No
 * section labels are needed, and none are invented.
 */
export function densityCurve(measures: MeasureLike[]): number[] {
  const counts = measures.map((m: any) =>
    (m?.events ?? []).filter((e: any) => e?.type === "note" && e?.pitch).length
  );
  const sorted = counts.filter((c) => c > 0).slice().sort((a, b) => a - b);
  if (!sorted.length) return counts.map(() => 0);
  // The 90th percentile rather than the maximum: one exceptionally dense bar
  // should not flatten the whole curve beneath it.
  const peak = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!;
  return counts.map((c) => (peak > 0 ? Math.min(1, c / peak) : 0));
}

/**
 * Decide who plays in each bar.
 *
 * Two shapes combined. An ENTRY stagger at the start, so the ensemble arrives
 * rather than switching on: the piano has the opening to itself, the inner
 * voices join, and the top voice waits longest. Then a DENSITY rule for the
 * rest: the thinner the piano writing, the fewer players under it — the lowest
 * and highest voices drop out first, since the inner voices are the ones that
 * sustain harmony without competing for the melody.
 *
 * A part never re-enters and leaves within a bar of itself; short flickers read
 * as mistakes rather than phrasing, so a part that has just entered is held in
 * for a minimum span.
 */
export function planArc(measures: MeasureLike[], options: ArcOptions): ArcDecision[] {
  const voices = options.voicesTopDown;
  const open = Math.max(0, options.openBars ?? 1);
  const density = densityCurve(measures);
  const n = measures.length;

  // Entry order: inner voices first, then outward, and the top voice last.
  // With four voices that is 2nd, 3rd, 4th (lowest), 1st (top).
  const inner = voices.slice(1, Math.max(1, voices.length - 1));
  const entryOrder = [...inner, ...voices.slice(-1), ...voices.slice(0, 1)]
    .filter((v, i, a) => a.indexOf(v) === i);
  const entryBar = new Map<string, number>();
  entryOrder.forEach((v, i) => entryBar.set(v, open + i));

  const raw: Array<Set<string>> = [];
  for (let i = 0; i < n; i++) {
    const bar = i + 1;
    const d = density[i] ?? 0;
    const playing = new Set<string>();
    for (const v of voices) {
      if (bar < (entryBar.get(v) ?? 0) + 1) continue;      // has not entered yet
      const rank = voices.indexOf(v);
      const isTop = rank === 0;
      const isBottom = rank === voices.length - 1;
      // Thin writing keeps the inner voices and rests the outer ones. The top
      // competes with the melody the pianist is already playing; the bottom
      // adds weight a thin passage has not asked for. What is left is the pair
      // that can hold harmony without drawing attention — which is the whole
      // job of an accompaniment under a piano that already has the song.
      if (d < 0.35 && (isTop || isBottom)) continue;
      playing.add(v);
    }
    raw.push(playing);
  }

  // Smooth: a part that appears for a single bar between two rests is noise.
  for (const v of voices) {
    for (let i = 1; i < n - 1; i++) {
      if (raw[i]!.has(v) && !raw[i - 1]!.has(v) && !raw[i + 1]!.has(v)) raw[i]!.delete(v);
      if (!raw[i]!.has(v) && raw[i - 1]!.has(v) && raw[i + 1]!.has(v)) raw[i]!.add(v);
    }
  }

  return raw.map((playing, i) => ({ playing, intensity: density[i] ?? 0 }));
}

// ── How often a sustaining part re-attacks ──────────────────────────────────

/** Note values a player reads without counting, longest first. */
const BOW_LENGTHS = [4, 3, 2, 1.5, 1];

/**
 * The longest note worth writing at this tempo, in beats.
 *
 * A bow lasts a couple of seconds at a comfortable speed, so the value that
 * fills one is a function of tempo, not a constant. At 71 to the quarter a
 * half note runs about 1.7 seconds and is exactly right; at 120 the same
 * duration wants a dotted half; at 60, a dotted quarter. Picking a note value
 * rather than a raw duration keeps the result readable.
 */
export function bowLengthBeats(quarterBpm: number, secondsPerBow = 1.8): number {
  const bpm = Number.isFinite(quarterBpm) && quarterBpm > 0 ? quarterBpm : 90;
  const beats = (secondsPerBow * bpm) / 60;
  return BOW_LENGTHS.find((v) => v <= beats + 1e-9) ?? 1;
}

/** The tempo the score asks for, or null when it does not say. */
export function quarterBpmOf(measures: MeasureLike[]): number | null {
  for (const m of measures ?? []) {
    const bpm = Number((m as any)?.performance?.tempos?.[0]?.bpm);
    if (Number.isFinite(bpm) && bpm > 0) return bpm;
  }
  return null;
}

/**
 * Stop a sustaining part from re-striking a note it is already holding.
 *
 * Our complementary parts were built on the piano's own onsets — the branch
 * says as much, "use piano RH onsets as rhythm grid" — which for a ballad
 * means the strings hammer out every quaver the pianist plays. On the
 * reference song that is 1,367 attacks against a reference edition's 606, and
 * the difference is almost entirely repeated notes: 671 quarters and 547
 * eighths where the reference writes 421 half notes.
 *
 * Adjacent notes of the SAME pitch are merged and re-emitted at a bow's
 * length. Only the same pitch: a part that is actually moving keeps every note
 * it had, so this thins repetition without touching melody. The pieces are
 * separate notes rather than ties, because a renewed bow is what is wanted —
 * a tie would ask one player to hold a whole phrase in a single stroke.
 */
export function sustainForBowing(parts: PartLike[], maxBeats: number): number {
  let removed = 0;
  for (const part of parts) {
    for (const measure of part?.measures ?? []) {
      const events: any[] = (measure?.events ?? []) as any[];
      const notes = events.filter((e) => e?.type === "note" && Number.isFinite(Number(e?.t)));
      if (notes.length < 2) continue;
      const others = events.filter((e) => e?.type !== "note");

      // One stream per sounding pitch; a divisi stack is several streams that
      // happen to share onsets, and each is held or re-struck on its own.
      const byPitch = new Map<string, any[]>();
      for (const n of notes) {
        const k = `${n.voice ?? 1}|${n.midi ?? JSON.stringify(n.pitch)}`;
        const list = byPitch.get(k);
        if (list) list.push(n);
        else byPitch.set(k, [n]);
      }

      const kept: any[] = [];
      for (const stream of byPitch.values()) {
        stream.sort((a, b) => Number(a.t) - Number(b.t));
        let i = 0;
        while (i < stream.length) {
          // Gather everything contiguous at this pitch.
          const first = stream[i]!;
          let end = Number(first.t) + Number(first.dur);
          let j = i + 1;
          while (j < stream.length && Math.abs(Number(stream[j]!.t) - end) < 1e-9) {
            end += Number(stream[j]!.dur);
            j++;
          }
          const wasCount = j - i;
          // Re-emit that span as bow lengths, the last piece taking the
          // remainder so the span still ends exactly where it did.
          let at = Number(first.t);
          let piece = 0;
          while (at < end - 1e-9) {
            const dur = Math.min(maxBeats, end - at);
            kept.push({ ...first, id: `${first.id}-b${piece}`, t: at, dur });
            at += dur;
            piece++;
          }
          // How many attacks this span cost, against how many it now costs.
          removed += wasCount - piece;
          i = j;
        }
      }
      kept.sort((a, b) => (Math.abs(Number(a.t) - Number(b.t)) > 1e-9 ? Number(a.t) - Number(b.t) : Number(a.midi ?? 0) - Number(b.midi ?? 0)));
      measure.events = [...others, ...kept];
    }
  }
  return removed;
}

/**
 * Silence the bars the arc does not call for. Notes are removed, not muted:
 * the exporter fills an empty measure with a rest, which is what a player
 * needs to see.
 */
export function applyArc(parts: PartLike[], arc: ArcDecision[]): Map<string, number> {
  const rested = new Map<string, number>();
  for (const part of parts) {
    const id = String(part?.part_id ?? "");
    let count = 0;
    const measures: MeasureLike[] = part?.measures ?? [];
    for (let i = 0; i < measures.length; i++) {
      const decision = arc[i];
      if (!decision || decision.playing.has(id)) continue;
      const had = (measures[i]?.events ?? []).some((e: any) => e?.type === "note");
      if (had) { measures[i]!.events = []; count++; }
    }
    rested.set(id, count);
  }
  return rested;
}
