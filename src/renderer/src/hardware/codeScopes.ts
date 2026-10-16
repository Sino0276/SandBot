import {
  childrenInDocument,
  findRobotId,
  isCodeGroup,
  type HardwareComponent,
  type SceneObject,
  type SceneObjects
} from '../scene/model'
import { isComponentType } from './catalog'
import { robotComponents, robotHardwareSettings, type ComponentEntry } from './components'
import {
  generatedConstantNames,
  groupFieldName,
  isValidGroupClassName,
  javaClassName,
  javaIdentifier
} from './naming'

// 생성 하드웨어 클래스의 범위(클래스) 트리. 로봇 클래스가 뿌리이고, 장치가 있는 그룹마다 중첩 클래스가 하나 생긴다.
// 클래스·필드·상수 이름은 여기서 한 번만 정하고 코드 생성(javaCodegen)과 검증(validation)이 같이 읽는다.
// 둘이 다른 이름을 보면 검증을 통과한 파일이 Android Studio에서 컴파일되지 않는다.

export type DeviceMember = {
  kind: 'device'
  objectId: string
  component: HardwareComponent
  // javaIdentifier(구성 이름). 그룹 안에서도 같은 이름이다(robot.lift.liftLeft).
  field: string
  // 이 장치가 자기 범위의 클래스 안에 만드는 상수(위치 오프셋 등)
  constants: string[]
}

export type GroupMember = {
  kind: 'group'
  objectId: string
  // 클래스 이름의 lowerCamel(Lift → lift). 클래스 이름을 쓸 수 없는 그룹은 표시용으로 이름에서 만든다.
  field: string
  scope: CodeScope
}

export type ScopeMember = DeviceMember | GroupMember

export type CodeScope = {
  // 범위를 여는 오브젝트(로봇 또는 그룹)
  objectId: string
  // 하이어라키 이름(생성 주석에 쓴다)
  name: string
  // 로봇은 하드웨어 설정의 클래스 이름, 그룹은 codeClassName ?? javaClassName(name)
  className: string
  // 로봇 클래스부터 이 클래스까지의 이름(['MyBotHardware', 'Lift']). 상수는 이 형식 경로로 쓴다.
  classPath: string[]
  // 로봇 변수에서 이 범위까지의 필드(로봇은 [], robot.lift면 ['lift'])
  fieldPath: string[]
  // 하이어라키 순서. 오브젝트 자신의 장치가 먼저, 그다음 자식이다.
  members: ScopeMember[]
}

export type RobotCodeScopes = {
  root: CodeScope
  // 로봇 전체의 장치(하이어라키 순서). import와 데드휠의 모터 찾기는 범위가 아니라 이 목록을 쓴다.
  entries: ComponentEntry[]
  // deviceKey(objectId, componentId) → 장치와 그 범위
  devices: Map<string, { scope: CodeScope; member: DeviceMember }>
  // 그룹 오브젝트 id → 그 그룹의 범위. 장치가 없어 빠진 그룹은 없다.
  groups: Map<string, CodeScope>
}

function deviceKey(objectId: string, componentId: string): string {
  return `${objectId}\n${componentId}`
}

// 그룹의 중첩 클래스 이름. 덮어쓰기(codeClassName)가 비어 있으면 이름에서 만든다.
export function groupClassName(object: SceneObject): string {
  return object.codeClassName?.trim() || javaClassName(object.name)
}

// object의 컴포넌트와 하위 오브젝트를 scope에 넣는다. 그룹 자식은 새 범위를 연다.
function collect(
  objects: SceneObjects,
  object: SceneObject,
  scope: CodeScope,
  result: RobotCodeScopes
): void {
  for (const component of object.components ?? []) {
    // 코드 생성과 같은 기준: 카탈로그에 없는 종류는 코드를 만들지 않는다
    if (!isComponentType(component.type)) continue
    const member: DeviceMember = {
      kind: 'device',
      objectId: object.id,
      component,
      field: javaIdentifier(component.name),
      constants: generatedConstantNames(component.type, component.name)
    }
    scope.members.push(member)
    result.devices.set(deviceKey(object.id, component.id), { scope, member })
  }
  for (const child of childrenInDocument(objects, object.id)) {
    if (!isCodeGroup(child)) {
      collect(objects, child, scope, result)
      continue
    }
    const className = groupClassName(child)
    const field = isValidGroupClassName(className)
      ? groupFieldName(className)
      : javaIdentifier(child.name)
    const nested: CodeScope = {
      objectId: child.id,
      name: child.name,
      className,
      classPath: [...scope.classPath, className],
      fieldPath: [...scope.fieldPath, field],
      members: []
    }
    collect(objects, child, nested, result)
    // 장치가 하나도 없는 그룹(빈 하위 그룹만 있는 그룹 포함)은 클래스를 만들지 않는다
    if (nested.members.length === 0) continue
    scope.members.push({ kind: 'group', objectId: child.id, field, scope: nested })
    result.groups.set(child.id, nested)
  }
}

// 문서(불변)마다 로봇별로 한 번 만든다. 검증·코드 생성·인스펙터가 같은 결과를 읽는다.
const scopeCache = new WeakMap<SceneObjects, Map<string, RobotCodeScopes>>()

export function buildCodeScopes(objects: SceneObjects, robotId: string): RobotCodeScopes {
  let byRobot = scopeCache.get(objects)
  if (!byRobot) {
    byRobot = new Map()
    scopeCache.set(objects, byRobot)
  }
  const cached = byRobot.get(robotId)
  if (cached) return cached

  const settings = robotHardwareSettings(objects, robotId)
  const robot = objects[robotId]
  const result: RobotCodeScopes = {
    root: {
      objectId: robotId,
      name: robot?.name ?? '',
      className: settings.className,
      classPath: [settings.className],
      fieldPath: [],
      members: []
    },
    entries: robotComponents(objects, robotId).filter((e) => isComponentType(e.component.type)),
    devices: new Map(),
    groups: new Map()
  }
  if (robot) collect(objects, robot, result.root, result)
  byRobot.set(robotId, result)
  return result
}

// 범위와 그 아래 모든 범위(전위 순서)
export function allScopes(scope: CodeScope): CodeScope[] {
  return [
    scope,
    ...scope.members.flatMap((member) => (member.kind === 'group' ? allScopes(member.scope) : []))
  ]
}

export type CodePath = {
  // 로봇 변수에서 이어지는 필드. robot.lift.liftLeft면 ['lift', 'liftLeft']
  fieldPath: string[]
  // 상수가 있는 클래스의 형식 이름. 장치는 자기 범위의 클래스, 그룹은 그 그룹의 클래스('MyBotHardware.Lift').
  typeName: string
  // 장치가 typeName 안에 만드는 상수 이름. 그룹은 빈 목록이다.
  constants: string[]
}

// 장치의 생성 코드 경로(인스펙터 표시용). 로봇 밖이거나 카탈로그에 없는 종류면 null.
export function componentCodePath(
  objects: SceneObjects,
  objectId: string,
  componentId: string
): CodePath | null {
  const robotId = findRobotId(objects, objectId)
  if (!robotId) return null
  const found = buildCodeScopes(objects, robotId).devices.get(deviceKey(objectId, componentId))
  if (!found) return null
  return {
    fieldPath: [...found.scope.fieldPath, found.member.field],
    typeName: found.scope.classPath.join('.'),
    constants: found.member.constants
  }
}

// 그룹의 생성 코드 경로. 로봇 밖이거나 장치가 없어 클래스를 만들지 않는 그룹이면 null.
export function groupCodePath(objects: SceneObjects, groupId: string): CodePath | null {
  const robotId = findRobotId(objects, groupId)
  if (!robotId) return null
  const scope = buildCodeScopes(objects, robotId).groups.get(groupId)
  if (!scope) return null
  return { fieldPath: scope.fieldPath, typeName: scope.classPath.join('.'), constants: [] }
}
