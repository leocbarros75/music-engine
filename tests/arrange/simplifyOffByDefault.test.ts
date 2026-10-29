import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pipelineMusicxmlToArrangedMusicxml } from "../../src/pipeline/pipelineMusicxmlToArrangedMusicxml";

/**
 * Simplified parts are OFF unless they are asked for — in the product, not
 * merely in the API.
 *
 * The feature first rode on `level`, and the sweep said it changed nothing with
 * no level set, which was true and beside the point: the web app defaults
 * `level` to "intermediate" and always sends it, so every user was getting an
 * easier copy of every part without asking. The sweep could not see it because
 * the sweep sends no level at all.
 *
 * So the thing to assert is not "absent means off" but "the settings a real
 * client sends mean off" — including a level, which is what exposed it.
 */
const SRC = readFileSync("tests/preservation/fixtures/holy-holy-holy.musicxml", "utf8");

function partsFor(settings: any): string[] {
  const r: any = pipelineMusicxmlToArrangedMusicxml({ musicxml: SRC, settings });
  assert.ok(r?.ok, `pipeline failed: ${r?.error}`);
  return [...String(r.musicxml).matchAll(/<part-name>([^<]*)<\/part-name>/g)].map((m) => m[1]!);
}

// ── A level alone never adds a part ──
{
  // This is the case that shipped broken. "intermediate" is the web app's own
  // default and is sent on every request it makes.
  for (const level of ["beginner", "intermediate", "advanced", "professional"]) {
    const names = partsFor({ ensemble: "brass_ensemble", level });
    const alts = names.filter((n) => /\(simplified\)/i.test(n));
    assert.deepEqual(
      alts, [],
      `level="${level}" alone must not add simplified parts, got ${alts.join(", ")}`
    );
  }
}

// ── No settings at all, and an explicit "off", add nothing ──
{
  for (const settings of [
    { ensemble: "brass_ensemble" },
    { ensemble: "brass_ensemble", simplifyLevel: "off" },
    { ensemble: "brass_ensemble", level: "beginner", simplifyLevel: "off" },
  ]) {
    const alts = partsFor(settings).filter((n) => /\(simplified\)/i.test(n));
    assert.deepEqual(alts, [], `${JSON.stringify(settings)} must add nothing, got ${alts.join(", ")}`);
  }
}

// ── Asking for it is what turns it on ──
{
  const names = partsFor({ ensemble: "brass_ensemble", simplifyLevel: "beginner" });
  const alts = names.filter((n) => /\(simplified\)/i.test(n));
  assert.ok(alts.length > 0, "simplifyLevel=beginner should add simplified parts");
  // And the originals are all still there, untouched in name and number.
  const base = partsFor({ ensemble: "brass_ensemble" });
  for (const n of base) {
    assert.ok(names.includes(n), `the original part "${n}" disappeared`);
  }
  assert.equal(names.length, base.length + alts.length, "only alternates were added");
}

// ── A single player can be marked, with the rest of the band left alone ──
{
  // The real case is one weak player, not a weak section — so this has to work
  // with the score-wide switch OFF.
  const alts = partsFor({
    ensemble: "brass_ensemble",
    simplifyLevel: "off",
    partLevels: [{ part: "Horn 2", level: "beginner" }],
  }).filter((n) => /\(simplified\)/i.test(n));
  assert.deepEqual(alts, ["Horn 2 (simplified)"], `only the named player, got ${alts.join(", ")}`);
}

// ── And a single player can be held back while the band is simplified ──
{
  // The inverse, and the reason the override takes a level rather than a flag:
  // one reader who wants the part as written.
  const all = partsFor({ ensemble: "brass_ensemble", simplifyLevel: "beginner" })
    .filter((n) => /\(simplified\)/i.test(n));
  assert.ok(all.includes("Horn 2 (simplified)"), "Horn 2 is simplified when the band is");

  const held = partsFor({
    ensemble: "brass_ensemble",
    simplifyLevel: "beginner",
    partLevels: [{ part: "Horn 2", level: "professional" }],
  }).filter((n) => /\(simplified\)/i.test(n));
  assert.ok(!held.includes("Horn 2 (simplified)"), "Horn 2 should keep the written part");
  assert.equal(held.length, all.length - 1, "everyone else keeps their alternate");
}

console.log("simplifyOffByDefault: ok");
