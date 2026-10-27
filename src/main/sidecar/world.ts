import type { DeviceValues } from '../../shared/sidecarProtocol'

// 사이드카 바깥의 세계(운동학 시뮬레이터 자리). 틱 경계마다 그 틱의 장치 출력을 받아, 그 틱 답(tickReply)에 실을 센서
// 값(장치 이름 → 값)을 돌려준다. 1단계는 시뮬레이터가 없어 늘 빈 값이고 장치는 기본값(0 등)을 쓴다.
// 2단계의 시뮬레이터는 이 인터페이스만 구현하면 호스트(session.ts)를 고치지 않고 이어진다.
export interface SimWorld {
  // tNanos: 이 틱 경계의 가상 시간(앞으로만 간다). 돌려준 값은 보낸 키만 바꾼다(sidecarProtocol.TickReply.inputs).
  step(tNanos: number, outputs: Record<string, DeviceValues>): Record<string, DeviceValues>
}

export const EMPTY_WORLD: SimWorld = { step: () => ({}) }
