import { Group } from 'three'
import { describe, expect, it } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { OpModeInfo } from '../../../../shared/play'
import { quantizeElements } from '../../../../shared/sim/elements/gameState'
import { newRun, type PlayData, type PlayRun, type SimGameState } from '../../play/playStore'
import {
  bindHiveDisplay,
  HIVE_ANGLE_EPSILON,
  hiveBodyShownOverCad,
  hiveGhostAngle,
  hiveMotionBound,
  simHiveAngle,
  type HiveDisplayTarget
} from './hiveDisplay'

// 6b(spec-6b §8): 실행 중 HIVE 움직임 그룹을 시뮬레이터 각에 묶기(React 렌더 없이), companion HIVE 몸체 보이기, 잔상 각

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

type HiveState = Pick<PlayData, 'run' | 'simGame'>

const START = -Math.PI / 6
const TIPPED = Math.PI / 6

function run(patch: Partial<PlayRun> = {}, gameElements = true): PlayRun {
  return {
    ...newRun({
      runId: 'r1',
      root: '/p',
      opMode: OP_MODE,
      robotId: 'bot',
      configPath: null,
      speed: 1,
      paused: false,
      field: { season: 'biobuzz', hiveTipped: [false, false], gameElements },
      elements: { kinds: ['pollen'], spawns: [] }
    }),
    phase: 'running',
    ...patch
  }
}

function game(hives: number[] | null, runId = 'r1'): SimGameState {
  const q = quantizeElements([])
  return {
    runId,
    tNanos: 0,
    revision: 1,
    poses: q.poses,
    flags: q.flags,
    ...(hives ? { hives, hiveTips: hives.map(() => 0) } : {})
  }
}

function source(state: HiveState): StoreApi<HiveState> {
  return createStore<HiveState>()(() => state)
}

function target(patch: Partial<HiveDisplayTarget> = {}): HiveDisplayTarget {
  return {
    motion: new Group(),
    body: null,
    index: 0,
    modelAngle: START,
    startAngle: START,
    ...patch
  }
}

describe('hiveMotionBound·simHiveAngle', () => {
  it('필드를 잠근 실행이 경기 요소를 켰을 때만 묶는다', () => {
    expect(hiveMotionBound({ run: run() })).toBe(true)
    expect(hiveMotionBound({ run: run({}, false) })).toBe(false)
    expect(hiveMotionBound({ run: run({ detached: true }) })).toBe(false)
    expect(hiveMotionBound({ run: run({ phase: 'finished' }) })).toBe(false)
    expect(hiveMotionBound({ run: null })).toBe(false)
  })

  it('지금 실행의 표시 상태의 HIVE 칸(1e-4 rad 정수)만 각이다', () => {
    const state = { run: run(), simGame: game([-5236, 5236]) }
    expect(simHiveAngle(state, 0)).toBe(-0.5236)
    expect(simHiveAngle(state, 1)).toBe(0.5236)
    expect(simHiveAngle(state, 2)).toBeNull()
    expect(simHiveAngle({ ...state, simGame: game(null) }, 0)).toBeNull()
    expect(simHiveAngle({ ...state, simGame: game([1], 'old') }, 0)).toBeNull()
    expect(simHiveAngle({ ...state, run: run({ detached: true }) }, 0)).toBeNull()
  })
})

describe('bindHiveDisplay', () => {
  it('붙자마자 θ_sim − θ_model을 쓰고, 각이 바뀔 때만 적용·다시 그리기, 떼면 0으로 되돌린다', () => {
    const store = source({ run: run(), simGame: game([-5236]) })
    const t = target()
    let draws = 0
    const unbind = bindHiveDisplay(t, store, () => draws++)
    expect(t.motion.rotation.y).toBeCloseTo(-0.5236 - START, 12)
    expect(Math.abs(t.motion.rotation.y)).toBeLessThan(HIVE_ANGLE_EPSILON)
    expect(draws).toBe(1)
    store.setState({ simGame: game([0]) })
    expect(t.motion.rotation.y).toBeCloseTo(-START, 12)
    expect(draws).toBe(2)
    // 같은 각의 새 상태(공만 움직임)는 다시 그리지 않는다
    store.setState({ simGame: { ...game([0]), revision: 2 } })
    expect(draws).toBe(2)
    // 다른 실행의 상태는 각이 없다(모델 각)
    store.setState({ simGame: game([5236], 'old') })
    expect(t.motion.rotation.y).toBe(0)
    expect(draws).toBe(3)
    store.setState({ simGame: game([5236]) })
    expect(t.motion.rotation.y).toBeCloseTo(0.5236 - START, 12)
    unbind()
    expect(t.motion.rotation.y).toBe(0)
    expect(draws).toBe(5)
    // 뗀 뒤에는 따르지 않는다
    store.setState({ simGame: game([0]) })
    expect(t.motion.rotation.y).toBe(0)
  })

  it('StrictMode처럼 떼고 다시 붙여도 같은 각에서 시작한다', () => {
    const store = source({ run: run(), simGame: game([1000]) })
    const t = target()
    bindHiveDisplay(t, store, () => {})()
    const again = bindHiveDisplay(t, store, () => {})
    expect(t.motion.rotation.y).toBeCloseTo(0.1 - START, 12)
    again()
  })

  it('source가 없으면(묶지 않음) 모델 각이고, companion 몸체는 모델 각이 넘어가지 않은 각이 아닐 때만 보인다', () => {
    const body = new Group()
    const untipped = target({ body })
    const unbind = bindHiveDisplay(untipped, null, () => {})
    expect(untipped.motion.rotation.y).toBe(0)
    expect(body.visible).toBe(false)
    unbind()
    const tipped = target({ body, modelAngle: TIPPED })
    bindHiveDisplay(tipped, null, () => {})
    expect(body.visible).toBe(true)
  })

  it('companion 몸체: 시뮬레이터 각이 넘어가지 않은 각에서 1e-4 rad 넘게 벗어나면 보이고, 떼면 모델 각 규칙으로', () => {
    const body = new Group()
    const store = source({ run: run(), simGame: game([-5236]) })
    const t = target({ body })
    const unbind = bindHiveDisplay(t, store, () => {})
    // 정수 각(−0.5236)과 −π/6의 차는 1.2e-6 rad: 넘어가지 않은 자세로 본다
    expect(body.visible).toBe(false)
    store.setState({ simGame: game([-5230]) })
    expect(body.visible).toBe(true)
    store.setState({ simGame: game([-5235]) })
    expect(body.visible).toBe(false)
    store.setState({ simGame: game([5236]) })
    expect(body.visible).toBe(true)
    unbind()
    expect(body.visible).toBe(false)
  })
})

describe('hiveBodyShownOverCad·hiveGhostAngle', () => {
  it('넘어가지 않은 각과의 차가 HIVE_ANGLE_EPSILON을 넘을 때만', () => {
    expect(hiveBodyShownOverCad(START, START)).toBe(false)
    expect(hiveBodyShownOverCad(START + HIVE_ANGLE_EPSILON, START)).toBe(false)
    expect(hiveBodyShownOverCad(START + 2 * HIVE_ANGLE_EPSILON, START)).toBe(true)
    expect(hiveBodyShownOverCad(TIPPED, START)).toBe(true)
  })

  it('잔상 각은 끝난 각이 보이는 모델 각과 다를 때만(같으면·칸이 없으면 null)', () => {
    expect(hiveGhostAngle([5236, -5236], 0, START)).toBe(0.5236)
    expect(hiveGhostAngle([5236, -5236], 1, START)).toBeNull()
    expect(hiveGhostAngle([5236, -5236], 0, TIPPED)).toBeNull()
    expect(hiveGhostAngle(undefined, 0, START)).toBeNull()
    expect(hiveGhostAngle([5236], 1, START)).toBeNull()
  })
})
