import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bandFor } from "../../src/arrange/difficulty/levels";

/**
 * The calibrated bands must stay tied to the measurement that produced them.
 *
 * `STUDENT_BAND`'s violin entries are not judgement any more: they are the
 * median ceiling of eight published simplified editions, read off the
 * engravings by `tools/calibration/`. A constant that came from a measurement
 * and then quietly drifts away from it is worse than one that was always a
 * guess, because it still reads as evidence. This re-derives the numbers from
 * the recorded data and fails if the table and the data disagree.
 *
 * It also pins the finding the whole pass rests on — that simplifying lowers
 * the ceiling and leaves the floor alone — to the editions rather than to a
 * comment.
 */

type Edition = { piece: string; n: number; lo: number; hi: number };
type Tier = {
  editions: number;
  ceiling: { min: number; median: number; max: number };
  floor: { min: number; median: number; max: number };
  per_edition: Edition[];
};

// Root-relative, like every other test here: the runner spawns each file as a
// script from the repository root.
const DATA = "tools/calibration/measured-bands.json";

function median(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.floor((v[mid - 1] + v[mid]) / 2);
}

const measured = JSON.parse(readFileSync(DATA, "utf8"));
{
  const inst: Record<string, Record<string, Tier>> = measured.instruments;

  // The reader reported nothing it could not place. If that ever stops being
  // true the medians below are drawn from an unknown fraction of the notes.
  assert.deepEqual(
    measured.unassigned_notehead_warnings, [],
    "measurement has unplaced noteheads; the recorded ranges are incomplete",
  );

  for (const id of ["violin_1", "violin_2"]) {
    const simplified = inst[id]?.simplified;
    assert.ok(simplified, `no simplified editions recorded for ${id}`);
    assert.ok(
      simplified.editions >= 8,
      `${id}: only ${simplified.editions} graded editions, too few to calibrate`,
    );

    // Re-derive from the per-edition rows rather than trusting the summary,
    // so a doctored median cannot carry a wrong constant into the engine.
    const ceilings = simplified.per_edition.map((e) => e.hi);
    const rederived = median(ceilings);
    assert.equal(
      rederived, simplified.ceiling.median,
      `${id}: recorded median ${simplified.ceiling.median} is not the median of ${ceilings}`,
    );

    const band = bandFor(id, "beginner");
    assert.ok(band, `${id} has no beginner band`);
    assert.equal(
      band!.hi, rederived,
      `${id}: beginner ceiling ${band!.hi} does not match the published simplified ` +
      `editions (median ${rederived}). Re-run tools/calibration/measure_bands.py, ` +
      `or do not claim this number is measured.`,
    );
  }

  // Violin 1 is written higher than violin 2 in the editions, and the engine
  // must keep that order. Swapping the two constants would otherwise pass
  // every other check in this file.
  const v1 = bandFor("violin_1", "beginner")!;
  const v2 = bandFor("violin_2", "beginner")!;
  assert.ok(
    v1.hi > v2.hi,
    `violin 1's beginner ceiling (${v1.hi}) must sit above violin 2's (${v2.hi})`,
  );

  // The load-bearing finding: simplifying is a ceiling operation. Across the
  // graded pairs the ceiling falls and the floor does not rise. `simplify.ts`
  // only ever pushes a line down, and this is why.
  for (const id of ["violin_1", "violin_2"]) {
    const pub = inst[id].published;
    const sim = inst[id].simplified;
    assert.ok(
      sim.ceiling.median <= pub.ceiling.median,
      `${id}: simplified ceiling ${sim.ceiling.median} is above published ${pub.ceiling.median}`,
    );
    assert.ok(
      sim.floor.min <= pub.floor.min,
      `${id}: simplifying raised the floor (${pub.floor.min} -> ${sim.floor.min}); ` +
      `the ceiling-only rule in simplify.ts assumes it does not`,
    );
  }

  const v1pub = inst.violin_1.published.ceiling.median;
  const v1sim = inst.violin_1.simplified.ceiling.median;
  assert.ok(
    v1pub - v1sim >= 3,
    `violin 1's editions differ by only ${v1pub - v1sim} semitones at the top; ` +
    `that is too little to call one of them simplified`,
  );

  // Every band must stay inside the instrument, at every level.
  for (const id of ["violin_1", "violin_2"]) {
    for (const level of ["beginner", "intermediate", "advanced"] as const) {
      const b = bandFor(id, level)!;
      assert.ok(b.lo < b.hi, `${id}/${level}: empty band ${b.lo}..${b.hi}`);
      assert.ok(b.hi <= 103, `${id}/${level}: ceiling ${b.hi} is above the violin's top note`);
      assert.ok(b.lo >= 55, `${id}/${level}: floor ${b.lo} is below the open G string`);
    }
  }

  // The levels have to stay in order.
  for (const id of ["violin_1", "violin_2"]) {
    const beg = bandFor(id, "beginner")!;
    const int = bandFor(id, "intermediate")!;
    const adv = bandFor(id, "advanced")!;
    assert.ok(
      beg.hi <= int.hi && int.hi <= adv.hi,
      `${id}: levels out of order — beginner ${beg.hi}, intermediate ${int.hi}, advanced ${adv.hi}`,
    );
  }

  // And `intermediate` has to stay BELOW what the publisher asks of a
  // professional — the thing the midpoint rule got wrong. Halving the gap to
  // the catalog's B6 put intermediate on G6, a semitone under this arranger's
  // professional median. A tier named for a developing player must not quietly
  // become the professional one.
  //
  // violin_1 ONLY, and the exclusion is the point rather than a convenience. A
  // first violin is written to the top of its range, so what a professional
  // edition reaches is a fair measure of a professional's register. A second
  // violin is written low because of its ROLE: across these ten editions its
  // published and simplified ceilings are the same note, A5. Holding violin_2's
  // intermediate under that would not be asking for an easier part, it would be
  // asking for a second violin part — a statement about scoring, not about the
  // player. Applying this reference there is the mistake it exists to catch.
  //
  // The reference is the HARDEST simplified edition in the pack, not the
  // professional median. "Below the professional median" sounds like the right
  // test and is nearly useless: the midpoint rule produced G6, one semitone
  // under the median, and would have passed it. The ceiling of the most
  // demanding simplified part a publisher actually wrote is a real limit, and
  // it is where E6 comes from.
  {
    const int = bandFor("violin_1", "intermediate")!;
    const hardestSimplified = inst.violin_1.simplified.ceiling.max;
    const proMedian = inst.violin_1.published.ceiling.median;
    assert.ok(
      int.hi <= hardestSimplified,
      `violin_1: intermediate tops out at ${int.hi}, above the hardest published simplified ` +
      `edition's ${hardestSimplified}. An intermediate player should not be asked for more ` +
      `than the most demanding simplified part in print.`,
    );
    assert.ok(
      int.hi < proMedian,
      `violin_1: intermediate (${int.hi}) has reached the published professional median ` +
      `(${proMedian}). That is not an intermediate part.`,
    );
  }

  // And the alternate levels must still differ, or the tier is decorative.
  assert.ok(
    bandFor("violin_1", "intermediate")!.hi > bandFor("violin_1", "beginner")!.hi,
    "violin_1: intermediate and beginner have collapsed onto the same ceiling",
  );

  // Neither violin's intermediate may be STRICTER than published simplified
  // practice. An intermediate player being handed less than the hardest part a
  // publisher already calls simplified would be the feature working backwards.
  for (const id of ["violin_1", "violin_2"]) {
    const int = bandFor(id, "intermediate")!;
    const hardest = inst[id].simplified.ceiling.max;
    assert.ok(
      int.hi >= hardest,
      `${id}: intermediate ceiling ${int.hi} is below the hardest published simplified ` +
      `edition's ${hardest} — an intermediate player would get less than a simplified part`,
    );
  }

  // The second line stays under the first, as the editions draw it.
  assert.ok(
    bandFor("violin_2", "intermediate")!.hi < bandFor("violin_1", "intermediate")!.hi,
    `violin_2's intermediate ceiling (${bandFor("violin_2", "intermediate")!.hi}) has caught ` +
    `violin_1's (${bandFor("violin_1", "intermediate")!.hi})`,
  );

  // What the number DOES, not what it is. A ceiling is only meaningful through
  // the parts it would and would not rewrite, so check it against the real
  // editions: it must leave every published simplified second violin alone, and
  // act on at most the single outlier among the professional ones (nine of ten
  // stop at B5; O Holy Night climbs to E6). Set it to A5 and this fails at
  // three; set it to E6 and the tier stops doing anything at all.
  {
    const int = bandFor("violin_2", "intermediate")!.hi;
    const pro = inst.violin_2.published.per_edition.map((e) => e.hi);
    const sim = inst.violin_2.simplified.per_edition.map((e) => e.hi);
    const rewritesSimplified = sim.filter((h) => h > int).length;
    const rewritesPro = pro.filter((h) => h > int).length;
    assert.equal(
      rewritesSimplified, 0,
      `violin_2: an intermediate ceiling of ${int} would rewrite ${rewritesSimplified} of ` +
      `${sim.length} parts the publisher already calls simplified`,
    );
    assert.ok(
      rewritesPro >= 1 && rewritesPro <= 2,
      `violin_2: an intermediate ceiling of ${int} would rewrite ${rewritesPro} of ` +
      `${pro.length} published professional parts — ${rewritesPro === 0
        ? "the tier is doing nothing" : "that is ordinary second violin writing, not an outlier"}`,
    );
  }
}
