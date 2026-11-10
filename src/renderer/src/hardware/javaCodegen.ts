import type { SceneObjects } from '../scene/model'
import { componentDef, type ComponentType } from './catalog'
import {
  buildCodeScopes,
  type CodeScope,
  type DeviceMember,
  type RobotCodeScopes
} from './codeScopes'
import { isInConfiguration, robotHardwareSettings, type ComponentEntry } from './components'
import type { CodeUnits } from '../scene/projectSettings'
import {
  ANGLE_CODE_UNITS,
  angleLiteral,
  type AngleCodeUnit,
  type LengthCodeUnit,
  deviceAngleUnit,
  deviceLengthUnits,
  javaDouble,
  LENGTH_CODE_UNITS,
  lengthLiteral
} from './codeUnits'
import { otosOffsetMetersDeg, pinpointComponentOffsetsMeters, robotFramePose } from './mounting'
import { GENERATED_MARKER } from '../../../shared/generatedFiles'
import { configXmlFilePath, constantName, GENERATED_JAVA_PACKAGE, javaString } from './naming'

const INDENT = '    '

// 예전 import 경로(시험)
export { javaDouble }

// 주석 안에 넣는 문자열이 주석을 닫거나 줄을 끊지 않게 한다. javac는 주석 안의 \u 이스케이프도
// 먼저 해석하므로(잘못된 \u는 컴파일 오류, \u000a는 줄바꿈) 역슬래시를 두 번 써서 이스케이프가 되지 않게 한다.
function commentText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\*\//g, '* /')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
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

// 생성 주석에 쓰는 단위 이름(OTOS)
const LENGTH_WORDS: Record<LengthCodeUnit, string> = {
  mm: 'millimeters',
  cm: 'centimeters',
  m: 'meters',
  in: 'inches'
}
const ANGLE_WORDS: Record<AngleCodeUnit, string> = { deg: 'degrees', rad: 'radians' }
const NAVIGATION = 'org.firstinspires.ftc.robotcore.external.navigation'

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

// entries는 로봇 전체 장치다(데드휠의 모터가 다른 그룹에 있어도 찾는다)
function generateComponent(
  objects: SceneObjects,
  entry: DeviceMember,
  entries: ComponentEntry[],
  units: CodeUnits
): Generated {
  const { component, objectId, field } = entry
  const type = component.type as ComponentType
  const def = componentDef(type)
  // 상수 이름은 검증(constantNameCollision)과 같은 규칙(naming.generatedConstantNames)으로 만든다
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
      const offsets = pinpointComponentOffsetsMeters(objects, objectId, props)
      const unit = deviceLengthUnits(type, units)[0]
      const { suffix, distanceUnit } = LENGTH_CODE_UNITS[unit]
      const x = `${constant}_X_OFFSET_${suffix}`
      const y = `${constant}_Y_OFFSET_${suffix}`
      constants.push(
        `/** ${commentText(component.name)}: X pod offset (left +) and Y pod offset (forward +) from the robot center, ${unit}. */`,
        `public static final double ${x} = ${lengthLiteral(offsets?.x ?? 0, unit)};`,
        `public static final double ${y} = ${lengthLiteral(offsets?.y ?? 0, unit)};`
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
        `${field}.setOffsets(${x}, ${y}, DistanceUnit.${distanceUnit});`,
        `${field}.setEncoderResolution(GoBildaPinpointDriver.GoBildaOdometryPods.${pods});`,
        `${field}.setEncoderDirections(GoBildaPinpointDriver.EncoderDirection.${direction(props.xDirection)}, ` +
          `GoBildaPinpointDriver.EncoderDirection.${direction(props.yDirection)});`,
        `${field}.resetPosAndIMU();`
      )
      break
    }
    case 'otos': {
      const offset = otosOffsetMetersDeg(objects, objectId, Number(props.mountingAngle)) ?? {
        x: 0,
        y: 0,
        h: 0
      }
      const unit = deviceLengthUnits(type, units)[0]
      const angle = deviceAngleUnit(type, units)
      const length = LENGTH_CODE_UNITS[unit]
      const angleInfo = ANGLE_CODE_UNITS[angle]
      const x = `${constant}_OFFSET_X_${length.suffix}`
      const y = `${constant}_OFFSET_Y_${length.suffix}`
      const h = `${constant}_OFFSET_H_${angleInfo.suffix}`
      constants.push(
        `/**`,
        ` * ${commentText(component.name)}: sensor pose on the robot in the convention of the SDK OTOS sample`,
        ...(unit === 'in' && angle === 'deg'
          ? [
              ` * (X right +, Y forward +, inches; heading CCW +, degrees). getPosition() then reports the robot center`,
              ` * in that convention. Road Runner / Pedro Pathing use X forward / Y left: set their own offsets instead.`
            ]
          : [
              ` * (X right +, Y forward +, ${LENGTH_WORDS[unit]}; heading CCW +, ${ANGLE_WORDS[angle]}). The driver and getPosition()`,
              ` * stay in inches and degrees. Road Runner / Pedro Pathing use X forward / Y left: set their own offsets instead.`
            ]),
        ` */`,
        `public static final double ${x} = ${lengthLiteral(offset.x, unit)};`,
        `public static final double ${y} = ${lengthLiteral(offset.y, unit)};`,
        `public static final double ${h} = ${angleLiteral(offset.h, angle)};`
      )
      init.push(get(def.javaType))
      // Pose2D는 드라이버의 지금 단위(기본 인치·도)다. 코드 단위가 다르면 넘길 때 바꾼다(setLinearUnit은 팀 코드의
      // getPosition 단위까지 바꾸므로 부르지 않는다).
      const converted = unit !== 'in' || angle !== 'deg'
      if (converted)
        init.push(
          "// Pose2D uses the driver's default units (inches, degrees): convert the constants."
        )
      // 전체 이름으로 쓴다(import하면 팀이 고른 그룹·로봇 클래스 이름 AngleUnit 등이 가릴 수 있다)
      const len = (name: string): string =>
        unit === 'in'
          ? name
          : `${NAVIGATION}.DistanceUnit.INCH.fromUnit(${NAVIGATION}.DistanceUnit.${length.distanceUnit}, ${name})`
      const ang =
        angle === 'deg'
          ? h
          : `${NAVIGATION}.AngleUnit.DEGREES.fromUnit(${NAVIGATION}.AngleUnit.${angleInfo.angleUnit}, ${h})`
      if (converted)
        init.push(
          `${field}.setOffset(new SparkFunOTOS.Pose2D(`,
          `${INDENT}${INDENT}${len(x)},`,
          `${INDENT}${INDENT}${len(y)},`,
          `${INDENT}${INDENT}${ang}));`
        )
      else init.push(`${field}.setOffset(new SparkFunOTOS.Pose2D(${x}, ${y}, ${h}));`)
      init.push(
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
        ...deviceLengthUnits(type, units).flatMap((unit) => {
          const { suffix } = LENGTH_CODE_UNITS[unit]
          return [
            `public static final double ${constant}_X_${suffix} = ${lengthLiteral(pose.x, unit)};`,
            `public static final double ${constant}_Y_${suffix} = ${lengthLiteral(pose.y, unit)};`
          ]
        }),
        `public static final boolean ${constant}_MEASURES_FORWARD = ${props.measures !== 'strafe'};`,
        `public static final boolean ${constant}_REVERSED = ${props.reversed === 'yes'};`
      )
      init.push(get(def.javaType, deadWheelDeviceName(entry, entries)))
      break
    }
    case 'webcam':
    case 'limelight':
      if (isInConfiguration(component)) {
        init.push(get(def.javaType))
      } else {
        // 시리얼이 없어 구성 XML에 넣지 않은 장치. get()은 장치가 없으면 예외를 던져 클래스 전체를 못 쓰게 하므로 null로 둔다.
        init.push(
          '// Not in the generated configuration until its serial number is set in SandBot: null until then.',
          `${field} = hardwareMap.tryGet(${def.javaType}.class, ${javaString(component.name)});`
        )
      }
      break
    default:
      // 설정할 속성이 없는 장치(거리·터치·아날로그·LED·Blinkin·HuskyLens·OctoQuad)
      init.push(get(def.javaType))
  }
  return { constants, init }
}

const indent = (line: string): string => (line ? `${INDENT}${line}` : '')

// 범위 하나의 클래스 본문(들여쓰기 전). 상수 → 필드(하이어라키 순서) → 생성자 → 중첩 클래스 묶음이고,
// 묶음 사이에 빈 줄을 하나씩 둔다. 그룹이 없는 로봇은 예전 출력과 바이트 단위로 같아야 한다(generatedOutput.test.ts).
function classBlocks(
  objects: SceneObjects,
  scopes: RobotCodeScopes,
  scope: CodeScope,
  units: CodeUnits
): string[][] {
  const constants: string[] = []
  const fields: string[] = []
  const init: string[] = []
  const nested: string[][] = []
  for (const member of scope.members) {
    if (init.length) init.push('')
    if (member.kind === 'device') {
      const generated = generateComponent(objects, member, scopes.entries, units)
      const def = componentDef(member.component.type as ComponentType)
      constants.push(...generated.constants)
      fields.push(`public final ${def.javaType} ${member.field};`)
      init.push(`// ${commentText(member.component.name)}`, ...generated.init)
    } else {
      const { className, name } = member.scope
      fields.push(`public final ${className} ${member.field};`)
      init.push(`// ${commentText(name)}`, `${member.field} = new ${className}(hardwareMap);`)
      nested.push(nestedClass(objects, scopes, member.scope, member.field, units))
    }
  }
  const constructor = [
    `/** Call during OpMode init (hardwareMap.get must only be used in the init phase). */`,
    `public ${scope.className}(HardwareMap hardwareMap) {`,
    ...init.map(indent),
    '}'
  ]
  return [constants, fields, constructor, ...nested].filter((block) => block.length > 0)
}

// 그룹의 중첩 클래스. 생성자가 public이라 그 메커니즘만 쓰는 OpMode에서 따로 만들 수 있다.
function nestedClass(
  objects: SceneObjects,
  scopes: RobotCodeScopes,
  scope: CodeScope,
  field: string,
  units: CodeUnits
): string[] {
  const typeName = scope.classPath.join('.')
  const enclosing = scope.classPath.slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('.'))
  // 둘 다 만들면 생성자의 초기화(엔코더 초기화, IMU initialize 등)가 두 번 일어난다
  const once =
    enclosing.length === 1
      ? `Construct either ${enclosing[0]} or this group, not both: each one initializes this hardware.`
      : `Construct only one of ${enclosing.join(', ')} or this group: each one initializes this hardware.`
  return [
    '/**',
    ` * Group "${commentText(scope.name)}" in SandBot (robot.${scope.fieldPath.join('.')}). To use only this group in an OpMode:`,
    ` *   ${typeName} ${field} = new ${typeName}(hardwareMap);`,
    ` * ${once}`,
    ' */',
    `public static final class ${scope.className} {`,
    ...classBlocks(objects, scopes, scope, units).flatMap((block, i) => [
      ...(i > 0 ? [''] : []),
      ...block.map(indent)
    ]),
    '}'
  ]
}

// 로봇 하나의 하드웨어 클래스(Java 소스). 검증 오류가 없는 상태에서 부른다.
export function generateHardwareJava(
  objects: SceneObjects,
  robotId: string,
  units: CodeUnits
): string {
  const settings = robotHardwareSettings(objects, robotId)
  const scopes = buildCodeScopes(objects, robotId, units)
  const robotName = objects[robotId]?.name ?? ''

  const imports = new Set(['com.qualcomm.robotcore.hardware.HardwareMap'])
  for (const { component } of scopes.entries) {
    for (const name of componentDef(component.type as ComponentType).imports) imports.add(name)
  }

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
    ...classBlocks(objects, scopes, scopes.root, units).flatMap((block) => [
      '',
      ...block.map(indent)
    ]),
    '}',
    ''
  ]
  return lines.join('\n')
}
