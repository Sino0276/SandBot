import { ShapeUtils, Vector2 } from 'three'
import type { DashOp } from '../../../shared/dashboard'
import { dashImageAssetPath } from '../../../shared/teamCodeAssets'
import { parseCssColor, type Rgba } from './cssColor'

// FTC Dashboard 필드 보기(웹 클라이언트 Field.js, 0.6.0)를 씬 뷰 바닥에 그리기 위한 순수 변환(라이브러리 L2).
// op 목록(field() op + fieldOverlay() op 한 목록)을 차례로 읽고 Field.js와 같은 상태를 이어 간다:
// - 사용자 변환: translate·rotation·scale op가 각자 자기 성분만 바꾸고, 합성은 늘 T·R·S다(op 순서와 관계없다).
//   그린 op는 그때의 변환을 쓴다.
// - 색(fill·stroke, CSS 색, 받지 못하는 글자는 캔버스처럼 무시), 선 굵기(사용자 단위 인치라 척도에 비례), alpha.
// - 글자·그림·격자는 usePageFrame이면 페이지 틀((px, py) → (72 − py, 72 − px) 인치, 사용자 변환 무시), 아니면 사용자 틀에
//   T·S(1, −1)·R(θ)(θ는 화면에서 시계 방향, 글자가 뒤집히지 않게)로 놓는다. 글자 앵커는 기준선 왼쪽 끝이다.
// Dashboard 좌표는 FTC 필드 좌표(인치, 원점 필드 가운데)이므로 × 0.0254로 SandBot 필드 좌표(미터)에 그대로 놓는다
// (필드 축이 어느 벽을 향하는지와 관계없다). 기본 필드 그림('/dash/…')과 기본 격자(144 in 페이지 틀 7×7)는 SandBot 필드가
// 대신하므로 그리지 않는다.
// 결과는 미터 단위 도형(interpretDashOps)과 그것을 삼각형·선으로 나눈 그리기 묶음(tessellateOverlay)이다. 씬 뷰
// (editor/scene/DashboardOverlay.tsx)가 이것을 그대로 그린다.

export const INCH = 0.0254
// 바닥(z 0)과 타일 선(z 1 mm) 바로 위
export const OVERLAY_Z = 0.002
// Dashboard 페이지 틀(필드 한 변 144 in)의 반
const HALF_FIELD_IN = 72
// Field.js의 splineSamples
export const SPLINE_SAMPLES = 250
// 캔버스 lineJoin 'miter'의 기본 miterLimit
const MITER_LIMIT = 10
// 격자 선 색(Field.js gridLineColor)
const GRID_COLOR: Rgba = { r: 120, g: 120, b: 120, a: 1 }
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
// 캔버스 기본 글꼴
const DEFAULT_FONT_SIZE = 10
const DEFAULT_FONT_FAMILY = 'sans-serif'

// 2D 아핀 변환(캔버스 DOMMatrix와 같은 순서): (x, y) → (a·x + c·y + e, b·x + d·y + f)
export type Affine = readonly [number, number, number, number, number, number]

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0]

export function multiply(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

const translation = (x: number, y: number): Affine => [1, 0, 0, 1, x, y]
const rotation = (theta: number): Affine => {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [c, s, -s, c, 0, 0]
}
const scaling = (x: number, y: number): Affine => [x, 0, 0, y, 0, 0]

// 페이지 틀(왼쪽 위 원점, x 오른쪽, y 아래, 인치) → 필드 인치
export const PAGE_FRAME: Affine = [0, -1, -1, 0, HALF_FIELD_IN, HALF_FIELD_IN]
// 필드 인치 → 미터
const TO_METERS: Affine = scaling(INCH, INCH)

// 선형 부분의 척도(넓이 비의 제곱근). 비균등 척도의 선 굵기는 이 값으로 근사한다.
export function linearScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

const isFiniteAffine = (m: Affine): boolean => m.every(Number.isFinite)

// 캔버스 font 글자(CSS font 줄임 표기)에서 크기·모양·글꼴. size는 사용자 단위(px = 인치). 읽지 못하면 캔버스처럼
// 기본값('10px sans-serif')이다(글자 op마다 save·restore 안에서 정하므로 이전 글꼴이 남지 않는다).
export type DashFont = { style: string; size: number; family: string }

const FONT =
  /^((?:(?:normal|italic|oblique|small-caps|bold|bolder|lighter|[1-9]00|condensed|expanded)\s+)*)([+]?(?:\d+\.?\d*|\.\d+))(px|pt|pc|in|cm|mm|em|rem|%)(?:\s*\/\s*\S+)?\s+(.+)$/i

const FONT_UNITS: Readonly<Record<string, number>> = {
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  // 캔버스의 상대 크기는 기본 글꼴 크기(10px) 기준이다
  em: DEFAULT_FONT_SIZE,
  rem: DEFAULT_FONT_SIZE,
  '%': DEFAULT_FONT_SIZE / 100
}

export function parseDashFont(font: string): DashFont {
  const match = typeof font === 'string' && font.length <= 256 ? FONT.exec(font.trim()) : null
  if (match) {
    const size = Number(match[2]) * FONT_UNITS[match[3].toLowerCase()]
    const family = match[4].trim()
    if (Number.isFinite(size) && size > 0 && family !== '')
      return { style: match[1].trim().replace(/\s+/g, ' '), size, family }
  }
  return { style: '', size: DEFAULT_FONT_SIZE, family: DEFAULT_FONT_FAMILY }
}

// ---- 도형(미터, 필드 좌표) ----

export type OverlayPrimitive =
  // 채운 다각형(점은 x, y 차례)
  | { kind: 'fill'; points: number[]; color: Rgba }
  // 선(점은 x, y 차례). width는 미터.
  | { kind: 'stroke'; points: number[]; closed: boolean; width: number; color: Rgba }
  // 화면 1 px 선(격자). segments는 x1, y1, x2, y2 차례.
  | { kind: 'hairlines'; segments: number[]; color: Rgba }
  // 글자: matrix는 캔버스 글자 틀(기준선 왼쪽 끝 원점, x 오른쪽, y 아래, 단위 = font.size의 단위) → 필드 미터.
  // lineWidth는 strokeText의 선 굵기(글자 틀 단위).
  | {
      kind: 'text'
      text: string
      font: DashFont
      matrix: Affine
      color: Rgba
      stroke: boolean
      lineWidth: number
    }
  // 그림: matrix는 그림 틀 → 필드 미터, rect [x, y, 너비, 높이]는 그림 틀에서 그림 왼쪽 위와 크기(y 아래).
  // path는 TeamCode assets 기준 경로(images/…).
  | {
      kind: 'image'
      path: string
      matrix: Affine
      rect: [number, number, number, number]
      alpha: number
    }

type DrawState = {
  originX: number
  originY: number
  rotation: number
  scaleX: number
  scaleY: number
  user: Affine
  fill: Rgba
  stroke: Rgba
  lineWidth: number
  alpha: number
}

const withAlpha = (color: Rgba, alpha: number): Rgba => ({ ...color, a: color.a * alpha })

function rebuildUser(state: DrawState): void {
  state.user = multiply(
    multiply(translation(state.originX, state.originY), rotation(state.rotation)),
    scaling(state.scaleX, state.scaleY)
  )
}

// 사용자 틀의 점 목록 → 필드 미터 점(x, y 차례). 수가 아닌 점은 캔버스처럼 건너뛴다.
function userPoints(state: DrawState, xs: readonly number[], ys: readonly number[]): number[] {
  const out: number[] = []
  const count = Math.min(xs.length, ys.length)
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue
    const [x, y] = apply(state.user, xs[i], ys[i])
    out.push(x * INCH, y * INCH)
  }
  return out
}

// 글자·그림·격자의 틀 → 필드 미터
function placedFrame(
  state: DrawState,
  op: { x: number; y: number; theta: number; usePageFrame: boolean }
): Affine {
  const base = op.usePageFrame ? PAGE_FRAME : state.user
  let frame = multiply(base, translation(op.x, op.y))
  if (!op.usePageFrame) frame = multiply(frame, scaling(1, -1))
  return multiply(TO_METERS, multiply(frame, rotation(op.theta)))
}

// 원을 몇 조각으로 나눌지(바깥 반지름 미터에 따라, 1 cm 안팎)
function circleSegments(radiusMeters: number): number {
  return Math.min(128, Math.max(24, Math.ceil((2 * Math.PI * radiusMeters) / 0.01)))
}

// Dashboard 기본 필드(TelemetryPacket.DEFAULT_FIELD)의 격자: 페이지 틀 drawGrid(0, 0, 144, 144, 7, 7)
function isDefaultGrid(op: Extract<DashOp, { type: 'grid' }>): boolean {
  return (
    op.usePageFrame &&
    op.x === 0 &&
    op.y === 0 &&
    op.width === 2 * HALF_FIELD_IN &&
    op.height === 2 * HALF_FIELD_IN &&
    op.numTicksX === 7 &&
    op.numTicksY === 7 &&
    op.theta === 0 &&
    op.pivotX === 0 &&
    op.pivotY === 0
  )
}

// op 목록 → 그리는 순서대로의 도형. 캔버스가 받지 않는 값(0 이하 선 굵기, 0–1 밖 alpha, 수가 아닌 값)은 무시한다.
export function interpretDashOps(ops: readonly DashOp[]): OverlayPrimitive[] {
  const state: DrawState = {
    originX: 0,
    originY: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    user: IDENTITY,
    fill: BLACK,
    stroke: BLACK,
    lineWidth: 1,
    alpha: 1
  }
  const out: OverlayPrimitive[] = []
  const strokeWidth = (frame: Affine): number => state.lineWidth * linearScale(frame) * INCH

  for (const op of ops) {
    switch (op.type) {
      case 'scale':
        state.scaleX = op.scaleX
        state.scaleY = op.scaleY
        rebuildUser(state)
        break
      case 'rotation':
        state.rotation = op.rotation
        rebuildUser(state)
        break
      case 'translate':
        state.originX = op.x
        state.originY = op.y
        rebuildUser(state)
        break
      case 'fill': {
        const color = parseCssColor(op.color)
        if (color) state.fill = color
        break
      }
      case 'stroke': {
        const color = parseCssColor(op.color)
        if (color) state.stroke = color
        break
      }
      case 'strokeWidth':
        if (Number.isFinite(op.width) && op.width > 0) state.lineWidth = op.width
        break
      case 'alpha':
        if (Number.isFinite(op.alpha) && op.alpha >= 0 && op.alpha <= 1) state.alpha = op.alpha
        break
      case 'circle': {
        if (!isFiniteAffine(state.user) || !(op.radius > 0) || !Number.isFinite(op.radius)) break
        const n = circleSegments(op.radius * linearScale(state.user) * INCH)
        const xs: number[] = []
        const ys: number[] = []
        for (let i = 0; i < n; i++) {
          const t = (2 * Math.PI * i) / n
          xs.push(op.x + op.radius * Math.cos(t))
          ys.push(op.y + op.radius * Math.sin(t))
        }
        const points = userPoints(state, xs, ys)
        if (points.length < 6) break
        if (op.stroke)
          out.push({
            kind: 'stroke',
            points,
            closed: true,
            width: strokeWidth(state.user),
            color: withAlpha(state.stroke, state.alpha)
          })
        else out.push({ kind: 'fill', points, color: withAlpha(state.fill, state.alpha) })
        break
      }
      case 'polygon': {
        if (!isFiniteAffine(state.user)) break
        const points = userPoints(state, op.xPoints, op.yPoints)
        if (op.stroke) {
          if (points.length >= 4)
            out.push({
              kind: 'stroke',
              points,
              closed: true,
              width: strokeWidth(state.user),
              color: withAlpha(state.stroke, state.alpha)
            })
        } else if (points.length >= 6)
          out.push({ kind: 'fill', points, color: withAlpha(state.fill, state.alpha) })
        break
      }
      case 'polyline': {
        if (!isFiniteAffine(state.user)) break
        const points = userPoints(state, op.xPoints, op.yPoints)
        if (points.length >= 4)
          out.push({
            kind: 'stroke',
            points,
            closed: false,
            width: strokeWidth(state.user),
            color: withAlpha(state.stroke, state.alpha)
          })
        break
      }
      case 'spline': {
        if (!isFiniteAffine(state.user)) break
        const xs: number[] = []
        const ys: number[] = []
        for (let i = 0; i <= SPLINE_SAMPLES; i++) {
          const t = i / SPLINE_SAMPLES
          xs.push((op.ax * t + op.bx) * t ** 4 + op.cx * t ** 3 + op.dx * t * t + op.ex * t + op.fx)
          ys.push((op.ay * t + op.by) * t ** 4 + op.cy * t ** 3 + op.dy * t * t + op.ey * t + op.fy)
        }
        const points = userPoints(state, xs, ys)
        if (points.length >= 4)
          out.push({
            kind: 'stroke',
            points,
            closed: false,
            width: strokeWidth(state.user),
            color: withAlpha(state.stroke, state.alpha)
          })
        break
      }
      case 'text': {
        const matrix = placedFrame(state, op)
        if (!isFiniteAffine(matrix) || op.text === '') break
        out.push({
          kind: 'text',
          text: op.text,
          font: parseDashFont(op.font),
          matrix,
          color: withAlpha(op.stroke ? state.stroke : state.fill, state.alpha),
          stroke: op.stroke,
          lineWidth: state.lineWidth
        })
        break
      }
      case 'image': {
        const path = dashImageAssetPath(op.path)
        // '/dash/…'(기본 필드 그림)와 assets 밖 경로는 그리지 않는다
        if (path === null) break
        const matrix = placedFrame(state, op)
        if (!isFiniteAffine(matrix) || !Number.isFinite(op.width) || !Number.isFinite(op.height))
          break
        out.push({
          kind: 'image',
          path,
          matrix,
          rect: [-op.pivotX, -op.pivotY, op.width, op.height],
          alpha: state.alpha
        })
        break
      }
      case 'grid': {
        if (isDefaultGrid(op)) break
        const matrix = placedFrame(state, op)
        if (!isFiniteAffine(matrix)) break
        const segments: number[] = []
        const push = (x1: number, y1: number, x2: number, y2: number): void => {
          if (![x1, y1, x2, y2].every(Number.isFinite)) return
          segments.push(...apply(matrix, x1, y1), ...apply(matrix, x2, y2))
        }
        // 눈금이 하나면 간격이 무한이라(Field.js) 선이 그려지지 않는다
        const nx = Math.min(Math.max(0, Math.trunc(op.numTicksX)), 1000)
        const ny = Math.min(Math.max(0, Math.trunc(op.numTicksY)), 1000)
        const horizontal = op.width / (nx - 1)
        const vertical = op.height / (ny - 1)
        for (let i = 0; i < nx; i++) {
          const x = -op.pivotX + horizontal * i
          push(x, -op.pivotY, x, -op.pivotY + op.height)
        }
        for (let i = 0; i < ny; i++) {
          const y = -op.pivotY + vertical * i
          push(-op.pivotX, y, -op.pivotX + op.width, y)
        }
        if (segments.length > 0)
          out.push({ kind: 'hairlines', segments, color: withAlpha(GRID_COLOR, state.alpha) })
        break
      }
    }
  }
  return out
}

// ---- 삼각형으로 나누기 ----

// 연속한 채움·선은 꼭짓점 색을 가진 삼각형 묶음 하나(mesh)로, 격자는 선 묶음 하나(lines)로 모은다. 한 묶음 안의
// 삼각형은 버퍼 순서대로 그려지므로(깊이를 쓰지 않음) 캔버스처럼 뒤의 것이 앞의 것 위에 쌓인다. 글자·그림은 따로다.
// positions는 x, y, z 차례(z = OVERLAY_Z), colors는 sRGB 0–1과 alpha(r, g, b, a 차례).
export type OverlayRun =
  | { kind: 'mesh'; positions: Float32Array; colors: Float32Array }
  | { kind: 'lines'; positions: Float32Array; colors: Float32Array }
  | Extract<OverlayPrimitive, { kind: 'text' }>
  | Extract<OverlayPrimitive, { kind: 'image' }>

export class OverlayBuilder {
  positions: number[] = []
  colors: number[] = []

  vertex(x: number, y: number, color: Rgba): void {
    this.positions.push(x, y, OVERLAY_Z)
    this.colors.push(color.r / 255, color.g / 255, color.b / 255, color.a)
  }

  triangle(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    color: Rgba
  ): void {
    this.vertex(ax, ay, color)
    this.vertex(bx, by, color)
    this.vertex(cx, cy, color)
  }

  get empty(): boolean {
    return this.positions.length === 0
  }
}

// 이웃 점이 거의 같은 점은 하나로(길이 0 조각은 방향이 없다)
function distinctPoints(points: readonly number[], closed: boolean): number[] {
  const out: number[] = []
  const same = (i: number, j: number): boolean =>
    Math.abs(points[i] - out[j]) < 1e-9 && Math.abs(points[i + 1] - out[j + 1]) < 1e-9
  for (let i = 0; i + 1 < points.length; i += 2)
    if (out.length === 0 || !same(i, out.length - 2)) out.push(points[i], points[i + 1])
  if (closed && out.length >= 4) {
    const last = out.length - 2
    if (Math.abs(out[0] - out[last]) < 1e-9 && Math.abs(out[1] - out[last + 1]) < 1e-9)
      out.splice(last, 2)
  }
  return out
}

// 두께 있는 선(캔버스 lineJoin 'miter'·miterLimit 10·lineCap 'butt'). 조각마다 띠를 두고, 꺾이는 곳의 바깥은 miter
// (한도를 넘으면 bevel)로 채운다. 안쪽은 두 띠가 만나는 점(안쪽 miter)에서 끝내 겹치지 않게 한다(조각이 너무 짧으면 두
// 띠가 겹친다: 반투명 선은 그 자리만 조금 진하다).
export function strokeTriangles(
  builder: OverlayBuilder,
  rawPoints: readonly number[],
  closed: boolean,
  width: number,
  color: Rgba
): void {
  if (!(width > 0) || !Number.isFinite(width)) return
  const points = distinctPoints(rawPoints, closed)
  const count = points.length / 2
  if (count < 2) return
  const hw = width / 2
  const segmentCount = closed ? count : count - 1
  const px = (i: number): number => points[2 * (((i % count) + count) % count)]
  const py = (i: number): number => points[2 * (((i % count) + count) % count) + 1]
  // 조각 i(점 i → i + 1)의 방향·길이·왼쪽 법선
  const dir: { x: number; y: number; length: number }[] = []
  for (let i = 0; i < segmentCount; i++) {
    const dx = px(i + 1) - px(i)
    const dy = py(i + 1) - py(i)
    const length = Math.hypot(dx, dy)
    dir.push({ x: dx / length, y: dy / length, length })
  }
  // 조각마다 시작·끝의 왼쪽(+법선)·오른쪽 점. 기본은 법선 방향 그대로이고, 꺾이는 곳의 안쪽은 안쪽 miter 점으로 바꾼다.
  const ends = dir.map((d, i) => {
    const nx = -d.y
    const ny = d.x
    const sx = px(i)
    const sy = py(i)
    const ex = px(i + 1)
    const ey = py(i + 1)
    return {
      startLeft: [sx + nx * hw, sy + ny * hw],
      startRight: [sx - nx * hw, sy - ny * hw],
      endLeft: [ex + nx * hw, ey + ny * hw],
      endRight: [ex - nx * hw, ey - ny * hw]
    }
  })
  const joints: { a: number; b: number; vertex: number }[] = []
  for (let i = 0; i < segmentCount - 1; i++) joints.push({ a: i, b: i + 1, vertex: i + 1 })
  if (closed && segmentCount >= 2) joints.push({ a: segmentCount - 1, b: 0, vertex: 0 })

  const joinFills: (() => void)[] = []
  for (const { a, b, vertex } of joints) {
    const da = dir[a]
    const db = dir[b]
    const cross = da.x * db.y - da.y * db.x
    const dot = da.x * db.x + da.y * db.y
    if (Math.abs(cross) < 1e-12 && dot > 0) continue
    const x = px(vertex)
    const y = py(vertex)
    // 왼쪽으로 꺾이면(cross > 0) 안쪽이 왼쪽이다
    const inner = cross > 0 ? 1 : -1
    const outer = -inner
    const nax = -da.y
    const nay = da.x
    const nbx = -db.y
    const nby = db.x
    // 꺾인 각의 반(α/2)의 cos = 두 법선의 반각
    let mx = nax + nbx
    let my = nay + nby
    const ml = Math.hypot(mx, my)
    const halfCos = ml / 2
    if (ml > 1e-12) {
      mx /= ml
      my /= ml
    }
    const tanHalf =
      halfCos > 1e-12 ? Math.sqrt(Math.max(0, 1 - halfCos * halfCos)) / halfCos : Infinity
    let pivotX = x
    let pivotY = y
    // 안쪽 miter 점이 두 조각 안에 있으면 두 띠를 그 점에서 끝낸다
    if (hw * tanHalf <= Math.min(da.length, db.length) && ml > 1e-12) {
      pivotX = x + inner * mx * (hw / halfCos)
      pivotY = y + inner * my * (hw / halfCos)
      const point = [pivotX, pivotY]
      if (inner > 0) {
        ends[a].endLeft = point
        ends[b].startLeft = point
      } else {
        ends[a].endRight = point
        ends[b].startRight = point
      }
    }
    const ax = x + outer * nax * hw
    const ay = y + outer * nay * hw
    const bx = x + outer * nbx * hw
    const by = y + outer * nby * hw
    const ratio = halfCos > 1e-12 ? 1 / halfCos : Infinity
    joinFills.push(() => {
      if (ratio <= MITER_LIMIT && ml > 1e-12) {
        const tipX = x + outer * mx * hw * ratio
        const tipY = y + outer * my * hw * ratio
        builder.triangle(pivotX, pivotY, ax, ay, tipX, tipY, color)
        builder.triangle(pivotX, pivotY, tipX, tipY, bx, by, color)
      } else builder.triangle(pivotX, pivotY, ax, ay, bx, by, color)
    })
  }
  for (const end of ends) {
    const [slx, sly] = end.startLeft
    const [srx, sry] = end.startRight
    const [elx, ely] = end.endLeft
    const [erx, ery] = end.endRight
    builder.triangle(slx, sly, srx, sry, erx, ery, color)
    builder.triangle(slx, sly, erx, ery, elx, ely, color)
  }
  for (const fill of joinFills) fill()
}

// 채운 다각형(캔버스 nonzero 규칙과 같은 것은 단순 다각형까지. 스스로 겹치는 다각형은 다를 수 있다)
export function fillTriangles(
  builder: OverlayBuilder,
  rawPoints: readonly number[],
  color: Rgba
): void {
  const points = distinctPoints(rawPoints, true)
  if (points.length < 6) return
  const contour: Vector2[] = []
  for (let i = 0; i < points.length; i += 2) contour.push(new Vector2(points[i], points[i + 1]))
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, []))
    builder.triangle(
      contour[a].x,
      contour[a].y,
      contour[b].x,
      contour[b].y,
      contour[c].x,
      contour[c].y,
      color
    )
}

export function tessellateOverlay(primitives: readonly OverlayPrimitive[]): OverlayRun[] {
  const runs: OverlayRun[] = []
  // 지금 모으는 묶음(삼각형 또는 선)
  let open: { kind: 'mesh' | 'lines'; builder: OverlayBuilder } | null = null
  const flush = (): void => {
    if (open && !open.builder.empty)
      runs.push({
        kind: open.kind,
        positions: Float32Array.from(open.builder.positions),
        colors: Float32Array.from(open.builder.colors)
      })
    open = null
  }
  const builderFor = (kind: 'mesh' | 'lines'): OverlayBuilder => {
    if (open?.kind !== kind) {
      flush()
      open = { kind, builder: new OverlayBuilder() }
    }
    return open.builder
  }
  for (const primitive of primitives) {
    switch (primitive.kind) {
      case 'fill':
        fillTriangles(builderFor('mesh'), primitive.points, primitive.color)
        break
      case 'stroke':
        strokeTriangles(
          builderFor('mesh'),
          primitive.points,
          primitive.closed,
          primitive.width,
          primitive.color
        )
        break
      case 'hairlines': {
        const builder = builderFor('lines')
        const { segments, color } = primitive
        for (let i = 0; i + 3 < segments.length; i += 4) {
          builder.vertex(segments[i], segments[i + 1], color)
          builder.vertex(segments[i + 2], segments[i + 3], color)
        }
        break
      }
      default:
        flush()
        runs.push(primitive)
    }
  }
  flush()
  return runs
}
