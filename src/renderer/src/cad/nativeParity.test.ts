import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { createRequire } from 'module'
import type { Occt, OcctNode, OcctResult } from 'occt-import-js'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseNativeResult } from './nativeResult'
import { convertOcctResult } from './stepImport'

// 네이티브 변환기(native/step-converter)가 렌더러 WASM(occt-import-js)과 같은 결과를 내는지 확인한다.
// 형상 id는 노드 계층·메시 순서·메시 수·메시별 빈 여부로 정해지므로 이것들은 정확히 같아야 한다.
// 정점·삼각형 수는 컴파일러의 부동소수 차이로 조금 다를 수 있어 허용 오차를 둔다.
// 변환기를 빌드하지 않았으면(pnpm build:step-converter) 건너뛴다.

const exe = process.platform === 'win32' ? 'sandbot-step-converter.exe' : 'sandbot-step-converter'
const converter =
  process.env.SANDBOT_STEP_CONVERTER ??
  resolve(
    __dirname,
    '../../../../resources/step-converter',
    `${process.platform}-${process.arch}`,
    exe
  )

const require = createRequire(import.meta.url)
const testFiles = join(require.resolve('occt-import-js'), '..', '..', 'test', 'testfiles')
const SAMPLES = [
  'cax-if/as1_pe_203.stp',
  'cax-if/as1-oc-214.stp',
  'cax-if/as1-tu-203.stp',
  'cax-if/dm1-id-214.stp',
  'cax-if/io1-cm-214.stp',
  'cax-if/sg1-c5-214.stp',
  'cax-if/s1-c5-214/s1-c5-214.stp',
  'cube-units/cube-in.step',
  'rounded-cube/rounded-cube.step',
  'conical-surface/conical-surface.step'
]

function shape(node: OcctNode): unknown {
  return { name: node.name, meshes: node.meshes, children: node.children.map(shape) }
}

function within(a: number, b: number, ratio: number): boolean {
  return Math.abs(a - b) <= Math.max(2, Math.max(a, b) * ratio)
}

describe.skipIf(!existsSync(converter))('네이티브 변환기와 WASM 결과 비교', () => {
  let occt: Occt
  let dir: string

  beforeAll(async () => {
    occt = await (require('occt-import-js') as () => Promise<Occt>)()
    dir = mkdtempSync(join(tmpdir(), 'sandbot-parity-'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const runNative = (input: Buffer): OcctResult => {
    const output = join(dir, 'out.bin')
    const run = spawnSync(converter, ['-', output], { input })
    expect(run.status, run.stderr.toString()).toBe(0)
    expect(run.stderr.toString()).toMatch(/result ok\s*$/)
    const bytes = readFileSync(output)
    return parseNativeResult(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    )
  }

  it.each(SAMPLES)('%s', (sample) => {
    const input = readFileSync(join(testFiles, sample))
    const wasm = occt.ReadStepFile(new Uint8Array(input), { linearUnit: 'meter' })
    const native = runNative(input)

    expect(native.success).toBe(wasm.success)
    expect(shape(native.root)).toEqual(shape(wasm.root))
    expect(native.meshes).toHaveLength(wasm.meshes.length)
    native.meshes.forEach((mesh, index) => {
      const other = wasm.meshes[index]
      const vertices = mesh.attributes.position.array.length / 3
      const otherVertices = other.attributes.position.array.length / 3
      const triangles = mesh.index.array.length / 3
      const otherTriangles = other.index.array.length / 3
      expect(mesh.name).toBe(other.name)
      expect(mesh.color).toEqual(other.color)
      expect(mesh.brep_faces.length).toBe(other.brep_faces.length)
      expect(mesh.brep_faces.map((face) => face.color)).toEqual(
        other.brep_faces.map((face) => face.color)
      )
      expect(triangles === 0).toBe(otherTriangles === 0)
      expect(Boolean(mesh.attributes.normal)).toBe(Boolean(other.attributes.normal))
      expect(within(vertices, otherVertices, 0.02)).toBe(true)
      expect(within(triangles, otherTriangles, 0.02)).toBe(true)
    })

    // 앱이 만드는 모델의 계층과 형상 id(원래 메시 순번)도 같다
    const a = convertOcctResult(native, sample)
    const b = convertOcctResult(wasm, sample)
    expect(a?.meshes.map((mesh) => mesh.sourceIndex)).toEqual(
      b?.meshes.map((mesh) => mesh.sourceIndex)
    )
    expect(a?.sourceMeshCount).toBe(b?.sourceMeshCount)
  })

  it('--version은 version.json과 같은 식별 정보를 낸다', () => {
    const run = spawnSync(converter, ['--version'])
    const identity = JSON.parse(run.stdout.toString())
    const expected = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../native/step-converter/version.json'), 'utf8')
    )
    expect(identity).toEqual({
      format: expected.format,
      occtImportJs: expected.occtImportJs.commit,
      occt: expected.occt.commit
    })
  })

  it('STEP이 아닌 입력은 readFailed로 끝난다', () => {
    const run = spawnSync(converter, ['-', join(dir, 'bad.bin')], {
      input: Buffer.from('not a step file')
    })
    expect(run.stderr.toString()).toMatch(/result readFailed\s*$/)
  })
})
