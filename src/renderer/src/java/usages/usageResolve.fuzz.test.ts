// 맞추기의 퍼즈·적대 입력(spec §10.3). 어떤 사실에도 resolveUsages가 예외를 던지지 않고, 결과의 모양이 맞고,
// 시간은 파일 수에 거의 비례한다. 시드가 고정이라 실패하면 같은 입력으로 다시 볼 수 있다.
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MAX_USAGE_FILE_BYTES } from '../../../../shared/ipc'
import { corpusScene, renamedCorpusScene } from './__fixtures__/corpusScene'
import { extractFacts, type FileFacts } from './usageFacts'
import { resolveUsages } from './usageResolve'
import { usageSymbols } from './usageSymbols'
import type { UsageResult } from './usageTypes'

const GEN = 'org.firstinspires.ftc.teamcode.sandbot'
const SYMBOLS = usageSymbols(corpusScene())
const RENAMED = usageSymbols(renamedCorpusScene())

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

const pick = <T>(next: () => number, items: readonly T[]): T =>
  items[Math.floor(next() * items.length)]

const WORDS = [
  'class',
  'interface',
  'enum',
  'new',
  'this',
  'super',
  'if',
  'else',
  'for',
  'try',
  'catch',
  'switch',
  'case',
  'return',
  'static',
  'final',
  'private',
  'int',
  'void',
  'extends',
  'implements',
  'instanceof',
  'a',
  'b',
  'robot',
  'lift',
  'liftLeft',
  'claw',
  'grip',
  'leftFront',
  'hardwareMap',
  'HardwareMap',
  'RobotHardware',
  'PracticeBotHardware',
  'Lift',
  'Claw',
  'CONFIGURATION_NAME',
  'PAR_X_MM',
  'ENC_X_MM',
  'get',
  'leftFrontMotorName',
  'Constants',
  'LF',
  'C1',
  'C2',
  'T',
  'org',
  'sandbot',
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
  '"x"',
  '"liftLeft"',
  '"leftFront"',
  '1',
  'null',
  '/* c */',
  '\n'
]

const IMPORTS = [
  `import ${GEN}.RobotHardware;`,
  `import ${GEN}.*;`,
  `import ${GEN}.RobotHardware.*;`,
  `import ${GEN}.RobotHardware.Lift;`,
  `import ${GEN}.Gone;`,
  `import static ${GEN}.RobotHardware.*;`,
  `import static ${GEN}.RobotHardware.Lift.ENC_X_MM;`,
  `import static ${GEN}.RobotHardware.Lift.Claw;`,
  'import p0.*;',
  'import p1.C1;',
  'import static p2.C2.*;',
  'import static p3.C3.robot;',
  'import com.qualcomm.robotcore.hardware.HardwareMap;'
]

function soup(next: () => number, tokens: number): string {
  const parts: string[] = []
  for (let i = 0; i < tokens; i++) parts.push(pick(next, WORDS))
  return parts.join(' ')
}

// 패키지·import·상속이 서로 얽힌 파일들(형식 풀이·상속·static import가 실제로 돈다)
function fuzzFiles(seed: number, count: number, tokens: number): Map<string, FileFacts> {
  const next = random(seed)
  const files = new Map<string, FileFacts>()
  for (let k = 0; k < count; k++) {
    const imports = Array.from({ length: Math.floor(next() * 4) }, () => pick(next, IMPORTS))
    const pkg = next() < 0.05 ? GEN : `p${k % 5}`
    const sup = pick(next, [
      'RobotHardware',
      `C${k + 1}`,
      `p${(k + 1) % 5}.C${k + 2}`,
      'Lift',
      'C0'
    ])
    const text = [
      `package ${pkg};`,
      ...imports,
      `public class C${k} extends ${sup} { RobotHardware robot; static String LF = "leftFront";`,
      soup(next, tokens),
      '}'
    ].join('\n')
    files.set(`src/main/java/p${k % 5}/C${k}.java`, extractFacts(text))
  }
  return files
}

function checkShape(result: UsageResult): void {
  const lists = [
    ...result.hits.values(),
    ...result.unresolved.values(),
    ...result.unknownNames.values()
  ]
  for (const list of lists) {
    for (const hit of list) {
      expect(hit.snippet.length).toBeLessThanOrEqual(96)
      expect(hit.mark[0]).toBeGreaterThanOrEqual(0)
      expect(hit.mark[1]).toBeLessThanOrEqual(hit.snippet.length)
      expect(hit.mark[0]).toBeLessThanOrEqual(hit.mark[1])
      expect(hit.line).toBeGreaterThan(0)
    }
  }
}

describe('맞추기 퍼즈', () => {
  it('얽힌 토큰 수프 파일 10 000개(200개씩)에 예외를 던지지 않는다', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const files = fuzzFiles(seed, 200, 120)
      checkShape(resolveUsages(files, SYMBOLS))
      checkShape(resolveUsages(files, RENAMED))
    }
  })

  it('말뭉치 파일을 토큰 단위로 망가뜨려도(지우기·겹치기·바꾸기) 예외를 던지지 않는다', () => {
    const root = join(__dirname, '__fixtures__', 'corpus', 'src', 'main', 'java')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
      )
    const sources = walk(root).map((path) => readFileSync(path, 'utf8'))
    const next = random(7)
    for (let round = 0; round < 40; round++) {
      const files = new Map<string, FileFacts>()
      sources.forEach((text, i) => {
        const tokens = text.split(/(\s+|[.;(){}[\],])/)
        for (let m = 0; m < 6; m++) {
          const at = Math.floor(next() * tokens.length)
          const r = next()
          if (r < 0.33) tokens.splice(at, 1)
          else if (r < 0.66) tokens.splice(at, 0, tokens[Math.floor(next() * tokens.length)] ?? '')
          else tokens[at] = pick(next, WORDS)
        }
        files.set(`src/main/java/f${i}.java`, extractFacts(tokens.join('')))
      })
      checkShape(resolveUsages(files, round % 2 ? RENAMED : SYMBOLS))
    }
  })

  it('256 KB 적대 입력의 사실도 한도 안에서 맞춘다(시간은 출력만)', () => {
    const size = MAX_USAGE_FILE_BYTES
    const patterns: Record<string, string> = {
      parens: '('.repeat(size),
      braces: `class A { void f() ${'{'.repeat(size - 22)}`,
      chain: `class A { Object f() { return robot${'.lift'.repeat((size - 40) / 5)}; } }`,
      semis: `class A { ${';'.repeat(size - 12)} }`,
      calls: `class A { void f() { ${'robot.lift.liftLeft.setPower(1);'.repeat(size / 33)} } }`,
      names: `class A { void f() { ${'hardwareMap.get(Object.class, "leftFront");'.repeat(size / 44)} } }`
    }
    for (const [name, text] of Object.entries(patterns)) {
      const start = performance.now()
      const files = new Map([[`src/main/java/${name}.java`, extractFacts(text)]])
      const result = resolveUsages(files, SYMBOLS)
      checkShape(result)
      console.log(`적대 입력 ${name}: ${(performance.now() - start).toFixed(0)} ms`)
    }
  })

  it('긴 상속 사슬·깊은 중첩·자기 참조 경계에서도 스택이 넘치지 않는다', () => {
    const files = new Map<string, FileFacts>()
    // 파일 3000개에 걸친 상속 사슬(맨 위만 생성 클래스)
    for (let k = 0; k < 3000; k++) {
      const sup = k === 2999 ? 'org.firstinspires.ftc.teamcode.sandbot.RobotHardware' : `C${k + 1}`
      files.set(
        `src/main/java/p/C${k}.java`,
        extractFacts(
          `package p; class C${k} extends ${sup} { void f() { lift.liftLeft.setPower(1); missing.x(); } }`
        )
      )
    }
    const nested = Array.from({ length: 40 }, (_, i) => `class N${i} extends N${i + 1} {`).join(' ')
    files.set(
      'src/main/java/q/Deep.java',
      extractFacts(
        `package q; class Deep<T extends T, U extends U[]> { T t; U u; ${nested} ${'}'.repeat(40)} void f() { t.x.y(); u[0].z(); } }`
      )
    )
    const result = resolveUsages(files, SYMBOLS)
    checkShape(result)
    // 상속 깊이 한도 안(맨 위에서 64단계)의 클래스는 생성 필드를 찾는다
    expect(result.hits.get('d:liftMotor\nll')?.length ?? 0).toBeGreaterThan(0)
  })

  it('시간은 파일 수에 거의 비례한다', () => {
    const time = (count: number): number => {
      const files = fuzzFiles(99, count, 200)
      const start = performance.now()
      resolveUsages(files, SYMBOLS)
      return performance.now() - start
    }
    time(100)
    const small = Math.max(time(250), 1)
    const large = time(1000)
    console.log(`맞추기: 250개 ${small.toFixed(1)} ms, 1000개 ${large.toFixed(1)} ms`)
    // 4배 파일에 4배 남짓(넉넉히 12배 안)
    expect(large).toBeLessThan(small * 12 + 50)
  })
})
