import type {
  FieldElementPlacement,
  FieldElementType,
  FieldHive,
  FieldMaterial,
  FieldRect,
  FieldSpec,
  FieldStartPreset,
  FieldStructure,
  FieldTag,
  FieldTape,
  FieldZone
} from './fieldSpec'
import { deepFreeze } from './fieldSpec'
import {
  mirrorElementPlacement,
  mirrorHive,
  mirrorKeepOut,
  mirrorPreset,
  mirrorStructure,
  mirrorTag,
  mirrorTape,
  mirrorZone
} from './symmetry'

// 2026-27 FTC BIOBUZZ 필드(spec-4ab §1.4–1.7, synthesis §2·§9.2). 값은 공식 CAD(am-0481 필드, FTC 축으로 옮긴
// `cad/bbox.json`·`sel.json`)와 FAC(필드 검수 치수), 게임 매뉴얼(CM)에서 왔다. CAD 변환은 FTC (X, Y, Z) = (CAD z, x, y)이고
// in × 0.0254다(순환 치환이라 거울상이 아니다).
//
// 축(spec-4ab §1.1): 원점 필드 중앙 타일 윗면, +X 관중석(audience) 벽, +Y 파랑 얼라이언스 벽, Z 위, 반시계 +. ftc-docs 필드
// 좌표계 정의(DECODE와 같은 Inverted 배치)를 BIOBUZZ 배치에 적용한 것이다(CM 9.5 `manual_latest.txt:2265` "red ALLIANCE
// AREA is located on the left from the primary audience viewing direction", FAC 3.5 빨강 GARDEN이 관중석 쪽). ftc-docs에
// BIOBUZZ 그림은 아직 없다.
//
// 대칭 [가정: 파랑 = 빨강의 180° 회전]: 짝마다 앞 순번만 적고 다른 쪽은 symmetry.ts의 정확한 Rz(π)로 만든다. CAD 비대칭
// (≤ 0.016 in)은 버리고 공칭 대칭값을 쓴다. 배열 순서가 계산 순서(행 키 s<순번>·태그 순서)다.

// 레일 안쪽 면의 반폭(m) [확인: CAD am-2556a FTC Rail 안쪽 면 70.585 in]. 가장자리 타일도 여기까지 온다
const INNER_HALF = 1.79286

// ---- 재질 [가정: synthesis §4.6 재질 표, 실측으로 바꿀 것]. 표시 색은 [결정: 계산과 무관한 표시 색] ----

// 회색 타일(CM 9.2 회색 한 가지, 표시 #383838 = CAD 0.22)
export const TILE_GRAY: FieldMaterial = { display: '#383838', rgb: [0.2, 0.2, 0.2], nir: 0.2 }
// 빨강 ProGaff 테이프
const TAPE_RED: FieldMaterial = { display: '#c62828', rgb: [0.45, 0.17, 0.13], nir: 0.6 }
// electric blue ProGaff 테이프
const TAPE_BLUE: FieldMaterial = { display: '#1565c0', rgb: [0.1, 0.28, 0.44], nir: 0.5 }
// 벽 레일(검정 알루미늄)
export const RAIL: FieldMaterial = { display: '#1c1c1c', rgb: [0.04, 0.04, 0.04], nir: 0.3 }
// 벽 투명판(폴리카보네이트, 반투명으로 그림). 반사는 4c의 거울 모델(optics)이 맡아 확산 반사율은 0
export const PANEL: FieldMaterial = {
  display: '#9fb6cc',
  rgb: [0, 0, 0],
  nir: 0,
  optics: 'polycarbonate'
}
const FOOT_BAR: FieldMaterial = { display: '#8c8f94', rgb: [0.4, 0.4, 0.4], nir: 0.4 }
const LEG: FieldMaterial = { display: '#b0b3b8', rgb: [0.5, 0.5, 0.5], nir: 0.5 }
// 로고 판(노랑)
const LOGO_PLATE: FieldMaterial = { display: '#f2c200', rgb: [0.6, 0.6, 0.15], nir: 0.7 }
const FLOWER: FieldMaterial = { display: '#24452c', rgb: [0.08, 0.15, 0.1], nir: 0.3 }
// HIVE CELL(표시만, 반투명) [결정: §4.6 표에 없는 값이다. 4ab는 표시만 쓰고 4c·4d는 쓰지 않는다(sensed·occludes false).
// 4d가 CELL을 가림에 쓰기 전에 다시 정한다]
const HIVE_CELL: FieldMaterial = { display: '#e0b000', rgb: [0.5, 0.5, 0.5], nir: 0.5 }

// ---- 외곽·바닥 [확인: CAD] ----

// 레일 Z 띠(m): 아래 [−0.589, 0.581] in, 위 [10.474, 11.644] in
export const BIOBUZZ_RAIL_BANDS: [number, number][] = [
  [-0.01496, 0.01476],
  [0.26604, 0.29576]
]
// 투명판 안쪽 면이 레일 안쪽 면보다 바깥인 거리(m): 70.674 − 70.585 in(CAD FTC Field Side Glass 11in)
export const BIOBUZZ_PANEL_INSET = 0.00226
// 판 이음(레일 끝)의 벽 방향 구간(m): 23.335–23.460 in, 네 벽 같음. FLOWER가 붙는 자리
export const BIOBUZZ_PANEL_SEAMS: [number, number][] = [
  [-0.59588, -0.59271],
  [0.59271, 0.59588]
]

// ---- 테이프(빨강, FAC 3.2–3.8 + CM 9.3) [가정: 테이프·구역은 FAC 기준, 테이프 폭 1 in] ----

const RED_TAPE: FieldTape[] = [
  // LOADING ZONE U자(A5): 양쪽 1 in 띠는 벽부터 깊이 11 in, 바깥 가장자리가 이음새(−47.004·−23.502 in)에
  {
    key: 'loadingZoneSide',
    alliance: 'red',
    rect: [-1.1939, -INNER_HALF, -1.1685, -1.51346],
    material: TAPE_RED
  },
  {
    key: 'loadingZoneSide',
    alliance: 'red',
    rect: [-0.62235, -INNER_HALF, -0.59695, -1.51346],
    material: TAPE_RED
  },
  // 벽에서 가장 먼 가장자리가 11 in(FAC 3.4)
  {
    key: 'loadingZoneFront',
    alliance: 'red',
    rect: [-1.1685, -1.53886, -0.62235, -1.51346],
    material: TAPE_RED
  },
  // GARDEN(A1): 2 in 한 줄(1 in 둘을 나란히), 바깥 가장자리가 벽
  {
    key: 'garden',
    alliance: 'red',
    rect: [1.74206, -INNER_HALF, INNER_HALF, -1.1939],
    material: TAPE_RED
  },
  // ALLIANCE AREA(필드 밖, Z −0.01496, 표시만): CAD 값 그대로
  {
    key: 'allianceArea',
    alliance: 'red',
    rect: [-1.22961, -3.19151, -1.20421, -1.81991],
    material: TAPE_RED,
    offField: true
  },
  {
    key: 'allianceArea',
    alliance: 'red',
    rect: [1.20421, -3.19151, 1.22961, -1.81991],
    material: TAPE_RED,
    offField: true
  },
  {
    key: 'allianceArea',
    alliance: 'red',
    rect: [-1.20421, -3.19151, 1.20421, -3.16611],
    material: TAPE_RED,
    offField: true
  }
]

// ---- 구역(판정용, FAC) ----

// LOADING ZONE(테이프 포함, CM 9.3): X [−47.004, −23.502] in, 벽에서 11 in
const RED_LOADING_ZONE: FieldZone = {
  key: 'loadingZone',
  alliance: 'red',
  rect: [-1.1939, -INNER_HALF, -0.59695, -1.51346]
}
// GARDEN(바깥 가장자리 기준, CM 9.3): FAC 3.5 X [68.1, 70.1] in의 2 in 띠
const RED_GARDEN: FieldZone = {
  key: 'garden',
  alliance: 'red',
  rect: [1.74206, -INNER_HALF, INNER_HALF, -1.1939]
}

// ---- 구조물(배열 순서 = 계산 순서 = 행 키 s<순번>, synthesis §9.2) ----

// [가정: 구조물 접선 μ 0.4] 3c 벽 마찰 WALL_FRICTION과 같다(실측 없음)
const STRUCTURE_FRICTION = 0.4

function box(
  key: FieldStructure['key'],
  center: [number, number, number],
  size: [number, number, number],
  rotation: [number, number, number],
  material: FieldMaterial,
  flags: { solid: boolean; occludes: boolean; sensed: boolean },
  carrier: FieldStructure['carrier'] = 'field'
): FieldStructure {
  return {
    key,
    shape: {
      kind: 'box',
      center: { x: center[0], y: center[1], z: center[2] },
      rotation: { x: rotation[0], y: rotation[1], z: rotation[2] },
      size: { x: size[0], y: size[1], z: size[2] }
    },
    ...flags,
    material,
    friction: STRUCTURE_FRICTION,
    carrier
  }
}

const SOLID = { solid: true, occludes: true, sensed: true }
const ABOVE = { solid: false, occludes: true, sensed: true }
const DISPLAY = { solid: false, occludes: false, sensed: false }

// 0 발판 막대(−Y): CAD am-5878 + 발 am-5879: X ±19.476 in, Y [−24.733, −22.750] in, Z [0, 2.148] in.
// [가정: 발판 막대는 넘지 못함] 높이로는 어떤 로봇에도 걸린다
const FOOT_BAR_0 = box(
  'footBar',
  [0, -0.60303, 0.02728],
  [0.98938, 0.05037, 0.05456],
  [0, 0, 0],
  FOOT_BAR,
  SOLID
)
// 다리 OBB(CAD 메시 SVD 맞춤, 재구성 오차 3e-16, 자기 Z = 다리 축, 메시가 OBB 밖으로 나간 양 최대 0.19 mm).
// 2 (+X,+Y) 축 방향 (−0.3942, −0.2459, 0.8855), 3 (−X,+Y) 축 (0.3942, −0.2459, 0.8855). +Y 쪽이지만 짝의 앞 순번이라 원본이다
const LEG_SIZE: [number, number, number] = [0.03023, 0.02541, 1.16215]
const LEG_2 = box(
  'leg',
  [0.24216, 0.46404, 0.52853],
  LEG_SIZE,
  [0.43065, 0.2265, -1.46769],
  LEG,
  SOLID
)
const LEG_3 = box(
  'leg',
  [-0.24216, 0.46404, 0.52853],
  LEG_SIZE,
  [-0.43065, 0.2265, -1.6739],
  LEG,
  SOLID
)
// 6 위 막대: CAD X ±0.5, Y [−11.993, 12.007], Z [40.95, 41.95] in(대칭 중심으로). 가장 낮은 점 40.95 in라 solid 아님
// [가정: HIVE 몸체는 가리지 않음, 꼭짓점·축 받침은 뺌]
const TOP_BAR = box('topBar', [0, 0, 1.05283], [0.0254, 0.6096, 0.0254], [0, 0, 0], LEG, ABOVE)
// 7 로고 판(+X): ACM X [1.549, 4.283], Z [34.072, 40.020] in → 두께 0.117·높이 6.459 in, 24°. 가장 낮은 점 34.07 in.
// [가정: 로고 판은 위가 안쪽으로 24° 기움] 대회에 따라 없을 수 있다
const LOGO_7 = box(
  'logoPlate',
  [0.07407, 0, 0.94097],
  [0.00297, 0.76606, 0.16408],
  [0, -0.41888, 0],
  LOGO_PLATE,
  ABOVE
)
// FLOWER(CAD am-5855 Flower Assembly Layer B 범위, 백스톱 윗면 22.654 in). 벽 쪽 면이 벽 안쪽 면(±1.79286)과 같은 평면.
// 9 `<1>`(−X 벽, Y−): X [−70.643, −65.630], Y [−26.365, −20.420] in. 원기둥(r 0.075)으로 하면 0.56 in 넘쳐 상자로 둔다
const FLOWER_9 = box(
  'flower',
  [-1.72993, -0.59417, 0.287705],
  [0.12586, 0.151, 0.57541],
  [0, 0, 0],
  FLOWER,
  SOLID
)
// 11 `<3>`(빨강 벽): X [20.420, 26.365], Y [−70.643, −65.630] in
const FLOWER_11 = box(
  'flower',
  [0.59417, -1.72993, 0.287705],
  [0.151, 0.12586, 0.57541],
  [0, 0, 0],
  FLOWER,
  SOLID
)
// HIVE CELL(빨강 HIVE 몸체 틀, 표시만): synthesis §2.4 CELL 상자(팔 방향 [0.23927, 0.54508], 법선 [−0.03785, 0.3175],
// 폭 0.53594)를 CELL마다 하나. CELL 판(아래판~윗판) 근사이고 리브는 뺐다(4d가 가림에 쓸 때 Z를 다시 정한다).
// 가장 낮은 점(리브 am-5866) 30.65 in라 29 in(R105.A) 로봇보다 높다 [가정: HIVE 몸체는 가리지 않음, 꼭짓점·축 받침은 뺌]
const CELL_SIZE: [number, number, number] = [0.30581, 0.53594, 0.35535]
const CELL_13 = box(
  'hiveCell',
  [-0.392175, 0, 0.139825],
  CELL_SIZE,
  [0, 0, 0],
  HIVE_CELL,
  DISPLAY,
  'hiveRed'
)
const CELL_14 = box(
  'hiveCell',
  [0.392175, 0, 0.139825],
  CELL_SIZE,
  [0, 0, 0],
  HIVE_CELL,
  DISPLAY,
  'hiveRed'
)

const STRUCTURES: FieldStructure[] = [
  FOOT_BAR_0,
  mirrorStructure(FOOT_BAR_0),
  LEG_2,
  LEG_3,
  mirrorStructure(LEG_2),
  mirrorStructure(LEG_3),
  TOP_BAR,
  LOGO_7,
  mirrorStructure(LOGO_7),
  FLOWER_9,
  mirrorStructure(FLOWER_9),
  FLOWER_11,
  mirrorStructure(FLOWER_11),
  CELL_13,
  CELL_14,
  mirrorStructure(CELL_13),
  mirrorStructure(CELL_14)
]

// 짝 표(spec-4ab §1.4 "짝" 열): [생성한 순번, 원본 순번]. 위 막대 6은 자기 짝이다. 데이터 시험이 확인한다
export const BIOBUZZ_STRUCTURE_PAIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [4, 2],
  [5, 3],
  [8, 7],
  [10, 9],
  [12, 11],
  [15, 13],
  [16, 14]
]

// ---- HIVE [확인: CAD·CM] ----

// 피벗: Z 43.95 in(CM 2293행), Y ∓12.75 in(CM 그림 9-10 중심 간격 25.5 in. CAD 비대칭 −0.32365/+0.32405의 평균).
// 각 θ > 0이면 +X 쪽이 내려간다. 시작 −30°(+X CELL이 위, EFG:533, CM 10.3.1 2574행 "the CELL which 'points at' a FLOWER
// should be the one tilted down"), 넘어감은 피벗 둘레 60° 강체 회전(+30°)
// [가정: HIVE 상태는 실행 동안 고정, 개인 실행 설정]
const HIVE_RED: FieldHive = {
  key: 'hiveRed',
  pivot: { x: 0, y: -0.32385, z: 1.11633 },
  startAngle: -Math.PI / 6,
  tippedAngle: Math.PI / 6
}

// ---- AprilTag(빨강 HIVE 몸체 틀) [확인: CAD 스티커 + SDK 오프셋 + 실물 화면] ----

// 검은 테두리 바깥 변 3.25 in(SDK getBioBuzzTagLibrary), 패밀리 36h11
const TAG_SIZE = 0.08255
// 득점 CELL(−X) x = −Y, y = +X, z = +Z: 몸체 틀 X −14.270 in, Z −1.493 in(CAD 스티커 두 장의 거울 대칭), Y는 SDK 오프셋
// ±6.5·±2.75 in(CAD와 0.008 in 차). 관중석 CELL(+X)은 x = +Y, y = −X
const TAG_X = 0.36246
const TAG_Z = -0.03792
const TAG_Y_OUTER = 0.1651
const TAG_Y_INNER = 0.06985

function tag(id: number, x: number, y: number, rz: number, cluster: string): FieldTag {
  return {
    id,
    size: TAG_SIZE,
    carrier: 'hiveRed',
    position: { x, y, z: TAG_Z },
    rotation: { x: 0, y: 0, z: rz },
    cluster
  }
}

// SDK 왼→오른(TagL1…R2) 순서. 묶음 이름은 SDK getBioBuzzTagLibrary와 같다
const RED_TAGS: FieldTag[] = [
  tag(30, -TAG_X, TAG_Y_OUTER, -Math.PI / 2, 'RED SCORING'),
  tag(31, -TAG_X, TAG_Y_INNER, -Math.PI / 2, 'RED SCORING'),
  tag(32, -TAG_X, -TAG_Y_INNER, -Math.PI / 2, 'RED SCORING'),
  tag(33, -TAG_X, -TAG_Y_OUTER, -Math.PI / 2, 'RED SCORING'),
  tag(34, TAG_X, -TAG_Y_OUTER, Math.PI / 2, 'RED AUDIENCE'),
  tag(35, TAG_X, -TAG_Y_INNER, Math.PI / 2, 'RED AUDIENCE'),
  tag(36, TAG_X, TAG_Y_INNER, Math.PI / 2, 'RED AUDIENCE'),
  tag(37, TAG_X, TAG_Y_OUTER, Math.PI / 2, 'RED AUDIENCE')
]

// ---- 움직이는 경기 요소(6a, spec-6a §4) ----

// 공 지름·질량 [확인: CM·EFG·AndyMark 제품 정보(POLLEN Ø 2.8 in = 0.0711 m 24.9 g, NECTAR Ø 3.6 in = 0.0914 m 41.3 g)]
const POLLEN_RADIUS = 0.03555
const POLLEN_MASS = 0.0249
const NECTAR_RADIUS = 0.0457
const NECTAR_MASS = 0.0413
// [가정: 위플형 PE 공의 벽 안쪽 반지름 = 0.95·r(구멍은 무시)] 실측 없음. 속 빈 껍질 관성 0.4·m·(r⁵ − rᵢ⁵)/(r³ − rᵢ³)
// = 0.6344·m·r²(속 찬 구 0.4와 얇은 껍질 2/3 사이)
const SHELL_INNER_RATIO = 0.95
function shellInertia(mass: number, radius: number): number {
  const k = SHELL_INNER_RATIO
  return ((0.4 * (1 - k ** 5)) / (1 - k ** 3)) * mass * radius * radius
}
// 표시 색과 반사율(6c 센서용) [가정: 노랑·빨강·파랑 PE 공의 반사율, 실측 없음]. 표시 색은 [결정: 계산과 무관한 표시 색]
const POLLEN_MATERIAL: FieldMaterial = { display: '#f2d21b', rgb: [0.65, 0.55, 0.08], nir: 0.7 }
const NECTAR_RED_MATERIAL: FieldMaterial = { display: '#d32f2f', rgb: [0.5, 0.1, 0.08], nir: 0.6 }
const NECTAR_BLUE_MATERIAL: FieldMaterial = { display: '#1e63c8', rgb: [0.08, 0.2, 0.5], nir: 0.5 }
// 접촉 값은 모두 실측 없는 가정이다(spec-6a §4, docs/assumptions.md 6a 표)
const BALL_CONTACT_COMMON = {
  // [가정: 0.3·r 넘게 눌리면 딱딱한 심] 위플 공이 그보다 깊게 눌리는 메커니즘은 공을 찌그러뜨린다고 본다
  coreDepthRatio: 0.3,
  // [가정: PE 공 표면 μ 0.5] 타일·알루미늄·고무 롤러 사이의 중간값(짝은 평균)
  friction: 0.5,
  // [가정: 굴림 저항 0.05] 구멍 난 속 빈 공이 타일 위를 구를 때의 감속(약 0.3 m/s²)
  rollingResistance: 0.05,
  // [가정: 회전 저항 접촉 반경 2 mm] 쉬는 공의 접촉 반경 √(2r·mg/k) ≈ 1.7–2.0 mm를 올림
  spinRadius: 0.002,
  // [가정: 반발 바닥 0.30·딱딱한 면 0.64·공끼리 0.5·로봇 0.5] 위플 공 낙하 영상 어림(타일 폼은 더 흡수한다)
  restitution: { floor: 0.3, hard: 0.64, element: 0.5, robot: 0.5 }
}
// [가정: C_d 0.5(구멍 난 구), Magnus 기울기 0.5·최대 0.3] 매끈한 구의 문헌값 어림
const BALL_AIR = { dragCoefficient: 0.5, magnusSlope: 0.5, magnusMax: 0.3 }
const POLLEN: FieldElementType = {
  kind: 'pollen',
  radius: POLLEN_RADIUS,
  mass: POLLEN_MASS,
  inertia: shellInertia(POLLEN_MASS, POLLEN_RADIUS),
  material: POLLEN_MATERIAL,
  // [가정: 판 강성 3000 N/m] 손가락으로 누른 어림(1 kg에 약 3 mm)
  contact: { plateStiffness: 3000, ...BALL_CONTACT_COMMON },
  air: BALL_AIR,
  // CM 10.8.2: 필드 밖 POLLEN은 경기 요원이 다시 넣는다
  reentry: true
}
const NECTAR_PHYSICS = {
  radius: NECTAR_RADIUS,
  mass: NECTAR_MASS,
  inertia: shellInertia(NECTAR_MASS, NECTAR_RADIUS),
  // [가정: 판 강성 4500 N/m] POLLEN보다 큰 구멍·지름이지만 벽이 두꺼운 어림
  contact: { plateStiffness: 4500, ...BALL_CONTACT_COMMON },
  air: BALL_AIR,
  // NECTAR는 사람 선수가 넣는다(6d). 6a는 밖에 그대로 둔다
  reentry: false
}
const ELEMENT_TYPES: FieldElementType[] = [
  POLLEN,
  { kind: 'nectarRed', ...NECTAR_PHYSICS, material: NECTAR_RED_MATERIAL },
  { kind: 'nectarBlue', ...NECTAR_PHYSICS, material: NECTAR_BLUE_MATERIAL }
]

// GARDEN POLLEN 4개(CM 10.3.1 "line starting in the corner closest to the ALLIANCE AREA against the audience or rear
// wall"): 빨강 GARDEN은 관중석 벽(+X)을 따라 빨강 벽(−Y) 구석에서 시작하는 띠(FAC 3.5, RED_GARDEN)라, 공은 관중석 벽과
// 빨강 벽에 닿고 서로 닿게 한 줄로 바닥에 놓인다(x = 벽 − r, y = −벽 + r·(1 + 2k)). 중심 x(1.75731)는 GARDEN 띠
// [1.74206, 1.79286] 안이다. 파랑은 Rz(π)
const RED_GARDEN_POLLEN: FieldElementPlacement[] = [0, 1, 2, 3].map((k) => ({
  group: 'garden',
  kind: 'pollen',
  position: {
    x: INNER_HALF - POLLEN_RADIUS,
    y: -INNER_HALF + POLLEN_RADIUS * (1 + 2 * k),
    z: POLLEN_RADIUS
  }
}))

// ---- 시작(G304) [결정: 프리셋과 스냅, synthesis §2.7·§9.6] ----

// GARDEN POLLEN 자리(CM 10.3.1). CAD 공 자리는 X ≥ 67.878 in(1.72410 m), Y ≤ −59.214 in였지만 CAD 공은 실제(Ø 2.8 in)보다
// 작아(벽까지 2.707 in) 실제 지름의 공이 벽에 닿으면 X 1.72176까지 온다. 그래서 X 경계는 공 바깥(벽 − 2r)이다(6a: 1.7241이면
// 빨강 벽 관중석 쪽 프리셋 끝에 붙인 로봇이 첫 공과 2.3 mm 겹쳤다). Y 경계는 공 넷(−1.50846)보다 넓은 CAD 값 그대로다.
// [가정: GARDEN POLLEN 자리를 시작 프리셋에서 피함] 규칙이 아니다(G304는 GARDEN 접촉을 허용한다)
const GARDEN_POLLEN_EDGE = INNER_HALF - 2 * POLLEN_RADIUS
const RED_KEEP_OUT: { rect: FieldRect } = {
  rect: [GARDEN_POLLEN_EDGE, -INNER_HALF, INNER_HALF, -1.50404]
}

// 빨강 여섯(yaw는 필드 안쪽을 보는 면). 구간 끝은 이음새(±0.59695·−1.19390), FLOWER 면(±0.51867·0.66967), GARDEN POLLEN
// 자리(1.72176·−1.50404), 벽(±1.79286)이다
const RED_PRESETS: FieldStartPreset[] = [
  {
    key: 'redWallScoring',
    alliance: 'red',
    wall: 'red',
    along: [-INNER_HALF, -1.1939],
    yaw: Math.PI / 2
  },
  {
    key: 'redWallCenter',
    alliance: 'red',
    wall: 'red',
    along: [-0.59695, 0.51867],
    yaw: Math.PI / 2
  },
  {
    key: 'redWallAudience',
    alliance: 'red',
    wall: 'red',
    along: [0.66967, GARDEN_POLLEN_EDGE],
    yaw: Math.PI / 2
  },
  { key: 'audienceWall', alliance: 'red', wall: 'audience', along: [-1.50404, 0], yaw: Math.PI },
  {
    key: 'scoringWallCorner',
    alliance: 'red',
    wall: 'scoring',
    along: [-INNER_HALF, -0.66967],
    yaw: 0
  },
  { key: 'scoringWallCenter', alliance: 'red', wall: 'scoring', along: [-0.51867, 0], yaw: 0 }
]
// 같은 행 파랑(라벨이 위치를 말하므로 이름이 다르다)
const BLUE_PRESET_KEYS = [
  'blueWallAudience',
  'blueWallCenter',
  'blueWallScoring',
  'scoringWall',
  'audienceWallCorner',
  'audienceWallCenter'
]

export const BIOBUZZ_FIELD: FieldSpec = deepFreeze<FieldSpec>({
  season: 'biobuzz',
  walls: { plusX: 'audience', minusX: 'scoring', plusY: 'blue', minusY: 'red' },
  perimeter: {
    innerHalf: INNER_HALF,
    // 타일 윗면부터 위 레일 윗면 11.644 in
    height: 0.29576,
    // 레일 두께 1.065 in(Y [70.585, 71.650])
    thickness: 0.02705,
    panelInset: BIOBUZZ_PANEL_INSET,
    railBands: BIOBUZZ_RAIL_BANDS,
    panelSeams: BIOBUZZ_PANEL_SEAMS,
    rail: RAIL,
    panel: PANEL
  },
  // 타일 이음새: 톱니 겹침 띠 [23.097, 23.907]·[46.599, 47.409] in의 중심 23.502·47.004 in(피치는 24 in가 아니다)
  floor: { seams: [-1.1939, -0.59695, 0, 0.59695, 1.1939], material: TILE_GRAY },
  tape: [...RED_TAPE, ...RED_TAPE.map((t) => mirrorTape(t, TAPE_BLUE))],
  zones: [RED_LOADING_ZONE, RED_GARDEN, mirrorZone(RED_LOADING_ZONE), mirrorZone(RED_GARDEN)],
  hives: [HIVE_RED, mirrorHive(HIVE_RED)],
  structures: STRUCTURES,
  aprilTags: { family: 'tag36h11', tags: [...RED_TAGS, ...RED_TAGS.map(mirrorTag)] },
  startKeepOut: [RED_KEEP_OUT, mirrorKeepOut(RED_KEEP_OUT)],
  startPresets: [
    ...RED_PRESETS,
    ...RED_PRESETS.map((p, i) => mirrorPreset(p, BLUE_PRESET_KEYS[i]))
  ],
  elements: {
    types: ELEMENT_TYPES,
    layout: [...RED_GARDEN_POLLEN, ...RED_GARDEN_POLLEN.map(mirrorElementPlacement)]
  }
})
