import { childrenOf, findRobotId, type HardwareComponent, type SceneObjects } from '../scene/model'
import {
  COMPONENT_TYPE_KEYS,
  CONTROL_HUB_ADDRESS,
  componentDef,
  isComponentType,
  PORT_RANGES,
  type ComponentTypeDef
} from './catalog'
import {
  allScopes,
  buildCodeScopes,
  type CodeScope,
  type DeviceMember,
  type GroupMember,
  type ScopeMember
} from './codeScopes'
import {
  LIMELIGHT_SERIAL_PATTERN,
  orphanComponents,
  robotComponents,
  robotHardwareSettings,
  type ComponentEntry
} from './components'
import { isValidHubOrientation, type HubDirection } from './mounting'
import {
  configXmlFilePath,
  isValidGroupClassName,
  isValidJavaClassName,
  javaFilePath
} from './naming'

// error는 코드 생성을 막고, warning은 생성은 하되 알린다. 문구는 표시할 때 code로 번역한다(hardware.issues.*).
export type IssueSeverity = 'error' | 'warning'

export type IssueCode =
  | 'emptyName'
  | 'nameWhitespace'
  | 'duplicateName'
  | 'fieldNameCollision'
  | 'portOutOfRange'
  | 'portConflict'
  | 'i2cAddressConflict'
  | 'imuOrientationInvalid'
  | 'touchSensorEvenChannel'
  | 'encoderMotorConflict'
  | 'deadWheelSlowPort'
  | 'expansionHubDisabled'
  | 'serialMissing'
  | 'limelightSerialInvalid'
  | 'pinpointPodMissing'
  | 'orphanComponent'
  | 'invalidClassName'
  | 'duplicateClassName'
  | 'emptyConfigName'
  | 'duplicateConfigName'
  | 'expansionHubAddressInvalid'
  | 'expansionHubAddressReserved'
  | 'servoScaleInvalid'
  | 'imuChipHub'
  | 'constantNameCollision'
  | 'invalidGroupName'
  | 'reservedGroupName'
  | 'duplicateGroupClass'

export type Issue = {
  severity: IssueSeverity
  code: IssueCode
  params: Record<string, string | number>
  // 문제가 있는 로봇·오브젝트·컴포넌트(하이어라키·인스펙터에서 표시하고 선택하는 데 쓴다)
  robotId?: string
  objectId?: string
  componentId?: string
}

// 10보다 큰 허브 주소는 SDK가 시스템용으로 남겨 둔다(MAX_UNRESERVED_MODULE_ADDRESS)
const MAX_UNRESERVED_HUB_ADDRESS = 10

// 생성 코드가 쓰는 타입 이름: 카탈로그의 모든 import(지금 쓰지 않는 종류 포함), HardwareMap, String.
// 로봇 클래스나 그룹 클래스(모든 깊이)가 이 이름이면 그 클래스를 감싸는 클래스 전체에서 원래 타입을 가려
// 컴파일되지 않는다(그룹 Servo가 옆 그룹의 Servo.Direction을, 그룹 String이 CONFIGURATION_NAME을 깨뜨린다).
// 생성 코드가 나중에 쓸 수 있는 java.lang 이름도 함께 막는다.
export const RESERVED_TYPE_NAMES: ReadonlySet<string> = new Set([
  ...[
    'com.qualcomm.robotcore.hardware.HardwareMap',
    ...COMPONENT_TYPE_KEYS.flatMap((type) => componentDef(type).imports)
  ].map((name) => name.slice(name.lastIndexOf('.') + 1)),
  'String',
  'Object',
  'Math',
  'Double',
  'Integer',
  'Boolean',
  'Override'
])

const SEVERITY: Record<IssueCode, IssueSeverity> = {
  emptyName: 'error',
  nameWhitespace: 'warning',
  duplicateName: 'error',
  fieldNameCollision: 'error',
  portOutOfRange: 'error',
  portConflict: 'error',
  i2cAddressConflict: 'error',
  imuOrientationInvalid: 'error',
  touchSensorEvenChannel: 'warning',
  encoderMotorConflict: 'error',
  deadWheelSlowPort: 'warning',
  expansionHubDisabled: 'error',
  serialMissing: 'warning',
  limelightSerialInvalid: 'error',
  pinpointPodMissing: 'warning',
  orphanComponent: 'warning',
  invalidClassName: 'error',
  duplicateClassName: 'error',
  emptyConfigName: 'error',
  duplicateConfigName: 'error',
  expansionHubAddressInvalid: 'error',
  expansionHubAddressReserved: 'warning',
  servoScaleInvalid: 'error',
  imuChipHub: 'error',
  constantNameCollision: 'error',
  invalidGroupName: 'error',
  reservedGroupName: 'error',
  duplicateGroupClass: 'error'
}

function issue(
  code: IssueCode,
  params: Record<string, string | number>,
  where: Omit<Issue, 'severity' | 'code' | 'params'>
): Issue {
  return { severity: SEVERITY[code], code, params, ...where }
}

function defOf(component: HardwareComponent): ComponentTypeDef | null {
  return isComponentType(component.type) ? componentDef(component.type) : null
}

// 같은 허브·포트 종류·번호를 둘 이상이 쓰면 충돌. 엔코더 포트(데드휠)는 모터 전원 단자와 따로 센다.
function checkPortConflicts(robotId: string, entries: ComponentEntry[], issues: Issue[]): void {
  const groups = new Map<string, ComponentEntry[]>()
  for (const entry of entries) {
    const def = defOf(entry.component)
    if (!def || def.portKind === 'usb' || def.portKind === 'i2c') continue
    const key = `${entry.component.hub}/${def.portKind}/${entry.component.port}`
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const names = group.map((e) => e.component.name).join(', ')
    for (const { objectId, component } of group) {
      issues.push(
        issue(
          'portConflict',
          { names, port: component.port },
          { robotId, objectId, componentId: component.id }
        )
      )
    }
  }
}

// 같은 허브·I2C 버스에 기본 주소가 같은 장치가 둘 이상 있으면 충돌
function checkI2cConflicts(robotId: string, entries: ComponentEntry[], issues: Issue[]): void {
  const groups = new Map<string, ComponentEntry[]>()
  for (const entry of entries) {
    const def = defOf(entry.component)
    if (!def || def.portKind !== 'i2c' || def.i2cAddress === undefined) continue
    const key = `${entry.component.hub}/${entry.component.port}/${def.i2cAddress}`
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const names = group.map((e) => e.component.name).join(', ')
    for (const { objectId, component } of group) {
      issues.push(
        issue(
          'i2cAddressConflict',
          { names, bus: component.port },
          { robotId, objectId, componentId: component.id }
        )
      )
    }
  }
}

function checkComponent(
  objects: SceneObjects,
  robotId: string,
  { objectId, component }: ComponentEntry,
  entries: ComponentEntry[],
  expansionHubEnabled: boolean,
  issues: Issue[]
): void {
  const where = { robotId, objectId, componentId: component.id }
  const def = defOf(component)
  if (!def) return
  const name = component.name

  if (!name.trim()) issues.push(issue('emptyName', {}, where))
  else if (name !== name.trim()) issues.push(issue('nameWhitespace', { name }, where))

  if (def.portKind !== 'usb') {
    if (component.hub === 'expansionHub' && !expansionHubEnabled) {
      issues.push(issue('expansionHubDisabled', { name }, where))
    }
    const range = PORT_RANGES[def.portKind]
    if (!Number.isInteger(component.port) || component.port < 0 || component.port >= range) {
      issues.push(issue('portOutOfRange', { name, port: component.port, max: range - 1 }, where))
    }
  }

  switch (component.type) {
    case 'servo': {
      // 생성 코드는 소수 셋째 자리까지 쓰고, SDK scaleRange는 min < max가 아니면 예외를 던진다
      const round = (value: string | number): number => Math.round(Number(value) * 1000) / 1000
      if (!(round(component.props.scaleMin) < round(component.props.scaleMax)))
        issues.push(issue('servoScaleInvalid', { name }, where))
      break
    }
    case 'imu':
      // Expansion Hub에는 BHI260AP가 없다(SDK는 Control Hub의 버스 0에서만 이 종류를 고르게 한다)
      if (component.props.chip === 'bhi260ap' && component.hub !== 'controlHub')
        issues.push(issue('imuChipHub', { name }, where))
      if (
        !isValidHubOrientation(
          component.props.logoFacing as HubDirection,
          component.props.usbFacing as HubDirection
        )
      ) {
        issues.push(issue('imuOrientationInvalid', { name }, where))
      }
      break
    case 'touchSensor':
      // REV 터치 센서는 디지털 포트 쌍의 두 번째 채널(1, 3, 5, 7)에서만 동작한다
      if (component.port % 2 === 0)
        issues.push(issue('touchSensorEvenChannel', { name, port: component.port }, where))
      break
    case 'webcam':
      if (!String(component.props.serialNumber ?? '').trim())
        issues.push(issue('serialMissing', { name }, where))
      break
    case 'limelight': {
      const serial = String(component.props.serialNumber ?? '').trim()
      if (!serial) issues.push(issue('serialMissing', { name }, where))
      else if (!LIMELIGHT_SERIAL_PATTERN.test(serial))
        issues.push(issue('limelightSerialInvalid', { name }, where))
      break
    }
    case 'pinpoint': {
      // 포드 파트가 지워졌거나 다른 로봇으로 옮겨졌으면 오프셋을 계산할 수 없다
      const inRobot = (id: string | number | undefined): boolean =>
        typeof id === 'string' && !!objects[id] && findRobotId(objects, id) === robotId
      if (!inRobot(component.props.xPod) || !inRobot(component.props.yPod))
        issues.push(issue('pinpointPodMissing', { name }, where))
      break
    }
    case 'deadWheel': {
      // 같은 번호 모터가 엔코더로 속도·위치 제어를 하면, 그 모터는 데드휠 값을 자기 엔코더로 읽게 된다
      const motor = entries.find(
        (e) =>
          e.component.type === 'motor' &&
          e.component.hub === component.hub &&
          e.component.port === component.port &&
          e.component.props.runMode !== 'withoutEncoder'
      )
      // 엔코더 포트 0·3은 하드웨어로 세고 1·2는 빠른 회전에서 값을 놓칠 수 있다(Road Runner 문서 권장)
      if (component.props.measures !== 'strafe' && (component.port === 1 || component.port === 2)) {
        issues.push(issue('deadWheelSlowPort', { name, port: component.port }, where))
      }
      if (motor) {
        issues.push(
          issue(
            'encoderMotorConflict',
            { name, motor: motor.component.name, port: component.port },
            where
          )
        )
      }
      break
    }
  }
}

function pushMemberIssues(
  code: 'fieldNameCollision' | 'constantNameCollision',
  params: Record<string, string>,
  robotId: string,
  members: ScopeMember[],
  issues: Issue[]
): void {
  for (const member of members) {
    // 그룹이 받는 문제는 그룹 오브젝트에 붙인다(컴포넌트 없음)
    const where =
      member.kind === 'device'
        ? { robotId, objectId: member.objectId, componentId: member.component.id }
        : { robotId, objectId: member.objectId }
    issues.push(issue(code, params, where))
  }
}

const memberName = (member: ScopeMember): string =>
  member.kind === 'device' ? member.component.name : member.scope.name

// 클래스 하나(로봇 클래스 또는 그룹의 중첩 클래스) 안의 이름. 다른 클래스의 같은 이름은 Java에서 겹치지 않는다.
function checkScope(robotId: string, scope: CodeScope, issues: Issue[]): void {
  const devices = scope.members.filter((m): m is DeviceMember => m.kind === 'device')
  const groups = scope.members.filter((m): m is GroupMember => m.kind === 'group')

  // 중첩 클래스 이름: 규칙, 예약 타입, 감싸는 클래스(로봇 클래스 포함)와 같은 이름(JLS: 같으면 컴파일 오류)
  const named: GroupMember[] = []
  for (const member of groups) {
    const { name, className } = member.scope
    const where = { robotId, objectId: member.objectId }
    if (!isValidGroupClassName(className)) {
      issues.push(issue('invalidGroupName', { name, className }, where))
      continue
    }
    named.push(member)
    if (RESERVED_TYPE_NAMES.has(className))
      issues.push(issue('reservedGroupName', { name, className }, where))
    if (scope.classPath.includes(className))
      issues.push(issue('duplicateGroupClass', { names: name, className }, where))
  }
  // 같은 클래스 안의 중첩 클래스끼리는 대소문자만 달라도 겹친다. RobotHardware$Lift.class와 RobotHardware$LIFT.class는
  // Windows·macOS 파일 시스템에서 한 파일이고, javac는 기본 설정으로는 알리지 않는다.
  const byClass = new Map<string, GroupMember[]>()
  for (const member of named) {
    const key = member.scope.className.toLowerCase()
    byClass.set(key, [...(byClass.get(key) ?? []), member])
  }
  for (const same of byClass.values()) {
    if (same.length < 2) continue
    const names = same.map(memberName).join(', ')
    const className = [...new Set(same.map((m) => m.scope.className))].join(', ')
    for (const member of same) {
      issues.push(
        issue('duplicateGroupClass', { names, className }, { robotId, objectId: member.objectId })
      )
    }
  }

  // 필드: 장치 필드와 그룹 필드가 같은 이름 공간이다. 이름이 빈 장치와 클래스 이름을 쓸 수 없는 그룹은 이미 오류다.
  const checked = new Set<ScopeMember>([
    ...devices.filter((m) => m.component.name.trim()),
    ...named
  ])
  const byField = new Map<string, ScopeMember[]>()
  for (const member of scope.members) {
    if (!checked.has(member)) continue
    byField.set(member.field, [...(byField.get(member.field) ?? []), member])
  }
  for (const [field, same] of byField) {
    if (same.length < 2) continue
    // 장치끼리 구성 이름까지 같으면 duplicateName으로 이미 알렸다. 그룹이 끼면 duplicateName이 잡지 않으므로 항상 알린다.
    const devicesOnly = same.every((m) => m.kind === 'device')
    if (devicesOnly && new Set(same.map((m) => m.component.name.trim())).size < 2) continue
    const names = same.map(memberName).join(', ')
    pushMemberIssues('fieldNameCollision', { names, field }, robotId, same, issues)
  }

  // 상수 이름은 이름의 대소문자를 지워 만들므로(leftPod·leftPOD → LEFT_POD) 필드가 달라도 겹칠 수 있다.
  // 상수는 자기 범위의 클래스에 있으므로 클래스마다 본다(필드·클래스 이름과는 _ 때문에 겹치지 않는다).
  const byConstant = new Map<string, DeviceMember[]>()
  for (const member of devices) {
    if (!member.component.name.trim()) continue
    for (const constant of member.constants) {
      byConstant.set(constant, [...(byConstant.get(constant) ?? []), member])
    }
  }
  // 같은 장치들이 상수 여러 개에서 겹치면(데드휠 둘이면 여섯 개) 첫 상수 하나로만 알린다
  const reportedGroups = new Set<string>()
  for (const [constant, same] of byConstant) {
    const groupKey = same.map((m) => m.component.id).join('|')
    if (same.length < 2 || reportedGroups.has(groupKey)) continue
    reportedGroups.add(groupKey)
    pushMemberIssues(
      'constantNameCollision',
      { names: same.map(memberName).join(', '), constant },
      robotId,
      same,
      issues
    )
  }
}

// 컴포넌트가 없는 로봇은 생성할 파일이 없으므로 검사하지 않는다
export function validateRobot(objects: SceneObjects, robotId: string): Issue[] {
  const entries = robotComponents(objects, robotId)
  if (entries.length === 0) return []
  const issues: Issue[] = []
  const settings = robotHardwareSettings(objects, robotId)
  const robotWhere = { robotId, objectId: robotId }

  if (!isValidJavaClassName(settings.className)) {
    issues.push(issue('invalidClassName', { className: settings.className }, robotWhere))
  }
  if (!settings.configName.trim()) issues.push(issue('emptyConfigName', {}, robotWhere))
  const address = settings.expansionHub.address
  if (
    settings.expansionHub.enabled &&
    (!Number.isInteger(address) || address < 1 || address > 254 || address === CONTROL_HUB_ADDRESS)
  ) {
    issues.push(issue('expansionHubAddressInvalid', { address }, robotWhere))
  } else if (settings.expansionHub.enabled && address > MAX_UNRESERVED_HUB_ADDRESS) {
    // SDK와 REV Hardware Client는 10보다 큰 주소를 시스템용으로 남겨 둔다
    issues.push(issue('expansionHubAddressReserved', { address }, robotWhere))
  }
  if (RESERVED_TYPE_NAMES.has(settings.className)) {
    issues.push(issue('invalidClassName', { className: settings.className }, robotWhere))
  }

  for (const entry of entries) {
    checkComponent(objects, robotId, entry, entries, settings.expansionHub.enabled, issues)
  }

  // 구성 이름은 로봇 전체에서 겹치면 안 된다(구성 XML 하나에 들어간다)
  const byName = new Map<string, ComponentEntry[]>()
  for (const entry of entries) {
    const name = entry.component.name.trim()
    if (!name) continue
    byName.set(name, [...(byName.get(name) ?? []), entry])
  }
  for (const [name, group] of byName) {
    if (group.length < 2) continue
    for (const { objectId, component } of group) {
      issues.push(
        issue('duplicateName', { name }, { robotId, objectId, componentId: component.id })
      )
    }
  }

  // Java 이름(그룹 클래스, 필드, 상수)은 생성 코드와 같은 범위 트리로 클래스마다 검사한다.
  // 장치가 없어 클래스를 만들지 않는 그룹은 트리에 없으므로 검사하지 않는다.
  for (const scope of allScopes(buildCodeScopes(objects, robotId).root)) {
    checkScope(robotId, scope, issues)
  }

  checkPortConflicts(robotId, entries, issues)
  checkI2cConflicts(robotId, entries, issues)
  return issues
}

function pushGroupIssues(
  groups: Map<string, string[]>,
  code: 'duplicateClassName' | 'duplicateConfigName',
  params: (robotId: string) => Record<string, string>,
  issues: Issue[]
): void {
  const reported = new Set<string>()
  for (const robotIds of groups.values()) {
    if (robotIds.length < 2) continue
    for (const robotId of robotIds) {
      if (reported.has(robotId)) continue
      reported.add(robotId)
      issues.push(issue(code, params(robotId), { robotId, objectId: robotId }))
    }
  }
}

// 씬 전체: 로봇마다 검사하고, 로봇 간 이름 중복과 로봇 밖 컴포넌트를 더한다.
export function validateScene(objects: SceneObjects): Issue[] {
  // 컴포넌트가 하나도 없으면 검사할 것이 없다(씬을 끌 때마다 불리므로 빨리 끝낸다)
  if (!Object.values(objects).some((object) => object.components?.length)) return []
  const robots = childrenOf(objects, null).filter(
    (object) => object.kind === 'robot' && robotComponents(objects, object.id).length > 0
  )
  const issues = robots.flatMap((robot) => validateRobot(objects, robot.id))

  // 생성 파일 경로가 겹치면 한쪽이 다른 쪽을 덮어쓴다. Java 파일은 대소문자를 구분하지 않는
  // 파일 시스템(Windows·macOS)에서도 겹치지 않아야 하고, XML 파일 이름은 클래스 이름을 소문자로 바꿔 만든다.
  const byFile = new Map<string, string[]>()
  const byConfig = new Map<string, string[]>()
  for (const robot of robots) {
    const { className, configName } = robotHardwareSettings(objects, robot.id)
    for (const key of [
      `java:${javaFilePath(className).toLowerCase()}`,
      `xml:${configXmlFilePath(className)}`
    ])
      byFile.set(key, [...(byFile.get(key) ?? []), robot.id])
    // Driver Station은 구성 이름을 대소문자 구분 없이 하나로 본다(RobotConfigFile.containedIn)
    const config = configName.trim().toLowerCase()
    if (config) byConfig.set(config, [...(byConfig.get(config) ?? []), robot.id])
  }
  pushGroupIssues(
    byFile,
    'duplicateClassName',
    (robotId) => ({ className: robotHardwareSettings(objects, robotId).className }),
    issues
  )
  pushGroupIssues(
    byConfig,
    'duplicateConfigName',
    (robotId) => ({ configName: robotHardwareSettings(objects, robotId).configName }),
    issues
  )

  for (const { objectId, component } of orphanComponents(objects)) {
    issues.push(
      issue('orphanComponent', { name: component.name }, { objectId, componentId: component.id })
    )
  }
  return issues
}

// 여러 컴포넌트가 함께 받는 문제(포트 충돌 등). 목록·개수에서 한 번만 센다.
const SHARED_CODES = new Set<IssueCode>([
  'duplicateName',
  'fieldNameCollision',
  'constantNameCollision',
  'duplicateGroupClass',
  'portConflict',
  'i2cAddressConflict'
])

export function uniqueIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const owner = SHARED_CODES.has(issue.code) ? '' : (issue.componentId ?? issue.objectId ?? '')
    const key = `${issue.robotId ?? ''}|${owner}|${issue.code}|${JSON.stringify(issue.params)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}
