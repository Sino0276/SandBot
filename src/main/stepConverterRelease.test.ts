import { execFile } from 'child_process'
import { createHash } from 'crypto'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { createServer, type Server } from 'http'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// 변환기 배포(scripts/step-converter-source.mjs, scripts/fetch-step-converter.mjs)를 실제 스크립트로 실행해 확인한다.
// 받기는 가짜 GitHub API 서버(SANDBOT_GITHUB_API)를 상대로 한다.

const root = resolve(__dirname, '../..')
const SOURCE_PATHS = [
  'native/step-converter/version.json',
  'native/step-converter/CMakeLists.txt',
  'native/step-converter/cmake',
  'native/step-converter/src',
  'scripts/build-step-converter.mjs',
  'scripts/step-converter-source.mjs'
]

type Run = { code: number; stdout: string; stderr: string }

function node(args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      args,
      { cwd: root, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        done({ code: error ? ((error.code as number) ?? 1) : 0, stdout, stderr })
      }
    )
  })
}

async function tagOf(dir = root): Promise<string> {
  const run = await node(['scripts/step-converter-source.mjs', '--root', dir])
  expect(run.code, run.stderr).toBe(0)
  return run.stdout.trim()
}

function filesUnder(dir: string): string[] {
  return statSync(dir).isDirectory()
    ? readdirSync(dir).flatMap((name) => filesUnder(join(dir, name)))
    : [dir]
}

describe('변환기 소스 해시(Release 태그)', () => {
  let copy: string

  beforeEach(() => {
    copy = mkdtempSync(join(tmpdir(), 'sandbot-source-'))
    for (const path of SOURCE_PATHS) cpSync(join(root, path), join(copy, path), { recursive: true })
    return () => rmSync(copy, { recursive: true, force: true })
  })

  it('태그 형식이 맞고, 같은 소스면 같은 태그다', async () => {
    const tag = await tagOf()
    expect(tag).toMatch(/^step-converter-[0-9a-f]{16}$/)
    expect(await tagOf(copy)).toBe(tag)
  })

  it('Windows의 CRLF 줄 끝은 태그를 바꾸지 않는다', async () => {
    const tag = await tagOf(copy)
    for (const file of SOURCE_PATHS.flatMap((path) => filesUnder(join(copy, path)))) {
      const text = readFileSync(file, 'utf8')
      writeFileSync(file, text.replace(/\r?\n/g, '\r\n'))
    }
    expect(await tagOf(copy)).toBe(tag)
  })

  it('변환기 소스가 바뀌면 태그가 바뀐다', async () => {
    const tag = await tagOf(copy)
    const main = join(copy, 'native/step-converter/src/main.cpp')
    writeFileSync(main, readFileSync(main, 'utf8') + '\n// changed\n')
    expect(await tagOf(copy)).not.toBe(tag)
  })
})

// Windows x64 실행 파일처럼 보이는 최소 PE 헤더
function fakeExe(machine = 0x8664): Buffer {
  const bytes = Buffer.alloc(512)
  bytes.write('MZ', 0, 'latin1')
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.write('PE\0\0', 0x80, 'latin1')
  bytes.writeUInt16LE(machine, 0x84)
  return bytes
}

describe('pnpm fetch:step-converter', () => {
  const ASSET = 'sandbot-step-converter-win32-x64.exe'
  let server: Server
  let api: string
  let tag: string
  let exe: Buffer
  let sums: string
  let release: 'ok' | 'missing'
  let requests: string[]
  let out: string

  beforeAll(async () => {
    tag = await tagOf()
    server = createServer((req, res) => {
      requests.push(req.url ?? '')
      if (req.url === `/repos/o/r/releases/tags/${tag}` && release === 'ok') {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            assets: [
              { name: ASSET, url: `${api}/assets/1` },
              { name: 'SHA256SUMS', url: `${api}/assets/2` }
            ]
          })
        )
      } else if (req.url === '/assets/1' && req.headers.accept === 'application/octet-stream') {
        res.end(exe)
      } else if (req.url === '/assets/2') {
        res.end(sums)
      } else {
        res.statusCode = 404
        res.end('{"message":"Not Found"}')
      }
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    api = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    release = 'ok'
    requests = []
    exe = fakeExe()
    sums = `${createHash('sha256').update(exe).digest('hex')}  ${ASSET}\n`
    out = mkdtempSync(join(tmpdir(), 'sandbot-fetch-'))
    return () => rmSync(out, { recursive: true, force: true })
  })

  const fetchConverter = (...extra: string[]): Promise<Run> =>
    node(
      [
        'scripts/fetch-step-converter.mjs',
        '--target',
        'win32-x64',
        '--repo',
        'o/r',
        '--out-dir',
        out,
        ...extra
      ],
      { SANDBOT_GITHUB_API: api, GITHUB_TOKEN: '', GH_TOKEN: '' }
    )

  it('지금 소스 해시의 Release에서 받아 확인한 뒤 넣고, 다음에는 받지 않는다', async () => {
    const first = await fetchConverter()
    expect(first.code, first.stderr).toBe(0)
    expect(readFileSync(join(out, 'sandbot-step-converter.exe')).equals(exe)).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'source.json'), 'utf8'))).toMatchObject({
      tag,
      origin: 'release'
    })

    requests = []
    const second = await fetchConverter()
    expect(second.code, second.stderr).toBe(0)
    expect(second.stdout).toMatch(/up to date/)
    expect(requests).toEqual([])
  })

  it('해시가 다르면 넣지 않는다', async () => {
    sums = `${'0'.repeat(64)}  ${ASSET}\n`
    const run = await fetchConverter()
    expect(run.code).toBe(1)
    expect(run.stderr).toMatch(/SHA-256/)
    expect(existsSync(join(out, 'sandbot-step-converter.exe'))).toBe(false)
  })

  it('다른 CPU용 실행 파일은 넣지 않고, 있던 파일은 그대로 둔다', async () => {
    writeFileSync(join(out, 'sandbot-step-converter.exe'), 'old')
    exe = fakeExe(0x14c)
    sums = `${createHash('sha256').update(exe).digest('hex')}  ${ASSET}\n`
    const run = await fetchConverter()
    expect(run.code).toBe(1)
    expect(run.stderr).toMatch(/win32-ia32, not win32-x64/)
    expect(readFileSync(join(out, 'sandbot-step-converter.exe'), 'utf8')).toBe('old')
    expect(readdirSync(out)).toEqual(['sandbot-step-converter.exe'])
  })

  it('이 소스의 Release가 없으면 알리고, --optional이면 경고만 한다', async () => {
    release = 'missing'
    const run = await fetchConverter()
    expect(run.code).toBe(1)
    expect(run.stderr).toContain(tag)
    expect(run.stderr).toMatch(/pnpm build:step-converter/)

    const optional = await fetchConverter('--optional')
    expect(optional.code).toBe(0)
    expect(optional.stderr).toMatch(/WASM/)
  })

  it('직접 빌드한 같은 소스의 변환기는 덮어쓰지 않는다', async () => {
    writeFileSync(join(out, 'sandbot-step-converter.exe'), 'built')
    writeFileSync(join(out, 'source.json'), JSON.stringify({ tag, origin: 'build' }))
    const run = await fetchConverter()
    expect(run.code, run.stderr).toBe(0)
    expect(readFileSync(join(out, 'sandbot-step-converter.exe'), 'utf8')).toBe('built')
    expect(requests).toEqual([])
  })
})
