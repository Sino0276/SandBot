import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
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
import type { Vec3 } from '../../../../shared/sim/worldSpec'
import { wallLabelKey } from '../../field/fieldLabels'
import { looseT } from '../../hardware/labels'
import { usePlayStore } from '../../play/playStore'
import { useSceneStore } from '../../scene/sceneStore'
import { displayedField } from '../field/fieldDisplay'
import { fieldElementsHidden, useSceneVisibilityStore } from '../sceneVisibility'
import { useDeferredDispose, type Disposable } from './deferredDispose'
import FieldFloor from './FieldFloor'
import {
  fieldViewModel,
  usesNominalFloor,
  WALL_LABEL_MATERIAL,
  type FieldGeometrySpec,
  type FieldMaterialSpec,
  type FieldMeshSpec
} from './fieldViewModel'
import StartMarkers from './StartMarkers'
import { createLabelTexture } from './labelTexture'
import { createTagTexture } from './tagTexture'

// 씬 뷰의 시즌 필드(spec-4ab §1.9): 타일·이음선·테이프·벽(레일 불투명, 판 반투명)·구조물·HIVE CELL·AprilTag·벽 라벨과 시작
// 표시. 씬 문서 밖이고 클릭되지 않는다(시작 표시만 예외). 'none'은 지금 FieldFloor 그대로다. 메시 목록은 fieldViewModel.ts.
// 재질은 (색, 투명도, 오프셋 종류)마다 컴포넌트 수명 동안 하나를 함께 쓰고, 시즌·HIVE 상태·보기 상태가 바뀔 때만 형상을
// 다시 만들고, 언어가 바뀌면 라벨 텍스처만 다시 만든다(frameloop demand라 바뀌면 invalidate).

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

type Placement = { position: Vec3; quaternion: Quaternion }

function placement(matrix: readonly number[]): Placement {
  const position = new Vector3()
  const quaternion = new Quaternion()
  new Matrix4().fromArray(matrix).decompose(position, quaternion, new Vector3())
  return { position: { x: position.x, y: position.y, z: position.z }, quaternion }
}

// 바닥·겹 요소·태그·라벨은 빛과 관계없이 보이는 평면(MeshBasicMaterial), 나머지는 빛을 받는다
const FLAT_ROLES = new Set(['floor', 'seam', 'tape'])

function SeasonFieldView({
  spec,
  tippedRed,
  tippedBlue,
  elementsHidden
}: {
  spec: FieldSpec
  tippedRed: boolean
  tippedBlue: boolean
  elementsHidden: boolean
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const invalidate = useThree((state) => state.invalidate)

  const pool = useMemo(() => new MaterialPool(), [])
  useDeferredDispose(pool)
  const tags = useMemo(() => new TagMaterials(), [])
  useDeferredDispose(tags)

  const model = useMemo(
    () => fieldViewModel(spec, [tippedRed, tippedBlue], elementsHidden),
    [spec, tippedRed, tippedBlue, elementsHidden]
  )
  const geometries = useMemo(() => new GeometrySet(model.meshes), [model])
  useDeferredDispose(geometries)

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
    const { position, quaternion } = placement(mesh.matrix)
    return (
      <mesh
        key={mesh.key}
        name={mesh.key}
        geometry={geometries.list[index]}
        material={material}
        position={[position.x, position.y, position.z]}
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
}

// 씬 뷰 필드: 실행이 잠갔으면 실행의 시즌·HIVE 상태, 아니면 문서 시즌(모르는 문자열은 'none')과 개인 실행 설정
function FieldView(): React.JSX.Element {
  const doc = useSceneStore((state) => state.field)
  const run = usePlayStore((state) => state.run)
  const hiveState = usePlayStore((state) => state.settings.hiveState)
  const elementsHidden = useSceneVisibilityStore(fieldElementsHidden)
  const shown = displayedField(run, doc, hiveState)
  return (
    <>
      {usesNominalFloor(shown.season) ? (
        <FieldFloor />
      ) : (
        <SeasonFieldView
          spec={resolveSeason(shown.season)}
          tippedRed={shown.hiveTipped[0]}
          tippedBlue={shown.hiveTipped[1]}
          elementsHidden={elementsHidden}
        />
      )}
      <StartMarkers />
    </>
  )
}

export default FieldView
