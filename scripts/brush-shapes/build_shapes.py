# Dựng src/editor/brush-shapes.js từ các vệt sơn vector trích ra (s133.json = vệt mềm, s16577.json = vệt cọ khô).
# Mỗi hình: bỏ chữ trắng + ô mẫu màu lạc, làm phẳng Bezier, rút gọn (RDP), rồi chuẩn hoá sao cho HÌNH CHỮ NHẬT LỚN NHẤT
# NẰM TRỌN TRONG THÂN vệt = [0,1000]x[0,1000]  → khi vẽ, kéo [0,1000]² vào đúng hộp chữ thì chữ luôn được che kín.
import json, re, sys

def subpaths(d):
    toks = re.findall(r'[MLCZ]|-?\d+(?:\.\d+)?', d)
    out = []; cur = None; op = None; buf = []; last = None
    def flush():
        nonlocal buf
        buf = []
    i = 0
    while i < len(toks):
        t = toks[i]
        if t in 'MLCZ':
            op = t; i += 1
            if op == 'Z':
                if cur: out.append(cur); cur = None
            continue
        if op == 'M':
            if cur: out.append(cur)
            p = (float(toks[i]), float(toks[i + 1])); i += 2; cur = [p]; last = p; op = 'L'
        elif op == 'L':
            p = (float(toks[i]), float(toks[i + 1])); i += 2; cur.append(p); last = p
        elif op == 'C':
            p1 = (float(toks[i]), float(toks[i + 1])); p2 = (float(toks[i + 2]), float(toks[i + 3])); p3 = (float(toks[i + 4]), float(toks[i + 5])); i += 6
            p0 = last
            for k in range(1, 9):
                t_ = k / 8; a = (1 - t_) ** 3; b = 3 * (1 - t_) ** 2 * t_; c = 3 * (1 - t_) * t_ ** 2; e = t_ ** 3
                cur.append((a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]))
            last = p3
        else: i += 1
    if cur: out.append(cur)
    return [s for s in out if len(s) >= 3]

def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; return [min(xs), min(ys), max(xs), max(ys)]

def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]; dx, dy = x1 - x0, y1 - y0; L = (dx * dx + dy * dy) ** 0.5 or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x1 * y0 - y1 * x0) / L
        if d > dmax: dmax, idx = d, i
    if dmax > eps: return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]

def inside(pt, P):
    c = False; j = len(P) - 1
    for i in range(len(P)):
        xi, yi = P[i]; xj, yj = P[j]
        if (yi > pt[1]) != (yj > pt[1]) and pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi: c = not c
        j = i
    return c

def inscribed(P, bb, GX=240, GY=80, minH=0.55):
    x0, y0, x1, y1 = bb; w, h = x1 - x0, y1 - y0
    grid = [[inside((x0 + (i + .5) * w / GX, y0 + (j + .5) * h / GY), P) for i in range(GX)] for j in range(GY)]
    best = (0, None)
    for ja in range(GY):
        col = [True] * GX
        for jb in range(ja, GY):
            col = [col[i] and grid[jb][i] for i in range(GX)]
            if (jb - ja + 1) < minH * GY: continue
            run = 0
            for i in range(GX):
                run = run + 1 if col[i] else 0
                area = run * (jb - ja + 1)
                if area > best[0]: best = (area, (i - run + 1, ja, i + 1, jb + 1))
    i0, j0, i1, j1 = best[1]
    return [x0 + i0 * w / GX, y0 + j0 * h / GY, x0 + i1 * w / GX, y0 + j1 * h / GY]

def centered(P, bb, GX=240, GY=80, minH=0.5):
    # hình chữ nhật lớn nhất nằm trọn trong thân VÀ ĐẶT GIỮA trọng tâm diện tích của thân → chữ luôn nằm giữa vệt như mẫu
    x0, y0, x1, y1 = bb; w, h = x1 - x0, y1 - y0
    g = [[1 if inside((x0 + (i + .5) * w / GX, y0 + (j + .5) * h / GY), P) else 0 for i in range(GX)] for j in range(GY)]
    S = [[0] * (GX + 1) for _ in range(GY + 1)]
    for j in range(GY):
        for i in range(GX): S[j + 1][i + 1] = g[j][i] + S[j][i + 1] + S[j + 1][i] - S[j][i]
    full = lambda i0, j0, i1, j1: S[j1][i1] - S[j0][i1] - S[j1][i0] + S[j0][i0] == (i1 - i0) * (j1 - j0)
    A = sum(map(sum, g)); ci = sum(i for j in range(GY) for i in range(GX) if g[j][i]) / A; cj = sum(j for j in range(GY) for i in range(GX) if g[j][i]) / A
    ci, cj = int(round(ci)), int(round(cj))
    best = (0, None)
    for hh in range(1, GY):
        j0, j1 = cj - hh, cj + hh
        if j0 < 0 or j1 > GY: break
        if (j1 - j0) < minH * GY: continue
        hw = 0
        while ci - hw - 1 >= 0 and ci + hw + 1 <= GX and full(ci - hw - 1, j0, ci + hw + 1, j1): hw += 1
        if hw and (2 * hw) * (j1 - j0) > best[0]: best = ((2 * hw) * (j1 - j0), (ci - hw, j0, ci + hw, j1))
    if not best[1]: return inscribed(P, bb, GX, GY)
    i0, j0, i1, j1 = best[1]
    return [x0 + i0 * w / GX, y0 + j0 * h / GY, x0 + i1 * w / GX, y0 + j1 * h / GY]

def build(fn):
    rs = [r for r in json.load(open(fn)) if r['fill'] and r['fill'] != '#ffffff']
    by = {}
    for r in rs: by.setdefault(r['fill'], []).append(r)
    shapes = []
    for col, items in by.items():
        subs = [s for r in items for s in subpaths(r['d'])]
        core = max(subs, key=lambda s: (lambda b: (b[2] - b[0]) * (b[3] - b[1]))(bbox(s)))
        cb = bbox(core); w, h = cb[2] - cb[0], cb[3] - cb[1]
        if len(core) < 60: continue
        keep = [s for s in subs if (lambda b: b[0] > cb[0] - w * .1 and b[2] < cb[2] + w * .1 and b[1] > cb[1] - h * .35 and b[3] < cb[3] + h * .35)(bbox(s))]
        # toạ độ tương đối hộp lõi 0..1000 trước khi rút gọn (để eps đồng nhất giữa các tệp)
        nrm = lambda s: [((x - cb[0]) / w * 1000, (y - cb[1]) / h * 1000) for x, y in s]
        keep = [nrm(s) for s in keep]; corep = nrm(core)
        ir = centered(corep, [0, 0, 1000, 1000])
        # chừa lề an toàn (lưới thô + rút gọn RDP có thể làm mép lấn vào): 1.2% ngang, 3% dọc
        mx, my = (ir[2] - ir[0]) * 0.012, (ir[3] - ir[1]) * 0.03
        ir = [ir[0] + mx, ir[1] + my, ir[2] - mx, ir[3] - my]
        sx, sy = 1000 / (ir[2] - ir[0]), 1000 / (ir[3] - ir[1])
        final = []
        for s in keep:
            # vòng kín: tách tại điểm xa điểm đầu nhất rồi rút gọn hai nửa (RDP với đoạn có 2 đầu trùng nhau sẽ suy biến)
            k = max(range(len(s)), key=lambda i: (s[i][0] - s[0][0]) ** 2 + (s[i][1] - s[0][1]) ** 2)
            s2 = rdp(s[:k + 1], 1.6)[:-1] + rdp(s[k:] + [s[0]], 1.6)[:-1]
            if len(s2) < 3: continue
            area = abs(sum(s2[i][0] * s2[i - 1][1] - s2[i - 1][0] * s2[i][1] for i in range(len(s2)))) / 2
            if area < 6: continue                         # vụn quá nhỏ (vô hình khi chiếu)
            final.append([(round((x - ir[0]) * sx), round((y - ir[1]) * sy)) for x, y in s2])
        final.sort(key=lambda s: -len(s))
        # bỏ các đường con nằm TRỌN trong vùng chữ (lỗ li ti của cọ khô) — sẽ thành chấm lạ đè lên chữ
        final = final[:1] + [s for s in final[1:] if not (lambda b: b[0] > 0 and b[1] > 0 and b[2] < 1000 and b[3] < 1000)(bbox(s))]
        d = ' '.join('M' + ' '.join('%d %d' % p for p in s) + 'Z' for s in final)
        allb = bbox([p for s in final for p in s])
        shapes.append({'d': d, 'n': sum(len(s) for s in final), 'subs': len(final), 'bounds': allb, 'inscribed': [round(v) for v in ir]})
    return shapes

smooth = build('s133.json'); dry = build('s16577.json')
for k, arr in (('smooth', smooth), ('dry', dry)):
    for s in arr: print(k, s['n'], s['subs'], s['bounds'], len(s['d']))
js = '''/* Hình vệt sơn (cọ) cho nền theo vùng chữ — do scripts/ dựng từ bộ vector mẫu người dùng cung cấp (xem docs/data-contracts.md).
 * Mỗi chuỗi là path SVG (chỉ M/L/Z) trong hệ toạ độ mà HÌNH CHỮ NHẬT LỚN NHẤT NẰM TRỌN TRONG THÂN vệt = [0,1000]x[0,1000];
 * phần sợi/đuôi/mảnh vụn có toạ độ ngoài khoảng đó. Vẽ: kéo [0,1000]² vào đúng hộp chữ → chữ luôn được che kín.
 * smooth = vệt mềm ("Brush"), dry = cọ khô ("Brush khô"). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrushShapes = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    smooth: %s,
    dry: %s
  };
}));
''' % (json.dumps([s['d'] for s in smooth], indent=0), json.dumps([s['d'] for s in dry], indent=0))
open(sys.argv[1], 'w', encoding='utf8', newline='\n').write(js)
print('bytes', len(js))
