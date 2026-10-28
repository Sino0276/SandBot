import type { DeviceValues } from '../../../shared/sidecarProtocol'
import { isComponentType, type ComponentType } from '../hardware/catalog'
import { robotComponents } from '../hardware/components'
import { sidecarDeviceName } from '../hardware/naming'
import type { SceneObjects } from '../scene/model'

// 장치 탭의 표. 사이드카가 보낸 출력(구성 이름 → 값)과 시뮬레이터가 보낸 센서 값(허브 원시 값)을 씬의 컴포넌트
// 순서(하이어라키)로 놓고, 행마다 그 컴포넌트가 붙은 오브젝트를 알려 준다(누르면 고른다). 같은 구성 이름(같은 포트의
// 모터·데드휠)은 처음 컴포넌트의 것이다. 씬에 없는 이름(허브 등)은 뒤에 이름 순으로 놓는다. 출력이나 센서 값 중 하나만
// 있는 장치도 행이 된다.

type Values = [string, DeviceValues[string]][]

export type DeviceRow = {
  name: string
  objectId: string | null
  type: ComponentType | null
  values: Values
  // 센서 값(키 이름 순, 받은 값이 없으면 빈 목록)
  inputs: Values
}

export function deviceRows(
  objects: SceneObjects,
  robotId: string | null,
  outputs: Readonly<Record<string, DeviceValues>>,
  inputs: Readonly<Record<string, DeviceValues>> = {}
): DeviceRow[] {
  const has = (name: string): boolean => Object.hasOwn(outputs, name) || Object.hasOwn(inputs, name)
  const valuesOf = (name: string): Values =>
    Object.hasOwn(outputs, name) ? Object.entries(outputs[name]) : []
  // 센서 값은 누적 상태라 키 순서가 처음 받은 순서다. 읽기 쉽게 이름 순으로 둔다.
  const inputsOf = (name: string): Values =>
    Object.hasOwn(inputs, name)
      ? Object.entries(inputs[name]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      : []
  const rows: DeviceRow[] = []
  const seen = new Set<string>()
  const entries =
    robotId !== null && objects[robotId]?.kind === 'robot' ? robotComponents(objects, robotId) : []
  for (const { objectId, component } of entries) {
    // 사이드카가 보내는 장치 이름(앞뒤 공백을 Java trim으로 뺀 구성 이름)
    const name = sidecarDeviceName(component.name)
    if (seen.has(name) || !has(name)) continue
    seen.add(name)
    rows.push({
      name,
      objectId,
      type: isComponentType(component.type) ? component.type : null,
      values: valuesOf(name),
      inputs: inputsOf(name)
    })
  }
  const rest = [...new Set([...Object.keys(outputs), ...Object.keys(inputs)])]
    .filter((name) => !seen.has(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
  for (const name of rest)
    rows.push({ name, objectId: null, type: null, values: valuesOf(name), inputs: inputsOf(name) })
  return rows
}
