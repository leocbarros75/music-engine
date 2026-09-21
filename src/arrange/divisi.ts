/**
 * Divisi: a section can play what one player cannot.
 *
 * A piano strikes more notes at once than a player can sustain, and the three
 * ways out are to drop material, to demand double stops, or to divide the
 * section. For a transcription the third is the only one that keeps the music:
 * two desks hold the chord while the others play the figure over it.
 *
 * What was happening instead is worse than any of the three. Bar 112 of the
 * reference holds a four-beat chord in the right hand with sixteenths running
 * above it. Both reached the first violins, in one voice, and MusicXML cannot
 * write two notes at once on a single staff line — so the export kept the
 * chord and all fourteen sixteenths vanished, with the bar still looking full.
 *
 * This separates a part's notes into as many notated voices as the music needs,
 * so nothing has to be dropped. Each voice is monophonic by construction; a
 * chord — notes sharing an onset AND a duration — stays together in one voice
 * as a stack, because that is a section playing divisi at the same rhythm, not
 * two rhythms at once.
 *
 * It is only right for a SECTION. Four winds or a true four-player quartet
 * cannot divide, and there the answer is to clip the held note where the next
 * attack falls — see the woodwind and brass paths, which do exactly that.
 * Calling this on a one-player-per-part ensemble would write music nobody can
 * perform.
 */

type EventLike = any;
type PartLike = any;

const EPS = 1e-9;

/**
 * Assign voice numbers within one measure so that no voice is ever asked to
 * play two notes at once. Returns the deepest division used.
 */
function separateMeasure(events: EventLike[]): number {
  const notes = events.filter((e: any) => e?.type === "note" && Number.isFinite(Number(e?.t)));
  if (notes.length < 2) {
    for (const n of notes) n.voice = 1;
    return notes.length ? 1 : 0;
  }

  // A chord is one thing to place: same onset, same length, played together.
  const groups = new Map<string, EventLike[]>();
  for (const n of notes) {
    const k = `${Number(n.t).toFixed(6)}|${Number(n.dur).toFixed(6)}`;
    const list = groups.get(k);
    if (list) list.push(n);
    else groups.set(k, [n]);
  }

  const ordered = [...groups.values()].sort((a, b) => {
    const dt = Number(a[0]!.t) - Number(b[0]!.t);
    if (Math.abs(dt) > EPS) return dt;
    // At one onset, the longest note first: it is the one that will still be
    // sounding, so it should claim the lower voice and hold it.
    return Number(b[0]!.dur) - Number(a[0]!.dur);
  });

  const freeAt: number[] = [];
  for (const group of ordered) {
    const start = Number(group[0]!.t);
    const end = start + Number(group[0]!.dur);
    let v = freeAt.findIndex((busyUntil) => busyUntil <= start + EPS);
    if (v < 0) { v = freeAt.length; freeAt.push(0); }
    freeAt[v] = end;
    // Lowest note first within the stack, so <chord/> attaches upward from it.
    const stack = group.slice().sort((a, b) => Number(a.midi ?? 0) - Number(b.midi ?? 0));
    stack.forEach((n, i) => {
      n.voice = v + 1;
      if (i > 0) n.chord = true;
      else delete n.chord;
    });
  }
  return freeAt.length;
}

/**
 * Divide every part as far as its music requires. Returns the deepest division
 * each part needed, keyed by part id — the staffing a player has to be told
 * about, since two lines on one stave means two desks, not a double stop.
 */
export function applyDivisi(parts: PartLike[]): Map<string, number> {
  const depth = new Map<string, number>();
  for (const part of parts) {
    let deepest = 0;
    for (const measure of part?.measures ?? []) {
      deepest = Math.max(deepest, separateMeasure((measure?.events ?? []) as EventLike[]));
    }
    depth.set(String(part?.part_id ?? ""), deepest);
  }
  return depth;
}

/**
 * The inverse, for an ensemble where each part is one player.
 *
 * A divided section reduces to a single line: the primary note of each stack
 * is kept and the divisi additions go, then anything still overlapping is
 * clipped where the next attack falls. Both steps are needed — a chord stack
 * and a second voice are equally unplayable by one flute, and the choral
 * fallback in the woodwind path was handing winds five-note stacks from the
 * string arranger's second violins long before divisi existed.
 *
 * Returns how many notes had to go, so a caller can say so rather than let it
 * pass silently.
 */
export function collapseToSinglePlayer(
  parts: PartLike[],
  /** Which note of a stack this player holds — the top of it, or the bottom. */
  keepFor: (part: PartLike, index: number) => "top" | "bottom" = () => "top"
): number {
  let dropped = 0;
  parts.forEach((part, index) => {
    const keep = keepFor(part, index);
    for (const measure of part?.measures ?? []) {
      const events = (measure?.events ?? []) as EventLike[];
      const notes = events.filter((e: any) => e?.type === "note" && Number.isFinite(Number(e?.t)));
      const others = events.filter((e: any) => e?.type !== "note");

      // One note per moment. A stack is divisi however it is written — an
      // explicit <chord/>, a second voice, or (as the choral path emits them)
      // simply several notes sharing an onset with no marking at all. All
      // three are equally unplayable by one player, so the rule is by onset
      // rather than by how the stack happens to be encoded.
      const byOnset = new Map<string, EventLike[]>();
      for (const n of notes) {
        const k = Number(n.t).toFixed(6);
        const list = byOnset.get(k);
        if (list) list.push(n);
        else byOnset.set(k, [n]);
      }
      const line: EventLike[] = [];
      for (const stack of byOnset.values()) {
        const midiOf = (e: any) => Number(e?.midi ?? Number.NaN);
        const sorted = stack.slice().sort((a, b) => (midiOf(a) || 0) - (midiOf(b) || 0));
        const chosen = keep === "bottom" ? sorted[0]! : sorted[sorted.length - 1]!;
        dropped += stack.length - 1;
        delete chosen.chord;
        chosen.voice = 1;
        line.push(chosen);
      }
      line.sort((a, b) => Number(a.t) - Number(b.t));

      // One line, so a held note releases where the next attack falls.
      for (let i = 0; i < line.length - 1; i++) {
        const room = Number(line[i + 1]!.t) - Number(line[i]!.t);
        if (room > EPS && Number(line[i]!.dur) > room + EPS) line[i]!.dur = room;
      }
      measure.events = [...others, ...line];
    }
  });
  return dropped;
}

/**
 * The staffing line for the front of a score: how many players each section
 * needs at its busiest. A reader who is not told this will try to play the
 * stack as a multiple stop.
 */
export function staffingNote(parts: PartLike[], depth: Map<string, number>): string {
  const divided = parts
    .map((p) => ({ name: String(p?.name ?? p?.part_id ?? ""), n: depth.get(String(p?.part_id ?? "")) ?? 1 }))
    .filter((x) => x.n > 1);
  if (!divided.length) return "";
  return `Divisi: ${divided.map((x) => `${x.n} ${x.name}`).join(", ")}. ` +
    "Stacked notes are divided between players, not multiple stops.";
}
