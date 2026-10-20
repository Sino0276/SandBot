import { describe, expect, it } from 'vitest'
import {
  extractFacts,
  extractFactsOrThrow,
  MAX_FACTS,
  MAX_SEGMENTS,
  type Chain,
  type FileFacts,
  type TypeRef,
  type TypeUseContext
} from './usageFacts'

function ref(type: TypeRef | null): string {
  return type ? type.names.join('.') + '[]'.repeat(type.dims) : 'null'
}

// 연쇄를 글자로: 머리 종류:이름(:형식) + 세그먼트(호출 (), 첨자 [])
function show(chain: Chain): string {
  const h = chain.head
  const head =
    h.k === 'local'
      ? `L:${h.name}:${ref(h.type)}`
      : h.k === 'name'
        ? `N:${h.name}`
        : h.k === 'call'
          ? `C:${h.name}`
          : h.k === 'new'
            ? `new:${ref(h.type)}${h.anon !== null ? '{}' : ''}`
            : h.k === 'cast'
              ? `cast:${ref(h.type)}`
              : h.k
  return (
    head +
    '[]'.repeat(chain.headIndex) +
    chain.segs.map((s) => `.${s.name}${s.call ? '()' : ''}${'[]'.repeat(s.index)}`).join('')
  )
}

function chains(facts: FileFacts): string[] {
  return facts.chains.map(show)
}

function typeUses(facts: FileFacts, ctx?: TypeUseContext): string[] {
  return facts.typeUses
    .filter((use) => !ctx || use.ctx === ctx)
    .map((use) => `${ctx ? '' : `${use.ctx} `}${ref(use.ref)}`)
}

function strings(facts: FileFacts): string[] {
  return facts.strings.map((s) => `${s.tier} ${s.value}`)
}

// 메서드 하나에 문장을 넣은 파일(필드 robot은 생성 형식)
function inMethod(statements: string, params = '', members = ''): FileFacts {
  return extractFactsOrThrow(
    `package p;\nclass T {\n  RobotHardware robot;\n  ${members}\n  void f(${params}) {\n    ${statements}\n  }\n}\n`
  )
}

describe('패키지와 import', () => {
  it('네 가지 import를 이름 배열로 모으고 import 사용을 남긴다', () => {
    const facts = extractFactsOrThrow(`
      package org.firstinspires.ftc.teamcode;
      import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;
      import org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift;
      import java.util.*;
      import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.CONFIGURATION_NAME;
      import static org.firstinspires.ftc.teamcode.c.Globals.robot;
      import static org.firstinspires.ftc.teamcode.d.Other.robot;
      import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift.*;
      class A {}
    `)
    expect(facts.pkg).toBe('org.firstinspires.ftc.teamcode')
    const { single, onDemand, staticSingle, staticOnDemand } = facts.imports
    expect(single.get('RobotHardware')).toEqual([
      'org',
      'firstinspires',
      'ftc',
      'teamcode',
      'sandbot',
      'RobotHardware'
    ])
    expect(single.get('Lift')?.slice(-2)).toEqual(['RobotHardware', 'Lift'])
    expect(onDemand).toEqual([['java', 'util']])
    expect(staticSingle.get('CONFIGURATION_NAME')?.[0].slice(-2)).toEqual([
      'RobotHardware',
      'CONFIGURATION_NAME'
    ])
    // 같은 이름을 여러 형식에서 static import할 수 있다
    expect(staticSingle.get('robot')?.map((names) => names[names.length - 2])).toEqual([
      'Globals',
      'Other'
    ])
    expect(staticOnDemand.map((names) => names.slice(-2))).toEqual([['RobotHardware', 'Lift']])
    expect(facts.importUses.map((use) => use.importKind)).toEqual([
      'single',
      'single',
      'onDemand',
      'static',
      'static',
      'static',
      'staticOnDemand'
    ])
    const lift = facts.importUses[1]
    expect(lift.ctx).toBe('import')
    expect(lift.snippet).toBe('import org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift')
    expect(lift.line).toBe(4)
    // 마지막 이름의 위치와 스니펫 표시
    const last = lift.marks[lift.marks.length - 1]
    expect(lift.snippet.slice(last[0], last[1])).toBe('Lift')
    expect(lift.positions[5][1]).toBe(lift.col - 'RobotHardware.'.length)
    expect(facts.importUses[6].snippet).toMatch(/^import static .*\.Lift\.\*$/)
    // import 사용은 typeUses에 넣지 않는다
    expect(facts.typeUses).toEqual([])
  })

  it('패키지가 없으면 빈 이름이다(기본 패키지)', () => {
    expect(extractFactsOrThrow('class A {}').pkg).toBe('')
  })
})

describe('클래스 개요', () => {
  it('필드: 접근·static, 선언자 여럿, C 방식 차원, stringLit', () => {
    const facts = extractFactsOrThrow(`
      public class A {
        public static final String LF = "leftFront", RF = " rightFront ";
        private RobotHardware robot, spare[];
        protected int count = 1, other;
        RobotHardware.Lift lift = robot.lift;
        static String EXPR = "a" + "b";
        String EMPTY = "  ";
      }
    `)
    const fields = facts.classes[0].fields
    expect(fields.get('LF')).toMatchObject({ access: 'public', isStatic: true })
    expect(fields.get('LF')?.stringLit).toMatchObject({
      value: 'leftFront',
      line: 3,
      snippet: 'LF = "leftFront"'
    })
    const lit = fields.get('RF')!.stringLit!
    expect(lit.value).toBe('rightFront')
    expect(lit.snippet.slice(lit.mark[0], lit.mark[1])).toBe('" rightFront "')
    expect(fields.get('robot')).toMatchObject({ access: 'private', isStatic: false })
    expect(ref(fields.get('robot')!.type)).toBe('RobotHardware')
    expect(ref(fields.get('spare')!.type)).toBe('RobotHardware[]')
    // 기본형은 형식이 없다(그래도 필드는 있다)
    expect(fields.get('count')).toMatchObject({ type: null, access: 'protected' })
    expect(fields.has('other')).toBe(true)
    expect(fields.get('lift')?.access).toBe('package')
    expect(fields.get('EXPR')?.stringLit).toBeUndefined()
    expect(fields.get('EMPTY')?.stringLit).toBeUndefined()
    // 필드 초기값은 연쇄로 남는다
    expect(chains(facts)).toContain('N:robot.lift')
    expect(typeUses(facts, 'decl')).toEqual([
      'String',
      'RobotHardware',
      'RobotHardware.Lift',
      'String',
      'String'
    ])
  })

  it('인터페이스 필드는 public static, 메서드는 public', () => {
    const facts = extractFactsOrThrow(`
      interface Config { String NAME = "x"; RobotHardware robot(); static int k() { return 0; } }
    `)
    const config = facts.classes[0]
    expect(config.kind).toBe('interface')
    expect(config.fields.get('NAME')).toMatchObject({ access: 'public', isStatic: true })
    expect(config.methods.get('robot')).toEqual([
      {
        ret: expect.objectContaining({ names: ['RobotHardware'] }),
        access: 'public',
        isStatic: false
      }
    ])
    expect(config.methods.get('k')?.[0]).toMatchObject({ ret: null, isStatic: true })
  })

  it('메서드: 반환 형식(void·기본형은 null), 오버로드, 생성자는 넣지 않는다', () => {
    const facts = extractFactsOrThrow(`
      class A {
        A(HardwareMap hw) { }
        RobotHardware make() { return null; }
        RobotHardware make(int k) { return null; }
        void run() { }
        int count() { return 0; }
        static RobotHardware[] all() { return null; }
        RobotHardware legacy()[] { return null; }
      }
    `)
    const methods = facts.classes[0].methods
    expect(methods.has('A')).toBe(false)
    expect(methods.get('make')?.map((m) => ref(m.ret))).toEqual(['RobotHardware', 'RobotHardware'])
    expect(methods.get('run')?.[0].ret).toBeNull()
    expect(methods.get('count')?.[0].ret).toBeNull()
    expect(ref(methods.get('all')![0].ret)).toBe('RobotHardware[]')
    expect(methods.get('all')?.[0].isStatic).toBe(true)
    expect(ref(methods.get('legacy')![0].ret)).toBe('RobotHardware[]')
  })

  it('상위 형식, 멤버 형식, 형식 매개변수의 경계(Q9c)', () => {
    const facts = extractFactsOrThrow(`
      class Outer<R extends RobotHardware & Cloneable> extends Base<R> implements A, B.C {
        static class Inner extends RobotHardware { }
        interface Api extends X, Y { }
        enum Mode { A, B }
        @interface Note { String value() default "x"; }
        <T extends RobotHardware.Lift> void g(T t) { t.liftLeft.setPower(1); }
      }
    `)
    const [outer, inner, api, mode, note] = facts.classes
    expect(ref(outer.superRef)).toBe('Base')
    expect(outer.superRef!.args.map(ref)).toEqual(['R'])
    expect(outer.ifaceRefs.map(ref)).toEqual(['A', 'B.C'])
    expect([...outer.members]).toEqual([
      ['Inner', 1],
      ['Api', 2],
      ['Mode', 3],
      ['Note', 4]
    ])
    expect(inner).toMatchObject({ name: 'Inner', outer: 0, local: false })
    expect(api.kind).toBe('interface')
    expect(api.superRef).toBeNull()
    expect(api.ifaceRefs.map(ref)).toEqual(['X', 'Y'])
    expect(mode.kind).toBe('enum')
    expect([...mode.fields.keys()]).toEqual(['A', 'B'])
    expect(note.kind).toBe('annotation')

    // 클래스 머리의 형식 매개변수: 몸통 단계의 부모 단계에 있다
    const body = facts.typeScopes[outer.typeScope]
    expect(body.cls).toBe(0)
    const header = facts.typeScopes[body.parent]
    expect(header.cls).toBe(-1)
    expect(ref(header.params.get('R')!)).toBe('RobotHardware')
    // 상위 형식은 머리 단계에서 푼다(자기 멤버 형식이 보이지 않는다)
    expect(outer.superRef!.scope).toBe(body.parent)

    // 메서드 형식 매개변수 T의 경계. 매개변수 t의 형식은 그 메서드 단계의 T다.
    const t = facts.chains.find((c) => c.head.k === 'local')!
    expect(show(t)).toBe('L:t:T.liftLeft.setPower()')
    const tType = (t.head as { type: TypeRef }).type
    const methodScope = facts.typeScopes[tType.scope]
    expect(methodScope.cls).toBe(-1)
    expect(methodScope.parent).toBe(outer.typeScope)
    expect(ref(methodScope.params.get('T')!)).toBe('RobotHardware.Lift')
    expect(typeUses(facts, 'extends')).toEqual(
      expect.arrayContaining([
        'RobotHardware',
        'Cloneable',
        'Base',
        'A',
        'B.C',
        'RobotHardware.Lift'
      ])
    )
  })

  it('enum 상수: enum 형식의 public static 필드, 인자는 연쇄, 몸통은 익명 클래스(Q6c)', () => {
    const facts = extractFactsOrThrow(`
      class Q6 {
        static RobotHardware robot = new RobotHardware();
        enum Mode {
          A(robot.lift.liftLeft), B("liftLeft") { void f() { robot.leftFront.setPower(0); } };
          Mode(Object o) { }
        }
      }
    `)
    const mode = facts.classes[1]
    expect(mode.fields.get('A')).toMatchObject({ access: 'public', isStatic: true })
    expect(ref(mode.fields.get('A')!.type)).toBe('Mode')
    const anon = facts.classes[2]
    expect(anon).toMatchObject({ name: null, outer: 1, local: true, captured: null })
    expect(ref(anon.superRef)).toBe('Mode')
    expect(chains(facts)).toEqual(['N:robot.lift.liftLeft', 'N:robot.leftFront.setPower()'])
    // 상수 인자 안 연쇄의 cls는 enum이다
    expect((facts.chains[0].head as { cls: number }).cls).toBe(1)
    expect((facts.chains[1].head as { cls: number }).cls).toBe(2)
    expect(strings(facts)).toEqual(['text liftLeft'])
  })

  it('필드 초기값·static 블록·인스턴스 초기화 블록도 훑는다(Q6a, Q6b)', () => {
    const facts = extractFactsOrThrow(`
      class Q6 {
        static RobotHardware robot = new RobotHardware();
        final Object m = robot.lift.liftLeft, n = robot.lift;
        static { robot.leftFront.setPower(0); }
        { robot.lift.claw.grip.setPosition(0); }
      }
    `)
    expect(chains(facts)).toEqual([
      'N:robot.lift.liftLeft',
      'N:robot.lift',
      'N:robot.leftFront.setPower()',
      'N:robot.lift.claw.grip.setPosition()'
    ])
  })

  it('필드 초기값의 형식 인자 쉼표는 선언자를 나누지 않는다', () => {
    const facts = extractFactsOrThrow(`
      class A {
        Map<String, Integer> m = new HashMap<String, Integer>(), n = Util.<String, Integer>make();
        boolean a = x < y, b = z > w;
      }
    `)
    expect([...facts.classes[0].fields.keys()]).toEqual(['m', 'n', 'a', 'b'])
  })
})

describe('지역 변수', () => {
  it('문장 자리의 선언만 지역 변수다', () => {
    const facts = inMethod(`
      RobotHardware r = robot;
      r.lift.liftLeft.setPower(1);
      robot.lift.liftLeft.setPower(1);
      final @SuppressWarnings("x") RobotHardware.Lift l = r.lift;
      l.claw.grip.setPosition(0);
      x = robot;
      List<RobotHardware> list = null;
      int robot2 = 0;
    `)
    expect(chains(facts)).toEqual([
      'N:robot',
      'L:r:RobotHardware.lift.liftLeft.setPower()',
      'N:robot.lift.liftLeft.setPower()',
      'L:r:RobotHardware.lift',
      'L:l:RobotHardware.Lift.claw.grip.setPosition()',
      'N:x',
      'N:robot'
    ])
    // 애너테이션 안 문자열은 사용처가 아니다
    expect(facts.strings).toEqual([])
    expect(typeUses(facts, 'decl')).toEqual([
      'RobotHardware',
      'RobotHardware',
      'RobotHardware.Lift',
      'List'
    ])
    expect(typeUses(facts, 'typeArg')).toEqual(['RobotHardware'])
  })

  it('지역 변수는 자기 초기값에서도 보이고 블록이 끝나면 사라진다', () => {
    const facts = inMethod(`
      { String robot = "x"; robot.length(); }
      robot.leftFront.setPower(0);
      RobotHardware self = self.lift;
    `)
    expect(chains(facts)).toEqual([
      'L:robot:String.length()',
      'N:robot.leftFront.setPower()',
      'L:self:RobotHardware.lift'
    ])
  })

  it('선언자 이어 쓰기와 C 방식 배열 뒤의 둘째 선언자(Q4)', () => {
    const facts = inMethod(
      `
      RobotHardware a = x, b = new RobotHardware();
      b.lift.liftLeft.setPower(1);
      RobotHardware.Lift arr[] = { x.lift }, single = x.lift;
      single.liftLeft.setPower(1);
      arr[0].liftLeft.setPower(1);
    `,
      'RobotHardware x'
    )
    expect(chains(facts)).toEqual([
      'L:b:RobotHardware.lift.liftLeft.setPower()',
      'L:x:RobotHardware.lift',
      'L:x:RobotHardware.lift',
      'L:single:RobotHardware.Lift.liftLeft.setPower()',
      'L:arr:RobotHardware.Lift[][].liftLeft.setPower()'
    ])
  })

  it('이름표·else·try·finally·do 뒤의 블록도 문장 자리다(그 안의 지역 변수)', () => {
    const facts = inMethod(`
      outer: for (RobotHardware r : bots) if (a) { } else { RobotHardware.Lift robot = r.lift; robot.liftLeft.setPower(1); }
      try { RobotHardware robot = null; robot.leftFront.setPower(0); }
      finally { RobotHardware.Lift robot = null; robot.claw.grip.setPosition(0); }
      do { RobotHardware robot = null; robot.lift.claw.grip.setPosition(1); } while (c);
      label: { RobotHardware robot = null; robot.lift.liftLeft.setPower(0); }
      robot.leftFront.setPower(1);
    `)
    expect(chains(facts)).toEqual([
      'N:bots',
      'N:a',
      'L:r:RobotHardware.lift',
      'L:robot:RobotHardware.Lift.liftLeft.setPower()',
      'L:robot:RobotHardware.leftFront.setPower()',
      'L:robot:RobotHardware.Lift.claw.grip.setPosition()',
      'L:robot:RobotHardware.lift.claw.grip.setPosition()',
      'N:c',
      'L:robot:RobotHardware.lift.liftLeft.setPower()',
      'N:robot.leftFront.setPower()'
    ])
  })

  it('매개변수: 가변 인자는 차원 +1, final·애너테이션을 건너뛴다', () => {
    const facts = inMethod(
      'bots[0].lift.liftLeft.setPower(1); hw.dcMotor.get("x");',
      'final @NonNull HardwareMap hw, RobotHardware... bots'
    )
    expect(chains(facts)).toEqual([
      'L:bots:RobotHardware[][].lift.liftLeft.setPower()',
      'L:hw:HardwareMap.dcMotor.get()'
    ])
    expect(strings(facts)).toEqual(['lookup x'])
  })
})

describe('for·catch·try 범위', () => {
  it('for-each 변수는 중괄호 없는 몸통 끝까지(H4, H5)', () => {
    const facts = inMethod(`
      for (PracticeBotHardware robot : new PracticeBotHardware[0]) robot.liftLeft.setPower(1);
      robot.lift.liftLeft.setPower(1);
      for (int i = 0, n = 2; i < n; i++) { RobotHardware robot = null; robot.leftFront.setPower(i); }
      robot.leftFront.setPower(0);
    `)
    expect(chains(facts)).toEqual([
      'L:robot:PracticeBotHardware.liftLeft.setPower()',
      'N:robot.lift.liftLeft.setPower()',
      'L:robot:RobotHardware.leftFront.setPower()',
      'N:robot.leftFront.setPower()'
    ])
    expect(facts.typeUses.find((use) => use.snippet.startsWith('new '))?.snippet).toBe(
      'new PracticeBotHardware[…]'
    )
  })

  it('catch 매개변수는 catch 블록 안에서만, finally는 밖(Q3), 합 형식은 null', () => {
    const facts = inMethod(`
      try { robot.leftFront.setPower(0); }
      catch (RuntimeException robot) { robot.getMessage(); }
      catch (IllegalStateException | IllegalArgumentException robot) { robot.getCause(); }
      finally { robot.lift.liftLeft.setPower(0); }
    `)
    expect(chains(facts)).toEqual([
      'N:robot.leftFront.setPower()',
      'L:robot:RuntimeException.getMessage()',
      'L:robot:null.getCause()',
      'N:robot.lift.liftLeft.setPower()'
    ])
  })

  it('try 자원은 try 블록 안에서만', () => {
    const facts = inMethod(`
      try (RobotHardware robot = make(); Lift l = robot.lift) { robot.leftFront.setPower(1); }
      catch (Exception e) { robot.leftFront.setPower(0); }
    `)
    expect(chains(facts)).toEqual([
      'L:robot:RobotHardware.lift',
      'L:robot:RobotHardware.leftFront.setPower()',
      'N:robot.leftFront.setPower()'
    ])
  })
})

describe('람다', () => {
  it('형식 없는 매개변수는 필드를 가리고(null), 식 몸통은 다음 인자 앞에서 끝난다(Q2)', () => {
    const facts = inMethod('both(robot -> robot.length(), robot.lift.liftLeft);')
    expect(chains(facts)).toEqual(['L:robot:null.length()', 'N:robot.lift.liftLeft'])
  })

  it('형식 있는 매개변수, 괄호 매개변수, 블록 몸통(H7, H8, H9)', () => {
    const facts = inMethod(`
      Runnable r = () -> robot.lift.liftLeft.setPower(1);
      Consumer<RobotHardware.Lift> c = (RobotHardware.Lift robot) -> robot.liftLeft.setPower(1);
      Consumer<RobotHardware> d = rb -> rb.lift.liftLeft.setPower(1);
      BiConsumer<A, B> e = (robot, other) -> { RobotHardware x = null; robot.go(); x.lift.claw.grip.setPosition(1); };
      robot.leftFront.setPower(1);
    `)
    expect(chains(facts)).toEqual([
      'N:robot.lift.liftLeft.setPower()',
      'L:robot:RobotHardware.Lift.liftLeft.setPower()',
      'L:rb:null.lift.liftLeft.setPower()',
      'L:robot:null.go()',
      'L:x:RobotHardware.lift.claw.grip.setPosition()',
      'N:robot.leftFront.setPower()'
    ])
  })
})

describe('switch', () => {
  it('switch 블록은 모든 case에 걸친 프레임 하나다(Q7)', () => {
    const facts = extractFactsOrThrow(`
      class Q7 {
        String robot = "field";
        void f(int k, RobotHardware r) {
          switch (k) {
            case 0: RobotHardware robot = r; break;
            case 1: robot = r; robot.lift.liftLeft.setPower(1); break;
            default: robot.leftFront.setPower(0);
          }
          robot.length();
        }
      }
    `)
    expect(chains(facts)).toEqual([
      'L:robot:RobotHardware.lift.liftLeft.setPower()',
      'L:robot:RobotHardware.leftFront.setPower()',
      'N:robot.length()'
    ])
  })

  it('enum case 라벨의 이름은 연쇄가 아니다', () => {
    const facts = inMethod('switch (mode) { case LIFT_LEFT: break; case Other.X: break; }')
    expect(chains(facts)).toEqual(['N:mode', 'N:Other.X'])
  })
})

describe('익명·지역 클래스', () => {
  it('익명 클래스: 상위 형식, 잡힌 지역 변수, 몸통의 이름은 그 클래스에서 푼다(H10)', () => {
    const facts = inMethod(`
      String robot = "local";
      RobotHardware hw = null;
      new BaseOpMode(hw.lift) { public void runOpMode() { robot.lift.liftLeft.setPower(1); } };
      Object o = new Runnable() { public void run() { } }.toString();
    `)
    const anon = facts.classes[1]
    expect(anon).toMatchObject({ name: null, outer: 0, local: true })
    expect(ref(anon.superRef)).toBe('BaseOpMode')
    expect([...anon.captured!.keys()].sort()).toEqual(['hw', 'robot'])
    expect(ref(anon.captured!.get('robot')!)).toBe('String')
    expect(facts.typeScopes[anon.typeScope].cls).toBe(1)
    expect(chains(facts)).toEqual([
      'L:hw:RobotHardware.lift',
      'new:Runnable{}.toString()',
      'N:robot.lift.liftLeft.setPower()'
    ])
    // 익명 클래스 몸통의 연쇄는 그 클래스(1)에서 푼다
    expect((facts.chains[2].head as { cls: number }).cls).toBe(1)
    // new 머리의 anon은 익명 클래스 번호다
    expect((facts.chains[1].head as { anon: number }).anon).toBe(2)
    expect(typeUses(facts, 'new')).toEqual(['BaseOpMode', 'Runnable'])
  })

  it('지역 클래스: 이름으로 풀지 않고(바깥 이름을 가린다), 잡힌 지역 변수를 둔다', () => {
    const facts = inMethod(`
      RobotHardware hw = null;
      class Lift extends Base { void g() { hw.leftFront.setPower(1); } }
      Lift mine = new Lift();
      mine.liftLeft = 3;
    `)
    const local = facts.classes[1]
    expect(local).toMatchObject({ name: 'Lift', outer: 0, local: true })
    expect([...local.captured!.keys()]).toEqual(['hw'])
    expect(facts.classes[0].members.has('Lift')).toBe(false)
    // 지역 클래스 뒤의 'Lift'는 알 수 없는 형식(null 경계의 매개변수)으로 가린다
    const decl = facts.typeUses.find((use) => use.snippet === 'Lift mine')!
    const scope = facts.typeScopes[decl.ref.scope]
    expect(scope.cls).toBe(-1)
    expect(scope.params.has('Lift')).toBe(true)
    expect(scope.params.get('Lift')).toBeNull()
    // 지역 클래스 자신도 그 단계 안에 있다
    expect(facts.typeScopes[local.typeScope].parent).toBe(decl.ref.scope)
    expect(chains(facts)).toEqual(['L:mine:Lift.liftLeft', 'N:hw.leftFront.setPower()'])
  })
})

describe('캐스트와 그 밖의 형식 사용', () => {
  it('캐스트는 형식 사용이고 피연산자 연쇄는 따로 읽는다(Q5)', () => {
    const facts = inMethod(
      'Object a = (Object) h.lift.liftLeft; Object b = (RobotHardware.Lift[]) o; int c = (int) -x;',
      'Holder h, Object o'
    )
    // 기본형 캐스트 (int) -x의 x는 따로 읽는 이름이다
    expect(chains(facts)).toEqual(['L:h:Holder.lift.liftLeft', 'N:x'])
    expect(typeUses(facts, 'cast')).toEqual(['Object', 'RobotHardware.Lift[]'])
  })

  it('((T) e).f는 cast 머리다(H11), 괄호 식은 머리가 없다(H17)', () => {
    const facts = inMethod(
      '((RobotHardware.Lift) o).liftLeft.setPower(1); (true ? robot : null).lift.liftLeft.setPower(1); (a + b).toString();',
      'Object o'
    )
    expect(chains(facts)).toEqual([
      'cast:RobotHardware.Lift.liftLeft.setPower()',
      'N:robot',
      'N:a',
      'N:b'
    ])
  })

  it('instanceof, .class, ::new, ::m, 형식 인자가 붙은 메서드 참조', () => {
    const facts = inMethod(`
      boolean k = o instanceof RobotHardware.Lift;
      Object a = RobotHardware.Lift.class;
      Object b = RobotHardware[].class;
      Supplier<RobotHardware> s = RobotHardware::new;
      Function<Object, String> f = RobotHardware.Lift::toString;
      Function<List<String>, Integer> g = List<String>::size;
    `)
    expect(typeUses(facts, 'instanceof')).toEqual(['RobotHardware.Lift'])
    expect(typeUses(facts, 'classLit')).toEqual(['RobotHardware.Lift', 'RobotHardware[]'])
    expect(typeUses(facts, 'methodRef')).toEqual(['RobotHardware', 'RobotHardware.Lift', 'List'])
    const classLit = facts.typeUses.find((use) => use.ctx === 'classLit')!
    expect(classLit.snippet).toBe('RobotHardware.Lift.class')
    expect(classLit.snippet.slice(...classLit.marks[1])).toBe('Lift')
    // ::new·.class는 연쇄를 남기지 않고, 표현식일 수도 있는 Name::m은 둘 다 남긴다
    expect(chains(facts)).toEqual(['N:o', 'N:RobotHardware.Lift'])
  })

  it('명시한 메서드 형식 인자와 생성자 형식 인자는 typeArg다', () => {
    const facts = inMethod(`
      List<RobotHardware.Lift> l = Collections.<RobotHardware.Lift>emptyList();
      Map<String, RobotHardware> m = new HashMap<>();
      this.<RobotHardware>pick().lift.liftLeft.setPower(1);
    `)
    expect(typeUses(facts, 'typeArg')).toEqual([
      'RobotHardware.Lift',
      'RobotHardware.Lift',
      'String',
      'RobotHardware',
      'RobotHardware'
    ])
    expect(chains(facts)).toEqual([
      'N:Collections.emptyList()',
      'this.pick().lift.liftLeft.setPower()'
    ])
  })

  it('throws·반환·매개변수 형식은 decl, 상위 형식은 extends', () => {
    const facts = extractFactsOrThrow(`
      class A extends RobotHardware implements Api {
        RobotHardware.Lift make(RobotHardware.Lift.Claw c) throws LiftException { return null; }
      }
    `)
    expect(typeUses(facts, 'extends')).toEqual(['RobotHardware', 'Api'])
    expect(facts.typeUses.filter((u) => u.ctx === 'decl').map((u) => u.snippet)).toEqual([
      'RobotHardware.Lift.Claw c',
      'RobotHardware.Lift make(…)',
      'throws LiftException'
    ])
  })
})

describe('연쇄의 머리', () => {
  it('this, super, Outer.this, 한정 없는 호출, new', () => {
    const facts = extractFactsOrThrow(`
      class MyRobot extends RobotHardware {
        RobotHardware make() { return this; }
        void f() {
          leftFront.setPower(1);
          this.lift.liftLeft.setPower(1);
          super.lift.claw.grip.setPosition(0);
          make().lift.liftLeft.setPower(1);
          new RobotHardware(hardwareMap).lift.liftLeft.setPower(0);
          double k = PAR_X_MM;
          Runnable r = new Runnable() { public void run() { MyRobot.this.lift.liftLeft.setPower(1); } };
        }
      }
    `)
    expect(chains(facts)).toEqual([
      'N:leftFront.setPower()',
      'this.lift.liftLeft.setPower()',
      'super.lift.claw.grip.setPosition()',
      'C:make.lift.liftLeft.setPower()',
      'new:RobotHardware.lift.liftLeft.setPower()',
      'N:hardwareMap',
      'N:PAR_X_MM',
      'N:MyRobot',
      'this.lift.liftLeft.setPower()'
    ])
    // Outer.this는 그 바깥 클래스(0)의 this다
    expect(facts.chains[8].head).toEqual({ k: 'this', cls: 0 })
    expect(facts.chains[8].text).toBe('MyRobot.this')
    expect(facts.chains[3].text).toBe('make(…)')
    expect(facts.chains[4].text).toBe('new RobotHardware(…)')
  })

  it('정적 접근·전체 이름·첨자(H15, H16, G2)', () => {
    const facts = inMethod(`
      double x = RobotHardware.Lift.ENC_X_MM + org.firstinspires.ftc.teamcode.sandbot.RobotHardware.PAR_X_MM;
      Globals.bots[0].leftFront.setPower(1);
      getBots()[1].lift.liftLeft.setPower(1);
    `)
    expect(chains(facts)).toEqual([
      'N:RobotHardware.Lift.ENC_X_MM',
      'N:org.firstinspires.ftc.teamcode.sandbot.RobotHardware.PAR_X_MM',
      'N:Globals.bots[].leftFront.setPower()',
      'C:getBots[].lift.liftLeft.setPower()'
    ])
  })

  it('주석은 연쇄를 끊지 않고, 주석 안 글자는 사용처가 아니다', () => {
    const facts = inMethod(`
      robot . lift /* c */ . claw // 줄 주석
        . grip.setPosition(0);
      // robot.lift.liftLeft.setPower(1);
      /* robot.leftFront */
    `)
    expect(chains(facts)).toEqual(['N:robot.lift.claw.grip.setPosition()'])
  })

  it('위치: 머리와 세그먼트의 줄·열(1부터, UTF-16), CRLF와 BOM', () => {
    const source =
      '﻿class A {\r\n  void f() {\r\n    robot.lift\r\n      .liftLeft = null; 한글.x = 1;\r\n  }\r\n}\r\n'
    const facts = extractFactsOrThrow(source)
    const [chain, korean] = facts.chains
    expect([chain.line, chain.col]).toEqual([3, 5])
    expect(chain.segs.map((s) => [s.name, s.line, s.col])).toEqual([
      ['lift', 3, 11],
      ['liftLeft', 4, 8]
    ])
    expect([korean.line, korean.col]).toEqual([4, 25])
    // 첫 줄의 BOM은 열로 세지 않는다
    const bom = extractFactsOrThrow('﻿class A { Object o = robot.lift; }')
    expect(bom.chains[0].col).toBe(22)
  })

  it(`세그먼트는 ${MAX_SEGMENTS}개까지만 둔다`, () => {
    const facts = inMethod(`robot${'.a'.repeat(MAX_SEGMENTS + 10)}.b();`)
    expect(facts.chains[0].segs).toHaveLength(MAX_SEGMENTS)
    expect(facts.skipped).toBeUndefined()
  })
})

describe('문자열', () => {
  it('찾기: hardwareMap.get, hardwareMap.dcMotor.get, HardwareMap 형식 변수(Pushbot)', () => {
    const facts = extractFactsOrThrow(`
      class Drive {
        HardwareMap hwMap;
        Drive(HardwareMap hardwareMap) {
          hardwareMap.get(DcMotorEx.class, "leftFront");
          hardwareMap.dcMotor.get("leftBack");
          opMode.hardwareMap.get(Servo.class, "claw");
          this.hardwareMap.servo.get("wrist");
        }
        void init(HardwareMap ahwMap) {
          hwMap = ahwMap;
          hwMap.get(DcMotor.class, "left_drive");
          ahwMap.get(DcMotor.class, "right_drive");
          hardwareMap.appContext.getResources().getIdentifier("RelativeLayout", "id", "pkg");
        }
      }
    `)
    expect(strings(facts)).toEqual([
      'lookup leftFront',
      'lookup leftBack',
      'lookup claw',
      'lookup wrist',
      'lookup left_drive',
      'lookup right_drive',
      // 호출 결과는 HardwareMap 식이 아니다
      'text RelativeLayout',
      'text id',
      'text pkg'
    ])
    const first = facts.strings[0]
    expect(first.snippet).toBe('hardwareMap.get(…, "leftFront")')
    expect(first.snippet.slice(first.mark[0], first.mark[1])).toBe('"leftFront"')
    expect([first.line, first.col]).toEqual([5, 44])
    expect(facts.strings[1].snippet).toBe('hardwareMap.dcMotor.get("leftBack")')
  })

  it('찾기: 다른 인자가 HardwareMap 식인 호출·new(FTCLib, Road Runner)', () => {
    const facts = inMethod(`
      new MotorEx(hardwareMap, "fl");
      new MotorEx(hardwareMap, "fr", Motor.GoBILDA.RPM_312);
      imu = new LazyHardwareMapImu(hardwareMap, "imu", new RevHubOrientationOnRobot(a, b));
      super.init(opMode.hardwareMap, "arm");
      new Thing(notAMap, "x");
    `)
    expect(strings(facts)).toEqual(['lookup fl', 'lookup fr', 'lookup imu', 'lookup arm', 'text x'])
    expect(facts.strings[1].snippet).toBe('new MotorEx(…, "fr", …)')
    expect(facts.strings[2].snippet).toBe('new LazyHardwareMapImu(…, "imu", …)')
  })

  it('찾기: 이름이 Name으로 끝나는 메서드(Pedro Pathing)', () => {
    const facts = extractFactsOrThrow(`
      class Constants {
        static MecanumConstants drive = new MecanumConstants()
            .maxPower(1)
            .leftFrontMotorName("leftFront")
            .rightRearMotorName("rightBack");
        static PinpointConstants pinpoint = new PinpointConstants().forwardPodY(-5).hardwareMapName("pinpoint");
      }
    `)
    expect(strings(facts)).toEqual(['lookup leftFront', 'lookup rightBack', 'lookup pinpoint'])
    expect(facts.strings[0].snippet).toMatch(/\.leftFrontMotorName\("leftFront"\)$/)
  })

  it('찾기가 아닌 같은 글자는 text이고, 애너테이션 안은 아예 없다', () => {
    const facts = extractFactsOrThrow(`
      @TeleOp(name = "arm", group = "arm")
      class Main extends LinearOpMode {
        @Override public void runOpMode() {
          telemetry.addData("arm", arm.getPower());
          @SuppressWarnings("arm") String s = "arm";
          if (s.equals("arm")) telemetry.addLine("arm " + s);
          String empty = "   ";
          String tooLong = "${'x'.repeat(200)}";
        }
      }
    `)
    expect(strings(facts)).toEqual(['text arm', 'text arm', 'text arm', 'text arm'])
    expect(facts.strings.map((s) => s.snippet)).toEqual([
      'telemetry.addData("arm", …)',
      's = "arm"',
      's.equals("arm")',
      '"arm "'
    ])
  })

  it('찾기 인자인 같은 파일의 String 상수·지역 변수는 그 초기값이 lookup이다', () => {
    const facts = extractFactsOrThrow(`
      class Drive {
        void init() {
          hardwareMap.get(DcMotorEx.class, LF);
          String rb = "rightBack";
          hardwareMap.get(DcMotorEx.class, rb);
          String unused = "rightBack";
          hardwareMap.get(DcMotorEx.class, Constants.LB);
          hardwareMap.get(DcMotorEx.class, this.RF);
          hardwareMap.get(DcMotorEx.class, OTHER);
          hardwareMap.get(DcMotorEx.class, computed);
        }
        static final String LF = "leftFront";
        static final String RF = "rightFront";
        static String computed = "a" + "b";
      }
    `)
    expect(facts.strings.map((s) => `${s.tier} ${s.snippet}`)).toEqual([
      'lookup rb = "rightBack"',
      'text unused = "rightBack"',
      'lookup LF = "leftFront"',
      'text RF = "rightFront"',
      'text computed = "a" …',
      'text "b"'
    ])
    // 이 파일에서 풀 수 없는 이름은 resolver가 푼다(Constants.LB, this.RF, 상속·static import일 수 있는 OTHER)
    expect(facts.lookupRefs.map(show)).toEqual(['N:Constants.LB', 'this.RF', 'N:OTHER'])
  })

  it('앞뒤 공백을 뺀 값으로 둔다(SDK가 trim한다)', () => {
    const facts = inMethod('hardwareMap.get(DcMotorEx.class, " liftLeft  "); x("\\tarm\\n");')
    expect(facts.strings.map((s) => s.value)).toEqual(['liftLeft', 'arm'])
    expect(facts.strings[0].snippet).toBe('hardwareMap.get(…, " liftLeft  ")')
  })

  it('온전한 인자가 아닌 문자열은 text다', () => {
    const facts = inMethod(`
      hardwareMap.get(DcMotorEx.class, "left" + "Front");
      hardwareMap.get(DcMotorEx.class, cond ? "a" : "b");
      hardwareMap.get(DcMotorEx.class, names[0]);
    `)
    expect(strings(facts)).toEqual(['text left', 'text Front', 'text a', 'text b'])
  })
})

describe('건너뛰는 파일과 한도', () => {
  it('리터럴 밖 \\u 이스케이프가 있으면 빈 사실 + unicodeEscape', () => {
    const facts = extractFacts('class A { void f() { r\\u002elift.liftLeft.setPower(1); } }')
    expect(facts.skipped).toBe('unicodeEscape')
    expect(facts.chains).toEqual([])
    expect(facts.classes).toEqual([])
    // 리터럴 안의 안전한 이스케이프는 괜찮다
    const ok = extractFacts('class A { Object o = hardwareMap.get(X.class, "lift\\u004ceft"); }')
    expect(ok.skipped).toBeUndefined()
    expect(ok.strings[0].value).toBe('liftLeft')
  })

  it(`연쇄가 ${MAX_FACTS}개를 넘으면 빈 사실 + capped`, () => {
    const facts = extractFacts(`class A { void f() { ${'a; '.repeat(MAX_FACTS + 1)} } }`)
    expect(facts.skipped).toBe('capped')
    expect(facts.chains).toEqual([])
  })

  it('쓰는 중인(짝이 맞지 않는) 코드에서도 예외 없이 앞부분을 읽는다', () => {
    const facts = extractFactsOrThrow(
      'class A { RobotHardware robot; void f() { robot.lift.liftLeft.setPower(1); if (x { robot.leftFront'
    )
    expect(chains(facts)).toEqual(['N:robot.lift.liftLeft.setPower()', 'N:x', 'N:robot.leftFront'])
  })
})

describe('메모리 규칙', () => {
  it('사실의 모든 글자는 intern을 거친다(파일 글자의 조각을 붙잡지 않는다)', () => {
    const MARK = '\u0001'
    const facts = extractFactsOrThrow(
      `
      package a.b;
      import static a.B.c;
      import java.util.*;
      @Config class A<T extends RobotHardware> extends Base implements Api {
        static final String LF = "leftFront";
        enum E { X("x") { } }
        <U> U g(T t, int... k) throws Ex { return null; }
        void f(HardwareMap hw) {
          RobotHardware.Lift l = (RobotHardware.Lift) t;
          for (Lift x : list) x.claw.grip.setPosition(0);
          try (R r = open()) { } catch (A | B e) { }
          Runnable q = () -> new Object() { void h() { l.liftLeft.setPower(1); } };
          class Local { }
          hw.get(DcMotorEx.class, LF); hardwareMap.get(X.class, Constants.RB);
          Object c = RobotHardware.Lift.class; Supplier<RobotHardware> s = RobotHardware::new;
          ((RobotHardware.Lift) o).liftLeft.setPower(1); this.lift.liftLeft.setPower(1);
          make().lift.liftLeft.setPower(1); new RobotHardware(hw).lift.liftLeft.setPower(0);
        }
      }
    `,
      (value) => MARK + value
    )
    // 코드가 정한 열거 값(종류·자리·등급 등)은 파일 글자가 아니다
    const ENUM_KEYS = new Set(['k', 'kind', 'ctx', 'tier', 'access', 'importKind', 'skipped'])
    const bad: string[] = []
    const visit = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        if (!value.startsWith(MARK)) bad.push(`${path}=${value}`)
      } else if (value instanceof Map) {
        for (const [key, item] of value) {
          visit(key, `${path}{key}`)
          visit(item, `${path}{${String(key)}}`)
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => visit(item, `${path}[${i}]`))
      } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          if (!ENUM_KEYS.has(key)) visit(item, `${path}.${key}`)
        }
      }
    }
    visit(facts, 'facts')
    expect(bad).toEqual([])
    expect(facts.chains.length).toBeGreaterThan(5)
    expect(facts.strings.length).toBeGreaterThan(1)
  })
})
