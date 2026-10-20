// 사용처 정답표 다시 만들기(pnpm usage-oracle). JDK 11+가 필요하다(CI는 쓰지 않고 커밋한 정답표만 읽는다).
// 1. 말뭉치의 생성 클래스를 지금 코드 생성 출력으로 다시 쓴다(vitest --update usageCorpus.test.ts).
// 2. javac 오라클(Oracle.java)로 두 정답표를 만든다.
//    - golden.txt: 보통 씬. 생성 클래스의 필드·상수·형식을 가리키는 모든 참조(경로:줄:열 종류 이름 [import] [qualifier]).
//    - golden-renamed.txt: 이름을 바꾼 씬의 생성 클래스로 컴파일한 cannot find symbol(경로:줄 이름).
//    첫 줄은 말뭉치 해시(# corpus-sha256 …)다. 테스트(usageGolden.test.ts)가 해시를 다시 계산해 말뭉치가 바뀌었으면
//    이 명령을 다시 돌리라고 알린다. 해시 계산은 테스트의 corpusHash와 같아야 한다.
// javac가 만든 클래스 파일은 os.tmpdir()의 임시 폴더에 두고 지운다.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const fixtures = join(repo, 'src/renderer/src/java/usages/__fixtures__')
const corpus = join(fixtures, 'corpus')
const generatedDir = join(corpus, 'src/main/java/org/firstinspires/ftc/teamcode/sandbot')

function walk(dir) {
  const result = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...walk(path))
    else if (entry.isFile()) result.push(path)
  }
  return result
}

const posix = (path) => path.split(sep).join('/')

// 말뭉치의 모든 파일(경로 순서)을 경로와 내용(CR을 뺀 것)으로 해시한다. git의 줄 끝 변환에 흔들리지 않게 한다.
function corpusHash() {
  const hash = createHash('sha256')
  const files = walk(corpus)
    .map((path) => posix(relative(corpus, path)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const path of files) {
    hash.update(`${path}\n`)
    hash.update(readFileSync(join(corpus, path), 'utf8').replace(/\r/g, ''))
    hash.update('\0')
  }
  return hash.digest('hex')
}

// 경로:줄:열 순서(숫자로)
function compareLines(a, b) {
  const pa = a.split(' ')[0].split(':')
  const pb = b.split(' ')[0].split(':')
  if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1
  for (let i = 1; i < 3; i++) {
    const d = Number(pa[i] ?? 0) - Number(pb[i] ?? 0)
    if (d) return d
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options
  })
  if (result.error) {
    console.error(`${command}를 실행하지 못했습니다: ${result.error.message}`)
    if (command === 'java') console.error('JDK 11 이상이 필요합니다(java가 PATH에 있어야 한다).')
    process.exit(1)
  }
  return result
}

// flags: [] 또는 ['--errors']. files는 함께 컴파일할 모든 소스(팀 파일, 생성 클래스, SDK 껍데기).
function oracle(flags, files) {
  const out = mkdtempSync(join(tmpdir(), 'sandbot-usage-oracle-'))
  try {
    const result = run('java', [
      // 안내 글자(한국어)가 깨지지 않게
      '-Dstdout.encoding=UTF-8',
      '-Dstderr.encoding=UTF-8',
      join(here, 'Oracle.java'),
      ...flags,
      out,
      corpus,
      ...files
    ])
    // JAVA_TOOL_OPTIONS 안내 줄은 버린다
    const stderr = result.stderr
      .split('\n')
      .filter((line) => line && !line.startsWith('Picked up JAVA_TOOL_OPTIONS'))
    if (stderr.length) console.error(stderr.join('\n'))
    if (result.status !== 0) {
      console.error('Oracle.java가 실패했습니다.')
      process.exit(1)
    }
    return result.stdout.split('\n').filter(Boolean).sort(compareLines)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

// 1. 생성 클래스
const vitest = join(repo, 'node_modules/vitest/vitest.mjs')
const update = run(
  process.execPath,
  [vitest, 'run', '--update=all', 'src/renderer/src/java/usages/usageCorpus.test.ts'],
  { stdio: 'inherit' }
)
if (update.status !== 0) {
  console.error('말뭉치의 생성 클래스를 다시 쓰지 못했습니다(usageCorpus.test.ts).')
  process.exit(1)
}

// 2. 정답표
const javaFiles = (dir) => walk(dir).filter((path) => path.endsWith('.java'))
const team = javaFiles(join(corpus, 'src/main/java'))
const sdk = javaFiles(join(corpus, 'sdk'))
const renamed = javaFiles(join(corpus, 'renamed'))
const header = `# corpus-sha256 ${corpusHash()}`

const normalLines = oracle([], [...team, ...sdk])
const renamedLines = oracle(
  ['--errors'],
  [...team.filter((path) => !path.startsWith(generatedDir + sep)), ...renamed, ...sdk]
)
if (renamedLines.length === 0) {
  console.error('이름을 바꾼 씬에서 javac 오류가 하나도 없습니다(말뭉치를 확인하세요).')
  process.exit(1)
}
writeFileSync(join(fixtures, 'golden.txt'), [header, ...normalLines, ''].join('\n'))
writeFileSync(join(fixtures, 'golden-renamed.txt'), [header, ...renamedLines, ''].join('\n'))
console.log(`golden.txt ${normalLines.length}줄, golden-renamed.txt ${renamedLines.length}줄`)
