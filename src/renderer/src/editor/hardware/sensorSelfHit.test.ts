import { BoxGeometry } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { afterEach, describe, expect, it } from 'vitest'
import { sensorMountInRobot, type SensorMountInRobot } from '../../hardware/mounting'
import { disposeGeometry, registerGeometry } from '../../scene/geometryRegistry'
import { objectLocalBounds } from '../../scene/localBounds'
import type { SceneObject, SceneObjects, Transform } from '../../scene/model'
import { sensorSelfHit } from './sensorSelfHit'

// 자기 로봇 가림(spec-4c §1.9, C13): 편집 자세에서 축·바깥 광선을 그 로봇의 CAD 메시(BVH)에 쏜다.

const registered: string[] = []
afterEach(() => {
  while (registered.length > 0) disposeGeometry(registered.pop()!)
})

// 상자 형상을 등록하고 BVH를 만든다(앱은 쉬는 시간에 만든다, scene/meshBvh.ts)
function box(id: string, sx: number, sy: number, sz: number, bvh = true): void {
  const geometry = new BoxGeometry(sx, sy, sz)
  if (bvh) geometry.boundsTree = new MeshBVH(geometry, { indirect: true } as never)
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

// 로봇: 몸체 상자 0.4 × 0.4 × 0.2(중심 높이 0.1), 몸체 앞(+X)에 붙은 센서 파트(1 cm 상자, x 0.21)
function robot(extra: SceneObjects = {}, bodyGeometry = 'g:body'): SceneObjects {
  return {
    bot: { id: 'bot', name: 'Bot', kind: 'robot', parentId: null, transform: at(0.5, 0, 0) },
    body: part('body', 'bot', at(0, 0, 0.1), bodyGeometry),
    sensor: part('sensor', 'bot', at(0.21, 0, 0.1), 'g:sensor'),
    ...extra
  }
}

const bounds = (objects: SceneObjects) => (id: string) => objectLocalBounds(objects, id)

function mountFor(objects: SceneObjects, yaw: number, pitch = 0): SensorMountInRobot {
  return sensorMountInRobot(objects, 'sensor', { yaw, pitch }, bounds(objects))!
}

describe('sensorSelfHit', () => {
  it('뒤(요 180°)를 보면 자기 몸체 파트에 축이 맞고, 앞을 보면 없다. 센서 자기 형상은 무시', () => {
    box('g:body', 0.4, 0.4, 0.2)
    box('g:sensor', 0.01, 0.01, 0.01)
    const objects = robot()
    const back = mountFor(objects, Math.PI)
    // 하우징 앞면은 센서 상자의 뒤 면(x 0.205), 몸체 앞면은 x 0.2 → 5 mm
    expect(back.position.x).toBeCloseTo(0.205, 7)
    const hit = sensorSelfHit(objects, 'bot', 'sensor', back, 'distanceSensor', 1.2)
    expect(hit).toEqual({ kind: 'axis', partId: 'body', distance: expect.any(Number) })
    expect(hit?.kind === 'axis' && hit.distance).toBeCloseTo(0.005, 6)
    expect(
      sensorSelfHit(objects, 'bot', 'sensor', mountFor(objects, 0), 'distanceSensor', 1.2)
    ).toBeNull()
    // reach보다 멀면 맞지 않는다
    expect(sensorSelfHit(objects, 'bot', 'sensor', back, 'distanceSensor', 0.004)).toBeNull()
    // 몸체가 없으면(센서 자기 형상뿐) 가림 없음
    const alone = { ...objects }
    delete alone.body
    expect(sensorSelfHit(alone, 'bot', 'sensor', back, 'distanceSensor', 1.2)).toBeNull()
  })

  it('숨긴 파트도 가린다(숨김은 보기 상태라 보지 않는다), 가장 가까운 파트', () => {
    box('g:body', 0.4, 0.4, 0.2)
    box('g:sensor', 0.01, 0.01, 0.01)
    box('g:bumper', 0.02, 0.4, 0.05)
    // 센서 앞 0.1 m에 범퍼, 그 뒤 0.3 m에 다른 범퍼
    const objects = robot({
      near: part('near', 'bot', at(0.33, 0, 0.1), 'g:bumper'),
      far: part('far', 'bot', at(0.53, 0, 0.1), 'g:bumper')
    })
    const hit = sensorSelfHit(objects, 'bot', 'sensor', mountFor(objects, 0), 'distanceSensor', 1.2)
    expect(hit?.kind === 'axis' && hit.partId).toBe('near')
    expect(hit?.kind === 'axis' && hit.distance).toBeCloseTo(0.33 - 0.01 - 0.215, 6)
  })

  it('바깥 광선만 맞으면 partial, BVH가 없는 메시는 건너뛴다', () => {
    box('g:body', 0.4, 0.4, 0.2)
    box('g:sensor', 0.01, 0.01, 0.01)
    // 축(z 0.1)에서 4–10 cm 위의 판: 0.3 m 앞에서 위 모선(11.2°)은 축보다 약 6 cm 위
    box('g:plate', 0.01, 0.4, 0.06)
    const objects = robot({ plate: part('plate', 'bot', at(0.52, 0, 0.17), 'g:plate') })
    expect(
      sensorSelfHit(objects, 'bot', 'sensor', mountFor(objects, 0), 'distanceSensor', 1.2)
    ).toEqual({
      kind: 'partial'
    })
    // 컬러 센서 발자국(31°)도 같은 판에 걸린다
    expect(
      sensorSelfHit(objects, 'bot', 'sensor', mountFor(objects, 0), 'colorSensor', 1.2)
    ).toEqual({
      kind: 'partial'
    })
    box('g:nobvh', 0.4, 0.4, 0.2, false)
    const noBvh = robot({}, 'g:nobvh')
    expect(
      sensorSelfHit(noBvh, 'bot', 'sensor', mountFor(noBvh, Math.PI), 'distanceSensor', 1.2)
    ).toBeNull()
  })

  it('메시 1761개 로봇에서 센서 하나의 시간(기록)', () => {
    box('g:sensor', 0.01, 0.01, 0.01)
    box('g:small', 0.008, 0.008, 0.008)
    const objects: SceneObjects = robot({}, 'g:sensor')
    delete objects.body
    // 로봇 안 40 × 45 격자(센서 축 밖)에 작은 파트 1761개
    let count = 0
    for (let i = 0; i < 40 && count < 1761; i++)
      for (let j = 0; j < 45 && count < 1761; j++) {
        const id = `p${count++}`
        objects[id] = part(id, 'bot', at(-0.2 + i * 0.01, -0.22 + j * 0.01, 0.3), 'g:small')
      }
    const mount = mountFor(objects, Math.PI)
    // 첫 호출은 로봇 좌표 행렬 색인을 만든다
    sensorSelfHit(objects, 'bot', 'sensor', mount, 'distanceSensor', 1.2)
    const times: number[] = []
    for (let k = 0; k < 20; k++) {
      const start = performance.now()
      sensorSelfHit(objects, 'bot', 'sensor', mount, 'distanceSensor', 1.2)
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    console.log(
      `sensorSelfHit 메시 1761개: 중앙값 ${times[10].toFixed(3)} ms, 최대 ${times[19].toFixed(3)} ms`
    )
    // CI 상한(목표는 1 ms 아래, 명세 §1.9)
    expect(times[10]).toBeLessThan(50)
  })
})
