import {
  isLinkableJavaPath,
  javaClassNameOfPath,
  normalizeLinkPath
} from '../../../shared/teamCodePaths'
import { AXIS_DIRECTIONS } from '../cad/alignment'
import { componentDef, isComponentType } from '../hardware/catalog'
import { cadOriginOf } from '../scene/hierarchy'
import {
  isCodeGroup,
  isInSubtree,
  type CadSource,
  type HardwareComponent,
  type RobotHardwareSettings,
  type SceneObject,
  type SceneObjects,
  type ScriptLink,
  type Vec3
} from '../scene/model'

// sandbot/project.json 형식. 사람이 git diff로 읽을 수 있게 들여쓴 JSON으로 저장한다.
export const PROJECT_FORMAT = 'sandbot-project'
// 1: 오브젝트·CAD, 2: 하드웨어 컴포넌트(components)와 로봇 코드 생성 설정(hardware) 추가,
// 3: CAD의 meshIndexing('source': 형상 id가 occt-import-js의 원래 메시 순번, meshCount는 빈 메시 포함 전체 수),
// 4: group 종류(Create Empty), CAD 밖으로 옮긴 노드의 cadOrigin, 그룹의 Java 클래스 이름 codeClassName,
// 5: 오브젝트에 연결한 TeamCode Java 파일 scripts([{ path, className }]).
// 이전 버전은 그대로 읽힌다(meshIndexing이 없으면 예전 방식). objects 배열의 순서가 형제 순서다.
export const PROJECT_VERSION = 5

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
    objects: Object.values(objects).map(({ cad, ...stored }) => {
      // 빈 연결 목록은 쓰지 않는다(스토어도 비면 필드를 지운다)
      const { scripts, ...rest } = stored
      const object = scripts?.length ? stored : rest
      if (!cad) return object
      const { absolutePath, ...cadRest } = cad
      const relativePath = absolutePath ? relativize(absolutePath) : null
      return { ...object, cad: { ...cadRest, file: { relativePath, absolutePath } } }
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

// 컴포넌트 속성: 카탈로그에 있는 키만 남기고, 없거나 범위를 벗어난 값은 기본값으로 채운다(속성이 늘어도 예전 파일이 열린다)
function parseProps(
  type: HardwareComponent['type'],
  value: Record<string, unknown>
): HardwareComponent['props'] {
  if (!isComponentType(type)) return {}
  const props: HardwareComponent['props'] = {}
  for (const def of componentDef(type).properties) {
    const raw = value[def.key]
    const valid =
      def.kind === 'enum'
        ? typeof raw === 'string' && def.options.includes(raw)
        : def.kind === 'number'
          ? isFiniteNumber(raw)
          : typeof raw === 'string'
    props[def.key] = valid ? (raw as string | number) : def.default
  }
  return props
}

function parseComponents(value: unknown, index: number): HardwareComponent[] {
  if (!Array.isArray(value)) invalid(index, 'components')
  return value.map((component, i) => {
    if (
      !isRecord(component) ||
      typeof component.id !== 'string' ||
      !component.id ||
      !isComponentType(component.type) ||
      typeof component.name !== 'string' ||
      (component.hub !== 'controlHub' && component.hub !== 'expansionHub') ||
      !Number.isInteger(component.port) ||
      !isRecord(component.props)
    ) {
      invalid(index, `components[${i}]`)
    }
    return {
      id: component.id,
      type: component.type,
      name: component.name,
      hub: component.hub,
      port: component.port as number,
      props: parseProps(component.type, component.props)
    }
  })
}

function parseHardware(value: unknown, index: number): RobotHardwareSettings {
  if (
    !isRecord(value) ||
    typeof value.className !== 'string' ||
    typeof value.configName !== 'string' ||
    !isRecord(value.expansionHub) ||
    typeof value.expansionHub.enabled !== 'boolean' ||
    !isFiniteNumber(value.expansionHub.address)
  ) {
    invalid(index, 'hardware')
  }
  return {
    className: value.className,
    configName: value.configName,
    expansionHub: { enabled: value.expansionHub.enabled, address: value.expansionHub.address }
  }
}

// 패키지까지 붙인 클래스 이름(점으로 이은 Java 식별자)
const QUALIFIED_CLASS =
  /^[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}$]*(\.[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}$]*)*$/u
const MAX_CLASS_NAME_LENGTH = 1024

// 스크립트 연결(v5). 형식이 틀리면(배열·객체·문자열이 아님) 다른 필드처럼 파일 오류다.
// 형식은 맞지만 연결할 수 없는 경로(TeamCode/src/main/java 밖, 생성 파일 폴더, Java 식별자가 아닌 폴더, Windows
// 장치 이름 등)는 버리고 dropped에 센다. project.json은 git에서 오는 믿을 수 없는 입력이지만, 연결은 탐색용
// 보조 기록이라(생성 코드가 참조하지 않음) 하나 때문에 프로젝트 전체를 열지 못하게 하지 않는다. 경로 규칙이
// 나중에 엄격해져도 예전 파일이 열린다. 같은 경로는 한 번만 둔다. className이 이름 형식이 아니면 경로에서 만든다.
function parseScripts(value: unknown, index: number, dropped: string[]): ScriptLink[] {
  if (!Array.isArray(value)) invalid(index, 'scripts')
  const scripts: ScriptLink[] = []
  value.forEach((link, i) => {
    if (!isRecord(link) || typeof link.path !== 'string' || typeof link.className !== 'string')
      invalid(index, `scripts[${i}]`)
    const path = normalizeLinkPath(link.path)
    if (!isLinkableJavaPath(path) || scripts.some((script) => script.path === path)) {
      dropped.push(link.path)
      return
    }
    const className = normalizeLinkPath(link.className)
    scripts.push({
      path,
      className:
        className.length <= MAX_CLASS_NAME_LENGTH && QUALIFIED_CLASS.test(className)
          ? className
          : javaClassNameOfPath(path)
    })
  })
  return scripts
}

function parseObject(
  value: unknown,
  index: number,
  droppedScripts: string[]
): SceneObject & { file?: StoredCadFile } {
  if (!isRecord(value)) invalid(index, '')
  const {
    id,
    name,
    kind,
    parentId,
    transform,
    visual,
    cad,
    components,
    hardware,
    cadOrigin,
    codeClassName,
    scripts
  } = value
  if (typeof id !== 'string' || !id) invalid(index, 'id')
  if (typeof name !== 'string') invalid(index, 'name')
  if (kind !== 'robot' && kind !== 'assembly' && kind !== 'part' && kind !== 'group') {
    invalid(index, 'kind')
  }
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
      (cad.meshIndexing !== undefined &&
        cad.meshIndexing !== 'source' &&
        cad.meshIndexing !== 'packed') ||
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
      meshCount: cad.meshCount,
      ...(cad.meshIndexing !== undefined
        ? { meshIndexing: cad.meshIndexing as CadSource['meshIndexing'] }
        : {})
    }
    object.file = { relativePath: cad.file.relativePath, absolutePath: cad.file.absolutePath }
  }

  if (components !== undefined) object.components = parseComponents(components, index)
  if (hardware !== undefined) {
    if (kind !== 'robot') invalid(index, 'hardware')
    object.hardware = parseHardware(hardware, index)
  }
  // 가리키는 CAD 루트는 모든 오브젝트를 읽은 뒤 확인한다(checkCadOrigins)
  if (cadOrigin !== undefined) {
    if (typeof cadOrigin !== 'string') invalid(index, 'cadOrigin')
    if (cadOrigin) object.cadOrigin = cadOrigin
  }
  if (codeClassName !== undefined) {
    if (typeof codeClassName !== 'string' || kind !== 'group') invalid(index, 'codeClassName')
    if (codeClassName) object.codeClassName = codeClassName
  }
  if (scripts !== undefined) {
    const links = parseScripts(scripts, index, droppedScripts)
    if (links.length > 0) object.scripts = links
  }
  return object
}

// 부모 관계 검사(모든 버전): 없는 부모, 순환, 최상위가 아닌 로봇은 파일 오류다.
function checkParents(objects: SceneObjects): void {
  const list = Object.values(objects)
  // 순환이 없다고 확인된 오브젝트(최상위까지 올라갈 수 있다)
  const rooted = new Set<string>()
  list.forEach((object, index) => {
    if (object.parentId !== null && !objects[object.parentId]) invalid(index, 'parentId')
    if (object.kind === 'robot' && object.parentId !== null) invalid(index, 'parentId')
    const path = new Set<string>()
    let current: SceneObject | undefined = object
    while (current && !rooted.has(current.id)) {
      if (path.has(current.id)) invalid(index, 'parentId')
      path.add(current.id)
      current = current.parentId === null ? undefined : objects[current.parentId]
    }
    for (const id of path) rooted.add(id)
  })
}

// CAD 메시 파트의 형상 id(cadGeometryId: `<CAD 루트 id>:<순번>`)가 가리키는 CAD 루트
function geometryCadRoot(objects: SceneObjects, object: SceneObject): string | null {
  if (object.visual?.type !== 'mesh') return null
  const { geometryId } = object.visual
  const separator = geometryId.lastIndexOf(':')
  if (separator <= 0 || !/^\d+$/.test(geometryId.slice(separator + 1))) return null
  const rootId = geometryId.slice(0, separator)
  return objects[rootId]?.cad ? rootId : null
}

// cadOrigin 검사(모든 버전, 모든 오브젝트를 읽은 뒤). cadOrigin은 부모 관계에서 나오는 보조 기록이라
// git 병합 등으로 어긋나도 파일 전체를 거부하지 않는다.
// - 없는 오브젝트나 CAD 루트가 아닌 것을 가리키거나 그룹·로봇·CAD 루트에 있으면 버리고 경고한다.
// - CAD 메시 파트가 형상의 CAD 루트 밖에 있는데 그 CAD를 출처로 갖지 않으면 cadOrigin을 그 루트로 맞춘다
//   (형상 id가 출처를 알려 준다. 없으면 그 CAD 루트를 지울 때 함께 지워지지 않는다).
function checkCadOrigins(objects: SceneObjects): void {
  for (const object of Object.values(objects)) {
    if (object.cadOrigin === undefined) continue
    const target = objects[object.cadOrigin]
    if (target?.cad && !object.cad && !isCodeGroup(object) && object.kind !== 'robot') continue
    console.warn(`project.json: ${object.id}의 cadOrigin(${object.cadOrigin})을 버린다`)
    const dropped = { ...object }
    delete dropped.cadOrigin
    objects[object.id] = dropped
  }
  for (const object of Object.values(objects)) {
    const rootId = geometryCadRoot(objects, object)
    if (
      rootId === null ||
      isInSubtree(objects, object.id, rootId) ||
      cadOriginOf(objects, object.id) === rootId
    )
      continue
    console.warn(
      `project.json: CAD 밖으로 옮긴 ${object.id}의 cadOrigin을 형상의 CAD 루트(${rootId})로 맞춘다`
    )
    objects[object.id] = { ...object, cadOrigin: rootId }
  }
}

// 프로젝트 파일을 읽는다. CAD 파일 경로(상대·절대)는 따로 돌려주고, 경로 찾기는 호출한 쪽이 한다.
// droppedScripts는 연결할 수 없는 경로라 버린 스크립트 연결의 경로다(호출한 쪽이 알린다).
export function parseProject(content: string): {
  objects: SceneObjects
  cadFiles: Map<string, StoredCadFile>
  droppedScripts: string[]
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
  const componentIds = new Set<string>()
  const droppedScripts: string[] = []
  data.objects.forEach((value, index) => {
    const { file, ...object } = parseObject(value, index, droppedScripts)
    if (objects[object.id]) invalid(index, 'id')
    for (const component of object.components ?? []) {
      if (componentIds.has(component.id)) invalid(index, 'components')
      componentIds.add(component.id)
    }
    objects[object.id] = object
    if (file) cadFiles.set(object.id, file)
  })
  checkParents(objects)
  checkCadOrigins(objects)
  if (droppedScripts.length > 0)
    console.warn(
      `project.json: 연결할 수 없는 스크립트 경로를 버린다: ${droppedScripts.join(', ')}`
    )
  return { objects, cadFiles, droppedScripts }
}
