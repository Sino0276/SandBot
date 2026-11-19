import { useThree } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
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
  type Group,
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
  isHiveBody,
  usesNominalFloor,
  WALL_LABEL_MATERIAL,
  type FieldCarrierSpec,
  type FieldGeometrySpec,
  type FieldMaterialSpec,
  type FieldMeshSpec
} from './fieldViewModel'
import { cylinderOutlineGeometry, prismGeometry } from './fieldPartGeometry'
import { GHOST_MATERIAL } from './ghostMaterial'
import { bindHiveDisplay, hiveGhostAngle, hiveMotionBound } from './hiveDisplay'
import ElementsView from './ElementsView'
import StartMarkers from './StartMarkers'
import { createLabelTexture } from './labelTexture'
import { createTagTexture } from './tagTexture'
import {
  COLLIDER_DISABLED_COLOR,
  COLLIDER_DISABLED_OPACITY,
  COLLIDER_OUTLINE_COLOR,
  COLLIDER_OUTLINE_HIDDEN_OPACITY,
  COLLIDER_OUTLINE_OPACITY
} from './colliderColors'

// 씬 뷰의 시즌 필드(spec-4ab §1.9): 타일·이음선·테이프·벽(레일 불투명, 판 반투명)·구조물·HIVE CELL·AprilTag·벽 라벨과 시작
// 표시. 씬 문서 밖이고 클릭되지 않는다(시작 표시만 예외). 'none'은 지금 FieldFloor 그대로다. 메시 목록은 fieldViewModel.ts.
// 6b(spec-6b §8): 부품이 있는 구조물은 공이 닿는 부품(FLOWER 케이지·CELL 트레이)으로 그리고, 경기 요소를 켠 실행 중에는 HIVE
// carrier 그룹 안쪽 움직임 그룹이 시뮬레이터 HIVE 각을 React 렌더 없이 따른다(hiveDisplay.ts). 끝난 실행의 HIVE 각이 보이는
// 시작 각과 다르면 그 각에 반투명 잔상(CELL·태그, 로봇 잔상과 같은 재질·renderOrder 5)을 다음 INIT·프로젝트 열기까지 둔다.
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
// 원기둥 둘레 분할 수 [가정: 표시만, 6b FLOWER 관·받침 원기둥과 그 윤곽의 원]
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
    case 'prism':
      return prismGeometry(spec.polygon, spec.height)
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

// FieldSpec.hives에서 carrier의 순번과 넘어가지 않은 각
function hiveOf(spec: FieldSpec, carrier: FieldCarrierSpec): { index: number; startAngle: number } {
  const index = spec.hives.findIndex((hive) => hive.key === carrier.key)
  return { index, startAngle: spec.hives[index]?.startAngle ?? carrier.angle }
}

// HIVE carrier 그룹(6b, spec-6b §8): 바깥 그룹은 모델 각(시작 상태)을 props로, 안쪽 움직임 그룹은 경기 요소를 켠 실행 동안
// 시뮬레이터 각과의 차를 명령형으로 갖는다(bindHiveDisplay, 끝나면 0). body는 필드 CAD와 함께 그릴 때의 HIVE 몸체이고 그
// 그룹은 지금 각이 넘어가지 않은 각에서 벗어났을 때만 보인다(CAD의 HIVE는 넘어가지 않은 자세로 고정)
function HiveCarrier({
  carrier,
  hive,
  name,
  body,
  children
}: {
  carrier: FieldCarrierSpec
  hive: { index: number; startAngle: number }
  name: string
  body?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  const invalidate = useThree((state) => state.invalidate)
  const motion = useRef<Group>(null)
  const bodyGroup = useRef<Group>(null)
  // 실행이 필드를 잠그고 경기 요소를 켰을 때만 묶는다(실행 시작·끝에만 바뀌는 boolean)
  const bound = usePlayStore(hiveMotionBound)
  const hasBody = body !== undefined
  const { index, startAngle } = hive
  useLayoutEffect(() => {
    const object = motion.current
    if (!object) return
    return bindHiveDisplay(
      {
        motion: object,
        body: hasBody ? bodyGroup.current : null,
        index,
        modelAngle: carrier.angle,
        startAngle
      },
      bound ? usePlayStore : null,
      invalidate
    )
  }, [bound, hasBody, index, carrier.angle, startAngle, invalidate])
  return (
    <group
      name={name}
      position={[carrier.pivot.x, carrier.pivot.y, carrier.pivot.z]}
      rotation={[0, carrier.angle, 0]}
    >
      <group ref={motion} name={`${name}.motion`}>
        {children}
        {hasBody && (
          <group ref={bodyGroup} name={`${name}.body`}>
            {body}
          </group>
        )}
      </group>
    </group>
  )
}

type GhostMesh = { key: string; geometry: BufferGeometry; placement: Placement }

// 끝난 실행의 HIVE 잔상(6b): 그 HIVE carrier의 메시(CELL·태그·축 조립체)를 끝난 각에 로봇 잔상 재질로. 끝난 각이 보이는 모델 각과
// 같으면(넘어가지 않고 끝남) 그리지 않는다. ghostGame은 실행 끝·INIT·프로젝트 열기에만 바뀌어 React로 그린다
function HiveGhost({
  carrier,
  index,
  meshes
}: {
  carrier: FieldCarrierSpec
  index: number
  meshes: readonly GhostMesh[]
}): React.JSX.Element | null {
  const invalidate = useThree((state) => state.invalidate)
  const angle = usePlayStore((state) =>
    hiveGhostAngle(state.ghostGame?.hives, index, carrier.angle)
  )
  useEffect(() => {
    invalidate()
  }, [angle, invalidate])
  if (angle === null || meshes.length === 0) return null
  return (
    <group
      name={`${carrier.key}.ghost`}
      position={[carrier.pivot.x, carrier.pivot.y, carrier.pivot.z]}
      rotation={[0, angle, 0]}
    >
      {meshes.map((mesh) => (
        <mesh
          key={mesh.key}
          name={`ghost.${mesh.key}`}
          geometry={mesh.geometry}
          material={GHOST_MATERIAL}
          position={mesh.placement.position}
          quaternion={mesh.placement.quaternion}
          renderOrder={FIELD_RENDER_ORDER.ghost}
          raycast={noRaycast}
        />
      ))}
    </group>
  )
}

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
    return variant === 'companion' ? fieldCompanionModel(full) : full
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
  // carrier마다 움직임 그룹의 메시, companion의 HIVE 몸체(보이기를 바꾸는 그룹), 잔상 메시
  const carried = new Map<string, React.JSX.Element[]>()
  const bodies = new Map<string, React.JSX.Element[]>()
  const ghosts = new Map<string, GhostMesh[]>()
  const add = <T,>(map: Map<string, T[]>, key: string, item: T): void => {
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  model.meshes.forEach((mesh, index) => {
    const element = meshFor(mesh, index)
    if (!element) return
    if (mesh.carrier === 'field') {
      fieldMeshes.push(element)
      return
    }
    add(variant === 'companion' && isHiveBody(mesh) ? bodies : carried, mesh.carrier, element)
    add(ghosts, mesh.carrier, {
      key: mesh.key,
      geometry: geometries.list[index],
      placement: placements[index]
    })
  })

  return (
    <group name="seasonField">
      {fieldMeshes}
      {model.carriers.map((carrier) => {
        const hive = hiveOf(spec, carrier)
        return (
          <HiveCarrier
            key={carrier.key}
            carrier={carrier}
            hive={hive}
            name={carrier.key}
            body={variant === 'companion' ? (bodies.get(carrier.key) ?? null) : undefined}
          >
            {carried.get(carrier.key)}
          </HiveCarrier>
        )
      })}
      {model.carriers.map((carrier) => (
        <HiveGhost
          key={`${carrier.key}.ghost`}
          carrier={carrier}
          index={hiveOf(spec, carrier).index}
          meshes={ghosts.get(carrier.key) ?? []}
        />
      ))}
    </group>
  )
})

// ---- 단순 형상 충돌체 윤곽(spec-4e §1.8, Unity 충돌체 기즈모) ----

// 색·불투명도는 Collider 기즈모(spec-5 §7)와 같은 값이다(colliderColors.ts)
// 윤곽 모서리의 각 문턱(°): 상자 12변·평면 4변만 남는다
const OUTLINE_THRESHOLD_DEG = 1

class OutlineMaterials implements Disposable {
  readonly front: LineBasicMaterial
  // CAD 면과 같은 평면의 선(바닥 사각형·FLOWER 벽 쪽 면)이 앞 패스에서 깜빡여도 이 패스가 잇는다
  readonly hidden: LineBasicMaterial
  // 흐린 윤곽(6b 부품이 있는 구조물의 봉투 상자): Collider 기즈모의 끈 Collider와 같은 색·불투명도
  readonly dimFront: LineBasicMaterial
  readonly dimHidden: LineBasicMaterial
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
    const hiddenRatio = COLLIDER_OUTLINE_HIDDEN_OPACITY / COLLIDER_OUTLINE_OPACITY
    this.front = line(COLLIDER_OUTLINE_COLOR, COLLIDER_OUTLINE_OPACITY, true)
    this.hidden = line(COLLIDER_OUTLINE_COLOR, COLLIDER_OUTLINE_HIDDEN_OPACITY, false)
    this.dimFront = line(COLLIDER_DISABLED_COLOR, COLLIDER_DISABLED_OPACITY, true)
    this.dimHidden = line(COLLIDER_DISABLED_COLOR, COLLIDER_DISABLED_OPACITY * hiddenRatio, false)
  }
  dispose(): void {
    this.front.dispose()
    this.hidden.dispose()
    this.dimFront.dispose()
    this.dimHidden.dispose()
  }
}

// 메시마다 EdgesGeometry 하나(앞·가려진 패스가 함께 쓴다). 면 형상은 모서리를 뽑은 뒤 바로 해제한다. 원기둥(6b FLOWER 관·받침)은
// 분할마다 세로선이 남지 않게 원 둘과 옆 선 넷이다(Collider 기즈모의 원기둥과 같은 모양)
class OutlineGeometries implements Disposable {
  readonly list: BufferGeometry[]
  constructor(meshes: readonly FieldMeshSpec[]) {
    this.list = meshes.map((mesh) => {
      if (mesh.geometry.kind === 'cylinder')
        return cylinderOutlineGeometry(
          mesh.geometry.radius,
          mesh.geometry.height,
          CYLINDER_SEGMENTS
        )
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

  const passes = (mesh: FieldMeshSpec): readonly ['front' | 'hidden', Material][] =>
    mesh.outline === 'dim'
      ? [
          ['front', materials.dimFront],
          ['hidden', materials.dimHidden]
        ]
      : [
          ['front', materials.front],
          ['hidden', materials.hidden]
        ]
  const fieldLines: React.JSX.Element[] = []
  const carried = new Map<string, React.JSX.Element[]>()
  model.meshes.forEach((mesh, index) => {
    const { position, quaternion } = placements[index]
    const lines = passes(mesh).map(([pass, material]) => (
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
        <HiveCarrier
          key={carrier.key}
          carrier={carrier}
          hive={hiveOf(spec, carrier)}
          name={`outline.${carrier.key}`}
        >
          {carried.get(carrier.key)}
        </HiveCarrier>
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
