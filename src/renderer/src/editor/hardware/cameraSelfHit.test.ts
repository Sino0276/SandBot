import { BoxGeometry } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { afterEach, describe, expect, it } from 'vitest'
import { trueIntrinsics } from '../../../../shared/sim/cameraData'
import type { SensorMountInRobot } from '../../hardware/mounting'
import { cameraMountInRobot } from '../../play/worldCameras'
import { disposeGeometry, registerGeometry } from '../../scene/geometryRegistry'
import { objectLocalBounds } from '../../scene/localBounds'
import type { SceneObject, SceneObjects, Transform } from '../../scene/model'
import { cameraOuterRays, PREVIEW_HEIGHT, PREVIEW_WIDTH } from '../scene/cameraGizmoModel'
import { cameraSelfHit, cameraSelfHitFor, CAMERA_SELF_HIT_REACH } from './cameraSelfHit'

// 웹캠 자기 로봇 가림(spec-4d §1.15, C8): 640×480 절두체의 9광선(광축, 네 모서리, 네 변 가운데)을 렌즈에서 그 로봇의 CAD
// 메시(BVH)에 쏜다. 광축이 맞으면 axis, 가장자리만이면 partial, 웹캠 자기 형상은 무시한다.

const registered: string[] = []
afterEach(() => {
  while (registered.length > 0) disposeGeometry(registered.pop()!)
})

function box(id: string, sx: number, sy: number, sz: number): void {
  const geometry = new BoxGeometry(sx, sy, sz)
  geometry.boundsTree = new MeshBVH(geometry, { indirect: true } as never)
  registerGeometry(id, geometry)
  registered.push(id)
}

const at = (x: number, y: number, z: number): Transform => ({
  position: [x, y, z],
  rotation: [0, 0, 0]
})

const part = (
  id: string,
  parentId: string,
  transform: Transform,
  geometryId?: string
): SceneObject => ({
  id,
  name: id,
  kind: 'part',
  parentId,
  transform,
  ...(geometryId ? { visual: { type: 'mesh' as const, geometryId, color: [0.5, 0.5, 0.5] } } : {})
})

// 로봇 앞(x 0.2)에 웹캠 파트(2 cm 상자, 렌즈 = 상자 앞면 x 0.21), 높이 0.3 m. 수평 조준(높이각 0)
function robot(extra: SceneObjects = {}): SceneObjects {
  return {
    bot: { id: 'bot', name: 'Bot', kind: 'robot', parentId: null, transform: at(0, 0, 0) },
    cam: part('cam', 'bot', at(0.2, 0, 0.3), 'g:cam'),
    ...extra
  }
}

const mountOf = (
  objects: SceneObjects,
  props: Record<string, number | string> = {}
): SensorMountInRobot =>
  cameraMountInRobot(objects, 'cam', { aimYaw: 0, aimPitch: 0, aimRoll: 0, ...props }, (id) =>
    objectLocalBounds(objects, id)
  )!

describe('cameraSelfHit', () => {
  it('렌즈 앞 상자가 광축을 가리면 axis(파트·거리), 웹캠 자기 형상은 무시', () => {
    box('g:cam', 0.02, 0.02, 0.02)
    box('g:wall', 0.02, 0.3, 0.3)
    const objects = robot({ wall: part('wall', 'bot', at(0.5, 0, 0.3), 'g:wall') })
    const mount = mountOf(objects)
    // 상자 형상은 float32라 1e-7 안
    expect(mount.position.x).toBeCloseTo(0.21, 7)
    const hit = cameraSelfHit(objects, 'bot', 'cam', mount, 'logitechC920')
    expect(hit?.kind).toBe('axis')
    if (hit?.kind === 'axis') {
      expect(hit.partId).toBe('wall')
      // 상자 앞면 x 0.49 − 렌즈 0.21
      expect(hit.distance).toBeCloseTo(0.28, 6)
    }
    // 앞이 비어 있으면 없음(자기 형상 g:cam만)
    expect(cameraSelfHit(robot(), 'bot', 'cam', mountOf(robot()), 'logitechC920')).toBeNull()
  })

  it('가장자리만 걸리면 partial: 광축 옆(왼쪽 위)에 놓인 작은 상자', () => {
    box('g:cam', 0.02, 0.02, 0.02)
    box('g:corner', 0.05, 0.05, 0.05)
    // 왼쪽 위 모서리 광선 방향(센서 틀)으로 0.3 m 앞, 광축은 비켜 간다
    const lens = trueIntrinsics('logitechC920', PREVIEW_WIDTH, PREVIEW_HEIGHT)
    const [topLeft] = cameraOuterRays(lens, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    const depth = 0.3 / topLeft.x
    const objects = robot({
      corner: part(
        'corner',
        'bot',
        at(0.21 + topLeft.x * depth, topLeft.y * depth, 0.3 + topLeft.z * depth),
        'g:corner'
      )
    })
    expect(cameraSelfHit(objects, 'bot', 'cam', mountOf(objects), 'logitechC920')).toEqual({
      kind: 'partial'
    })
  })

  it('광선 길이 1.2 m 밖은 보지 않는다, 바깥 광선은 8개(네 모서리 → 네 변 가운데)', () => {
    box('g:cam', 0.02, 0.02, 0.02)
    box('g:far', 0.02, 0.3, 0.3)
    const objects = robot({
      far: part('far', 'bot', at(0.21 + CAMERA_SELF_HIT_REACH + 0.05, 0, 0.3), 'g:far')
    })
    expect(cameraSelfHit(objects, 'bot', 'cam', mountOf(objects), 'logitechC920')).toBeNull()
    const lens = trueIntrinsics('logitechC920', PREVIEW_WIDTH, PREVIEW_HEIGHT)
    const rays = cameraOuterRays(lens, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    expect(rays).toHaveLength(8)
    for (const ray of rays) expect(Math.hypot(ray.x, ray.y, ray.z)).toBeCloseTo(1, 12)
  })

  it('cameraSelfHitFor: 같은 입력이면 기억한 결과, 장착이 바뀌면 다시 쏜다', () => {
    box('g:cam', 0.02, 0.02, 0.02)
    box('g:wall', 0.02, 0.3, 0.3)
    const objects = robot({ wall: part('wall', 'bot', at(0.5, 0, 0.3), 'g:wall') })
    const front = mountOf(objects)
    const first = cameraSelfHitFor('w1', objects, 0, 'bot', 'cam', front, 'logitechC920')
    expect(first?.kind).toBe('axis')
    expect(cameraSelfHitFor('w1', objects, 0, 'bot', 'cam', front, 'logitechC920')).toBe(first)
    // 뒤를 보면(요 180°) 앞 상자는 맞지 않는다
    const back = mountOf(objects, { aimYaw: Math.PI })
    expect(cameraSelfHitFor('w1', objects, 0, 'bot', 'cam', back, 'logitechC920')).toBeNull()
  })
})
