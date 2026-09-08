import type { ScoreModel } from "./types";
import { parseMusicXMLToScoreModel } from "../parsers/musicxmlParser";

/** Compatibility entry point. All imports now use the ordered, beat-based parser. */
export function musicxmlToScoreModel(xml: string): ScoreModel {
  const parsed = parseMusicXMLToScoreModel(xml);
  if (!parsed.parts.length) throw new Error("Not a populated score-partwise MusicXML document.");
  return {
    ...parsed,
    score_id: "imported-score",
    meta: { ...parsed.meta, ensemble: "piano_solo" },
    global: { divisions: 4 },
    parts: parsed.parts.map(part => ({
      ...part,
      name: part.name ?? "Piano",
      instrument: "piano",
      staves: Math.max(1, ...part.measures.flatMap(m => m.events.map(e => e.staff ?? 1))),
      measures: part.measures.map((m, mi) => ({
        ...m,
        events: m.events.map((e, ei) => ({
          ...e, id: `${part.part_id}-${mi}-${ei}`, voice: e.voice ?? 1,
          staff: e.staff ?? 1, ...(e.type === "rest" ? { isRest: true as const } : {})
        }))
      }))
    }))
  } as ScoreModel;
}
