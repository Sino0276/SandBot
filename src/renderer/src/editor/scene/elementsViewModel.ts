import { Vector3 } from 'three'
import { resolveElementType } from '../../../../shared/sim/elements/elementData'
import {
  ELEMENT_FLAG_OUT,
  elementDisplayPose,
  elementFlags,
  GAME_POSE_STRIDE
} from '../../../../shared/sim/elements/gameState'
import { elementSpawns } from '../../../../shared/sim/elements/spawn'
import type { FieldSpec } from '../../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { ELEMENT_KINDS, type SimElementKind } from '../../../../shared/sim/worldSpec'
import type { GhostGame, PlayRunElements, SimGameState } from '../../play/playStore'
import { RUN_ELEMENT_GROUPS, robotPreloads, robotStartPose } from '../../play/worldElements'
import { worldMatrix, type SceneObjects } from '../../scene/model'

// 씬 뷰 경기 요소(6a, spec-6a §5)의 순수 모델: 그릴 공 목록(종류, 필드 좌표 중심, 단위 사원수). ElementsView가 층마다 종류별
// InstancedMesh에 쓴다. 층:
// - solid: 불투명. 편집 중에는 시즌 시작 배치와 대상 로봇의 팀 Preload Slot 공, 실행 중에는 시뮬레이터 표시 상태(gameState, 아직
//   없으면 시작 상태)
// - preview: 반투명. 편집 중 대상 로봇의 자동 프리로드 자리(팀이 자리를 두지 않았을 때 시뮬레이터가 둘 곳)
// - ghost: 반투명. 끝난 실행의 마지막 상태(잔상, 다음 INIT·프로젝트 열기까지)
// 필드 밖 공(표식 out)은 그리지 않는다.

export type BallInstance = {
  kind: SimElementKind
  position: [number, number, number]
  // [w, x, y, z]
  orientation: [number, number, number, number]
}

export type ElementLayers = {
  solid: BallInstance[]
  preview: BallInstance[]
  ghost: BallInstance[]
}

export const EMPTY_LAYERS: ElementLayers = Object.freeze({
  solid: [],
  preview: [],
  ghost: []
}) as unknown as ElementLayers

const BIOBUZZ = resolveSeason('biobuzz')

// 종류의 반지름과 표시 색: 그 시즌 데이터, 시즌에 없으면 BIOBUZZ 값(지난 실행 잔상을 시즌을 바꾼 뒤에도 그리게)
export function ballLook(
  field: FieldSpec,
  kind: SimElementKind
): { radius: number; color: string } {
  const type = resolveElementType(field, kind) ?? resolveElementType(BIOBUZZ, kind)!
  return { radius: type.radius, color: type.material.display }
}

const IDENTITY: [number, number, number, number] = [1, 0, 0, 0]

// 편집 중 공: 시즌 시작 배치(6a에 생기는 묶음)와 대상 로봇 프리로드(팀 자리는 그 오브젝트의 문서 자세, 자동 자리는 로봇 시작 자세로
// 옮긴 필드 좌표). 시즌에 경기 요소가 없으면 빈 층
export function editElementLayers(
  objects: SceneObjects,
  targetRobotId: string | null,
  field: FieldSpec
): Pick<ElementLayers, 'solid' | 'preview'> {
  if (!field.elements) return { solid: [], preview: [] }
  // 배치는 로봇 자세와 관계없다(프리로드 없이 시작 자세는 쓰지 않는다)
  const solid: BallInstance[] = elementSpawns(
    field,
    { groups: [...RUN_ELEMENT_GROUPS], preloads: [] },
    { x: 0, y: 0, yaw: 0 }
  ).map((s) => ({
    kind: s.kind,
    position: [s.position.x, s.position.y, s.position.z],
    orientation: IDENTITY
  }))
  const preview: BallInstance[] = []
  const start = targetRobotId === null ? null : robotStartPose(objects, targetRobotId)
  if (targetRobotId !== null && start) {
    const preloads = robotPreloads(objects, targetRobotId, field)
    for (const slot of preloads.slots) {
      if (slot.objectId !== null) {
        const center = objects[slot.objectId].preload!.center
        const p = new Vector3(...center).applyMatrix4(worldMatrix(objects, slot.objectId))
        solid.push({ kind: 'pollen', position: [p.x, p.y, p.z], orientation: IDENTITY })
      } else {
        const c = Math.cos(start.yaw)
        const s = Math.sin(start.yaw)
        const r = slot.inRobot
        preview.push({
          kind: 'pollen',
          position: [c * r.x - s * r.y + start.x, s * r.x + c * r.y + start.y, r.z],
          orientation: IDENTITY
        })
      }
    }
  }
  return { solid, preview }
}

// 줄인 자세 목록(gameState·잔상) → 공(필드 밖은 뺀다). kinds 길이와 공 수가 다르면 빈 목록(모양이 틀린 상태를 그리지 않는다)
export function posesToBalls(
  kinds: readonly SimElementKind[],
  poses: readonly number[],
  flags: readonly number[] | undefined
): BallInstance[] {
  if (poses.length !== kinds.length * GAME_POSE_STRIDE) return []
  const out: BallInstance[] = []
  kinds.forEach((kind, i) => {
    if (elementFlags(flags, i) & ELEMENT_FLAG_OUT) return
    const { position, orientation } = elementDisplayPose(poses, i)
    out.push({ kind, position: [position.x, position.y, position.z], orientation })
  })
  return out
}

// 실행 중 공: 그 실행의 표시 상태가 있으면 그것, 아직 없으면(컴파일 중) 시작 상태
export function runElementBalls(
  elements: PlayRunElements,
  game: SimGameState | null
): BallInstance[] {
  if (game) return posesToBalls(elements.kinds, game.poses, game.flags)
  return elements.spawns
    .filter((s) => !s.out)
    .map((s) => ({
      kind: s.kind,
      position: [s.position.x, s.position.y, s.position.z],
      orientation: [...s.orientation]
    }))
}

export function ghostElementBalls(ghost: GhostGame | null): BallInstance[] {
  return ghost ? posesToBalls(ghost.kinds, ghost.poses, ghost.flags) : []
}

// 종류별로 나눈다(InstancedMesh 하나가 종류 하나)
export function ballsByKind(
  balls: readonly BallInstance[]
): Record<SimElementKind, BallInstance[]> {
  const out = Object.fromEntries(ELEMENT_KINDS.map((kind) => [kind, []])) as unknown as Record<
    SimElementKind,
    BallInstance[]
  >
  for (const ball of balls) out[ball.kind].push(ball)
  return out
}
