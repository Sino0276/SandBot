import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JavaSourceRead, ReadJavaSourcesResult } from '../../../shared/ipc'
import { isLinkableJavaPath } from '../../../shared/teamCodePaths'
import {
  deviceUsageView,
  fileGroups,
  groupUsageView,
  robotUsageView,
  type UsageView
} from '../editor/usages/usageView'
import { useNoticeStore } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { buildJavaIndex, useJavaIndexStore } from './javaIndex'
import {
  checkUsagesAfterSave,
  initUsageIndex,
  resetUsageIndexState,
  setUsageBaseline,
  setUsageWorkerFactory,
  SYMBOLS_DEBOUNCE_MS,
  useUsageIndexStore,
  type UsageWorkerLike
} from './usageIndex'
import {
  COMP_ROBOT_ID,
  corpusScene,
  PRACTICE_ROBOT_ID,
  renamedCorpusScene
} from './usages/__fixtures__/corpusScene'
import type { FromWorker, ToWorker, UsageHit, UsageResult } from './usages/usageTypes'
import { createUsageWorkerState, handleMessage } from './usages/usageWorkerCore'

// 사용처 끝까지 잇기(통합) 테스트: 말뭉치(usages/__fixtures__/corpus, TeamCode 폴더 모양)를 디스크에서 읽는 가짜
// window.api.readJavaSources → 조율(usageIndex) → 진짜 워커 논리(usageWorkerCore, 기본 의존성 = 진짜
// extractFacts·resolveUsages) → 진짜 기호표(usageSymbols) → 카드 보기 모델(usageView). 가짜는 IPC와 워커 스레드뿐이다.
// 워커와 주고받는 메시지는 structuredClone을 거친다(진짜 postMessage처럼 복제할 수 있어야 한다).
// 코드 사용처가 javac와 같은지는 usageGolden.test.ts가 확인한다. 여기서는 같은 정답표가 화면까지 그대로 가는지 본다.

const CORPUS = join(__dirname, 'usages', '__fixtures__', 'corpus')
const FIXTURES = join(__dirname, 'usages', '__fixtures__')
const ROOT = '/corpus-project'
const T = 'src/main/java/org/firstinspires/ftc/teamcode/'
const LIFT_LEFT = { objectId: 'liftMotor', componentId: 'll' }

// usageGolden.test.ts의 ACCEPTED_FN 중 liftLeft 필드(찾지 못해도 되는 것, 경로:줄:열)
const MISSED_LIFT_LEFT = [
  `${T}Escapes.java:8:21`,
  `${T}LocalClass.java:11:19`,
  `${T}Shadowing.java:18:70`,
  `${T}Shadowing.java:33:22`,
  `${T}Shadowing.java:37:36`,
  `${T}probes/b/Q10Generic.java:21:20`
]
// 그 밖의 ACCEPTED_FN(건너뛴 파일의 형식 RobotHardware)
const MISSED = [`${T}Escapes.java:7:12`, ...MISSED_LIFT_LEFT]

const posix = (path: string): string => path.split(sep).join('/')
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const at = (hit: UsageHit): string => `${hit.path}:${hit.line}:${hit.col}`
const atLine = (hit: UsageHit): string => `${hit.path}:${hit.line}`

function walk(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...walk(path))
    else if (entry.isFile()) result.push(path)
  }
  return result
}

// 정답표 줄(머리줄 뺌)
function golden(name: string): string[] {
  return readFileSync(join(FIXTURES, name), 'utf8')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
}

// 정답표에서 이 줄 모양의 코드 사용처 자리(경로:줄:열). import·한정자는 사용처가 아니고, javac가 선언자 여럿에 같은
// 형식 트리를 나눠 주어 겹친 자리는 하나로 본다. 받아들인 한계(MISSED)는 뺀다.
function goldenPositions(pattern: RegExp): string[] {
  const lines = golden('golden.txt').filter(
    (line) => !/\[(import|qualifier)\]/.test(line) && pattern.test(line)
  )
  return [...new Set(lines.map((line) => line.split(' ')[0]))]
    .filter((position) => !MISSED.includes(position))
    .sort(compare)
}

// 메인의 목록처럼 TeamCode 기준 경로(생성 패키지 폴더 제외)와 크기·수정 시각
function listing(): { path: string; size: number; mtimeMs: number }[] {
  return walk(join(CORPUS, 'src/main/java'))
    .map((path) => posix(relative(CORPUS, path)))
    .filter(isLinkableJavaPath)
    .sort(compare)
    .map((path) => {
      const stat = statSync(join(CORPUS, path))
      return { path, size: stat.size, mtimeMs: stat.mtimeMs }
    })
}

// 메인의 readJavaSources처럼 목록 경로를 읽는다(루트가 다르면 거부)
const readJavaSources = vi.fn(
  async (root: string, paths: string[]): Promise<ReadJavaSourcesResult> => {
    if (root !== ROOT) return { ok: false, code: 'notAllowed', detail: root }
    return {
      ok: true,
      files: paths.map((path): JavaSourceRead => {
        if (!isLinkableJavaPath(path)) return { path, status: 'notAllowed' }
        const full = join(CORPUS, path)
        const stat = statSync(full)
        const text = readFileSync(full).toString('utf8')
        return { path, status: 'ok', text, size: stat.size, mtimeMs: stat.mtimeMs }
      })
    }
  }
)

// 같은 스레드에서 도는 워커. 진짜 워커 논리를 기본 의존성으로 만든다(사실·맞추기 모두 진짜).
class InThreadWorker implements UsageWorkerLike {
  onmessage: ((event: { data: FromWorker }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly messages: ToWorker[] = []
  readonly replies: FromWorker[] = []
  private terminated = false
  private readonly state = createUsageWorkerState()
  postMessage(message: ToWorker): void {
    const copy = structuredClone(message)
    this.messages.push(copy)
    queueMicrotask(() => {
      if (this.terminated) return
      const reply = structuredClone(handleMessage(this.state, copy))
      this.replies.push(reply)
      this.onmessage?.({ data: reply })
    })
  }
  terminate(): void {
    this.terminated = true
  }
  get matches(): number {
    return this.messages.filter((m) => m.type === 'match').length
  }
}

let workers: InThreadWorker[]
const worker = (): InThreadWorker => workers[workers.length - 1]
const usage = (): ReturnType<typeof useUsageIndexStore.getState> => useUsageIndexStore.getState()
const result = (): UsageResult => {
  const { result } = usage()
  if (!result) throw new Error('사용처 결과가 없다')
  return result
}
const readCount = (): number => readJavaSources.mock.calls.length

const settle = async (): Promise<void> => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

// 씬을 바꾸고(편집) 묶음 시간이 지나 맞추기가 끝날 때까지
async function edit(objects: SceneObjects): Promise<void> {
  useSceneStore.setState({ objects })
  vi.advanceTimersByTime(SYMBOLS_DEBOUNCE_MS)
  await settle()
}

// projectActions의 열기처럼: 씬과 루트·세션을 정하고 기준 씬을 둔 뒤 목록을 준비한다
async function openCorpus(objects: SceneObjects): Promise<void> {
  useSceneStore.setState({ objects })
  useProjectStore.setState({ root: ROOT, session: 1, busy: false })
  setUsageBaseline(objects)
  useJavaIndexStore.setState({
    status: 'ready',
    root: ROOT,
    files: buildJavaIndex(listing()),
    truncated: false,
    revision: useJavaIndexStore.getState().revision + 1
  })
  await settle()
}

function deviceView(objects: SceneObjects, device = LIFT_LEFT): UsageView {
  const view = deviceUsageView(
    objects,
    result(),
    usage().baseline,
    device.objectId,
    device.componentId
  )
  if (!view) throw new Error('장치 카드에 사용처가 없다')
  return view
}

const section = (view: UsageView, id: string): UsageView['sections'][number] | undefined =>
  view.sections.find((s) => s.id === id)

// 장치 enc(Lift의 데드휠)의 구성 이름을 바꾼 씬. 필드·상수 이름도 함께 바뀌고, "enc"를 찾는 문자열은 구성에 없는
// 이름이 된다.
function renameEncoder(objects: SceneObjects, name: string): SceneObjects {
  const part = objects.liftEncoder
  return {
    ...objects,
    liftEncoder: {
      ...part,
      components: part.components!.map((c) => (c.id === 'enc' ? { ...c, name } : c))
    }
  }
}

describe('사용처 끝까지 잇기(말뭉치, 진짜 사실·맞추기·기호표)', () => {
  beforeAll(() => {
    initUsageIndex()
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    workers = []
    readJavaSources.mockClear()
    vi.stubGlobal('window', { api: { readJavaSources } })
    useSceneStore.setState({ objects: {} })
    useProjectStore.setState(useProjectStore.getInitialState())
    useJavaIndexStore.setState(useJavaIndexStore.getInitialState())
    useNoticeStore.setState({ notices: [] })
    resetUsageIndexState()
    setUsageWorkerFactory(() => {
      const created = new InThreadWorker()
      workers.push(created)
      return created
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetUsageIndexState()
  })

  it('목록의 파일을 한 번에 읽어 맞추고, 장치 카드가 javac 정답표의 사용처를 보인다', async () => {
    const objects = corpusScene()
    await openCorpus(objects)

    expect(usage().status).toBe('ready')
    const listed = listing().map((file) => file.path)
    expect(readJavaSources.mock.calls.map(([, paths]) => paths)).toEqual([listed])
    expect(worker().replies.some((reply) => reply.type === 'error')).toBe(false)
    expect(result().files).toEqual({
      scanned: listed.length - 1,
      tooLarge: [],
      unicodeEscape: [`${T}Escapes.java`],
      failed: []
    })
    expect(result().unresolved.size).toBe(0)

    const view = deviceView(objects)
    // 코드: javac가 liftLeft(RobotHardware.Lift)에 묶는 자리(import·한정자 제외)에서 받아들인 한계만 빠진다
    const expected = goldenPositions(/ field RobotHardware\.Lift\.liftLeft$/)
    const code = section(view, 'code')!
    expect(code.hits.map(at).sort(compare)).toEqual(expected)
    expect(code.hits.every((hit) => hit.kind === 'field')).toBe(true)
    for (const hit of code.hits)
      expect(hit.snippet.slice(hit.mark[0], hit.mark[1])).toBe('liftLeft')
    expect(view.counts).toEqual({ code: expected.length, byName: 1, descendants: 0, warnings: 0 })

    // 이름으로: 다른 파일의 상수를 찾기 인자로 쓴 초기값. Practice Bot에도 같은 구성 이름이 있다.
    expect(section(view, 'byName')!.hits.map((hit) => `${atLine(hit)} ${hit.snippet}`)).toEqual([
      `${T}Constants.java:5 LIFT_MOTOR = "liftLeft"`
    ])
    expect(view.sharedName).toBe(true)
    // 같은 글자의 다른 문자열은 접어 두고 세지 않는다
    const sameText = section(view, 'sameText')!
    expect(sameText.tone).toBe('folded')
    expect(sameText.hits.map(atLine)).toEqual([`${T}MainTeleOp.java:26`])
    expect(view.sections.map((s) => s.id)).toEqual(['code', 'byName', 'sameText'])
    expect(view.empty).toBe(false)
    expect(view.unavailable).toBe(false)

    // 파일 묶음: 경로 순서, 파일마다 전체 개수, 첫 사용처
    const groups = fileGroups(code.hits)
    const subsystem = groups.find((group) => group.path === `${T}subsystems/LiftSubsystem.java`)!
    expect(subsystem.rows.map((hit) => `${hit.line}:${hit.col} ${hit.snippet}`)).toEqual([
      '15:14 lift.liftLeft.setPower(…)',
      '16:19 this.lift.liftLeft.setPower(…)'
    ])
    expect(subsystem.first).toBe(subsystem.rows[0])
    expect(groups.map((group) => group.path)).toEqual(
      [...new Set(expected.map((position) => position.split(':')[0]))].sort(compare)
    )
  })

  it('그룹·로봇 카드가 javac 정답표의 필드·형식·생성 사용처와 하위 장치 수를 보인다', async () => {
    const objects = corpusScene()
    await openCorpus(objects)
    const deviceCount = (device: { objectId: string; componentId: string }): number => {
      const { counts } = deviceView(objects, device)
      return counts.code + counts.byName
    }
    const LIFT_DEVICES = [
      LIFT_LEFT,
      { objectId: 'liftEncoder', componentId: 'enc' },
      { objectId: 'clawServo', componentId: 'grip' }
    ]

    // Lift 그룹: 연쇄가 lift에서 끝나는 필드와 형식 RobotHardware.Lift. 하위 장치 수는 Claw 그룹의 grip까지
    // 장치 카드의 코드·이름 수를 더한 것이다.
    const lift = groupUsageView(objects, result(), usage().baseline, 'lift')!
    const liftCode = section(lift, 'code')!
    expect(liftCode.hits.map(at).sort(compare)).toEqual(
      goldenPositions(/ (field RobotHardware\.lift|type RobotHardware\.Lift)$/)
    )
    expect(new Set(liftCode.hits.map((hit) => hit.kind))).toEqual(new Set(['field', 'type']))
    expect(lift.sections.map((s) => s.id)).toEqual(['code'])
    expect(lift.counts).toEqual({
      code: liftCode.total,
      byName: 0,
      descendants: LIFT_DEVICES.map(deviceCount).reduce((a, b) => a + b, 0),
      warnings: 0
    })

    // 로봇: 만드는 곳(new)과 형식·CONFIGURATION_NAME. Escapes.java는 건너뛴 파일이다.
    for (const [robotId, className] of [
      [COMP_ROBOT_ID, 'RobotHardware'],
      [PRACTICE_ROBOT_ID, 'PracticeBotHardware']
    ]) {
      const robot = robotUsageView(objects, result(), usage().baseline, robotId)!
      const constructs = section(robot, 'constructs')?.hits ?? []
      const code = section(robot, 'code')!.hits
      expect(constructs.every((hit) => hit.kind === 'new' && hit.snippet.startsWith('new '))).toBe(
        true
      )
      expect([...constructs, ...code].map(at).sort(compare)).toEqual(
        goldenPositions(new RegExp(` (type ${className}|const ${className}\\.CONFIGURATION_NAME)$`))
      )
      expect(robot.counts.code).toBe(constructs.length + code.length)
      expect(robot.counts.warnings).toBe(0)
      // 어느 로봇에도 없는 찾기 이름은 로봇 카드마다 모두 접어 두고 세지 않는다
      const unknown = section(robot, 'unknownNames')!
      expect(unknown.tone).toBe('folded')
      expect(unknown.hits.map(at).sort(compare)).toEqual(
        [...result().unknownNames.values()].flat().map(at).sort(compare)
      )
    }
    expect([...result().unknownNames.keys()]).toEqual(['leftBack', 'rightBack', 'rightFront'])
    const comp = robotUsageView(objects, result(), usage().baseline, COMP_ROBOT_ID)!
    expect(section(comp, 'constructs')!.hits.length).toBeGreaterThan(0)
    // 로봇의 하위 장치 수는 자리 수다. par 데드휠은 같은 포트 모터(leftFront)의 찾기 문자열을 함께 가져 한 번만 센다.
    const compDevices = [
      { objectId: 'drive', componentId: 'lf' },
      { objectId: 'odometry', componentId: 'par' },
      ...LIFT_DEVICES
    ]
    const places = new Set(
      compDevices.flatMap((device) => {
        const view = deviceView(objects, device)
        return ['code', 'byName'].flatMap((id) => section(view, id)?.hits ?? []).map(at)
      })
    )
    expect(comp.counts.descendants).toBe(places.size)
    expect(places.size).toBeLessThan(compDevices.map(deviceCount).reduce((a, b) => a + b, 0))
    expect(deviceView(objects, { objectId: 'odometry', componentId: 'par' }).samePortName).toBe(
      true
    )
  })

  it('이름을 바꾸면 파일을 읽지 않고 맞추기만 해서, 바꾼 카드에 이전 이름을 쓰는 곳을 붙인다', async () => {
    const objects = corpusScene()
    await openCorpus(objects)
    const reads = readCount()
    const matches = worker().matches

    // 장치(liftLeft → liftMain, par → parallel), 그룹(Claw → Gripper), 로봇 클래스(PracticeBotHardware → TestBotHardware)
    const renamed = renamedCorpusScene()
    await edit(renamed)
    expect(readCount()).toBe(reads)
    expect(workers).toHaveLength(1)
    expect(worker().matches).toBe(matches + 1)
    expect(usage().status).toBe('ready')

    // 장치 카드: 저장한 범위(Lift)에 없는 이전 필드 liftLeft. javac의 cannot find symbol(liftLeft)에서 받아들인
    // 한계만 빠진다.
    const missedLines = MISSED_LIFT_LEFT.map((position) =>
      position.split(':').slice(0, 2).join(':')
    )
    const expectedLines = golden('golden-renamed.txt')
      .filter((line) => line.endsWith(' liftLeft'))
      .map((line) => line.split(' ')[0])
      .filter((line) => !missedLines.includes(line))
      .sort(compare)
    const device = deviceView(renamed)
    const renamedCode = device.sections[0]
    expect(renamedCode).toMatchObject({
      id: 'renamedCode',
      tone: 'warning',
      old: 'robot.lift.liftLeft'
    })
    expect(renamedCode.hits.map(atLine).sort(compare)).toEqual(expectedLines)
    expect(renamedCode.hits.every((h) => h.kind === 'unresolved' && h.member === 'liftLeft')).toBe(
      true
    )
    expect(device.counts.warnings).toBe(expectedLines.length)
    // 지금 이름(liftMain)은 아무 데도 쓰지 않는다. "liftLeft" 문자열은 Practice Bot의 장치 것이라 구성에 없는
    // 이름이 아니다.
    expect(device.counts.code).toBe(0)
    expect(section(device, 'renamedName')).toBeUndefined()

    // 그룹 카드(Claw → Gripper): 부모 범위(Lift)에 없는 이전 필드 claw와 이전 멤버 형식 Claw
    const group = groupUsageView(renamed, result(), usage().baseline, 'claw')!
    expect(group.sections[0]).toMatchObject({ id: 'renamedCode', tone: 'warning' })
    expect(group.sections[0].old).toBe('robot.lift.claw, RobotHardware.Lift.Claw')
    const clawLines = golden('golden-renamed.txt')
      .filter((line) => line.endsWith(' claw') || line.endsWith(' Claw'))
      .map((line) => line.split(' ')[0])
      .sort(compare)
    expect(group.sections[0].hits.map(atLine).sort(compare)).toEqual(
      // static on-demand로 들여온 Claw는 찾지 않는다(spec §6.5, usageGolden.test.ts)
      clawLines.filter((line) => line !== `${T}Imports.java:11`)
    )

    // 로봇 카드(Practice Bot): 생성 패키지에 없는 이전 클래스 이름
    const practice = robotUsageView(renamed, result(), usage().baseline, PRACTICE_ROBOT_ID)!
    expect(practice.sections[0]).toMatchObject({
      id: 'renamedCode',
      old: 'PracticeBotHardware'
    })
    expect(practice.sections[0].hits.every((hit) => hit.member === 'PracticeBotHardware')).toBe(
      true
    )
    // Comp Bot 카드는 이 로봇 범위의 없는 이름과 '*'를 모두 보인다(장치·그룹 카드에 붙인 것도)
    const comp = robotUsageView(renamed, result(), usage().baseline, COMP_ROBOT_ID)!
    const unresolved = section(comp, 'unresolved')!
    expect(unresolved.total).toBe(
      [...result().unresolved.values()].reduce((sum, hits) => sum + hits.length, 0)
    )

    // 실행 취소로 저장한 이름에 돌아오면 다시 읽지 않고 모두 사라진다
    await edit(objects)
    expect(readCount()).toBe(reads)
    expect(worker().matches).toBe(matches + 2)
    expect(result().unresolved.size).toBe(0)
    const back = deviceView(objects)
    expect(back.sections.map((s) => s.id)).toEqual(['code', 'byName', 'sameText'])
    expect(back.counts.warnings).toBe(0)
  })

  it('구성 이름을 바꾸면 이전 필드·상수와 이전 구성 이름을 찾는 문자열을 그 장치 카드에 붙인다', async () => {
    const objects = corpusScene()
    await openCorpus(objects)
    const reads = readCount()

    const renamed = renameEncoder(objects, 'liftEncoder')
    await edit(renamed)
    expect(readCount()).toBe(reads)
    const view = deviceView(renamed, { objectId: 'liftEncoder', componentId: 'enc' })
    const renamedCode = section(view, 'renamedCode')!
    // 필드 enc(robot.lift.enc)와 상수 ENC_X_MM을 모두 쓰므로 제목에 둘 다 있다
    expect(renamedCode.old).toBe('robot.lift.enc, RobotHardware.Lift.ENC_X_MM')
    // 정답표에서 javac가 필드 enc·상수 ENC_X_MM에 묶은 자리가 모두 이전 이름이 된다. 중첩 클래스의 static
    // on-demand로 들여온 단순 이름(Imports.java:10)은 알리지 않는다(spec §6.5).
    const expected = golden('golden.txt')
      .filter((line) =>
        / (field RobotHardware\.Lift\.enc|const RobotHardware\.Lift\.ENC_X_MM)$/.test(line)
      )
      .map((line) => line.split(' ')[0])
      .filter((position) => position !== `${T}Imports.java:10:16`)
      .sort(compare)
    expect(renamedCode.hits.map(at).sort(compare)).toEqual(expected)
    expect(renamedCode.hits.map((hit) => hit.member).sort()).toEqual([
      ...Array<string>(6).fill('ENC_X_MM'),
      ...Array<string>(4).fill('enc')
    ])
    expect(view.counts).toEqual({ code: 0, byName: 0, descendants: 0, warnings: 11 })
    // "enc"를 찾는 문자열(같은 파일의 String 상수 초기값)은 이제 어느 장치에도 없는 이름이다
    const renamedName = section(view, 'renamedName')!
    expect(renamedName.old).toBe('enc')
    expect(renamedName.hits.map((hit) => `${atLine(hit)} ${hit.snippet}`)).toEqual([
      `${T}subsystems/LiftByName.java:11 ENCODER = "enc"`
    ])
    expect(view.sections.slice(0, 2).map((s) => s.id)).toEqual(['renamedCode', 'renamedName'])
  })

  it('저장해 생성 코드를 맞추면 저장한 씬으로 맞춘 결과에서 깨지는 곳을 경고 알림으로 알린다', async () => {
    const objects = corpusScene()
    await openCorpus(objects)
    const reads = readCount()

    // 이름을 바꾸고 저장: 생성 코드에 없는 이름(usagesBroken)과 이번 저장이 없앤 구성 이름 "enc"(usagesBrokenByName)
    const saved = renameEncoder(renamedCorpusScene(), 'liftEncoder')
    await edit(saved)
    useProjectStore.setState({
      generation: {
        status: 'synced',
        written: [],
        unchanged: [],
        deleted: [],
        skipped: [],
        modified: [],
        caseRenamed: []
      }
    })
    setUsageBaseline(saved)
    await checkUsagesAfterSave(objects, saved, Promise.resolve())
    expect(readCount()).toBe(reads)

    const typed = [...result().unresolved.values()].flat()
    const notices = useNoticeStore.getState().notices
    expect(notices.map((notice) => [notice.level, notice.key])).toEqual([
      ['warning', 'usagesBroken'],
      ['warning', 'usagesBrokenByName']
    ])
    expect(notices[0].params.count).toBe(typed.length)
    expect(typed.length).toBeGreaterThan(0)
    expect(String(notices[0].params.files).split(', ')).toHaveLength(4)
    expect(notices[0].params.files).toMatch(/…$/)
    expect(notices[1].params).toEqual({ count: 1, files: 'LiftByName.java' })

    // 저장한 뒤에는 이전 이름이 로봇 카드로 옮겨 간다(기준 씬 = 저장한 씬)
    const device = deviceView(saved)
    expect(section(device, 'renamedCode')).toBeUndefined()
    const comp = robotUsageView(saved, result(), usage().baseline, COMP_ROBOT_ID)!
    expect(section(comp, 'unresolved')!.total).toBe(typed.length)

    // 다시 저장한 이름으로 되돌려 저장하면 알림이 사라진다(교체)
    await edit(objects)
    setUsageBaseline(objects)
    await checkUsagesAfterSave(saved, objects, Promise.resolve())
    expect(useNoticeStore.getState().notices).toEqual([])
    expect(readCount()).toBe(reads)
  })
})
