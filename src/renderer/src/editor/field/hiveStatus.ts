import { GAME_POSE_SCALE, hiveDisplayTips } from '../../../../shared/sim/elements/gameState'
import type { FieldHiveKey } from '../../../../shared/sim/seasons/fieldSpec'
import { simGameOf, type PlayData } from '../../play/playStore'
import { runLocksField } from './fieldDisplay'

// Field 인스펙터 HIVE 줄(6b, spec-6b §8): 필드를 잠근 실행 중에는 시뮬레이터 HIVE의 지금 각과 그 실행에서 넘어간 횟수
// (gameState hives·hiveTips), STOP 뒤 다음 INIT까지는 끝난 각과 횟수다. 끝난 줄은 그 실행의 HIVE 끝 상태(gameState finalHives →
// lastRunElements.hives, 전체 정밀도)가 있으면 그것이고, 없으면(끝 상태를 싣지 못하고 끝남) 끝난 실행의 잔상(ghostGame, 씬 뷰
// HIVE 잔상과 같은 표시 상태)이다. lastRunElements는 6d 이음새라 다음 INIT에도 남으므로 지금 run(끝난 실행)의 것일 때만 쓰고,
// 다음 INIT은 run과 ghostGame을 바꿔 줄이 사라진다. 각은 0.1° 단위 정수로 줄여 두어 인스펙터가 약 60 Hz 표시 상태마다 다시
// 그리지 않고 보이는 글자가 바뀔 때만 다시 그린다.

// rad → 0.1° 단위(인스펙터는 ° 소수 한 자리로 보인다)
const DECI_DEGREES = 1800 / Math.PI

export type HiveStatus = {
  // 'now' 실행 중, 'end' 끝난 실행
  phase: 'now' | 'end'
  // HIVE마다 [0.1° 정수, 넘어간 횟수](FieldSpec.hives 순서)
  values: readonly (readonly [number, number])[]
}

// 각(rad) → 0.1° 정수(−0 없이)
export function hiveDeciDegrees(angle: number): number {
  return Math.round(angle * DECI_DEGREES) + 0
}

// 표시 상태(1e-4 rad 정수 각과 횟수) → [0.1°, 횟수, …]
function displayValues(
  hives: readonly number[] | undefined,
  hiveTips: readonly number[] | undefined
): number[] {
  if (!hives || hives.length === 0) return []
  return hives.flatMap((angle, k) => [
    hiveDeciDegrees(angle / GAME_POSE_SCALE),
    hiveDisplayTips(hiveTips, k) ?? 0
  ])
}

// 끝난 실행의 [0.1°, 횟수, …](없으면 빈 목록)
function endValues(data: Pick<PlayData, 'run' | 'ghostGame' | 'lastRunElements'>): number[] {
  const last = data.lastRunElements
  if (data.run && last && last.runId === data.run.runId && last.hives && last.hives.length > 0)
    return last.hives.flatMap((hive) => [hiveDeciDegrees(hive.angle), hive.tips])
  return displayValues(data.ghostGame?.hives, data.ghostGame?.hiveTips)
}

// 스토어 선택자용 평평한 값: [단계(0 없음, 1 지금, 2 끝), 0.1° 정수, 횟수, …]. useShallow로 비교한다
export function hiveStatusKey(
  data: Pick<PlayData, 'run' | 'simGame' | 'ghostGame' | 'lastRunElements'>
): number[] {
  if (runLocksField(data.run)) {
    const game = simGameOf(data)
    const values = displayValues(game?.hives, game?.hiveTips)
    return values.length > 0 ? [1, ...values] : [0]
  }
  const values = endValues(data)
  return values.length > 0 ? [2, ...values] : [0]
}

// 평평한 값 → 줄. 없으면 null
export function hiveStatusOf(key: readonly number[]): HiveStatus | null {
  if (key[0] !== 1 && key[0] !== 2) return null
  const values: (readonly [number, number])[] = []
  for (let i = 1; i + 1 < key.length; i += 2) values.push([key[i], key[i + 1]])
  return { phase: key[0] === 1 ? 'now' : 'end', values }
}

// HIVE 이름의 번역 키(field.inspector.hiveRed·hiveBlue)
export function hiveLabelKey(
  key: FieldHiveKey
): 'field.inspector.hiveRed' | 'field.inspector.hiveBlue' {
  return key === 'hiveRed' ? 'field.inspector.hiveRed' : 'field.inspector.hiveBlue'
}
