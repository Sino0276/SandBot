import { describe, expect, it } from 'vitest'
import { NativeResultError, parseNativeResult } from './nativeResult'

type MeshSpec = {
  name: string
  color?: [number, number, number]
  positions: number[]
  normals?: number[]
  indices: number[]
  faces?: { first: number; last: number; color: [number, number, number] | null }[]
}

// 네이티브 변환기(native/step-converter/src/main.cpp)와 같은 배치로 SBSTEP01을 만든다
function encode(
  root: unknown,
  meshes: MeshSpec[],
  patch: (json: { meshes: Record<string, unknown>[] }) => void = () => {}
): ArrayBuffer {
  const chunks: Uint8Array[] = []
  let offset = 24
  const push = (array: Float32Array | Uint32Array): number => {
    const at = offset
    chunks.push(new Uint8Array(array.buffer.slice(0)))
    offset += array.byteLength
    return at
  }
  const json = {
    root,
    meshes: meshes.map((mesh) => {
      const positionOffset = push(new Float32Array(mesh.positions))
      const normalOffset = mesh.normals ? push(new Float32Array(mesh.normals)) : -1
      const indexOffset = push(new Uint32Array(mesh.indices))
      return {
        name: mesh.name,
        ...(mesh.color ? { color: mesh.color } : {}),
        brep_faces: mesh.faces ?? [{ first: 0, last: mesh.indices.length / 3 - 1, color: null }],
        vertexCount: mesh.positions.length / 3,
        normalCount: mesh.normals ? mesh.normals.length / 3 : 0,
        triangleCount: mesh.indices.length / 3,
        positionOffset,
        normalOffset,
        indexOffset
      } as Record<string, unknown>
    })
  }
  patch(json)
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const out = new Uint8Array(offset + jsonBytes.length)
  out.set(new TextEncoder().encode('SBSTEP01'), 0)
  const view = new DataView(out.buffer)
  view.setBigUint64(8, BigInt(offset), true)
  view.setBigUint64(16, BigInt(jsonBytes.length), true)
  let at = 24
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  out.set(jsonBytes, offset)
  return out.buffer
}

const triangle: MeshSpec = {
  name: '판',
  color: [0.5, 0.25, 1],
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2],
  faces: [{ first: 0, last: 0, color: [1, 0, 0] }]
}
const root = {
  name: '',
  meshes: [],
  children: [{ name: 'as1', meshes: [0, 1], children: [] }]
}

describe('parseNativeResult', () => {
  it('occt-import-js 결과와 같은 모양으로 읽는다', () => {
    const result = parseNativeResult(
      encode(root, [
        triangle,
        { name: 'rod', positions: [0, 0, 0, 0, 0, 1, 1, 0, 0], indices: [0, 2, 1] }
      ])
    )
    expect(result.success).toBe(true)
    expect(result.root).toEqual(root)
    expect(result.meshes).toHaveLength(2)
    const [plate, rod] = result.meshes
    expect(plate.name).toBe('판')
    expect(plate.color).toEqual([0.5, 0.25, 1])
    expect(Array.from(plate.attributes.position.array)).toEqual(triangle.positions)
    expect(Array.from(plate.attributes.normal!.array)).toEqual(triangle.normals)
    expect(Array.from(plate.index.array)).toEqual([0, 1, 2])
    expect(plate.brep_faces).toEqual([{ first: 0, last: 0, color: [1, 0, 0] }])
    // 법선이 없으면 attribute도 없다(WASM과 같음), 색이 없으면 color 키도 없다
    expect(rod.attributes.normal).toBeUndefined()
    expect('color' in rod).toBe(false)
  })

  it('삼각형이 없는 메시와 면(last = first - 1)도 읽는다', () => {
    const empty: MeshSpec = {
      name: 'empty',
      positions: [],
      normals: [],
      indices: [],
      faces: [{ first: 0, last: -1, color: null }]
    }
    const result = parseNativeResult(encode({ name: '', meshes: [0], children: [] }, [empty]))
    expect(result.meshes[0].attributes.position.array.length).toBe(0)
    expect(result.meshes[0].attributes.normal!.array.length).toBe(0)
    expect(result.meshes[0].brep_faces).toEqual([{ first: 0, last: -1, color: null }])
  })

  it('형식이 다르거나 손상된 파일은 거부한다', () => {
    const good = encode(root, [triangle, triangle])
    const corrupt = (mutate: (bytes: Uint8Array, view: DataView) => void): ArrayBuffer => {
      const copy = new Uint8Array(good.slice(0))
      mutate(copy, new DataView(copy.buffer))
      return copy.buffer
    }
    const bad: ArrayBuffer[] = [
      new ArrayBuffer(10),
      corrupt((bytes) => (bytes[0] = 0x41)),
      corrupt((_, view) => view.setBigUint64(8, BigInt(8), true)),
      corrupt((_, view) => view.setBigUint64(16, BigInt(1e9), true)),
      encode(root, [triangle, triangle], (json) => (json.meshes[0].positionOffset = 26)),
      encode(root, [triangle, triangle], (json) => (json.meshes[0].indexOffset = 1 << 20)),
      encode(root, [triangle, triangle], (json) => (json.meshes[1].vertexCount = 2)),
      encode(root, [triangle, triangle], (json) => (json.meshes[0].normalCount = 1)),
      encode(
        root,
        [triangle, triangle],
        (json) => (json.meshes[0].brep_faces = [{ first: 0, last: 5, color: null }])
      ),
      encode({ name: '', meshes: [2], children: [] }, [triangle, triangle]),
      encode({ name: 1, meshes: [], children: [] }, [triangle])
    ]
    for (const buffer of bad) expect(() => parseNativeResult(buffer)).toThrow(NativeResultError)
  })
})
