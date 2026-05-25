import { XMLParser } from "fast-xml-parser";
import crypto from "crypto";
import type { ScoreModel, Part, Measure, NoteEvent, Pitch } from "./types";

function asArray<T>(x: T | T[] | undefined): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function musicxmlToScoreModel(xml: string): ScoreModel {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true
  });

  const doc = parser.parse(xml);
  const spw = doc["score-partwise"];
  if (!spw) {
    throw new Error("Not a score-partwise MusicXML document.");
  }

  // PART LIST map id -> name
  const partList = spw["part-list"];
  const scoreParts = asArray(partList?.["score-part"]);
  const partNameById: Record<string, string> = {};
  for (const p of scoreParts) {
    const id = p?.["@_id"];
    const nm = p?.["part-name"];
    if (id) partNameById[id] = typeof nm === "string" ? nm : (nm?.["#text"] ?? "Part");
  }

  const partsXml = asArray(spw["part"]);
  let globalDivisions = 480; // default fallback

  const parts: Part[] = partsXml.map((pXml: any) => {
    const part_id = pXml?.["@_id"] ?? "P1";
    const name = partNameById[part_id] ?? "Piano";
    const measuresXml = asArray(pXml["measure"]);

    let currentDivisions = globalDivisions;

    const measures: Measure[] = measuresXml.map((mXml: any) => {
      const number = Number(mXml?.["@_number"] ?? 1);
      const attributes = mXml["attributes"];

      // read divisions / key / time (if present)
      const div = attributes?.["divisions"] != null ? Number(attributes["divisions"]) : undefined;
      if (div && Number.isFinite(div)) currentDivisions = div;

      if (number === 1 && div && Number.isFinite(div)) globalDivisions = div;

      const keyFifths =
        attributes?.["key"]?.["fifths"] != null ? Number(attributes["key"]["fifths"]) : undefined;

      const beats =
        attributes?.["time"]?.["beats"] != null ? Number(attributes["time"]["beats"]) : undefined;

      const beatType =
        attributes?.["time"]?.["beat-type"] != null
          ? Number(attributes["time"]["beat-type"])
          : undefined;

      const notesXml = asArray(mXml["note"]);

// Per-voice time cursors — each MusicXML voice is an independent time stream.
// This correctly handles <backup>/<forward> implicit resets: when Dorico (or any
// notation app) writes a grand-staff piano, it encodes voice 1 (RH staff 1), then
// emits <backup> and encodes voice 2 (LH staff 2). Because fast-xml-parser ignores
// <backup>, using a single shared cursor pushed LH notes past the measure boundary.
// Independent per-voice cursors make <backup> irrelevant — each voice starts at 0.
const voiceCursors    = new Map<number, number>(); // voice → next onset
const voiceLastOnset  = new Map<number, number>(); // voice → last non-chord onset

const events: NoteEvent[] = notesXml.map((nXml: any, idx: number) => {
  const dur = nXml["duration"] != null ? Number(nXml["duration"]) : 0;
  const voice = nXml["voice"] != null ? Number(nXml["voice"]) : 1;
  const staff = nXml["staff"] != null ? Number(nXml["staff"]) : 1;

  const isRest = nXml["rest"] != null;
  const isChordTone = nXml["chord"] != null;

  // Each voice has its own independent onset cursor
  const vt         = voiceCursors.get(voice) ?? 0;
  const vLastOnset = voiceLastOnset.get(voice) ?? 0;

  // onset: chord tones share the previous note's onset within the same voice
  const onset = isChordTone ? vLastOnset : vt;

  const id = makeId(`P${part_id}_M${number}_N${idx}`);

  let ev: NoteEvent;

  if (isRest) {
    ev = { id, t: onset, dur, type: "rest", voice, staff, isRest: true };
  } else {
    const pitchXml = nXml["pitch"];
    const step = pitchXml?.["step"];
    const octave = pitchXml?.["octave"];

    if (!step || octave == null) {
      ev = { id, t: onset, dur, type: "rest", voice, staff, isRest: true };
    } else {
      const alter = pitchXml?.["alter"] != null ? Number(pitchXml["alter"]) : undefined;
      const pitch: Pitch = { step: String(step), octave: Number(octave) };
      if (alter !== undefined && Number.isFinite(alter)) pitch.alter = alter;

      ev = { id, t: onset, dur, type: "note", pitch, voice, staff };
    }
  }

  // Advance this voice's cursor (chord tones do not advance it)
  if (!isChordTone) {
    voiceLastOnset.set(voice, onset);
    voiceCursors.set(voice, vt + dur);
  }
  return ev;
});

      return {
        number,
        attributes: {
          divisions: currentDivisions,
          key_fifths: keyFifths,
          time: beats && beatType ? { beats, beat_type: beatType } : undefined
        },
        events
      };
    });

    return {
      part_id,
      name,
      instrument: "piano",
      staves: 2,
      measures
    };
  });

  return {
    score_id: makeId("SCORE"),
    meta: {
      ensemble: "piano_solo"
    },
    global: { divisions: globalDivisions },
    parts
  };
}