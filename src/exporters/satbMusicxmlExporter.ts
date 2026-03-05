// src/exporters/satbMusicxmlExporter.ts
import type { ScoreModel } from "../score/types";
import { pitchToMidi } from "../instruments/instrumentCatalog";

type Pitch = { step: string; alter?: number; octave: number };
type NormalizedEvent = { type: "note" | "rest"; durBeats: number; pitch?: Pitch };

const EXPORT_DIVISIONS = 4;
const EXPORT_DIVISIONS_WITH_TUPLETS = 12;
const EPS = 1e-6;

function escXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function asInt(x: unknown, fallback: number): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function getFirstMeasureAttributes(score: ScoreModel): any | null {
  const p0: any = (score as any).parts?.[0];
  const m0: any = p0?.measures?.[0];
  return m0?.attributes ?? null;
}

function getTime(score: ScoreModel): { beats: number; beatType: number } {
  const attrs = getFirstMeasureAttributes(score);
  const t = attrs?.time;
  const beats = asInt(t?.beats, 4);
  const beatType = asInt(t?.beat_type ?? t?.beatType, 4);
  return { beats, beatType };
}

function getKey(score: ScoreModel): { fifths: number; mode: string } {
  const attrs = getFirstMeasureAttributes(score);
  const fifths = asInt(attrs?.key_fifths ?? attrs?.key?.fifths, 0);
  const mode = typeof attrs?.key?.mode === "string" ? attrs.key.mode : "major";
  return { fifths, mode };
}

const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

function keySignatureAlter(step: string, keyFifths: number): number {
  const s = String(step || "").toUpperCase();
  if (!s) return 0;
  if (keyFifths > 0) {
    const idx = Math.min(keyFifths, 7);
    return SHARP_ORDER.slice(0, idx).includes(s) ? 1 : 0;
  }
  if (keyFifths < 0) {
    const idx = Math.min(Math.abs(keyFifths), 7);
    return FLAT_ORDER.slice(0, idx).includes(s) ? -1 : 0;
  }
  return 0;
}

function accidentalFromAlterForDisplay(alter: number): string | null {
  if (alter === 0) return "natural";
  if (alter === 1) return "sharp";
  if (alter === -1) return "flat";
  if (alter === 2) return "double-sharp";
  if (alter === -2) return "double-flat";
  return null;
}

function normalizePitchForKey(p: Pitch, keyFifths: number): Pitch {
  const pc = ((pitchToMidi(p) % 12) + 12) % 12;

  const flatTargets = [
    [],
    [10],
    [10, 3],
    [10, 3, 8],
    [10, 3, 8, 1],
    [10, 3, 8, 1, 6],
    [10, 3, 8, 1, 6, 11],
    [10, 3, 8, 1, 6, 11, 4]
  ];

  const sharpTargets = [
    [],
    [6],
    [6, 1],
    [6, 1, 8],
    [6, 1, 8, 3],
    [6, 1, 8, 3, 10],
    [6, 1, 8, 3, 10, 5],
    [6, 1, 8, 3, 10, 5, 0]
  ];

  const flatsByPc: Record<number, { step: string; alter: number }> = {
    10: { step: "B", alter: -1 },
    3: { step: "E", alter: -1 },
    8: { step: "A", alter: -1 },
    1: { step: "D", alter: -1 },
    6: { step: "G", alter: -1 },
    11: { step: "C", alter: -1 },
    4: { step: "F", alter: -1 }
  };

  const sharpsByPc: Record<number, { step: string; alter: number }> = {
    6: { step: "F", alter: 1 },
    1: { step: "C", alter: 1 },
    8: { step: "G", alter: 1 },
    3: { step: "D", alter: 1 },
    10: { step: "A", alter: 1 },
    5: { step: "E", alter: 1 },
    0: { step: "B", alter: 1 }
  };

  if (keyFifths < 0) {
    const idx = Math.min(Math.abs(keyFifths), 7);
    if (flatTargets[idx]?.includes(pc)) {
      const mapped = flatsByPc[pc];
      if (mapped) return { ...p, step: mapped.step, alter: mapped.alter };
    }
    return p;
  }

  if (keyFifths > 0) {
    const idx = Math.min(Math.abs(keyFifths), 7);
    if (sharpTargets[idx]?.includes(pc)) {
      const mapped = sharpsByPc[pc];
      if (mapped) return { ...p, step: mapped.step, alter: mapped.alter };
    }
    return p;
  }

  return p;
}

function voiceClefXml(voiceName: string): string {
  const v = voiceName.toLowerCase();

  // Strings
  if (v.includes("violin")) {
    return `<clef><sign>G</sign><line>2</line></clef>`;
  }
  if (v.includes("viola")) {
    return `<clef><sign>C</sign><line>3</line></clef>`;
  }
  if (v.includes("cello")) {
    return `<clef><sign>F</sign><line>4</line></clef>`;
  }
  if (v.includes("double bass") || v.includes("double_bass") || v.includes("contrabass")) {
    return `<clef><sign>F</sign><line>4</line></clef>`;
  }

  // Soprano / Alto: treble
  if (v.includes("soprano") || v.includes("alto")) {
    return `<clef><sign>G</sign><line>2</line></clef>`;
  }

  // Tenor: treble 8vb (octave down)
  if (v.includes("tenor")) {
    return `<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>`;
  }

  // Bass: bass clef
  return `<clef><sign>F</sign><line>4</line></clef>`;
}

function pitchXml(p: Pitch): string {
  const step = escXml(String(p.step));
  const octave = asInt(p.octave, 4);
  const alter = p.alter;

  if (typeof alter === "number" && alter !== 0) {
    return `<pitch><step>${step}</step><alter>${alter}</alter><octave>${octave}</octave></pitch>`;
  }
  return `<pitch><step>${step}</step><octave>${octave}</octave></pitch>`;
}

type DurationNotation = {
  type: string;
  dots: number;
  timeModification?: { actual: number; normal: number };
};

function durationToNotation(durBeats: number): DurationNotation {
  const table = [
    { beats: 4, type: "whole", dots: 0 },
    { beats: 3, type: "half", dots: 1 },
    { beats: 2, type: "half", dots: 0 },
    { beats: 1.5, type: "quarter", dots: 1 },
    { beats: 1, type: "quarter", dots: 0 },
    { beats: 0.75, type: "eighth", dots: 1 },
    { beats: 0.5, type: "eighth", dots: 0 },
    { beats: 0.25, type: "16th", dots: 0 },
    // Triplet-eighth in 4/4: three in the time of two eighths.
    { beats: 1 / 3, type: "eighth", dots: 0, timeModification: { actual: 3, normal: 2 } },
    // Quarter-note triplet support (three in the time of two quarters).
    { beats: 2 / 3, type: "quarter", dots: 0, timeModification: { actual: 3, normal: 2 } },
    // Triplet-16th support.
    { beats: 1 / 6, type: "16th", dots: 0, timeModification: { actual: 3, normal: 2 } }
  ];

  for (const row of table) {
    if (Math.abs(durBeats - row.beats) < EPS) {
      return {
        type: row.type,
        dots: row.dots,
        timeModification: (row as any).timeModification
      };
    }
  }
  return { type: "quarter", dots: 0 };
}

function hasTupletDurations(score: ScoreModel): boolean {
  const parts: any[] = Array.isArray((score as any)?.parts) ? (score as any).parts : [];
  for (const p of parts) {
    const measures: any[] = Array.isArray(p?.measures) ? p.measures : [];
    for (const m of measures) {
      const events: any[] = Array.isArray(m?.events) ? m.events : [];
      for (const e of events) {
        const dur = Number((e as any)?.dur);
        if (!Number.isFinite(dur) || dur <= 0) continue;
        const x3 = dur * 3;
        const x2 = dur * 2;
        const nearInt3 = Math.abs(x3 - Math.round(x3)) < EPS;
        const nearInt2 = Math.abs(x2 - Math.round(x2)) < EPS;
        // Detect values like 1/3, 2/3, 1/6, etc. without flagging plain binary durations.
        if (nearInt3 && !nearInt2) return true;
      }
    }
  }
  return false;
}

function timeModificationXml(notation: DurationNotation): string {
  if (!notation.timeModification) return "";
  return `<time-modification><actual-notes>${notation.timeModification.actual}</actual-notes><normal-notes>${notation.timeModification.normal}</normal-notes></time-modification>`;
}

function measureLengthInBeats(beats: number, beatType: number): number {
  if (beats <= 0 || beatType <= 0) return 4;
  return beats * (4 / beatType);
}

function normalizeMeasureEvents(events: any[], measureLenBeats: number): NormalizedEvent[] {
  const cleaned = (events ?? [])
    .filter((e: any) => e && (e.type === "note" || e.type === "rest"))
    .map((e: any) => ({
      type: e.type as "note" | "rest",
      t: Number(e.t ?? 0),
      dur: Number(e.dur ?? 0),
      pitch: e.pitch as Pitch | undefined
    }))
    .filter((e: any) => Number.isFinite(e.t) && Number.isFinite(e.dur) && e.dur > 0)
    .sort((a: any, b: any) => Number(a.t) - Number(b.t));

  let cursor = 0;
  const out: NormalizedEvent[] = [];

  for (const e of cleaned) {
    if (cursor >= measureLenBeats - EPS) break;

    if (e.t > cursor + EPS) {
      const restDur = Math.min(e.t - cursor, measureLenBeats - cursor);
      if (restDur > EPS) out.push({ type: "rest", durBeats: restDur });
      cursor += restDur;
    }

    if (e.t < cursor - EPS) {
      e.t = cursor;
    }

    const remaining = measureLenBeats - cursor;
    if (remaining <= EPS) break;
    const useDur = Math.min(e.dur, remaining);
    if (useDur <= EPS) continue;

    if (e.type === "note" && e.pitch) {
      out.push({ type: "note", durBeats: useDur, pitch: e.pitch });
    } else {
      out.push({ type: "rest", durBeats: useDur });
    }
    cursor += useDur;
  }

  const tail = measureLenBeats - cursor;
  if (tail > EPS) out.push({ type: "rest", durBeats: tail });

  return out;
}

function ensureSatbOrder(parts: any[]): any[] {
  const get = (name: string): any | null =>
    parts.find((p) => String(p?.name ?? "").toLowerCase() === name.toLowerCase()) ?? null;

  const s = get("Soprano");
  const a = get("Alto");
  const t = get("Tenor");
  const b = get("Bass");

  const ordered = [s, a, t, b].filter(Boolean);
  if (ordered.length === 4) return ordered;

  // fallback: keep original order if something is missing
  return parts;
}

export function exportSatbScoreModelToMusicXML(score: ScoreModel): string {
  const partsAny: any[] = Array.isArray((score as any).parts) ? (score as any).parts : [];
  const parts = ensureSatbOrder(partsAny);

  const title = typeof (score as any).meta?.title === "string" ? (score as any).meta.title : "";
  const composer = typeof (score as any).meta?.composer === "string" ? (score as any).meta.composer : "";

  const { beats, beatType } = getTime(score);
  const { fifths, mode } = getKey(score);

  const divisions = hasTupletDurations(score) ? EXPORT_DIVISIONS_WITH_TUPLETS : EXPORT_DIVISIONS;

  // Determine measure count from first part
  const measureCount = Array.isArray(parts?.[0]?.measures) ? parts[0].measures.length : 0;

  const partListXml = parts
    .map((p) => {
      const id = escXml(String(p.part_id ?? p.id ?? `P_${String(p.name ?? "X")}`));
      const nm = escXml(String(p.name ?? id));
      return `<score-part id="${id}"><part-name>${nm}</part-name></score-part>`;
    })
    .join("");

  const headerXml =
    `<work>${title ? `<work-title>${escXml(title)}</work-title>` : ""}</work>` +
    `<identification>${
      composer ? `<creator type="composer">${escXml(composer)}</creator>` : ""
    }</identification>`;

  const xmlParts = parts
    .map((p) => {
      const partId = escXml(String(p.part_id ?? p.id ?? `P_${String(p.name ?? "X")}`));
      const voiceName = String(p.name ?? "");

      const measures: any[] = Array.isArray(p.measures) ? p.measures : [];

      const measuresXml = Array.from({ length: measureCount }, (_, i) => {
        const m = measures[i] ?? { number: i + 1, events: [] };
        const num = asInt(m.number, i + 1);

        // Only measure 1 gets attributes
        const attributesXml =
          num === 1
            ? `<attributes>
                <divisions>${divisions}</divisions>
                <key><fifths>${fifths}</fifths><mode>${escXml(mode)}</mode></key>
                <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>
                ${voiceClefXml(voiceName)}
              </attributes>`
            : "";

        const events: any[] = Array.isArray(m.events) ? m.events : [];
        const measureLenBeats = measureLengthInBeats(beats, beatType);
        const normalized = normalizeMeasureEvents(events, measureLenBeats);

        const notesXml =
          normalized.length === 0
            ? (() => {
                const durDivs = Math.max(1, Math.round(measureLenBeats * divisions));
                const notation = durationToNotation(measureLenBeats);
                const { type, dots } = notation;
                const dotsXml = dots ? "<dot/>".repeat(dots) : "";
                return `<note><rest/><duration>${durDivs}</duration><type>${type}</type>${dotsXml}${timeModificationXml(notation)}</note>`;
              })()
            : normalized
                .map((e) => {
                  const durDivs = Math.max(1, Math.round(e.durBeats * divisions));
                  const notation = durationToNotation(e.durBeats);
                  const { type, dots } = notation;
                  const dotsXml = dots ? "<dot/>".repeat(dots) : "";
                  const tmXml = timeModificationXml(notation);

                  if (e.type === "rest") {
                    return `<note><rest/><duration>${durDivs}</duration><type>${type}</type>${dotsXml}${tmXml}</note>`;
                  }

                  const pitch = e.pitch;
                  if (!pitch || !pitch.step || pitch.octave === undefined) {
                    return `<note><rest/><duration>${durDivs}</duration><type>${type}</type>${dotsXml}${tmXml}</note>`;
                  }
                  const shouldNormalize = !voiceName.toLowerCase().includes("soprano");
                  const normalized = shouldNormalize ? normalizePitchForKey(pitch, fifths) : pitch;
                  const alterVal = typeof normalized.alter === "number" ? normalized.alter : 0;
                  const expectedAlter = keySignatureAlter(normalized.step, fifths);
                  const accidental =
                    alterVal === expectedAlter ? "" : accidentalFromAlterForDisplay(alterVal) ?? "";
                  const accidentalXml = accidental ? `<accidental>${accidental}</accidental>` : "";

                  return `<note>${pitchXml(normalized)}<duration>${durDivs}</duration><type>${type}</type>${dotsXml}${tmXml}${accidentalXml}</note>`;
                })
                .join("");

        const barlineXml =
          num === measureCount ? `<barline location="right"><bar-style>light-heavy</bar-style></barline>` : "";
        return `<measure number="${num}">${attributesXml}${notesXml}${barlineXml}</measure>`;
      }).join("");

      return `<part id="${partId}">${measuresXml}</part>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  ${headerXml}
  <part-list>${partListXml}</part-list>
  ${xmlParts}
</score-partwise>
`;
}
