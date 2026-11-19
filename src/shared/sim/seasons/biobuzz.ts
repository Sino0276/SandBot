import type { Vec2 } from '../worldSpec'
import type {
  FieldElementPlacement,
  FieldElementType,
  FieldHive,
  FieldMaterial,
  FieldPart,
  FieldPartKey,
  FieldRect,
  FieldSpec,
  FieldStartPreset,
  FieldStructure,
  FieldTag,
  FieldTape,
  FieldZone
} from './fieldSpec'
import { deepFreeze } from './fieldSpec'
import { ringSectorPolygons, rotateQuarter } from './partShapes'
import {
  mirrorElementPlacement,
  mirrorHive,
  mirrorKeepOut,
  mirrorPart,
  mirrorPreset,
  mirrorStructure,
  mirrorTag,
  mirrorTape,
  mirrorZone,
  neg
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

// ---- FLOWER 케이지(6b, spec-6b §1.3·부록 A.2) ----
// 공식 필드 CAD(STEP, CM 9.1 "official representation", spec-6b 머리의 주소·sha256)를 읽기만 하며 잰 값이다. 측정 스크립트:
// docs/research/6b/cad-scripts/flower.py(메시 번호는 그 출력과 cad-geometry-notes.txt). 수는 FLOWER 9(`<1>`)의 자기 틀
// (u = 필드 +X = 필드 안쪽, v = 필드 +Y, w = Z = 타일 윗면부터, 원점 = 축)이고 FLOWER는 v에 거울 대칭이다(CAD 비대칭 ≤ 0.02 mm는
// 버린다). FLOWER 11은 같은 자기 수를 정확한 90° 회전((u, v) → (−v, u), 삼각함수 없음)으로 놓고, 10·12는 mirrorStructure다.
//
// 공 조각(balls)과 로봇 조각(robots)을 따로 둔다(spec-6b §1.3): 공은 고리를 22.5° 조각 16개(안쪽 현이 구멍, 바깥은 고리 윤곽)로,
// 로봇은 고리마다 구멍을 채운 볼록 기둥 하나로 본다 [결정: 로봇은 고리 구멍 안으로 들어가지 않는다(아래 회수 구멍은 아래·가운데
// 고리 사이라 열려 있다), 로봇 조각 수를 줄여 섀시 행 한도 28 안에 두려고]. 관·압출재·백스톱·받침은 둘 다 쓴다(관은 공에 정확한
// 원기둥, 로봇에 16각 기둥).

// FLOWER 9 축(필드 m) [확인: 공식 필드 CAD am-5862 Flower HIPS Pipe #790·#791·#794·#812 중심의 가운데, X −68.0415·Y −23.3929 in]
const FLOWER_9_AXIS: Vec2 = { x: -1.728254, y: -0.59418 }
// 아래 고리(am-5859 Layer X #810): 타일 위 높이 [확인: 공식 필드 CAD #810, 0.354 in. 타일 아래 부분은 폼에 묻힘(FAC 1.6)]
const FLOWER_RING_BOTTOM_W: [number, number] = [0, 0.008992]
// 구멍 반지름 [확인: 공식 필드 CAD #810 단면 r 0.0384–0.0390, 가운데 값. 위 모서리 모따기(r 0.04158)는 뺐다]. CM의 "약 2.79 in"
// 지름과 다르다(CAD가 공식 표현, spec-6b §11)
const FLOWER_RING_BOTTOM_HOLE = 0.0387
// 바깥 윤곽(v ≤ 0 반쪽, 벽 쪽부터 반시계) [확인: 공식 필드 CAD #810 타일 위 꼭짓점의 v 대칭 볼록 껍질, 둥근 모서리는 1 mm 안에서
// 줄임(flower.py SIMPLIFY_IN 0.04 in)]
const FLOWER_RING_BOTTOM_OUTER: readonly Vec2[] = [
  { x: -0.062743, y: -0.027312 },
  { x: -0.060975, y: -0.046455 },
  { x: -0.054936, y: -0.056779 },
  { x: -0.048134, y: -0.06057 },
  { x: -0.005892, y: -0.074307 },
  { x: 0.005963, y: -0.07429 },
  { x: 0.047527, y: -0.060631 },
  { x: 0.054365, y: -0.056657 },
  { x: 0.059004, y: -0.05025 },
  { x: 0.060644, y: -0.042512 }
]
// 가운데 고리(am-5858 Layer B #814): 판 w [0.099162, 0.108053]과 관 소켓(관 둘레, w 0.108053까지 위)의 범위 [확인: 공식 필드
// CAD #814]. 공에는 범위 전체를 구멍 원기둥으로 본다(소켓 안 자유 반지름 1.926–1.944 in이 구멍과 0.5 mm 안이다)
const FLOWER_RING_MIDDLE_W: [number, number] = [0.099162, 0.133452]
// [확인: 공식 필드 CAD #814 단면 r 1.92–1.93 in]
const FLOWER_RING_MIDDLE_HOLE = 0.0489
// 바깥 윤곽(v ≤ 0 반쪽) [확인: 공식 필드 CAD #814 v 대칭 볼록 껍질, 1 mm 줄임]. 벽 쪽 탭(u −0.06604, |v| ≤ 0.026416)은 봉투 벽 쪽
// 면(벽 안쪽 면, u −0.064605)에서 자른다 [결정: 6b 계약 리뷰. 그 자리는 벽이다]
const FLOWER_RING_MIDDLE_OUTER: readonly Vec2[] = [
  { x: -0.064605, y: -0.031788 },
  { x: -0.059751, y: -0.050904 },
  { x: -0.055503, y: -0.056765 },
  { x: -0.049242, y: -0.060395 },
  { x: -0.005427, y: -0.07474 },
  { x: 0.005424, y: -0.07474 },
  { x: 0.049239, y: -0.060395 },
  { x: 0.055501, y: -0.056765 },
  { x: 0.059749, y: -0.050904 },
  { x: 0.061251, y: -0.043824 }
]
// NECTAR 턱 셋(FAC 2.9 "NECTAR does not escape FLOWER"): 가운데 고리 구멍 안, w [0.104267, 0.10795] [확인: 공식 필드 CAD #814
// 단면, 4.105–4.25 in]. 실제 안쪽 모서리는 45° 모따기라 아래 r 0.042926에서 위 0.046482로 벌어지고 가운데 NECTAR는 아래 안쪽
// 모서리에 쉰다(중심 w 0.119947). 턱을 수직 안쪽 면 하나로 두고 그 반지름은 NECTAR가 같은 높이에 쉬는 값으로 한다
// [결정: 모따기 대신 같은 쉬는 높이의 수직 면, r_eq = √(r_N² − (0.119947 − 0.10795)²) = 0.044097, flower.py]. 각 범위는 w 4.11 in
// 단면에서 r_eq보다 안쪽인 곳(±10.95°, ±131.3°–158.4°)이고, 안쪽 현은 턱 가운데 각에서 r_eq 원에 닿으며(쉬는 점이 현의 가운데)
// 바깥 점(0.0505·0.0515)은 고리 구멍보다 바깥이라 고리 조각과 겹친다 [결정, 꼭짓점은 flower.py가 낸 수]
const FLOWER_LIP_W: [number, number] = [0.104267, 0.10795]
const FLOWER_LIPS: readonly (readonly Vec2[])[] = [
  [
    { x: 0.044097, y: -0.008532 },
    { x: 0.049581, y: -0.009593 },
    { x: 0.049581, y: 0.009593 },
    { x: 0.044097, y: 0.008532 }
  ],
  [
    { x: -0.029938, y: 0.034077 },
    { x: -0.03399, y: 0.03869 },
    { x: -0.047883, y: 0.018958 },
    { x: -0.042175, y: 0.016698 }
  ],
  [
    { x: -0.042175, y: -0.016698 },
    { x: -0.047883, y: -0.018958 },
    { x: -0.03399, y: -0.03869 },
    { x: -0.029938, y: -0.034077 }
  ]
]
// 위 고리(am-5857 Layer C #819): 판과 관 소켓의 범위 [확인: 공식 필드 CAD #819, 20.254–21.404 in], 여는 곳 반지름(지름 3.97–4.01 in,
// CM 약 4 in) [확인: 공식 필드 CAD #819 단면]
const FLOWER_RING_TOP_W: [number, number] = [0.514452, 0.543662]
const FLOWER_RING_TOP_HOLE = 0.0507
// 바깥 윤곽(v ≤ 0 반쪽, 모따기 팔각형) [확인: 공식 필드 CAD #819 v 대칭 볼록 껍질, 1 mm 줄임]
const FLOWER_RING_TOP_OUTER: readonly Vec2[] = [
  { x: -0.060943, y: -0.043824 },
  { x: -0.059467, y: -0.050778 },
  { x: -0.055295, y: -0.056534 },
  { x: -0.049145, y: -0.0601 },
  { x: -0.00533, y: -0.074445 },
  { x: 0.005327, y: -0.074445 },
  { x: 0.049142, y: -0.0601 },
  { x: 0.055292, y: -0.056534 },
  { x: 0.059465, y: -0.050778 },
  { x: 0.06094, y: -0.043824 }
]
// HIPS 관 넷(am-5862): 중심 (±0.043815, ±0.043815), 바깥 반지름 0.013343, w [0.108052, 0.539852] [확인: 공식 필드 CAD #790·#791·
// #794·#812 w = 12 in 단면]. 관 사이 자유 반지름 0.048621(POLLEN이 빠져나가지 못함, FAC 2.11)
const FLOWER_PIPE_OFFSET = 0.043815
const FLOWER_PIPE_RADIUS = 0.013343
const FLOWER_PIPE_W: [number, number] = [0.108052, 0.539852]
// 벽 쪽 압출재 둘(am-5892 Flower Peanut Support #796·#797): w [0.008992, 0.104242], A(v < 0)의 볼록 껍질, B는 A의 v 거울
// [확인: 공식 필드 CAD #796, 1 mm 줄임]
const FLOWER_UPRIGHT_W: [number, number] = [0.008992, 0.104242]
const FLOWER_UPRIGHT: readonly Vec2[] = [
  { x: -0.062243, y: -0.028717 },
  { x: -0.052822, y: -0.046721 },
  { x: -0.049394, y: -0.047794 },
  { x: -0.03139, y: -0.038372 },
  { x: -0.030317, y: -0.034944 },
  { x: -0.039739, y: -0.01694 },
  { x: -0.043167, y: -0.015867 },
  { x: -0.061171, y: -0.025289 }
]
// Field Wall Bracket(am-5860 #798, 벽 레일 위에 얹혀 뒤 관 둘을 문다): w [0.2905, 0.30066] [확인: 공식 필드 CAD #798]. 로봇에는
// 볼록 껍질 하나(v ≤ 0 반쪽, 1 mm 줄임), 공에는 안쪽 둥근 가장자리(r 0.048082, 뒤 관 사이 135°–225°)의 바깥 22.5° 조각 넷을 그
// 껍질로 자른 것 [확인: 공식 필드 CAD #798 단면 r 1.89–1.91 in]. 봉투(벽 레일 위·±v) 밖으로 나가는 예외 부품이다
// (PART_ENVELOPE_EXCEPTIONS)
const FLOWER_BRACKET_W: [number, number] = [0.2905, 0.30066]
const FLOWER_BRACKET_INNER = 0.048082
const FLOWER_BRACKET_SECTORS = [6, 7, 8, 9]
const FLOWER_BRACKET: readonly Vec2[] = [
  { x: -0.095308, y: -0.071714 },
  { x: -0.080403, y: -0.084477 },
  { x: -0.047911, y: -0.083955 },
  { x: -0.024429, y: -0.059422 }
]
// 백스톱(am-5884 #801): 위 고리 위 휜 막대, w [0.569062, 0.575412]. 뒤 막대 면 u −0.06074·−0.04804, 45° 막대 둘의 면이 축에서
// 법선 거리 0.049307·0.062007(폭 12.7 mm) [확인: 공식 필드 CAD #801 w 22.53 in 단면의 180°·135° 광선, flower.py. spec-6b 부록 A.2의
// 폭 8.9 mm·u [−0.058826, −0.049962]와 다르다: 같은 높이 모든 단면에서 0.5 in 폭]. 뒤 막대는 안쪽 모서리(v ±0.02169)까지의 상자,
// 45° 막대는 그 모서리부터 둥근 끝(+v 쪽 v > 2 in 껍질)까지의 볼록 기둥이다
const FLOWER_BACKSTOP_W: [number, number] = [0.569062, 0.575412]
const FLOWER_BACKSTOP_U: [number, number] = [-0.06074, -0.04804]
const FLOWER_BACKSTOP_CORNER_V = 0.02169
const FLOWER_BACKSTOP_DIAGONAL: readonly Vec2[] = [
  { x: -0.06074, y: 0.02169 },
  { x: -0.04804, y: 0.02169 },
  { x: -0.011349, y: 0.058382 },
  { x: -0.009776, y: 0.060983 },
  { x: -0.010048, y: 0.065478 },
  { x: -0.011923, y: 0.067871 },
  { x: -0.016222, y: 0.06921 },
  { x: -0.020329, y: 0.067362 },
  { x: -0.06074, y: 0.026951 }
]
// 백스톱 받침 둘(am-1696 Nylon Spacer #788·#789, OD 0.375 in): 중심 (−0.01585, ±0.062865), w [0.543662, 0.569062]
// [확인: 공식 필드 CAD #788·#789]
const FLOWER_SPACER_CENTER: Vec2 = { x: -0.01585, y: 0.062865 }
const FLOWER_SPACER_RADIUS = 0.0047625
const FLOWER_SPACER_W: [number, number] = [0.543662, 0.569062]

// v 거울: 반쪽(v ≤ 0, 반시계)에 그 거울을 거꾸로 이어 v 대칭 반시계 다각형
function mirrorHalfV(half: readonly Vec2[]): Vec2[] {
  return [...half, ...[...half].reverse().map((p) => ({ x: p.x, y: neg(p.y) }))]
}
const mirrorV = (polygon: readonly Vec2[]): Vec2[] =>
  [...polygon].reverse().map((p) => ({ x: p.x, y: neg(p.y) }))

// FLOWER 하나의 부품(축 axis, quarter: FLOWER 9 자기 수를 (u, v) → (−v, u)로 돌린다). 볼록 기둥은 중심이 축(회전 0)이고 다각형은
// 축 기준 자기 수(돌린 것), 원기둥 중심·상자 중심은 축 + 자기 수. 순서가 행 토큰 s<i>p<j>의 j다
function flowerParts(axis: Vec2, quarter: boolean): FieldPart[] {
  const turn = (p: Vec2): Vec2 => (quarter ? rotateQuarter(p) : { x: p.x, y: p.y })
  const zero = { x: 0, y: 0, z: 0 }
  const prism = (
    key: FieldPartKey,
    polygon: readonly Vec2[],
    [w0, w1]: [number, number],
    use: { robots: boolean; balls: boolean }
  ): FieldPart => ({
    shape: {
      kind: 'prism',
      center: { x: axis.x, y: axis.y, z: (w0 + w1) / 2 },
      rotation: zero,
      polygon: polygon.map(turn),
      height: w1 - w0
    },
    ...use,
    key
  })
  const cylinder = (
    key: FieldPartKey,
    offset: Vec2,
    radius: number,
    [w0, w1]: [number, number]
  ): FieldPart => {
    const o = turn(offset)
    return {
      shape: {
        kind: 'cylinder',
        center: { x: axis.x + o.x, y: axis.y + o.y, z: (w0 + w1) / 2 },
        rotation: zero,
        radius,
        height: w1 - w0
      },
      robots: true,
      balls: true,
      key
    }
  }
  const ROBOTS = { robots: true, balls: false }
  const BALLS = { robots: false, balls: true }
  const BOTH = { robots: true, balls: true }
  const ring = (
    key: FieldPartKey,
    outer: readonly Vec2[],
    hole: number,
    w: [number, number]
  ): FieldPart[] => [
    prism(key, outer, w, ROBOTS),
    ...ringSectorPolygons(outer, hole).map(([, polygon]) => prism(key, polygon, w, BALLS))
  ]
  const bracket = mirrorHalfV(FLOWER_BRACKET)
  // 백스톱 뒤 막대: u 구간 × |v| ≤ 안쪽 모서리. 상자(회전 0)라 돌리면 크기 x·y를 바꾼다
  const backstopU = FLOWER_BACKSTOP_U
  const backCenter = turn({ x: (backstopU[0] + backstopU[1]) / 2, y: 0 })
  const backSize = { x: backstopU[1] - backstopU[0], y: 2 * FLOWER_BACKSTOP_CORNER_V }
  const backstopBox: FieldPart = {
    shape: {
      kind: 'box',
      center: {
        x: axis.x + backCenter.x,
        y: axis.y + backCenter.y,
        z: (FLOWER_BACKSTOP_W[0] + FLOWER_BACKSTOP_W[1]) / 2
      },
      rotation: zero,
      size: {
        x: quarter ? backSize.y : backSize.x,
        y: quarter ? backSize.x : backSize.y,
        z: FLOWER_BACKSTOP_W[1] - FLOWER_BACKSTOP_W[0]
      }
    },
    ...BOTH,
    key: 'flowerBackstop'
  }
  return [
    ...ring(
      'flowerRingBottom',
      mirrorHalfV(FLOWER_RING_BOTTOM_OUTER),
      FLOWER_RING_BOTTOM_HOLE,
      FLOWER_RING_BOTTOM_W
    ),
    prism('flowerUpright', FLOWER_UPRIGHT, FLOWER_UPRIGHT_W, BOTH),
    prism('flowerUpright', mirrorV(FLOWER_UPRIGHT), FLOWER_UPRIGHT_W, BOTH),
    ...ring(
      'flowerRingMiddle',
      mirrorHalfV(FLOWER_RING_MIDDLE_OUTER),
      FLOWER_RING_MIDDLE_HOLE,
      FLOWER_RING_MIDDLE_W
    ),
    ...FLOWER_LIPS.map((lip) => prism('flowerLip', lip, FLOWER_LIP_W, BALLS)),
    ...[
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1]
    ].map(([su, sv]) =>
      cylinder(
        'flowerPipe',
        { x: su * FLOWER_PIPE_OFFSET, y: sv * FLOWER_PIPE_OFFSET },
        FLOWER_PIPE_RADIUS,
        FLOWER_PIPE_W
      )
    ),
    prism('flowerWallBracket', bracket, FLOWER_BRACKET_W, ROBOTS),
    ...ringSectorPolygons(bracket, FLOWER_BRACKET_INNER, FLOWER_BRACKET_SECTORS).map(
      ([, polygon]) => prism('flowerWallBracket', polygon, FLOWER_BRACKET_W, BALLS)
    ),
    ...ring(
      'flowerRingTop',
      mirrorHalfV(FLOWER_RING_TOP_OUTER),
      FLOWER_RING_TOP_HOLE,
      FLOWER_RING_TOP_W
    ),
    cylinder('flowerSpacer', FLOWER_SPACER_CENTER, FLOWER_SPACER_RADIUS, FLOWER_SPACER_W),
    cylinder(
      'flowerSpacer',
      { x: FLOWER_SPACER_CENTER.x, y: neg(FLOWER_SPACER_CENTER.y) },
      FLOWER_SPACER_RADIUS,
      FLOWER_SPACER_W
    ),
    backstopBox,
    prism('flowerBackstop', FLOWER_BACKSTOP_DIAGONAL, FLOWER_BACKSTOP_W, BOTH),
    prism('flowerBackstop', mirrorV(FLOWER_BACKSTOP_DIAGONAL), FLOWER_BACKSTOP_W, BOTH)
  ]
}

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
// 9 `<1>`(−X 벽, Y−): X [−70.643, −65.630], Y [−26.365, −20.420] in. 원기둥(r 0.075)으로 하면 0.56 in 넘쳐 상자로 둔다.
// 상자(shape)는 봉투다: 평면 경로·4c 광선·4d 가림·시작 프리셋·자동 프리로드·열기 알림이 쓴다. 로봇 3D 충돌과 공은 부품(parts,
// 6b 케이지, 아래 FLOWER 케이지 절)을 쓴다
const FLOWER_9: FieldStructure = {
  ...box(
    'flower',
    [-1.72993, -0.59417, 0.287705],
    [0.12586, 0.151, 0.57541],
    [0, 0, 0],
    FLOWER,
    SOLID
  ),
  parts: flowerParts(FLOWER_9_AXIS, false)
}
// 11 `<3>`(빨강 벽): X [20.420, 26.365], Y [−70.643, −65.630] in. 케이지는 FLOWER 9의 정확한 Rz(+π/2) 상이다
// [확인: 공식 필드 CAD Flower Assembly <1>·<3> 경계 상자·관 중심, cad-geometry-notes [FLOWER frame convention]]
const FLOWER_11: FieldStructure = {
  ...box(
    'flower',
    [0.59417, -1.72993, 0.287705],
    [0.151, 0.12586, 0.57541],
    [0, 0, 0],
    FLOWER,
    SOLID
  ),
  parts: flowerParts(rotateQuarter(FLOWER_9_AXIS), true)
}
// HIVE CELL(빨강 HIVE 몸체 틀, 표시만): synthesis §2.4 CELL 상자(팔 방향 [0.23927, 0.54508], 법선 [−0.03785, 0.3175],
// 폭 0.53594)를 CELL마다 하나. CELL 판(아래판~윗판) 근사이고 리브는 뺐다(4d가 가림에 쓸 때 Z를 다시 정한다).
// 가장 낮은 점(리브 am-5866) 30.65 in라 29 in(R105.A) 로봇보다 높다 [가정: HIVE 몸체는 가리지 않음, 꼭짓점·축 받침은 뺌].
// 상자는 표시·4d 이음새로 그대로 두고, 공이 닿는 트레이는 부품(parts, 6b, 아래 CELL 트레이 절)이다
const CELL_SIZE: [number, number, number] = [0.30581, 0.53594, 0.35535]

// ---- CELL 트레이(6b, spec-6b §1.3·부록 A.1) ----
// 빨강 HIVE 몸체 틀(m, x_b 팔(+X CELL = 관중석 CELL), y_b 축 = 필드 +Y, z_b CELL 법선)의 +X CELL(구조물 14). −X CELL(13)은 그
// (x, y) → (−x, −y) 상(mirrorPart, HIVE가 자기 축 둘레 Rz(π)에 대칭)이다. 공식 필드 CAD를 θ = −30°(빨강 시작)에서 몸체 틀로 옮겨
// 쟀다(hivebody.py, cell.py, cad-geometry-notes [CELL tray]). CAD 피벗 y는 저장소 피벗(빨강·파랑 평균)과 0.2 mm 다르다
// [결정: CAD 비대칭 0.2 mm 버림, 4ab 규칙]. 공만 닿는다(robots false: 로봇은 HIVE에 닿지 않는다, 사용자 결정 11/19).
// 바깥 끝(입구, x_b 0.544982)은 열려 있고 안쪽 끝은 Back Skin이다. 단면은 오각형(밑판·옆벽 둘·지붕 둘)이다.
// [결정: 밑판·옆벽·지붕 이음의 둥글림(R 약 1 in)은 무시한다. 쉬는 POLLEN·NECTAR는 둥글림이 끝난 평평한 껍질에 닿는다]
// [가정: 리브 안쪽 턱(껍질보다 1.5–2 mm 안쪽)은 무시하고 리브 안쪽 윤곽 = 껍질 안쪽 면, 리브 바닥 보스(밑판 관 둘레)도 뺀다]
// 기울어진 면(지붕·리브·Back Skin 오각형)은 x_b로 민 볼록 기둥(회전 (0, π/2, 0): 자기 z = x_b, 자기 x = −z_b, 자기 y = y_b)이다

// 껍질 안쪽 면 [확인: 공식 필드 CAD #845 Hive Goal Bottom Skin·#870 Top Skin·#863 Back Skin·#873 Goal Rib 단면]
const CELL_X_BACK = 0.239725
const CELL_X_MOUTH = 0.544982
const CELL_Y = 0.256007
const CELL_Z_FLOOR = -0.037287
const CELL_Z_JUNCTION = 0.163576
const CELL_Z_APEX = 0.327137
// 지붕 경사(32.574°, z = 0.327137 − 0.6389·|y|) [확인: 공식 필드 CAD #870 단면 최소제곱]
const CELL_ROOF_SLOPE = 0.6389
// 껍질 두께 0.508 mm(0.020 in PETG) [확인: 공식 필드 CAD #845 안·바깥 면]
const CELL_SKIN = 0.000508
// Back Skin 판(am-5871): x_b [0.239217, 0.239725], 바깥 윤곽 |y| ≤ 0.265911, 밑 −0.047193, 지붕 z = 0.337497 − 0.6389·|y|(직선 부분
// 맞춤, 아래 가운데 홈은 뺌) [확인: 공식 필드 CAD #863, cell.py]
const CELL_BACK_SKIN_X0 = 0.239217
const CELL_BACK_SKIN_HALF = 0.265911
const CELL_BACK_SKIN_BOTTOM = -0.047193
const CELL_BACK_SKIN_APEX = 0.337497
// Goal Rib(am-5866) 바깥 윤곽: |y| ≤ 0.2667, 밑 −0.047955, 지붕 z = 0.33825 − 0.6389·|y| [확인: 공식 필드 CAD #873·#833, cell.py].
// 입구 리브 x_b [0.52019, 0.544982], 뒤 리브 [0.239217, 0.26162] [확인: 공식 필드 CAD #873·#833 리브 고리 범위]
const CELL_RIB_HALF = 0.2667
const CELL_RIB_BOTTOM = -0.047955
const CELL_RIB_APEX = 0.33825
const CELL_RIBS: readonly [number, number][] = [
  [0.52019, CELL_X_MOUTH],
  [CELL_BACK_SKIN_X0, 0.26162]
]
// Cell Base Tube(am-5868, 1 in 각관) [확인: 공식 필드 CAD #830]
const CELL_BASE_TUBE = {
  x: [0.119532, CELL_X_MOUTH],
  y: [-0.0127, 0.0127],
  z: [-0.068885, -0.043485]
}
// Churro Lite 받침 둘(am-5867, 3/8 in 육각 막대): 경계 상자 [가정: 육각 막대를 경계 상자로] [확인: 공식 필드 CAD #871·#875]
const CELL_STANDOFF = { x: [0.258826, 0.526034], y: [0.240614, 0.250012], z: [0.152578, 0.163449] }

type Range = readonly [number, number] | number[]
const cellBox = (key: FieldPartKey, x: Range, y: Range, z: Range): FieldPart => ({
  shape: {
    kind: 'box',
    center: { x: (x[0] + x[1]) / 2, y: (y[0] + y[1]) / 2, z: (z[0] + z[1]) / 2 },
    rotation: { x: 0, y: 0, z: 0 },
    size: { x: x[1] - x[0], y: y[1] - y[0], z: z[1] - z[0] }
  },
  robots: false,
  balls: true,
  key
})
// (y, z) 반시계 단면을 x_b [x0, x1]로 민 볼록 기둥. 자기 (x, y) = (−z, y)는 방향을 지키는 회전이라 반시계 그대로다
const cellPrism = (
  key: FieldPartKey,
  section: readonly [number, number][],
  x0: number,
  x1: number
): FieldPart => ({
  shape: {
    kind: 'prism',
    center: { x: (x0 + x1) / 2, y: 0, z: 0 },
    rotation: { x: 0, y: Math.PI / 2, z: 0 },
    polygon: section.map(([y, z]) => ({ x: neg(z), y })),
    height: x1 - x0
  },
  robots: false,
  balls: true,
  key
})
// y 거울(반시계를 지키려고 순서를 뒤집는다)
const mirrorSectionY = (section: readonly [number, number][]): [number, number][] =>
  [...section].reverse().map(([y, z]) => [neg(y), z])

function cellTrayParts(): FieldPart[] {
  const roofZ = (apex: number, y: number): number => apex - CELL_ROOF_SLOPE * y
  // 지붕 껍질 바깥 면: 안쪽 면을 법선으로 CELL_SKIN만큼(수직으로 CELL_SKIN·√(1 + s²))
  const outerApex = CELL_Z_APEX + CELL_SKIN * Math.sqrt(1 + CELL_ROOF_SLOPE * CELL_ROOF_SLOPE)
  const outerY = CELL_Y + CELL_SKIN
  const roof: [number, number][] = [
    [0, CELL_Z_APEX],
    [CELL_Y, CELL_Z_JUNCTION],
    [outerY, roofZ(outerApex, outerY)],
    [0, outerApex]
  ]
  const backSkinCorner = roofZ(CELL_BACK_SKIN_APEX, CELL_BACK_SKIN_HALF)
  const backSkin: [number, number][] = [
    [-CELL_BACK_SKIN_HALF, CELL_BACK_SKIN_BOTTOM],
    [CELL_BACK_SKIN_HALF, CELL_BACK_SKIN_BOTTOM],
    [CELL_BACK_SKIN_HALF, backSkinCorner],
    [0, CELL_BACK_SKIN_APEX],
    [-CELL_BACK_SKIN_HALF, backSkinCorner]
  ]
  // 리브 조각 다섯: 안쪽 오각형 I(껍질 안쪽 면)과 바깥 오각형 O 사이 띠를 모서리마다 대각으로 자른 사각형(밑, +y 옆, +y 지붕,
  // −y 지붕, −y 옆)
  const ribCorner = roofZ(CELL_RIB_APEX, CELL_RIB_HALF)
  const I: [number, number][] = [
    [-CELL_Y, CELL_Z_FLOOR],
    [CELL_Y, CELL_Z_FLOOR],
    [CELL_Y, CELL_Z_JUNCTION],
    [0, CELL_Z_APEX],
    [-CELL_Y, CELL_Z_JUNCTION]
  ]
  const O: [number, number][] = [
    [-CELL_RIB_HALF, CELL_RIB_BOTTOM],
    [CELL_RIB_HALF, CELL_RIB_BOTTOM],
    [CELL_RIB_HALF, ribCorner],
    [0, CELL_RIB_APEX],
    [-CELL_RIB_HALF, ribCorner]
  ]
  const ribSections = [0, 1, 2, 3, 4].map((k): [number, number][] => {
    const n = (k + 1) % 5
    return [O[k], O[n], I[n], I[k]]
  })
  const xs: [number, number] = [CELL_X_BACK, CELL_X_MOUTH]
  return [
    cellBox('cellFloor', xs, [-CELL_Y, CELL_Y], [CELL_Z_FLOOR - CELL_SKIN, CELL_Z_FLOOR]),
    cellBox('cellWall', xs, [CELL_Y, outerY], [CELL_Z_FLOOR - CELL_SKIN, CELL_Z_JUNCTION]),
    cellBox('cellWall', xs, [-outerY, -CELL_Y], [CELL_Z_FLOOR - CELL_SKIN, CELL_Z_JUNCTION]),
    cellPrism('cellRoof', roof, xs[0], xs[1]),
    cellPrism('cellRoof', mirrorSectionY(roof), xs[0], xs[1]),
    cellPrism('cellBackSkin', backSkin, CELL_BACK_SKIN_X0, CELL_X_BACK),
    ...CELL_RIBS.flatMap(([x0, x1]) =>
      ribSections.map((section) => cellPrism('cellRib', section, x0, x1))
    ),
    cellBox('cellBaseTube', CELL_BASE_TUBE.x, CELL_BASE_TUBE.y, CELL_BASE_TUBE.z),
    cellBox('cellStandoff', CELL_STANDOFF.x, CELL_STANDOFF.y, CELL_STANDOFF.z),
    cellBox(
      'cellStandoff',
      CELL_STANDOFF.x,
      [-CELL_STANDOFF.y[1], -CELL_STANDOFF.y[0]],
      CELL_STANDOFF.z
    )
  ]
}
const CELL_TRAY_PLUS_X = cellTrayParts()

const CELL_13: FieldStructure = {
  ...box('hiveCell', [-0.392175, 0, 0.139825], CELL_SIZE, [0, 0, 0], HIVE_CELL, DISPLAY, 'hiveRed'),
  parts: CELL_TRAY_PLUS_X.map(mirrorPart)
}
const CELL_14: FieldStructure = {
  ...box('hiveCell', [0.392175, 0, 0.139825], CELL_SIZE, [0, 0, 0], HIVE_CELL, DISPLAY, 'hiveRed'),
  parts: CELL_TRAY_PLUS_X
}

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
// should be the one tilted down"), 넘어감은 피벗 둘레 60° 강체 회전(+30°). 두 멈춤(±30°, 댐퍼가 끝까지 눌림)
// [확인: FAC 1.13 위로 선 CELL 입구 밑이 타일 위 53.5 ± 0.5 in = CAD ±30°에서 53.41–53.47 in].
// 시작 상태는 개인 실행 설정(hiveState)이고, 경기 요소(공)가 있는 실행에서는 6b 동역학(dynamics)으로 움직인다
const HIVE_RED: FieldHive = {
  key: 'hiveRed',
  pivot: { x: 0, y: -0.32385, z: 1.11633 },
  startAngle: -Math.PI / 6,
  tippedAngle: Math.PI / 6,
  dynamics: {
    // 질량 × 축에서 무게중심까지(kg·m) [결정: 공식 보정표(EFG §12.3)의 안 넘어감(3N+2P·7P)과 넘어감(3N+3P·8P) 받침 토크 창
    // [0.042020, 0.047978]·g의 가운데를 멈춤(30°)에서 받치는 값 0.044999/sin 30°, spec-6b 부록 B. 시뮬레이터가 접촉 모델로 다시
    // 쟀다(elements/hive.test.ts: 보정표 짐을 트레이에 놓고 이분법): 안 넘어가야 할 줄(3N+2P·7P, 놓기·던지기)은 massMoment 0.0857
    // 미만에서, 넘어가야 할 줄(3N+3P·8P)은 0.0938 이상에서 안 넘어간다. 모든 줄을 만족하는 창 [0.0857, 0.0938]의 가운데 0.0897이
    // 0.0900과 0.3 % 안이라 그대로 둔다(놓기만 보면 창 [0.0818, 0.0938]). 던지기 = 그 자리 위 0.3 m에서 1 m/s로 아래로 [가정:
    // spec-6b §10]]. CAD 형상 × AndyMark 무게로 잰 값(아래 관성과 같은 방법)은 0.154 kg·m(무게중심 z_b 0.058 m)라 보정값이
    // 그보다 작다(실제 HIVE는 와셔로 보정한다, EFG §12.4)
    massMoment: 0.09,
    // 축 둘레 관성(kg·m²) [가정: AndyMark 배송 무게(CELL 약 1.09 kg, 축 조립체 0.48 kg, HIVE 2.67 kg)를 부록 A.1 형상에 고르게
    // 나눠 ∫(x_b² + z_b²) dm, docs/research/6b/cad-scripts/inertia.py 0.3861]
    inertia: 0.386,
    // 축 쿨롱 마찰 토크(N·m) [가정: F608ZZ 차폐 베어링 둘, 출처 없음. 보정 창 반폭 0.0292 N·m보다 작아야 한다]
    pivotFriction: 0.005
  },
  // 축 조립체(베어링 판 둘·축·댐퍼 받침)를 상자 하나로 [가정: |x_b| ≤ 0.175, |y_b| ≤ 0.0191, z_b [−0.0689, 0.0222], 공식 필드 CAD
  // #902·#919·#883 경계]. 고정된 A-Frame 꼭대기·축 받침은 공에 두지 않는다 [가정]
  parts: [
    {
      shape: {
        kind: 'box',
        center: { x: 0, y: 0, z: -0.02335 },
        rotation: { x: 0, y: 0, z: 0 },
        size: { x: 0.35, y: 0.0382, z: 0.0911 }
      },
      robots: false,
      balls: true,
      key: 'hivePivot'
    }
  ]
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

// FLOWER POLLEN 4개씩(EFG §11.2 "bottom most Pollen sitting on the tiles inside the Flower Bottom Ring and each subsequent Pollen
// resting on the one below", CM 10.3.1): 축 위에 서로 닿은 기둥(z = r, 3r, 5r, 7r)이고 잠든 채 시작한다 [결정: EFG는 지그재그
// 배치를 정하지 않는다. 공식 CAD 배치도 축 위 기둥이다(공 사이 0.124 in 틈은 CAD 배치라 닿게 했다), cad-geometry-notes B)]
function flowerColumn(axis: Vec2): FieldElementPlacement[] {
  return [0, 1, 2, 3].map((k) => ({
    group: 'flower',
    kind: 'pollen',
    position: { x: axis.x, y: axis.y, z: POLLEN_RADIUS * (1 + 2 * k) }
  }))
}
const FLOWER_9_POLLEN = flowerColumn(FLOWER_9_AXIS)
const FLOWER_11_POLLEN = flowerColumn(rotateQuarter(FLOWER_9_AXIS))

// 위로 향한 CELL의 NECTAR 3개(CM 10.3.1 "placed contacting the back wall of the CELL and in a line against the side closest to the
// ALLIANCE AREA of corresponding color", EFG §11.1): 빨강 HIVE 몸체 틀에서 Back Skin과 밑판에 닿고 빨강 벽(−Y) 쪽 옆벽부터 서로
// 닿게 한 줄(x_b = Back Skin + r, z_b = 밑판 + r, y_b = −옆벽 + r·(1 + 2k)). 빨강 시작('start', θ −30°)은 +X CELL이 위다.
// 넘어간 채 시작('tipped', θ +30°)하면 −X CELL이 위이고 자리는 그 (x, y) → (−x, y) 상이다: 두 시작 상태 모두 빨강 NECTAR는 빨강
// ALLIANCE AREA 쪽(빨강 벽, −y_b) 옆벽에 붙는다 [확인: CM 10.3.1 "in a line against the side closest to the ALLIANCE AREA of
// corresponding color". 몸체 틀 y_b는 필드 +Y라 HIVE가 넘어가도 −y_b가 빨강 벽 쪽이다. −X CELL 트레이는 +X의 (x, y) → (−x, −y)
// 상이지만 y로 대칭이라 같은 자리에 닿는다]. 빨강 HIVE에는 빨강 NECTAR, 파랑은 mirrorElementPlacement(파랑 벽 +y_b 쪽)
const RED_HIVE_NECTAR_START: FieldElementPlacement[] = [0, 1, 2].map((k) => ({
  group: 'hiveCell',
  kind: 'nectarRed',
  position: {
    x: CELL_X_BACK + NECTAR_RADIUS,
    y: -CELL_Y + NECTAR_RADIUS * (1 + 2 * k),
    z: CELL_Z_FLOOR + NECTAR_RADIUS
  },
  carrier: 'hiveRed',
  when: 'start'
}))
const RED_HIVE_NECTAR_TIPPED: FieldElementPlacement[] = RED_HIVE_NECTAR_START.map((p) => ({
  group: 'hiveCell',
  kind: 'nectarRed',
  position: { x: neg(p.position.x), y: p.position.y, z: p.position.z },
  carrier: 'hiveRed',
  when: 'tipped'
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
    // 배열 순서 = 공 번호(spec-6b §1.2): GARDEN(빨강 4, 파랑 4: 6a와 같은 번호 0–7) → FLOWER 9·10·11·12 × 4(아래부터) →
    // hiveCell(빨강 시작 3, 빨강 넘어간 시작 3, 파랑 시작 3, 파랑 넘어간 시작 3; 실행에는 시작 상태에 맞는 쪽만 생긴다)
    layout: [
      ...RED_GARDEN_POLLEN,
      ...RED_GARDEN_POLLEN.map(mirrorElementPlacement),
      ...FLOWER_9_POLLEN,
      ...FLOWER_9_POLLEN.map(mirrorElementPlacement),
      ...FLOWER_11_POLLEN,
      ...FLOWER_11_POLLEN.map(mirrorElementPlacement),
      ...RED_HIVE_NECTAR_START,
      ...RED_HIVE_NECTAR_TIPPED,
      ...RED_HIVE_NECTAR_START.map(mirrorElementPlacement),
      ...RED_HIVE_NECTAR_TIPPED.map(mirrorElementPlacement)
    ]
  }
})
