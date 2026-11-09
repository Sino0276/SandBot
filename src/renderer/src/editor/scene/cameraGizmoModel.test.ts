import { Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { CAMERA_MODEL_IDS, trueIntrinsics } from '../../../../shared/sim/cameraData'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { tagFieldPose } from '../../../../shared/sim/seasons/tagPoses'
import type { TagObservation } from '../../../../shared/sim/vision'
import { cameraAimRotation } from '../../hardware/mounting'
import { newRun, type PlayData, type PlayRun } from '../../play/playStore'
import type { HardwareComponent, JointSettings, SceneObjects, Transform } from '../../scene/model'
import {
  CAMERA_FRUSTUM_LENGTH,
  CAMERA_GIZMO_COLOR,
  cameraGizmoGeometry,
  cameraGizmoPose,
  cameraGizmoTargets,
  frustumCornerDirections,
  pixelDirection,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  tagCornersInField,
  type CameraGizmoTarget
} from './cameraGizmoModel'
import { mountMatrix, SENSOR_DISTANCE_COLOR, SENSOR_WARNING_COLOR } from './sensorGizmoModel'

// 씬 뷰 웹캠 기즈모의 순수 모델(spec-4d §1.15, C5)

const at = (x: number, y: number, z: number, yaw = 0): Transform => ({
  position: [x, y, z],
  rotation: [0, 0, yaw]
})
const NO_VISIBILITY: { hidden: Set<string>; isolated: string[] | null; fieldHidden: boolean } = {
  hidden: new Set<string>(),
  isolated: null,
  fieldHidden: false
}
const NO_PREVIEW = { values: {} }
const IDLE: Pick<PlayData, 'run' | 'simPose'> = { run: null, simPose: null }

const webcam = (id: string, props: Record<string, number | string> = {}): HardwareComponent => ({
  id,
  type: 'webcam',
  name: id,
  hub: 'controlHub',
  port: 0,
  props: { serialNumber: 'SN', aimYaw: 0, aimPitch: 0, aimRoll: 0, ...props }
})

const pan: JointSettings = {
  type: 'revolute',
  anchor: [0, 0, 0],
  axis: 'z',
  axisSign: 1,
  limits: { lower: -Math.PI, upper: Math.PI },
  friction: { coulomb: 0, viscous: 0 },
  spring: null,
  drive: { kind: 'none' }
}

// 로봇(1, 0) 요 0. 앞 웹캠 파트(0.2, 0, 0.3), 팬 관절 그룹 아래 웹캠 파트(0.1, 0, 0.4)
function scene(): SceneObjects {
  return {
    bot: { id: 'bot', name: 'Bot', kind: 'robot', parentId: null, transform: at(1, 0, 0) },
    front: {
      id: 'front',
      name: 'Front',
      kind: 'part',
      parentId: 'bot',
      transform: at(0.2, 0, 0.3),
      components: [webcam('cam')]
    },
    pan: {
      id: 'pan',
      name: 'Pan',
      kind: 'group',
      parentId: 'bot',
      transform: at(0, 0, 0),
      joint: pan
    },
    turret: {
      id: 'turret',
      name: 'Turret',
      kind: 'part',
      parentId: 'pan',
      transform: at(0.1, 0, 0.4),
      components: [webcam('top')]
    },
    loose: {
      id: 'loose',
      name: 'Loose',
      kind: 'part',
      parentId: null,
      transform: at(0, 0, 0),
      components: [webcam('stray')]
    }
  }
}

const target = (objects: SceneObjects, key: string): CameraGizmoTarget =>
  cameraGizmoTargets(objects, ['bot'], NO_VISIBILITY).find((t) => t.key === key)!

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Auto',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Auto.java',
  line: 1,
  flavor: 'Autonomous',
  name: 'Auto',
  group: '',
  preselectTeleOp: ''
}

function runOf(cameras: PlayRun['cameras'], joints: string[] = []): PlayRun {
  const run = newRun({
    runId: 'r1',
    root: '/p',
    opMode: OP_MODE,
    robotId: 'bot',
    configPath: null,
    speed: 1,
    paused: false,
    joints,
    cameras
  })
  return { ...run, phase: 'running' }
}

const axisOf = (m: Matrix4): Vector3 => new Vector3(1, 0, 0).transformDirection(m)
const upOf = (m: Matrix4): Vector3 => new Vector3(0, 0, 1).transformDirection(m)

// OpenCV 핀홀 투영(왜곡 없음): 센서 틀 방향 → (u, v)
function project(
  lens: { fx: number; fy: number; cx: number; cy: number },
  d: { x: number; y: number; z: number }
): [number, number] {
  return [lens.fx * (-d.y / d.x) + lens.cx, lens.fy * (-d.z / d.x) + lens.cy]
}

describe('절두체 방향', () => {
  it('네 모서리 방향을 투영하면 영상 가장자리(−0.5, −0.5)·(w − 0.5, −0.5)·(w − 0.5, h − 0.5)·(−0.5, h − 0.5)', () => {
    for (const model of CAMERA_MODEL_IDS)
      for (const [w, h] of [
        [640, 480],
        [1280, 720]
      ]) {
        const lens = trueIntrinsics(model, w, h)
        const corners = frustumCornerDirections(lens, w, h)
        const expected = [
          [-0.5, -0.5],
          [w - 0.5, -0.5],
          [w - 0.5, h - 0.5],
          [-0.5, h - 0.5]
        ]
        corners.forEach((d, i) => {
          expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12)
          const [u, v] = project(lens, d)
          expect(u).toBeCloseTo(expected[i][0], 9)
          expect(v).toBeCloseTo(expected[i][1], 9)
        })
      }
    // 주점은 광축(+X)
    const lens = trueIntrinsics('logitechC920', 640, 480)
    const center = pixelDirection(lens, lens.cx, lens.cy)
    expect(center).toEqual({ x: 1, y: -0, z: -0 })
    // 영상 왼쪽 위는 센서 +Y(왼쪽)·+Z(위)
    const [topLeft] = frustumCornerDirections(lens, 640, 480)
    expect(topLeft.y).toBeGreaterThan(0)
    expect(topLeft.z).toBeGreaterThan(0)
  })

  it('형상: 렌즈 → 모서리 4 + 끝 사각형 4 + 위쪽 삼각형 3, 깊이 1.0 m, 삼각형은 영상 위쪽(롤 반영)', () => {
    const lens = trueIntrinsics('logitechC920', PREVIEW_WIDTH, PREVIEW_HEIGHT)
    for (const roll of [0, Math.PI / 2]) {
      const matrix = mountMatrix({
        position: { x: 1, y: 2, z: 0.3 },
        rotation: cameraAimRotation({ yaw: 0.3, pitch: 0.2, roll })
      })
      const geometry = cameraGizmoGeometry({
        matrix: matrix.elements,
        pivot: { x: 1, y: 2, z: 0.3 },
        lens,
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        excluded: false,
        tags: null
      })
      expect(geometry.frustum).toHaveLength(11)
      const axis = axisOf(matrix)
      const up = upOf(matrix)
      const origin = new Vector3(1, 2, 0.3)
      // 모서리 선 끝은 광축 깊이 1.0 m
      for (const segment of geometry.frustum.slice(0, 4)) {
        const end = new Vector3(segment.to.x, segment.to.y, segment.to.z).sub(origin)
        expect(end.dot(axis)).toBeCloseTo(CAMERA_FRUSTUM_LENGTH, 12)
      }
      // 삼각형 꼭짓점은 끝 사각형 위 변보다 영상 위쪽(센서 +Z)에 있다
      const topEdge = new Vector3(
        geometry.frustum[0].to.x,
        geometry.frustum[0].to.y,
        geometry.frustum[0].to.z
      ).sub(origin)
      const apex = new Vector3(
        geometry.frustum[8].to.x,
        geometry.frustum[8].to.y,
        geometry.frustum[8].to.z
      ).sub(origin)
      expect(apex.dot(up)).toBeGreaterThan(topEdge.dot(up))
      expect(geometry.visibleTags).toEqual([])
      expect(geometry.occludedTags).toEqual([])
    }
  })

  it('태그 표시: 보이는 태그는 검은 테두리(tagFieldPose 꼭짓점), 가려진 태그만 점선, 다른 이유·빠진 웹캠은 없음', () => {
    const field = resolveSeason('biobuzz')
    const hiveTipped = [false, false] as const
    const observation = (
      id: number,
      visible: boolean,
      rejection: TagObservation['rejection']
    ): TagObservation =>
      ({
        id,
        corners: [0, 0, 0, 0, 0, 0, 0, 0],
        shortSide: 20,
        visible,
        rejection
      }) as TagObservation
    const observations = [
      observation(34, true, null),
      observation(32, false, 'occluded'),
      observation(30, false, 'tooSmall'),
      observation(31, false, 'behind')
    ]
    const lens = trueIntrinsics('logitechC920', 640, 480)
    const input = {
      matrix: new Matrix4().elements,
      pivot: { x: 0, y: 0, z: 0 },
      lens,
      width: 640,
      height: 480,
      excluded: false,
      tags: { field, hiveTipped, observations }
    }
    const geometry = cameraGizmoGeometry(input)
    expect(geometry.visibleTags).toHaveLength(4)
    expect(geometry.occludedTags).toHaveLength(4)
    const corners = tagCornersInField(field, 34, hiveTipped)!
    expect(geometry.visibleTags.map((s) => s.from)).toEqual(corners)
    // 꼭짓점은 태그 틀 (±s/2, ±s/2)를 필드 자세로 옮긴 것(apriltag 순서)
    const tag = field.aprilTags.tags.find((t) => t.id === 34)!
    const pose = tagFieldPose(field, tag, hiveTipped)
    const r = pose.rotation
    const h = tag.size / 2
    expect(corners[0].x).toBeCloseTo(pose.position.x - r[0] * h + r[1] * h, 15)
    expect(corners[0].z).toBeCloseTo(pose.position.z - r[6] * h + r[7] * h, 15)
    expect(cameraGizmoGeometry({ ...input, excluded: true }).visibleTags).toEqual([])
  })

  it('색: 청록이 거리 센서 보라·경고 주황과 다르다', () => {
    expect(CAMERA_GIZMO_COLOR).toBe('#22d3ee')
    expect(CAMERA_GIZMO_COLOR).not.toBe(SENSOR_DISTANCE_COLOR)
    expect(CAMERA_GIZMO_COLOR).not.toBe(SENSOR_WARNING_COLOR)
  })
})

describe('기즈모 대상·자세', () => {
  it('고른 오브젝트·상위·다중 선택, 숨김·고립 보기, 로봇 밖 제외', () => {
    const objects = scene()
    const keys = (ids: string[], visibility = NO_VISIBILITY): string[] =>
      cameraGizmoTargets(objects, ids, visibility).map((t) => t.key)
    expect(keys([])).toEqual([])
    expect(keys(['bot'])).toEqual(['cam', 'top'])
    expect(keys(['pan'])).toEqual(['top'])
    expect(keys(['front', 'pan'])).toEqual(['cam', 'top'])
    // 로봇 밖 웹캠은 고르더라도 그리지 않는다
    expect(keys(['loose'])).toEqual([])
    expect(keys(['bot'], { ...NO_VISIBILITY, hidden: new Set(['front']) })).toEqual(['top'])
    expect(keys(['bot'], { ...NO_VISIBILITY, isolated: ['turret'] })).toEqual(['top'])
  })

  it('문서: 렌즈 = 피벗(형상 없음), 기본 회전, 팬 미리보기가 절두체를 돌린다', () => {
    const objects = scene()
    const pose = cameraGizmoPose(objects, target(objects, 'cam'), IDLE, NO_PREVIEW, null)!
    expect(pose.source).toBe('document')
    expect(pose.showTags).toBe(true)
    expect(pose.model).toBe('logitechC920')
    expect(
      new Vector3()
        .setFromMatrixPosition(pose.matrix)
        .toArray()
        .map((v) => Number(v.toFixed(12)))
    ).toEqual([1.2, 0, 0.3])
    expect(axisOf(pose.matrix).x).toBeCloseTo(1, 12)
    const rest = cameraGizmoPose(objects, target(objects, 'top'), IDLE, NO_PREVIEW, null)!
    const turned = cameraGizmoPose(
      objects,
      target(objects, 'top'),
      IDLE,
      { values: { pan: Math.PI / 2 } },
      null
    )!
    expect(axisOf(rest.matrix).x).toBeCloseTo(1, 12)
    expect(axisOf(turned.matrix).y).toBeCloseTo(1, 12)
  })

  it('실행 잠금: run.cameras 장착·모델로, 태그 숨김. 떼어 놓은 실행이면 문서', () => {
    const objects = scene()
    const runMount = {
      body: -1,
      position: { x: 0.2, y: 0, z: 0.3 },
      rotation: { x: 0, y: 0, z: Math.PI / 2 }
    }
    const run = runOf([
      { objectId: 'front', componentId: 'cam', body: -1, mount: runMount, model: 'gobilda3122' }
    ])
    const simPose = { robotId: 'bot', tNanos: 0, x: -1, y: 2, yaw: 0, blocked: false }
    const pose = cameraGizmoPose(
      objects,
      target(objects, 'cam'),
      { run, simPose },
      NO_PREVIEW,
      null
    )!
    expect(pose.source).toBe('run')
    expect(pose.showTags).toBe(false)
    expect(pose.model).toBe('gobilda3122')
    const expected = new Matrix4().makeTranslation(-1, 2, 0).multiply(mountMatrix(runMount))
    pose.matrix.elements.forEach((v, i) =>
      expect(Math.abs(v - expected.elements[i])).toBeLessThan(1e-12)
    )
    // 실행에 없는 웹캠(top)은 문서 장착으로 그리고 태그는 숨긴다
    const other = cameraGizmoPose(
      objects,
      target(objects, 'top'),
      { run, simPose },
      NO_PREVIEW,
      null
    )!
    expect(other.source).toBe('document')
    expect(other.showTags).toBe(false)
    const detached = cameraGizmoPose(
      objects,
      target(objects, 'cam'),
      { run: { ...run, detached: true }, simPose },
      NO_PREVIEW,
      null
    )!
    expect(detached.source).toBe('document')
  })

  it('실행 장착의 관절 몸체: run.joints[j] 표시 행렬 · 앵커', () => {
    const objects = scene()
    const mount = { body: 0, position: { x: 0.1, y: 0, z: 0.4 }, rotation: { x: 0, y: 0, z: 0 } }
    const run = runOf(
      [{ objectId: 'turret', componentId: 'top', body: 0, mount, model: 'logitechC920' }],
      ['pan']
    )
    const pose = cameraGizmoPose(
      objects,
      target(objects, 'top'),
      { run, simPose: null },
      NO_PREVIEW,
      null
    )!
    expect(pose.source).toBe('run')
    expect(
      new Vector3()
        .setFromMatrixPosition(pose.matrix)
        .toArray()
        .map((v) => Number(v.toFixed(12)))
    ).toEqual([1.1, 0, 0.4])
  })
})
