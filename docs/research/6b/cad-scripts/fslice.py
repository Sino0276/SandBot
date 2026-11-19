# 사용: python3 -I fslice.py <meshes-verts.json> <메시,…> <Z,…> <cx> <cy> [각 간격]
# 필드 좌표(in) 수평 단면에서 축(cx, cy) 둘레 각마다 첫·마지막 교차 반지름
import sys, json
import numpy as np
V = json.load(open(sys.argv[1]))
ids = [int(v) for v in sys.argv[2].split(',')]
zs = [float(v) for v in sys.argv[3].split(',')]
o = np.array([float(sys.argv[4]), float(sys.argv[5])])
step = float(sys.argv[6]) if len(sys.argv) > 6 else 15
mesh = [(np.array(V[str(i)]['pos']).reshape(-1, 3), np.array(V[str(i)]['idx']).reshape(-1, 3)) for i in ids]
for z in zs:
    segs = []
    for P, F in mesh:
        d = P[:, 2] - z
        for tri in F:
            dd = d[tri]
            if (dd > 0).all() or (dd < 0).all():
                continue
            seg = []
            for a, b in ((0, 1), (1, 2), (2, 0)):
                da, db = dd[a], dd[b]
                if (da > 0) != (db > 0):
                    t = da / (da - db)
                    seg.append((P[tri[a]] + t * (P[tri[b]] - P[tri[a]]))[:2])
            if len(seg) == 2:
                segs.append(seg)
    if not segs:
        print('Z', z, 'none'); continue
    S = np.array(segs); Pp = S[:, 0]; E = S[:, 1] - S[:, 0]
    out = []
    for a in np.arange(-180, 180, step):
        dv = np.array([np.cos(np.radians(a)), np.sin(np.radians(a))])
        det = dv[0] * (-E[:, 1]) - dv[1] * (-E[:, 0])
        ok = np.abs(det) > 1e-12
        rx = Pp[:, 0] - o[0]; ry = Pp[:, 1] - o[1]
        sd = np.where(ok, det, 1)
        t = np.where(ok, (rx * (-E[:, 1]) - ry * (-E[:, 0])) / sd, -1)
        u = np.where(ok, (dv[0] * ry - dv[1] * rx) / sd, -1)
        hit = ok & (t > 0) & (u >= 0) & (u <= 1)
        if hit.any():
            ts = np.sort(t[hit]); out.append('%d:%.3f/%.3f' % (a, ts[0], ts[-1]))
        else:
            out.append('%d:-' % a)
    print('Z %.3f' % z, ' '.join(out))
