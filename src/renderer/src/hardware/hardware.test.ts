import { describe, expect, it } from 'vitest'
import {
  GENERATED_MARKER,
  generatedState,
  isAllowedGeneratedPath
} from '../../../shared/generatedFiles'
import { ALIGNMENT_PRESETS, cadRootTransform } from '../cad/alignment'
import type { HardwareComponent, SceneObjects } from '../scene/model'
import { propertyDefaults, type ComponentType } from './catalog'
import { createComponent, uniqueName } from './components'
import { generateConfigXml } from './configXml'
import { generateTeamCodeFiles } from './generate'
import { generateHardwareJava, javaDouble } from './javaCodegen'
import {
  isValidHubOrientation,
  normalizeDegrees,
  otosOffsetInchDeg,
  pinpointOffsetsMm
} from './mounting'
import {
  configXmlFilePath,
  constantName,
  generatedConstantNames,
  javaFilePath,
  javaIdentifier,
  javaString,
  sidecarDeviceName
} from './naming'
import { uniqueIssues, validateScene, type IssueCode } from './validation'

const DEG = Math.PI / 180
const INCH = 0.0254

function component(
  id: string,
  type: ComponentType,
  name: string,
  port: number,
  props: Record<string, string | number> = {},
  hub: HardwareComponent['hub'] = 'controlHub'
): HardwareComponent {
  return { id, type, name, hub, port, props: { ...propertyDefaults(type), ...props } }
}

// 필드 원점에 앞(+X)을 보고 있는 로봇. 파트들은 로봇 바로 아래에 있다.
function scene(
  parts: Record<string, { position: [number, number, number]; components?: HardwareComponent[] }>
): SceneObjects {
  const objects: SceneObjects = {
    robot: {
      id: 'robot',
      name: 'Test Bot',
      kind: 'robot',
      parentId: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
    }
  }
  for (const [id, part] of Object.entries(parts)) {
    objects[id] = {
      id,
      name: id,
      kind: 'part',
      parentId: 'robot',
      transform: { position: part.position, rotation: [0, 0, 0] },
      components: part.components
    }
  }
  return objects
}

function codes(objects: SceneObjects): IssueCode[] {
  return validateScene(objects).map((i) => i.code)
}

describe('이름 규칙', () => {
  it('구성 이름을 Java 식별자와 상수 이름으로 바꾼다', () => {
    expect(javaIdentifier('front_left')).toBe('frontLeft')
    expect(javaIdentifier('Webcam 1')).toBe('webcam1')
    expect(javaIdentifier('2m sensor')).toBe('_2mSensor')
    expect(javaIdentifier('class')).toBe('class_')
    expect(constantName('frontLeft')).toBe('FRONT_LEFT')
  })

  it('Java 문자열은 따옴표와 역슬래시를 이스케이프한다', () => {
    expect(javaString('a"b\\c')).toBe('"a\\"b\\\\c"')
  })

  it('사이드카 장치 이름은 Java String.trim처럼 앞뒤의 U+0020 이하 글자만 뺀다', () => {
    expect(sidecarDeviceName(' \t\r\n\u0000leftFront \u001f')).toBe('leftFront')
    expect(sidecarDeviceName('left Front')).toBe('left Front')
    // JS trim()은 빼지만 Java trim은 남기는 공백(NBSP, 전각 공백, BOM, U+2003)
    expect(sidecarDeviceName('\u00a0leftFront\u3000')).toBe('\u00a0leftFront\u3000')
    expect(sidecarDeviceName('\ufeffimu\u2003 ')).toBe('\ufeffimu\u2003')
    expect(sidecarDeviceName(' \t ')).toBe('')
    expect(sidecarDeviceName('')).toBe('')
  })

  it('생성 파일 경로는 정해진 패키지와 res/xml만 허용한다', () => {
    expect(javaFilePath('RobotHardware')).toBe(
      'src/main/java/org/firstinspires/ftc/teamcode/sandbot/RobotHardware.java'
    )
    expect(configXmlFilePath('RobotHardware')).toBe('src/main/res/xml/sandbot_robot_hardware.xml')
    expect(isAllowedGeneratedPath(javaFilePath('RobotHardware'))).toBe(true)
    expect(isAllowedGeneratedPath(configXmlFilePath('MyBot2'))).toBe(true)
    expect(
      isAllowedGeneratedPath('src/main/java/org/firstinspires/ftc/teamcode/MyOpMode.java')
    ).toBe(false)
    expect(isAllowedGeneratedPath('src/main/res/xml/../../AndroidManifest.xml')).toBe(false)
    expect(isAllowedGeneratedPath('src/main/res/xml/teamwebcamcalibrations.xml')).toBe(false)
  })

  it('같은 이름이 있으면 번호를 붙인다', () => {
    expect(uniqueName('motor', ['motor', 'motor2'])).toBe('motor3')
    expect(uniqueName('Webcam 1', ['Webcam 1'])).toBe('Webcam 1_2')
  })

  it('Java double 리터럴', () => {
    expect(javaDouble(12, 2)).toBe('12.0')
    expect(javaDouble(-0.0001, 2)).toBe('0.0')
    expect(javaDouble(1.23456, 3)).toBe('1.235')
  })
})

describe('새 컴포넌트', () => {
  it('같은 종류가 쓰지 않은 가장 낮은 포트와 겹치지 않는 이름을 고른다', () => {
    let next = 0
    const id = (): string => `c${next++}`
    const first = createComponent('motor', [], id)
    const second = createComponent('motor', [first], id)
    expect([first.port, second.port]).toEqual([0, 1])
    expect([first.name, second.name]).toEqual(['motor', 'motor2'])
    // 서보는 모터와 다른 포트 종류라 0번부터
    expect(createComponent('servo', [first, second], id).port).toBe(0)
    expect(createComponent('imu', [], id)).toMatchObject({ port: 0, name: 'imu' })
  })
})

describe('장착 위치 계산', () => {
  it('Pinpoint: X 포드는 왼쪽 +, Y 포드는 앞 + (mm)', () => {
    const objects = scene({
      xPod: { position: [0.05, 0.12, 0] },
      yPod: { position: [-0.08, -0.02, 0] }
    })
    const offsets = pinpointOffsetsMm(objects, 'xPod', 'yPod')!
    expect(offsets.x).toBeCloseTo(120, 6)
    expect(offsets.y).toBeCloseTo(-80, 6)
  })

  it('OTOS: SDK 샘플 예(왼쪽 5 in, 앞 10 in, 시계 방향 90°) → {-5, 10, -90}', () => {
    const objects = scene({ otos: { position: [10 * INCH, 5 * INCH, 0] } })
    const offset = otosOffsetInchDeg(objects, 'otos', -90)!
    expect(offset.x).toBeCloseTo(-5, 9)
    expect(offset.y).toBeCloseTo(10, 9)
    expect(offset.h).toBeCloseTo(-90, 9)
  })

  it('로봇이 필드에서 움직여도 로봇 기준 값은 같다', () => {
    const objects = scene({ otos: { position: [10 * INCH, 5 * INCH, 0] } })
    objects.robot.transform = { position: [1, -1, 0], rotation: [0, 0, 70 * DEG] }
    expect(otosOffsetInchDeg(objects, 'otos', 0)!.x).toBeCloseTo(-5, 9)
  })

  it('각도 정규화와 허브 방향 유효성', () => {
    expect(normalizeDegrees(270)).toBe(-90)
    expect(normalizeDegrees(-190)).toBe(170)
    expect(isValidHubOrientation('up', 'forward')).toBe(true)
    expect(isValidHubOrientation('up', 'down')).toBe(false)
    expect(isValidHubOrientation('left', 'left')).toBe(false)
  })
})

describe('검증', () => {
  it('문제가 없으면 이슈가 없다', () => {
    const objects = scene({
      fl: { position: [0, 0, 0], components: [component('a', 'motor', 'frontLeft', 0)] },
      hub: { position: [0, 0, 0], components: [component('b', 'imu', 'imu', 0)] }
    })
    expect(codes(objects)).toEqual([])
  })

  it('이름 중복·포트 충돌·포트 범위', () => {
    const objects = scene({
      a: { position: [0, 0, 0], components: [component('a', 'motor', 'arm', 2)] },
      b: {
        position: [0, 0, 0],
        components: [component('b', 'motor', 'arm', 2), component('c', 'servo', 'claw', 9)]
      }
    })
    const found = codes(objects)
    expect(found.filter((c) => c === 'duplicateName')).toHaveLength(2)
    expect(found.filter((c) => c === 'portConflict')).toHaveLength(2)
    expect(found).toContain('portOutOfRange')
  })

  it('같은 포트라도 허브가 다르거나 포트 종류가 다르면 충돌이 아니다', () => {
    const objects = scene({
      a: {
        position: [0, 0, 0],
        components: [
          component('a', 'motor', 'left', 0),
          component('b', 'motor', 'right', 0, {}, 'expansionHub'),
          component('c', 'servo', 'claw', 0)
        ]
      }
    })
    objects.robot.hardware = {
      className: 'RobotHardware',
      configName: 'Bot',
      expansionHub: { enabled: true, address: 2 }
    }
    expect(codes(objects)).toEqual([])
  })

  it('Expansion Hub를 켜지 않고 쓰면 오류', () => {
    const objects = scene({
      a: {
        position: [0, 0, 0],
        components: [component('a', 'motor', 'left', 0, {}, 'expansionHub')]
      }
    })
    expect(codes(objects)).toContain('expansionHubDisabled')
  })

  it('데드휠과 같은 번호 모터가 엔코더를 쓰면 오류, 엔코더를 안 쓰면 허용', () => {
    const wheel = component('w', 'deadWheel', 'par', 0)
    const usingEncoder = scene({
      a: {
        position: [0, 0, 0],
        components: [component('m', 'motor', 'intake', 0, { runMode: 'usingEncoder' }), wheel]
      }
    })
    expect(codes(usingEncoder)).toContain('encoderMotorConflict')
    const withoutEncoder = scene({
      a: { position: [0, 0, 0], components: [component('m', 'motor', 'intake', 0), wheel] }
    })
    expect(codes(withoutEncoder)).toEqual([])
  })

  it('앞뒤를 재는 데드휠이 엔코더 포트 1·2에 있으면 경고', () => {
    const objects = scene({
      a: {
        position: [0, 0, 0],
        components: [
          component('w', 'deadWheel', 'par', 2),
          component('p', 'deadWheel', 'perp', 1, { measures: 'strafe' })
        ]
      }
    })
    expect(validateScene(objects).map((i) => [i.code, i.severity])).toEqual([
      ['deadWheelSlowPort', 'warning']
    ])
  })

  it('같은 I2C 버스에 같은 주소의 장치 둘이면 오류, 버스가 다르면 허용', () => {
    const same = scene({
      a: {
        position: [0, 0, 0],
        components: [component('a', 'colorSensor', 'c1', 1), component('b', 'colorSensor', 'c2', 1)]
      }
    })
    expect(codes(same)).toContain('i2cAddressConflict')
    const different = scene({
      a: {
        position: [0, 0, 0],
        components: [component('a', 'colorSensor', 'c1', 1), component('b', 'colorSensor', 'c2', 2)]
      }
    })
    expect(codes(different)).toEqual([])
  })

  it('경고: 짝수 채널 터치 센서, 웹캠 시리얼 없음, Pinpoint 포드 미지정', () => {
    const objects = scene({
      a: {
        position: [0, 0, 0],
        components: [
          component('a', 'touchSensor', 'touch', 0),
          component('b', 'webcam', 'Webcam 1', 0),
          component('c', 'pinpoint', 'pinpoint', 1)
        ]
      }
    })
    const issues = validateScene(objects)
    expect(issues.map((i) => i.code).sort()).toEqual([
      'pinpointPodMissing',
      'serialMissing',
      'touchSensorEvenChannel'
    ])
    expect(issues.every((i) => i.severity === 'warning')).toBe(true)
  })

  it('IMU 방향이 불가능하면 오류, 클래스 이름이 잘못되면 오류', () => {
    const objects = scene({
      hub: {
        position: [0, 0, 0],
        components: [component('a', 'imu', 'imu', 0, { logoFacing: 'up', usbFacing: 'down' })]
      }
    })
    objects.robot.hardware = {
      className: '2Bad',
      configName: 'Bot',
      expansionHub: { enabled: false, address: 2 }
    }
    expect(codes(objects).sort()).toEqual(['imuOrientationInvalid', 'invalidClassName'])
  })

  it('이름은 달라도 같은 Java 필드가 되면 오류', () => {
    const objects = scene({
      a: {
        position: [0, 0, 0],
        components: [
          component('a', 'motor', 'front_left', 0),
          component('b', 'motor', 'front left', 1)
        ]
      }
    })
    expect(codes(objects)).toEqual(['fieldNameCollision', 'fieldNameCollision'])
  })

  it('로봇끼리 생성 파일이나 구성 이름이 겹치면 오류, 컴포넌트 없는 로봇은 검사하지 않는다', () => {
    const objects = scene({
      a: { position: [0, 0, 0], components: [component('a', 'motor', 'm', 0)] }
    })
    const second = (id: string, className: string, configName: string, withMotor = true): void => {
      objects[id] = {
        id,
        name: id,
        kind: 'robot',
        parentId: null,
        transform: { position: [1, 0, 0], rotation: [0, 0, 0] },
        components: withMotor ? [component(`${id}-m`, 'motor', 'm', 0)] : undefined,
        hardware: { className, configName, expansionHub: { enabled: false, address: 2 } }
      }
    }
    // 대소문자만 다른 클래스 이름(Windows·macOS에서 같은 파일)
    second('r2', 'Robothardware', 'Other')
    expect(codes(objects)).toEqual(['duplicateClassName', 'duplicateClassName'])

    delete objects.r2
    second('r3', 'Bot', 'Test Bot')
    expect(codes(objects)).toEqual(['duplicateConfigName', 'duplicateConfigName'])

    delete objects.r3
    second('r4', 'RobotHardware', '', false)
    expect(codes(objects)).toEqual([])
  })
})

describe('코드 생성', () => {
  const objects = scene({
    fl: {
      position: [0.15, 0.15, 0.05],
      components: [
        component('fl', 'motor', 'frontLeft', 0, { direction: 'reverse', runMode: 'usingEncoder' })
      ]
    },
    claw: {
      position: [0.2, 0, 0.3],
      components: [component('cl', 'servo', 'claw', 0, { scaleMin: 0.2, scaleMax: 0.8 })]
    },
    hub: {
      position: [0, 0, 0.05],
      components: [component('im', 'imu', 'imu', 0, { logoFacing: 'left', usbFacing: 'up' })]
    },
    color: {
      position: [0.2, 0, 0.05],
      components: [component('co', 'colorSensor', 'sample color', 1)]
    },
    par: {
      position: [0, 0.1, 0],
      components: [component('in', 'motor', 'intake', 1), component('pa', 'deadWheel', 'par', 1)]
    },
    perp: {
      position: [-0.05, 0, 0],
      components: [component('pe', 'deadWheel', 'perp', 3, { measures: 'strafe', reversed: 'yes' })]
    },
    cam: {
      position: [0.2, 0, 0.3],
      components: [component('wc', 'webcam', 'Webcam 1', 0, { serialNumber: 'ABC123' })]
    }
  })
  objects.robot.hardware = {
    className: 'MyBotHardware',
    configName: 'My Bot',
    expansionHub: { enabled: false, address: 2 }
  }

  it('하드웨어 클래스(Java)', () => {
    const java = generateHardwareJava(objects, 'robot')
    expect(java).toContain(`// ${GENERATED_MARKER}`)
    expect(java).toContain('package org.firstinspires.ftc.teamcode.sandbot;')
    expect(java).toContain('public class MyBotHardware {')
    expect(java).toContain('public static final String CONFIGURATION_NAME = "My Bot";')
    expect(java).toContain('public final DcMotorEx frontLeft;')
    expect(java).toContain('frontLeft = hardwareMap.get(DcMotorEx.class, "frontLeft");')
    expect(java).toContain('frontLeft.setDirection(DcMotorSimple.Direction.REVERSE);')
    expect(java).toContain('frontLeft.setMode(DcMotor.RunMode.RUN_USING_ENCODER);')
    expect(java).toContain('claw.scaleRange(0.2, 0.8);')
    expect(java).toContain('RevHubOrientationOnRobot.LogoFacingDirection.LEFT,')
    expect(java).toContain('RevHubOrientationOnRobot.UsbFacingDirection.UP)));')
    expect(java).toContain('public final NormalizedColorSensor sampleColor;')
    expect(java).toContain('sampleColor.setGain(2.0f);')
    // 데드휠: 1번 엔코더 포트는 같은 번호의 intake 모터 이름으로 읽는다
    expect(java).toContain('par = hardwareMap.get(DcMotorEx.class, "intake");')
    expect(java).toContain('public static final double PAR_Y_MM = 100.0;')
    expect(java).toContain('public static final boolean PERP_MEASURES_FORWARD = false;')
    expect(java).toContain('public static final boolean PERP_REVERSED = true;')
    expect(java).toContain('import com.qualcomm.robotcore.hardware.HardwareMap;')
    // 모든 final 필드는 생성자에서 한 번씩 대입된다
    const fields = [...java.matchAll(/public final \w+ (\w+);/g)].map((m) => m[1])
    for (const field of fields)
      expect(java.match(new RegExp(`^\\s+${field} = hardwareMap`, 'gm'))).toHaveLength(1)
  })

  it('로봇 구성 XML', () => {
    const xml = generateConfigXml(objects, 'robot')
    expect(xml).toContain(GENERATED_MARKER)
    expect(xml).toContain('<Robot type="FirstInspires-FTC" name="My Bot">')
    expect(xml).toContain(
      '<LynxUsbDevice name="Control Hub Portal" serialNumber="(embedded)" parentModuleAddress="173">'
    )
    expect(xml).toContain('<LynxModule name="Control Hub" port="173">')
    expect(xml).toContain('<goBILDA5202SeriesMotor name="frontLeft" port="0" />')
    // 데드휠만 있는 3번 엔코더 포트는 Motor 항목으로, 모터와 같이 쓰는 1번은 따로 넣지 않는다
    expect(xml).toContain('<goBILDA5202SeriesMotor name="intake" port="1" />')
    expect(xml).toContain('<Motor name="perp" port="3" />')
    expect(xml).not.toContain('name="par"')
    expect(xml).toContain('<Servo name="claw" port="0" />')
    expect(xml).toContain('<ControlHubImuBHI260AP name="imu" port="0" bus="0" />')
    expect(xml).toContain('<RevColorSensorV3 name="sample color" port="0" bus="1" />')
    expect(xml).toContain('<Webcam name="Webcam 1" serialNumber="ABC123" />')
    expect(xml).not.toContain('Expansion Hub')
  })

  it('Expansion Hub를 켜면 주소로 모듈을 추가한다', () => {
    const withHub = scene({
      a: {
        position: [0, 0, 0],
        components: [component('a', 'servo', 'wrist', 1, {}, 'expansionHub')]
      }
    })
    withHub.robot.hardware = {
      className: 'RobotHardware',
      configName: 'Bot',
      expansionHub: { enabled: true, address: 3 }
    }
    const xml = generateConfigXml(withHub, 'robot')
    expect(xml).toContain('<LynxModule name="Expansion Hub 3" port="3">')
    expect(xml).toMatch(/Expansion Hub 3" port="3">\n\s+<Servo name="wrist" port="1" \/>/)
  })

  it('오류가 있으면 파일을 만들지 않고, 없으면 로봇마다 Java와 XML 두 개', () => {
    expect(generateTeamCodeFiles(objects)).toMatchObject({ blocked: false })
    const { files } = generateTeamCodeFiles(objects)
    expect(files.map((f) => f.path)).toEqual([
      'src/main/java/org/firstinspires/ftc/teamcode/sandbot/MyBotHardware.java',
      'src/main/res/xml/sandbot_my_bot_hardware.xml'
    ])
    // 메인 프로세스가 도구가 쓴 그대로인지 확인할 수 있게 해시를 붙인다
    expect(files.map((f) => generatedState(f.content))).toEqual(['pristine', 'pristine'])
    const broken = scene({
      a: { position: [0, 0, 0], components: [component('a', 'motor', '', 0)] }
    })
    expect(generateTeamCodeFiles(broken)).toMatchObject({ blocked: true, files: [] })
  })
})

describe('리뷰에서 찾은 경우', () => {
  it('이름 규칙: 숫자로 시작하는 상수, 한글 이름, 생성 코드가 쓰는 이름', () => {
    expect(constantName(javaIdentifier('포드1'))).toBe('포드1')
    expect(constantName(javaIdentifier('1번 포드'))).toBe('_1번포드')
    expect(constantName(javaIdentifier('2wheel odo'))).toBe('_2WHEEL_ODO')
    expect(javaIdentifier('왼쪽 모터')).toBe('왼쪽모터')
    expect(javaIdentifier('!!!')).toBe('device')
    expect(javaIdentifier('hardware map')).toBe('hardwareMap_')
    expect(javaIdentifier('x²')).toBe('x')
    expect(generatedConstantNames('deadWheel', '1')).toContain('_1_X_MM')
  })

  it('Java 주석에 들어가는 이름의 역슬래시는 \\u 이스케이프가 되지 않는다', () => {
    const objects = scene({
      a: { position: [0, 0, 0], components: [component('a', 'motor', 'C:\\users', 0)] }
    })
    objects.robot.name = 'bot \\u000a evil'
    const java = generateHardwareJava(objects, 'robot')
    expect(java).toContain('// C:\\\\users')
    expect(java).toContain('"bot \\\\u000a evil"')
    expect(java).not.toMatch(/(^|[^\\])(\\\\)*\\u/)
  })

  it('시리얼 없는 웹캠은 XML에 없으므로 Java는 tryGet으로 null을 허용한다', () => {
    const objects = scene({
      cam: { position: [0, 0, 0], components: [component('w', 'webcam', 'Webcam 1', 0)] }
    })
    expect(codes(objects)).toEqual(['serialMissing'])
    const java = generateHardwareJava(objects, 'robot')
    expect(java).toContain('webcam1 = hardwareMap.tryGet(WebcamName.class, "Webcam 1");')
    expect(java).not.toContain('hardwareMap.get(WebcamName.class')
    expect(generateConfigXml(objects, 'robot')).not.toContain('<Webcam')
  })

  it('Limelight 주소는 시리얼(Control Hub 주소)의 마지막 자리를 1로 바꾼다', () => {
    const objects = scene({
      ll: {
        position: [0, 0, 0],
        components: [
          component('l', 'limelight', 'limelight', 0, {
            serialNumber: 'EthernetOverUsb:eth0:172.29.0.25'
          })
        ]
      }
    })
    expect(generateConfigXml(objects, 'robot')).toContain(
      '<EthernetDevice name="limelight" serialNumber="EthernetOverUsb:eth0:172.29.0.25" ipAddress="172.29.0.1" />'
    )
    expect(generateHardwareJava(objects, 'robot')).toContain(
      'limelight = hardwareMap.get(Limelight3A.class, "limelight");'
    )
  })

  it.each(Object.entries(ALIGNMENT_PRESETS))(
    'OTOS 방향은 CAD 정렬 회전과 관계없이 장착 각도다 (%s)',
    (_, alignment) => {
      const objects = scene({})
      objects.cad = {
        id: 'cad',
        name: 'cad',
        kind: 'assembly',
        parentId: 'robot',
        transform: cadRootTransform({ min: [-0.2, -0.2, -0.2], max: [0.2, 0.2, 0.2] }, alignment)
      }
      objects.sensor = {
        id: 'sensor',
        name: 'sensor',
        kind: 'part',
        parentId: 'cad',
        transform: { position: [0, 0, 0.1], rotation: [0, 0, 0] }
      }
      expect(otosOffsetInchDeg(objects, 'sensor', 0)!.h).toBeCloseTo(0, 9)
      expect(otosOffsetInchDeg(objects, 'sensor', -90)!.h).toBeCloseTo(-90, 9)
    }
  )

  it('서보 범위·Expansion Hub의 BHI260AP·상수 이름 충돌·import 타입과 같은 클래스 이름은 오류', () => {
    const objects = scene({
      a: {
        position: [0, 0, 0],
        components: [
          component('s', 'servo', 'claw', 0, { scaleMin: 0.8, scaleMax: 0.2 }),
          component('i', 'imu', 'imu', 0, {}, 'expansionHub'),
          component('p', 'deadWheel', 'leftPod', 0),
          component('q', 'deadWheel', 'leftPOD', 3)
        ]
      }
    })
    objects.robot.hardware = {
      className: 'Servo',
      configName: 'Bot',
      expansionHub: { enabled: true, address: 2 }
    }
    const found = codes(objects)
    expect(found).toContain('servoScaleInvalid')
    expect(found).toContain('imuChipHub')
    // 데드휠 둘은 상수 여섯 개가 겹치지만 장치마다 한 번만 알린다
    expect(found.filter((c) => c === 'constantNameCollision')).toHaveLength(2)
    expect(found).toContain('invalidClassName')
  })

  it('Expansion Hub 주소 11 이상은 경고, 구성 이름 중복은 대소문자를 무시한다', () => {
    const objects = scene({
      a: { position: [0, 0, 0], components: [component('a', 'motor', 'm', 0)] }
    })
    objects.robot.hardware = {
      className: 'RobotHardware',
      configName: 'Robot',
      expansionHub: { enabled: true, address: 42 }
    }
    expect(validateScene(objects).map((i) => [i.code, i.severity])).toEqual([
      ['expansionHubAddressReserved', 'warning']
    ])
    objects.r2 = {
      id: 'r2',
      name: 'r2',
      kind: 'robot',
      parentId: null,
      transform: { position: [1, 0, 0], rotation: [0, 0, 0] },
      components: [component('b', 'motor', 'm', 0)],
      hardware: {
        className: 'Other',
        configName: 'robot',
        expansionHub: { enabled: false, address: 2 }
      }
    }
    expect(codes(objects)).toContain('duplicateConfigName')
  })

  it('이름이 빈 컴포넌트 둘은 문제 목록에서 하나로 합치지 않는다', () => {
    const objects = scene({
      a: {
        position: [0, 0, 0],
        components: [component('a', 'motor', '', 0), component('b', 'motor', '', 1)]
      }
    })
    const issues = validateScene(objects).filter((i) => i.code === 'emptyName')
    expect(uniqueIssues(issues)).toHaveLength(2)
  })

  it('새 터치 센서는 동작하는 홀수 채널을 고른다', () => {
    const id = (): string => 't'
    const first = createComponent('touchSensor', [], id)
    expect(first.port).toBe(1)
    expect(createComponent('touchSensor', [first], id).port).toBe(3)
  })
})
