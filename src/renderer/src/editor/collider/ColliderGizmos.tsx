import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineDashedMaterial,
  type LineSegments
} from 'three'
import { simPoseOf, usePlayStore } from '../../play/playStore'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { useJointPreviewStore } from '../joint/jointPreviewStore'
import {
  COLLIDER_DISABLED_COLOR,
  COLLIDER_OUTLINE_COLOR,
  COLLIDER_OUTLINE_HIDDEN_OPACITY,
  COLLIDER_OUTLINE_OPACITY
} from '../scene/colliderColors'
import { useDeferredDispose } from '../scene/deferredDispose'
import { useSceneVisibilityStore } from '../sceneVisibility'
import {
  colliderGizmoBodies,
  colliderGizmoTargets,
  type ColliderGizmoBody,
  type ColliderGizmoItem,
  type ColliderGizmoStyle
} from './colliderGizmoModel'
import { collisionModelEntry, useCollisionModelRefresh } from './useCollisionModel'

// 씬 뷰 Collider 기즈모(spec-5 §7, Unity 충돌체 기즈모). 순수 모델은 colliderGizmoModel.ts다. 4e 단순 형상 윤곽과 같은 두
// 패스(깊이 검사 켬 0.9, 끔 0.2)로 초록 #91f48b 선을 그리고, 끈 Collider는 Unity 끈 색 #54c84d(0.55), 섀시 대체 상자는 점선, 지금
// 활성 오브젝트의 Collider는 불투명도 1이다. 클릭되지 않는다(레이캐스트 끔). frameloop가 demand라 바뀔 때 invalidate한다. 재질은
// 컴포넌트 수명 동안 다시 쓰고, 형상은 선분 배열이 바뀔 때 새로 만든다(자세는 그룹 행렬이라 형상을 다시 만들지 않는다). 해제는
// StrictMode의 정리 → 재실행을 견디게 미룬다(deferredDispose.ts).

// 센서·카메라 기즈모와 같은 겹 규칙
const RENDER_ORDER = 11
// 끈 Collider 불투명도(Unity 끈 색의 alpha 140/255 ≈ 0.55) [가정: 표시만]
const DISABLED_OPACITY = 0.55
// 대체 상자 점선(m) [가정: 표시만, 명세 §7 dash 0.01 m]
const DASH_SIZE = 0.01
const GAP_SIZE = 0.006

const noRaycast = (): void => {}

type Pass = {
  front: LineBasicMaterial | LineDashedMaterial
  hidden: LineBasicMaterial | LineDashedMaterial
}

class GizmoMaterials {
  readonly passes: Record<ColliderGizmoStyle, Pass>
  constructor() {
    const solid = (color: string, opacity: number, depthTest: boolean): LineBasicMaterial =>
      new LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest,
        depthWrite: false,
        toneMapped: false
      })
    const dashed = (opacity: number, depthTest: boolean): LineDashedMaterial =>
      new LineDashedMaterial({
        color: COLLIDER_OUTLINE_COLOR,
        transparent: true,
        opacity,
        depthTest,
        depthWrite: false,
        toneMapped: false,
        dashSize: DASH_SIZE,
        gapSize: GAP_SIZE
      })
    const hiddenRatio = COLLIDER_OUTLINE_HIDDEN_OPACITY / COLLIDER_OUTLINE_OPACITY
    this.passes = {
      normal: {
        front: solid(COLLIDER_OUTLINE_COLOR, COLLIDER_OUTLINE_OPACITY, true),
        hidden: solid(COLLIDER_OUTLINE_COLOR, COLLIDER_OUTLINE_HIDDEN_OPACITY, false)
      },
      active: {
        front: solid(COLLIDER_OUTLINE_COLOR, 1, true),
        hidden: solid(COLLIDER_OUTLINE_COLOR, hiddenRatio, false)
      },
      disabled: {
        front: solid(COLLIDER_DISABLED_COLOR, DISABLED_OPACITY, true),
        hidden: solid(COLLIDER_DISABLED_COLOR, DISABLED_OPACITY * hiddenRatio, false)
      },
      fallback: {
        front: dashed(COLLIDER_OUTLINE_OPACITY, true),
        hidden: dashed(COLLIDER_OUTLINE_HIDDEN_OPACITY, false)
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

function Item({
  item,
  materials
}: {
  item: ColliderGizmoItem
  materials: GizmoMaterials
}): React.JSX.Element | null {
  const geometry = useMemo(() => {
    const value = new BufferGeometry()
    value.setAttribute('position', new Float32BufferAttribute(item.segments as number[], 3))
    return value
  }, [item.segments])
  useDeferredDispose(geometry)
  if (item.segments.length === 0) return null
  const pass = materials.passes[item.style]
  const dashed = item.style === 'fallback'
  const onUpdate = dashed ? (self: LineSegments) => self.computeLineDistances() : undefined
  return (
    <>
      <lineSegments
        name={`collider.${item.key}.front`}
        geometry={geometry}
        material={pass.front}
        renderOrder={RENDER_ORDER}
        raycast={noRaycast}
        onUpdate={onUpdate}
      />
      <lineSegments
        name={`collider.${item.key}.hidden`}
        geometry={geometry}
        material={pass.hidden}
        renderOrder={RENDER_ORDER}
        raycast={noRaycast}
        onUpdate={onUpdate}
      />
    </>
  )
}

function Body({
  body,
  materials
}: {
  body: ColliderGizmoBody
  materials: GizmoMaterials
}): React.JSX.Element {
  return (
    <group matrix={body.matrix} matrixAutoUpdate={false}>
      {body.items.map((item) => (
        <Item key={item.key} item={item} materials={materials} />
      ))}
    </group>
  )
}

function ColliderGizmos(): React.JSX.Element {
  const objects = useSceneStore((state) => state.objects)
  const revision = useSceneStore((state) => state.geometryRevision)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const activeId = useEditorStore((state) => state.selectedId)
  const hidden = useSceneVisibilityStore((state) => state.hidden)
  const isolated = useSceneVisibilityStore((state) => state.isolated)
  // 기즈모가 쓰는 실행 값만 구독한다(활성·떼어 놓음·로봇·충돌 몸체·관절). 텔레메트리·장치마다 run이 새 객체가 되어도 이것들은
  // 그대로라 다시 계산하지 않는다(SensorGizmos와 같은 이유). 계산은 지금 run을 읽는다
  const runKey = usePlayStore(
    useShallow((state) => {
      const current = state.run
      return current
        ? [
            current.phase === 'finished',
            current.detached,
            current.robotId,
            current.colliders,
            current.joints
          ]
        : []
    })
  )
  const simPose = usePlayStore(simPoseOf)
  const preview = useJointPreviewStore()
  const refresh = useCollisionModelRefresh()
  const invalidate = useThree((state) => state.invalidate)
  const materials = useMemo(() => new GizmoMaterials(), [])
  useDeferredDispose(materials)
  const bodies = useMemo(() => {
    void runKey
    void refresh
    const run = usePlayStore.getState().run
    const models = (robotId: string): ReturnType<typeof collisionModelEntry> =>
      collisionModelEntry(objects, revision, robotId)
    const targets = colliderGizmoTargets(
      objects,
      selectedIds,
      (robotId) => models(robotId)?.joints ?? null
    )
    return colliderGizmoBodies({
      objects,
      targets,
      models,
      play: { run, simPose },
      preview,
      visibility: { hidden, isolated, fieldHidden: false },
      activeId
    })
  }, [
    objects,
    revision,
    selectedIds,
    activeId,
    hidden,
    isolated,
    runKey,
    simPose,
    preview,
    refresh
  ])
  useEffect(() => {
    invalidate()
    return () => invalidate()
  }, [bodies, invalidate])
  return (
    <>
      {bodies.map((body) => (
        <Body key={body.key} body={body} materials={materials} />
      ))}
    </>
  )
}

export default ColliderGizmos
