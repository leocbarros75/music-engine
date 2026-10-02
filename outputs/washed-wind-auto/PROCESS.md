# Washed - Wind Auto: musical decisions and code walkthrough

Prepared October 2, 2026 with Codex. Flute, Oboe, Clarinet in B-flat, Bassoon. Professional chamber arrangement from the supplied rhythm chart. The score uses written pitch for the clarinet; its chord symbols above the flute are concert-pitch harmonies. Each individual part has chord symbols appropriate to that instrument's written pitch.

## 1. Start with reliable source data

The source is the same five-page Washed rhythm PDF used for String Auto. Its matching adjacent Dorico MusicXML provides the note, rhythm, chord, and repeat data. Unchanged copies are included as `source-rhythm.pdf` and `source-rhythm.musicxml`. Their SHA-256 fingerprints match the source copies from the string package.

The chart is in B major, 4/4, quarter note = 139. A two-eighth-note pickup precedes 123 numbered measures. Two passages have repeats and alternate endings. There are 124 measure elements in the notation file; following the two repeats produces 136 played measure visits, including the pickup.

This is a rhythm chart containing a partial melody and pitched instrumental cues. It is not a complete vocal lead sheet. The source contains normal pitched notes, rhythm slashes, percussion cues, rests, and simultaneous chord tones. The parser distinguishes these categories before extracting any line. A rhythm slash's nominal staff pitch is never treated as a melody note.

`read_source()` follows the MusicXML time cursor: ordinary notes move it forward, chord tones share the previous onset, `<backup>` moves it backward for another voice, and `<forward>` advances it. The source's four divisions per quarter become eight divisions per quarter in the arrangement. This preserves exact eighth-note anticipations without relying on floating-point time.

## 2. Define what remains and what is newly arranged

Flute retains the opening's 46 pitched segments, including the pickup, with original pitch, onset, duration, and ties. Rest positions follow from those exact note times. The pickup remains melody alone. Original chord symbols from measure 9 onward retain their roots, qualities, slash basses, added degrees, and change times. All repeat and ending barlines are copied to every part.

The N.C. opening receives the same editorial harmony as the string edition. It is identified as added harmony, not represented as recovered original harmony. Later slash-only sections receive new instrumental continuations. The opening theme returns in later choruses, and the bridge uses written riffs plus new harmonic sequences based on their contour.

Register transfers and redistribution are part of the arrangement. Source cues can move by octaves to fit a wind instrument; source ties are reconciled when a line changes instrument. The preserved opening remains a separate, exact requirement.

The event file records `layer`, `role`, and source IDs. Its three layers are lead, source cue, and accompaniment. A newly sequenced source motif can retain a prototype source ID while its role explicitly says that its notes are editorial. This distinction makes the provenance inspectable rather than implying every derived pitch was printed in the original.

## 3. Keep the opening harmonization coherent

| Location | Editorial harmony | Function and color |
|---|---|---|
| Pickup | B context; melody alone | Tonal preparation |
| 1 | B | Tonic |
| 2 | G#m7 | Relative minor with shared tonic-chord tones |
| 3 | Eadd9 | Subdominant with added F# |
| 4 | F#7sus4 | Suspended dominant with E as the seventh |
| 5 | B | Tonic return |
| 6 | G#m7 | Relative-minor contrast |
| 7 | E6/9 | Expanded subdominant |
| 8 | F#7sus4 | Preparation for the printed introduction |

In measures 1-2, the Bassoon changes from B2 to G#2 while Clarinet retains concert D#4 and Oboe retains F#4. Common tones make the harmonic change smooth. These are chosen pitches, not uninterrupted two-bar sustains: the rhythmic layer leaves rests for breathing.

In measure 3, Bassoon plays E3, Clarinet concert E4, and Oboe G#4, while the flute melody supplies B and F# among its notes. The texture distributes harmonic information across melody and accompaniment. The added ninth does not need to be doubled everywhere.

The melody may contain expressive non-chord tones. C# over G#m7 contributes a ninth color during a moving figure. Harmonic support stays at the phrase level instead of changing chord on every melodic note.

## 4. Recompose the orchestration for four different timbres

| Instrument | Role in this edition | Actual sounding range |
|---|---|---|
| Flute | Preserved opening, chorus return, selected cues, bridge solos, closing upper phrases | F#4 - E6 |
| Oboe | First-verse continuation, later chorus, turnaround cues, bridge responses | F#4 - G#5 |
| B-flat Clarinet | Second-verse and vamp lead, transferred guitar cue, bridge solos, inner harmonic support | G#3 - F#5 |
| Bassoon | Specified harmonic bass, lightly tongued pulse, slower closing support | F#2 - E3 |

Clarinet's actual written range is A#3-G#5. The ranges in the table describe this arrangement, not the complete instrument ranges. No piccolo, English horn, bass clarinet, contrabassoon, multiphonics, or other extended techniques are required.

A flute can carry a clear upper line; oboe offers a contrasting reed color; clarinet moves between inner support and melodic foreground; bassoon combines harmonic foundation with articulated rhythm. These are practical orchestration choices informed by the instruments' different colors. Philharmonia's player-led resources provide useful starting points: [flute](https://philharmonia.co.uk/resources/instruments/flute/), [oboe](https://philharmonia.co.uk/resources/instruments/oboe/), [clarinet](https://philharmonia.co.uk/resources/instruments/clarinet/), and [bassoon](https://philharmonia.co.uk/resources/instruments/bassoon/).

This is an independent instrumental arrangement. Accompanying a singer would require checking the newly composed lines against the complete vocal melody.

## 5. Plan the lead instrument before choosing accompaniment

`leader(bar)` is the formal orchestration plan:

| Measures | Foreground |
|---|---|
| Pickup and 1-8 | Flute |
| 9-28 | Oboe, with selected introduction cues in Flute |
| 29-36 | Flute, returning to the opening theme |
| 37-52 | Clarinet |
| 53-62 | Oboe, with the written guitar cue in Clarinet at 53-60 |
| 63-66 | Flute transition and first bridge riff |
| 67-104 | Two-bar lead exchanges among Oboe, Clarinet, and Flute |
| 105-112 | Clarinet vamp |
| 113-114 | Oboe second-ending cue |
| 115-116 | Flute closing phrase |
| 117-118 | Oboe closing phrase |
| 119-120 | Clarinet closing phrase |
| 121-123 | Flute closing phrase and final chord |

The bridge begins Flute at 65-66, Oboe at 67-68, Clarinet at 69-70, then Flute at 71-72. The cycle continues. The bassoon pulse links these changes so the music feels like one developing passage rather than disconnected solos.

A handoff also creates a breathing opportunity. The former soloist returns to a less demanding support pattern; the new soloist has had lighter material. Dynamics follow the role: an mp lead usually sits over p accompaniment; an mf lead over mp accompaniment; a quiet p lead over pp support. These markings propose a balance. Acoustic balance still depends on register, players, and room.

## 6. Translate string textures into wind textures

String pizzicato does not become a wind articulation by renaming the instrument. The quartet uses short tongued notes and written rests to make the verse pulse. The Bassoon usually plays an eighth note followed by an eighth rest on the quarter-note grid, with additional entries at printed chord-change times. Clarinet supplies offbeat responses when it is not carrying the lead.

Upper accompaniment pads occupy only part of the measure. Typical Flute support begins on beat 2 and ends after beat 3. Oboe and Clarinet use complementary windows, often leaving the last beat or a first eighth free. Bassoon support is more sustained in quieter passages and changes into an articulated foundation in verses and the bridge.

The opening and choruses therefore keep harmonic color without asking a wind player to sustain the long common-tone spans used in the string score. The accompaniment is regenerated for the quartet, rather than copied from five string parts into four wind staves.

## 7. Respect slash basses and chord anticipations

Measure 9 begins B/D#, changes to E6/9 on beat 2, and anticipates F#(add4) on the final eighth. G#m7 follows after the first eighth of measure 10. The Bassoon follows the specified bass class: D#, E, F#, then G# in an appropriate octave.

F#(add4) retains the third A#, while F#sus4 replaces that third with B. The harmonic parser retains that distinction even when a sparse instantaneous voicing omits a degree. It also keeps the source's added ninth and sixth information.

The source harmony is represented as root, chord kind, bass, degrees, and onset/duration. The official MusicXML reference describes that structure. [W3C harmony reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/harmony/)

## 8. Select the remaining voices

`voiced()` receives the current harmony, active lead/cue notes, and previous accompaniment pitches. It fixes the Bassoon to a nearby octave of the specified bass. It enumerates chord-tone pitches for the upper instruments not currently assigned a lead or source cue.

Candidates use individual register windows. Generated upper accompaniment voices follow a Clarinet-Oboe-Flute ascending order when those parts are available. The search rejects immediate semitone spacing between those accompaniment voices and penalizes semitone friction or unnecessary unison against active foreground notes. It also favors smaller movement and good harmonic coverage.

A simplified movement term is:

```python
movement = abs(new_pitch - previous_pitch)
cost += movement + max(0, movement - 7)**2
```

The cost also adds a preferred-register term and a penalty for missing chord pitch classes, considering the Bassoon and active melodic/cue notes. A fixed cue is not replaced just because a generated chord tone would be easier to optimize.

This is a local exhaustive search, not global dynamic programming. It does not certify all voice-leading relationships or acoustic balance. Some voice crossing between a lead and accompaniment is intentional in mixed wind colors. Species-counterpoint rules are not treated as mandatory for this pop-derived chamber texture.

## 9. Use concert pitch internally and transpose only when writing

All events use sounding MIDI pitch. For B-flat Clarinet, the writer adds two semitones to produce written pitch and adds:

```xml
<transpose>
  <diatonic>-1</diatonic>
  <chromatic>-2</chromatic>
</transpose>
```

The notation reader subtracts the written-to-sounding interval on re-import, so the decoded part must agree with the concert-pitch event model. The MusicXML transpose element encodes what to add to written pitch to obtain sounding pitch. [W3C transpose reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/)

B concert major becomes C# written major for this clarinet edition. Seven sharps require E# and B#. Enharmonic pitch alone is insufficient for correct notation: writing F instead of E# would obscure a diatonic relationship. `CLAR_SPELL` supplies the written spellings; the octave calculation accounts for B# crossing a MIDI octave boundary:

```python
written = sounding + 2
step, alter = CLAR_SPELL[written % 12]
octave = (written - alter - STEP[step]) // 12 - 1
```

For example, written B#4 has MIDI pitch 72 and sounds A#4 at MIDI 70. A naive `written // 12 - 1` would assign B#5 and make it an octave too high. The explicit spelling and round-trip checks prevent that error.

Chord roots and slash basses in the Clarinet part transpose too. Concert B/D# becomes written C#/E#. The full score keeps concert chord symbols above Flute and uses written clarinet notes, clearly labeled in the subtitle. It is a transposed score.

## 10. Audit breathing across the performed form

A valid measure length is not a breathing plan. `playback_route()` unfolds both repeated passages, including the alternate endings. `breath_audit()` builds a sounding/quiet timeline for each part and measures uninterrupted runs between written rests of at least an eighth note. Changing pitch or tonguing a new note does not count as breathing.

The first audit found a continuous Flute span through the quiet transition and first bridge riff. Measure 64 now ends with a quarter rest. A second long span joined the second-ending cue to the closing Flute phrase; the cue at 113-114 now belongs to Oboe. These are musical revisions prompted by the audit, not merely a higher allowable threshold.

At constant quarter=139, the resulting longest nominal runs are:

| Part | Quarters between counted rest opportunities | Nominal seconds |
|---|---|---|
| Flute | 12 | 5.18 |
| Oboe | 8 | 3.45 |
| Clarinet | 8 | 3.45 |
| Bassoon | 7.5 | 3.24 |

These are heuristic checks. An eighth rest is only about 0.22 seconds, and may not give the player the desired breath at every pressure, dynamic, or register. The ritardando and final fermata can extend actual time beyond these estimates. The final Flute span includes the last chord; coordinate the fermata release and any necessary re-breath with the ensemble. No breath-capacity claim is inferred from a passing test.

## 11. Separate ties, slurs, and tonguing

Ties preserve sound across identical pitches; source ties remain exact in the opening. Ties in transferred cues are reconciled after octave placement and instrument handoffs, so a player does not receive a dangling tie to a note now assigned elsewhere.

Short optional slurs group contiguous moving lead/cue notes within one beat. Repeated notes, tied notes, large leaps, and separated notes are not automatically slurred by this rule. Bassoon pulses and inner offbeats use staccato markings plus explicit rests. These suggestions establish a starting character, not a complete professional articulation solution.

Use the review sheet to evaluate whether a slur makes a particular register transition smoother, whether a reed articulation is too heavy, and whether the Bassoon pulse gives energy without dominating. No string bow-direction symbols belong in these wind parts.

## 12. Encode the musical timeline reliably

A quarter is eight integer units; an eighth is four; a full 4/4 bar is 32; the pickup is eight. Each authored event stores part, bar, onset, duration, sounding pitch, layer, role, source IDs, ties, slur, and articulation. The same event list generates the full score and all four parts.

Chord symbols are inserted at their actual MusicXML cursor positions. When a chord change lies inside a sustained note or rest, the writer splits that duration; a sustained pitch receives ties between its pieces. This avoids relying on an importer's handling of harmony offsets. The validator compares sounding pitch at every time unit, allowing useful engraving splits without allowing an unintended pitch or duration change.

`notation.py` supplies conventional duration values, metrical splitting, rests, and beams. XML writing is a separate layer from the decisions about melody, voicing, activity, and breathing.

## 13. Validate, engrave, and review separately

Eighteen tests cover source file hashes, pickup/form duration, the opening signature and editorial harmony provenance, exclusion of slash notes from melodic source IDs, slash basses and anticipations, repeat-aware breathing, rejection of an unbroken wind phrase, bridge lead distribution, clarinet spelling/transposition, source chord transposition in the Clarinet part, score/part agreement, and rejection of altered notes, durations, ties, harmonies, or repeat barlines.

The generator additionally checks every measure's length and displayed note type, tie/slur pairing, instrument ranges, generated accompaniment chord membership, and actual sounding-pitch round trips. Every exported MusicXML is reopened. MuseScore exports the five PDFs; all 32 pages are checked for nonempty content and reviewed visually, with closer inspection of clarinet notation and a bridge handoff. The final archive is tested for integrity.

These checks establish structural consistency and usable engraving. No audio audition or live-player rehearsal was completed. They do not prove ideal reed response, breath placement, flute projection, or room balance. `PLAYER-REVIEW.md` supplies a concrete first-reading checklist.

## 14. Reproduce and learn from controlled changes

Keep the two source files, `arrange.py`, and `notation.py` in the package directory. Python 3 standard library is enough to generate the MusicXML and run the tests:

```sh
python3 arrange.py
python3 -m unittest test_arrangement.py
```

Running Python updates MusicXML and data reports, not PDFs. Reopen the new notation in Dorico or MuseScore and export the PDFs again after an edit. `engrave-jobs.json` is regenerated with the correct paths for the current package folder.

To study orchestration, change one two-bar lead assignment and compare the required support voicings and breath audit. To study harmony, change one editorial opening chord while retaining the exact melody checks. To study notation, inspect the concert D# versus written E# in the Clarinet part, or compare a whole authored event with its tied engraving pieces.

This is a piece-specific generator. It assumes this source's divisions, meter, measure count, chord vocabulary, and section map. Generalizing it requires configurable source interpretation, instrument roles, formal plans, changing meters/divisions, and more detailed phrase annotations. The output notes are generated deterministically from editorial musical decisions; no external music-generation service supplies them.
