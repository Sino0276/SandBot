import { Object3D } from 'three'

// 저장 좌표계는 FTC 필드 좌표계다. 원점은 필드 중앙 바닥, Z가 위, 단위는 미터·라디안.
// Three.js 기본값(Y-up)을 바꾸므로 Object3D를 만드는 코드보다 먼저 이 모듈이 평가되어야 한다(main.tsx에서 가장 먼저 import).
Object3D.DEFAULT_UP.set(0, 0, 1)

const INCH = 0.0254

// 공칭 치수. 실제 필드는 벽 두께와 타일 이음새 때문에 조금 작다.
export const FIELD_SIZE = 144 * INCH
export const TILE_SIZE = 24 * INCH

// FTC 로봇 시작 크기 한도(18 in 정육면체). 임시 로봇 모델에 쓴다.
export const ROBOT_SIZE = 18 * INCH

export const DEG = Math.PI / 180
