import { MAX_WORLD_ELEMENTS, type SimElementState } from '../worldSpec'

// 경기 요소 표시 상태(6a, spec-6a §5): 시뮬레이터 → 메인 → 렌더러 'gameState' 이벤트의 몸통. 공마다 위치 xyz와 사원수 wxyz를
// 1e-4 단위 정수로 줄인 7칸(필드 좌표, 0.1 mm·사원수 1e-4)과 비트 표식이다. 공 순서는 elementSpawns 순서(배치 → 프리로드)이고
// 실행 동안 바뀌지 않는다. revision은 줄인 값이나 표식이 바뀔 때만 는다(메인은 바뀐 것만 보낸다). 순수 TS다.

// 공 하나의 칸 수: x, y, z, qw, qx, qy, qz
export const GAME_POSE_STRIDE = 7
// 위치(m)와 사원수 성분의 정수 단위(값 × 이것을 반올림) [결정: 표시에 0.1 mm·1e-4면 충분, 정수라 JSON이 짧고 바이트로 같다]
export const GAME_POSE_SCALE = 1e4
// 표식 비트: 잠듦, 필드 밖(표시에서 숨김)
export const ELEMENT_FLAG_ASLEEP = 1
export const ELEMENT_FLAG_OUT = 2

// PhysicsWorld.gameState()가 돌려주는 값(공이 없는 세계는 null). poses.length = GAME_POSE_STRIDE·N, flags.length = N
export type GameState = { revision: number; poses: number[]; flags: number[] }

// 반올림한 정수(−0 없이)
const quantize = (value: number): number => Math.round(value * GAME_POSE_SCALE) + 0

// 공 상태 → 줄인 자세와 표식(같은 입력 → 같은 정수)
export function quantizeElements(states: readonly SimElementState[]): {
  poses: number[]
  flags: number[]
} {
  const poses: number[] = []
  const flags: number[] = []
  for (const s of states) {
    const [w, x, y, z] = s.orientation
    poses.push(
      quantize(s.position.x),
      quantize(s.position.y),
      quantize(s.position.z),
      quantize(w),
      quantize(x),
      quantize(y),
      quantize(z)
    )
    flags.push((s.asleep ? ELEMENT_FLAG_ASLEEP : 0) | (s.out ? ELEMENT_FLAG_OUT : 0))
  }
  return { poses, flags }
}

// 공 i의 표시 자세(필드 좌표 m, 단위로 다시 맞춘 사원수 [w, x, y, z]). 줄인 사원수가 0이면 단위 사원수
export function elementDisplayPose(
  poses: readonly number[],
  i: number
): {
  position: { x: number; y: number; z: number }
  orientation: [number, number, number, number]
} {
  const o = GAME_POSE_STRIDE * i
  const w = poses[o + 3]
  const x = poses[o + 4]
  const y = poses[o + 5]
  const z = poses[o + 6]
  const norm = Math.sqrt(w * w + x * x + y * y + z * z)
  return {
    position: {
      x: poses[o] / GAME_POSE_SCALE,
      y: poses[o + 1] / GAME_POSE_SCALE,
      z: poses[o + 2] / GAME_POSE_SCALE
    },
    orientation: norm > 0 ? [w / norm, x / norm, y / norm, z / norm] : [1, 0, 0, 0]
  }
}

// 표식 칸이 없으면(이벤트가 생략) 0
export function elementFlags(flags: readonly number[] | undefined, i: number): number {
  return flags?.[i] ?? 0
}

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

// 메인·렌더러가 받은 모양을 확인한다: revision은 0 이상 정수, poses는 GAME_POSE_STRIDE의 배수 길이의 정수(공
// MAX_WORLD_ELEMENTS개까지), flags는 있으면 공 수만큼의 0–3 정수. count를 주면 공 수가 그것과 같아야 한다
export function isValidGameState(
  value: { revision: unknown; poses: unknown; flags?: unknown },
  count?: number
): boolean {
  const { revision, poses, flags } = value
  if (!isInt(revision) || revision < 0) return false
  if (!Array.isArray(poses) || poses.length % GAME_POSE_STRIDE !== 0) return false
  const n = poses.length / GAME_POSE_STRIDE
  if (n > MAX_WORLD_ELEMENTS || (count !== undefined && n !== count)) return false
  if (!poses.every(isInt)) return false
  if (flags === undefined) return true
  return (
    Array.isArray(flags) &&
    flags.length === n &&
    flags.every((f) => isInt(f) && f >= 0 && f <= (ELEMENT_FLAG_ASLEEP | ELEMENT_FLAG_OUT))
  )
}
