# O Espírito de Deus: composing and coding a piano accompaniment

## What this edition contains

A separate melody staff above the piano grand staff, in a lyrical vocal-score
texture. The 21 notated measures retain the source's 147 melody notes/rests,
rhythmic values, ties, chord symbols, repeat and alternate endings. The pianist
receives arpeggios, smoothly connected chord voicings, six neighbor-tone figures,
and a broader closing cadence. Suggested tempo: quarter = 72; all eighths are
straight. Tempo, piano dynamics and accompaniment are editorial additions.

The musical difficulty lies in balance, legato, bass movement and shaping around
the voice. Professional accompaniment does not require continuous virtuoso
figuration. The piano should support the melody even when its register overlaps
or rises above the singer. There are no lyrics in the supplied file to align.

## 1. Read the file without flattening its timeline

The source is Dorico MusicXML, with four divisions per quarter note. Therefore:

| Written value | Duration units |
|---|---:|
| Sixteenth | 1 |
| Eighth | 2 |
| Quarter | 4 |
| Dotted quarter | 6 |
| Half | 8 |
| Whole | 16 |

MusicXML document order is not always chronological. In this source, a note can
be followed by a backup, a harmony symbol, and a forward. That places the chord
at the beginning of the note rather than after it. Ignoring these controls would
move chord changes to the wrong beat.

The scan() function uses Fraction arithmetic and an explicit cursor:

```python
if element.tag == 'backup':
    cursor -= duration
elif element.tag == 'forward':
    cursor += duration
```

For a chord symbol, its onset is the cursor plus any explicit offset. A sounding
chord note marked with <chord/> shares the previous note's onset. The scan records
melody onset, duration, spelled pitch, ties, voice/staff and lyrics when present.
That signature is compared with the output, instead of merely counting notes.

## 2. Use the supplied harmony as the source of harmonic intent

This task does not require guessing chords from MIDI. The source already gives
its harmonic plan. In measure 2, C starts on beat 1 and G/B on beat 3. The slash
bass is meaningful: the second bass arrival is B, not G. The following A-minor
measure completes the local descending bass motion C-B-A.

The source also distinguishes E minor from E major. E major in measure 9 includes
G-sharp; replacing it with the diatonic E-minor chord would change the harmonic
intent. Measure 15 uses G-sharp diminished followed by A minor. Near the end,
A-flat major and B-flat major lead to C major under the sustained vocal C.

I interpret this as C-major/A-minor territory with chromatic color. That is an
analysis, not a reason to overwrite explicit source chords. Source melodic notes
sometimes add tensions to the triads; the arranger must retain and balance them.

The Harmony dataclass stores measure, onset, root, quality, bass, duration and
label. The pcs property produces the triad's pitch classes:

```python
major = (0, 4, 7)
minor = (0, 3, 7)
diminished = (0, 3, 6)
```

The present implementation supports those three qualities because those are the
ones this source uses. A general engine must explicitly implement or reject
other chord kinds, rather than silently treating every symbol as a major triad.

## 3. Choose a small vocabulary of textures

The TEXTURES mapping is an editorial composition plan, not an automatically
learned classifier. It lets the accompaniment change behavior through the piece.

### Moving vocal passages: flowing foundation

The left hand plays eighth-note chord arpeggios while the right hand sustains
triads or a lighter two-note voicing. This avoids duplicating every sixteenth
note in the melody. Measure 1, for example, uses a G-harmony arpeggio in the bass
under B-D-G in the right hand.

### Sustained vocal passages: short piano responses

In measures 3, 5, 7, 9, 11, 13, 17 and 18, the left hand uses quarter-note
arpeggios. The right hand begins with a half-note chord, then a short eighth-note
response. Not every response is ornamented. These are accompaniment figures,
not a fully independent second melody throughout the piece.

### Closing measures: broader harmony

Measure 20 uses half-note A-flat and B-flat chords with bass octaves. Measure 21
settles on C with a fuller right-hand chord and an octave in the bass. The upper
part preserves the original sustained C. The piano fermata is editorial; the
singer and pianist coordinate the final release.

Arpeggiation distributes chord notes through time; it does not by itself change
the chord. For examples and comparison with Alberti bass, study Robert
Hutchinson's [Arpeggiated Accompaniments](https://musictheory.pugetsound.edu/mt21c/ArpeggiatedAccompaniments.html).

## 4. Optimize chord voicings before writing the surface figuration

For each harmony, choose_voicings() enumerates ascending three-note combinations
between MIDI 57 and 76. It retains complete triads whose total span is at most an
octave. Candidate inversions therefore arise naturally from the note ordering.

A dynamic-programming search chooses the sequence with the lowest accumulated
cost:

```
transition = sum(abs(new_voice - previous_voice))
register_cost = 0.06 * abs(mean_pitch - 66)
span_cost = 0.025 * chord_span
```

The three voices are paired from lowest to highest. This rewards small movements
and common tones, with mild register and span preferences. These numerical
weights are editorial settings, not scientifically measured musical constants.

Example from measures 2-3:

| Harmony | RH voicing |
|---|---|
| C | C4 E4 G4 |
| G/B | B3 D4 G4 |
| Am | C4 E4 A4 |

Between C and G/B, the ordered voices move -1, -2 and 0 semitones. Between G/B
and Am, they move +1, +2 and +2. The maximum movement between successive searched
triads in this arrangement is three semitones per ordered voice.

Retaining common tones and minimizing unnecessary movement are useful
voice-leading principles. Compare with Hutchinson's
[Voice Leading Root Position Triads in Four Parts](https://musictheory.pugetsound.edu/mt21c/VoiceLeadingFourPartsRootPosition.html).
Our piano algorithm does not implement every rule of that four-part exercise:
it does not prove SATB correctness, forbid every parallel fifth, or optimize
counterpoint against the vocal line. It solves a narrower hand-position problem.

A right-hand inversion is not automatically the inversion of the complete
harmony: the actual bass note determines the latter. G/B retains B in the bass
regardless of the order of the right-hand notes.

The final written chord is deliberately fuller than the searched three-note
voicing. analysis.json reports the underlying searched voicings; the final
C4-E4-G4-C5 realization adds an octave frame.

## 5. Add genuine neighbor tones, with an explicit resolution

A complete neighbor figure departs from a chord tone by step and returns to that
same chord tone. It differs from a passing tone, which connects distinct anchors.
See [Neighbor Tones](https://musictheory.pugetsound.edu/mt21c/NeighborTones.html).

In measure 3, the right hand plays A4-B4-A4 after the opening A-minor chord,
then E4. B is the upper neighbor. It starts on the second eighth of beat 3 and
returns to A on beat 4. The vocal E can continue while this small figure moves.

The algorithm requires:

```python
neighbor - anchor in (1, 2)  # a semitone or whole tone above
neighbor % 12 not in harmony.pitch_classes
resolution == anchor
```

The same structural test is applied to all six selected figures. The placement
is deliberately sparse: measures 3, 5, 7, 11, 13 and 18. The mapping is an
editorial decision about where the voice leaves space; the code does not infer
that expressive decision from scratch.

A diatonic B over F major is permitted in the chosen C-major context. It is a
brief non-chord tone, not a permanent instruction to replace F with another
chord. If a performer finds that color too bright, the figure can be revised.
That kind of feedback is musical judgment beyond the structural neighbor test.

## 6. Check two hands together, not just each chord separately

An octave-limit test is useful but insufficient. An arpeggio can reach a pitch
already held in the other hand, producing a physical conflict even when all
individual chords are small.

I found and corrected that issue while building this version. The left-hand
candidate pool is bounded below the lowest RH voicing note. Validation then
compares every pair of overlapping RH/LH event intervals:

```python
if max(rh_start, lh_start) < min(rh_end, lh_end):
    assert max(lh_pitches) < min(rh_pitches)
```

This is intentionally conservative: professional players can redistribute notes
between hands, but this arrangement does not depend on an unmarked transfer.
It also checks piano range, duration/type agreement and four beats per staff.
These checks are not a complete fingering or comfort model.

## 7. Spell chromatic notes by harmonic function

G-sharp in E major and G-sharp diminished must not be presented as A-flat merely
because they share a MIDI pitch. Conversely, the A-flat chord in measure 20 needs
A-flat spelling. The name() function uses chord context to distinguish these.
There is a specific regression test for this distinction.

MIDI pitch numbers are good for interval arithmetic. Spelled pitches are needed
for readable musical meaning. A production engine should retain both throughout
its internal representation.

## 8. Preserve repeat structure and export MusicXML

The melody part is copied, its fixed page-position instructions are removed,
and a two-staff piano part is appended beneath it. The source's barlines and
alternate endings are copied to the piano as well. The visual layout is new;
the melody's musical event signature is unchanged.

The source has a tie into the first ending after measure 16; the second-ending
entry is retained exactly as supplied. Any alternative editorial handling of
that repeat-boundary tie should be agreed with the performer rather than
silently altering the source in this accompaniment pass.

The RH uses voice/staff 1 and the LH voice/staff 2. Chord members carry <chord/>.
After four RH beats, <backup><duration>16</duration></backup> returns the cursor
to the beginning of the bar for the LH. Eighth notes are beamed in beat pairs.
No recorded audio or MIDI transcription model is involved in this stage.

## 9. Tests and engraving

Run the six tests with:

```
python3 -m unittest -v
```

They test source timeline parsing and slash bass, melody/form preservation,
triad membership and span, neighbor resolution, chromatic spelling, and rejection
of a deliberately introduced hand collision. The exported PDF was rendered and
both pages visually inspected. This establishes readable layout, not an actual
pianist's performance assessment. I have not listened to an audio realization.

MuseScore was used for PDF engraving. Its process reported a shutdown crash on
one export even though it produced the PDF; the PDF was reopened independently
and visually checked. File integrity and the printed pages, rather than process
exit status alone, were used to assess the export.

## 10. Run it and learn by changing one decision at a time

All arrangement code uses the Python standard library. In the package folder:

```
python3 arrange.py
python3 -m unittest -v
```

The default input is source.musicxml next to the script. You can specify another
path with --source, but the texture map, measure count and cadence remain specific
to this 21-measure piece. Generalizing requires replacing those assumptions.

Outputs: o-espirito-melody-piano.musicxml and analysis.json. Open the MusicXML in
Dorico or MuseScore to play it, edit the engraving, or export a fresh PDF. The
Python script does not update the PDF automatically.

Try these experiments:

1. Remove measure 3 from NEIGHBOR_BARS and hear a purely chordal response.
2. Change a held passage from 'answer' to 'flow' and compare activity beneath the
   singer. Keep the harmonic rhythm identical so texture is the only variable.
3. Change the voicing register cost and inspect how the hands move. Re-run the
   collision test because a register change can make a previously safe pattern
   unsuitable.
4. Ask a pianist to compare two versions at the same tempo, then record the
   preferred version and the reason in PERFORMANCE-REVIEW.md.

## About the references

The linked textbook chapters are examples of public, inspectable foundations for
arpeggiation, neighbor tones and voice leading. They were consulted for this
explanation. They are not a claim about an exact training-data source, and no
specific published arrangement was copied into your accompaniment. The source
melody/harmony, the explicitly written texture plan, and the documented algorithm
are the direct inputs to this result.
