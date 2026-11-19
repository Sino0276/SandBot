import type {
  FieldElementPlacement,
  FieldPart,
  FieldSpec
} from '../../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import {
  mirrorElementPlacement,
  mirrorHive,
  mirrorPart,
  mirrorStructure
} from '../../../../shared/sim/seasons/symmetry'

// 렌더러 시험용 6b 시즌 판(시험만 쓴다): BIOBUZZ 부품·배치 데이터는 물리 쪽 커밋이 넣으므로, 렌더러 규칙(부품 그리기·색·윤곽·
// companion·HIVE 움직임·잔상·Field 인스펙터 공 수·편집 중 공)은 이 얕은 복사 판으로 본다. 값은 모양을 보기 위한 것이고 공식
// 측정값이 아니다(fieldParts.test.ts와 같은 FLOWER 9 축, spec-6b 부록 A.2).

const BIOBUZZ = resolveSeason('biobuzz')
export const FLOWER = 9
export const FLOWER_MIRROR = 10
// 빨강 HIVE CELL(−X 13, +X 14)과 파랑 짝(15, 16)
export const CELL_MINUS = 13
export const CELL_PLUS = 14
const AXIS = { x: -1.728254, y: -0.59418 }
const zero = { x: 0, y: 0, z: 0 }

// FLOWER 9: 공 조각(아래 고리 조각 볼록 기둥, 관 원기둥, 백스톱 상자)과 로봇 전용 판(그리지 않는다)
export const FLOWER_PARTS: readonly FieldPart[] = [
  {
    shape: {
      kind: 'prism',
      center: { x: AXIS.x, y: AXIS.y, z: 0.004496 },
      rotation: zero,
      polygon: [
        { x: 0.0387, y: -0.0077 },
        { x: 0.06, y: -0.0119 },
        { x: 0.06, y: 0.0119 },
        { x: 0.0387, y: 0.0077 }
      ],
      height: 0.008992
    },
    robots: false,
    balls: true,
    key: 'flowerRingBottom'
  },
  {
    shape: {
      kind: 'prism',
      center: { x: AXIS.x, y: AXIS.y, z: 0.004496 },
      rotation: zero,
      polygon: [
        { x: -0.05, y: -0.05 },
        { x: 0.05, y: -0.05 },
        { x: 0.05, y: 0.05 },
        { x: -0.05, y: 0.05 }
      ],
      height: 0.008992
    },
    robots: true,
    balls: false,
    key: 'flowerRingBottom'
  },
  {
    shape: {
      kind: 'cylinder',
      center: { x: AXIS.x + 0.043815, y: AXIS.y + 0.043815, z: 0.323952 },
      rotation: zero,
      radius: 0.013343,
      height: 0.4318
    },
    robots: true,
    balls: true,
    key: 'flowerPipe'
  },
  {
    shape: {
      kind: 'box',
      center: { x: AXIS.x - 0.054, y: AXIS.y, z: 0.572237 },
      rotation: { x: 0, y: 0, z: Math.PI / 4 },
      size: { x: 0.008865, y: 0.0508, z: 0.00635 }
    },
    robots: true,
    balls: true,
    key: 'flowerBackstop'
  }
]

// +X CELL 트레이 일부(빨강 HIVE 몸체 틀): 밑판 상자와 오각형 Back Skin(볼록 기둥, 자기 z = 몸체 +x)
export const CELL_PARTS: readonly FieldPart[] = [
  {
    shape: {
      kind: 'box',
      center: { x: 0.3921, y: 0, z: -0.03754 },
      rotation: zero,
      size: { x: 0.30526, y: 0.51201, z: 0.000508 }
    },
    robots: false,
    balls: true,
    key: 'cellFloor'
  },
  {
    shape: {
      kind: 'prism',
      center: { x: 0.239471, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      polygon: [
        { x: 0.04719, y: -0.26589 },
        { x: 0.04719, y: 0.26589 },
        { x: -0.163576, y: 0.26589 },
        { x: -0.33198, y: 0 },
        { x: -0.163576, y: -0.26589 }
      ],
      height: 0.000508
    },
    robots: false,
    balls: true,
    key: 'cellBackSkin'
  }
]

// −X CELL은 몸체 틀에서 (x, y) → (−x, −y)(Rz(π), 부록 A.1)
const CELL_MINUS_PARTS = CELL_PARTS.map(mirrorPart)

// 빨강 HIVE 축 조립체(부록 A.1 축 조립체 상자)
export const HIVE_PARTS: readonly FieldPart[] = [
  {
    shape: {
      kind: 'box',
      center: { x: 0, y: 0, z: -0.02335 },
      rotation: zero,
      size: { x: 0.35, y: 0.0382, z: 0.0911 }
    },
    robots: false,
    balls: true,
    key: 'hivePivot'
  }
]

// 시작 배치: FLOWER 9 안 POLLEN 둘(쌓임)과 빨강 위로 향한 CELL NECTAR(시작 상태면 +X CELL, 넘어간 채 시작하면 −X CELL), 파랑은 거울
const pollen = (z: number): FieldElementPlacement => ({
  group: 'flower',
  kind: 'pollen',
  position: { x: AXIS.x, y: AXIS.y, z }
})
const nectar = (when: 'start' | 'tipped'): FieldElementPlacement => ({
  group: 'hiveCell',
  kind: 'nectarRed',
  position: { x: when === 'start' ? 0.29 : -0.29, y: 0, z: 0.0084 },
  carrier: 'hiveRed',
  when
})
const RED_LAYOUT: readonly FieldElementPlacement[] = [
  pollen(0.03555),
  pollen(0.1066),
  nectar('start'),
  nectar('tipped')
]

// BIOBUZZ에 위 부품·배치를 더한 판(배치는 GARDEN 뒤에 FLOWER → hiveCell, spec-6b §1.2 순서)
export function partsSpec(): FieldSpec {
  const structures = BIOBUZZ.structures.map((structure, index) => {
    if (index === FLOWER) return { ...structure, parts: FLOWER_PARTS }
    if (index === FLOWER_MIRROR)
      return mirrorStructure({ ...BIOBUZZ.structures[FLOWER], parts: FLOWER_PARTS })
    if (index === CELL_PLUS) return { ...structure, parts: CELL_PARTS }
    if (index === CELL_MINUS) return { ...structure, parts: CELL_MINUS_PARTS }
    if (index === CELL_PLUS + 2)
      return mirrorStructure({ ...BIOBUZZ.structures[CELL_PLUS], parts: CELL_PARTS })
    if (index === CELL_MINUS + 2)
      return mirrorStructure({ ...BIOBUZZ.structures[CELL_MINUS], parts: CELL_MINUS_PARTS })
    return structure
  })
  const red = { ...BIOBUZZ.hives[0], parts: HIVE_PARTS }
  const flower = RED_LAYOUT.filter((p) => p.group === 'flower')
  const cell = RED_LAYOUT.filter((p) => p.group === 'hiveCell')
  const layout = [
    ...BIOBUZZ.elements!.layout,
    ...flower,
    ...flower.map(mirrorElementPlacement),
    ...cell,
    ...cell.map(mirrorElementPlacement)
  ]
  return {
    ...BIOBUZZ,
    structures,
    hives: [red, mirrorHive(red)],
    elements: { ...BIOBUZZ.elements!, layout }
  }
}
