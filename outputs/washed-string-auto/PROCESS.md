# Washed - String Auto: musical and technical walkthrough

Prepared October 1, 2026. Instrumentation: Violin 1, Violin 2, Viola, Cello, Double Bass. This is a new instrumental arrangement using the supplied rhythm chart. The original source files remain unchanged in this package.

## 1. Establish what the source actually contains

The supplied PDF has five pages, B major, 4/4, quarter note = 139, a two-eighth-note pickup, 123 numbered measures, two repeat passages, and first/second endings. I compared its opening, chord vocabulary, rehearsal structure, and ending with the matching MusicXML found beside it. That export provides exact musical data; the PDF provides the visual reference. I did not estimate pitches from pixels or infer the entire song from a recording.

There is a crucial distinction: this is a rhythm chart with a written opening tune and several pitched instrumental cues. It is not a complete vocal lead sheet. The export contains 425 normal pitched note records, 228 rhythm-slash records, 19 percussion-cue records, and 208 rests. Some simultaneous pitched records belong to chord voicings. Therefore, 425 records do not mean 425 successive vocal notes.

The generator reads notehead shape, voice, onset, duration, ties, and harmony. A slash can have a nominal pitch in MusicXML because notation software needs a staff position. That pitch is not evidence of a tune. In this edition, slash and percussion placeholders never become melodic source material. Normal pitched notes are still interpreted in context: an upper guitar cue is an instrumental cue, not automatically the missing vocal melody.

The official MusicXML reference defines the alternate shapes represented by `<notehead>`. The decision to classify these particular slashes as rhythm placeholders comes from reading this chart. [W3C notehead reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notehead/)

## 2. Define preservation and creative freedom

The source opening has 46 pitched segments, including the pickup. Violin 1 preserves their pitches, onset times, durations, and source ties. The rests are preserved through the same onset/duration timeline. Optional short slurs add articulation without changing the tune.

The source marks the opening N.C. This means no chord accompaniment is specified; it is not an invitation to invent a supposedly recovered original harmony. Your request authorizes an editorial harmonization. The added chords are labeled in the score, and their provenance is explicit in `harmony-plan.json`.

From measure 9 onward, printed roots, chord qualities, added degrees, slash basses, and change times remain those of the source. Both repeat structures and their endings remain intact. The instrumental arrangement introduces new melodies in passages where only rhythm slashes are supplied. It also brings back the opening theme in later choruses. Those returns are editorial choices, not claims about an unwritten original vocal part.

`arrangement-events.json` separates source opening melody, transferred cues, theme returns, newly written continuations, and accompaniment. Events derived from source notes carry source record IDs. You can trace an event to its source and distinguish an octave transfer from a newly generated pitch.

## 3. Harmonize the unaccompanied opening

The new opening progression is:

| Location | Added harmony | Musical purpose |
|---|---|---|
| Pickup | B, melody alone | Establish the tonal context without a premature ensemble entrance |
| 1 | B | Tonic support for the repeated B notes |
| 2 | G#m7 | Relative-minor color while retaining B, D#, and F# as shared tones |
| 3 | Eadd9 | Subdominant color; F# is the added ninth |
| 4 | F#7sus4 | Dominant tension with B as the suspended fourth and E as the seventh |
| 5 | B | Return to tonic |
| 6 | G#m7 | Repeat the relative-minor contrast |
| 7 | E6/9 | Broaden the subdominant sonority |
| 8 | F#7sus4 | Prepare the printed introduction beginning at measure 9 |

In B major, this broadly follows I - vi7 - IV - V7sus4. It is a chosen progression compatible with much of the tune, not a uniquely determined analysis. Melody notes can be non-chord tones: C# against G#m7, for example, adds a passing ninth color in the moving line. The accompaniment does not chase every melodic eighth note with a new chord.

The opening also demonstrates economical voice leading. In measures 1 and 2, Viola stays on F#3 and Violin 2 stays on D#4 while Cello changes B2 to G#2. Two common tones make the harmonic change audible without moving every player. In measure 3, the accompaniment gives E3, F#3, B3: an open Eadd9 subset. A chord symbol can describe the harmonic field even when the ensemble omits a degree at a particular instant.

The pickup remains melody-only. That preserves the call-like entrance and gives the accompaniment a clear first downbeat.

## 4. Give the instruments distinct jobs

| Instrument | Main job | Actual sounding range in this edition |
|---|---|---|
| Violin 1 | Opening tune, returning themes, bridge riffs, new instrumental continuation | F#4 - E6 |
| Violin 2 | Harmonic strand and selected source instrumental cues | B3 - F#5 |
| Viola | Inner chord color, verse backbeats, bridge pulse | E3 - D#4 |
| Cello | Harmonic bass, pizzicato pulse, later bowed motor rhythm | F#2 - B3 |
| Double Bass | Low foundation and chord anticipations; arco closing support | F#1 - E2 |

There are five independent single-note parts; no double stops or divisi are required. The ranges above describe this score, not the instruments' complete capabilities. Violin 1's upper register is the principal professional demand. The accompaniment remains more restrained so the lead has room.

The double bass is written an octave above its sounding pitch. The code stores concert pitches, adds 12 semitones when writing bass notation, and writes `<octave-change>-1</octave-change>`. The validator reads that transposition back. A missing octave change must fail, even if the part looks plausible. [W3C transpose reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/)

## 5. Develop form through texture

Measures 1-8 use a quiet arco accompaniment beneath the preserved opening melody. Measures 9-28 introduce pizzicato Viola backbeats, Cello pulses, and low Bass support. Selected source chord-hit pitches become a second-violin strand, while the first violin supplies an editorial melodic continuation.

Measures 29-36 bring back the opening theme. Measures 37-52 return to the verse texture. Measures 53-60 repeat the theme an octave higher, with the source guitar cue transferred down an octave to Violin 2. This creates two strands rather than simply doubling the melody. Measures 61-62 retain the written turnaround cue; 63-64 relax into a sustained transition.

The bridge begins at 65 with source riffs and harmonic sequences based on their contour. Where no pitched upper line exists, the two-bar riff serves as a prototype; its transposed targets are projected onto the current chord's pitch classes. At 81 the Cello changes to a light detached eighth-note motor, while Viola adds a quarter-note inner pulse. The Bass supplies a more regular quarter-note foundation. This is a string interpretation of rhythmic energy, not a literal drum transcription.

Measures 105-112 return to the pizzicato vamp and preserve its repeat/endings. Measures 113-114 transfer the written second-ending cue. Measures 115-122 lift the source closing upper line into the violin register over quieter arco support. All five instruments resolve to a B-major sonority at 123, with a fermata and a preceding ritardando instruction.

This is designed as an instrumental string arrangement. If you later want it beneath a singer or full rhythm section, the new Violin 1 line should be revised against the complete vocal melody to avoid competing with it.

## 6. Represent harmony as data

A harmony record includes the measure, onset, duration, root pitch class, bass pitch class, chord kind, added/subtracted degrees, origin, and the source XML element. Pitch classes use C=0 through B=11. Register is assigned later.

For example:

```python
# B major, then B/D#:
root = 11
chord_pitch_classes = {11, 3, 6}  # B, D#, F#
bass = 3                        # D# determines first inversion
```

The slash bass controls the low line. In measure 9, B/D# begins on the downbeat, E6/9 begins on beat 2, and F#(add4) begins on the final eighth. The next measure carries that F# sonority for its first eighth before G#m7 enters. A bar-level chord list would lose these anticipations.

F#(add4) and F#sus4 are different: the added-fourth chord retains A#, whereas a suspended-fourth chord replaces the third with B. The parser preserves the source's added/subtracted degree semantics. The accompaniment may omit some degrees in a sparse voicing, but the harmonic model retains the distinction.

The MusicXML harmony structure supplies root, kind, bass, degrees, and timing information. [W3C harmony reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/harmony/)

## 7. Choose accompaniment voicings

`voiced()` enumerates candidate Cello, Viola, and Violin 2 pitches. It fixes Cello to a nearby octave of the specified bass and restricts the inner voices to practical registers. Candidates must satisfy ascending accompaniment order, an inner-voice gap no larger than an octave, and no adjacent semitone between Viola and Violin 2. The lead register and source cue register further limit the candidate ceiling.

The cost combines movement from the previous voicing, a stronger penalty for leaps over a fifth, preferred register, missing chord degrees, and semitone friction against the active lead. The lowest-cost candidate wins.

In simplified notation, movement contributes:

```python
cost = sum(abs(new-old) + max(0, abs(new-old)-7)**2
           for new, old in zip(candidate, previous))
```

This is a local search: it chooses each next voicing from the previous choice. It is not global dynamic programming and does not guarantee optimal counterpoint over the whole piece. It does not enforce species-counterpoint rules or ban all parallel fifths. The style permits common-tone pads, open intervals, and some parallel motion. Source cues can also create register relationships outside the generated accompaniment constraints.

The rhythmic layer then decides when each selected pitch is attacked. A good voicing does not automatically make a good texture; the code handles harmony selection and rhythmic activity separately.

## 8. Make rhythmic data explicit

The source uses four divisions per quarter. The arrangement uses eight:

```python
DIVISIONS = 8
QUARTER = 8
EIGHTH = 4
FULL_BAR = 32
PICKUP = 8
```

Source time values are multiplied by two. `<backup>` moves the read cursor backward for another voice; `<forward>` moves it ahead; `<chord>` shares the preceding note onset. Ignoring those elements would scramble simultaneous voices.

An event contains part, bar, onset, duration, concert MIDI pitch, role, source IDs, tie flags, optional slur, and articulation. For example, an inner accompaniment tone might be:

```python
{'part': 'VA', 'bar': 1, 'on': 0, 'dur': 32,
 'midi': 54, 'role': 'sustained harmonic strand',
 'sources': [], 'tie_start': False, 'tie_stop': False,
 'slur': None, 'art': None}
```

`notation.py` breaks durations into conventional note values, writes accidentals and rests, and beams notes by beat. The score and each individual part are generated from the same event list. There is no separate hand-copied set of part notes that can silently diverge from the score.

## 9. Distinguish sound, notation, and importer behavior

During the first engraving pass, chord symbols became crowded because the importer did not place harmony offsets as intended. The final writer inserts each chord at the actual MusicXML time cursor. When a change occurs inside a sustained note, it splits that note and ties the pieces. The sounding duration stays the same; the notation gains a reliable insertion point for the harmony.

For example, a quarter note crossing a final-eighth chord change may become two tied eighth notes. The round-trip checker compares every sounding time unit, so this engraving adjustment cannot silently shorten or reattack the sound in the modeled timeline.

This illustrates why generating XML and generating a readable score are separate tasks. A file can parse correctly while a particular notation application interprets layout instructions differently. The final PDFs are exported with MuseScore and checked visually.

## 10. Bowing and articulation

Source ties are preserved in the opening. Additional ties sustain selected common tones in arco pads. Ties at reuse boundaries are reconciled against actual neighboring pitches and timing; repeat/ending boundaries are protected from inappropriate generated cross-bar ties.

Short slurs are suggested only for contiguous, moving, untied first-violin notes fitting inside one beat. Repeated pitches are not automatically joined by these slurs. The resulting marks are provisional articulation suggestions, not a complete bow-distribution plan. Up-bow and down-bow symbols are intentionally left to the section leader after a reading; assigning them by beat parity would not establish the best physical solution.

Before each arco/pizzicato change, the affected accompaniment has at least a quarter-note rest. At quarter=139 that is about 0.43 seconds. This is a preparation allowance, not proof that every player will prefer that switch time. The closing Bass uses sustained arco support instead of continuing its pizzicato pattern.

Philharmonia's violin resource discusses tuning, register color, and bow direction; its double-bass resource provides an instrument-specific starting point. These inform the practical vocabulary. They do not certify this arrangement's bowings. [Philharmonia violin](https://philharmonia.co.uk/resources/instruments/violin/), [Philharmonia double bass](https://philharmonia.co.uk/resources/instruments/double-bass/)

## 11. Validation and what it proves

Fourteen regression and deliberate-corruption tests check the complete round trip, original file hashes, pickup duration, opening/provenance, slash exclusion, slash bass and anticipation, mode-change rests, score/part agreement, and rejection of wrong bass transposition, pitch, duration, tie, printed harmony, or repeat.

The generator also checks every staff's measure length, note type/duration agreement, tie/slur pairing, sounding pitch range, generated accompaniment chord membership, source barlines, and the exact opening signature. Every exported MusicXML is reopened. The PDFs are checked for nonempty pages and visually reviewed after export. The delivery ZIP is checked for archive integrity.

These checks establish structural consistency and readable engraving. They do not establish acoustic balance, ideal fingering, ensemble blend, or bow comfort. No live-player rehearsal or audio audition was completed for this edition. Use `PLAYER-REVIEW.md` to collect those observations and revise the editable MusicXML.

## 12. Run and experiment

Keep `arrange.py`, `notation.py`, and `source-rhythm.musicxml` together. Python 3 standard library is sufficient to generate and test the MusicXML:

```sh
python3 arrange.py
python3 -m unittest test_arrangement.py
```

Run those commands inside the extracted package directory. Open `washed-string-auto.musicxml` in Dorico or MuseScore to edit or re-export. The six MusicXML files are the full score and five individual parts. The PDF export job file is generated with paths appropriate to the directory where the code is run.

Useful controlled experiments are to change one opening chord, adjust the movement penalty, lower the bridge's rhythmic density, or lengthen the preparation rests. Regenerate and inspect the differences. Keep the original melody/signature tests in place; if you intentionally rewrite the tune, document that new scope before changing those expectations.

The script is piece-specific. Its source divisions, meter, measure count, chord vocabulary, register transfers, and section map are deliberate assumptions about this chart. It is not a universal PDF-to-strings converter. To generalize it, expose those assumptions as inputs, handle changing meters/divisions, add explicit melody-role annotation, and separate a user-approved formal plan from the renderer.

The musical choices are editorial decisions made for your request, then implemented by deterministic code. The cited documentation supports the encoding and instrument vocabulary; it does not supply these exact notes or prove this harmonization is the only good one.
