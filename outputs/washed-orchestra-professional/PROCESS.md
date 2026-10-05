# Washed - Professional Orchestra: musical process and code

This edition develops the supplied Washed rhythm chart into a standalone orchestral arrangement for your established 19-staff orchestra. The explanation below documents musical choices, inspectable data, and executable algorithms. It is not a transcript of private internal reasoning. The complete generator is supplied so that the decisions can be studied, changed, and tested.

## 1. Define professional complexity musically

The arrangement's greater complexity comes from simultaneous musical roles: a foreground theme, a complementary counterline, harmonic strands, a changing pulse, and selective orchestral responses. A professional part need not be difficult in every bar. Independent phrasing, exposed entries, ensemble precision, register changes, and tone control are substantial musical demands even when a passage contains few notes.

The strings provide continuity and most of the motion. Woodwind solos and responses change the foreground color. Horns support selected structural spans, while trumpets, trombones, bass trombone, and tuba punctuate cadences and the later bridge peaks. Timpani adds brief harmonic/rhythmic emphasis. This gives stronger moments a different orchestral weight while retaining a clear foreground.

The score is written for Flutes 1 and 2, Oboe, B-flat Clarinet, Bassoon, F Horns 1 and 2, B-flat Trumpets 1 and 2, Trombones 1 and 3, Bass Trombone, Tuba, Timpani, Violins 1 and 2, Viola, Cello, and Double Bass. Trombone numbering follows your previous orchestra request. String section sizes are not specified.

## 2. Read the source rather than guess the missing melody

The supplied PDF and its matching Dorico MusicXML describe a rhythm chart. They contain a partial melody and pitched cues as well as rhythm slashes and percussion marks. The audit distinguishes 425 ordinary pitched records, 228 slashes, 19 percussion cues, and 208 rests. Multiple chord tones at one attack count as several pitched records.

`read_source()` parses note durations, voices, pitches, ties, harmonic symbols, barlines, and offsets. `upper_line()` groups ordinary pitched notes at each onset/duration and selects the highest note in the designated source voice. Rhythm-slash placeholder pitches and percussion cues are never accepted as melody material.

The quarter-note pickup contains two eighths, sounding F-sharp 4 and G-sharp 4. The original opening's 46 pitched segments remain in Violin 1 with their pitches, timing, and ties intact. Later instrumental cues retain source IDs, and octave transfers are recorded explicitly.

When the source gives only slashes, the arrangement supplies a newly composed instrumental continuation. Later chorus returns of the opening theme are editorial decisions. Some wind/brass cue endings are shortened to admit a breath, with a `breath_trimmed` flag in the events file. Those are documented adaptations rather than claims that every later source duration is unchanged. The edition does not reconstruct an unprovided complete vocal melody.

Both source files are copied unchanged into the package and checked by SHA-256. Original composers and rights remain in the derived score, along with an editorial orchestration credit. A malformed placeholder lyricist field is omitted from derived credits without inventing a replacement name.

## 3. Retain the harmonic and formal frame

Concert B major, 4/4, quarter note = 139, and even eighths retain the source's character. The opening N.C. receives the same editorial progression as the earlier Auto editions:

| Passage | Concert harmony |
|---|---|
| Pickup | B context; unaccompanied melody |
| 1 / 5 | B |
| 2 / 6 | G-sharp minor 7 |
| 3 | E add 9 |
| 4 / 8 | F-sharp 7 sus 4 |
| 7 | E 6/9 |

From measure 9 onward, printed harmonic roots, basses, chord kinds, degrees, and onsets are preserved. For example, measure 9 begins with B/D-sharp, moves to E 6/9 on beat 2, and anticipates F-sharp add 4 on its final eighth. In measure 10, G-sharp minor 7 arrives after the first eighth.

Add 4 and sus 4 are different harmonies. An added fourth retains the major third; a suspension replaces it. The parser applies MusicXML's degree operations to the basic chord kind, rather than interpreting the displayed text alone.

The first source repeat has first ending 59-60 and second ending 61-62; the second has first ending 111-112 and second ending 113-114. Barline signatures are copied into every part. `playback_route()` unfolds the two repeats into 136 measure visits, including the pickup. It is authored for this source's form, not a universal interpreter for every possible D.S., coda, or nested repeat.

## 4. Plan foreground changes and sectional development

| Measures | Foreground | Arrangement treatment |
|---|---|---|
| Pickup-8 | Violin 1 | Original opening over restrained held strings; occasional color entries |
| 9-12 | Violin 1 | New continuation; source chord-hit cue in Flute 2 |
| 13-20 | Oboe | Violin counterline, broken-chord support, pizzicato lower strings |
| 21-28 | Clarinet | Continuation and source turnaround over the string framework |
| 29-36 | Violin 1 | Opening theme returned an octave higher; source cue in Violin 2 |
| 37-52 | Cello | Lower solo color, violin counterline, selective woodwind answers |
| 53-62 | Violin 1 | Theme return with separate Violin 2 cue and source endings |
| 63-64 | Clarinet | Quiet transition over held strings |
| 65-88 | Four-bar solo exchanges | Violin 1, Clarinet, Oboe, Cello, then Violin 1 and Clarinet |
| 89-104 | Trumpet 1 / Violin 1 | Bridge peaks, faster string details, brass accents, timpani punctuation |
| 105-112 | Violin 2 | Reduced vamp with lower-string pizzicato |
| 113-114 | Cello | Source descending second-ending cue |
| 115-123 | Violin 1, Oboe, Clarinet, Violin 1 | Restrained closing, ritardando, final tonic |

`leader()` encodes the featured instrument for each measure. Source melody/cue events are created before accompaniment. A part that already carries a solo, cue, or counterline is not filled with a second simultaneous string line. This priority prevents impossible overlaps and keeps roles identifiable.

The bridge's source riff is sequenced where the source abbreviates pitched notation. The generator takes its rhythm and relative contour, shifts the register toward the selected instrument, and projects the new pitches onto the current harmony. Events are labeled as editorial sequences, even though they reference a source prototype.

## 5. Write complementary counterlines

`counterline()` chooses a distinct rhythmic pattern, alternately beginning on the downbeat or after an eighth rest. Against an active lead note, `counter_target()` prefers a complementary register and third/sixth-like relationship, with costs for abrupt movement and an adjacent semitone against the foreground. Chord tones anchor the line.

This is a pragmatic tonal texture algorithm. It does not enforce every rule of species counterpoint or prove the absence of all parallel perfect intervals. Its rhythmic independence and register choices need listening review, particularly where several high woodwind lines coexist.

Some quarter-note cells become a chord anchor followed by a brief diatonic neighbor and its return. The neighbor remains in the B-major scale and resolves inside the same harmonic span. In the generator's eight-unit quarter-note clock, the cell is:

```text
anchor:      onset t,     duration 4 units
neighbor:    onset t + 4, duration 2 units
resolution:  onset t + 6, duration 2 units
```

The validator requires the neighbor to move one or two semitones to its resolution, and requires the resolution to match the preceding anchor. This makes it a real neighbor figure rather than any arbitrarily inserted non-chord tone.

Measure 13's Violin 1 counterline illustrates how harmonic anticipations reshape a nominal rhythm: its notes begin at units 4, 16, and 24, but their durations are clipped to four units where the next harmony interrupts the larger cell. The authored template therefore does not override the source's precise chord schedule.

## 6. Voice the remaining strings

`string_voicing()` selects pitches only for string staves that are not already occupied in that bar. It searches chord-tone options in preferred registers for cello, viola, second violins, and first violins. The ordered generated voices cannot cross one another or create an adjacent semitone. Fixed solo/cue/counterline notes are considered in a friction cost but can cross accompaniment strands.

The search retains the best 64 partial states after adding each available part. This is a bounded beam search. Its cost combines movement from the previous assignment, a penalty for leaps beyond a fifth, distance from preferred tessitura, semitone friction against fixed notes, and missing chord classes:

```python
motion = abs(pitch - previous.get(part, preferred))
local_cost = motion + max(0, motion - 7)**2
local_cost += 0.2 * abs(pitch - preferred)
local_cost += sum(4 if abs(pitch-q) == 1 else 0 for q in fixed)
states = sorted(candidate_states, key=cost_with_coverage)[:64]
```

The approach favors manageable movement without evaluating every combination. It is not a globally optimal solution over the entire piece. Harmonic coverage is a preference, not a guarantee that all chord degrees sound in every rhythmic instant: some assigned pitches are used only in brief cells, and some fixed melodic notes are non-chord tones.

Double bass takes the source slash bass or chord root in a low register. It supplies short pizzicato pulses through most of the piece and sustained arco foundation in the closing. A string upper voice's inversion does not define the complete harmony's inversion; the actual bass does.

## 7. Develop the rhythmic texture and ornaments

Second violins use broken-chord eighth-note figures in selected verses and bridge passages. Viola contributes pizzicato backbeats or bowed inner pulses, while cello alternates solo passages, harmonic pulses, and sustained support. The rhythms change by section rather than giving every player the same attacks.

Later bridge figures introduce pairs of sixteenths. In Violin 2, measure 89, the concert pattern starts D-sharp 5, F-sharp 5, B 5, then G-sharp 5-F-sharp 5 in sixteenths; it repeats through the bar. The G-sharp approaches the F-sharp chord tone by step. This is labeled a **diatonic approach**, not a strict neighbor: the immediately preceding arpeggio note is B, so the figure does not have the same anchor-return structure as the counterline ornament.

`validate_musical_constraints()` verifies both kinds of ornament, including their scale membership, short duration, stepwise resolution, and containment within a harmonic span. It also rejects overlapping events in one instrument.

The sixteenth-note detail is intentionally selective. It changes the bridge's motion while leaving the foreground riff recognizable. At this tempo, clarity and light articulation matter more than additional volume.

## 8. Control the other families

`wood_present()` selects short response windows by instrument and section. Flutes brighten bridge passages and selected cadences; oboe and clarinet also take exposed melodic roles. Bassoon adds occasional lower color rather than continuously doubling the bass.

`brass_present()` reserves horns for selected spans and the other brass principally for cadences and later peaks. Generated low-brass and paired horn/trumpet voices have family-specific ordering and spacing. Most brass accompaniment is a short accent, with recovery space around it. Foreground Trumpet 1 gets its bridge riff before accompaniment is added.

At section and foreground changes, accompaniment usually receives a lower dynamic than the featured line; brass accompaniment receives an additional reduction. These are notation choices. Actual loudness depends on register, number of strings, articulation, player projection, and the room.

The repeat-aware mean part sounding proportions are approximately 62.2% strings, 12.6% woodwinds, 7.6% brass, and 3.0% timpani. The exact current figures are in `validation.json`. The family calculation divides by the number of staves, avoiding a misleading raw total comparison between five strings and eight brass. The validator requires the intended hierarchy. It does not turn time-on-note into an acoustic balance or fatigue model.

Timpani uses only sounding F-sharp 2 and B 2. At each selected cadence attack, the code chooses a fixed drum pitch compatible with the current harmony. This avoids an automatically inferred pedal-retuning schedule. The final B is allowed to ring without a roll; the player and conductor agree damping and release. The drum-size/tuning choice still needs confirmation against the instruments available.

## 9. Provide breathing and string technique preparation

Wind and brass solo phrase endings receive a quarter rest at selected two-bar boundaries when necessary. For example, the source-derived oboe turnaround at measure 20 is shortened to three beats. The event retains its source ID and a breathing-edit flag so that the adjustment is inspectable.

`breath_audit()` runs through the actual unfolded repeat route. A change of pitch or tongued attack does not count as a breath. A rest of at least an eighth resets the continuous-sounding run; the guardrail rejects runs over twelve quarters without such an opportunity. The delivered maxima are eight quarters for clarinet and seven for oboe and Trumpet 1; other winds/brass have shorter runs at the nominal tempo.

An eighth rest at 139 is about 0.22 seconds, and a quarter is about 0.43 seconds. Neither is a physiological guarantee. The audit does not model air pressure, register effort, fatigue, ritardando, or fermata duration.

Arco/pizzicato changes are encoded as explicit directions. The preceding bar is shortened where needed to leave a quarter of preparation. Short slurs join selected adjacent moving notes; repeated attacks stay articulated. Compatible common-tone string pads can tie across a boundary, except at repeat/ending-sensitive points. Automatic up/down-bow directions are not added. Section leaders determine bow distribution, string choice, and fingering; ties preserve sounding duration rather than requiring one physically continuous bow.

## 10. Separate sounding pitch from written notation

All arrangement events use concert MIDI pitch. Only `write_event()` converts to written pitch. B-flat clarinet and trumpets are written two semitones above sounding; horns are written seven semitones above; double bass is written twelve semitones above. Tuba has no octave transposition.

The written key signatures are C-sharp major for B-flat instruments, F-sharp major for horns, and B major for the remaining pitched staves. B-sharp and E-sharp spelling is necessary in those transposed keys. The written octave must agree with the chosen spelling:

```python
written = concert_midi + semitone_shift
step, alter = spelling(part)[written % 12]
octave = (written - alter - STEP[step]) // 12 - 1
```

For example, concert A-sharp 3 becomes trumpet/clarinet B-sharp 3, enharmonically C4, and horn E-sharp 4. Dividing MIDI by twelve without considering the letter/accidental would mislabel the B-sharp octave.

MusicXML `<transpose>` specifies the amount added to written pitch to obtain sounding pitch. The generator writes negative chromatic/diatonic shifts for B-flat instruments and horns. Double bass uses zero chromatic and diatonic shift plus `<octave-change>-1</octave-change>`. Round-trip tests check all these relationships. With 19 parts, MIDI channels are not assigned invalid values above 16; the notation importer allocates routing.

The full score has transposed staves and concert chord symbols above Flute 1, explicitly identified in its subtitle. Individual transposing parts transpose chord roots and slash basses to match their written notes. Double-bass chord classes stay the same under octave transposition.

## 11. Export, reopen, and challenge the result

The clock uses eight divisions per quarter: 32 units per full measure and eight in the pickup. `build()` inserts harmonies at their actual XML cursor positions. A sustained note crossing a harmony insertion point is split and tied, preserving its sounding duration. `notation.chunks()` creates standard note values and `beam_measure()` groups short notes by beat.

`decode()` independently reconstructs the exported sounding timeline, applies transposition, verifies displayed note types/dots and bar totals, and checks tie/slur pairing. The result must equal the authored events for the score and every part. `validate_performed_ties()` additionally checks ties across actual repeat and ending jumps, where a valid printed sequence could otherwise fail during performance.

The delivered edition passes 32 tests. Source hashes, opening preservation, printed harmony, repeats, instrument transpositions, part agreement, breathing, fixed timpani tuning, texture hierarchy, resolved ornaments, and technique-change preparation are checked. Corruption tests deliberately alter a note, duration, notation type, tie, repeat, chord, transposition, bass octave, ornament, drum pitch, or preparation rest and require rejection.

MuseScore exported a 31-page A3 full score and nineteen four-page A4 parts. All 107 output pages were rendered and visually reviewed, including enlarged inspections of the opening full score, Trumpet 1's written key, Violin 2's bridge detail, and Cello's closing. The archive receives a corruption check and member-hash comparison against its manifest.

Structural correctness and visual review are complete stages here. Audio review and a live player reading are not. The checks do not establish that every bow change, intonation tendency, blend, or endurance demand is settled. `PLAYER-REVIEW.md` supplies focused first-reading questions and a table for measured player feedback.

## 12. Reproduce and learn from changes

Run these inside the extracted folder:

```sh
python3 arrange.py
python3 -m unittest -v test_arrangement.py
```

Python's standard library is sufficient for the generator and tests. The generator rewrites MusicXML and musical JSON reports, not PDFs. Export the regenerated score/parts in your notation application. MuseScore users can use `engrave-jobs.json` with batch export; regenerate the job file after moving the folder because it contains absolute paths.

Useful controlled experiments include reducing the register-friction cost, changing one counterline pattern, or removing a selected brass cadence. Regenerate and compare the actual notes and activity report, then listen or read with players. Passing the tests does not mean the changed musical choice is artistically superior.

The code contains this piece's form, source-cue selection, section boundaries, and phrase prototypes. It is an educational arrangement generator for this edition, not an automatic solution for every lead sheet.

## 13. Knowledge sources and attribution

The supplied chart supplies the song material. The references below support instrument and notation knowledge; they do not supply these particular notes or orchestration rules.

- [Philharmonia: Violin](https://philharmonia.co.uk/resources/instruments/violin/) discusses register, sustain, and bowing. Its discussion informs the distinction between string duration and practical bow distribution; the edition's specific slurs remain editorial.
- [Philharmonia: Clarinet](https://philharmonia.co.uk/resources/instruments/clarinet/) describes changing tone across registers and dynamic flexibility. Clarinet foreground and transition roles here are applications chosen for this arrangement.
- [Philharmonia: Timpani](https://philharmonia.co.uk/resources/instruments/timpani/) explains pitched drums and pedal tuning. The two fixed pitches and cadence schedule are this edition's choices.
- [W3C MusicXML: harmony](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/harmony/) documents harmonic symbols and their components; it supports the parser and chord-preservation checks.
- [W3C MusicXML: transpose](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/) specifies written-to-sounding encoding; it supports trumpet, clarinet, horn, and double-bass export checks.

The beam width, weights, register windows, breath threshold, participation patterns, and individual phrase assignments are inspectable decisions in the code. They are not universal orchestration laws. No generative audio service composed this edition; Codex-assisted Python writes the authored events into notation. A first reading with professional musicians is the next source of evidence for refining the musical result.
