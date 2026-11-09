import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineDashedMaterial,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type LineSegments
} from 'three'
import { readColorSensor } from '../../../../shared/sim/colorSensor'
import { raycasterFor } from '../../../../shared/sim/fieldRaycast'
import { readRangeSensor } from '../../../../shared/sim/rangeSensor'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { sensorPoseFromMatrix } from '../../../../shared/sim/sensorFrame'
import type { Vec3 as SimVec3 } from '../../../../shared/sim/worldSpec'
import { sensorAim, sensorMountInRobot } from '../../hardware/mounting'
import { simPoseOf, usePlayStore } from '../../play/playStore'
import { sensorExclusions } from '../../play/worldSensors'
import { objectLocalBounds } from '../../scene/localBounds'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { documentSeasonId, lockedRunField, runLocksField } from '../field/fieldDisplay'
import { SELF_HIT_COLOR_REACH, SELF_HIT_DISTANCE_REACH } from '../hardware/sensorReading'
import { selfHitFor, useSelfHitRefresh } from '../hardware/sensorSelfHit'
import { useJointPreviewStore } from '../joint/jointPreviewStore'
import { useSceneVisibilityStore } from '../sceneVisibility'
import { useDeferredDispose } from './deferredDispose'
import {
  SENSOR_COLOR_LINE_COLOR,
  SENSOR_DISTANCE_COLOR,
  SENSOR_EXCLUDED_COLOR,
  SENSOR_EXCLUDED_OPACITY,
  SENSOR_WARNING_COLOR,
  sensorGizmoGeometry,
  sensorGizmoPose,
  sensorGizmoTargets,
  type GizmoSegment,
  type SensorGizmoGeometry,
  type SensorGizmoTarget
} from './sensorGizmoModel'

// 씬 뷰의 거리·컬러 센서 기즈모(4c, spec-4c §1.9). Unity가 고른 Light(spot)·Camera의 원뿔·절두체를 그리듯 고른
// 오브젝트(또는 그 상위)의 센서를 그린다. 순수 모델은 sensorGizmoModel.ts다. 클릭되지 않고(레이캐스트 끔) 깊이 검사를 끈다
// (JointGizmo·IMU 표시와 같음). frameloop가 demand라 바뀔 때 invalidate한다. 재질은 컴포넌트 수명 동안 다시 쓰고, 형상은
// 바뀔 때 새로 만든다. 해제는 StrictMode의 정리 → 재실행을 견디게 미룬다(deferredDispose.ts).

// 표시 크기(m) [가정: FTC 센서·로봇 크기에서 보기 좋은 값. 원점 점은 명세 §1.9의 반지름 4 mm]
const ORIGIN_RADIUS = 0.004
const VALUE_RADIUS = 0.006
const RING_INNER = 0.006
const RING_OUTER = 0.009
// 점선 모양(m) [가정: 1.2 m 원뿔에서 점선으로 읽히는 간격]
const DASH_SIZE = 0.01
const GAP_SIZE = 0.006
// 컬러 발자국 채움의 불투명도 [가정: 바닥 타일·테이프가 비쳐 보이게]
const DISC_OPACITY = 0.6
const RENDER_ORDER = 11

const noRaycast = (): void => {}
const overlay = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false }
const Z = new Vector3(0, 0, 1)

type GizmoMaterials = {
  line: Record<'distance' | 'color' | 'excluded', LineBasicMaterial>
  dashed: Record<'distance' | 'color' | 'excluded' | 'warning', LineDashedMaterial>
  point: Record<'distance' | 'color' | 'excluded', MeshBasicMaterial>
  dispose: () => void
}

function createMaterials(): GizmoMaterials {
  const line = (color: string, opacity = 1): LineBasicMaterial =>
    new LineBasicMaterial({ color, opacity, ...overlay })
  const dashed = (color: string, opacity = 1): LineDashedMaterial =>
    new LineDashedMaterial({ color, opacity, dashSize: DASH_SIZE, gapSize: GAP_SIZE, ...overlay })
  const point = (color: string, opacity = 1): MeshBasicMaterial =>
    new MeshBasicMaterial({ color, opacity, side: DoubleSide, ...overlay })
  const materials = {
    line: {
      distance: line(SENSOR_DISTANCE_COLOR),
      color: line(SENSOR_COLOR_LINE_COLOR),
      excluded: line(SENSOR_EXCLUDED_COLOR, SENSOR_EXCLUDED_OPACITY)
    },
    dashed: {
      distance: dashed(SENSOR_DISTANCE_COLOR),
      color: dashed(SENSOR_COLOR_LINE_COLOR),
      excluded: dashed(SENSOR_EXCLUDED_COLOR, SENSOR_EXCLUDED_OPACITY),
      warning: dashed(SENSOR_WARNING_COLOR)
    },
    point: {
      distance: point(SENSOR_DISTANCE_COLOR),
      color: point(SENSOR_COLOR_LINE_COLOR),
      excluded: point(SENSOR_EXCLUDED_COLOR, SENSOR_EXCLUDED_OPACITY)
    }
  }
  return {
    ...materials,
    dispose: () => {
      for (const group of [materials.line, materials.dashed, materials.point])
        for (const material of Object.values(group)) material.dispose()
    }
  }
}

// 선분 목록 → 형상(LineSegments 두 점씩)
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
      // 점선은 선분마다 길이를 센다
      onUpdate={dashed ? (self: LineSegments) => self.computeLineDistances() : undefined}
    />
  )
}

function Disc({ disc }: { disc: NonNullable<SensorGizmoGeometry['disc']> }): React.JSX.Element {
  const geometry = useMemo(() => new CircleGeometry(disc.radius, 48), [disc.radius])
  useDeferredDispose(geometry)
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: disc.color,
        opacity: DISC_OPACITY,
        side: DoubleSide,
        ...overlay
      }),
    [disc.color]
  )
  useDeferredDispose(material)
  const quaternion = new Quaternion().setFromUnitVectors(Z, new Vector3(...vec(disc.normal)))
  return (
    <mesh
      position={vec(disc.center)}
      quaternion={quaternion}
      geometry={geometry}
      material={material}
      renderOrder={RENDER_ORDER - 1}
      raycast={noRaycast}
    />
  )
}

// 모듈에서 함께 쓰는 점 형상(해제하지 않는다, JointGizmo와 같은 방식)
const SPHERE = new SphereGeometry(1, 12, 8)
const RING = new RingGeometry(RING_INNER, RING_OUTER, 24)

function GizmoView({
  geometry,
  materials
}: {
  geometry: SensorGizmoGeometry
  materials: GizmoMaterials
}): React.JSX.Element {
  const tone = geometry.excluded ? 'excluded' : geometry.kind
  const pivotLine = useMemo(
    () => [{ from: geometry.pivot, to: geometry.origin }],
    [geometry.pivot, geometry.origin]
  )
  const value = geometry.value
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
      <Lines segments={geometry.solid} material={materials.line[tone]} dashed={false} />
      <Lines segments={geometry.dashed} material={materials.dashed[tone]} dashed />
      <Lines segments={geometry.warning} material={materials.dashed.warning} dashed />
      {value?.kind === 'sphere' && (
        <mesh
          position={vec(value.at)}
          geometry={SPHERE}
          material={materials.point[tone]}
          scale={VALUE_RADIUS}
          renderOrder={RENDER_ORDER}
          raycast={noRaycast}
        />
      )}
      {value?.kind === 'ring' && (
        <mesh
          position={vec(value.at)}
          quaternion={new Quaternion().setFromUnitVectors(Z, new Vector3(...vec(value.normal)))}
          geometry={RING}
          material={materials.point[tone]}
          renderOrder={RENDER_ORDER}
          raycast={noRaycast}
        />
      )}
      {geometry.disc && <Disc disc={geometry.disc} />}
    </group>
  )
}

const objectBounds =
  (objects: SceneObjects) =>
  (id: string): ReturnType<typeof objectLocalBounds> =>
    objectLocalBounds(objects, id)

function SensorGizmo({
  target,
  materials
}: {
  target: SensorGizmoTarget
  materials: GizmoMaterials
}): React.JSX.Element | null {
  const objects = useSceneStore((state) => state.objects)
  const fieldDoc = useSceneStore((state) => state.field)
  const revision = useSceneStore((state) => state.geometryRevision)
  const run = usePlayStore((state) => state.run)
  // 그 로봇이 실행 중 자세를 받을 때만 자세를 구독한다(약 60 Hz, 그 밖에는 다시 그리지 않는다)
  const simPose = usePlayStore((state) => {
    const current = simPoseOf(state)
    return current && current.robotId === target.robotId ? current : null
  })
  const preview = useJointPreviewStore()
  const refresh = useSelfHitRefresh()
  const invalidate = useThree((state) => state.invalidate)
  const geometry = useMemo(() => {
    void revision
    void refresh
    const bounds = objectBounds(objects)
    const play = { run, simPose }
    const pose = sensorGizmoPose(objects, target, play, preview, bounds)
    if (!pose) return null
    const season = lockedRunField(run)?.season ?? documentSeasonId(fieldDoc)
    const caster = raycasterFor(resolveSeason(season))
    // 실행이 잠근 로봇인데 run.sensors에 없는 센서는 시뮬레이터가 쓰지 않는다(빠졌거나 INIT 뒤에 붙임)
    const excluded =
      pose.source === 'run'
        ? false
        : runLocksField(run) && run.robotId === target.robotId
          ? true
          : sensorExclusions(objects, target.robotId).has(target.key)
    const sensorPose = sensorPoseFromMatrix(pose.matrix.elements)
    const reading =
      pose.showValues && !excluded
        ? target.type === 'distanceSensor'
          ? readRangeSensor(caster, sensorPose)
          : readColorSensor(caster, sensorPose)
        : null
    // 자기 가림은 편집 자세(문서 장착)로만 본다(시뮬레이터에 로봇 형상이 없어 경고만 한다)
    let selfHitDistance: number | null = null
    if (pose.source === 'document' && !excluded) {
      const mount = sensorMountInRobot(
        objects,
        target.objectId,
        sensorAim(target.type, target.component.props),
        bounds
      )
      const reach =
        reading?.distance ??
        (target.type === 'distanceSensor' ? SELF_HIT_DISTANCE_REACH : SELF_HIT_COLOR_REACH)
      const hit = mount
        ? selfHitFor(
            target.key,
            objects,
            revision,
            target.robotId,
            target.objectId,
            mount,
            target.type,
            reach
          )
        : null
      if (hit?.kind === 'axis') selfHitDistance = hit.distance
    }
    return sensorGizmoGeometry({
      kind: target.type === 'distanceSensor' ? 'distance' : 'color',
      matrix: pose.matrix.elements,
      pivot: { x: pose.pivot.x, y: pose.pivot.y, z: pose.pivot.z },
      caster,
      reading,
      excluded,
      selfHitDistance
    })
  }, [objects, fieldDoc, revision, run, simPose, preview, refresh, target])
  useEffect(() => {
    invalidate()
    return () => invalidate()
  }, [geometry, invalidate])
  if (!geometry) return null
  return <GizmoView geometry={geometry} materials={materials} />
}

function SensorGizmos(): React.JSX.Element {
  const objects = useSceneStore((state) => state.objects)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const hidden = useSceneVisibilityStore((state) => state.hidden)
  const isolated = useSceneVisibilityStore((state) => state.isolated)
  const targets = useMemo(
    () => sensorGizmoTargets(objects, selectedIds, { hidden, isolated, fieldHidden: false }),
    [objects, selectedIds, hidden, isolated]
  )
  const materials = useMemo(() => createMaterials(), [])
  useDeferredDispose(materials)
  return (
    <>
      {targets.map((target) => (
        <SensorGizmo key={target.key} target={target} materials={materials} />
      ))}
    </>
  )
}

export default SensorGizmos
