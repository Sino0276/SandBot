# PnP 기준값 고정물(sidecar/tests/fixtures/vision/pnp-reference.json)을 다시 만든다(spec-4d §4 B, 사용처 정답표 usage-oracle과
# 같은 방식: 개발자가 손으로 돌리고 CI는 쓰지 않는다. 시험은 cv2 없이 고정물만 읽는다).
#
# 실행: OpenCV 4.10.0 파이썬 바퀴(opencv-python-headless==4.10.0.84)와 numpy를 넣은 격리 venv에서
#   <venv>/bin/python -I scripts/vision-pnp-oracle.py
# 입력은 SDK AprilTagProcessorImpl과 같은 꼴이다: 물체 점 MatOfPoint3f, 영상 점 MatOfPoint2f(float32), 카메라 행렬 CV_32F, 빈 왜곡,
# rvec·tvec CV_32F(결과를 float로), useExtrinsicGuess false. 묶음 물체 점은 SDK getBioBuzzTagLibrary 멤버 위치(in, offY 7.1874f,
# offZ −5.622f, AprilTagGameDatabase.java:198–216), 단일 태그는 (±s/2, ±s/2, 0)(poseFromTrapezoid). 태그 필드 자세는 4ab 참값
# src/shared/sim/seasons/__fixtures__/biobuzz-tags.json(공식 CAD에서 계산)이다. 영상 점은 apriltag 3 좌표(참 투영 + 0.5, spec-4d §0)가
# 기본이고 A3 대조용으로 OpenCV 좌표 경우를 둔다.
import datetime
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'sidecar', 'tests', 'fixtures', 'vision', 'pnp-reference.json')
TAGS = os.path.join(ROOT, 'src', 'shared', 'sim', 'seasons', '__fixtures__', 'biobuzz-tags.json')
INCH = 0.0254
TAG_SIZE_IN = 3.25  # SDK BioBuzz 태그 변(in), AprilTagGameDatabase
MEMBER_X = [-6.5, -2.75, 2.75, 6.5]  # 첫 id부터
OFF_Y = float(np.float32(7.1874))
OFF_Z = float(np.float32(-5.622))
CLUSTERS = {'RED SCORING': 30, 'RED AUDIENCE': 34, 'BLUE AUDIENCE': 38, 'BLUE SCORING': 42}
FLAGS = {'ITERATIVE': cv2.SOLVEPNP_ITERATIVE, 'EPNP': cv2.SOLVEPNP_EPNP, 'IPPE': cv2.SOLVEPNP_IPPE,
         'IPPE_SQUARE': cv2.SOLVEPNP_IPPE_SQUARE, 'SQPNP': cv2.SOLVEPNP_SQPNP, 'BUILTIN': -1}
R_CV_S = np.array([[0, -1, 0], [0, 0, -1], [1, 0, 0]], float)  # 센서 틀(+X 광축, +Z 위) → OpenCV 카메라 틀
# 렌즈 값(SDK 내장 보정, float): C920 640×480, C920 1280×720(1920×1080에서 scaled), goBILDA 640×480, 대체 578.272
K_C920 = (622.000977, 622.000977, 319.803009, 241.251007, 640, 480)
K_C920_720 = (923.946716, 923.946716, 634.654663, 356.056000, 1280, 720)
K_GOBILDA = (481.984985, 481.984985, 334.203003, 241.947998, 640, 480)
K_FALLBACK = (578.272, 578.272, 320, 240, 640, 480)


def f32(a):
    return np.asarray(a, np.float32).astype(float)


def quat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                     [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                     [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])


def zyx(r):
    cx, sx, cy, sy, cz, sz = math.cos(r[0]), math.sin(r[0]), math.cos(r[1]), math.sin(r[1]), math.cos(r[2]), math.sin(r[2])
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


tags = {}
for t in json.load(open(TAGS)):
    if isinstance(t['id'], int):
        tags[(t['id'], t['state'])] = (np.array(t['pos_in']) * INCH, quat(t['q_wxyz']))


def camera(origin, yaw, pitch, roll=0.0):
    return np.array(origin, float), zyx([roll, -pitch, yaw])


def aim(origin, target):
    d = np.array(target) - np.array(origin)
    return math.atan2(d[1], d[0]), math.atan2(d[2], math.hypot(d[0], d[1]))


def corners(s):
    h = s / 2
    return [np.array(p, float) for p in [(-h, h, 0), (h, h, 0), (h, -h, 0), (-h, -h, 0)]]


def project(K, cam_o, cam_R, P):
    Pc = R_CV_S @ cam_R.T @ (P - cam_o)
    return np.array([K[0] * Pc[0] / Pc[2] + K[2], K[1] * Pc[1] / Pc[2] + K[3]]), Pc[2]


def cluster_scene(first, state, cam_o, cam_R, K, members=None, shift=0.5):
    """묶음(첫 id first)의 영상 점·SDK 물체 점·참값(묶음 틀 → 카메라, in). members: 보이는 멤버 순번"""
    members = members if members is not None else [0, 1, 2, 3]
    img, obj, depth = [], [], []
    for k in members:
        c, R = tags[(first + k, state)]
        for j, p in enumerate(corners(TAG_SIZE_IN * INCH)):
            uv, z = project(K, cam_o, cam_R, c + R @ p)
            img.append(uv + shift)
            depth.append(z)
            q = corners(TAG_SIZE_IN)[j]
            obj.append([q[0] + MEMBER_X[k], q[1] + OFF_Y, OFF_Z])
    c0, R0 = tags[(first, state)]
    O = c0 - R0 @ (np.array([MEMBER_X[0], OFF_Y, OFF_Z]) * INCH)
    t = R_CV_S @ cam_R.T @ (O - cam_o) / INCH
    Rc = R_CV_S @ cam_R.T @ R0
    return np.array(img), np.array(obj), t, Rc, min(depth)


def single_scene(tid, state, cam_o, cam_R, K, shift=0.5):
    c, R = tags[(tid, state)]
    img = [project(K, cam_o, cam_R, c + R @ p)[0] + shift for p in corners(TAG_SIZE_IN * INCH)]
    obj = [list(p) for p in corners(TAG_SIZE_IN)]
    t = R_CV_S @ cam_R.T @ (c - cam_o) / INCH
    return np.array(img), np.array(obj), t, R_CV_S @ cam_R.T @ R


def in_frame(img, K):
    return bool(((img[:, 0] > 0) & (img[:, 0] < K[4] - 1) & (img[:, 1] > 0) & (img[:, 1] < K[5] - 1)).all())


def solve(obj, img, K, flag):
    Km = np.array([[K[0], 0, K[2]], [0, K[1], K[3]], [0, 0, 1]], np.float32)
    rvec = np.zeros((3, 1), np.float32)
    tvec = np.zeros((3, 1), np.float32)
    ok, rvec, tvec = cv2.solvePnP(np.asarray(obj, np.float32), np.asarray(img, np.float32), Km, np.zeros((0, 1)),
                                  rvec, tvec, False, flag)
    R, _ = cv2.Rodrigues(rvec.astype(np.float32))
    return bool(ok), nan_null(rvec), nan_null(tvec), nan_null(R.astype(np.float32))


def nan_null(a):
    # IPPE + BioBuzz 묶음은 실제 OpenCV에서 rot2vec의 acos가 정의역 밖이라 rvec가 NaN일 수 있다(JSON에는 NaN이 없어 null로)
    return [None if math.isnan(v) else v for v in np.asarray(a, np.float32).astype(float).ravel().tolist()]


cases = []


def add(name, solver, obj, img, K, truth=None, kind=None, note=None):
    obj = f32(obj)
    img = f32(img)
    case = {'name': name, 'solver': solver, 'flags': FLAGS[solver], 'camera': f32(K[:4]).tolist(),
            'object': obj.ravel().tolist(), 'image': img.ravel().tolist()}
    if truth is not None:
        case['truth'] = {'t': [float(v) for v in truth[0]], 'R': [float(v) for v in np.ravel(truth[1])]}
    if note:
        case['note'] = note
    try:
        ok, r, t, R = solve(obj, img, K, FLAGS[solver])
        if not ok:
            case['kind'] = 'noSolution'
        else:
            case['kind'] = kind or 'match'
            case['rvec'], case['tvec'], case['R'] = r, t, R
            if truth is not None:
                tv = np.array([np.nan if v is None else v for v in t])
                case['relError'] = float(np.max(np.abs(tv - truth[0])) / np.linalg.norm(truth[0]))
    except cv2.error as e:
        case['kind'] = 'error'
        case['error'] = str(e)
    cases.append(case)
    return case


def cluster_center(first, state):
    return np.mean([tags[(first + k, state)][0] for k in range(4)], axis=0)


# 1. 장면: 두 얼라이언스·네 묶음·두 HIVE 상태, 묶음 중심을 겨눈 카메라(가깝고·멀고·스치는 각)
rng = np.random.default_rng(20261109)
scene_count = 0
for state in ['start', 'tipped']:
    for name, first in CLUSTERS.items():
        cen = cluster_center(first, state)
        normal = tags[(first, state)][1] @ np.array([0, 0, -1.0])  # 앞면 법선(태그 −z)
        made = 0
        for dist, side, label in [(0.9, 0.0, 'near'), (1.6, 0.15, 'far'), (1.1, 0.6, 'grazing')]:
            for _ in range(200):
                d = normal + side * np.cross(normal, [0, 0, 1]) + rng.normal(0, 0.05, 3)
                o = cen + d / np.linalg.norm(d) * dist
                if not (0.1 < o[2] < 0.6 and abs(o[0]) < 1.7 and abs(o[1]) < 1.7):
                    o[2] = min(max(o[2], 0.15), 0.55)
                yaw, pitch = aim(o, cen)
                cam_o, cam_R = camera(o, yaw + rng.uniform(-0.05, 0.05), pitch + rng.uniform(-0.05, 0.05),
                                      rng.uniform(-0.2, 0.2))
                img, obj, t, Rc, zmin = cluster_scene(first, state, cam_o, cam_R, K_C920)
                if zmin > 0.1 and in_frame(img, K_C920):
                    break
            else:
                continue
            tag = f'{state} {name} {label}'
            for solver in ['ITERATIVE', 'IPPE', 'EPNP']:
                add(f'{tag} cluster {solver}', solver, obj, img, K_C920, (t, Rc),
                    kind='ippeWrong' if solver == 'IPPE' else None)
            # 단일 태그(첫 멤버의 다음 id) z = 0
            simg, sobj, st, sR = single_scene(first + 1, state, cam_o, cam_R, K_C920)
            for solver in ['ITERATIVE', 'IPPE', 'IPPE_SQUARE']:
                add(f'{tag} single {first + 1} {solver}', solver, sobj, simg, K_C920, (st, sR))
            made += 1
            scene_count += 1

# 2. 부록 B 장면(빨강 관중석, C920 640×480, 카메라 (1.05, −0.30, 0.30)이 묶음 중심을 겨눔): OpenCV 좌표·apriltag 3 좌표 두 벌
cen = cluster_center(34, 'start')
o = np.array([1.05, -0.30, 0.30])
yaw, pitch = aim(o, cen)
cam_o, cam_R = camera(o, yaw, pitch)
for shift, coord in [(0.0, 'opencv'), (0.5, 'apriltag')]:
    img, obj, t, Rc, _ = cluster_scene(34, 'start', cam_o, cam_R, K_C920, shift=shift)
    for solver in ['ITERATIVE', 'IPPE', 'EPNP', 'SQPNP', 'IPPE_SQUARE', 'BUILTIN']:
        add(f'appendixB {coord} cluster {solver}', solver, obj, img, K_C920, (t, Rc),
            kind='ippeWrong' if solver == 'IPPE' else None)
    one = [4, 5, 6, 7]
    add(f'appendixB {coord} member35 IPPE_SQUARE', 'IPPE_SQUARE', obj[one], img[one], K_C920, (t, Rc),
        kind='ippeWrong', note='solveSquare: 원점 중심 정사각형 H와 오프셋 점을 섞은 틀린 값')
    add(f'appendixB {coord} member35 ITERATIVE', 'ITERATIVE', obj[one], img[one], K_C920, (t, Rc))
    simg, sobj, st, sR = single_scene(35, 'start', cam_o, cam_R, K_C920, shift=shift)
    for solver in ['ITERATIVE', 'IPPE', 'IPPE_SQUARE', 'EPNP']:
        add(f'appendixB {coord} single35 {solver}', solver, sobj, simg, K_C920, (st, sR))
img, obj, t, Rc, _ = cluster_scene(34, 'start', cam_o, cam_R, K_C920)
# 대체 렌즈 값(SDK 보정 없음: 578.272, w/2, h/2)
for solver in ['ITERATIVE', 'IPPE']:
    add(f'appendixB fallback578 cluster {solver}', solver, obj, img, K_FALLBACK, None,
        kind='ippeWrong' if solver == 'IPPE' else None)
# 잡음 σ 0.3 px(numpy 시드 7)
noisy = img + np.random.default_rng(7).normal(0, 0.3, img.shape)
for solver in ['ITERATIVE', 'IPPE', 'EPNP']:
    add(f'appendixB noisy cluster {solver}', solver, obj, noisy, K_C920, (t, Rc),
        kind='ippeWrong' if solver == 'IPPE' else None)
simg, sobj, st, sR = single_scene(35, 'start', cam_o, cam_R, K_C920)
snoisy = simg + np.random.default_rng(7).normal(0, 0.3, simg.shape)
for solver in ['ITERATIVE', 'IPPE', 'IPPE_SQUARE']:
    add(f'appendixB noisy single35 {solver}', solver, sobj, snoisy, K_C920, (st, sR))

# 3. IPPE 반사 확인: 감김 뒤집기(각 태그 0,3,2,1)·첫 두 점 바꾸기면 참값, 단위 METER·MM, 법선 +z 팀 묶음, 비평면 팀 묶음
rev = [i * 4 + j for i in range(4) for j in (0, 3, 2, 1)]
add('ippe winding reversed', 'IPPE', obj[rev], img[rev], K_C920, (t, Rc))
sw = [1, 0] + list(range(2, 16))
add('ippe first two swapped', 'IPPE', obj[sw], img[sw], K_C920, (t, Rc))
add('ippe cluster METER', 'IPPE', obj * INCH, img, K_C920, (t * INCH, Rc), kind='ippeWrong')
add('ippe cluster MM', 'IPPE', obj * 25.4, img, K_C920, (t * 25.4, Rc), kind='ippeWrong')
nonplanar = obj.copy()
nonplanar[8:12, 2] += 2.0  # 셋째 태그를 묶음 면에서 2 in 띄운 팀 라이브러리(같은 영상 점이라 해가 없어야 한다)
add('ippe nonplanar team cluster', 'IPPE', nonplanar, img, K_C920, None)

# 4. 해상도·모델: C920 1280×720(scaled), goBILDA 640×480
for K, label in [(K_C920_720, 'c920-1280x720'), (K_GOBILDA, 'gobilda-640x480')]:
    img2, obj2, t2, R2, _ = cluster_scene(34, 'start', cam_o, cam_R, K)
    for solver in ['ITERATIVE', 'IPPE', 'EPNP']:
        add(f'{label} cluster {solver}', solver, obj2, img2, K, (t2, R2),
            kind='ippeWrong' if solver == 'IPPE' else None)
    simg2, sobj2, st2, sR2 = single_scene(35, 'start', cam_o, cam_R, K)
    add(f'{label} single35 ITERATIVE', 'ITERATIVE', sobj2, simg2, K, (st2, sR2))

# 5. EPNP: 잘 조건된 것(참값 대비 상대 오차 < 1e-4)과 1 % 넘게 틀린 것을 단일·묶음 각각 5개 이상(crit4d-sdk epnp_bad.py와 같은 꼴)
want = {('single', 'good'): 6, ('single', 'bad'): 6, ('cluster', 'good'): 6, ('cluster', 'bad'): 6}
got = {k: 0 for k in want}
rng = np.random.default_rng(3)
cen = cluster_center(34, 'start')
for trial in range(4000):
    if all(got[k] >= want[k] for k in want):
        break
    o = np.array([rng.uniform(0.3, 1.6), rng.uniform(-1.2, 0.6), rng.uniform(0.1, 0.45)])
    yaw, pitch = aim(o, cen)
    c_o, c_R = camera(o, yaw + rng.uniform(-0.2, 0.2), pitch + rng.uniform(-0.15, 0.15), rng.uniform(-0.3, 0.3))
    img3, obj3, t3, R3, zmin = cluster_scene(34, 'start', c_o, c_R, K_C920, shift=0.0)
    if zmin < 0.1 or not in_frame(img3, K_C920):
        continue
    simg3, sobj3, st3, sR3 = single_scene(35, 'start', c_o, c_R, K_C920, shift=0.0)
    q = simg3
    side = min(np.linalg.norm(q[i] - q[(i + 1) % 4]) for i in range(4))
    if side < 15:
        continue
    for what, (o_, i_, tt, RR) in [('single', (sobj3, simg3, st3, sR3)), ('cluster', (obj3, img3, t3, R3))]:
        ok, _, tv, _ = solve(f32(o_), f32(i_), K_C920, cv2.SOLVEPNP_EPNP)
        e = float(np.max(np.abs(np.array(tv) - tt)) / np.linalg.norm(tt))
        grade = 'good' if e < 1e-4 else 'bad' if e > 3e-2 else None
        if grade and got[(what, grade)] < want[(what, grade)]:
            got[(what, grade)] += 1
            add(f'epnp {what} {grade} {got[(what, grade)]}', 'EPNP', o_, i_, K_C920, (tt, RR),
                kind='epnpBad' if grade == 'bad' else 'match')
if any(got[k] < want[k] for k in want):
    sys.exit(f'not enough EPNP cases: {got}')

header = {
    'generator': 'scripts/vision-pnp-oracle.py',
    'opencv': cv2.__version__,
    'package': 'opencv-python-headless 4.10.0.84',
    'numpy': np.__version__,
    'date': datetime.date.today().isoformat(),
    'scenes': scene_count,
    'note': 'kind: match(이동 1e-4 in·R 원소 1e-5로 같아야 함), ippeWrong(OpenCV가 낸 틀린 값과 같아야 함), '
            'epnpBad(참값 대비 1 % 넘게 틀려야 함), error(같은 예외 문구), noSolution(해 0개). rvec·R의 null은 '
            'NaN(IPPE 묶음에서 rot2vec의 acos가 정의역 밖)',
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump({'header': header, 'cases': cases}, f, indent=1, ensure_ascii=False, allow_nan=False)
    f.write('\n')
# 저장소의 Prettier 꼴로(prettier --check가 이 파일도 본다)
if subprocess.run(['npx', 'prettier', '--write', OUT], cwd=ROOT).returncode != 0:
    print(f'warning: run npx prettier --write {OUT}')
kinds = {}
for c in cases:
    kinds[c['kind']] = kinds.get(c['kind'], 0) + 1
print(f'{len(cases)} cases, {scene_count} scenes: {kinds}')
for c in cases:
    if 'relError' in c and c['kind'] == 'match' and c['relError'] > 1e-3:
        print('warning: match case far from truth', c['name'], c['relError'])
