import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import converterVersion from '../../native/step-converter/version.json'
import type { StepConvertPhase } from '../shared/ipc'
import { cacheKey } from './meshCache'
import {
  convertStepFile,
  converterEnv,
  exitFailure,
  probeConverter,
  type ConverterExit
} from './stepConverter'

// 진짜 변환기 대신 node로 돌리는 가짜 변환기. 표준 입력으로 받은 STEP 내용으로 동작을 고른다.
const FAKE_CONVERTER = `
const fs = require('fs')
const args = process.argv.slice(2)
if (args[0] === '--version') {
  const identity = JSON.parse(process.env.FAKE_IDENTITY)
  process.stdout.write(JSON.stringify(identity) + '\\n')
  return
}
const [input, output] = args
const finish = (status, code) => { process.stderr.write('result ' + status + '\\n'); process.exit(code) }
if (input !== '-') finish('failed', 64)
if (process.env.CSF_MeshAlgo) { process.stderr.write('error occt env leaked\\n'); finish('failed', 68) }
const mode = fs.readFileSync(0, 'utf8').trim()
const phase = (name) => process.stderr.write('phase ' + name + '\\n')
phase('read')
if (mode === 'readFailed') { process.stderr.write('error cannot read STEP\\n'); finish('readFailed', 66) }
if (mode === 'oom') { process.stderr.write('error out of memory\\n'); finish('outOfMemory', 67) }
if (mode === 'crash') process.exit(3)
if (mode === 'hang') { phase('transfer'); setInterval(() => {}, 1000); return }
phase('transfer'); process.stderr.write('progress 0.5\\nprogress 9\\n'); phase('mesh'); phase('bogus'); phase('write')
if (mode === 'partial') process.stderr.write('warning untranslated 3\\n')
fs.writeFileSync(output, Buffer.from('SBSTEP01-' + mode))
finish('ok', 0)
`

const TAG = 'model-test'
const IDENTITY = {
  format: converterVersion.format,
  occtImportJs: converterVersion.occtImportJs.commit,
  occt: converterVersion.occt.commit
}

describe('네이티브 STEP 변환기 실행', () => {
  let dir: string
  let fake: string
  const step = async (name: string, mode: string): Promise<string> => {
    const path = join(dir, name)
    await writeFile(path, mode)
    return path
  }
  const convert = (
    path: string,
    onProgress: (phase: StepConvertPhase, fraction: number | null) => void = () => {},
    onStart: Parameters<typeof convertStepFile>[5] = () => {}
  ): ReturnType<typeof convertStepFile> =>
    convertStepFile(process.execPath, path, TAG, join(dir, 'out'), onProgress, onStart, [fake])

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-converter-test-'))
    fake = join(dir, 'fake-converter.cjs')
    await writeFile(fake, `(() => {${FAKE_CONVERTER}})()`)
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  afterEach(() => {
    delete process.env.CSF_MeshAlgo
    delete process.env.FAKE_IDENTITY
  })

  it('표준 입력으로 넘긴 내용을 변환하고, 그 내용의 캐시 키와 진행 단계를 준다', async () => {
    const progress: [StepConvertPhase, number | null][] = []
    const path = await step('ok.step', 'ok')
    const result = await convert(path, (phase, fraction) => progress.push([phase, fraction]))
    expect(progress).toEqual([
      ['read', null],
      ['transfer', null],
      ['transfer', 0.5],
      ['transfer', 1],
      ['mesh', null],
      ['write', null]
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new TextDecoder().decode(result.bytes)).toBe('SBSTEP01-ok')
    expect(result.key).toBe(cacheKey(new TextEncoder().encode('ok'), 'ok.step', TAG))
    expect(result.untranslated).toBe(0)
  })

  it('OCCT가 건너뛴 엔티티 수를 알린다', async () => {
    expect(await convert(await step('partial.step', 'partial'))).toMatchObject({
      ok: true,
      untranslated: 3
    })
  })

  it('OCCT 환경 변수는 변환기에 넘기지 않는다', async () => {
    process.env.CSF_MeshAlgo = 'delabella'
    const result = await convert(await step('env.step', 'ok'))
    expect(result.ok).toBe(true)
    expect(
      converterEnv({ PATH: '/bin', CSF_STEPDefaults: 'x', MMGT_OPT: '0', casroot: 'y' })
    ).toEqual({ PATH: '/bin' })
  })

  it('결과 줄을 실패 이유로 바꾸고, 결과 줄 없이 끝나면 비정상 종료로 본다', async () => {
    expect(await convert(await step('bad.step', 'readFailed'))).toEqual({
      ok: false,
      code: 'readFailed',
      detail: 'cannot read STEP'
    })
    expect(await convert(await step('big.step', 'oom'))).toMatchObject({
      ok: false,
      code: 'outOfMemory'
    })
    // 종료 코드 3(Windows abort와 같음)이어도 결과 줄이 없으면 STEP 읽기 실패가 아니다
    expect(await convert(await step('crash.step', 'crash'))).toEqual({
      ok: false,
      code: 'failed',
      detail: 'exit 3'
    })
  })

  it('취소하면 프로세스를 멈추고 cancelled를 돌려준다', async () => {
    let cancel: (() => void) | undefined
    const result = await convert(
      await step('hang.step', 'hang'),
      (phase) => {
        if (phase === 'transfer') cancel?.()
      },
      (run) => {
        cancel = run.cancel
      }
    )
    expect(result).toEqual({ ok: false, code: 'cancelled', detail: '' })
  })

  it('변환기가 없으면 unavailable(WASM으로 대신 읽음), 입력 파일이 없으면 failed', async () => {
    const path = await step('x.step', 'ok')
    expect(
      await convertStepFile(
        join(dir, 'missing-converter'),
        path,
        TAG,
        join(dir, 'out'),
        () => {},
        () => {}
      )
    ).toMatchObject({ ok: false, code: 'unavailable' })
    expect(await convert(join(dir, 'gone.step'))).toMatchObject({ ok: false, code: 'failed' })
  })

  it('--version이 version.json과 같은 소스로 빌드됐다고 할 때만 쓴다', async () => {
    process.env.FAKE_IDENTITY = JSON.stringify(IDENTITY)
    expect(await probeConverter(process.execPath, [fake])).toBe(true)
    process.env.FAKE_IDENTITY = JSON.stringify({ ...IDENTITY, occt: 'other' })
    expect(await probeConverter(process.execPath, [fake])).toBe(false)
    process.env.FAKE_IDENTITY = '"not an identity"'
    expect(await probeConverter(process.execPath, [fake])).toBe(false)
    expect(await probeConverter(join(dir, 'missing-converter'))).toBe(false)
  })
})

describe('exitFailure', () => {
  const exit = (patch: Partial<ConverterExit>): ConverterExit => ({
    code: 0,
    signal: null,
    spawnError: null,
    cancelled: false,
    result: 'ok',
    phases: [],
    untranslated: 0,
    errors: [],
    ...patch
  })

  it('변환기가 알린 결과를 기준으로 한다', () => {
    expect(exitFailure(exit({}))).toBeNull()
    expect(exitFailure(exit({ code: 66, result: 'readFailed', errors: ['x'] }))).toEqual({
      code: 'readFailed',
      detail: 'x'
    })
    expect(exitFailure(exit({ code: 67, result: 'outOfMemory' }))?.code).toBe('outOfMemory')
    expect(exitFailure(exit({ code: 1, result: 'ok' }))?.code).toBe('failed')
    const enoent = Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' })
    expect(exitFailure(exit({ code: null, result: null, spawnError: enoent }))?.code).toBe(
      'unavailable'
    )
  })

  it('결과 줄 없이 끝난 경우', () => {
    const crash = (patch: Partial<ConverterExit>): ConverterExit =>
      exit({ code: null, result: null, ...patch })
    expect(exitFailure(crash({ code: 0xc0000017 }), 'win32')?.code).toBe('outOfMemory')
    // Linux에서 변환 중에 받은 SIGKILL만 메모리 부족(OOM killer)으로 본다
    expect(
      exitFailure(crash({ signal: 'SIGKILL', phases: ['read', 'transfer'] }), 'linux')?.code
    ).toBe('outOfMemory')
    expect(exitFailure(crash({ signal: 'SIGKILL' }), 'linux')?.code).toBe('failed')
    // macOS는 서명 문제로도 SIGKILL을 보낸다
    expect(
      exitFailure(crash({ signal: 'SIGKILL', phases: ['read', 'transfer'] }), 'darwin')?.code
    ).toBe('failed')
    expect(exitFailure(crash({ signal: 'SIGSEGV' }), 'linux')).toEqual({
      code: 'failed',
      detail: 'exit SIGSEGV'
    })
    // 취소로 SIGKILL을 보낸 것은 메모리 부족이 아니다
    expect(
      exitFailure(crash({ signal: 'SIGKILL', cancelled: true, phases: ['transfer'] }), 'linux')
        ?.code
    ).toBe('cancelled')
  })
})
