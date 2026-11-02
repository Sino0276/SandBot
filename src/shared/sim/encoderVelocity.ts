// 허브(Lynx) 펌웨어의 엔코더 속도 측정. 허브는 모터 포트 엔코더의 속도를 지난 50 ms 동안 센 틱 수 × 20(틱/s)으로 보고한다.
// 그래서 값은 늘 20 틱/s의 배수이고, 창 가운데의 평균 속도라 약 25 ms 늦다. Road Runner ftc의 OverflowEncoder(Encoders.kt
// inverseOverflow: "the velocity is always a multiple of 20 cps due to Expansion Hub's 50ms measurement window")가 이 성질로
// int16으로 감긴 값을 되돌리므로, 20의 배수가 아니면 팀 코드의 속도가 65536의 배수만큼 틀어진다.
//
// 규칙(시각 t는 틱 경계의 가상 시각): 속도 = (floor(raw(t)) − floor(raw(t − 50 ms))) × 20. raw는 원시 허브 틱(소수)이고
// floor가 엔코더가 센 정수다(position 입력과 같다). raw(t − 50 ms)는 기록(하위 단계마다, 1 ms 이하 간격) 사이를 선형 보간한다.
// 창은 틱마다 미끄러진다고 본다(펌웨어가 50 ms마다 한 번만 새로 재는지는 공개 자료로 확인하지 못했다. 20의 배수인 것은 같다).
// 첫 기록(실행을 시작한 틱) 전에는 멈춰 있었다고 본다(세계는 실행마다 정지 상태로 만든다): 시작 뒤 처음 50 ms는
// t − 50 ms가 첫 기록보다 앞이므로 첫 기록의 값을 쓴다. 그래서 시작 틱의 속도는 0이고, 그 뒤 50 ms 동안은 시작부터 센 틱 × 20이다.
// 값은 int16으로 감기 전이다(허브가 bulk read로 보내는 short로 감는 것은 가짜 SDK의 SimDcMotorController가 한다).
// 계산은 기록한 수로만 한다(벽시계·난수 없음): 같은 기록열이면 같은 값이다.

// 허브의 측정 창(ns)과 틱 수 → 틱/s 배율(1 s ÷ 50 ms)
export const HUB_VELOCITY_WINDOW_NANOS = 50_000_000
export const HUB_VELOCITY_SCALE = 1e9 / HUB_VELOCITY_WINDOW_NANOS

export class HubVelocityWindow {
  // 기록(시각 ns, 원시 틱)을 시각 순으로. 창 시작(마지막 시각 − 50 ms) 이전 기록은 보간에 쓸 마지막 하나만 남긴다.
  private readonly times: number[] = []
  private readonly raws: number[] = []

  // tNanos는 앞 기록보다 뒤여야 한다(같거나 앞이면 무시한다)
  record(tNanos: number, raw: number): void {
    const n = this.times.length
    if (n > 0 && !(tNanos > this.times[n - 1])) return
    this.times.push(tNanos)
    this.raws.push(raw)
    const start = tNanos - HUB_VELOCITY_WINDOW_NANOS
    let drop = 0
    while (drop + 1 < this.times.length && this.times[drop + 1] <= start) drop++
    if (drop > 0) {
      this.times.splice(0, drop)
      this.raws.splice(0, drop)
    }
  }

  // 마지막 기록 시각에 허브가 보고할 속도(틱/s, 20의 배수인 정수). 기록이 없으면 0.
  ticksPerSecond(): number {
    const n = this.times.length
    if (n === 0) return 0
    const now = Math.floor(this.raws[n - 1])
    const before = Math.floor(this.rawAt(this.times[n - 1] - HUB_VELOCITY_WINDOW_NANOS))
    const velocity = (now - before) * HUB_VELOCITY_SCALE
    return velocity === 0 ? 0 : velocity
  }

  // 시각 t의 원시 틱: 첫 기록 전이면 첫 값, 기록 시각이면 그 값, 그 사이는 선형 보간
  private rawAt(t: number): number {
    if (t <= this.times[0]) return this.raws[0]
    for (let i = 1; i < this.times.length; i++) {
      const t1 = this.times[i]
      if (t > t1) continue
      if (t === t1) return this.raws[i]
      const t0 = this.times[i - 1]
      const r0 = this.raws[i - 1]
      return r0 + ((this.raws[i] - r0) * (t - t0)) / (t1 - t0)
    }
    return this.raws[this.raws.length - 1]
  }
}
