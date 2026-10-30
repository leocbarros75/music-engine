import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pipelineMusicxmlToArrangedMusicxml } from "../../src/pipeline/pipelineMusicxmlToArrangedMusicxml";

/**
 * The alternate has to stand in for the part that actually ships.
 *
 * It is a copy of a finished part, so WHEN the copy is taken decides what is
 * in it. Taken too early it is a copy of something the player will never be
 * handed: melody protection writes the source melody into whichever part
 * carries it, and an alternate cloned before that step kept the arranger's
 * pre-protection line instead. In the symphonic orchestra that put "Violin I
 * (simplified)" a full octave ABOVE the Violin I it was meant to make easier —
 * the exact opposite of the feature, shipped and unnoticed, because nothing
 * compared the alternate with its own original.
 *
 * Two things follow, and both are checked here against the exported score
 * rather than the model, because the model is reassigned after export.
 */

const MAP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Written range and mark counts for every named part in an exported score. */
function partsOf(xml: string) {
  const names = new Map<string, string>();
  for (const m of xml.matchAll(
    /<score-part id="([^"]+)">[\s\S]*?<part-name[^>]*>([^<]*)<\/part-name>/g
  )) names.set(m[1]!, m[2]!);

  const out = new Map<string, { lo: number; hi: number; n: number; marks: number; leap: number }>();
  for (const m of xml.matchAll(/<part id="([^"]+)">([\s\S]*?)<\/part>/g)) {
    const body = m[2]!;
    const ms: number[] = [];
    for (const p of body.matchAll(
      /<pitch>\s*<step>([A-G])<\/step>\s*(?:<alter>(-?\d+)<\/alter>\s*)?<octave>(-?\d+)<\/octave>/g
    )) ms.push(12 * (Number(p[3]) + 1) + MAP[p[1]!]! + Number(p[2] ?? 0));
    if (!ms.length) continue;
    let leap = 0;
    for (let i = 1; i < ms.length; i++) leap = Math.max(leap, Math.abs(ms[i]! - ms[i - 1]!));
    out.set(names.get(m[1]!) ?? m[1]!, {
      lo: Math.min(...ms), hi: Math.max(...ms), n: ms.length, leap,
      marks: (body.match(/<repeat\b|<ending\b|<dynamics\b/g) ?? []).length,
    });
  }
  return out;
}

function arrange(src: string, settings: any) {
  const r: any = pipelineMusicxmlToArrangedMusicxml({ musicxml: src, settings });
  assert.ok(r?.ok, `pipeline failed: ${r?.error}`);
  return partsOf(String(r.musicxml));
}

// ── 1. An alternate is never written higher than the part it replaces ──
//
// Simplification is a ceiling operation: it may move a line down, or leave it
// alone, and that is all. Confirmed by the published graded editions, where the
// ceiling falls by a median of six semitones and never rises
// (tools/calibration/README.md). symphonic_orchestra is in this list because
// it is where the fault was visible.
{
  const SRC = readFileSync("tests/preservation/fixtures/holy-holy-holy.musicxml", "utf8");
  let checked = 0;
  for (const ensemble of ["string_ensemble", "orchestra", "symphonic_orchestra", "brass_ensemble"]) {
    const base = { ensemble, textureMode: "homophony_melody_accompaniment" };
    const parts = arrange(SRC, { ...base, simplifyLevel: "beginner" });
    const alts = [...parts.keys()].filter((n) => /\(simplified\)/i.test(n));
    assert.ok(alts.length > 0, `${ensemble}: no alternates were produced at all`);

    for (const alt of alts) {
      const original = parts.get(alt.replace(/\s*\(simplified\)\s*$/i, ""));
      assert.ok(original, `${ensemble}: "${alt}" has no original beside it`);
      const a = parts.get(alt)!;
      assert.ok(
        a.hi <= original!.hi,
        `${ensemble}: "${alt}" tops out at ${a.hi}, above its own original's ${original!.hi}. ` +
        `An alternate may only move a line down.`
      );
      assert.ok(
        a.lo >= original!.lo - 24,
        `${ensemble}: "${alt}" bottoms out at ${a.lo}, more than two octaves under its original's ${original!.lo}`
      );

      // And it may not ask for a WIDER jump than the part it replaces.
      //
      // Register is not the only thing that makes a part hard, and it was the
      // only thing being scored. Bringing a stubborn note down on its own used
      // to turn a trumpet's 71 71 73 73 73 71 into 71 71 61 61 61 71 — a
      // two-semitone step becoming a ten-semitone leap, in the part meant to be
      // the easier one. Over three ensembles 7 of 37 alternates came out with a
      // wider leap, the worst going from no octave leaps to eight.
      assert.ok(
        a.leap <= original!.leap,
        `${ensemble}: "${alt}" leaps ${a.leap} semitones where its original leaps at most ` +
        `${original!.leap}. A simplified part may not ask for a bigger jump than the music does.`
      );
      checked++;
    }
  }
  assert.ok(checked >= 20, `only ${checked} alternates compared; the check is too thin to mean much`);
}

// ── 2. An alternate carries the source's repeats, endings and dynamics ──
//
// This is why the clone used to be taken early — so that carrySourceMarks,
// running afterwards, would sweep the new part up with the rest. Taking it
// later works for a better reason: the donor already has the marks, and the
// alternate is a deep copy. Asserted rather than assumed, because the whole
// placement argument turns on the copy really being deep.
//
// The usual fixture is no use here: it has no repeats, endings or dynamics at
// all, so it cannot tell a part that carries them from one that does not.
{
  const SRC = readFileSync("outputs/living-hope-piano-and-strings/original-piano.musicxml", "utf8");
  const parts = arrange(SRC, { ensemble: "string_ensemble", simplifyLevel: "beginner" });
  const alts = [...parts.keys()].filter((n) => /\(simplified\)/i.test(n));
  assert.ok(alts.length > 0, "no alternates to check marks on");

  let withMarks = 0;
  for (const alt of alts) {
    const original = parts.get(alt.replace(/\s*\(simplified\)\s*$/i, ""))!;
    if (original.marks === 0) continue;   // nothing to carry
    assert.ok(
      parts.get(alt)!.marks > 0,
      `"${alt}" carries no repeats, endings or dynamics while its original carries ${original.marks}`
    );
    withMarks++;
  }
  assert.ok(withMarks > 0, "no original carried any marks; this check proved nothing");
}

console.log("ok simplifiedAlternate");
