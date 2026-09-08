# Source preservation — Step 2

For the current MIDI/playback path, see [Step 3: unified performance](unified-performance.md). It adds sustained ties, repeats, tempo maps and a shared performance interpreter to this preservation boundary.

A protected arrangement keeps an immutable copy of the selected source melody. After accompaniment generation, the pipeline restores the locked melody in the score model, transfers the source melody's MusicXML notation to the destination instrument, and independently compares the final MusicXML against the source. A mismatch stops export with a measure/beat diagnostic.

## Contract

`preserveSource` defaults to true. The default `melodyOctaveShift` is 0. Explicit values -1 and +1 move the melody one octave without changing chord symbols or key signatures. Written instrument transposition remains separate from this musical choice. An out-of-range melody produces an error; it is never silently moved to fit. The old automatic +12 shifts in string melody paths have been removed.

For an eligible single monophonic melody, the checks cover:

- Note/rest order, pitch spelling, sounding pitch, original register and quarter-beat timing.
- Source chord symbols, extensions, slash bass and placement in the exported melody staff.
- Measure labels, order, pickups, meter and key changes.
- Source lyrics, ties, notation, directions (including tempo and section labels).
- Repeat and ending barlines, propagated to all generated parts.
- Agreement between the protected model and the actual exported MusicXML.

Only clefs, instrument references and written transposition adapt to the new instrument. Print/system breaks are discarded so notation software can lay out the new ensemble. Dynamics and articulation already present in the source melody take precedence over generated melody markings. Accompaniment remains generated.

Changing the key/meter or supplying conflicting chords requires an explicit opt-out. When source harmony symbols are absent, new supplied/inferred harmony can still be used; the report's source-chord count is zero. This check verifies source chord notation, not whether every accompaniment note is a good realization of that harmony.

## Settings and report

The web and desktop settings provide “Keep source melody, chords and form” and “Melody register”. Part selection filters original MusicXML directly, preserving its notation, and rejects selections that would silently discard a separate chord chart. The API also accepts `sourceMelodyPartId` for explicit selection. A named Melody/Soprano/Voice/Vocal/Violin I part, or a sole source part, can be selected automatically when unambiguous.

The response exposes `meta.preservation` and the model records `meta.sourcePreservation`:

- `verified`: includes source and destination part IDs, octave choice, counts, and checked fields.
- `not_applicable`: explains why the source/mode has no preservation guarantee.
- `disabled`: the caller explicitly turned protection off.

Eligible ensemble modes are choral, string ensemble, woodwind ensemble, brass ensemble, worship orchestra and symphonic orchestra (plus pipeline aliases). Piano, copy/re-instrumentation modes, polyphonic or ambiguous source melodies, multi-staff melodies, changing instrument transposition, microtonal/unpitched sources, and chord charts distributed across different source parts are not certified by this step. Unsupported explicit octave requests fail rather than being ignored. A protected melody that cannot fit the selected instrument also fails.

Use the pipeline's returned `musicxml`. Re-exporting only `scoreModel` through an older standalone exporter still loses notation that the reduced model cannot represent. The desktop route now saves the pipeline's verified XML directly. The legacy score-model-only SATB endpoint remains available without a preservation claim.

## Tests

Run `npm run test:preservation` (source comparisons plus request-handler integration) and `npm run test:score` (the shared timing/pitch standard). Backend, web and Electron build commands remain unchanged.

The regression fixture is the user's original Holy Holy Holy upload: 16 bars, 45 melody notes, 33 chord symbols. Tests cover homophonic/polyphonic strings, explicit register, transposing source/destination instruments, selection, changing key/meter, pickups, lyrics, ties, grace notes and repeat endings. Fault injection deliberately changes or removes notes, chords, slash bass, key, meter, lyrics, ties, tempo and repeats; the independent verifier must reject each corrupted output. Request tests exercise the real handlers in-process without opening a network port.

A MIDI-byte regression checks every melody note-on and note-off against the source timeline. MIDI export now keeps exact note-event duration instead of shortening every note. Playback envelopes are separate. Repeat unfolding, tie-aware sustained performance, grace-note realization and variable tempo maps are not implemented by this step; those source details are protected in MusicXML. This is not a claim of performance-equivalent MIDI for arbitrary notation.

## Remaining work

The existing `cello_free_range` polyphonic candidate test still fails as it did before Step 1. Phrase shaping, accompaniment harmonic accuracy, voice crossings, instrument balance and musical quality need their own review/tests. Source preservation is a prerequisite for those improvements, not proof that the arrangement is musically finished.
