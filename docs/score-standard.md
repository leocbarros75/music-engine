# Score standard, version 1

This contract is implemented in `src/score/types.ts`, `src/score/standard.ts`, and
`src/score/pitch.ts`. The shared modules are browser-safe. Both MusicXML importer
entry points use the same ordered parser.

## Time

- `t` is relative to the beginning of its measure, in quarter-note beats.
- `dur` is in quarter-note beats: quarter = 1, eighth = 0.5, triplet eighth = 1/3.
- `attributes.divisions` and `global.divisions` are serialization resolutions,
  not units for internal events. `source_divisions` records the original resolution.
- Convert MusicXML durations once, at import, with `divisionsToBeats`.
- Meter is `attributes.time = { beats, beat_type }`. The importer materializes
  inherited meter and key attributes. Consumers of externally constructed models
  must still resolve inheritance through the shared timeline.
- `buildMeasureTimeline` defines score-wide bar starts. Array position aligns
  measures across instruments; printed measure numbers are labels and can start at 0.
- Normal bar length is `beats * 4 / beat_type`. A declared pickup/irregular bar
  uses `durationBeats`; MusicXML `implicit="yes"` preserves this on round trip.
- Incomplete unmarked measures are not guessed to be pickups.
- A conflicting meter or explicit bar length raises an error. An overfull event
  must not lengthen only one instrument's clock. `buildNoteTimeline` validates
  event bounds before playback or MIDI encoding.
- Grace notes have `grace: true`, `dur: 0`; they do not consume metrical time.
  Their performance scheduling and complete engraved preservation are separate work.
- Floating-point fractional beats are supported with a 1e-7 boundary tolerance.
  Exporter notation/tuplet decomposition is not replaced by this contract.

## Pitch

- `pitchSpace` belongs to each part: `written` or `sounding`.
- Imported MusicXML pitches are `written`; preserve the source `transpose`.
- Arrangement boundaries convert with `toSoundingScore`. Generated parts use
  sounding/concert pitch. Exporters convert sounding notes into instrument notation.
- `transpose` means written-to-sounding: chromatic + 12 * octaveChange.
- `pitch` is authoritative. `midi`, if cached, refers to the same pitch space.
- `toSoundingScore` is immutable and idempotent. The retained source transpose
  is provenance once `pitchSpace` is `sounding`; it must not be applied again.
- Legacy parts without pitchSpace are interpreted as written when they carry
  transpose, otherwise sounding. New code should always declare pitchSpace.
- Never infer stored pitch space merely from an instrument name.
- Chords supplied to the MusicXML arrangement pipeline use the source lead part's
  written pitch context, as do MusicXML harmony symbols. Convert them alongside
  the source. Supplied chord-only requests have no transposing source.
- A source that changes transposing instruments mid-part or mixes chord-symbol
  pitch contexts still needs an explicit richer import model; first-part/first-
  transpose conventions are retained rather than pretending to support that case.

## Consumers updated

Main and compatibility importers; main arranging pipeline and legacy SATB route;
SATB harmonizer; string, wind, brass, and orchestral polyphonic slice timing;
string bass beat classification; both MusicXML exporters; re-instrumentation;
concert-pitch conversion; browser MIDI and audio scheduling.

The browser bundles the same score helpers as the backend. The Docker web-build
stage copies `src/score/` for those imports.

## Validation

Run `npm run test:score`, `npm run build`, and `npm --prefix apps/web run build`.
Tests decode generated MIDI bytes and compare onsets against the shared audio
clock. They cover divisions, meter inheritance/change, pickups, backups/forward,
transposition, stale MIDI caches, grace-note time, invalid spans, and the actual
string pipeline.

This step does not implement exact melody locking, complete lyrics/repeats/
expressive notation export, tie-aware performance, variable tempo maps, OMR,
or phrase-level AI composition. Those remain the later preservation/export and
musical-review stages. Existing unrelated tests remain visible.

Step 2 adds a tested source-preservation boundary; see [source-preservation.md](source-preservation.md) for its contract and remaining performance limitations.

Step 3 adds the shared performance interpretation and canonical exporter; see [unified-performance.md](unified-performance.md).
