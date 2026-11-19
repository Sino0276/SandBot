import type { Object3D } from 'three'
import { hiveDisplayAngle } from '../../../../shared/sim/elements/gameState'
import { simGameOf, type PlayData } from '../../play/playStore'
import { runLocksField } from '../field/fieldDisplay'

// 실행 중 씬 뷰의 HIVE(6b, spec-6b §8). 시뮬레이터 HIVE 각(gameState hives, 약 60 Hz)은 React로 다시 그리지 않고 carrier 그룹
// 안쪽의 움직임 그룹에 명령형으로 쓴다(로봇 자세 poseDisplay.ts bindPoseDisplay와 같은 방식). 바깥 carrier 그룹은 모델 각(그
// 실행의 시작 상태, 잠기지 않으면 개인 실행 설정 hiveState)을 R3F props로 갖고, 안쪽 그룹은 R3F가 회전 props를 갖지 않아 여기서
// θ_sim − θ_model을 쓰고 끝날 때 0으로 되돌린다. 필드 CAD와 함께 그릴 때(companion)는 CAD의 HIVE가 넘어가지 않은 자세로 고정이라
// HIVE 몸체(CELL·축 조립체)를 지금 각이 넘어가지 않은 각에서 벗어났을 때만 보인다.

type PlaySource = {
  getState: () => Pick<PlayData, 'run' | 'simGame'>
  subscribe: (
    listener: (
      state: Pick<PlayData, 'run' | 'simGame'>,
      previous: Pick<PlayData, 'run' | 'simGame'>
    ) => void
  ) => () => void
}

// 각이 같다고 보는 차(rad). 시뮬레이터 각은 1e-4 rad 정수로 오므로(gameState quantizeHives) 넘어가지 않은 각 −π/6이 −0.5236으로
// 와도(1.2e-6 차) 같은 자세다 [결정: 표시만, 각 정수 단위와 같은 값]
export const HIVE_ANGLE_EPSILON = 1e-4

// 움직임 그룹을 시뮬레이터에 묶는가: 필드를 잠근 실행이 경기 요소(공)를 켰을 때(꺼진 실행의 HIVE는 시작 상태로 고정이다)
export function hiveMotionBound(data: Pick<PlayData, 'run'>): boolean {
  return runLocksField(data.run) && data.run.field.gameElements === true
}

// HIVE k의 시뮬레이터 표시 각(rad). 지금 실행의 표시 상태에 HIVE 각이 없으면 null(모델 각으로 그린다)
export function simHiveAngle(data: Pick<PlayData, 'run' | 'simGame'>, k: number): number | null {
  return hiveDisplayAngle(simGameOf(data)?.hives, k)
}

// 넘어가지 않은 자세의 CAD 위에 단순 HIVE 몸체를 보일 각인가(필드 CAD는 넘어가지 않은 HIVE를 그린다, spec-4e §1.6)
export function hiveBodyShownOverCad(angle: number, startAngle: number): boolean {
  return Math.abs(angle - startAngle) > HIVE_ANGLE_EPSILON
}

export type HiveDisplayTarget = {
  // carrier 그룹 안쪽의 움직임 그룹(회전 y만 쓴다)
  motion: Object3D
  // companion일 때 HIVE 몸체를 담은 그룹(보이기만 바꾼다). 없으면 null
  body: Object3D | null
  // FieldSpec.hives 순번
  index: number
  // 바깥 carrier 그룹의 각(R3F props)
  modelAngle: number
  // FieldHive.startAngle(넘어가지 않은 자세)
  startAngle: number
}

function apply(target: HiveDisplayTarget, angle: number | null): void {
  target.motion.rotation.y = angle === null ? 0 : angle - target.modelAngle
  if (target.body)
    target.body.visible = hiveBodyShownOverCad(angle ?? target.modelAngle, target.startAngle)
}

// 움직임 그룹을 묶는다. source가 null이면(묶지 않는 때: 실행 없음·잠그지 않음·경기 요소 끔) 모델 각을 적용하고 끝이다. 아니면
// 붙자마자 지금 각을 적용하고(StrictMode가 정리한 뒤 다시 붙여도 같은 자세), 표시 상태가 바뀌어 각이 달라질 때만 적용하고
// 다시 그리기를 요청한다(frameloop demand). 돌려준 함수는 구독을 풀고 모델 각으로 되돌린다.
export function bindHiveDisplay(
  target: HiveDisplayTarget,
  source: PlaySource | null,
  invalidate: () => void
): () => void {
  let applied = source ? simHiveAngle(source.getState(), target.index) : null
  apply(target, applied)
  invalidate()
  if (!source)
    return () => {
      apply(target, null)
      invalidate()
    }
  const unsubscribe = source.subscribe((state, previous) => {
    if (state.simGame === previous.simGame && state.run === previous.run) return
    const angle = simHiveAngle(state, target.index)
    if (angle === applied) return
    applied = angle
    apply(target, angle)
    invalidate()
  })
  return () => {
    unsubscribe()
    apply(target, null)
    invalidate()
  }
}

// 끝난 실행의 HIVE 잔상 각(ghostGame hives). 보이는 모델 각과 같으면(HIVE_ANGLE_EPSILON 안) null: 잔상이 지금 HIVE와 겹친다
export function hiveGhostAngle(
  hives: readonly number[] | undefined,
  k: number,
  modelAngle: number
): number | null {
  const angle = hiveDisplayAngle(hives, k)
  if (angle === null || Math.abs(angle - modelAngle) <= HIVE_ANGLE_EPSILON) return null
  return angle
}
