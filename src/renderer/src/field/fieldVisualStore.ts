import type { BufferGeometry } from 'three'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { FieldVisualStatusEntry } from '../project/projectStore'
import type { FieldVisual } from '../scene/fieldDoc'
import type { Vec3 } from '../scene/model'
import type { BuiltFieldVisual } from './fieldVisualModel'

// 불러온 필드 CAD 형상(spec-4e §3.1). 씬 문서 밖의 보기 전용 형상이라 geometryRegistry가 아니라 여기에 둔다. 칸은 하나다
// (가장 최근에 읽은 파일). 형상은 모듈 변수이고 zustand에는 직렬화할 수 있는 요약만 둔다.
// 지우기(문서 visual을 뗌)는 형상을 해제하지 않는다(실행 취소로 되살리면 바로 보인다). 해제는 다른 파일로 바꿔 끼울 때와
// 프로젝트를 열 때(clearLoadedFieldVisual)뿐이다.

export type FieldVisualGroup = {
  key: string
  color: Vec3 // sRGB 0–1
  vertexColors: boolean
  glass: boolean
  decal: boolean // 얇은 겹(테이프, spec-4e §1.4)
  geometry: BufferGeometry // CAD 좌표(m), 정렬 전, boundingSphere·boundingBox 계산됨
}

export type FieldVisualInfo = {
  path: string // 이 형상을 읽은 STEP 절대 경로
  revision: number // 바꿔 끼울 때마다 +1
  meshCount: number
  triangleCount: number
  glassMeshCount: number
  bounds: { min: Vec3; max: Vec3 } // 묶음 boundingBox의 합(CAD 좌표, 정렬 전)
}

export const useFieldVisualStore: UseBoundStore<StoreApi<{ loaded: FieldVisualInfo | null }>> =
  create<{ loaded: FieldVisualInfo | null }>()(() => ({ loaded: null }))

let groups: readonly FieldVisualGroup[] = []
let revision = 0

function disposeGroups(list: readonly FieldVisualGroup[]): void {
  for (const group of list) group.geometry.dispose()
}

// 새 형상으로 바꿔 끼운다. set을 먼저 하고 이전 형상을 해제한다(메시가 이전 형상을 든 채 프레임이 그려지면 three가 GPU
// 버퍼를 다시 올리고 다시는 해제하지 않는다). 같은 경로로 다시 넣어도 이전 것을 해제한다.
export function setLoadedFieldVisual(path: string, built: BuiltFieldVisual): void {
  const previous = groups
  groups = built.groups
  revision += 1
  useFieldVisualStore.setState({
    loaded: {
      path,
      revision,
      meshCount: built.meshCount,
      triangleCount: built.triangleCount,
      glassMeshCount: built.glassMeshCount,
      bounds: { min: [...built.bounds.min], max: [...built.bounds.max] }
    }
  })
  if (previous !== built.groups) disposeGroups(previous)
}

// 칸을 비운다(프로젝트 열기). loaded를 null로 둔 뒤 형상을 해제한다.
export function clearLoadedFieldVisual(): void {
  const previous = groups
  groups = []
  useFieldVisualStore.setState({ loaded: null })
  disposeGroups(previous)
}

// 지금 loaded의 묶음
export function fieldVisualGroups(): readonly FieldVisualGroup[] {
  return groups
}

// 문서 visual의 경로 형상이 칸에 있는가(그리기는 이것만 본다, 읽기 상태는 보지 않는다)
export function fieldCadReady(
  visual: FieldVisual | undefined,
  loaded: FieldVisualInfo | null
): boolean {
  return !!visual && !!loaded && loaded.path === visual.absolutePath
}

// Field 인스펙터의 상태 배지
export type FieldVisualState =
  'none' | 'shown' | 'loading' | 'failed' | 'cancelled' | 'missing' | 'unloaded'

// 상태는 그 경로의 것만 쓴다(mine). 순서: visual 없음 → 내 경로 읽는 중 → 내 경로 못 찾음(그린 형상이 남아 있어도) →
// 그려져 있음(실패·취소보다 먼저: [다시 불러오기]가 실패해도 이전 형상은 그 경로의 유효한 형상이다) → 내 경로 실패·취소 →
// 읽지 않음
export function fieldVisualState(
  visual: FieldVisual | undefined,
  status: FieldVisualStatusEntry | null,
  loaded: FieldVisualInfo | null
): FieldVisualState {
  if (!visual) return 'none'
  const mine = status !== null && status.path === visual.absolutePath ? status.status : null
  if (mine === 'loading') return 'loading'
  if (mine === 'missing') return 'missing'
  if (fieldCadReady(visual, loaded)) return 'shown'
  if (mine === 'failed' || mine === 'cancelled') return mine
  return 'unloaded'
}
