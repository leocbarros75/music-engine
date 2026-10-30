"""
Read pitches out of a Finale-engraved PDF part.

Not an OMR system and not trying to be one. It exploits the fact that Finale,
printed through Quartz, writes every glyph as its own
    q <a> 0 0 <d> <x> <y> cm BT <s> 0 0 <s> 0 0 Tm /Fn 1 Tf (<code>) Tj ET Q
and draws staff lines, ledger lines, stems and barlines as explicit strokes.
So a notehead's pitch is geometry, not image recognition: its y against the
five staff-line y values, plus the clef and the accidentals in front of it.

Stdlib only. Reads untrusted input files; never executes anything from them.
"""
import re, sys, zlib, collections, json, math

# ── PDF object layer ────────────────────────────────────────────────────────

def _objects(data):
    objs = {}
    for m in re.finditer(rb'(?<![0-9])(\d+)\s+(\d+)\s+obj\b', data):
        num = int(m.group(1))
        end = data.find(b'endobj', m.end())
        objs[num] = data[m.end():end if end > 0 else len(data)]
    return objs

def _stream_of(body):
    m = re.search(rb'stream\r?\n', body)
    if not m:
        return None
    e = body.find(b'endstream', m.end())
    raw = body[m.end():e if e > 0 else len(body)]
    if b'FlateDecode' in body[:m.start()]:
        try:
            return zlib.decompress(raw)
        except Exception:
            try:
                return zlib.decompressobj().decompress(raw)
            except Exception:
                return None
    return raw

def _dict_get(body, key):
    """Value of /key: a ref '12 0 R', a name, a number, an [array] or a << dict >>."""
    m = re.search(rb'/' + key.encode() + rb'\s*(?=\S)', body)
    if not m:
        return None
    i = m.end()
    if body[i:i + 2] == b'<<':                      # nested dict: match << >> depth
        depth, j = 0, i
        while j < len(body):
            if body[j:j + 2] == b'<<':
                depth += 1; j += 2
            elif body[j:j + 2] == b'>>':
                depth -= 1; j += 2
                if depth == 0:
                    return body[i:j]
            else:
                j += 1
        return body[i:]
    m2 = re.match(rb'(\[[^\]]*\]|\d+\s+\d+\s+R|/[A-Za-z0-9#+._-]+|-?[\d.]+)', body[i:])
    return m2.group(1).strip() if m2 else None

def _resolve(objs, val):
    if val is None:
        return None
    m = re.fullmatch(rb'(\d+)\s+\d+\s+R', val.strip())
    return objs.get(int(m.group(1))) if m else val

# ── page discovery, in document order ───────────────────────────────────────

def _pages(data, objs):
    """Page bodies in /Kids order when a /Pages node exists, else file order."""
    order = []
    for num, body in objs.items():
        if re.search(rb'/Type\s*/Pages\b', body):
            kids = _dict_get(body, 'Kids')
            if kids:
                order += [int(x) for x in re.findall(rb'(\d+)\s+\d+\s+R', kids)]
    seen, out = set(), []
    for num in order:
        b = objs.get(num)
        if b is not None and re.search(rb'/Type\s*/Page\b', b) and num not in seen:
            seen.add(num); out.append((num, b))
    if not out:
        out = sorted(((n, b) for n, b in objs.items()
                      if re.search(rb'/Type\s*/Page\b', b)), key=lambda kv: kv[0])
    return out

def _fonts(objs, page_body):
    """Resource font name -> BaseFont, e.g. b'TT22' -> 'Petrucci'."""
    res = _resolve(objs, _dict_get(page_body, 'Resources'))
    if res is None:
        res = page_body
    fdict = _resolve(objs, _dict_get(res, 'Font'))
    out = {}
    if fdict is None:
        return out
    for name, ref in re.findall(rb'/([A-Za-z0-9]+)\s+(\d+)\s+\d+\s+R', fdict):
        fb = _dict_get(objs.get(int(ref), b''), 'BaseFont')
        if fb:
            out[name] = fb.lstrip(b'/').split(b'+')[-1].decode('latin-1')
    return out

def _content(objs, page_body):
    c = _dict_get(page_body, 'Contents')
    if c is None:
        return b''
    parts = []
    for ref in re.findall(rb'(\d+)\s+\d+\s+R', c):
        s = _stream_of(objs.get(int(ref), b''))
        if s:
            parts.append(s)
    if not parts:
        s = _stream_of(_resolve(objs, c) or b'')
        if s:
            parts.append(s)
    return b'\n'.join(parts)

# ── content stream interpreter ─────────────────────────────────────────────

_TOK = re.compile(rb"""
    (?P<str>\((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*\))
  | (?P<hex><[0-9A-Fa-f\s]*>)
  | (?P<name>/[^\s/\[\]()<>]+)
  | (?P<num>[-+]?(?:\d+\.?\d*|\.\d+))
  | (?P<arr>[\[\]])
  | (?P<op>[A-Za-z'"*][A-Za-z0-9'"*]*)
""", re.X)

_ESC = {b'n': b'\n', b'r': b'\r', b't': b'\t', b'b': b'\b', b'f': b'\f',
        b'(': b'(', b')': b')', b'\\': b'\\'}

def _unescape(s):
    s = s[1:-1]
    s = re.sub(rb'\\([0-7]{1,3})', lambda m: bytes([int(m.group(1), 8) & 0xFF]), s)
    s = re.sub(rb'\\(.)', lambda m: _ESC.get(m.group(1), m.group(1)), s)
    return s

def _mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a*A + b*C, a*B + b*D, c*A + d*C, c*B + d*D, e*A + f*C + E, e*B + f*D + F)

def interpret(stream, fonts):
    """-> (glyphs, hsegs, vsegs). Glyph x,y is the glyph origin in page points."""
    glyphs, hsegs, vsegs = [], [], []
    ctm = (1, 0, 0, 1, 0, 0)
    stack = []
    tm = tlm = (1, 0, 0, 1, 0, 0)
    font, size, leading = None, 0.0, 0.0
    operands = []
    cur = None          # current point for path building
    path = []           # list of (x0,y0,x1,y1) in device space

    def dev(x, y, m):
        a, b, c, d, e, f = m
        return (a*x + c*y + e, b*x + d*y + f)

    def flush_path():
        nonlocal path
        for x0, y0, x1, y1 in path:
            if abs(y1 - y0) < 0.35 and abs(x1 - x0) > 0.5:
                hsegs.append((min(x0, x1), max(x0, x1), (y0 + y1) / 2))
            elif abs(x1 - x0) < 0.35 and abs(y1 - y0) > 0.5:
                vsegs.append((min(y0, y1), max(y0, y1), (x0 + x1) / 2))
        path = []

    def nums(n):
        if len(operands) < n:
            return None
        try:
            return [float(v.decode('latin-1')) for v in operands[-n:]]
        except ValueError:
            return None

    for m in _TOK.finditer(stream):
        kind = m.lastgroup
        tokv = m.group()
        if kind in ('str', 'hex', 'name', 'num', 'arr'):
            operands.append(tokv)
            continue
        op = tokv.decode('latin-1')
        if op == 'q':
            stack.append(ctm)
        elif op == 'Q':
            if stack:
                ctm = stack.pop()
        elif op == 'cm':
            v = nums(6)
            if v:
                ctm = _mul(tuple(v), ctm)
        elif op == 'BT':
            tm = tlm = (1, 0, 0, 1, 0, 0)
        elif op == 'Tf':
            if len(operands) >= 2:
                font = fonts.get(operands[-2].lstrip(b'/'), '')
                try: size = float(operands[-1].decode('latin-1'))
                except ValueError: size = 0.0
        elif op == 'Tm':
            v = nums(6)
            if v:
                tm = tlm = tuple(v)
        elif op in ('Td', 'TD'):
            v = nums(2)
            if v:
                if op == 'TD':
                    leading = -v[1]
                tlm = _mul((1, 0, 0, 1, v[0], v[1]), tlm); tm = tlm
        elif op == 'TL':
            v = nums(1)
            if v: leading = v[0]
        elif op == 'T*':
            tlm = _mul((1, 0, 0, 1, 0, -leading), tlm); tm = tlm
        elif op in ('Tj', 'TJ', "'", '"'):
            if op in ("'", '"'):
                tlm = _mul((1, 0, 0, 1, 0, -leading), tlm); tm = tlm
            codes = []
            if op == 'TJ':
                # last [...] group: strings advance, numbers kern
                depth = 0
                for t in reversed(operands):
                    if t == b']': depth += 1
                    elif t == b'[':
                        depth -= 1
                        if depth == 0: break
                start = len(operands) - 1
                d = 0
                for i in range(len(operands) - 1, -1, -1):
                    if operands[i] == b']': d += 1
                    elif operands[i] == b'[':
                        d -= 1
                        if d == 0:
                            start = i; break
                for t in operands[start + 1:]:
                    if t.startswith(b'('):
                        codes += list(_unescape(t))
            elif operands and operands[-1].startswith(b'('):
                codes = list(_unescape(operands[-1]))
            trm = _mul(_mul((size, 0, 0, size, 0, 0), tm), ctm)
            x, y = trm[4], trm[5]
            eff = math.hypot(trm[2], trm[3])
            for i, code in enumerate(codes):
                glyphs.append({'x': x, 'y': y, 'code': code, 'font': font or '', 'size': eff})
        elif op == 'm':
            v = nums(2)
            if v: cur = dev(v[0], v[1], ctm)
        elif op == 'l':
            v = nums(2)
            if v and cur:
                p = dev(v[0], v[1], ctm)
                path.append((cur[0], cur[1], p[0], p[1])); cur = p
        elif op == 're':
            v = nums(4)
            if v:
                x, y, w, h = v
                c0 = dev(x, y, ctm); c1 = dev(x + w, y + h, ctm)
                X0, X1 = sorted((c0[0], c1[0])); Y0, Y1 = sorted((c0[1], c1[1]))
                if abs(Y1 - Y0) < 1.2 and (X1 - X0) > 0.5:
                    path.append((X0, (Y0 + Y1) / 2, X1, (Y0 + Y1) / 2))
                elif abs(X1 - X0) < 1.2 and (Y1 - Y0) > 0.5:
                    path.append(((X0 + X1) / 2, Y0, (X0 + X1) / 2, Y1))
        elif op in ('S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n'):
            flush_path()
        if op:
            operands = []
    flush_path()
    return glyphs, hsegs, vsegs

def read_pdf(path):
    data = open(path, 'rb').read()
    objs = _objects(data)
    out = []
    for num, body in _pages(data, objs):
        fonts = _fonts(objs, body)
        g, h, v = interpret(_content(objs, body), fonts)
        out.append({'glyphs': g, 'hsegs': h, 'vsegs': v})
    return out

if __name__ == '__main__':
    pages = read_pdf(sys.argv[1])
    print(f"pages: {len(pages)}")
    for i, p in enumerate(pages, 1):
        byfont = collections.Counter(g['font'] for g in p['glyphs'])
        print(f"  p{i}: glyphs={len(p['glyphs'])} hsegs={len(p['hsegs'])} vsegs={len(p['vsegs'])} fonts={dict(byfont)}")
    mus = [g for p in pages for g in p['glyphs'] if 'Petrucci' in g['font'] or 'Maestro' in g['font']]
    print("\nmusic-font glyph codes:")
    for (f, c, s), n in collections.Counter((g['font'], g['code'], round(g['size'], 1)) for g in mus).most_common(25):
        print(f"  {f:10s} 0x{c:02X} size={s:6.2f}  n={n}")
