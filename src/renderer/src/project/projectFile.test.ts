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
          zeroPowerBehavior: 'brake'
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
    expect(data).toMatchObject({ format: 'sandbot-project', version: 4 })
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
      zeroPowerBehavior: 'brake'
    })
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
