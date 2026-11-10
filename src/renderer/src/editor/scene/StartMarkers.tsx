import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type Group } from 'three'
import { usePlayStore } from '../../play/playStore'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { runLocksField } from '../field/fieldDisplay'
import {
  handleStartMarkerClick,
  presetSeason,
  startPresetModel,
  startTargetRobotId
} from '../field/startPresetModel'
import { fieldElementsHidden, useSceneVisibilityStore } from '../sceneVisibility'
import { useDeferredDispose, type Disposable } from './deferredDispose'
import {
  startMarkerCursor,
  startMarkerMaterialKey,
  startMarkersShown,
  startMarkerSpecs,
  type FieldMaterialSpec,
  type StartMarkerSpec
} from './fieldViewModel'
import { markerOccluded } from './startMarkerHover'

// 씬 뷰 시작 표시(spec-4ab §1.9): 문서 시즌의 시작 프리셋마다 반투명 사각형(벽에서 18 in). 누르면 대상 로봇(활성 오브젝트의
// 로봇)을 누른 점의 벽 방향 좌표로 그 프리셋에 스냅한다. 선택은 바꾸지 않는다. 대상 로봇의 지금 면으로 스냅해 너무 넓거나
// 겹치는 프리셋은 흐리고 누를 수 없다. Field만 골랐으면 모두 보통으로 그리되 누를 수 없다.

function markerPlacement(marker: StartMarkerSpec): { position: Vector3; quaternion: Quaternion } {
  const position = new Vector3()
  const quaternion = new Quaternion()
  new Matrix4().fromArray(marker.matrix).decompose(position, quaternion, new Vector3())
  return { position, quaternion }
}

// 재질 묶음: (얼라이언스 색, 불투명도, offset 종류)마다 하나를 컴포넌트 수명 동안 함께 쓴다(startMarkerMaterialKey)
class MarkerMaterialPool implements Disposable {
  private readonly materials = new Map<string, MeshBasicMaterial>()

  get(spec: FieldMaterialSpec): MeshBasicMaterial {
    const key = startMarkerMaterialKey(spec)
    let material = this.materials.get(key)
    if (!material) {
      material = new MeshBasicMaterial({
        color: spec.color,
        transparent: spec.transparent,
        opacity: spec.opacity,
        depthWrite: spec.depthWrite
      })
      material.polygonOffset = true
      material.polygonOffsetFactor = -1
      material.polygonOffsetUnits = spec.polygonOffsetUnits
      this.materials.set(key, material)
    }
    return material
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }
}

type Hover = { key: string; occluded: boolean }

function setCanvasCursor(canvas: HTMLElement, cursor: string): void {
  canvas.style.cursor = cursor
}

// 보이는 동안만 붙는 표시 메시들. 커서는 이 컴포넌트의 호버 상태로 정하고 effect가 캔버스에 쓰므로, 표시가 내려가면(실행
// 잠금·숨김·고립 보기·대상 없음) 정리가 커서를 되돌리고, 흐림·누를 수 있음이 바뀌면 커서도 바로 따른다(R3F는 호버 중 내려간
// 오브젝트에 pointerout을 보내지 않는다)
function StartMarkerMeshes({
  markers,
  dimmed,
  clickable,
  geometry,
  pool
}: {
  markers: readonly StartMarkerSpec[]
  dimmed: ReadonlySet<string>
  clickable: boolean
  geometry: PlaneGeometry
  pool: MarkerMaterialPool
}): React.JSX.Element {
  const gl = useThree((state) => state.gl)
  const raycaster = useThree((state) => state.raycaster)
  // R3F는 오브젝트를 내릴 때 internal.interaction을 새 배열로 바꾸고(filter) 스토어에 알리지 않으므로, 그리기 때 고른 배열은
  // 내려간 오브젝트를 계속 품고 새로 붙은 것을 놓친다. 사건 때마다 지금 배열을 읽는다
  const getState = useThree((state) => state.get)
  const group = useRef<Group>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const placements = useMemo(() => markers.map(markerPlacement), [markers])

  const hovered = hover ? markers.find((marker) => marker.key === hover.key) : undefined
  const cursor =
    hover && hovered
      ? startMarkerCursor({ clickable, dimmed: dimmed.has(hovered.key), occluded: hover.occluded })
      : ''
  useEffect(() => {
    if (!cursor) return
    const canvas = gl.domElement
    setCanvasCursor(canvas, cursor)
    return () => {
      if (canvas.style.cursor === cursor) setCanvasCursor(canvas, '')
    }
  }, [cursor, gl])

  const track = (key: string) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    const occluded =
      group.current !== null &&
      markerOccluded(raycaster, getState().internal.interaction, group.current, event.distance)
    setHover((previous) =>
      previous?.key === key && previous.occluded === occluded ? previous : { key, occluded }
    )
  }

  return (
    <group name="startMarkers" ref={group}>
      {markers.map((marker, index) => {
        const { position, quaternion } = placements[index]
        return (
          <mesh
            key={marker.key}
            name={`start.${marker.key}`}
            geometry={geometry}
            material={pool.get(marker.material)}
            position={position}
            quaternion={quaternion}
            scale={[marker.width, marker.height, 1]}
            renderOrder={marker.renderOrder}
            onClick={(event: ThreeEvent<MouseEvent>) =>
              handleStartMarkerClick({
                delta: event.delta,
                altKey: event.nativeEvent.altKey,
                point: event.point,
                stopPropagation: () => event.stopPropagation()
              })
            }
            onPointerOver={track(marker.key)}
            onPointerMove={track(marker.key)}
            onPointerOut={() =>
              setHover((previous) => (previous?.key === marker.key ? null : previous))
            }
          />
        )
      })}
    </group>
  )
}

function StartMarkers(): React.JSX.Element | null {
  const objects = useSceneStore((state) => state.objects)
  // 시즌 문자열만 구독한다(4e부터 field 객체는 필드 CAD 정렬·경로 고침에도 바뀐다, spec-4e §4.4)
  const season = useSceneStore((state) => state.field.season)
  const doc = useMemo(() => ({ season }), [season])
  const activeId = useEditorStore((state) => state.selectedId)
  const fieldSelected = useEditorStore((state) => state.fieldSelected)
  const locked = usePlayStore((state) => runLocksField(state.run))
  const elementsHidden = useSceneVisibilityStore(fieldElementsHidden)
  const invalidate = useThree((state) => state.invalidate)

  const spec = presetSeason(doc)
  const robotId = startTargetRobotId(objects, activeId)
  const shown = startMarkersShown({
    hasTarget: robotId !== null,
    fieldSelected,
    locked,
    elementsHidden,
    hasPresets: spec !== null
  })

  // 대상 로봇의 지금 면(맞는 프리셋의 면, 없으면 기본)으로 흐릴 프리셋
  const model = useMemo(
    () => (shown && robotId !== null ? startPresetModel(objects, robotId, doc, 'default') : null),
    [shown, robotId, objects, doc]
  )
  const dimmedKey = model
    ? model.options
        .filter((option) => option.disabled !== null)
        .map((option) => option.preset.key)
        .join('|')
    : ''
  const dimmed = useMemo(() => new Set(dimmedKey ? dimmedKey.split('|') : []), [dimmedKey])
  const markers = useMemo(
    () => (spec && shown ? startMarkerSpecs(spec, dimmed) : []),
    [spec, shown, dimmed]
  )
  // 형상·재질은 컴포넌트 수명 동안 하나씩이고 내려갈 때 해제한다(StrictMode의 정리 → 재실행에는 남는다)
  const geometry = useMemo(() => new PlaneGeometry(1, 1), [])
  useDeferredDispose(geometry)
  const pool = useMemo(() => new MarkerMaterialPool(), [])
  useDeferredDispose(pool)
  useEffect(() => {
    invalidate()
  }, [markers, invalidate])

  if (!shown || !spec) return null
  return (
    <StartMarkerMeshes
      markers={markers}
      dimmed={dimmed}
      clickable={robotId !== null}
      geometry={geometry}
      pool={pool}
    />
  )
}

export default StartMarkers
