import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { describe, expect, it } from 'vitest'
import { isLinkableJavaPath } from '../../../../shared/teamCodePaths'
import { corpusScene, renamedCorpusScene } from './__fixtures__/corpusScene'
import { extractFacts, type FileFacts } from './usageFacts'
import { resolveUsages } from './usageResolve'
import { usageSymbols } from './usageSymbols'
import type { SymbolClass, UsageKey, UsageResult, UsageSymbols } from './usageTypes'

// javac와 견주는 사용처 차분 테스트(spec §10.2). 정답표(__fixtures__/golden*.txt)는 scripts/usage-oracle이
// javac의 이름 풀이로 만든 것이고(pnpm usage-oracle, JDK 11+), CI는 JDK 없이 커밋한 정답표만 읽는다.
// - 보통 씬: 코드 사용처(필드·상수·형식)가 정답표(import·한정자 제외)와 같아야 한다. 잘못 찾은 것은 하나도 없어야
//   하고, 찾지 못한 것은 ACCEPTED_FN(spec §12의 한계)과 정확히 같아야 한다. 고칠 때는 ACCEPTED_FN을 늘리지 말고
//   해석기를 고친다.
// - 이름을 바꾼 씬: 생성 코드에 없는 이름(범위 키와 '*')이 javac의 cannot find symbol(경로:줄 이름)과 같아야 한다.
//   javac만 알리는 것은 ACCEPTED_RENAMED_FN(위 한계와 on-demand로 들여온 이름)과 같아야 한다.

const FIXTURES = join(__dirname, '__fixtures__')
const CORPUS = join(FIXTURES, 'corpus')
const T = 'src/main/java/org/firstinspires/ftc/teamcode/'

// 찾지 못해도 되는 코드 사용처(경로:줄:열과 이유)
const ACCEPTED_FN: { at: string; reason: string }[] = [
  { at: `${T}Escapes.java:7:12`, reason: '리터럴 밖 유니코드 이스케이프가 있는 파일은 건너뛴다' },
  // 열은 javac의 끝 위치 - 이름 길이라 이스케이프 글자 수만큼 밀린다
  { at: `${T}Escapes.java:8:21`, reason: '리터럴 밖 유니코드 이스케이프가 있는 파일은 건너뛴다' },
  { at: `${T}LocalClass.java:11:19`, reason: '지역 클래스 이름은 풀지 않는다(K2)' },
  { at: `${T}Shadowing.java:18:70`, reason: '형식 없는 람다 매개변수(H9)' },
  { at: `${T}Shadowing.java:33:22`, reason: '제네릭 반환 형식(H13)' },
  { at: `${T}Shadowing.java:37:36`, reason: '조건식 받는 쪽(H17)' },
  { at: `${T}probes/b/Q10Generic.java:21:20`, reason: '형식 인자 치환(Q10b)' }
]

// javac만 알리는 생성 코드에 없는 이름(경로:줄 이름과 이유)
const ACCEPTED_RENAMED_FN: { at: string; reason: string }[] = [
  ...ACCEPTED_FN.map(({ at, reason }) => {
    const [path, line] = at.split(':')
    return { at: `${path}:${line}`, reason }
  }).map(({ at, reason }) => ({ at: `${at} liftLeft`, reason })),
  { at: `${T}Imports.java:11 Claw`, reason: 'static on-demand로 들여온 멤버 형식(spec §6.5)' },
  { at: `${T}precedence/D.java:9 PAR_X_MM`, reason: 'static on-demand로 들여온 상수(spec §6.5)' },
  // 받는 쪽 없는 이름은 패키지·알 수 없는 형식 이름일 수 있어 알리지 않는다(받는 쪽이 있으면 알린다, SC1–SC4)
  { at: `${T}MyRobot.java:16 PAR_X_MM`, reason: '하위 클래스 안의 받는 쪽 없는 이름(spec §12)' },
  {
    at: `${T}CompetitionRobot.java:12 PAR_X_MM`,
    reason: '하위 클래스 안의 받는 쪽 없는 이름(spec §12)'
  },
  {
    at: `${T}Shadowing.java:13 PracticeBotHardware`,
    reason: '…sandbot.*로 들여온 이름(spec §6.5)'
  },
  {
    at: `${T}Shadowing.java:13 PracticeBotHardware`,
    reason: '…sandbot.*로 들여온 이름(spec §6.5)'
  },
  {
    at: `${T}precedence/sub/B.java:11 PracticeBotHardware`,
    reason: '…sandbot.*로 들여온 이름(spec §6.5)'
  }
].filter(({ at }) => !at.startsWith(`${T}Escapes.java:7 `))

function walk(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...walk(path))
    else if (entry.isFile()) result.push(path)
  }
  return result
}

const posix = (path: string): string => path.split(sep).join('/')
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// scripts/usage-oracle/run.mjs의 corpusHash와 같은 계산(경로 순서로 경로와 CR을 뺀 내용)
function corpusHash(): string {
  const hash = createHash('sha256')
  const files = walk(CORPUS)
    .map((path) => posix(relative(CORPUS, path)))
    .sort(compare)
  for (const path of files) {
    hash.update(`${path}\n`)
    hash.update(readFileSync(join(CORPUS, path), 'utf8').replace(/\r/g, ''))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readGolden(name: string): string[] {
  const [header, ...lines] = readFileSync(join(FIXTURES, name), 'utf8')
    .replace(/\r/g, '')
    .split('\n')
    .filter(Boolean)
  expect(
    header,
    `${name}: 말뭉치가 바뀌었습니다. pnpm usage-oracle로 정답표를 다시 만드세요.`
  ).toBe(`# corpus-sha256 ${corpusHash()}`)
  return lines
}

// 목록이 주는 것과 같은 TeamCode 기준 경로(생성 패키지 폴더 제외)의 사실
function corpusFacts(): Map<string, FileFacts> {
  const files = new Map<string, FileFacts>()
  const paths = walk(join(CORPUS, 'src/main/java'))
    .map((path) => posix(relative(CORPUS, path)))
    .filter(isLinkableJavaPath)
    .sort(compare)
  for (const path of paths) files.set(path, extractFacts(readFileSync(join(CORPUS, path), 'utf8')))
  return files
}

// 키·멤버 이름 → 생성 클래스 경로(RobotHardware.Lift)
function classPaths(symbols: UsageSymbols): {
  member: Map<string, string>
  cls: Map<UsageKey, string>
} {
  const member = new Map<string, string>()
  const cls = new Map<UsageKey, string>()
  const visit = (c: SymbolClass, path: string): void => {
    cls.set(c.key, path)
    for (const f of c.fields) {
      member.set(`${f.key}\n${f.name}`, path)
      if (f.group) visit(f.group, `${path}.${f.group.name}`)
    }
    for (const k of c.constants) member.set(`${k.key}\n${k.name}`, path)
  }
  for (const robot of symbols.robots) visit(robot, robot.name)
  return { member, cls }
}

// 사용처 → 정답표 줄(경로:줄:열 종류 이름). 필드·상수 이름은 스니펫의 맞은 토큰이다.
function typedLines(result: UsageResult, symbols: UsageSymbols): string[] {
  const { member, cls } = classPaths(symbols)
  const lines: string[] = []
  for (const [key, hits] of result.hits) {
    for (const hit of hits) {
      const at = `${hit.path}:${hit.line}:${hit.col}`
      if (hit.kind === 'field' || hit.kind === 'constant') {
        const name = hit.snippet.slice(hit.mark[0], hit.mark[1])
        const owner = member.get(`${key}\n${name}`)
        lines.push(`${at} ${hit.kind === 'field' ? 'field' : 'const'} ${owner ?? '?'}.${name}`)
      } else if (hit.kind === 'type' || hit.kind === 'new') {
        lines.push(`${at} type ${cls.get(key) ?? '?'}`)
      }
    }
  }
  return lines
}

// a에서 b를 뺀 것(여러 벌 집합)
function minus(a: string[], b: string[]): string[] {
  const counts = new Map<string, number>()
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1)
  const result: string[] = []
  for (const line of a) {
    const n = counts.get(line) ?? 0
    if (n > 0) counts.set(line, n - 1)
    else result.push(line)
  }
  return result.sort(compare)
}

describe('javac 정답표와 견주기', () => {
  it('보통 씬: 코드 사용처', () => {
    // import와 한정자(RobotHardware.Lift의 RobotHardware, robot.lift.liftLeft의 robot.lift)는 사용처가 아니다.
    // javac는 선언자 여럿(RobotHardware a, b)에 같은 형식 트리를 나눠 주어 같은 줄이 두 번 나온다. 사용처는 자리마다
    // 하나라 같은 줄은 하나로 본다.
    const golden = [
      ...new Set(readGolden('golden.txt').filter((line) => !/\[(import|qualifier)\]/.test(line)))
    ]
    const symbols = usageSymbols(corpusScene())
    const ours = typedLines(resolveUsages(corpusFacts(), symbols), symbols)
    expect(new Set(ours).size, '같은 자리의 사용처가 둘 있다').toBe(ours.length)
    expect(minus(ours, golden), '잘못 찾은 사용처').toEqual([])
    const missed = minus(golden, ours).map((line) => line.split(' ')[0])
    expect(missed, '찾지 못한 사용처').toEqual(ACCEPTED_FN.map(({ at }) => at).sort(compare))
  })

  it('보통 씬: 이스케이프 파일은 건너뛰고, 생성 코드에 없는 이름이 없다', () => {
    const result = resolveUsages(corpusFacts(), usageSymbols(corpusScene()))
    expect(result.files.unicodeEscape).toEqual([`${T}Escapes.java`])
    expect(result.unresolved).toEqual(new Map())
  })

  it('보통 씬: 이름으로 찾기(찾기는 세고, 같은 글자는 따로, 없는 이름은 구성에 없는 이름)', () => {
    const result = resolveUsages(corpusFacts(), usageSymbols(corpusScene()))
    const sites = (key: UsageKey, kind: string): string[] =>
      (result.hits.get(key) ?? [])
        .filter((hit) => hit.kind === kind)
        .map((hit) => `${hit.path.slice(T.length)}:${hit.line} ${hit.snippet}`)
    // 데드휠 par는 같은 포트 모터의 구성 이름(leftFront)으로 찾는다
    for (const key of ['d:drive\nlf', 'd:odometry\npar']) {
      expect(sites(key, 'lookup')).toEqual([
        'pedro/PedroConstants.java:9 …anumConstants(…).maxPower(…).leftFrontMotorName("leftFront")',
        'rr/MecanumDrive.java:11 hardwareMap.get(…, "leftFront")'
      ])
      expect(sites(key, 'text')).toEqual([
        'Constants.java:7 CAPTION = "leftFront"',
        'rr/MecanumDrive.java:17 PAR_NAME = "leftFront"'
      ])
    }
    // 다른 파일의 상수를 찾기 인자로 쓰면 그 초기값이 찾기다. 두 로봇의 같은 구성 이름은 둘 다 받는다.
    for (const key of ['d:liftMotor\nll', 'd:practiceLift\npll']) {
      expect(sites(key, 'lookup')).toEqual(['Constants.java:5 LIFT_MOTOR = "liftLeft"'])
      expect(sites(key, 'text')).toEqual(['MainTeleOp.java:26 telemetry.addData("liftLeft", …)'])
    }
    expect(sites('d:clawServo\ngrip', 'lookup')).toEqual(['Constants.java:6 GRIP = " grip "'])
    expect(sites('d:liftEncoder\nenc', 'lookup')).toEqual([
      'subsystems/LiftByName.java:11 ENCODER = "enc"'
    ])
    expect([...result.unknownNames.keys()]).toEqual(['leftBack', 'rightBack', 'rightFront'])
    expect(result.unknownNames.get('leftBack')!.map((hit) => hit.path.slice(T.length))).toEqual([
      'pedro/PedroConstants.java',
      'rr/MecanumDrive.java'
    ])
  })

  it('이름을 바꾼 씬: 생성 코드에 없는 이름', () => {
    const golden = readGolden('golden-renamed.txt')
    const result = resolveUsages(corpusFacts(), usageSymbols(renamedCorpusScene()))
    const ours = [...result.unresolved.values()].flatMap((hits) =>
      hits.map((hit) => `${hit.path}:${hit.line} ${hit.member}`)
    )
    expect(minus(ours, golden), 'javac가 알리지 않는 이름').toEqual([])
    expect(minus(golden, ours), 'javac만 알리는 이름').toEqual(
      ACCEPTED_RENAMED_FN.map(({ at }) => at).sort(compare)
    )
  })
})
