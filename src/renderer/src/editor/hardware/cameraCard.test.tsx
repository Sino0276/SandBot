import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { BoxGeometry } from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../../shared/play'
import { rotationMatrix } from '../../../../shared/sim/seasons/fieldGeometry'
import ko from '../../i18n/locales/ko'
import { cameraAimRotation, sdkCameraPose, type CameraAim } from '../../hardware/mounting'
import { newRun, usePlayStore } from '../../play/playStore'
import type { HardwareComponent, SceneObjects } from '../../scene/model'
import { disposeGeometry, registerGeometry } from '../../scene/geometryRegistry'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import ComponentCard from './ComponentCard'

// 웹캠 카드(spec-4d §1.15, C3): 카메라 모델·조준 칸, setCameraPose 계산값 줄, 편집 자세 줄, 실행 중 배지

vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {} }
  Object.assign(globalThis, { localStorage: storage })
})

type TestStore<T> = { getInitialState: () => T; setState: (patch: Partial<T>) => void }
const restores: (() => void)[] = []
function setStore<T extends object>(store: TestStore<T>, patch: Partial<T>): void {
  const initial = store.getInitialState()
  const saved = { ...initial }
  restores.push(() => Object.assign(initial, saved))
  Object.assign(initial, patch)
  store.setState(patch)
}
afterEach(() => {
  while (restores.length > 0) restores.pop()!()
})

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

const DEG = Math.PI / 180

const webcam = (props: Record<string, number | string> = {}): HardwareComponent => ({
  id: 'cam',
  type: 'webcam',
  name: 'Webcam 1',
  hub: 'controlHub',
  port: 0,
  props: {
    serialNumber: 'SN1',
    cameraModel: 'logitechC920',
    aimYaw: 0,
    aimPitch: Math.PI / 6,
    aimRoll: 0,
    ...props
  }
})

// 로봇 원점에서 앞 0.2 m·왼쪽 0.05 m·높이 0.3 m(형상 없음 → 렌즈 = 피벗)
const scene = (component: HardwareComponent): SceneObjects => ({
  bot: {
    id: 'bot',
    name: 'Bot',
    kind: 'robot',
    parentId: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  },
  part: {
    id: 'part',
    name: 'Camera',
    kind: 'part',
    parentId: 'bot',
    transform: { position: [0.2, 0.05, 0.3], rotation: [0, 0, 0] },
    components: [component]
  }
})

const OP_MODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Auto',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Auto.java',
  line: 1,
  flavor: 'Autonomous',
  name: 'Auto',
  group: '',
  preselectTeleOp: ''
}

const render = (component: HardwareComponent, objects: SceneObjects = scene(component)): string => {
  setStore(useSceneStore, { objects })
  setStore(useUnitStore, { lengthUnit: 'mm' })
  return renderToStaticMarkup(
    <ComponentCard
      objects={objects}
      objectId="part"
      component={component}
      siblings={[]}
      objectOptions={{}}
      expansionHubEnabled={false}
      issues={[]}
    />
  )
}

// 0.2 m = 7.87 in, 0.05 m = 1.97 in, 0.3 m = 11.81 in. SDK 틀: x = −y(왼쪽 → 오른쪽 −), y = x(앞)
const POSITION = 'Position(INCH, -1.97, 7.87, 11.81)'

describe('웹캠 카드', () => {
  it('C3: 기본 위 30° → YawPitchRollAngles(DEGREES, 0.0, -60.0, 0.0), 수평·왼쪽 90°·롤 20°', () => {
    const cases: [Record<string, number>, string][] = [
      [{}, 'YawPitchRollAngles(DEGREES, 0.0, -60.0, 0.0)'],
      [{ aimPitch: 0 }, 'YawPitchRollAngles(DEGREES, 0.0, -90.0, 0.0)'],
      [{ aimYaw: 90 * DEG, aimPitch: 0 }, 'YawPitchRollAngles(DEGREES, 90.0, -90.0, 0.0)'],
      [{ aimPitch: 0, aimRoll: 20 * DEG }, 'YawPitchRollAngles(DEGREES, 0.0, -90.0, 20.0)']
    ]
    for (const [props, angles] of cases) {
      const html = render(webcam(props))
      expect(html).toContain(`setCameraPose: ${POSITION} · ${angles}`)
    }
    const html = render(webcam())
    expect(html).toContain(
      `title="${i18n.t('hardware.derivedHints.webcam').replace(/'/g, '&#x27;')}"`
    )
  })

  it('로봇 중심선 위 렌즈의 반올림 찌꺼기(±1e-17)는 "-0.00"·"-0.0"이 아니라 0이다', () => {
    const component = webcam({ aimRoll: -1e-17 })
    const objects = scene(component)
    const centred: SceneObjects = {
      ...objects,
      part: { ...objects.part, transform: { position: [0.2, 1e-17, 0.3], rotation: [0, 0, 0] } }
    }
    const html = render(component, centred)
    expect(html).toContain(
      'setCameraPose: Position(INCH, 0.00, 7.87, 11.81) · YawPitchRollAngles(DEGREES, 0.0, -60.0, 0.0)'
    )
    expect(html).not.toContain('-0.0')
  })

  it('형상을 읽으면 setCameraPose 줄이 피벗에서 하우징 앞면으로 바뀐다(형상 판으로 다시 그림)', () => {
    const component = webcam({ aimPitch: 0 })
    const objects = scene(component)
    const withMesh: SceneObjects = {
      ...objects,
      part: {
        ...objects.part,
        visual: { type: 'mesh', geometryId: 'cam-geometry', color: [0.5, 0.5, 0.5] }
      }
    }
    // 형상을 아직 읽지 않았으면 피벗(앞 0.2 m = 7.87 in)
    expect(render(component, withMesh)).toContain('Position(INCH, -1.97, 7.87, 11.81)')
    const geometry = new BoxGeometry(0.0254, 0.05, 0.03)
    registerGeometry('cam-geometry', geometry)
    try {
      // 수평 앞 조준: 렌즈 = 피벗 + 상자 앞면(+X 0.5 in) → y_sdk 8.37 in
      expect(render(component, withMesh)).toContain('Position(INCH, -1.97, 8.37, 11.81)')
    } finally {
      disposeGeometry('cam-geometry')
    }
  })

  it('C3: sdkCameraPose를 SDK ZXZ(Rz·Rx·Rz)로 되돌린 회전 = SandBot 장착의 OpenCV 축 행렬(1e-12)', () => {
    // SDK 로봇 틀 ← SandBot 로봇 틀: Rz(90°) (x_sdk = −y, y_sdk = x)
    const toSdk = [0, -1, 0, 1, 0, 0, 0, 0, 1]
    const mul = (a: readonly number[], b: readonly number[]): number[] =>
      Array.from({ length: 9 }, (_, k) => {
        const i = Math.floor(k / 3)
        const j = k % 3
        return a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
      })
    // 센서 틀에서 OpenCV 카메라 축(열 = x_cv, y_cv, z_cv): [−ŷ, −ẑ, x̂]
    const cvAxes = [0, 0, 1, -1, 0, 0, 0, -1, 0]
    const rz = (a: number): number[] => [
      Math.cos(a),
      -Math.sin(a),
      0,
      Math.sin(a),
      Math.cos(a),
      0,
      0,
      0,
      1
    ]
    const rx = (a: number): number[] => [
      1,
      0,
      0,
      0,
      Math.cos(a),
      -Math.sin(a),
      0,
      Math.sin(a),
      Math.cos(a)
    ]
    for (const aim of [
      { yaw: 0, pitch: Math.PI / 6, roll: 0 },
      { yaw: 0.7, pitch: -0.4, roll: 20 * DEG },
      { yaw: -2.5, pitch: 1.2, roll: -1.1 }
    ] satisfies CameraAim[]) {
      const pose = sdkCameraPose({ x: 0.2, y: 0.05, z: 0.3 }, aim)
      const sdk = mul(mul(rz(pose.yaw * DEG), rx(pose.pitch * DEG)), rz(pose.roll * DEG))
      const sandbot = mul(mul(toSdk, rotationMatrix(cameraAimRotation(aim))), cvAxes)
      sdk.forEach((v, i) => expect(Math.abs(v - sandbot[i])).toBeLessThan(1e-12))
    }
  })

  it('카메라 모델 선택칸(다섯, 기본 C920)·롤 칸·편집 자세 줄(렌즈·태그)과 도움말', () => {
    const html = render(webcam())
    expect(html).toContain('카메라 모델')
    expect(html).toContain('롤(뒤에서 볼 때 시계 방향 +) (°)')
    expect(html).toContain('조준 높이각(위 +) (°)')
    expect(html).toContain('value="30.0"')
    expect(html.match(/<option value="(logitech|lifecam|gobilda)/g)).toHaveLength(5)
    expect(html).toContain('렌즈 640×480: fx 622.0')
    expect(html).toContain(
      `title="${i18n.t('hardware.cameraReading.hint').replace(/'/g, '&#x27;')}"`
    )
    // 형상이 없으면 피벗 꼬리
    expect(html).toContain(`⚠ ${i18n.t('hardware.cameraReading.tails.pivot')}`)
    // 시리얼이 없으면 꼬리로 알린다
    const unconfigured = render(webcam({ serialNumber: '' }))
    expect(unconfigured).toContain(`⚠ ${i18n.t('hardware.cameraReading.tails.notConfigured')}`)
  })

  it('실행 중인 로봇의 모델·조준 칸에 "실행 중" 배지', () => {
    const run = newRun({
      runId: 'r1',
      root: '/p',
      opMode: OP_MODE,
      robotId: 'bot',
      configPath: null,
      speed: 1,
      paused: false
    })
    setStore(usePlayStore, { run: { ...run, phase: 'running' } })
    const html = render(webcam())
    expect(html.match(/frame-badge is-running/g) ?? []).toHaveLength(4)
  })
})
