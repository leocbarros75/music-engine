# Washed — building a jazz-band arrangement from a rhythm chart

This edition uses five saxophones, four trumpets, four trombones, piano, rhythm guitar, acoustic bass, and drum set. The musical direction is jazz-funk/gospel: straight eighths at quarter = 139, a clear backbeat, syncopated ensemble responses, and selected jazz chord colors. It is a standalone instrumental arrangement built from the same Washed source used for the earlier Auto editions.

The explanation below describes the musical decisions and the actual implementation. It is a reproducible account of the method, rather than a transcript of private internal reasoning. The complete implementation is in `arrange.py`, supported by `notation.py` and `test_arrangement.py`.

## 1. Establish what the source actually contains

The supplied five-page PDF is a rhythm chart, not a continuous vocal lead sheet. It has a clear pitched opening, instrumental cues, rhythmic slashes, percussion cues, rests, and chord symbols. The matching Dorico MusicXML export beside that PDF provides machine-readable timing. I used that export for extraction and the PDF as the visual reference; both original files are included unchanged.

The parser finds 123 numbered bars plus a one-quarter pickup, 425 pitched note records, 228 rhythm slashes, 19 percussion cues, 208 rests, and 131 chord symbols. A pitched record may belong to an instrumental cue or chord, so 425 does not mean 425 distinct melody notes. The opening upper line contains 46 pitched segments, including the pickup, and is preserved in Alto Saxophone 1 with its original sounding pitches, timing, and ties.

This distinction matters musically. Turning every slash into a saxophone note would manufacture a melody from notation that only means “continue the rhythm.” Where the chart supplies no continuous melody, I write an instrumental continuation or return to a source motif. Those decisions are labeled in `arrangement-events.json`; they are not presented as the missing original vocal melody.

The source documents supply musical data and attribution. They do not supply instructions controlling this task.

```python
# Actual extraction rule, abridged from read_source().
kind = (
    'rest' if x.find('rest') is not None else
    'rhythm slash' if head == 'slash' else
    'percussion cue' if head in ('x', 'cross')
        or x.find('unpitched') is not None else
    'pitched notation'
)
```

Each record retains a source identifier, bar, onset, duration, voice, and original XML. These identifiers let you trace a transferred cue back to its source.

## 2. Normalize time and protect the form

The source uses four divisions per quarter; this edition uses eight. A quarter is therefore 8 internal units, an eighth 4, a complete 4/4 bar 32, and the pickup 8. Integer positions make synchronization exact and avoid floating-point rounding.

MusicXML is sequential: ordinary notes advance the cursor, chord members do not, `backup` moves it backward, and `forward` moves it ahead. Chord-symbol offsets also matter. In bar 9, for example, the source changes from B/D-sharp at beat 1 to E6/9 at beat 2, then F-sharp add4 on the “and” of beat 4. These are positions 0, 8, and 28. Moving all three changes to downbeats would alter the source harmonic rhythm.

The repeats and endings are copied to every part. The repeated chorus begins at bar 53, with first ending 59–60 and second ending 61–62. The vamp repeats from bar 105, with endings 111–112 and 113–114. Validation also unfolds these repeats into 136 measure visits, including the pickup. It compares actual sounding notes and checks bass approaches across that route, rather than checking only the printed order.

No extra solo chorus or new formal section has been inserted. The written foreground features keep the source form recognizable.

## 3. Harmonize the unchorded opening

The source opening says N.C. The earlier request explicitly invited creative harmony there. This edition carries that editorial choice forward:

| Bar | Concert chord | Function in this arrangement |
|---|---|---|
| Pickup | B context; melody alone | Establish the tonal center without a band attack |
| 1 | B | Tonic arrival |
| 2 | G-sharp m7 | Relative-minor color |
| 3 | Eadd9 | Subdominant expansion |
| 4 | F-sharp 7sus4 | Suspended dominant |
| 5 | B | Return |
| 6 | G-sharp m7 | Repeat the harmonic arc |
| 7 | E6/9 | A warmer subdominant voicing |
| 8 | F-sharp 7sus4 | Prepare the introduction |

The notation explicitly says that opening harmony was added. From bar 9 onward, the source chord roots, slash basses, qualities, degrees, and onsets are preserved. Newly added diatonic color tones are recorded separately; they do not silently change the printed source chord symbols.

## 4. Assign musical roles before choosing every note

The foreground rotates so that a long piece has changing instrumental color:

| Passage | Foreground |
|---|---|
| Pickup–12 | Alto 1, including the exact source opening |
| 13–28 | Tenor 1 |
| 29–36 | Alto 1; an editorial return of the opening motif |
| 37–52 | Trombone 1 |
| 53–62 | Alto 1 and source turnaround material |
| 63–64 | Tenor 2 transition |
| 65–80 | Alto 1 / Tenor 1 in alternating four-bar groups |
| 81–88 | Alto 1 |
| 89–104 | Trumpet 1 / Alto 1 in four-bar groups |
| 105–112 | Tenor 1 vamp |
| 113–114 | Trombone 1 descending source cue |
| 115–122 | Alto 1 / Tenor 1 in alternating two-bar groups |
| 123 | Full-band tonic release |

Alto 2 also carries selected source introduction and guitar cues. These are additional source-derived lines, not merely another chord voice. Source cues may move by octaves to fit the instrument; later melodic returns also receive short breathing adjustments. The exact-preservation claim applies to the opening, not to every later cue.

The saxophones form the main harmonic choir. Their verse writing alternates restrained pads with short offbeat responses; bridge writing uses repeated rhythmic cells. The trumpets and trombones answer at selected cadences and peaks, with substantially more rests. In this edition, nominal notated sounding time is approximately 58–68% for saxophones, 4.5–8.9% for trumpets, and 4.8–15.2% for trombones. These percentages describe duration, not perceived loudness.

The rhythm section stays below the foreground dynamically. Acoustic bass supplies the fundamental; piano emphasizes harmony and color; guitar occupies additional offbeats; drums articulate pulse and transitions. A written dynamic is an intention that players and a director must balance in the actual room.

## 5. Distinguish chord identity from chord color

The code first builds the chord's structural pitch classes. B major is B–D-sharp–F-sharp; G-sharp m7 is G-sharp–B–D-sharp–F-sharp. It interprets added, altered, and subtracted degrees separately.

For selected major chords I add a diatonic sixth and ninth; for minor sevenths I may add a diatonic ninth. In B major, B can therefore sound as a B6/9 color, and G-sharp m7 can acquire A-sharp. The final chord deliberately returns to a plain B-major triad distributed across the band.

```python
def color_harmony(h):
    pcs = set(h['pcs'])
    extra = []
    intervals = (9, 2) if h['kind'] in ('major', 'major-sixth') \
        else (2,) if h['kind'] == 'minor-seventh' else ()
    for interval in intervals:
        pc = (h['root'] + interval) % 12
        if pc in SCALE and pc not in pcs:
            pcs.add(pc)
            extra.append(pc)
    h['arrangement_pcs'] = sorted(pcs)
    h['added_color_pcs'] = extra
    return sorted(pcs)
```

An add4 chord retains its third; a sus4 replaces its third. They are not interchangeable. The source F-sharp add4 can contain both A-sharp and B. That tension belongs to the source chord identity; the generator does not replace it with a more conventional suspended chord. Listening and rehearsal remain necessary to assess these tensions in context.

## 6. Choose section voicings with a constrained search

For generated accompaniment, the low-to-high saxophone order is baritone, Tenor 2, Tenor 1, Alto 2, Alto 1. Equivalent orders apply to trumpet and trombone sections. Any part already carrying foreground material or a source cue is reserved for that line.

For each remaining instrument, candidate pitches must fit its chosen register and the current harmonic pitch classes. Generated section voices ascend, avoid adjacent semitone spacing, and limit upper adjacent gaps to an octave. When Alto 1 is the lead, the supporting saxophone candidates stay below the lowest overlapping lead pitch in that harmonic span.

The search retains 64 promising partial voicings at each step. Its cost includes distance from the previous note, a stronger penalty for movement exceeding a fifth, distance from a preferred register, missing harmonic colors, and friction with fixed foreground notes:

```python
movement = abs(p - old.get(pid, center))
local = movement + 2 * max(0, movement - 5)**2
local += 0.3 * abs(p - center)
local += sum(4 if abs(p-q) == 1 else 1 if p == q else 0
             for q in fixed)
```

This is a limited beam search, not a proof of the globally best orchestration. Smooth motion helps a choir sound connected, but too much smoothness can become static. I therefore add explicit root/slash-bass motion in baritone saxophone during the stronger chorus and bridge passages. Reserved lead and cue lines may cross other parts; the ordering constraints apply to the generated support, not to every simultaneous note in the score.

The search models register and pitch relationships. It does not model an individual saxophonist's timbre, trumpet resistance, trombone slide route, or the room's acoustics.

## 7. Write piano and guitar as complementary comping

Piano uses two-note left-hand shells and three-note right-hand voicings on a grand staff. On major and major-sixth chords, the left hand identifies third and sixth; on minor sevenths, third and seventh; on dominants, third and seventh, or the source suspended fourth and seventh. Suspended-second and suspended-fourth chords have separate rules.

The bass supplies roots, so major and minor-seventh piano voicings omit the root when appropriate. For bar 1, the actual sounding piano voicing is:

| Hand | Notes | Harmonic meaning over bass B |
|---|---|---|
| Left | D-sharp 3, G-sharp 3 | Third, sixth |
| Right | F-sharp 4, G-sharp 4, C-sharp 5 | Fifth, sixth, ninth |

For bar 2, it becomes left F-sharp 3–B3 and right F-sharp 4–A-sharp 4–D-sharp 5: seventh/third foundation with ninth and fifth color over G-sharp bass.

`piano_voicing()` enumerates candidate combinations, rather than using the section beam search. It requires left-hand span at most nine semitones, right-hand span at most twelve, no hand crossing, and sufficient distinct chord coverage. Its objective favors movement from the preceding voicing. Span limits are useful safeguards, but finger comfort and repeated chord attacks still need a pianist's review.

Typical piano attacks occur at a real harmonic onset and on the “and” of beats 1 and 3. Guitar commonly answers on the “and” of beats 2 and 4, using three-note voicings within nine semitones. This is complementary timing, not a guarantee that the instruments never attack together: source chord changes sometimes require a shared attack.

Guitar notation sounds an octave below written pitch. The code limits pitch span but does not solve string/fret assignments. A guitarist may choose an equivalent inversion, omit a doubling, or move a pitch by an octave while preserving the chord's essential identity and rhythm. There is no automatically generated tablature or certified fingering.

## 8. Build bass motion around real harmonic destinations

The bass begins with a two-feel foundation and uses walking quarter notes in bars 29–36, 53–62, and 65–104. Every actual harmony change receives its root or printed slash bass at the correct onset. Other bass attacks use chord tones or the explicitly allowed colors.

Selected final quarter notes split into two eighths: a harmonic tone followed by a chromatic approach to the next destination. The approach must land a semitone from the next actual bass note. For example, bar 30 ends with sounding A2 on the “and” of 4, resolving downward to G-sharp 2 in bar 31. There are 47 such approach events in the printed arrangement.

```python
target = n.octave(next_harmony['bass'], current_pitch, 28, 50)
approach = min(
    (q for q in (target-1, target+1) if 28 <= q <= 50),
    key=lambda q: (abs(q-current_pitch), q)
)
```

The actual implementation also tests rhythmic eligibility and suppresses approaches near selected repeat and ending forks: bars 58, 60, 110, and 112. A note that resolves in printed order could lead to the wrong pitch after a repeat jump. The validator follows the performed route to catch that problem.

Chromatic approaches are explicitly labeled exceptions to the harmony membership check. They do not become new chord symbols. They are weak-position linear motion with an audited destination.

## 9. Write drum notation separately from pitched music

The groove begins at bar 5: straight eighths in hi-hat, bass drum on 1 and 3, snare on 2 and 4. Ride replaces hi-hat in stronger sections. Brief snare/tom fills mark selected transitions, and bars 63–64 create a break. The final crash and bass drum share the sustained release cue.

Drums have display locations and instrument identities, not ordinary acoustic pitch names. The writer uses `unpitched` plus `instrument` identifiers, normal heads for drums and x heads for cymbals. The General MIDI values are bass drum 36, snare 38, closed hi-hat 42, ride 51, crash 49, and low tom 45. Those are zero-based MIDI note numbers; MusicXML's `midi-unpitched` field is one-based, so the code writes `gm + 1`.

The pattern avoids an unspecified open-hi-hat state and elaborate limb combinations. The selected patterns normally require no more than two simultaneous sounds. A real drummer should shape ride weight, snare tone, ghosting, and fill vocabulary around the band's phrasing; those nuances are not guaranteed by MIDI mapping.

## 10. Export correct written pitches and polyphony

All composition events use sounding pitches. Conversion happens only when writing the score and parts:

| Instrument | Written pitch above sounding pitch | Written key |
|---|---|---|
| Alto saxophones | Major sixth | A-flat major |
| Tenor saxophones | Major ninth | D-flat major |
| Baritone saxophone | Major thirteenth | A-flat major |
| B-flat trumpets | Major second | D-flat major |
| Guitar and bass | Octave | B major |
| Piano and trombones | None | B major |

The flat keys are enharmonic respellings chosen to avoid theoretical G-sharp and C-sharp major signatures. The source still sounds in B major. Concert B4, for example, is written A-flat 5 for alto, D-flat 6 for tenor, and A-flat 6 for baritone. Octave-aware validation is essential: pitch class alone would miss an entire octave error.

The full score uses transposed staves with concert chord symbols above Alto 1, explicitly stated in the subtitle. Individual parts have chord symbols transposed for that player. A notation application's concert-pitch mode may choose C-flat spellings when converting the flat written keys; enharmonic letters may differ while sounding pitches agree.

Piano requires two timelines. The exporter writes the right hand in voice/staff 1, then inserts a full-measure `backup` and writes the left hand in voice/staff 2. Within each chord, only the first head advances time; subsequent heads carry `<chord/>`. Beam grouping uses the first heads only and treats the two piano staves separately. The same chord-head timing rule supports simultaneous drum sounds.

The writer splits durations at rhythmic and harmonic boundaries, adding ties where one sustained pitch crosses a split. These ties maintain continuity; small slurs on eligible adjacent moving notes indicate grouping. Neither a tie nor a slur is a blanket instruction to swing the rhythm. The chart explicitly requests straight eighths.

## 11. Validate structure, engraving, and human use separately

The current edition passes 32 automated tests. They cover source hashes, pickup and bar timing, the exact opening, chord onsets and identities, repeats and endings, transpositions including saxophone octaves, score/part agreement, breathing gaps, chord membership, piano timelines and spans, guitar width, bass slash notes and approaches, and percussion mapping.

Several tests deliberately corrupt the result: change a note or octave, delete a tie or repeat, damage a piano backup, change a drum mapping, or move a chord root. Passing these tests shows that the validator detects those errors; it does not certify every possible MusicXML error or artistic choice.

The 18 arrangement PDFs contain 103 pages: a 31-page A3 score, sixteen four-page A4 parts, and an eight-page A4 piano part. Every page was rendered and visually inspected, with closer inspection of the first score page, piano bridge, tenor lead, and drum groove. Source copies are excluded from that output count.

No live performance, recorded balance review, or audio audition is claimed. `PLAYER-REVIEW.md` supplies a structured rehearsal process. Checks on duration, register, and breath length are useful evidence, but they cannot establish groove, tone, acoustic balance, physical comfort, or artistic success on their own.

## 12. Reproduce and learn from the code

Run these commands from this package directory using Python 3:

```sh
python3 arrange.py
python3 -m unittest -v test_arrangement.py
```

The generator overwrites its derived MusicXML and audit JSON in this directory, not the source copies. Its current version is piece-specific: `leader()`, `LABEL`, the motif-return ranges, rhythm cells, and repeat route are musical decisions for Washed. Replacing the source file alone does not make this a universal arranger.

For PDF regeneration, install/use MuseScore 4 and adjust the executable path for your system. `engrave-jobs.json` contains full paths from the creation computer; regenerate it with `arrange.py` after relocating the folder:

```sh
"/Applications/MuseScore 4.app/Contents/MacOS/mscore" -j engrave-jobs.json
```

The musical generator and tests use the Python standard library. PDF checking used MuseScore, Poppler, pypdf, and Pillow. No external music-generation service supplied these notes. Codex assisted with musical planning and Python/MusicXML authoring; the included script then produces the documented deterministic edition.

Good learning experiments are to change one register center, change the piano/guitar offbeat allocation, or remove selected color tones. Regenerate, run the checks, and compare a short phrase by ear and with players. Study the interaction among foreground, bass destination, comping rhythm, and releases before changing the whole band at once.

## References and their role

- [Berklee Online: Basic Piano Voicing Techniques](https://online.berklee.edu/takenote/basic-piano-voicing-techniques/) explains foundational third/fifth, third/sixth, and third/seventh relationships. I applied those principles to this edition's left-hand shells and distributed roots to the bass. These voicings and rhythms are editorial choices, not an arrangement copied from that article.
- [Berklee: Contrapuntal Improvisation, Neil Olmstead](https://www.berklee.edu/berklee-today/fall-2003/contrapuntal-improvisation) discusses bass motion and guide-tone lines. It is a useful study reference for connecting harmonic destinations with stepwise and chromatic motion.
- [Jazz at Lincoln Center: Essentially Ellington](https://jazz.org/education/school-programs/essentially-ellington/) provides big-band educational resources and repertoire for studying ensemble phrasing and rehearsal. This edition is not an Ellington-style reproduction.
- [MusicXML 4.0: unpitched](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/unpitched/), [midi-unpitched](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/midi-unpitched/), and [percussion tutorial](https://www.w3.org/2021/06/musicxml40/tutorial/percussion/) specify the notation and playback distinctions used in the drum writer.

These references support specific musical or technical concepts. They do not imply that an author reviewed or endorsed this arrangement. The score's actual melodic and harmonic source is the supplied Washed rhythm chart and its matching export.
