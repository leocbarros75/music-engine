// src/arrange/woodwinds/woodwindStyle.ts
//
// Woodwind ensemble style system — mirrors the string ensemble's texture /
// example / composer settings so the wind auto arranger has full parity.

import type { ProfileId } from "../strings/types";

// ── Woodwind texture modes → DP profile ──────────────────────────────────────
// These select the voice-leading profile used by the underlying string DP.
export type WoodwindTexture =
  | "melody_harmony"   // Flute leads; Ob/Cl/Bn accompany (default)
  | "chorale"          // homophonic block, all voices balanced (hymn/Bach-like)
  | "contrapuntal"     // independent imitative lines (counterpoint)
  | "chamber";         // balanced dialogue, moderate independence

export function woodwindTextureToProfile(
  texture: WoodwindTexture | undefined,
  styleRaw: string,
  polyphonic: boolean
): ProfileId {
  // Explicit counterpoint / polyphonic request wins.
  if (texture === "contrapuntal" || polyphonic) return "countermelody";
  if (texture === "chorale")  return "bach_chorale";
  // Baroque style defaults to the chorale-calibrated profile.
  if (styleRaw === "baroque") return "bach_chorale";
  if (texture === "chamber")  return "melody_harmony";
  return "melody_harmony";
}

// ── Reference wind-ensemble examples → composer/period style ──────────────────
// Each example sets a composer profile (reusing the calibrated string composer
// profiles — period voice-leading is instrument-agnostic) plus a default texture.
export type WoodwindExample = {
  value: string;
  label: string;
  composer: string;            // key into COMPOSER_PROFILES (strings/composerProfiles.ts)
  texture: WoodwindTexture;
  help: string;
};

export const WOODWIND_EXAMPLES: WoodwindExample[] = [
  // Classical wind serenades / quintets
  { value: "mozart_k361_gran_partita", label: "Mozart — Gran Partita K.361", composer: "mozart", texture: "melody_harmony",
    help: "Classical wind serenade — clear melody+harmony, light textures, Alberti-style inner motion." },
  { value: "mozart_k388_serenade",     label: "Mozart — Serenade K.388",      composer: "mozart", texture: "chamber",
    help: "Darker C-minor wind octet — balanced chamber dialogue." },
  { value: "mozart_k452_quintet",      label: "Mozart — Quintet K.452 (piano+winds)", composer: "mozart", texture: "chamber",
    help: "Conversational classical balance between the wind voices." },
  { value: "beethoven_op16_quintet",   label: "Beethoven — Quintet Op.16",    composer: "beethoven", texture: "melody_harmony",
    help: "Classical-dramatic: stronger dynamic contrast, more independent lines." },
  // Wind-quintet canon (Romantic)
  { value: "reicha_quintet",           label: "Reicha — Wind Quintet Op.88/91", composer: "haydn", texture: "chamber",
    help: "Foundational wind-quintet idiom — equal, conversational voices." },
  { value: "danzi_quintet",            label: "Danzi — Wind Quintet Op.56/67",  composer: "mozart", texture: "melody_harmony",
    help: "Graceful early-Romantic wind quintet — singing flute/oboe over light support." },
  { value: "nielsen_quintet",          label: "Nielsen — Wind Quintet Op.43",   composer: "brahms", texture: "contrapuntal",
    help: "Each instrument strongly characterised — independent, contrapuntal lines." },
  // Baroque (transcriptions)
  { value: "bach_chorale_winds",       label: "Bach — Chorale (wind transcription)", composer: "bach", texture: "chorale",
    help: "Strict 4/5-part chorale: balanced block voicing, no parallels." },
  { value: "handel_winds",             label: "Handel — Wind movement",         composer: "handel", texture: "melody_harmony",
    help: "Baroque clarity: walking bassoon bass, balanced upper voices." },
];

export function woodwindExampleToComposer(exampleId: string): string | null {
  return WOODWIND_EXAMPLES.find((e) => e.value === exampleId)?.composer ?? null;
}

export function woodwindExampleToTexture(exampleId: string): WoodwindTexture | null {
  return WOODWIND_EXAMPLES.find((e) => e.value === exampleId)?.texture ?? null;
}
