# 사용: python3 -I hivebody.py <meshes.json> <meshes-verts.json> <출력 npz 폴더>
# 빨강 HIVE 메시를 몸체 틀(in)로 옮겨 경계 상자를 찍고 꼭짓점을 npz로 저장
import sys, json, math
import numpy as np
mj, vj, outdir = sys.argv[1:4]
meta = json.load(open(mj))
verts = json.load(open(vj))
PIV = np.array([0.0, -12.742, 43.95])
th = -math.pi / 6  # 빨강 시작 각
c, s = math.cos(-th), math.sin(-th)
def to_body(P):
    d = P - PIV
    xb = d[:, 0] * c + d[:, 2] * s
    zb = -d[:, 0] * s + d[:, 2] * c
    return np.stack([xb, d[:, 1], zb], 1)
store = {}
for e in meta:
    p = e['path'] or []
    if not any('Red Hive' in q for q in p):
        continue
    v = verts.get(str(e['i']))
    if v is None:
        continue
    P = np.array(v['pos']).reshape(-1, 3)
    B = to_body(P)
    mn, mx = B.min(0), B.max(0)
    print(e['i'], e['name'][:44].ljust(44), 'x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]' % (mn[0], mx[0], mn[1], mx[1], mn[2], mx[2]))
    store['v%d' % e['i']] = B
    store['f%d' % e['i']] = np.array(v['idx']).reshape(-1, 3)
np.savez(outdir + '/redhive_body.npz', **store)
