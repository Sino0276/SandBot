import { describe, expect, it, vi } from 'vitest'
import type { ColliderSettings, RobotCollisionSettings } from '../scene/collider'
import type { FieldDoc } from '../scene/fieldDoc'
import { createGroup, moveObjects } from '../scene/hierarchy'
import type { JointSettings, SceneObjects } from '../scene/model'
import {
  parseProject,
  PROJECT_VERSION,
  ProjectFileError,
  serializeProject,
  type StoredCadFile
} from './projectFile'

const objects: SceneObjects = {
  robot: {
    id: 'robot',
    name: 'Robot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0.5, -1, 0], rotation: [0, 0, 1.2] },
    hardware: {
      className: 'RobotHardware',
      configName: 'My Bot',
      expansionHub: { enabled: true, address: 2 }
    }
  },
  cad: {
    id: 'cad',
    name: 'ROBOT_ASM',
    kind: 'assembly',
    parentId: 'robot',
    transform: { position: [0, 0, 0.2], rotation: [0, 0, 0] },
    cad: {
      fileName: 'robot.step',
      absolutePath: '/home/team/cad/robot.step',
      upAxis: '+Y',
      forwardAxis: '+Z',
      bounds: { min: [0, 0, 0], max: [0.4, 0.4, 0.4] },
      meshCount: 1,
      meshIndexing: 'source'
    }
  },
  plate: {
    id: 'plate',
    name: 'Plate',
    kind: 'part',
    parentId: 'cad',
    transform: { position: [0.1, 0, 0], rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: 'cad:0', color: [0.5, 0.5, 0.5] },
    components: [
      {
        id: 'm1',
        type: 'motor',
        name: 'frontLeft',
        hub: 'controlHub',
        port: 0,
        props: {
          motorModel: 'goBilda5202',
          direction: 'reverse',
          runMode: 'usingEncoder',
          zeroPowerBehavior: 'brake',
          gearbox: 19.2,
          stallTorque: 0,
          freeSpeed: 0
        }
      }
    ]
  }
}

const relativize = (path: string): string => path.replace('/home/team/', '../')

// 시험 프로젝트의 필드(새 프로젝트의 기본 시즌이 아닌 값으로, 왕복이 기본값에 기대지 않게)
const FIELD: FieldDoc = { season: 'none' }

describe('프로젝트 파일', () => {
  it('저장한 내용을 다시 읽으면 같은 씬이 된다', () => {
    const { objects: loaded, cadFiles } = parseProject(serializeProject(objects, FIELD, relativize))
    expect(loaded).toEqual(objects)
    expect(cadFiles.get('cad')).toEqual({
      relativePath: '../cad/robot.step',
      absolutePath: '/home/team/cad/robot.step'
    })
  })

  it('CAD 경로는 상대 경로와 절대 경로를 함께 저장한다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    expect(data).toMatchObject({ format: 'sandbot-project', version: 13 })
    expect(data.objects[1].cad.file).toEqual({
      relativePath: '../cad/robot.step',
      absolutePath: '/home/team/cad/robot.step'
    })
    expect(data.objects[1].cad.absolutePath).toBeUndefined()
  })

  it('경로를 모르는 CAD는 상대 경로를 null로 저장한다', () => {
    const withoutPath: SceneObjects = {
      ...objects,
      cad: { ...objects.cad, cad: { ...objects.cad.cad!, absolutePath: '' } }
    }
    const { cadFiles } = parseProject(serializeProject(withoutPath, FIELD, relativize))
    expect(cadFiles.get('cad')).toEqual({ relativePath: null, absolutePath: '' })
  })
})

describe('메커니즘 그룹(버전 4)', () => {
  // 그룹을 CAD 루트 앞에 만들고(형제 순서), 파트를 CAD 밖 그룹으로 옮긴 씬
  const grouped = (): SceneObjects => {
    let scene = createGroup(objects, { id: 'lift', parentId: 'robot', name: '리프트' })
    scene = moveObjects(scene, ['lift'], 'robot', 'cad')
    scene = { ...scene, lift: { ...scene.lift, codeClassName: 'Lift' } }
    return moveObjects(scene, ['plate'], 'lift')
  }

  it('그룹·cadOrigin·codeClassName과 형제 순서를 저장하고 그대로 읽는다', () => {
    const scene = grouped()
    expect(scene.plate.cadOrigin).toBe('cad')
    const content = serializeProject(scene, FIELD, relativize)
    const { objects: loaded } = parseProject(content)
    expect(loaded).toEqual(scene)
    expect(Object.keys(loaded)).toEqual(['robot', 'lift', 'cad', 'plate'])
    expect(serializeProject(loaded, FIELD, relativize)).toBe(content)
  })

  it('그룹이 없는 씬은 새 필드를 쓰지 않는다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    for (const object of data.objects) {
      expect(object).not.toHaveProperty('cadOrigin')
      expect(object).not.toHaveProperty('codeClassName')
    }
  })

  it('버전 3 파일을 그대로 읽는다', () => {
    const v3 = `{
  "format": "sandbot-project",
  "version": 3,
  "objects": [
    { "id": "robot", "name": "Robot", "kind": "robot", "parentId": null,
      "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0] } },
    { "id": "cad", "name": "ROBOT_ASM", "kind": "assembly", "parentId": "robot",
      "transform": { "position": [0, 0, 0.2], "rotation": [1.5707963267948966, 0, 1.5707963267948966] },
      "cad": { "fileName": "robot.step", "upAxis": "+Y", "forwardAxis": "+Z",
        "bounds": { "min": [0, 0, 0], "max": [0.4, 0.4, 0.4] }, "meshCount": 1, "meshIndexing": "source",
        "file": { "relativePath": "../cad/robot.step", "absolutePath": "/home/team/cad/robot.step" } } },
    { "id": "plate", "name": "Plate", "kind": "part", "parentId": "cad",
      "transform": { "position": [0.1, 0, 0], "rotation": [0, 0, 0] },
      "visual": { "type": "mesh", "geometryId": "cad:0", "color": [0.5, 0.5, 0.5] } }
  ]
}`
    const { objects: loaded } = parseProject(v3)
    expect(Object.keys(loaded)).toEqual(['robot', 'cad', 'plate'])
    expect(loaded.plate).toEqual({
      id: 'plate',
      name: 'Plate',
      kind: 'part',
      parentId: 'cad',
      transform: { position: [0.1, 0, 0], rotation: [0, 0, 0] },
      visual: { type: 'mesh', geometryId: 'cad:0', color: [0.5, 0.5, 0.5] }
    })
    expect(loaded.cad.cad?.meshIndexing).toBe('source')
  })

  it('끊긴 cadOrigin(없는 오브젝트·CAD 아닌 것·그룹에 있는 것)은 경고하고 버린다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const data = JSON.parse(serializeProject(grouped(), FIELD, relativize))
    const byId = (id: string): Record<string, unknown> =>
      data.objects.find((object: { id: string }) => object.id === id)
    // plate는 형상 id로 출처를 다시 채운다(아래 테스트). 여기서는 메시 없는 오브젝트로 확인한다.
    data.objects.push(
      {
        id: 'bracket',
        name: 'Bracket',
        kind: 'part',
        parentId: 'lift',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        cadOrigin: 'deleted'
      },
      {
        id: 'nut',
        name: 'Nut',
        kind: 'part',
        parentId: 'lift',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        cadOrigin: 'lift'
      }
    )
    byId('lift').cadOrigin = 'cad'
    const { objects: loaded } = parseProject(JSON.stringify(data))
    expect(loaded.bracket).not.toHaveProperty('cadOrigin')
    expect(loaded.nut).not.toHaveProperty('cadOrigin')
    expect(loaded.lift).not.toHaveProperty('cadOrigin')
    expect(loaded.plate.cadOrigin).toBe('cad')
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('CAD 루트 밖에 있는데 cadOrigin이 없는 메시 파트는 형상 id로 출처를 채운다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const data = JSON.parse(serializeProject(grouped(), FIELD, relativize))
    for (const object of data.objects) delete object.cadOrigin
    const { objects: loaded } = parseProject(JSON.stringify(data))
    expect(loaded.plate.cadOrigin).toBe('cad')
    expect(warn).toHaveBeenCalledTimes(1)
    // CAD 루트 안에 있는 파트는 건드리지 않는다
    const inside = parseProject(serializeProject(objects, FIELD, relativize)).objects
    expect(inside.plate).not.toHaveProperty('cadOrigin')
    warn.mockRestore()
  })

  it('codeClassName은 그룹에만, cadOrigin은 문자열만 받는다', () => {
    const misplaced = JSON.parse(serializeProject(objects, FIELD, relativize))
    misplaced.objects[2].codeClassName = 'Plate'
    expect(() => parseProject(JSON.stringify(misplaced))).toThrow(ProjectFileError)
    const wrongType = JSON.parse(serializeProject(objects, FIELD, relativize))
    wrongType.objects[2].cadOrigin = 3
    expect(() => parseProject(JSON.stringify(wrongType))).toThrow(ProjectFileError)
  })
})

describe('스크립트 연결(버전 5)', () => {
  const LIFT = {
    path: 'src/main/java/org/firstinspires/ftc/teamcode/mech/Lift.java',
    className: 'org.firstinspires.ftc.teamcode.mech.Lift'
  }
  const ARM = {
    path: 'src/main/java/org/firstinspires/ftc/teamcode/Arm.java',
    className: 'org.firstinspires.ftc.teamcode.Arm'
  }
  const linked = (): SceneObjects => ({
    ...objects,
    plate: { ...objects.plate, scripts: [LIFT, ARM] },
    robot: { ...objects.robot, scripts: [LIFT] }
  })
  // 저장한 파일의 plate에 scripts를 넣는다
  const withScripts = (scripts: unknown): string => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    data.objects[2].scripts = scripts
    return JSON.stringify(data)
  }

  it('연결 목록(순서 포함)을 저장하고 그대로 읽는다', () => {
    const content = serializeProject(linked(), FIELD, relativize)
    const { objects: loaded, droppedScripts } = parseProject(content)
    expect(loaded).toEqual(linked())
    expect(droppedScripts).toEqual([])
    expect(serializeProject(loaded, FIELD, relativize)).toBe(content)
  })

  it('연결이 없으면 scripts를 쓰지 않고, 빈 목록도 쓰지 않는다', () => {
    const empty: SceneObjects = { ...objects, plate: { ...objects.plate, scripts: [] } }
    for (const object of JSON.parse(serializeProject(empty, FIELD, relativize)).objects) {
      expect(object).not.toHaveProperty('scripts')
    }
    expect(parseProject(withScripts([])).objects.plate).not.toHaveProperty('scripts')
  })

  it('형식이 틀린 연결은 invalidData', () => {
    for (const scripts of [
      'Lift.java',
      [LIFT.path],
      [{ path: LIFT.path }],
      [{ path: 3, className: LIFT.className }],
      [{ ...LIFT, className: null }]
    ]) {
      expect(() => parseProject(withScripts(scripts))).toThrow(ProjectFileError)
    }
  })

  it('연결할 수 없는 경로(git에서 온 믿을 수 없는 값)는 버리고 알리며, 나머지는 읽는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = [
      '../../../etc/passwd.java',
      'src/main/java/../../build.gradle',
      'C:/Windows/System32/calc.java',
      'src/main/java/org/firstinspires/ftc/teamcode/sandbot/RobotHardware.java',
      'src/main/java/org/firstinspires/ftc/teamcode/SandBot/RobotHardware.java',
      'src/main/java/org/firstinspires/ftc/teamcode/CON.java',
      'src/main/java/org/firstinspires/ftc/teamcode/Lift.java.',
      'src/main/java/org/firstinspires/ftc/teamcode/Lift.exe',
      'src/main/java\\org\\Lift.java'
    ]
    const { objects: loaded, droppedScripts } = parseProject(
      withScripts([...bad.map((path) => ({ path, className: 'X' })), LIFT, { ...LIFT }])
    )
    expect(loaded.plate.scripts).toEqual([LIFT])
    // 같은 경로를 두 번 둔 것도 하나만 남기고 센다
    expect(droppedScripts).toEqual([...bad, LIFT.path])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('경로는 NFC로 바꿔 읽고, 이름 형식이 아닌 className은 경로에서 만든다', () => {
    const korean = 'src/main/java/org/firstinspires/ftc/teamcode/리프트.java'
    const { objects: loaded } = parseProject(
      withScripts([
        { path: korean.normalize('NFD'), className: 'org.firstinspires.ftc.teamcode.리프트' },
        { path: ARM.path, className: 'not a class; rm -rf' }
      ])
    )
    expect(loaded.plate.scripts).toEqual([
      { path: korean.normalize('NFC'), className: 'org.firstinspires.ftc.teamcode.리프트' },
      ARM
    ])
  })

  it('버전 4 파일은 연결 없이 그대로 읽는다', () => {
    const v4 = JSON.parse(serializeProject(objects, FIELD, relativize))
    v4.version = 4
    const { objects: loaded } = parseProject(JSON.stringify(v4))
    expect(loaded).toEqual(objects)
  })
})

describe('바퀴(버전 6)', () => {
  const WHEEL = {
    kind: 'mecanum',
    diameter: 0.104,
    motor: 'm1',
    gearRatio: 1,
    angle: 0,
    rollers: 'auto',
    friction: 0
  } as const
  const withWheel = (): SceneObjects => ({
    ...objects,
    plate: { ...objects.plate, wheel: { ...WHEEL } }
  })
  // 저장한 파일의 오브젝트(index)에 wheel을 넣는다
  const fileWith = (index: number, wheel: unknown, version = 6): string => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    data.version = version
    data.objects[index].wheel = wheel
    return JSON.stringify(data)
  }

  it('바퀴를 저장하고 그대로 읽는다(바이트 단위로 같게 다시 쓴다)', () => {
    const content = serializeProject(withWheel(), FIELD, relativize)
    expect(JSON.parse(content).objects[2].wheel).toEqual(WHEEL)
    const { objects: loaded } = parseProject(content)
    expect(loaded).toEqual(withWheel())
    expect(serializeProject(loaded, FIELD, relativize)).toBe(content)
  })

  it('바퀴가 없으면 wheel을 쓰지 않는다', () => {
    for (const object of JSON.parse(serializeProject(objects, FIELD, relativize)).objects) {
      expect(object).not.toHaveProperty('wheel')
    }
  })

  it('지운 모터를 가리키는 참조는 그대로 남는다', () => {
    const { objects: loaded } = parseProject(fileWith(2, { ...WHEEL, motor: 'deleted-motor' }))
    expect(loaded.plate.wheel?.motor).toBe('deleted-motor')
  })

  it('로봇·CAD 루트의 바퀴, 모양·형식이 틀린 바퀴는 invalidData', () => {
    expect(() => parseProject(fileWith(0, WHEEL))).toThrow(ProjectFileError)
    expect(() => parseProject(fileWith(1, WHEEL))).toThrow(ProjectFileError)
    for (const wheel of [
      'mecanum',
      [WHEEL],
      { ...WHEEL, kind: 'swerve' },
      { ...WHEEL, kind: undefined },
      { ...WHEEL, diameter: '0.1' },
      { ...WHEEL, motor: 3 },
      { ...WHEEL, motor: null },
      { ...WHEEL, gearRatio: null },
      { ...WHEEL, angle: '0' },
      { ...WHEEL, rollers: 'left' }
    ]) {
      expect(() => parseProject(fileWith(2, wheel))).toThrow(ProjectFileError)
    }
  })

  it('범위 밖 수는 기본값으로 바꾸고 각은 (−π, π]로 감는다', () => {
    const { objects: loaded } = parseProject(
      fileWith(2, { ...WHEEL, kind: 'traction', diameter: 5, gearRatio: 0, angle: 3 * Math.PI })
    )
    expect(loaded.plate.wheel).toEqual({
      kind: 'traction',
      // 일반 바퀴의 기본 지름
      diameter: 0.096,
      motor: 'm1',
      gearRatio: 1,
      angle: Math.PI,
      rollers: 'auto',
      friction: 0
    })
    const { objects: negative } = parseProject(
      fileWith(2, { ...WHEEL, diameter: -0.1, gearRatio: 1e6, angle: -Math.PI / 2 })
    )
    expect(negative.plate.wheel).toMatchObject({
      diameter: 0.104,
      gearRatio: 1,
      angle: -Math.PI / 2
    })
  })

  it('버전 8 이하의 바퀴는 friction 없이 읽고 종류 기본(0)이다. 범위 밖 friction은 0으로 바꾼다(버전 9)', () => {
    const legacy: Record<string, unknown> = { ...WHEEL }
    delete legacy.friction
    expect(parseProject(fileWith(2, legacy, 8)).objects.plate.wheel?.friction).toBe(0)
    expect(
      parseProject(fileWith(2, { ...WHEEL, friction: 0.75 }, 9)).objects.plate.wheel?.friction
    ).toBe(0.75)
    for (const friction of [0.01, 4, -1, Number.MAX_VALUE])
      expect(
        parseProject(fileWith(2, { ...WHEEL, friction }, 9)).objects.plate.wheel?.friction
      ).toBe(0)
    expect(() => parseProject(fileWith(2, { ...WHEEL, friction: '0.5' }, 9))).toThrow(
      ProjectFileError
    )
  })

  it('그룹·어셈블리에도 둘 수 있다', () => {
    const scene: SceneObjects = {
      ...objects,
      lift: {
        id: 'lift',
        name: 'FL',
        kind: 'group',
        parentId: 'robot',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        wheel: { ...WHEEL, kind: 'omni', rollers: 'auto', diameter: 0.096 }
      }
    }
    expect(parseProject(serializeProject(scene, FIELD, relativize)).objects).toEqual(scene)
  })

  it('버전 5 파일은 바퀴 없이 그대로 읽는다', () => {
    const v5 = JSON.parse(serializeProject(objects, FIELD, relativize))
    v5.version = 5
    const { objects: loaded } = parseProject(JSON.stringify(v5))
    expect(loaded).toEqual(objects)
    expect(Object.values(loaded).some((object) => object.wheel)).toBe(false)
  })

  it('더 새 버전은 열지 않는다', () => {
    expect(() => parseProject(fileWith(2, WHEEL, PROJECT_VERSION + 1))).toThrow(
      expect.objectContaining({ code: 'newerVersion' })
    )
  })
})

describe('질량 설정(버전 7)', () => {
  const withMass = (): SceneObjects => ({
    ...objects,
    robot: { ...objects.robot, rigidbody: { weighedMass: 14.2, defaultMaterial: 'pla' } },
    cad: { ...objects.cad, mass: { material: 'petg', infill: 0.4 } },
    plate: { ...objects.plate, mass: { mass: 0.437, centerOfMass: [0, 0.01, -0.02] } }
  })
  // 저장한 파일의 오브젝트(index)에 field 값을 넣는다
  const fileWith = (index: number, field: string, value: unknown, version = 7): string => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    data.version = version
    data.objects[index][field] = value
    return JSON.stringify(data)
  }

  it('질량 설정과 Rigidbody를 저장하고 그대로 읽는다(바이트 단위로 같게 다시 쓴다)', () => {
    const content = serializeProject(withMass(), FIELD, relativize)
    const stored = JSON.parse(content).objects
    expect(stored[0].rigidbody).toEqual({ weighedMass: 14.2, defaultMaterial: 'pla' })
    expect(stored[1].mass).toEqual({ material: 'petg', infill: 0.4 })
    const { objects: loaded } = parseProject(content)
    expect(loaded).toEqual(withMass())
    expect(serializeProject(loaded, FIELD, relativize)).toBe(content)
  })

  it('빈 질량 설정(카드만 붙임)은 남기고, 빈 Rigidbody는 버린다', () => {
    const { objects: loaded } = parseProject(fileWith(2, 'mass', {}))
    expect(loaded.plate.mass).toEqual({})
    const { objects: robot } = parseProject(fileWith(0, 'rigidbody', {}))
    expect(robot.robot).not.toHaveProperty('rigidbody')
  })

  it('설정이 없으면 mass·rigidbody를 쓰지 않는다', () => {
    for (const object of JSON.parse(serializeProject(objects, FIELD, relativize)).objects) {
      expect(object).not.toHaveProperty('mass')
      expect(object).not.toHaveProperty('rigidbody')
    }
  })

  it('모르는 재질 키와 범위 밖·형식이 틀린 값은 그 필드만 버린다', () => {
    const { objects: loaded } = parseProject(
      fileWith(2, 'mass', {
        material: 'vibranium',
        infill: 2,
        mass: 101,
        centerOfMass: [0, 0, 50],
        extra: true
      })
    )
    expect(loaded.plate.mass).toEqual({})
    const { objects: partial } = parseProject(
      fileWith(2, 'mass', { material: 'steel', infill: '0.2', mass: 0.3, centerOfMass: [1, 2] })
    )
    expect(partial.plate.mass).toEqual({ material: 'steel', mass: 0.3 })
    const { objects: robot } = parseProject(
      fileWith(0, 'rigidbody', { weighedMass: 500, defaultMaterial: 'aluminum7075' })
    )
    expect(robot.robot.rigidbody).toEqual({ defaultMaterial: 'aluminum7075' })
  })

  it('로봇의 질량 설정, 로봇이 아닌 오브젝트의 Rigidbody, 객체가 아닌 값은 invalidData', () => {
    expect(() => parseProject(fileWith(0, 'mass', {}))).toThrow(ProjectFileError)
    expect(() => parseProject(fileWith(1, 'rigidbody', { weighedMass: 1 }))).toThrow(
      ProjectFileError
    )
    for (const value of ['steel', [1], null, 3]) {
      expect(() => parseProject(fileWith(2, 'mass', value))).toThrow(ProjectFileError)
      expect(() => parseProject(fileWith(0, 'rigidbody', value))).toThrow(ProjectFileError)
    }
  })

  it('CAD 루트·그룹에도 둘 수 있다', () => {
    const scene: SceneObjects = {
      ...objects,
      cad: { ...objects.cad, mass: { mass: 3 } },
      battery: {
        id: 'battery',
        name: 'Battery',
        kind: 'group',
        parentId: 'robot',
        transform: { position: [0, 0, 0.05], rotation: [0, 0, 0] },
        mass: { mass: 0.597 }
      }
    }
    expect(parseProject(serializeProject(scene, FIELD, relativize)).objects).toEqual(scene)
  })

  it('버전 6 파일은 질량 설정 없이 그대로 읽는다', () => {
    const v6 = JSON.parse(serializeProject(objects, FIELD, relativize))
    v6.version = 6
    const { objects: loaded } = parseProject(JSON.stringify(v6))
    expect(loaded).toEqual(objects)
    expect(Object.values(loaded).some((object) => object.mass || object.rigidbody)).toBe(false)
    // 다시 저장하면 지금 버전이 된다
    expect(JSON.parse(serializeProject(loaded, FIELD, relativize)).version).toBe(PROJECT_VERSION)
  })
})

describe('관절(버전 8)', () => {
  const JOINT: JointSettings = {
    type: 'prismatic',
    anchor: [0, 0.02, -0.1],
    axis: 'z',
    axisSign: -1,
    limits: { lower: 0, upper: 0.488 },
    friction: { coulomb: 1, viscous: 0.5 },
    spring: { kind: 'constantForce', force: 35.2 },
    drive: {
      kind: 'motor',
      motors: ['m1', 'deleted-motor'],
      gearRatio: 1,
      spoolDiameter: 0.0357,
      rigging: { kind: 'continuous', stages: ['stage2'] }
    }
  }
  const withJoint = (): SceneObjects => ({
    ...objects,
    plate: { ...objects.plate, joint: structuredClone(JOINT) },
    cad: { ...objects.cad, joint: { ...structuredClone(JOINT), type: 'revolute', limits: null } }
  })
  // 저장한 파일의 오브젝트(index)에 joint를 넣는다
  const fileWith = (index: number, joint: unknown, version = 8): string => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    data.version = version
    data.objects[index].joint = joint
    return JSON.stringify(data)
  }

  it('관절을 저장하고 그대로 읽는다(바이트 단위로 같게 다시 쓴다, 끊긴 id는 남긴다)', () => {
    const content = serializeProject(withJoint(), FIELD, relativize)
    expect(JSON.parse(content).objects[2].joint).toEqual(JOINT)
    const { objects: loaded } = parseProject(content)
    expect(loaded).toEqual(withJoint())
    expect(serializeProject(loaded, FIELD, relativize)).toBe(content)
  })

  it('모든 구동 종류와 스프링 종류를 읽는다', () => {
    const drives: JointSettings['drive'][] = [
      { kind: 'none' },
      { kind: 'stage' },
      { kind: 'servo', servo: 's1', gearRatio: 2, editPosition: 0.5, direction: 1 },
      { kind: 'crServo', servo: 's2', gearRatio: 1, spoolDiameter: 0.03, direction: 1 },
      { ...(JOINT.drive as object), rigging: { kind: 'direct' } } as JointSettings['drive']
    ]
    for (const drive of drives)
      for (const spring of [null, { kind: 'linear', stiffness: 20, rest: 0.1 }] as const) {
        const joint = { ...JOINT, drive, spring }
        expect(parseProject(fileWith(2, joint)).objects.plate.joint).toEqual(joint)
      }
  })

  it('서보 구동의 편집 자세 위치·방향이 없는 예전 v8 파일은 기본값(0.5, +축)으로 읽는다', () => {
    const old = { ...JOINT, type: 'revolute', limits: null }
    expect(
      parseProject(fileWith(2, { ...old, drive: { kind: 'servo', servo: 's1', gearRatio: 2 } }))
        .objects.plate.joint?.drive
    ).toEqual({ kind: 'servo', servo: 's1', gearRatio: 2, editPosition: 0.5, direction: 1 })
    expect(
      parseProject(
        fileWith(2, {
          ...old,
          drive: { kind: 'crServo', servo: 's2', gearRatio: 1, spoolDiameter: 0.03 }
        })
      ).objects.plate.joint?.drive
    ).toEqual({ kind: 'crServo', servo: 's2', gearRatio: 1, spoolDiameter: 0.03, direction: 1 })
    // 고친 값은 그대로 읽고 다시 쓴다
    const drive = { kind: 'servo', servo: 's1', gearRatio: 2, editPosition: 0.35, direction: -1 }
    expect(parseProject(fileWith(2, { ...old, drive })).objects.plate.joint?.drive).toEqual(drive)
  })

  it('범위 밖 수는 기본값으로 바꾼다', () => {
    const { objects: loaded } = parseProject(
      fileWith(2, {
        ...JOINT,
        anchor: [0, 0, 20],
        limits: null,
        friction: { coulomb: -1, viscous: 0.5 },
        spring: { kind: 'constantForce', force: -3 },
        drive: { ...JOINT.drive, gearRatio: 0 }
      })
    )
    expect(loaded.plate.joint).toMatchObject({
      anchor: [0, 0, 0],
      // 직선 관절은 한계가 늘 있다
      limits: { lower: 0, upper: 0.5 },
      friction: { coulomb: 1, viscous: 0.5 },
      spring: null,
      drive: { gearRatio: 1 }
    })
  })

  it('로봇의 관절, 바퀴와 같은 오브젝트의 관절, 모양·형식이 틀린 관절은 invalidData', () => {
    expect(() => parseProject(fileWith(0, JOINT))).toThrow(ProjectFileError)
    const data = JSON.parse(fileWith(2, JOINT))
    data.objects[2].wheel = {
      kind: 'mecanum',
      diameter: 0.104,
      motor: '',
      gearRatio: 1,
      angle: 0,
      rollers: 'auto'
    }
    expect(() => parseProject(JSON.stringify(data))).toThrow(ProjectFileError)
    for (const joint of [
      'revolute',
      [JOINT],
      null,
      { ...JOINT, type: 'spherical' },
      { ...JOINT, anchor: [0, 0] },
      { ...JOINT, anchor: [0, '0', 0] },
      { ...JOINT, axis: 'w' },
      { ...JOINT, axisSign: 0 },
      { ...JOINT, limits: { lower: 0 } },
      { ...JOINT, limits: 0.5 },
      { ...JOINT, friction: { coulomb: 1 } },
      { ...JOINT, spring: { kind: 'gas', force: 1 } },
      { ...JOINT, spring: { kind: 'linear', stiffness: 1 } },
      { ...JOINT, drive: { kind: 'magic' } },
      { ...JOINT, drive: { ...JOINT.drive, motors: 'm1' } },
      { ...JOINT, drive: { ...JOINT.drive, motors: [1] } },
      { ...JOINT, drive: { ...JOINT.drive, rigging: { kind: 'cascade' } } },
      { ...JOINT, drive: { ...JOINT.drive, rigging: { kind: 'belt', stages: [] } } },
      { ...JOINT, drive: { kind: 'servo', servo: 3, gearRatio: 1 } },
      { ...JOINT, drive: { kind: 'crServo', servo: 's', gearRatio: 1 } },
      { ...JOINT, drive: { kind: 'servo', servo: 's', gearRatio: 1, editPosition: '0.5' } },
      { ...JOINT, drive: { kind: 'servo', servo: 's', gearRatio: 1, direction: 'reverse' } },
      {
        ...JOINT,
        drive: { kind: 'crServo', servo: 's', gearRatio: 1, spoolDiameter: 0.03, direction: null }
      }
    ]) {
      expect(() => parseProject(fileWith(2, joint))).toThrow(ProjectFileError)
    }
  })

  it('관절이 없으면 joint를 쓰지 않고, 버전 7 파일은 관절 없이 그대로 읽는다', () => {
    for (const object of JSON.parse(serializeProject(objects, FIELD, relativize)).objects)
      expect(object).not.toHaveProperty('joint')
    const v7 = JSON.parse(serializeProject(objects, FIELD, relativize))
    v7.version = 7
    const { objects: loaded } = parseProject(JSON.stringify(v7))
    expect(loaded).toEqual(objects)
    expect(JSON.parse(serializeProject(loaded, FIELD, relativize)).version).toBe(PROJECT_VERSION)
  })
})

describe('버전과 하위 호환', () => {
  it('버전 2 CAD(meshIndexing 없음)는 예전 형상 id 방식으로 읽고, 모르는 방식은 거부한다', () => {
    const legacy = JSON.parse(serializeProject(objects, FIELD, relativize))
    legacy.version = 2
    delete legacy.objects[1].cad.meshIndexing
    expect(parseProject(JSON.stringify(legacy)).objects.cad.cad?.meshIndexing).toBeUndefined()
    legacy.objects[1].cad.meshIndexing = 'sorted'
    expect(() => parseProject(JSON.stringify(legacy))).toThrow(ProjectFileError)
  })

  it('버전 1 파일(컴포넌트 없음)도 열린다', () => {
    const v1 = JSON.stringify({
      format: 'sandbot-project',
      version: 1,
      objects: [
        {
          id: 'robot',
          name: 'Robot',
          kind: 'robot',
          parentId: null,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
        }
      ]
    })
    const { objects: loaded } = parseProject(v1)
    expect(loaded.robot.components).toBeUndefined()
    expect(loaded.robot.hardware).toBeUndefined()
  })

  it('컴포넌트 속성은 카탈로그 키만 남기고, 없거나 잘못된 값은 기본값으로 채운다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    data.objects[2].components[0].props = { direction: 'sideways', extra: 1 }
    const { objects: loaded } = parseProject(JSON.stringify(data))
    expect(loaded.plate.components![0].props).toEqual({
      motorModel: 'goBilda5202',
      direction: 'forward',
      runMode: 'withoutEncoder',
      zeroPowerBehavior: 'brake',
      // 시뮬레이터 전용 속성(v6·v8)도 기본값(0 = 모델 기본·데이터시트)으로 채운다
      gearbox: 0,
      stallTorque: 0,
      freeSpeed: 0
    })
  })

  it('버전 5 이하 파일의 모터·데드휠은 새 시뮬레이터 속성을 기본값으로 채운다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    data.version = 5
    delete data.objects[2].components[0].props.gearbox
    data.objects[2].components.push({
      id: 'dw',
      type: 'deadWheel',
      name: 'par',
      hub: 'controlHub',
      port: 1,
      props: { measures: 'forward', reversed: 'yes' }
    })
    const { objects: loaded } = parseProject(JSON.stringify(data))
    expect(loaded.plate.components![0].props.gearbox).toBe(0)
    expect(loaded.plate.components![1].props).toEqual({
      measures: 'forward',
      reversed: 'yes',
      podType: 'fourBar',
      podDiameter: 0.035,
      podCpr: 8192
    })
  })

  it('길이 속성은 범위 밖이거나 수가 아니면 기본값으로 채운다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    const deadWheel = (podDiameter: unknown): Record<string, unknown> => ({
      id: `dw${data.objects[2].components.length}`,
      type: 'deadWheel',
      name: `dw${data.objects[2].components.length}`,
      hub: 'controlHub',
      port: 1,
      props: { podType: 'custom', podDiameter, podCpr: 4000 }
    })
    for (const value of [0.048, 5, -0.01, '0.04', null])
      data.objects[2].components.push(deadWheel(value))
    const { objects: loaded } = parseProject(JSON.stringify(data))
    expect(loaded.plate.components!.slice(1).map((c) => c.props.podDiameter)).toEqual([
      0.048, 0.035, 0.035, 0.035, 0.035
    ])
    expect(loaded.plate.components![1].props.podCpr).toBe(4000)
  })

  it('리밋 스위치의 거리(길이)·각도(라디안)는 범위 밖이거나 수가 아니면 0(기본)으로 채운다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    const values: unknown[] = [0.005, 2, -0.1, '0.01', null]
    values.forEach((value, i) =>
      data.objects[2].components.push({
        id: `ls${i}`,
        type: 'touchSensor',
        name: `ls${i}`,
        hub: 'controlHub',
        port: i,
        props: { limitJoint: 'j', limitAt: 'upper', limitDistance: value, limitAngle: value }
      })
    )
    const { objects: loaded } = parseProject(JSON.stringify(data))
    const switches = loaded.plate.components!.slice(1)
    expect(switches.map((c) => c.props.limitDistance)).toEqual([0.005, 0, 0, 0, 0])
    expect(switches.map((c) => c.props.limitAngle)).toEqual([0.005, 0, 0, 0, 0])
    expect(switches[0].props.limitAt).toBe('upper')
  })
})

describe('잘못된 프로젝트 파일', () => {
  const codeOf = (content: string): string | undefined => {
    try {
      parseProject(content)
    } catch (error) {
      return error instanceof ProjectFileError ? error.code : 'other'
    }
    return undefined
  }
  const valid = (): Record<string, unknown> =>
    JSON.parse(serializeProject(objects, FIELD, relativize))

  it('JSON이 아니면 invalidJson', () => {
    expect(codeOf('{ nope')).toBe('invalidJson')
  })

  it('다른 형식이면 notProject, 더 새 버전이면 newerVersion', () => {
    expect(codeOf(JSON.stringify({ format: 'other' }))).toBe('notProject')
    expect(codeOf(JSON.stringify({ ...valid(), version: PROJECT_VERSION + 1 }))).toBe(
      'newerVersion'
    )
    expect(codeOf(JSON.stringify({ ...valid(), version: 99 }))).toBe('newerVersion')
  })

  it('부모 순환이나 최상위가 아닌 로봇은 invalidData(모든 버전)', () => {
    const cycle = valid()
    const list = cycle.objects as { id: string; parentId: string | null }[]
    list[1].parentId = 'plate'
    expect(codeOf(JSON.stringify(cycle))).toBe('invalidData')
    expect(codeOf(JSON.stringify({ ...cycle, version: 1 }))).toBe('invalidData')

    const selfParent = valid()
    ;(selfParent.objects as { parentId: string | null }[])[2].parentId = 'plate'
    expect(codeOf(JSON.stringify(selfParent))).toBe('invalidData')

    const nested = valid()
    ;(nested.objects as Record<string, unknown>[]).push({
      id: 'robot2',
      name: 'Robot 2',
      kind: 'robot',
      parentId: 'cad',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
    })
    expect(codeOf(JSON.stringify(nested))).toBe('invalidData')
  })

  it('부모가 없는 오브젝트나 깨진 변환은 invalidData', () => {
    const dangling = valid()
    ;(dangling.objects as { parentId: string }[])[2].parentId = 'missing'
    expect(codeOf(JSON.stringify(dangling))).toBe('invalidData')

    const unknownType = valid()
    ;(unknownType.objects as { components: { type: string }[] }[])[2].components[0].type =
      'warpDrive'
    expect(codeOf(JSON.stringify(unknownType))).toBe('invalidData')

    const hardwareOnPart = valid()
    ;(hardwareOnPart.objects as { hardware?: unknown }[])[2].hardware = (
      hardwareOnPart.objects as { hardware?: unknown }[]
    )[0].hardware
    expect(codeOf(JSON.stringify(hardwareOnPart))).toBe('invalidData')

    const broken = valid()
    ;(broken.objects as { transform: unknown }[])[0].transform = { position: [0, 0], rotation: [] }
    expect(codeOf(JSON.stringify(broken))).toBe('invalidData')
  })
})

// spec-4ab §2.1: 프로젝트 v10 field({ season })
describe('필드(v10)', () => {
  const codeOf = (content: string): string | undefined => {
    try {
      parseProject(content)
    } catch (error) {
      return error instanceof ProjectFileError ? `${error.code}:${error.message}` : 'other'
    }
    return undefined
  }

  // B1
  it('v10 왕복: field와 objects를 그대로 내고, 파일에 "field": { "season": … }가 있다', () => {
    const content = serializeProject(objects, { season: 'biobuzz' }, relativize)
    expect(content).toContain('"field": {\n    "season": "biobuzz"\n  }')
    // 머리(format, version, field) 다음에 objects
    expect(Object.keys(JSON.parse(content))).toEqual([
      'format',
      'version',
      'field',
      'settings',
      'objects'
    ])
    const loaded = parseProject(content)
    expect(loaded.field).toEqual({ season: 'biobuzz' })
    expect(loaded.fieldDefaulted).toBe(false)
    expect(loaded.objects).toEqual(objects)
    expect(serializeProject(loaded.objects, loaded.field, relativize)).toBe(content)
    // 'none'도 같다
    expect(parseProject(serializeProject(objects, FIELD, relativize)).field).toEqual(FIELD)
  })

  it('저장은 field의 season만 쓴다(다른 키는 쓰지 않는다)', () => {
    const extra = { season: 'none', hive: 'tipped' } as FieldDoc
    expect(JSON.parse(serializeProject(objects, extra, relativize)).field).toEqual({
      season: 'none'
    })
  })

  // B2
  it('v9 이하(field 없음)는 BIOBUZZ로 읽고 fieldDefaulted, v10은 아니다', () => {
    const v9 = JSON.parse(serializeProject(objects, FIELD, relativize))
    v9.version = 9
    delete v9.field
    expect(parseProject(JSON.stringify(v9))).toMatchObject({
      field: { season: 'biobuzz' },
      fieldDefaulted: true
    })
    // v9에 field가 있어도(손으로 고친 파일) 보지 않는다
    v9.field = { season: 'none' }
    expect(parseProject(JSON.stringify(v9)).field).toEqual({ season: 'biobuzz' })
    const v1 = JSON.stringify({
      format: 'sandbot-project',
      version: 1,
      objects: [
        {
          id: 'robot',
          name: 'Robot',
          kind: 'robot',
          parentId: null,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
        }
      ]
    })
    expect(parseProject(v1)).toMatchObject({ field: { season: 'biobuzz' }, fieldDefaulted: true })
    expect(parseProject(serializeProject(objects, FIELD, relativize)).fieldDefaulted).toBe(false)
  })

  it('v9에서 읽은 기본 field는 공유 기본값 객체가 아니다(얼린 객체를 스토어에 넣지 않는다)', () => {
    const v9 = JSON.parse(serializeProject(objects, FIELD, relativize))
    v9.version = 9
    delete v9.field
    const { field } = parseProject(JSON.stringify(v9))
    expect(Object.isFrozen(field)).toBe(false)
  })

  // B3(파일 쪽)
  it('모양이 맞는 모르는 시즌은 보존하고 다시 저장해도 그 문자열이다', () => {
    const content = serializeProject(objects, { season: 'decode2027' }, relativize)
    const loaded = parseProject(content)
    expect(loaded.field).toEqual({ season: 'decode2027' })
    expect(loaded.fieldDefaulted).toBe(false)
    expect(serializeProject(loaded.objects, loaded.field, relativize)).toBe(content)
  })

  it('field의 다른 키는 버린다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    data.field = { season: 'biobuzz', hiveState: 'tipped', extra: 1 }
    expect(parseProject(JSON.stringify(data)).field).toEqual({ season: 'biobuzz' })
  })

  // B4
  it('v10에서 field 없음·객체 아님·숫자 시즌·정규식 밖·65자는 invalidData(field)', () => {
    const withField = (field: unknown, remove = false): string => {
      const data = JSON.parse(serializeProject(objects, FIELD, relativize))
      if (remove) delete data.field
      else data.field = field
      return JSON.stringify(data)
    }
    const expected = 'invalidData:invalidData: field'
    expect(codeOf(withField(undefined, true))).toBe(expected)
    expect(codeOf(withField(null))).toBe(expected)
    expect(codeOf(withField('biobuzz'))).toBe(expected)
    expect(codeOf(withField([{ season: 'biobuzz' }]))).toBe(expected)
    expect(codeOf(withField({}))).toBe(expected)
    expect(codeOf(withField({ season: 2026 }))).toBe(expected)
    for (const season of ['', 'BioBuzz', '2026', 'bio-buzz', 'bio buzz', 'bió', 'a'.repeat(65)])
      expect(codeOf(withField({ season })), season).toBe(expected)
    // 경계: 64자, 소문자로 시작하는 영숫자(대문자·숫자 포함)는 받는다
    for (const season of ['a'.repeat(64), 'decode2027', 'intoTheDeep', 'x'])
      expect(codeOf(withField({ season })), season).toBeUndefined()
  })
})

describe('필드 CAD 보기(v11, spec-4e §2.3)', () => {
  const VISUAL = {
    fileName: 'field-cad-step.step',
    absolutePath: '/home/team/field/field-cad-step.step',
    upAxis: '+Y',
    forwardAxis: '+Z'
  } as const
  const WITH_VISUAL: FieldDoc = { season: 'biobuzz', visual: { ...VISUAL } }

  // A1
  it('왕복: 같은 FieldDoc과 fieldVisualFile을 내고, 파일은 version 13(지금 판)와 키를 골라 쓴 모양이다', () => {
    const content = serializeProject(objects, WITH_VISUAL, relativize)
    const data = JSON.parse(content)
    expect(data.version).toBe(13)
    expect(PROJECT_VERSION).toBe(13)
    expect(data.field).toEqual({
      season: 'biobuzz',
      visual: {
        fileName: 'field-cad-step.step',
        upAxis: '+Y',
        forwardAxis: '+Z',
        file: {
          relativePath: '../field/field-cad-step.step',
          absolutePath: '/home/team/field/field-cad-step.step'
        }
      }
    })
    // 키 순서도 명세 모양 그대로(git diff로 읽는 파일)
    expect(Object.keys(data.field.visual)).toEqual(['fileName', 'upAxis', 'forwardAxis', 'file'])
    const loaded = parseProject(content)
    expect(loaded.field).toEqual(WITH_VISUAL)
    expect(loaded.fieldVisualFile).toEqual({
      relativePath: '../field/field-cad-step.step',
      absolutePath: '/home/team/field/field-cad-step.step'
    })
    expect(loaded.fieldVisualDropped).toBe(false)
    expect(serializeProject(loaded.objects, loaded.field, relativize)).toBe(content)
  })

  it('문서 visual에 끼운 다른 키는 파일에 없다', () => {
    const extra = { season: 'biobuzz', visual: { ...VISUAL, extra: 1 } } as FieldDoc
    const { visual } = JSON.parse(serializeProject(objects, extra, relativize)).field
    expect(Object.keys(visual)).toEqual(['fileName', 'upAxis', 'forwardAxis', 'file'])
  })

  it('절대 경로가 비면 relativePath는 null이다', () => {
    const empty: FieldDoc = { season: 'none', visual: { ...VISUAL, absolutePath: '' } }
    const { visual } = JSON.parse(serializeProject(objects, empty, relativize)).field
    expect(visual.file).toEqual({ relativePath: null, absolutePath: '' })
  })

  it('못 찾은 필드 CAD의 파일 값은 절대 경로가 같을 때만 그대로 쓴다(비평 U2)', () => {
    const kept: StoredCadFile = {
      relativePath: '../field/field.step',
      absolutePath: VISUAL.absolutePath
    }
    const write = (fieldVisualFile: StoredCadFile | null): unknown =>
      JSON.parse(serializeProject(objects, WITH_VISUAL, () => 'relativized', { fieldVisualFile }))
        .field.visual.file
    expect(write(kept)).toEqual(kept)
    // 경로가 다르면(다시 찾음) 지금 경로로 다시 계산한다
    expect(write({ ...kept, absolutePath: '/other.step' })).toEqual({
      relativePath: 'relativized',
      absolutePath: VISUAL.absolutePath
    })
    expect(write(null)).toEqual({ relativePath: 'relativized', absolutePath: VISUAL.absolutePath })
  })

  // A2
  it('visual 없는 field는 season만 쓴다(version만 11)', () => {
    const content = serializeProject(objects, { season: 'biobuzz' }, relativize)
    expect(JSON.parse(content).field).toEqual({ season: 'biobuzz' })
    expect(content).toContain('"field": {\n    "season": "biobuzz"\n  }')
    const loaded = parseProject(content)
    expect('visual' in loaded.field).toBe(false)
    expect(loaded.fieldVisualFile).toBeNull()
    expect(loaded.fieldVisualDropped).toBe(false)
  })

  it('v10 파일은 visual 키가 있어도 버리고, 다시 쓰면 지금 판이다', () => {
    const data = JSON.parse(serializeProject(objects, WITH_VISUAL, relativize))
    data.version = 10
    const loaded = parseProject(JSON.stringify(data))
    expect(loaded.field).toEqual({ season: 'biobuzz' })
    expect('visual' in loaded.field).toBe(false)
    expect(loaded.fieldVisualFile).toBeNull()
    expect(loaded.fieldVisualDropped).toBe(false)
    expect(JSON.parse(serializeProject(loaded.objects, loaded.field, relativize)).version).toBe(13)
  })

  // A3
  it('틀린 visual은 버리고 파일은 연다(fieldVisualDropped), season이 틀리면 지금처럼 invalidData', () => {
    const good = JSON.parse(serializeProject(objects, WITH_VISUAL, relativize)).field.visual
    const withVisual = (visual: unknown): string => {
      const data = JSON.parse(serializeProject(objects, WITH_VISUAL, relativize))
      data.field.visual = visual
      return JSON.stringify(data)
    }
    const { file, ...rest } = good
    const cases: unknown[] = [
      [good],
      'field.step',
      null,
      { ...good, fileName: 3 },
      { ...good, upAxis: 'Y' },
      { ...good, upAxis: '+Y', forwardAxis: '-Y' },
      rest,
      { ...good, file: { ...file, relativePath: 3 } },
      { ...good, file: { relativePath: file.relativePath } },
      { ...good, file: 'x' }
    ]
    for (const visual of cases) {
      const loaded = parseProject(withVisual(visual))
      expect(loaded.objects, JSON.stringify(visual)).toEqual(objects)
      expect(loaded.field).toEqual({ season: 'biobuzz' })
      expect('visual' in loaded.field).toBe(false)
      expect(loaded.fieldVisualDropped, JSON.stringify(visual)).toBe(true)
      expect(loaded.fieldVisualFile).toBeNull()
    }
    // relativePath null은 맞는 값이다. visual의 다른 키는 버린다.
    const loaded = parseProject(
      withVisual({ ...good, extra: 1, file: { ...file, relativePath: null, more: 2 } })
    )
    expect(loaded.fieldVisualDropped).toBe(false)
    expect(loaded.field.visual).toEqual(VISUAL)
    expect(loaded.fieldVisualFile).toEqual({ relativePath: null, absolutePath: file.absolutePath })
    // season이 틀리면 visual과 관계없이 파일 오류다
    const bad = JSON.parse(withVisual(good))
    bad.field.season = 'Bad'
    expect(() => parseProject(JSON.stringify(bad))).toThrow('invalidData: field')
  })
})

describe('프로젝트 설정(v12 settings, 코드 단위)', () => {
  const CM_RAD = { codeUnits: { length: 'cm', angle: 'rad' } } as const

  it('왕복: settings를 키를 골라 쓰고 그대로 읽는다', () => {
    const content = serializeProject(objects, FIELD, relativize, { settings: CM_RAD })
    const data = JSON.parse(content)
    expect(data.version).toBe(13)
    expect(data.settings).toEqual({ codeUnits: { length: 'cm', angle: 'rad' } })
    const loaded = parseProject(content)
    expect(loaded.settings).toEqual(CM_RAD)
    expect(loaded.settingsDropped).toBe(false)
  })

  it('settings를 넘기지 않으면 기본값(sdk)을 쓴다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    expect(data.settings).toEqual({ codeUnits: { length: 'sdk', angle: 'sdk' } })
  })

  it('v11 이하는 settings를 보지 않고 기본값이다(알리지 않음)', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize, { settings: CM_RAD }))
    data.version = 11
    const loaded = parseProject(JSON.stringify(data))
    expect(loaded.settings.codeUnits).toEqual({ length: 'sdk', angle: 'sdk' })
    expect(loaded.settingsDropped).toBe(false)
  })

  it('v12 이상에 settings가 없으면 기본값이고 알리지 않는다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    delete data.settings
    const loaded = parseProject(JSON.stringify(data))
    expect(loaded.settings.codeUnits).toEqual({ length: 'sdk', angle: 'sdk' })
    expect(loaded.settingsDropped).toBe(false)
  })

  it.each([
    ['배열', []],
    ['codeUnits 없음', {}],
    ['모르는 길이', { codeUnits: { length: 'ft', angle: 'deg' } }],
    ['모르는 각도', { codeUnits: { length: 'mm', angle: 'grad' } }],
    ['문자열', 'mm']
  ])('틀린 settings(%s)는 기본값으로 읽고 프로젝트는 연다', (_label, settings) => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    data.settings = settings
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loaded = parseProject(JSON.stringify(data))
    warn.mockRestore()
    expect(loaded.settings.codeUnits).toEqual({ length: 'sdk', angle: 'sdk' })
    expect(loaded.settingsDropped).toBe(true)
    expect(Object.keys(loaded.objects)).toEqual(Object.keys(objects))
  })

  it('모르는 키는 버린다', () => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize, { settings: CM_RAD }))
    data.settings.extra = 1
    data.settings.codeUnits.extra = 2
    const loaded = parseProject(JSON.stringify(data))
    expect(loaded.settings).toEqual(CM_RAD)
  })
})

describe('충돌체와 자기 충돌(v13, spec-5 §2.3)', () => {
  const COLLIDERS: ColliderSettings[] = [
    { id: 'c-box', kind: 'box', center: [0.01, 0, 0.02], size: [0.1, 0.2, 0.05] },
    {
      id: 'c-cap',
      kind: 'capsule',
      enabled: false,
      center: [0, 0, 0],
      radius: 0.02,
      height: 0.3,
      direction: 'y',
      friction: 0.9
    },
    { id: 'c-mesh', kind: 'mesh', vertexLimit: 48, friction: 0 }
  ]
  const COLLISION: RobotCollisionSettings = {
    forceCollide: [
      ['cad', 'robot'],
      ['deleted-joint', 'robot']
    ]
  }
  const withColliders = (): SceneObjects => ({
    ...objects,
    robot: { ...objects.robot, collision: structuredClone(COLLISION) },
    plate: { ...objects.plate, colliders: structuredClone(COLLIDERS) },
    cad: { ...objects.cad, colliders: [structuredClone(COLLIDERS[0])] }
  })
  // 저장한 파일의 오브젝트(index)에 칸 하나를 넣는다
  const fileWith = (index: number, key: string, value: unknown, version = 13): string => {
    const data = JSON.parse(serializeProject(objects, FIELD, relativize))
    data.version = version
    data.objects[index][key] = value
    return JSON.stringify(data)
  }

  it('B1 왕복: 종류마다(끈 것 하나) colliders와 collision을 그대로 읽고 바이트 단위로 같게 다시 쓴다', () => {
    const content = serializeProject(withColliders(), FIELD, relativize)
    const data = JSON.parse(content)
    expect(data.version).toBe(13)
    expect(data.objects[2].colliders).toEqual(COLLIDERS)
    expect(data.objects[0].collision).toEqual(COLLISION)
    // 키 순서는 정리 순서(id, kind, enabled?, 종류 칸, friction)라 git diff가 안정하다
    expect(Object.keys(data.objects[2].colliders[1])).toEqual([
      'id',
      'kind',
      'enabled',
      'center',
      'radius',
      'height',
      'direction',
      'friction'
    ])
    const { objects: loaded } = parseProject(content)
    expect(loaded).toEqual(withColliders())
    expect(serializeProject(loaded, FIELD, relativize)).toBe(content)
  })

  it('B2 v12 파일은 colliders 없이 열리고 다시 쓰면 13, 충돌체 없는 오브젝트는 바이트 같다', () => {
    const v13 = serializeProject(objects, FIELD, relativize)
    const v12 = JSON.parse(v13)
    v12.version = 12
    const { objects: loaded } = parseProject(JSON.stringify(v12))
    expect(loaded).toEqual(objects)
    for (const object of Object.values(loaded)) {
      expect('colliders' in object).toBe(false)
      expect('collision' in object).toBe(false)
    }
    expect(serializeProject(loaded, FIELD, relativize)).toBe(v13)
  })

  it('B3 범위 밖 수는 자르고, friction 범위 밖·enabled true는 키를 지우며, 빈 목록은 키를 두지 않는다', () => {
    const { objects: loaded } = parseProject(
      fileWith(2, 'colliders', [
        {
          id: 'a',
          kind: 'box',
          enabled: true,
          center: [20, -20, 0],
          size: [0, 11, -0],
          friction: 3
        },
        { id: 'b', kind: 'capsule', center: [0, 0, 0], radius: 5, height: 30, direction: 'z' },
        { id: 'c', kind: 'mesh', vertexLimit: 7.6, friction: -0.1 }
      ])
    )
    expect(loaded.plate.colliders).toEqual([
      { id: 'a', kind: 'box', center: [10, -10, 0], size: [1e-3, 10, 1e-3] },
      { id: 'b', kind: 'capsule', center: [0, 0, 0], radius: 1, height: 20, direction: 'z' },
      { id: 'c', kind: 'mesh', vertexLimit: 8 }
    ])
    expect('colliders' in parseProject(fileWith(2, 'colliders', [])).objects.plate).toBe(false)
    // 자기 충돌 설정은 짝·목록을 사전순으로 놓고 같은 짝을 뺀다. 비면 키가 없다
    const collision = parseProject(
      fileWith(0, 'collision', {
        forceCollide: [
          ['z', 'a'],
          ['a', 'z'],
          ['b', 'a']
        ]
      })
    ).objects.robot.collision
    expect(collision).toEqual({
      forceCollide: [
        ['a', 'b'],
        ['a', 'z']
      ]
    })
    const empty = parseProject(fileWith(0, 'collision', { forceCollide: [] })).objects.robot
    expect('collision' in empty).toBe(false)
  })

  it.each([
    ['배열 아님', { id: 'a', kind: 'mesh', vertexLimit: 32 }],
    ['원소가 객체 아님', ['box']],
    ['id 없음', [{ kind: 'mesh', vertexLimit: 32 }]],
    ['빈 id', [{ id: '', kind: 'mesh', vertexLimit: 32 }]],
    ['65자 id', [{ id: 'x'.repeat(65), kind: 'mesh', vertexLimit: 32 }]],
    ['모르는 종류', [{ id: 'a', kind: 'sphere', center: [0, 0, 0], radius: 1 }]],
    ['길이 2 center', [{ id: 'a', kind: 'box', center: [0, 0], size: [1, 1, 1] }]],
    ['글자 size', [{ id: 'a', kind: 'box', center: [0, 0, 0], size: [1, '1', 1] }]],
    [
      '방향 w',
      [{ id: 'a', kind: 'capsule', center: [0, 0, 0], radius: 1, height: 1, direction: 'w' }]
    ],
    [
      '글자 radius',
      [{ id: 'a', kind: 'capsule', center: [0, 0, 0], radius: '1', height: 1, direction: 'x' }]
    ],
    ['글자 vertexLimit', [{ id: 'a', kind: 'mesh', vertexLimit: '32' }]],
    ['글자 enabled', [{ id: 'a', kind: 'mesh', vertexLimit: 32, enabled: 'false' }]],
    ['글자 friction', [{ id: 'a', kind: 'mesh', vertexLimit: 32, friction: '0.4' }]],
    [
      '같은 id 둘',
      [
        { id: 'a', kind: 'mesh', vertexLimit: 32 },
        { id: 'a', kind: 'mesh', vertexLimit: 16 }
      ]
    ],
    ['9개', Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, kind: 'mesh', vertexLimit: 32 }))]
  ])('B3 틀린 colliders(%s)는 invalidData(colliders)', (_label, colliders) => {
    expect(() => parseProject(fileWith(2, 'colliders', colliders))).toThrow(
      'invalidData: objects[2].colliders'
    )
  })

  it.each([
    ['로봇이 아닌 오브젝트', 2, { forceCollide: [['a', 'b']] }],
    ['객체 아님', 0, [['a', 'b']]],
    ['forceCollide 없음', 0, {}],
    ['원소가 셋', 0, { forceCollide: [['a', 'b', 'c']] }],
    ['같은 id 둘', 0, { forceCollide: [['a', 'a']] }],
    ['수 id', 0, { forceCollide: [['a', 1]] }],
    ['빈 id', 0, { forceCollide: [['a', '']] }],
    ['137개', 0, { forceCollide: Array.from({ length: 137 }, (_, i) => [`a${i}`, `b${i}`]) }]
  ])('B3 틀린 collision(%s)은 invalidData(collision)', (_label, index, collision) => {
    expect(() => parseProject(fileWith(index, 'collision', collision))).toThrow(
      `invalidData: objects[${index}].collision`
    )
  })
})
