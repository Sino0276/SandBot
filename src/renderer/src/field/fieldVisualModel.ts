import type { ImportedModel } from '../cad/stepImport'
import type { Vec3 } from '../scene/model'
import type { FieldVisualGroup } from './fieldVisualStore'

// 필드 CAD 보기(spec-4e §1.4·§1.5): 불러온 STEP 메시를 재질 묶음마다 형상 하나로 합친다. 씬 문서·형상 id·BVH·질량 성질을
// 만들지 않는 보기 전용 형상이다. 입력 ImportedModel은 읽기만 한다(메시 캐시에 같은 객체가 쓰이므로 배열을 바꾸지 않는다).

// 반투명 묶음으로 그릴 메시 이름(ImportedMesh.name, occt 메시 이름) [결정: 메시 이름 규칙]. 공식 BIOBUZZ 필드 CAD의
// 폴리카보네이트 벽 판 "FTC Field Side Glass 11in" 12개만 맞는다(색이 알루미늄 부품과 같은 회색이라 색으로 가를 수 없다).
export const FIELD_GLASS_NAME = /glass|polycarbonate|lexan/i

// 투명판 불투명도 [가정: 표시만]. 단순 형상의 벽 판(fieldViewModel.ts PANEL_OPACITY)과 같은 값이다.
export const FIELD_CAD_GLASS_OPACITY = 0.25

// 경계 상자 최소 변이 이 값 이하인 메시는 얇은 겹(decal, 테이프) 묶음이다(m) [가정: 표시만]. 공식 파일의 테이프
// "Gaffer Tape …"는 두께 0.01 in(0.254 mm)이고 아랫면이 타일 윗면과 같은 평면이라 polygonOffset으로 그린다.
export const FIELD_CAD_DECAL_THICKNESS = 0.0005

export type BuiltFieldVisual = {
  groups: FieldVisualGroup[]
  meshCount: number
  triangleCount: number
  glassMeshCount: number
  // 묶음 boundingBox의 합(CAD 좌표, 정렬 전)
  bounds: { min: Vec3; max: Vec3 }
}

// 메시를 묶어 형상으로 만든다(순수, 결정적: 묶음 순서는 model.meshes에서 키가 처음 나온 순서).
// 계약 단계(spec-4e §6)는 빈 결과를 돌려준다(부르는 곳이 아직 없다). 구현은 갈래 A다.
export function buildFieldVisual(model: ImportedModel): BuiltFieldVisual {
  void model
  return {
    groups: [],
    meshCount: 0,
    triangleCount: 0,
    glassMeshCount: 0,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] }
  }
}
