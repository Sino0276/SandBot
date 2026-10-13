import { create } from 'zustand'

// 씬 뷰 비행(우클릭을 누른 채 WASD/QE) 상태. 비행 중에는 W/E 같은 편집기 단축키를 쓰지 않는다.
type FlyState = {
  flying: boolean
  // 비행 속도(m/s). 우클릭 중 휠로 바꾼다.
  speed: number
}

export const DEFAULT_FLY_SPEED = 1.5
export const MIN_FLY_SPEED = 0.05
export const MAX_FLY_SPEED = 30

export const useFlyStore = create<FlyState>()(() => ({ flying: false, speed: DEFAULT_FLY_SPEED }))

export function isFlying(): boolean {
  return useFlyStore.getState().flying
}
