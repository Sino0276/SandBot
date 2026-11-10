import { Matrix4 } from 'three'
import { childrenInDocument, transformToMatrix, type SceneObject, type SceneObjects } from './model'

// 로봇 하위의 모양 오브젝트(CAD 메시·임시 모양)와 그 로봇 좌표 행렬 표(씬 문서·로봇마다 한 번). 부모 사슬을 한 번만 내려가며
// 곱하므로 큰 CAD(메시 1761개)에서도 오브젝트마다 worldMatrix를 다시 곱하지 않는다. 센서·웹캠 자기 가림(4c·4d,
// editor/hardware/sensorSelfHit.ts)은 CAD 메시('mesh')만 쓰고, 충돌 형상의 자동 볼록 껍질(5, play/worldColliders.ts의 몸체
// 풀이와 같은 규칙)은 임시 모양도 쓴다(임시 상자 로봇의 섀시가 18 in 상자가 되게).

export type RobotMeshEntry = {
  id: string
  // mesh: CAD 메시(형상은 geometryRegistry의 geometryId), placeholder: 임시 모양(scene/localBounds.ts PLACEHOLDER_BOUNDS)
  kind: 'mesh' | 'placeholder'
  // mesh의 형상 id(placeholder는 빈 글자)
  geometryId: string
  // 로봇 좌표 → 오브젝트 로컬
  toLocal: Matrix4
  // 오브젝트 로컬 → 로봇 좌표
  toRobot: Matrix4
}

const meshIndex = new WeakMap<SceneObjects, Map<string, readonly RobotMeshEntry[]>>()

// 로봇과 그 하위의 모양 오브젝트(문서 순서, 깊이 우선). 같은 문서·로봇이면 같은 배열이다
export function robotMeshes(objects: SceneObjects, robotId: string): readonly RobotMeshEntry[] {
  let byRobot = meshIndex.get(objects)
  if (!byRobot) meshIndex.set(objects, (byRobot = new Map()))
  const cached = byRobot.get(robotId)
  if (cached) return cached
  const entries: RobotMeshEntry[] = []
  const add = (id: string, matrix: Matrix4): void => {
    const visual = objects[id].visual
    if (visual)
      entries.push({
        id,
        kind: visual.type,
        geometryId: visual.type === 'mesh' ? visual.geometryId : '',
        toLocal: matrix.clone().invert(),
        toRobot: matrix
      })
  }
  const walk = (parentId: string, parentMatrix: Matrix4): void => {
    for (const child of childrenInDocument(objects, parentId)) {
      const matrix = parentMatrix.clone().multiply(transformToMatrix(child.transform))
      add(child.id, matrix)
      walk(child.id, matrix)
    }
  }
  // 로봇 자신의 모양(임시 상자 로봇)은 로봇 좌표 그대로다
  if (objects[robotId]) {
    add(robotId, new Matrix4())
    walk(robotId, new Matrix4())
  }
  byRobot.set(robotId, entries)
  return entries
}

// 오브젝트 하나의 로봇 좌표 행렬(robotMeshes의 표와 같은 곱셈 순서: 로봇 단위 행렬부터 부모 사슬을 내려가며 곱한다). 로봇 밖이면
// null. 모양이 없는 오브젝트(그룹 등)에 붙인 Collider의 틀에 쓴다(새 행렬)
export function robotObjectMatrix(
  objects: SceneObjects,
  robotId: string,
  id: string
): Matrix4 | null {
  const chain: string[] = []
  let current: SceneObject | undefined = objects[id]
  const visited = new Set<string>()
  while (current && current.id !== robotId) {
    if (visited.has(current.id)) return null
    visited.add(current.id)
    chain.push(current.id)
    current = current.parentId !== null ? objects[current.parentId] : undefined
  }
  if (!current) return null
  let matrix = new Matrix4()
  for (let k = chain.length - 1; k >= 0; k--)
    matrix = matrix.clone().multiply(transformToMatrix(objects[chain[k]].transform))
  return matrix
}
