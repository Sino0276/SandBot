import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JavaFileList, OpenJavaFileResult } from '../../../shared/ipc'
import { useNoticeStore } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import { ipcErrorDetail, openScriptFile } from './openScript'

const PATH = 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java'

describe('스크립트 열기', () => {
  const openJavaFile = vi.fn((): Promise<OpenJavaFileResult> => Promise.resolve({ ok: true }))
  const listJavaFiles = vi.fn((): Promise<JavaFileList> =>
    Promise.resolve({ files: [], truncated: false, hasTeamCode: true })
  )
  const notices = (): { level: string; key: string; params: Record<string, unknown> }[] =>
    useNoticeStore.getState().notices.map(({ level, key, params }) => ({ level, key, params }))

  beforeEach(() => {
    openJavaFile.mockClear()
    listJavaFiles.mockClear()
    vi.stubGlobal('window', { api: { openJavaFile, listJavaFiles } })
    useProjectStore.setState({ root: '/team', session: 1 })
    useNoticeStore.setState({ notices: [] })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useProjectStore.setState(useProjectStore.getInitialState())
    useNoticeStore.setState({ notices: [] })
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

  it('IPC 오류 메시지의 채널 머리말을 뗀다', () => {
    expect(ipcErrorDetail(new Error("Error invoking remote method 'x:y': Error: bad"))).toBe('bad')
    expect(ipcErrorDetail('plain')).toBe('plain')
  })
})
