import { describe, expect, it } from 'vitest'
import type { ExternalEditorState } from '../../../shared/ipc'
import {
  externalEditorChoice,
  externalEditorOptions,
  externalEditorValue
} from './externalEditorOptions'

const STUDIO = {
  id: 'android-studio',
  name: 'Android Studio',
  exe: 'C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe'
}
const CODE = { id: 'vscode', name: 'Visual Studio Code', exe: 'C:\\VSCode\\Code.exe' }

const state = (patch: Partial<ExternalEditorState>): ExternalEditorState => ({
  kind: 'system',
  detectedId: null,
  exe: null,
  args: null,
  defaultArgs: '"$(File)"',
  detected: [STUDIO, CODE],
  ...patch
})

describe('외부 스크립트 편집기 선택 상자', () => {
  it('확장자로 열기(기본), 찾은 편집기(제품 이름), 찾아보기 순이다', () => {
    const system = state({})
    expect(externalEditorValue(system)).toBe('system')
    expect(externalEditorOptions(system)).toEqual([
      { value: 'system', labelKey: 'openByExtension' },
      { value: 'detected:android-studio', text: 'Android Studio' },
      { value: 'detected:vscode', text: 'Visual Studio Code' },
      { value: 'browse', labelKey: 'browse' }
    ])
  })

  it('찾은 편집기를 고르면 그 항목이 값이다', () => {
    const detected = state({ kind: 'detected', detectedId: 'vscode', exe: CODE.exe })
    expect(externalEditorValue(detected)).toBe('detected:vscode')
    expect(externalEditorOptions(detected)).toHaveLength(4)
  })

  it('이번에 찾지 못한 저장된 편집기와 직접 고른 편집기는 실행 파일 이름으로 보인다', () => {
    const gone = state({ kind: 'detected', detectedId: 'idea', exe: 'D:\\IDEA\\bin\\idea64.exe' })
    expect(externalEditorValue(gone)).toBe('detected:idea')
    expect(externalEditorOptions(gone)).toContainEqual({
      value: 'detected:idea',
      text: 'idea64.exe'
    })
    const custom = state({ kind: 'custom', exe: '/opt/editor/bin/edit', args: '"$(File)"' })
    expect(externalEditorValue(custom)).toBe('custom')
    const options = externalEditorOptions(custom)
    expect(options.at(-2)).toEqual({ value: 'custom', text: 'edit' })
    expect(options.at(-1)).toEqual({ value: 'browse', labelKey: 'browse' })
  })

  it('고른 값을 메인에 보낼 선택으로 바꾼다(실행 파일 경로는 보내지 않는다)', () => {
    expect(externalEditorChoice('system', 'T')).toEqual({ kind: 'system' })
    expect(externalEditorChoice('detected:vscode', 'T')).toEqual({ kind: 'detected', id: 'vscode' })
    expect(externalEditorChoice('browse', 'Choose')).toEqual({ kind: 'browse', title: 'Choose' })
    expect(externalEditorChoice('custom', 'T')).toBeNull()
    expect(externalEditorChoice('detected:', 'T')).toBeNull()
    expect(externalEditorChoice('C:\\evil.exe', 'T')).toBeNull()
  })
})
