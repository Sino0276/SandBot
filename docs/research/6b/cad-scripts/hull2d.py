# 사용: python3 -I hull2d.py <meshes-verts.json> <cx> <cy> <메시,…>
# 메시 꼭짓점의 XY 볼록 껍질(축 기준 u = X − cx, v = Y − cy, in)과 Z 범위, 거의 일직선인 점 제거
import sys, json, math
import numpy as np
V = json.load(open(sys.argv[1])); cx, cy = float(sys.argv[2]), float(sys.argv[3])
def hull(P):
    P = sorted(set(map(tuple, np.round(P, 4))))
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, up = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
def simplify(H, tol=0.01):
    out = list(H)
    changed = True
    while changed and len(out) > 3:
        changed = False
        for k in range(len(out)):
            a, b, c = np.array(out[k-1]), np.array(out[k]), np.array(out[(k+1) % len(out)])
            ab = c - a; L = np.linalg.norm(ab)
            d = abs(ab[0] * (b - a)[1] - ab[1] * (b - a)[0]) / L if L > 0 else 0
            if d < tol:
                out.pop(k); changed = True; break
    return out
for i in [int(v) for v in sys.argv[4].split(',')]:
    P = np.array(V[str(i)]['pos']).reshape(-1, 3)
    H = simplify(hull(P[:, :2] - [cx, cy]))
    print('mesh', i, 'Z [%.3f, %.3f]' % (P[:, 2].min(), P[:, 2].max()), 'hull', len(H))
    print('   ' + ' '.join('(%.3f,%.3f)' % p for p in H))
