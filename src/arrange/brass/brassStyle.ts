// src/arrange/brass/brassStyle.ts
//
// Brass ensemble style system — mirrors the woodwind style module.

import type { ProfileId } from "../strings/types";

export type BrassTexture =
  | "melody_harmony"   // Trumpet 1 leads; others accompany (default)
  | "chamber"          // balanced quintet — all voices ~equally active (pop/jazz, calibrated)
  | "chorale"          // homophonic block (hymn / brass-chorale — very idiomatic)
  | "fanfare"          // bright, leap-friendly, all upper voices active (ceremonial)
  | "contrapuntal";    // independent imitative lines (Gabrieli / fugal)

export function brassTextureToProfile(
  texture: BrassTexture | undefined,
  styleRaw: string,
  polyphonic: boolean
): ProfileId {
  if (texture === "contrapuntal" || polyphonic) return "countermelody";
  if (texture === "chorale")  return "bach_chorale";
  if (styleRaw === "baroque") return "bach_chorale";
  // chamber + fanfare + melody_harmony use the balanced melody+harmony profile.
  return "melody_harmony";
}

export type BrassActivity = "grounded" | "less_active" | "active" | "high_active";

/**
 * Per-instrument activity per texture (controls rhythmic density), calibrated
 * from the brass data (Sousa march + 1812 + Zarathustra):
 *   chorale        — block hymn: every voice moves together
 *   fanfare        — all upper voices brilliant & active; tuba/trombone ground it
 *   melody_harmony — Trumpet 1 leads over a calmer accompaniment; tuba grounded
 *   (contrapuntal handled by the polyphonic engine; activity ignored there)
 */
export function brassTextureToActivity(
  texture: BrassTexture | undefined
): Partial<Record<"tpt1" | "tpt2" | "hn" | "tbn" | "tuba", BrassActivity>> {
  switch (texture) {
    case "chorale":
      return { tpt1: "active", tpt2: "active", hn: "active", tbn: "active", tuba: "active" };
    case "chamber":
      // Calibrated from 3 real brass quintets: all five voices are nearly equally
      // active (≈970–1075 notes each), incl. a walking tuba (49% stepwise).
      return { tpt1: "active", tpt2: "active", hn: "active", tbn: "active", tuba: "active" };
    case "fanfare":
      return { tpt1: "active", tpt2: "active", hn: "active", tbn: "less_active", tuba: "grounded" };
    case "melody_harmony":
    default:
      return { tpt1: "active", tpt2: "less_active", hn: "less_active", tbn: "less_active", tuba: "grounded" };
  }
}

// ── Reference brass-ensemble examples → composer/period style + default texture
export type BrassExample = { value: string; label: string; composer: string; texture: BrassTexture; help: string };

export const BRASS_EXAMPLES: BrassExample[] = [
  { value: "gabrieli_canzona", label: "Gabrieli — Canzona (antiphonal)", composer: "bach", texture: "contrapuntal",
    help: "Renaissance/Baroque antiphonal brass — independent imitative lines." },
  { value: "brass_chorale",    label: "Brass chorale (hymn)",            composer: "bach", texture: "chorale",
    help: "Block hymn voicing — the core brass-choir sound, strict voice-leading." },
  { value: "fanfare",          label: "Ceremonial fanfare",              composer: "handel", texture: "fanfare",
    help: "Bright ceremonial brass — active trumpets/horns, arpeggiated, grounded tuba." },
  { value: "sousa_brass",      label: "Sousa — March brass",             composer: "haydn", texture: "melody_harmony",
    help: "March style — stepwise trumpet tune over an oom-pah accompaniment." },
  { value: "popjazz_quintet",  label: "Pop / Jazz brass quintet",        composer: "dvorak", texture: "chamber",
    help: "Calibrated from real brass quintets — all five voices equally active, walking tuba bass." },
];

export function brassExampleToComposer(id: string): string | null {
  return BRASS_EXAMPLES.find((e) => e.value === id)?.composer ?? null;
}
export function brassExampleToTexture(id: string): BrassTexture | null {
  return BRASS_EXAMPLES.find((e) => e.value === id)?.texture ?? null;
}
