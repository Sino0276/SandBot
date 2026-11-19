# 사용: python3 -I aperture.py <npz> <메시> <축> <값,…>
# 단면의 안쪽 윤곽: 지정한 선마다 가장 안쪽 교점(몸체 틀 in). 바닥 z, 옆 y, 지붕 z를 잰다
import sys
import numpy as np
npz = np.load(sys.argv[1]); i = int(sys.argv[2]); ax = int(sys.argv[3])
V = npz['v%d' % i]; F = npz['f%d' % i]
others = [k for k in range(3) if k != ax]
def slice_at(c):
    d = V[:, ax] - c
    segs = []
    for tri in F:
        dd = d[tri]
        if (dd > 0).all() or (dd < 0).all():
            continue
        seg = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            da, db = dd[a], dd[b]
            if (da > 0) != (db > 0):
                t = da / (da - db)
                seg.append((V[tri[a]] + t * (V[tri[b]] - V[tri[a]]))[others])
        if len(seg) == 2:
            segs.append(seg)
    return np.array(segs)
def ray_hits(S, o, dvec):
    # 2D 광선과 조각 교차 거리 목록
    o = np.array(o, float); dvec = np.array(dvec, float)
    out = []
    for p, q in S:
        e = q - p
        M = np.array([[dvec[0], -e[0]], [dvec[1], -e[1]]])
        if abs(np.linalg.det(M)) < 1e-12:
            continue
        t, u = np.linalg.solve(M, p - o)
        if t > 0 and 0 <= u <= 1:
            out.append(t)
    return sorted(out)
for c in [float(v) for v in sys.argv[4].split(',')]:
    S = slice_at(c)
    if len(S) == 0:
        print(c, 'none'); continue
    o = (0.0, 5.0)
    res = []
    for name, dv in (('-z', (0, -1)), ('+y', (1, 0)), ('-y', (-1, 0)), ('+z', (0, 1)), ('+y+z32', (np.cos(np.radians(57.4)), np.sin(np.radians(57.4))))):
        h = ray_hits(S, o, dv)
        res.append('%s %s' % (name, ['%.3f' % v for v in h[:4]]))
    print('x=%.3f' % c, ' | '.join(res))
