import { BufferAttribute, BufferGeometry } from 'three'
import { boundsCenter } from '../cad/alignment'
import type { ImportedMesh, ImportedModel } from '../cad/stepImport'
import type { Vec3 } from '../scene/model'
import type { FieldVisualGroup } from './fieldVisualStore'

// 필드 CAD 보기(spec-4e §1.4·§1.5): 불러온 STEP 메시를 재질 묶음마다 형상 하나로 합친다. 씬 문서·형상 id·BVH·질량 성질을
// 만들지 않는 보기 전용 형상이다. 입력 ImportedModel은 읽기만 한다(메시 캐시에 같은 객체가 쓰이므로 배열을 바꾸지 않는다).

// 반투명 묶음으로 그릴 메시 이름(ImportedMesh.name, occt 메시 이름) [결정: 메시 이름 규칙]. 공식 BIOBUZZ 필드 CAD의
// 폴리카보네이트 벽 판 "FTC Field Side Glass 11in" 12개만 맞는다(색이 알루미늄 부품과 같은 회색이라 색으로 가를 수 없다).
export const FIELD_GLASS_NAME = /glass|polycarbonate|lexan/i

// 투명판 불투명도 [가정: 표시만]. 단순 형상의 벽 판(fieldViewModel.ts PANEL_OPACITY)과 같은 값이다.
export const FIELD_CAD_GLASS_OPACITY = 0.25

// 경계 상자 최소 변이 이 값 이하인 메시는 얇은 겹(decal, 테이프) 묶음이다(m) [가정: 표시만]. 공식 파일의 테이프
// "Gaffer Tape …"는 두께 0.01 in(0.254 mm)이고 아랫면이 타일 윗면과 같은 평면이라 polygonOffset으로 그린다.
export const FIELD_CAD_DECAL_THICKNESS = 0.0005

export type BuiltFieldVisual = {
  groups: FieldVisualGroup[]
  meshCount: number
  triangleCount: number
  glassMeshCount: number
  // 묶음 boundingBox의 합(CAD 좌표, 정렬 전)
  bounds: { min: Vec3; max: Vec3 }
}

// 투명판인지(이름 규칙). 정규식에 g 깃발이 없어 test가 상태를 갖지 않는다.
export function isFieldGlassMesh(mesh: Pick<ImportedMesh, 'name'>): boolean {
  return FIELD_GLASS_NAME.test(mesh.name)
}

// 얇은 겹인지(경계 상자 최소 변). 정렬과 무관하다(어느 축이든 얇음).
export function isFieldDecalMesh(mesh: Pick<ImportedMesh, 'bounds'>): boolean {
  const { min, max } = mesh.bounds
  return Math.min(max[0] - min[0], max[1] - min[1], max[2] - min[2]) <= FIELD_CAD_DECAL_THICKNESS
}

// 묶음 키: 기본 색(sRGB 0–1 그대로)·꼭짓점 색 유무·투명판·얇은 겹. 같은 키의 메시는 재질이 같다.
export function fieldVisualGroupKey(mesh: ImportedMesh): string {
  const flag = (value: boolean): number => (value ? 1 : 0)
  return `${mesh.color.join(',')}|${flag(!!mesh.colors)}|${flag(isFieldGlassMesh(mesh))}|${flag(isFieldDecalMesh(mesh))}`
}

type Pending = {
  key: string
  meshes: ImportedMesh[]
  color: Vec3
  vertexColors: boolean
  glass: boolean
  decal: boolean
  vertices: number
  indices: number
}

// 법선이 없는 메시의 법선. 모델의 배열을 감싸면 제자리에서 바뀔 수 있으므로 위치·인덱스 사본으로 만든 임시 형상에서 구한다.
function computedNormals(mesh: ImportedMesh): Float32Array {
  const temp = new BufferGeometry()
  temp.setAttribute('position', new BufferAttribute(mesh.positions.slice(), 3))
  temp.setIndex(new BufferAttribute(mesh.indices.slice(), 1))
  temp.computeVertexNormals()
  const normals = (temp.getAttribute('normal').array as Float32Array).slice()
  temp.dispose()
  return normals
}

// 한 묶음의 메시를 새 배열에 직접 합친다(createGeometry·translate·mergeGeometries를 쓰지 않는다: 앞의 둘은 모델 배열을
// 감싸 제자리에서 바꾸고, 마지막은 JS 배열로 인덱스를 합쳐 느리다). 정점은 피벗 기준 좌표 + 경계 상자 중심 = CAD 좌표(m)다
// (더하기는 double, 쓸 때 float로 잘린다).
function buildGroup(pending: Pending): FieldVisualGroup {
  const positions = new Float32Array(pending.vertices * 3)
  const normals = new Float32Array(pending.vertices * 3)
  const colors = pending.vertexColors ? new Float32Array(pending.vertices * 3) : null
  const index = new Uint32Array(pending.indices)
  let vertexOffset = 0
  let indexOffset = 0
  for (const mesh of pending.meshes) {
    const center = boundsCenter(mesh.bounds)
    const base = vertexOffset * 3
    const source = mesh.positions
    for (let k = 0; k < source.length; k++) positions[base + k] = source[k] + center[k % 3]
    normals.set(mesh.normals ?? computedNormals(mesh), base)
    if (colors && mesh.colors) colors.set(mesh.colors, base)
    const indices = mesh.indices
    for (let i = 0; i < indices.length; i++) index[indexOffset + i] = indices[i] + vertexOffset
    vertexOffset += source.length / 3
    indexOffset += indices.length
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  if (colors) geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return {
    key: pending.key,
    color: [...pending.color],
    vertexColors: pending.vertexColors,
    glass: pending.glass,
    decal: pending.decal,
    geometry
  }
}

// 메시를 묶어 형상으로 만든다(결정적: 묶음 순서는 model.meshes에서 키가 처음 나온 순서). 입력 모델을 바꾸지 않고, 결과는
// 모델 배열을 참조하지 않는다(합친 뒤 모델을 들고 있지 않아도 된다).
export function buildFieldVisual(model: ImportedModel): BuiltFieldVisual {
  // 키는 숫자처럼 보이지 않는 글자('|' 포함)라 Map 삽입 순서가 처음 나온 순서다
  const pendings = new Map<string, Pending>()
  let triangleCount = 0
  let glassMeshCount = 0
  for (const mesh of model.meshes) {
    const key = fieldVisualGroupKey(mesh)
    let pending = pendings.get(key)
    if (!pending) {
      pending = {
        key,
        meshes: [],
        color: mesh.color,
        vertexColors: !!mesh.colors,
        glass: isFieldGlassMesh(mesh),
        decal: isFieldDecalMesh(mesh),
        vertices: 0,
        indices: 0
      }
      pendings.set(key, pending)
    }
    pending.meshes.push(mesh)
    pending.vertices += mesh.positions.length / 3
    pending.indices += mesh.indices.length
    triangleCount += mesh.indices.length / 3
    if (pending.glass) glassMeshCount += 1
  }
  const groups = [...pendings.values()].map(buildGroup)
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const { geometry } of groups) {
    const box = geometry.boundingBox
    if (!box || box.isEmpty()) continue
    const lo = box.min.toArray()
    const hi = box.max.toArray()
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], lo[i])
      max[i] = Math.max(max[i], hi[i])
    }
  }
  const bounds = Number.isFinite(min[0])
    ? { min, max }
    : { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 }
  return { groups, meshCount: model.meshes.length, triangleCount, glassMeshCount, bounds }
}
