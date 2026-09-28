# Living Hope: piano-to-brass transcription laboratory

## What this edition is

An editorial transcription for eight professional brass players: two B-flat trumpets, two horns in F, two tenor trombones, bass trombone and tuba. The brass carry the complete texture; no piano is required. This is an adaptation of the supplied piano arrangement by Dan Galbraith, of the song by Brian Johnson and Phil Wickham. The original credits remain in the MusicXML metadata. Keep the source's licensing information with the files.

This guide describes the implemented musical decisions and reproducible algorithm. It does not claim that an automated scoring rule replaces rehearsal or that this edition has been played by a professional ensemble.

The source contains 62 notated measures in E-flat major, 4/4, at quarter note = 71, with repeats and alternate endings. There is no separate vocal staff. Consequently, “melody” here means the highest currently sounding right-hand piano note, not a separately verified sung melody. That line includes the pianist's fills and chord-top notes.

## 1. Decide what must survive the transfer

A transcription must keep the musical identity while accommodating a different sound-producing system. Here the priorities are the source form, upper piano line, principal bass, harmonic interior, and rhythmic attacks. There is no newly invented countermelody or reharmonization. Each output note has a source identifier and retains that source's pitch class; octave displacement is permitted.

A piano can sustain several notes under pedal while its performer initiates new attacks. Eight brass players can sustain independently, but each needs air, clear entries, and a coherent individual line. Literal copying of every piano staff into a brass part would therefore be a poor allocation of performers. This edition removes redundant octave doublings, redistributes registers, and shortens selected note endings to admit breaths.

The original source is preserved as `original-piano.musicxml`. The output is a transcription, not a claim of note-for-note identity: 870 of the source's 1,005 pitched note segments contribute to the result. The 135 unused segments are listed in `omissions.json`. A source segment is a notated note including a tied continuation, not necessarily a fresh attack.

## 2. Read musical time correctly

`read_source()` walks through the MusicXML, rather than assuming the notes appear in chronological order. Piano XML commonly writes a complete right-hand voice, uses `<backup>` to move the clock backward, then writes another voice or the left hand.

The source uses eight divisions per quarter note. Thus a quarter lasts 8 units, an eighth 4, a sixteenth 2, and a 4/4 bar 32. A `<chord>` note shares the preceding note's onset and does not advance the clock. `<backup>` subtracts time; `<forward>` adds it.

For each pitched segment the parser records its measure, onset, duration, staff, voice, MIDI pitch, original XML and source ID. It also assigns a chain identity to tied notes. Repeated same-pitch attacks have different identities; tied continuations share an identity. Without this distinction, an algorithm could incorrectly turn repeated articulations into a long tied note.

```python
onset = previous_onset if is_chord_note else cursor
if not is_chord_note:
    previous_onset = cursor
    cursor += duration
```

The parser verifies that every source measure reaches 32 units and that source ties have matching continuations.

## 3. Divide the piano texture into active intervals

For each measure, the algorithm gathers every note onset and ending, plus the bar boundaries. Adjacent boundaries form small intervals within which the set of sounding source notes is constant.

```python
bounds = sorted({0, 32} | {n['on'] for n in notes}
                | {n['on'] + n['dur'] for n in notes})
active = [n for n in notes if n['on'] <= start < n['on'] + n['dur']]
```

This matters when, for example, a right-hand chord continues across a moving bass note. Evaluating only beats would miss source changes between beats. The algorithm uses the actual encoded notes; it does not guess new harmony from chord symbols.

## 4. Allocate musical roles

| Part | Main responsibility |
|---|---|
| Trumpet 1 | Upper piano line in the introduction, verse continuation, choruses and closing |
| Trumpet 2 | Upper interior reinforcement in choruses and closing |
| Horn 1 | Upper piano line in measures 5-12 and 35-42; middle reinforcement in choruses |
| Horn 2 | First distinct inner right-hand pitch class |
| Trombone 1 | Next distinct inner right-hand pitch class |
| Trombone 2 | Deeper inner tone or octave reinforcement of the lower harmonic voice |
| Bass trombone | Principal bass reinforcement at selected structural points |
| Tuba | Principal left-hand bass, using source voice 3 |

Source left-hand voice 4 is excluded: it is an alternate layer in the piano texture, not a second bass line to reproduce indiscriminately. That is an editorial choice worth reconsidering when comparing the edition with the source.

The chorus regions are measures 24-34 and 49-62. Bass trombone reinforces their first two beats, plus selected earlier phrase pillars, instead of doubling every tuba movement. Trumpet 2 rests outside the fuller regions. Where the right hand offers only a single pitch class, the interior parts rest rather than manufacture a chord.

Not all eight instruments need different notes. Selected octave and unison reinforcement provides weight, but the independent source lines remain identifiable. The score order groups trumpets, horns, then trombones and tuba.

## 5. Choose registers and voice leading

For a source pitch class, `octave()` enumerates permitted octave equivalents and chooses the pitch nearest a target. For interior parts that target is normally the previous pitch, encouraging economical motion. The melody targets the original pitch register. The inner allocation also tries to keep successive voices below the preceding voice.

```python
candidates = [p for p in range(low, high + 1) if p % 12 == source_pitch % 12]
chosen = min(candidates, key=lambda p: (abs(p - target), p))
```

This is a local nearest-note heuristic, not global optimization or a universal orchestration rule. When a strict vertical ceiling would eliminate every octave option within the working range, the code relaxes the ceiling to provide an octave of candidates. Voice crossing can therefore occur. Range and line continuity have priority over an absolute no-crossing rule; inspect such passages in rehearsal.

The working ranges are conservative design bands for this edition, not complete statements of each instrument's capabilities. `playability-audit.json` records the actual sounding extremes. Tuba includes low E-flat1 at the final cadence. A player may choose an octave alternative depending on instrument and ensemble balance.

## 6. Notate transposition without changing sound

All allocation is computed in concert pitch. Only when writing notation does the code transpose trumpets up a major second and horns up a perfect fifth. It moves both the letter name and the semitone value, preserving meaningful enharmonic spelling.

| Instrument | Concert E-flat major becomes | Written C4 sounds |
|---|---|---|
| B-flat trumpet | F major, one flat | B-flat3 |
| Horn in F | B-flat major, two flats | F3 |
| Trombones and tuba | E-flat major, three flats | C4 |

The MusicXML `<transpose>` value describes the transformation from written to sounding pitch. It is therefore negative here:

```xml
<!-- B-flat trumpet -->
<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
<!-- Horn in F -->
<transpose><diatonic>-4</diatonic><chromatic>-7</chromatic></transpose>
```

Both the full score and player parts are transposed. The trombones and tuba use concert-pitch bass clef. MIDI program numbers request the appropriate general instrument families; they do not establish realistic playback quality.

## 7. Breaths, ties, articulation and endurance

After neighboring intervals from the same source chain are merged, alternating measure endings are selected for breaths, staggered by part. The last note is shortened by up to an eighth note. If it is already short, half its duration is released instead. Its attack is retained. This produces 118 written breath rests, with corresponding breath marks.

Ties are rebuilt after these releases. A tie is allowed only when source-chain identity, sounding pitch and exact temporal adjacency all match. An intentional breath breaks the tie. Short contiguous moving notes within a beat can receive a slur if they have no intervening breath or tie and their steps/leaps satisfy the implemented limit. These slurs propose a musical grouping; brass players still determine the practical tongue and air coordination.

The longest continuous passage in the notated sequence is 7.75 quarter-note beats before a rest, excluding the final fermata. At quarter = 71, that is about 6.55 seconds. This is an audit of time, not a proof of sufficient air. Some rests are only a sixteenth note; a player may need to release earlier or redistribute an entry. The audit does not expand the repeat road map, so repeat-boundary breathing and total lip endurance need separate rehearsal review.

The final fermata is open-ended. The conductor should coordinate a comfortable final duration and collective release. Bass trombone and tuba should support the final chord without masking its upper voices.

## 8. Preserve form and prepare readable notation

Every part receives the original barlines, repeats and alternate endings. Tempo markings, dynamics and hairpins transfer; piano pedal marks and keyboard-specific instructions do not. Rehearsal labels identify major sections. These copied dynamics are a starting point: brass balance can require a lower accompaniment level than the source piano marking suggests.

Unusual durations are split into conventional tied values. Beams are grouped metrically. Engraving is rebuilt for the new ensemble rather than inheriting piano page coordinates. The full score has eight staves; each individual part is independently engraved.

## 9. What the checks establish

Nine automated tests check full sounding-pitch and duration reconstruction, transposing keys, extracted-part equivalence, source support at every retained time unit, monophony/ranges, the notated breathing bound, and adjacent ties. Deliberately corrupted pitch and duration data are rejected in two negative tests.

`validate()` also verifies 62 measures per part and matching source repeats/endings. `note-map.json` identifies the source of each brass event, the role, octave displacement, breath trim and resulting ties/slurs. There are 1,271 events before extra notation splits; 388 are octave-displaced relative to their source note. These counts include deliberate doubling across instruments.

The PDFs are separately rendered and visually checked. Automated structure checks, visual engraving review, audio playback and a player read-through are different stages. This package does not claim an audio audition or live read-through. Human review should particularly address lead prominence when Horn 1 carries the tune, low-register clarity, short breath opportunities, repeated-section stamina and page turns.

## 10. Reproduce and explore

Python 3's standard library is sufficient to generate the MusicXML and audit files:

```sh
cd /path/to/living-hope-brass-ensemble
python3 transcribe.py
python3 -m unittest discover -s . -p 'test_*.py' -v
```

For PDF export, install MuseScore and open each MusicXML, or run its batch converter:

```sh
mscore -j engrave-jobs.json
```

Run the generator first after moving the folder: it rewrites the batch file with the new absolute paths. The macOS executable is typically inside the MuseScore application bundle. Output XML is editable in notation applications; check imported transposition and repeat notation before making player copies.

Useful experiments: change the horn-led regions; compare the principal line in trumpet and horn registers; remove chorus doublings and listen to transparency; adjust the breath schedule and inspect which source durations change. Change one variable at a time and rerun the tests. Avoid treating a green test suite as a musical quality score.

## References and listening study

- [Philharmonia instrument resources](https://philharmonia.co.uk/resources/instruments/) introduce orchestral instruments through player demonstrations. Follow the trumpet, horn, trombone, bass trombone and tuba entries to study their sound and practical use.
- [Philharmonia trombone resource](https://philharmonia.co.uk/resources/instruments/trombone/) gives a player-centered starting point for understanding the instrument in an ensemble.
- [W3C MusicXML transpose reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/) documents written-to-sounding transposition.
- [W3C MIDI-compatible MusicXML tutorial](https://www.w3.org/2021/06/musicxml40/tutorial/midi-compatible-part/) explains pitch, duration and playback-related notation.

These references explain instruments and encoding. The exact allocation, ranges and breath heuristic in this edition are editorial choices implemented in the supplied code, not prescriptions attributed to those sources.
