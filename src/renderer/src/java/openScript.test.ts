import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JavaFileList, OpenJavaFileResult } from '../../../shared/ipc'
import { useNoticeStore } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import {
  ipcErrorDetail,
  openScriptFile,
  resetLineSupport,
  resetOpenScriptState,
  useLineSupportStore
} from './openScript'

const PATH = 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java'

describe('스크립트 열기', () => {
  const openJavaFile = vi.fn((): Promise<OpenJavaFileResult> => Promise.resolve({ ok: true }))
  const listJavaFiles = vi.fn((): Promise<JavaFileList> =>
    Promise.resolve({ files: [], truncated: false, hasTeamCode: true })
  )
  const notices = (): { level: string; key: string; params: Record<string, unknown> }[] =>
    useNoticeStore.getState().notices.map(({ level, key, params }) => ({ level, key, params }))

  beforeEach(() => {
    // 앞 테스트의 mockResolvedValue를 지우고 처음 구현({ ok: true })으로 되돌린다
    openJavaFile.mockReset()
    listJavaFiles.mockClear()
    vi.stubGlobal('window', { api: { openJavaFile, listJavaFiles } })
    useProjectStore.setState({ root: '/team', session: 1 })
    useNoticeStore.setState({ notices: [] })
    resetOpenScriptState()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useProjectStore.setState(useProjectStore.getInitialState())
    useNoticeStore.setState({ notices: [] })
    resetOpenScriptState()
  })

  it('열린 프로젝트와 TeamCode 기준 경로를 메인에 넘기고, 성공하면 알리지 않는다', async () => {
    await openScriptFile(PATH)
    expect(openJavaFile).toHaveBeenCalledWith('/team', PATH, undefined)
    expect(notices()).toEqual([])
  })

  it('프로젝트가 없으면 열지 않는다', async () => {
    useProjectStore.setState({ root: null })
    await openScriptFile(PATH)
    expect(openJavaFile).not.toHaveBeenCalled()
  })

  it('실패 이유마다 알리고, 다시 열면 이전 실패 알림을 지운다', async () => {
    const cases: [OpenJavaFileResult, string, string][] = [
      [{ ok: false, code: 'openFailed', detail: 'no app' }, 'error', 'scriptOpenFailed'],
      [{ ok: false, code: 'launchFailed', detail: 'ENOENT' }, 'error', 'scriptLaunchFailed'],
      [{ ok: false, code: 'notAllowed', detail: '' }, 'error', 'scriptNotAllowed'],
      [{ ok: false, code: 'missing', detail: '' }, 'warning', 'scriptMissing']
    ]
    for (const [result, level, key] of cases) {
      openJavaFile.mockResolvedValueOnce(result)
      await openScriptFile(PATH)
      expect(notices()).toEqual([
        {
          level,
          key,
          params: expect.objectContaining({ fileName: 'Lift.java' })
        }
      ])
    }
    expect(notices()[0].params).not.toHaveProperty('detail')
    // 없으면 옮겨졌을 수 있으므로 목록을 다시 읽는다(카드가 [다시 연결]을 보인다)
    expect(listJavaFiles).toHaveBeenCalledWith('/team')
    await openScriptFile(PATH)
    expect(notices()).toEqual([])
  })

  it('편집기 이유(detail)를 알림에 넣는다', async () => {
    openJavaFile.mockResolvedValueOnce({ ok: false, code: 'launchFailed', detail: 'EACCES' })
    await openScriptFile(PATH)
    expect(notices()[0].params).toMatchObject({ detail: 'EACCES' })
    openJavaFile.mockRejectedValueOnce(
      new Error("Error invoking remote method 'teamcode:open-java-file': Error: boom")
    )
    await openScriptFile(PATH)
    expect(notices()).toEqual([
      { level: 'error', key: 'scriptOpenFailed', params: { fileName: 'Lift.java', detail: 'boom' } }
    ])
  })

  it('편집기가 줄 번호를 받지 못하면(lineIgnored) 앱을 켠 동안 한 번만 알린다', async () => {
    openJavaFile.mockResolvedValue({ ok: true, lineIgnored: true })
    await openScriptFile(PATH, 12)
    expect(openJavaFile).toHaveBeenCalledWith('/team', PATH, 12)
    expect(notices()).toEqual([{ level: 'warning', key: 'lineIgnored', params: {} }])
    // 다음 열기가 지우지 않고(실패 알림과 다름), 다시 띄우지도 않는다
    await openScriptFile(PATH, 20)
    expect(notices()).toHaveLength(1)
    useNoticeStore.setState({ notices: [] })
    await openScriptFile(PATH, 30)
    // 편집기 설정을 바꿔도 다시 띄우지 않는다
    resetLineSupport()
    await openScriptFile(PATH, 40)
    expect(notices()).toEqual([])
    // 실패 알림은 그대로 띄운다
    openJavaFile.mockResolvedValueOnce({ ok: false, code: 'launchFailed', detail: 'ENOENT' })
    await openScriptFile(PATH, 50)
    expect(notices().map((notice) => notice.key)).toEqual(['scriptLaunchFailed'])
  })

  it('줄 번호를 받는지(useLineSupportStore)는 줄을 넘겨 연 결과로 정한다', async () => {
    const support = (): string => useLineSupportStore.getState().support
    expect(support()).toBe('unknown')
    // 줄을 넘기지 않으면 알 수 없다
    openJavaFile.mockResolvedValueOnce({ ok: true })
    await openScriptFile(PATH)
    expect(support()).toBe('unknown')
    openJavaFile.mockResolvedValueOnce({ ok: true, lineIgnored: true })
    await openScriptFile(PATH, 3)
    expect(support()).toBe('no')
    // 실패는 바꾸지 않는다
    openJavaFile.mockResolvedValueOnce({ ok: false, code: 'missing', detail: '' })
    await openScriptFile(PATH, 3)
    openJavaFile.mockRejectedValueOnce(new Error('boom'))
    await openScriptFile(PATH, 3)
    expect(support()).toBe('no')
    openJavaFile.mockResolvedValueOnce({ ok: true })
    await openScriptFile(PATH, 3)
    expect(support()).toBe('yes')
    // 편집기 설정을 바꾸면(환경 설정 창) 다시 모른다
    resetLineSupport()
    expect(support()).toBe('unknown')
  })

  it('IPC 오류 메시지의 채널 머리말을 뗀다', () => {
    expect(ipcErrorDetail(new Error("Error invoking remote method 'x:y': Error: bad"))).toBe('bad')
    expect(ipcErrorDetail('plain')).toBe('plain')
  })
})
