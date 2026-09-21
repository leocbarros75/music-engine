import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getInstrumentSpec } from '../../src/instruments/instrumentCatalog';
import { WOODWIND_RANGES } from '../../src/arrange/woodwinds/woodwindRanges';
import { BRASS_RANGES } from '../../src/arrange/brass/brassRanges';

/**
 * An editorial range says how much of an instrument we choose to write for. The
 * instrument catalog says what the instrument can play. The first must be a
 * NARROWING of the second, never a widening.
 *
 * This is not pedantry. The piano-copy arrangers place a note with the
 * editorial range and then clamp it with the catalog, so an editorial ceiling
 * above the catalog's is a claim the code cannot honour — and the disagreement
 * is silent. The trombone's ceiling read C5 while the catalog capped it at
 * Bb4, and a register rule written against C5 could never fire: it produced
 * byte-identical output and looked correct for it.
 */
const PAIRS: Array<[string, { absMin: number; absMax: number; prefMin: number; prefMax: number }, string]> = [
  ['flute', WOODWIND_RANGES.fl, 'flute'],
  ['oboe', WOODWIND_RANGES.ob, 'oboe'],
  ['clarinet', WOODWIND_RANGES.cl, 'clarinet_bb'],
  ['bassoon', WOODWIND_RANGES.bn, 'bassoon'],
  ['horn (woodwind quintet)', WOODWIND_RANGES.hn, 'horn_f'],
  ['trumpet 1', BRASS_RANGES.tpt1, 'tpt1'],
  ['trumpet 2', BRASS_RANGES.tpt2, 'tpt2'],
  ['horn', BRASS_RANGES.hn, 'hn'],
  ['trombone', BRASS_RANGES.tbn, 'tbn'],
  ['tuba', BRASS_RANGES.tuba, 'tuba_c'],
];

test('every editorial range names an instrument the catalog knows', () => {
  for (const [name, , specId] of PAIRS)
    assert(getInstrumentSpec(specId), `${name}: the catalog has no "${specId}"`);
});

test('no editorial range claims more than the instrument can play', () => {
  const widened: string[] = [];
  for (const [name, r, specId] of PAIRS) {
    const spec = getInstrumentSpec(specId) as any;
    if (!spec) continue;
    if (r.absMin < spec.midi_low)
      widened.push(`${name}: floor ${r.absMin} is below the catalog's ${spec.midi_low}`);
    if (r.absMax > spec.midi_high)
      widened.push(`${name}: ceiling ${r.absMax} is above the catalog's ${spec.midi_high}`);
  }
  assert.deepEqual(widened, [],
    'an editorial range must narrow the catalog, never widen it — otherwise the ' +
    'clamp silently overrides what this table says and code written against it ' +
    'does nothing:\n  ' + widened.join('\n  '));
});

test('a preferred band sits inside its own absolute range', () => {
  for (const [name, r] of PAIRS) {
    assert(r.prefMin >= r.absMin, `${name}: prefMin ${r.prefMin} below absMin ${r.absMin}`);
    assert(r.prefMax <= r.absMax, `${name}: prefMax ${r.prefMax} above absMax ${r.absMax}`);
    assert(r.prefMin < r.prefMax, `${name}: empty preferred band`);
  }
});

test('the effective range is the editorial one, with nothing lost to the clamp', () => {
  // The point of the invariant above: intersecting with the catalog is a
  // no-op, so what the table says is what the arrangers do.
  for (const [name, r, specId] of PAIRS) {
    const spec = getInstrumentSpec(specId) as any;
    if (!spec) continue;
    assert.deepEqual(
      [Math.max(r.absMin, spec.midi_low), Math.min(r.absMax, spec.midi_high)],
      [r.absMin, r.absMax],
      `${name}: the catalog narrows this range, so the table overstates it`
    );
  }
});
