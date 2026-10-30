#!/usr/bin/env python3
"""
Derive player-level bands from published graded editions.

Takes a directory of engraved part PDFs whose filenames are
"<piece> - <part>.pdf" and writes measured-bands.json: per instrument, the
range each published part actually uses, and -- where a publisher ships the
same arrangement twice, once as written and once simplified -- the ceiling
those two editions settle on.

Run:  python3 tools/calibration/measure_bands.py <pack-dir> [-o out.json]

The pack itself is not in this repository: it is purchased sheet music. The
JSON it produces is, so the numbers in src/arrange/difficulty/levels.ts can be
traced to a measurement instead of standing as bare constants.
"""
import sys, os, glob, json, argparse, collections, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from read_part import extract, nm

# written -> sounding, per part name as the publisher spells it
TRANSPOSE = {
    'Violin 1, 2': 0, 'Violin 1, 2 (Simplified)': 0, 'Viola': 0, 'Cello': 0,
    'String Bass': -12,                            # contrabass sounds 8vb
    'Clarinet 3 (doubles Viola)': -2,              # Bb
    'Bassoon (doubles Cello)': 0,
    'Bass Clarinet (doubles String Bass)': -14,    # Bb, major 9th
}
# a part that carries two sections on one staff: upper line / lower line
DIVISI = {'Violin 1, 2': ('violin_1', 'violin_2'),
          'Violin 1, 2 (Simplified)': ('violin_1', 'violin_2')}
SIMPLIFIED = {'Violin 1, 2 (Simplified)'}
INSTRUMENT = {'Viola': 'viola', 'Cello': 'cello', 'String Bass': 'double_bass',
              'Clarinet 3 (doubles Viola)': 'clarinet_bb',
              'Bassoon (doubles Cello)': 'bassoon',
              'Bass Clarinet (doubles String Bass)': 'bass_clarinet_bb'}


def voices(notes):
    """Split a divisi staff into its upper and lower section line."""
    chords = collections.defaultdict(list)
    for n in notes:
        chords[(n['page'], n['staff'], round(n['x'] / 1.5))].append(n['midi'])
    return ([max(v) for v in chords.values()], [min(v) for v in chords.values()])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pack')
    ap.add_argument('-o', '--out', default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), 'measured-bands.json'))
    args = ap.parse_args()

    obs = collections.defaultdict(lambda: collections.defaultdict(list))
    pieces, warnings, tacet = set(), [], []
    for f in sorted(glob.glob(os.path.join(args.pack, '*', '*.pdf'))):
        base = os.path.basename(f)[:-4]
        if ' - ' not in base:
            continue
        piece, part = base.split(' - ', 1)
        if part not in TRANSPOSE:
            continue
        notes, warn = extract(f)
        warnings += [f"{base}: {w}" for w in warn]
        if not notes:
            tacet.append(base)       # publisher's own answer: this part sits out
            continue
        pieces.add(piece)
        t = TRANSPOSE[part]
        tier = 'simplified' if part in SIMPLIFIED else 'published'
        shifted = [dict(n, midi=n['midi'] + t) for n in notes]
        if part in DIVISI:
            up, lo = voices(shifted)
            lines = list(zip(DIVISI[part], (up, lo)))
        else:
            lines = [(INSTRUMENT[part], [n['midi'] for n in shifted])]
        for inst, ms in lines:
            obs[inst][tier].append({'piece': piece, 'n': len(ms),
                                    'lo': min(ms), 'hi': max(ms)})

    out = {
        'source': os.path.basename(os.path.normpath(args.pack)),
        'pieces': len(pieces),
        'tacet': sorted(tacet),
        'unassigned_notehead_warnings': warnings,
        'instruments': {},
    }
    for inst in sorted(obs):
        entry = {}
        for tier, rows in sorted(obs[inst].items()):
            his = sorted(r['hi'] for r in rows)
            los = sorted(r['lo'] for r in rows)
            entry[tier] = {
                'editions': len(rows),
                'ceiling': {'min': his[0], 'median': int(statistics.median(his)), 'max': his[-1]},
                'floor':   {'min': los[0], 'median': int(statistics.median(los)), 'max': los[-1]},
                'per_edition': sorted(rows, key=lambda r: r['piece']),
            }
        out['instruments'][inst] = entry

    with open(args.out, 'w') as fh:
        json.dump(out, fh, indent=2)
        fh.write('\n')

    for inst, e in out['instruments'].items():
        bits = "  ".join(
            f"{t}: {e[t]['editions']}ed ceiling {nm(e[t]['ceiling']['median'])}"
            f" floor {nm(e[t]['floor']['median'])}" for t in sorted(e))
        print(f"  {inst:18s} {bits}")
    print(f"\n{len(pieces)} pieces, tacet={len(tacet)}, warnings={len(warnings)} -> {args.out}")
    return 1 if warnings else 0


if __name__ == '__main__':
    sys.exit(main())
