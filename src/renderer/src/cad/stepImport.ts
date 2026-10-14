import type { OcctMesh, OcctNode, OcctResult } from 'occt-import-js'
import { boundsCenter, cadRootTransform, type CadAlignment } from './alignment'
import type { MeshIndexing, SceneObject, SceneObjects, Transform, Vec3 } from '../scene/model'

export type Bounds = { min: Vec3; max: Vec3 }

export type ImportedMesh = {
  // occt-import-js 결과(meshes)에서의 원래 순번. 새로 불러온 CAD의 형상 id는 이 순번으로 만든다
  // (삼각형을 만들지 못해 빠진 메시가 있어도 다른 파트의 id가 밀리지 않게).
  sourceIndex: number
  name: string
  // 피벗(경계 상자 중심) 기준 정점 좌표, 미터
  positions: Float32Array
  normals: Float32Array | null
  indices: Uint32Array
  // 면마다 색이 다를 때만 있는 정점 색(선형 RGB)
  colors: Float32Array | null
  // 메시 기본 색(sRGB 0~1)
  color: Vec3
  // CAD 좌표 경계 상자
  bounds: Bounds
}

export type ImportedNode = {
  name: string
  kind: 'assembly' | 'part'
  // part일 때 meshes의 인덱스
  meshIndex?: number
  bounds: Bounds
  children: ImportedNode[]
}

// meshes에는 삼각형이 있는 메시만 있다. sourceMeshCount는 occt-import-js가 준 전체 메시 수(빈 메시 포함).
export type ImportedModel = { root: ImportedNode; meshes: ImportedMesh[]; sourceMeshCount: number }

// 메시 캐시(앱 데이터 폴더)의 형식 태그. convertOcctResult의 출력이나 occt-import-js 버전이 바뀌면 올린다.
// 올리면 기존 캐시는 쓰지 않고 다시 변환한다. v2: sourceIndex·sourceMeshCount 추가.
export const MESH_CACHE_TAG = 'model-v2'

function isFloat32OrNull(value: unknown): boolean {
  return value === null || value instanceof Float32Array
}

// 캐시에서 읽은 값이 변환 결과 형식인지(깨진 캐시를 형상으로 쓰지 않게) 가볍게 확인한다
export function isImportedModel(value: unknown): value is ImportedModel {
  if (!value || typeof value !== 'object') return false
  const model = value as Partial<ImportedModel>
  const sourceMeshCount = model.sourceMeshCount
  return (
    !!model.root &&
    typeof model.root === 'object' &&
    Number.isSafeInteger(sourceMeshCount) &&
    Array.isArray(model.meshes) &&
    model.meshes.every(
      (mesh) =>
        !!mesh &&
        Number.isSafeInteger(mesh.sourceIndex) &&
        mesh.sourceIndex >= 0 &&
        mesh.sourceIndex < sourceMeshCount! &&
        mesh.positions instanceof Float32Array &&
        mesh.indices instanceof Uint32Array &&
        isFloat32OrNull(mesh.normals) &&
        isFloat32OrNull(mesh.colors)
    )
  )
}

export const DEFAULT_PART_COLOR: Vec3 = [0.62, 0.64, 0.68]

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

function computeBounds(positions: ArrayLike<number>): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis]
      if (value < min[axis]) min[axis] = value
      if (value > max[axis]) max[axis] = value
    }
  }
  return { min, max }
}

function unionBounds(list: Bounds[]): Bounds {
  return {
    min: [0, 1, 2].map((i) => Math.min(...list.map((b) => b.min[i]))) as Vec3,
    max: [0, 1, 2].map((i) => Math.max(...list.map((b) => b.max[i]))) as Vec3
  }
}

function convertMesh(mesh: OcctMesh, sourceIndex: number): ImportedMesh | null {
  const source = mesh.attributes.position.array
  if (source.length === 0 || mesh.index.array.length === 0) return null

  const bounds = computeBounds(source)
  const center = boundsCenter(bounds)
  const positions = new Float32Array(source.length)
  for (let i = 0; i < source.length; i++) positions[i] = source[i] - center[i % 3]

  const color = mesh.color ?? DEFAULT_PART_COLOR
  const indices = Uint32Array.from(mesh.index.array)

  let colors: Float32Array | null = null
  if (mesh.brep_faces.some((face) => face.color)) {
    colors = new Float32Array(source.length)
    const fill = (target: number, rgb: Vec3): void => {
      colors![target * 3] = srgbToLinear(rgb[0])
      colors![target * 3 + 1] = srgbToLinear(rgb[1])
      colors![target * 3 + 2] = srgbToLinear(rgb[2])
    }
    for (let v = 0; v < source.length / 3; v++) fill(v, color)
    for (const face of mesh.brep_faces) {
      if (!face.color) continue
      for (let triangle = face.first; triangle <= face.last; triangle++) {
        for (let corner = 0; corner < 3; corner++) fill(indices[triangle * 3 + corner], face.color)
      }
    }
  }

  return {
    sourceIndex,
    name: mesh.name,
    positions,
    normals: mesh.attributes.normal ? Float32Array.from(mesh.attributes.normal.array) : null,
    indices,
    colors,
    color,
    bounds
  }
}

function convertNode(node: OcctNode, meshes: (ImportedMesh | null)[]): ImportedNode | null {
  const children: ImportedNode[] = []
  for (const child of node.children) {
    const converted = convertNode(child, meshes)
    if (converted) children.push(converted)
  }
  node.meshes.forEach((meshIndex, order) => {
    const mesh = meshes[meshIndex]
    if (!mesh) return
    const fallback = node.meshes.length > 1 ? `${node.name} ${order + 1}` : node.name
    children.push({
      name: mesh.name || fallback,
      kind: 'part',
      meshIndex,
      bounds: mesh.bounds,
      children: []
    })
  })

  if (children.length === 0) return null
  // 메시 하나만 가진 노드는 그 자체로 파트다. 이름은 노드(컴포넌트) 이름을 쓴다.
  if (node.children.length === 0 && children.length === 1) {
    return { ...children[0], name: node.name || children[0].name }
  }
  return {
    name: node.name,
    kind: 'assembly',
    bounds: unionBounds(children.map((child) => child.bounds)),
    children
  }
}

// occt-import-js 결과를 계층과 피벗 중심 메시로 바꾼다. 워커에서 실행한다.
export function convertOcctResult(result: OcctResult, fileName: string): ImportedModel | null {
  const meshes = result.meshes.map((mesh, index) => convertMesh(mesh, index))
  // occt 루트는 이름 없는 컨테이너다. 최상위 형상이 하나면 그것을 루트로 쓴다.
  const top =
    result.root.meshes.length === 0 && result.root.children.length === 1
      ? result.root.children[0]
      : { ...result.root, name: result.root.name || baseName(fileName) }
  const root = convertNode(top, meshes)
  if (!root) return null

  // 계층에서 참조하는 메시만 남기고 인덱스를 다시 매긴다
  const used: ImportedMesh[] = []
  const reindex = (node: ImportedNode): void => {
    if (node.meshIndex !== undefined) {
      used.push(meshes[node.meshIndex]!)
      node.meshIndex = used.length - 1
    }
    node.children.forEach(reindex)
  }
  reindex(root)
  return { root, meshes: used, sourceMeshCount: result.meshes.length }
}

function hasTriangles(mesh: OcctMesh): boolean {
  return mesh.attributes.position.array.length > 0 && mesh.index.array.length > 0
}

// convertOcctResult가 모델을 만들지 못한 이유. 메시가 하나도 없으면 empty, 메시는 있는데 모두 삼각형이 없으면
// meshFailed(삼각분할 실패: 대개 WASM 메모리 한도).
export function emptyResultReason(result: OcctResult): 'empty' | 'meshFailed' {
  return result.meshes.length > 0 && !result.meshes.some(hasTriangles) ? 'meshFailed' : 'empty'
}

// WASM 힙을 더 늘리지 못할 때 emscripten·브라우저가 내는 오류
export function isOutOfMemoryError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /out of memory|\bOOM\b|Cannot enlarge memory|Array buffer allocation failed/i.test(text)
}

// 삼각형을 만들지 못해 빠진 메시 수
export function droppedMeshCount(model: ImportedModel): number {
  return model.sourceMeshCount - model.meshes.length
}

// 메시마다 등록할 형상 id. 새로 불러온 CAD(meshIndexing 'source')는 원래 순번, 예전 프로젝트(packed)는 빈 메시를
// 빼고 다시 매긴 순번을 쓴다.
export function meshGeometryIds(
  cadRootId: string,
  model: ImportedModel,
  indexing: MeshIndexing
): string[] {
  return model.meshes.map((mesh, index) =>
    cadGeometryId(cadRootId, indexing === 'source' ? mesh.sourceIndex : index)
  )
}

export function transferablesOf(model: ImportedModel): ArrayBuffer[] {
  return model.meshes.flatMap((mesh) =>
    [mesh.positions, mesh.normals, mesh.indices, mesh.colors]
      .filter((array) => array !== null)
      .map((array) => array.buffer as ArrayBuffer)
  )
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.(step|stp)$/i, '')
}

const IDENTITY_ROTATION: Vec3 = [0, 0, 0]

// CAD 메시 형상 id. 프로젝트를 다시 열 때 같은 파일을 읽으면 같은 id로 다시 등록된다.
export function cadGeometryId(cadRootId: string, meshIndex: number): string {
  return `${cadRootId}:${meshIndex}`
}

// 불러온 모델을 씬 오브젝트로 만든다: 로봇(필드 중앙) → CAD 루트(정렬) → 어셈블리·파트.
// 파트 형상은 cadGeometryId(CAD 루트 id, 메시 인덱스)로 가리키고, 호출한 쪽이 그 id로 형상을 등록한다.
export function buildSceneObjects(
  model: ImportedModel,
  options: {
    fileName: string
    absolutePath: string
    alignment: CadAlignment
    createId: () => string
  }
): { objects: SceneObjects; robotId: string; cadRootId: string } {
  const { fileName, absolutePath, alignment, createId } = options
  const objects: SceneObjects = {}
  const cadRootId = createId()

  const robotId = createId()
  objects[robotId] = {
    id: robotId,
    name: baseName(fileName),
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: IDENTITY_ROTATION }
  }

  const add = (node: ImportedNode, parentId: string, transform: Transform, id: string): void => {
    const object: SceneObject = { id, name: node.name, kind: node.kind, parentId, transform }
    if (node.meshIndex !== undefined) {
      const mesh = model.meshes[node.meshIndex]
      object.visual = {
        type: 'mesh',
        geometryId: cadGeometryId(cadRootId, mesh.sourceIndex),
        color: mesh.color
      }
    }
    objects[id] = object

    // 자식 피벗은 부모 피벗(경계 상자 중심) 기준 상대 위치다. CAD 루트 아래에는 회전이 없다.
    const center = boundsCenter(node.bounds)
    for (const child of node.children) {
      const childCenter = boundsCenter(child.bounds)
      add(
        child,
        id,
        {
          position: [0, 1, 2].map((i) => childCenter[i] - center[i]) as Vec3,
          rotation: IDENTITY_ROTATION
        },
        createId()
      )
    }
  }

  add(model.root, robotId, cadRootTransform(model.root.bounds, alignment), cadRootId)
  objects[cadRootId].cad = {
    fileName,
    absolutePath,
    ...alignment,
    bounds: model.root.bounds,
    meshCount: model.sourceMeshCount,
    meshIndexing: 'source'
  }

  return { objects, robotId, cadRootId }
}
