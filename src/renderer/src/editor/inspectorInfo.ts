import { Quaternion, Vector3, type Matrix4 } from 'three'
import { cadOriginOf } from '../scene/hierarchy'
import {
  ancestorIds,
  isInSubtree,
  worldMatrix,
  type CadSource,
  type SceneObjects
} from '../scene/model'

// 인스펙터가 보여 주는 계산값(순수 함수, Vitest에 DOM 환경이 없어서 컴포넌트 밖에 둔다)

// 이 값보다 덜 다르면 같은 방향으로 본다(쿼터니언 내적 기준, 약 0.005°). 부모 바꾸기의 행렬 계산 오차를 견딘다.
const SAME_ROTATION_EPSILON = 1e-9

function worldRotation(matrix: Matrix4): Quaternion {
  const rotation = new Quaternion()
  matrix.decompose(new Vector3(), rotation, new Vector3())
  return rotation
}

// 오브젝트(또는 그 하위)를 CAD 루트 밖으로 옮겼으면 그 CAD 루트 id. CAD 루트 안에 있거나, CAD 루트 자신이거나,
// CAD에서 오지 않은 오브젝트(그룹·로봇 포함)면 null. 인스펙터가 CAD 파일 행과 루트 링크를 보이는 데 쓴다.
export function movedOutCadRoot(objects: SceneObjects, id: string): string | null {
  const origin = cadOriginOf(objects, id)
  return origin !== null && origin !== id && !isInSubtree(objects, id, origin) ? origin : null
}

// 인스펙터 값(부모 기준 로컬 값)의 축이 CAD 파일의 축이면 그 CAD 정보. CAD 루트 아래 파트는 위가 +Y일 수 있어
// 알려 준다. 부모의 월드 방향이 그 CAD 루트의 월드 방향과 같을 때만 그렇다. 그래서 중간 노드를 돌렸으면
// 알리지 않고, CAD 밖으로 옮긴 어셈블리의 하위(어셈블리가 CAD 방향을 그대로 가짐)에는 알린다.
// CAD 루트 자신은 부모가 로봇이라 해당하지 않는다.
export function parentCadAxes(objects: SceneObjects, id: string): CadSource | undefined {
  const object = objects[id]
  if (!object?.parentId || object.cad) return undefined
  // 출처가 없는 그룹(CAD 안에 만든 그룹 등)은 위로 올라가며 처음 만나는 출처를 쓴다
  let rootId: string | null = null
  for (const candidate of [id, ...ancestorIds(objects, id)]) {
    rootId = cadOriginOf(objects, candidate)
    if (rootId !== null) break
  }
  const cad = rootId !== null ? objects[rootId]?.cad : undefined
  if (rootId === null || !cad) return undefined
  const parent = worldRotation(worldMatrix(objects, object.parentId))
  const root = worldRotation(worldMatrix(objects, rootId))
  return 1 - Math.abs(parent.dot(root)) < SAME_ROTATION_EPSILON ? cad : undefined
}
