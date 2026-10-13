import type { HubId, SceneObjects } from '../scene/model'
import {
  componentDef,
  CONTROL_HUB_ADDRESS,
  isComponentType,
  MOTOR_MODEL_TAGS,
  type ComponentType,
  type PortKind
} from './catalog'
import { robotComponents, robotHardwareSettings, type ComponentEntry } from './components'
import { GENERATED_MARKER } from '../../../shared/generatedFiles'
import { xmlAttribute } from './naming'
import { LIMELIGHT_SERIAL_PATTERN } from './validation'

// 로봇 구성 XML(TeamCode/src/main/res/xml). 앱에 넣으면 Driver Station 구성 목록에 읽기 전용으로 나타난다.
// 형식은 FTC SDK의 ReadXMLFileHandler/WriteXMLFileHandler를 따른다.

const INDENT = '    '

// 허브 안의 장치 태그(포트 종류별). 대소문자를 구분하며 틀리면 SDK가 장치를 조용히 버린다.
function deviceTag(type: ComponentType, props: Record<string, string | number>): string | null {
  switch (type) {
    case 'motor':
      return (
        MOTOR_MODEL_TAGS[props.motorModel as keyof typeof MOTOR_MODEL_TAGS] ??
        MOTOR_MODEL_TAGS.unspecified
      )
    case 'servo':
      return props.pulseRange === 'fullRange' ? 'ServoFullRange' : 'Servo'
    case 'crServo':
      return 'ContinuousRotationServo'
    case 'sparkMini':
      return 'RevSPARKMini'
    case 'blinkin':
      return 'RevBlinkinLedDriver'
    case 'imu':
      return props.chip === 'bno055' ? 'LynxEmbeddedIMU' : 'ControlHubImuBHI260AP'
    case 'distanceSensor':
      return 'REV_VL53L0X_RANGE_SENSOR'
    case 'colorSensor':
      return 'RevColorSensorV3'
    case 'touchSensor':
      return 'RevTouchSensor'
    case 'digitalDevice':
      return 'DigitalDevice'
    case 'analogInput':
      return 'AnalogInput'
    case 'led':
      return 'Led'
    case 'huskyLens':
      return 'HuskyLens'
    case 'pinpoint':
      return 'goBILDAPinpoint'
    case 'otos':
      return 'SparkFunOTOS'
    case 'octoQuad':
      return 'OctoQuadFTC'
    case 'deadWheel':
      // 데드휠만 꽂힌 엔코더 포트는 이름을 붙일 모터 항목이 필요하다(같은 번호에 모터가 있으면 그 이름을 쓴다)
      return 'Motor'
    case 'webcam':
    case 'limelight':
      return null
  }
}

const PORT_ORDER: PortKind[] = ['motor', 'encoder', 'servo', 'digital', 'analog', 'i2c']

function element(tag: string, attributes: [string, string | number][]): string {
  return `<${tag} ${attributes.map(([key, value]) => `${key}="${xmlAttribute(String(value))}"`).join(' ')} />`
}

function moduleDevices(hub: HubId, entries: ComponentEntry[]): string[] {
  const onHub = entries.filter(
    (e) =>
      e.component.hub === hub && componentDef(e.component.type as ComponentType).portKind !== 'usb'
  )
  const kindOf = (e: ComponentEntry): PortKind =>
    componentDef(e.component.type as ComponentType).portKind
  const lines: string[] = []

  for (const kind of PORT_ORDER) {
    const group = onHub
      .filter((e) => kindOf(e) === kind)
      .sort((a, b) => a.component.port - b.component.port)
    if (kind === 'i2c') {
      // I2C 장치의 port는 버스 안의 순번이다(IMU가 먼저 오게 한다)
      const byBus = new Map<number, ComponentEntry[]>()
      for (const e of group)
        byBus.set(e.component.port, [...(byBus.get(e.component.port) ?? []), e])
      for (const [bus, devices] of [...byBus].sort((a, b) => a[0] - b[0])) {
        devices.sort(
          (a, b) => Number(b.component.type === 'imu') - Number(a.component.type === 'imu')
        )
        devices.forEach((e, index) => {
          const tag = deviceTag(e.component.type as ComponentType, e.component.props)
          if (tag)
            lines.push(
              element(tag, [
                ['name', e.component.name],
                ['port', index],
                ['bus', bus]
              ])
            )
        })
      }
      continue
    }
    for (const e of group) {
      if (kind === 'encoder') {
        const sharesMotor = entries.some(
          (m) =>
            m.component.type === 'motor' &&
            m.component.hub === hub &&
            m.component.port === e.component.port
        )
        if (sharesMotor) continue
      }
      const tag = deviceTag(e.component.type as ComponentType, e.component.props)
      if (tag)
        lines.push(
          element(tag, [
            ['name', e.component.name],
            ['port', e.component.port]
          ])
        )
    }
  }
  return lines
}

export function generateConfigXml(objects: SceneObjects, robotId: string): string {
  const settings = robotHardwareSettings(objects, robotId)
  const entries = robotComponents(objects, robotId).filter((e) => isComponentType(e.component.type))
  const pad = (depth: number, line: string): string => `${INDENT.repeat(depth)}${line}`

  const modules: string[] = []
  const addModule = (name: string, address: number, hub: HubId): void => {
    const devices = moduleDevices(hub, entries)
    modules.push(pad(2, `<LynxModule name="${xmlAttribute(name)}" port="${address}">`))
    modules.push(...devices.map((line) => pad(3, line)))
    modules.push(pad(2, '</LynxModule>'))
  }
  if (settings.expansionHub.enabled) {
    addModule(
      `Expansion Hub ${settings.expansionHub.address}`,
      settings.expansionHub.address,
      'expansionHub'
    )
  }
  addModule('Control Hub', CONTROL_HUB_ADDRESS, 'controlHub')

  // 웹캠·Limelight는 허브 밖, <Robot> 바로 아래. 시리얼이 없으면 연결되지 않으므로 넣지 않는다(검증 경고).
  const usbDevices: string[] = []
  for (const { component } of entries) {
    const serial = String(component.props.serialNumber ?? '').trim()
    if (component.type === 'webcam' && serial) {
      usbDevices.push(
        pad(
          1,
          element('Webcam', [
            ['name', component.name],
            ['serialNumber', serial]
          ])
        )
      )
    }
    const limelight = component.type === 'limelight' ? LIMELIGHT_SERIAL_PATTERN.exec(serial) : null
    if (limelight) {
      usbDevices.push(
        pad(
          1,
          element('EthernetDevice', [
            ['name', component.name],
            ['serialNumber', serial],
            ['ipAddress', limelight[1]]
          ])
        )
      )
    }
  }

  return [
    "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
    `<!-- Generated by SandBot. Do not edit: this file is overwritten every time the SandBot project is saved. ${GENERATED_MARKER} -->`,
    `<Robot type="FirstInspires-FTC" name="${xmlAttribute(settings.configName)}">`,
    pad(
      1,
      `<LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="${CONTROL_HUB_ADDRESS}">`
    ),
    ...modules,
    pad(1, '</LynxUsbDevice>'),
    ...usbDevices,
    '</Robot>',
    ''
  ].join('\n')
}
