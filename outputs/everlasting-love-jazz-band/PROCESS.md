# The Everlasting Love of God - piano with jazz band

This is a complementary jazz-ballad arrangement for the supplied piano score. The piano remains the musical anchor. The new saxophones, brass, bass, guitar, and drums supply harmony, responses, rhythmic support, and changes of color around it. The arrangement keeps even eighths at the source tempo, quarter note = 72. A jazz ballad can have this relaxed pulse without changing the piano's rhythms into swing.

The following is an account of the musical decisions, algorithms, and checks you can inspect and reproduce. The rules in the program are explicit editorial choices for this piece; they are not a universal formula for jazz arranging.

## 1. Establish what the source actually contains

The supplied file contains one piano part with two staves, 79 measures, 1,345 pitched note segments, and one rest. It has 158 chord symbols. The nominal key is F major. There are 299 notated quarter-note beats before any performance navigation. Measures change between 4/4, 3/4, and 2/4; this is not a uniform four-beat grid. The source also includes ties, phrase marks, tempo and dynamic information, piano-specific directions, lyrics/cues, navigation symbols, and a final fermata.

The program preserves the complete piano measure tree after removing engraving coordinates, measure widths, and forced page layouts. It does not reconstruct the piano from a simplified note list. That protects the inner voices, noteheads, ties, pedal information if present, and other details that a melody-and-chord reconstruction could lose. The original file is also included byte for byte as `original-piano.musicxml`.

The original work and source-arranger metadata are retained. The additional band arrangement is identified as an editorial arrangement. The MusicXML contains the original piano's musical content; a new PDF is necessarily a new engraving rather than an image of the original pages.

## 2. Choose the ensemble and its musical jobs

The lineup is two alto saxophones in Eb, two tenor saxophones in Bb, baritone saxophone in Eb, four trumpets in Bb, three tenor trombones, bass trombone, rhythm guitar, piano, acoustic bass, and drum set. This is a standard-sized big band with the requested rhythm instruments. There are 17 players and 18 staves because piano uses two staves.

| Section | Main job in this arrangement | How space is created |
| --- | --- | --- |
| Saxophones | Warm, sustained harmonic choir; occasional upper-sax answers | Pads leave written breath rests; the verses often use four lower saxophones |
| Trumpets | Soft upper-register responses at selected arrivals | Short tenuto notes, few entrances, restrained dynamics |
| Trombones | Low/middle harmonic answers and structural support | Alternate with the trumpet choir; avoid continuous low brass |
| Guitar | Brief, compact chord responses | Usually every other bar; three-note voicings and short durations |
| Piano | The supplied complete part | All original musical data preserved |
| Bass | Two-feel foundation; quiet quarters in the later chorus | Sparse attacks, source slash basses respected at harmony changes |
| Drums | Quiet brush-ballad pulse and changes between hat and ride color | Three-bar opening rest, restraint throughout, rest during the ritardando |

The saxophones have more continuous presence than brass. Dynamics describe an intention, not a measured acoustic balance. During rehearsal, the piano's upper line should remain clear, and the drummer and guitarist should listen for how much rhythmic information the pianist is already providing.

## 3. Read time correctly before assigning notes

`source.py` parses the piano using integer MusicXML divisions. This source has eight divisions per quarter note:

```python
quarter = 8
eighth = 4
half_note = 16
bar_4_4 = 32
bar_3_4 = 24
bar_2_4 = 16
```

For each measure, a cursor advances for an ordinary note. A note containing `<chord/>` shares the previous onset and does not advance the cursor. `<backup>` moves the cursor backward so another voice or staff can be represented. `<forward>` moves it ahead. This is essential: reading XML note elements as one long melody would scramble the piano's simultaneous voices.

The parser also records sounding MIDI pitch, staff, voice, duration, and tied-note chains. MIDI pitch is an internal numerical representation: middle C is 60, with one semitone per integer. The output remains conventional musical notation.

## 4. Extract harmony at its real onset

`harmony.py` follows the same time cursor and reads each chord's root, quality, added/altered/subtracted degrees, and slash bass. A chord span ends at the next symbol or the measure boundary. Where the source does not restate a harmony at the start of a measure, the preceding chord is carried forward. That produces 163 explicit spans from the 158 printed symbols; the five extra spans are continuations, not invented chord changes.

The accompaniment never carries a note blindly through a new chord. Each event is bounded by its own harmonic span. The source navigation and barlines are retained. The code copies the supplied segno and coda symbols without inventing an additional D.S. command or changing the form.

## 5. Add jazz color conservatively

The source already supplies minor sevenths, major sevenths/ninths, added seconds, suspensions, and slash chords. Those are useful harmonic material for a ballad. On source major triads, the program may add a sixth or ninth if the candidate belongs to F major and has no semitone pitch-class clash with any piano note overlapping that harmony span.

This screening is deliberately conservative. It considers every overlapping piano pitch class, rather than only the chord symbol or a single melody note. It can reject a musically acceptable ninth because an E appears elsewhere in the span; that is a limitation of the simplified model. Conversely, passing the test does not prove that every spacing or register will sound ideal.

Suspended and power chords retain their source quality. The program does not insert a third into a power chord just to make it sound more conventionally jazzy. It also avoids substitute dominants and chromatic reharmonizations that would require rewriting the protected piano.

The resulting plan has extra color pitch classes in 93 of its 163 spans. These are available colors: a three-note guitar chord or four-part verse sax texture need not contain every available pitch. Guitar and bass retain the source chord symbols, so the printed original symbol may be simpler than the band's complete voicing. Inspect `harmony-plan.json` to see the exact additions.

## 6. Voice the saxophone choir

`ordered_voicing()` enumerates possible chord tones in bounded registers. It requires strictly ascending sounding pitches from baritone through Alto 1. It restricts upper adjacent gaps to an octave and evaluates movement, leaps, register, missing characteristic tones, and harmonic coverage.

The cost used by the code is:

```text
cost = sum(|new_pitch - previous_pitch|)
     + 2 * sum(max(0, |new_pitch - previous_pitch| - 5)^2)
     + 0.25 * sum(|new_pitch - register_center|)
     + 8 * count(missing required characteristic tones)
     + 3 * count(missing available chord classes)
```

The squared leap penalty makes a large jump more expensive than several modest movements. Thirds and sevenths receive extra importance where the chord quality calls for them. Repeated common tones often win the search, which suits sustained accompaniment. The previous candidate is retained across successive harmonic spans, including spans where the section rests; this maintains a coherent register but is not an exhaustive optimization of all audible transitions.

This is a local search, not dynamic programming over the whole piece. It also does not implement a named drop-2 recipe. Calling every open voicing “drop-2” would be inaccurate: that term describes a specific transformation of a close-position chord.

Here is the actual opening F harmony, colored as F6/9:

| Instrument | Concert pitch | Written pitch |
| --- | --- | --- |
| Baritone saxophone | A2 | F#4 |
| Tenor saxophone 2 | F3 | G4 |
| Tenor saxophone 1 | C4 | D5 |
| Alto saxophone 2 | G4 | E5 |
| Alto saxophone 1 | D5 | B5 |

The piano and bass supply F as the foundation. The sax choir supplies A, F, C, G, and D, spreading the third, root, fifth, ninth, and sixth across the section. The upper fourths give the voicing an open color. Its register is an editorial choice you can change by editing the centers in `compose()`.

## 7. Create responses rather than doubling every piano note

The upper saxophone has short three-note answers at selected phrase endings. The algorithm takes a voiced pitch, chooses a nearby different chord tone where possible, and returns to the first pitch. For example, it generates a P-Q-P figure rather than copying the pianist's arpeggio. “Chord-tone neighbor” here describes the contour; it is not necessarily a non-chord-tone neighbor in strict contrapuntal terminology.

The figure is slurred across its three attacks and ends with a rest. The program replaces any overlapping Alto 1 pad in that span, avoiding two simultaneous musical instructions for one player.

Brass entries are chosen explicitly by measure number. Lower brass marks arrivals such as measures 14, 22, 31, 46, 57, 65, and 75. Trumpets respond at measures 26, 30, 40, 44, 61, 69, 73, and 79. Both choirs contribute at measures 73 and 79. These sparse, soft entries reflect the decision to keep piano central. They are not a transcription of all the piano's accents.

## 8. Arrange the rhythm section around the piano

The bass begins with a two-feel, generally half-note motion in 4/4. At each new harmony, it honors the source root or slash bass. Other attacks favor the fifth or root. Measures 65-73 use quiet quarter notes, with the last note sometimes chosen from the current chord to approach the next bass smoothly. This is a limited chord-tone bass design, not a complete chromatic walking-bass method. The source's short meters are treated as actual shorter measures.

Guitar voicings use three distinct pitch classes in a sounding span of at most nine semitones. The search favors the middle register and characteristic chord tones. Written guitar pitch is an octave above sounding pitch. The span check helps avoid awkward wide chords, but it does not determine string assignments or prove a particular fingering; a guitarist may select practical positions within the written harmony.

Drums use a quiet quarter-note hat or ride pulse, a soft bass drum on alternating beats, and brush/snare taps between them. This is a notated starting groove. A professional drummer can vary taps and add continuous brush sweeps while preserving the pulse, meter, and restraint. Brush sweep gestures are not reconstructed from the piano or fully simulated by General MIDI.

The final brass response releases early while the saxophones, guitar, bass, and piano carry the final sustained harmony. Follow the pianist/conductor through the final ritardando and fermata.

## 9. Separate sounding pitch from written pitch

All composition and range decisions use sounding pitch. Export adds the written transposition once:

| Instrument | Written pitch above sounding pitch | MusicXML sounding adjustment |
| --- | --- | --- |
| Alto saxophones | Major sixth | chromatic -9, diatonic -5 |
| Tenor saxophones | Major ninth | chromatic -2, diatonic -1, octave-change -1 |
| Baritone saxophone | Major thirteenth | chromatic -9, diatonic -5, octave-change -1 |
| Trumpets | Major second | chromatic -2, diatonic -1 |
| Guitar and bass | Octave | chromatic 0, diatonic 0, octave-change -1 |
| Trombones and piano | Unison | No transposition |

For example, concert C4 is written A4 for alto, D5 for tenor, A5 for baritone, and D4 for trumpet. In concert F major, the Eb saxophone parts have a D-major key signature and Bb parts have a G-major signature.

The MusicXML `<transpose>` describes the adjustment from written to sounding pitch. Its direction is the inverse of the arithmetic used to create written notes. The exported score is in transposed notation, including octave-transposing guitar and bass. [W3C transpose reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/).

## 10. Encode chords, ties, and drums correctly

When a duration crosses an awkward rhythmic boundary, `chunks()` divides it into standard note values and `write_event()` ties the segments. A chord is exported as several notes: only its first note advances the cursor; subsequent notes include `<chord/>`. The round-trip decoder applies that same rule, so guitar chords and drum combinations do not accidentally lengthen measures.

Drum notes use `<unpitched>`, a display position, an instrument ID, and a notehead shape. They are not fake pitched notes. Each drum sound has a separate instrument declaration; all use MIDI channel 10. The XML `midi-unpitched` value is one greater than the zero-based General MIDI note number. For example, bass drum note 36 is encoded as 37. The export maps kick, snare, closed hat, and ride separately. [W3C percussion tutorial](https://www.w3.org/2021/06/musicxml40/tutorial/percussion/).

The MIDI ports separate the large ensemble's pitched instruments and piano so that channel reuse does not assign the piano a saxophone sound. Audio playback quality still depends on the importing application's instrument library.

## 11. Reproduce and inspect the code

Keep these files together in the package folder:

| File | Purpose |
| --- | --- |
| `original-piano.musicxml` | Byte-preserved input |
| `source.py` | Source parsing, exact timing, notation primitives |
| `harmony.py` | Chord-span extraction |
| `arrange.py` | Color selection, voicing, composition, export, validation |
| `test_arrangement.py` | Musical invariants and deliberate corruption tests |
| `harmony-plan.json` | Every source harmonic span, selected colors and sax voicing |
| `arrangement-events.json` | Every new event: player, measure, onset, duration, pitches and musical role |
| `part-activity.json` | Notated activity per part; not a loudness measurement |
| `validation.json` | Source fingerprint and structural result |
| `engrave-jobs.json` | Local MuseScore PDF-export jobs |
| `pdf-audit.json` | Final PDF page counts and file sizes |

From a terminal in this folder:

```bash
python3 arrange.py
python3 -m unittest -v test_arrangement.py
"/Applications/MuseScore 4.app/Contents/MacOS/mscore" -j engrave-jobs.json
```

The PDF command is macOS-specific. On another system, use its MuseScore executable path or open the MusicXML interactively. No additional Python package is needed for the score generator or tests. MuseScore is needed only for engraving. Running the generator regenerates the MusicXML and analysis files in this folder.

An event has a deliberately simple representation:

```python
{
    "part": "GT",
    "bar": 1,
    "on": 4,          # eighth-note position after the downbeat
    "dur": 4,         # eighth-note duration
    "pitches": [53, 57, 60],  # sounding F3, A3, C4
    "role": "sparse guitar comp",
    "art": "tenuto",
    "slur": None
}
```

That dictionary is the actual opening guitar event. The saxophones supply the sixth and ninth while guitar gives a compact F-major triad. For the other events, inspect the JSON. Keeping musical events separate from notation makes it easier to change voicing without disturbing the writer or the protected piano.

To learn from the code, first change only a register center or a section-entry measure, regenerate, and inspect the result. Then try a different guitar-comp onset. Keep the validation on. Substituting a different source requires adapting the source-specific meter/division assumptions, section map, key-color filter, ranges, and expected source facts; this is not a generic one-command arranger for any song.

## 12. Validate the result and know what the tests mean

The package's 12 tests cover source counts, piano protection, actual exported transpositions and key signatures, part/score agreement, meters, navigation symbols, paired slurs, breath gaps, timing, and drum mapping. Several deliberately corrupt the piano pitch/tempo, a saxophone transposition, a duration, or percussion mapping and confirm rejection.

The decoder reads transposition from the exported XML rather than trusting the composer's configuration. It reconstructs every sounding pitch at each timing unit and compares that multiset with the planned events. This catches a wrong octave as well as a wrong note or duration. Each exported file is reopened before it is accepted.

The byte-preserved source fingerprint is:

```text
cdad3b123fca952a06fb52b74ba49e2f971c9dc0733f463f51999ec87f2b0b39
```

PDF checks include reopening the files, checking title/page counts, rendering pages, and inspecting the score and parts visually. These checks establish that the delivered notation is present and readable. They do not replace an audio audition or a rehearsal. No live players or audio audition were used for this version.

For player feedback, record the passage, tempo, proposed articulation/voicing, preferred alternative, reason, and comfort/sound assessment. Useful first questions are whether the saxophone registers blend at soft dynamics, whether bass reinforces or crowds the piano's left hand, and whether guitar should omit a written comp attack during a particularly active piano figure.

## 13. Study examples and references

The code itself is the most direct evidence for this arrangement: it shows exactly how the notes were selected. For musical study, compare the sound and score of a published ballad, listening separately to the lead voice, sustained backgrounds, bass activity, and brass entrances.

Jazz at Lincoln Center's [Essentially Ellington program](https://jazz.org/education/school-programs/essentially-ellington/) provides published repertoire resources and rehearsal guides, including *Blood Count* and *Prelude to a Kiss*. These are useful examples to study for ballad phrasing, section color, and accompanying a featured line. I did not copy their notes or claim that this generator reproduces their arranging methods.

For rhythm-section learning, NAfME's [rhythm-section education session](https://nafme.org/event/nafme-jazz-education-council-town-hall-from-beginnin-to-swingin-tips-and-tricks-for-teaching-rhythm-sections-at-all-levels/) describes work on listening, guitar/piano voicings, bass lines, and drum groove. It is a useful route to further instruction rather than a source for the generated pitches.

For implementation, the W3C [MusicXML reference](https://www.w3.org/2021/06/musicxml40/) is the primary specification. Its transposition and percussion pages explain the interchange mechanisms used here. Musical taste remains an editorial and rehearsal decision; the specification describes how to represent the decisions reliably.
