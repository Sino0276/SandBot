import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RevealSimFileResult } from '../../../shared/ipc'
import { useNoticeStore } from '../editor/noticeStore'
import { revealSimFile } from './simFiles'

// Console의 Road Runner 튜닝 결과 줄 → 파일 관리자(메인 revealSimFile). 실패는 알림으로 알리고 같은 알림이 쌓이지 않는다.

const FILE = '/u/sim-files/abc/FIRST/RoadRunner/tuning/forward-ramp/1793363559542.json'

describe('모의 저장소 파일 보이기', () => {
  let answer: RevealSimFileResult | Error
  const reveal = vi.fn(async (): Promise<RevealSimFileResult> => {
    if (answer instanceof Error) throw answer
    return answer
  })
  const notices = (): string[] =>
    useNoticeStore
      .getState()
      .notices.map((notice) => `${notice.level} ${notice.key} ${notice.params.fileName}`)

  beforeEach(() => {
    answer = { ok: true }
    reveal.mockClear()
    useNoticeStore.setState({ notices: [] })
    vi.stubGlobal('window', { api: { revealSimFile: reveal } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('그 프로젝트와 절대 경로를 메인에 보낸다(확인은 메인이 한다)', async () => {
    await revealSimFile('/p', FILE)
    expect(reveal).toHaveBeenCalledWith('/p', FILE)
    expect(notices()).toEqual([])
  })

  it('지웠으면 경고, 그 밖의 실패는 오류 알림이고, 다시 누르면 이전 알림을 지운다', async () => {
    answer = { ok: false, code: 'missing', detail: FILE }
    await revealSimFile('/p', FILE)
    expect(notices()).toEqual(['warning simFileMissing 1793363559542.json'])
    answer = { ok: false, code: 'notAllowed', detail: 'outside the simulated storage' }
    await revealSimFile('/p', FILE)
    expect(notices()).toEqual(['error simFileRevealFailed 1793363559542.json'])
    answer = new Error("Error invoking remote method 'play:reveal-sim-file': Error: boom")
    await revealSimFile('/p', 'C:\\Users\\t\\FIRST\\a.json')
    expect(useNoticeStore.getState().notices.map((n) => n.params)).toEqual([
      { fileName: 'a.json', detail: 'boom' }
    ])
    answer = { ok: true }
    await revealSimFile('/p', FILE)
    expect(notices()).toEqual([])
  })
})
