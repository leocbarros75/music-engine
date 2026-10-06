import { midiToPitch, pitchToMidi, getInstrumentSpec } from "../../instruments/instrumentCatalog";

/**
 * Seventeen chairs, not eight.
 *
 * Our jazz route builds an octet — one alto, one tenor, one trumpet, one
 * trombone and a four-piece rhythm section — which is a playable small band,
 * but the reference edition of this chart is a full big band of seventeen, and
 * measured against it the missing nine are a second alto, a second tenor, a
 * baritone, three more trumpets and three more trombones.
 *
 * What the measurement showed, and what this file is shaped by, is that the two
 * sections are NOT scored alike:
 *
 *   AS1  462 notes  67% sounding  0 bars off      TP1   75 notes   9%  103 off
 *   AS2  349         56%          1               TP2   40         5%  108
 *   TS1  401         66%          1               TP3   40         5%  108
 *   TS2  335         57%          1               TP4   40         5%  108
 *   BS   337         57%          1               TB1  106        16%   90
 *                                                 TB2   41         5%  106
 *                                                 TB3   41         5%  106
 *                                                 BT    41         5%  106
 *
 * The saxophones carry the chart as a five-part block that essentially never
 * stops. The brass punctuates: a dozen-odd bars each, silent in 90 to 108 of
 * 124. So the derived saxes double their donors throughout and the derived
 * brass plays only on the punches — which is the single most important thing
 * here, because nine more parts at the donors' own 66% would be a wall of
 * sound, not a big band.
 *
 * Two facts from the reference made the derivation method obvious rather than
 * invented. Its own harmony plan carries a four-part `voicing.saxophones` map
 * (BS, TS2, TS1, AS2) under a lead that is not in it — so the lower four
 * saxophones harmonise a line the first alto states. And within each brass
 * sub-section the onsets are BYTE-IDENTICAL: TP2, TP3 and TP4 share all 40 of
 * their onsets, TB2, TB3 and BT all 41 of theirs. They double one rhythm.
 *
 * So, exactly as the brass section's expansion does: nothing is composed. Each
 * derived part doubles its donor's rhythm and takes a chord tone the band is
 * already sounding at that instant, inside the register the reference measures
 * for that chair. The harmony stays the voicing's; only the spacing is new.
 */

/** A derived part sits at least a whole tone under its donor, never a semitone. */
const MIN_GAP = 2;

/** How far below its donor a chair may reach for a chord tone. */
const MAX_DROP = 14;

/** How far outside its measured register a chair may sit before it is counted. */
const BAND_SLACK = 2;

/**
 * The octave a chair may be moved by, and only downwards.
 *
 * Every candidate note is already below its donor, so a downward shift can
 * never cross above the line it harmonises; an upward one could. Restricting
 * the choice to zero or octaves down makes the crossing impossible rather than
 * checked for.
 */
const OCTAVE_CHOICES = [0, -12, -24];

/**
 * What one note pulled back inside the instrument costs, against one note
 * merely sitting outside the chair's measured register.
 *
 * Measured on the real chart, every weight from 0 to 7 gives the SAME octave to
 * all nine chairs, and 8 upwards puts the Baritone Sax back an octave high. So
 * this number is not finely tuned and should not be read as if it were: what
 * mattered was that the term stopped being a veto. Three sits in the middle of
 * the range that works, so a clamped note counts for something without being
 * able to decide the register on its own.
 */
const CLAMP_COST = 3;

/**
 * Where the lead rests on a punch bar, the punch comes off the piano's comp.
 *
 * All four of our horns are written from one set of onsets, so they fall silent
 * in the same 31 bars — and those bars cluster at 67-104, which is where the
 * eight-bar grid lands six of its thirteen punches. Doubling a rhythm that is
 * not there yields nothing, so the trumpets reached 7 bars against the
 * reference's 16.
 *
 * The reference's own brass is busiest in exactly that stretch — TP2 plays bars
 * 88, 89, 93, 96, 97, 100, 101 — because a big band's brass answers the holes
 * the saxes leave rather than shadowing them. The piano is the only pitched part
 * that never rests, and it comps off the beat, so its onsets in those bars give
 * the section a syncopated punch, which is the reference's own name for what
 * these parts play. Still derived, not composed: the rhythm is the piano's and
 * the pitch is the bar's chord.
 */
const MAX_PUNCH_HITS = 3;

/**
 * The brass punches on an eight-bar hypermetre, and enters late.
 *
 * The reference's punch bars are its own editorial section map — trumpets on
 * bars 32, 36, 56, 60, 62, 80, 88, 89, 93, 96, 97, 100, 101, 104, 114, 123 —
 * and we have no section map to read, so the placement cannot be reproduced.
 * The COUNT and the shape can. An eight-bar grid from a late entry gives the
 * trombones 16 bars against its 18 and the trumpets 13 against its 16, with the
 * same late entry and the same final-bar tutti; a four-bar grid gave 28 and 24,
 * which is twice the reference's weight. Measured in bars played, not in
 * placement, this is the closer fit.
 */
const PHRASE_BARS = 4;
const PUNCH_EVERY = 8;

/**
 * Where each brass sub-section comes in, as a fraction of the chart.
 *
 * The reference brings the trombones in at bar 8 and the trumpets at bar 32 of
 * 124 — a sixteenth and a quarter of the way through. Held as fractions these
 * reproduce those two bars exactly once rounded up to a phrase boundary, and
 * still mean something on a chart that is not 124 bars long; held as the
 * constants 8 and 32 they would silence the trumpets on anything shorter.
 */
const TROMBONE_ENTRY = 1 / 16;
const TRUMPET_ENTRY = 1 / 4;

type Punch = "trumpet" | "trombone";

type Chair = {
  id: string;
  name: string;
  instrument: string;
  /** The part whose rhythm this one doubles, by name. */
  donor: RegExp;
  /** Insert after this part, by name, to keep big-band score order. */
  after: RegExp;
  /**
   * The register this chair occupies, measured from the reference edition and
   * stated in concert pitch (its parts are written, so alto is -9, tenor -14,
   * baritone -21 and trumpet -2 from the printed range).
   */
  band: { lo: number; hi: number };
  /** Set when this chair punctuates rather than carries. */
  punch?: Punch;
  /**
   * Set on the top chair of a punching sub-section — the one whose donor is a
   * lead line rather than another derived chair. Only this chair falls back to
   * the piano's rhythm when the lead rests, because the chairs under it derive
   * from it and so inherit the fallback for free.
   */
  punchLead?: boolean;
};

const CHAIRS: Chair[] = [
  // --- Saxophones: a five-part block that carries. No punch gate.
  { id: "ASX2", name: "Alto Sax 2", instrument: "alto_sax_eb",
    donor: /^alto sax$/i, after: /^alto sax$/i, band: { lo: 59, hi: 78 } },
  { id: "TSX2", name: "Tenor Sax 2", instrument: "tenor_sax_bb",
    donor: /^tenor sax$/i, after: /^tenor sax$/i, band: { lo: 51, hi: 66 } },
  // The baritone derives from the SECOND tenor, not the first: it is the floor
  // of the section, and the brass section's bass trombone taught us that
  // reaching down from a donor two chairs up opens a gap the next voice cannot
  // fill. Deriving from the chair directly above keeps the stack close.
  { id: "BSX", name: "Baritone Sax", instrument: "baritone_sax_eb",
    donor: /^tenor sax 2$/i, after: /^tenor sax 2$/i, band: { lo: 40, hi: 52 } },

  // --- Brass: punctuation. Each derives from the chair above it.
  { id: "TPT2", name: "Trumpet 2", instrument: "trumpet_bb_2",
    donor: /^trumpet$/i, after: /^trumpet$/i, band: { lo: 66, hi: 75 },
    punch: "trumpet", punchLead: true },
  { id: "TPT3", name: "Trumpet 3", instrument: "trumpet_bb_2",
    donor: /^trumpet 2$/i, after: /^trumpet 2$/i, band: { lo: 63, hi: 71 }, punch: "trumpet" },
  { id: "TPT4", name: "Trumpet 4", instrument: "trumpet_bb_2",
    donor: /^trumpet 3$/i, after: /^trumpet 3$/i, band: { lo: 59, hi: 66 }, punch: "trumpet" },
  { id: "TBN2", name: "Trombone 2", instrument: "trombone",
    donor: /^trombone$/i, after: /^trombone$/i, band: { lo: 54, hi: 59 },
    punch: "trombone", punchLead: true },
  { id: "TBN3", name: "Trombone 3", instrument: "trombone",
    donor: /^trombone 2$/i, after: /^trombone 2$/i, band: { lo: 46, hi: 53 }, punch: "trombone" },
  { id: "BTBN", name: "Bass Trombone", instrument: "bass_trombone",
    donor: /^trombone 3$/i, after: /^trombone 3$/i, band: { lo: 40, hi: 42 }, punch: "trombone" },
];

export type ChairPlan = {
  part: string;
  from: string;
  notes: number;
  /** Bars this chair plays in. */
  bars: number;
  /** Notes placed outside the chair's measured register, nothing else fitting. */
  outside: number;
  /** Notes that had to double the donor at the unison or octave. */
  doubled: number;
};

/** The next phrase boundary at or after `bar`. */
function toPhrase(bar: number): number {
  return Math.ceil(bar / PHRASE_BARS) * PHRASE_BARS;
}

/**
 * The bars a brass sub-section punches on: an eight-bar grid from its entry,
 * plus the last bar of the chart, where the reference puts a tutti chord in
 * every brass part ("final B-major voicing" is the role it gives all eight).
 */
export function punchBars(kind: Punch, barCount: number): Set<number> {
  const entry = toPhrase(barCount * (kind === "trumpet" ? TRUMPET_ENTRY : TROMBONE_ENTRY));
  const out = new Set<number>();
  for (let b = entry; b < barCount; b += PUNCH_EVERY) out.add(b);
  if (barCount > 0) out.add(barCount - 1);
  return out;
}

function eventMidi(ev: any): number | null {
  if (!ev?.pitch) return null;
  try { return pitchToMidi(ev.pitch); } catch { return null; }
}

function isNote(e: any): boolean {
  return e?.type === "note" && !e.grace;
}

/** Playable range for a chair, from the instrument catalog rather than invented. */
function playable(instrument: string, band: { lo: number; hi: number }) {
  const spec = getInstrumentSpec(instrument);
  return {
    lo: spec ? spec.midi_low : band.lo - 12,
    hi: spec ? spec.midi_high : band.hi + 12,
  };
}

/**
 * The next chord tone below the donor's note — the whole of the harmonic
 * decision, and the reason the derived line follows the lead.
 *
 * Choosing by nearest-below rather than by nearest-to-a-target register is what
 * keeps the contour. The first attempt picked, of the chord tones available, the
 * one closest to the middle of the chair's measured band, and the Baritone Sax
 * came out THREE SEMITONES WIDE across 124 bars where the reference edition's
 * spans twelve: asking every note to be near one pitch collapses the line onto
 * that pitch. A section chair takes the next tone down from the chair above it,
 * so when the lead rises it rises with it.
 */
export function chordToneBelow(from: number, pcs: Set<number>, floor: number): number | null {
  for (let m = from - MIN_GAP; m >= Math.max(floor, from - MAX_DROP); m--) {
    if (pcs.has(((m % 12) + 12) % 12)) return m;
  }
  return null;
}

/**
 * Which octave this chair's line sits in, judged on the whole line at once.
 *
 * The register is a property of the chair, not of the note: a baritone player
 * does not hop octaves bar to bar to stay near the middle of their range. So
 * the chord-tone line is built first and shifted by ONE constant, chosen for
 * how much of the line it lands inside the measured band — the same lesson the
 * brass arranger's sweet-spot pass learned, where judging each note separately
 * let six outliers dictate where two hundred went.
 */
export function chooseOctave(
  line: number[],
  chair: { band: { lo: number; hi: number }; instrument: string }
): number {
  if (!line.length) return 0;
  const hard = playable(chair.instrument, chair.band);
  const centre = (chair.band.lo + chair.band.hi) / 2;

  let best = 0;
  let bestScore = Infinity;
  for (const o of OCTAVE_CHOICES) {
    let outside = 0;
    let unplayable = 0;
    let drift = 0;
    for (const raw of line) {
      const m = raw + o;
      if (m < chair.band.lo - BAND_SLACK || m > chair.band.hi + BAND_SLACK) outside++;
      if (m < hard.lo || m > hard.hi) unplayable++;
      drift += Math.abs(m - centre);
    }
    // A note that falls off the end of the instrument is pulled back by an
    // octave when it is written, so it costs the line its contour at that point
    // — worse than merely sitting outside the measured band, but NOT
    // disqualifying, because it is already handled.
    //
    // Weighting it as disqualifying was this pass's own version of a fault the
    // brass arranger had: fourteen notes of the Baritone Sax's three hundred and
    // ninety-two fall under the instrument an octave down, and treating that as
    // a veto left all three hundred and ninety-two an octave HIGH — concert
    // 47-59 where the reference edition writes 40-52. Six notes must not decide
    // where two hundred go, whichever direction they push.
    const score = outside + unplayable * CLAMP_COST + drift / line.length / 1000;
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/**
 * Add the nine missing chairs, derived from the players already there.
 * Mutates `score.parts` in place and returns what was added.
 */
export function expandJazzSections(score: any): ChairPlan[] {
  const parts: any[] = score?.parts ?? [];
  if (!parts.length) return [];
  const find = (re: RegExp) => parts.find((p) => re.test(String(p?.name ?? "")));
  if (find(/^alto sax 2$/i)) return [];          // already a big band

  const barCount = Math.max(...parts.map((p) => (p?.measures ?? []).length), 0);
  const punches: Record<Punch, Set<number>> = {
    trumpet: punchBars("trumpet", barCount),
    trombone: punchBars("trombone", barCount),
  };

  const out: ChairPlan[] = [];

  for (const chair of CHAIRS) {
    const donor = find(chair.donor);
    if (!donor) continue;

    const hard = playable(chair.instrument, chair.band);

    // Phase one: the chord-tone line, before any decision about register. It has
    // to be built whole, because the octave it sits in is chosen for the line
    // and not for any one note of it.
    type Slot = {
      bar: number; i: number; event: any; raw: number;
      doubled: boolean;
      /** Placed in its register already, so the line's octave shift skips it. */
      fixed?: boolean;
    };
    const slots: Slot[] = [];
    const piano = find(/^piano$/i);

    (donor.measures ?? []).forEach((m: any, bar: number) => {
      // The brass sits out everything but its punches.
      if (chair.punch && !punches[chair.punch].has(bar)) return;

      const src = (m?.events ?? []).filter(isNote);

      // A punch bar where the lead rests: take the piano's comp rhythm and the
      // bar's own chord. Only the top chair of the sub-section does this; the
      // chairs below it derive from this one and inherit it.
      if (!src.length && chair.punch && chair.punchLead && piano) {
        const pianoHere = (piano.measures?.[bar]?.events ?? []).filter(isNote);
        if (!pianoHere.length) return;

        const barPcs = new Set<number>();
        for (const e of pianoHere) {
          const v = eventMidi(e);
          if (v !== null) barPcs.add(((v % 12) + 12) % 12);
        }
        // The top chord tone this chair can reach, so the sub-section hangs
        // below it exactly as it does below the lead.
        const top = chordToneBelow(
          chair.band.hi + BAND_SLACK + MIN_GAP, barPcs, chair.band.lo - BAND_SLACK
        );
        if (top === null) return;

        const onsets: number[] = [];
        for (const e of pianoHere) {
          const t = Number(e.t);
          if (!onsets.includes(t)) onsets.push(t);
        }
        onsets.sort((a, b) => a - b);
        for (const [i, t] of onsets.slice(0, MAX_PUNCH_HITS).entries()) {
          const src0 = pianoHere.find((e: any) => Number(e.t) === t);
          slots.push({
            bar, i, raw: top, doubled: false, fixed: true,
            event: { ...src0, t, voice: 1, staff: 1 },
          });
        }
        return;
      }
      if (!src.length) return;

      // What the band is sounding in this bar, as pitch classes. Per bar rather
      // than per onset: on a chart with one chord to the bar that IS the
      // harmony, and an onset-exact set is often two notes wide because the
      // piano and guitar comp off the beat.
      const barPcs = new Set<number>();
      for (const p of parts) {
        for (const e of (p.measures?.[bar]?.events ?? [])) {
          if (!isNote(e)) continue;
          const v = eventMidi(e);
          if (v !== null) barPcs.add(((v % 12) + 12) % 12);
        }
      }
      if (!barPcs.size) return;

      for (const [i, e] of src.entries()) {
        const cur = eventMidi(e);
        if (cur === null) continue;
        const below = chordToneBelow(cur, barPcs, cur - MAX_DROP);
        // Nothing of the chord within reach below the donor: double it at the
        // octave, which is ordinary section writing when the chair above is
        // already sitting on the bottom of the voicing.
        slots.push({ bar, i, event: e, raw: below ?? cur - 12, doubled: below === null });
      }
    });

    // Phase two: one octave for the whole line, then write it. The piano-derived
    // punches are excluded from the decision and from the shift — they were
    // placed in this chair's register to begin with, so they are evidence about
    // nothing and moving them would undo that.
    //
    // Measured: that exemption currently changes NOTHING. Both chairs that take
    // piano punches, Trumpet 2 and Trombone 2, choose a shift of zero on this
    // chart and on the test fixture, so `fixed` has never once altered a note.
    // It is kept because it is only correct by construction — a chart whose lead
    // trumpet sits an octave higher would shift, and would drag the in-register
    // punches out with it — but it is not covered by a test and should not be
    // read as if it were.
    const shift = chooseOctave(slots.filter((s) => !s.fixed).map((s) => s.raw), chair);

    let notes = 0;
    let outside = 0;
    let doubled = 0;
    const playedBars = new Set<number>();
    const byBar = new Map<number, Slot[]>();
    for (const s of slots) {
      const list = byBar.get(s.bar);
      if (list) list.push(s); else byBar.set(s.bar, [s]);
    }

    const measures = (donor.measures ?? []).map((m: any, bar: number) => {
      const copy = JSON.parse(JSON.stringify(m));
      copy.events = (m?.events ?? []).filter((e: any) => !isNote(e))
        .map((e: any) => JSON.parse(JSON.stringify(e)));

      for (const s of byBar.get(bar) ?? []) {
        // The chosen octave is the line's; an individual note that still falls
        // off the end of the instrument is pulled back by octaves, which is the
        // only place a note moves on its own.
        let midi = s.raw + (s.fixed ? 0 : shift);
        while (midi > hard.hi) midi -= 12;
        while (midi < hard.lo) midi += 12;

        copy.events.push({
          ...JSON.parse(JSON.stringify(s.event)),
          id: `${chair.id}-${bar}-${s.i}`,
          pitch: midiToPitch(midi),
        });
        notes++;
        playedBars.add(bar);
        if (midi < chair.band.lo - BAND_SLACK || midi > chair.band.hi + BAND_SLACK) outside++;
        if (s.doubled) doubled++;
      }
      copy.events.sort((a: any, b: any) => Number(a.t) - Number(b.t));
      return copy;
    });

    if (!notes) continue;

    const part = {
      part_id: chair.id,
      name: chair.name,
      instrument: chair.instrument,
      staves: 1,
      measures,
    };

    const anchor = parts.findIndex((p) => chair.after.test(String(p?.name ?? "")));
    if (anchor >= 0) parts.splice(anchor + 1, 0, part);
    else parts.push(part);

    out.push({
      part: chair.name,
      from: String(donor.name),
      notes,
      bars: playedBars.size,
      outside,
      doubled,
    });
  }

  return out;
}

/** One line naming the chairs added. */
export function expandJazzSentence(plans: ChairPlan[]): string | null {
  if (!plans.length) return null;
  const saxes = plans.filter((p) => /sax/i.test(p.part));
  const brass = plans.filter((p) => !/sax/i.test(p.part));
  const bits = (xs: ChairPlan[]) =>
    xs.map((p) => `${p.part} from ${p.from} (${p.notes} notes, ${p.bars} bars)`).join(", ");
  const doubled = plans.reduce((n, p) => n + p.doubled, 0);
  const outside = plans.reduce((n, p) => n + p.outside, 0);

  return (
    `[jazz] A seventeen-piece band rather than an octet. ` +
    `Saxophones carry: ${bits(saxes)}. ` +
    `Brass punctuates on an eight-bar hypermetre after a late entry: ${bits(brass)}. ` +
    `Each doubles its donor's rhythm and takes a chord tone the band is already ` +
    `sounding, inside the register the reference edition measures for that chair.` +
    (outside
      ? ` ${outside} note(s) sit outside that register because nothing of the chord ` +
        `was available inside it.`
      : "") +
    (doubled
      ? ` ${doubled} note(s) double the donor at the unison or octave, the chord ` +
        `offering nothing below it on that instrument.`
      : "")
  );
}
