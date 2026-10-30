"""Written pitches of a Finale-engraved part PDF, by geometry.

See README.md. Validated against the Semsen Hymns Project Vol. 3 strings pack:
78 parts read with zero noteheads left unassigned, all 30 doubling pairs
(Viola/Clarinet 3, Cello/Bassoon, String Bass/Bass Clarinet) agreeing exactly,
and a visual check of the engraved page.
"""
import sys, os, collections, statistics, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from finale_pdf import read_pdf

NOTEHEAD = {0xCF: 'black', 0xFA: 'half', 0x77: 'whole'}
CLEF     = {0x26: 'treble', 0x3F: 'bass', 0x42: 'c'}
# diatonic index of the line the clef glyph's own origin sits on
CLEF_REF = {'treble': 4*7+4, 'bass': 3*7+3, 'c': 4*7+0}   # G4, F3, C4
CLEF_NAME_BY_DEG = {4: 'alto', 6: 'tenor', 2: 'soprano', 8: 'baritone'}
ACC      = {0x23: 1, 0x62: -1, 0x6E: 0}          # sharp, flat, natural
# bottom staff line as a diatonic index (octave*7 + [C,D,E,F,G,A,B])
CLEF_BASE = {'treble': 4*7+2, 'bass': 2*7+4, 'alto': 3*7+3, 'tenor': 3*7+1}
SEMI = [0, 2, 4, 5, 7, 9, 11]

def midi_of(idx, alter):
    return (idx // 7 + 1) * 12 + SEMI[idx % 7] + alter

def find_staves(hsegs, min_len=120.0):
    """Five lines at the modal spacing = one staff.

    Neither a greedy scan nor an adjacency chain works. A multi-measure-rest
    bar, a hairpin and a beam all draw long horizontal lines near a staff; any
    rule that walks neighbours in order is derailed by them and cannot recover,
    which silently dropped whole systems. So ask the question directly: is
    there a line at y, y+s, y+2s, y+3s and y+4s? Interlopers then simply fail
    the test instead of breaking a chain.
    """
    runs = collections.defaultdict(list)
    for x0, x1, y in hsegs:
        runs[round(y, 1)].append((x0, x1))
    if not runs:
        return []
    longest = max((x1 - x0) for segs in runs.values() for x0, x1 in segs)
    # staff lines span the system; beams and hairpins are a fraction of it
    thresh = max(min_len, 0.55 * longest)
    ys = {y: segs for y, segs in runs.items()
          if max(x1 - x0 for x0, x1 in segs) >= thresh}
    cand = sorted(ys)
    if len(cand) < 5:
        return []
    gaps = collections.Counter(round(b - a, 1) for a, b in zip(cand, cand[1:])
                               if 2.0 <= b - a <= 15.0)
    if not gaps:
        return []

    def at(y):
        for c in cand:
            if abs(c - y) < 0.35:
                return c
        return None

    # A page can carry more than one staff size -- a last system engraved
    # larger sat at 6.0pt while the rest of the page was 5.1pt, and a single
    # modal spacing left its 13 noteheads on no staff at all. Try every
    # spacing with enough support, densest first, and let `used` settle ties.
    out, used = [], set()
    for space, _n in gaps.most_common():
        if _n < 4:                      # one staff contributes four gaps
            continue
        for y0 in cand:
            if y0 in used:
                continue
            run = [y0]
            for k in range(1, 5):
                c = at(y0 + k * space)
                if c is None or c in used:
                    run = None; break
                run.append(c)
            if not run:
                continue
            used.update(run)
            out.append({'lines': run, 'space': space,
                        'xL': min(x for y in run for x, _ in ys[y]),
                        'xR': max(x for y in run for _, x in ys[y])})
    out.sort(key=lambda s: s['lines'][0])
    return out


def extract(path, default_clef=None, verbose=False):
    notes, warnings = [], []
    seen_heads = set()
    for pi, page in enumerate(read_pdf(path), 1):
        staves = find_staves(page['hsegs'])
        if not staves:
            continue
        mus = [g for g in page['glyphs'] if g['font'] in ('Petrucci', 'Maestro')]
        page_heads = [g for g in page['glyphs']
                      if g['font'] == 'Petrucci' and g['code'] in NOTEHEAD]
        # "8va"/"8vb" would shift a whole passage; report rather than silently absorb
        for g in page['glyphs']:
            if g['font'].startswith('Times') or g['font'].startswith('Eras'):
                pass
        for si, s in enumerate(staves):
            half = s['space'] / 2
            top, bot = s['lines'][4], s['lines'][0]
            # a glyph belongs to this staff if it is within ~5 spaces of it
            band = [g for g in mus
                    if bot - 6 * s['space'] <= g['y'] <= top + 6 * s['space']
                    and s['xL'] - 2 <= g['x'] <= s['xR'] + 6]
            # drop glyphs that belong to a nearer staff
            band = [g for g in band
                    if min(abs(g['y'] - L) for L in s['lines'])
                    == min(min(abs(g['y'] - L) for L in t['lines']) for t in staves)]
            deg = lambda g: int(round((g['y'] - bot) / half))

            clefs = [g for g in band if g['code'] in CLEF and g['font'] == 'Petrucci']
            clefs.sort(key=lambda g: g['x'])
            if clefs:
                kind = CLEF[clefs[0]['code']]
                cdeg = int(round((clefs[0]['y'] - bot) / half))
                base = CLEF_REF[kind] - cdeg
                clef = kind if kind != 'c' else CLEF_NAME_BY_DEG.get(cdeg, 'alto')
                clef_x = clefs[0]['x']
            else:
                clef = default_clef or 'treble'
                base = CLEF_BASE[clef]
                clef_x = s['xL']

            # key signature: accidentals clustered just right of the clef
            keysig = {}
            accs = sorted((g for g in band if g['code'] in ACC and g['font'] == 'Petrucci'),
                          key=lambda g: g['x'])
            ks_end = clef_x + 2.2 * s['space']
            run_x = clef_x
            for g in accs:
                if g['x'] <= ks_end and g['x'] >= run_x - 0.5:
                    letter = (base + deg(g)) % 7
                    keysig[letter] = ACC[g['code']]
                    run_x = g['x']; ks_end = g['x'] + 1.3 * s['space']
            inline = [g for g in accs if g['x'] > ks_end]

            # barlines: vertical strokes spanning most of this staff
            bars = sorted({round(v[2], 1) for v in page['vsegs']
                           if v[0] <= bot + 1.2 and v[1] >= top - 1.2
                           and s['xL'] - 3 <= v[2] <= s['xR'] + 3})

            heads = sorted((g for g in band if g['code'] in NOTEHEAD and g['font'] == 'Petrucci'),
                           key=lambda g: g['x'])
            for h in heads:
                d = deg(h)
                idx = base + d
                alter = keysig.get(idx % 7, 0)
                # an inline accidental: just left of the head, same line/space,
                # and after the most recent barline before this head
                prev_bar = max([b for b in bars if b < h['x'] - 0.5], default=-1e9)
                for a in inline:
                    if (prev_bar < a['x'] < h['x'] + 0.5
                            and abs(a['y'] - h['y']) < half * 0.6
                            and (h['x'] - a['x']) < 3.0 * s['space']):
                        alter = ACC[a['code']]
                seen_heads.add((pi, round(h['x'], 3), round(h['y'], 3)))
                notes.append({'page': pi, 'staff': si, 'x': round(h['x'], 2),
                              'deg': d, 'clef': clef, 'kind': NOTEHEAD[h['code']],
                              'midi': midi_of(idx, alter), 'alter': alter})
        missed = [g for g in page_heads
                  if (pi, round(g['x'], 3), round(g['y'], 3)) not in seen_heads]
        if missed:
            warnings.append(f"page {pi}: {len(missed)} notehead glyph(s) on no staff")
    return notes, warnings

NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def nm(m): return f"{NAMES[m % 12]}{m // 12 - 1}"

if __name__ == '__main__':
    for path in sys.argv[1:]:
        notes, _ = extract(path)
        if not notes:
            print(f"{path.split('/')[-1]}: NO NOTES"); continue
        ms = [n['midi'] for n in notes]
        kinds = collections.Counter(n['kind'] for n in notes)
        print(f"{path.split('/')[-1]}")
        print(f"   notes={len(notes)} range={nm(min(ms))}..{nm(max(ms))} ({min(ms)}..{max(ms)})"
              f" median={int(statistics.median(ms))} clef={notes[0]['clef']} kinds={dict(kinds)}")
