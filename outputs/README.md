# outputs/ — reference material, not engine output

Nothing here is produced by this engine. These are external arrangements of the
same source material, kept as benchmarks to measure our own output against.

Each folder also ships a `.zip` and a nested copy of its own contents. Those are
byte-identical duplicates and are gitignored; only the canonical files are
tracked.

## What is here

| | |
|---|---|
| `test4-intermediate/`, `test4-professional/` | Two arrangements of the `test4` MIDI at different difficulty levels |
| `test4-strings/` | A five-part string ensemble of the same source — score and extracted parts, with its generator and a READ-ME |
| `test4-melody-walking-piano/` | Melody + walking-bass piano, with a voicing analysis |
| `string-bowing-lab/` | A bowing analyser (Python, stdlib only), a learning guide, a ties/slurs/bow-directions notation example, and an audit of the string score above |

## Why keep them

They are the measuring stick several fixes were argued from, and the numbers are
worth being able to re-derive:

- The string ensemble's inner parts repeat a pitch on **1–15%** of transitions.
  Ours repeated on **79–85%** — the gap that became `afcebe2`, the sustain pass.
- Its Violin I sits an octave above the source melody, where ours was parked at
  the source octave. That framed the register work in `1c2456b`.
- The bowing lab's audit found **14 whole-bar slurs in Violin I, 12 containing
  repeated attacks**, and its author's own conclusion — that a run of
  correct-looking bow symbols proves nothing about bow distribution — is why
  `04a84cd` prints so few bow directions.
- `bowing_lab.py` runs standalone: `python3 bowing_lab.py --self-test`.

## A caution

These files are one arranger's choices, not ground truth. Where our output
differs it is worth asking which is better, not assuming the reference wins —
the engine's own calibration notes (Beethoven Op.18 No.3, 120 Bach chorales,
Handel's Messiah) are the wider sample and live in `src/arrange/strings/`.
