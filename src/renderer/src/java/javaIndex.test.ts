import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JavaFileList } from '../../../shared/ipc'
import { useProjectStore } from '../project/projectStore'
import {
  buildJavaIndex,
  FOCUS_REFRESH_DELAY,
  refreshJavaIndex,
  relinkCandidate,
  scriptChoices,
  scheduleFocusRefresh,
  scriptLinkStatus,
  useJavaIndexStore
} from './javaIndex'

const P = 'src/main/java/org/firstinspires/ftc/teamcode/'
const file = (path: string, mtimeMs = 1): { path: string; size: number; mtimeMs: number } => ({
  path,
  size: 10,
  mtimeMs
})

describe('Java 인덱스 만들기', () => {
  it('클래스 이름은 경로에서 만들고, 연결할 수 없는 경로는 뺀다', () => {
    const files = buildJavaIndex([
      file(`${P}mech/Lift.java`),
      file(`${P}Drive.java`),
      // 생성 패키지(대소문자 무시), Java 식별자가 아닌 폴더, Windows 장치 이름, 다른 폴더
      file(`${P}sandbot/RobotHardware.java`),
      file(`${P}SANDBOT/Other.java`),
      file(`${P}my-folder/Arm.java`),
      file(`${P}AUX.java`),
      file('src/test/java/Foo.java'),
      // 같은 경로는 한 번만
      file(`${P}Drive.java`)
    ])
    expect(files.map((entry) => entry.path)).toEqual([`${P}Drive.java`, `${P}mech/Lift.java`])
    expect(files[1]).toMatchObject({
      className: 'org.firstinspires.ftc.teamcode.mech.Lift',
      simpleName: 'Lift',
      packageName: 'org.firstinspires.ftc.teamcode.mech'
    })
  })

  it('NFD 경로(macOS)는 NFC로 바꿔 담는다', () => {
    const nfd = `${P}리프트.java`.normalize('NFD')
    const [entry] = buildJavaIndex([file(nfd)])
    expect(entry.path).toBe(`${P}리프트.java`.normalize('NFC'))
    expect(entry.simpleName).toBe('리프트'.normalize('NFC'))
  })
})

describe('다시 연결 후보', () => {
  const files = buildJavaIndex([
    file(`${P}mech/Lift.java`),
    file(`${P}Arm.java`),
    file(`${P}a/Claw.java`),
    file(`${P}b/Claw.java`)
  ])
  const link = (path: string): { path: string; className: string } => ({
    path,
    className: path.slice('src/main/java/'.length, -'.java'.length).split('/').join('.')
  })

  it('같은 이름의 파일이 하나뿐이면 그것을 고른다', () => {
    expect(relinkCandidate(files, link(`${P}Lift.java`))?.path).toBe(`${P}mech/Lift.java`)
  })

  it('같은 클래스 이름(패키지 포함)을 파일 이름보다 먼저 본다', () => {
    const moved = { path: `${P}old/Claw.java`, className: 'org.firstinspires.ftc.teamcode.a.Claw' }
    expect(relinkCandidate(files, moved)?.path).toBe(`${P}a/Claw.java`)
  })

  it('대소문자만 바꾼 이름(파일·폴더)은 그 경로를 먼저 고른다', () => {
    const renamed = buildJavaIndex([
      file(`${P}LiftSubsystem.java`),
      file(`${P}subsystems/Arm.java`)
    ])
    expect(relinkCandidate(renamed, link(`${P}Liftsubsystem.java`))?.path).toBe(
      `${P}LiftSubsystem.java`
    )
    expect(relinkCandidate(renamed, link(`${P}Subsystems/Arm.java`))?.path).toBe(
      `${P}subsystems/Arm.java`
    )
  })

  it('후보가 여럿이거나 없으면 고르지 않고, 파일이 있으면 후보가 없다', () => {
    expect(relinkCandidate(files, link(`${P}c/Claw.java`))).toBeNull()
    expect(relinkCandidate(files, link(`${P}Intake.java`))).toBeNull()
    expect(relinkCandidate(files, link(`${P}Arm.java`))).toBeNull()
  })

  it('카드 상태: 프로젝트·목록 상태에 따라 찾음·없음·확인 못 함', () => {
    const ready = { status: 'ready' as const, root: '/p', files, truncated: false }
    expect(scriptLinkStatus(ready, null, link(`${P}Arm.java`))).toEqual({ kind: 'noProject' })
    expect(scriptLinkStatus(ready, '/other', link(`${P}Arm.java`))).toEqual({ kind: 'checking' })
    expect(scriptLinkStatus(ready, '/p', link(`${P}Arm.java`))).toEqual({ kind: 'found' })
    expect(scriptLinkStatus(ready, '/p', link(`${P}Lift.java`))).toMatchObject({
      kind: 'missing',
      candidate: { path: `${P}mech/Lift.java` }
    })
    expect(scriptLinkStatus({ ...ready, truncated: true }, '/p', link(`${P}Lift.java`))).toEqual({
      kind: 'unknown'
    })
    expect(scriptLinkStatus({ ...ready, status: 'failed' }, '/p', link(`${P}Lift.java`))).toEqual({
      kind: 'unknown'
    })
    expect(
      scriptLinkStatus({ ...ready, status: 'noTeamCode', files: [] }, '/p', link(`${P}Arm.java`))
    ).toEqual({ kind: 'noTeamCode' })
  })
})

describe('선택창 항목', () => {
  const files = buildJavaIndex([
    file(`${P}mech/Lift.java`),
    file(`${P}mech/LiftTuner.java`),
    file(`${P}opmodes/TeleOpLift.java`),
    file(`${P}lift/Arm.java`),
    file(`${P}Drive.java`)
  ])
  const names = (entries: { simpleName: string }[]): string[] => entries.map((e) => e.simpleName)

  it('이미 연결한 파일은 빼고 클래스 이름 순으로 보인다', () => {
    expect(names(scriptChoices(files, new Set([`${P}Drive.java`]), ''))).toEqual([
      'Arm',
      'Lift',
      'LiftTuner',
      'TeleOpLift'
    ])
  })

  it('검색어: 클래스 이름 앞부분, 클래스 이름 안, 경로 순(대소문자 무시)', () => {
    expect(names(scriptChoices(files, new Set(), 'LIFT'))).toEqual([
      'Lift',
      'LiftTuner',
      'TeleOpLift',
      'Arm'
    ])
    expect(names(scriptChoices(files, new Set(), 'nope'))).toEqual([])
  })
})

describe('다시 읽기', () => {
  let resolvers: ((list: JavaFileList) => void)[] = []
  const listJavaFiles = vi.fn(
    () =>
      new Promise<JavaFileList>((resolve) => {
        resolvers.push(resolve)
      })
  )
  const list = (paths: string[], hasTeamCode = true): JavaFileList => ({
    files: paths.map((path) => file(path)),
    truncated: false,
    hasTeamCode
  })
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    resolvers = []
    listJavaFiles.mockClear()
    vi.stubGlobal('window', { api: { listJavaFiles } })
    useProjectStore.setState({ root: '/p', session: 1 })
    useJavaIndexStore.setState(useJavaIndexStore.getInitialState())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useProjectStore.setState(useProjectStore.getInitialState())
  })

  it('읽는 중에 온 요청은 모아서, 끝난 뒤 한 번만 더 읽는다', async () => {
    const first = refreshJavaIndex()
    expect(useJavaIndexStore.getState()).toMatchObject({ status: 'loading', root: '/p' })
    const second = refreshJavaIndex()
    const third = refreshJavaIndex()
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(listJavaFiles).toHaveBeenCalledTimes(1)
    resolvers[0](list([`${P}Lift.java`]))
    await settle()
    expect(listJavaFiles).toHaveBeenCalledTimes(2)
    resolvers[1](list([`${P}Lift.java`, `${P}Arm.java`]))
    await first
    expect(useJavaIndexStore.getState().files.map((e) => e.simpleName)).toEqual(['Arm', 'Lift'])
    expect(useJavaIndexStore.getState().status).toBe('ready')
  })

  it('읽는 사이 다른 프로젝트를 열었으면 결과를 버리고 새 프로젝트를 읽는다', async () => {
    const done = refreshJavaIndex()
    useProjectStore.setState({ root: '/q', session: 2 })
    void refreshJavaIndex()
    resolvers[0](list([`${P}Old.java`]))
    await settle()
    expect(useJavaIndexStore.getState()).toMatchObject({ status: 'loading', root: '/q', files: [] })
    expect(listJavaFiles).toHaveBeenLastCalledWith('/q')
    resolvers[1](list([`${P}New.java`]))
    await done
    expect(useJavaIndexStore.getState().files.map((e) => e.simpleName)).toEqual(['New'])
  })

  it('목록이 같으면 revision을 올리지 않고, TeamCode가 없으면 noTeamCode', async () => {
    const run = async (result: JavaFileList): Promise<void> => {
      const done = refreshJavaIndex()
      resolvers[resolvers.length - 1](result)
      await done
    }
    await run(list([`${P}Lift.java`]))
    const revision = useJavaIndexStore.getState().revision
    await run(list([`${P}Lift.java`]))
    expect(useJavaIndexStore.getState().revision).toBe(revision)
    await run(list([], false))
    expect(useJavaIndexStore.getState()).toMatchObject({ status: 'noTeamCode', files: [] })
  })

  it('읽기에 실패하면 이전 목록을 두고 failed로 표시한다', async () => {
    const ok = refreshJavaIndex()
    resolvers[0](list([`${P}Lift.java`]))
    await ok
    listJavaFiles.mockImplementationOnce(() => Promise.reject(new Error('notAllowed')))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await refreshJavaIndex()
    expect(useJavaIndexStore.getState()).toMatchObject({ status: 'failed' })
    expect(useJavaIndexStore.getState().files).toHaveLength(1)
    error.mockRestore()
  })
})

describe('창 포커스로 다시 읽기', () => {
  const listJavaFiles = vi.fn((): Promise<JavaFileList> =>
    Promise.resolve({ files: [file(`${P}Lift.java`)], truncated: false, hasTeamCode: true })
  )

  beforeEach(() => {
    vi.useFakeTimers()
    listJavaFiles.mockClear()
    vi.stubGlobal('window', { api: { listJavaFiles } })
    useProjectStore.setState({ root: '/p', session: 1, busy: false })
    useJavaIndexStore.setState(useJavaIndexStore.getInitialState())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useProjectStore.setState(useProjectStore.getInitialState())
  })

  it('짧은 사이에 여러 번 온 포커스는 마지막 뒤 한 번만 읽는다', async () => {
    scheduleFocusRefresh()
    await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_DELAY - 50)
    scheduleFocusRefresh()
    await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_DELAY - 50)
    scheduleFocusRefresh()
    expect(listJavaFiles).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_DELAY)
    expect(listJavaFiles).toHaveBeenCalledTimes(1)
    expect(useJavaIndexStore.getState()).toMatchObject({ status: 'ready', root: '/p' })
  })

  it('열기·저장 중(busy)이면 건너뛰고, 프로젝트가 없으면 읽지 않는다', async () => {
    useProjectStore.setState({ busy: true })
    scheduleFocusRefresh()
    await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_DELAY * 2)
    expect(listJavaFiles).not.toHaveBeenCalled()
    useProjectStore.setState({ busy: false, root: null })
    scheduleFocusRefresh()
    await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_DELAY * 2)
    expect(listJavaFiles).not.toHaveBeenCalled()
    expect(useJavaIndexStore.getState().status).toBe('none')
  })
})
