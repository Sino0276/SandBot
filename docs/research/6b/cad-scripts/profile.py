# 사용: python3 -I profile.py <slice.npy> <cy> <cz> [각 간격°]
# 중심(cy, cz) 둘레 각마다 가장 가까운·먼 교점(몸체 틀 in)
import sys, math
import numpy as np
P = np.load(sys.argv[1]); cy, cz = float(sys.argv[2]), float(sys.argv[3])
step = float(sys.argv[4]) if len(sys.argv) > 4 else 10
d = P - [cy, cz]
ang = np.degrees(np.arctan2(d[:, 1], d[:, 0]))
r = np.hypot(d[:, 0], d[:, 1])
for a in np.arange(-180, 180, step):
    sel = (ang >= a - step / 2) & (ang < a + step / 2)
    if sel.any():
        k = np.argmin(r[sel]); K = np.argmax(r[sel])
        pi = P[sel][k]; po = P[sel][K]
        print('%6.1f  near (%.3f, %.3f)  far (%.3f, %.3f)' % (a, pi[0], pi[1], po[0], po[1]))
