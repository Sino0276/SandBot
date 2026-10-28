// 필드 치수(미터). 씬 뷰의 필드 그림(renderer editor/scene/FieldFloor.tsx)과 운동학 시뮬레이터의 벽(world.ts)이 같이 쓴다.
// 공칭 12 ft 필드다. 실제 필드는 벽 두께와 타일 이음새 때문에 조금 작다. 필드 X·Y축이 어느 벽을 향하는지는 아직 정하지
// 않았으므로(시즌별) 벽은 원점 대칭으로만 둔다.

const INCH = 0.0254

export const FIELD_SIZE = 144 * INCH
export const WALL_THICKNESS = 0.025
export const WALL_HEIGHT = 0.3

// 벽 안쪽 면의 반폭: 벽은 필드 가장자리(±FIELD_SIZE/2)를 가운데로 두께만큼 걸쳐 있다
export const WALL_INNER_HALF = FIELD_SIZE / 2 - WALL_THICKNESS / 2
