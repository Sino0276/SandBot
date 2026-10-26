import { describe, expect, it } from 'vitest'
import { emptyFacts, extractFacts, type FileFacts } from './usageFacts'
import { resolveUsages } from './usageResolve'
import {
  MAX_HITS_PER_KEY,
  MAX_HITS_PER_UNKNOWN_NAME,
  MAX_UNKNOWN_NAMES,
  type SymbolClass,
  type UsageKey,
  type UsageResult,
  type UsageSymbols
} from './usageTypes'
import { createUsageWorkerState, handleMessage } from './usageWorkerCore'

// 맞추기(spec §6.3–6.5)의 규칙마다 작은 Java 파일로 확인한다. javac와의 전체 비교는 usageGolden.test.ts가 한다.
// 각 규칙은 javac로 확인한 탐침(설계의 jls·resolver 탐침 A–M, Q1–Q10)을 따른다.

const GEN = 'org.firstinspires.ftc.teamcode.sandbot'

// 생성 클래스: RobotHardware { leftFront, par(상수 PAR_X_MM), lift: Lift { liftLeft, ENC_X_MM, claw: Claw { grip } } }
const LF = 'd:drive\nlf'
const PAR = 'd:odo\npar'
const LIFT_LEFT = 'd:liftMotor\nll'
const ENC = 'd:enc\nenc'
const GRIP = 'd:clawServo\ngrip'
const ROBOT = 'r:bot'
const LIFT = 'g:lift'
const CLAW = 'g:claw'

const claw: SymbolClass = {
  key: CLAW,
  name: 'Claw',
  fields: [{ name: 'grip', key: GRIP, group: null }],
  constants: []
}
const lift: SymbolClass = {
  key: LIFT,
  name: 'Lift',
  fields: [
    { name: 'liftLeft', key: LIFT_LEFT, group: null },
    { name: 'enc', key: ENC, group: null },
    { name: 'claw', key: CLAW, group: claw }
  ],
  constants: [{ name: 'ENC_X_MM', key: ENC }]
}
const robot: SymbolClass = {
  key: ROBOT,
  name: 'RobotHardware',
  fields: [
    { name: 'leftFront', key: LF, group: null },
    { name: 'par', key: PAR, group: null },
    { name: 'lift', key: LIFT, group: lift }
  ],
  constants: [
    { name: 'CONFIGURATION_NAME', key: ROBOT },
    { name: 'PAR_X_MM', key: PAR }
  ]
}

function symbolsOf(
  robots: SymbolClass[],
  extra: Partial<Pick<UsageSymbols, 'unavailable' | 'lookupNames'>> = {}
): UsageSymbols {
  const unavailable = extra.unavailable ?? []
  const lookupNames = extra.lookupNames ?? [
    { name: 'leftFront', keys: [LF, PAR] },
    { name: 'liftLeft', keys: [LIFT_LEFT] },
    { name: 'grip', keys: [GRIP] }
  ]
  return {
    robots,
    unavailable,
    lookupNames,
    signature: JSON.stringify({ robots, unavailable, lookupNames })
  }
}

const SYMBOLS = symbolsOf([robot])

// 경로 → 소스. 경로 순서로 사실을 만든다(워커와 같다).
function factsOf(sources: Record<string, string>): Map<string, FileFacts> {
  return new Map(
    Object.keys(sources)
      .sort()
      .map((path) => [path, extractFacts(sources[path])])
  )
}

function resolve(sources: Record<string, string>, symbols = SYMBOLS): UsageResult {
  return resolveUsages(factsOf(sources), symbols)
}

// 키의 사용처를 '경로:줄 종류 맞은글자'로(열은 usageGolden.test.ts가 javac와 견준다)
function hits(result: UsageResult, key: UsageKey, kinds?: string[]): string[] {
  return (result.hits.get(key) ?? [])
    .filter((hit) => !kinds || kinds.includes(hit.kind))
    .map((hit) => `${hit.path}:${hit.line} ${hit.kind} ${hit.snippet.slice(...hit.mark)}`)
}

// 모든 키의 코드 사용처(field·constant·type·new)
function codeHits(result: UsageResult): string[] {
  return [...result.hits]
    .flatMap(([key, list]) =>
      list
        .filter((hit) => ['field', 'constant', 'type', 'new'].includes(hit.kind))
        .map((hit) => `${hit.path}:${hit.line} ${hit.kind} ${key}`)
    )
    .sort()
}

function unresolved(result: UsageResult): string[] {
  return [...result.unresolved]
    .flatMap(([key, list]) => list.map((hit) => `${hit.path}:${hit.line} ${key} ${hit.member}`))
    .sort()
}

const IMPORT = `import ${GEN}.RobotHardware;`

describe('형식 이름(JLS 6.4.1, 7.5)', () => {
  it('단일 import, 중첩 클래스, 전체 이름. 한정자는 사용처가 아니다', () => {
    const result = resolve({
      'A.java': `package a;
${IMPORT}
class A {
  RobotHardware r;
  RobotHardware.Lift l;
  ${GEN}.RobotHardware.Lift.Claw c;
  void f() { new RobotHardware(null); new RobotHardware.Lift(null); }
}`
    })
    expect(hits(result, ROBOT)).toEqual([
      'A.java:4 type RobotHardware',
      'A.java:7 new RobotHardware'
    ])
    expect(hits(result, LIFT)).toEqual(['A.java:5 type Lift', 'A.java:7 new Lift'])
    expect(hits(result, CLAW)).toEqual(['A.java:6 type Claw'])
    expect(result.unresolved).toEqual(new Map())
  })

  it('B: 같은 패키지의 형식이 on-demand를 이긴다', () => {
    const result = resolve({
      'sub/RobotHardware.java': 'package sub; public class RobotHardware { public String lift; }',
      'sub/B.java': `package sub; import ${GEN}.*; class B { Object f(RobotHardware r) { return r.lift; } }`
    })
    expect(codeHits(result)).toEqual([])
  })

  it('C: on-demand는 후보가 하나일 때만(둘이면 javac가 모호하다고 알린다)', () => {
    const one = resolve({
      'c/C.java': `package c; import ${GEN}.RobotHardware.*; class C { Object f(Lift l) { return l.liftLeft; } }`
    })
    expect(codeHits(one)).toEqual(['c/C.java:1 field d:liftMotor\nll', 'c/C.java:1 type g:lift'])
    const two = resolve({
      'p/Lift.java': 'package p; public class Lift { public int liftLeft; }',
      'c/C.java': `package c; import p.*; import ${GEN}.RobotHardware.*; class C { Object f(Lift l) { return l.liftLeft; } }`
    })
    expect(codeHits(two)).toEqual([])
  })

  it('D: static on-demand의 멤버 형식·상수, 형식으로 쓴 상수', () => {
    const result = resolve({
      'D.java': `package d;
import static ${GEN}.RobotHardware.*;
class D { double f(Lift l) { String s = CONFIGURATION_NAME; return PAR_X_MM + Lift.ENC_X_MM; } }`
    })
    expect(hits(result, LIFT)).toEqual(['D.java:3 type Lift'])
    expect(hits(result, ROBOT)).toEqual(['D.java:3 constant CONFIGURATION_NAME'])
    expect(hits(result, PAR)).toEqual(['D.java:3 constant PAR_X_MM'])
    expect(hits(result, ENC)).toEqual(['D.java:3 constant ENC_X_MM'])
  })

  it('E: 클래스의 필드가 단일 static import를 가린다', () => {
    const result = resolve({
      'E.java': `package e; import static ${GEN}.RobotHardware.PAR_X_MM;
class E { String PAR_X_MM = "mine"; String f() { return PAR_X_MM; } }`
    })
    expect(codeHits(result)).toEqual([])
  })

  it('G: 단일 static import한 멤버 형식, M: 멤버 클래스가 그것을 가린다', () => {
    const result = resolve({
      'G.java': `package t; import static ${GEN}.RobotHardware.Lift; class G { Object f(Lift l) { return l.liftLeft; } }`,
      'M.java': `package t; import static ${GEN}.RobotHardware.Lift;
class M { static class Lift { String liftLeft; } String f(Lift l) { return l.liftLeft; } }`
    })
    expect(codeHits(result)).toEqual(['G.java:1 field d:liftMotor\nll', 'G.java:1 type g:lift'])
  })

  it('K: 같은 패키지의 형식이 static on-demand의 멤버 형식을 이긴다, L: 단일 import는 같은 패키지를 이긴다', () => {
    const result = resolve({
      'k/Lift.java': 'package k; public class Lift { public int team; }',
      'k/K.java': `package k; import static ${GEN}.RobotHardware.*; class K { int f(Lift l) { return l.team; } }`,
      'k/L.java': `package k; import ${GEN}.RobotHardware.Lift; class L { Object f(Lift l) { return l.liftLeft; } }`
    })
    expect(codeHits(result)).toEqual(['k/L.java:1 field d:liftMotor\nll', 'k/L.java:1 type g:lift'])
  })

  it('A(O1): 변수가 형식을 가린다', () => {
    const result = resolve({
      'O.java': `package o; ${IMPORT}
class O { static class Holder { Object Lift; } Object f() { Holder RobotHardware = new Holder(); return RobotHardware.Lift; } }`
    })
    expect(codeHits(result)).toEqual([])
  })

  it('형식 매개변수(Q9c): 경계의 멤버로 풀지만 T라고 쓴 자리는 형식 사용처가 아니다', () => {
    const result = resolve({
      'Q.java': `package q; ${IMPORT}
class Q<R extends RobotHardware> {
  R robot;
  <T extends RobotHardware> void g(T t) { t.lift.liftLeft.setPower(1); robot.leftFront.setPower(0); }
  <Lift> void h(Lift l) { l.hashCode(); }
}`
    })
    expect(codeHits(result)).toEqual([
      'Q.java:2 type r:bot',
      'Q.java:4 field d:drive\nlf',
      'Q.java:4 field d:liftMotor\nll',
      'Q.java:4 type r:bot'
    ])
  })

  it('패키지는 경로가 아니라 package 선언에서 온다', () => {
    const result = resolve({
      'wrong/place/Base.java': `package real; ${IMPORT} public class Base { protected RobotHardware robot; }`,
      'x/Sub.java':
        'package x; import real.Base; class Sub extends Base { void f() { robot.leftFront.setPower(1); } }'
    })
    expect(hits(result, LF)).toEqual(['x/Sub.java:1 field leftFront'])
  })
})

describe('변수 이름과 상속(JLS 6.5.2, 8.2)', () => {
  it('Q1: package-private 필드는 다른 패키지의 하위 클래스가 물려받지 않는다(바깥 필드가 보인다)', () => {
    const result = resolve({
      'a/Base.java': 'package a; public class Base { String robot = "pkg"; }',
      'b/Q1.java': `package b; ${IMPORT}
class Q1 { RobotHardware robot; class Inner extends a.Base { void f() { robot.lift.liftLeft.setPower(1); } } }`,
      'a/Same.java': `package a; ${IMPORT}
class Same { RobotHardware robot; class Inner extends Base { void f() { robot.length(); } } }`
    })
    expect(hits(result, LIFT_LEFT)).toEqual(['b/Q1.java:2 field liftLeft'])
  })

  it('private 필드는 물려받지 않는다', () => {
    const result = resolve({
      'Base.java': 'package p; public class Base { private String robot; }',
      'Q.java': `package p; ${IMPORT}
class Q { RobotHardware robot; class Inner extends Base { void f() { robot.leftFront.setPower(1); } } }`
    })
    expect(hits(result, LF)).toEqual(['Q.java:2 field leftFront'])
  })

  it('F: 상속한 필드가 바깥 클래스의 필드와 잡힌 지역 변수를 이긴다, 잡힌 지역 변수는 바깥 필드를 이긴다', () => {
    const result = resolve({
      'Base.java': `package f; ${IMPORT} public class Base { protected RobotHardware robot; }`,
      'F.java': `package f; ${IMPORT}
class F {
  String robot = "outer";
  class Inner extends Base { Object g() { return robot.lift.liftLeft; } }
  Object h() { String robot = "local"; return new Base() { Object g() { return robot.leftFront; } }; }
  Object k(final RobotHardware r) { String s = "x"; return new Object() { Object g() { return r.lift.claw; } }; }
}`
    })
    expect(codeHits(result).filter((line) => line.startsWith('F.java'))).toEqual([
      'F.java:4 field d:liftMotor\nll',
      'F.java:5 field d:drive\nlf',
      'F.java:6 field g:claw',
      'F.java:6 type r:bot'
    ])
  })

  it('생성 클래스의 하위 클래스: 받는 쪽 없는 필드·상수, this·super, 멤버 형식, 하위 클래스 형식의 받는 쪽', () => {
    const result = resolve({
      'MyRobot.java': `package m; ${IMPORT}
public class MyRobot extends RobotHardware {
  MyRobot() { super(null); }
  void f() { leftFront.setPower(1); this.lift.liftLeft.setPower(1); super.par.setPower(0); Lift l = lift; double k = PAR_X_MM; }
}`,
      'Uses.java':
        'package m; class Uses { void f(MyRobot r) { r.lift.claw.grip.setPosition(1); } }'
    })
    expect(hits(result, LF)).toEqual(['MyRobot.java:4 field leftFront'])
    expect(hits(result, LIFT_LEFT)).toEqual(['MyRobot.java:4 field liftLeft'])
    expect(hits(result, PAR, ['field'])).toEqual(['MyRobot.java:4 field par'])
    expect(hits(result, LIFT)).toEqual(['MyRobot.java:4 type Lift', 'MyRobot.java:4 field lift'])
    expect(hits(result, PAR, ['constant'])).toEqual(['MyRobot.java:4 constant PAR_X_MM'])
    expect(hits(result, GRIP)).toEqual(['Uses.java:1 field grip'])
  })

  it('Q8: static import한 필드와 메서드', () => {
    const result = resolve({
      'c/Globals.java': `package c; ${IMPORT}
public final class Globals { public static RobotHardware robot; public static RobotHardware getRobot() { return robot; } }`,
      'b/Q8.java': `package b;
import static c.Globals.robot;
import static c.Globals.getRobot;
class Q8 { void f() { robot.lift.liftLeft.setPower(1); getRobot().leftFront.setPower(0); } }`
    })
    expect(hits(result, LIFT_LEFT)).toEqual(['b/Q8.java:4 field liftLeft'])
    expect(hits(result, LF)).toEqual(['b/Q8.java:4 field leftFront'])
  })

  it('싱글턴과 팀 필드: Robot.getInstance().hw.lift.liftLeft, robot.hw.lift.liftLeft', () => {
    const result = resolve({
      'Robot.java': `package r; ${IMPORT}
public class Robot { private static Robot instance; public RobotHardware hw; public static Robot getInstance() { return instance; } }`,
      'Uses.java': `package r;
class Uses { Robot robot; void f() { Robot.getInstance().hw.lift.liftLeft.setPower(1); robot.hw.lift.liftLeft.setPower(1); } }`
    })
    expect(hits(result, LIFT_LEFT)).toEqual([
      'Uses.java:2 field liftLeft',
      'Uses.java:2 field liftLeft'
    ])
  })

  it('메서드 반환: 오버로드의 형식이 모두 같을 때만(A2, H18)', () => {
    const result = resolve({
      'H.java': `package h; ${IMPORT}
class H {
  RobotHardware robot;
  RobotHardware make() { return robot; }
  RobotHardware make(int k) { return robot; }
  RobotHardware other() { return robot; }
  String other(int k) { return ""; }
  void f() { make().leftFront.setPower(1); other().leftFront.setPower(1); }
}`
    })
    expect(hits(result, LF)).toEqual(['H.java:8 field leftFront'])
  })

  it('enum 상수와 인터페이스 상수(물려받은 public static)', () => {
    const result = resolve({
      'I.java': `package i; ${IMPORT}
interface HasRobot { RobotHardware SHARED = null; }
class I implements HasRobot {
  enum Side { LEFT; RobotHardware.Lift lift() { return SHARED.lift; } }
  void f() { SHARED.leftFront.setPower(1); Side.LEFT.lift().enc.setPower(0); }
}`
    })
    expect(hits(result, LIFT, ['field'])).toEqual(['I.java:4 field lift'])
    expect(hits(result, LF)).toEqual(['I.java:5 field leftFront'])
    expect(hits(result, ENC)).toEqual(['I.java:5 field enc'])
  })

  it('순환 상속(쓰는 중인 코드)에서도 멈춘다', () => {
    const result = resolve({
      'A.java': 'package c; class A extends B { void f() { missing.x(); Inner i; } }',
      'B.java': 'package c; class B extends A implements I { }',
      'I.java': 'package c; interface I extends I { }',
      'S.java':
        'package c; class S extends S.T { static class T extends S { } void f() { y.z(); } }'
    })
    expect(codeHits(result)).toEqual([])
    expect(result.unresolved).toEqual(new Map())
  })

  it('지역 변수·람다 매개변수가 필드를 가리고, 끝나면 다시 필드다', () => {
    const result = resolve({
      'L.java': `package l; ${IMPORT}
class L {
  RobotHardware robot;
  void f(java.util.List<String> xs) {
    { String robot = "x"; robot.length(); }
    xs.forEach(robot -> robot.length());
    robot.leftFront.setPower(1);
  }
}`
    })
    expect(hits(result, LF)).toEqual(['L.java:7 field leftFront'])
  })
})

describe('생성 형식과 연쇄', () => {
  it('마지막 생성 멤버만 사용처다. Object 메서드는 없는 이름이 아니다', () => {
    const result = resolve({
      'C.java': `package c; ${IMPORT}
class C { RobotHardware r; void f() {
  r.lift.liftLeft.setPower(1);
  r.lift.toString();
  r.lift.claw.hashCode();
  Object o = r.lift;
  int n = r.getClass().getName().length();
} }`
    })
    expect(hits(result, LIFT, ['field'])).toEqual(['C.java:4 field lift', 'C.java:6 field lift'])
    expect(hits(result, LIFT_LEFT)).toEqual(['C.java:3 field liftLeft'])
    expect(hits(result, CLAW, ['field'])).toEqual(['C.java:5 field claw'])
    expect(result.unresolved).toEqual(new Map())
  })

  it('배열: 원소는 첨자로, length는 사용처가 아니다', () => {
    const result = resolve({
      'A.java': `package a; ${IMPORT}
class A { static RobotHardware[] bots; static RobotHardware.Lift[][] grid; void f() {
  bots[0].leftFront.setPower(1);
  int n = bots.length + grid[0].length;
  grid[0][1].claw.grip.setPosition(0);
  RobotHardware c[] = bots; c[1].lift.liftLeft.setPower(0);
} }`
    })
    expect(hits(result, LF)).toEqual(['A.java:3 field leftFront'])
    expect(hits(result, GRIP)).toEqual(['A.java:5 field grip'])
    expect(hits(result, LIFT_LEFT)).toEqual(['A.java:6 field liftLeft'])
  })

  it('같은 이름의 필드 둘(fieldNameCollision)은 두 키 모두 사용처다', () => {
    const twin: SymbolClass = {
      ...robot,
      fields: [...robot.fields, { name: 'leftFront', key: 'd:twin\nlf2', group: null }]
    }
    const result = resolve(
      {
        'A.java': `package a; ${IMPORT} class A { void f(RobotHardware r) { r.leftFront.setPower(1); } }`
      },
      symbolsOf([twin])
    )
    expect(hits(result, LF)).toEqual(['A.java:1 field leftFront'])
    expect(hits(result, 'd:twin\nlf2')).toEqual(['A.java:1 field leftFront'])
  })

  it('생성 코드에 없는 이름: 없는 멤버는 찾던 범위의 키, 없는 형식은 *', () => {
    const result = resolve({
      'A.java': `package a;
import ${GEN}.OldBot;
import ${GEN}.RobotHardware;
import ${GEN}.RobotHardware.Gripper;
import static ${GEN}.RobotHardware.Lift.LIFT_X_MM;
import static ${GEN}.Gone.*;
class A {
  OldBot old;
  Gripper g;
  RobotHardware.Lift.Gripper g2;
  void f(RobotHardware r) {
    r.lift.liftRight.setPower(1);
    r.lift.claw.grip.setPower(0);
    r.arm.lift.liftLeft.setPower(0);
    double x = LIFT_X_MM + RobotHardware.Lift.LIFT_Y_MM;
    OldBot.CONFIGURATION_NAME.length();
    ${GEN}.Missing.X.hashCode();
    r.drive();
  }
}`
    })
    expect(unresolved(result)).toEqual([
      'A.java:10 g:lift Gripper',
      'A.java:12 g:lift liftRight',
      'A.java:14 r:bot arm',
      'A.java:15 g:lift LIFT_X_MM',
      'A.java:15 g:lift LIFT_Y_MM',
      'A.java:16 * OldBot',
      'A.java:17 * Missing',
      'A.java:18 r:bot drive',
      'A.java:2 * OldBot',
      'A.java:4 r:bot Gripper',
      'A.java:5 g:lift LIFT_X_MM',
      'A.java:6 * Gone',
      'A.java:8 * OldBot',
      'A.java:9 r:bot Gripper'
    ])
    // 생성 형식(grip은 Servo)의 메서드는 알 수 없는 형식이라 따지지 않는다
    expect(hits(result, GRIP)).toEqual(['A.java:13 field grip'])
  })

  it('생성 클래스의 하위 팀 클래스로 쓴 없는 이름(필드·상수·멤버 형식·static import)은 그 생성 클래스의 키다', () => {
    const result = resolve({
      'p/CompBot.java': `package p; ${IMPORT}
public class CompBot extends RobotHardware {
  private int hidden;
  CompBot() { super(null); }
  void g() { this.rightFront.setPower(1); rightBack.setPower(1); }
}`,
      'p/Practice.java': 'package p; public class Practice extends CompBot { }',
      'p/Runner.java': `package p; ${IMPORT}
public class Runner extends RobotHardware implements Runnable { Runner() { super(null); } public void run() { } }`,
      'q/Uses.java': `package q;
import static p.CompBot.PAR_X_MM;
import static p.CompBot.PAR_Y_MM;
import p.CompBot;
import p.Practice;
import p.Runner;
class Uses {
  void f(CompBot bot, Practice practice, Runner runner) {
    bot.leftFront.setPower(PAR_X_MM + CompBot.PAR_X_MM);
    CompBot.Lift l = bot.lift;
    bot.rightFront.setPower(PAR_Y_MM);
    double y = CompBot.PAR_Y_MM;
    CompBot.Intake in = bot.intake;
    practice.rightFront.setPower(0);
    practice.hidden = 1;
    bot.drive();
    runner.rightFront.setPower(0);
  }
}`
    })
    // javac의 cannot find symbol과 같다. 팀 클래스가 선언한 이름(private hidden), 팀 클래스의 메서드, 알 수 없는 상위
    // 형식(Runnable)이 있는 계층, 받는 쪽 없는 이름(rightBack, spec §12)은 알리지 않는다.
    expect(unresolved(result)).toEqual([
      'p/CompBot.java:5 r:bot rightFront',
      'q/Uses.java:11 r:bot PAR_Y_MM',
      'q/Uses.java:11 r:bot rightFront',
      'q/Uses.java:12 r:bot PAR_Y_MM',
      'q/Uses.java:13 r:bot Intake',
      'q/Uses.java:13 r:bot intake',
      'q/Uses.java:14 r:bot rightFront',
      'q/Uses.java:3 r:bot PAR_Y_MM'
    ])
    expect(hits(result, LF)).toEqual(['q/Uses.java:9 field leftFront'])
    expect(hits(result, PAR)).toEqual([
      'q/Uses.java:9 constant PAR_X_MM',
      'q/Uses.java:9 constant PAR_X_MM'
    ])
    expect(hits(result, LIFT)).toEqual(['q/Uses.java:10 type Lift', 'q/Uses.java:10 field lift'])
  })

  it('깨진 단일 import는 범위에 들어가지 않는다: 같은 패키지·on-demand로 이어서 찾고, 그 팀 클래스에 없는 멤버만 알린다', () => {
    const result = resolve({
      'p/Fancy.java': 'package p;\npublic enum Fancy { A }',
      'p/Gripper.java':
        'package p;\npublic class Gripper { public double open; public void close() { } }',
      'p/Offsets.java':
        'package p;\npublic class Offsets { public static final double LIFT_X_MM = 1; }',
      'p/Util.java': `package p;\n${IMPORT}\npublic class Util { public static RobotHardware robot() { return null; } }`,
      'p/Wrapped.java': 'package p;\npublic class Wrapped extends com.acme.Base { }',
      'p/Uses.java': `package p;
import ${GEN}.RobotHardware.Lift.Gripper;
import ${GEN}.RobotHardware.Lift.Fancy;
import ${GEN}.RobotHardware.Lift.Wrapped;
import ${GEN}.RobotHardware.Lift.Arm;
import static ${GEN}.RobotHardware.LIFT_X_MM;
import static p.Offsets.*;
import static ${GEN}.OldBot.robot;
import static p.Util.*;
class Uses {
  Gripper g;
  Fancy f;
  Wrapped w;
  Arm a;
  void m() {
    g.grip.hashCode();
    g.open = 1;
    g.close();
    g.toString();
    g.release();
    f.ordinal();
    Object b = Fancy.B;
    w.grip.hashCode();
    double x = LIFT_X_MM;
    robot().lift.liftLeft.setPower(1);
  }
}`
    })
    // javac의 cannot find symbol과 같다. 이어서 찾은 팀 클래스의 선언(11–13줄), 있는 멤버, Object·enum의 메서드, 알 수
    // 없는 상위 형식(com.acme.Base)이 있는 계층, static on-demand로 찾은 상수(24줄)와 메서드(25줄)는 알리지 않는다.
    // 아무 데도 없는 이름(Arm)은 쓰는 자리마다 알린다.
    expect(unresolved(result)).toEqual([
      'p/Uses.java:14 g:lift Arm',
      'p/Uses.java:16 g:lift grip',
      'p/Uses.java:2 g:lift Gripper',
      'p/Uses.java:20 g:lift release',
      'p/Uses.java:22 g:lift B',
      'p/Uses.java:3 g:lift Fancy',
      'p/Uses.java:4 g:lift Wrapped',
      'p/Uses.java:5 g:lift Arm',
      'p/Uses.java:6 r:bot LIFT_X_MM',
      'p/Uses.java:8 * OldBot'
    ])
    expect(hits(result, LIFT_LEFT)).toEqual(['p/Uses.java:25 field liftLeft'])
    expect(codeHits(result).filter((line) => line.startsWith('p/Uses.java'))).toEqual([
      'p/Uses.java:25 field d:liftMotor\nll'
    ])
  })

  it('경계가 둘 이상인 형식 매개변수: 다른 경계의 메서드는 없는 이름이 아니고, 필드는 푼 경계에서 찾는다', () => {
    const result = resolve({
      'g/HasArm.java': `package g; ${IMPORT} public interface HasArm { RobotHardware ARM = null; RobotHardware arm(); }`,
      'g/Stopper.java': `package g; ${IMPORT}
final class Stopper {
  static <R extends RobotHardware & Runnable> void stop(R r) { r.run(); r.leftFront.setPower(0); r.rightFront.setPower(0); }
  static <R extends RobotHardware & HasArm, S extends R> void arm(S s) { s.arm().leftFront.setPower(0); s.ARM.lift.liftLeft.setPower(0); }
  static <R extends RobotHardware & Runnable> void many(R[] rs) { rs[0].run(); }
}`
    })
    expect(unresolved(result)).toEqual(['g/Stopper.java:3 r:bot rightFront'])
    expect(hits(result, LF)).toEqual([
      'g/Stopper.java:3 field leftFront',
      'g/Stopper.java:4 field leftFront'
    ])
    expect(hits(result, LIFT_LEFT)).toEqual(['g/Stopper.java:4 field liftLeft'])
  })

  it('공변 반환으로 재정의한 메서드는 가장 아래 형식을 돌려준다(관계없는 형식이 섞이면 알 수 없다)', () => {
    const result = resolve({
      'c/CompBot.java': `package c; ${IMPORT} public class CompBot extends RobotHardware { CompBot() { super(null); } }`,
      'c/Provider.java': `package c; ${IMPORT} public interface Provider { RobotHardware robot(); }`,
      'c/CompProvider.java': `package c;
public class CompProvider implements Provider {
  public CompBot robot() { return null; }
  CompBot pick() { return null; }
}`,
      'c/Sub.java': `package c; class Sub extends CompProvider { Other pick(int k) { return null; } }
class Other { }`,
      'c/Use.java': `package c;
class Use { void f(CompProvider c, Provider p, Sub s) {
  c.robot().leftFront.setPower(0);
  p.robot().lift.liftLeft.setPower(0);
  s.robot().par.setPower(0);
  s.pick().leftFront.setPower(0);
  c.robot().gone.setPower(0);
} }`
    })
    expect(hits(result, LF)).toEqual(['c/Use.java:3 field leftFront'])
    expect(hits(result, LIFT_LEFT)).toEqual(['c/Use.java:4 field liftLeft'])
    expect(hits(result, PAR, ['field'])).toEqual(['c/Use.java:5 field par'])
    expect(unresolved(result)).toEqual(['c/Use.java:7 r:bot gone'])
  })

  it('enum의 values()·valueOf()는 그 enum을 돌려준다', () => {
    const result = resolve({
      'e/Slots.java': `package e; ${IMPORT}
public enum Slots {
  MAIN;
  public RobotHardware robot;
  public static Slots valueOf(int k) { return MAIN; }
  static void f() {
    Slots.values()[0].robot.lift.liftLeft.setPower(0);
    for (Slots s : values()) s.robot.leftFront.setPower(0);
    values()[0].robot.leftFront.setPower(1);
  }
}`,
      'e/Use.java': `package e;
class Use { void f() { Slots.valueOf("MAIN").robot.par.setPower(0); Slots.MAIN.robot.leftFront.setPower(0); } }`
    })
    expect(hits(result, LIFT_LEFT)).toEqual(['e/Slots.java:7 field liftLeft'])
    expect(hits(result, LF)).toEqual([
      'e/Slots.java:8 field leftFront',
      'e/Slots.java:9 field leftFront',
      'e/Use.java:2 field leftFront'
    ])
    expect(hits(result, PAR, ['field'])).toEqual(['e/Use.java:2 field par'])
  })

  it('…sandbot.*로 들여온 이름은 없는 형식으로 알리지 않는다(SDK의 on-demand 이름과 가를 수 없다)', () => {
    const result = resolve({
      'A.java': `package a; import ${GEN}.*; class A { OldBot old; void f() { OldBot.X.y(); } }`
    })
    expect(result.unresolved).toEqual(new Map())
  })

  it('잘못됐거나 겹치는 로봇 클래스: 코드 사용처를 찾지 않고 없는 형식으로도 알리지 않는다', () => {
    const symbols = symbolsOf([], {
      unavailable: [{ key: ROBOT, className: 'RobotHardware', reason: 'duplicateClassName' }]
    })
    const result = resolve(
      {
        'A.java': `package a; ${IMPORT}
class A { RobotHardware r; void f() { r.lift.liftLeft.setPower(1); RobotHardware.Lift.X.y(); String s = "liftLeft"; } }`
      },
      symbols
    )
    expect(codeHits(result)).toEqual([])
    expect(result.unresolved).toEqual(new Map())
    // 이름으로 찾기는 그대로 한다
    expect(hits(result, LIFT_LEFT)).toEqual(['A.java:2 text "liftLeft"'])
  })

  it('생성 패키지를 선언한 팀 파일은 형식을 보태지 않는다(같은 패키지의 로봇 클래스는 보인다)', () => {
    const result = resolve({
      'fake/Fake.java': `package ${GEN}; public class Fake { RobotHardware r; void f() { r.leftFront.setPower(1); } }`,
      'A.java': `package a; import ${GEN}.Fake; class A { Fake f; }`
    })
    expect(unresolved(result)).toEqual(['A.java:1 * Fake', 'A.java:1 * Fake'])
    expect(hits(result, ROBOT)).toEqual(['fake/Fake.java:1 type RobotHardware'])
    expect(hits(result, LF)).toEqual(['fake/Fake.java:1 field leftFront'])
  })

  it('X.f::m·X.f.class의 이름은 식일 수 있다(생성 클래스의 상수면 없는 형식이 아니다)', () => {
    const result = resolve({
      'A.java': `package a; ${IMPORT}
class A { java.util.function.Supplier<Integer> s = RobotHardware.CONFIGURATION_NAME::length; }`
    })
    expect(result.unresolved).toEqual(new Map())
    expect(hits(result, ROBOT, ['constant'])).toEqual(['A.java:2 constant CONFIGURATION_NAME'])
  })

  it('스니펫: 머리부터 맞은 멤버 다음 하나까지, 맞은 토큰 표시, 96자 이하', () => {
    const long = 'x'.repeat(120)
    const result = resolve({
      'A.java': `package a; ${IMPORT}
class A { RobotHardware robot; Object ${long}; void f() {
  robot.lift.liftLeft.setPower(1).a().b();
  ${long}.hashCode(); robot.lift.claw.grip.setPosition(0);
  RobotHardware.Lift arr[] = null; arr[0].liftLeft.getPower();
} }`
    })
    const [first, second] = result.hits.get(LIFT_LEFT)!
    expect(first.snippet).toBe('robot.lift.liftLeft.setPower(…)…')
    expect(first.snippet.slice(...first.mark)).toBe('liftLeft')
    expect(second.snippet).toBe('arr[…].liftLeft.getPower(…)')
    for (const list of result.hits.values()) {
      for (const hit of list) {
        expect(hit.snippet.length).toBeLessThanOrEqual(96)
        expect(hit.mark[0]).toBeLessThan(hit.mark[1])
      }
    }
  })
})

describe('문자열', () => {
  it('찾기는 구성 이름의 장치들(없으면 구성에 없는 이름), 같은 글자는 맞는 장치에만', () => {
    const result = resolve({
      'A.java': `package a;
import com.qualcomm.robotcore.hardware.HardwareMap;
class A { void f(HardwareMap hw) {
  hw.get(Object.class, "leftFront");
  hw.get(Object.class, " liftLeft ");
  hw.get(Object.class, "rightRear");
  System.out.println("grip");
  System.out.println("unrelated");
} }`
    })
    // 데드휠 par는 같은 포트 모터의 구성 이름(leftFront)이라 둘 다 받는다
    expect(hits(result, LF)).toEqual(['A.java:4 lookup "leftFront"'])
    expect(hits(result, PAR)).toEqual(['A.java:4 lookup "leftFront"'])
    expect(hits(result, LIFT_LEFT)).toEqual(['A.java:5 lookup " liftLeft "'])
    expect(hits(result, GRIP)).toEqual(['A.java:7 text "grip"'])
    expect([...result.unknownNames.keys()]).toEqual(['rightRear'])
    expect(result.totals.get(LF)).toMatchObject({ lookup: 1, text: 0 })
  })

  it('다른 파일의 상수(Constants.LF)를 찾기 인자로 쓰면 그 초기값 자리가 찾기다(같은 자리의 같은 글자를 이긴다)', () => {
    const result = resolve({
      'c/Constants.java': `package c;
public final class Constants { public static final String LF = "leftFront"; public static final String NONE = "ghost"; }`,
      'd/Drive.java': `package d;
import c.Constants;
import com.qualcomm.robotcore.hardware.HardwareMap;
class Drive { Drive(HardwareMap hardwareMap) { hardwareMap.get(Object.class, Constants.LF); hardwareMap.get(Object.class, Constants.NONE); } }`
    })
    expect(hits(result, LF)).toEqual(['c/Constants.java:2 lookup "leftFront"'])
    expect(result.hits.get(LF)![0].snippet).toBe('LF = "leftFront"')
    expect([...result.unknownNames.keys()]).toEqual(['ghost'])
    expect(result.unknownNames.get('ghost')![0].path).toBe('c/Constants.java')
  })

  it('물려받은 상수와 static import한 상수도 찾기 인자로 푼다', () => {
    const result = resolve({
      'c/Names.java':
        'package c; public class Names { public static final String GRIP = "grip"; protected static final String LIFT = "liftLeft"; }',
      'd/Arm.java': `package d;
import static c.Names.GRIP;
class Arm extends c.Names { void f(com.qualcomm.robotcore.hardware.HardwareMap hardwareMap) { hardwareMap.servo.get(GRIP); hardwareMap.get(Object.class, LIFT); } }`
    })
    expect(hits(result, GRIP)).toEqual(['c/Names.java:1 lookup "grip"'])
    expect(hits(result, LIFT_LEFT)).toEqual(['c/Names.java:1 lookup "liftLeft"'])
  })
})

describe('결과', () => {
  it(`한도: 키마다 ${MAX_HITS_PER_KEY}개(코드가 같은 글자보다 먼저), 전체 개수는 자르기 전`, () => {
    const lines = [
      ...Array.from({ length: 250 }, () => 'System.out.println("leftFront");'),
      ...Array.from({ length: 30 }, () => 'r.leftFront.setPower(1);')
    ]
    const result = resolve({
      'A.java': `package a; ${IMPORT}\nclass A { void f(RobotHardware r) {\n${lines.join('\n')}\n} }`
    })
    const list = result.hits.get(LF)!
    expect(list).toHaveLength(MAX_HITS_PER_KEY)
    expect(list.filter((hit) => hit.kind === 'field')).toHaveLength(30)
    expect(result.totals.get(LF)).toMatchObject({ field: 30, text: 250 })
    // 남긴 것은 (경로, 줄, 열) 순서다
    const order = list.map((hit) => hit.line)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it(`구성에 없는 이름은 ${MAX_UNKNOWN_NAMES}개까지, 이름마다 ${MAX_HITS_PER_UNKNOWN_NAME}개까지`, () => {
    const calls = [
      ...Array.from(
        { length: MAX_UNKNOWN_NAMES + 20 },
        (_, i) => `hw.get(Object.class, "m${String(i).padStart(3, '0')}");`
      ),
      ...Array.from({ length: 80 }, () => 'hw.get(Object.class, "m000");')
    ]
    const result = resolve({
      'A.java': `package a; class A { void f(com.qualcomm.robotcore.hardware.HardwareMap hw) {\n${calls.join('\n')}\n} }`
    })
    expect(result.unknownNames.size).toBe(MAX_UNKNOWN_NAMES)
    expect([...result.unknownNames.keys()][0]).toBe('m000')
    expect(result.unknownNames.get('m000')).toHaveLength(MAX_HITS_PER_UNKNOWN_NAME)
  })

  it('생성 코드에 없는 이름도 키마다 자르고 전체 개수를 남긴다', () => {
    const lines = Array.from({ length: 230 }, () => 'r.gone.x();')
    const result = resolve({
      'A.java': `package a; ${IMPORT}\nclass A { void f(RobotHardware r) {\n${lines.join('\n')}\n} }`
    })
    expect(result.unresolved.get(ROBOT)).toHaveLength(MAX_HITS_PER_KEY)
    expect(result.totals.get(ROBOT)?.unresolved).toBe(230)
    expect(result.fileTotals.get(ROBOT)?.get('A.java')?.unresolved).toBe(230)
  })

  it('자른 키만 자르기 전의 파일별 개수를 남긴다', () => {
    const uses = (n: number): string =>
      Array.from({ length: n }, () => 'r.leftFront.setPower(0);').join('\n')
    const result = resolve({
      'A.java': `package a; ${IMPORT}\nclass A { void f(RobotHardware r) {\n${uses(150)}\n} }`,
      'B.java': `package a; ${IMPORT}\nclass B { void f(RobotHardware r) {\n${uses(120)}\n} }`,
      'C.java': `package a; ${IMPORT}\nclass C { void f(RobotHardware r) { r.par.setPower(0); } }`
    })
    expect(result.hits.get(LF)).toHaveLength(MAX_HITS_PER_KEY)
    const byPath = result.fileTotals.get(LF)!
    expect(byPath.get('A.java')?.field).toBe(150)
    expect(byPath.get('B.java')?.field).toBe(120)
    // 자르지 않은 키는 없다(행이 곧 전체다)
    expect(result.fileTotals.has(PAR)).toBe(false)
  })

  it('파일: 사실을 만든 수, 유니코드 이스케이프로 건너뛴 파일, 한도를 넘은 파일(tooLarge)', () => {
    const escape = String.fromCharCode(92) + 'u0041'
    const files = new Map<string, FileFacts>([
      ['A.java', extractFacts('package a; class A {}')],
      ['B.java', extractFacts(`package b; class B { int ${escape}x; }`)],
      ['C.java', emptyFacts('capped')]
    ])
    const result = resolveUsages(files, SYMBOLS)
    expect(result.files).toEqual({
      scanned: 1,
      tooLarge: ['C.java'],
      unicodeEscape: ['B.java'],
      failed: []
    })
  })

  it('워커는 한도를 넘은 파일(capped)을 읽지 않은 너무 큰 파일과 합친다', () => {
    const state = createUsageWorkerState({
      extractFacts: (text) => (text === 'capped' ? emptyFacts('capped') : extractFacts(text))
    })
    handleMessage(state, {
      type: 'files',
      batch: 1,
      upserts: [
        { path: 'b/Capped.java', stamp: '1:1', text: 'capped' },
        { path: 'a/Big.java', stamp: '2:1', text: null, problem: 'tooLarge' },
        { path: 'c/Ok.java', stamp: '3:1', text: 'package c; class Ok {}' }
      ],
      removes: []
    })
    const reply = handleMessage(state, { type: 'match', seq: 1, symbols: SYMBOLS })
    expect(reply.type === 'result' && reply.result.files).toEqual({
      scanned: 1,
      tooLarge: ['a/Big.java', 'b/Capped.java'],
      unicodeEscape: [],
      failed: []
    })
  })

  it('사실이 없는 파일은 경로의 이름으로 자리 클래스를 둔다(on-demand로 보이는 생성 이름이 대신 풀리지 않는다)', () => {
    const S = 'src/main/java/'
    const escape = String.fromCharCode(92) + 'u00b0'
    const sources: Record<string, string> = {
      [`${S}sub/Command.java`]: `package sub;
import ${GEN}.RobotHardware.*;
import ${GEN}.RobotHardware.Lift.*;
class Command { Lift lift; Claw claw; Holder holder; void f() {
  lift.setPower(1); lift.liftLeft.setPower(0); claw.grip.setPosition(0); holder.lift.liftLeft.setPower(0);
} }`,
      // 이스케이프로 건너뛴 같은 패키지의 Lift
      [`${S}sub/Lift.java`]: `package sub; // 30${escape}\npublic class Lift { public void setPower(double p) { } }`,
      // 다른 경로의 파일이 sub.Holder를 선언했다(읽은 파일이 이긴다)
      [`${S}other/Holders.java`]: `package sub; ${IMPORT} class Holder { RobotHardware.Lift lift; }`
    }
    // 워커가 읽지 않은 같은 패키지의 Claw(너무 큼·읽지 못함)와 Holder
    const result = resolveUsages(factsOf(sources), SYMBOLS, [
      `${S}sub/Claw.java`,
      `${S}sub/Holder.java`
    ])
    // javac는 Lift·Claw를 같은 패키지의 팀 클래스로 묶는다. 그 멤버는 모르므로 사용처도 없는 이름도 없다.
    expect(codeHits(result)).toEqual([
      `${S}other/Holders.java:1 type g:lift`,
      `${S}sub/Command.java:5 field ${LIFT_LEFT}`
    ])
    expect(hits(result, LIFT_LEFT)).toEqual([`${S}sub/Command.java:5 field liftLeft`])
    expect(result.unresolved).toEqual(new Map())
    // 워커가 읽지 않은 파일은 워커가 센다
    expect(result.files).toEqual({
      scanned: 2,
      tooLarge: [],
      unicodeEscape: [`${S}sub/Lift.java`],
      failed: []
    })

    // 목록에 없으면(그런 팀 클래스가 없으면) on-demand의 생성 이름이다
    const absent = resolveUsages(
      factsOf({ [`${S}sub/Command.java`]: sources[`${S}sub/Command.java`] }),
      SYMBOLS
    )
    expect(hits(absent, LIFT, ['type'])).toEqual([`${S}sub/Command.java:4 type Lift`])
    expect(hits(absent, CLAW, ['type'])).toEqual([`${S}sub/Command.java:4 type Claw`])
  })

  it('워커가 읽지 않은 파일의 경로를 맞추기에 넘겨 자리 클래스를 둔다', () => {
    const S = 'src/main/java/'
    const state = createUsageWorkerState()
    handleMessage(state, {
      type: 'files',
      batch: 1,
      upserts: [
        { path: `${S}sub/Lift.java`, stamp: '1:1', text: null, problem: 'tooLarge' },
        { path: `${S}sub/Claw.java`, stamp: '1:1', text: null, problem: 'failed' },
        {
          path: `${S}sub/Command.java`,
          stamp: '1:1',
          text: `package sub; import ${GEN}.RobotHardware.*; import ${GEN}.RobotHardware.Lift.*;
class Command { Lift lift; Claw claw; void f() { lift.spin(1); lift.liftLeft.setPower(0); claw.grip.setPosition(0); } }`
        }
      ],
      removes: []
    })
    const reply = handleMessage(state, { type: 'match', seq: 1, symbols: SYMBOLS })
    if (reply.type !== 'result') throw new Error(reply.type)
    expect(codeHits(reply.result)).toEqual([])
    expect(reply.result.unresolved).toEqual(new Map())
    expect(reply.result.files).toEqual({
      scanned: 1,
      tooLarge: [`${S}sub/Lift.java`],
      unicodeEscape: [],
      failed: [`${S}sub/Claw.java`]
    })
  })

  it('결정적이다: 같은 입력이면 같은 결과, 입력 순서와 관계없이 (경로, 줄, 열) 순서', () => {
    const sources = {
      'b/B.java': `package b; ${IMPORT} class B { RobotHardware r; void f() { r.leftFront.setPower(1); System.out.println("leftFront"); } }`,
      'a/A.java': `package a; ${IMPORT} class A { RobotHardware r; void f() { r.leftFront.setPower(0); r.gone(); } }`
    }
    const first = resolve(sources)
    const again = resolve(sources)
    expect(again).toEqual(first)
    const reversed = resolveUsages(new Map([...factsOf(sources)].reverse()), SYMBOLS)
    expect(reversed).toEqual(first)
    expect(hits(first, LF)).toEqual([
      'a/A.java:1 field leftFront',
      'b/B.java:1 field leftFront',
      'b/B.java:1 text "leftFront"'
    ])
  })
})
