import { collectNotes, pairSourceToOutput, type Note } from "./noteConservation";

/**
 * What the arrangement left behind, and why.
 *
 * Four wind players cannot sound every note of a dense piano texture at once,
 * so an arrangement is a reduction and notes get dropped. That is not the
 * problem. The problem is dropping them silently: the engine has always
 * produced a score with no account of what is missing from it, which leaves
 * anyone checking their own music against the output to diff two scores by eye
 * and guess whether an absence was a decision or a bug.
 *
 * So: every source note that no part plays, named, with a reason inferred from
 * evidence in the score itself. The reasons are deliberately few and each one
 * is something the data can actually support — and where it supports nothing,
 * the record says "unattributed" rather than inventing a rationale. A plausible
 * wrong reason is worse than no reason, because it stops the reader looking.
 */

export type OmissionReason =
  /** Another note of the same pitch class sounds at this moment and was kept. */
  | "octave_doubling"
  /** Its written voice is dropped almost everywhere — a whole line left out. */
  | "voice_omitted"
  /** Nothing from its source part reaches the arrangement at all. */
  | "part_omitted"
  /** An inner note of a chord whose outer notes were kept. */
  | "interior_voice"
  /** The evidence does not say. */
  | "unattributed";

export type Omission = {
  /** Stable enough to find the note again: bar, beat, pitch. */
  id: string;
  measure: number;
  beat: number;
  midi: number;
  sourcePart: string;
  sourceStaff: number | null;
  sourceVoice: number | null;
  reason: OmissionReason;
  /** One phrase a reader can act on, without needing the taxonomy. */
  detail: string;
};

export type OmissionsRecord = {
  omissions: Omission[];
  summary: {
    sourceNotes: number;
    kept: number;
    omitted: number;
    byReason: Record<string, number>;
  };
};

const pc = (midi: number) => ((midi % 12) + 12) % 12;
const at = (n: Note) => `${n.measure}|${Math.round(n.onset * 1000)}`;

/**
 * A voice counts as dropped when hardly any of it survives.
 *
 * Not "none of it": an arrangement that takes three notes out of a hundred
 * from an alternate left-hand figure has still left that figure out, and
 * saying so is more use than a hundred separate notes each blamed on being an
 * interior voice.
 */
const VOICE_DROPPED_RATIO = 0.9;

export function buildOmissions(sourceXml: string, outputXml: string): OmissionsRecord {
  const source = collectNotes(sourceXml);
  const taken = pairSourceToOutput(source, collectNotes(outputXml));

  // Which (part, voice) and which parts lose nearly everything.
  const voiceTotal = new Map<string, number>();
  const voiceLost = new Map<string, number>();
  const partTotal = new Map<string, number>();
  const partLost = new Map<string, number>();
  source.forEach((n, i) => {
    const vk = `${n.partId}|${n.voice ?? "-"}`;
    voiceTotal.set(vk, (voiceTotal.get(vk) ?? 0) + 1);
    partTotal.set(n.partId, (partTotal.get(n.partId) ?? 0) + 1);
    if (!taken[i]) {
      voiceLost.set(vk, (voiceLost.get(vk) ?? 0) + 1);
      partLost.set(n.partId, (partLost.get(n.partId) ?? 0) + 1);
    }
  });
  const droppedVoice = (n: Note) => {
    const vk = `${n.partId}|${n.voice ?? "-"}`;
    const total = voiceTotal.get(vk) ?? 0;
    return total > 0 && (voiceLost.get(vk) ?? 0) / total >= VOICE_DROPPED_RATIO;
  };
  const droppedPart = (n: Note) => {
    const total = partTotal.get(n.partId) ?? 0;
    return total > 0 && (partLost.get(n.partId) ?? 0) / total >= VOICE_DROPPED_RATIO;
  };

  // What sounds at each moment, and what of it survived — so a dropped note can
  // be compared against its own chord rather than against the score at large.
  const kept = new Map<string, Note[]>();
  const all = new Map<string, Note[]>();
  source.forEach((n, i) => {
    const k = at(n);
    (all.get(k) ?? all.set(k, []).get(k)!).push(n);
    if (taken[i]) (kept.get(k) ?? kept.set(k, []).get(k)!).push(n);
  });

  const omissions: Omission[] = [];
  const byReason: Record<string, number> = {};

  source.forEach((n, i) => {
    if (taken[i]) return;
    const here = kept.get(at(n)) ?? [];
    const chord = all.get(at(n)) ?? [];

    let reason: OmissionReason;
    let detail: string;

    if (here.some((k) => pc(k.midi) === pc(n.midi))) {
      reason = "octave_doubling";
      detail = "the same pitch is already sounding in another part here";
    } else if (droppedPart(n)) {
      reason = "part_omitted";
      detail = `nothing from "${n.partName}" is used by this arrangement`;
    } else if (droppedVoice(n)) {
      reason = "voice_omitted";
      detail = `voice ${n.voice ?? "?"} of "${n.partName}" is left out throughout` +
        " — an alternate or doubling line, not the principal one";
    } else if (
      here.length &&
      chord.some((c) => c.midi > n.midi) &&
      chord.some((c) => c.midi < n.midi)
    ) {
      reason = "interior_voice";
      detail = "an inner note of this chord; the outer parts were taken and there was no player left for it";
    } else {
      reason = "unattributed";
      detail = "no reason could be established from the score — worth a look";
    }

    byReason[reason] = (byReason[reason] ?? 0) + 1;
    omissions.push({
      id: `m${n.measure}-b${+n.onset.toFixed(3)}-${n.midi}`,
      measure: n.measure,
      beat: +n.onset.toFixed(3),
      midi: n.midi,
      sourcePart: n.partName,
      sourceStaff: n.staff,
      sourceVoice: n.voice,
      reason,
      detail,
    });
  });

  return {
    omissions,
    summary: {
      sourceNotes: source.length,
      kept: source.length - omissions.length,
      omitted: omissions.length,
      byReason,
    },
  };
}

/** One line a person can read without opening the JSON. */
export function omissionsSentence(record: OmissionsRecord): string {
  const { sourceNotes, kept, omitted, byReason } = record.summary;
  if (!omitted) return `All ${sourceNotes} source notes are played by the arrangement.`;
  const phrase: Record<string, string> = {
    octave_doubling: "already sounding elsewhere",
    voice_omitted: "from a line left out throughout",
    part_omitted: "from a part this arrangement does not use",
    interior_voice: "inner chord notes with no player left",
    unattributed: "unaccounted for",
  };
  const parts = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${n} ${phrase[r] ?? r}`);
  return `${kept} of ${sourceNotes} source notes are played; ${omitted} are not — ${parts.join(", ")}.`;
}
