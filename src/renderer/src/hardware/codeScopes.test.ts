import { describe, expect, it } from 'vitest'
import type { HardwareComponent, SceneObject, SceneObjects } from '../scene/model'
import { propertyDefaults, type ComponentType } from './catalog'
import { buildCodeScopes, componentCodePath, groupCodePath } from './codeScopes'
import { generateConfigXml } from './configXml'
import { generateTeamCodeFiles } from './generate'
import { generateHardwareJava } from './javaCodegen'
import { groupFieldName, isValidGroupClassName, javaClassName } from './naming'
import { objectLevelIssues, severityByObject } from './sceneIssues'
import { uniqueIssues, validateScene, type Issue, type IssueCode } from './validation'

function component(
  id: string,
  type: ComponentType,
  name: string,
  port: number,
  props: Record<string, string | number> = {}
): HardwareComponent {
  return { id, type, name, hub: 'controlHub', port, props: { ...propertyDefaults(type), ...props } }
}

function object(
  id: string,
  kind: SceneObject['kind'],
  parentId: string,
  extra: Partial<SceneObject> = {}
): SceneObject {
  return {
    id,
    name: id,
    kind,
    parentId,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    ...extra
  }
}

// 오브젝트 목록을 순서대로 넣는다(키 순서 = 형제 순서)
function scene(...objects: SceneObject[]): SceneObjects {
  const result: SceneObjects = {
    robot: {
      id: 'robot',
      name: 'Test Bot',
      kind: 'robot',
      parentId: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      hardware: {
        className: 'MyBotHardware',
        configName: 'My Bot',
        expansionHub: { enabled: false, address: 2 }
      }
    }
  }
  for (const o of objects) result[o.id] = o
  return result
}

const group = (
  id: string,
  parentId: string,
  name: string,
  extra: Partial<SceneObject> = {}
): SceneObject => object(id, 'group', parentId, { name, ...extra })
const part = (id: string, parentId: string, ...components: HardwareComponent[]): SceneObject =>
  object(id, 'part', parentId, { components })

// 로봇: 드라이브 모터 → Lift(모터, Claw 그룹(그룹 자신의 서보), 옆 데드휠) → Intake(모터) → Odometry(데드휠) → 빈 그룹 → IMU
function mechanismScene(): SceneObjects {
  return scene(
    part('drive', 'robot', component('fl', 'motor', 'frontLeft', 0)),
    group('lift', 'robot', 'Lift'),
    part('liftMotor', 'lift', component('ll', 'motor', 'liftLeft', 1)),
    group('claw', 'lift', 'Claw', { components: [component('cs', 'servo', 'claw', 0)] }),
    object('perpPart', 'part', 'lift', {
      transform: { position: [-0.05, 0.1, 0], rotation: [0, 0, 0] },
      components: [component('pe', 'deadWheel', 'perp', 2, { measures: 'strafe' })]
    }),
    group('intake', 'robot', 'Intake'),
    part('intakeMotor', 'intake', component('in', 'motor', 'intake', 3)),
    group('odometry', 'robot', 'Odometry'),
    part('parPart', 'odometry', component('pa', 'deadWheel', 'par', 3)),
    group('empty', 'robot', '빈 그룹'),
    part('emptyPart', 'empty'),
    part('hub', 'robot', component('im', 'imu', 'imu', 0))
  )
}

function codes(objects: SceneObjects): IssueCode[] {
  return validateScene(objects).map((i) => i.code)
}

function issuesOf(objects: SceneObjects, code: IssueCode): Issue[] {
  return validateScene(objects).filter((i) => i.code === code)
}

describe('그룹 이름 규칙', () => {
  it('그룹 이름 → 클래스 이름', () => {
    expect(javaClassName('lift arm')).toBe('LiftArm')
    expect(javaClassName('Group (1)')).toBe('Group1')
    expect(javaClassName('LIFT')).toBe('LIFT')
    expect(javaClassName('front_lift')).toBe('FrontLift')
    expect(javaClassName('Lift$Claw')).toBe('LiftClaw')
    expect(javaClassName('리프트')).toBe('리프트')
    expect(isValidGroupClassName('LiftArm')).toBe(true)
    for (const name of ['리프트', '2ndStage', 'lift', 'Lift_Arm', 'Lift$Claw', ''])
      expect(isValidGroupClassName(name)).toBe(false)
  })

  it('클래스 이름 → 필드 이름(앞의 대문자 묶음을 소문자로)', () => {
    expect(groupFieldName('Lift')).toBe('lift')
    expect(groupFieldName('LIFT')).toBe('lift')
    expect(groupFieldName('IMU')).toBe('imu')
    expect(groupFieldName('IMU2')).toBe('imu2')
    expect(groupFieldName('LiftArm')).toBe('liftArm')
    expect(groupFieldName('HTTPServer')).toBe('httpServer')
    expect(groupFieldName('Do')).toBe('do_')
    expect(groupFieldName('HardwareMap')).toBe('hardwareMap_')
  })
})

describe('코드 범위', () => {
  it('하이어라키 순서로 장치와 그룹을 넣고, 장치가 없는 그룹은 뺀다', () => {
    const objects = mechanismScene()
    const { root, groups } = buildCodeScopes(objects, 'robot')
    expect(root.members.map((m) => m.field)).toEqual([
      'frontLeft',
      'lift',
      'intake',
      'odometry',
      'imu'
    ])
    const lift = groups.get('lift')!
    expect(lift.members.map((m) => m.field)).toEqual(['liftLeft', 'claw', 'perp'])
    // 그룹 자신의 컴포넌트는 그 그룹 범위에 속한다
    expect(groups.get('claw')!.members.map((m) => m.field)).toEqual(['claw'])
    expect(groups.has('empty')).toBe(false)
    // 문서마다 한 번 만든다
    expect(buildCodeScopes(objects, 'robot')).toBe(buildCodeScopes(objects, 'robot'))
  })

  it('필드 경로와 상수의 형식 경로', () => {
    const objects = mechanismScene()
    expect(componentCodePath(objects, 'claw', 'cs')).toEqual({
      fieldPath: ['lift', 'claw', 'claw'],
      typeName: 'MyBotHardware.Lift.Claw',
      constants: []
    })
    expect(componentCodePath(objects, 'perpPart', 'pe')).toMatchObject({
      fieldPath: ['lift', 'perp'],
      typeName: 'MyBotHardware.Lift',
      constants: expect.arrayContaining(['PERP_X_MM'])
    })
    expect(componentCodePath(objects, 'drive', 'fl')).toMatchObject({
      fieldPath: ['frontLeft'],
      typeName: 'MyBotHardware'
    })
    expect(groupCodePath(objects, 'claw')).toEqual({
      fieldPath: ['lift', 'claw'],
      typeName: 'MyBotHardware.Lift.Claw',
      constants: []
    })
    expect(groupCodePath(objects, 'empty')).toBeNull()
  })

  it('카탈로그에 없는 종류만 있는 그룹은 클래스를 만들지 않는다', () => {
    const objects = scene(
      part('m', 'robot', component('m', 'motor', 'm', 0)),
      group('g', 'robot', 'Future'),
      part('p', 'g', { ...component('x', 'motor', 'x', 1), type: 'futureDevice' })
    )
    expect(groupCodePath(objects, 'g')).toBeNull()
    expect(generateHardwareJava(objects, 'robot')).not.toContain('Future')
  })
})

describe('그룹 코드 생성', () => {
  const java = generateHardwareJava(mechanismScene(), 'robot')
  const lines = java.split('\n')

  it('필드는 계층 순서, 그룹은 생성자에서 중첩 클래스를 만든다', () => {
    expect(java).toContain(
      [
        '    public final DcMotorEx frontLeft;',
        '    public final Lift lift;',
        '    public final Intake intake;',
        '    public final Odometry odometry;',
        '    public final IMU imu;'
      ].join('\n')
    )
    expect(java).toContain(
      [
        '        // Lift',
        '        lift = new Lift(hardwareMap);',
        '',
        '        // Intake',
        '        intake = new Intake(hardwareMap);'
      ].join('\n')
    )
  })

  it('중첩 클래스: Javadoc, 상수, 필드, public 생성자, 그룹 안의 그룹', () => {
    expect(java).toContain(
      [
        '    /**',
        '     * Group "Lift" in SandBot (robot.lift). To use only this group in an OpMode:',
        '     *   MyBotHardware.Lift lift = new MyBotHardware.Lift(hardwareMap);',
        '     * Construct either MyBotHardware or this group, not both: each one initializes this hardware.',
        '     */',
        '    public static final class Lift {',
        '        /** perp: dead wheel measuring strafe (left/right) motion; position from the robot center (X forward +, Y left +). */',
        '        public static final double PERP_X_MM = -50.0;'
      ].join('\n')
    )
    expect(java).toContain(
      [
        '        public final DcMotorEx liftLeft;',
        '        public final Claw claw;',
        '        public final DcMotorEx perp;',
        '',
        '        /** Call during OpMode init (hardwareMap.get must only be used in the init phase). */',
        '        public Lift(HardwareMap hardwareMap) {',
        '            // liftLeft',
        '            liftLeft = hardwareMap.get(DcMotorEx.class, "liftLeft");'
      ].join('\n')
    )
    expect(java).toContain(
      [
        '            // Claw',
        '            claw = new Claw(hardwareMap);',
        '',
        '            // perp',
        '            perp = hardwareMap.get(DcMotorEx.class, "perp");',
        '        }',
        '',
        '        /**',
        '         * Group "Claw" in SandBot (robot.lift.claw). To use only this group in an OpMode:',
        '         *   MyBotHardware.Lift.Claw claw = new MyBotHardware.Lift.Claw(hardwareMap);',
        '         * Construct only one of MyBotHardware, MyBotHardware.Lift or this group: each one initializes this hardware.',
        '         */',
        '        public static final class Claw {',
        '            public final Servo claw;',
        '',
        '            /** Call during OpMode init (hardwareMap.get must only be used in the init phase). */',
        '            public Claw(HardwareMap hardwareMap) {',
        '                // claw',
        '                claw = hardwareMap.get(Servo.class, "claw");',
        '                claw.setDirection(Servo.Direction.FORWARD);',
        '            }',
        '        }',
        '    }',
        '',
        '    /**',
        '     * Group "Intake" in SandBot (robot.intake). To use only this group in an OpMode:'
      ].join('\n')
    )
    // 로봇 클래스에는 그룹 안의 상수가 없다
    const robotBody = lines.slice(0, lines.indexOf('    public static final class Lift {'))
    expect(robotBody.join('\n')).not.toContain('PERP_')
    expect(java.endsWith('    }\n}\n')).toBe(true)
  })

  it('데드휠과 같은 번호의 모터가 다른 그룹에 있어도 그 모터 이름으로 읽는다', () => {
    const objects = mechanismScene()
    expect(generateHardwareJava(objects, 'robot')).toContain(
      '            par = hardwareMap.get(DcMotorEx.class, "intake");'
    )
    const xml = generateConfigXml(objects, 'robot')
    expect(xml).toContain('name="intake" port="3"')
    expect(xml).not.toContain('name="par"')
  })

  it('장치가 없는 그룹은 아무것도 만들지 않는다', () => {
    const plain = scene(part('m', 'robot', component('m', 'motor', 'm', 0)))
    const withEmpty = scene(
      part('m', 'robot', component('m', 'motor', 'm', 0)),
      group('g', 'robot', 'Empty'),
      group('g2', 'g', 'Inner'),
      part('p', 'g2')
    )
    expect(generateTeamCodeFiles(withEmpty)).toEqual(generateTeamCodeFiles(plain))
  })

  it('검증 오류 없이 생성되고, 모든 final 필드는 자기 생성자에서 한 번 대입된다', () => {
    const objects = mechanismScene()
    expect(validateScene(objects).filter((i) => i.severity === 'error')).toEqual([])
    expect(generateTeamCodeFiles(objects).blocked).toBe(false)
    const fields = [...java.matchAll(/public final (\w+) (\w+);/g)].map((m) => m[2])
    for (const field of fields)
      expect(java.match(new RegExp(`^\\s+${field} = (hardwareMap|new )`, 'gm'))).not.toBeNull()
  })
})

describe('그룹 검증', () => {
  const motor = (id: string, name: string, port: number): SceneObject =>
    part(`${id}Part`, 'robot', component(id, 'motor', name, port))

  it('그룹 이름을 클래스로 쓸 수 없으면 오류, Java 클래스 이름을 정하면 통과', () => {
    const objects = scene(
      group('g', 'robot', '리프트'),
      part('p', 'g', component('m', 'motor', 'liftLeft', 0))
    )
    const issues = validateScene(objects)
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'invalidGroupName',
        severity: 'error',
        params: { name: '리프트', className: '리프트' },
        robotId: 'robot',
        objectId: 'g'
      })
    ])
    expect(issues[0].componentId).toBeUndefined()
    const named = { ...objects, g: { ...objects.g, codeClassName: 'Lift' } }
    expect(codes(named)).toEqual([])
    expect(generateHardwareJava(named, 'robot')).toContain(
      '     * Group "리프트" in SandBot (robot.lift).'
    )
  })

  it('$·_가 든 Java 클래스 이름과 숫자로 시작하는 이름은 오류', () => {
    for (const codeClassName of ['Lift$Claw', 'Lift_Arm', '2Lift', 'lift']) {
      const objects = scene(
        group('g', 'robot', 'Lift', { codeClassName }),
        part('p', 'g', component('m', 'motor', 'm', 0))
      )
      expect(codes(objects)).toEqual(['invalidGroupName'])
    }
  })

  it('생성 코드가 쓰는 타입 이름(String·Servo·HardwareMap)은 모든 깊이에서 오류', () => {
    for (const name of ['String', 'Servo', 'HardwareMap', 'DistanceUnit']) {
      const objects = scene(
        group('g', 'robot', name),
        part('p', 'g', component('m', 'motor', 'm', 0))
      )
      expect(issuesOf(objects, 'reservedGroupName')).toEqual([
        expect.objectContaining({ params: { name, className: name }, objectId: 'g' })
      ])
    }
    // Lift 안의 HardwareMap 그룹은 Lift 생성자의 매개변수 타입을 가린다
    const nested = scene(
      group('lift', 'robot', 'Lift'),
      group('g', 'lift', 'HardwareMap'),
      part('p', 'g', component('m', 'motor', 'm', 0))
    )
    expect(codes(nested)).toEqual(['reservedGroupName'])
  })

  it('감싸는 클래스와 같은 이름(그룹 안의 같은 그룹, 로봇 클래스)은 오류', () => {
    const groupInGroup = scene(
      group('outer', 'robot', 'Group'),
      group('inner', 'outer', 'Group'),
      part('p', 'inner', component('m', 'motor', 'm', 0))
    )
    expect(validateScene(groupInGroup)).toEqual([
      expect.objectContaining({
        code: 'duplicateGroupClass',
        params: { names: 'Group', className: 'Group' },
        objectId: 'inner'
      })
    ])
    // 세 단계: Lift.Claw.Lift
    const deep = scene(
      group('lift', 'robot', 'Lift'),
      group('claw', 'lift', 'Claw'),
      group('lift2', 'claw', 'Lift'),
      part('p', 'lift2', component('m', 'motor', 'm', 0))
    )
    expect(issuesOf(deep, 'duplicateGroupClass').map((i) => i.objectId)).toEqual(['lift2'])
    const robotClass = scene(
      group('g', 'robot', 'MyBotHardware'),
      part('p', 'g', component('m', 'motor', 'm', 0))
    )
    expect(codes(robotClass)).toEqual(['duplicateGroupClass'])
    // 깊이가 다른 같은 이름(MyBotHardware.Claw와 MyBotHardware.Lift.Claw)은 Java에서 허용된다
    const differentDepth = scene(
      group('claw', 'robot', 'Claw'),
      part('p', 'claw', component('a', 'servo', 'a', 0)),
      group('lift', 'robot', 'Lift'),
      group('claw2', 'lift', 'Claw'),
      part('q', 'claw2', component('b', 'servo', 'b', 1))
    )
    expect(codes(differentDepth)).toEqual([])
  })

  it('같은 클래스 안의 그룹은 대소문자만 달라도 오류이고, 문제 목록에서 한 번만 센다', () => {
    const objects = scene(
      group('a', 'robot', 'Lift'),
      part('p', 'a', component('m', 'motor', 'm', 0)),
      group('b', 'robot', 'LIFT'),
      part('q', 'b', component('n', 'motor', 'n', 1))
    )
    const issues = issuesOf(objects, 'duplicateGroupClass')
    expect(issues.map((i) => i.objectId)).toEqual(['a', 'b'])
    expect(issues[0].params).toEqual({ names: 'Lift, LIFT', className: 'Lift, LIFT' })
    expect(uniqueIssues(issues)).toHaveLength(1)
    // 둘 다 필드 lift가 되므로 필드 충돌도 함께 알린다(javac도 두 오류를 낸다)
    expect(issuesOf(objects, 'fieldNameCollision').map((i) => i.objectId)).toEqual(['a', 'b'])
  })

  it('그룹 필드와 장치 필드가 같으면 구성 이름이 같아도 오류(duplicateName이 잡지 않는다)', () => {
    const objects = scene(
      motor('m', 'lift', 0),
      group('g', 'robot', 'lift'),
      part('p', 'g', component('s', 'servo', 'claw', 0))
    )
    const issues = issuesOf(objects, 'fieldNameCollision')
    expect(issues.map((i) => [i.objectId, i.componentId])).toEqual([
      ['mPart', 'm'],
      ['g', undefined]
    ])
    expect(issues[0].params).toEqual({ names: 'lift, lift', field: 'lift' })
    expect(codes(objects)).toEqual(['fieldNameCollision', 'fieldNameCollision'])
  })

  it('다른 클래스의 같은 필드·상수 이름은 겹치지 않는다', () => {
    const objects = scene(
      part('a', 'robot', component('s', 'servo', 'claw', 0)),
      group('lift', 'robot', 'Lift'),
      group('claw', 'lift', 'Claw'),
      part('b', 'claw', component('d1', 'deadWheel', 'leftPod', 0)),
      group('odo', 'robot', 'Odometry'),
      part('c', 'odo', component('d2', 'deadWheel', 'leftPOD', 3))
    )
    expect(codes(objects)).toEqual([])
    // 같은 클래스 안에서는 상수가 겹친다(씬 문서는 불변이라 새 문서를 만든다)
    const moved = { ...objects, c: { ...objects.c, parentId: 'claw' } }
    expect(codes(moved)).toEqual(['constantNameCollision', 'constantNameCollision'])
  })

  it('구성 이름 중복과 포트 충돌은 범위와 관계없이 로봇 전체로 본다', () => {
    const objects = scene(
      motor('m', 'liftLeft', 0),
      group('g', 'robot', 'Lift'),
      part('p', 'g', component('n', 'motor', 'liftLeft', 0))
    )
    expect(codes(objects)).toEqual([
      'duplicateName',
      'duplicateName',
      'portConflict',
      'portConflict'
    ])
  })

  it('장치가 없는 그룹은 검사하지 않는다', () => {
    const objects = scene(motor('m', 'm', 0), group('g', 'robot', '빈 그룹'), group('h', 'g', 'Do'))
    expect(codes(objects)).toEqual([])
  })

  it('로봇 클래스 이름이 String이면 오류', () => {
    const objects = scene(motor('m', 'm', 0))
    const hardware = { ...objects.robot.hardware!, className: 'String' }
    expect(codes({ ...objects, robot: { ...objects.robot, hardware } })).toEqual([
      'invalidClassName'
    ])
  })

  it('로봇 클래스 이름의 $는 오류(다른 로봇의 중첩 클래스 Bot$Lift와 겹칠 수 있다)', () => {
    const objects = scene(motor('m', 'm', 0))
    const hardware = { ...objects.robot.hardware!, className: 'Bot$Lift' }
    expect(codes({ ...objects, robot: { ...objects.robot, hardware } })).toEqual([
      'invalidClassName'
    ])
  })

  it('그룹 이슈는 로봇 목록·차단 수·하이어라키 표시에 들어간다', () => {
    const objects = scene(
      group('outer', 'robot', 'Mechanisms'),
      group('g', 'outer', 'String'),
      part('p', 'g', component('m', 'motor', 'm', 0))
    )
    const issues = validateScene(objects)
    expect(issues.every((i) => i.robotId === 'robot')).toBe(true)
    expect(generateTeamCodeFiles(objects)).toMatchObject({ blocked: true, files: [] })
    expect(objectLevelIssues(issues, 'g').map((i) => i.code)).toEqual(['reservedGroupName'])
    const severities = severityByObject(objects, issues)
    expect(severities.get('g')).toEqual({ severity: 'error', own: true })
    expect(severities.get('outer')).toEqual({ severity: 'error', own: false })
    expect(severities.get('p')).toBeUndefined()
  })
})
