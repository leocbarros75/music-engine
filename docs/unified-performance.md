# Step 3 — One notation and performance path

## Data flow

Arrangement → canonical MusicXML exporter → source-preservation transfer/check → re-import final MusicXML in sounding pitch → shared performance compiler → MIDI and audio schedule.

The main pipeline returns the final `musicxml`, its synchronized `scoreModel`, and (when supported) `midiBase64`. `meta.performance` reports readiness, played measure/note counts, duration, tempo count, and interpretation warnings. Source preservation is checked again after synchronization.

The old SATB exporter is now a compatibility alias for the canonical exporter. It no longer has separate timing and transposition behavior. Shared performance notation (tempos, repeat endings, dynamics, articulations, grace notes, ties) survives the supported export/re-import path. Full source lyrics and engraving still rely on the pipeline's returned MusicXML, as described in Step 2.

## One performance compiler

`src/score/performance.ts` is browser-safe and shared by the server, MIDI encoder and player. It handles:

- Written-to-sounding pitch using the Step 1 pitch-space contract.
- Shared measure lengths, pickups, changing meter and trailing rests.
- Bounded forward/backward repeats, nested repeats, and numbered alternate endings.
- Ties as sustained notes rather than repeated attacks, separated by voice/staff/pitch.
- Numeric tempo maps, including offsets and dotted metronome beat units.
- Dynamic levels as note velocities; accent, staccato and staccatissimo interpretation.
- Grace notes/chords with an explicit on-beat realization.

At a repeat, the written tempo and dynamic context at the destination is restored. Repeats are bounded to 16 passes per region and 10,000 traversal steps; malformed/unbounded instructions are rejected.

MIDI and playback use the same 480-tick quarter-note resolution and MIDI-representable tempo values. Unusual fractional rhythms are rounded in the performance layer with a warning; source notation remains unchanged. A tie crossing a tempo change integrates both tempo segments. Unmarked notes are no longer shortened automatically.

Grace groups take up to one quarter of a quarter-note beat, capped at half the principal note's duration. The principal note starts later and ends at its original endpoint. Chord members sound together. This is a consistent engine interpretation, not a promise that every notation application's grace-note interpretation will match it. Unmatched tie stops are reported and played as fresh attacks.

## Tempo choices

By default, MIDI and playback follow the exported score's tempo map. The web app no longer passes its settings value as an unconditional playback/MIDI override. If a score lacks an initial tempo, the pipeline writes the fallback tempo into the exported score. For a protected melody, it places that generated marking on an accompaniment staff so the source staff remains intact.

Turning source preservation off and choosing a tempo explicitly produces a fixed-tempo score, MIDI and playback. The standalone performance/MIDI APIs accept an optional audition BPM that scales the entire tempo map relative to its initial tempo, rather than deleting later changes.

## Instruments and player

MIDI programs and soundfont names share `src/score/instrumentPlayback.ts`. Bassoon is no longer accidentally identified as bass; vocal parts use a choir sound. MIDI uses port metadata for groups larger than 15 melodic channels, avoiding program conflicts in large ensembles. A receiving DAW must support MIDI ports to preserve that routing.

The player now calls the sound library's actual `play(note, time, options)` API. It resumes the remainder of sustaining notes, includes trailing silence, caches loaded sounds, applies velocity and live master volume, and cancels stale playback after score changes or unmounting. Sound-load failure becomes a visible error rather than a silent piano substitution or an indefinitely loading player.

The desktop app saves the server's MIDI alongside its MusicXML and provides an Open MIDI button. The server MIDI bytes and browser MIDI bytes are tested for equality.

## Unsupported instructions and limits

D.C./D.S./coda/fine navigation, hairpin interpolation, and unpitched percussion without an explicit drum map are not implemented. When those instructions are present in the final MusicXML, the performance report explains the limitation and MIDI/playback is unavailable; the score can still be reviewed. The standalone notation writer serializes the supported performance fields, not arbitrary source notation. Continue using the preservation pipeline for source fidelity.

This step does not implement human rubato, fermata stretching, ornaments beyond the documented grace policy, pedal controllers, continuously shaped dynamics, or a DAW-quality sample engine. Soundfont access still needs a working network; timbre and sample release tails depend on the sound library. These do not change the shared note-event timeline.

The existing polyphonic `cello_free_range` failure is unchanged. Accompaniment quality and voice-leading remain separate from output consistency.

## Tests

Run `npm run test:performance`, `npm run test:preservation`, and `npm run test:score`.

Performance tests use explicit expected note orders/durations and independently decode MIDI tempo, note, program and port bytes. They cover ties, repeats/endings (including nested cases), tempo changes, grace groups, dynamics/articulations, fractional timing, sounding pitch, trailing rests, pause/resume, sound-library arguments, metadata-only tempo, opt-out tempo, and server/browser MIDI equality. Existing preservation tests still verify the source notes and notation; their MIDI comparison uses the performed source timeline, with separate fixtures checking ties, tempi and repeats against explicit expected values.
