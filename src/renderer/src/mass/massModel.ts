import type { SceneObjects } from '../scene/model'
import type { MassLookup, MassModel } from './types'

// 질량 추정(spec-3a §3). 순수 함수: 같은 문서와 같은 메시 성질이면 같은 결과다(objects 키 순서로 센다).
// 계약 단계의 빈 구현이다(갈래 B가 채운다).
export function computeMassModel(objects: SceneObjects, lookup: MassLookup): MassModel {
  void objects
  void lookup
  return { objects: {}, robots: {} }
}
