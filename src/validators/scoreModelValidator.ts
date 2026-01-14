import type { ScoreModel } from "../score/types";

type Issue = {
  severity: "error" | "warning";
  type: string;
  message: string;
  location?: {
    part_id?: string;
    measure?: number;
    t?: number;
    event_id?: string;
    top_event_id?: string;
    bot_event_id?: string;
    staff?: number;
    voice?: number;
  };
};

function pitchToMidi(step: string, alter: number | undefined, octave: number): number {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const s = step.toUpperCase();
  const semis = (base[s] ?? 0) + (alter ?? 0);
  return (octave + 1) * 12 + semis;
}

function intervalClass(semitones: number) {
  return Math.abs(semitones) % 12;
}

function isPerfect5th(semitones: number) {
  return intervalClass(semitones) === 7;
}

function isPerfect8ve(semitones: number) {
  return Math.abs(semitones) % 12 === 0;
}

function isPerfectUnison(semitones: number) {
  return Math.abs(semitones) === 0;
}

// Return highest RH note and lowest LH note at each onset t (outer voices)
function collectOuterVoiceTimeline(score: ScoreModel) {
  type Point = { measure: number; t: number; topMidi?: number; botMidi?: number; topId?: string; botId?: string };
  const timeline: Point[] = [];

  for (const part of score.parts) {
    for (const m of part.measures) {
      const byT: Record<number, { top?: { midi: number; id: string }; bot?: { midi: number; id: string } }> = {};

      for (const ev of m.events) {
        if (ev.type !== "note") continue;

        const midi = pitchToMidi(ev.pitch.step, ev.pitch.alter, ev.pitch.octave);
        const t = ev.t;

        if (!byT[t]) byT[t] = {};

        // RH staff=1: pick highest note at time t
        if (ev.staff === 1) {
          const cur = byT[t].top;
          if (!cur || midi > cur.midi) byT[t].top = { midi, id: ev.id };
        }

        // LH staff=2: pick lowest note at time t
        if (ev.staff === 2) {
          const cur = byT[t].bot;
          if (!cur || midi < cur.midi) byT[t].bot = { midi, id: ev.id };
        }
      }

      const times = Object.keys(byT).map(n => Number(n)).sort((a, b) => a - b);
      for (const t of times) {
        timeline.push({
          measure: m.number,
          t,
          topMidi: byT[t].top?.midi,
          botMidi: byT[t].bot?.midi,
          topId: byT[t].top?.id,
          botId: byT[t].bot?.id
        });
      }
    }
  }

  return timeline;
}

export function validateScoreModelPiano(score: ScoreModel) {
  const issues: Issue[] = [];

  // Piano safe-ish absolute range (can refine later)
  const PIANO_LOW = pitchToMidi("A", 0, 0); // A0
  const PIANO_HIGH = pitchToMidi("C", 0, 8); // C8

  for (const part of score.parts) {
    let staff1HasNotes = false;
    let staff2HasNotes = false;

    for (const m of part.measures) {
      for (const ev of m.events) {
        // duration sanity
        if (ev.dur <= 0) {
          issues.push({
            severity: "error",
            type: "zero_duration",
            message: `Event has non-positive duration.`,
            location: { part_id: part.part_id, measure: m.number, event_id: ev.id, staff: ev.staff, voice: ev.voice }
          });
        }

        // staff usage + range
        if (ev.type === "note") {
          if (ev.staff === 1) staff1HasNotes = true;
          if (ev.staff === 2) staff2HasNotes = true;

          const midi = pitchToMidi(ev.pitch.step, ev.pitch.alter, ev.pitch.octave);
          if (midi < PIANO_LOW || midi > PIANO_HIGH) {
            issues.push({
              severity: "error",
              type: "piano_range_violation",
              message: `Note ${ev.pitch.step}${ev.pitch.alter ?? ""}${ev.pitch.octave} is outside piano range.`,
              location: { part_id: part.part_id, measure: m.number, event_id: ev.id, staff: ev.staff, voice: ev.voice }
            });
          }
        }

        // clef/staff hint (basic)
        if (ev.type === "note" && ev.staff !== 1 && ev.staff !== 2) {
          issues.push({
            severity: "warning",
            type: "unexpected_staff_number",
            message: `Note is on staff ${ev.staff}; piano should use staff 1 or 2.`,
            location: { part_id: part.part_id, measure: m.number, event_id: ev.id, staff: ev.staff, voice: ev.voice }
          });
        }
      }
    }

    // empty staff detection
    if (!staff1HasNotes) {
      issues.push({
        severity: "warning",
        type: "empty_staff_1",
        message: `Piano staff 1 (treble) has no notes in this part.`,
        location: { part_id: part.part_id }
      });
    }
    if (!staff2HasNotes) {
      issues.push({
        severity: "warning",
        type: "empty_staff_2",
        message: `Piano staff 2 (bass) has no notes in this part.`,
        location: { part_id: part.part_id }
      });
    }
  }

  // --- Harmony / voice-leading checks (outer voices: RH top vs LH bottom) ---
  const outer = collectOuterVoiceTimeline(score);

  // spacing rule between hands (can refine by skill level later)
  const MAX_HAND_SPACING = 24; // semitones (2 octaves)

  for (let i = 0; i < outer.length; i++) {
    const cur = outer[i];
    if (cur.topMidi == null || cur.botMidi == null) continue;

    const spacing = cur.topMidi - cur.botMidi;

    // Hand crossing (LH above RH)
    if (spacing < 0) {
      issues.push({
        severity: "error",
        type: "hand_crossing",
        message: "Left hand is above right hand (outer voices crossed).",
        location: { measure: cur.measure, t: cur.t, event_id: cur.topId ?? cur.botId }
      });
    }

    // Excessive spacing
    if (spacing > MAX_HAND_SPACING) {
      issues.push({
        severity: "warning",
        type: "excessive_hand_spacing",
        message: `Hands are spaced very wide (${spacing} semitones).`,
        location: { measure: cur.measure, t: cur.t, event_id: cur.topId ?? cur.botId }
      });
    }

    // Need previous for voice-leading checks
    if (i === 0) continue;

    const prev = outer[i - 1];
    if (prev.topMidi == null || prev.botMidi == null) continue;

    const prevInt = prev.topMidi - prev.botMidi;
    const curInt = cur.topMidi - cur.botMidi;

    const prevPerf5 = isPerfect5th(prevInt);
    const curPerf5 = isPerfect5th(curInt);

    const prevOct = isPerfect8ve(prevInt) || isPerfectUnison(prevInt);
    const curOct = isPerfect8ve(curInt) || isPerfectUnison(curInt);

    const topMoved = cur.topMidi !== prev.topMidi;
    const botMoved = cur.botMidi !== prev.botMidi;

    // Similar motion detection (both move same direction)
    const topDir = Math.sign(cur.topMidi - prev.topMidi);
    const botDir = Math.sign(cur.botMidi - prev.botMidi);
    const similarMotion = topDir !== 0 && botDir !== 0 && topDir === botDir;

    // Parallel 5ths
    if (prevPerf5 && curPerf5 && topMoved && botMoved && similarMotion) {
      issues.push({
        severity: "error",
        type: "parallel_5ths_outer_voices",
        message: "Parallel perfect fifths between outer voices.",
        location: {
          measure: cur.measure,
          t: cur.t,
          top_event_id: cur.topId,
          bot_event_id: cur.botId
        }
      });
    }

    // Parallel octaves/unisons
    if (prevOct && curOct && topMoved && botMoved && similarMotion) {
      issues.push({
        severity: "error",
        type: "parallel_8ves_outer_voices",
        message: "Parallel octaves/unisons between outer voices.",
        location: {
          measure: cur.measure,
          t: cur.t,
          top_event_id: cur.topId,
          bot_event_id: cur.botId
        }
      });
    }

    // Direct/Hidden perfect intervals (outer voices)
    // Similar motion into P5 or P8 WITH soprano leap
    const isPerfect5 = isPerfect5th(curInt);
    const isPerfect8 = isPerfect8ve(curInt) || isPerfectUnison(curInt);

    // soprano leap: >= minor third
    const sopranoLeap = Math.abs(cur.topMidi - prev.topMidi) >= 3;

    if (similarMotion && sopranoLeap && (isPerfect5 || isPerfect8)) {
      issues.push({
        severity: "error",
        type: isPerfect8 ? "direct_8ves_outer_voices" : "direct_5ths_outer_voices",
        message: isPerfect8
          ? "Direct/hidden octaves between outer voices (similar motion into octave with soprano leap)."
          : "Direct/hidden fifths between outer voices (similar motion into fifth with soprano leap).",
        location: {
          measure: cur.measure,
          t: cur.t,
          top_event_id: cur.topId,
          bot_event_id: cur.botId
        }
      });
    }
  }

  return {
    ok: issues.filter(i => i.severity === "error").length === 0,
    issues
  };
}