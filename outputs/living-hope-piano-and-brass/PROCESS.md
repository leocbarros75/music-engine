# Living Hope: piano with complementary brass

## Musical intention

This edition retains Dan Galbraith's supplied piano arrangement of Living Hope, by Brian Johnson and Phil Wickham, and adds eight independently notated brass parts. The instrumentation is two B-flat trumpets, two horns in F, two tenor trombones, bass trombone and tuba. It is intended for professional players, with the piano remaining prominent.

The piano supplies the principal musical statement and continuous movement. The brass supplies harmonic support, brief answers and structural emphasis. Unlike the preceding brass-only transcription, the added notes are newly composed from the source harmony; they do not systematically redistribute the piano notes among brass players.

The source contains 62 notated measures, including repeats and alternate endings, in E-flat major and 4/4 at quarter note = 71. There is no separate vocal staff. Consequently, the score does not claim to preserve a separately identified sung melody. It preserves the supplied piano part in full.

## Piano preservation

The combined score includes a deep copy of the original piano part. All 1,005 pitched note segments remain, together with the rhythms, voices, ties, chord symbols, pedal and performance instructions. The original MusicXML is also supplied unchanged as `original-piano.musicxml`.

“Intact” concerns musical content. Old page breaks, widths and coordinates are removed so that the piano can fit beneath eight brass staves. An embedded title is moved into the score header. The composite instruction mp - mf is represented as one text object. In measure 35, that marking and “2x - more motion” are joined into one text instruction to prevent a collision. Both instructions remain.

The validation compares normalized XML trees, rather than merely counting notes. Separate negative tests alter a piano pitch and tempo marking and confirm that the preservation check rejects both changes. Source identification and rights metadata are retained.

## Reading the source harmony

`read_source()` maintains a musical time cursor while reading MusicXML. A note advances time, a chord member shares the previous onset, `<backup>` rewinds the cursor for another voice, and `<forward>` advances it. Harmony offsets are included. Here eight duration units equal one quarter note and 32 equal a measure.

Each chord symbol becomes a time span containing a root, chord pitch classes and explicit bass pitch class. Where a measure has no new chord symbol, the last chord continues. This is a deliberate reliance on the source's chord labels, not an automatic harmonic analysis of every piano ornament.

`parse_chord()` handles the chord types occurring in this source, including major, minor, minor seventh, suspended fourth and added second, plus slash basses. For example, an A-flat add2 chord retains both C, its third, and B-flat, its added second. A B-flat sus4 uses E-flat rather than D. A slash chord's bass is used by the low brass rather than replacing it with the root.

Each new brass event must begin and end within one of these harmonic spans. The validator checks that its pitch belongs to the chord, or to the designated bass for tuba and bass trombone. This does not prove that every piano non-chord tone blends equally well with the added brass; that relationship still deserves listening review.

## Choosing voicings

The core four-note search has, from low to high, a bass-register reference, Horn 2, Horn 1 and Trumpet 1. It enumerates chord-tone candidates inside chosen ranges, rejects crossed core voicings and large upper gaps, then scores the remaining candidates.

```python
cost = motion + 2 * leap_penalty + 12 * missing_chord_tones + 0.2 * distance_from_centers
```

`motion` sums semitone changes from the previous voicing. `leap_penalty` squares motion beyond five semitones. `missing_chord_tones` encourages harmonic completeness. The final term discourages drifting to the edge of the working tessitura. This is a local exhaustive search, not a globally optimal solution or a rule for all brass music.

The tuba is then placed an octave below the original low reference and follows the written bass. Additional brass derives from the chosen chord tones: Trumpet 2 reinforces the upper interior, Trombone 1 sits an octave below Horn 1's selected tone, and Trombone 2 an octave below Horn 2. Bass trombone provides selective bass punctuation in its own register. These are deliberately related parts, not eight unrelated melodic lines.

## Form and orchestration

| Measures | Intended brass texture |
|---|---|
| 1 | Piano alone |
| 2-4 | Quiet horn color; occasional tuba and tenor support |
| 5 | Piano alone at the verse entry |
| 6-12 | Delayed Horn 2 support, occasional Horn 1, sparse low support |
| 13-23 | More horn support and selected short trumpet/horn answers |
| 24-34 | Fuller chorus, with brief trumpet and trombone pillars |
| 35-42 | Reduced texture for the later verse |
| 43-48 | Restrained tenor build toward the chorus |
| 49-61 | Full brass palette, still separated by rests |
| 62 | Shared final chord and coordinated fermata release |

Trumpet 2 is absent from the early verses. Bass trombone punctuates selected chorus measures instead of doubling the tuba continuously. Tenor trombones enter later in the texture, with a few earlier phrase-support notes. The added parts stay at p or mp in restrained passages and generally mf in the fuller sections; eight brass players at mf can still cover a piano, so these markings require room-specific balance decisions.

## Rhythm, answers and breathing

Sustained support usually lasts one to one-and-a-half beats, with delayed entries in some parts. These rests preserve room for the piano's movement and provide breathing time. The answer pattern is a quarter note followed by two eighth notes, grouped with a short slur. Its middle pitch is a nearby chord tone, not necessarily a scalar neighbor tone. The code describes it accurately as a chord-tone answer.

Answers occur only at selected measure endings and only when the remaining harmonic span is long enough. The answering instrument's simultaneous sustained support is removed, keeping the line monophonic. Trombone 1 often enters an eighth note after the main brass chord attack to reduce the weight of a unanimous onset.

The tests limit uninterrupted playing to four quarter-note beats in the notated sequence before the final fermata. This is a scheduling guard, not a physiological guarantee. Repeats, fatigue, register, dynamic level and the individual player all affect breathing. At the final fermata, release is conductor-led; its duration cannot be established by a fixed-beat test.

## Transposition and notation

All harmony and voicing calculations use sounding pitches. At export, trumpet notes are written two semitones higher and horn notes seven semitones higher. The MusicXML transpose metadata specifies the reverse written-to-sounding interval: -2 for trumpets and -7 for horns. The full score is transposed, matching the extracted parts.

| Instrument | Written key | Clef |
|---|---|---|
| Trumpets in B-flat | F major | Treble |
| Horns in F | B-flat major | Treble |
| Trombones, bass trombone, tuba | E-flat major | Bass |
| Original piano | E-flat major | Original treble and bass staves |

The brass pitch spelling uses a flat-oriented chromatic table appropriate to this material. It is not a general diatonic spelling engine for arbitrary modulations. The piano's original spelling remains untouched.

The generator supplies explicit beams for paired answer eighths and copies the original repeat and alternate-ending barlines to every part. The full score puts the eight brass staves above the piano. Page layout is rebuilt for ten staves, with four notated measures per score page except the final page.

## Code and output files

- `arrange.py`: standalone Python 3 generator using only the standard library.
- `test_arrangement.py`: nine tests, including deliberate-corruption checks.
- `harmonic-plan.json`: source chord spans and selected core voicings.
- `arrangement-events.json`: all 596 new notes, with part, measure, onset, duration, pitch, role and phrasing.
- `validation.json`: preservation and structural results.
- `engrave-jobs.json`: MuseScore PDF batch jobs.
- `original-piano.musicxml`: unchanged source copy.
- Combined and individual MusicXML/PDF files.

```sh
cd /path/to/living-hope-piano-and-brass
python3 arrange.py
python3 -m unittest discover -s . -p 'test_*.py' -v
mscore -j engrave-jobs.json
```

Run the generator after relocating the folder so the engraving job paths point to the new location. MuseScore can also open each MusicXML for manual editing and export. Regenerating overwrites the generated XML; keep hand-edited versions under a different name.

## Verification and rehearsal

Nine tests passed: piano preservation, rejection of changed piano pitch and tempo, brass transpositions, continuous-playing bound, suspension/add2/slash-bass handling, extracted-part equivalence, piano-only openings and final fermata, and rejection of corrupt brass duration. Every brass part is monophonic and every bar totals 32 units. Original repeat and ending structures are preserved.

PDFs are separately rendered for visual inspection. These checks do not establish a live performance result. No audio audition or player read-through is claimed. In rehearsal, listen especially to the piano's prominence, the weight of the lower brass, the placement of short answers against the piano melody, and the final release. The octave-derived tenor doublings and simultaneous harmonic pillars are the first places to reduce weight if the piano is covered.

For an instructive experiment, remove Trumpet 2 from one chorus and compare clarity. Then restore it and shorten its notes. Finally compare tuba alone with tuba plus bass trombone. This helps distinguish three independent arranging variables: register, density and duration.

## Further study

The [Philharmonia instrument resources](https://philharmonia.co.uk/resources/instruments/) offer player demonstrations for trumpet, horn, trombone, bass trombone and tuba. Use these to develop a listening vocabulary for register and articulation. The [W3C transpose reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/) explains the written-to-sounding encoding used here. These references explain instruments and notation; the specific voicing costs, entrance schedule and musical choices above are editorial decisions in this code.
