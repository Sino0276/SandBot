import { useSceneStore } from '../scene/sceneStore'

// 필드 시즌 고르기와 필드 알림(spec-4ab §2.4). 계약 커밋은 시즌 고르기만 하고, 알림(열기·고르기의 시즌·겹침 알림, 낡은 알림
// 다시 계산)은 갈래 B가 채운다.

type SceneDocState = ReturnType<typeof useSceneStore.getState>

// Field 인스펙터의 시즌 선택. 갈래 B가 고른 뒤 notifyFieldState('choose')를 더한다.
export function chooseFieldSeason(season: string): void {
  useSceneStore.getState().setFieldSeason(season)
}

// 열기·시즌 고르기 때 스토어의 objects·field로 필드 알림(모르는 시즌, 시작 겹침, v9 기본 시즌)을 띄운다. 갈래 B가 채운다.
export function notifyFieldState(reason: 'open' | 'choose', options?: { assumed: boolean }): void {
  void reason
  void options
}

// sceneStore 구독에서 낡은 필드 알림을 다시 계산한다(새로 띄우지는 않는다). 갈래 B가 채운다.
export function refreshFieldNotices(state: SceneDocState, previous: SceneDocState): void {
  void state
  void previous
}
