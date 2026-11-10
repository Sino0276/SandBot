import { Vector3 } from 'three'
import { alignmentRotation, type CadAlignment } from '../../cad/alignment'
import type { Vec3 } from '../../scene/model'

// Field 인스펙터 "필드 CAD (보기용)" 구역의 정렬 확인(spec-4e §4.1, 순수). 정렬은 회전만이라 위 축을 잘못 고르거나 원점이
// 바닥이 아닌 STEP을 고르면 필드가 세워지거나 바닥 아래로 가도 다른 표시가 없다(클릭도, 하이어라키 행도 없다). 그래서
// 정렬한 경계 상자를 한 줄로 보이고 두 규칙으로 경고한다.

export type FieldCadBounds = { min: Vec3; max: Vec3 }

// CAD 좌표 경계 상자(정렬 전)의 8꼭짓점을 정렬 회전으로 돌린 필드 좌표 범위
export function alignedFieldCadBounds(
  bounds: FieldCadBounds,
  alignment: CadAlignment
): FieldCadBounds {
  const rotation = alignmentRotation(alignment)
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const corner = new Vector3()
  for (let k = 0; k < 8; k += 1) {
    corner
      .set(
        k & 1 ? bounds.max[0] : bounds.min[0],
        k & 2 ? bounds.max[1] : bounds.min[1],
        k & 4 ? bounds.max[2] : bounds.min[2]
      )
      .applyMatrix4(rotation)
    const values = [corner.x, corner.y, corner.z]
    for (let i = 0; i < 3; i += 1) {
      // 회전 원소가 0·±1이라 −0이 나올 수 있다(표시에 "-0"이 보이지 않게 0으로)
      const value = values[i] === 0 ? 0 : values[i]
      if (value < min[i]) min[i] = value
      if (value > max[i]) max[i] = value
    }
  }
  return { min, max }
}

// 정렬이 의심스러운가: 정렬한 Z 폭 ≥ min(X 폭, Y 폭)(위 축이 틀림), 또는 Z 범위가 0을 품지 않음(원점이 바닥이 아님).
// 공식 BIOBUZZ 필드 CAD(Y-up)는 X 3.65 m · Y 6.38 m · Z −0.043..1.677 m라 경고가 없고, 같은 파일에 Z-up을 고르면 Z 폭
// 3.65 m ≥ X 폭 1.72 m라 경고다(spec-4e §4.1, cad/bbox.json).
export function fieldCadAlignmentSuspect(bounds: FieldCadBounds, alignment: CadAlignment): boolean {
  const aligned = alignedFieldCadBounds(bounds, alignment)
  const width = (i: number): number => aligned.max[i] - aligned.min[i]
  if (width(2) >= Math.min(width(0), width(1))) return true
  return !(aligned.min[2] <= 0 && aligned.max[2] >= 0)
}

// 경계 상자 줄(field.inspector.cad.bounds)의 x·y·z 글자: "최소..최대 단위"(표시 단위, length가 숫자 글자로 바꾼다)
export function fieldCadBoundsParams(
  bounds: FieldCadBounds,
  alignment: CadAlignment,
  length: (meters: number) => string,
  symbol: string
): { x: string; y: string; z: string } {
  const aligned = alignedFieldCadBounds(bounds, alignment)
  const range = (i: number): string =>
    `${length(aligned.min[i])}..${length(aligned.max[i])} ${symbol}`
  return { x: range(0), y: range(1), z: range(2) }
}
