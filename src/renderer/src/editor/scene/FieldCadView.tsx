import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, MeshStandardMaterial, Quaternion, SRGBColorSpace } from 'three'
import { alignmentRotation, type CadAlignment } from '../../cad/alignment'
import { FIELD_CAD_GLASS_OPACITY } from '../../field/fieldVisualModel'
import { fieldVisualGroups, type FieldVisualGroup } from '../../field/fieldVisualStore'
import type { FieldVisual } from '../../scene/fieldDoc'
import { useDeferredDispose, type Disposable } from './deferredDispose'
import { FIELD_RENDER_ORDER, POLYGON_OFFSET_UNITS } from './fieldViewModel'

// 필드 CAD 보기(spec-4e §1.9): 불러온 필드 STEP을 재질 묶음마다 메시 하나로 그린다. 씬 문서 밖의 배경이라 하이어라키 행·
// 형상 id가 없고 클릭되지 않는다. 형상은 fieldVisualStore가 맡고(바꿔 끼울 때·비울 때 해제) 이 컴포넌트는 해제하지 않는다.
// 재질은 컴포넌트 수명 동안 쓰고 해제는 미룬다(StrictMode). 숨김·고립 보기는 내리지 않고 visible만 바꾼다(재질 21개를 해제·
// 다시 컴파일하지 않게, 비평 L3). 정렬은 그룹 quaternion이다(위치는 옮기지 않는다: CAD 원점 = 필드 원점).

// 필드 CAD 메시는 클릭되지 않는다(다리 뒤 로봇·시작 표시도 클릭된다)
const noRaycast = (): void => {}

// 로봇 CAD 재질(SceneObjectsView cadMaterial)과 같은 값이다(강조 없음)
const CAD_METALNESS = 0.1
const CAD_ROUGHNESS = 0.7

// 묶음 키(color|vertexColors|glass|decal)마다 재질 하나. 불투명은 renderOrder 0, 투명판은 반투명·깊이 쓰지 않음·벽 판 순서,
// decal(테이프)은 polygonOffset으로 타일 윗면 앞에(깊이는 쓴다, 4ab 겹 요소와 같은 units)
class FieldCadMaterials implements Disposable {
  private readonly materials = new Map<string, MeshStandardMaterial>()

  get(group: FieldVisualGroup): MeshStandardMaterial {
    const key = `${group.color.join(',')}|${group.vertexColors ? 1 : 0}|${group.glass ? 1 : 0}|${group.decal ? 1 : 0}`
    let material = this.materials.get(key)
    if (!material) {
      material = new MeshStandardMaterial({
        // CAD 색은 sRGB 값이다
        color: new Color().setRGB(...group.color, SRGBColorSpace),
        vertexColors: group.vertexColors,
        metalness: CAD_METALNESS,
        roughness: CAD_ROUGHNESS
      })
      if (group.glass) {
        material.transparent = true
        material.opacity = FIELD_CAD_GLASS_OPACITY
        material.depthWrite = false
      }
      if (group.decal) {
        material.polygonOffset = true
        material.polygonOffsetFactor = -1
        material.polygonOffsetUnits = POLYGON_OFFSET_UNITS.overlay
      }
      this.materials.set(key, material)
    }
    return material
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose()
    this.materials.clear()
  }
}

// 묶음의 renderOrder: 투명판은 벽 판(3) 순서라 잔상(5)·넘어간 HIVE CELL(4)이 판 뒤에서도 보인다
function fieldCadRenderOrder(group: FieldVisualGroup): number {
  return group.glass ? FIELD_RENDER_ORDER.wallPanel : FIELD_RENDER_ORDER.floor
}

// 정렬 회전(순수 회전, 위치 없음)의 quaternion: 앞 축 → 필드 +X, 위 축 → 필드 +Z
function fieldCadQuaternion(alignment: CadAlignment): Quaternion {
  return new Quaternion().setFromRotationMatrix(alignmentRotation(alignment))
}

function FieldCadView({
  visual,
  revision,
  visible
}: {
  visual: FieldVisual
  // fieldVisualStore 칸의 판(바꿔 끼울 때만 묶음을 다시 고른다)
  revision: number
  visible: boolean
}): React.JSX.Element {
  const invalidate = useThree((state) => state.invalidate)
  const materials = useMemo(() => new FieldCadMaterials(), [])
  useDeferredDispose(materials)
  // 묶음은 모듈 칸이라 판(revision)이 바뀔 때만 다시 읽는다
  const groups = useMemo(() => {
    void revision
    return fieldVisualGroups()
  }, [revision])
  const { upAxis, forwardAxis } = visual
  const quaternion = useMemo(
    () => fieldCadQuaternion({ upAxis, forwardAxis }),
    [upAxis, forwardAxis]
  )

  useEffect(() => {
    invalidate()
  }, [groups, quaternion, visible, invalidate])

  return (
    <group name="fieldCad" quaternion={quaternion} visible={visible}>
      {groups.map((group) => (
        <mesh
          key={group.key}
          name={`fieldCad.${group.key}`}
          geometry={group.geometry}
          material={materials.get(group)}
          renderOrder={fieldCadRenderOrder(group)}
          raycast={noRaycast}
        />
      ))}
    </group>
  )
}

export default FieldCadView
