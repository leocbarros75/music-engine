LIVING HOPE - PIANO WITH WIND QUARTET
Music: Brian Johnson and Phil Wickham
Original piano arrangement: Dan Galbraith (PraiseCharts #71163 / CCLI #7106807)

INSTRUMENTS
Original piano, flute, oboe, Bb clarinet and bassoon.
This edition requires piano. It adds newly composed complementary wind lines.
It is separate from the earlier stand-alone wind transcription.

FILES
living-hope-piano-and-winds.pdf: combined score, including both piano staves.
living-hope-piano-and-winds.musicxml: editable combined score.
FL / OB / CL / BN: separate flute, oboe, clarinet and bassoon PDF/MusicXML parts.
original-piano.musicxml: unchanged source copy.
PROCESS.md: detailed musical and coding explanation, references and instructions.
arrange.py / test_arrangement.py: reproducible generator and nine tests.
arrangement-events.json / harmonic-plan.json / validation.json: inspectable data.

MUSICAL DETAILS
62 notated measures, original repeats and alternate endings retained.
Concert Eb major, 4/4, quarter note = 71.
The Bb clarinet is written in F major, sounding a major second below written.
All 1,005 source piano pitched note segments retained; 384 wind notes added.
The piano's musical content remains; page layout and overlapping text displays
are normalized as explained in PROCESS.md.

Nine automated checks passed and PDF layouts were reviewed.
No live player read-through or audio-based balance assessment is claimed.

REPRODUCTION
Run python3 arrange.py and python3 -m unittest -v in this folder.
MuseScore PDF export is a separate step documented in PROCESS.md.
