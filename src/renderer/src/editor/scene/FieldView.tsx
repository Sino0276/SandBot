import { useThree } from '@react-three/fiber'
import { memo, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture
} from 'three'
import type { FieldSpec, FieldWallName } from '../../../../shared/sim/seasons/fieldSpec'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { wallLabelKey } from '../../field/fieldLabels'
import { fieldCadReady, useFieldVisualStore } from '../../field/fieldVisualStore'
import { looseT } from '../../hardware/labels'
import { usePlayStore } from '../../play/playStore'
import { useSceneStore } from '../../scene/sceneStore'
import { documentField, lockedRunField } from '../field/fieldDisplay'
import { fieldElementsHidden, useSceneVisibilityStore } from '../sceneVisibility'
import { useDeferredDispose, type Disposable } from './deferredDispose'
import FieldCadView from './FieldCadView'
import FieldFloor from './FieldFloor'
import { fieldLayers } from './fieldLayers'
import {
  fieldCompanionModel,
  fieldOutlineMeshes,
  fieldViewModel,
  FIELD_RENDER_ORDER,
  usesNominalFloor,
  WALL_LABEL_MATERIAL,
  type FieldGeometrySpec,
  type FieldMaterialSpec,
  type FieldMeshSpec
} from './fieldViewModel'
import ElementsView from './ElementsView'
import StartMarkers from './StartMarkers'
import { createLabelTexture } from './labelTexture'
import { createTagTexture } from './tagTexture'
import {
  COLLIDER_OUTLINE_COLOR,
  COLLIDER_OUTLINE_HIDDEN_OPACITY,
  COLLIDER_OUTLINE_OPACITY
} from './colliderColors'

// 씬 뷰의 시즌 필드(spec-4ab §1.9): 타일·이음선·테이프·벽(레일 불투명, 판 반투명)·구조물·HIVE CELL·AprilTag·벽 라벨과 시작
// 표시. 씬 문서 밖이고 클릭되지 않는다(시작 표시만 예외). 'none'은 지금 FieldFloor 그대로다. 메시 목록은 fieldViewModel.ts.
// 재질은 (색, 투명도, 오프셋 종류)마다 컴포넌트 수명 동안 하나를 함께 쓰고, 시즌·HIVE 상태·보기 상태가 바뀔 때만 형상을
// 다시 만들고, 언어가 바뀌면 라벨 텍스처만 다시 만든다(frameloop demand라 바뀌면 invalidate).
// 필드 CAD(보기용, 4e)가 그려져 있으면(spec-4e §1.6 fieldLayers) 단순 형상은 CAD와 함께 그리는 것(태그·벽 라벨·넘어간 HIVE
// CELL)만 그리고, "단순 형상도 보기"면 시뮬레이터 형상을 초록 충돌체 윤곽선으로 겹친다(FieldColliderOutlines).

// 필드 메시는 클릭되지 않는다(다리 뒤 로봇도 클릭된다)
const noRaycast = (): void => {}

function applyMaterialSpec(material: Material, spec: FieldMaterialSpec): void {
  material.transparent = spec.transparent
  material.opacity = spec.opacity
  material.depthWrite = spec.depthWrite
  if (spec.polygonOffsetUnits !== 0) {
    material.polygonOffset = true
    material.polygonOffsetFactor = -1
    material.polygonOffsetUnits = spec.polygonOffsetUnits
  }
}

// 빛을 받는 필드 재질의 거칠기 [가정: 표시만, 무광 플라스틱·금속 판]
const FIELD_ROUGHNESS = 0.85
// 원기둥 둘레 분할 수 [가정: 표시만, 지금 BIOBUZZ 데이터에는 원기둥이 없다]
const CYLINDER_SEGMENTS = 32

// 색 재질 묶음: 같은 재질 키는 같은 객체
class MaterialPool implements Disposable {
  private readonly materials = new Map<string, Material>()

  get(spec: FieldMaterialSpec, flat: boolean): Material {
    const key = JSON.stringify([spec, flat])
    let material = this.materials.get(key)
    if (!material) {
      material = flat
        ? new MeshBasicMaterial({ color: spec.color })
        : new MeshStandardMaterial({ color: spec.color, roughness: FIELD_ROUGHNESS, metalness: 0 })
      applyMaterialSpec(material, spec)
      this.materials.set(key, material)
    }
    return material
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }
}

// 태그 텍스처·재질(태그 id마다 하나, 처음 쓸 때 만든다)
class TagMaterials implements Disposable {
  private readonly entries = new Map<number, { texture: Texture; material: Material } | null>()

  get(id: number, spec: FieldMaterialSpec): Material | null {
    let entry = this.entries.get(id)
    if (entry === undefined) {
      const texture = createTagTexture(id)
      if (texture) {
        const material = new MeshBasicMaterial({ map: texture })
        applyMaterialSpec(material, spec)
        entry = { texture, material }
      } else entry = null
      this.entries.set(id, entry)
    }
    return entry?.material ?? null
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry?.material.dispose()
      entry?.texture.dispose()
    }
    this.entries.clear()
  }
}

// 벽 라벨 텍스처·재질(언어·시즌 벽 이름마다 한 벌)
class LabelMaterials implements Disposable {
  readonly language: string
  private readonly entries = new Map<FieldWallName, { texture: Texture; material: Material }>()

  constructor(
    language: string,
    texts: ReadonlyMap<FieldWallName, string>,
    spec: FieldMaterialSpec
  ) {
    this.language = language
    for (const [wall, text] of texts) {
      const texture = createLabelTexture(text)
      if (!texture) continue
      const material = new MeshBasicMaterial({ map: texture, side: DoubleSide })
      applyMaterialSpec(material, spec)
      this.entries.set(wall, { texture, material })
    }
  }

  get(wall: FieldWallName): Material | null {
    return this.entries.get(wall)?.material ?? null
  }

  texture(wall: FieldWallName): Texture | null {
    return this.entries.get(wall)?.texture ?? null
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.material.dispose()
      entry.texture.dispose()
    }
    this.entries.clear()
  }
}

function makeGeometry(spec: FieldGeometrySpec): BufferGeometry {
  switch (spec.kind) {
    case 'plane':
      return new PlaneGeometry(spec.width, spec.height)
    case 'box':
      return new BoxGeometry(spec.size.x, spec.size.y, spec.size.z)
    case 'cylinder':
      return new CylinderGeometry(spec.radius, spec.radius, spec.height, CYLINDER_SEGMENTS)
  }
}

class GeometrySet implements Disposable {
  readonly list: BufferGeometry[]
  constructor(meshes: readonly FieldMeshSpec[]) {
    this.list = meshes.map((mesh) => makeGeometry(mesh.geometry))
  }
  dispose(): void {
    for (const geometry of this.list) geometry.dispose()
  }
}

type Placement = { position: Vector3; quaternion: Quaternion }

function placement(matrix: readonly number[]): Placement {
  const position = new Vector3()
  const quaternion = new Quaternion()
  new Matrix4().fromArray(matrix).decompose(position, quaternion, new Vector3())
  return { position, quaternion }
}

// 바닥·겹 요소·태그·라벨은 빛과 관계없이 보이는 평면(MeshBasicMaterial), 나머지는 빛을 받는다
const FLAT_ROLES = new Set(['floor', 'seam', 'tape'])

// 속성(시즌·HIVE 상태·숨김·층)이 같으면 다시 그리지 않는다. variant 'companion'은 필드 CAD와 함께 그리는 것만이다
// (fieldCompanionModel). 그릴 모델(drawn)을 먼저 정하고 형상·자세·순번을 모두 그 모델 기준으로 만든다(비평 M3).
const SeasonFieldView = memo(function SeasonFieldView({
  spec,
  tippedRed,
  tippedBlue,
  elementsHidden,
  variant
}: {
  spec: FieldSpec
  tippedRed: boolean
  tippedBlue: boolean
  elementsHidden: boolean
  variant: 'all' | 'companion'
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const invalidate = useThree((state) => state.invalidate)

  const pool = useMemo(() => new MaterialPool(), [])
  useDeferredDispose(pool)
  const tags = useMemo(() => new TagMaterials(), [])
  useDeferredDispose(tags)

  const model = useMemo(() => {
    const full = fieldViewModel(spec, [tippedRed, tippedBlue], elementsHidden)
    return variant === 'companion' ? fieldCompanionModel(full, [tippedRed, tippedBlue]) : full
  }, [spec, tippedRed, tippedBlue, elementsHidden, variant])
  const geometries = useMemo(() => new GeometrySet(model.meshes), [model])
  useDeferredDispose(geometries)
  // 자세는 모델마다 한 번 푼다(다시 그릴 때 새 Quaternion을 넘기면 R3F가 모든 메시에 다시 적용한다)
  const placements = useMemo(() => model.meshes.map((mesh) => placement(mesh.matrix)), [model])

  // 언어가 바뀌면 라벨 텍스처만 다시 만든다(UI 문자열 불변 조건)
  const labels = useMemo(() => {
    const texts = new Map<FieldWallName, string>()
    if (spec.walls)
      for (const wall of Object.values(spec.walls)) texts.set(wall, looseT(t)(wallLabelKey(wall)))
    return new LabelMaterials(language, texts, WALL_LABEL_MATERIAL)
  }, [spec, language, t])
  useDeferredDispose(labels)

  useEffect(() => {
    invalidate()
  }, [model, labels, invalidate])

  const meshFor = (mesh: FieldMeshSpec, index: number): React.JSX.Element | null => {
    let material: Material | null
    if (mesh.role === 'tag') material = tags.get(mesh.tagId!, mesh.material)
    else if (mesh.role === 'wallLabel') material = labels.get(mesh.wall!)
    else material = pool.get(mesh.material, FLAT_ROLES.has(mesh.role))
    if (!material) return null
    const { position, quaternion } = placements[index]
    return (
      <mesh
        key={mesh.key}
        name={mesh.key}
        geometry={geometries.list[index]}
        material={material}
        position={position}
        quaternion={quaternion}
        renderOrder={mesh.renderOrder}
        raycast={noRaycast}
      />
    )
  }

  const fieldMeshes: React.JSX.Element[] = []
  const carried = new Map<string, React.JSX.Element[]>()
  model.meshes.forEach((mesh, index) => {
    const element = meshFor(mesh, index)
    if (!element) return
    if (mesh.carrier === 'field') fieldMeshes.push(element)
    else {
      const list = carried.get(mesh.carrier) ?? []
      list.push(element)
      carried.set(mesh.carrier, list)
    }
  })

  return (
    <group name="seasonField">
      {fieldMeshes}
      {model.carriers.map((carrier) => (
        <group
          key={carrier.key}
          name={carrier.key}
          position={[carrier.pivot.x, carrier.pivot.y, carrier.pivot.z]}
          rotation={[0, carrier.angle, 0]}
        >
          {carried.get(carrier.key)}
        </group>
      ))}
    </group>
  )
})

// ---- 단순 형상 충돌체 윤곽(spec-4e §1.8, Unity 충돌체 기즈모) ----

// 색·불투명도는 Collider 기즈모(spec-5 §7)와 같은 값이다(colliderColors.ts)
// 윤곽 모서리의 각 문턱(°): 상자 12변·평면 4변만 남는다
const OUTLINE_THRESHOLD_DEG = 1

class OutlineMaterials implements Disposable {
  readonly front = new LineBasicMaterial({
    color: COLLIDER_OUTLINE_COLOR,
    transparent: true,
    opacity: COLLIDER_OUTLINE_OPACITY,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  })
  // CAD 면과 같은 평면의 선(바닥 사각형·FLOWER 벽 쪽 면)이 앞 패스에서 깜빡여도 이 패스가 잇는다
  readonly hidden = new LineBasicMaterial({
    color: COLLIDER_OUTLINE_COLOR,
    transparent: true,
    opacity: COLLIDER_OUTLINE_HIDDEN_OPACITY,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  })
  dispose(): void {
    this.front.dispose()
    this.hidden.dispose()
  }
}

// 메시마다 EdgesGeometry 하나(앞·가려진 패스가 함께 쓴다). 면 형상은 모서리를 뽑은 뒤 바로 해제한다
class OutlineGeometries implements Disposable {
  readonly list: BufferGeometry[]
  constructor(meshes: readonly FieldMeshSpec[]) {
    this.list = meshes.map((mesh) => {
      const solid = makeGeometry(mesh.geometry)
      const edges = new EdgesGeometry(solid, OUTLINE_THRESHOLD_DEG)
      solid.dispose()
      return edges
    })
  }
  dispose(): void {
    for (const geometry of this.list) geometry.dispose()
  }
}

// 시뮬레이터가 계산에 쓰는 단순 형상(fieldOutlineMeshes)의 윤곽. 재질 둘은 컴포넌트 수명 동안, 형상은 모델이 바뀔 때 새로
// 만들고 이전 것은 미뤄 해제한다(StrictMode)
const FieldColliderOutlines = memo(function FieldColliderOutlines({
  spec,
  tippedRed,
  tippedBlue
}: {
  spec: FieldSpec
  tippedRed: boolean
  tippedBlue: boolean
}): React.JSX.Element {
  const invalidate = useThree((state) => state.invalidate)
  const materials = useMemo(() => new OutlineMaterials(), [])
  useDeferredDispose(materials)
  const model = useMemo(
    () => fieldOutlineMeshes(fieldViewModel(spec, [tippedRed, tippedBlue], false), spec),
    [spec, tippedRed, tippedBlue]
  )
  const geometries = useMemo(() => new OutlineGeometries(model.meshes), [model])
  useDeferredDispose(geometries)
  const placements = useMemo(() => model.meshes.map((mesh) => placement(mesh.matrix)), [model])

  useEffect(() => {
    invalidate()
  }, [model, invalidate])

  const passes: readonly ['front' | 'hidden', Material][] = [
    ['front', materials.front],
    ['hidden', materials.hidden]
  ]
  const fieldLines: React.JSX.Element[] = []
  const carried = new Map<string, React.JSX.Element[]>()
  model.meshes.forEach((mesh, index) => {
    const { position, quaternion } = placements[index]
    const lines = passes.map(([pass, material]) => (
      <lineSegments
        key={`${mesh.key}.${pass}`}
        name={`outline.${mesh.key}.${pass}`}
        geometry={geometries.list[index]}
        material={material}
        position={position}
        quaternion={quaternion}
        renderOrder={FIELD_RENDER_ORDER.colliderOutline}
        raycast={noRaycast}
      />
    ))
    if (mesh.carrier === 'field') fieldLines.push(...lines)
    else carried.set(mesh.carrier, [...(carried.get(mesh.carrier) ?? []), ...lines])
  })

  return (
    <group name="fieldOutlines">
      {fieldLines}
      {model.carriers.map((carrier) => (
        <group
          key={carrier.key}
          name={`outline.${carrier.key}`}
          position={[carrier.pivot.x, carrier.pivot.y, carrier.pivot.z]}
          rotation={[0, carrier.angle, 0]}
        >
          {carried.get(carrier.key)}
        </group>
      ))}
    </group>
  )
})

// 씬 뷰 필드: 실행이 잠갔으면 실행의 시즌·HIVE 상태, 아니면 문서 시즌(모르는 문자열은 'none')과 개인 실행 설정.
// 실행 전체(state.run)가 아니라 잠근 run.field만 구독한다(텔레메트리·장치마다 바뀌는 run으로 다시 그리지 않게)
// 문서 field 객체가 아니라 시즌 문자열과 visual을 따로 구독한다(4e부터 field는 정렬·경로 고침에도 바뀐다, spec-4e §0).
// 필드 CAD는 그 경로의 형상이 칸에 있을 때만(fieldCadReady, 읽기 상태는 보지 않는다) 올려 두고, 숨김·고립 보기는 visible만
// 바꾼다(spec-4e §1.9).
function FieldView(): React.JSX.Element {
  const season = useSceneStore((state) => state.field.season)
  const visual = useSceneStore((state) => state.field.visual)
  const loaded = useFieldVisualStore((state) => state.loaded)
  const lockedField = usePlayStore((state) => lockedRunField(state.run))
  const hiveState = usePlayStore((state) => state.settings.hiveState)
  const elementsHidden = useSceneVisibilityStore(fieldElementsHidden)
  const shapesShown = useSceneVisibilityStore((state) => state.fieldShapesShown)
  const shown = lockedField ?? documentField({ season }, hiveState)
  const cadReady = fieldCadReady(visual, loaded)
  const layers = fieldLayers({ cadReady, shapesShown, elementsHidden })
  const nominal = usesNominalFloor(shown.season)
  const spec = resolveSeason(shown.season)
  return (
    <>
      {cadReady && visual && loaded && (
        <FieldCadView visual={visual} revision={loaded.revision} visible={layers.cad} />
      )}
      {layers.simple === 'all' ? (
        nominal ? (
          <FieldFloor />
        ) : (
          <SeasonFieldView
            spec={spec}
            tippedRed={shown.hiveTipped[0]}
            tippedBlue={shown.hiveTipped[1]}
            elementsHidden={elementsHidden}
            variant="all"
          />
        )
      ) : (
        // 'companion': 'none'·모르는 시즌은 비어 있다(FieldFloor도 그리지 않는다)
        !nominal && (
          <SeasonFieldView
            spec={spec}
            tippedRed={shown.hiveTipped[0]}
            tippedBlue={shown.hiveTipped[1]}
            elementsHidden={false}
            variant="companion"
          />
        )
      )}
      {layers.outlines && (
        <FieldColliderOutlines
          spec={spec}
          tippedRed={shown.hiveTipped[0]}
          tippedBlue={shown.hiveTipped[1]}
        />
      )}
      {/* 움직이는 경기 요소(6a): 시작 배치·프리로드, 실행 중 시뮬레이터 상태, 끝난 실행의 잔상 */}
      <ElementsView />
      <StartMarkers />
    </>
  )
}

export default FieldView
