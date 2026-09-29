# The Everlasting Love of God: piano with orchestra

## Musical intention

This edition keeps the supplied piano's musical content intact and adds accompaniment for the same nineteen orchestral parts. The piano remains the principal voice. Strings form a continuous harmonic background; woodwinds supply brief paired responses; brass marks selected arrivals; timpani adds sparse rhythmic punctuation.

The Brahms reference informs the desired character: warm middle-register strings, linked inner voices, restrained syncopation, and small figures that recur in related forms. This is a new accompaniment to the existing song, not a quotation from Brahms or a reconstruction of his compositional method. The fixed contemporary harmony and piano writing remain the foundation.

The source credits Matt Boswell, Matt Papa and Matt Redman, with Jeff Moore as arranger and Daniel Galbraith credited for orchestration. Those source credits and rights metadata are retained. This added orchestral accompaniment is distinct from the publisher's orchestration.

## Your balance requirement, made measurable

The code measures both total sounding duration across a family and average activity per part. The latter prevents eight brass parts from being compared unfairly with five woodwind parts. One part playing a quarter note contributes one part-beat. The work spans 299 quarter-note beats in its written measure sequence.

| Family | New note events | Part-beats | Average activity per part |
|---|---:|---:|---:|
| Strings: five parts | 843 | 1,345 | 89.97% |
| Woodwinds: five parts | 178 | 152 | 10.17% |
| Brass: eight parts, including horns | 32 | 32 | 1.34% |
| Timpani | 5 | 2.5 | 0.84% |

The strict strings > woodwinds > brass order passes for both duration measures in every labeled section, as well as for the whole work. “Always more” is implemented section by section, not as a requirement that every instrument be sounding at every instant. Rests and contrasting entrances remain possible.

These are notation measurements, not acoustic measurements. A short brass chord can overpower several quiet string parts. The score therefore also limits brass dynamics, avoids continuous bass doubling, and explicitly asks the ensemble to remain beneath the piano. The metrics do not account for the number of players assigned to each string part, room acoustics, piano lid position or amplification. No fixed orchestration can guarantee those conditions without rehearsal.

## 1. Preserve the piano

The original MusicXML is included unchanged as `original-piano.musicxml`. The combined score contains a deep copy of its piano part: all 1,345 pitched segments, voices, rhythmic values, pedal, harmony labels, tempo and performance instructions remain.

Only engraving is normalized: original page breaks, widths, coordinates and fonts are removed as needed to fit the expanded score. Composite dynamic ranges are converted to one readable text object. This does not mean that the combined file is byte-identical to the source; the supplied original copy is the byte-preserved reference.

Validation compares the complete normalized piano XML tree. Separate tests deliberately change a piano pitch and a tempo marking and require rejection. That is stronger than merely checking note counts.

The form remains 79 measures, in F major, with 4/4, 2/4 and 3/4 changes. Quarter note = 72 is retained. Source navigation symbols and barlines are copied. The orchestra follows the piano's final ritardando and fermata.

## 2. Parse harmony at its real onset

`harmony()` reads the piano's 158 chord symbols with a running MusicXML time cursor. A normal note advances the cursor; a chord member does not. Backup and forward elements move between voices. A harmony offset is applied to the current cursor. If a measure begins without a new symbol, the preceding harmony carries forward.

Each harmonic span records measure, onset, duration, root, bass and pitch classes. The parser supports all chord kinds in this file: major, minor, minor seventh, major seventh, major ninth, suspended fourth and power chords. Added, altered and subtracted degrees are handled explicitly. Slash-bass notes are retained.

A major ninth is not treated as an added second triad: it includes the major seventh. A power chord receives no invented third. A suspended-fourth chord does not silently acquire a major third. These distinctions matter because a long orchestral chord makes harmonic errors more audible than a brief piano attack.

Every generated note begins and ends inside one harmonic span. A common tone may be tied into the next span only when it remains valid there.

## 3. Search for connected string voicings

The four core voices, from low to high, are cello, viola, Violin 2 and Violin 1. The candidate ranges are Cello G2-G3, Viola F3-F4, Violin 2 C4-C5 and Violin 1 F4-F5. They are working bands for this accompaniment rather than statements of the instruments' complete ranges.

The generator enumerates chord-tone combinations, rejects crossings and upper gaps larger than an octave, and chooses the lowest-cost candidate. The scoring formula is:

```python
cost = motion + 2 * leap_penalty + 5 * missing_tones \
       + 3 * close_piano_friction + 0.25 * distance_from_register_centers
```

Motion is the total semitone distance from the previous voicing. Large leaps receive an additional squared penalty. Missing chord tones are discouraged, but the piano already supplies the full harmony, so four strings need not reproduce every extension. Register centers discourage drift toward extremes.

The friction term samples the source's highest sounding right-hand pitch every eighth-note unit and penalizes a semitone between it and Violin 1. This is a limited, useful guard against persistent close clashes, not a complete dissonance analysis. It does not evaluate every piano voice or every transient note. Listening review remains necessary.

This is a local exhaustive search over each chord, not a global optimization across the complete composition. It creates connected voicings, but it does not prove that the chosen sequence is uniquely best.

## 4. Give the strings continuity and inner motion

Violin 1, Violin 2 and cello usually sustain the selected harmonic strands through a chord span. Viola sustains in quieter sections and introduces light offbeat eighth-note pulses in longer spans of fuller sections. Double bass supplies restrained bass support rather than copying every piano left-hand figure.

At selected fuller-section measures, Violin 1 ends a span with a nearby chord tone and a return. The two eighth notes receive a short slur. This is a recurring two-note figure adapted to successive harmonies. It is a chord-tone figure, not necessarily a diatonic neighbor-note dissonance.

Adjacent common pitches are tied through eligible boundaries. Cross-bar sustain groups are limited by the alternating-bar rule. A tie means continuation of the same pitch; the section can stagger bow changes where necessary. It does not require every player to perform an entire tied passage in one bow. Bow directions and detailed fingerings remain for the section leaders.

The string texture supplies the Romantic warmth requested without replacing the piano melody. There are no generated double stops or divisi requirements.

## 5. Use woodwinds as responses

The rotating pairs are clarinet/bassoon, oboe/clarinet, flute 1/oboe, and flute 2/bassoon. They enter in selected measures and normally use one-beat notes, sometimes shorter when harmony changes rapidly. Entries occur later in the harmonic span and end with at least an eighth-note gap before that span ends.

The final woodwind response lasts one and a half beats. A test checks continuous playing across adjacent spans so multiple short events cannot accidentally form a long passage without a breath.

Pair rotation changes color while avoiding an all-woodwind block on every chord. The notes reinforce selected string chord tones in instrument-appropriate registers. They are newly composed accompaniment, not extracted piano melody notes.

## 6. Reserve brass and percussion

Brass enters only at selected arrivals: measures 22, 29, 40, 45, 57, 65, 73 and 79. Some arrivals use just horns, some a small mixed group, and the final arrival uses the full brass family. These are short, quiet pillars, generally one beat, marked pp and always subordinate to the piano.

The final brass chord releases before the piano and strings complete their sustained ending. This prevents a long brass chord from dominating the final sonority. The full family does not play through an entire chorus.

Timpani is tuned to F2 and C3, using five soft, short attacks where the selected bass or root supports one of those pitches. It has no rolls or retuning changes. The role is punctuation and a brief change of texture. The restrained percussion writing is intentional; a denser rhythmic layer would compete with this piano source.

## 7. Notation, transposition and layout

The calculation uses concert pitch. The notation layer writes clarinet and trumpets a major second higher, horns a perfect fifth higher, and double bass an octave higher. The corresponding written keys are G major for B-flat instruments, C major for horns, and F major for the others. Viola uses alto clef; the low instruments use bass clef.

The score contains the nineteen orchestral staves above the unchanged two-staff piano part. The conductor score uses a large page format. All orchestra parts have independent MusicXML and PDF files. The full score is transposed, matching the performance parts.

`notation.py` provides pitch spelling, durations, ties, slurs and export helpers inherited from the preceding work. `piano_layout.py` isolates engraving normalization for the preserved piano. Run `arrange.py` to build this edition; `notation.py` is a helper library and is not this arrangement's entry point.

The temporary spelling records produced by `fake_sources()` are newly composed-note containers used by the notation writer. Their IDs are not provenance links to piano notes. The harmonic plan, musical roles and piano-preservation comparison are the appropriate audit records for this accompaniment.

## 8. Verify the result

Twelve tests check piano preservation, rejection of changed piano pitch and tempo, rejection of corrupt orchestral duration, the family hierarchy in every section, transposition metadata, extracted-part consistency, meter changes, wind breathing, ties/slurs, timpani tuning and source note count. Export validation also checks sounding pitches, measure durations, registers, source barlines and harmonic membership.

PDF review is a separate step from those tests. The score remains an editorial performance draft until the musicians have checked balance, string bow distribution, breathing and page turns. No audio audition or live rehearsal is claimed.

A useful rehearsal order is: piano alone; piano with strings; add one woodwind pair; then add the brief brass pillars; finally add timpani. Ask whether the piano's moving line remains intelligible at each stage. Adjust orchestral dynamics before changing the pianist's expression.

## Reproduce and learn

```sh
cd /path/to/everlasting-love-piano-orchestra
python3 arrange.py
python3 -m unittest discover -s . -p 'test_*.py' -v
mscore -j engrave-jobs.json
```

Python 3's standard library generates the MusicXML and reports. MuseScore supplies PDF engraving. Run the generator after moving the folder so export paths are refreshed. Keep manual edits under different filenames because regeneration overwrites the generated score and parts.

Files to study: `harmony-plan.json` for harmonic spans and selected voicings, `arrangement-events.json` for every new note and musical role, `family-balance.json` for whole-piece and section activity, and `validation.json` for preservation results and the source hash.

For an experiment, increase a brass arrival from one beat to four and rerun the hierarchy test. Then compare the musical effect in rehearsal: a numerical hierarchy can pass even while a single sustained brass chord overwhelms the piano. This illustrates why both measurable constraints and listening judgment matter.

## Reference for the Brahms study

The [full-score resources for Brahms's Piano Concerto No. 2, Op. 83](https://imslp.org/wiki/Piano_Concerto_No.2%2C_Op.83_%28Brahms%2C_Johannes%29) provide a primary-score study companion. Compare the solo piano and orchestral staves: mark where instrumental families enter, how long they remain active, which registers they occupy, and how much accompaniment motion surrounds the soloist. This is a study exercise, not a claim that the present algorithm reconstructs Brahms's choices.

The [W3C MusicXML transpose reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/) explains the written-to-sounding representation used in these files. The [Philharmonia instrument resources](https://philharmonia.co.uk/resources/instruments/) offer player-led demonstrations for listening and orchestration study.
