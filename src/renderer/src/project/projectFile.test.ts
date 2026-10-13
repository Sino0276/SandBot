import { describe, expect, it } from 'vitest'
import type { SceneObjects } from '../scene/model'
import { parseProject, ProjectFileError, serializeProject } from './projectFile'

const objects: SceneObjects = {
  robot: {
    id: 'robot',
    name: 'Robot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0.5, -1, 0], rotation: [0, 0, 1.2] }
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
      meshCount: 1
    }
  },
  plate: {
    id: 'plate',
    name: 'Plate',
    kind: 'part',
    parentId: 'cad',
    transform: { position: [0.1, 0, 0], rotation: [0, 0, 0] },
    visual: { type: 'mesh', geometryId: 'cad:0', color: [0.5, 0.5, 0.5] }
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
    expect(data).toMatchObject({ format: 'sandbot-project', version: 1 })
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

    const broken = valid()
    ;(broken.objects as { transform: unknown }[])[0].transform = { position: [0, 0], rotation: [] }
    expect(codeOf(JSON.stringify(broken))).toBe('invalidData')
  })
})
