# 사용: python3 -I damper.py <meshes-verts.json>
import sys, json, math
import numpy as np
V = json.load(open(sys.argv[1]))
def pts(i): return np.array(V[str(i)]['pos']).reshape(-1, 3)
PIV = np.array([0.0, -12.742, 43.95])
c, s = math.cos(math.pi / 6), math.sin(math.pi / 6)
def body(P):
    d = P - PIV
    return np.stack([d[:, 0] * c + d[:, 2] * s, d[:, 1], -d[:, 0] * s + d[:, 2] * c], 1)
corner = pts(354); axle = pts(339)
for i in (886, 890, 887, 893):
    P = pts(i)
    B = body(P)
    m = B.mean(0); U, S, Vt = np.linalg.svd(B - m)
    ax = Vt[0]
    proj = (B - m) @ ax
    tip1 = m + ax * proj.max(); tip2 = m + ax * proj.min()
    # 메시 최단 거리(꼭짓점 기준, 근사)
    from itertools import islice
    dmin = 1e9
    for Q in (corner, axle):
        D = np.linalg.norm(P[:, None, :] - Q[None, ::7, :], axis=2).min()
        dmin = min(dmin, D)
    print(i, 'axis(body)', np.round(ax, 4), 'len %.3f' % (proj.max() - proj.min()), 'ends(body)', np.round(tip1, 3), np.round(tip2, 3), 'min dist to frame corner/axle holder %.3f in' % dmin)
    # 축 방향의 각(몸체 x에서 z로)
    print('   axis angle from body +x toward +z: %.2f deg' % math.degrees(math.atan2(ax[2], ax[0])))
# 틀 모서리 몸체 좌표 경계(시작 자세 기준)
Bc = body(corner)
print('top corner in start-pose body frame', np.round(Bc.min(0), 3), np.round(Bc.max(0), 3))
