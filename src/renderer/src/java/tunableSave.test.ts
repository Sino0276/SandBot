import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  JavaLiteralEdit,
  ReadJavaFileResult,
  WriteJavaLiteralsResult
} from '../../../shared/ipc'
import { isLiteralSpanText } from '../../../shared/java/javaLiteral'
import type { TunableFile, TunableNode, TunableValueType } from '../../../shared/java/tunableTypes'
import { clearHistory, initHistory, redo, undo } from '../editor/history'
import { useNoticeStore } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import { useJavaSourcesStore } from './javaSources'
import {
  applyTunableSaveOutcome,
  isCompleteTunableSave,
  saveTunables,
  type TunableSaveOutcome
} from './tunableSave'

// 파서 대신 쓰는 작은 고정 형식 파서(이 테스트의 Java 글자만 읽는다): class 이름 하나와
// `public static <형식> <이름> = <초기값>;` 줄. 리터럴 하나가 아니면(식) 고칠 수 없다.
vi.mock('../../../shared/java/tunables', () => ({
  parseTunables: (text: string): TunableFile => {
    const className = /class (\w+)/.exec(text)?.[1] ?? 'X'
    const fields: TunableNode[] = []
    const pattern = /public static (double|float|int|long|boolean|String) (\w+) = ([^;]+);/g
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const literal = match[3]
      const start = match.index + match[0].length - 1 - literal.length
      const editable = isLiteralSpanText(literal)
      fields.push({
        kind: 'value',
        id: `${className}#${match[2]}`,
        name: match[2],
        type: match[1] as TunableValueType,
        boxed: false,
        literal,
        span: { start, end: start + literal.length },
        editable,
        ...(editable ? {} : { reason: 'expression' as const }),
        line: text.slice(0, match.index).split('\n').length
      })
    }
    return {
      blocks: [{ classPath: className, name: className, line: 1, fields }],
      // 주석 안의 \\u(이 테스트의 글자만)
      unicodeEscapes: /\/\/[^\n]*\\u/.test(text),
      staticFieldsWithoutConfig: false
    }
  }
}))

const ROOT = '/p'
const LIFT = 'src/main/java/a/Lift.java'
const ARM = 'src/main/java/a/Arm.java'

const field = (type: string, name: string, value: string): string =>
  `  public static ${type} ${name} = ${value};\n`
const lift = (...fields: string[]): string =>
  `// 주석\r\n@Config\r\npublic class Lift {\r\n${fields.join('')}}\r\n`

// 디스크(경로 → 내용)와 해시
let disk = new Map<string, string>()
const hashOf = (text: string): string =>
  `h${text.length}:${[...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)}`

const readJavaFile = vi.fn(async (_root: string, path: string): Promise<ReadJavaFileResult> => {
  const text = disk.get(path)
  if (text === undefined) return { ok: false, code: 'missing', detail: '' }
  return { ok: true, text, hash: hashOf(text), editable: true }
})

const writeJavaLiterals = vi.fn(
  async (
    _root: string,
    path: string,
    expectedHash: string,
    edits: JavaLiteralEdit[]
  ): Promise<WriteJavaLiteralsResult> => {
    let text = disk.get(path)
    if (text === undefined) return { status: 'missing' }
    if (hashOf(text) !== expectedHash) return { status: 'changed' }
    for (const edit of [...edits].reverse()) {
      if (text.slice(edit.start, edit.end) !== edit.expected)
        return { status: 'refused', reason: 'expected' }
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
    }
    disk.set(path, text)
    return { status: 'written', text, hash: hashOf(text) }
  }
)

const scene = (): ReturnType<typeof useSceneStore.getState> => useSceneStore.getState()
const noticeKeys = (): string[] => useNoticeStore.getState().notices.map((notice) => notice.key)

async function save(): Promise<TunableSaveOutcome> {
  const outcome = await saveTunables(ROOT, scene().tunables)
  applyTunableSaveOutcome(ROOT, outcome)
  return outcome
}

describe('튜닝 값 저장', () => {
  beforeEach(() => {
    disk = new Map()
    readJavaFile.mockReset()
    writeJavaLiterals.mockReset()
    vi.stubGlobal('window', { api: { readJavaFile, writeJavaLiterals } })
    useProjectStore.setState({ root: ROOT, session: 1 })
    useJavaSourcesStore.setState({ root: ROOT, session: 1, files: {} })
    useNoticeStore.setState({ notices: [] })
    initHistory()
    scene().replaceObjects({})
    clearHistory()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useProjectStore.setState(useProjectStore.getInitialState())
  })

  it('모두 쓰면 완료이고, 리터럴 자리만 바뀌며(CRLF·주석 그대로) 저장하지 않은 값이 사라진다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1'), field('int', 'n', '- 3')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    scene().setTunable(LIFT, 'Lift#n', '4', '-3')
    const outcome = await save()
    expect(isCompleteTunableSave(outcome)).toBe(true)
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kP', '0.25'), field('int', 'n', '4')))
    // 파일 하나에 쓰기 한 번, 바꿀 자리는 앞에서부터
    expect(writeJavaLiterals).toHaveBeenCalledTimes(1)
    const edits = writeJavaLiterals.mock.calls[0][3]
    expect(edits.map((edit) => edit.expected)).toEqual(['0.1', '- 3'])
    expect(scene().tunables).toEqual({})
    // 쓴 내용이 캐시에 들어간다(인스펙터가 새 디스크 값을 바로 보인다)
    const source = useJavaSourcesStore.getState().files[LIFT]
    expect(source?.status === 'ready' && source.hash).toBe(hashOf(disk.get(LIFT)!))
    expect(noticeKeys()).toEqual([])
    // 저장 뒤 실행 취소하면 이전 디스크 값이 저장하지 않은 값이 된다(부호 뒤 공백까지 원래 글자 그대로)
    expect(undo()).toBe(true)
    expect(scene().tunables[LIFT]['Lift#n']).toEqual({ value: '- 3', base: '4' })
    expect(isCompleteTunableSave(await save())).toBe(true)
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kP', '0.25'), field('int', 'n', '- 3')))
    expect(scene().tunables).toEqual({})
    // 다시 실행하면 그 저장의 디스크 값(4) 기준으로 맞춘 편집이 된다(base는 비교용 글자 '-3')
    expect(redo()).toBe(true)
    expect(scene().tunables[LIFT]['Lift#n']).toEqual({ value: '4', base: '-3' })
    expect(isCompleteTunableSave(await save())).toBe(true)
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kP', '0.25'), field('int', 'n', '4')))
  })

  it('다른 줄이 바뀐 것은 충돌이 아니다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    // Android Studio에서 앞에 필드를 더했다(위치가 밀림)
    disk.set(LIFT, lift(field('int', 'added', '1'), field('double', 'kP', '0.1')))
    expect(isCompleteTunableSave(await save())).toBe(true)
    expect(disk.get(LIFT)).toBe(lift(field('int', 'added', '1'), field('double', 'kP', '0.25')))
  })

  it('충돌: 그 필드의 디스크 값이 바뀌었으면 쓰지 않고 파일 값을 따르며 알린다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1'), field('double', 'kI', '0.0')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    scene().setTunable(LIFT, 'Lift#kI', '0.5', '0.0')
    disk.set(LIFT, lift(field('double', 'kP', '0.3'), field('double', 'kI', '0.0')))
    const outcome = await save()
    expect(isCompleteTunableSave(outcome)).toBe(false)
    expect(outcome.conflicts).toEqual([
      { path: LIFT, fieldId: 'Lift#kP', fileValue: '0.3', value: '0.25' }
    ])
    // 충돌하지 않은 필드는 쓴다
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kP', '0.3'), field('double', 'kI', '0.5')))
    expect(scene().tunables).toEqual({})
    const notice = useNoticeStore.getState().notices[0]
    expect(notice).toMatchObject({
      key: 'tunableConflict',
      params: { file: 'Lift.java', field: 'Lift.kP', fileValue: '0.3', value: '0.25' }
    })
    // 다음 저장은 알림을 바꾼다
    await save()
    expect(noticeKeys()).toEqual([])
  })

  it('충돌: 식이 됐거나 형식이 바뀌어 값이 맞지 않으면 쓰지 않는다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1'), field('double', 'kD', '1.0')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    scene().setTunable(LIFT, 'Lift#kD', '2.0', '1.0')
    disk.set(LIFT, lift(field('double', 'kP', 'Math.PI'), field('float', 'kD', '1.0')))
    const outcome = await save()
    expect(outcome.conflicts.map((conflict) => conflict.fieldId)).toEqual(['Lift#kP', 'Lift#kD'])
    expect(writeJavaLiterals).not.toHaveBeenCalled()
    expect(scene().tunables).toEqual({})
  })

  it('실패: 파일을 쓸 수 없는 상태면(읽기 전용 등) 쓰지 않고 그 파일의 값을 모두 남기며 이유를 알린다', async () => {
    const cases = [
      ['readOnly', 'tunableFileReadOnly'],
      ['tooLarge', 'tunableFileTooLarge'],
      ['encoding', 'tunableFileEncoding'],
      ['generated', 'tunableFileGenerated']
    ] as const
    for (const [reason, key] of cases) {
      disk.set(LIFT, lift(field('double', 'kP', '0.1'), field('double', 'kI', '0.0')))
      scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
      // 밖에서 바뀐 필드·없어진 필드도 파일을 고친 뒤 다음 저장이 정한다(지금 버리지 않는다)
      scene().setTunable(LIFT, 'Lift#kI', '0.5', '0.3')
      scene().setTunable(LIFT, 'Lift#gone', '1.0', '2.0')
      const before = scene().tunables
      readJavaFile.mockImplementationOnce(async () => ({
        ok: true,
        // 1 MB를 넘으면 내용이 없다(모든 필드가 없어 보이지만 없어진 것이 아니다)
        text: reason === 'tooLarge' ? '' : disk.get(LIFT)!,
        hash: reason === 'tooLarge' ? '' : 'x',
        editable: false,
        reason
      }))
      const outcome = await save()
      expect(outcome.failed, reason).toEqual([{ path: LIFT, reason }])
      expect(outcome.conflicts, reason).toEqual([])
      expect(outcome.missing, reason).toEqual([])
      expect(isCompleteTunableSave(outcome), reason).toBe(false)
      expect(writeJavaLiterals).not.toHaveBeenCalled()
      expect(scene().tunables, reason).toBe(before)
      expect(useNoticeStore.getState().notices, reason).toMatchObject([
        { level: 'error', key, params: { file: 'Lift.java' } }
      ])
      // 인스펙터 캐시도 쓸 수 없는 파일로 바뀐다
      expect(useJavaSourcesStore.getState().files[LIFT], reason).toMatchObject({
        status: 'ready',
        editable: false,
        reason
      })
    }
  })

  it('실패: 읽은 뒤 쓰기 전에 파일 상태가 바뀌어 거부되면(읽기 전용이 됨 등) 값을 남기고 이유를 알린다', async () => {
    const cases = [
      ['readOnly', 'tunableFileReadOnly'],
      ['tooLarge', 'tunableFileTooLarge'],
      ['encoding', 'tunableFileEncoding'],
      ['generated', 'tunableFileGenerated']
    ] as const
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    for (const [reason, key] of cases) {
      writeJavaLiterals.mockImplementationOnce(async () => ({ status: 'refused', reason }))
      const outcome = await save()
      expect(outcome.failed, reason).toEqual([{ path: LIFT, reason }])
      expect(isCompleteTunableSave(outcome), reason).toBe(false)
      expect(scene().tunables, reason).toEqual({
        [LIFT]: { 'Lift#kP': { value: '0.25', base: '0.1' } }
      })
      expect(noticeKeys(), reason).toEqual([key])
    }
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kP', '0.1')))
    // 파일을 고친 뒤 다시 저장하면 쓴다
    expect(isCompleteTunableSave(await save())).toBe(true)
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kP', '0.25')))
    expect(noticeKeys()).toEqual([])
  })

  it('파일이 없으면 버리고 값을 알린다', async () => {
    scene().setTunable(ARM, 'Arm#pos', '0.5', '0.1')
    const outcome = await save()
    expect(outcome.missing).toEqual([
      { path: ARM, file: true, fields: [{ fieldId: 'Arm#pos', value: '0.5' }] }
    ])
    expect(isCompleteTunableSave(outcome)).toBe(false)
    expect(scene().tunables).toEqual({})
    expect(useNoticeStore.getState().notices[0]).toMatchObject({
      key: 'tunableMissing',
      params: { file: 'Arm.java', fields: 'Arm.pos = 0.5' }
    })
    expect(useJavaSourcesStore.getState().files[ARM]).toEqual({ status: 'missing' })
  })

  it('필드가 없으면(이름이 바뀜) 그 필드만 버리고 나머지는 쓴다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1'), field('double', 'kI', '0.0')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    scene().setTunable(LIFT, 'Lift#kI', '0.5', '0.0')
    disk.set(LIFT, lift(field('double', 'kp', '0.1'), field('double', 'kI', '0.0')))
    const outcome = await save()
    expect(outcome.missing).toEqual([
      { path: LIFT, file: false, fields: [{ fieldId: 'Lift#kP', value: '0.25' }] }
    ])
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kp', '0.1'), field('double', 'kI', '0.5')))
    expect(scene().tunables).toEqual({})
  })

  it('이미 그 값이면 쓰지 않고 완료로 친다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    disk.set(LIFT, lift(field('double', 'kP', '0.25')))
    expect(isCompleteTunableSave(await save())).toBe(true)
    expect(writeJavaLiterals).not.toHaveBeenCalled()
    expect(scene().tunables).toEqual({})
  })

  it('[SandBot 값 쓰기]로 저장한 뒤 버튼을 되돌려도, 그 값이 이미 디스크 값이면 저장하지 않은 값이 남지 않는다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    scene().setTunable(LIFT, 'Lift#kP', '0.2', '0.1')
    // Android Studio에서 0.3이 됐고, [SandBot 값 쓰기]가 새 base로 다시 고쳤다
    disk.set(LIFT, lift(field('double', 'kP', '0.3')))
    scene().setTunable(LIFT, 'Lift#kP', '0.2', '0.3')
    expect(isCompleteTunableSave(await save())).toBe(true)
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kP', '0.2')))
    // 버튼을 누르기 전 문서({0.2, base 0.1})는 디스크 값(0.2)과 같다
    expect(undo()).toBe(true)
    expect(scene().tunables).toEqual({})
  })

  it('읽은 뒤 파일이 바뀌면(changed) 다시 읽고 한 번 더 쓴다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    writeJavaLiterals.mockImplementationOnce(async () => {
      // 그 사이 Android Studio가 다른 줄을 저장했다
      disk.set(LIFT, lift(field('int', 'n', '1'), field('double', 'kP', '0.1')))
      return { status: 'changed' }
    })
    const outcome = await save()
    expect(isCompleteTunableSave(outcome)).toBe(true)
    expect(readJavaFile).toHaveBeenCalledTimes(2)
    expect(writeJavaLiterals).toHaveBeenCalledTimes(2)
    expect(disk.get(LIFT)).toBe(lift(field('int', 'n', '1'), field('double', 'kP', '0.25')))
  })

  it('두 번 모두 바뀌면 실패로 두고 값을 남긴다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    writeJavaLiterals
      .mockImplementationOnce(async () => ({ status: 'changed' }))
      .mockImplementationOnce(async () => ({ status: 'changed' }))
    const outcome = await save()
    expect(writeJavaLiterals).toHaveBeenCalledTimes(2)
    expect(outcome.failed).toEqual([{ path: LIFT, reason: 'changed' }])
    expect(scene().tunables[LIFT]['Lift#kP']).toEqual({ value: '0.25', base: '0.1' })
    expect(noticeKeys()).toEqual(['tunableFileBusy'])
  })

  it('쓰기 실패(I/O 오류·거부)는 값을 남기고 알린다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    disk.set(ARM, `public class Arm {\n${field('double', 'pos', '0.1')}}\n`)
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    scene().setTunable(ARM, 'Arm#pos', '0.5', '0.1')
    const ipcError = new Error(
      "Error invoking remote method 'teamcode:write-java-literals': Error: EPERM"
    )
    writeJavaLiterals.mockImplementationOnce(async () => {
      throw ipcError
    })
    const outcome = await save()
    // 파일 순서대로 한다: Lift는 실패, Arm은 썼다
    expect(outcome.failed).toEqual([{ path: LIFT, reason: 'error', detail: 'EPERM' }])
    expect(scene().tunables).toEqual({ [LIFT]: { 'Lift#kP': { value: '0.25', base: '0.1' } } })
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kP', '0.1')))
    expect(useNoticeStore.getState().notices[0]).toMatchObject({
      key: 'tunableWriteFailed',
      params: { file: 'Lift.java', detail: 'EPERM' }
    })
    // 읽기 실패도 같다
    readJavaFile.mockImplementationOnce(async () => ({ ok: false, code: 'failed', detail: 'EIO' }))
    const again = await save()
    expect(again.failed).toEqual([{ path: LIFT, reason: 'error', detail: 'EIO' }])
    expect(scene().tunables[LIFT]).toBeDefined()
    // 파일 상태가 아닌 그 밖의 거부는 메인의 이유를 그대로 보인다
    writeJavaLiterals.mockImplementationOnce(async () => ({
      status: 'refused',
      reason: 'expected text does not match'
    }))
    const refused = await save()
    expect(refused.failed).toEqual([
      { path: LIFT, reason: 'error', detail: 'expected text does not match' }
    ])
    expect(isCompleteTunableSave(refused)).toBe(false)
    expect(useNoticeStore.getState().notices).toMatchObject([
      {
        key: 'tunableWriteFailed',
        params: { file: 'Lift.java', detail: 'expected text does not match' }
      }
    ])
    expect(scene().tunables[LIFT]['Lift#kP']).toEqual({ value: '0.25', base: '0.1' })
  })

  it('메인이 받지 않는 파일이 됐으면(밖을 가리키는 링크 등, notAllowed) 없는 파일처럼 버리고 알린다(카드가 보일 수 없음)', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    readJavaFile.mockImplementationOnce(async () => ({
      ok: false,
      code: 'notAllowed',
      detail: 'outside TeamCode/src/main/java'
    }))
    const read = await save()
    expect(read.failed).toEqual([])
    expect(read.missing).toEqual([
      { path: LIFT, file: true, notAllowed: true, fields: [{ fieldId: 'Lift#kP', value: '0.25' }] }
    ])
    expect(isCompleteTunableSave(read)).toBe(false)
    expect(useNoticeStore.getState().notices).toMatchObject([
      { key: 'tunableFileNotAllowed', params: { file: 'Lift.java', fields: 'Lift.kP = 0.25' } }
    ])
    expect(scene().tunables[LIFT]).toBeUndefined()
    // 쓰는 순간 링크가 됐어도(쓰기 거부) 같다
    scene().setTunable(LIFT, 'Lift#kP', '0.3', '0.1')
    writeJavaLiterals.mockImplementationOnce(async () => ({
      status: 'refused',
      reason: 'notAllowed: became a link'
    }))
    const written = await save()
    expect(written.failed).toEqual([])
    expect(written.missing).toMatchObject([{ path: LIFT, notAllowed: true }])
    expect(noticeKeys()).toEqual(['tunableFileNotAllowed'])
    expect(scene().tunables[LIFT]).toBeUndefined()
  })
  it('실패: 리터럴 밖에 \\u가 생겼으면(파일 전체가 읽기 전용) 충돌로 버리지 않고 값을 남긴다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    const escaped = lift(field('double', 'kP', '0.1')).replace('// 주석', '// 30\\u00B0')
    disk.set(LIFT, escaped)
    const outcome = await save()
    expect(outcome.failed).toEqual([{ path: LIFT, reason: 'unicodeEscape' }])
    expect(outcome.conflicts).toEqual([])
    expect(writeJavaLiterals).not.toHaveBeenCalled()
    expect(noticeKeys()).toEqual(['tunableFileUnicodeEscape'])
    expect(scene().tunables).toEqual({ [LIFT]: { 'Lift#kP': { value: '0.25', base: '0.1' } } })
    // \\u를 지우면 다음 저장이 쓴다
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    expect(isCompleteTunableSave(await save())).toBe(true)
    expect(disk.get(LIFT)).toBe(lift(field('double', 'kP', '0.25')))
  })

  it('저장하는 동안 다시 고친 값은 충돌이어도 지금 문서에서 빼지 않는다', async () => {
    disk.set(LIFT, lift(field('double', 'kP', '0.1')))
    scene().setTunable(LIFT, 'Lift#kP', '0.25', '0.1')
    disk.set(LIFT, lift(field('double', 'kP', '0.3')))
    const pending = saveTunables(ROOT, scene().tunables)
    // 인스펙터가 ⚠ 파일 값 0.3을 보고 다시 입력했다(새 base)
    scene().setTunable(LIFT, 'Lift#kP', '0.4', '0.3')
    applyTunableSaveOutcome(ROOT, await pending)
    expect(scene().tunables[LIFT]['Lift#kP']).toEqual({ value: '0.4', base: '0.3' })
  })
})
