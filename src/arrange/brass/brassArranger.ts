// src/arrange/brass/brassArranger.ts
//
// Brass ensemble arranger — same engine pattern as the woodwind arranger:
//   1. Run the string DP (block) or the polyphonic engine (contrapuntal).
//   2. Remap the string voices → brass instruments by explicit DP slot:
//        Trumpet 1 ← vln1   Trumpet 2 ← vln2   Horn ← vla
//        Trombone  ← vc     Tuba      ← cb
//      (Quartet drops the Horn; Tuba still maps to cb so it stays the bass.)
//   3. Octave-place each note into the instrument's sweet-spot register.
//   4. For the block path, apply a per-voice rhythm grid from the source.
//
// Concert pitch throughout; the MusicXML exporter writes the transposition
// (Trumpet +2, Horn +7; Trombone/Tuba concert bass clef).

import type { ScoreModel, NoteEvent } from "../../score/types";
import { arrangeStringEnsemble } from "../strings/stringArranger";
import { arrangeBrassPolyphonic } from "./polyphony/brassPolyphonicArranger";
import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";
import type { ProfileId, Slice, Voicing, VoiceId } from "../strings/types";
import { gateBrassParticipation, participationSentence } from "./participation";
import { expandBrassSection, expandSectionSentence } from "./expandSection";
import { shareBrassMelody, shareBrassMelodySentence } from "./shareMelody";
import { buildCandidatesForSlice } from "../strings/candidates";
import {
  BRASS_RANGES, BRASS_SWEET_SPOT, BRASS_TO_STRING_VOICE, BRASS_PART_META, BRASS_CHARACTER,
  BRASS_QUARTET_VOICES, BRASS_QUINTET_VOICES, type BrassVoiceId,
} from "./brassRanges";

type ChordEvent = { measure: number; t: number; symbol: string };
export type BrassActivity = "grounded" | "less_active" | "active" | "high_active";

function eventMidi(ev: any): number | null {
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}
function snapDur(d: number): number {
  const S = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25] as const;
  for (const s of S) if (s <= d + 1e-9) return s;
  return 0.25;
}
function pickChordAt(chords: ChordEvent[], measure: number, t: number): string | null {
  const evs = chords.filter((c) => Number(c.measure) === Number(measure));
  if (!evs.length) return null;
  let best: ChordEvent | null = null;
  for (const c of evs) if (Number(c.t) <= t) best = c;
  return best?.symbol ?? evs[0]?.symbol ?? null;
}
function clampToSweetSpot(midi: number, r: { absMin: number; absMax: number; prefMin: number; prefMax: number }): number {
  let m = midi;
  while (m < r.absMin) m += 12;
  while (m > r.absMax) m -= 12;
  const mid = (r.prefMin + r.prefMax) / 2;
  if (m < r.prefMin) { const up = m + 12; if (up <= r.absMax && Math.abs(up - mid) <= Math.abs(m - mid)) m = up; }
  if (m > r.prefMax) { const dn = m - 12; if (dn >= r.absMin && Math.abs(dn - mid) <= Math.abs(m - mid)) m = dn; }
  return m;
}
function activityToAgility(a: BrassActivity): number {
  return a === "grounded" ? 0.2 : a === "less_active" ? 0.6 : a === "active" ? 0.9 : 1.0;
}
function thinOnsets(times: number[], agility: number, measureLen: number, isMelody: boolean): number[] {
  if (isMelody || agility >= 0.8) return times;
  const step = agility < 0.5 ? measureLen / 2 : 1.0;
  const kept = times.filter((t) => Math.abs(t - Math.round(t / step) * step) < 1e-6);
  if (!kept.length || Math.abs(kept[0]! - 0) > 1e-6) kept.unshift(0);
  return Array.from(new Set(kept)).sort((a, b) => a - b);
}

// Map the string-DP score's voices onto brass instruments by explicit slot.
function remapStringToBrass(stringScore: ScoreModel, voices: BrassVoiceId[]): ScoreModel {
  const parts: any[] = (stringScore as any).parts ?? [];
  const bySlot: Record<string, any> = {};
  // String parts in canonical order vln1,vln2,vla,vc,cb
  const slotOrder = ["vln1", "vln2", "vla", "vc", "cb"];
  parts.slice(0, 5).forEach((p, i) => { bySlot[slotOrder[i]!] = p; });

  const brassParts = voices.map((bv) => {
    const slot = BRASS_TO_STRING_VOICE[bv];
    const src = bySlot[slot];
    const meta = BRASS_PART_META[bv];
    const range = BRASS_RANGES[bv];
    if (!src) return { ...meta, staves: 1, measures: [] };
    const measures = (src.measures ?? []).map((m: any) => ({
      ...m,
      events: (m.events ?? []).map((ev: any) => {
        if (ev.type !== "note" || !ev.pitch) return ev;
        const midi = eventMidi(ev);
        if (midi === null) return ev;
        const placed = clampToSweetSpot(midi, range);
        return placed === midi ? ev : { ...ev, pitch: midiToPitch(placed) };
      }),
    }));
    return { ...src, part_id: meta.part_id, name: meta.name, instrument: meta.instrument, staves: 1, measures };
  });

  return {
    ...(stringScore as any),
    parts: brassParts,
    meta: { ...(stringScore as any).meta, ensemble: "brass_ensemble" },
  } as any;
}

// Apply per-voice source rhythm to the brass voices (block path).
/**
 * How much of its slot each voice holds before letting go.
 *
 * Every part sounded 92-95% of every bar it played, because each note was given
 * the distance to the next onset and so butted against it. The reference
 * edition's parts are nothing like that, and nothing like each other either.
 *
 * These are its own densities, measured WITHIN the bars each instrument
 * actually plays — sounding share x total bars / playing bars, so the whole-bar
 * rests the participation gate already handles are not counted twice:
 *
 *   Horn        ~81%   sustained, breath-spaced support
 *   Tuba        ~70%   a half-time pulse in verses, eighth-and-rest in bridges
 *   Trombone    ~59%   short chord attacks, mostly on beats 2 and 4
 *   Trumpet 2   ~53%   brief responses
 *   Trumpet 1   ~92%   dense when it plays at all — it just plays rarely
 *
 * So the first trumpet needs no share at all: as the melody carrier it takes
 * the length the source wrote, which already comes to about 92%. Its entry here
 * only covers the bars where it is NOT leading.
 *
 * The wind arranger's rule does not port directly. There, one three-quarter
 * share fitted every accompanying voice and the sustained pad was the horn
 * (agility below 0.5, holding through to its next onset). Reading agility the
 * same way here would make the TUBA the pad, at 0.45 — and hold it at nearly
 * 100% when the reference's tuba is the most detached low voice but for the
 * trombone. A brass bass pulses; it does not drone.
 *
 * This matches density, not placement. The tuba's pulse on beats 1 and 3 and
 * the trombone's attacks on 2 and 4 are about WHERE the notes fall, which is
 * separate work (as `pulse.ts` is for the lower strings).
 *
 * And `snapDur` truncates to the next standard value DOWN, so a share does not
 * arrive as a percentage. The tuba sits on a half-measure grid, where 0.7 of a
 * two-beat slot is 1.4 and snaps to a quarter — which lands it at 50% sounding
 * rather than 70%, as two quarter notes on beats 1 and 3. That is the
 * reference's own verse idiom for the instrument, so it stays: raising the
 * share to 0.75 would snap to 1.5 instead and reach 75%, closer to the
 * reference's 66% average but as a dotted-quarter drone. The average is higher
 * than 50% because the reference varies the idiom by section, adding
 * eighth-and-rest attacks through the bridges — which is placement again, not
 * length. Matching the number here would cost the groove.
 */
const BRASS_HOLD: Record<BrassVoiceId, number> = {
  tpt1: 0.9,
  tpt2: 0.55,
  hn:   0.8,
  tbn:  0.6,
  tuba: 0.7,
};

function applyBrassRhythm(
  score: ScoreModel,
  sourcePart: any,
  chords: ChordEvent[],
  key: { fifths: number; mode: "major" | "minor" },
  activity: Partial<Record<BrassVoiceId, BrassActivity>>
): void {
  if (!sourcePart) return;
  const srcMeasures: any[] = sourcePart.measures ?? [];
  const nameToVoice: Record<string, BrassVoiceId> = {
    "trumpet 1": "tpt1", "trumpet 2": "tpt2", "horn in f": "hn", "trombone": "tbn", "tuba": "tuba",
  };
  for (const part of (score as any).parts ?? []) {
    const wv = nameToVoice[String(part?.name ?? "").toLowerCase().trim()];
    if (!wv) continue;
    const stringVoice = BRASS_TO_STRING_VOICE[wv];
    const range = BRASS_RANGES[wv];
    const eff = activity[wv] ? activityToAgility(activity[wv]!) : BRASS_CHARACTER[wv].agility;
    const isMelody = wv === "tpt1" && activity[wv] !== "grounded" && activity[wv] !== "less_active";
    let prevMidi: number | null = null;

    part.measures = (part.measures ?? []).map((m: any) => {
      const mnum = Number(m.number);
      const beats = Number(m.attributes?.time?.beats ?? 4);
      const beatType = Number(m.attributes?.time?.beat_type ?? 4);
      const measureLen = beats * (4 / beatType);

      const dpSchedule = new Map<number, number>();
      for (const ev of (m.events ?? [])) {
        if (ev.type !== "note" || ev.isRest) continue;
        const mm = eventMidi(ev); if (mm !== null) dpSchedule.set(Number(ev.t ?? 0), mm);
      }
      const dpAnchorAt = (t: number) => { let b: number | null = null; for (const [st, p] of dpSchedule) if (st <= t + 1e-9) b = p; return b; };

      const srcM = srcMeasures.find((pm: any) => Number(pm.number) === mnum);
      const onsetSet = new Set<number>();
      // How long the source holds each onset. Taking the distance to the next
      // one instead butts every note against the one after it, which is what
      // made all five parts sound 92-95% of every bar they played.
      const srcDur = new Map<number, number>();
      if (srcM) for (const ev of (srcM.events ?? [])) {
        if (ev.type !== "note") continue;
        const t = Number(ev.t ?? 0);
        if (t < 0 || t >= measureLen) continue;
        const key = Math.round(t * 1000) / 1000;
        onsetSet.add(key);
        const d = Number(ev.dur);
        // A chord sounds as one attack: take the longest of its notes.
        if (Number.isFinite(d) && d > 0) srcDur.set(key, Math.max(srcDur.get(key) ?? 0, d));
      }
      if (!onsetSet.size) for (let t = 0; t < measureLen; t += 1.0) onsetSet.add(Math.round(t * 1000) / 1000);

      // Quarter-note gap fill, so an ACCOMPANYING voice keeps the harmony
      // present while the melody rests. Not for the melody carrier: where the
      // tune rests, that rest is the tune.
      if (!isMelody) {
        const sorted = Array.from(onsetSet).sort((a, b) => a - b);
        const bounds = [...sorted, measureLen];
        for (let i = 0; i < bounds.length - 1; i++) {
          const gs = bounds[i]!, ge = bounds[i + 1]!;
          if (ge - gs > 1 + 1e-9) for (let ft = gs + 1; ft < ge - 1e-9; ft += 1) onsetSet.add(Math.round(ft * 1000) / 1000);
        }
      }

      const times = [...thinOnsets(Array.from(onsetSet).sort((a, b) => a - b), eff, measureLen, isMelody), measureLen];
      const events: NoteEvent[] = [];
      for (let i = 0; i < times.length - 1; i++) {
        const t = times[i]!, next = times[i + 1]!;
        const capDur = measureLen - t; if (capDur <= 0) continue;
        // The lead takes the length the source wrote, so its silence survives.
        // Everyone else takes their own share of the slot — see BRASS_HOLD.
        const own = isMelody ? srcDur.get(t) : undefined;
        const want = own !== undefined ? own : (next - t) * BRASS_HOLD[wv];
        const dur = snapDur(Math.min(capDur, next - t, want)); if (dur <= 0) continue;
        const slice: Slice = { measure: mnum, t, dur, melodyMidi: null, chordSymbol: pickChordAt(chords, mnum, t) };
        const prevVoicing: Voicing | null = prevMidi !== null
          ? { vln1: null, vln2: null, vla: null, vc: null, cb: null, [stringVoice]: prevMidi } as any : null;
        const cands = buildCandidatesForSlice({ slice, prevVoicing, keyFifths: key.fifths, keyMode: key.mode })[stringVoice as VoiceId];
        const anchor = dpAnchorAt(t) ?? prevMidi ?? Math.round((range.prefMin + range.prefMax) / 2);
        let midi: number | null = null;
        if (cands.length) midi = cands.reduce((b, c) => (Math.abs(c - anchor) < Math.abs(b - anchor) ? c : b));
        if (midi === null) {
          events.push({ id: `${wv}-r-${mnum}-${t}`, t, dur, type: "rest", voice: 1, staff: 1, isRest: true } as any);
        } else {
          midi = clampToSweetSpot(midi, range); prevMidi = midi;
          events.push({ id: `${wv}-n-${mnum}-${t}`, t, dur, type: "note", pitch: midiToPitch(midi), voice: 1, staff: 1 });
        }
      }
      return { ...m, events };
    });
  }
}

export type BrassArrangerOptions = {
  profile?: ProfileId;
  chords?: ChordEvent[];
  key?: { fifths: number; mode: "major" | "minor" };
  warnings?: string[];
  quintet?: boolean;          // true = with Horn (default); false = quartet (no Horn)
  /**
   * Eight-part orchestral brass section instead of the five-part quintet.
   *
   * Opt-IN, deliberately. Defaulting it on inside the arranger expanded every
   * caller that did not mention it — the sweep caught piano_with_brass growing
   * to eight players when the claim was that it stays a quintet. Five against a
   * piano is the point of that route. The brass_ensemble route passes this
   * explicitly, so the user-facing default is still a section.
   */
  section?: boolean;
  polyphonic?: boolean;       // contrapuntal path
  level?: string;
  activity?: Partial<Record<BrassVoiceId, BrassActivity>>;
  /**
   * Optional override for the rhythm-template part. When set (e.g. the frozen
   * piano part in piano_with_brass mode) it is used as the onset-time grid for
   * all voices instead of the auto-detected melody part. RH notes (staff=1 or
   * voice≤2) are filtered out automatically.
   */
  rhythmSourcePart?: any;
};

/**
 * Arrange a score as a brass quintet (Tpt1/Tpt2/Horn/Trombone/Tuba) or quartet.
 */


/**
 * Put each voice in the register the instrument is for.
 *
 * The brass inherit their pitches from the string voicing, so a low Violin I
 * gives a low first trumpet: ours ran 58 to 70 where a hand-written edition of
 * the same song has 74 to 79. Both are inside the trumpet, but only one is the
 * bright register a lead part is written in. The sweet spot has been recorded
 * in BRASS_CHARACTER since the file was written and nothing read it.
 *
 * The whole line moves by whole octaves, so every interval inside it survives
 * — this decides where the part sits, not what it plays. A shift is taken only
 * if it brings the line's median closer to the middle of the sweet spot AND
 * leaves every note inside the instrument.
 */
function centreOnSweetSpot(score: ScoreModel, voices: BrassVoiceId[]): number {
  let shifted = 0;
  for (const v of voices) {
    const part = ((score as any).parts ?? []).find((p: any) => p.part_id === BRASS_PART_META[v].part_id);
    if (!part) continue;
    const notes = (part.measures ?? []).flatMap((m: any) =>
      (m.events ?? []).filter((e: any) => e?.type === "note"));
    const midis = notes.map((e: any) => eventMidi(e)).filter((x: any): x is number => x !== null);
    if (midis.length < 4) continue;

    const sorted = [...midis].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const spot = BRASS_SWEET_SPOT[v];
    const centre = (spot.lo + spot.hi) / 2;
    const range = BRASS_RANGES[v];

    let best = 0;
    let bestGap = Math.abs(median - centre);
    for (const oct of [-24, -12, 12, 24]) {
      if (Math.min(...midis) + oct < range.absMin || Math.max(...midis) + oct > range.absMax) continue;
      const gap = Math.abs(median + oct - centre);
      if (gap < bestGap - 1e-9) { bestGap = gap; best = oct; }
    }
    if (!best) continue;

    for (const e of notes) {
      const m = eventMidi(e);
      if (m === null) continue;
      e.midi = m + best;
      e.pitch = midiToPitch(m + best);
      shifted++;
    }
  }
  return shifted;
}

/**
 * Put the section back in order.
 *
 * Trumpet 2 was sounding ABOVE Trumpet 1 in every bar of the piece, and the
 * Horn above both. Each brass part is scored independently here — one voice at
 * a time, nearest its own anchor, clamped to its own range — so nothing ever
 * compared them against each other, and the crossing in the underlying string
 * voicing (Violin II above Violin I in two bars out of three) came through
 * untouched.
 *
 * A second trumpet playing over the first is not a stylistic choice, it is a
 * mistake a section would query on sight. So at every onset the voices are
 * walked top down and any that sits above the one over it drops by octaves
 * until it does not — never below its own floor, and nothing moves if the
 * order is already right.
 *
 * The deeper fault is in the shared string DP, which crosses its violins
 * despite a crossing penalty. Fixing it there reaches strings, winds, brass
 * and both orchestras at once and is a separate piece of work; this keeps the
 * brass readable in the meantime.
 */
function uncrossBrassSection(score: ScoreModel, voices: BrassVoiceId[]): number {
  const parts = voices
    .map((v) => ({ v, part: ((score as any).parts ?? []).find((p: any) => p.part_id === BRASS_PART_META[v].part_id) }))
    .filter((x) => x.part);
  if (parts.length < 2) return 0;
  const bars = Math.max(0, ...parts.map((x) => (x.part.measures ?? []).length));
  let moved = 0;

  for (let mi = 0; mi < bars; mi++) {
    // Every onset at which anyone sounds in this bar.
    const onsets = new Set<number>();
    for (const { part } of parts) {
      for (const ev of (part.measures?.[mi]?.events ?? [])) {
        if (ev?.type === "note") onsets.add(Math.round(Number(ev.t) * 1000) / 1000);
      }
    }
    for (const t of [...onsets].sort((a, b) => a - b)) {
      let ceiling: number | null = null;
      for (const { v, part } of parts) {
        const ev = (part.measures?.[mi]?.events ?? []).find(
          (e: any) => e?.type === "note" && Math.abs(Number(e.t) - t) < 1e-6
        );
        if (!ev) continue;
        let midi = eventMidi(ev);
        if (midi === null) { ceiling = ceiling; continue; }
        if (ceiling !== null && midi > ceiling) {
          // Drop only as far as the voice's PREFERRED floor, not its absolute
          // one. Using absMin put the horn at 46 — inside the instrument, well
          // below where a horn lives, and a section reordered into its own
          // cellar is not an improvement on a section out of order. If it
          // cannot get under the voice above without leaving its register, it
          // stays where it is and the crossing stands.
          const floor = BRASS_RANGES[v].prefMin;
          while (midi > ceiling && midi - 12 >= floor) midi -= 12;
          if (midi !== eventMidi(ev)) {
            ev.midi = midi;
            ev.pitch = midiToPitch(midi);
            moved++;
          }
        }
        ceiling = midi;
      }
    }
  }
  return moved;
}

export function arrangeBrassEnsemble(
  score: ScoreModel,
  chords: ChordEvent[],
  options: BrassArrangerOptions = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const profile = options.profile ?? "melody_harmony";
  const quintet = options.quintet ?? true; // brass quintet is the standard ensemble
  const voices = quintet ? BRASS_QUINTET_VOICES : BRASS_QUARTET_VOICES;
  const key = options.key ?? { fifths: 0, mode: "major" as const };

  // Contrapuntal → polyphonic engine, keep independent rhythms (no flattening).
  if (options.polyphonic) {
    const poly = arrangeBrassPolyphonic(score, chords, { level: options.level });
    warnings.push(...(poly.warnings ?? []));
    return { scoreModel: remapStringToBrass(poly.scoreModel as ScoreModel, voices), warnings };
  }

  // Block path: string DP → remap → per-voice source rhythm.
  const sr = arrangeStringEnsemble(score, chords, { profile });
  warnings.push(...(sr.warnings ?? []));
  const brassScore = remapStringToBrass(sr.scoreModel as ScoreModel, voices);

  // Rhythm-template part: an explicit override (e.g. the frozen piano part in
  // piano_with_brass) filtered to RH onsets, else the auto-detected melody.
  let melodyPart: any = options.rhythmSourcePart ?? null;
  if (!melodyPart) {
    melodyPart = (score.parts ?? []).find((p: any) => {
      const n = String(p?.name ?? "").toLowerCase();
      return n.includes("soprano") || n.includes("melody") || n.includes("voice");
    }) ?? score.parts?.[0] ?? null;
  } else {
    const rhMeasures: any[] = (melodyPart.measures ?? []).map((m: any) => ({
      ...m,
      events: (m.events ?? []).filter((ev: any) => {
        if (ev.type !== "note") return false;
        const staff = Number(ev.staff ?? 1);
        const voice = Number(ev.voice ?? 1);
        return staff === 1 || voice <= 2; // right hand only
      }),
    }));
    melodyPart = { ...melodyPart, measures: rhMeasures };
  }

  if (melodyPart && chords.length) {
    applyBrassRhythm(brassScore, melodyPart, chords, key, options.activity ?? {});

    // Hand the tune round first: who is leading decides who may sit out.
    const shared = shareBrassMelody((brassScore as any).parts ?? []);
    const shareLine = shareBrassMelodySentence(shared.plans);
    if (shareLine) warnings.push(shareLine);

    // Then who plays this bar, decided before the register and ordering passes
    // so they only work on notes that survive and their counts stay honest.
    const gated = gateBrassParticipation(
      (brassScore as any).parts ?? [], melodyPart, shared.leadByBar
    );
    const line = participationSentence(gated);
    if (line) warnings.push(line);
  }

  // Register first, then order: moving a whole line by an octave would undo
  // any tidying done before it.
  const centred = centreOnSweetSpot(brassScore, voices);
  if (centred) {
    warnings.push(
      `[brass] ${centred} note(s) moved by octave into the instrument's own register — ` +
      "the voicing came from the strings and sat below where brass is written."
    );
  }

  const uncrossed = uncrossBrassSection(brassScore, voices);
  if (uncrossed) {
    warnings.push(
      `[brass] ${uncrossed} note(s) dropped an octave to keep the section in order — ` +
      "a second trumpet does not play above the first."
    );
  }

  // Eight players rather than five, when the route asks for a section.
  //
  // LAST, after the register and ordering passes. Running it before them put
  // Horn 2 above Horn 1 in 37 of 377 comparisons: uncrossBrassSection knows
  // only the five voices the DP writes, so it shifted Horn 1 by an octave and
  // left the derived part where it was. Deriving from the final lines instead
  // makes the ordering true by construction — each new voice takes a chord tone
  // below the donor it will actually sit under.
  if (options.section === true) {
    const added = expandBrassSection(brassScore as any);
    const line = expandSectionSentence(added);
    if (line) warnings.push(line);
  }

  return { scoreModel: brassScore, warnings };
}
