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
    it('같은 파일의 new T()만 펼친다(생성자·초기화 블록·인자·익명·다른 파일 형식은 펼치지 않는다)', () => {
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
        ['ctor', 0, 'object'],
        ['init', 0, 'object'],
        ['other', 0, 'object']
      ])
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
    for (let end = 0; end <= MECANUM_DRIVE.length; end += 7) {
      expect(() => parseTunables(MECANUM_DRIVE.slice(0, end))).not.toThrow()
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
      'class A { int x = new ; }'
    ]) {
      expect(() => parseTunables(text), text).not.toThrow()
    }
  })
})
