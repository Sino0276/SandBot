import { describe, expect, it, vi } from 'vitest'
import { createGroup, moveObjects } from '../scene/hierarchy'
import type { SceneObjects } from '../scene/model'
import { parseProject, PROJECT_VERSION, ProjectFileError, serializeProject } from './projectFile'

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
          gearbox: 19.2
        }
      }
    ]
  }
}

const relativize = (path: string): string => path.replace('/home/team/', '../')

describe('프로젝트 파일', () => {
  it('저장한 내용을 다시 읽으면 같은 씬이 된다', () => {
    const { objects: loaded, cadFiles } = parseProject(serializeProject(objects, relativize))
    expect(loaded).toEqual(objects)
    expect(cadFiles.get('cad')).toEqual({
      relativePath: '../cad/robot.step',
      absolutePath: '/home/team/cad/robot.step'
    })
  })

  it('CAD 경로는 상대 경로와 절대 경로를 함께 저장한다', () => {
    const data = JSON.parse(serializeProject(objects, relativize))
    expect(data).toMatchObject({ format: 'sandbot-project', version: 6 })
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
    const { cadFiles } = parseProject(serializeProject(withoutPath, relativize))
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
    const content = serializeProject(scene, relativize)
    const { objects: loaded } = parseProject(content)
    expect(loaded).toEqual(scene)
    expect(Object.keys(loaded)).toEqual(['robot', 'lift', 'cad', 'plate'])
    expect(serializeProject(loaded, relativize)).toBe(content)
  })

  it('그룹이 없는 씬은 새 필드를 쓰지 않는다', () => {
    const data = JSON.parse(serializeProject(objects, relativize))
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
    const data = JSON.parse(serializeProject(grouped(), relativize))
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
    const data = JSON.parse(serializeProject(grouped(), relativize))
    for (const object of data.objects) delete object.cadOrigin
    const { objects: loaded } = parseProject(JSON.stringify(data))
    expect(loaded.plate.cadOrigin).toBe('cad')
    expect(warn).toHaveBeenCalledTimes(1)
    // CAD 루트 안에 있는 파트는 건드리지 않는다
    const inside = parseProject(serializeProject(objects, relativize)).objects
    expect(inside.plate).not.toHaveProperty('cadOrigin')
    warn.mockRestore()
  })

  it('codeClassName은 그룹에만, cadOrigin은 문자열만 받는다', () => {
    const misplaced = JSON.parse(serializeProject(objects, relativize))
    misplaced.objects[2].codeClassName = 'Plate'
    expect(() => parseProject(JSON.stringify(misplaced))).toThrow(ProjectFileError)
    const wrongType = JSON.parse(serializeProject(objects, relativize))
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
    const data = JSON.parse(serializeProject(objects, relativize))
    data.objects[2].scripts = scripts
    return JSON.stringify(data)
  }

  it('연결 목록(순서 포함)을 저장하고 그대로 읽는다', () => {
    const content = serializeProject(linked(), relativize)
    const { objects: loaded, droppedScripts } = parseProject(content)
    expect(loaded).toEqual(linked())
    expect(droppedScripts).toEqual([])
    expect(serializeProject(loaded, relativize)).toBe(content)
  })

  it('연결이 없으면 scripts를 쓰지 않고, 빈 목록도 쓰지 않는다', () => {
    const empty: SceneObjects = { ...objects, plate: { ...objects.plate, scripts: [] } }
    for (const object of JSON.parse(serializeProject(empty, relativize)).objects) {
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
    const v4 = JSON.parse(serializeProject(objects, relativize))
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
    rollers: 'auto'
  } as const
  const withWheel = (): SceneObjects => ({
    ...objects,
    plate: { ...objects.plate, wheel: { ...WHEEL } }
  })
  // 저장한 파일의 오브젝트(index)에 wheel을 넣는다
  const fileWith = (index: number, wheel: unknown, version = 6): string => {
    const data = JSON.parse(serializeProject(objects, relativize))
    data.version = version
    data.objects[index].wheel = wheel
    return JSON.stringify(data)
  }

  it('바퀴를 저장하고 그대로 읽는다(바이트 단위로 같게 다시 쓴다)', () => {
    const content = serializeProject(withWheel(), relativize)
    expect(JSON.parse(content).objects[2].wheel).toEqual(WHEEL)
    const { objects: loaded } = parseProject(content)
    expect(loaded).toEqual(withWheel())
    expect(serializeProject(loaded, relativize)).toBe(content)
  })

  it('바퀴가 없으면 wheel을 쓰지 않는다', () => {
    for (const object of JSON.parse(serializeProject(objects, relativize)).objects) {
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
      rollers: 'auto'
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
    expect(parseProject(serializeProject(scene, relativize)).objects).toEqual(scene)
  })

  it('버전 5 파일은 바퀴 없이 그대로 읽는다', () => {
    const v5 = JSON.parse(serializeProject(objects, relativize))
    v5.version = 5
    const { objects: loaded } = parseProject(JSON.stringify(v5))
    expect(loaded).toEqual(objects)
    expect(Object.values(loaded).some((object) => object.wheel)).toBe(false)
  })

  it('더 새 버전(7)은 열지 않는다', () => {
    expect(() => parseProject(fileWith(2, WHEEL, PROJECT_VERSION + 1))).toThrow(
      expect.objectContaining({ code: 'newerVersion' })
    )
  })
})

describe('버전과 하위 호환', () => {
  it('버전 2 CAD(meshIndexing 없음)는 예전 형상 id 방식으로 읽고, 모르는 방식은 거부한다', () => {
    const legacy = JSON.parse(serializeProject(objects, relativize))
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
    const data = JSON.parse(serializeProject(objects, relativize))
    data.objects[2].components[0].props = { direction: 'sideways', extra: 1 }
    const { objects: loaded } = parseProject(JSON.stringify(data))
    expect(loaded.plate.components![0].props).toEqual({
      motorModel: 'goBilda5202',
      direction: 'forward',
      runMode: 'withoutEncoder',
      zeroPowerBehavior: 'brake',
      // 시뮬레이터 전용 속성(v6)도 기본값(0 = 모델 기본)으로 채운다
      gearbox: 0
    })
  })

  it('버전 5 이하 파일의 모터·데드휠은 새 시뮬레이터 속성을 기본값으로 채운다', () => {
    const data = JSON.parse(serializeProject(objects, relativize))
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
    const data = JSON.parse(serializeProject(objects, relativize))
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
  const valid = (): Record<string, unknown> => JSON.parse(serializeProject(objects, relativize))

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
