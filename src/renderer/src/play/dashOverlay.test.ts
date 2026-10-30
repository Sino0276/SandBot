import { describe, expect, it } from 'vitest'
import type { DashOp } from '../../../shared/dashboard'
import { parseCssColor } from './cssColor'
import {
  apply,
  INCH,
  interpretDashOps,
  OVERLAY_Z,
  OverlayBuilder,
  PAGE_FRAME,
  parseDashFont,
  SPLINE_SAMPLES,
  strokeTriangles,
  tessellateOverlay,
  type OverlayPrimitive
} from './dashOverlay'

// 미터 점 목록 → 인치(비교하기 쉽게)
const inches = (points: readonly number[]): number[] => points.map((v) => v / INCH)

const circle = (x: number, y: number, radius: number, stroke = true): DashOp => ({
  type: 'circle',
  x,
  y,
  radius,
  stroke
})
const polyline = (xPoints: number[], yPoints: number[]): DashOp => ({
  type: 'polyline',
  xPoints,
  yPoints
})
const text = (
  value: string,
  x: number,
  y: number,
  theta: number,
  usePageFrame: boolean,
  stroke = false
): DashOp => ({ type: 'text', text: value, x, y, font: '8px Arial', theta, stroke, usePageFrame })

function only<K extends OverlayPrimitive['kind']>(
  primitives: OverlayPrimitive[],
  kind: K
): Extract<OverlayPrimitive, { kind: K }> {
  expect(primitives).toHaveLength(1)
  expect(primitives[0].kind).toBe(kind)
  return primitives[0] as Extract<OverlayPrimitive, { kind: K }>
}

// 원의 점들의 평균(중심)과 첫 점까지 거리(반지름), 인치
function circleShape(points: number[]): { cx: number; cy: number; radius: number } {
  const p = inches(points)
  let cx = 0
  let cy = 0
  for (let i = 0; i < p.length; i += 2) {
    cx += p[i]
    cy += p[i + 1]
  }
  cx /= p.length / 2
  cy /= p.length / 2
  return { cx, cy, radius: Math.hypot(p[0] - cx, p[1] - cy) }
}

describe('CSS 색', () => {
  it('이름·hex·rgb()·rgba()·hsl()을 읽는다', () => {
    expect(parseCssColor('goldenrod')).toEqual({ r: 218, g: 165, b: 32, a: 1 })
    expect(parseCssColor('  RED ')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseCssColor('#4CAF507A')).toEqual({ r: 76, g: 175, b: 80, a: 0x7a / 255 })
    expect(parseCssColor('#3F51B5')).toEqual({ r: 63, g: 81, b: 181, a: 1 })
    expect(parseCssColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseCssColor('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 0x88 / 255 })
    expect(parseCssColor('rgb(255, 128, 0)')).toEqual({ r: 255, g: 128, b: 0, a: 1 })
    expect(parseCssColor('rgba(0,0,255,0.5)')).toEqual({ r: 0, g: 0, b: 255, a: 0.5 })
    expect(parseCssColor('rgb(100% 0% 0% / 25%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.25 })
    expect(parseCssColor('rgb(300, -5, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    const green = parseCssColor('hsl(120, 100%, 50%)')!
    expect(green.r).toBeCloseTo(0)
    expect(green.g).toBeCloseTo(255)
    expect(green.b).toBeCloseTo(0)
    expect(parseCssColor('hsla(0.5turn 100% 50% / 0.5)')).toMatchObject({ a: 0.5 })
  })

  it('받지 못하는 글자는 null이다', () => {
    for (const value of [
      '',
      'notacolor',
      '#12',
      '#12345',
      '#ggg',
      'rgb(1, 2)',
      'rgb(1, 2, 3, 4, 5)',
      'rgb(1 2 3, 4)',
      'rgb(a, b, c)',
      'constructor',
      '__proto__',
      'url(x)'
    ])
      expect(parseCssColor(value), value).toBeNull()
  })
})

describe('글꼴', () => {
  it('크기(사용자 단위)·모양·글꼴을 읽고, 못 읽으면 캔버스 기본값', () => {
    expect(parseDashFont('8px Arial')).toEqual({ style: '', size: 8, family: 'Arial' })
    expect(parseDashFont('bold italic 12px "Courier New", monospace')).toEqual({
      style: 'bold italic',
      size: 12,
      family: '"Courier New", monospace'
    })
    expect(parseDashFont('9pt serif').size).toBeCloseTo(12)
    expect(parseDashFont('2em sans-serif').size).toBe(20)
    expect(parseDashFont('Arial')).toEqual({ style: '', size: 10, family: 'sans-serif' })
    expect(parseDashFont('-4px Arial')).toEqual({ style: '', size: 10, family: 'sans-serif' })
  })
})

describe('Dashboard op 해석(Field.js)', () => {
  it('페이지 틀: (px, py) → (72 − py, 72 − px) 인치', () => {
    expect(apply(PAGE_FRAME, 0, 0)).toEqual([72, 72])
    expect(apply(PAGE_FRAME, 144, 144)).toEqual([-72, -72])
    expect(apply(PAGE_FRAME, 10, 20)).toEqual([52, 62])
    const label = only(interpretDashOps([text('A', 10, 20, 0, true)]), 'text')
    expect(inches(apply(label.matrix, 0, 0))).toEqual([52, 62])
    // 페이지 틀의 기준선(+x)은 필드 −y(화면 오른쪽), 글자 위(−y)는 필드 +x(화면 위)
    const [bx, by] = apply(label.matrix, 1, 0)
    expect((bx - 52 * INCH) / INCH).toBeCloseTo(0)
    expect((by - 62 * INCH) / INCH).toBeCloseTo(-1)
    const [ux, uy] = apply(label.matrix, 0, -1)
    expect((ux - 52 * INCH) / INCH).toBeCloseTo(1)
    expect((uy - 62 * INCH) / INCH).toBeCloseTo(0)
    // 페이지 틀은 사용자 변환을 쓰지 않는다
    const moved = only(
      interpretDashOps([{ type: 'translate', x: 30, y: 30 }, text('A', 10, 20, 0, true)]),
      'text'
    )
    expect(inches(apply(moved.matrix, 0, 0))).toEqual([52, 62])
  })

  it('사용자 변환은 늘 T·R·S이고 op는 자기 성분만 바꾼다(순서와 관계없음)', () => {
    const ops: DashOp[] = [
      { type: 'scale', scaleX: 2, scaleY: 3 },
      { type: 'translate', x: 10, y: 5 },
      { type: 'rotation', rotation: Math.PI / 2 },
      circle(1, 0, 1)
    ]
    // 필드 점 = t + R(θ)·diag(sx, sy)·q: (10, 5) + R90·(2, 0) = (10, 7)
    const a = circleShape(only(interpretDashOps(ops), 'stroke').points)
    expect(a.cx).toBeCloseTo(10)
    expect(a.cy).toBeCloseTo(7)
    const reordered = [ops[2], ops[1], ops[0], ops[3]]
    const b = circleShape(only(interpretDashOps(reordered), 'stroke').points)
    expect(b.cx).toBeCloseTo(10)
    expect(b.cy).toBeCloseTo(7)
    // 같은 성분을 다시 정하면 바꾼다(합치지 않는다)
    const replaced = interpretDashOps([
      { type: 'translate', x: 10, y: 0 },
      { type: 'translate', x: 0, y: 4 },
      circle(0, 0, 1)
    ])
    const c = circleShape(only(replaced, 'stroke').points)
    expect(c.cx).toBeCloseTo(0)
    expect(c.cy).toBeCloseTo(4)
  })

  it('그린 op는 그때의 변환·색을 쓰고, 상태는 다음 op로 이어진다', () => {
    const primitives = interpretDashOps([
      { type: 'stroke', color: 'red' },
      circle(0, 0, 1),
      { type: 'translate', x: 20, y: 0 },
      { type: 'stroke', color: 'not a color' },
      circle(0, 0, 1)
    ])
    expect(primitives).toHaveLength(2)
    const [first, second] = primitives as Extract<OverlayPrimitive, { kind: 'stroke' }>[]
    expect(circleShape(first.points).cx).toBeCloseTo(0)
    expect(circleShape(second.points).cx).toBeCloseTo(20)
    // 받지 못하는 색은 무시해 빨강이 남는다
    expect(second.color).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  })

  it('사용자 틀 글자는 T·S(1, −1)·R(θ): 기준선 (cos θ, −sin θ), 위 (sin θ, cos θ)', () => {
    for (const theta of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2]) {
      const label = only(interpretDashOps([text('T', 5, 6, theta, false)]), 'text')
      const [ox, oy] = inches(apply(label.matrix, 0, 0))
      expect(ox).toBeCloseTo(5)
      expect(oy).toBeCloseTo(6)
      const [bx, by] = inches(apply(label.matrix, 1, 0))
      expect(bx - 5).toBeCloseTo(Math.cos(theta))
      expect(by - 6).toBeCloseTo(-Math.sin(theta))
      // 캔버스 글자 틀의 위는 −y
      const [ux, uy] = inches(apply(label.matrix, 0, -1))
      expect(ux - 5).toBeCloseTo(Math.sin(theta))
      expect(uy - 6).toBeCloseTo(Math.cos(theta))
    }
  })

  it('글자는 fill·stroke 색, 글꼴, 선 굵기를 가진다', () => {
    const [filled, stroked] = interpretDashOps([
      { type: 'fill', color: 'blue' },
      { type: 'stroke', color: 'lime' },
      { type: 'strokeWidth', width: 2 },
      text('F', 0, 0, 0, false),
      text('S', 0, 0, 0, false, true)
    ]) as Extract<OverlayPrimitive, { kind: 'text' }>[]
    expect(filled.color).toEqual({ r: 0, g: 0, b: 255, a: 1 })
    expect(filled.stroke).toBe(false)
    expect(filled.font).toEqual({ style: '', size: 8, family: 'Arial' })
    expect(stroked.color).toEqual({ r: 0, g: 255, b: 0, a: 1 })
    expect(stroked.stroke).toBe(true)
    expect(stroked.lineWidth).toBe(2)
  })

  it('선 굵기는 사용자 단위 인치이고 척도에 비례한다', () => {
    const plain = only(interpretDashOps([polyline([0, 10], [0, 0])]), 'stroke')
    // 캔버스 기본 1 in
    expect(plain.width).toBeCloseTo(INCH)
    const scaled = only(
      interpretDashOps([
        { type: 'strokeWidth', width: 2 },
        { type: 'scale', scaleX: 3, scaleY: 3 },
        polyline([0, 10], [0, 0])
      ]),
      'stroke'
    )
    expect(scaled.width).toBeCloseTo(6 * INCH)
    expect(inches(scaled.points)).toEqual([0, 0, 30, 0])
    // 0 이하 굵기는 캔버스처럼 무시한다
    const ignored = only(
      interpretDashOps([{ type: 'strokeWidth', width: 0 }, polyline([0, 1], [0, 0])]),
      'stroke'
    )
    expect(ignored.width).toBeCloseTo(INCH)
  })

  it('alpha는 뒤의 모든 그리기에 곱하고, 0–1 밖 값은 무시한다', () => {
    const [half, kept] = interpretDashOps([
      { type: 'fill', color: '#4CAF507A' },
      { type: 'alpha', alpha: 0.5 },
      circle(0, 0, 1, false),
      { type: 'alpha', alpha: 2 },
      circle(0, 0, 1, false)
    ]) as Extract<OverlayPrimitive, { kind: 'fill' }>[]
    expect(half.kind).toBe('fill')
    expect(half.color.a).toBeCloseTo((0x7a / 255) * 0.5)
    expect(kept.color.a).toBeCloseTo((0x7a / 255) * 0.5)
  })

  it('다각형은 닫고 선은 열어 두며, 사각형은 채운다', () => {
    const [outline, rect, line] = interpretDashOps([
      { type: 'polygon', xPoints: [0, 4, 4], yPoints: [0, 0, 3], stroke: true },
      { type: 'polygon', xPoints: [0, 2, 2, 0], yPoints: [0, 0, 2, 2], stroke: false },
      polyline([0, 1, 2], [0, 1, 0])
    ])
    expect(outline).toMatchObject({ kind: 'stroke', closed: true })
    expect(rect.kind).toBe('fill')
    expect(line).toMatchObject({ kind: 'stroke', closed: false })
  })

  it('스플라인은 t를 250번 나눈 5차식이다', () => {
    const spline = only(
      interpretDashOps([
        {
          type: 'spline',
          ax: 0,
          bx: 0,
          cx: 0,
          dx: 0,
          ex: 10,
          fx: 1,
          ay: 0,
          by: 0,
          cy: 0,
          dy: 4,
          ey: 0,
          fy: 2
        }
      ]),
      'stroke'
    )
    const p = inches(spline.points)
    expect(p.length).toBe(2 * (SPLINE_SAMPLES + 1))
    expect(p[0]).toBeCloseTo(1)
    expect(p[1]).toBeCloseTo(2)
    expect(p[p.length - 2]).toBeCloseTo(11)
    expect(p[p.length - 1]).toBeCloseTo(6)
  })

  it('기본 필드(/dash 그림과 144 in 격자)는 그리지 않고, 팀 격자와 /images 그림은 그린다', () => {
    const defaultField: DashOp[] = [
      { type: 'alpha', alpha: 0.4 },
      {
        type: 'image',
        path: '/dash/decode.webp',
        x: 0,
        y: 0,
        width: 144,
        height: 144,
        theta: 0,
        pivotX: 0,
        pivotY: 0,
        usePageFrame: true
      },
      { type: 'alpha', alpha: 1 },
      {
        type: 'grid',
        x: 0,
        y: 0,
        width: 144,
        height: 144,
        numTicksX: 7,
        numTicksY: 7,
        theta: 0,
        pivotX: 0,
        pivotY: 0,
        usePageFrame: true
      }
    ]
    expect(interpretDashOps(defaultField)).toEqual([])
    const [grid, image] = interpretDashOps([
      {
        type: 'grid',
        x: 0,
        y: 0,
        width: 24,
        height: 12,
        numTicksX: 3,
        numTicksY: 2,
        theta: 0,
        pivotX: 0,
        pivotY: 0,
        usePageFrame: false
      },
      {
        type: 'image',
        path: '/images/robot.png',
        x: 10,
        y: 20,
        width: 18,
        height: 9,
        theta: 0,
        pivotX: 9,
        pivotY: 4.5,
        usePageFrame: false
      }
    ])
    if (grid.kind !== 'hairlines') throw new Error(grid.kind)
    // 세로 3줄(0, 12, 24) + 가로 2줄(0, 12), 사용자 틀이라 y가 뒤집힌다
    expect(inches(grid.segments).map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([
      0, 0, 0, -12, 12, 0, 12, -12, 24, 0, 24, -12, 0, 0, 24, 0, 0, -12, 24, -12
    ])
    expect(grid.color).toEqual({ r: 120, g: 120, b: 120, a: 1 })
    if (image.kind !== 'image') throw new Error(image.kind)
    expect(image.path).toBe('images/robot.png')
    expect(image.rect).toEqual([-9, -4.5, 18, 9])
    expect(inches(apply(image.matrix, 0, 0))).toEqual([10, 20])
  })
})

describe('삼각형으로 나누기', () => {
  it('곧은 선은 너비 ±w/2의 띠 하나(삼각형 2개)다', () => {
    const builder = new OverlayBuilder()
    strokeTriangles(builder, [0, 0, 1, 0], false, 0.2, { r: 255, g: 0, b: 0, a: 1 })
    expect(builder.positions.length).toBe(6 * 3)
    const ys = builder.positions.filter((_, i) => i % 3 === 1)
    expect(Math.max(...ys)).toBeCloseTo(0.1)
    expect(Math.min(...ys)).toBeCloseTo(-0.1)
    const zs = builder.positions.filter((_, i) => i % 3 === 2)
    expect(zs.every((z) => z === OVERLAY_Z)).toBe(true)
    expect(builder.colors.slice(0, 4)).toEqual([1, 0, 0, 1])
  })

  it('직각으로 꺾이면 바깥은 miter 꼭짓점, 안쪽은 두 띠가 만나는 점에서 끝난다', () => {
    const builder = new OverlayBuilder()
    // 오른쪽으로 갔다 위로(왼쪽으로 꺾임)
    strokeTriangles(builder, [0, 0, 1, 0, 1, 1], false, 0.2, { r: 0, g: 0, b: 0, a: 1 })
    const xy: [number, number][] = []
    for (let i = 0; i < builder.positions.length; i += 3)
      xy.push([builder.positions[i], builder.positions[i + 1]])
    const has = (x: number, y: number): boolean =>
      xy.some(([px, py]) => Math.abs(px - x) < 1e-9 && Math.abs(py - y) < 1e-9)
    // 바깥 miter 꼭짓점 (1.1, −0.1), 안쪽 만나는 점 (0.9, 0.1)
    expect(has(1.1, -0.1)).toBe(true)
    expect(has(0.9, 0.1)).toBe(true)
    // 안쪽 법선 끝(1, 0.1)·(0.9, 0)은 쓰지 않는다(겹치지 않음)
    expect(has(1, 0.1)).toBe(false)
    expect(has(0.9, 0)).toBe(false)
    // 띠 2개(삼각형 4개) + miter(삼각형 2개)
    expect(xy.length).toBe(6 * 3)
  })

  it('아주 뾰족하게 꺾이면 miter 한도(10)를 넘어 bevel이다', () => {
    const builder = new OverlayBuilder()
    strokeTriangles(builder, [0, 0, 10, 0, 0, 0.5], false, 0.2, { r: 0, g: 0, b: 0, a: 1 })
    // 띠 2개(삼각형 4개) + bevel(삼각형 1개)
    expect(builder.positions.length).toBe(5 * 3 * 3)
  })

  it('연속한 채움·선은 한 묶음, 격자와 글자는 따로이며 순서를 지킨다', () => {
    const runs = tessellateOverlay(
      interpretDashOps([
        { type: 'polygon', xPoints: [0, 2, 2, 0], yPoints: [0, 0, 2, 2], stroke: false },
        polyline([0, 5], [0, 0]),
        {
          type: 'grid',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          numTicksX: 2,
          numTicksY: 2,
          theta: 0,
          pivotX: 0,
          pivotY: 0,
          usePageFrame: false
        },
        text('hi', 0, 0, 0, false),
        circle(0, 0, 2, false)
      ])
    )
    expect(runs.map((run) => run.kind)).toEqual(['mesh', 'lines', 'text', 'mesh'])
    const [mesh, lines] = runs as Extract<(typeof runs)[number], { kind: 'mesh' | 'lines' }>[]
    // 사각형(삼각형 2개) + 선 띠(삼각형 2개)
    expect(mesh.positions.length).toBe(4 * 3 * 3)
    expect(mesh.colors.length).toBe(4 * 3 * 4)
    // 격자 선 4개(꼭짓점 8개)
    expect(lines.positions.length).toBe(8 * 3)
  })

  it('같은 op 목록은 늘 같은 버퍼다(결정적)', () => {
    const ops: DashOp[] = [
      { type: 'stroke', color: '#3F51B5' },
      { type: 'strokeWidth', width: 1 },
      circle(10, 20, 9),
      polyline([0, 10, 20], [0, 5, 0])
    ]
    const a = tessellateOverlay(interpretDashOps(ops))
    const b = tessellateOverlay(interpretDashOps(ops))
    expect(a).toEqual(b)
  })
})
