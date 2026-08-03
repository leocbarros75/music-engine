// src/arrange/symphonic/symphonicOrchestraArranger.ts
//
// SYMPHONIC ORCHESTRA (Classical / Romantic) — a sibling of, and fully isolated
// from, the worship orchestra. Nothing here imports a worship file, and no
// worship file imports this; the DP core is its own fork under ./core.
//
// Why it is a different engine, not a re-skin of the worship orchestra:
//
//   • WHO CARRIES THE MUSIC. In worship the band + congregation carry the song
//     and the orchestra is a cushion that must not compete (brass-forward,
//     strings as pad). Here the orchestra IS the music: the STRINGS are the
//     protagonist, winds are colour and solo voices, brass is reserved power.
//
//   • TEXTURE. Worship is a homophonic pad plus unison hits, deliberately
//     leaving space for the rhythm section. Symphonic writing wants layered
//     roles, octave doubling across families, and tutti/solo opposition
//     (Tovey): the orchestra recedes for a solo line and swells between phrases.
//
//   • DYNAMIC ARCHITECTURE. Worship builds by adding players toward the final
//     chorus. A symphony builds by ACCUMULATION AND COLOUR: transparent
//     exposition → fuller middle → tutti climax, brass entering last.
//
//   • HARMONY. The symphonic core deliberately drops the worship post-processing
//     (forced bass roots, automatic add9/m7 triad colour) — see ./core/stringArranger.
//
// Period ("classical" | "romantic") switches BOTH the roster and the scoring:
//   classical → Fl Ob Cl Bsn · Hn 1-2 · Tpt 1-2 · Timp · Vln I/II Vla Vc Cb  (12)
//   romantic  → + Piccolo · Hn 3-4 · Tbn 1-2 · Tbn 3/Tuba                    (16)

import type { ScoreModel } from "../../score/types";
import { arrangeStringEnsemble } from "./core/stringArranger";
import { getInstrumentSpec, midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";

type ChordEvent = { measure: number; t: number; symbol: string };
export type SymphonicPeriod = "classical" | "romantic";
type CoreVoice = "vln1" | "vln2" | "vla" | "vc" | "cb";

/** Family, used for balance reporting and for tutti/solo decisions. */
type Family = "ww" | "brass" | "perc" | "str";

type PartDef = {
  partId: string;
  name: string;
  instrument: string;
  family: Family;
  /** Which core voice this part draws from. */
  src: CoreVoice;
  /** Octave shift applied to the core voice (e.g. piccolo +12, bass -12). */
  octave?: number;
  /** Phrase intensity (0..1) at or above which this part plays. */
  enterAt: number;
  /** Romantic-only parts are dropped for the classical roster. */
  romanticOnly?: boolean;
  /** Timpani: only tonic/dominant, only on strong beats. */
  timpani?: boolean;
};

/**
 * The ~16-part practical symphonic roster (Romantic); the classical period uses
 * the 12 non-`romanticOnly` parts. Score order is standard: woodwinds → brass →
 * percussion → strings, which the exporter preserves.
 *
 * enterAt encodes the dynamic architecture — strings play essentially always,
 * winds join as the music fills out, brass and timpani are held for climaxes.
 */
// CALIBRATED 2026-08-03 against real scores supplied by the user, measured as
// "share of measures in which the part sounds":
//
//                        strings   winds   brass   timpani
//   Brahms 3, mvt I        93%      66%     33%      12%     (lyrical sonata)
//   Dvořák 9, finale       86%      67%     51%      44%     (climactic finale)
//
// Within the brass the split is emphatic and consistent: HORNS play far more
// than trumpets/trombones (Brahms 50-54% vs 15-29%; Dvořák 64% vs 44-49%) —
// horns really are the harmonic glue, the rest is reserved weight.
//
// (Two supplied files were deliberately NOT used for these targets: the
// Beethoven 9 "Ode" file is a fully-tutti excerpt where every part plays every
// bar, and the Tchaikovsky is a CONCERTO — its orchestra drops to 51/39/14%
// because it must stay under the soloist. That concerto profile is a good
// future mode, but it is not symphonic default behaviour.)
//
// enterAt is the phrase-intensity at which a part joins; with the curve below it
// yields roughly: strings 100%, winds ~70%, brass ~37%, timpani ~24%.
const SYMPHONIC_PARTS: PartDef[] = [
  // ── Woodwinds — colour and solo lines (target ~70% of measures) ──
  { partId: "SY_FL",   name: "Flute",           instrument: "flute",        family: "ww",    src: "vln1", enterAt: 0.52 },
  { partId: "SY_OB",   name: "Oboe",            instrument: "oboe",         family: "ww",    src: "vln1", enterAt: 0.50 },
  { partId: "SY_CL",   name: "Clarinet in Bb",  instrument: "clarinet_bb",  family: "ww",    src: "vln2", enterAt: 0.49 },
  // Bassoon doubles the CELLO line (its Romantic role), not the double bass —
  // that independence is exactly what the worship roster collapses into one part.
  { partId: "SY_BSN",  name: "Bassoon",         instrument: "bassoon",      family: "ww",    src: "vc",   enterAt: 0.47 },

  // ── Brass — horns are the glue (~55%), trumpets/trombones reserved (~20-33%) ──
  { partId: "SY_HN12", name: "Horn 1-2",        instrument: "horn_f",       family: "brass", src: "vla",  enterAt: 0.56 },
  { partId: "SY_HN34", name: "Horn 3-4",        instrument: "horn_f",       family: "brass", src: "vc",   enterAt: 0.60, romanticOnly: true },
  { partId: "SY_TPT",  name: "Trumpet 1-2",     instrument: "trumpet_bb_1", family: "brass", src: "vln1", enterAt: 0.69 },
  { partId: "SY_TBN12",name: "Trombone 1-2",    instrument: "trombone",     family: "brass", src: "vla",  enterAt: 0.75, romanticOnly: true },
  { partId: "SY_TBN3", name: "Trombone 3/Tuba", instrument: "tuba_c",       family: "brass", src: "cb",   enterAt: 0.76, romanticOnly: true },

  // ── Percussion ──
  { partId: "SY_TIMP", name: "Timpani",         instrument: "timpani",      family: "perc",  src: "cb",   enterAt: 0.72, timpani: true },

  // ── Strings — the protagonist: present throughout ──
  { partId: "SY_VLN1", name: "Violin I",        instrument: "violin_1",     family: "str",   src: "vln1", enterAt: 0.00 },
  { partId: "SY_VLN2", name: "Violin II",       instrument: "violin_2",     family: "str",   src: "vln2", enterAt: 0.00 },
  { partId: "SY_VLA",  name: "Viola",           instrument: "viola",        family: "str",   src: "vla",  enterAt: 0.00 },
  { partId: "SY_VC",   name: "Cello",           instrument: "cello",        family: "str",   src: "vc",   enterAt: 0.00 },
  // Contrabass sounds 8vb below the cello line (the exporter writes it 8va).
  { partId: "SY_CB",   name: "Contrabass",      instrument: "contrabass",   family: "str",   src: "cb",   octave: -12, enterAt: 0.39 },
];

/** Below C3 no interval tighter than a 5th (Forsyth/Adler) — acoustics, not style. */
const LOW_LIMIT_MIDI = 48;
const PHRASE_LEN = 4;

function eventMidi(ev: any): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) { try { return pitchToMidi(ev.pitch); } catch { return null; } }
  return null;
}

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** Clamp into the instrument's real range by octave displacement. */
function clampToInstrument(midi: number, instrument: string): number | null {
  const spec = getInstrumentSpec(instrument);
  if (!spec) return midi;
  const lo = Number(spec.midi_low), hi = Number(spec.midi_high);
  let out = midi;
  while (out < lo) out += 12;
  while (out > hi) out -= 12;
  return out >= lo && out <= hi ? out : null;
}

/**
 * Per-phrase intensity curve: a symphonic arc rather than a worship build.
 * Transparent opening, a fuller middle, and the peak saved for the final third
 * — brass and timpani ride on top of this via each part's enterAt.
 */
function phraseIntensities(nMeasures: number): number[] {
  const nPhrases = Math.max(1, Math.ceil(nMeasures / PHRASE_LEN));
  const out: number[] = [];
  for (let i = 0; i < nPhrases; i++) {
    const pos = nPhrases === 1 ? 1 : i / (nPhrases - 1); // 0..1 through the piece
    // Rise to a broad plateau, then a final lift for the climax.
    let v = 0.30 + 0.55 * Math.pow(pos, 0.85);
    if (pos > 0.80) v = Math.min(1, v + 0.12);           // final climax
    if (i === 0) v = Math.min(v, 0.34);                   // transparent opening
    out.push(Math.max(0, Math.min(1, v)));
  }
  return out;
}

/**
 * Widen muddy low intervals: below C3, nothing tighter than a 5th. Identical
 * acoustics rule to the worship engine, re-implemented here so the two stay
 * completely independent.
 */
function refineLowSpacing(score: ScoreModel): void {
  const parts = (score.parts ?? []).filter((p: any) => p.part_id !== "SY_TIMP");
  const loOf = new Map<string, number>();
  for (const p of parts as any[]) {
    const spec = getInstrumentSpec(p.instrument);
    loOf.set(p.part_id, spec ? Number(spec.midi_low) : 0);
  }
  const nM = Math.max(0, ...parts.map((p: any) => (p.measures ?? []).length));
  for (let mi = 0; mi < nM; mi++) {
    const byOnset = new Map<string, Array<{ ev: any; lo: number }>>();
    for (const p of parts as any[]) {
      const lo = loOf.get(p.part_id) ?? 0;
      for (const ev of (p.measures?.[mi]?.events ?? [])) {
        if (ev?.type !== "note" || !ev.pitch) continue;
        const k = String(Math.round(Number(ev.t ?? 0) * 1000));
        const arr = byOnset.get(k) ?? [];
        arr.push({ ev, lo });
        byOnset.set(k, arr);
      }
    }
    for (const grp of byOnset.values()) {
      const occ = new Map<number, number>();
      for (const g of grp) { const m = eventMidi(g.ev); if (m !== null) occ.set(m, (occ.get(m) ?? 0) + 1); }
      const sorted = grp.map((g) => ({ g, m: eventMidi(g.ev) ?? 0 })).sort((a, b) => a.m - b.m);
      for (let i = 1; i < sorted.length; i++) {
        const lo = sorted[i - 1]!, hi = sorted[i]!;
        const gap = hi.m - lo.m;
        if (hi.m < LOW_LIMIT_MIDI && gap > 0 && gap < 7) {
          const down = lo.m - 12;
          if (down >= lo.g.lo && (occ.get(down) ?? 0) === 0) {
            occ.set(lo.m, (occ.get(lo.m) ?? 1) - 1);
            occ.set(down, 1);
            lo.g.ev.midi = down;
            lo.g.ev.pitch = midiToPitch(down);
            lo.m = down;
          }
        }
      }
    }
  }
}

export type SymphonicOptions = {
  period?: SymphonicPeriod;
  warnings?: string[];
  profile?: string;
  /** Restrict to these part ids (empty/undefined = the whole period roster). */
  parts?: string[];
};

/**
 * Arrange a lead sheet + chords as a symphonic orchestra.
 * Runs this module's own DP fork for a 5-voice core, then scores it across the
 * period roster with strings leading and brass reserved for climaxes.
 */
export function arrangeSymphonicOrchestra(
  score: ScoreModel,
  chords: ChordEvent[],
  options: SymphonicOptions = {}
): { scoreModel: ScoreModel; warnings: string[] } {
  const warnings = options.warnings ?? [];
  const period: SymphonicPeriod = options.period === "classical" ? "classical" : "romantic";

  // 1) Voice-leading core (symphonic fork: no worship harmony post-processing).
  const core = arrangeStringEnsemble(score, chords, {
    profile: (options.profile ?? "melody_harmony") as any,
  }).scoreModel as ScoreModel;

  const coreByVoice = new Map<CoreVoice, any>();
  const CORE_NAMES: Record<CoreVoice, RegExp> = {
    vln1: /violin i\b|violin 1/i, vln2: /violin ii\b|violin 2/i,
    vla: /viola/i, vc: /cello/i, cb: /bass/i,
  };
  for (const v of ["vln1", "vln2", "vla", "vc", "cb"] as CoreVoice[]) {
    const p = (core.parts ?? []).find((x: any) => CORE_NAMES[v].test(String(x?.name ?? "")));
    if (p) coreByVoice.set(v, p);
  }
  if (!coreByVoice.size) {
    warnings.push("[symphonic] Could not read the voice core — returning the core score.");
    return { scoreModel: core, warnings };
  }

  // 2) Roster for the period, optionally filtered by the caller.
  let roster = SYMPHONIC_PARTS.filter((p) => period === "romantic" || !p.romanticOnly);
  if (options.parts?.length) {
    const want = new Set(options.parts);
    const filtered = roster.filter((p) => want.has(p.partId));
    if (filtered.length) roster = filtered;
  }

  const nM = Math.max(0, ...[...coreByVoice.values()].map((p: any) => (p.measures ?? []).length));
  const intens = phraseIntensities(nM);

  // Tonic pitch class for the timpani (tonic/dominant only).
  const firstAttrs: any = (core.parts?.[0]?.measures?.[0] as any)?.attributes;
  const fifths = Number(firstAttrs?.key_fifths ?? 0);
  const tonicPc = ((fifths * 7) % 12 + 12) % 12;
  const dominantPc = (tonicPc + 7) % 12;

  // 3) Score each part from its core voice, gated by the intensity curve.
  const outParts: any[] = [];
  for (const def of roster) {
    const srcPart = coreByVoice.get(def.src);
    if (!srcPart) continue;
    const measures: any[] = [];
    for (let mi = 0; mi < nM; mi++) {
      const srcM = srcPart.measures?.[mi];
      const intensity = intens[Math.floor(mi / PHRASE_LEN)] ?? 0.5;
      const plays = intensity >= def.enterAt;
      const events: any[] = [];
      if (plays) {
        for (const ev of (srcM?.events ?? [])) {
          if (ev?.type !== "note" || !ev.pitch) continue;
          let midi = eventMidi(ev);
          if (midi === null) continue;
          midi += def.octave ?? 0;
          if (def.timpani) {
            // Timpani: tonic/dominant only, and only on the downbeat.
            const pc = ((midi % 12) + 12) % 12;
            if (Number(ev.t ?? 0) > 0.01) continue;
            if (pc !== tonicPc && pc !== dominantPc) continue;
          }
          const placed = clampToInstrument(midi, def.instrument);
          if (placed === null) continue;
          events.push({
            id: `${def.partId}-${mi + 1}-${ev.t}`,
            t: ev.t, dur: ev.dur, type: "note",
            pitch: midiToPitch(placed), midi: placed,
            voice: 1, staff: 1,
          });
        }
      }
      measures.push({
        number: srcM?.number ?? mi + 1,
        ...(srcM?.attributes ? { attributes: clone(srcM.attributes) } : {}),
        events,
      });
    }
    outParts.push({
      part_id: def.partId, name: def.name, instrument: def.instrument,
      staves: 1, measures,
    });
  }

  const out: any = {
    ...core,
    parts: outParts,
    meta: { ...(core as any).meta, ensemble: "symphonic_orchestra", symphonicPeriod: period },
  };

  refineLowSpacing(out as ScoreModel);

  // Family balance report — the symphonic target inverts the worship one
  // (strings-led rather than brass-forward).
  const count = (fam: Family) => outParts
    .filter((p) => roster.find((d) => d.partId === p.part_id)?.family === fam)
    .reduce((a, p) => a + (p.measures ?? []).reduce((b: number, m: any) => b + (m.events ?? []).length, 0), 0);
  const ww = count("ww"), br = count("brass"), st = count("str");
  const tot = ww + br + st || 1;
  warnings.push(
    `[symphonic] ${period} roster: ${outParts.length} parts · balance strings ${Math.round(100 * st / tot)}% / ` +
    `winds ${Math.round(100 * ww / tot)}% / brass ${Math.round(100 * br / tot)}% (strings-led, brass reserved).`
  );

  return { scoreModel: out as ScoreModel, warnings };
}

export { SYMPHONIC_PARTS };
