import type { Articulation, ContactRow } from './articulation'
import type { FieldSpec } from './seasons/fieldSpec'
import type { WorldSpec } from './worldSpec'

// 몸체 충돌 행(spec-5 §4.2): 섀시·관절 몸체의 3D 충돌체가 필드 벽(높이까지, 윗면)·고정 구조물·바닥(관절 몸체)·같은 로봇의 다른
// 몸체와 부딪히는 행을 하위 단계마다 만든다. 행은 벽·구조물과 같은 규칙이다(예측 간격 목표 −max(gap, 0)/h, 반발·위치 보정
// 없음, 마찰은 짝마다 패치: 접선 둘 + 비틀림). 새 행 키는 모두 'c'로 시작한다(부록 B).
//
// 계약 커밋: 상수·bodyCollisionNeeded·클래스 서명만 있다(생성자는 던진다, world.ts는 아직 부르지 않는다). 5 A가 구현한다.
// DEFAULT_COLLIDER_FRICTION·FLOOR_FRICTION은 worldSpec.ts에 둔다(렌더러와 함께 쓴다).

// 예측 띠의 여유(m) = contact.ts WALL_MARGIN
export const COLLISION_MARGIN = 1e-3
// 특징(기준 면·모서리) 히스테리시스(m) = fieldContact.ts REFERENCE_TOLERANCE
export const FEATURE_TOLERANCE = 5e-4
// 섀시–정적 짝의 수평 자리 합치기 공차(m, spec-5 §1.7)
export const CHASSIS_MERGE_TOLERANCE = FEATURE_TOLERANCE
// 거의 나란한 모서리 짝 건너뛰기(Box3D B3_PARALLEL_EDGE_TOL, convex_manifold.c:140)
export const PARALLEL_EDGE_TOLERANCE = 0.005
// 짝마다 점(Box3D B3_MAX_MANIFOLD_POINTS)과 행(법선 4 + 접선 둘 + 비틀림 하나)
export const MAX_MANIFOLD_POINTS = 4
export const MAX_PAIR_ROWS = 7
// 한 하위 단계의 충돌 행 [P-M10, 결정: 4짝 × 7. LCP 측정에서 행 ~70이면 한 풀이가 수십 ms]
export const MAX_COLLISION_ROWS = 28
// 이보다 작은 ‖j‖²의 행은 넣지 않는다(solveBoxLcp는 대각 ≤ 0이면 던진다, M§5 함정 5)
export const MIN_ROW_NORM2 = 1e-12
// 섀시–정적 짝의 수평 법선 성분 하한 [가정: 75.5° 넘게 누운 면은 섀시에 행이 없다. BIOBUZZ 다리 면 |n_h| ≈ 0.89, M§5 함정 4]
export const MIN_HORIZONTAL_NORMAL = 0.25
// 미끄러짐 방향으로 접선을 고르는 상대 속도 문턱(m/s, Bullet 속도 방향 마찰, M§5 함정 7)
export const SLIP_DIRECTION_SPEED = 1e-3
// 지난 t1을 새 접선 평면에 투영한 길이가 이 이상이면 그 방향을 이어 쓴다 [P-L22, 결정: M§5 함정 7 중간 단계]
export const TANGENT_KEEP_MIN = 0.5
// 패치 중심 무게 하한 [가정: Box3D relax 무게, spec-5 §1.6]
export const PATCH_WEIGHT_MIN = 1e-3
// 바닥·윗면 마찰 하중 상한(h·W)을 거는 정적 법선의 z 하한 [P-M8, 가정]
export const UPWARD_NORMAL_Z = 0.5
// 실행 중 겹침 알림(collisionOverlap) 깊이(m) [사용자 결정 11/10]
export const OVERLAP_NOTICE_DEPTH = 1e-3
// 벽 상자를 바닥 아래로 늘이는 깊이(m) [결정: 벽 밑면이 분리 축으로 뽑히지 않게. 바닥 아래에는 아무것도 없다]
export const WALL_BASE_DEPTH = 0.05

// 형상이 있는 세계인지: 섀시 충돌체 칸이 있거나(빈 배열도) 관절 하나라도 충돌체가 있다. 아니면 5 전과 같은 경로다(바이트 보존)
export function bodyCollisionNeeded(spec: WorldSpec): boolean {
  return (
    spec.robot.colliders !== undefined || spec.joints.some((j) => (j.colliders?.length ?? 0) > 0)
  )
}

export type BodyCollisionNotice = {
  code: 'collisionOverlap' | 'collisionLimit' | 'collisionLift' | 'worldError'
  params: Record<string, string>
}

export class BodyCollision {
  // 섀시가 3D 경로인지(spec.robot.colliders !== undefined)
  readonly chassis3d: boolean

  constructor(spec: WorldSpec, field: FieldSpec) {
    void spec
    void field
    throw new Error('5-A')
  }

  // 이번 하위 단계의 행(z 공간, 길이 m). blocking: 섀시–정적 법선 행(blocked 판정). upward: §1.6 상한 대상 법선 행 키
  rows(
    art: Articulation,
    h: number,
    m: number
  ): {
    rows: ContactRow[]
    blocking: ContactRow[]
    upward: string[]
    notices: BodyCollisionNotice[]
  } {
    void art
    void h
    void m
    throw new Error('5-A')
  }

  // art.step 뒤에 부른다: upward 법선 충격 합으로 collisionLift 지연을 센다(§1.6)
  afterStep(art: Articulation, h: number): BodyCollisionNotice[] {
    void art
    void h
    throw new Error('5-A')
  }
}
