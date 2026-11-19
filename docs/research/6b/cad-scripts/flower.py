# 사용: python3 -I flower.py <meshes-verts.json>
# FLOWER 9(am-5855 Flower Assembly <1>) 부품의 측정값을 FLOWER 9 자기 틀(u = 필드 +X, v = 필드 +Y, w = Z, 원점은 축과 타일 윗면)의
# 미터로 찍는다(6b 시즌 데이터 biobuzz.ts의 FLOWER 부품). 메시 좌표는 FTC 필드 좌표 인치다(dump.mjs 출력).
# v 대칭으로 만든다(FLOWER는 v에 거울 대칭, cad-geometry-notes [FLOWER frame convention]): 점과 그 v 거울을 합친 볼록 껍질을
# 줄인다(꼭짓점을 빼면 껍질 안쪽으로만 줄어든다, 오차 ≤ SIMPLIFY_IN).
import sys, json, math
import numpy as np

AXIS = (-68.0415, -23.3929)  # FLOWER 9 축(필드 in)
IN = 0.0254
WALL_U = (-70.585 - AXIS[0])  # 벽 안쪽 면(u, in)
SIMPLIFY_IN = 0.04  # 볼록 다각형 줄이기 공차(in): 둥근 모서리를 1 mm 안에서 줄인다

V = json.load(open(sys.argv[1]))


def mesh(i):
    P = np.array(V[str(i)]['pos']).reshape(-1, 3)
    F = np.array(V[str(i)]['idx']).reshape(-1, 3)
    P = P - [AXIS[0], AXIS[1], 0.0]
    return P, F


def hull(P):
    P = sorted(set(map(tuple, np.round(P, 5))))
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, up = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return [np.array(p) for p in lo[:-1] + up[:-1]]


def simplify(H, tol):
    # Visvalingam: 이웃과 만드는 삼각형 넓이가 가장 작은 꼭짓점부터 빼되, 그 꼭짓점이 새 변에서 tol 넘게 떨어지면 멈춘다
    # (둥근 모서리의 점은 빠지고 긴 면의 끝은 남는다)
    out = list(H)
    while len(out) > 3:
        best, k_best, d_best = None, -1, 0.0
        for k in range(len(out)):
            a, b, c = out[k-1], out[k], out[(k+1) % len(out)]
            ab = c - a; L = np.linalg.norm(ab)
            area = abs(ab[0] * (b - a)[1] - ab[1] * (b - a)[0])
            if best is None or area < best:
                best, k_best, d_best = area, k, area / L
        if d_best > tol:
            break
        out.pop(k_best)
    return out


def symmetric(P2):
    M = P2.copy(); M[:, 1] *= -1
    return np.vstack([P2, M])


def symmetrize(H):
    # 줄인 다각형을 v에 정확히 대칭으로: v ≥ 0 쪽 점(v = 0 점은 그대로)과 그 거울. 반시계, (u 최소, v 음수)에서 시작
    upper = [p for p in H if p[1] > 1e-9]
    axis = [p for p in H if abs(p[1]) <= 1e-9]
    pts = upper + [np.array([p[0], -p[1]]) for p in upper] + axis
    ang = [math.atan2(p[1], p[0] + 0.3) for p in pts]
    return [p for _, p in sorted(zip(ang, pts), key=lambda t: t[0])]


def clip_u(H, u0):
    # u ≥ u0 쪽만 남긴다(Sutherland–Hodgman 한 변)
    out = []
    n = len(H)
    for k in range(n):
        a, b = H[k], H[(k+1) % n]
        ina, inb = a[0] >= u0, b[0] >= u0
        if ina: out.append(a)
        if ina != inb:
            t = (u0 - a[0]) / (b[0] - a[0])
            out.append(a + t * (b - a))
    return out


def fmt(H):
    return ' '.join('(%.6f, %.6f)' % (p[0] * IN, p[1] * IN) for p in H)


def slice_segments(P, F, w):
    d = P[:, 2] - w
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
                seg.append((P[tri[a]] + t * (P[tri[b]] - P[tri[a]]))[:2])
        if len(seg) == 2:
            segs.append(seg)
    return np.array(segs)


def ray_near(S, ang):
    # 축에서 각 ang(°) 광선의 가장 가까운 교점 거리
    dv = np.array([math.cos(math.radians(ang)), math.sin(math.radians(ang))])
    P = S[:, 0]; E = S[:, 1] - S[:, 0]
    det = dv[0] * (-E[:, 1]) - dv[1] * (-E[:, 0])
    ok = np.abs(det) > 1e-12
    sd = np.where(ok, det, 1)
    t = np.where(ok, (P[:, 0] * (-E[:, 1]) - P[:, 1] * (-E[:, 0])) / sd, -1)
    u = np.where(ok, (dv[0] * P[:, 1] - dv[1] * P[:, 0]) / sd, -1)
    hit = ok & (t > 0) & (u >= 0) & (u <= 1)
    return t[hit].min() if hit.any() else None


print('# FLOWER 9 자기 틀(m). 벽 안쪽 면 u = %.6f' % (WALL_U * IN))

# 고리 바깥 윤곽(v 대칭 볼록 껍질, 줄임). 아래 고리는 타일 위(w ≥ 0) 꼭짓점만
for name, i, wmin in (('bottomRing #810', 810, 0.0), ('middleRing #814', 814, -1e9), ('topRing #819', 819, -1e9)):
    P, F = mesh(i)
    sel = P[:, 2] >= wmin
    H = hull(symmetric(P[sel][:, :2]))
    S = symmetrize(simplify(H, SIMPLIFY_IN))
    if i == 814:
        S = clip_u(S, WALL_U)
    print('%s w [%.6f, %.6f] outer %d: %s' % (name, max(P[:, 2].min(), wmin) * IN, P[:, 2].max() * IN, len(S), fmt(S)))

# 가운데 고리 판 윗면(판 + 턱이 끝나는 높이)과 구멍
P, F = mesh(814)
lo, hi = 4.2, 4.3
for _ in range(30):
    mid = (lo + hi) / 2
    S = slice_segments(P, F, mid)
    if len(S) and ray_near(S, 90) is not None: lo = mid
    else: hi = mid
print('middleRing plate top w %.6f (in %.4f)' % (lo * IN, lo))
for w in (4.0, 4.1, 4.2):
    S = slice_segments(P, F, w)
    r = [ray_near(S, a) for a in range(-90, 91, 15) if not (abs(a) <= 15)]
    r = [v for v in r if v is not None]
    print('middleRing hole w %.3f in: r min %.4f max %.4f in' % (w, min(r), max(r)))

# NECTAR 턱: 45° 모따기 아래 안쪽 모서리(w 4.105 in, r 1.69 in). 가운데 NECTAR가 실제와 같은 높이에 쉬는 수직 면 반지름 r_eq
NECTAR_R = 0.0457
w_edge, r_edge = 0.104267, 0.042926  # 부록 A.2
w_top = 0.10795
zc = w_edge + math.sqrt(NECTAR_R ** 2 - r_edge ** 2)
r_eq = math.sqrt(NECTAR_R ** 2 - (zc - w_top) ** 2)
print('lip: NECTAR rest centre %.6f, equivalent vertical face r_eq %.6f' % (zc, r_eq))
S = slice_segments(P, F, 4.11)
r_eq_in = r_eq / IN
for lo_a, hi_a in ((-20, 20), (120, 170)):
    angs = [a / 10 for a in range(lo_a * 10, hi_a * 10 + 1)]
    inside = [a for a in angs if (ray_near(S, a) or 9) < r_eq_in]
    print('lip angles where near r < r_eq at w 4.11 in: [%.1f, %.1f]' % (min(inside), max(inside)))

# 위 고리 여는 곳
P, F = mesh(819)
for w in (20.5, 21.2, 21.38):
    S = slice_segments(P, F, w)
    r = [ray_near(S, a) for a in range(0, 360, 15)]
    r = [v for v in r if v is not None]
    print('topRing opening w %.2f in: r min %.4f max %.4f in' % (w, min(r), max(r)))

# 압출재(peanut) 둘, Field Wall Bracket: 평면 볼록 껍질
for name, ids in (('upright A #796', [796]), ('upright B #797', [797])):
    P, F = mesh(ids[0])
    H = simplify(hull(P[:, :2]), SIMPLIFY_IN)
    print('%s w [%.6f, %.6f] hull %d: %s' % (name, P[:, 2].min() * IN, P[:, 2].max() * IN, len(H), fmt(H)))
P, F = mesh(798)
H = symmetrize(simplify(hull(symmetric(P[:, :2])), SIMPLIFY_IN))
print('bracket #798 w [%.6f, %.6f] hull %d: %s' % (P[:, 2].min() * IN, P[:, 2].max() * IN, len(H), fmt(H)))
S = slice_segments(P, F, (P[:, 2].min() + P[:, 2].max()) / 2)
r = [ray_near(S, a) for a in range(130, 231, 5)]
print('bracket inner edge r (130..230°, in): %s' % ' '.join('%.3f' % v if v else '-' for v in r))

# 백스톱(#801): 휜 막대(두께 w 0.25 in). 뒤 막대 안·바깥 면은 180° 광선, ±45° 막대 안·바깥 면은 ±135° 광선의 가까운·먼 교점
# (막대 법선 방향이라 법선 거리), 끝은 v ≥ 2 in 쪽 껍질의 둥근 끝
def ray_far(S, ang):
    dv = np.array([math.cos(math.radians(ang)), math.sin(math.radians(ang))])
    Pp = S[:, 0]; E = S[:, 1] - S[:, 0]
    det = dv[0] * (-E[:, 1]) - dv[1] * (-E[:, 0])
    ok = np.abs(det) > 1e-12
    sd = np.where(ok, det, 1)
    t = np.where(ok, (Pp[:, 0] * (-E[:, 1]) - Pp[:, 1] * (-E[:, 0])) / sd, -1)
    u = np.where(ok, (dv[0] * Pp[:, 1] - dv[1] * Pp[:, 0]) / sd, -1)
    hit = ok & (t > 0) & (u >= 0) & (u <= 1)
    return t[hit].max()


P, F = mesh(801)
wm = (P[:, 2].min() + P[:, 2].max()) / 2
print('backstop #801 w [%.6f, %.6f]' % (P[:, 2].min() * IN, P[:, 2].max() * IN))
S = slice_segments(P, F, wm)
print('  back bar faces u %.6f / %.6f' % (-ray_near(S, 180) * IN, -ray_far(S, 180) * IN))
print('  diagonal bar normal distance %.6f / %.6f' % (ray_near(S, 135) * IN, ray_far(S, 135) * IN))
Q = P[:, :2]
H = simplify(hull(Q[Q[:, 1] > 2.0]), SIMPLIFY_IN)
print('  +v end (v > 2 in) hull %d: %s' % (len(H), fmt(H)))
for i in (788, 789):
    P, F = mesh(i)
    c = (P.min(0) + P.max(0)) / 2
    print('spacer #%d centre (%.6f, %.6f) r %.6f w [%.6f, %.6f]' % (i, c[0] * IN, c[1] * IN, (P[:, 0].max() - P[:, 0].min()) / 2 * IN, P[:, 2].min() * IN, P[:, 2].max() * IN))

# NECTAR 턱 조각 다각형(m, 반시계): 안쪽 현은 턱 가운데 각에서 r_eq 원에 닿고(가운데 NECTAR가 현의 가운데 점에 쉰다), 바깥 점은
# 고리 구멍(r 0.0489, 현 0.04796)보다 바깥(겹침). 각 범위는 위에서 잰 것을 v 대칭으로
LIP_OUTER = {'front': 0.0505, 'side': 0.0515}
for name, a0, a1 in (('front', -10.95, 10.95), ('side', 131.3, 158.4)):
    half = (a1 - a0) / 2
    ri = r_eq / math.cos(math.radians(half))
    ro = LIP_OUTER[name]
    pts = [(ri, a0), (ro, a0), (ro, a1), (ri, a1)]
    print('lip %s [%.2f, %.2f] deg: %s' % (name, a0, a1, ' '.join(
        '(%.6f, %.6f)' % (r * math.cos(math.radians(a)), r * math.sin(math.radians(a))) for r, a in pts)))
