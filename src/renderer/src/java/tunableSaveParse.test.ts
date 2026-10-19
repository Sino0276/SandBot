import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  JavaLiteralEdit,
  ReadJavaFileResult,
  WriteJavaLiteralsResult
} from '../../../shared/ipc'
import { parseTunables } from '../../../shared/java/tunables'
import { clearHistory, initHistory } from '../editor/history'
import { useNoticeStore } from '../editor/noticeStore'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import { useJavaSourcesStore } from './javaSources'
import {
  diskLiteralKey,
  displayTunable,
  tunableEditValue,
  tunableNodes,
  type TunableValueNode
} from './tunableEdits'
import { applyTunableSaveOutcome, isCompleteTunableSave, saveTunables } from './tunableSave'

// 실제 파서(shared/java/tunables.ts)로 인스펙터 편집 → 저장까지. 쓰기는 메인처럼 바꿀 자리만 이어 붙인다.
const PATH = 'src/main/java/org/firstinspires/ftc/teamcode/MecanumDrive.java'
const SOURCE = [
  '﻿package org.firstinspires.ftc.teamcode;',
  '',
  'import com.acmerobotics.dashboard.config.Config;',
  '',
  '// 한국어 주석: 드라이브 튜닝 값',
  '@Config',
  'public final class MecanumDrive {',
  '    public static class Params {',
  '        public double inPerTick = 1;',
  '        public double lateralInPerTick = inPerTick;',
  '        public boolean useImu = true;',
  '    }',
  '',
  '    public static Params PARAMS = new Params();',
  '    public static double kP = - 0.5, kI = 2;',
  '    public static String label = "드라이브";',
  '    public static final double TRACK = 12;',
  '}',
  ''
].join('\r\n')

let disk = SOURCE
const hashOf = (text: string): string => `${text.length}:${text.slice(-40)}:${text}`

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
    let text = disk
    for (const edit of [...edits].reverse()) {
      if (text.slice(edit.start, edit.end) !== edit.expected)
        return { status: 'refused', reason: 'expected' }
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
    }
    disk = text
    return { status: 'written', text, hash: hashOf(text) }
  }
)

const node = (id: string): TunableValueNode => {
  const found = tunableNodes(parseTunables(disk)).get(id)
  if (found?.kind !== 'value') throw new Error(`no value ${id}`)
  return found
}

// 인스펙터 입력칸 확정과 같은 일
function type(id: string, input: string): void {
  const field = node(id)
  const value = tunableEditValue(field, input)
  if (value === null) return
  useSceneStore.getState().setTunable(PATH, id, value, diskLiteralKey(field)!)
}

describe('튜닝 값 저장(실제 파서)', () => {
  beforeEach(() => {
    disk = SOURCE
    vi.stubGlobal('window', { api: { readJavaFile, writeJavaLiterals } })
    useProjectStore.setState({ root: '/p', session: 1 })
    useJavaSourcesStore.setState({ root: '/p', session: 1, files: {} })
    useNoticeStore.setState({ notices: [] })
    initHistory()
    useSceneStore.getState().replaceObjects({})
    clearHistory()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useProjectStore.setState(useProjectStore.getInitialState())
  })

  it('객체 자식·부호 있는 값·boolean·문자열을 쓰고, 리터럴 밖의 글자(BOM·CRLF·주석)는 그대로 둔다', async () => {
    expect(displayTunable(node('MecanumDrive#kP'), undefined, true).text).toBe('-0.5')
    type('MecanumDrive.Params#inPerTick', '0.5')
    type('MecanumDrive#kP', '-0.25')
    // 같은 값을 다른 글자로 입력(double 2를 2.0으로)한 것은 변경이 아니다
    type('MecanumDrive#kI', '2.0')
    expect(useSceneStore.getState().tunables[PATH]?.['MecanumDrive#kI']).toBeUndefined()
    // 받을 수 없는 입력은 버린다
    type('MecanumDrive#kI', 'abc')
    type('MecanumDrive#label', '앞 "A"')
    type('MecanumDrive.Params#useImu', 'false')
    expect(Object.keys(useSceneStore.getState().tunables[PATH])).toHaveLength(4)

    const outcome = await saveTunables('/p', useSceneStore.getState().tunables)
    applyTunableSaveOutcome('/p', outcome)
    expect(isCompleteTunableSave(outcome)).toBe(true)
    expect(disk).toBe(
      SOURCE.replace('inPerTick = 1;', 'inPerTick = 0.5;')
        .replace('useImu = true', 'useImu = false')
        .replace('kP = - 0.5', 'kP = -0.25')
        .replace('"드라이브"', '"앞 \\"A\\""')
    )
    expect(disk.startsWith('﻿')).toBe(true)
    expect(disk.split('\r\n')).toHaveLength(SOURCE.split('\r\n').length)
    expect(useSceneStore.getState().tunables).toEqual({})
    // 쓴 내용이 캐시에 들어가 인스펙터가 새 값을 보인다
    const source = useJavaSourcesStore.getState().files[PATH]
    expect(source?.status).toBe('ready')
    if (source?.status !== 'ready') return
    const kP = tunableNodes(source.tunables).get('MecanumDrive#kP') as TunableValueNode
    expect(displayTunable(kP, undefined, true).text).toBe('-0.25')
  })

  it('식(lateralInPerTick = inPerTick)과 final 필드는 고칠 수 없다', () => {
    const nodes = tunableNodes(parseTunables(disk))
    expect(nodes.get('MecanumDrive.Params#lateralInPerTick')).toMatchObject({
      editable: false,
      reason: 'expression'
    })
    expect(nodes.has('MecanumDrive#TRACK')).toBe(false)
  })
})
