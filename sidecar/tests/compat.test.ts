import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ensureFtcSamples, FetchError } from '../../scripts/fetch-ftc-sdk.mjs'
import { COMPONENT_TYPE_KEYS } from '../../src/renderer/src/hardware/catalog'
import { createComponent } from '../../src/renderer/src/hardware/components'
import { generateTeamCodeFiles } from '../../src/renderer/src/hardware/generate'
import { validateScene } from '../../src/renderer/src/hardware/validation'
import type { HardwareComponent, SceneObjects } from '../../src/renderer/src/scene/model'
import {
  hasJdk,
  repoRoot,
  runProcess,
  SIDECAR_TEST_TIMEOUT,
  sidecarBuild,
  sidecarReport,
  testTempDir,
  type SidecarBuild
} from './support'

// 호환 테스트: 팀 코드가 보는 sandbot-sdk.jar로 실제 FTC 코드가 수정 없이 컴파일되는지(--release 8, 사이드카의 팀 코드
// 컴파일과 같은 옵션). 실행 동작은 런타임·장치 테스트가 본다. JDK가 없으면 건너뛴다.

// 컴파일되지 않는 샘플과 이유. 1단계 밖(비전 처리의 OpenCV 형식, 안드로이드 UI·리소스)만 뺀다.
// until: 이 형식이 손 구현으로 생기면(빌드 보고의 hand) 그 샘플은 컴파일되어야 한다(목록에서 지운다).
// 뺀 샘플이 컴파일되면 테스트가 목록을 줄이라고 알린다.
const EXCLUDED_SAMPLES: Record<string, { reason: string; until?: string[] }> = {
  'ConceptAprilTag.java': { reason: 'OpenCV org.opencv.core.Point has no fields (vision)' },
  'ConceptAprilTagEasy.java': { reason: 'OpenCV org.opencv.core.Point has no fields (vision)' },
  'ConceptAprilTagLocalization.java': {
    reason: 'OpenCV org.opencv.core.Point has no fields (vision)'
  },
  'ConceptAprilTagSwitchableCameras.java': {
    reason: 'OpenCV org.opencv.core.Point has no fields (vision)'
  },
  'ConceptVisionColorLocator_Rectangle.java': {
    reason: 'OpenCV org.opencv.core.RotatedRect has no fields (vision)'
  },
  'ConceptVisionColorLocator_Circle.java': {
    reason: 'needs android.graphics.Color and android.util.Size',
    until: ['android.graphics.Color', 'android.util.Size']
  },
  'ConceptVisionColorSensor.java': {
    reason: 'needs android.util.Size',
    until: ['android.util.Size']
  },
  'UtilityCameraFrameCapture.java': {
    reason: 'needs android.util.Size',
    until: ['android.util.Size']
  },
  'ConceptLEDStick.java': {
    reason: 'needs android.graphics.Color',
    until: ['android.graphics.Color']
  },
  'ConceptSoundsASJava.java': {
    reason: 'Android resources (Context.getResources, getPackageName)'
  },
  'ConceptSoundsSKYSTONE.java': {
    reason: 'Android resources (Context.getResources, getPackageName)'
  },
  'SensorColor.java': { reason: 'Android UI (Activity.findViewById, View) on the RC screen' },
  'SensorMRColor.java': { reason: 'Android UI (Activity.findViewById, View) on the RC screen' }
}

const corpus = join(
  repoRoot,
  'src/renderer/src/java/usages/__fixtures__/corpus/src/main/java/org/firstinspires/ftc/teamcode'
)
// 사용처 말뭉치에서 FTC SDK 밖 라이브러리를 쓰는 폴더(1단계는 SDK만)
const CORPUS_LIBRARY_DIRS = ['pedro', 'rr']

function javaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.java'))
    .map((e) => join(e.parentPath, e.name))
    .sort()
}

// 사이드카가 팀 코드를 컴파일하는 옵션(--release 8 -g -proc:none -encoding UTF-8 -Xlint:-options)으로 sdk jar에 대고
function compileAgainstSdk(build: SidecarBuild, files: string[]): ReturnType<typeof runProcess> {
  return runProcess(build.javac, [
    '--release',
    '8',
    '-g',
    '-proc:none',
    '-encoding',
    'UTF-8',
    '-Xlint:-options',
    '-nowarn',
    '-Xmaxerrs',
    '10000',
    '-cp',
    build.sdkJar,
    '-d',
    testTempDir('compat'),
    ...files
  ])
}

// javac 오류 줄(경로:줄: error: …)을 파일별로
function errorsByFile(output: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const match of output.matchAll(/^(.+\.java):(\d+): error: (.*)$/gm)) {
    const list = result.get(match[1]) ?? []
    list.push(`${match[2]}: ${match[3]}`)
    result.set(match[1], list)
  }
  return result
}

// 카탈로그의 모든 종류를 붙인 로봇과, 생성 클래스의 중첩 클래스가 되는 메커니즘 그룹(Lift → Claw)
function everyComponentScene(): SceneObjects {
  const objects: SceneObjects = {
    robot: {
      id: 'robot',
      name: 'Compat Bot',
      kind: 'robot',
      parentId: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      hardware: {
        className: 'CompatBotHardware',
        configName: 'Compat Bot',
        expansionHub: { enabled: true, address: 2 }
      }
    }
  }
  const all: HardwareComponent[] = []
  let n = 0
  const add = (type: (typeof COMPONENT_TYPE_KEYS)[number]): HardwareComponent => {
    const component = createComponent(type, all, () => `c${n++}`)
    all.push(component)
    return component
  }
  for (const type of COMPONENT_TYPE_KEYS) {
    const id = `p${n}`
    objects[id] = {
      id,
      name: `part ${n}`,
      kind: 'part',
      parentId: 'robot',
      transform: { position: [0.01 * n, 0.02 * (n % 5) - 0.04, 0], rotation: [0, 0, 0] },
      components: [add(type)]
    }
  }
  objects.lift = {
    id: 'lift',
    name: 'Lift',
    kind: 'group',
    parentId: 'robot',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  }
  objects.liftMotor = {
    id: 'liftMotor',
    name: 'lift motor',
    kind: 'part',
    parentId: 'lift',
    transform: { position: [0, 0, 0.1], rotation: [0, 0, 0] },
    components: [{ ...add('motor'), name: 'liftLeft', hub: 'expansionHub' }]
  }
  objects.claw = {
    id: 'claw',
    name: 'Claw',
    kind: 'group',
    parentId: 'lift',
    transform: { position: [0, 0, 0.2], rotation: [0, 0, 0] },
    components: [{ ...add('servo'), name: 'claw', hub: 'expansionHub' }]
  }
  return objects
}

describe.skipIf(!hasJdk())('FTC 코드 호환(sandbot-sdk.jar로 컴파일)', () => {
  let build: SidecarBuild

  beforeAll(async () => {
    const result = await sidecarBuild()
    if (!result) throw new Error('JDK disappeared')
    build = result
  }, SIDECAR_TEST_TIMEOUT)

  it(
    'FtcRobotController 12.0 샘플(제외 목록 밖)이 컴파일된다',
    async (ctx) => {
      let samples: { dir: string; files: string[] }
      try {
        samples = await ensureFtcSamples({ log: () => {} })
      } catch (error) {
        // 받지 못하면(오프라인) 건너뛴다. 해시가 다른 것은 실패다.
        if (error instanceof FetchError && !/SHA-256/.test((error as Error).message)) {
          ctx.skip()
          return
        }
        throw error
      }
      const hand = new Set(sidecarReport(build).hand)
      const isExcluded = (name: string): boolean => {
        const entry = EXCLUDED_SAMPLES[name]
        if (!entry) return false
        return !entry.until || !entry.until.every((type) => hand.has(type))
      }
      const result = await compileAgainstSdk(build, samples.files)
      const errors = errorsByFile(result.output)
      const name = (file: string): string => relative(samples.dir, file).split(sep).join('/')
      const unexpected: Record<string, string[]> = {}
      for (const [file, list] of errors) if (!isExcluded(name(file))) unexpected[name(file)] = list
      expect(unexpected).toEqual({})
      // 제외 목록은 정말 컴파일되지 않는 것만(다른 작업이 손 구현을 더해 고쳐졌으면 목록에서 지운다)
      const compiledButExcluded = samples.files
        .map(name)
        .filter((n) => isExcluded(n) && ![...errors.keys()].some((f) => name(f) === n))
      expect(compiledButExcluded).toEqual([])
      expect(samples.files.length).toBe(65)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '사용처 말뭉치의 팀 파일(FTC SDK만 쓰는 것)과 생성 클래스가 컴파일된다',
    async () => {
      const files = javaFiles(corpus).filter(
        (file) => !CORPUS_LIBRARY_DIRS.includes(relative(corpus, file).split(sep)[0])
      )
      expect(files.some((f) => f.endsWith(join('sandbot', 'RobotHardware.java')))).toBe(true)
      const result = await compileAgainstSdk(build, files)
      expect(Object.fromEntries(errorsByFile(result.output))).toEqual({})
      expect(result.code).toBe(0)
    },
    SIDECAR_TEST_TIMEOUT
  )

  it(
    '카탈로그의 모든 종류와 메커니즘 그룹으로 생성한 하드웨어 클래스가 컴파일된다',
    async () => {
      const objects = everyComponentScene()
      expect(validateScene(objects).filter((issue) => issue.severity === 'error')).toEqual([])
      const { files, blocked } = generateTeamCodeFiles(objects)
      expect(blocked).toBe(false)
      const dir = testTempDir('generated')
      const javaPaths: string[] = []
      for (const file of files) {
        if (!file.path.endsWith('.java')) continue
        const path = join(dir, ...file.path.split('/'))
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, file.content)
        javaPaths.push(path)
      }
      expect(javaPaths).toHaveLength(1)
      const result = await compileAgainstSdk(build, javaPaths)
      expect(Object.fromEntries(errorsByFile(result.output))).toEqual({})
      expect(result.code).toBe(0)
    },
    SIDECAR_TEST_TIMEOUT
  )
})
