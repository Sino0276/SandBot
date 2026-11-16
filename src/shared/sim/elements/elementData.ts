import type { FieldElementType, FieldSpec } from '../seasons/fieldSpec'
import type { SimElementKind } from '../worldSpec'

// 움직이는 경기 요소(6a: POLLEN·NECTAR 공, spec-6a §1·§2)의 상수. 순수 TS다. 공 하나의 물리 값(반지름·질량·관성·접촉·공기)은
// 시즌 데이터(seasons/<시즌>.ts FieldSpec.elements.types)이고, 여기에는 시즌과 관계없는 풀이·잠들기·다시 넣기 값만 둔다.
// 실측 없는 값은 [가정]이고 docs/assumptions.md 6a 표에도 적는다.

// 세계 설명 한도(worldSpec.ts가 정하고 여기서 다시 내보낸다: 메인 검증과 같은 값 한곳)
export { ELEMENT_GROUPS, ELEMENT_KINDS, MAX_PRELOADS, MAX_WORLD_ELEMENTS } from '../worldSpec'

// 로봇 섬(로봇에 닿은 공을 로봇 LCP에 묶는 Schur 보수)의 공 행 한도. 넘는 공은 로봇(풀이 뒤 속도)에 한쪽으로 풀고
// elementCouplingLimit [결정: 결합 8개 하위 단계 1.5 ms 예산(spec-6a §2.7). 바닥에서 로봇에 닿은 공 하나는 로봇·바닥 짝 둘로
// 6행(법선 + 접선 둘)이고 붙은 공끼리 짝이 공마다 하나 꼴로 3행씩 더해진다(두 줄로 놓인 8개 P4는 66행). 그런데 인테이크가 벽에
// 끼운 공은 섀시 앞면·롤러·벽·바닥·이웃 공에 함께 닿아 15–18행이라, 실제 앱 E2E 쐐기(GARDEN 넷 + 바구니 프리로드 넷)는 84행이었다.
// 6a 리뷰 2에서 72를 96으로 올려 그 쐐기를 한쪽 풀이 없이 담는다(정확도: 로봇이 끼인 공을 모두 느낀다. 쐐기 첫 하위 단계는 72일
// 때보다 빨랐다, P6). 6a 리뷰 전의 48(= 8 × 6)은 공끼리 짝을 세지 않아 붙어 있는 8개를 담지 못했다]
export const MAX_COUPLED_ROWS = 96
// 공끼리 섬의 조밀 LCP 행 한도. 넘으면 고정 횟수 PGS로 풀고 elementIslandLarge [결정: 조밀 풀이 비용 O(n³)]
export const ISLAND_DENSE_ROWS = 60
// 큰 섬의 PGS 반복 수(고정, 행 순서) [결정]
export const PGS_SWEEPS = 30
// 잠들기: 속력 |v|와 |ω|·r이 이보다 작은 상태가 SLEEP_TIME 넘게 이어진 섬은 잠든다(속도 정확히 0)
// [가정: 5 mm/s·0.5 s] 쉬는 공의 반올림 떨림보다 크고 눈에 띄는 굴림보다 작다
export const SLEEP_SPEED = 5e-3
export const SLEEP_TIME = 0.5
// 이 법선 접근 속도(m/s) 아래면 반발하지 않는다(쉬는 공이 튀지 않게) [가정: Box2D·Box3D restitution threshold 1 m/s보다
// 작은 공 크기 어림]
export const V_BOUNCE = 0.25
// 접선 행의 순응 γ_t = TANGENT_COMPLIANCE_RATIO / m [가정: 정지 마찰이 미끄럼 없이 붙되 LCP 조건수를 낮추는 작은 값]
export const TANGENT_COMPLIANCE_RATIO = 0.01
// 공기 밀도(kg/m³, 20 °C 해수면) [가정: 대회장 실내 공기]
export const AIR_DENSITY = 1.2
// 필드 밖 공을 경기 요원이 다시 넣기까지(ns) [가정: 3 s, 사용자 결정 11/13] 규칙(CM 10.8.2)은 시간을 정하지 않는다
export const REENTRY_DELAY_NANOS = 3_000_000_000
// 공 중심이 이 높이(m)보다 낮으면 필드 밖(바닥을 뚫음) [결정: 벽 바닥 깊이 WALL_BASE_DEPTH와 같다]
export const OUT_OF_FIELD_Z = -0.05
// 자리(프리로드 자동 배치·다시 넣기) 사이와 벽·로봇 외곽에서 띄우는 간격(m) [결정: 놓은 공이 겹치지 않을 만큼, 반올림 여유]
export const SLOT_GAP = 5e-4
// 넓은 단계 격자 칸(m) [결정: POLLEN 지름 0.071 m의 두 배 안쪽, 3×3 칸 질의]
export const BROAD_PHASE_CELL = 0.125
// 부드러운 법선 행의 감쇠비 ζ(c = 2ζ√(k·m)) [가정: 임계 감쇠 1. 위플 공 판 시험의 감쇠 측정이 없어 튀지 않고 가장 빨리 가라앉는 값]
export const CONTACT_DAMPING_RATIO = 1
// 끼임: 접촉의 법선(공 쪽으로)과 같은 공의 다른 접촉 법선의 내적이 이보다 작으면(서로 반대쪽, 약 90.6° 넘게 벌어짐) 그 행은 끼여
// 있고 반발 두 단계 대신 이력 스프링을 쓴다(elementWorld.ts pinchedContacts, ballContact.ts normalRow) [결정: 바닥과 벽처럼 직각인 두 면은 끼임이 아니다. 0보다 조금 아래라 껍질 GJK
// 법선의 반올림이 직각 짝을 끼임으로 만들지 않는다]
export const PINCH_NORMAL_DOT = -0.01
// 접촉점 하나의 스프링 = 판 강성 × 이 값 [결정: 판 강성은 공을 두 판 사이에 끼운 직렬 접촉 둘이라 접촉 하나는 그 두 배]
export const CONTACT_STIFFNESS_PER_PLATE = 2

// 시즌의 공 종류(FieldSpec.elements.types에서). 시즌에 경기 요소가 없거나 그 종류가 없으면 null
export function resolveElementType(
  field: FieldSpec,
  kind: SimElementKind
): FieldElementType | null {
  return field.elements?.types.find((t) => t.kind === kind) ?? null
}
