# 사용: python3 -I contour.py <npz> <메시,…> <축> <값> <oy> <oz> [각 간격]
# 중심에서 각마다 첫 교차점(안쪽 윤곽)과 마지막 교차점(바깥 윤곽)
import sys
import numpy as np
npz = np.load(sys.argv[1]); ids = [int(v) for v in sys.argv[2].split(',')]; ax = int(sys.argv[3]); c = float(sys.argv[4])
o = np.array([float(sys.argv[5]), float(sys.argv[6])]); step = float(sys.argv[7]) if len(sys.argv) > 7 else 5
others = [k for k in range(3) if k != ax]
segs = []
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
            if (da > 0) != (db > 0):
                t = da / (da - db)
                seg.append((V[tri[a]] + t * (V[tri[b]] - V[tri[a]]))[others])
        if len(seg) == 2:
            segs.append(seg)
S = np.array(segs)
P = S[:, 0]; E = S[:, 1] - S[:, 0]
for a in np.arange(-180, 180, step):
    dv = np.array([np.cos(np.radians(a)), np.sin(np.radians(a))])
    # o + t dv = P + u E
    det = dv[0] * (-E[:, 1]) - dv[1] * (-E[:, 0])
    ok = np.abs(det) > 1e-12
    rx = P[:, 0] - o[0]; ry = P[:, 1] - o[1]
    t = np.where(ok, (rx * (-E[:, 1]) - ry * (-E[:, 0])) / np.where(ok, det, 1), -1)
    u = np.where(ok, (dv[0] * ry - dv[1] * rx) / np.where(ok, det, 1), -1)
    hit = ok & (t > 0) & (u >= 0) & (u <= 1)
    if hit.any():
        ts = np.sort(t[hit])
        pi = o + ts[0] * dv; po = o + ts[-1] * dv
        print('%6.1f in (%.3f, %.3f) out (%.3f, %.3f)' % (a, pi[0], pi[1], po[0], po[1]))
    else:
        print('%6.1f none' % a)
