import { BoxGeometry } from 'three'
import { meshHullOf, type MeshHull } from '../../cad/stepImport'
import { registerGeometry } from '../../scene/geometryRegistry'
import { defaultJoint } from '../../scene/joint'
import type { SceneObject, SceneObjects } from '../../scene/model'
import { clearCollisionModels } from './useCollisionModel'

// Collider 인스펙터·기즈모 시험(B11–B14·B16)이 같이 쓰는 씬과 형상 등록

type V3 = [number, number, number]

export function sceneObject(
  id: string,
  parentId: string | null,
  position: V3,
  extra: Partial<SceneObject> = {},
  rotation: V3 = [0, 0, 0]
): SceneObject {
  return {
    id,
    name: extra.name ?? id,
    kind: extra.kind ?? 'part',
    parentId,
    transform: { position, rotation },
    ...extra
  }
}

const mesh = (id: string): Partial<SceneObject> => ({
  visual: { type: 'mesh', geometryId: `g:${id}`, color: [1, 1, 1] }
})

// 로봇 R(바퀴 없음) → CAD 루트 cad(Y-up, 정렬 회전) → 파트 part, 섀시 판 base, 리프트 관절 lift → 판 plate,
// 메커니즘 그룹 mech(관절 아님) → 팔 관절 arm → 관 tube. 로봇 밖 오브젝트 loose
export function colliderScene(): SceneObjects {
  return {
    R: sceneObject('R', null, [0, 0, 0], { kind: 'robot', name: 'Robot' }),
    cad: sceneObject(
      'cad',
      'R',
      [0, 0, 0.1],
      {
        kind: 'assembly',
        name: 'CAD',
        cad: {
          fileName: 'bot.step',
          absolutePath: '/bot.step',
          upAxis: '+Y',
          forwardAxis: '+Z',
          bounds: { min: [-0.1, -0.1, -0.1], max: [0.1, 0.1, 0.1] },
          meshCount: 1,
          meshIndexing: 'source'
        }
      },
      [Math.PI / 2, 0, Math.PI / 2]
    ),
    part: sceneObject('part', 'cad', [0, 0, 0], mesh('part')),
    base: sceneObject('base', 'R', [0, 0, 0.05], mesh('base')),
    lift: sceneObject('lift', 'R', [0.1, 0, 0.1], {
      kind: 'group',
      name: 'Lift',
      joint: { ...defaultJoint('prismatic'), axis: 'z' }
    }),
    plate: sceneObject('plate', 'lift', [0, 0, 0.05], mesh('plate')),
    mech: sceneObject('mech', 'R', [0.2, 0, 0], { kind: 'group', name: 'Mechanism' }),
    arm: sceneObject('arm', 'mech', [0, 0, 0.2], {
      kind: 'group',
      name: 'Arm',
      joint: defaultJoint('revolute')
    }),
    tube: sceneObject('tube', 'arm', [0.1, 0, 0], mesh('tube')),
    loose: sceneObject('loose', null, [2, 0, 0], { kind: 'group', name: 'Loose' })
  }
}

// 상자 형상과 그 메시 껍질을 등록한다(STEP 워커가 내는 것). error를 주면 껍질 오차를 덮어쓴다
export function registerBox(
  geometryId: string,
  size: V3,
  error?: number
): { geometry: BoxGeometry; hull: MeshHull } {
  const geometry = new BoxGeometry(...size)
  geometry.computeBoundingBox()
  const hull = meshHullOf(geometry.getAttribute('position').array)
  if (error !== undefined) hull.error = error
  registerGeometry(geometryId, geometry, { hull })
  return { geometry, hull }
}

// 시험 씬의 메시를 모두 등록한다(base·part·plate·tube)
export function registerSceneMeshes(): void {
  registerBox('g:base', [0.4, 0.4, 0.1])
  registerBox('g:part', [0.1, 0.2, 0.3])
  registerBox('g:plate', [0.1, 0.2, 0.01])
  registerBox('g:tube', [0.2, 0.02, 0.02])
}

export function resetCollisionModels(): void {
  clearCollisionModels()
}
