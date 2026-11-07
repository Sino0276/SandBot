import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three'
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
import { startMarkersShown, startMarkerSpecs, type StartMarkerSpec } from './fieldViewModel'

// 씬 뷰 시작 표시(spec-4ab §1.9): 문서 시즌의 시작 프리셋마다 반투명 사각형(벽에서 18 in). 누르면 대상 로봇(활성 오브젝트의
// 로봇)을 누른 점의 벽 방향 좌표로 그 프리셋에 스냅한다. 선택은 바꾸지 않는다. 대상 로봇의 지금 면으로 스냅해 너무 넓거나
// 겹치는 프리셋은 흐리고 누를 수 없다. Field만 골랐으면 모두 보통으로 그리되 누를 수 없다.

function markerPlacement(marker: StartMarkerSpec): { position: Vector3; quaternion: Quaternion } {
  const position = new Vector3()
  const quaternion = new Quaternion()
  new Matrix4().fromArray(marker.matrix).decompose(position, quaternion, new Vector3())
  return { position, quaternion }
}

// 표시 위 커서: 누를 수 있으면 손가락, 흐린 것은 not-allowed, Field만 골랐으면 기본(사건 대상 = 캔버스)
function setCursor(event: ThreeEvent<PointerEvent>, cursor: string): void {
  const target = event.nativeEvent.target as HTMLElement | null
  if (target?.style) target.style.cursor = cursor
}

// 이 컴포넌트가 만든 재질 묶음
class MaterialList implements Disposable {
  constructor(readonly list: MeshBasicMaterial[]) {}
  dispose(): void {
    for (const material of this.list) material.dispose()
  }
}

function StartMarkers(): React.JSX.Element | null {
  const objects = useSceneStore((state) => state.objects)
  const doc = useSceneStore((state) => state.field)
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
  const markers = useMemo(
    () =>
      spec && shown ? startMarkerSpecs(spec, new Set(dimmedKey ? dimmedKey.split('|') : [])) : [],
    [spec, shown, dimmedKey]
  )
  const geometry = useMemo(() => new PlaneGeometry(1, 1), [])
  useDeferredDispose(geometry)
  const materials = useMemo(
    () =>
      new MaterialList(
        markers.map((marker) => {
          const material = new MeshBasicMaterial({
            color: marker.material.color,
            transparent: marker.material.transparent,
            opacity: marker.material.opacity,
            depthWrite: marker.material.depthWrite
          })
          material.polygonOffset = true
          material.polygonOffsetFactor = -1
          material.polygonOffsetUnits = marker.material.polygonOffsetUnits
          return material
        })
      ),
    [markers]
  )
  // 재질·형상은 바뀌거나 내려갈 때 해제한다(StrictMode의 정리 → 재실행에는 남는다)
  useDeferredDispose(materials)
  useEffect(() => {
    invalidate()
  }, [markers, invalidate])

  if (!shown || !spec) return null
  const clickable = robotId !== null

  return (
    <group name="startMarkers">
      {markers.map((marker, index) => {
        const { position, quaternion } = markerPlacement(marker)
        const dimmed = model?.options[index]?.disabled != null
        return (
          <mesh
            key={marker.key}
            name={`start.${marker.key}`}
            geometry={geometry}
            material={materials.list[index]}
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
            onPointerOver={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation()
              setCursor(event, !clickable ? '' : dimmed ? 'not-allowed' : 'pointer')
            }}
            onPointerOut={(event: ThreeEvent<PointerEvent>) => setCursor(event, '')}
          />
        )
      })}
    </group>
  )
}

export default StartMarkers
