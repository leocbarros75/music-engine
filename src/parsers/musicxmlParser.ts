import { DOMParser } from "@xmldom/xmldom";

type Pitch = {
  step: string;
  alter?: number;
  octave: number;
};

type NoteEvent =
  | {
      type: "note";
      t: number;
      dur: number;
      pitch: Pitch;
      midi: number;
      voice?: number;
      staff?: number;
      tieStart?: boolean;
      tieStop?: boolean;
      chord?: boolean;
    }
  | {
      type: "rest";
      t: number;
      dur: number;
      voice?: number;
      staff?: number;
    };

type Measure = {
  number: number;
  attributes?: any;
  events: NoteEvent[];
};

type Part = {
  part_id: string;
  name?: string;
  transpose?: { diatonic: number; chromatic: number; octaveChange: number };
  measures: Measure[];
};

type ScoreModel = {
  meta?: any;
  parts: Part[];
};

function textOf(el: Element | null | undefined): string {
  if (!el) return "";
  return String(el.textContent ?? "").trim();
}

function intOf(el: Element | null | undefined, fallback = 0): number {
  const s = textOf(el);
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function localNameOf(el: Element | null | undefined): string {
  if (!el) return "";
  const raw = String((el as any).localName ?? el.tagName ?? "");
  const parts = raw.split(":");
  return parts[parts.length - 1] ?? raw;
}

function elementsByTagName(root: Document | Element, tag: string): Element[] {
  const result: Element[] = [];
  const nsFn = (root as any).getElementsByTagNameNS;
  const nodeList = typeof nsFn === "function" ? nsFn.call(root, "*", tag) : (root as any).getElementsByTagName(tag);
  if (!nodeList) return result;
  for (let i = 0; i < nodeList.length; i++) {
    const item = nodeList.item(i);
    if (item && item.nodeType === 1) result.push(item as Element);
  }
  return result;
}

function firstChild(el: Element, tag: string): Element | null {
  const xs = elementsByTagName(el, tag);
  return xs.length ? xs[0] : null;
}

function parseNoteTieFlags(noteEl: Element): { tieStart: boolean; tieStop: boolean } {
  let tieStart = false;
  let tieStop = false;

  const childNodes = noteEl.childNodes;
  for (let i = 0; i < childNodes.length; i++) {
    const node = childNodes.item(i);
    if (!node || node.nodeType !== 1) continue;
    const el = node as Element;
    if (localNameOf(el) !== "tie") continue;
    const type = String(el.getAttribute("type") ?? "").toLowerCase();
    if (type === "start") tieStart = true;
    if (type === "stop") tieStop = true;
  }

  const notationsEl = firstChild(noteEl, "notations");
  if (notationsEl) {
    const nChildren = notationsEl.childNodes;
    for (let i = 0; i < nChildren.length; i++) {
      const node = nChildren.item(i);
      if (!node || node.nodeType !== 1) continue;
      const el = node as Element;
      if (localNameOf(el) !== "tied") continue;
      const type = String(el.getAttribute("type") ?? "").toLowerCase();
      if (type === "start") tieStart = true;
      if (type === "stop") tieStop = true;
    }
  }

  return { tieStart, tieStop };
}

function stepToPc(step: string): number {
  const s = String(step ?? "").toUpperCase();
  if (s === "C") return 0;
  if (s === "D") return 2;
  if (s === "E") return 4;
  if (s === "F") return 5;
  if (s === "G") return 7;
  if (s === "A") return 9;
  if (s === "B") return 11;
  return 0;
}

function pitchToMidi(p: Pitch): number {
  const pc = stepToPc(p.step) + (p.alter ?? 0);
  return (p.octave + 1) * 12 + pc;
}

function computeMeasureLengthInBeats(
  beats: number | undefined,
  beatType: number | undefined
): number | null {
  if (!beats || !beatType) return null;
  // quarter-note length = 1 beat in our internal units
  // measure length = beats * (4 / beatType)
  const len = beats * (4 / beatType);
  return Number.isFinite(len) && len > 0 ? len : null;
}

function accidentalFromAlter(alter: number, warnings: string[]): string {
  if (alter === 1) return "#";
  if (alter === -1) return "b";
  if (alter === 0) return "";
  if (alter > 1) {
    warnings.push(`[chord] root alter=${alter} not supported; using "#".`);
    return "#";
  }
  if (alter < -1) {
    warnings.push(`[chord] root alter=${alter} not supported; using "b".`);
    return "b";
  }
  return "";
}

function chordSuffixFromKind(kind: string, kindTextAttr: string, warnings: string[]): string {
  const k = String(kind || "").trim().toLowerCase();
  const kt = String(kindTextAttr || "").trim().toLowerCase();
  if (kt) {
    if (kt === "2" || kt === "add2") return "add2";
    if (kt === "sus" || kt === "sus4" || kt === "sus42") return "sus4";
    if (kt === "sus2") return "sus2";
    if (kt === "6" || kt === "add6") return "6";
    if (kt === "9" || kt === "add9") return "9";
    if (kt === "ma9" || kt === "maj9") return "maj9";
    if (kt === "ma7" || kt === "maj7") return "maj7";
    if (kt === "m7") return "m7";
  }
  if (!k || k === "major") return "";
  if (k === "minor") return "m";
  if (k === "dominant" || k === "major-minor") return "7";
  if (k === "major-seventh") return "maj7";
  if (k === "minor-seventh") return "m7";
  if (k === "diminished") return "dim";
  if (k === "diminished-seventh") return "dim7";
  if (k === "half-diminished") return "ø7";
  if (k === "augmented") return "aug";
  if (k === "augmented-seventh") return "aug7";
  if (k === "suspended-fourth") return "sus4";
  if (k === "suspended-second") return "sus2";
  if (k === "major-ninth") return "maj9";
  if (k === "dominant-ninth") return "9";
  if (k === "added-sixth") return "6";
  warnings.push(`[chord] Unsupported harmony kind "${kind}". Defaulting to major triad.`);
  return "";
}

function parseHarmonySymbol(harmonyEl: Element, warnings: string[]): { symbol: string } | null {
  const rootEl = firstChild(harmonyEl, "root");
  const rootStep = rootEl ? textOf(firstChild(rootEl, "root-step")) : "";
  if (!rootStep) return null;

  const rootAlterEl = rootEl ? firstChild(rootEl, "root-alter") : null;
  const rootAlter = rootAlterEl ? intOf(rootAlterEl, 0) : 0;
  const rootAcc = accidentalFromAlter(rootAlter, warnings);

  const kindEl = firstChild(harmonyEl, "kind");
  const kindText = kindEl ? textOf(kindEl) : "";
  const kindTextAttr = kindEl?.getAttribute("text") ?? "";
  const suffix = chordSuffixFromKind(kindText, kindTextAttr, warnings);

  const bassEl = firstChild(harmonyEl, "bass");
  const bassStep = bassEl ? textOf(firstChild(bassEl, "bass-step")) : "";
  const bassAlterEl = bassEl ? firstChild(bassEl, "bass-alter") : null;
  const bassAlter = bassAlterEl ? intOf(bassAlterEl, 0) : 0;
  const bassAcc = bassStep ? accidentalFromAlter(bassAlter, warnings) : "";

  const rootName = `${rootStep.toUpperCase()}${rootAcc}`;
  const bassName = bassStep ? `${bassStep.toUpperCase()}${bassAcc}` : "";

  const symbol = bassName ? `${rootName}${suffix}/${bassName}` : `${rootName}${suffix}`;
  return symbol ? { symbol } : null;
}

/**
 * Parser rules supported:
 * - <chord/> notes share onset with previous non-chord note (same voice stream)
 * - <backup>/<forward> adjusts the time cursor
 *
 * Extra heuristic (for simple test fixtures):
 * Some fixtures encode a vertical sonority by writing multiple whole notes
 * in the same measure WITHOUT <chord/>, <backup>, or voice layers.
 * In that case, after the measure is already "full", we treat remaining notes
 * as stacked at the measure start (t=0) so harmony analysis can see the chord.
 */
export function parseMusicXMLToScoreModel(xml: string): ScoreModel {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const scorePartwise = elementsByTagName(doc, "score-partwise")[0] ?? null;
  if (!scorePartwise) return { parts: [] };

  // Extract title: prefer <work-title>, fall back to <movement-title>, then <credit-words>
  let scoreTitle = "";
  const workEl = elementsByTagName(scorePartwise, "work")[0] ?? null;
  if (workEl) scoreTitle = textOf(firstChild(workEl as Element, "work-title"));
  if (!scoreTitle) {
    const mvEl = elementsByTagName(scorePartwise, "movement-title")[0] ?? null;
    if (mvEl) scoreTitle = textOf(mvEl as Element);
  }
  if (!scoreTitle) {
    const credEls = elementsByTagName(scorePartwise, "credit-words");
    if (credEls.length) scoreTitle = textOf(credEls[0] as Element);
  }

  const partList = elementsByTagName(scorePartwise, "part-list")[0] ?? null;

  const partNames = new Map<string, string>();
  if (partList) {
    const scoreParts = elementsByTagName(partList, "score-part");
    for (let i = 0; i < scoreParts.length; i++) {
      const sp = scoreParts[i] as Element;
      const id = String(sp.getAttribute("id") ?? "");
      const pn = firstChild(sp, "part-name");
      const name = textOf(pn);
      if (id) partNames.set(id, name);
    }
  }

  const parts: Part[] = [];
  const chordEvents: Array<{ measure: number; t: number; symbol: string }> = [];
  const chordWarnings: string[] = [];
  const partEls = elementsByTagName(scorePartwise, "part");

  for (let pi = 0; pi < partEls.length; pi++) {
    const partEl = partEls[pi] as Element;
    const partId = String(partEl.getAttribute("id") ?? `P${pi + 1}`);
    const measures: Measure[] = [];

    // Capture the part's <transpose> (transposing-instrument written→sounding
    // offset). Stored as additive part metadata only — note pitches are kept
    // exactly as written in the file, so existing flows are unaffected. The
    // re-instrumentation step uses it to recover true concert pitch.
    let partTranspose: { diatonic: number; chromatic: number; octaveChange: number } | null = null;

    const measureEls = elementsByTagName(partEl, "measure");
    let curDivisions = 480;

    for (let mi = 0; mi < measureEls.length; mi++) {
      const mEl = measureEls[mi] as Element;
      const mNumber = intOf({ textContent: mEl.getAttribute("number") } as any, mi + 1);

      const attrsEl = firstChild(mEl, "attributes");

      // Read divisions early (affects durations + measure length)
      if (attrsEl) {
        const divEl = firstChild(attrsEl, "divisions");
        const d = intOf(divEl, curDivisions);
        if (d > 0) curDivisions = d;
      }

      // Read time/key early so we can compute measure length heuristic
      let beatsForLen: number | undefined = undefined;
      let beatTypeForLen: number | undefined = undefined;

      if (attrsEl) {
        const timeEl = firstChild(attrsEl, "time");
        if (timeEl) {
          beatsForLen = intOf(firstChild(timeEl, "beats"), undefined as any);
          beatTypeForLen = intOf(firstChild(timeEl, "beat-type"), undefined as any);
        }
      }

      const measureLen = computeMeasureLengthInBeats(beatsForLen, beatTypeForLen);

      const events: NoteEvent[] = [];
      let t = 0;
      let lastNonChordStartT = 0;

      const childNodes = mEl.childNodes;

      for (let ci = 0; ci < childNodes.length; ci++) {
        const node = childNodes.item(ci);
        if (!node || node.nodeType !== 1) continue;

        const el = node as Element;
        const tag = localNameOf(el);

        if (tag === "harmony") {
          const parsed = parseHarmonySymbol(el, chordWarnings);
          if (parsed) {
            const offsetEl = firstChild(el, "offset");
            const offsetDivs = offsetEl ? intOf(offsetEl, 0) : null;
            const rawBeat = offsetDivs !== null ? t + offsetDivs / curDivisions : t;
            const beat = Number.isFinite(rawBeat) ? rawBeat : 0;
            const beatClamped = Math.max(0, beat);
            chordEvents.push({ measure: mNumber, t: beatClamped, symbol: parsed.symbol });
          } else {
            chordWarnings.push("[chord] Could not parse <harmony> element.");
          }
          continue;
        }

        if (tag === "note") {
          const isChordTone = !!firstChild(el, "chord");
          const tieFlags = parseNoteTieFlags(el);

          const restEl = firstChild(el, "rest");
          const durEl = firstChild(el, "duration");
          const durDivs = intOf(durEl, curDivisions);
          const dur = curDivisions > 0 ? durDivs / curDivisions : durDivs;

          const voiceEl = firstChild(el, "voice");
          const staffEl = firstChild(el, "staff");
          const voice = voiceEl ? intOf(voiceEl, 1) : undefined;
          const staff = staffEl ? intOf(staffEl, 1) : undefined;

          let noteT = isChordTone ? lastNonChordStartT : t;
          const rawT = noteT;

          // Heuristic: if this note would begin at/after the measure length (or overfill it),
          // and we have no explicit voice/chord/backup structure, treat as stacked at t=0.
          if (!isChordTone && measureLen != null) {
            const noExplicitLayering = voice == null && staff == null;
            const startsOutside = noteT >= measureLen;
            const wouldOverfill = noteT + dur > measureLen && dur >= measureLen;

            if (noExplicitLayering && (startsOutside || wouldOverfill)) {
              noteT = 0;
            }
          }

          if (restEl) {
            events.push({ type: "rest", t: noteT, dur, voice, staff, source_t: rawT } as any);
          } else {
            const pitchEl = firstChild(el, "pitch");
            if (pitchEl) {
              const step = textOf(firstChild(pitchEl, "step"));
              const alterEl = firstChild(pitchEl, "alter");
              const octave = intOf(firstChild(pitchEl, "octave"), 4);

              // allow negative alter
              const alterRaw = textOf(alterEl);
              const alterParsed = alterRaw === "" ? 0 : Number.parseInt(alterRaw, 10);
              const alter = Number.isFinite(alterParsed) ? alterParsed : 0;

              const pitch: Pitch = { step, alter, octave };
              const midi = pitchToMidi(pitch);

              events.push({
                type: "note",
                t: noteT,
                dur,
                pitch,
                midi,
                voice,
                staff,
                source_t: rawT,
                chord: isChordTone ? true : undefined,
                tieStart: tieFlags.tieStart ? true : undefined,
                tieStop: tieFlags.tieStop ? true : undefined
              } as any);
            } else {
              events.push({ type: "rest", t: noteT, dur, voice, staff, source_t: rawT } as any);
            }
          }

          // Advance cursor only if truly sequential.
          // If heuristic stacked it at 0 while cursor is already past, do not advance.
          if (!isChordTone) {
            // If we forced stacking (noteT !== t), don't move the main cursor.
            if (noteT === t) {
              lastNonChordStartT = t;
              t += dur;
            } else {
              lastNonChordStartT = noteT;
            }
          }

          continue;
        }

        if (tag === "backup") {
          const durEl = firstChild(el, "duration");
          const durDivs = intOf(durEl, 0);
          const dur = curDivisions > 0 ? durDivs / curDivisions : durDivs;
          t -= dur;
          if (t < 0) t = 0;
          lastNonChordStartT = t;
          continue;
        }

        if (tag === "forward") {
          const durEl = firstChild(el, "duration");
          const durDivs = intOf(durEl, 0);
          const dur = curDivisions > 0 ? durDivs / curDivisions : durDivs;
          t += dur;
          lastNonChordStartT = t;
          continue;
        }
      }

      // Build attributes object
      const attributes: any = {};
      if (attrsEl) {
        const divEl = firstChild(attrsEl, "divisions");
        const inputDivisions = divEl ? intOf(divEl, curDivisions) : curDivisions;
        attributes.divisions = 4;
        attributes.source_divisions = inputDivisions;

        const timeEl = firstChild(attrsEl, "time");
        const beatsEl = timeEl ? firstChild(timeEl, "beats") : null;
        const beatTypeEl = timeEl ? firstChild(timeEl, "beat-type") : null;

        if (beatsEl && beatTypeEl) {
          const beats = intOf(beatsEl, 4);
          const beatType = intOf(beatTypeEl, 4);

          // Provide both shapes (some parts of code used beatType earlier)
          attributes.time = {
            beats,
            beat_type: beatType,
            beatType
          };
        }

        const keyEl = firstChild(attrsEl, "key");
        const fifthsEl = keyEl ? firstChild(keyEl, "fifths") : null;
        if (fifthsEl) {
          const raw = textOf(fifthsEl);
          const n = Number.parseInt(raw, 10);
          if (Number.isFinite(n)) attributes.key_fifths = n;
        }
        const modeEl = keyEl ? firstChild(keyEl, "mode") : null;
        if (modeEl) {
          const modeRaw = textOf(modeEl).toLowerCase();
          if (modeRaw === "minor" || modeRaw === "major") {
            attributes.key_mode = modeRaw;
          }
        }

        // <transpose> — first occurrence wins (it rarely changes mid-part).
        if (!partTranspose) {
          const transEl = firstChild(attrsEl, "transpose");
          if (transEl) {
            const chromEl = firstChild(transEl, "chromatic");
            const diatEl = firstChild(transEl, "diatonic");
            const octEl = firstChild(transEl, "octave-change");
            const chromatic = chromEl ? Number.parseInt(textOf(chromEl), 10) : 0;
            if (Number.isFinite(chromatic)) {
              partTranspose = {
                chromatic,
                diatonic: diatEl ? (Number.parseInt(textOf(diatEl), 10) || 0) : 0,
                octaveChange: octEl ? (Number.parseInt(textOf(octEl), 10) || 0) : 0,
              };
            }
          }
        }
      }

      measures.push({
        number: mNumber,
        attributes: Object.keys(attributes).length ? attributes : undefined,
        events
      });
    }

    parts.push({
      part_id: partId,
      name: partNames.get(partId) ?? undefined,
      measures,
      ...(partTranspose ? { transpose: partTranspose } : {}),
    });
  }

  const deduped: Array<{ measure: number; t: number; symbol: string }> = [];
  const chordByKey = new Map<string, { measure: number; t: number; symbol: string }>();
  for (const c of chordEvents) {
    const key = `${c.measure}:${c.t}`;
    const existing = chordByKey.get(key);
    if (!existing) {
      chordByKey.set(key, c);
      deduped.push(c);
    } else if (existing.symbol !== c.symbol) {
      chordWarnings.push(
        `[chord] Conflicting symbols at measure ${c.measure} t=${c.t}: "${existing.symbol}" vs "${c.symbol}". Using first.`
      );
    }
  }

  const m0 = parts[0]?.measures?.[0];
  const meta: any = {
    title: scoreTitle || undefined,
    inputKeyFifths: m0?.attributes?.key_fifths,
    inputKeyMode: m0?.attributes?.key_mode,
    inputTime: m0?.attributes?.time,
    inputDivisions: m0?.attributes?.source_divisions ?? m0?.attributes?.divisions,
    inputChords: deduped,
    inputChordWarnings: chordWarnings.length ? chordWarnings : undefined
  };

  return {
    meta,
    parts
  };
}
