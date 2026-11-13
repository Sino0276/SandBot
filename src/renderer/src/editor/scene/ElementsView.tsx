import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3
} from 'three'
import type { FieldSpec } from '../../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import {
  ELEMENT_KINDS,
  MAX_WORLD_ELEMENTS,
  type SimElementKind
} from '../../../../shared/sim/worldSpec'
import { simGameOf, usePlayStore, type PlayState } from '../../play/playStore'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { documentSeasonId, lockedRunField, runLocksField } from '../field/fieldDisplay'
import { startTargetRobotId } from '../field/startPresetModel'
import { fieldElementsHidden, useSceneVisibilityStore } from '../sceneVisibility'
import { useDeferredDispose, type Disposable } from './deferredDispose'
import {
  ballLook,
  ballsByKind,
  editElementLayers,
  ghostElementBalls,
  runElementBalls,
  type BallInstance,
  type ElementLayers
} from './elementsViewModel'

// 씬 뷰 경기 요소(6a, spec-6a §5): 공을 층(solid·preview·ghost) × 종류(POLLEN·NECTAR 빨강·파랑)의 InstancedMesh로 그린다.
// - 편집 중(실행이 필드를 잠그지 않음): 개인 설정 gameElements가 켜졌고 문서 시즌에 경기 요소가 있으면 시작 배치(불투명)와 대상
//   로봇(활성 오브젝트의 로봇, 시작 표시와 같은 규칙)의 프리로드(팀 자리 불투명, 자동 자리 반투명)
// - 실행 중: 그 실행의 공(run.elements)을 시뮬레이터 표시 상태(simGame)로 그린다. 60 Hz로 바뀌므로 React로 다시 그리지 않고
//   스토어 구독에서 인스턴스 행렬만 바꾸고 invalidate한다(로봇 자세 poseDisplay와 같은 방식)
// - 끝난 실행의 잔상(ghostGame, 반투명 renderOrder 5 = 로봇 잔상과 같은 겹)
// 필드 요소를 숨기거나 고립 보기 중이면 그리지 않는다(fieldElementsHidden, 구조물·HIVE와 같은 규칙). 씬 문서 밖이고 클릭되지
// 않는다(레이캐스트 끔). 형상·재질은 컴포넌트 수명 동안 하나씩이고 해제는 StrictMode를 견디게 미룬다(deferredDispose.ts).

const LAYERS = ['solid', 'preview', 'ghost'] as const
type Layer = (typeof LAYERS)[number]

// 반투명 층의 불투명도와 겹 순서(로봇 잔상과 같은 renderOrder 5) [가정: 표시만]
const PREVIEW_OPACITY = 0.45
const GHOST_OPACITY = 0.35
const TRANSLUCENT_RENDER_ORDER = 5
// 구 분할 수(지름 7–9 cm 공이 매끈해 보일 만큼) [가정: 표시만]
const SPHERE_WIDTH_SEGMENTS = 24
const SPHERE_HEIGHT_SEGMENTS = 16
// 공 표면 거칠기(무광 플라스틱) [가정: 표시만]
const BALL_ROUGHNESS = 0.6

const noRaycast = (): void => {}

// 층·종류마다 재질 하나(컴포넌트 수명 동안). 색은 시즌 데이터의 표시 색이라 시즌이 바뀌면 색만 바꾼다
class BallMaterials implements Disposable {
  readonly byLayer: Record<Layer, Record<SimElementKind, MeshStandardMaterial>>
  constructor() {
    const make = (layer: Layer): MeshStandardMaterial =>
      new MeshStandardMaterial({
        roughness: BALL_ROUGHNESS,
        metalness: 0,
        transparent: layer !== 'solid',
        opacity: layer === 'preview' ? PREVIEW_OPACITY : layer === 'ghost' ? GHOST_OPACITY : 1,
        depthWrite: layer === 'solid'
      })
    this.byLayer = Object.fromEntries(
      LAYERS.map((layer) => [
        layer,
        Object.fromEntries(ELEMENT_KINDS.map((kind) => [kind, make(layer)]))
      ])
    ) as BallMaterials['byLayer']
  }
  setColors(field: FieldSpec): void {
    for (const layer of LAYERS)
      for (const kind of ELEMENT_KINDS)
        this.byLayer[layer][kind].color.set(ballLook(field, kind).color)
  }
  dispose(): void {
    for (const layer of LAYERS)
      for (const kind of ELEMENT_KINDS) this.byLayer[layer][kind].dispose()
  }
}

const matrix = new Matrix4()
const position = new Vector3()
const quaternion = new Quaternion()
const scale = new Vector3()

// 한 층의 공을 종류별 InstancedMesh에 쓴다(반지름은 시즌 데이터)
function writeLayer(
  meshes: Partial<Record<SimElementKind, InstancedMesh>>,
  balls: readonly BallInstance[],
  field: FieldSpec
): void {
  const byKind = ballsByKind(balls)
  for (const kind of ELEMENT_KINDS) {
    const mesh = meshes[kind]
    if (!mesh) continue
    const list = byKind[kind].slice(0, MAX_WORLD_ELEMENTS)
    const r = ballLook(field, kind).radius
    scale.set(r, r, r)
    list.forEach((ball, i) => {
      const [w, x, y, z] = ball.orientation
      matrix.compose(position.set(...ball.position), quaternion.set(x, y, z, w), scale)
      mesh.setMatrixAt(i, matrix)
    })
    mesh.count = list.length
    mesh.instanceMatrix.needsUpdate = true
  }
}

function ElementsView(): React.JSX.Element {
  const objects = useSceneStore((state) => state.objects)
  // 시즌 문자열만 구독한다(4e부터 field 객체는 필드 CAD 정렬·경로 고침에도 바뀐다)
  const season = useSceneStore((state) => documentSeasonId(state.field))
  const activeId = useEditorStore((state) => state.selectedId)
  const gameElements = usePlayStore((state) => state.settings.gameElements)
  // 실행 전체가 아니라 잠금·잠근 필드·실행의 공만 구독한다(텔레메트리마다 바뀌는 run으로 다시 그리지 않게)
  const locked = usePlayStore((state) => runLocksField(state.run))
  const lockedField = usePlayStore((state) => lockedRunField(state.run))
  const runElements = usePlayStore((state) =>
    runLocksField(state.run) ? state.run.elements : null
  )
  const ghost = usePlayStore((state) => state.ghostGame)
  const hidden = useSceneVisibilityStore(fieldElementsHidden)
  const invalidate = useThree((state) => state.invalidate)

  const field = resolveSeason(lockedField?.season ?? season)
  const targetRobotId = startTargetRobotId(objects, activeId)
  const geometry = useMemo(
    () => new SphereGeometry(1, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS),
    []
  )
  useDeferredDispose(geometry)
  const materials = useMemo(() => new BallMaterials(), [])
  useDeferredDispose(materials)
  const meshes = useRef<Record<Layer, Partial<Record<SimElementKind, InstancedMesh>>>>({
    solid: {},
    preview: {},
    ghost: {}
  })
  // 층·종류마다 바뀌지 않는 ref 함수(렌더마다 새 함수면 React가 커밋마다 떼고 다시 붙인다)
  const attach = useMemo(
    () =>
      Object.fromEntries(
        LAYERS.map((layer) => [
          layer,
          Object.fromEntries(
            ELEMENT_KINDS.map((kind) => [
              kind,
              (mesh: InstancedMesh | null): void => {
                if (mesh) meshes.current[layer][kind] = mesh
                else delete meshes.current[layer][kind]
              }
            ])
          )
        ])
      ) as Record<Layer, Record<SimElementKind, (mesh: InstancedMesh | null) => void>>,
    []
  )

  // 편집 중 층(실행이 잠그지 않을 때, 설정이 켜졌을 때)
  const edit = useMemo(
    () =>
      !locked && gameElements
        ? editElementLayers(objects, targetRobotId, field)
        : { solid: [], preview: [] },
    [locked, gameElements, objects, targetRobotId, field]
  )
  const ghostBalls = useMemo(() => ghostElementBalls(ghost), [ghost])

  useLayoutEffect(() => {
    materials.setColors(field)
    const layers: ElementLayers = { solid: edit.solid, preview: edit.preview, ghost: ghostBalls }
    // 실행 중 solid는 아래 구독이 쓴다
    if (!locked) writeLayer(meshes.current.solid, layers.solid, field)
    writeLayer(meshes.current.preview, layers.preview, field)
    writeLayer(meshes.current.ghost, layers.ghost, field)
    invalidate()
  }, [edit, ghostBalls, locked, field, materials, invalidate])

  // 실행 중: 표시 상태가 바뀔 때마다 명령형으로(React 렌더 없이) 쓴다
  useLayoutEffect(() => {
    if (!locked) return
    const write = (state: PlayState): void => {
      writeLayer(
        meshes.current.solid,
        runElements ? runElementBalls(runElements, simGameOf(state)) : [],
        field
      )
      invalidate()
    }
    write(usePlayStore.getState())
    return usePlayStore.subscribe((state, previous) => {
      if (state.simGame !== previous.simGame) write(state)
    })
  }, [locked, runElements, field, invalidate])

  useEffect(() => () => invalidate(), [invalidate])

  return (
    <group name="elements" visible={!hidden}>
      {LAYERS.map((layer) =>
        ELEMENT_KINDS.map((kind) => (
          <instancedMesh
            key={`${layer}.${kind}`}
            name={`elements.${layer}.${kind}`}
            ref={attach[layer][kind]}
            args={[geometry, materials.byLayer[layer][kind], MAX_WORLD_ELEMENTS]}
            // 만들 때만 0(InstancedMesh 기본 count는 최대 수라 쓰기 전에 원점에 공이 보인다). R3F는 바뀌지 않은 속성을 다시
            // 넣지 않으므로 쓴 뒤의 다시 그리기가 이것으로 되돌리지 않는다
            count={0}
            renderOrder={layer === 'solid' ? 0 : TRANSLUCENT_RENDER_ORDER}
            frustumCulled={false}
            raycast={noRaycast}
          />
        ))
      )}
    </group>
  )
}

export default ElementsView
