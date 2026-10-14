import type { OcctColor, OcctMesh, OcctNode, OcctResult } from 'occt-import-js'

// 네이티브 STEP 변환기(native/step-converter)의 출력 SBSTEP01을 occt-import-js 결과와 같은 모양으로 읽는다.
// 배열은 출력 버퍼를 가리키는 타입 배열 뷰다(convertOcctResult가 메시마다 제 버퍼로 복사한다).
//   magic[8] "SBSTEP01" | u64 jsonOffset | u64 jsonLength | 메시 배열들 | JSON(UTF-8)
// 다른 프로세스가 만든 파일이므로 범위·정렬·인덱스를 모두 확인한다.

const MAGIC = 'SBSTEP01'
const HEADER_BYTES = 24

export class NativeResultError extends Error {}

type NativeMeshInfo = {
  name: unknown
  color?: unknown
  brep_faces: unknown
  vertexCount: unknown
  normalCount: unknown
  triangleCount: unknown
  positionOffset: unknown
  normalOffset: unknown
  indexOffset: unknown
}

function fail(message: string): never {
  throw new NativeResultError(message)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function readColor(value: unknown, what: string): OcctColor {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((c) => typeof c === 'number' && Number.isFinite(c))
  )
    fail(`invalid ${what}`)
  return [value[0], value[1], value[2]]
}

function readNode(value: unknown, meshCount: number, depth: number): OcctNode {
  if (depth > 1000) fail('hierarchy too deep')
  if (!value || typeof value !== 'object') fail('invalid node')
  const node = value as { name?: unknown; meshes?: unknown; children?: unknown }
  if (typeof node.name !== 'string') fail('invalid node name')
  if (!Array.isArray(node.meshes) || !node.meshes.every((m) => isCount(m) && m < meshCount))
    fail('invalid node meshes')
  if (!Array.isArray(node.children)) fail('invalid node children')
  return {
    name: node.name,
    meshes: node.meshes as number[],
    children: node.children.map((child) => readNode(child, meshCount, depth + 1))
  }
}

export function parseNativeResult(buffer: ArrayBuffer): OcctResult {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < HEADER_BYTES) fail('file too short')
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) fail('not a SBSTEP01 file')
  }
  const view = new DataView(buffer)
  const jsonOffset = Number(view.getBigUint64(8, true))
  const jsonLength = Number(view.getBigUint64(16, true))
  // JSON은 파일 끝에 있다(변환기가 마지막에 쓴다). 길이가 맞지 않으면 덜 썼거나 손상된 파일이다.
  if (jsonOffset < HEADER_BYTES || jsonOffset + jsonLength !== bytes.length)
    fail('invalid json range')

  let json: { root?: unknown; meshes?: unknown }
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonOffset, jsonOffset + jsonLength)))
  } catch {
    fail('invalid json')
  }
  if (!json || typeof json !== 'object' || !Array.isArray(json.meshes)) fail('invalid meshes')
  const infos = json.meshes as NativeMeshInfo[]

  // 메시 배열은 머리와 JSON 사이에 있어야 하고, 4바이트 정렬이어야 타입 배열 뷰를 만들 수 있다
  const typedArray = <T extends Float32Array | Uint32Array>(
    Type: { new (buffer: ArrayBuffer, offset: number, length: number): T },
    offset: unknown,
    length: number,
    what: string
  ): T => {
    if (!isCount(offset) || offset % 4 !== 0) fail(`invalid ${what} offset`)
    if (offset < HEADER_BYTES || offset + length * 4 > jsonOffset) fail(`${what} out of range`)
    return new Type(buffer, offset, length)
  }

  const meshes: OcctMesh[] = infos.map((info, index) => {
    if (!info || typeof info !== 'object') fail(`invalid mesh ${index}`)
    const { vertexCount, normalCount, triangleCount } = info
    if (typeof info.name !== 'string') fail(`invalid mesh ${index} name`)
    if (!isCount(vertexCount) || !isCount(normalCount) || !isCount(triangleCount))
      fail(`invalid mesh ${index} counts`)

    const positions = typedArray(Float32Array, info.positionOffset, vertexCount * 3, 'position')
    const indices = typedArray(Uint32Array, info.indexOffset, triangleCount * 3, 'index')
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] >= vertexCount) fail(`mesh ${index} index out of range`)
    }
    // 법선은 정점마다 있을 때만 있다(occt-import-js와 같음). 없으면 offset이 -1이다.
    let normal: { array: Float32Array } | undefined
    if (info.normalOffset !== -1) {
      if (normalCount !== vertexCount) fail(`mesh ${index} normal count mismatch`)
      normal = { array: typedArray(Float32Array, info.normalOffset, normalCount * 3, 'normal') }
    }

    if (!Array.isArray(info.brep_faces)) fail(`invalid mesh ${index} faces`)
    const brepFaces = info.brep_faces.map((face: unknown) => {
      const f = face as { first?: unknown; last?: unknown; color?: unknown }
      // 삼각형이 없는 면은 last가 first - 1이다
      if (
        !isCount(f.first) ||
        typeof f.last !== 'number' ||
        !Number.isSafeInteger(f.last) ||
        f.last < f.first - 1 ||
        f.last >= triangleCount
      )
        fail(`invalid mesh ${index} face range`)
      return {
        first: f.first,
        last: f.last,
        color: f.color === null || f.color === undefined ? null : readColor(f.color, 'face color')
      }
    })

    return {
      name: info.name,
      ...(info.color !== undefined ? { color: readColor(info.color, 'mesh color') } : {}),
      brep_faces: brepFaces,
      attributes: { position: { array: positions }, ...(normal ? { normal } : {}) },
      index: { array: indices }
    }
  })

  return { success: true, root: readNode(json.root, meshes.length, 0), meshes }
}
