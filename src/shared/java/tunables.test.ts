import { describe, expect, it } from 'vitest'
import { parseTunables } from './tunables'
import type { TunableFile, TunableNode } from './tunableTypes'

const CONFIG = 'import com.acmerobotics.dashboard.config.Config;\n'
const DISABLED = 'import com.qualcomm.robotcore.eventloop.opmode.Disabled;\n'

// 묶음과 필드를 평평하게(자식 포함)
function nodes(file: TunableFile): TunableNode[] {
  const out: TunableNode[] = []
  const visit = (node: TunableNode): void => {
    out.push(node)
    if (node.kind === 'object') node.children.forEach(visit)
  }
  file.blocks.forEach((block) => block.fields.forEach(visit))
  return out
}

function ids(text: string): string[] {
  return nodes(parseTunables(text)).map((node) => node.id)
}

function node(text: string, id: string): TunableNode {
  const found = nodes(parseTunables(text)).find((item) => item.id === id)
  if (!found) throw new Error(`no node ${id}`)
  return found
}

// 값 노드만(형식 검사용)
function value(text: string, id: string): Extract<TunableNode, { kind: 'value' }> {
  const found = node(text, id)
  if (found.kind !== 'value') throw new Error(`${id} is ${found.kind}`)
  return found
}

// 노드마다 [id, 값이면 고칠 수 있는지·아니면 종류, 이유](자식 포함, 평평하게)
function states(text: string): [string, boolean | string, string | null][] {
  return nodes(parseTunables(text)).map((item) => [
    item.id,
    item.kind === 'value' ? item.editable : item.kind,
    item.reason ?? null
  ])
}

// road-runner-quickstart(1.0) MecanumDrive.java 54-94행에서 줄인 것
const MECANUM_DRIVE = `package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.config.Config;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;

@Config
public final class MecanumDrive {
    public static class Params {
        // IMU orientation
        // TODO: fill in these values based on
        //   see https://ftc-docs.firstinspires.org/en/latest/programming_resources/imu/imu.html?highlight=imu#physical-hub-mounting
        public RevHubOrientationOnRobot.LogoFacingDirection logoFacingDirection =
                RevHubOrientationOnRobot.LogoFacingDirection.UP;
        public RevHubOrientationOnRobot.UsbFacingDirection usbFacingDirection =
                RevHubOrientationOnRobot.UsbFacingDirection.FORWARD;

        // drive model parameters
        public double inPerTick = 1;
        public double lateralInPerTick = inPerTick;
        public double trackWidthTicks = 0;

        // feedforward parameters (in tick units)
        public double kS = 0;
        public double kV = 0;
        public double kA = 0;

        // path profile parameters (in inches)
        public double maxWheelVel = 50;
        public double minProfileAccel = -30;
        public double maxProfileAccel = 50;

        // turn profile parameters (in radians)
        public double maxAngVel = Math.PI; // shared with path
        public double maxAngAccel = Math.PI;

        // path controller gains
        public double axialGain = 0.0;
        public double lateralGain = 0.0;
        public double headingGain = 0.0; // shared with turn

        public double axialVelGain = 0.0;
        public double lateralVelGain = 0.0;
        public double headingVelGain = 0.0; // shared with turn
    }

    public static Params PARAMS = new Params();

    public final MecanumKinematics kinematics = new MecanumKinematics(
            PARAMS.inPerTick * PARAMS.trackWidthTicks, PARAMS.inPerTick / PARAMS.lateralInPerTick);

    public MecanumDrive(HardwareMap hardwareMap, Pose2d pose) {
        this.pose = pose;
    }
}
`

describe('parseTunables', () => {
  describe('Road Runner 1.0 MecanumDrive', () => {
    const file = parseTunables(MECANUM_DRIVE)

    it('@Config 클래스 하나, PARAMS 객체 아래에 Params의 인스턴스 필드', () => {
      expect(file.unicodeEscapes).toBe(false)
      expect(file.staticFieldsWithoutConfig).toBe(false)
      expect(file.blocks.map((block) => [block.classPath, block.name, block.line])).toEqual([
        ['MecanumDrive', 'MecanumDrive', 7]
      ])
      const [params] = file.blocks[0].fields
      expect(params).toMatchObject({
        kind: 'object',
        id: 'MecanumDrive#PARAMS',
        name: 'PARAMS',
        typeName: 'Params',
        text: 'new Params()'
      })
      expect(file.blocks[0].fields).toHaveLength(1)
      if (params.kind !== 'object') throw new Error()
      expect(params.reason).toBeUndefined()
      expect(params.children.map((child) => child.name)).toEqual([
        'logoFacingDirection',
        'usbFacingDirection',
        'inPerTick',
        'lateralInPerTick',
        'trackWidthTicks',
        'kS',
        'kV',
        'kA',
        'maxWheelVel',
        'minProfileAccel',
        'maxProfileAccel',
        'maxAngVel',
        'maxAngAccel',
        'axialGain',
        'lateralGain',
        'headingGain',
        'axialVelGain',
        'lateralVelGain',
        'headingVelGain'
      ])
    })

    it('kS는 고칠 수 있고 id는 선언 위치(MecanumDrive.Params#kS)다', () => {
      const kS = value(MECANUM_DRIVE, 'MecanumDrive.Params#kS')
      expect(kS).toMatchObject({
        type: 'double',
        boxed: false,
        literal: '0',
        editable: true,
        line: 23
      })
      expect(kS.reason).toBeUndefined()
      expect(MECANUM_DRIVE.slice(kS.span?.start, kS.span?.end)).toBe('0')
      const min = value(MECANUM_DRIVE, 'MecanumDrive.Params#minProfileAccel')
      expect(min).toMatchObject({ literal: '-30', editable: true })
      expect(MECANUM_DRIVE.slice(min.span?.start, min.span?.end)).toBe('-30')
    })

    it('lateralInPerTick·maxAngVel은 식, logoFacingDirection은 enum이라 읽기 전용', () => {
      expect(value(MECANUM_DRIVE, 'MecanumDrive.Params#lateralInPerTick')).toMatchObject({
        editable: false,
        reason: 'expression',
        literal: 'inPerTick'
      })
      expect(value(MECANUM_DRIVE, 'MecanumDrive.Params#maxAngVel')).toMatchObject({
        editable: false,
        reason: 'expression',
        literal: 'Math.PI'
      })
      expect(node(MECANUM_DRIVE, 'MecanumDrive.Params#logoFacingDirection')).toMatchObject({
        kind: 'other',
        reason: 'enum',
        typeText: 'RevHubOrientationOnRobot.LogoFacingDirection',
        text: 'RevHubOrientationOnRobot.LogoFacingDirection.UP',
        line: 12
      })
    })

    it('final 인스턴스 필드(kinematics)와 생성자는 묶음에 없다', () => {
      expect(ids(MECANUM_DRIVE)).not.toContain('MecanumDrive#kinematics')
    })
  })

  describe('@Config 찾기', () => {
    const body = 'class Lift { public static double kP = 0.5; }'

    it('단일 import, 패키지 import, 정규 이름', () => {
      expect(ids(`${CONFIG}@Config public ${body}`)).toEqual(['Lift#kP'])
      expect(ids(`import com.acmerobotics.dashboard.config.*;\n@Config public ${body}`)).toEqual([
        'Lift#kP'
      ])
      expect(ids(`@com.acmerobotics.dashboard.config.Config public ${body}`)).toEqual(['Lift#kP'])
    })

    it('import가 없거나 다른 Config면 묶음이 아니다(@Config 없는 static 필드로 알린다)', () => {
      for (const text of [
        `@Config public ${body}`,
        `import org.other.Config;\n@Config public ${body}`,
        `import org.other.*;\n@Config public ${body}`,
        `import static com.acmerobotics.dashboard.config.Config;\n@Config public ${body}`,
        `public ${body}`
      ]) {
        const file = parseTunables(text)
        expect(file.blocks, text).toEqual([])
        expect(file.staticFieldsWithoutConfig, text).toBe(true)
      }
    })

    it('이 파일의 형식이 Config 이름을 가리면 그 형식이다', () => {
      const shadowed = `import com.acmerobotics.dashboard.config.*;
@interface Config {}
@Config public ${body}`
      expect(parseTunables(shadowed).blocks).toEqual([])
      // 자신의 중첩 형식은 자신의 어노테이션을 가리지 않는다
      const ownNested = `${CONFIG}@Config public class Lift {
  public static class Config {}
  public static double kP = 0.5;
}`
      expect(ids(ownNested)).toEqual(['Lift#kP'])
    })

    it('@Disabled 클래스는 빼고(import 방식 모두), 다른 Disabled는 무시한다', () => {
      expect(ids(`${CONFIG}${DISABLED}@Config @Disabled public ${body}`)).toEqual([])
      expect(
        ids(
          `${CONFIG}import com.qualcomm.robotcore.eventloop.opmode.*;\n@Disabled @Config public ${body}`
        )
      ).toEqual([])
      expect(
        ids(`${CONFIG}@com.qualcomm.robotcore.eventloop.opmode.Disabled @Config public ${body}`)
      ).toEqual([])
      expect(ids(`${CONFIG}import org.other.Disabled;\n@Config @Disabled public ${body}`)).toEqual([
        'Lift#kP'
      ])
      // @Disabled @Config는 @Config 없는 static 필드로 치지 않는다
      expect(
        parseTunables(`${CONFIG}${DISABLED}@Config @Disabled public ${body}`)
          .staticFieldsWithoutConfig
      ).toBe(false)
    })

    it('묶음 이름은 @Config 값, 비었거나 알 수 없으면 단순 이름', () => {
      const name = (annotation: string): string =>
        parseTunables(`${CONFIG}${annotation} public ${body}`).blocks[0].name
      expect(name('@Config("Lift PID")')).toBe('Lift PID')
      expect(name('@Config(value = "Named")')).toBe('Named')
      expect(name('@Config("")')).toBe('Lift')
      expect(name('@Config()')).toBe('Lift')
      expect(name('@Config(Names.LIFT)')).toBe('Lift')
      expect(name('@Config("caf\\u00e9")')).toBe('café')
    })

    it('중첩 @Config 클래스는 단순 이름의 따로 된 묶음이다', () => {
      const text = `${CONFIG}
@Config
public class Outer {
    public static int y = 2;

    @Config
    public static class Inner {
        public static double x = 1;
        @Config("Deep") static class Deeper { public static boolean on = true; }
    }

    public static class Plain {
        public static double hidden = 3;
    }
}`
      const file = parseTunables(text)
      expect(file.blocks.map((block) => [block.classPath, block.name, block.line])).toEqual([
        ['Outer', 'Outer', 4],
        ['Outer.Inner', 'Inner', 8],
        ['Outer.Inner.Deeper', 'Deep', 10]
      ])
      expect(nodes(file).map((item) => item.id)).toEqual([
        'Outer#y',
        'Outer.Inner#x',
        'Outer.Inner.Deeper#on'
      ])
      // @Config 없는 Plain의 static 필드
      expect(file.staticFieldsWithoutConfig).toBe(true)
    })
  })

  describe('필드 고르기', () => {
    it('public static이고 final이 아닌 것만(인스턴스·private·protected·패키지·final·인터페이스 상수 제외)', () => {
      const text = `${CONFIG}@Config public class A {
  public static final double CONST = 1;
  static double packagePrivate = 2;
  private static double secret = 3;
  protected static double prot = 4;
  public double instance = 5;
  final public static double finalToo = 6;
  static public double reordered = 7;
  @Deprecated public static double annotated = 8;
  public static volatile double vol = 9;
  public interface I { double X = 1; public static double Y = 2; }
}`
      expect(ids(text)).toEqual(['A#reordered', 'A#annotated', 'A#vol'])
    })

    it('기본형·박싱·String 형식', () => {
      const text = `${CONFIG}@Config public class A {
  public static boolean b = true;
  public static int i = 1;
  public static long l = 2L;
  public static float f = 1.5f;
  public static double d = 2.5;
  public static Boolean bb = false;
  public static Integer bi = 3;
  public static Long bl = 4L;
  public static Float bf = 2.5f;
  public static Double bd = 3.5;
  public static String s = "x";
  public static java.lang.Double qualified = 1.0;
}`
      const file = parseTunables(text)
      expect(
        nodes(file).map((item) =>
          item.kind === 'value' ? [item.name, item.type, item.boxed, item.editable] : item.kind
        )
      ).toEqual([
        ['b', 'boolean', false, true],
        ['i', 'int', false, true],
        ['l', 'long', false, true],
        ['f', 'float', false, true],
        ['d', 'double', false, true],
        ['bb', 'boolean', true, true],
        ['bi', 'int', true, true],
        ['bl', 'long', true, true],
        ['bf', 'float', true, true],
        ['bd', 'double', true, true],
        ['s', 'String', false, true],
        ['qualified', 'double', true, true]
      ])
    })

    it('short·byte·char·배열·제네릭은 지원하지 않는 형식이다', () => {
      const text = `${CONFIG}@Config public class A {
  public static short s = 1;
  public static byte b = 2;
  public static char c = 'c';
  public static Short bs = 1;
  public static Character bc = 'c';
  public static double[] arr = {1, 2};
  public static double old[] = {1, 2};
  public static java.util.List<Double> list = new java.util.ArrayList<>();
}`
      const all = nodes(parseTunables(text))
      expect(
        all.map((item) => [item.name, item.kind, 'reason' in item ? item.reason : null])
      ).toEqual([
        ['s', 'other', 'unsupportedType'],
        ['b', 'other', 'unsupportedType'],
        ['c', 'other', 'unsupportedType'],
        ['bs', 'other', 'unsupportedType'],
        ['bc', 'other', 'unsupportedType'],
        ['arr', 'other', 'unsupportedType'],
        ['old', 'other', 'unsupportedType'],
        ['list', 'other', 'unsupportedType']
      ])
      expect(all[5]).toMatchObject({ typeText: 'double[]', text: '{1, 2}' })
    })

    it('선언 하나의 여러 이름은 줄마다 따로다', () => {
      const text = `${CONFIG}@Config public class A {
  public static double a = 1, b, c = -3.5;
}`
      const file = parseTunables(text)
      expect(nodes(file).map((item) => item.id)).toEqual(['A#a', 'A#b', 'A#c'])
      expect(value(text, 'A#b')).toMatchObject({
        editable: false,
        reason: 'noInitializer',
        literal: null,
        span: null
      })
      const c = value(text, 'A#c')
      expect(text.slice(c.span?.start, c.span?.end)).toBe('-3.5')
      expect(c.editable).toBe(true)
    })

    it('메서드·초기화 블록·익명 클래스·지역 클래스 안의 필드는 보지 않는다', () => {
      const text = `${CONFIG}@Config public class A {
  public static Runnable r = new Runnable() {
    public static double hidden = 1;
    public void run() { double local = 2; }
  };
  static { double inStatic = 3; }
  { double inInstance = 4; }
  public void method() {
    class Local { public static double localClass = 5; }
    Object o = new Object() { public double anon = 6; };
  }
  public static double after = 7;
}`
      expect(ids(text)).toEqual(['A#r', 'A#after'])
      expect(value(text, 'A#after').editable).toBe(true)
    })

    it('주석·문자열 안의 글자는 무시한다', () => {
      const text = `${CONFIG}@Config public class A {
  // public static double fake1 = 1;
  /* public static double fake2 = 2; */
  public static String s = "public static double fake3 = 3;";
  /** @Config class Fake { public static double fake4 = 4; } */
  public static double real = 5;
}`
      expect(ids(text)).toEqual(['A#s', 'A#real'])
    })

    it('초기값의 형식 인자 안 쉼표는 이름을 나누지 않는다', () => {
      const text = `${CONFIG}@Config public class A {
  public static java.util.Map<String, Integer> m = new java.util.HashMap<String, Integer>();
  public static java.util.function.Supplier<Object> s = java.util.HashMap<String, Integer>::new;
  public static java.util.List<String> e = java.util.Collections.<String>emptyList();
  public static boolean x = 1 < 2, y = 3 > 2;
  public static double after = 1;
}`
      expect(ids(text)).toEqual(['A#m', 'A#s', 'A#e', 'A#x', 'A#y', 'A#after'])
      expect(value(text, 'A#x')).toMatchObject({ reason: 'expression', literal: '1 < 2' })
    })

    it('제네릭 메서드·생성자·어노테이션 형식·enum 본문·record를 지나간다', () => {
      const text = `${CONFIG}
@Config public class A {
  public <T extends Comparable<T>> T max(T a, T b) { return a; }
  public <T> A(T t) {}
  public @interface Marker { String value() default "x"; int[] ids() default {1, 2}; }
  public enum Mode { ON("on") { void f() {} }, OFF("off"); Mode(String s) {} public static double inEnum = 1; }
  record Point(int x, int y) { public static double inRecord = 2; }
  public static double after = 3;
}`
      expect(ids(text)).toEqual(['A#after'])
    })
  })

  describe('값', () => {
    const wrap = (field: string): string => `${CONFIG}@Config public class A {\n  ${field}\n}`

    it('부호 하나와 리터럴 하나만 고칠 수 있다', () => {
      const editable = [
        'public static double a = -1.5;',
        'public static double a = - 1.5;',
        'public static double a = +2;',
        'public static int a = 0x1F;',
        'public static long a = 1_000L;',
        'public static float a = 2;',
        'public static float a = 0x1p3f;',
        'public static String a = "";',
        'public static boolean a = false;'
      ]
      for (const field of editable) {
        expect(value(wrap(field), 'A#a').editable, field).toBe(true)
      }
      const span = value(wrap('public static double a = - 1.5;'), 'A#a')
      expect(span.literal).toBe('- 1.5')
    })

    it('식·null·텍스트 블록·문자열 안의 \\u는 이유와 함께 읽기 전용', () => {
      const cases: [string, string][] = [
        ['public static double a = 1 + 2;', 'expression'],
        ['public static double a = (1);', 'expression'],
        ['public static double a = -/*c*/1;', 'expression'],
        ['public static double a = -\n    1;', 'expression'],
        ['public static double a = --1;', 'expression'],
        ['public static double a = Math.PI;', 'expression'],
        ['public static int a = 1.5;', 'expression'],
        ['public static int a = 5L;', 'expression'],
        ['public static float a = 1.5;', 'expression'],
        ["public static int a = 'c';", 'expression'],
        ["public static String a = 'c';", 'expression'],
        ['public static boolean a = -true;', 'expression'],
        ['public static String a = "x" + 1;', 'expression'],
        ['public static Double a = null;', 'null'],
        ['public static String a = null;', 'null'],
        ['public static String a = """\n    text\n    """;', 'textBlock'],
        ['public static String a = "\\u00B0";', 'textBlock'],
        ['public static double a;', 'noInitializer']
      ]
      for (const [field, reason] of cases) {
        expect(value(wrap(field), 'A#a'), field).toMatchObject({ editable: false, reason })
      }
    })

    it('줄바꿈(CR·LF, 8진 이스케이프 포함)이 든 문자열은 읽기 전용이다(한 줄 입력칸이 지운다)', () => {
      for (const literal of ['"x=%.2f\\ny=%.2f"', '"a\\rb"', '"a\\r\\n"', '"a\\12b"', '"\\015"']) {
        expect(value(wrap(`public static String a = ${literal};`), 'A#a'), literal).toMatchObject({
          editable: false,
          reason: 'lineBreak',
          literal
        })
      }
      // 탭·이스케이프한 역슬래시 뒤의 n은 줄바꿈이 아니다
      for (const literal of ['"a\\tb"', '"a\\\\nb"', '"\\0"']) {
        expect(value(wrap(`public static String a = ${literal};`), 'A#a').editable, literal).toBe(
          true
        )
      }
    })

    it('줄바꿈 문자열보다 먼저 보는 이유(식, 파일의 \\u)는 그대로다', () => {
      expect(value(wrap('public static String a = "a\\n" + "b";'), 'A#a').reason).toBe('expression')
      const unsafe = `${CONFIG}@Config public class A {
  public static String a = "a\\nb";
  // \\u000a
}`
      expect(value(unsafe, 'A#a').reason).toBe('unicodeEscape')
    })

    it('텍스트 블록 뒤의 필드도 읽는다', () => {
      const text = wrap(
        'public static String t = """\n    a "b" c\n    """; public static int n = 3;'
      )
      expect(value(text, 'A#n')).toMatchObject({ editable: true, literal: '3' })
    })

    it('리터럴 밖의 \\u 이스케이프가 있으면 파일 전체가 읽기 전용이다', () => {
      const text = `${CONFIG}@Config public class A {
  public static double kP = 0.5;
  // \\u000a public static double kI = 1.25;
}`
      const file = parseTunables(text)
      expect(file.unicodeEscapes).toBe(true)
      expect(value(text, 'A#kP')).toMatchObject({ editable: false, reason: 'unicodeEscape' })
      // 문자열 안의 평범한 \\u는 그 필드만
      const inString = wrap('public static String deg = "\\u00B0"; public static double kP = 1;')
      expect(parseTunables(inString).unicodeEscapes).toBe(false)
      expect(value(inString, 'A#kP').editable).toBe(true)
      // 역슬래시가 이스케이프된 것은 \\u가 아니다
      const escaped = wrap(
        'public static String path = "C:\\\\users"; public static double kP = 1;'
      )
      expect(parseTunables(escaped).unicodeEscapes).toBe(false)
      expect(value(escaped, 'A#path').editable).toBe(true)
    })

    it('enum: 이 파일의 enum, 다른 파일 형식의 A.B 초기값', () => {
      const text = `${CONFIG}@Config public class A {
  public enum Mode { FAST, SLOW }
  public static Mode mode = Mode.FAST;
  public static Mode unset;
  public static Direction dir = Direction.FORWARD;
  public static DcMotorSimple.Direction qualified = DcMotorSimple.Direction.REVERSE;
}`
      expect(
        nodes(parseTunables(text)).map((item) => [
          item.id,
          item.kind,
          'reason' in item && item.reason
        ])
      ).toEqual([
        ['A#mode', 'other', 'enum'],
        ['A#unset', 'other', 'enum'],
        ['A#dir', 'other', 'enum'],
        ['A#qualified', 'other', 'enum']
      ])
    })
  })

  describe('객체 펼치기', () => {
    it('같은 파일의 new T()만 펼친다(인자·익명·다른 파일 형식은 펼치지 않고, 생성자·초기화 블록이 있으면 자식이 읽기 전용)', () => {
      const text = `${CONFIG}@Config public class A {
  public static class P { public double k = 1; }
  public static class WithCtor { public double k = 1; public WithCtor() { k = 2; } }
  public static class WithInit { public double k = 1; { k = 3; } }
  public static abstract class Abs { public double k = 1; }
  public static P ok = new P();
  public static P qualified = new A.P();
  public static P args = new P(1);
  public static P anon = new P() {};
  public static P none;
  public static P nul = null;
  public static WithCtor ctor = new WithCtor();
  public static WithInit init = new WithInit();
  public static PIDFCoefficients other = new PIDFCoefficients();
}`
      const fields = parseTunables(text).blocks[0].fields
      expect(
        fields.map((item) =>
          item.kind === 'object'
            ? [item.name, item.children.length, item.reason ?? null]
            : item.kind
        )
      ).toEqual([
        ['ok', 1, null],
        ['qualified', 1, null],
        ['args', 0, 'object'],
        ['anon', 0, 'object'],
        ['none', 0, 'noInitializer'],
        ['nul', 0, 'object'],
        ['ctor', 1, null],
        ['init', 1, null],
        ['other', 0, 'object']
      ])
      expect(value(text, 'A.WithCtor#k')).toMatchObject({
        editable: false,
        reason: 'initializedInType'
      })
      expect(value(text, 'A.WithInit#k')).toMatchObject({
        editable: false,
        reason: 'initializedInType'
      })
      expect(value(text, 'A.P#k').editable).toBe(true)
    })

    it('자식은 public 인스턴스 필드(final 포함, static·private 제외)이고 같은 형식은 자식 id를 나눠 쓴다', () => {
      const text = `${CONFIG}@Config public class A {
  public static class Gains {
    public double kP = 0.1;
    public final double kFinal = 0.2;
    public static double shared = 0.3;
    private double secret = 0.4;
    double pkg = 0.5;
  }
  public static Gains LIFT = new Gains();
  public static Gains ARM = new Gains();
}`
      const fields = parseTunables(text).blocks[0].fields
      const children = fields.map((item) =>
        item.kind === 'object' ? item.children.map((child) => child.id) : []
      )
      expect(children).toEqual([
        ['A.Gains#kP', 'A.Gains#kFinal'],
        ['A.Gains#kP', 'A.Gains#kFinal']
      ])
      expect(value(text, 'A.Gains#kFinal').editable).toBe(true)
      // Gains의 static 필드는 @Config 없는 static 필드다
      expect(parseTunables(text).staticFieldsWithoutConfig).toBe(true)
    })

    it('펼친 객체 안의 객체도 펼치고, 그 필드가 final이면 빈 묶음이다(Dashboard와 같음)', () => {
      const text = `${CONFIG}@Config public class A {
  public static class Inner { public double x = 1; }
  public static class Outer {
    public Inner inner = new Inner();
    public final Inner fixed = new Inner();
  }
  public static Outer O = new Outer();
}`
      const [outer] = parseTunables(text).blocks[0].fields
      if (outer.kind !== 'object') throw new Error()
      expect(
        outer.children.map((child) =>
          child.kind === 'object'
            ? [child.id, child.children.map((c) => c.id), child.reason ?? null]
            : child.id
        )
      ).toEqual([
        ['A.Outer#inner', ['A.Inner#x'], null],
        ['A.Outer#fixed', [], 'object']
      ])
    })

    it('같은 형식이 다시 나오면 멈추고, 깊이는 4단계까지다', () => {
      const cyclic = `${CONFIG}@Config public class A {
  public static class Node { public double v = 1; public Node next = new Node(); }
  public static Node N = new Node();
}`
      const [n] = parseTunables(cyclic).blocks[0].fields
      if (n.kind !== 'object') throw new Error()
      expect(
        n.children.map((child) => [child.id, child.kind, 'reason' in child ? child.reason : null])
      ).toEqual([
        ['A.Node#v', 'value', null],
        ['A.Node#next', 'object', 'object']
      ])

      const deep = `${CONFIG}@Config public class A {
  public static class L5 { public double v = 5; }
  public static class L4 { public L5 next = new L5(); }
  public static class L3 { public L4 next = new L4(); }
  public static class L2 { public L3 next = new L3(); }
  public static class L1 { public L2 next = new L2(); }
  public static L1 ROOT = new L1();
}`
      let current = parseTunables(deep).blocks[0].fields[0]
      const chain: string[] = []
      while (current.kind === 'object') {
        chain.push(`${current.id}:${current.children.length}`)
        if (current.children.length === 0) break
        current = current.children[0]
      }
      expect(chain).toEqual([
        'A#ROOT:1',
        'A.L1#next:1',
        'A.L2#next:1',
        'A.L3#next:1',
        'A.L4#next:0'
      ])
    })

    it('이름은 안쪽 범위부터 푼다(같은 이름의 중첩 형식)', () => {
      const text = `${CONFIG}
class Params { public double outside = 1; }
@Config public class A {
  public static class Params { public double inside = 2; }
  public static Params P = new Params();
}`
      expect(ids(text)).toEqual(['A#P', 'A.Params#inside'])
    })
  })

  describe('생성자·초기화 블록이 정하는 값(initializedInType)', () => {
    it('생성자가 있는 형식도 펼치고(Dashboard와 같음), 값 자식은 이유와 관계없이 모두 읽기 전용이다', () => {
      const text = `${CONFIG}@Config public class A {
  public enum Mode { ON, OFF }
  public static class Pid {
    public double kP = 1, kI;
    public double kD = kP * 2;
    public String label = "x";
    public Mode mode = Mode.ON;
    public Pid() { kI = 2; }
  }
  public static Pid pid = new Pid();
}`
      expect(states(text)).toEqual([
        ['A#pid', 'object', null],
        ['A.Pid#kP', false, 'initializedInType'],
        ['A.Pid#kI', false, 'initializedInType'],
        ['A.Pid#kD', false, 'initializedInType'],
        ['A.Pid#label', false, 'initializedInType'],
        ['A.Pid#mode', 'other', 'enum']
      ])
      // 원래 글자와 위치는 그대로 보인다
      const kP = value(text, 'A.Pid#kP')
      expect(text.slice(kP.span?.start, kP.span?.end)).toBe('1')
      expect(value(text, 'A.Pid#kI')).toMatchObject({ literal: null, span: null })
    })

    it('본문이 비거나 super();뿐인 생성자, new T()가 부르지 않는 생성자는 세지 않는다', () => {
      const trivial = [
        'public P() {}',
        'public P() { /* nothing */ }',
        'P() { super(); }',
        'public P() {} public P(double k) { this.k = k; }',
        'public P(double k, int n) { this.k = k * n; }'
      ]
      for (const ctor of trivial) {
        const text = `${CONFIG}@Config public class A {
  public static class P { public double k = 1; ${ctor} }
  public static P p = new P();
}`
        expect(states(text), ctor).toEqual([
          ['A#p', 'object', null],
          ['A.P#k', true, null]
        ])
      }
      const nonTrivial = [
        'public P() { k = 2; }',
        'public P() { super(); k = 2; }',
        'public P() { this(1); } public P(double k) { this.k = k; }',
        'public P(double... ks) { k = ks.length; }',
        'public P() throws Exception { init(); }',
        '{ k = 3; }'
      ]
      for (const member of nonTrivial) {
        const text = `${CONFIG}@Config public class A {
  public static class P { public double k = 1; ${member} }
  public static P p = new P();
}`
        expect(value(text, 'A.P#k').reason, member).toBe('initializedInType')
      }
    })

    it('같은 파일 상위 클래스의 생성자·초기화 블록은 그 클래스와 위의 필드만 정한다(하위 필드 초기값이 뒤에 돈다)', () => {
      // javac + Dashboard 0.6.0으로 확인: x = 2.0, z = 4.0(상위가 정함), y = 1.0, w = 1.0, v = 6.0(초기값 그대로)
      const text = `${CONFIG}@Config public class A {
  public static class Base { public double x = 1; public Base() { x = 2; } }
  public static class InitBase { public double z = 1; { z = 4; } }
  public static class P extends Base { public double y = 1; }
  public static class Q extends InitBase { public double w = 1; }
  public static class VBase { public VBase() { init(); } void init() {} }
  public static class V extends VBase { public double v = 6; @Override void init() { v = 7; } }
  public static P p = new P();
  public static Q q = new Q();
  public static V vv = new V();
}`
      expect(states(text)).toEqual([
        ['A#p', 'object', null],
        ['A.P#y', true, null],
        ['A.Base#x', false, 'initializedInType'],
        ['A#q', 'object', null],
        ['A.Q#w', true, null],
        ['A.InitBase#z', false, 'initializedInType'],
        ['A#vv', 'object', null],
        ['A.V#v', true, null]
      ])
      // 하위 클래스의 생성자는 상위 클래스 필드도 정할 수 있다
      const sub = `${CONFIG}@Config public class A {
  public static class Base { public double x = 1; }
  public static class P extends Base { public double y = 1; public P() { x = 2; } }
  public static P p = new P();
}`
      expect(states(sub)).toEqual([
        ['A#p', 'object', null],
        ['A.P#y', false, 'initializedInType'],
        ['A.Base#x', false, 'initializedInType']
      ])
    })

    it('공용 상위 클래스의 생성자가 같은 형식의 다른 객체를 읽기 전용으로 만들지 않는다', () => {
      // 리뷰의 Cascade.java(Dashboard: LIFT.name = "LiftParams", 나머지는 초기값 그대로)
      const text = `${CONFIG}@Config public class Cascade {
  public static class Pid { public double kP = 0.5; public double kD = 0.01; }
  public static class Mechanism { public String name = "m"; public Mechanism() { name = getClass().getSimpleName(); } }
  public static class LiftParams extends Mechanism { public Pid pid = new Pid(); public double maxHeight = 30; }
  public static LiftParams LIFT = new LiftParams();
  public static Pid TURRET_PID = new Pid();
}`
      expect(states(text)).toEqual([
        ['Cascade#LIFT', 'object', null],
        ['Cascade.LiftParams#pid', 'object', null],
        ['Cascade.Pid#kP', true, null],
        ['Cascade.Pid#kD', true, null],
        ['Cascade.LiftParams#maxHeight', true, null],
        ['Cascade.Mechanism#name', false, 'initializedInType'],
        ['Cascade#TURRET_PID', 'object', null],
        ['Cascade.Pid#kP', true, null],
        ['Cascade.Pid#kD', true, null]
      ])
    })

    it('그 안의 객체 자식도 같고, 같은 id는 다른 경로에서도 읽기 전용이다', () => {
      const shared = `public static class Inner { public double x = 1; }
  public static class Outer {
    public Inner inner = new Inner();
    public Inner unset;
    public Outer() { inner.x = 5; unset = new Inner(); }
  }`
      const text = `${CONFIG}@Config public class A {
  ${shared}
  public static Outer O = new Outer();
  public static Inner I = new Inner();
}`
      expect(states(text)).toEqual([
        ['A#O', 'object', null],
        ['A.Outer#inner', 'object', null],
        ['A.Inner#x', false, 'initializedInType'],
        ['A.Outer#unset', 'object', 'initializedInType'],
        // 생성자가 없는 Inner를 바로 쓴 경로도 같은 리터럴이라 읽기 전용
        ['A#I', 'object', null],
        ['A.Inner#x', false, 'initializedInType']
      ])
      // 생성자가 정하는 경로가 없으면 고칠 수 있다
      const alone = `${CONFIG}@Config public class A {
  ${shared}
  public static Inner I = new Inner();
}`
      expect(states(alone)).toEqual([
        ['A#I', 'object', null],
        ['A.Inner#x', true, null]
      ])
    })

    it('펼칠 수 없는 경우(인자·다른 파일 형식)는 그대로 object다', () => {
      const text = `${CONFIG}@Config public class A {
  public static class P { public double k = 1; public P() { k = 2; } public P(int n) {} }
  public static P args = new P(1);
  public static PIDFCoefficients other = new PIDFCoefficients();
}`
      expect(states(text)).toEqual([
        ['A#args', 'object', 'object'],
        ['A#other', 'object', 'object']
      ])
    })
  })

  describe('static 블록이 정하는 값(initializedInType)', () => {
    // Lift의 static 블록에 body를 넣는다
    const lift = (body: string, members = ''): string => `${CONFIG}@Config public class Lift {
  public static double kP = 1;
  public static int n = 0;
  public static double kI = 2;${members}
  static { ${body} }
}`
    const kP = (text: string): Extract<TunableNode, { kind: 'value' }> => value(text, 'Lift#kP')

    it('대입·복합 대입·증감(한정자 Lift.·Outer.Lift.·패키지, 괄호, 람다·익명 클래스 안)은 읽기 전용', () => {
      const assigning = [
        'kP = 2;',
        'kP += 0.5;',
        'kP -= 1;',
        'kP *= 2;',
        'kP /= 2;',
        'kP %= 2;',
        'kP++;',
        '++kP;',
        'kP--;',
        'n = (int) --kP;',
        '(kP) = 3;',
        '++(kP);',
        'Lift.kP = 2;',
        'org.firstinspires.ftc.teamcode.Lift.kP = 2;',
        'if (n > 0) kP = 1; else n = 1;',
        'Runnable r = () -> kP = 3; r.run();',
        'Runnable r = () -> { kP = 3; };',
        'new Thread() { public void run() { kP = 2; } }.start();',
        'make().kP = 2;',
        // 지역 변수의 범위는 따지지 않는다(애매하면 읽기 전용)
        'double kP = 2; kP = 3;'
      ]
      for (const body of assigning) {
        expect(kP(lift(body)), body).toMatchObject({
          editable: false,
          reason: 'initializedInType',
          literal: '1'
        })
        // 다른 필드는 그대로
        expect(value(lift(body), 'Lift#kI').editable, body).toBe(true)
      }
      for (const body of ['n <<= 1;', 'n >>= 1;', 'n >>>= 1;', 'n &= 1;', 'n |= 1;', 'n ^= 1;']) {
        expect(value(lift(body), 'Lift#n').reason, body).toBe('initializedInType')
      }
    })

    it('중첩 형식의 이름으로 한정한 것(Outer.Lift.kP)도 센다', () => {
      const text = `${CONFIG}public class Outer {
  @Config public static class Lift {
    public static double kP = 1;
    static { Outer.Lift.kP = 2; }
  }
}`
      expect(value(text, 'Outer.Lift#kP').reason).toBe('initializedInType')
    })

    it('읽기·같은 이름의 지역 변수 선언·다른 이름으로 한정한 것은 세지 않는다', () => {
      const untouched = [
        'double kP = 2;',
        'final double kP = 2, other = 3;',
        'for (double kP : new double[] {1}) {}',
        'double x = kP * 2;',
        'System.out.println(kP);',
        'boolean b = kP == 1 || kP >= 1 || kP > 0 || kP <= 2 || kP != 3 || kP < 1;',
        'n = kP > 1 ? 1 : 0;',
        'Runnable r = () -> System.out.println(kP);',
        'Helper other = new Helper(); other.kP = 2;',
        'Helper.kP = 2;',
        'new Helper().run(kP);'
      ]
      for (const body of untouched) {
        const text = lift(
          body,
          '\n  public static class Helper { public static double kP; void run(double v) {} }'
        )
        expect(kP(text), body).toMatchObject({ editable: true })
      }
    })

    it('static 블록이 있다는 것만으로는 읽기 전용이 아니다', () => {
      expect(kP(lift('System.loadLibrary("x");')).editable).toBe(true)
      expect(kP(lift('')).editable).toBe(true)
    })

    it('다른 중첩 형식의 static 블록은 그 형식의 필드만 정한다', () => {
      const inner = `${CONFIG}@Config public class Outer {
  public static double kP = 1;
  @Config public static class Inner {
    public static double kP = 1;
    static { kP = 2; }
  }
}`
      expect(states(inner)).toEqual([
        ['Outer#kP', true, null],
        ['Outer.Inner#kP', false, 'initializedInType']
      ])
      const outer = `${CONFIG}@Config public class Outer {
  public static double kP = 1;
  static { kP = 2; }
  @Config public static class Inner { public static double kP = 1; }
}`
      expect(states(outer)).toEqual([
        ['Outer#kP', false, 'initializedInType'],
        ['Outer.Inner#kP', true, null]
      ])
      // 한계: 선언한 형식이 아닌 형식의 static 블록이 하는 대입은 보지 않는다
      const elsewhere = `${CONFIG}@Config public class Outer {
  public static double kP = 1;
  static class Helper { static { Outer.kP = 2; } }
}`
      expect(value(elsewhere, 'Outer#kP').editable).toBe(true)
    })

    it('객체 필드는 static 블록에 나오기만 해도 자식이 읽기 전용이다(같은 형식의 다른 필드도)', () => {
      const params = (body: string): string =>
        lift(
          body,
          `
  public static class Params { public double kS = 0; }
  public static Params PARAMS = new Params();
  public static Params SPARE;`
        )
      for (const body of [
        'PARAMS.kS = 2;',
        'PARAMS = new Params();',
        'Lift.PARAMS.kS++;',
        'configure(PARAMS);'
      ]) {
        const text = params(body)
        expect(node(text, 'Lift#PARAMS'), body).toMatchObject({ kind: 'object' })
        expect(value(text, 'Lift.Params#kS'), body).toMatchObject({
          editable: false,
          reason: 'initializedInType'
        })
      }
      expect(value(params('double kS = 1; other.PARAMS = null;'), 'Lift.Params#kS').editable).toBe(
        true
      )
      // 초기값 없이 static 블록이 만드는 객체
      expect(node(params('SPARE = new Params();'), 'Lift#SPARE')).toMatchObject({
        kind: 'object',
        children: [],
        reason: 'initializedInType'
      })
      expect(node(params(''), 'Lift#SPARE')).toMatchObject({ reason: 'noInitializer' })
    })

    it('static 블록·static 필드 초기값이 부르는 같은 형식의 static 메서드(그 메서드가 부르는 것도)를 본다', () => {
      // 리뷰의 SB.java·Rep.java(javac + Dashboard 0.6.0: a = 10, c = 30, f = 60, viaMethod = 100, 나머지는 초기값)
      const text = `${CONFIG}@Config public class L {
  public static double a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8;
  public static class Pid { public double kP = 1; }
  public static Pid PID = new Pid();
  static { L.one(); two(1); rec(); }
  static void one() { a = 10; }
  static void two(int n) { }
  static void two(String s) { b = 20; }
  static int depth;
  static void rec() { if (depth++ < 1) rec(); chain(); }
  static void chain() { set(); }
  static void set() { c = 30; tune(PID); }
  static void tune(Pid p) { }
  static void never() { d = 40; }
  void instance() { e = 50; }
  public static double viaInit = initF();
  static double initF() { f = 60; return 0; }
  static Helper other() { return new Helper(); }
  static { Helper.set(); new Helper().run(); other().set(); Runnable r = Helper::g; }
  static class Helper { static void set() { } void run() { } static void g() { } }
  static void g() { g = 70; }
}`
      const editable = Object.fromEntries(
        nodes(parseTunables(text)).map((item) => [
          item.id,
          item.kind === 'value' ? item.editable : item.reason
        ])
      )
      expect(editable).toMatchObject({
        'L#a': false,
        // 이름이 같은 메서드(오버로드)는 모두 본다(애매하면 읽기 전용)
        'L#b': false,
        'L#c': false,
        // 부르지 않는 메서드, 인스턴스 메서드, 다른 형식으로 한정한 호출, 메서드 참조는 보지 않는다
        'L#d': true,
        'L#e': true,
        'L#f': false,
        'L#g': true,
        'L#h': true,
        // 메서드 안에 나온 객체 필드는 자식이 읽기 전용
        'L.Pid#kP': false
      })
    })
  })

  describe('같은 파일의 상위 클래스(extends)', () => {
    it('맨 위 필드: 자기 필드 뒤에 상위 클래스들의 public static 필드, id는 선언한 형식', () => {
      // 리뷰의 Inherit2.java(Dashboard: Child는 OWN·BASE_GAIN, Child2는 OWN2·OWN·BASE_GAIN)
      const text = `${CONFIG}public class Consts {
    public static class Base { public static double BASE_GAIN = 0.75; public double inst = 1; }
    @Config
    public static class Child extends Base { public static double OWN = 1.5; }
    @Config
    public static class Child2 extends Child { public static double OWN2 = 2.5; }
}`
      const file = parseTunables(text)
      expect(file.blocks.map((block) => [block.name, block.fields.map((f) => f.id)])).toEqual([
        ['Child', ['Consts.Child#OWN', 'Consts.Base#BASE_GAIN']],
        ['Child2', ['Consts.Child2#OWN2', 'Consts.Child#OWN', 'Consts.Base#BASE_GAIN']]
      ])
      const gain = value(text, 'Consts.Base#BASE_GAIN')
      expect(text.slice(gain.span?.start, gain.span?.end)).toBe('0.75')
      expect(gain.editable).toBe(true)
    })

    it('최상위 형식, 형식 인자, 형식 매개변수의 extends, implements', () => {
      const text = `${CONFIG}
@Config
public class Inherit<T extends Other> extends InheritBase<Double> implements Iface {
    public static double OWN = 2.5;
}
class InheritBase<V> { public static double BASE_GAIN = 0.75; public double baseInst = 1; }
class Other { public static double NOT_SUPER = 1; }
interface Iface { double X = 1; }`
      expect(ids(text)).toEqual(['Inherit#OWN', 'InheritBase#BASE_GAIN'])
    })

    it('extends는 선언을 감싼 범위에서 푼다(자신의 중첩 형식이 아닌 형제 형식)', () => {
      const text = `${CONFIG}public class Holder {
    public static class Base { public static double OUTER = 1; }
    @Config public static class Child extends Base {
        public static class Base { public static double INNER = 2; }
        public static double OWN = 3;
    }
}`
      expect(ids(text)).toEqual(['Holder.Child#OWN', 'Holder.Base#OUTER'])
    })

    it('다른 파일의 상위 클래스는 보이지 않고, 순환(컴파일 오류)에도 멈춘다', () => {
      expect(
        ids(
          `${CONFIG}@Config public class Tele extends LinearOpMode { public static double S = 1; }`
        )
      ).toEqual(['Tele#S'])
      const cyclic = `${CONFIG}
@Config class A extends B { public static double a = 1; }
@Config class B extends A { public static double b = 2; }`
      expect(ids(cyclic)).toEqual(['A#a', 'B#b', 'B#b', 'A#a'])
    })

    it('상위 클래스의 static 블록이 정한 필드는 하위 클래스 묶음에서도 읽기 전용이다', () => {
      const text = `${CONFIG}public class H {
    public static class Base { public static double G = 1; static { G = 2; } }
    @Config public static class Child extends Base { public static double OWN = 1; }
}`
      expect(states(text)).toEqual([
        ['H.Child#OWN', true, null],
        ['H.Base#G', false, 'initializedInType']
      ])
    })

    it('묶음 클래스와 사이 클래스의 static 블록이 정한 물려받은 필드도 읽기 전용이다(같은 이름으로 가린 것은 뺀다)', () => {
      // 리뷰의 SubStatic.java와 Rep.java(javac + Dashboard 0.6.0: CompBot의 MAX_VEL = 50, C의 V·W·Z = 9, X·Y는 초기값)
      const text = `${CONFIG}public class S {
    public static class DriveConstants { public static double MAX_VEL = 30; public static double MAX_ACCEL = 30; }
    @Config public static class CompBot extends DriveConstants {
        public static double TRACK_WIDTH = 14;
        static { MAX_VEL = 50; }
    }
    public static class D { public static double X = 1, Y = 2, Z = 3, W = 4, V = 5; }
    public static class M extends D { public static double X = 5; }
    @Config public static class C extends M {
        static { X = 9; D.Z = 9; C.W = 9; setV(); M.X = 9; Other.Y = 9; }
        static void setV() { V = 9; }
    }
    static class Other { static double Y; }
}`
      const file = parseTunables(text)
      const fieldStates = (index: number): [string, boolean | string][] =>
        file.blocks[index].fields.map((field) => [
          field.id,
          field.kind === 'value' ? field.editable : field.kind
        ])
      expect(fieldStates(0)).toEqual([
        ['S.CompBot#TRACK_WIDTH', true],
        ['S.DriveConstants#MAX_VEL', false],
        ['S.DriveConstants#MAX_ACCEL', true]
      ])
      expect(fieldStates(1)).toEqual([
        // X는 M이 가린 이름이라 C의 static 블록이 정하는 것은 M.X다(Dashboard는 D.X = 1을 보인다)
        ['S.D#X', true],
        ['S.D#Y', true],
        ['S.D#Z', false],
        ['S.D#W', false],
        ['S.D#V', false]
      ])
      expect(value(text, 'S.DriveConstants#MAX_VEL').reason).toBe('initializedInType')
      // 하위 클래스를 묶음으로 보지 않는 곳(DriveConstants 자신의 묶음)도 같은 id라 읽기 전용이다
      const own = text.replace(
        'public static class DriveConstants',
        '@Config public static class DriveConstants'
      )
      expect(value(own, 'S.DriveConstants#MAX_VEL').editable).toBe(false)
      expect(parseTunables(own).blocks[0].fields[0]).toMatchObject({
        id: 'S.DriveConstants#MAX_VEL',
        editable: false
      })
    })

    it('객체 자식: 상위 클래스의 public 인스턴스 필드도 펼친다(다른 파일의 상위 클래스는 아는 필드만)', () => {
      // 리뷰의 Inherit.java(Dashboard: PARAMS.kS·PARAMS.kA)
      const text = `${CONFIG}@Config public class Inherit {
    public static class ParamsBase { public double kA = 0.1; public static double kStatic = 1; }
    public static class Params extends ParamsBase { public double kS = 0.2; }
    public static class Remote extends RemoteBase { public double kR = 0.3; }
    public static Params PARAMS = new Params();
    public static Remote REMOTE = new Remote();
}`
      expect(states(text)).toEqual([
        ['Inherit#PARAMS', 'object', null],
        ['Inherit.Params#kS', true, null],
        ['Inherit.ParamsBase#kA', true, null],
        ['Inherit#REMOTE', 'object', null],
        ['Inherit.Remote#kR', true, null]
      ])
    })

    it('가린 필드(같은 이름)는 Dashboard처럼 걸러진 것 중 가장 위 상위 클래스의 것만 보인다', () => {
      // javac + Dashboard 0.6.0 ReflectionConfig로 확인한 값: Child.kP = 1.0(Base), Child2.kP = 1.0(Base),
      // FinalChild.kF = 12.0·kI = 13.0(자기 것), PARAMS.kS = 0.1(PBase)·kV = 0.6(Params), QQ.q = 7.0(QBase)
      const text = `${CONFIG}public class Hidden {
    public static class Base { public static double kP = 1.0; public static double ONLY_BASE = 9.0; }
    @Config
    public static class Child extends Base { public static double kP = 2.0; public static double OWN = 3.0; }
    @Config
    public static class Child2 extends Child { public static double kP = 4.0; }
    public static class FinalBase { public static final double kF = 10.0; public double kI = 11.0; }
    @Config
    public static class FinalChild extends FinalBase { public static double kF = 12.0; public static double kI = 13.0; }
    public static class PBase { public double kS = 0.1; public double kA = 0.2; public static double kV = 0.3; }
    public static class Params extends PBase { public double kS = 0.5; public double kV = 0.6; }
    @Config
    public static class Holder { public static Params PARAMS = new Params(); }
    public static class QBase { public double q = 7.0; }
    public static class Q extends QBase { public static double q = 8.0; }
    @Config
    public static class QHolder { public static Q QQ = new Q(); }
}`
      const file = parseTunables(text)
      const literals = (fields: TunableNode[]): [string, string | null][] =>
        fields.flatMap((field) =>
          field.kind === 'value'
            ? [[field.id, field.literal]]
            : field.kind === 'object'
              ? literals(field.children)
              : []
        )
      expect(file.blocks.map((block) => [block.name, literals(block.fields)])).toEqual([
        [
          'Child',
          [
            ['Hidden.Child#OWN', '3.0'],
            ['Hidden.Base#kP', '1.0'],
            ['Hidden.Base#ONLY_BASE', '9.0']
          ]
        ],
        [
          'Child2',
          [
            ['Hidden.Child#OWN', '3.0'],
            ['Hidden.Base#kP', '1.0'],
            ['Hidden.Base#ONLY_BASE', '9.0']
          ]
        ],
        [
          'FinalChild',
          [
            ['Hidden.FinalChild#kF', '12.0'],
            ['Hidden.FinalChild#kI', '13.0']
          ]
        ],
        [
          'Holder',
          [
            ['Hidden.Params#kV', '0.6'],
            ['Hidden.PBase#kS', '0.1'],
            ['Hidden.PBase#kA', '0.2']
          ]
        ],
        ['QHolder', [['Hidden.QBase#q', '7.0']]]
      ])
    })
  })

  it('위치: CRLF·BOM이 있어도 span은 받은 글자의 오프셋이고 줄은 1부터다', () => {
    const text = `\uFEFF${CONFIG}// 한국어 주석\r\n@Config\r\npublic class Lift {\r\n    public static double kP = 0.5;\r\n}\r\n`
    const kP = value(text, 'Lift#kP')
    expect(text.slice(kP.span?.start, kP.span?.end)).toBe('0.5')
    expect(kP.line).toBe(5)
    expect(parseTunables(text).blocks[0].line).toBe(4)
  })

  it('@Config 없는 OpMode의 static 필드를 알린다', () => {
    const text = `@TeleOp public class Drive extends LinearOpMode {
  public static double SPEED = 0.5;
  @Override public void runOpMode() {}
}`
    expect(parseTunables(text)).toEqual({
      blocks: [],
      unicodeEscapes: false,
      staticFieldsWithoutConfig: true
    })
    expect(
      parseTunables('public class X { public static final double K = 1; }')
        .staticFieldsWithoutConfig
    ).toBe(false)
  })

  it('잘린 파일·잡음에도 예외를 던지지 않는다', () => {
    // 상위 클래스·생성자·static 블록이 있는 파일
    const busy = `${CONFIG}@Config public class A<T extends B> extends B<T> {
  public static class P extends Q { public double k = 1; public P() throws X { super(); k = 2; } }
  public static class Q { public double q = 1; { q = 2; } }
  public static P p = new P();
  public static double kP = 1;
  static { kP >>>= 1; (kP) = 2; Runnable r = () -> { A.kP++; }; p.k = 3; }
}
class B<V> { public static double G = 1; }`
    for (const text of [MECANUM_DRIVE, busy]) {
      for (let end = 0; end <= text.length; end += 3) {
        expect(() => parseTunables(text.slice(0, end))).not.toThrow()
      }
    }
    for (const text of [
      '',
      '}}}{{{',
      '@',
      '@Config',
      'class',
      'class {',
      'enum E {',
      '<<<>>>',
      'public static double = ;',
      'class A { int x = new ; }',
      'class A extends',
      'class A extends {',
      'class A<T extends> extends B {',
      'class A { A( { } }',
      'class A { A() throws',
      'class A { static {',
      'class A { static { kP',
      'class A { static { .kP = 1; } public static double kP = 1; }'
    ]) {
      expect(() => parseTunables(text), text).not.toThrow()
    }
  })
})
