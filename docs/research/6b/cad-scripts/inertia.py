# 사용: python3 -I inertia.py
# HIVE 축 둘레 관성 추정(spec-6b 부록 A.3). 부품 질량(AndyMark 배송 무게 [가정])을 부록 A.1의 CELL 트레이 형상(biobuzz.ts의
# 부품과 같은 수)에 고르게 나눠 ∫(x_b² + z_b²) dm를 적분한다. 몸체 틀(빨강 HIVE, m): x_b 팔, y_b 축, z_b CELL 법선.
# 무게중심 높이 z_com과 M·z_com(질량 모멘트)도 찍는다(비교용: 시뮬레이터는 보정표에 맞춘 massMoment를 쓴다).
# 입력은 이 파일의 상수뿐이다(측정 파일을 읽지 않는다).

# ---- CELL 형상(+X CELL, m) ----
X_BACK = 0.239725   # Back Skin 공 쪽 면
X_MOUTH = 0.544982  # 입구(바깥 리브 바깥 면)
SKIN = 0.000508     # 껍질 두께
Y_IN = 0.256007     # 옆벽 안쪽 면
Z_FLOOR = -0.037287  # 밑판 안쪽 면
Z_JUNCTION = 0.163576
Z_APEX = 0.327137
ROOF_SLOPE = 0.6389
# Back Skin 판(x [0.239217, 0.239725]) 바깥 윤곽
BACK_HALF, BACK_BOTTOM, BACK_APEX = 0.265911, -0.047193, 0.337497
# 리브 바깥 윤곽, 두 리브의 x 구간
RIB_HALF, RIB_BOTTOM, RIB_APEX = 0.2667, -0.047955, 0.33825
RIBS = ((0.52019, 0.544982), (0.239217, 0.26162))
# Cell Base Tube, Churro 받침
TUBE = ((0.119532, 0.544982), (-0.0127, 0.0127), (-0.068885, -0.043485))
CHURRO = ((0.258826, 0.526034), (0.240614, 0.250012), (0.152578, 0.163449))
# 무게추 나사 자리(밑판 아래)
BALLAST = (0.513232, -0.056185)
# 축 조립체 상자
PIVOT = ((-0.175, 0.175), (-0.0191, 0.0191), (-0.0689, 0.0222))

# ---- 질량(kg) [가정: AndyMark 배송 무게, spec-6b 부록 A.3] ----
RIB_MASS = 0.168          # Goal Rib 하나
PETG_DENSITY = 1270.0     # kg/m³
TUBE_MASS = 0.172
CHURRO_MASS = 0.037
FASTENER_MASS = 0.090     # CELL 하나의 나사·리벳·케이블 타이: 두 리브에 반씩 [가정]
BALLAST_MASS = 5 * 0.00272 + 0.0045  # 와셔 5 + 나비 너트
PIVOT_MASS = 0.48


def poly_moments(P):
    # 다각형(반시계, (y, z))의 넓이, ∫z dA, ∫z² dA
    A = Sz = Szz = 0.0
    n = len(P)
    for k in range(n):
        y0, z0 = P[k]; y1, z1 = P[(k + 1) % n]
        c = y0 * z1 - y1 * z0
        A += c / 2
        Sz += (z0 + z1) * c / 6
        Szz += (z0 * z0 + z0 * z1 + z1 * z1) * c / 12
    return A, Sz, Szz


def prism(P, x0, x1, mass=None, density=None):
    # x로 민 다각형: (질량, ∫z dm, ∫(x² + z²) dm)
    A, Sz, Szz = poly_moments(P)
    L = x1 - x0
    m = mass if mass is not None else density * A * L
    mx2 = (x0 * x0 + x0 * x1 + x1 * x1) / 3
    return m, m * Sz / A, m * (mx2 + Szz / A)


def box(xr, yr, zr, mass=None, density=None):
    P = [(yr[0], zr[0]), (yr[1], zr[0]), (yr[1], zr[1]), (yr[0], zr[1])]
    return prism(P, xr[0], xr[1], mass, density)


def total(parts):
    return tuple(sum(p[k] for p in parts) for k in range(3))


inner = [(-Y_IN, Z_FLOOR), (Y_IN, Z_FLOOR), (Y_IN, Z_JUNCTION), (0.0, Z_APEX), (-Y_IN, Z_JUNCTION)]
rib_corner = RIB_APEX - ROOF_SLOPE * RIB_HALF
outer = [(-RIB_HALF, RIB_BOTTOM), (RIB_HALF, RIB_BOTTOM), (RIB_HALF, rib_corner), (0.0, RIB_APEX), (-RIB_HALF, rib_corner)]
back_corner = BACK_APEX - ROOF_SLOPE * BACK_HALF
back_skin = [(-BACK_HALF, BACK_BOTTOM), (BACK_HALF, BACK_BOTTOM), (BACK_HALF, back_corner), (0.0, BACK_APEX), (-BACK_HALF, back_corner)]
# 지붕 껍질 하나(y ≥ 0): 안쪽 선과 SKIN만큼 바깥 선
lift = SKIN * (1 + ROOF_SLOPE ** 2) ** 0.5
roof = [(0.0, Z_APEX), (Y_IN, Z_JUNCTION), (Y_IN + SKIN, Z_APEX + lift - ROOF_SLOPE * (Y_IN + SKIN)), (0.0, Z_APEX + lift)]
roof_mirror = [(-y, z) for (y, z) in reversed(roof)]

cell = []
# 껍질(PETG 밀도 × 형상 부피)
cell.append(box((X_BACK, X_MOUTH), (-Y_IN, Y_IN), (Z_FLOOR - SKIN, Z_FLOOR), density=PETG_DENSITY))
for s in (1, -1):
    cell.append(box((X_BACK, X_MOUTH), tuple(sorted((s * Y_IN, s * (Y_IN + SKIN)))), (Z_FLOOR - SKIN, Z_JUNCTION), density=PETG_DENSITY))
cell.append(prism(roof, X_BACK, X_MOUTH, density=PETG_DENSITY))
cell.append(prism(roof_mirror, X_BACK, X_MOUTH, density=PETG_DENSITY))
cell.append(prism(back_skin, X_BACK - SKIN, X_BACK, density=PETG_DENSITY))
skins = total(cell)
# 리브: 바깥 오각형 − 안쪽 오각형(띠), 리브 질량 + 나사 반
for x0, x1 in RIBS:
    Ao = poly_moments(outer)[0]; Ai = poly_moments(inner)[0]
    m = RIB_MASS + FASTENER_MASS / 2
    o = prism(outer, x0, x1, density=1.0); i = prism(inner, x0, x1, density=1.0)
    k = m / (o[0] - i[0])
    cell.append((m, k * (o[1] - i[1]), k * (o[2] - i[2])))
cell.append(box(*TUBE, mass=TUBE_MASS))
for s in (1, -1):
    yr = tuple(sorted((s * CHURRO[1][0], s * CHURRO[1][1])))
    cell.append(box(CHURRO[0], yr, CHURRO[2], mass=CHURRO_MASS))
cell.append((BALLAST_MASS, BALLAST_MASS * BALLAST[1], BALLAST_MASS * (BALLAST[0] ** 2 + BALLAST[1] ** 2)))
m_cell, mz_cell, I_cell = total(cell)
pivot = box(*PIVOT, mass=PIVOT_MASS)
M = 2 * m_cell + pivot[0]
MZ = 2 * mz_cell + pivot[1]
I = 2 * I_cell + pivot[2]
print('skins %.4f kg (PETG %.0f kg/m3 x %.3f mm)' % (skins[0], PETG_DENSITY, SKIN * 1000))
print('CELL %.4f kg, HIVE %.4f kg' % (m_cell, M))
print('inertia about the pivot axis %.4f kg m^2' % I)
print('COM height z_com %.5f m, M z_com %.5f kg m' % (MZ / M, MZ))
