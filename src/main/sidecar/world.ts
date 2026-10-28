import type { DeviceValues } from '../../shared/sidecarProtocol'
import type { SimNoticeCode } from '../../shared/play'
import type { SimPose, WorldSpec } from '../../shared/sim/worldSpec'

// 사이드카 바깥의 세계(운동학 시뮬레이터). 틱이 도착할 때마다 그 틱의 장치 출력을 받아, 그 틱 답(tickReply)에 실을 센서
// 값(장치 이름 → 값)을 돌려준다. 구현은 src/shared/sim/world.ts의 KinematicWorld(2단계)이고, 세계가 없으면 EMPTY_WORLD.
export interface SimWorld {
  // tNanos: 이 틱 경계의 가상 시간(앞으로만 간다). 돌려준 값은 보낸 키만 바꾼다(sidecarProtocol.TickReply.inputs).
  step(tNanos: number, outputs: Record<string, DeviceValues>): Record<string, DeviceValues>
  // 지금 로봇 자세(필드 좌표). 세계에 로봇이 없으면 null.
  pose(): SimPose | null
  // 쌓인 안내를 꺼낸다(호스트가 simNotice 이벤트로 보낸다)
  drainNotices(): { code: SimNoticeCode; params: Record<string, string> }[]
}

export const EMPTY_WORLD: SimWorld = {
  step: () => ({}),
  pose: () => null,
  drainNotices: () => []
}

// 실행마다 세계를 만든다(PlayInitRequest.world를 검증한 값, 없으면 null)
export type WorldFactory = (spec: WorldSpec | null) => SimWorld
