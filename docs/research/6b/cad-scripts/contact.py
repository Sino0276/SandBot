# 사용: python3 -I contact.py <meshes-verts.json> <메시 a> <메시 b>
# a의 꼭짓점 → b의 삼각형 최단 거리(정확한 점–삼각형), 가장 가까운 짝과 b 면 법선
import sys, json, math
import numpy as np
V = json.load(open(sys.argv[1]))
a, b = int(sys.argv[2]), int(sys.argv[3])
A = np.array(V[str(a)]['pos']).reshape(-1, 3)
B = np.array(V[str(b)]['pos']).reshape(-1, 3); FB = np.array(V[str(b)]['idx']).reshape(-1, 3)
def closest_on_tri(p, t0, t1, t2):
    # Ericson 5.1.5
    ab = t1 - t0; ac = t2 - t0; ap = p - t0
    d1 = ab @ ap; d2 = ac @ ap
    if d1 <= 0 and d2 <= 0: return t0
    bp = p - t1; d3 = ab @ bp; d4 = ac @ bp
    if d3 >= 0 and d4 <= d3: return t1
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0: return t0 + d1 / (d1 - d3) * ab
    cp = p - t2; d5 = ab @ cp; d6 = ac @ cp
    if d6 >= 0 and d5 <= d6: return t2
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0: return t0 + d2 / (d2 - d6) * ac
    va = d3 * d6 - d5 * d4
    if va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0:
        return t1 + (d4 - d3) / ((d4 - d3) + (d5 - d6)) * (t2 - t1)
    den = 1 / (va + vb + vc); v = vb * den; w = vc * den
    return t0 + ab * v + ac * w
# 후보 줄이기
cent = B[FB].mean(1)
best = (1e9, None, None, None)
for p in A:
    near = np.argsort(np.linalg.norm(cent - p, axis=1))[:40]
    for k in near:
        t = B[FB[k]]
        q = closest_on_tri(p, *t)
        d = np.linalg.norm(p - q)
        if d < best[0]:
            n = np.cross(t[1] - t[0], t[2] - t[0]); n /= np.linalg.norm(n)
            best = (d, p, q, n)
print('min dist %.4f in' % best[0], 'a pt', np.round(best[1], 3), 'b pt', np.round(best[2], 3), 'b normal', np.round(best[3], 3))
