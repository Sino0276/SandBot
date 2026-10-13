import { AXIS_DIRECTIONS } from '../cad/alignment'
import type { CadSource, SceneObject, SceneObjects, Vec3 } from '../scene/model'

// sandbot/project.json 형식. 사람이 git diff로 읽을 수 있게 들여쓴 JSON으로 저장한다.
export const PROJECT_FORMAT = 'sandbot-project'
export const PROJECT_VERSION = 1

// 파일에서 CAD 경로는 프로젝트 기준 상대 경로를 먼저 쓰고, 없거나 못 찾으면 절대 경로를 쓴다.
export type StoredCadFile = { relativePath: string | null; absolutePath: string }
type StoredCad = Omit<CadSource, 'absolutePath'> & { file: StoredCadFile }
type StoredObject = Omit<SceneObject, 'cad'> & { cad?: StoredCad }

type ProjectFileData = {
  format: typeof PROJECT_FORMAT
  version: number
  objects: StoredObject[]
}

export type ProjectFileErrorCode = 'invalidJson' | 'notProject' | 'newerVersion' | 'invalidData'

export class ProjectFileError extends Error {
  constructor(
    readonly code: ProjectFileErrorCode,
    detail = ''
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

export function serializeProject(
  objects: SceneObjects,
  // 절대 경로를 프로젝트 기준 상대 경로로 바꾼다
  relativize: (absolutePath: string) => string
): string {
  const data: ProjectFileData = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    objects: Object.values(objects).map(({ cad, ...object }) => {
      if (!cad) return object
      const { absolutePath, ...rest } = cad
      const relativePath = absolutePath ? relativize(absolutePath) : null
      return { ...object, cad: { ...rest, file: { relativePath, absolutePath } } }
    })
  }
  return JSON.stringify(data, null, 2) + '\n'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
const isAxis = (value: unknown): boolean =>
  typeof value === 'string' && (AXIS_DIRECTIONS as string[]).includes(value)

function invalid(index: number, field: string): never {
  throw new ProjectFileError('invalidData', `objects[${index}].${field}`)
}

function parseObject(value: unknown, index: number): SceneObject & { file?: StoredCadFile } {
  if (!isRecord(value)) invalid(index, '')
  const { id, name, kind, parentId, transform, visual, cad } = value
  if (typeof id !== 'string' || !id) invalid(index, 'id')
  if (typeof name !== 'string') invalid(index, 'name')
  if (kind !== 'robot' && kind !== 'assembly' && kind !== 'part') invalid(index, 'kind')
  if (parentId !== null && typeof parentId !== 'string') invalid(index, 'parentId')
  if (!isRecord(transform) || !isVec3(transform.position) || !isVec3(transform.rotation)) {
    invalid(index, 'transform')
  }

  const object: SceneObject & { file?: StoredCadFile } = {
    id,
    name,
    kind,
    parentId,
    transform: { position: transform.position, rotation: transform.rotation }
  }

  if (visual !== undefined) {
    if (!isRecord(visual)) invalid(index, 'visual')
    if (visual.type === 'mesh' && typeof visual.geometryId === 'string' && isVec3(visual.color)) {
      object.visual = { type: 'mesh', geometryId: visual.geometryId, color: visual.color }
    } else if (
      visual.type === 'placeholder' &&
      (visual.shape === 'robot' || visual.shape === 'webcam')
    ) {
      object.visual = { type: 'placeholder', shape: visual.shape }
    } else {
      invalid(index, 'visual')
    }
  }

  if (cad !== undefined) {
    if (
      !isRecord(cad) ||
      typeof cad.fileName !== 'string' ||
      !isAxis(cad.upAxis) ||
      !isAxis(cad.forwardAxis) ||
      !isRecord(cad.bounds) ||
      !isVec3(cad.bounds.min) ||
      !isVec3(cad.bounds.max) ||
      !isFiniteNumber(cad.meshCount) ||
      !isRecord(cad.file) ||
      (cad.file.relativePath !== null && typeof cad.file.relativePath !== 'string') ||
      typeof cad.file.absolutePath !== 'string'
    ) {
      invalid(index, 'cad')
    }
    object.cad = {
      fileName: cad.fileName,
      absolutePath: cad.file.absolutePath,
      upAxis: cad.upAxis as CadSource['upAxis'],
      forwardAxis: cad.forwardAxis as CadSource['forwardAxis'],
      bounds: { min: cad.bounds.min, max: cad.bounds.max },
      meshCount: cad.meshCount
    }
    object.file = { relativePath: cad.file.relativePath, absolutePath: cad.file.absolutePath }
  }
  return object
}

// 프로젝트 파일을 읽는다. CAD 파일 경로(상대·절대)는 따로 돌려주고, 경로 찾기는 호출한 쪽이 한다.
export function parseProject(content: string): {
  objects: SceneObjects
  cadFiles: Map<string, StoredCadFile>
} {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch (error) {
    throw new ProjectFileError('invalidJson', String(error))
  }
  if (!isRecord(data) || data.format !== PROJECT_FORMAT) throw new ProjectFileError('notProject')
  if (!isFiniteNumber(data.version) || data.version > PROJECT_VERSION) {
    throw new ProjectFileError('newerVersion', String(data.version))
  }
  if (!Array.isArray(data.objects)) throw new ProjectFileError('invalidData', 'objects')

  const objects: SceneObjects = {}
  const cadFiles = new Map<string, StoredCadFile>()
  data.objects.forEach((value, index) => {
    const { file, ...object } = parseObject(value, index)
    if (objects[object.id]) invalid(index, 'id')
    objects[object.id] = object
    if (file) cadFiles.set(object.id, file)
  })
  for (const [index, object] of Object.values(objects).entries()) {
    if (object.parentId !== null && !objects[object.parentId]) invalid(index, 'parentId')
  }
  return { objects, cadFiles }
}
