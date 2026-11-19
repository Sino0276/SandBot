# 사용: python3 -I slice.py <npz> <메시 번호,…> <축 0|1|2> <값> [정렬 축 a b]
# 평면과 삼각형의 교선 조각 끝점을 찍는다(몸체 틀 in)
import sys
import numpy as np
npz = np.load(sys.argv[1])
ids = [int(v) for v in sys.argv[2].split(',')]
ax = int(sys.argv[3]); c = float(sys.argv[4])
others = [k for k in range(3) if k != ax]
pts = []
for i in ids:
    V = npz['v%d' % i]; F = npz['f%d' % i]
    d = V[:, ax] - c
    for tri in F:
        dd = d[tri]
        if (dd > 0).all() or (dd < 0).all():
            continue
        seg = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            da, db = dd[a], dd[b]
            if (da > 0) != (db > 0) and da != db:
                t = da / (da - db)
                p = V[tri[a]] + t * (V[tri[b]] - V[tri[a]])
                seg.append(p[others])
        if len(seg) == 2:
            pts.append(seg[0]); pts.append(seg[1])
P = np.array(pts)
np.save(sys.argv[1].replace('.npz', '') + '_slice.npy', P)
print('n', len(P), 'range', P.min(0), P.max(0))
