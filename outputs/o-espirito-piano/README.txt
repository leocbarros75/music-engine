O ESPIRITO DE DEUS - MELODY AND PIANO

Start with o-espirito-melody-piano.pdf for the printed score.
Open o-espirito-melody-piano.musicxml in Dorico or MuseScore to edit it.
Read PROCESS.md for the musical and technical walkthrough.
Use PERFORMANCE-REVIEW.md to collect pianist/singer feedback.

Rebuild in this folder with Python 3:
  python3 arrange.py
  python3 -m unittest -v

No external Python packages are required. The script rebuilds MusicXML and JSON;
export a fresh PDF from your notation program after changing the arrangement.
source.musicxml is an unchanged copy of the file supplied for this task.
analysis.json describes the harmonic plan, searched voicings and validations.

The melody is preserved. Piano texture, ornaments, tempo and dynamics are
editorial. The printed two-page PDF was visually reviewed. No audio performance
was assessed, and a pianist/singer read-through remains useful.
