import assert from "node:assert/strict";
import { shareBrassMelody, shareBrassMelodySentence } from "../../src/arrange/brass/shareMelody";
import { gateBrassParticipation } from "../../src/arrange/brass/participation";
import { midiToPitch, pitchToMidi } from "../../src/instruments/instrumentCatalog";
import { BRASS_RANGES } from "../../src/arrange/brass/brassRanges";

/**
 * Who has the tune, and who must get out of its way.
 *
 * The first trumpet carried the melody in every bar, so the participation gate
 * had to keep it in every bar the chart filled — 61 off against the reference's
 * 84. Measuring the reference's top SOUNDING voice block by block (its trumpets
 * read down a major second, its horns down a fifth) the lead goes to Horn 1 for
 * 10 blocks of 16 and to the trumpets for 3 each. The horn is the workhorse
 * because a horn can play a whole chart and a trumpet cannot.
 */

const NAMES = ["Trumpet 1", "Trumpet 2", "Horn in F", "Trombone", "Tuba"];

/** Five parts; the first trumpet gets `melody`, everyone else a held note. */
function brassParts(melody: number[], inner = 55): any[] {
  return NAMES.map((name, p) => ({
    part_id: `P${p}`,
    name,
    measures: melody.map((m, i) => ({
      number: i + 1,
      events: [{
        type: "note", t: 0, dur: 4,
        pitch: midiToPitch(p === 0 ? m : inner),
        id: `${name}-${i}`,
      }],
    })),
  }));
}

function sourceOf(kinds: string): any {
  return {
    measures: [...kinds].map((k, i) => ({
      number: i + 1,
      events:
        k === "E" ? []
        : k === "S"
          ? [{ type: "note", t: 0, dur: 1, notehead: "slash", pitch: { step: "C", octave: 5 } }]
          : [{ type: "note", t: 0, dur: 1, pitch: { step: "C", octave: 5 } }],
    })),
  };
}

const find = (parts: any[], re: RegExp) => parts.find((p) => re.test(String(p.name)))!;
const sounds = (part: any, i: number) =>
  (part.measures?.[i]?.events ?? []).some((e: any) => e?.type === "note" && !e.grace);
const midisOf = (part: any) =>
  (part.measures ?? []).map((m: any) => {
    const n = (m.events ?? []).find((e: any) => e.type === "note");
    return n ? pitchToMidi(n.pitch) : NaN;
  });

// 24 bars = three blocks. ROTATION is tpt1, hn, tpt2, ...
const BARS = 24;
// 80-84: inside the first trumpet (52-86) and above the horn's ceiling of 77,
// which is the situation on the real chart, where the melody reaches 84.
const MELODY = Array.from({ length: BARS }, (_, i) => 80 + (i % 5));

// ── The horn takes the majority of the blocks ──────────────────────────────
{
  const parts = brassParts(Array.from({ length: 64 }, (_, i) => 72 + (i % 5)));
  const { plans } = shareBrassMelody(parts);
  const by = new Map(plans.map((p) => [p.lead, p.blocks]));
  const hn = by.get("Horn in F") ?? 0;
  const t1 = by.get("Trumpet 1") ?? 0;
  const t2 = by.get("Trumpet 2") ?? 0;
  assert.ok(hn > t1 + t2,
    `the horn should lead more than both trumpets together, got horn ${hn} vs ${t1}+${t2}`);
  assert.equal(hn, 5, "five of every eight blocks");
}

// ── The tune actually moves, and the trumpet takes the line it gave up ─────
{
  const parts = brassParts(MELODY);
  const { leadByBar } = shareBrassMelody(parts);
  const tpt1 = find(parts, /^trumpet 1/i);
  const hn = find(parts, /^horn/i);

  // Block 0 is the trumpet's; block 1 (bars 8-15) is the horn's.
  assert.deepEqual(midisOf(tpt1).slice(0, 8), MELODY.slice(0, 8),
    "the trumpet keeps its own block");
  assert.ok(leadByBar.slice(8, 16).every((v) => v === "hn"), "the horn leads block 1");
  assert.ok(midisOf(tpt1).slice(8, 16).every((v) => v === 55),
    "the trumpet reads the line the horn gave up");

  // The horn has the tune there — an octave down, because its ceiling is 77.
  const hornBlock = midisOf(hn).slice(8, 16);
  assert.deepEqual(hornBlock, MELODY.slice(8, 16).map((m) => m - 12),
    "the horn takes the same tune, an octave lower");
  for (const v of hornBlock) {
    assert.ok(v >= BRASS_RANGES.hn.absMin && v <= BRASS_RANGES.hn.absMax,
      `${v} is outside the horn's range`);
  }
  // The trombone and tuba are not in the rotation.
  assert.ok(midisOf(find(parts, /^tuba/i)).every((v) => v === 55), "the tuba is untouched");
}

// ── A line the horn can reach is left where it is ──────────────────────────
{
  // 60-64 is inside the horn (35-77), so there is nothing to fix.
  const low = Array.from({ length: BARS }, (_, i) => 60 + (i % 5));
  const parts = brassParts(low);
  shareBrassMelody(parts);
  assert.deepEqual(midisOf(find(parts, /^horn/i)).slice(8, 16), low.slice(8, 16),
    "a reachable line is not transposed");
}

// ── Neither trumpet sits above the horn's tune ─────────────────────────────
{
  const kinds = "M".repeat(BARS);
  const parts = brassParts(MELODY);
  const { leadByBar } = shareBrassMelody(parts);
  gateBrassParticipation(parts, sourceOf(kinds), leadByBar);

  const tpt1 = find(parts, /^trumpet 1/i);
  const tpt2 = find(parts, /^trumpet 2/i);
  const hn = find(parts, /^horn/i);

  for (let i = 8; i < 16; i++) {
    // Over, not instead of: where the horn is breathing a trumpet is allowed
    // to cover the bar, and that is the only reason either should be heard
    // inside the horn's block.
    if (!sounds(hn, i)) continue;
    assert.ok(!sounds(tpt1, i), `Trumpet 1 plays over the horn's tune at bar ${i + 1}`);
    assert.ok(!sounds(tpt2, i),
      `Trumpet 2 plays over the horn's tune at bar ${i + 1} — that buries the melody`);
  }
  // And the horn is actually there to be heard.
  let heard = 0;
  for (let i = 8; i < 16; i++) if (sounds(hn, i)) heard++;
  assert.ok(heard >= 7, `the horn should hold its block, sounding in ${heard} of 8 bars`);
}

// ── The lead is never dropped for a whole section ──────────────────────────
{
  // A tune-less passage overlapping the trumpet's own block: it must not be
  // silenced where it is the one leading a melody bar.
  const kinds = "MMMMMMMM" + "SSSSSS" + "MMMMMMMMMM";
  const parts = brassParts(MELODY);
  const { leadByBar } = shareBrassMelody(parts);
  gateBrassParticipation(parts, sourceOf(kinds), leadByBar);
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] !== "M") continue;
    const lead = leadByBar[i];
    const part = parts.find((p) =>
      (lead === "hn" ? /^horn/i : lead === "tpt2" ? /^trumpet 2/i : /^trumpet 1/i)
        .test(String(p.name)))!;
    // The horn is allowed its one-bar breath; the trumpets are not allowed to
    // hand back a section.
    if (lead !== "hn") {
      assert.ok(sounds(part, i),
        `bar ${i + 1}: ${lead} holds the tune and was silenced anyway`);
    }
  }
}

// ── A melody bar never loses its tune ─────────────────────────────────────
{
  // The horn breathes on a fixed count and both trumpets are out under a
  // horn-led passage. Together those took the tune out of 6 melody bars of the
  // real chart — trombone and tuba holding harmony under nothing at all.
  const kinds = "M".repeat(64);
  const parts = brassParts(Array.from({ length: 64 }, (_, i) => 80 + (i % 5)));
  const { leadByBar } = shareBrassMelody(parts);
  gateBrassParticipation(parts, sourceOf(kinds), leadByBar);

  const melodic = parts.filter((p) => /trumpet|horn/i.test(String(p.name)));
  for (let i = 0; i < kinds.length; i++) {
    assert.ok(melodic.some((p) => sounds(p, i)),
      `bar ${i + 1} is a melody bar with no trumpet and no horn — the tune vanished`);
  }
  assert.ok(leadByBar.some((v) => v === "hn"), "the horn does lead somewhere here");
}

// ── The horn still breathes while it leads ─────────────────────────────────
{
  const kinds = "M".repeat(64);
  const parts = brassParts(Array.from({ length: 64 }, (_, i) => 60 + (i % 5)));
  const { leadByBar } = shareBrassMelody(parts);
  gateBrassParticipation(parts, sourceOf(kinds), leadByBar);
  const hn = find(parts, /^horn/i);
  let breaths = 0;
  for (let i = 0; i < 64; i++) if (!sounds(hn, i) && leadByBar[i] === "hn") breaths++;
  assert.ok(breaths > 0,
    "the horn carries most of the chart and must still be allowed to breathe");
}

// ── Reporting and degenerate cases ────────────────────────────────────────
{
  assert.equal(shareBrassMelodySentence([]), null);
  assert.equal(shareBrassMelodySentence([{ lead: "Horn in F", blocks: 5 }]), null,
    "one leader is not sharing");
  const line = shareBrassMelodySentence([
    { lead: "Horn in F", blocks: 10 }, { lead: "Trumpet 1", blocks: 4 },
  ]);
  assert.ok(line && /Horn in F 10/.test(line));

  assert.deepEqual(shareBrassMelody([]).plans, []);
  const onlyHorn = [{ part_id: "P", name: "Horn in F", measures: [{ number: 1, events: [] }] }];
  assert.deepEqual(shareBrassMelody(onlyHorn).plans, [], "no trumpet to share from");
}

console.log("PASS brass melody sharing");
