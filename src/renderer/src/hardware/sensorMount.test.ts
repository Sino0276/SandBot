import { describe, expect, it } from 'vitest'
import type { Vec3 as SimVec3 } from '../../../shared/sim/worldSpec'
import type { SceneObject, SceneObjects, Vec3 } from '../scene/model'
import {
  aimRotation,
  sensorAim,
  sensorMountInRobot,
  type LocalBoundsLookup,
  type SensorAim
} from './mounting'

// 거리·컬러 센서 장착(4c, spec-4c §1.2 K2·K3)

const DEG = Math.PI / 180

function object(
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  position: Vec3 = [0, 0, 0],
  rotation: Vec3 = [0, 0, 0],
  extra: Partial<SceneObject> = {}
): SceneObject {
  return { id, name: id, kind, parentId, transform: { position, rotation }, ...extra }
}

const mesh = (geometryId: string): SceneObject['visual'] => ({
  type: 'mesh',
  geometryId,
  color: [1, 1, 1]
})

// 로봇은 필드에서 옮기고 돌려 둔다(로봇 좌표 변환을 확인하려고)
function scene(): SceneObjects {
  return {
    robot: object('robot', 'robot', null, [1, 2, 0], [0, 0, 30 * DEG]),
    sensor: object('sensor', 'part', 'robot', [0.1, -0.05, 0.2], [0, 0, 0], {
      visual: mesh('box')
    }),
    // CAD 축 정렬처럼 돌아간 부모 아래 파트(경계 상자는 그 파트 로컬 축)
    tilted: object('tilted', 'group', 'robot', [0, 0.1, 0.05], [Math.PI / 2, 0, 0]),
    tiltedPart: object('tiltedPart', 'part', 'tilted', [0, 0, 0], [0, 0, 0], {
      visual: mesh('slab')
    }),
    group: object('group', 'group', 'robot', [-0.2, 0, 0.1]),
    child: object('child', 'part', 'group', [0.05, 0, 0], [0, 0, 0], { visual: mesh('box') }),
    empty: object('empty', 'group', 'robot', [0.3, 0, 0.1]),
    bare: object('bare', 'part', 'robot', [0.3, 0, 0.1]),
    cadRoot: object('cadRoot', 'assembly', 'robot', [0, 0, 0], [0, 0, 0], {
      cad: {
        fileName: 'a.step',
        absolutePath: '/a.step',
        upAxis: '+Z',
        forwardAxis: '+X',
        bounds: { min: [-0.1, -0.1, -0.1], max: [0.1, 0.1, 0.1] }
      } as SceneObject['cad']
    }),
    cadPart: object('cadPart', 'part', 'cadRoot', [0, 0, 0], [0, 0, 0], { visual: mesh('box') }),
    loose: object('loose', 'part', null, [0, 0, 0], [0, 0, 0], { visual: mesh('box') })
  }
}

const BOXES: Record<string, { min: SimVec3; max: SimVec3 }> = {
  box: { min: { x: -0.01, y: -0.01, z: -0.01 }, max: { x: 0.01, y: 0.01, z: 0.01 } },
  // 로컬 z로 얇고 y로 긴 판(부모가 x로 90° 돌아 로봇 좌표에서는 z로 길다)
  slab: { min: { x: -0.01, y: -0.03, z: -0.002 }, max: { x: 0.01, y: 0.03, z: 0.002 } }
}

function lookup(objects: SceneObjects): LocalBoundsLookup {
  return (id) => {
    const visual = objects[id]?.visual
    return visual?.type === 'mesh' ? (BOXES[visual.geometryId] ?? null) : null
  }
}

const FORWARD: SensorAim = { yaw: 0, pitch: 0 }

describe('sensorAim', () => {
  it('없음·수가 아님·NaN·범위 밖은 기본값(컬러 높이각 −90°)', () => {
    expect(sensorAim('distanceSensor', {})).toEqual({ yaw: 0, pitch: 0 })
    expect(sensorAim('colorSensor', {})).toEqual({ yaw: 0, pitch: -Math.PI / 2 })
    expect(sensorAim('colorSensor', { aimYaw: NaN, aimPitch: '0.3' })).toEqual({
      yaw: 0,
      pitch: -Math.PI / 2
    })
    expect(sensorAim('distanceSensor', { aimYaw: 4, aimPitch: -2 })).toEqual({ yaw: 0, pitch: 0 })
    expect(sensorAim('distanceSensor', { aimYaw: Infinity, aimPitch: -Infinity })).toEqual({
      yaw: 0,
      pitch: 0
    })
  })

  it('경계값과 범위 안 값은 그대로', () => {
    expect(sensorAim('distanceSensor', { aimYaw: Math.PI, aimPitch: Math.PI / 2 })).toEqual({
      yaw: Math.PI,
      pitch: Math.PI / 2
    })
    expect(sensorAim('colorSensor', { aimYaw: -Math.PI, aimPitch: -Math.PI / 2 })).toEqual({
      yaw: -Math.PI,
      pitch: -Math.PI / 2
    })
    expect(sensorAim('colorSensor', { gain: 2, aimYaw: 0.5, aimPitch: 0.25 })).toEqual({
      yaw: 0.5,
      pitch: 0.25
    })
  })
})

describe('aimRotation', () => {
  it('ZYX (0, −pitch, yaw)이고 −0을 만들지 않는다', () => {
    expect(aimRotation({ yaw: 0.4, pitch: -Math.PI / 2 })).toEqual({
      x: 0,
      y: Math.PI / 2,
      z: 0.4
    })
    const zero = aimRotation({ yaw: -0, pitch: 0 })
    expect(Object.is(zero.x, 0) && Object.is(zero.y, 0) && Object.is(zero.z, 0)).toBe(true)
  })
})

describe('sensorMountInRobot', () => {
  const objects = scene()
  const bounds = lookup(objects)
  const pivot = { x: 0.1, y: -0.05, z: 0.2 }

  it('앞을 보면 하우징 앞면은 피벗 + 반폭(로봇 좌표, 로봇의 필드 자세와 무관)', () => {
    const mount = sensorMountInRobot(objects, 'sensor', FORWARD, bounds)!
    expect(mount.housing).toBe('front')
    expect(mount.pivotOffset).toBeCloseTo(0.01, 12)
    expect(mount.position.x).toBeCloseTo(pivot.x + 0.01, 12)
    expect(mount.position.y).toBeCloseTo(pivot.y, 12)
    expect(mount.position.z).toBeCloseTo(pivot.z, 12)
    expect(mount.rotation).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('아래를 보면 z − 반폭, 요 45°면 투영 최대 반폭·√2', () => {
    const down = sensorMountInRobot(objects, 'sensor', { yaw: 0, pitch: -Math.PI / 2 }, bounds)!
    expect(down.pivotOffset).toBeCloseTo(0.01, 12)
    expect(down.position.x).toBeCloseTo(pivot.x, 12)
    expect(down.position.z).toBeCloseTo(pivot.z - 0.01, 12)
    expect(down.rotation).toEqual({ x: 0, y: Math.PI / 2, z: 0 })
    const diagonal = sensorMountInRobot(objects, 'sensor', { yaw: 45 * DEG, pitch: 0 }, bounds)!
    expect(diagonal.pivotOffset).toBeCloseTo(0.01 * Math.SQRT2, 12)
    expect(diagonal.position.x).toBeCloseTo(pivot.x + 0.01, 12)
    expect(diagonal.position.y).toBeCloseTo(pivot.y + 0.01, 12)
  })

  it('돌아간 부모 아래 형상은 로봇 좌표로 옮겨 투영한다', () => {
    // 판의 로컬 y(±0.03)가 로봇 z가 된다
    const up = sensorMountInRobot(objects, 'tiltedPart', { yaw: 0, pitch: Math.PI / 2 }, bounds)!
    expect(up.pivotOffset).toBeCloseTo(0.03, 12)
    expect(up.position.z).toBeCloseTo(0.05 + 0.03, 12)
    const forward = sensorMountInRobot(objects, 'tiltedPart', FORWARD, bounds)!
    expect(forward.pivotOffset).toBeCloseTo(0.01, 12)
  })

  it('자기 형상이 없는 그룹은 하위 형상들, 없으면 피벗', () => {
    const group = sensorMountInRobot(objects, 'group', FORWARD, bounds)!
    expect(group.housing).toBe('front')
    expect(group.pivotOffset).toBeCloseTo(0.06, 12)
    expect(group.position.x).toBeCloseTo(-0.2 + 0.06, 12)
    // 뒤를 보면 하위 형상이 모두 피벗 앞(+X)에 있어 투영 최대가 음수 → 0
    const back = sensorMountInRobot(objects, 'group', { yaw: Math.PI, pitch: 0 }, bounds)!
    expect(back.housing).toBe('front')
    expect(back.pivotOffset).toBe(0)
    expect(back.position.x).toBeCloseTo(-0.2, 12)
    for (const id of ['empty', 'bare']) {
      const mount = sensorMountInRobot(objects, id, FORWARD, bounds)!
      expect(mount.housing).toBe('pivot')
      expect(mount.pivotOffset).toBe(0)
      expect(mount.rotation).toEqual({ x: 0, y: 0, z: 0 })
      expect(mount.position.x).toBeCloseTo(0.3, 12)
      expect(mount.position.y).toBeCloseTo(0, 12)
      expect(mount.position.z).toBeCloseTo(0.1, 12)
    }
  })

  it('robot·CAD 루트는 하위 형상이 있어도 피벗', () => {
    for (const id of ['robot', 'cadRoot']) {
      const mount = sensorMountInRobot(objects, id, FORWARD, bounds)!
      expect(mount.housing).toBe('pivot')
      expect(mount.pivotOffset).toBe(0)
      expect(mount.position.x).toBeCloseTo(0, 12)
      expect(mount.position.y).toBeCloseTo(0, 12)
      expect(mount.position.z).toBeCloseTo(0, 12)
    }
  })

  it('형상 조회가 없거나 형상을 아직 읽지 않았으면 피벗', () => {
    const none = sensorMountInRobot(objects, 'sensor', FORWARD, null)!
    expect(none.housing).toBe('pivot')
    expect(none.pivotOffset).toBe(0)
    expect(none.position.x).toBeCloseTo(pivot.x, 12)
    const unloaded = sensorMountInRobot(objects, 'sensor', FORWARD, () => null)!
    expect(unloaded.housing).toBe('pivot')
  })

  it('로봇 밖·없는 오브젝트는 null', () => {
    expect(sensorMountInRobot(objects, 'loose', FORWARD, bounds)).toBeNull()
    expect(sensorMountInRobot(objects, 'gone', FORWARD, bounds)).toBeNull()
  })

  it('회전에 −0이 없다', () => {
    const mount = sensorMountInRobot(objects, 'sensor', { yaw: -0, pitch: -0 }, bounds)!
    expect(Object.is(mount.rotation.y, 0) && Object.is(mount.rotation.z, 0)).toBe(true)
  })
})
