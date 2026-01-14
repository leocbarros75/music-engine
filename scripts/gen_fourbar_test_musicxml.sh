#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/in.musicxml"

cat > "$OUT" <<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC
  "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>

  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>

      <!-- RH: C major triad arpeggio (C-E-G-C) -->
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>

      <!-- LH: C whole note -->
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1920</duration><voice>2</voice><staff>2</staff></note>
    </measure>

    <measure number="2">
      <!-- RH: Dm (D-F-A-D) -->
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>6</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>

      <!-- LH: D whole note -->
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>1920</duration><voice>2</voice><staff>2</staff></note>
    </measure>

    <measure number="3">
      <!-- RH: G7-ish (G-B-D-F) -->
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>B</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>6</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>6</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>

      <!-- LH: G whole note -->
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>1920</duration><voice>2</voice><staff>2</staff></note>
    </measure>

    <measure number="4">
      <!-- RH: C (C-E-G-C) -->
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>480</duration><voice>1</voice><staff>1</staff></note>

      <!-- LH: C whole note -->
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1920</duration><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
XML

echo "Wrote: $OUT"
echo "Bytes: $(wc -c < "$OUT" | tr -d ' ')"