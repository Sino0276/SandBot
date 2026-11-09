import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineDashedMaterial,
  MeshBasicMaterial,
  SphereGeometry,
  type LineSegments
} from 'three'
import { trueIntrinsics } from '../../../../shared/sim/cameraData'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { sensorPoseFromMatrix } from '../../../../shared/sim/sensorFrame'
import { DEFAULT_DECIMATION } from '../../../../shared/sim/vision'
import type { Vec3 as SimVec3 } from '../../../../shared/sim/worldSpec'
import { simPoseOf, usePlayStore } from '../../play/playStore'
import { cameraExclusions } from '../../play/worldCameras'
import { objectLocalBounds } from '../../scene/localBounds'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import {
  documentSeasonId,
  hiveTippedOf,
  lockedRunField,
  runLocksField
} from '../field/fieldDisplay'
import { fieldVisionFor } from '../hardware/cameraReading'
import { useJointPreviewStore } from '../joint/jointPreviewStore'
import { useSceneVisibilityStore } from '../sceneVisibility'
import {
  CAMERA_GIZMO_COLOR,
  cameraGizmoGeometry,
  cameraGizmoPose,
  cameraGizmoTargets,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  type CameraGizmoGeometry,
  type CameraGizmoTarget
} from './cameraGizmoModel'
import { useDeferredDispose } from './deferredDispose'
import {
  SENSOR_EXCLUDED_COLOR,
  SENSOR_EXCLUDED_OPACITY,
  SENSOR_WARNING_COLOR,
  type GizmoSegment
} from './sensorGizmoModel'

// 씬 뷰의 웹캠 기즈모(4d, spec-4d §1.15). Unity가 고른 Camera의 절두체를 그리듯 고른 오브젝트(또는 그 상위)의 웹캠을
// 그린다. 순수 모델은 cameraGizmoModel.ts다. 클릭되지 않고(레이캐스트 끔) 깊이 검사를 끈다(4c SensorGizmos와 같음).
// frameloop가 demand라 바뀔 때 invalidate한다. 재질은 컴포넌트 수명 동안 다시 쓰고, 형상은 바뀔 때 새로 만든다. 해제는
// StrictMode의 정리 → 재실행을 견디게 미룬다(deferredDispose.ts).

// 렌즈 점 반지름(m) [가정: 4c 센서 원점 점과 같은 4 mm]
const ORIGIN_RADIUS = 0.004
// 점선 모양(m) [가정: 4c 센서 기즈모와 같은 간격. 태그 변 8.3 cm에서 점선으로 읽힌다]
const DASH_SIZE = 0.01
const GAP_SIZE = 0.006
const RENDER_ORDER = 11

const noRaycast = (): void => {}
const overlay = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false }

type GizmoMaterials = {
  line: Record<'camera' | 'excluded', LineBasicMaterial>
  warning: LineDashedMaterial
  point: Record<'camera' | 'excluded', MeshBasicMaterial>
  dispose: () => void
}

function createMaterials(): GizmoMaterials {
  const line = (color: string, opacity = 1): LineBasicMaterial =>
    new LineBasicMaterial({ color, opacity, ...overlay })
  const point = (color: string, opacity = 1): MeshBasicMaterial =>
    new MeshBasicMaterial({ color, opacity, side: DoubleSide, ...overlay })
  const materials = {
    line: {
      camera: line(CAMERA_GIZMO_COLOR),
      excluded: line(SENSOR_EXCLUDED_COLOR, SENSOR_EXCLUDED_OPACITY)
    },
    warning: new LineDashedMaterial({
      color: SENSOR_WARNING_COLOR,
      dashSize: DASH_SIZE,
      gapSize: GAP_SIZE,
      ...overlay
    }),
    point: {
      camera: point(CAMERA_GIZMO_COLOR),
      excluded: point(SENSOR_EXCLUDED_COLOR, SENSOR_EXCLUDED_OPACITY)
    }
  }
  return {
    ...materials,
    dispose: () => {
      for (const material of [
        ...Object.values(materials.line),
        materials.warning,
        ...Object.values(materials.point)
      ])
        material.dispose()
    }
  }
}

function segmentGeometry(segments: readonly GizmoSegment[]): BufferGeometry {
  const positions: number[] = []
  for (const { from, to } of segments) positions.push(from.x, from.y, from.z, to.x, to.y, to.z)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geometry
}

const vec = (v: SimVec3): [number, number, number] => [v.x, v.y, v.z]

function Lines({
  segments,
  material,
  dashed
}: {
  segments: readonly GizmoSegment[]
  material: LineBasicMaterial | LineDashedMaterial
  dashed: boolean
}): React.JSX.Element | null {
  const geometry = useMemo(() => segmentGeometry(segments), [segments])
  useDeferredDispose(geometry)
  if (segments.length === 0) return null
  return (
    <lineSegments
      geometry={geometry}
      material={material}
      renderOrder={RENDER_ORDER}
      raycast={noRaycast}
      onUpdate={dashed ? (self: LineSegments) => self.computeLineDistances() : undefined}
    />
  )
}

// 모듈에서 함께 쓰는 점 형상(해제하지 않는다, SensorGizmos와 같은 방식)
const SPHERE = new SphereGeometry(1, 12, 8)

function GizmoView({
  geometry,
  materials
}: {
  geometry: CameraGizmoGeometry
  materials: GizmoMaterials
}): React.JSX.Element {
  const tone = geometry.excluded ? 'excluded' : 'camera'
  const pivotLine = useMemo(
    () => [{ from: geometry.pivot, to: geometry.origin }],
    [geometry.pivot, geometry.origin]
  )
  return (
    <group>
      <mesh
        position={vec(geometry.origin)}
        geometry={SPHERE}
        material={materials.point[tone]}
        scale={ORIGIN_RADIUS}
        renderOrder={RENDER_ORDER}
        raycast={noRaycast}
      />
      <Lines segments={pivotLine} material={materials.line[tone]} dashed={false} />
      <Lines segments={geometry.frustum} material={materials.line[tone]} dashed={false} />
      <Lines segments={geometry.visibleTags} material={materials.line.camera} dashed={false} />
      <Lines segments={geometry.occludedTags} material={materials.warning} dashed />
    </group>
  )
}

const objectBounds =
  (objects: SceneObjects) =>
  (id: string): ReturnType<typeof objectLocalBounds> =>
    objectLocalBounds(objects, id)

function CameraGizmo({
  target,
  materials
}: {
  target: CameraGizmoTarget
  materials: GizmoMaterials
}): React.JSX.Element | null {
  const objects = useSceneStore((state) => state.objects)
  const fieldDoc = useSceneStore((state) => state.field)
  const revision = useSceneStore((state) => state.geometryRevision)
  const hiveState = usePlayStore((state) => state.settings.hiveState)
  // 기즈모가 쓰는 실행 값만 구독한다(4c SensorGizmos와 같은 이유: 텔레메트리·장치마다 run이 새 객체가 되어도 그대로)
  const runKey = usePlayStore(
    useShallow((state) => {
      const current = state.run
      return current
        ? [
            current.phase === 'finished',
            current.detached,
            current.robotId,
            current.cameras,
            current.joints,
            current.field
          ]
        : []
    })
  )
  const simPose = usePlayStore((state) => {
    const current = simPoseOf(state)
    return current && current.robotId === target.robotId ? current : null
  })
  const preview = useJointPreviewStore()
  const invalidate = useThree((state) => state.invalidate)
  const geometry = useMemo(() => {
    void revision
    void runKey
    const run = usePlayStore.getState().run
    const pose = cameraGizmoPose(objects, target, { run, simPose }, preview, objectBounds(objects))
    if (!pose) return null
    // 실행이 잠근 로봇인데 run.cameras에 없는 웹캠은 시뮬레이터가 쓰지 않는다(빠졌거나 INIT 뒤에 붙임)
    const exclusion =
      pose.source === 'run'
        ? null
        : runLocksField(run) && run.robotId === target.robotId
          ? 'notInRun'
          : (cameraExclusions(objects, target.robotId).get(target.key) ?? null)
    const locked = lockedRunField(run)
    const season = locked?.season ?? documentSeasonId(fieldDoc)
    const hiveTipped = locked?.hiveTipped ?? hiveTippedOf(hiveState)
    const spec = resolveSeason(season)
    const lens = trueIntrinsics(pose.model, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    // 태그는 편집·미리보기 자세에서만(실행 중인 로봇은 숨김). 구성에 없는 웹캠(notConfigured)은 회색이지만 인스펙터 줄처럼
    // 보이는 태그를 그린다(시리얼을 넣기 전에도 조준을 맞출 수 있게)
    const showTags = pose.showTags && (exclusion === null || exclusion === 'notConfigured')
    const observations = showTags
      ? fieldVisionFor(spec, hiveTipped).observe(
          sensorPoseFromMatrix(pose.matrix.elements),
          pose.model,
          PREVIEW_WIDTH,
          PREVIEW_HEIGHT,
          DEFAULT_DECIMATION
        )
      : null
    return cameraGizmoGeometry({
      matrix: pose.matrix.elements,
      pivot: { x: pose.pivot.x, y: pose.pivot.y, z: pose.pivot.z },
      lens,
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      excluded: exclusion !== null,
      tags: observations ? { field: spec, hiveTipped, observations } : null
    })
  }, [objects, fieldDoc, revision, hiveState, runKey, simPose, preview, target])
  useEffect(() => {
    invalidate()
    return () => invalidate()
  }, [geometry, invalidate])
  if (!geometry) return null
  return <GizmoView geometry={geometry} materials={materials} />
}

function CameraGizmos(): React.JSX.Element {
  const objects = useSceneStore((state) => state.objects)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const hidden = useSceneVisibilityStore((state) => state.hidden)
  const isolated = useSceneVisibilityStore((state) => state.isolated)
  const targets = useMemo(
    () => cameraGizmoTargets(objects, selectedIds, { hidden, isolated, fieldHidden: false }),
    [objects, selectedIds, hidden, isolated]
  )
  const materials = useMemo(() => createMaterials(), [])
  useDeferredDispose(materials)
  return (
    <>
      {targets.map((target) => (
        <CameraGizmo key={target.key} target={target} materials={materials} />
      ))}
    </>
  )
}

export default CameraGizmos
