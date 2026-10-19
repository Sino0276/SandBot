import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyLiteralEdits, checkLiteralEdits } from '../../../main/teamCodeJava'
import type {
  JavaLiteralEdit,
  ReadJavaFileResult,
  WriteJavaLiteralsResult
} from '../../../shared/ipc'
import { parseTunables } from '../../../shared/java/tunables'
import { clearHistory, initHistory, undo } from '../editor/history'
import { useNoticeStore } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import { useJavaSourcesStore } from './javaSources'
import {
  diskLiteralKey,
  tunableEditValue,
  tunableNodes,
  type TunableValueNode
} from './tunableEdits'
import {
  applyTunableSaveOutcome,
  isCompleteTunableSave,
  saveTunables,
  type TunableSaveOutcome
} from './tunableSave'

// 저장 → 실행 취소 → 다시 저장하면 파일이 바이트 단위로 원래대로 돌아오는지(git diff가 빈다).
// 실제 파서·실행 취소 기록·저장 흐름에, 쓰기는 메인의 검사(checkLiteralEdits)와 바꾸기(applyLiteralEdits)를 그대로 쓴다.
const ROOT = '/p'
const PATH = 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java'

let disk = ''
const hashOf = (text: string): string => `${text.length}:${text}`

const readJavaFile = vi.fn(async (): Promise<ReadJavaFileResult> => ({
  ok: true,
  text: disk,
  hash: hashOf(disk),
  editable: true
}))
const writeJavaLiterals = vi.fn(
  async (
    _root: string,
    _path: string,
    hash: string,
    edits: JavaLiteralEdit[]
  ): Promise<WriteJavaLiteralsResult> => {
    if (hash !== hashOf(disk)) return { status: 'changed' }
    const problem = checkLiteralEdits(disk, edits)
    if (problem) return { status: 'refused', reason: problem }
    disk = applyLiteralEdits(disk, edits)
    return { status: 'written', text: disk, hash: hashOf(disk) }
  }
)

const scene = (): ReturnType<typeof useSceneStore.getState> => useSceneStore.getState()

// 인스펙터 입력칸 확정과 같은 일
function type(id: string, input: string): void {
  const node = tunableNodes(parseTunables(disk)).get(id) as TunableValueNode
  const value = tunableEditValue(node, input)
  expect(value, input).not.toBeNull()
  scene().setTunable(PATH, id, value!, diskLiteralKey(node)!)
}

async function save(): Promise<TunableSaveOutcome> {
  const outcome = await saveTunables(ROOT, scene().tunables)
  applyTunableSaveOutcome(ROOT, outcome)
  return outcome
}

const lift = (declaration: string): string =>
  [
    'package org.firstinspires.ftc.teamcode;',
    '',
    'import com.acmerobotics.dashboard.config.Config;',
    '',
    '@Config',
    'public class Lift {',
    `    public static ${declaration}; // 튜닝 값`,
    '}',
    ''
  ].join('\r\n')

// RR 1.0 MecanumDrive처럼 객체(PARAMS) 안의 인스턴스 필드
const mecanum = [
  'package org.firstinspires.ftc.teamcode;',
  '',
  'import com.acmerobotics.dashboard.config.Config;',
  '',
  '@Config',
  'public final class Lift {',
  '    public static class Params {',
  '        public double inPerTick = 1;',
  '        public double kS = 0;',
  '        public double kV = 0;',
  '    }',
  '',
  '    public static Params PARAMS = new Params();',
  '}',
  ''
].join('\r\n')

describe('저장 뒤 실행 취소하고 다시 저장하면 원래 글자로 돌아간다', () => {
  beforeEach(() => {
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

  // [원래 파일, 고칠 필드, 입력]
  const cases: [string, string, string, string][] = [
    ['double kS = 0 (RR Params)', mecanum, 'Lift.Params#kS', '0.5'],
    ['long 5', lift('long kP = 5'), 'Lift#kP', '7'],
    ['int 0x10', lift('int kP = 0x10'), 'Lift#kP', '7'],
    ['double 1_000.5', lift('double kP = 1_000.5'), 'Lift#kP', '7'],
    ['int +5', lift('int kP = +5'), 'Lift#kP', '7'],
    ['float 1.5F', lift('float kP = 1.5F'), 'Lift#kP', '7'],
    ['double 2.5d', lift('double kP = 2.5d'), 'Lift#kP', '7'],
    ['double .5', lift('double kP = .5'), 'Lift#kP', '7'],
    ['int 010', lift('int kP = 010'), 'Lift#kP', '7'],
    ['Double 0.0', lift('Double kP = 0.0'), 'Lift#kP', '7'],
    ['Long 5L', lift('Long kP = 5L'), 'Lift#kP', '7']
  ]

  for (const [label, original, id, input] of cases) {
    it(label, async () => {
      disk = original
      type(id, input)
      const first = await save()
      expect(isCompleteTunableSave(first)).toBe(true)
      expect(disk).not.toBe(original)
      expect(scene().tunables).toEqual({})

      expect(undo()).toBe(true)
      expect(Object.keys(scene().tunables[PATH] ?? {})).toEqual([id])

      const second = await save()
      expect(isCompleteTunableSave(second)).toBe(true)
      expect(useNoticeStore.getState().notices).toEqual([])
      expect(scene().tunables).toEqual({})
      expect(disk).toBe(original)
    })
  }

  it('쓸 수 없는 디스크 글자(날 탭이 든 문자열)는 같은 값의 정규 리터럴로 되돌린다', async () => {
    const original = lift('String NAME = "a\tb"')
    disk = original
    type('Lift#NAME', 'x')
    expect(isCompleteTunableSave(await save())).toBe(true)
    expect(undo()).toBe(true)
    const second = await save()
    expect(isCompleteTunableSave(second)).toBe(true)
    expect(useNoticeStore.getState().notices).toEqual([])
    expect(scene().tunables).toEqual({})
    expect(disk).toBe(original.replace('"a\tb"', '"a\\tb"'))
  })
})
