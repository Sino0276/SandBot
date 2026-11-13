import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial } from 'three'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { simPoseOf, usePlayStore } from '../../play/playStore'
import { useSceneStore } from '../../scene/sceneStore'
import { capsuleSegments } from '../collider/colliderGizmoModel'
import { useEditorStore } from '../editorStore'
import { displayedField } from '../field/fieldDisplay'
import { useJointPreviewStore } from '../joint/jointPreviewStore'
import { useDeferredDispose } from '../scene/deferredDispose'
import { useSceneVisibilityStore } from '../sceneVisibility'
import { preloadGizmoItems, type PreloadGizmoStyle } from './preloadGizmoModel'

// 씬 뷰 Preload Slot 기즈모(6a, spec-6a §3): 고른 오브젝트(와 하위)의 자리마다 POLLEN 크기의 큰 원 셋(Unity Gizmos.DrawWireSphere).
// Collider 기즈모와 같은 두 패스(깊이 검사 켬 0.9, 끔 0.2)·renderOrder 11이고 클릭되지 않는다. 노랑은 세계 설명에 들어가는 자리,
// 회색은 빠지는 자리다. 재질은 컴포넌트 수명 동안, 원 형상은 반지름마다 한 번 만들고 자리는 위치로만 옮긴다. 해제는 StrictMode를
// 견디게 미룬다(deferredDispose.ts). frameloop가 demand라 바뀔 때 invalidate한다.

const RENDER_ORDER = 11
// POLLEN 노랑(ElementsView 공 색과 구별되게 조금 밝게) [가정: 표시만]
export const PRELOAD_GIZMO_COLOR = '#fde047'
// 빠진 자리(센서 기즈모의 빠진 센서와 같은 회색) [가정: 표시만]
export const PRELOAD_GIZMO_EXCLUDED_COLOR = '#64748b'
const FRONT_OPACITY = 0.9
const HIDDEN_OPACITY = 0.2

const noRaycast = (): void => {}

class GizmoMaterials {
  readonly passes: Record<
    PreloadGizmoStyle,
    { front: LineBasicMaterial; hidden: LineBasicMaterial }
  >
  constructor() {
    const line = (color: string, opacity: number, depthTest: boolean): LineBasicMaterial =>
      new LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest,
        depthWrite: false,
        toneMapped: false
      })
    this.passes = {
      used: {
        front: line(PRELOAD_GIZMO_COLOR, FRONT_OPACITY, true),
        hidden: line(PRELOAD_GIZMO_COLOR, HIDDEN_OPACITY, false)
      },
      excluded: {
        front: line(PRELOAD_GIZMO_EXCLUDED_COLOR, FRONT_OPACITY / 2, true),
        hidden: line(PRELOAD_GIZMO_EXCLUDED_COLOR, HIDDEN_OPACITY / 2, false)
      }
    }
  }
  dispose(): void {
    for (const pass of Object.values(this.passes)) {
      pass.front.dispose()
      pass.hidden.dispose()
    }
  }
}

function PreloadGizmos(): React.JSX.Element {
  const objects = useSceneStore((state) => state.objects)
  const doc = useSceneStore((state) => state.field)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const hidden = useSceneVisibilityStore((state) => state.hidden)
  const isolated = useSceneVisibilityStore((state) => state.isolated)
  const hiveState = usePlayStore((state) => state.settings.hiveState)
  // 기즈모가 쓰는 실행 값만(텔레메트리·장치마다 run이 새 객체가 되어도 다시 계산하지 않게, ColliderGizmos와 같은 이유)
  const runKey = usePlayStore(
    useShallow((state) => {
      const current = state.run
      return current
        ? [current.phase === 'finished', current.detached, current.robotId, current.field]
        : []
    })
  )
  const simPose = usePlayStore(simPoseOf)
  const preview = useJointPreviewStore()
  const invalidate = useThree((state) => state.invalidate)
  const materials = useMemo(() => new GizmoMaterials(), [])
  useDeferredDispose(materials)
  const items = useMemo(() => {
    void runKey
    const run = usePlayStore.getState().run
    // 실행이 필드를 잠그면 실행의 시즌으로(자리 규칙이 시즌의 POLLEN 크기를 쓴다)
    const field = resolveSeason(displayedField(run, doc, hiveState).season)
    return preloadGizmoItems({
      objects,
      selectedIds,
      field,
      play: { run, simPose },
      preview,
      visibility: { hidden, isolated, fieldHidden: false }
    })
  }, [objects, doc, hiveState, selectedIds, hidden, isolated, runKey, simPose, preview])
  // 반지름마다 원 셋 한 번(시즌 POLLEN 크기 하나라 보통 하나)
  const radius = items[0]?.radius ?? 0
  const geometry = useMemo(() => {
    const value = new BufferGeometry()
    const p = { x: 0, y: 0, z: 0 }
    value.setAttribute('position', new Float32BufferAttribute(capsuleSegments(p, p, radius), 3))
    return value
  }, [radius])
  useDeferredDispose(geometry)
  useEffect(() => {
    invalidate()
    return () => invalidate()
  }, [items, invalidate])
  return (
    <>
      {items.map((item) => {
        const pass = materials.passes[item.style]
        return (
          <group key={item.key} position={item.center}>
            <lineSegments
              name={`preload.${item.key}.front`}
              geometry={geometry}
              material={pass.front}
              renderOrder={RENDER_ORDER}
              raycast={noRaycast}
            />
            <lineSegments
              name={`preload.${item.key}.hidden`}
              geometry={geometry}
              material={pass.hidden}
              renderOrder={RENDER_ORDER}
              raycast={noRaycast}
            />
          </group>
        )
      })}
    </>
  )
}

export default PreloadGizmos
