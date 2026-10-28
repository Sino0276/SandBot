import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpModeInfo } from '../../../shared/play'
import { cancelNotice, useNoticeStore } from '../editor/noticeStore'
import { installLibraryNotice, libraryNoticeText } from './libraryNotice'
import { newRun, usePlayStore } from './playStore'

const OPMODE: OpModeInfo = {
  className: 'org.firstinspires.ftc.teamcode.Auto',
  path: 'src/main/java/org/firstinspires/ftc/teamcode/Auto.java',
  line: 1,
  flavor: 'Autonomous',
  name: 'Auto',
  group: '',
  preselectTeleOp: ''
}

const run = (runId: string): ReturnType<typeof newRun> =>
  newRun({
    runId,
    root: '/p',
    opMode: OPMODE,
    robotId: null,
    configPath: null,
    speed: 1,
    paused: false
  })

describe('라이브러리 받기 진행 알림', () => {
  let uninstall: () => void
  const onCancel = vi.fn()

  beforeEach(() => {
    useNoticeStore.setState({ notices: [] })
    usePlayStore.setState({ run: run('r1') })
    uninstall = installLibraryNotice(onCancel)
  })

  afterEach(() => {
    uninstall()
    usePlayStore.setState({ run: null })
    useNoticeStore.setState({ notices: [] })
    onCancel.mockReset()
  })

  const setProgress = (progress: ReturnType<typeof newRun>['libraryProgress']): void =>
    usePlayStore.setState((state) => ({
      run: state.run && { ...state.run, libraryProgress: progress }
    }))

  it('진행이 오면 진행 알림(취소 가능)을 띄우고 같은 알림을 고쳐 쓴다', () => {
    setProgress({ phase: 'resolving', done: 2, total: 5, bytes: 100 })
    const [notice] = useNoticeStore.getState().notices
    expect(notice).toMatchObject({
      level: 'progress',
      key: 'libraryResolving',
      params: { done: 2, size: '100 B' },
      cancellable: true
    })
    setProgress({ phase: 'downloading', done: 1, total: 3, bytes: 4096 })
    const notices = useNoticeStore.getState().notices
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      id: notice.id,
      key: 'libraryDownloading',
      params: { done: 1, total: 3, size: '4 KB' },
      startedAt: notice.startedAt
    })
    cancelNotice(notice.id)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('보고가 오거나(진행이 지워짐) 실행이 사라지면 닫는다', () => {
    setProgress({ phase: 'downloading', done: 0, total: 1, bytes: 0 })
    expect(useNoticeStore.getState().notices).toHaveLength(1)
    setProgress(null)
    expect(useNoticeStore.getState().notices).toHaveLength(0)
    setProgress({ phase: 'downloading', done: 0, total: 1, bytes: 0 })
    usePlayStore.setState({ run: null })
    expect(useNoticeStore.getState().notices).toHaveLength(0)
  })

  it('다른 실행의 진행이면 새 알림', () => {
    setProgress({ phase: 'downloading', done: 0, total: 1, bytes: 0 })
    const first = useNoticeStore.getState().notices[0].id
    usePlayStore.setState({
      run: { ...run('r2'), libraryProgress: { phase: 'downloading', done: 0, total: 2, bytes: 0 } }
    })
    const notices = useNoticeStore.getState().notices
    expect(notices).toHaveLength(1)
    expect(notices[0].id).not.toBe(first)
  })

  it('문구', () => {
    expect(libraryNoticeText({ phase: 'reading', done: 0, total: 0, bytes: 0 }).key).toBe(
      'libraryResolving'
    )
  })
})
