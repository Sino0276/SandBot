// 사실 추출의 퍼즈·적대 입력(spec §10.3). 어떤 토큰 수프에도 예외를 던지지 않고(capped 말고는 extractFactsOrThrow도
// 던지지 않는다), 시간은 크기에 거의 비례한다. 시드가 고정이라 실패하면 같은 입력으로 다시 볼 수 있다.
import { describe, expect, it } from 'vitest'
import { MAX_USAGE_FILE_BYTES } from '../../../../shared/ipc'
import { extractFactsOrThrow } from './usageFacts'

// mulberry32: 작고 결정적인 의사 난수
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = [
  'class',
  'interface',
  'enum',
  '@interface',
  'new',
  'this',
  'super',
  'if',
  'else',
  'for',
  'while',
  'do',
  'try',
  'catch',
  'finally',
  'switch',
  'case',
  'default',
  'return',
  'static',
  'final',
  'public',
  'private',
  'int',
  'void',
  'extends',
  'implements',
  'import',
  'package',
  'instanceof',
  'synchronized',
  'break',
  'throw',
  'throws',
  'a',
  'b',
  'robot',
  'lift',
  'liftLeft',
  'hardwareMap',
  'HardwareMap',
  'RobotHardware',
  'Lift',
  'get',
  'leftFrontMotorName',
  'x',
  'List',
  'T',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  ';',
  ',',
  '.',
  '::',
  '->',
  '<',
  '>',
  '=',
  '?',
  ':',
  '@',
  '&',
  '|',
  '+',
  '!',
  '...',
  '"x"',
  '"liftLeft"',
  '" arm "',
  '1',
  '2.0',
  "'c'",
  'true',
  'null',
  '/* c */',
  '// c\n',
  '\n'
]

function soup(next: () => number, tokens: number): string {
  const parts: string[] = []
  for (let i = 0; i < tokens; i++) {
    const r = next()
    // 드물게: 닫히지 않은 문자열·텍스트 블록·리터럴 밖 \u
    if (r < 0.002) parts.push('"open')
    else if (r < 0.003) parts.push('"""')
    else if (r < 0.0035) parts.push('\\u0041')
    else parts.push(WORDS[Math.floor(next() * WORDS.length)])
  }
  return parts.join(' ')
}

// 그럴듯한 코드를 토큰 단위로 망가뜨린다(지우기·겹치기·바꾸기)
const SEEDS = [
  `package org.firstinspires.ftc.teamcode;
import org.firstinspires.ftc.teamcode.sandbot.RobotHardware;
import static org.firstinspires.ftc.teamcode.sandbot.RobotHardware.Lift.*;
@TeleOp(name = "arm")
public class Main extends LinearOpMode {
  static final String LF = "leftFront";
  RobotHardware robot;
  enum Mode { A(robot.lift.liftLeft), B { void f() { } } ; Mode(Object o) { } }
  <T extends RobotHardware> void g(T t, int... k) throws Exception {
    for (RobotHardware.Lift l : lifts) l.claw.grip.setPosition(0);
    try (R r = open()) { } catch (A | B e) { e.go(); } finally { robot.leftFront.setPower(0); }
    switch (k[0]) { case 0: RobotHardware robot = t; break; default: robot.lift.liftLeft.setPower(1); }
    Runnable q = () -> new Object() { void h() { robot.lift.liftLeft.setPower(1); } };
    both(robot -> robot.length(), robot.lift.liftLeft);
    ((RobotHardware.Lift) o).liftLeft.setPower(1);
    hardwareMap.get(DcMotorEx.class, LF); new MotorEx(hardwareMap, "fl");
    Object c = RobotHardware.Lift.class; Supplier<RobotHardware> s = RobotHardware::new;
    class Local extends Base { int x = this.y; }
    label: while (true) if (a) break label; else continue;
    do x(); while (y);
  }
}`,
  `class Constants {
  static MecanumConstants drive = new MecanumConstants().maxPower(1).leftFrontMotorName("leftFront");
  Map<String, Integer> m = new HashMap<String, Integer>(), n = Util.<String, Integer>make();
  boolean a = x < y, b = z > w;
  interface Api extends X, Y { String NAME = "x"; RobotHardware robot(); }
  @interface Note { String value() default "x"; }
}`
]

function mutate(next: () => number, source: string): string {
  const parts = source.split(/(\s+)/)
  const out: string[] = []
  for (const part of parts) {
    const r = next()
    if (r < 0.05) continue
    out.push(part)
    if (r > 0.97) out.push(part)
    else if (r > 0.94) out.push(WORDS[Math.floor(next() * WORDS.length)])
  }
  return out.join('')
}

function bestTime(source: string): number {
  let best = Infinity
  for (let k = 0; k < 3; k++) {
    const started = performance.now()
    extractFactsOrThrow(source)
    best = Math.min(best, performance.now() - started)
  }
  return best
}

describe('퍼즈', () => {
  it('토큰 수프 10 000개: 예외 없음', () => {
    const next = random(20261020)
    let capped = 0
    for (let n = 0; n < 10_000; n++) {
      const source = soup(next, 20 + Math.floor(next() * 300))
      let facts
      try {
        facts = extractFactsOrThrow(source)
      } catch (error) {
        throw new Error(`soup #${n} threw: ${String(error)}\n${source}`)
      }
      if (facts.skipped === 'capped') capped++
    }
    expect(capped).toBe(0)
  })

  it('그럴듯한 코드를 망가뜨린 것 4 000개: 예외 없음', () => {
    const next = random(4)
    for (let n = 0; n < 4_000; n++) {
      const source = mutate(next, SEEDS[n % SEEDS.length])
      try {
        extractFactsOrThrow(source)
      } catch (error) {
        throw new Error(`mutant #${n} threw: ${String(error)}\n${source}`)
      }
    }
  })

  it('망가뜨리지 않은 씨앗은 사실이 있다(퍼즈가 빈 길만 돌지 않게)', () => {
    const facts = extractFactsOrThrow(SEEDS[0])
    expect(facts.skipped).toBeUndefined()
    expect(facts.chains.length).toBeGreaterThan(10)
    expect(facts.strings.some((s) => s.tier === 'lookup')).toBe(true)
  })

  it('시간은 크기에 거의 비례한다(8배 크기에 32배 미만)', () => {
    const small = soup(random(7), 15_000)
    const large = soup(random(7), 120_000)
    const realistic = SEEDS[0].replace(/^package.*$/m, '')
    const ratio = bestTime(large) / Math.max(bestTime(small), 0.5)
    expect(ratio).toBeLessThan(32)
    const realisticRatio =
      bestTime(realistic.repeat(80)) / Math.max(bestTime(realistic.repeat(10)), 0.5)
    expect(realisticRatio).toBeLessThan(32)
  })
})

describe('적대 입력(256 KB)', () => {
  // 제곱 시간이면 수십 초가 걸린다. 시간은 느슨하게만 본다.
  const size = MAX_USAGE_FILE_BYTES
  const patterns: [string, string][] = [
    ['(', '('],
    ['{', '{'],
    ['[', '['],
    ['a.', 'a.'],
    [';', ';'],
    ['a<', 'a<'],
    ['a<b,', 'a<b,'],
    ['for(;;)', 'for(;;)'],
    ['if(a)', 'if(a)'],
    ['x->', 'x->'],
    ['(a)->', '(a)->'],
    ['new A(){', 'new A(){'],
    ['class A{', 'class A{'],
    ['{int a;', '{int a;'],
    ['f(', 'f('],
    ['"x",', '"x",'],
    ['((T)a).', '((T)a).'],
    ['a[0]', 'a[0]'],
    ['((((', '(((('],
    [')]}', ')]}']
  ]
  for (const [name, unit] of patterns) {
    it(`${name} × N`, () => {
      const body = unit.repeat(Math.floor(size / unit.length))
      for (const source of [body, `class A { void f() { ${body} } }`]) {
        const started = performance.now()
        // 한도를 넘으면 capped이고, 그 밖의 예외는 없어야 한다
        expect(() => extractFactsOrThrow(source)).not.toThrow()
        expect(performance.now() - started).toBeLessThan(5000)
      }
    })
  }
})
