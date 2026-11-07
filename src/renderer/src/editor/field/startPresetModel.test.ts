import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { placeFootprint } from '../../../../shared/sim/seasons/fieldGeometry'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import {
  matchingPreset,
  presetRect,
  presetTarget,
  snapRobotToStart
} from '../../../../shared/sim/seasons/startPose'
import { newRun, usePlayStore } from '../../play/playStore'
import { robotOutline } from '../../play/worldSpec'
import type { SceneObject, SceneObjects, Vec3 } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { markHandleInteraction, useEditorStore } from '../editorStore'
import { beginChange, endChange } from '../history'
import { resetSceneVisibility } from '../sceneVisibility'
import {
  handleStartMarkerClick,
  presetAt,
  presetSeason,
  snapRobotToPreset,
  startPresetModel,
  startTargetRobotId,
  type StartMarkerClick
} from './startPresetModel'

// C7·C8·C13(spec-4ab §1.7·§1.9): 로봇 인스펙터 "시작 위치"와 씬 뷰 시작 표시의 모델·쓰기·클릭 규칙

const BIOBUZZ = resolveSeason('biobuzz')
const INNER = BIOBUZZ.perimeter.innerHalf

function node(
  id: string,
  kind: SceneObject['kind'],
  parentId: string | null,
  position: Vec3 = [0, 0, 0],
  yaw = 0,
  extra: Partial<SceneObject> = {}
): SceneObject {
  return {
    id,
    name: id,
    kind,
    parentId,
    transform: { position, rotation: [0, 0, yaw] },
    ...extra
  }
}

// bot: CAD 없는 18 in 로봇(외곽 ±9 in, 높이 18 in), part: 그 하위 파트
// wide: CAD 경계 0.8 × 0.7 m(로봇 X × Y) 로봇
const SCENE: SceneObjects = {
  bot: node('bot', 'robot', null, [0, 0, 0]),
  part: node('part', 'part', 'bot', [0.1, 0, 0.1]),
  wide: node('wide', 'robot', null, [0.5, 0.5, 0]),
  wideCad: node('wideCad', 'assembly', 'wide', [0, 0, 0], 0, {
    cad: {
      fileName: 'wide.step',
      absolutePath: '/cad/wide.step',
      upAxis: '+Z',
      forwardAxis: '+X',
      bounds: { min: [-0.4, -0.35, 0], max: [0.4, 0.35, 0.3] },
      meshCount: 0,
      meshIndexing: 'source'
    }
  })
}

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Drive',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Drive.java',
  line: 1,
  flavor: 'TeleOp',
  name: 'Drive',
  group: '',
  preselectTeleOp: ''
}

const scene = (): ReturnType<typeof useSceneStore.getState> => useSceneStore.getState()
const pose = (id: string): { x: number; y: number; yaw: number } => {
  const { position, rotation } = scene().objects[id].transform
  return { x: position[0], y: position[1], yaw: rotation[2] }
}

// 씬 문서 변경 횟수(setLocalTransform 한 번 = 실행 취소 한 단계)
let writes = 0
let unsubscribe: () => void = () => {}

beforeEach(() => {
  useSceneStore.setState({ objects: SCENE, field: { season: 'biobuzz' } })
  useEditorStore.getState().select('bot')
  usePlayStore.setState({ run: null })
  resetSceneVisibility()
  writes = 0
  unsubscribe = useSceneStore.subscribe((state, previous) => {
    if (state.objects !== previous.objects) writes++
  })
})

afterEach(() => {
  unsubscribe()
})

describe('시작 위치 고르기(C7)', () => {
  it('프리셋을 고르면 setLocalTransform 한 번이고 외곽이 벽에 간격 0으로 닿는다', () => {
    expect(snapRobotToPreset('bot', 'redWallCenter', 'default')).toBe(true)
    expect(writes).toBe(1)
    const now = pose('bot')
    expect(now.yaw).toBeCloseTo(Math.PI / 2, 15)
    const placed = placeFootprint(robotOutline(scene().objects, 'bot').footprint, now)
    expect(Math.min(...placed.map((p) => p.y))).toBeCloseTo(-INNER, 12)
    // 지금 값이 matchingPreset
    const model = startPresetModel(scene().objects, 'bot', scene().field, 'default')!
    expect(model.match).toEqual({ key: 'redWallCenter', facing: 'default' })
    // 같은 자세면 단계를 만들지 않는다
    expect(snapRobotToPreset('bot', 'redWallCenter', 'default')).toBe(false)
    expect(writes).toBe(1)
  })

  it('요 30° 로봇에 고르면 요가 프리셋 요가 되고 target은 §1.7 정의대로', () => {
    const preset = BIOBUZZ.startPresets.find((candidate) => candidate.key === 'redWallCenter')!
    // 사각형 밖(요 30°로 깊이를 넘음): 구간 가운데
    useSceneStore.setState({
      objects: { ...SCENE, bot: node('bot', 'robot', null, [0.1, -1.5, 0], Math.PI / 6) }
    })
    const { footprint } = robotOutline(scene().objects, 'bot')
    expect(presetTarget(preset, INNER, footprint, pose('bot'))).toBeUndefined()
    snapRobotToPreset('bot', 'redWallCenter', 'default')
    const middle = snapRobotToStart(footprint, preset, INNER, undefined, 'default')
    expect(middle.ok && pose('bot')).toEqual(middle.ok && middle.pose)
    expect(pose('bot').yaw).toBeCloseTo(Math.PI / 2, 15)
    // 사각형 안(깊이가 18 in라 벽에 붙어 있을 때만): 지금 외곽 중심의 벽 방향 좌표(구간에 잘림)
    useSceneStore.setState({
      objects: { ...SCENE, bot: node('bot', 'robot', null, [0.2, -INNER + 0.2286, 0], 0) }
    })
    const target = presetTarget(preset, INNER, footprint, pose('bot'))
    expect(target).toBeCloseTo(0.2, 12)
    snapRobotToPreset('bot', 'redWallCenter', 'default')
    const kept = snapRobotToStart(footprint, preset, INNER, target, 'default')
    expect(kept.ok && pose('bot')).toEqual(kept.ok && kept.pose)
  })

  it('면 바꾸기: 같은 프리셋을 그 면으로 다시 스냅한다', () => {
    snapRobotToPreset('bot', 'redWallCenter', 'default')
    snapRobotToPreset('bot', 'redWallCenter', 'reverse')
    expect(pose('bot').yaw).toBeCloseTo(-Math.PI / 2, 15)
    const model = startPresetModel(scene().objects, 'bot', scene().field, 'default')!
    expect(model.match).toEqual({ key: 'redWallCenter', facing: 'reverse' })
    expect(model.facing).toBe('reverse')
    expect(writes).toBe(2)
  })

  it('너무 넓거나 충돌하는 프리셋은 비활성이고 이유를 모은다', () => {
    const model = startPresetModel(scene().objects, 'wide', scene().field, 'default')!
    const disabled = Object.fromEntries(
      model.options.map((option) => [option.preset.key, option.disabled])
    )
    // 빨강 벽 기본 요 π/2: 벽 방향 폭 = 로봇 Y 0.7 m > 득점 쪽 구간 0.59896 m
    expect(disabled.redWallScoring).toBe('tooWide')
    expect(disabled.redWallAudience).toBeNull()
    // 득점 쪽 벽 모서리: 깊이 0.8 m가 빨강 LOADING ZONE에 걸린다
    expect(disabled.scoringWallCorner).toBe('conflict')
    const wide = model.options.filter((option) => option.disabled === 'tooWide')
    const available = wide.map((option) => (option.snap.ok ? 0 : option.snap.available))
    expect(model.tooWide).toMatchObject({ count: wide.length, available: Math.max(...available) })
    expect(model.conflict!.count).toBe(
      model.options.filter((option) => option.disabled === 'conflict').length
    )
    expect(model.conflict!.conflicts).toContainEqual({ kind: 'zone', index: 0 })
    expect(model.size.width).toBeCloseTo(0.8, 12)
    expect(model.size.depth).toBeCloseTo(0.7, 12)
    expect(model.oversize).toBe(true)
    // 높이: CAD 루트 피벗(경계 중심) 기준 꼭짓점 z의 최대값
    expect(model.height).toBeCloseTo(0.15, 12)
    // 비활성 프리셋으로는 쓰지 않는다(tooWide)
    expect(snapRobotToPreset('wide', 'redWallScoring', 'default')).toBe(false)
    // 18 in 로봇은 넘지 않는다
    expect(startPresetModel(scene().objects, 'bot', scene().field, 'default')!.oversize).toBe(false)
  })

  it("'none'·모르는 시즌은 프리셋이 없다", () => {
    expect(presetSeason({ season: 'none' })).toBeNull()
    expect(presetSeason({ season: 'decode2027' })).toBeNull()
    expect(startPresetModel(SCENE, 'bot', { season: 'none' }, 'default')).toBeNull()
    useSceneStore.setState({ field: { season: 'none' } })
    expect(snapRobotToPreset('bot', 'redWallCenter', 'default')).toBe(false)
    expect(writes).toBe(0)
  })
})

function click(
  point: { x: number; y: number },
  patch: Partial<StartMarkerClick> = {}
): { result: boolean; stopped: number } {
  const stopPropagation = vi.fn()
  const result = handleStartMarkerClick({
    delta: 0,
    altKey: false,
    point,
    stopPropagation,
    ...patch
  })
  return { result, stopped: stopPropagation.mock.calls.length }
}

// 빨강 벽 가운데 표시 안의 점
const CENTER_POINT = { x: 0.3, y: -1.6 }

describe('시작 표시(C8)', () => {
  it('대상 로봇은 활성 오브젝트의 로봇이다(하위 파트가 활성이어도)', () => {
    expect(startTargetRobotId(SCENE, 'part')).toBe('bot')
    expect(startTargetRobotId(SCENE, null)).toBeNull()
    expect(startTargetRobotId(SCENE, 'missing')).toBeNull()
  })

  it('누른 점의 벽 방향 좌표로 그 로봇을 스냅하고 선택은 그대로', () => {
    useEditorStore.getState().select('part')
    const { result, stopped } = click(CENTER_POINT)
    expect(result).toBe(true)
    expect(stopped).toBe(1)
    expect(writes).toBe(1)
    const preset = BIOBUZZ.startPresets.find((candidate) => candidate.key === 'redWallCenter')!
    const expected = snapRobotToStart(
      robotOutline(scene().objects, 'bot').footprint,
      preset,
      INNER,
      CENTER_POINT.x,
      'default'
    )
    expect(expected.ok && pose('bot')).toEqual(expected.ok && expected.pose)
    expect(useEditorStore.getState().selectedIds).toEqual(['part'])
  })

  it('Field만 골랐으면 누를 수 없지만 선택을 풀지 않는다', () => {
    useEditorStore.getState().selectField()
    const { result, stopped } = click(CENTER_POINT)
    expect(result).toBe(false)
    expect(stopped).toBe(1)
    expect(useEditorStore.getState().fieldSelected).toBe(true)
    expect(writes).toBe(0)
  })

  it('실행이 필드를 잠그면 누를 수 없다', () => {
    usePlayStore.setState({
      run: {
        ...newRun({
          runId: 'r',
          root: '/p',
          opMode: OP_MODE,
          robotId: 'bot',
          configPath: null,
          speed: 1,
          paused: false
        }),
        phase: 'running'
      }
    })
    expect(click(CENTER_POINT).result).toBe(false)
    expect(writes).toBe(0)
  })
})

describe('시작 표시 클릭 규칙(C13)', () => {
  it('끈 클릭·Alt·핸들 직후·핸들 드래그 중이면 스냅하지 않고, 늘 전파를 막는다', () => {
    expect(click(CENTER_POINT, { delta: 3 })).toEqual({ result: false, stopped: 1 })
    expect(click(CENTER_POINT, { altKey: true })).toEqual({ result: false, stopped: 1 })
    beginChange()
    try {
      expect(click(CENTER_POINT)).toEqual({ result: false, stopped: 1 })
    } finally {
      endChange()
    }
    markHandleInteraction()
    expect(click(CENTER_POINT)).toEqual({ result: false, stopped: 1 })
    expect(writes).toBe(0)
  })

  it('흐린 표시를 누르면 스냅하지 않고 선택도 그대로다', () => {
    useEditorStore.getState().select('wideCad')
    const scoring = presetRect(
      BIOBUZZ.startPresets.find((candidate) => candidate.key === 'redWallScoring')!,
      INNER
    )
    // redWallScoring 안이고 scoringWallCorner 밖인 점
    const point = { x: (scoring[0] + scoring[2]) / 2 + 0.2, y: -1.4 }
    expect(presetAt(BIOBUZZ, point)!.key).toBe('redWallScoring')
    vi.useFakeTimers({ toFake: ['performance'] })
    try {
      vi.advanceTimersByTime(1000)
      expect(click(point)).toEqual({ result: false, stopped: 1 })
      expect(writes).toBe(0)
      // 같은 조건에서 흐리지 않은 표시(빨강 벽 관중석 쪽)는 스냅한다
      expect(click({ x: 1.2, y: -1.6 }).result).toBe(true)
      expect(writes).toBe(1)
      useSceneStore.setState({ objects: SCENE })
      writes = 0
    } finally {
      vi.useRealTimers()
    }
    expect(useEditorStore.getState().selectedIds).toEqual(['wideCad'])
    expect(writes).toBe(0)
  })

  it('겹친 두 표시는 배열 앞의 프리셋이다', () => {
    // redWallScoring ∩ scoringWallCorner = [−1.79286, −1.33566]²
    const corner = { x: -1.6, y: -1.6 }
    expect(presetAt(BIOBUZZ, corner)!.key).toBe('redWallScoring')
    vi.useFakeTimers({ toFake: ['performance'] })
    try {
      vi.advanceTimersByTime(1000)
      expect(click(corner).result).toBe(true)
    } finally {
      vi.useRealTimers()
    }
    expect(
      matchingPreset(BIOBUZZ, robotOutline(scene().objects, 'bot').footprint, pose('bot'))
    ).toEqual({
      key: 'redWallScoring',
      facing: 'default'
    })
  })
})
