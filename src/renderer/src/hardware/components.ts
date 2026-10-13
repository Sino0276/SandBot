import {
  findRobotId,
  subtreeIds,
  type HardwareComponent,
  type RobotHardwareSettings,
  type SceneObjects
} from '../scene/model'
import {
  componentDef,
  DEFAULT_EXPANSION_HUB_ADDRESS,
  EMBEDDED_IMU_BUS,
  isComponentType,
  PORT_RANGES,
  propertyDefaults,
  type ComponentType
} from './catalog'

export const DEFAULT_CLASS_NAME = 'RobotHardware'

export function robotHardwareSettings(
  objects: SceneObjects,
  robotId: string
): RobotHardwareSettings {
  const robot = objects[robotId]
  return (
    robot?.hardware ?? {
      className: DEFAULT_CLASS_NAME,
      configName: robot?.name ?? DEFAULT_CLASS_NAME,
      expansionHub: { enabled: false, address: DEFAULT_EXPANSION_HUB_ADDRESS }
    }
  )
}

// 같은 이름이 있으면 2, 3…을 붙인다(구성 이름은 로봇 안에서 겹치면 안 된다)
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = /\d$/.test(base) ? `${base}_${n}` : `${base}${n}`
    if (!used.has(candidate)) return candidate
  }
}

export type ComponentEntry = { objectId: string; component: HardwareComponent }

// 로봇과 그 하위 오브젝트에 붙은 모든 컴포넌트(하이어라키 순서)
export function robotComponents(objects: SceneObjects, robotId: string): ComponentEntry[] {
  return subtreeIds(objects, robotId).flatMap((objectId) =>
    (objects[objectId].components ?? []).map((component) => ({ objectId, component }))
  )
}

// 로봇에 속하지 않은 오브젝트에 붙은 컴포넌트. 코드가 생성되지 않으므로 경고한다.
export function orphanComponents(objects: SceneObjects): ComponentEntry[] {
  return Object.values(objects)
    .filter((object) => object.components?.length && !findRobotId(objects, object.id))
    .flatMap((object) =>
      object.components!.map((component) => ({ objectId: object.id, component }))
    )
}

// 구성 XML의 Limelight 시리얼 형식(SDK EthernetOverUsbSerialNumber): EthernetOverUsb:<인터페이스>:<IPv4>
// IP는 그 인터페이스에서 Control Hub 자신의 주소다.
export const LIMELIGHT_SERIAL_PATTERN = /^EthernetOverUsb:[^:]+:(\d{1,3}(?:\.\d{1,3}){3})$/

export function usbSerial(component: HardwareComponent): string {
  return String(component.props.serialNumber ?? '').trim()
}

// 구성 XML에 들어가는 장치인지. 웹캠·Limelight는 실제 시리얼이 있어야 연결되므로 시리얼이 없으면 넣지 않는다.
// 생성 Java도 같은 기준으로 get()과 tryGet()을 고른다.
export function isInConfiguration(component: HardwareComponent): boolean {
  switch (component.type) {
    case 'webcam':
      return usbSerial(component) !== ''
    case 'limelight':
      return LIMELIGHT_SERIAL_PATTERN.test(usbSerial(component))
    default:
      return true
  }
}

// 새 컴포넌트. 이름은 로봇 안에서 겹치지 않게, 포트는 같은 종류가 쓰지 않은 가장 낮은 번호로 정한다.
export function createComponent(
  type: ComponentType,
  existing: HardwareComponent[],
  createId: () => string
): HardwareComponent {
  const def = componentDef(type)
  let port = 0
  if (type === 'imu') {
    port = EMBEDDED_IMU_BUS
  } else if (def.portKind !== 'usb' && def.portKind !== 'i2c') {
    const used = new Set(
      existing
        .filter((c) => c.hub === 'controlHub' && sharesPortClass(c.type, type))
        .map((c) => c.port)
    )
    // REV 터치 센서는 디지털 포트 쌍의 두 번째 채널(홀수)에서만 동작한다
    const step = type === 'touchSensor' ? 2 : 1
    port = type === 'touchSensor' ? 1 : 0
    while (used.has(port)) port += step
    if (port >= PORT_RANGES[def.portKind]) {
      port = 0
      while (used.has(port)) port++
    }
  } else if (def.portKind === 'i2c') {
    // 버스 0은 내장 IMU가 쓰므로 다른 I2C 장치는 1번 버스부터 제안한다
    port = 1
  }
  return {
    id: createId(),
    type,
    name: uniqueName(
      def.defaultName,
      existing.map((c) => c.name)
    ),
    hub: 'controlHub',
    port,
    props: propertyDefaults(type)
  }
}

// 같은 물리 포트 묶음을 쓰는지(모터 포트의 전원 단자와 엔코더 단자는 다른 자원이다)
export function sharesPortClass(a: string, b: string): boolean {
  return (
    isComponentType(a) &&
    isComponentType(b) &&
    componentDef(a).portKind === componentDef(b).portKind
  )
}
