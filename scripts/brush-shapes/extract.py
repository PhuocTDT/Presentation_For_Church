# Trích các hình tô (fill) từ luồng nội dung PDF/AI → JSON [{fill, d (toạ độ y lật xuống), bbox}]
import re, sys, zlib, json

def streams(data):
    for m in re.finditer(rb'stream\r?\n', data):
        start = m.end()
        end = data.find(b'endstream', start)
        raw = data[start:end]
        hdr = data[max(0, m.start() - 400):m.start()]
        if b'FlateDecode' in hdr.split(b'obj')[-1]:
            try: raw = zlib.decompressobj().decompress(raw)
            except Exception: continue
        yield raw

TOK = re.compile(rb'[-+]?\d*\.\d+|[-+]?\d+|/[^\s/\[\]()<>]+|[A-Za-z\'"*]+|\[|\]|\(.*?\)|<<|>>|<[^>]*>')

def parse(raw, H):
    st = []; out = []; path = []; cur = None; color = None; ctm = [1, 0, 0, 1, 0, 0]; stack = []
    def T(x, y):
        a, b, c, d, e, f = ctm
        return (a * x + c * y + e, b * x + d * y + f)
    for t in TOK.findall(raw):
        try:
            st.append(float(t)); continue
        except ValueError: pass
        op = t.decode('latin1')
        op = {'mo': 'm', 'li': 'l', 'cv': 'c', 'cp': 'h', 'cmyk': 'k'}.get(op, op)
        n = st
        if op == 'q': stack.append(list(ctm))
        elif op == 'Q': ctm = stack.pop() if stack else ctm
        elif op == 'cm' and len(n) >= 6:
            a, b, c, d, e, f = n[-6:]; A = ctm
            ctm = [a * A[0] + b * A[2], a * A[1] + b * A[3], c * A[0] + d * A[2], c * A[1] + d * A[3], e * A[0] + f * A[2] + A[4], e * A[1] + f * A[3] + A[5]]
        elif op == 'm' and len(n) >= 2: p = T(*n[-2:]); path.append(['M', p]); cur = p
        elif op == 'l' and len(n) >= 2: p = T(*n[-2:]); path.append(['L', p]); cur = p
        elif op == 'c' and len(n) >= 6:
            p1, p2, p3 = T(*n[-6:-4]), T(*n[-4:-2]), T(*n[-2:]); path.append(['C', p1, p2, p3]); cur = p3
        elif op == 'v' and len(n) >= 4:
            p2, p3 = T(*n[-4:-2]), T(*n[-2:]); path.append(['C', cur, p2, p3]); cur = p3
        elif op == 'y' and len(n) >= 4:
            p1, p3 = T(*n[-4:-2]), T(*n[-2:]); path.append(['C', p1, p3, p3]); cur = p3
        elif op == 'h': path.append(['Z'])
        elif op == 're' and len(n) >= 4:
            x, y, w, h = n[-4:]
            path += [['M', T(x, y)], ['L', T(x + w, y)], ['L', T(x + w, y + h)], ['L', T(x, y + h)], ['Z']]
        elif op in ('rg', 'sc', 'scn') and len(n) >= 3: color = '#%02x%02x%02x' % tuple(int(max(0, min(1, v)) * 255) for v in n[-3:])
        elif op == 'k' and len(n) >= 4:
            c, m_, y_, k = n[-4:]; color = '#%02x%02x%02x' % tuple(int(255 * (1 - min(1, v + k))) for v in (c, m_, y_))
        elif op in ('f', 'F', 'f*', 'B', 'B*', 'b', 'b*'):
            if path: out.append({'fill': color, 'path': path})
            path = []
        elif op in ('n', 'S', 's', 'W', 'W*'):
            if op in ('n', 'S', 's'): path = []
        st = []
    res = []
    for o in out:
        xs = []; ys = []; d = ''
        for seg in o['path']:
            if seg[0] == 'Z': d += 'Z'; continue
            pts = seg[1:]
            d += seg[0] + ' '.join('%.2f %.2f' % (x, H - y) for x, y in pts) + ' '
            for x, y in pts: xs.append(x); ys.append(H - y)
        if xs: res.append({'fill': o['fill'], 'd': d.strip(), 'bbox': [min(xs), min(ys), max(xs), max(ys)], 'n': len(o['path'])})
    return res

data = open(sys.argv[1], 'rb').read()
H = float(sys.argv[3]) if len(sys.argv) > 3 else 500
if data[:4] != b'%PDF':
    a = data.find(b'%%Page: 1 1'); b = data.find(b'%%PageTrailer')
    r = parse(data[a:b], H)
    json.dump(r, open(sys.argv[2], 'w'))
    for i, x in enumerate(r): print(i, x['fill'], [round(v) for v in x['bbox']], x['n'])
    sys.exit(0)
H = float(sys.argv[3]) if len(sys.argv) > 3 else 500
best = []
for raw in streams(data):
    if raw.count(b' c') < 20: continue
    r = parse(raw, H)
    if len(r) > len(best): best = r
json.dump(best, open(sys.argv[2], 'w'))
for i, r in enumerate(best): print(i, r['fill'], [round(v) for v in r['bbox']], r['n'])
