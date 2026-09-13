# Melody with block chords and walking bass

## Musical source and editorial choices
The source is test4-TRANSCRIBED.musicxml. This arrangement reuses the clarified
melodic reading from the preceding piano versions, returned to its original
register (C-sharp4 through A4). It preserves the 15-bar form. It is not a literal
reproduction of the source: short release gaps were smoothed, inner voices were
rearranged, and sustained bass notes were replaced with walking motion.

The score has a separate concert-pitch melody part and a two-staff piano part.
Melody playback uses a flute sound as a neutral placeholder, not a prescribed
instrument. Eighth notes are straight. Suggested tempo is quarter = 76.

## Harmonic plan
The harmonic outline uses D, G, A, B minor and F-sharp minor triads. Pedal-derived
sonorities remain at selected points: G over D in bar 2, A over D in bar 3,
and A over G at the start of bar 10. Melody and bass can supply sevenths,
suspensions or other extensions beyond the right-hand triad.

RH triads are rearticulated on beats 1 and 3; the ending is a whole-note chord.
The LH moves in quarters through bar 14 and settles on D in bar 15.

## Voicing algorithm
1. Enumerate ascending three-note combinations from MIDI pitches 57 to 74.
2. Keep combinations containing exactly the triad pitch classes.
3. Reject spans greater than an octave.
4. Use dynamic programming to minimize total movement across the whole sequence.

Transition cost = sum(abs(new_voice - old_voice)) for the three ordered voices,
plus 0.08 * abs(mean(new_chord) - 64), a small register preference.

This is a deterministic optimization of explicitly supplied harmonies. It does
not infer the harmonies from arbitrary MIDI. Likewise the melody and bass lines
are explicitly authored data, not outputs of the voicing optimizer.

Opening example:
D: A3 D4 F-sharp4 (RH second inversion)
G: B3 D4 G4 (RH first inversion)
Movement: +2, 0, +1 semitones; D4 remains a common tone.

RH position describes the triad within the right hand only. A3 D4 F-sharp4 over
LH D3 is an overall root-position D harmony, despite the RH second-inversion
shape. The true harmonic bass determines the inversion of the full sonority.

## Walking bass
The bass combines chord tones, occasional register changes and diatonic or
chromatic approach notes. Examples: bar 4 A-sharp2 resolves to bar 5 B2;
bar 6 G-sharp2 resolves to bar 7 A2; bar 10 E-sharp3 resolves to bar 11 F-sharp3.
E-sharp is spelled according to its upward resolution, rather than as F natural.
Some bass notes intentionally form passing dissonances against held RH chords.
The line is hand-authored; it does not claim every step is conjunct or every
beat is a chord root. The source's pedal points are partially retained and
partially adapted to the requested walking texture.

## MusicXML encoding
Two divisions per quarter: eighth=1, quarter=2, half=4, whole=8.
Simultaneous chord members use chord elements. Piano RH uses staff/voice 1;
LH uses staff/voice 2. An eight-unit backup returns to the start of the bar
before encoding the LH. The separate melody is its own MusicXML part.

## Validation and practical limits
Checked: four beats per staff per bar, note type/duration agreement, octave
maximum RH chord span, bass register, and successful reopening of exports.
Maximum movement of any ordered RH voice between chords is three semitones.
These checks do not evaluate fingering, harmonic taste, engraved layout or
performance balance. Audio comparison, visual engraving proof and a pianist's
read-through have not been performed.

## Reproduce and experiment
Run: python3 build_arrangement.py
Only Python's standard library is required. Edit HARMONY to change triads,
BASS to change walking notes, or the candidate range / cost to change voicings.
The generated voicing-analysis.json lists every chosen chord and RH position.
