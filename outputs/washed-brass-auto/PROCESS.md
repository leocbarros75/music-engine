# Washed — Brass Auto: arranging and coding the edition

This guide explains the musical design and the actual, reproducible rules in the included code. It is a description of decisions and algorithms, not a transcript of private internal deliberation. The goal is an eight-part brass arrangement of the supplied rhythm chart, following the same melody-and-chord approach as the String Auto and Wind Auto editions.

## 1. Establish what the source actually supplies

The supplied five-page PDF is a rhythm chart. Its matching Dorico MusicXML provides machine-readable durations, pitches, chord symbols, repeats, and endings. It contains a recognizable opening melody and later instrumental cues, but many passages use rhythmic slash notation. A slash is a rhythm instruction; its encoded placeholder pitch must not become the tune.

The generator classifies every source note before arranging. The audit counts 425 ordinary pitched records, 228 rhythm slashes, 19 percussion cues, and 208 rests. Chord stacks can contribute several pitched records at the same onset, so this count is not a count of unique melody attacks. `upper_line()` selects the highest ordinary pitched note at each onset/duration in the designated source voice. Slashes and percussion cues are excluded from that selection.

The score has a quarter-note pickup followed by 123 numbered measures in 4/4. The pickup comprises two eighth notes, concert F-sharp 4 and G-sharp 4. The 46 pitched opening segments retain their pitches, onsets, durations, and source ties. Later pitched cues are selected and transferred by octave when necessary; `arrangement-events.json` records their source IDs and octave shifts.

This distinction matters: a new line over a slash-only verse is editorial composition. It cannot be described as preservation of the original vocal line, because that complete line was not supplied. Returns of the opening theme in later choruses are also deliberate arrangement decisions.

The source PDF and XML are copied unchanged into the package and checked by SHA-256. Composer and rights credits remain in the derived score. The source's malformed placeholder lyricist field is omitted from derived credits; it is not substituted with an invented attribution.

## 2. Preserve form before adding texture

Concert B major, 4/4, and quarter note = 139 establish the setting. Even eighth notes retain the source's energetic character. This is not the jazz-ballad treatment from a different earlier source.

Rehearsal marks outline opening, introduction, verses, choruses, bridge sections, tag, vamp, closing, and final chord. Original repeat and ending barlines are copied to every part. The first repeat spans 53–60, with first ending 59–60 and second ending 61–62. The later repeat spans 105–112, with first ending 111–112 and second ending 113–114.

For breath and participation checks, `playback_route()` unfolds these repeats into 136 measure visits, including the pickup. This catches a sustained passage crossing a backward repeat that an inspection of printed order could miss. The route is authored for this score's two explicit repeats; it is not a general interpreter for every possible coda, D.S., or nested-repeat structure.

## 3. Harmonize the opening transparently

The opening lacks harmonic guidance in the source. The same editorial progression used in the earlier Auto editions gives it a coherent tonal setting:

| Measure | Concert harmony | Function / color |
|---|---|---|
| Pickup | B context; melody alone | Establish the tonal center without an accompanying attack |
| 1 | B | Tonic |
| 2 | G-sharp minor 7 | Relative minor color |
| 3 | E add 9 | Subdominant with a bright extension |
| 4 | F-sharp 7 sus 4 | Suspended dominant |
| 5 | B | Tonic return |
| 6 | G-sharp minor 7 | Parallel color to measure 2 |
| 7 | E 6/9 | Expanded subdominant |
| 8 | F-sharp 7 sus 4 | Dominant preparation for the introduction |

The notation explicitly labels the opening harmony as added to source N.C. From measure 9 onward, printed source chord roots, slash basses, chord kinds, degree alterations, and harmonic onsets are retained.

Chord degrees need precise interpretation. F-sharp add 4 contains F-sharp, A-sharp, C-sharp, and B: the added fourth does not remove the major third. F-sharp sus 4 replaces the third with B. A naive parser that treats both as the same pitch-class set changes the harmony. The `chord()` function first loads the basic interval set, then applies MusicXML degree additions, alterations, or subtractions.

Measure 9 demonstrates why onset precision matters: B/D-sharp begins at the barline, E 6/9 arrives on beat 2, and F-sharp add 4 appears on the final eighth. Measure 10's G-sharp minor 7 enters after its first eighth note. The arrangement preserves those anticipations rather than rounding every change to a downbeat.

## 4. Give each instrument a job

This is an expanded brass ensemble of eight players, rather than a conventional five-player brass quintet. Two horns provide a flexible middle choir; three trombones and tuba give the lower register more independent roles.

| Instrument | Main use | Actual sounding range in this edition |
|---|---|---|
| Trumpet 1 in B-flat | Opening theme, chorus return, bridge exchanges, final lead | F-sharp 4–E 5 |
| Trumpet 2 in B-flat | Second theme color, source cues, short responses | F-sharp 3–E 5 |
| Horn 1 in F | First verse lead, source cue, harmonic connection | F-sharp 3–B 4 |
| Horn 2 in F | Inner harmony and vamp lead | F-sharp 3–E 4 |
| Trombone 1 | Second verse lead, turnarounds, bridge exchanges | F-sharp 2–F-sharp 4 |
| Trombone 2 | Chordal rhythm and lower harmonic voice | B 2–F-sharp 3 |
| Bass Trombone | Selective low reinforcement and open support | F-sharp 2–B 2 |
| Tuba | Harmonic bass, inversion basses, rhythmic foundation | F-sharp 1–E 2 |

These are actual exported ranges, not general claims about each instrument's maximum compass. The configurable bounds in `PARTS` are wider guardrails. A line can satisfy a range check while still needing player-specific adjustments for endurance, intonation, articulation, or instrument setup.

The lead map is intentional: Trumpet 1 has the opening; Horn 1 takes measures 9–28; Trumpet 1 returns at 29–36; Trombone 1 leads 37–52; Trumpet 2 carries 53–62; Horn 1 bridges 63–64. In 65–104, two-bar features rotate Trumpet 1, Horn 1, Trombone 1, and Trumpet 2. Horn 2 leads the repeated vamp at 105–112. Trombone 1 has the second-ending cue at 113–114, then the closing passes through horn, trumpet, trombone, and Trumpet 1.

This distributes color and responsibility while retaining identifiable material. It also supplies trumpet recovery time. It is not a literal reassignment of every source note to a different staff.

## 5. Choose participants before choosing pitches

One tempting implementation is to find an eight-note chord for every harmony and keep every player sounding. That would create unnecessary density and substantial endurance demands. Here, `supports()` decides which accompaniment players participate before `voiced()` assigns their notes.

Trumpet 1 is usually silent when another instrument leads. Trumpet 2 adds selected responses and rests through much of the texture. Horn and trombone accompaniment patterns include whole-bar omissions, and bass trombone does not duplicate tuba continuously. A source cue or solo assignment takes precedence over accompaniment in that part and bar.

The actual repeat-aware nominal sounding proportions are approximately 22% for Trumpet 1, 27% for Trumpet 2, 70% for Horn 1, 53% for Horn 2, 46% for Trombone 1, 31% for Trombone 2, 42% for Bass Trombone, and 68% for Tuba. These figures measure occupied score time. They do not model effort, air demand, register difficulty, or acoustic loudness. Horn 1's larger workload deserves particular attention in the first reading.

Dynamic levels reinforce the selected roles: a solo line receives the section's base dynamic; accompaniment is generally one level softer. The opening and closing remain gentle; stronger bridge and chorus passages use moderate dynamics. The edition calls for light tongue and no mutes. There are no automatic mute changes or unprepared extremes of volume.

## 6. Voice chords with a bounded search

Each harmony defines pitch classes, a bass class, an onset, and a duration. All internal notes use **sounding MIDI pitch**, so the voicing calculation sees a single acoustic register system even though players read different transpositions.

Tuba takes the indicated slash bass or root in a low preferred register. For each participating upper voice, the code enumerates chord-tone pitches within a register window. It then scores candidate combinations for movement from that instrument's previous assigned pitch, preferred tessitura, large leaps, friction with fixed melody/cue notes, and missing harmonic classes.

The implementation uses a **beam search of width 48**. After adding one instrument, it retains the 48 best partial states, then continues with the next instrument. This avoids evaluating every possible eight-part combination. The following excerpt shows the central idea; the delivered `voiced()` contains the full implementation:

```python
movement = abs(pitch - previous.get(part, preferred_pitch))
local_cost = movement + max(0, movement - 7)**2
local_cost += 0.3 * abs(pitch - preferred_pitch)

# Rank partial voicings, including harmonic coverage.
states = sorted(
    next_states,
    key=lambda state: state[0]
        + 5 * len(set(chord_pitch_classes) - state[3])
)[:48]
```

This is a heuristic, not proof of a globally optimal voicing across the entire piece. A previous voicing influences the next, but the algorithm does not reconsider every earlier chord after seeing the ending. Moreover, a selected pitch may not be attacked if that part's rhythmic cell falls outside the short harmony span; harmonic coverage in the search is therefore a preference, not a promise that every degree sounds simultaneously at every instant.

Spacing restrictions are family-specific. Generated bass-trombone support stays at least seven semitones above the tuba bass; adjacent generated low-brass voices maintain at least four semitones. Generated trombones ascend Bass Trombone–Trombone 2–Trombone 1, horns ascend Horn 2–Horn 1, and trumpets ascend Trumpet 2–Trumpet 1. Adjacent semitones within a generated family are rejected. Fixed solo lines and transferred cues can cross accompaniment voices; the score does not enforce one universal low-to-high ordering across all eight players.

The final concert chord illustrates an open B-major distribution:

```text
Trumpet 1       B4
Trumpet 2       F#4
Horn 1          D#4
Horn 2          B3
Trombone 1      F#3
Trombone 2      B2
Bass Trombone   F#2
Tuba            B1
```

The third resides in Horn 1, with root and fifth distributed through the ensemble. Doubling supports the final sonority; tuning and actual balance remain ensemble decisions.

## 7. Convert harmony into brass texture

The accompaniment is not uniform. Horns and middle voices use sustained, breath-spaced support. In verse and vamp passages, tuba often uses a half-time quarter-note pulse on beats 1 and 3, also responding to actual harmonic starts. In bridge passages it plays eighth-note attacks followed by eighth rests on a quarter-note grid.

Trombone accompaniment places short eighth-note chord attacks principally on beats 2 and 4 in rhythmic sections. Bass trombone uses selected lower supports separated by rests. Trumpet responses are brief and sparse. These roles make the harmonic rhythm audible while avoiding continuous block scoring.

Durations are clipped at chord boundaries, so an accompaniment pitch is not automatically held into an incompatible harmony. Sustained source melody can cross those boundaries as the source specifies. The generator avoids overlaps inside a single instrument: a player never receives both a solo line and an independent accompaniment attack at the same time.

## 8. Encode transposition and spelling correctly

B-flat trumpet is written a major second above sounding; F horn is written a perfect fifth above sounding. The full score and parts use C-sharp major for trumpets (seven sharps), F-sharp major for horns (six sharps), and concert B major for trombones and tuba. This keeps the source's key rather than moving the entire arrangement to a simpler written key.

MusicXML's `<transpose>` describes the relationship from written notes to sounding notes. Thus the trumpet metadata is negative two chromatic semitones and negative one diatonic step; horn is negative seven chromatic semitones and negative four diatonic steps:

```xml
<transpose>
  <diatonic>-1</diatonic>
  <chromatic>-2</chromatic>
</transpose>
```

Enharmonic spelling is a separate concern from MIDI arithmetic. Trumpet spelling includes B-sharp and E-sharp; horn spelling includes E-sharp. The code derives the written octave from the selected letter and accidental, not simply from integer division of the MIDI number:

```python
written = concert_midi + semitone_shift
step, alter = spelling(part)[written % 12]
octave = (written - alter - STEP[step]) // 12 - 1
```

For example, concert A-sharp 3 becomes trumpet B-sharp 3, enharmonically C4, rather than an erroneously encoded B-sharp 4. The same concert pitch becomes horn E-sharp 4. A focused spelling test covers this boundary even when a particular part does not happen to play it in the arrangement.

Full-score chord symbols remain concert pitch, explicitly identified in the subtitle. Separate trumpet/horn parts transpose both chord roots and slash basses to their written key. Tuba reads actual concert bass clef without an octave-transposition tag; double-bass notation conventions do not apply to it.

## 9. Treat ties, slurs, and breathing as different instructions

A tie sustains one pitch without rearticulation. A slur connects different notes musically. The generator preserves compatible source ties and removes an orphan tie when a transfer or handoff leaves no matching same-pitch continuation in the receiving part. Notation splits can introduce additional ties while preserving the sounding duration.

Editorial slurs are short, beat-contained groups of adjacent moving notes, with no repeated pitch and no jump greater than a fifth. Repeated attacks remain articulated. This rule supplies a conservative starting point, not a complete brass articulation pedagogy. Horn/trumpet players decide when a smooth phrase requires a different valve or lip approach. Trombonists decide whether a printed slur needs light legato tonguing or an alternate position to avoid an unwanted glissando.

`breath_audit()` examines the unfolded performed timeline. It counts only rests of at least an eighth as opportunities; changing note, tonguing, or crossing a barline does not reset the sustained run. The rule rejects runs exceeding twelve quarter notes without that minimum opportunity. At 139, the measured maxima range from about 1.73 seconds for several low voices to 5.18 seconds for Trumpet 1. Horn 1's maximum is about 4.32 seconds.

An eighth rest is only about 0.22 seconds at this tempo. The audit cannot establish that every player can take sufficient air in that time. It also uses the nominal tempo: the written ritardando and final fermata can lengthen the ending considerably. The ensemble must agree final breaths, hold, and release. `PLAYER-REVIEW.md` provides passage-specific questions and a feedback table.

## 10. Write and independently read the notation

The output uses eight MusicXML divisions per quarter note: a full 4/4 bar occupies 32 units and the pickup occupies 8. Source divisions are converted before composition, avoiding rounding errors at eighth-note chord anticipations.

For each part/bar, `build()` combines event starts, event ends, chord starts, and bar boundaries into a sorted timeline. It places a harmony element at the actual XML cursor rather than depending on an importer to interpret offsets. If a chord starts inside a sustained note, it splits that note and joins its segments with ties. `notation.chunks()` maps uncommon or metrically awkward durations to ordinary note values; `beam_measure()` writes beat-aware beams for short notes.

After exporting, `decode()` reopens the XML, applies transposition metadata, and reconstructs sounding pitch at every time unit. It also verifies note types and dots, bar duration, matching tie endpoints, and paired slurs. That reconstructed timeline is compared with the authored events, both for the full score and each part. This catches errors that an XML parser alone would accept.

## 11. Verify the deliverables and understand the limits

The delivered edition passes 21 tests. They cover source hashes, exact opening preservation, later printed harmony and repeat/ending preservation, cue classification, performed repeat order, breathing opportunities, selected spacing, trumpet recovery, score-to-part equality, transposition, and enharmonic octave spelling. Mutation tests deliberately introduce bad pitches, durations, ties, chord symbols, repeat data, or transpositions and check that the validators reject them.

MuseScore engraved a 16-page A3 full score and eight four-page A4 parts. All 48 output pages were rendered and visually reviewed, with additional enlarged checks of the opening score and horn part. The package manifest records delivery hashes, and the ZIP is checked for corruption and content agreement.

Structural verification, visual engraving, audio review, and live playing are different stages. Here the first two are complete; audio and live-player review are not. The code does not simulate acoustic balance, intonation, fatigue, valve/slide technique, or room response. Treat this as an editable, checked arrangement for an informed first reading rather than a certified final performance edition.

To reproduce, open a terminal in the extracted package and run:

```sh
python3 arrange.py
python3 -m unittest -v test_arrangement.py
```

These commands regenerate MusicXML and musical reports. PDFs require a new notation-application export. `arrange.py` intentionally contains piece-specific form, phrase templates, and repeat-route decisions. Applying it to another song requires musical analysis and code changes; replacing the source file alone is insufficient.

## 12. References and what they contribute

The score is built from the supplied source and explicit editorial decisions. The following references explain instrument characteristics and notation conventions; they did not provide a ready-made arrangement of this song.

- [Philharmonia: Trumpet](https://philharmonia.co.uk/resources/instruments/trumpet/) describes a versatile instrument capable of lyrical as well as assertive playing. That supports using trumpet for a light opening rather than reserving it only for climaxes.
- [Philharmonia: Horn](https://philharmonia.co.uk/resources/instruments/horn/) discusses its characteristic sound and ensemble role. Horn lead passages and inner harmony here are editorial applications of that knowledge.
- [Philharmonia: Trombone](https://philharmonia.co.uk/resources/instruments/trombone/) provides instrument context relevant to the trombone choir and player-controlled slide articulation.
- [Philharmonia: Tuba](https://philharmonia.co.uk/resources/instruments/tuba/) provides context for the low brass foundation. The pulse patterns and ranges in this score are arrangement choices.
- [W3C MusicXML: harmony](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/harmony/) documents chord representation, including roots, kinds, and degrees; these fields underlie source-chord preservation.
- [W3C MusicXML: transpose](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/) documents written-to-sounding relationships; these underlie independent trumpet and horn round-trip checks.

The beam-search weights, twelve-quarter breath threshold, activity proportions, participation rules, and particular voicings are transparent choices in this edition's code. They are not universal orchestration laws or externally verified physiological limits. The strongest next source of knowledge is a measured first reading: record the passage, tempo, proposed articulation/breath, player's alternative, reason, and comfort/balance result, then revise the score and rerun its checks.
