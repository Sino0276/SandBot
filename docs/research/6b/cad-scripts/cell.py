# 사용: python3 -I cell.py <redhive_body.npz>
# CELL 트레이의 바깥 윤곽(Back Skin #863, 입구 리브 #873, 뒤 리브 #833)을 몸체 틀(hivebody.py 출력, in) 단면에서 직선으로 맞춰
# 날카로운 모서리 오각형으로 찍는다(6b 시즌 데이터 biobuzz.ts CELL 부품). 둥근 모서리는 직선 부분만 맞춘다(옆면 z 0.5–5 in,
# 지붕 |y| 2–8 in, 밑면 |y| 1.5–8 in).
import sys
import numpy as np

IN = 0.0254
npz = np.load(sys.argv[1])


def slice_x(i, x):
    V = npz['v%d' % i]; F = npz['f%d' % i]
    d = V[:, 0] - x
    pts = []
    for tri in F:
        dd = d[tri]
        if (dd > 0).all() or (dd < 0).all():
            continue
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if (dd[a] > 0) != (dd[b] > 0):
                t = dd[a] / (dd[a] - dd[b])
                pts.append((V[tri[a]] + t * (V[tri[b]] - V[tri[a]]))[1:3])
    return np.array(pts)


def outer(i, x):
    P = slice_x(i, x)
    y, z = P[:, 0], P[:, 1]
    side = P[(z > 0.5) & (z < 5)]
    half = np.abs(side[:, 0]).max()
    bottom = P[(np.abs(y) > 1.5) & (np.abs(y) < 8)]
    zb = bottom[:, 1].min()
    roof = P[(np.abs(y) > 2) & (np.abs(y) < 9) & (z > 3)]
    # 바깥 지붕: |y| 0.5 in 칸마다 가장 높은 점에 z = a − s|y| 맞춤(리브는 안쪽 윤곽 점도 있어 칸의 최댓값만)
    ay = np.abs(roof[:, 0]); bins = np.floor(ay * 2) / 2
    top = np.array([roof[bins == b][np.argmax(roof[bins == b][:, 1])] for b in np.unique(bins)])
    top[:, 0] = np.abs(top[:, 0])
    s, a = np.polyfit(top[:, 0], top[:, 1], 1)
    corner = a + s * half
    print('mesh %d x %.3f in: |y| <= %.6f, bottom z %.6f, roof z = %.6f %+.5f|y| (slope %.2f deg), wall/roof corner z %.6f (m)'
          % (i, x, half * IN, zb * IN, a * IN, s, np.degrees(np.arctan(-s)), corner * IN))
    return half, zb, a, s


outer(863, 9.428)
outer(873, 21.2)
outer(833, 9.9)
outer(873, 20.6)
