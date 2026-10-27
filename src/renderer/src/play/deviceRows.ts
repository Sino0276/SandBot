import type { DeviceValues } from '../../../shared/sidecarProtocol'
import { isComponentType, type ComponentType } from '../hardware/catalog'
import { robotComponents } from '../hardware/components'
import type { SceneObjects } from '../scene/model'

// 장치 탭의 표. 사이드카가 보낸 출력(구성 이름 → 값)을 씬의 컴포넌트 순서(하이어라키)로 놓고, 행마다 그 컴포넌트가
// 붙은 오브젝트를 알려 준다(누르면 고른다). 같은 구성 이름(같은 포트의 모터·데드휠)은 처음 컴포넌트의 것이다.
// 씬에 없는 이름(허브 등)은 뒤에 이름 순으로 놓는다.

export type DeviceRow = {
  name: string
  objectId: string | null
  type: ComponentType | null
  values: [string, DeviceValues[string]][]
}

export function deviceRows(
  objects: SceneObjects,
  robotId: string | null,
  outputs: Readonly<Record<string, DeviceValues>>
): DeviceRow[] {
  const rows: DeviceRow[] = []
  const seen = new Set<string>()
  const entries =
    robotId !== null && objects[robotId]?.kind === 'robot' ? robotComponents(objects, robotId) : []
  for (const { objectId, component } of entries) {
    const name = component.name.trim()
    if (seen.has(name) || !Object.hasOwn(outputs, name)) continue
    seen.add(name)
    rows.push({
      name,
      objectId,
      type: isComponentType(component.type) ? component.type : null,
      values: Object.entries(outputs[name])
    })
  }
  const rest = Object.keys(outputs)
    .filter((name) => !seen.has(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
  for (const name of rest)
    rows.push({ name, objectId: null, type: null, values: Object.entries(outputs[name]) })
  return rows
}
