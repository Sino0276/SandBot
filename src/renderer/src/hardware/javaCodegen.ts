import type { HardwareComponent, SceneObjects } from '../scene/model'
import { componentDef, isComponentType, type ComponentType } from './catalog'
import { robotComponents, robotHardwareSettings, type ComponentEntry } from './components'
import {
  INCH_PER_METER,
  MM_PER_METER,
  otosOffsetInchDeg,
  pinpointComponentOffsetsMm,
  robotFramePose
} from './mounting'
import { GENERATED_MARKER } from '../../../shared/generatedFiles'
import {
  configXmlFilePath,
  constantName,
  GENERATED_JAVA_PACKAGE,
  javaIdentifier,
  javaString
} from './naming'

const INDENT = '    '

// Java double 리터럴: 반올림 후 끝의 0을 지우되 소수점은 남긴다(12 → 12.0)
export function javaDouble(value: number, digits: number): string {
  const fixed = (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '.0') : `${fixed}.0`
  return trimmed === '-0.0' ? '0.0' : trimmed
}

// Javadoc 주석 안에 넣는 문자열이 주석을 닫지 않게 한다
function commentText(value: string): string {
  return value.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ')
}

const DIRECTION_ENUM: Record<string, string> = { forward: 'FORWARD', reverse: 'REVERSE' }
const HUB_DIRECTION_ENUM: Record<string, string> = {
  up: 'UP',
  down: 'DOWN',
  forward: 'FORWARD',
  backward: 'BACKWARD',
  left: 'LEFT',
  right: 'RIGHT'
}

type Generated = { constants: string[]; init: string[] }

// 데드휠이 꽂힌 엔코더 포트와 같은 번호에 모터가 있으면, SDK에서는 그 모터 이름으로 엔코더를 읽는다
export function deadWheelDeviceName(entry: ComponentEntry, entries: ComponentEntry[]): string {
  const motor = entries.find(
    (e) =>
      e.component.type === 'motor' &&
      e.component.hub === entry.component.hub &&
      e.component.port === entry.component.port
  )
  return motor ? motor.component.name : entry.component.name
}

function generateComponent(
  objects: SceneObjects,
  entry: ComponentEntry,
  entries: ComponentEntry[]
): Generated {
  const { component, objectId } = entry
  const type = component.type as ComponentType
  const def = componentDef(type)
  const field = javaIdentifier(component.name)
  const constant = constantName(field)
  const props = component.props
  const get = (javaType: string, name = component.name): string =>
    `${field} = hardwareMap.get(${javaType}.class, ${javaString(name)});`
  const constants: string[] = []
  const init: string[] = []

  switch (type) {
    case 'motor': {
      init.push(get(def.javaType))
      init.push(
        `${field}.setDirection(DcMotorSimple.Direction.${DIRECTION_ENUM[props.direction]});`
      )
      if (props.runMode === 'resetThenUsingEncoder') {
        init.push(`${field}.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);`)
        init.push(`${field}.setMode(DcMotor.RunMode.RUN_USING_ENCODER);`)
      } else {
        const mode = props.runMode === 'usingEncoder' ? 'RUN_USING_ENCODER' : 'RUN_WITHOUT_ENCODER'
        init.push(`${field}.setMode(DcMotor.RunMode.${mode});`)
      }
      const zero = props.zeroPowerBehavior === 'float' ? 'FLOAT' : 'BRAKE'
      init.push(`${field}.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.${zero});`)
      break
    }
    case 'servo': {
      init.push(get(def.javaType))
      init.push(`${field}.setDirection(Servo.Direction.${DIRECTION_ENUM[props.direction]});`)
      const min = Number(props.scaleMin)
      const max = Number(props.scaleMax)
      if (min !== 0 || max !== 1)
        init.push(`${field}.scaleRange(${javaDouble(min, 3)}, ${javaDouble(max, 3)});`)
      break
    }
    case 'crServo':
    case 'sparkMini':
      init.push(get(def.javaType))
      init.push(
        `${field}.setDirection(DcMotorSimple.Direction.${DIRECTION_ENUM[props.direction]});`
      )
      break
    case 'imu':
      init.push(get(def.javaType))
      init.push(
        `${field}.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(`,
        `${INDENT}${INDENT}RevHubOrientationOnRobot.LogoFacingDirection.${HUB_DIRECTION_ENUM[props.logoFacing]},`,
        `${INDENT}${INDENT}RevHubOrientationOnRobot.UsbFacingDirection.${HUB_DIRECTION_ENUM[props.usbFacing]})));`
      )
      break
    case 'colorSensor':
      init.push(get(def.javaType))
      init.push(`${field}.setGain(${javaDouble(Number(props.gain), 2)}f);`)
      break
    case 'digitalDevice':
      init.push(get(def.javaType))
      init.push(
        `${field}.setMode(DigitalChannel.Mode.${props.mode === 'output' ? 'OUTPUT' : 'INPUT'});`
      )
      break
    case 'pinpoint': {
      // 포드 파트가 없거나 다른 로봇에 있으면 오프셋을 0으로 둔다(검증 경고 pinpointPodMissing)
      const offsets = pinpointComponentOffsetsMm(objects, objectId, props)
      constants.push(
        `/** ${commentText(component.name)}: X pod offset (left +) and Y pod offset (forward +) from the robot center, mm. */`,
        `public static final double ${constant}_X_OFFSET_MM = ${javaDouble(offsets?.x ?? 0, 2)};`,
        `public static final double ${constant}_Y_OFFSET_MM = ${javaDouble(offsets?.y ?? 0, 2)};`
      )
      const pods = props.podType === 'swingarm' ? 'goBILDA_SWINGARM_POD' : 'goBILDA_4_BAR_POD'
      const direction = (value: string | number): string =>
        value === 'reversed' ? 'REVERSED' : 'FORWARD'
      init.push(get(def.javaType))
      if (!offsets)
        init.push(
          '// Choose the X and Y pod parts in SandBot to compute these offsets from the CAD.'
        )
      init.push(
        `${field}.setOffsets(${constant}_X_OFFSET_MM, ${constant}_Y_OFFSET_MM, DistanceUnit.MM);`,
        `${field}.setEncoderResolution(GoBildaPinpointDriver.GoBildaOdometryPods.${pods});`,
        `${field}.setEncoderDirections(GoBildaPinpointDriver.EncoderDirection.${direction(props.xDirection)}, ` +
          `GoBildaPinpointDriver.EncoderDirection.${direction(props.yDirection)});`,
        `${field}.resetPosAndIMU();`
      )
      break
    }
    case 'otos': {
      const offset = otosOffsetInchDeg(objects, objectId, Number(props.mountingAngle)) ?? {
        x: 0,
        y: 0,
        h: 0
      }
      constants.push(
        `/**`,
        ` * ${commentText(component.name)}: sensor pose on the robot in the convention of the SDK OTOS sample`,
        ` * (X right +, Y forward +, inches; heading CCW +, degrees). getPosition() then reports the robot center`,
        ` * in that convention. Road Runner / Pedro Pathing use X forward / Y left: set their own offsets instead.`,
        ` */`,
        `public static final double ${constant}_OFFSET_X_IN = ${javaDouble(offset.x, 3)};`,
        `public static final double ${constant}_OFFSET_Y_IN = ${javaDouble(offset.y, 3)};`,
        `public static final double ${constant}_OFFSET_H_DEG = ${javaDouble(offset.h, 2)};`
      )
      init.push(get(def.javaType))
      init.push(
        `${field}.setOffset(new SparkFunOTOS.Pose2D(${constant}_OFFSET_X_IN, ${constant}_OFFSET_Y_IN, ${constant}_OFFSET_H_DEG));`,
        `${field}.setLinearScalar(${javaDouble(Number(props.linearScalar), 3)});`,
        `${field}.setAngularScalar(${javaDouble(Number(props.angularScalar), 3)});`,
        `${field}.calibrateImu();`,
        `${field}.resetTracking();`
      )
      break
    }
    case 'deadWheel': {
      const pose = robotFramePose(objects, objectId) ?? { x: 0, y: 0 }
      const measures = props.measures === 'strafe' ? 'strafe (left/right)' : 'forward/backward'
      constants.push(
        `/** ${commentText(component.name)}: dead wheel measuring ${measures} motion; position from the robot center (X forward +, Y left +). */`,
        `public static final double ${constant}_X_MM = ${javaDouble(pose.x * MM_PER_METER, 2)};`,
        `public static final double ${constant}_Y_MM = ${javaDouble(pose.y * MM_PER_METER, 2)};`,
        `public static final double ${constant}_X_IN = ${javaDouble(pose.x * INCH_PER_METER, 3)};`,
        `public static final double ${constant}_Y_IN = ${javaDouble(pose.y * INCH_PER_METER, 3)};`,
        `public static final boolean ${constant}_MEASURES_FORWARD = ${props.measures !== 'strafe'};`,
        `public static final boolean ${constant}_REVERSED = ${props.reversed === 'yes'};`
      )
      init.push(get(def.javaType, deadWheelDeviceName(entry, entries)))
      break
    }
    default:
      // 설정할 속성이 없는 장치(거리·터치·아날로그·LED·Blinkin·웹캠·Limelight·HuskyLens·OctoQuad)
      init.push(get(def.javaType))
  }
  return { constants, init }
}

// 로봇 하나의 하드웨어 클래스(Java 소스). 검증 오류가 없는 상태에서 부른다.
export function generateHardwareJava(objects: SceneObjects, robotId: string): string {
  const settings = robotHardwareSettings(objects, robotId)
  const entries = robotComponents(objects, robotId).filter((e) => isComponentType(e.component.type))
  const robotName = objects[robotId]?.name ?? ''

  const imports = new Set(['com.qualcomm.robotcore.hardware.HardwareMap'])
  for (const { component } of entries) {
    for (const name of componentDef(component.type as ComponentType).imports) imports.add(name)
  }

  const fields = entries.map(({ component }: { component: HardwareComponent }) => {
    const def = componentDef(component.type as ComponentType)
    return `public final ${def.javaType} ${javaIdentifier(component.name)};`
  })
  const generated = entries.map((entry) => generateComponent(objects, entry, entries))
  const constants = generated.flatMap((g) => g.constants)
  const init = generated.flatMap((g, i) => [
    ...(i > 0 ? [''] : []),
    `// ${entries[i].component.name}`.replace(/[\r\n]+/g, ' '),
    ...g.init
  ])

  const lines = [
    `// Generated by SandBot. Do not edit: this file is overwritten every time the SandBot project is saved.`,
    `// ${GENERATED_MARKER}`,
    `package ${GENERATED_JAVA_PACKAGE};`,
    '',
    ...[...imports].sort().map((name) => `import ${name};`),
    '',
    '/**',
    ` * Hardware for the robot "${commentText(robotName)}".`,
    ' *',
    ` * Activate the robot configuration "${commentText(settings.configName)}" on the Driver Station`,
    ` * (generated as TeamCode/${configXmlFilePath(settings.className)}), then in an OpMode:`,
    ` *   ${settings.className} robot = new ${settings.className}(hardwareMap);`,
    ' */',
    `public class ${settings.className} {`,
    `${INDENT}/** Robot configuration name to activate on the Driver Station. */`,
    `${INDENT}public static final String CONFIGURATION_NAME = ${javaString(settings.configName)};`,
    ...(constants.length ? ['', ...constants.map((line) => `${INDENT}${line}`)] : []),
    ...(fields.length ? ['', ...fields.map((line) => `${INDENT}${line}`)] : []),
    '',
    `${INDENT}/** Call during OpMode init (hardwareMap.get must only be used in the init phase). */`,
    `${INDENT}public ${settings.className}(HardwareMap hardwareMap) {`,
    ...init.map((line) => (line ? `${INDENT}${INDENT}${line}` : '')),
    `${INDENT}}`,
    '}',
    ''
  ]
  return lines.join('\n')
}
