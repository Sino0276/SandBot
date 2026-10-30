import { describe, expect, it } from 'vitest'
import {
  MAX_DASH_CONFIG_DEPTH,
  MAX_DASH_CONFIG_NODES,
  MAX_DASH_DATA,
  MAX_DASH_LOG_LINES,
  MAX_DASH_OPS,
  MAX_DASH_POINTS,
  MAX_DASH_TEXT,
  type DashConfigNode,
  type DashOp
} from '../../shared/dashboard'
import { parseSidecarLine, ProtocolError } from './protocol'

// 사이드카 메시지 읽기 중 FTC Dashboard(dash·dashConfig)와 사이드카 안내(notice). 나머지는 session.test.ts가 세션과 함께 본다.

const parse = (message: Record<string, unknown>): unknown =>
  parseSidecarLine(JSON.stringify(message))

function rejects(message: Record<string, unknown>, what: string): void {
  expect(() => parse(message)).toThrow(ProtocolError)
  expect(() => parse(message)).toThrow(what)
}

// 와이어 모양 그대로(실제 Dashboard Gson 직렬화의 필드 이름, src/shared/dashboard.ts)
const ALL_OPS: DashOp[] = [
  { type: 'circle', x: 1, y: 2, radius: 3, stroke: true },
  { type: 'polygon', xPoints: [0, 1, 1], yPoints: [0, 0, 1], stroke: false },
  { type: 'polyline', xPoints: [0, 60], yPoints: [0, 60] },
  {
    type: 'spline',
    ax: 1,
    bx: 2,
    cx: 3,
    dx: 4,
    ex: 5,
    fx: 6,
    ay: -1,
    by: -2,
    cy: -3,
    dy: -4,
    ey: -5,
    fy: -6
  },
  {
    type: 'text',
    text: '안녕',
    x: 1,
    y: 2,
    font: '8px Arial',
    theta: -0.5,
    stroke: false,
    usePageFrame: true
  },
  {
    type: 'image',
    path: '/images/a.png',
    x: 0,
    y: 0,
    width: 144,
    height: 144,
    theta: 0,
    pivotX: 0,
    pivotY: 0,
    usePageFrame: true
  },
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
  },
  { type: 'translate', x: 1, y: 2 },
  { type: 'rotation', rotation: 1.5 },
  { type: 'scale', scaleX: 2, scaleY: -2 },
  { type: 'fill', color: '#4CAF507A' },
  { type: 'stroke', color: 'goldenrod' },
  { type: 'strokeWidth', width: 1 },
  { type: 'alpha', alpha: 0.4 }
]

const dash = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'dash',
  tNanos: 5_000_000,
  cleared: false,
  data: [['x', '1.0']],
  log: ['step 1'],
  ops: ALL_OPS,
  ...patch
})

describe('사이드카 메시지: dash', () => {
  it('op 종류마다 와이어 모양 그대로 읽는다(log·ops는 null일 수 있다)', () => {
    expect(parse(dash())).toEqual({
      type: 'dash',
      tNanos: 5_000_000,
      cleared: false,
      data: [['x', '1.0']],
      log: ['step 1'],
      ops: ALL_OPS
    })
    expect(parse(dash({ cleared: true, data: [], log: null, ops: null }))).toEqual({
      type: 'dash',
      tNanos: 5_000_000,
      cleared: true,
      data: [],
      log: null,
      ops: null
    })
  })

  it('op 모양이 틀리면 프로토콜 오류: 모르는 종류, 빠진 필드, 무한대, 정수가 아닌 굵기, 점이 수가 아님', () => {
    rejects(dash({ ops: [{ type: 'arc', x: 1 }] }), 'dash.ops')
    rejects(dash({ ops: [{ type: 'toString' }] }), 'dash.ops')
    rejects(dash({ ops: [{ type: 'circle', x: 1, y: 2, stroke: true }] }), 'dash.op.circle.radius')
    // JSON에는 NaN이 없고 1e999는 Infinity로 읽힌다
    expect(() =>
      parseSidecarLine(
        '{"type":"dash","tNanos":0,"cleared":false,"data":[],"log":null,"ops":[{"type":"alpha","alpha":1e999}]}'
      )
    ).toThrow('dash.op.alpha.alpha')
    rejects(dash({ ops: [{ type: 'strokeWidth', width: 1.5 }] }), 'dash.op.strokeWidth.width')
    rejects(
      dash({ ops: [{ type: 'polyline', xPoints: [0, '1'], yPoints: [0, 1] }] }),
      'dash.op.polyline.xPoints'
    )
    rejects(
      dash({ ops: [{ type: 'fill', color: 'x'.repeat(MAX_DASH_TEXT + 1) }] }),
      'dash.op.fill.color'
    )
    rejects(dash({ cleared: 'yes' }), 'dash.cleared')
  })

  it('한도: op 수, 점 수(다각형·선의 합), data 키 수, 글자 수, 로그 줄 수', () => {
    const circle = { type: 'circle', x: 0, y: 0, radius: 1, stroke: true }
    expect(() => parse(dash({ ops: Array(MAX_DASH_OPS).fill(circle) }))).not.toThrow()
    rejects(dash({ ops: Array(MAX_DASH_OPS + 1).fill(circle) }), 'dash.ops')
    const line = (n: number): Record<string, unknown> => ({
      type: 'polyline',
      xPoints: Array(n).fill(0),
      yPoints: Array(n).fill(0)
    })
    const half = MAX_DASH_POINTS / 2
    expect(() => parse(dash({ ops: [line(half), line(half)] }))).not.toThrow()
    rejects(dash({ ops: [line(half), line(half + 1)] }), 'dash.ops')

    const data = (n: number): [string, string][] =>
      Array.from({ length: n }, (_, i): [string, string] => [`k${i}`, String(i)])
    expect(() => parse(dash({ data: data(MAX_DASH_DATA) }))).not.toThrow()
    rejects(dash({ data: data(MAX_DASH_DATA + 1) }), 'dash.data')
    rejects(dash({ data: [['k', 'v'.repeat(MAX_DASH_TEXT + 1)]] }), 'dash.data')
    rejects(dash({ data: [['k', 1]] }), 'dash.data')
    rejects(dash({ data: [['k', 'v', 'w']] }), 'dash.data')

    expect(() => parse(dash({ log: Array(MAX_DASH_LOG_LINES).fill('l') }))).not.toThrow()
    rejects(dash({ log: Array(MAX_DASH_LOG_LINES + 1).fill('l') }), 'dash.log')
    rejects(dash({ log: [null] }), 'dash.log')
  })
})

describe('사이드카 메시지: dashConfig', () => {
  const leaf = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
    kind: 'value',
    type: 'enum',
    value: 'FAST',
    enumValues: ['SLOW', 'FAST'],
    source: { declaringClass: 'org.firstinspires.ftc.teamcode.Drive$Params', field: 'mode' },
    ...patch
  })
  const config = (root: unknown): Record<string, unknown> => ({
    type: 'dashConfig',
    tNanos: 0,
    root
  })
  // 깊이 depth의 묶음 사슬(맨 아래에 값)
  const chain = (depth: number): Record<string, unknown> => {
    let node: Record<string, unknown> = leaf()
    for (let i = 0; i < depth; i++) node = { kind: 'custom', children: [{ name: `n${i}`, node }] }
    return node
  }

  it('트리(묶음·값, 형식, enum 상수, source)를 읽는다', () => {
    const root: DashConfigNode = {
      kind: 'custom',
      children: [
        {
          name: 'Drive',
          node: {
            kind: 'custom',
            children: [
              {
                name: 'mode',
                node: {
                  kind: 'value',
                  type: 'enum',
                  value: 'FAST',
                  enumValues: ['SLOW', 'FAST'],
                  source: {
                    declaringClass: 'org.firstinspires.ftc.teamcode.Drive$Params',
                    field: 'mode'
                  }
                }
              },
              {
                name: 'scale',
                node: {
                  kind: 'value',
                  type: 'readonlyString',
                  value: 'null',
                  enumValues: [],
                  source: null
                }
              }
            ]
          }
        }
      ]
    }
    expect(parse(config(root))).toEqual({ type: 'dashConfig', tNanos: 0, root })
  })

  it('한도와 모양: 깊이, 노드 수, 형식, source', () => {
    // 루트 깊이 0, 값은 깊이 MAX_DASH_CONFIG_DEPTH까지
    expect(() => parse(config(chain(MAX_DASH_CONFIG_DEPTH)))).not.toThrow()
    rejects(config(chain(MAX_DASH_CONFIG_DEPTH + 1)), 'dashConfig.root')
    const wide = (n: number): Record<string, unknown> => ({
      kind: 'custom',
      children: Array.from({ length: n }, (_, i) => ({ name: `v${i}`, node: leaf() }))
    })
    expect(() => parse(config(wide(MAX_DASH_CONFIG_NODES)))).not.toThrow()
    rejects(config(wide(MAX_DASH_CONFIG_NODES + 1)), 'dashConfig.root')
    // 트리 전체로 센다
    rejects(
      config({
        kind: 'custom',
        children: [
          { name: 'a', node: wide(MAX_DASH_CONFIG_NODES / 2) },
          { name: 'b', node: wide(MAX_DASH_CONFIG_NODES / 2) }
        ]
      }),
      'dashConfig.root'
    )
    rejects(
      config({ kind: 'custom', children: [{ name: 1, node: leaf() }] }),
      'dashConfig.child.name'
    )
    rejects(config(leaf({ type: 'custom' })), 'dashConfig.node.type')
    rejects(config(leaf({ kind: 'other' })), 'dashConfig.node.kind')
    rejects(config(leaf({ value: 1 })), 'dashConfig.node.value')
    rejects(config(leaf({ enumValues: [1] })), 'dashConfig.node.enumValues')
    rejects(config(leaf({ source: { declaringClass: 'a' } })), 'dashConfig.source.field')
    rejects(config(leaf({ source: 'a#b' })), 'dashConfig.source')
    rejects(config({ kind: 'custom' }), 'dashConfig.node.children')
  })
})

describe('사이드카 메시지: notice', () => {
  it('안내 code와 글자 매개변수', () => {
    expect(parse({ type: 'notice', tNanos: 7, code: 'dashCamera', params: {} })).toEqual({
      type: 'notice',
      tNanos: 7,
      code: 'dashCamera',
      params: {}
    })
    expect(
      parse({
        type: 'notice',
        tNanos: 7,
        code: 'rrTuningSaved',
        params: { path: 'RoadRunner/tuning/accel/1.json' }
      })
    ).toEqual({
      type: 'notice',
      tNanos: 7,
      code: 'rrTuningSaved',
      params: { path: 'RoadRunner/tuning/accel/1.json' }
    })
    rejects({ type: 'notice', tNanos: 7, code: 'other', params: {} }, 'notice.code')
    rejects({ type: 'notice', tNanos: 7, code: 'dashImage', params: { a: 1 } }, 'notice.params')
    rejects({ type: 'notice', tNanos: 7, code: 'dashImage', params: [] }, 'notice.params')
    rejects(
      {
        type: 'notice',
        tNanos: 7,
        code: 'dashImage',
        params: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, 'v']))
      },
      'notice.params'
    )
  })
})
