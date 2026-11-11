import {
  isLinkableJavaPath,
  javaClassNameOfPath,
  normalizeLinkPath
} from '../../../shared/teamCodePaths'
import { AXIS_DIRECTIONS, isValidAlignment } from '../cad/alignment'
import { componentDef, isComponentType } from '../hardware/catalog'
import {
  DEFAULT_FIELD_DOC,
  isSeasonString,
  type FieldDoc,
  type FieldVisual
} from '../scene/fieldDoc'
import {
  DEFAULT_PROJECT_SETTINGS,
  isCodeUnits,
  type ProjectSettings
} from '../scene/projectSettings'
import { cadOriginOf } from '../scene/hierarchy'
import type { MassSettings, RigidbodySettings } from '../mass/types'
import {
  isCodeGroup,
  isInSubtree,
  type CadSource,
  type HardwareComponent,
  type JointDrive,
  type JointSettings,
  type RobotHardwareSettings,
  type SceneObject,
  type SceneObjects,
  type ScriptLink,
  type Vec3,
  type WheelSettings
} from '../scene/model'
import {
  canHaveMass,
  canHaveRigidbody,
  sanitizeMass,
  sanitizeRigidbody
} from '../scene/massSettings'
import {
  canHaveJoint,
  DEFAULT_SERVO_EDIT_POSITION,
  isJointAxis,
  isJointType,
  sanitizeJoint
} from '../scene/joint'
import { isWheelKind, isWheelRollers, sanitizeWheel } from '../scene/wheel'
import {
  canHaveColliders,
  canHaveRobotCollision,
  COLLIDER_DIRECTIONS,
  MAX_FORCE_COLLIDE,
  MAX_OBJECT_COLLIDERS,
  sanitizeColliders,
  sanitizeRobotCollision,
  type ColliderDirection,
  type ColliderSettings,
  type RobotCollisionSettings
} from '../scene/collider'

// sandbot/project.json 형식. 사람이 git diff로 읽을 수 있게 들여쓴 JSON으로 저장한다.
export const PROJECT_FORMAT = 'sandbot-project'
// 1: 오브젝트·CAD, 2: 하드웨어 컴포넌트(components)와 로봇 코드 생성 설정(hardware) 추가,
// 3: CAD의 meshIndexing('source': 형상 id가 occt-import-js의 원래 메시 순번, meshCount는 빈 메시 포함 전체 수),
// 4: group 종류(Create Empty), CAD 밖으로 옮긴 노드의 cadOrigin, 그룹의 Java 클래스 이름 codeClassName,
// 5: 오브젝트에 연결한 TeamCode Java 파일 scripts([{ path, className }]),
// 6: 바퀴 wheel({ kind, diameter, motor, gearRatio, angle, rollers }, 시뮬레이터 설정, assembly·part·group에만),
// 7: 질량 mass({ material?, infill?, mass?, centerOfMass? }, robot이 아닌 오브젝트)와 로봇 rigidbody
//    ({ weighedMass?, defaultMaterial? }). 둘 다 시뮬레이터 설정이다(scene/massSettings.ts).
// 8: 관절 joint({ type, anchor, axis, axisSign, limits, friction, spring, drive }, 시뮬레이터 설정, robot이 아니고 바퀴가
//    없는 오브젝트에만, scene/joint.ts).
// 9: 바퀴 wheel.friction(잠근 바퀴의 겉보기 타일 마찰 계수, 0이면 종류 기본, 3c 구동계 동역학).
// 10: 필드 field({ season }, 시즌 id 문자열, 모르는 값은 보존). 시즌 데이터는 src/shared/sim/seasons/ 한곳이라 시즌을
//     더해도 이 버전을 올리지 않는다(모르는 시즌 문자열은 보존하고 표시·시뮬레이터는 'none'으로 처리한다).
// 11: 필드 CAD 보기 field.visual({ fileName, upAxis, forwardAxis, file: { relativePath, absolutePath } }, 보기용,
//     시뮬레이터는 쓰지 않음, spec-4e §2.3). 틀린 visual은 버리고 프로젝트는 연다(fieldVisualDropped).
// 12: 프로젝트 설정 settings({ codeUnits: { length, angle } }, 생성 Java의 코드 단위). 없거나 틀리면 기본값('sdk')으로
//     읽고 프로젝트는 연다(settingsDropped, 틀린 값일 때만).
// 13: 오브젝트 충돌체 colliders([{ id, kind, enabled?, center·size | center·radius·height·direction | vertexLimit,
//     friction? }], 모든 kind, scene/collider.ts)와 로봇 자기 충돌 collision({ forceCollide: [[a, b]…] }, robot에만).
//     둘 다 시뮬레이터 설정이다(spec-5 §2.3).
// 이전 버전은 그대로 읽힌다(meshIndexing이 없으면 예전 방식, 5 이하는 바퀴 없음, 6 이하는 질량 설정 없음, 7 이하는 관절 없음,
// 8 이하는 바퀴 friction 없음 = 0, 9 이하는 field 없음 = BIOBUZZ, 10 이하는 field.visual 없음, 11 이하는 settings 없음 =
// 코드 단위 'sdk', 12 이하는 colliders·collision 없음).
// objects 배열의 순서가 형제 순서다.
export const PROJECT_VERSION = 13
// field를 두기 시작한 버전
const FIELD_VERSION = 10
// field.visual(필드 CAD 보기)을 두기 시작한 버전
export const FIELD_VISUAL_VERSION = 11
// settings(프로젝트 설정)를 두기 시작한 버전
export const SETTINGS_VERSION = 12

// 파일에서 CAD 경로는 프로젝트 기준 상대 경로를 먼저 쓰고, 없거나 못 찾으면 절대 경로를 쓴다.
export type StoredCadFile = { relativePath: string | null; absolutePath: string }
type StoredCad = Omit<CadSource, 'absolutePath'> & { file: StoredCadFile }
type StoredObject = Omit<SceneObject, 'cad'> & { cad?: StoredCad }
// 파일의 필드 CAD 보기(v11): 문서 FieldVisual의 absolutePath 대신 로봇 CAD처럼 file(상대·절대 경로)을 쓴다
type StoredFieldVisual = Omit<FieldVisual, 'absolutePath'> & { file: StoredCadFile }
type StoredField = { season: string; visual?: StoredFieldVisual }

type ProjectFileData = {
  format: typeof PROJECT_FORMAT
  version: number
  field: StoredField
  settings: ProjectSettings
  objects: StoredObject[]
}

export type SerializeOptions = {
  // 열 때 찾지 못한 필드 CAD의 파일 값(spec-4e §2.3). 그 절대 경로가 지금 visual의 절대 경로와 같으면 file을 이 값
  // 그대로 쓴다(저장한 사람의 절대 경로를 이 PC 기준으로 relativize해 원래 맞던 상대 경로를 잃지 않게).
  fieldVisualFile?: StoredCadFile | null
  // 프로젝트 설정(v12). 없으면 기본값을 쓴다(시험).
  settings?: ProjectSettings
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

// 필드 설정을 파일 꼴로. 시즌 문자열(모르는 시즌도 그대로)과, 있으면 visual의 키를 골라 쓴다(문서에 끼어든 키가 파일로
// 새지 않게 펼치지 않는다).
function storedField(
  field: FieldDoc,
  relativize: (absolutePath: string) => string,
  options: SerializeOptions
): StoredField {
  const { visual } = field
  if (!visual) return { season: field.season }
  const { fileName, absolutePath, upAxis, forwardAxis } = visual
  const kept = options.fieldVisualFile
  const file: StoredCadFile =
    kept && kept.absolutePath === absolutePath
      ? { relativePath: kept.relativePath, absolutePath: kept.absolutePath }
      : { relativePath: absolutePath ? relativize(absolutePath) : null, absolutePath }
  return { season: field.season, visual: { fileName, upAxis, forwardAxis, file } }
}

// 프로젝트 설정을 파일 꼴로(키를 골라 쓴다)
function storedSettings(settings: ProjectSettings): ProjectSettings {
  const { length, angle } = settings.codeUnits
  return { codeUnits: { length, angle } }
}

export function serializeProject(
  objects: SceneObjects,
  // 필드 설정(v10 시즌, v11 필드 CAD 보기)
  field: FieldDoc,
  // 절대 경로를 프로젝트 기준 상대 경로로 바꾼다
  relativize: (absolutePath: string) => string,
  options: SerializeOptions = {}
): string {
  const data: ProjectFileData = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    field: storedField(field, relativize, options),
    settings: storedSettings(options.settings ?? DEFAULT_PROJECT_SETTINGS),
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
          : def.kind === 'length' || def.kind === 'angle'
            ? isFiniteNumber(raw) && raw >= def.min && raw <= def.max
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

// 바퀴(v6). 모양·형식이 틀리면(객체가 아님, 수가 아닌 지름, 모르는 종류·롤러, 문자열이 아닌 모터) 다른 필드처럼
// 파일 오류이고, 범위 밖 수는 컴포넌트 속성(parseProps)처럼 기본값으로 바꾼다(sanitizeWheel, 각은 (−π, π]로 감음).
// 모터 id는 그대로 둔다(지운 모터를 가리켜도 바퀴 카드가 경고하고, 실행 취소·다시 연결로 되살릴 수 있다).
function parseWheel(value: unknown, index: number): WheelSettings {
  if (
    !isRecord(value) ||
    !isWheelKind(value.kind) ||
    typeof value.diameter !== 'number' ||
    typeof value.motor !== 'string' ||
    typeof value.gearRatio !== 'number' ||
    typeof value.angle !== 'number' ||
    !isWheelRollers(value.rollers) ||
    (value.friction !== undefined && typeof value.friction !== 'number')
  )
    invalid(index, 'wheel')
  return sanitizeWheel({
    kind: value.kind,
    diameter: value.diameter,
    motor: value.motor,
    gearRatio: value.gearRatio,
    angle: value.angle,
    rollers: value.rollers,
    // v9에서 더했다: 없으면 종류 기본(0)
    friction: value.friction ?? 0
  })
}

// 질량 설정(v7). 객체가 아니면 다른 필드처럼 파일 오류이고, 모르는 재질 키·범위 밖 수·형식이 틀린 값은 그 필드만
// 버린다(sanitizeMass, 재질 목록이 줄거나 범위가 좁아져도 예전 파일이 열린다). 빈 {}은 질량 카드만 붙인 상태라 남긴다.
function parseMass(value: unknown, index: number): MassSettings {
  if (!isRecord(value)) invalid(index, 'mass')
  return sanitizeMass(value)
}

// 로봇 Rigidbody(v7). 정리한 결과가 비면 필드를 두지 않는다(스토어 setRobotRigidbody와 같음).
function parseRigidbody(value: unknown, index: number): RigidbodySettings | null {
  if (!isRecord(value)) invalid(index, 'rigidbody')
  return sanitizeRigidbody(value)
}

const isNumber = (value: unknown): value is number => typeof value === 'number'
// 없으면(나중에 더한 칸) fallback, 수면 그 값, 다른 형식이면 null(그 구동을 받지 않는다)
const optionalNumber = (value: unknown, fallback: number): number | null =>
  value === undefined ? fallback : isNumber(value) ? value : null
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

// 관절 구동(v8). 종류마다 필드의 형식만 보고, 범위는 sanitizeJoint가 맞춘다. 형식이 틀리면 null(파일 오류).
function parseJointDrive(value: unknown): JointDrive | null {
  if (!isRecord(value)) return null
  switch (value.kind) {
    case 'none':
    case 'stage':
      return { kind: value.kind }
    case 'motor': {
      const { motors, gearRatio, spoolDiameter, rigging } = value
      if (
        !isStringList(motors) ||
        !isNumber(gearRatio) ||
        !isNumber(spoolDiameter) ||
        !isRecord(rigging)
      )
        return null
      if (rigging.kind === 'direct')
        return { kind: 'motor', motors, gearRatio, spoolDiameter, rigging: { kind: 'direct' } }
      if (
        (rigging.kind !== 'cascade' && rigging.kind !== 'continuous') ||
        !isStringList(rigging.stages)
      )
        return null
      return {
        kind: 'motor',
        motors,
        gearRatio,
        spoolDiameter,
        rigging: { kind: rigging.kind, stages: rigging.stages }
      }
    }
    // editPosition·direction은 PROJECT_VERSION 8 안에서 나중에 더했다: 없으면 기본값(편집 자세 = 위치 0.5, +펄스 = +축)
    case 'servo': {
      const editPosition = optionalNumber(value.editPosition, DEFAULT_SERVO_EDIT_POSITION)
      const direction = optionalNumber(value.direction, 1)
      return typeof value.servo === 'string' &&
        isNumber(value.gearRatio) &&
        editPosition !== null &&
        direction !== null
        ? {
            kind: 'servo',
            servo: value.servo,
            gearRatio: value.gearRatio,
            editPosition,
            direction: direction === -1 ? -1 : 1
          }
        : null
    }
    case 'crServo': {
      const direction = optionalNumber(value.direction, 1)
      return typeof value.servo === 'string' &&
        isNumber(value.gearRatio) &&
        isNumber(value.spoolDiameter) &&
        direction !== null
        ? {
            kind: 'crServo',
            servo: value.servo,
            gearRatio: value.gearRatio,
            spoolDiameter: value.spoolDiameter,
            direction: direction === -1 ? -1 : 1
          }
        : null
    }
    default:
      return null
  }
}

function parseJointSpring(value: unknown): JointSettings['spring'] | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  if (value.kind === 'constantForce' && isNumber(value.force))
    return { kind: 'constantForce', force: value.force }
  if (value.kind === 'linear' && isNumber(value.stiffness) && isNumber(value.rest))
    return { kind: 'linear', stiffness: value.stiffness, rest: value.rest }
  return undefined
}

// 관절(v8). 모양·형식이 틀리면(객체가 아님, 모르는 종류·축, 수가 아닌 값) 바퀴처럼 파일 오류이고, 범위 밖 수는 기본값으로
// 바꾼다(sanitizeJoint). 장치·관절 id는 그대로 둔다(지운 모터·관절을 가리켜도 세계 설명을 만들 때 경고한다).
function parseJoint(value: unknown, index: number): JointSettings {
  if (!isRecord(value)) invalid(index, 'joint')
  const { type, anchor, axis, axisSign, limits, friction } = value
  const spring = parseJointSpring(value.spring)
  const drive = parseJointDrive(value.drive)
  if (
    !isJointType(type) ||
    !Array.isArray(anchor) ||
    anchor.length !== 3 ||
    !anchor.every(isNumber) ||
    !isJointAxis(axis) ||
    (axisSign !== 1 && axisSign !== -1) ||
    (limits !== null &&
      (!isRecord(limits) || !isNumber(limits.lower) || !isNumber(limits.upper))) ||
    !isRecord(friction) ||
    !isNumber(friction.coulomb) ||
    !isNumber(friction.viscous) ||
    spring === undefined ||
    drive === null
  )
    invalid(index, 'joint')
  return sanitizeJoint({
    type,
    anchor: [anchor[0], anchor[1], anchor[2]],
    axis,
    axisSign,
    limits:
      limits === null ? null : { lower: limits.lower as number, upper: limits.upper as number },
    friction: { coulomb: friction.coulomb, viscous: friction.viscous },
    spring,
    drive
  })
}

// 충돌체(v13). 다른 오브젝트 칸처럼 버전으로 가르지 않는다(바퀴·관절과 같다). 배열이 아니거나, 원소가 객체가 아니거나, id가
// 1–64자 글자가 아니거나, 종류를 모르거나, 칸 형식이 틀리면(수가 아님, 길이 3이 아닌 배열, 방향이 x·y·z가 아님), enabled가
// boolean이 아니거나, friction이 수가 아니거나, 같은 id가 둘이거나 MAX_OBJECT_COLLIDERS를 넘으면 파일 오류다. 범위 밖 수는
// 정리(sanitizeColliders)가 자르고(friction은 키를 지운다), enabled true는 키를 지운다. 비면 null(키를 두지 않는다).
const isColliderId = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 64
function parseColliders(value: unknown, index: number): ColliderSettings[] | null {
  if (!Array.isArray(value) || value.length > MAX_OBJECT_COLLIDERS) invalid(index, 'colliders')
  const ids = new Set<string>()
  const list = value.map((entry): ColliderSettings => {
    if (!isRecord(entry) || !isColliderId(entry.id) || ids.has(entry.id))
      invalid(index, 'colliders')
    ids.add(entry.id)
    const { id, kind, enabled, friction } = entry
    if (enabled !== undefined && typeof enabled !== 'boolean') invalid(index, 'colliders')
    if (friction !== undefined && !isFiniteNumber(friction)) invalid(index, 'colliders')
    // enabled true·범위 밖 friction은 정리가 지운다(타입은 정리 전 값이라 넓혀 둔다)
    const tail = {
      ...(enabled !== undefined ? { enabled: enabled as false } : {}),
      ...(friction !== undefined ? { friction } : {})
    }
    switch (kind) {
      case 'box':
        if (!isVec3(entry.center) || !isVec3(entry.size)) invalid(index, 'colliders')
        return { id, kind, center: [...entry.center], size: [...entry.size], ...tail }
      case 'capsule':
        if (
          !isVec3(entry.center) ||
          !isFiniteNumber(entry.radius) ||
          !isFiniteNumber(entry.height) ||
          !(COLLIDER_DIRECTIONS as readonly unknown[]).includes(entry.direction)
        )
          invalid(index, 'colliders')
        return {
          id,
          kind,
          center: [...entry.center],
          radius: entry.radius,
          height: entry.height,
          direction: entry.direction as ColliderDirection,
          ...tail
        }
      case 'mesh':
        if (!isFiniteNumber(entry.vertexLimit)) invalid(index, 'colliders')
        return { id, kind, vertexLimit: entry.vertexLimit, ...tail }
      default:
        invalid(index, 'colliders')
    }
  })
  const sanitized = sanitizeColliders(list)
  return sanitized.length > 0 ? sanitized : null
}

// 로봇 자기 충돌 설정(v13, robot에만). 객체가 아니거나, forceCollide가 배열이 아니거나 MAX_FORCE_COLLIDE를 넘거나, 원소가
// 서로 다른 1–64자 글자 둘의 배열이 아니면 파일 오류다. 정리(sanitizeRobotCollision)가 짝·목록을 사전순으로 놓고 같은
// 짝을 빼며, 비면 null(키를 두지 않는다). 끊긴 id(지운 관절)는 남긴다(빌더가 무시).
function parseCollision(value: unknown, index: number): RobotCollisionSettings | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.forceCollide) ||
    value.forceCollide.length > MAX_FORCE_COLLIDE
  )
    invalid(index, 'collision')
  const pairs = value.forceCollide.map((pair): [string, string] => {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !isColliderId(pair[0]) ||
      !isColliderId(pair[1]) ||
      pair[0] === pair[1]
    )
      invalid(index, 'collision')
    return [pair[0], pair[1]]
  })
  return sanitizeRobotCollision({ forceCollide: pairs })
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
    scripts,
    wheel,
    mass,
    rigidbody,
    joint,
    colliders,
    collision
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
  // 로봇·CAD 루트에는 바퀴를 두지 않는다(scene/wheel.ts canHaveWheel)
  if (wheel !== undefined) {
    if (kind === 'robot' || object.cad) invalid(index, 'wheel')
    object.wheel = parseWheel(wheel, index)
  }
  // 질량 설정은 robot이 아닌 오브젝트에, Rigidbody는 robot에만 둔다(scene/massSettings.ts)
  if (mass !== undefined) {
    if (!canHaveMass(object)) invalid(index, 'mass')
    object.mass = parseMass(mass, index)
  }
  if (rigidbody !== undefined) {
    if (!canHaveRigidbody(object)) invalid(index, 'rigidbody')
    const settings = parseRigidbody(rigidbody, index)
    if (settings) object.rigidbody = settings
  }
  // 관절은 robot과 바퀴가 있는 오브젝트에는 두지 않는다(scene/joint.ts canHaveJoint)
  if (joint !== undefined) {
    if (!canHaveJoint(object)) invalid(index, 'joint')
    object.joint = parseJoint(joint, index)
  }
  // 충돌체는 모든 kind에(scene/collider.ts canHaveColliders), 자기 충돌 설정은 robot에만 둔다
  if (colliders !== undefined) {
    if (!canHaveColliders(object)) invalid(index, 'colliders')
    const list = parseColliders(colliders, index)
    if (list) object.colliders = list
  }
  if (collision !== undefined) {
    if (!canHaveRobotCollision(object)) invalid(index, 'collision')
    const settings = parseCollision(collision, index)
    if (settings) object.collision = settings
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

type ParsedFieldVisual = { visual: FieldVisual; file: StoredCadFile }

// 필드 CAD 보기(v11). 객체이고 fileName 문자열, 두 축이 축 방향이고 글자가 다르며, file이 객체이고 relativePath가 null
// 또는 문자열, absolutePath가 문자열이어야 한다. 틀리면 null(버린다). 다른 키는 버린다. 문서의 absolutePath는 파일의
// absolutePath 그대로다(열기가 상대 경로 → 절대 경로 순으로 찾아 고친다).
function parseFieldVisual(value: unknown): ParsedFieldVisual | null {
  if (!isRecord(value)) return null
  const { fileName, upAxis, forwardAxis, file } = value
  if (typeof fileName !== 'string' || !isAxis(upAxis) || !isAxis(forwardAxis)) return null
  const alignment = { upAxis, forwardAxis } as Pick<FieldVisual, 'upAxis' | 'forwardAxis'>
  if (!isValidAlignment(alignment)) return null
  if (!isRecord(file)) return null
  const { relativePath, absolutePath } = file
  if (
    (relativePath !== null && typeof relativePath !== 'string') ||
    typeof absolutePath !== 'string'
  )
    return null
  return {
    visual: { fileName, absolutePath, ...alignment },
    file: { relativePath, absolutePath }
  }
}

// 필드(v10). 객체이고 season이 시즌 문자열 모양(fieldDoc.ts isSeasonString)이어야 한다. 없거나 틀리면 파일 오류다.
// 모양이 맞으면 모르는 시즌도 보존한다(다시 저장해도 그 문자열을 쓴다). 다른 키는 버린다.
// v9 이하는 field를 보지 않고 BIOBUZZ(DEFAULT_PROJECT_SEASON, 사용자 결정 11/07)로 읽는다(fieldDefaulted).
// v11은 visual(필드 CAD 보기)도 읽는다. 틀린 visual은 버리고 프로젝트는 연다 [결정: spec-4e §2.3, 비평 M5: 보기 전용이고
// 개인 절대 경로가 든 설정이라 git 병합으로 깨지기 쉬운데 그것 하나로 팀 프로젝트 전체를 못 여는 것은 지나치다].
// v10 이하는 visual을 보지 않는다(있어도 버림).
function parseField(
  data: Record<string, unknown>,
  version: number
): {
  field: FieldDoc
  fieldDefaulted: boolean
  fieldVisualFile: StoredCadFile | null
  fieldVisualDropped: boolean
} {
  if (version < FIELD_VERSION)
    return {
      field: { season: DEFAULT_FIELD_DOC.season },
      fieldDefaulted: true,
      fieldVisualFile: null,
      fieldVisualDropped: false
    }
  const { field } = data
  if (!isRecord(field) || !isSeasonString(field.season))
    throw new ProjectFileError('invalidData', 'field')
  const season = field.season
  if (version < FIELD_VISUAL_VERSION || field.visual === undefined)
    return {
      field: { season },
      fieldDefaulted: false,
      fieldVisualFile: null,
      fieldVisualDropped: false
    }
  const parsed = parseFieldVisual(field.visual)
  if (!parsed) {
    console.warn('project.json: 읽을 수 없는 필드 CAD 설정(field.visual)을 버린다')
    return {
      field: { season },
      fieldDefaulted: false,
      fieldVisualFile: null,
      fieldVisualDropped: true
    }
  }
  return {
    field: { season, visual: parsed.visual },
    fieldDefaulted: false,
    fieldVisualFile: parsed.file,
    fieldVisualDropped: false
  }
}

// 프로젝트 설정(v12). v11 이하나 키가 없으면 기본값이다. 틀린 값은 기본값으로 읽고 dropped로 알린다(보기 설정 하나로
// 팀 프로젝트 전체를 못 열지 않게, field.visual과 같은 규칙). 모르는 키는 버린다.
function parseSettings(
  data: Record<string, unknown>,
  version: number
): { settings: ProjectSettings; settingsDropped: boolean } {
  if (version < SETTINGS_VERSION || data.settings === undefined)
    return { settings: DEFAULT_PROJECT_SETTINGS, settingsDropped: false }
  const { settings } = data
  if (!isRecord(settings) || !isCodeUnits(settings.codeUnits)) {
    console.warn('project.json: 읽을 수 없는 프로젝트 설정(settings)을 기본값으로 읽는다')
    return { settings: DEFAULT_PROJECT_SETTINGS, settingsDropped: true }
  }
  const { length, angle } = settings.codeUnits
  return { settings: { codeUnits: { length, angle } }, settingsDropped: false }
}

// 프로젝트 파일을 읽는다. CAD 파일 경로(상대·절대)는 따로 돌려주고, 경로 찾기는 호출한 쪽이 한다.
// droppedScripts는 연결할 수 없는 경로라 버린 스크립트 연결의 경로다(호출한 쪽이 알린다).
// fieldDefaulted는 field가 없는 예전 형식(v9 이하)이라 기본 시즌으로 읽었다는 뜻이다(열기가 알린다).
// fieldVisualFile은 필드 CAD의 파일 경로(상대·절대, 열기가 찾는다), fieldVisualDropped는 틀린 field.visual을 버렸다는
// 뜻이다(열기가 알린다).
export function parseProject(content: string): {
  objects: SceneObjects
  field: FieldDoc
  fieldDefaulted: boolean
  fieldVisualFile: StoredCadFile | null
  fieldVisualDropped: boolean
  settings: ProjectSettings
  settingsDropped: boolean
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
  const { field, fieldDefaulted, fieldVisualFile, fieldVisualDropped } = parseField(
    data,
    data.version
  )
  const { settings, settingsDropped } = parseSettings(data, data.version)

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
  return {
    objects,
    field,
    fieldDefaulted,
    fieldVisualFile,
    fieldVisualDropped,
    settings,
    settingsDropped,
    cadFiles,
    droppedScripts
  }
}
