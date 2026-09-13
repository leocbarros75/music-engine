# String bowing: an educational workflow

This laboratory contains a working Python analyzer, an audit of our earlier
string arrangement, and a two-bar MusicXML notation example. It does not change
the existing arrangement or claim to deliver performer-approved bowings.

## 1. Three layers of information

A tie connects written notes into one sustained musical event. A repeated pitch
without a tie remains a new attack. A bowing slur groups attacks into a stroke;
up/down-bow symbols select its direction. Keep these as separate data structures.
A sustained tied event can still need unobtrusive physical bow changes.

Sources: [Dorico ties versus slurs](https://archive.steinberg.help/dorico_se/v5/en/Dorico_SE_5_Operation_Manual_en.pdf),
[MusicXML tie](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/tie/),
[MusicXML tied](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/tied/).

## 2. Begin with the intended sound

Identify phrase arrival, articulation, accent, dynamic trajectory, release and
ensemble role before selecting directions. A lyrical melody, detached bass line
and sustained inner harmony require different solutions even at identical tempo.
A phrase can continue through multiple bow changes; avoid automatically turning
an entire musical phrase into one literal bowing slur.

## 3. Time and physical resources

At a constant quarter-note tempo: seconds = quarter_beats * 60 / tempo.
At quarter = 76, four beats last approximately 3.16 seconds.
This duration is not intrinsically excessive. Dynamics, contact point, chosen
string, starting bow position and the player's control affect feasibility.
A fermata makes the metrical duration an incomplete description.

For an idealized stroke, consumed length = integral of bow speed over time.
This is a bookkeeping relationship, not a sound-quality predictor. Bow speed,
normal force and contact point interact; loudness is not simply pressure.
See [UNSW: Bows and strings](https://newt.phys.unsw.edu.au/jw/Bows.html).

Do not invent universal limits such as 'a cello gets two beats per bow'.
The lab's two-beat grouping preference and 2.5-second review trigger are explicit,
changeable classroom settings. They are NOT experimentally measured capacities.

## 4. Instrument and fingering context

A mature system should record instrument, sounding pitch, potential string,
position/fingering, dynamic, articulation, available bow and musical role.
Pitch alone does not identify string crossings: one pitch can have multiple
string/fingering choices. Solve bowing and fingering jointly, or leave crossings
uncertain until a player supplies fingerings. First and second violin use the
same instrument; their different functions do not imply different mechanics.

Review viola register/timbre and cello string choices independently. For bass,
convert written to sounding pitch before physical range reasoning and record
French/German bow technique when relevant. Avoid scaling violin numbers blindly.
Sources: [Violin](https://philharmonia.co.uk/resources/instruments/violin/),
[Cello](https://philharmonia.co.uk/resources/instruments/cello/),
[Double bass](https://philharmonia.co.uk/resources/instruments/double-bass/).

## 5. What the executable actually does

- Parses a deliberately restricted monophonic MusicXML representation.
- Rejects unsupported chords and polyphonic timeline controls explicitly.
- Converts integer MusicXML durations into exact Fraction beat values.
- Checks sound/notation tie agreement and merges contiguous same-pitch tie chains.
- Audits existing slurs for duration and repeated attacks needing interpretation.
- Proposes groups of at most two beats when possible, inside each measure.
- Starts a new group for repeated attacks; it does not assume portato intent.
- Alternates candidate directions by GROUP, starting down.
- Reports long single events instead of inventing attacks to break them up.

This is a greedy demonstrator, not global optimization. It does not model dynamic
changes, retakes, fermatas, actual bow position, string assignment or ensemble
coordination. An original longer slur may be entirely playable. A warning is an
invitation to inspect, not a verdict that the notation is wrong.

## 6. Opening of our Violin I part

Original rhythm: F-sharp dotted quarter, F-sharp eighth, F-sharp quarter,
G eighth, A eighth. Candidate: down on the dotted quarter, up on the eighth,
then down across F-sharp–G–A under one slur.

The first down-bow need not consume a whole bow. The short up-bow need not return
to the frog. These unequal durations demonstrate why direction labels alone do
not establish usable bow distribution. A player must plan stroke lengths.
Repeated notes within a slur are not inherently errors; portato or other same-
direction rearticulation may be intended, but should be communicated clearly.

## 7. What I would improve in the earlier arrangement

The earlier generator placed one full-measure slur on each multi-note measure in
the upper three parts. That was a layout-level heuristic, not a bowing analysis.
The audit finds 14 such slurs in Violin I, 12 containing repeated attacks.
Revisit those markings instead of presenting them as authoritative bowings.
Do not add up/down symbols to every note of a final part merely because software
can do so. Print essential directions and let section leaders finalize details.

## 8. A more advanced planner

Candidate state: event index, direction, bow location bin, string/position option.
Candidate action: one or several notes in a stroke, a supported retake, or an
unobtrusive bow change in a sustained event. Respect musical attack intent.

A weighted cost can include accent mismatch, difficult string crossings,
insufficient available bow, awkward retakes and conflicting ensemble attacks.
Hard constraints encode impossibility under stated assumptions; soft penalties
encode preferences. Search with dynamic programming or a beam search. Avoid
optimizing invented physical constants and then calling the result 'best'.

Gather player feedback as structured examples: context, proposed version,
preferred alternative, reason, and confidence. Tune on some pieces; test on
unseen pieces and players. Preserve multiple acceptable solutions. Recording
ratings should include sound and comfort, not just agreement with one editor.

## 9. Run and modify

```
python3 bowing_lab.py --self-test
python3 bowing_lab.py --input source.musicxml --output report.json --tempo 76
python3 bowing_lab.py --demo ties-slurs-bows-demo.musicxml
```

Use the included input-string-score.musicxml as the source for the worked example.
Try --tempo 50 versus --tempo 120, or --group-beats 1 versus 2. Beat grouping
currently ignores tempo, but the duration warnings change; that limitation is
intentional and visible. Review thresholds with a player before using them.

The two-bar notation example contains D5 half tied to D5 half (one sustained
event), then E5–F-sharp5 slurred up-bow and G5–A5 slurred down-bow. Its MusicXML
uses separate tie/tied, slur and technical bow-direction elements.
See [MusicXML slur](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/slur/)
and [up-bow](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/up-bow/).

Tests passed: tie merging, malformed tie rejection, grouping, repeated-attack
separation, tempo scaling and direction alternation. The demonstration file has
not been visually proofread or evaluated by a string player.
