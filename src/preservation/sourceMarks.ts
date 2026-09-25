import type { ScoreModel } from "../score/types";

/**
 * Carry the source's marks onto the parts written from it.
 *
 * Repeats, first and second endings, dynamics, hairpins and tempo are not
 * decoration — they are the shape of the piece. A transcription that drops
 * them hands back a player's part that runs straight through a repeat, has no
 * endings to take, and never changes dynamic: the notes are right and the
 * music is not.
 *
 * The copy arrangers build their measures fresh (number, attributes on the
 * first bar, events) and never carried `performance` across, so every
 * transcription mode lost the lot. The DP-based ensembles kept it by accident
 * of building on the source's own measures.
 *
 * A repeat is a fact about the SCORE, so it goes on every part — a wind
 * quartet with the repeat printed only on the flute's staff is unreadable in
 * rehearsal. Marks already set on an output part are left alone, so an
 * arranger that has said something specific keeps the last word.
 */
export function carrySourceMarks(source: ScoreModel | any, outParts: any[]): number {
  const srcParts: any[] = source?.parts ?? [];
  if (!srcParts.length || !outParts?.length) return 0;
  const bars = Math.max(0, ...srcParts.map((p) => (p?.measures ?? []).length));
  let carried = 0;
  for (let i = 0; i < bars; i++) {
    // Whichever source part states them — in a piano source that is the piano,
    // in a choral one whichever staff the publisher put the repeat on.
    let marks: any = null;
    for (const sp of srcParts) {
      const perf = sp?.measures?.[i]?.performance;
      if (perf && Object.keys(perf).length) { marks = perf; break; }
    }
    if (!marks) continue;
    for (const op of outParts) {
      const m = op?.measures?.[i];
      if (!m || m.performance) continue;
      m.performance = JSON.parse(JSON.stringify(marks));
      carried++;
    }
  }
  return carried;
}
