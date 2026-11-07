import { WALL_HEIGHT, WALL_INNER_HALF, WALL_THICKNESS } from '../field'
import { BIOBUZZ_PANEL_INSET, BIOBUZZ_PANEL_SEAMS, PANEL, RAIL, TILE_GRAY } from './biobuzz'
import { deepFreeze, type FieldSpec } from './fieldSpec'

// 'none' 시즌(spec-4ab §1.2, synthesis §9.3): 3c까지의 공칭 12 ft 근사(field.ts)다. 축의 뜻이 없고(벽 라벨 없음) 벽은
// 원점 대칭이며 구조물·태그·프리셋이 없다. 시뮬레이터는 3c와 바이트까지 같아야 하므로 벽 치수는 field.ts의 상수를 그대로
// import한다(숫자를 다시 적지 않는다, 같은 double).

const INCH = 0.0254

export const NONE_FIELD: FieldSpec = deepFreeze<FieldSpec>({
  season: 'none',
  walls: null,
  perimeter: {
    innerHalf: WALL_INNER_HALF,
    height: WALL_HEIGHT,
    thickness: WALL_THICKNESS,
    panelInset: BIOBUZZ_PANEL_INSET,
    // BIOBUZZ 레일 단면(아래 띠 그대로, 위 띠 두께 0.29576 − 0.26604)을 높이 WALL_HEIGHT에 맞춰 올린 것
    railBands: [
      [-0.01496, 0.01476],
      [WALL_HEIGHT - (0.29576 - 0.26604), WALL_HEIGHT]
    ],
    panelSeams: BIOBUZZ_PANEL_SEAMS,
    rail: RAIL,
    panel: PANEL
  },
  // 24 in 타일 이음(k = −2…2). 씬 뷰 FieldFloor가 그리는 선과 같다(renderer TILE_SIZE를 import하지 않는다)
  floor: {
    seams: [-2, -1, 0, 1, 2].map((k) => k * 24 * INCH),
    // 회색 타일 재질, 표시 색은 FieldFloor 그대로
    material: { ...TILE_GRAY, display: '#3b3e45' }
  },
  tape: [],
  zones: [],
  hives: [],
  structures: [],
  aprilTags: { family: 'tag36h11', tags: [] },
  startKeepOut: [],
  startPresets: []
})
