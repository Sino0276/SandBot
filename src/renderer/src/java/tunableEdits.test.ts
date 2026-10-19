import { beforeEach, describe, expect, it } from 'vitest'
import type { TunableFile, TunableNode } from '../../../shared/java/tunableTypes'
import { clearHistory, initHistory, redo, rewriteTunableHistory, undo } from '../editor/history'
import type { SceneObjects } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import {
  displayTunable,
  editsWithoutRow,
  hasTunableEdits,
  NO_TUNABLE_EDITS,
  rebaseAfterWrite,
  tunableEditValue,
  tunableFieldLabel,
  tunableInputLiteral,
  tunableNodes,
  sameLiteralKey,
  withoutTunable,
  withTunable,
  type TunableEdits,
  type TunableWrite
} from './tunableEdits'

const LIFT = 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java'
const KP = 'Lift#kP'

describe('튜닝 값 편집(순수 함수)', () => {
  it('디스크 값과 다를 때만 항목을 두고, 바뀐 것이 없으면 같은 참조다', () => {
    const one = withTunable(NO_TUNABLE_EDITS, LIFT, KP, '0.2', '0.1')
    expect(one).toEqual({ [LIFT]: { [KP]: { value: '0.2', base: '0.1' } } })
    expect(hasTunableEdits(one)).toBe(true)
    expect(withTunable(one, LIFT, KP, '0.2', '0.1')).toBe(one)
    // 디스크 값을 다시 입력하면 항목(과 빈 파일 키)이 사라진다
    const back = withTunable(one, LIFT, KP, '0.1', '0.1')
    expect(back).toEqual({})
    expect(hasTunableEdits(back)).toBe(false)
    // 없는 항목을 디스크 값으로 두는 것은 변경이 아니다
    expect(withTunable(NO_TUNABLE_EDITS, LIFT, KP, '0.1', '0.1')).toBe(NO_TUNABLE_EDITS)
  })

  it('같은 파일의 다른 필드는 남기고 하나만 지운다', () => {
    let edits = withTunable(NO_TUNABLE_EDITS, LIFT, KP, '0.2', '0.1')
    edits = withTunable(edits, LIFT, 'Lift#kI', '3', '1')
    expect(withoutTunable(edits, LIFT, KP)).toEqual({
      [LIFT]: { 'Lift#kI': { value: '3', base: '1' } }
    })
    expect(withoutTunable(edits, LIFT, 'Lift#none')).toBe(edits)
    expect(withoutTunable(withoutTunable(edits, LIFT, KP), LIFT, 'Lift#kI')).toEqual({})
  })

  it('rebase: 쓴 필드의 항목은 사라지고, 항목이 없던 문서는 이전 디스크 값을 저장하지 않은 값으로 갖는다', () => {
    const writes: TunableWrite[] = [
      { path: LIFT, fieldId: KP, before: '0.1', after: '0.2', restore: '0.1' }
    ]
    const written = withTunable(NO_TUNABLE_EDITS, LIFT, KP, '0.2', '0.1')
    expect(rebaseAfterWrite(written, writes)).toEqual({})
    expect(rebaseAfterWrite(NO_TUNABLE_EDITS, writes)).toEqual({
      [LIFT]: { [KP]: { value: '0.1', base: '0.2' } }
    })
    // 다른 값을 보던 편집(base가 다름)은 그대로 둔다(저장할 때 충돌로 처리)
    const stale = withTunable(NO_TUNABLE_EDITS, LIFT, KP, '0.5', '0.3')
    expect(rebaseAfterWrite(stale, writes)).toBe(stale)
    // 쓴 것과 관계없는 필드는 그대로
    const other = withTunable(NO_TUNABLE_EDITS, LIFT, 'Lift#kI', '3', '1')
    expect(rebaseAfterWrite(other, writes)).toEqual({
      [LIFT]: { 'Lift#kI': { value: '3', base: '1' }, [KP]: { value: '0.1', base: '0.2' } }
    })
  })

  it('rebase: 항목이 없던 문서는 before 대신 restore(되돌려 쓸 리터럴)를 갖는다', () => {
    // 쓸 수 없는 디스크 글자(날 탭이 든 문자열)는 같은 값의 정규 리터럴로 되돌린다
    const writes: TunableWrite[] = [
      { path: LIFT, fieldId: 'Lift#NAME', before: '"a\tb"', after: '"x"', restore: '"a\\tb"' }
    ]
    expect(rebaseAfterWrite(NO_TUNABLE_EDITS, writes)).toEqual({
      [LIFT]: { 'Lift#NAME': { value: '"a\\tb"', base: '"x"' } }
    })
  })

  it('rebase: 다른 디스크 값을 보던 편집이라도 값이 이미 새 디스크 값이면 지운다', () => {
    const writes: TunableWrite[] = [
      { path: LIFT, fieldId: KP, before: '0.3', after: '0.2', restore: '0.3' }
    ]
    // 0.1을 보고 0.2로 고친 편집(그 뒤 밖에서 0.3이 됐다가 SandBot이 0.2를 썼다)
    const sameValue = withTunable(NO_TUNABLE_EDITS, LIFT, KP, '0.2', '0.1')
    expect(rebaseAfterWrite(sameValue, writes)).toEqual({})
    // 값이 다르면 그대로(저장할 때 충돌)
    const otherValue = withTunable(NO_TUNABLE_EDITS, LIFT, KP, '0.25', '0.1')
    expect(rebaseAfterWrite(otherValue, writes)).toBe(otherValue)
  })

  it('알림의 필드 이름', () => {
    expect(tunableFieldLabel('MecanumDrive.Params#kS')).toBe('MecanumDrive.Params.kS')
  })
})

// 저장을 흉내 낸다: 파일에 쓰고 기록 전체를 새 디스크 값 기준으로 옮긴다(java/tunableSave.ts와 같은 순서)
function save(writes: TunableWrite[]): void {
  rewriteTunableHistory((tunables) => rebaseAfterWrite(tunables, writes))
}

// 저장 대상: 지금 문서의 항목마다 base → value로 쓴다(디스크가 base와 같다고 본다)
function writesOf(tunables: TunableEdits): TunableWrite[] {
  return Object.entries(tunables).flatMap(([path, fields]) =>
    Object.entries(fields).map(([fieldId, { value, base }]) => ({
      path,
      fieldId,
      before: base,
      after: value,
      restore: base
    }))
  )
}

describe('저장 뒤 실행 취소(rebase)', () => {
  const objects: SceneObjects = {}
  // 디스크 값(파일). 인스펙터는 편집할 때 이 값을 base로 넘긴다.
  let disk = '0.1'
  const state = (): ReturnType<typeof useSceneStore.getState> => useSceneStore.getState()
  const edit = (value: string): void => state().setTunable(LIFT, KP, value, disk)
  const entry = (): unknown => state().tunables[LIFT]?.[KP]
  // 인스펙터에 보이는 값(저장하지 않은 값 ?? 디스크 값)
  const shown = (): string => state().tunables[LIFT]?.[KP]?.value ?? disk
  const dirty = (): boolean => hasTunableEdits(state().tunables)
  const saveNow = (): void => {
    const writes = writesOf(state().tunables)
    for (const write of writes) disk = write.after
    save(writes)
  }

  beforeEach(() => {
    initHistory()
    state().replaceObjects(objects)
    clearHistory()
    disk = '0.1'
  })

  it('저장한 뒤 실행 취소하면 dirty가 되고, 다시 저장하면 파일이 이전 값으로 돌아간다', () => {
    edit('0.2')
    saveNow()
    expect(disk).toBe('0.2')
    expect(dirty()).toBe(false)
    expect(undo()).toBe(true)
    expect(dirty()).toBe(true)
    expect(shown()).toBe('0.1')
    expect(entry()).toEqual({ value: '0.1', base: '0.2' })
    // 두 번째 저장
    saveNow()
    expect(disk).toBe('0.1')
    expect(dirty()).toBe(false)
  })

  it('저장 뒤 실행 취소·저장 뒤 다시 실행하면 저장했던 값이 다시 저장하지 않은 값이 된다', () => {
    edit('0.2')
    saveNow()
    undo()
    saveNow()
    expect(redo()).toBe(true)
    expect(dirty()).toBe(true)
    expect(shown()).toBe('0.2')
    expect(entry()).toEqual({ value: '0.2', base: '0.1' })
    saveNow()
    expect(disk).toBe('0.2')
    expect(dirty()).toBe(false)
    // 기록은 그대로 이어진다
    expect(undo()).toBe(true)
    expect(shown()).toBe('0.1')
  })

  it('다른 디스크 값을 보던 이전 편집은 rebase가 건드리지 않는다', () => {
    // 디스크가 밖에서 0.3이 된 뒤 고친 편집(base 0.3)
    disk = '0.3'
    edit('0.5')
    const stale = state().tunables
    // 그 사이 다른 경로로 0.3 → 0.4를 썼다(이 편집과 관계없는 저장)
    save([{ path: LIFT, fieldId: KP, before: '0.1', after: '0.4', restore: '0.1' }])
    expect(state().tunables).toBe(stale)
  })

  it('저장하는 동안 고친 값은 저장하지 않은 값으로 남는다', () => {
    edit('0.2')
    // 저장을 시작할 때 잡은 편집
    const writes = writesOf(state().tunables)
    // 쓰기가 끝나기 전에 다시 고쳤다(인스펙터는 아직 이전 디스크 값 0.1을 base로 쓴다)
    edit('0.3')
    disk = '0.2'
    save(writes)
    expect(dirty()).toBe(true)
    expect(entry()).toEqual({ value: '0.3', base: '0.2' })
    // 그 편집을 되돌리면 저장한 값(0.2)이라 깨끗하다
    undo()
    expect(dirty()).toBe(false)
    expect(shown()).toBe('0.2')
    // 한 번 더 되돌리면 저장 전 값(0.1)을 저장하지 않은 값으로 갖는다
    undo()
    expect(entry()).toEqual({ value: '0.1', base: '0.2' })
  })

  it('저장하는 동안 실행 취소하면 이전 값이 저장하지 않은 값이 되고, 다시 실행하면 깨끗하다', () => {
    edit('0.2')
    const writes = writesOf(state().tunables)
    undo()
    disk = '0.2'
    save(writes)
    expect(dirty()).toBe(true)
    expect(shown()).toBe('0.1')
    expect(redo()).toBe(true)
    expect(dirty()).toBe(false)
    expect(shown()).toBe('0.2')
  })

  it('디스크 값을 다시 입력하면 항목이 사라져 깨끗하고, 실행 취소 한 단계다', () => {
    edit('0.2')
    edit('0.1')
    expect(dirty()).toBe(false)
    expect(undo()).toBe(true)
    expect(shown()).toBe('0.2')
    expect(undo()).toBe(true)
    expect(dirty()).toBe(false)
    expect(undo()).toBe(false)
  })
})

describe('튜닝 값 표시', () => {
  const kP: Extract<TunableNode, { kind: 'value' }> = {
    kind: 'value',
    id: KP,
    name: 'kP',
    type: 'double',
    boxed: false,
    literal: '0.5',
    span: { start: 10, end: 13 },
    editable: true,
    line: 3
  }
  const kS: TunableNode = { ...kP, id: 'MecanumDrive.Params#kS', name: 'kS' }
  const file: TunableFile = {
    blocks: [
      { classPath: 'Lift', name: 'Lift', line: 1, fields: [kP] },
      {
        classPath: 'MecanumDrive',
        name: 'MecanumDrive',
        line: 5,
        fields: [
          {
            kind: 'object',
            id: 'MecanumDrive#PARAMS',
            name: 'PARAMS',
            typeName: 'Params',
            text: 'new Params()',
            children: [kS],
            line: 6
          },
          // 같은 형식의 두 번째 static 필드는 자식 id를 나눠 쓴다(처음 것을 찾는다)
          {
            kind: 'object',
            id: 'MecanumDrive#OTHER',
            name: 'OTHER',
            typeName: 'Params',
            text: 'new Params()',
            children: [{ ...kS, line: 99 }],
            line: 7
          }
        ]
      }
    ],
    unicodeEscapes: false,
    staticFieldsWithoutConfig: false
  }

  it('객체의 자식까지 id로 찾는다', () => {
    const nodes = tunableNodes(file)
    expect(nodes.get(KP)).toBe(kP)
    expect(nodes.get('MecanumDrive.Params#kS')).toBe(kS)
    expect(nodes.get('MecanumDrive#PARAMS')?.kind).toBe('object')
    expect(tunableNodes(file)).toBe(nodes)
  })

  it('값 칸이 없는 편집(읽지 않은 파일, 없어진 필드, 값이 아니게 된 id)을 따로 고른다', () => {
    const edits = {
      [KP]: { value: '0.2', base: '0.5' },
      'Lift#gone': { value: '1.0', base: '2.0' },
      'MecanumDrive#PARAMS': { value: '1.0', base: '2.0' }
    }
    expect(editsWithoutRow(edits, file)).toEqual([
      ['Lift#gone', { value: '1.0', base: '2.0' }],
      ['MecanumDrive#PARAMS', { value: '1.0', base: '2.0' }]
    ])
    // 1 MB를 넘어 내용이 없거나 읽지 못한 파일이면 모두
    expect(editsWithoutRow(edits, null).map(([id]) => id)).toEqual([
      KP,
      'Lift#gone',
      'MecanumDrive#PARAMS'
    ])
    expect(editsWithoutRow(undefined, file)).toEqual([])
  })

  it('되돌릴 원래 글자(- 5)는 비교용 글자(-5)와 같은 값이다(파일 값 알림을 띄우지 않는다)', () => {
    expect(sameLiteralKey('- 5', '-5')).toBe(true)
    expect(sameLiteralKey('-\t5', '-5')).toBe(true)
    expect(sameLiteralKey('-5', '-5')).toBe(true)
    expect(sameLiteralKey('- 5', '5')).toBe(false)
    expect(sameLiteralKey('"a  b"', '"a  b"')).toBe(true)
    expect(sameLiteralKey('"a"', '"b"')).toBe(false)
    const minus = { ...kP, type: 'int' as const, literal: '-5' }
    expect(displayTunable(minus, { value: '- 5', base: '7' }, true)).toEqual({
      text: '-5',
      pending: true,
      fileValue: null
    })
    // 저장 뒤 기록: 그 값이 새 디스크 값이면 항목이 남지 않는다
    const write: TunableWrite = { path: LIFT, fieldId: KP, before: '7', after: '-5', restore: '7' }
    expect(rebaseAfterWrite(withTunable(NO_TUNABLE_EDITS, LIFT, KP, '- 5', '7'), [write])).toEqual(
      {}
    )
  })

  it('저장하지 않은 값을 먼저 보이고, 편집할 때 본 값과 디스크 값이 다르면 파일 값을 알린다', () => {
    expect(displayTunable(kP, undefined, true)).toEqual({
      text: '0.5',
      pending: false,
      fileValue: null
    })
    expect(displayTunable(kP, { value: '0.25', base: '0.5' }, true)).toEqual({
      text: '0.25',
      pending: true,
      fileValue: null
    })
    // 다른 편집기에서 0.5가 됐다(편집은 0.3을 보고 했다)
    expect(displayTunable(kP, { value: '0.25', base: '0.3' }, true).fileValue).toBe('0.5')
    // 접미사는 빼고 보인다
    const f = { ...kP, type: 'float' as const, literal: '2.5f' }
    expect(displayTunable(f, undefined, true).text).toBe('2.5')
    expect(displayTunable(f, { value: '3.0f', base: '2.5f' }, true).text).toBe('3.0')
    // 비교는 정규화한 글자로 한다('- 1'과 '-1')
    const negative = { ...kP, literal: '- 1.0' }
    expect(displayTunable(negative, { value: '2.0', base: '-1.0' }, true).fileValue).toBeNull()
    // 밖에서 SandBot 값과 같은 값으로 고쳤으면 ⚠를 띄우지 않는다(다음 저장이 항목을 지운다)
    expect(displayTunable(kP, { value: '0.5', base: '0.3' }, true)).toEqual({
      text: '0.5',
      pending: true,
      fileValue: null
    })
  })

  it('[SandBot 값 쓰기]는 저장하지 않은 값을 지금 형식으로 다시 만들고, 받을 수 없으면 null(버튼을 숨긴다)', () => {
    // TunablesList: kept = tunableEditValue(node, displayTunable(...).text)
    const keep = (node: typeof kP, value: string, base: string): string | null =>
      tunableEditValue(node, displayTunable(node, { value, base }, true).text)
    // double 0.25를 고치는 동안 밖에서 float 0.7f가 됐다
    const asFloat = { ...kP, type: 'float' as const, literal: '0.7f' }
    expect(keep(asFloat, '0.25', '0.5')).toBe('0.25f')
    // long → Long: Long에는 L이 있어야 한다
    const asLong = { ...kP, type: 'long' as const, boxed: true, literal: '7L' }
    expect(keep(asLong, '5', '6')).toBe('5L')
    // double → int: 0.25는 int로 받을 수 없다
    const asInt = { ...kP, type: 'int' as const, literal: '3' }
    expect(keep(asInt, '0.25', '0.5')).toBeNull()
    // 같은 형식이면 저장하지 않은 값 그대로
    expect(keep({ ...kP, literal: '0.7' }, '0.25', '0.5')).toBe('0.25')
  })

  it('디스크 값과 같은 값을 다른 글자로 입력하면 디스크 리터럴(항목 없음)이다', () => {
    const two = { ...kP, literal: '2' }
    expect(tunableEditValue(two, '2.0')).toBe('2')
    expect(tunableEditValue(two, '2.5')).toBe('2.5')
    const hex = { ...kP, type: 'int' as const, literal: '0x10' }
    expect(tunableEditValue(hex, '16')).toBe('0x10')
    expect(tunableEditValue(hex, '17')).toBe('17')
    expect(tunableEditValue(hex, '1.5')).toBeNull()
    // 리터럴의 형식이 필드 형식과 다르면 Java처럼 넓힌 값으로 비교한다
    const mask = { ...kP, type: 'long' as const, literal: '0xFFFFFFFF' }
    expect(displayTunable(mask, undefined, true).text).toBe('-1')
    expect(tunableEditValue(mask, '-1')).toBe('0xFFFFFFFF')
    expect(tunableEditValue(mask, '4294967295')).toBe('4294967295L')
    const floatInDouble = { ...kP, literal: '0.1f' }
    expect(displayTunable(floatInDouble, undefined, true).text).toBe('0.10000000149011612')
    expect(tunableEditValue(floatInDouble, '0.10000000149011612')).toBe('0.1f')
    expect(tunableEditValue(floatInDouble, '0.1')).toBe('0.1')
    const intInFloat = { ...kP, type: 'float' as const, literal: '16777217' }
    expect(displayTunable(intInFloat, undefined, true).text).toBe('16777216')
    expect(tunableEditValue(intInFloat, '16777216')).toBe('16777217')
    const flag = { ...kP, type: 'boolean' as const, literal: 'true' }
    expect(tunableEditValue(flag, 'false')).toBe('false')
    expect(tunableEditValue(flag, 'true')).toBe('true')
  })

  it('입력 → 리터럴: 형식에 맞게 접미사를 붙이고, 받을 수 없으면 null', () => {
    expect(tunableInputLiteral('double', '1')).toBe('1.0')
    expect(tunableInputLiteral('float', '2.5')).toBe('2.5f')
    expect(tunableInputLiteral('long', '5')).toBe('5L')
    expect(tunableInputLiteral('int', '1.5')).toBeNull()
    expect(tunableInputLiteral('String', 'a"b')).toBe('"a\\"b"')
  })
})
