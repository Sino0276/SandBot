// 필드 치수(미터): 공칭 144 in 둘레의 근사(안쪽 143.0 in), 'none' 시즌(seasons/none.ts). 씬 뷰의 'none' 필드 그림
// (renderer editor/scene/FieldFloor.tsx)과 시뮬레이터의 벽(world.ts)이 같이 쓴다. 시즌 필드는 seasons/에 있다.

const INCH = 0.0254

export const FIELD_SIZE = 144 * INCH
export const WALL_THICKNESS = 0.025
export const WALL_HEIGHT = 0.3

// 벽 안쪽 면의 반폭: 벽은 필드 가장자리(±FIELD_SIZE/2)를 가운데로 두께만큼 걸쳐 있다
export const WALL_INNER_HALF = FIELD_SIZE / 2 - WALL_THICKNESS / 2
