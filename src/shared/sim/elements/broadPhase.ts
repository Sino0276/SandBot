import { BROAD_PHASE_CELL } from './elementData'

// 공의 넓은 단계(6a, spec-6a §1): 필드 [−GRID_HALF, GRID_HALF]² 위 BROAD_PHASE_CELL 정수 격자. 칸마다 공 목록을 head/next
// Int32Array 연결 목록으로 두고, 큰 번호부터 넣어 목록이 작은 번호부터 나온다(Map·Set 순서를 쓰지 않는다). 격자 밖 공은 가장자리
// 칸에 넣는다(자르기). 순수·결정적이다.

// 격자가 덮는 반폭(m) [결정: BIOBUZZ 벽 바깥면 1.81 m와 필드 밖으로 날아간 공(나감 판정 전)을 덮는다]
export const GRID_HALF = 2.5
const CELLS = Math.ceil((2 * GRID_HALF) / BROAD_PHASE_CELL)

const cellOf = (x: number): number =>
  Math.min(CELLS - 1, Math.max(0, Math.floor((x + GRID_HALF) / BROAD_PHASE_CELL)))

export class BallGrid {
  private readonly head = new Int32Array(CELLS * CELLS)
  private next: Int32Array
  // 이 격자에 넣은 공(번호 오름차순), 비었으면 아무것도 넣지 않았다
  private count = 0

  constructor(capacity: number) {
    this.next = new Int32Array(Math.max(1, capacity))
  }

  // x·y(필드, 공마다 3칸씩 pos의 0·1)로 넣는다. include(i)가 거짓인 공은 넣지 않는다
  build(n: number, pos: Float64Array, include: (i: number) => boolean): void {
    this.head.fill(-1)
    if (this.next.length < n) this.next = new Int32Array(n)
    this.count = 0
    for (let i = n - 1; i >= 0; i--) {
      if (!include(i)) continue
      const cell = cellOf(pos[3 * i]) * CELLS + cellOf(pos[3 * i + 1])
      this.next[i] = this.head[cell]
      this.head[cell] = i
      this.count++
    }
  }

  // 축 정렬 상자 [x0, x1] × [y0, y1]이 걸친 칸의 공을 visit에 넘긴다(칸 순서: x 칸 오름차순, 그 안 y 칸 오름차순, 칸 안은 번호
  // 오름차순). 같은 공은 한 칸에만 있으므로 한 번만 나온다
  query(x0: number, x1: number, y0: number, y1: number, visit: (i: number) => void): void {
    if (this.count === 0) return
    const i0 = cellOf(x0)
    const i1 = cellOf(x1)
    const j0 = cellOf(y0)
    const j1 = cellOf(y1)
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = this.head[i * CELLS + j]; k >= 0; k = this.next[k]) visit(k)
  }
}
