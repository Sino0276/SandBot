import { describe, expect, it } from 'vitest'
import type { SceneObjects } from '../scene/model'
import { parseProject, ProjectFileError, serializeProject } from './projectFile'

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
    expect(data).toMatchObject({ format: 'sandbot-project', version: 3 })
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
    expect(codeOf(JSON.stringify({ ...valid(), version: 99 }))).toBe('newerVersion')
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
