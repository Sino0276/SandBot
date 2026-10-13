import type { OcctMesh, OcctNode, OcctResult } from 'occt-import-js'
import { boundsCenter, cadRootTransform, type CadAlignment } from './alignment'
import type { SceneObject, SceneObjects, Transform, Vec3 } from '../scene/model'

export type Bounds = { min: Vec3; max: Vec3 }

export type ImportedMesh = {
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

export type ImportedModel = { root: ImportedNode; meshes: ImportedMesh[] }

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

function convertMesh(mesh: OcctMesh): ImportedMesh | null {
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
  const meshes = result.meshes.map(convertMesh)
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
  return { root, meshes: used }
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

// 불러온 모델을 씬 오브젝트로 만든다: 로봇(필드 중앙) → CAD 루트(정렬) → 어셈블리·파트.
// 파트 형상은 meshIndex로 가리키고, 호출한 쪽이 geometryIds에 맞춰 형상을 등록한다.
export function buildSceneObjects(
  model: ImportedModel,
  options: { fileName: string; alignment: CadAlignment; createId: () => string }
): { objects: SceneObjects; robotId: string; geometryIds: Map<number, string> } {
  const { fileName, alignment, createId } = options
  const objects: SceneObjects = {}
  const geometryIds = new Map<number, string>()

  const robotId = createId()
  objects[robotId] = {
    id: robotId,
    name: baseName(fileName),
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: IDENTITY_ROTATION }
  }

  const add = (node: ImportedNode, parentId: string, transform: Transform): string => {
    const id = createId()
    const object: SceneObject = { id, name: node.name, kind: node.kind, parentId, transform }
    if (node.meshIndex !== undefined) {
      const geometryId = createId()
      geometryIds.set(node.meshIndex, geometryId)
      object.visual = { type: 'mesh', geometryId, color: model.meshes[node.meshIndex].color }
    }
    objects[id] = object

    // 자식 피벗은 부모 피벗(경계 상자 중심) 기준 상대 위치다. CAD 루트 아래에는 회전이 없다.
    const center = boundsCenter(node.bounds)
    for (const child of node.children) {
      const childCenter = boundsCenter(child.bounds)
      add(child, id, {
        position: [0, 1, 2].map((i) => childCenter[i] - center[i]) as Vec3,
        rotation: IDENTITY_ROTATION
      })
    }
    return id
  }

  const cadRootId = add(model.root, robotId, cadRootTransform(model.root.bounds, alignment))
  objects[cadRootId].cad = { fileName, ...alignment, bounds: model.root.bounds }

  return { objects, robotId, geometryIds }
}
