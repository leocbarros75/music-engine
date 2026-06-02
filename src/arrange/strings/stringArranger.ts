import type { NoteEvent, ScoreModel } from "../../score/types";
import type { Slice, StringArrangerOptions, StringArrangerResult, StringEnsembleArrangement, VoiceId, Voicing } from "./types";
import { buildCandidatesForSlice, buildVoicingStates } from "./candidates";
import { runDp } from "./dp";
import { STRING_RANGES } from "./ranges";
import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";

type ChordEvent = { measure: number; t: number; symbol: string };

const VOICES: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function isNoteOrRest(ev: any): boolean {
  return ev && (ev.type === "note" || ev.type === "rest");
}

function eventMidi(ev: any): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) {
    try {
      return pitchToMidi(ev.pitch);
    } catch {
      return null;
    }
  }
  return null;
}

function clampMidiToRangeByOctave(midi: number, range: { absMin: number; absMax: number }): number {
  let out = midi;
  while (out < range.absMin) out += 12;
  while (out > range.absMax) out -= 12;
  return out;
}

function getKeyInfo(score: ScoreModel): { fifths: number; mode: "major" | "minor" } {
  const first = score.parts?.[0]?.measures?.[0]?.attributes;
  const fifths = typeof first?.key_fifths === "number" ? first.key_fifths : 0;
  const mode = String(first?.key_mode ?? "major").toLowerCase() === "minor" ? "minor" : "major";
  return { fifths, mode };
}

function measureLengthBeats(measure: any): number {
  const beats = Number(measure?.attributes?.time?.beats ?? 4);
  const beatType = Number(measure?.attributes?.time?.beat_type ?? 4);
  return beats * (4 / beatType);
}

function findMelodyPart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes("soprano") || n.includes("melody") || n.includes("voice")) return p;
  }
  return parts[0] ?? null;
}

function pickChordForTime(chords: ChordEvent[], measure: number, t: number): string | null {
  const events = chords.filter((c) => Number(c.measure) === Number(measure));
  if (!events.length) return null;
  let best: ChordEvent | null = null;
  for (const c of events) {
    if (Number(c.t) <= t) best = c;
  }
  return best?.symbol ?? events[0]?.symbol ?? null;
}

/**
 * Snap a duration (in beats) DOWN to the nearest standard note value so the
 * exporter can always assign a valid <type> element.  Non-standard values such
 * as 3.25 (dotted-half + 16th) or 1.25 (quarter + 16th) produce a <duration>
 * with no matching <type>, which causes MuseScore to add an implicit rest and
 * report an "Incomplete measure: Found 17/16" error.
 *
 * Standard values at a 16th-note grid (sorted descending):
 *   whole=4.0, dotted-half=3.0, half=2.0, dotted-quarter=1.5,
 *   quarter=1.0, dotted-eighth=0.75, eighth=0.5, 16th=0.25
 */
const STANDARD_BEAT_DURATIONS = [4.0, 3.0, 2.0, 1.5, 1.0, 0.75, 0.5, 0.25] as const;

function snapToStandardDuration(dur: number): number {
  for (const s of STANDARD_BEAT_DURATIONS) {
    if (s <= dur + 1e-9) return s;
  }
  return 0.25; // minimum floor
}

function buildSlices(melodyPart: any, chords: ChordEvent[]): Slice[] {
  const slices: Slice[] = [];
  const measures = melodyPart?.measures ?? [];
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    const mNum = Number(m?.number) || i + 1;
    const measureLen = measureLengthBeats(m);
    const melEvents = (m?.events ?? []).filter(isNoteOrRest).sort((a: any, b: any) => Number(a.t) - Number(b.t));
    const times = new Set<number>();
    // Only add time points within the measure — values beyond measureLen would
    // create extra slices after the barline, producing "17/16" MuseScore errors.
    for (const ev of melEvents) {
      const et = Number(ev.t ?? 0);
      if (et >= 0 && et <= measureLen) times.add(et);
    }
    for (const c of chords) {
      if (Number(c.measure) === mNum) {
        const ct = Number(c.t);
        // Strict < measureLen: a chord landing exactly on the barline belongs
        // to the next measure and must not be added to this one's grid.
        if (ct >= 0 && ct < measureLen) times.add(ct);
      }
    }
    times.add(0);
    times.add(measureLen);
    // Re-filter after the forced adds to keep the set clean, then sort.
    const ordered = Array.from(times).filter(t => t >= 0 && t <= measureLen).sort((a, b) => a - b);
    for (let tIdx = 0; tIdx < ordered.length - 1; tIdx++) {
      const t = ordered[tIdx]!;
      const next = ordered[tIdx + 1]!;
      // Cap at (measureLen - t) so the minimum-duration floor can never push
      // a note past the barline (e.g. last 16th-grid slot → 0.125 raw →
      // Math.max(0.25, 0.125) = 0.25 would overflow by 0.125 beats).
      const capDur = measureLen - t;
      if (capDur <= 0) continue;
      // Snap to a standard rhythmic value so the exporter can always write a
      // valid <type> element.  Non-standard values (e.g. 3.25 beats = 13
      // divisions) produce type-less notes that MuseScore misinterprets as
      // whole notes and then adds a ghost rest → "Found 17/16" error.
      const rawDur = Math.min(capDur, Math.max(0.25, next - t));
      const dur = snapToStandardDuration(rawDur);
      const active = melEvents.find((e: any) => e.type === "note" && Number(e.t) <= t && t < Number(e.t) + Number(e.dur));
      const melodyMidi = active ? eventMidi(active) : null;
      slices.push({
        measure: mNum,
        t,
        dur,
        melodyMidi: melodyMidi === null ? null : melodyMidi,
        chordSymbol: pickChordForTime(chords, mNum, t)
      });
    }
  }
  return slices;
}

function makeEventsFromVoicing(
  slices: Slice[],
  voicings: Voicing[],
  voice: VoiceId
): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    let midi = voicings[i]?.[voice] ?? null;
    if (midi === null) {
      out.push({
        id: `${voice}-${slice.measure}-${slice.t}`,
        t: slice.t,
        dur: slice.dur,
        type: "rest",
        voice: 1,
        staff: 1,
        isRest: true
      });
      continue;
    }
    const range = STRING_RANGES[voice];
    midi = clampMidiToRangeByOctave(midi, range);
    out.push({
      id: `${voice}-${slice.measure}-${slice.t}`,
      t: slice.t,
      dur: slice.dur,
      type: "note",
      pitch: midiToPitch(midi),
      voice: 1,
      staff: 1
    });
  }
  return out;
}

function groupEventsByMeasure(events: NoteEvent[], template: any[]): any[] {
  const byMeasure: Record<number, NoteEvent[]> = {};
  for (const ev of events) {
    const m = Number(ev.id.split("-")[1]) || 1;
    if (!byMeasure[m]) byMeasure[m] = [];
    byMeasure[m].push(ev);
  }
  return template.map((m) => ({
    number: m.number,
    attributes: m.attributes ? clone(m.attributes) : undefined,
    events: (byMeasure[m.number] ?? []).sort((a, b) => a.t - b.t)
  }));
}

function buildPart(
  template: any[],
  voiceEvents: NoteEvent[],
  part_id: string,
  name: string,
  instrument: string
): any {
  return {
    part_id,
    name,
    instrument,
    staves: 1,
    measures: groupEventsByMeasure(voiceEvents, template)
  };
}

export function arrangeStringEnsemble(
  score: ScoreModel,
  chords: ChordEvent[],
  options: StringArrangerOptions = {}
): StringArrangerResult {
  const warnings: string[] = [];
  const melodyPart = findMelodyPart(score);
  if (!melodyPart) {
    warnings.push("[strings] Missing melody part; returning original score.");
    return { scoreModel: score, arrangement: { parts: { vln1: [], vln2: [], vla: [], vc: [], cb: [] } }, warnings };
  }

  const slices = buildSlices(melodyPart, chords);
  const key = getKeyInfo(score);

  const profile = options.profile ?? "melody_harmony";
  const candidatesBySlice: Voicing[][] = [];
  let prevVoicing: Voicing | null = null;
  for (const slice of slices) {
    const candidateMap = buildCandidatesForSlice({ slice, prevVoicing, keyFifths: key.fifths, keyMode: key.mode, profileId: profile });
    const voicings = buildVoicingStates(candidateMap);
    candidatesBySlice.push(voicings);
    prevVoicing = voicings[0] ?? null;
  }

  const dpResult = runDp({ slices, candidatesBySlice, profileId: profile });
  const bestStates = dpResult.best;
  const bestVoicings = bestStates.map((s) => s.voicing);

  const vln1 = makeEventsFromVoicing(slices, bestVoicings, "vln1");
  const vln2 = makeEventsFromVoicing(slices, bestVoicings, "vln2");
  const vla = makeEventsFromVoicing(slices, bestVoicings, "vla");
  const vc = makeEventsFromVoicing(slices, bestVoicings, "vc");
  const cb = makeEventsFromVoicing(slices, bestVoicings, "cb");

  const measuresTemplate = (melodyPart.measures ?? []).map((m: any) => ({
    number: m.number,
    attributes: m.attributes ? clone(m.attributes) : undefined
  }));

  const parts = [
    buildPart(measuresTemplate, vln1, "P_V1", "Violin I", "violin_1"),
    buildPart(measuresTemplate, vln2, "P_V2", "Violin II", "violin_2"),
    buildPart(measuresTemplate, vla, "P_VA", "Viola", "viola"),
    buildPart(measuresTemplate, vc, "P_VC", "Cello", "cello"),
    buildPart(measuresTemplate, cb, "P_DB", "Double Bass", "double_bass")
  ];

  // melody_pizzicato: Vln I arco; all others pizzicato
  const baseArticulations: StringEnsembleArrangement["articulations"] = [{ measure: 1, t: 0, type: "legato" }];
  const pizzicatoMeta = profile === "melody_pizzicato"
    ? { pizzicato_voices: ["vln2", "vla", "vc", "cb"] as const }
    : undefined;

  const arrangement: StringEnsembleArrangement = {
    parts: { vln1, vln2, vla, vc, cb },
    dynamics: [{ measure: 1, value: profile === "cello_melody" ? "mp" : "mf" }],
    articulations: baseArticulations,
    phrasing: [{ startMeasure: 1, endMeasure: measuresTemplate.length }],
    debug: {
      transitionPenalties: dpResult.penalties,
      ...(pizzicatoMeta as any)
    }
  };

  const scoreModel: ScoreModel = {
    ...(score as any),
    meta: { ...(score as any).meta, ensemble: "string_ensemble" },
    parts
  };

  return { scoreModel, arrangement, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Piano-bass rhythm overlay for Cello + Double Bass
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Post-process the Cello and Double Bass parts of an already-arranged
 * stringScore so that their note onsets match the piano source's left-hand
 * rhythm.  Pitches are re-chosen from chord tones (root / bass-note preferred
 * for CB, full chord set for VC) so harmony is always respected.
 *
 * @param stringScore   Output of arrangeStringEnsemble — modified in place.
 * @param pianoPart     The frozen piano part (deep-clone of the uploaded score).
 * @param chords        Chord events driving the harmony.
 * @param key           Detected key (fifths + mode).
 */
export function applyPianoBassRhythm(
  stringScore: ScoreModel,
  pianoPart: any,
  chords: ChordEvent[],
  key: { fifths: number; mode: "major" | "minor" }
): void {
  if (!pianoPart) return;

  const parts: any[] = (stringScore as any).parts ?? [];
  const vcPart = parts.find((p: any) => {
    const n = String(p?.name ?? "").toLowerCase();
    return n.includes("cello") || n.includes("violoncello");
  });
  const cbPart = parts.find((p: any) => {
    const n = String(p?.name ?? "").toLowerCase();
    return n.includes("double bass") || n.includes("double_bass") || n.includes("contrabass");
  });

  if (!vcPart && !cbPart) return;

  const pianoMeasures: any[] = pianoPart.measures ?? [];

  for (const part of [vcPart, cbPart]) {
    if (!part) continue;
    const n = String(part?.name ?? "").toLowerCase();
    const voiceId: VoiceId = n.includes("bass") || n.includes("contrabass") ? "cb" : "vc";
    const range = STRING_RANGES[voiceId];

    // Persist the previous MIDI so voice-leading stays smooth across measures.
    let prevMidi: number | null = null;

    part.measures = (part.measures ?? []).map((m: any) => {
      const mnum = Number(m.number);
      const attrs = m.attributes ?? {};
      const beats    = Number(attrs?.time?.beats    ?? 4);
      const beatType = Number(attrs?.time?.beat_type ?? 4);
      const measureLen = beats * (4 / beatType);

      // ── 1. Collect left-hand onset times from the piano source ───────────
      // "Left hand" = staff 2 OR voice 3/4 (covers both parser conventions).
      const pianoM = pianoMeasures.find((pm: any) => Number(pm.number) === mnum);
      const seenT = new Set<number>();
      if (pianoM) {
        for (const ev of (pianoM.events ?? [])) {
          if (ev.type !== "note") continue;
          const staff = Number(ev.staff ?? 1);
          const voice = Number(ev.voice ?? 1);
          if (staff === 2 || voice >= 3) {
            const t = Number(ev.t ?? 0);
            if (t >= 0 && t < measureLen) seenT.add(t);
          }
        }
      }

      // Fall back to quarter-note grid when piano has no left-hand data.
      if (!seenT.size) {
        for (let t = 0; t < measureLen; t += 1.0) seenT.add(t);
      }

      const times = Array.from(seenT).sort((a, b) => a - b);
      times.push(measureLen); // sentinel barline

      // ── 2. Build note events at those onset times with chord-tone pitches ─
      const events: NoteEvent[] = [];
      for (let i = 0; i < times.length - 1; i++) {
        const t     = times[i]!;
        const next  = times[i + 1]!;
        const capDur = measureLen - t;
        if (capDur <= 0) continue;
        const rawDur = Math.min(capDur, next - t);
        const dur    = snapToStandardDuration(rawDur);
        if (dur <= 0) continue;

        const slice: Slice = {
          measure: mnum,
          t,
          dur,
          melodyMidi: null,
          chordSymbol: pickChordForTime(chords, mnum, t)
        };

        // Reuse the existing candidate machinery — respects chord tones,
        // prefers root/bass-note for CB, stays close to previous pitch.
        const prevVoicing: Voicing | null = prevMidi !== null
          ? { vln1: null, vln2: null, vla: null, vc: null, cb: null, [voiceId]: prevMidi } as any
          : null;

        const candidateMap = buildCandidatesForSlice({
          slice,
          prevVoicing,
          keyFifths: key.fifths,
          keyMode:   key.mode
        });
        const candidates = candidateMap[voiceId];
        const midi = candidates.length ? candidates[0]! : null;

        if (midi === null) {
          events.push({
            id:     `${voiceId}-bass-${mnum}-${t}`,
            t, dur,
            type:   "rest",
            voice:  1,
            staff:  1,
            isRest: true
          } as any);
        } else {
          const clamped = clampMidiToRangeByOctave(midi, range);
          prevMidi = clamped;
          events.push({
            id:    `${voiceId}-bass-${mnum}-${t}`,
            t, dur,
            type:  "note",
            pitch: midiToPitch(clamped),
            voice: 1,
            staff: 1
          });
        }
      }

      return { ...m, events };
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Piano-RH rhythm overlay for Violin I, Violin II, and Viola
// ─────────────────────────────────────────────────────────────────────────────

/** Maps a lowercase part name to its string voice ID. */
function partNameToVoiceId(n: string): VoiceId | null {
  // Use exact/prefix matching to avoid "violin i" matching "violin ii".
  if (n === "violin i" || n === "violin 1" || n === "vln i" || n === "vln1" ||
      n.startsWith("violin i ") || n.startsWith("violin 1 ")) return "vln1";
  if (n === "violin ii" || n === "violin 2" || n === "vln ii" || n === "vln2" ||
      n.startsWith("violin ii ") || n.startsWith("violin 2 ")) return "vln2";
  if (n === "viola" || n === "vla" || n.startsWith("viola ") || n.startsWith("vla ")) return "vla";
  return null;
}

/**
 * Post-process Violin I, Violin II, and Viola so all three follow the piano's
 * RIGHT-HAND rhythm at the same density.
 *
 * Strategy — "melody-guided chord-tone" for each voice:
 * 1. Build onset-time → highest RH MIDI pitch map per measure (melody contour).
 * 2. For each onset, transpose the piano melody pitch into the voice's range,
 *    then pick the chord-tone candidate NEAREST to that transposed target.
 * 3. Fallback: nearest chord tone to the previous note (smooth voice-leading).
 *
 * All three voices use the SAME onset-time grid (piano RH) so they are
 * rhythmically identical.  Each independently lands on the chord tone closest
 * to the melody in its own register, producing natural voice spread.
 */
export function applyPianoMelodyRhythm(
  stringScore: ScoreModel,
  pianoPart: any,
  chords: ChordEvent[],
  key: { fifths: number; mode: "major" | "minor" }
): void {
  if (!pianoPart) return;

  const parts: any[] = (stringScore as any).parts ?? [];
  const pianoMeasures: any[] = pianoPart.measures ?? [];

  // Process each upper-string part that we can identify by name.
  for (const part of parts) {
    const n = String(part?.name ?? "").toLowerCase().trim();
    const voiceId = partNameToVoiceId(n);
    if (!voiceId) continue; // skip Cello, Bass, or unrecognised parts
    if (voiceId === "vc" || voiceId === "cb") continue; // handled by applyPianoBassRhythm

    const range = STRING_RANGES[voiceId];
    let prevMidi: number | null = null;

    part.measures = (part.measures ?? []).map((m: any) => {
      const mnum = Number(m.number);
      const attrs = m.attributes ?? {};
      const beats    = Number(attrs?.time?.beats    ?? 4);
      const beatType = Number(attrs?.time?.beat_type ?? 4);
      const measureLen = beats * (4 / beatType);

      const pianoM = pianoMeasures.find((pm: any) => Number(pm.number) === mnum);

      // onset-time → highest piano-RH MIDI pitch (melody contour guide).
      const onsetPitch = new Map<number, number>();
      if (pianoM) {
        for (const ev of (pianoM.events ?? [])) {
          if (ev.type !== "note") continue;
          const staff = Number(ev.staff ?? 1);
          const voice = Number(ev.voice ?? 1);
          if (staff !== 1 && voice > 2) continue; // right hand only
          const t = Number(ev.t ?? 0);
          if (t < 0 || t >= measureLen) continue;
          const midi = eventMidi(ev);
          if (midi === null) continue;
          const cur = onsetPitch.get(t);
          if (cur === undefined || midi > cur) onsetPitch.set(t, midi);
        }
      }
      if (!onsetPitch.size) {
        for (let t = 0; t < measureLen; t += 1.0) onsetPitch.set(t, -1);
      }

      const times = Array.from(onsetPitch.keys()).sort((a, b) => a - b);
      times.push(measureLen);

      const events: NoteEvent[] = [];

      for (let i = 0; i < times.length - 1; i++) {
        const t     = times[i]!;
        const next  = times[i + 1]!;
        const capDur = measureLen - t;
        if (capDur <= 0) continue;
        const dur = snapToStandardDuration(Math.min(capDur, next - t));
        if (dur <= 0) continue;

        const slice: Slice = {
          measure: mnum, t, dur,
          melodyMidi: null,
          chordSymbol: pickChordForTime(chords, mnum, t)
        };
        const prevVoicing: Voicing | null = prevMidi !== null
          ? { vln1: null, vln2: null, vla: null, vc: null, cb: null, [voiceId]: prevMidi } as any
          : null;
        const candidateMap = buildCandidatesForSlice({
          slice, prevVoicing, keyFifths: key.fifths, keyMode: key.mode
        });
        const cands = candidateMap[voiceId];

        // Pick chord tone nearest to the piano melody target in this voice's range.
        const rawMidi = onsetPitch.get(t) ?? -1;
        const target = rawMidi > 0
          ? clampMidiToRangeByOctave(rawMidi, range)
          : (prevMidi ?? Math.round((range.prefMin + range.prefMax) / 2));

        let midi: number | null = null;
        if (cands.length) {
          midi = cands.reduce((best, c) =>
            Math.abs(c - target) < Math.abs(best - target) ? c : best
          );
        }

        if (midi === null) {
          events.push({ id: `${voiceId}-rh-${mnum}-${t}`, t, dur, type: "rest", voice: 1, staff: 1, isRest: true } as any);
        } else {
          prevMidi = midi;
          events.push({ id: `${voiceId}-rh-${mnum}-${t}`, t, dur, type: "note", pitch: midiToPitch(midi), voice: 1, staff: 1 });
        }
      }

      return { ...m, events };
    });
  }
}
