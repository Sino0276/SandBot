import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashConfigNode } from '../../../shared/dashboard'
import type { ReadJavaFileResult } from '../../../shared/ipc'
import { sourceFromRead, useJavaSourcesStore, type JavaSource } from '../java/javaSources'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import {
  applyConfigValue,
  ensureConfigSource,
  localConfigSource,
  syncConfigSourcesRun,
  useConfigSourcesStore
} from './dashConfigApply'
import {
  checkApply,
  configInputValue,
  configPathKey,
  configRows,
  configValues,
  extendBaseline,
  hasChangedValue,
  tunableTarget
} from './dashConfigModel'

type ValueNode = Extract<DashConfigNode, { kind: 'value' }>

const LIFT_PATH = 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java'
const LIFT = `package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.config.Config;

@Config
public class Lift {
    public static double kP = 0.5;
    public static int TICKS = 10;
    public static float GAIN = 0.25f;
    public static long LIMIT = 5L;
    public static boolean ENABLED = false;
    public static String NAME = "lift";
    public static double HALF = 1.0 / 2;
    public static Mode MODE = Mode.UP;
    public static Params PARAMS = new Params();

    public enum Mode { UP, DOWN }

    public static class Params {
        public double kS = 0.1;
    }
}
`

const value = (
  type: ValueNode['type'],
  current: string,
  field: string | null,
  declaringClass = 'org.firstinspires.ftc.teamcode.Lift'
): ValueNode => ({
  kind: 'value',
  type,
  value: current,
  enumValues: type === 'enum' ? ['UP', 'DOWN'] : [],
  source: field === null ? null : { declaringClass, field }
})

const ok = (text: string, editable = true): Extract<ReadJavaFileResult, { ok: true }> => ({
  ok: true,
  text,
  hash: `#${text.length}`,
  editable
})

const lift = (): JavaSource => sourceFromRead(ok(LIFT))
const target = (node: ValueNode): { path: string; fieldId: string } | null =>
  node.source ? tunableTarget(node.source) : null

describe('Dashboard 설정 → TeamCode 튜닝 값', () => {
  it('선언 클래스 바이너리 이름 → 최상위 클래스 파일, 중첩 경로#필드', () => {
    expect(
      tunableTarget({ declaringClass: 'org.firstinspires.ftc.teamcode.Lift', field: 'kP' })
    ).toEqual({ path: LIFT_PATH, fieldId: 'Lift#kP' })
    expect(
      tunableTarget({
        declaringClass: 'org.firstinspires.ftc.teamcode.MecanumDrive$Params',
        field: 'inPerTick'
      })
    ).toEqual({
      path: 'src/main/java/org/firstinspires/ftc/teamcode/MecanumDrive.java',
      fieldId: 'MecanumDrive.Params#inPerTick'
    })
    expect(tunableTarget({ declaringClass: 'Top$A$B', field: 'x' })).toEqual({
      path: 'src/main/java/Top.java',
      fieldId: 'Top.A.B#x'
    })
    // 생성 패키지·식별자가 아닌 이름·빈 이름은 TeamCode 튜닝 값이 아니다
    expect(
      tunableTarget({
        declaringClass: 'org.firstinspires.ftc.teamcode.sandbot.RobotHardware',
        field: 'x'
      })
    ).toBeNull()
    expect(tunableTarget({ declaringClass: 'a.Outer$', field: 'x' })).toBeNull()
    expect(tunableTarget({ declaringClass: '', field: 'x' })).toBeNull()
    expect(tunableTarget({ declaringClass: 'a.B', field: '' })).toBeNull()
  })

  it('고칠 수 있는 리터럴 필드는 Dashboard 값을 그 형식의 리터럴로 옮긴다', () => {
    const cases: [ValueNode, string, string][] = [
      [value('double', '0.75', 'kP'), '0.75', '0.5'],
      [value('int', '42', 'TICKS'), '42', '10'],
      [value('float', '0.5', 'GAIN'), '0.5f', '0.25f'],
      [value('long', '-7', 'LIMIT'), '-7L', '5L'],
      [value('boolean', 'true', 'ENABLED'), 'true', 'false'],
      [value('string', 'arm "x"', 'NAME'), '"arm \\"x\\""', '"lift"'],
      // Double.toString의 지수 표기
      [value('double', '1.0E-4', 'kP'), '1.0e-4', '0.5'],
      // 객체의 자식(선언 클래스는 중첩 클래스)
      [value('double', '0.2', 'kS', 'org.firstinspires.ftc.teamcode.Lift$Params'), '0.2', '0.1']
    ]
    for (const [node, literal, base] of cases) {
      const check = checkApply(node, target(node), lift(), undefined)
      expect(check, node.source?.field).toEqual({
        ok: true,
        path: LIFT_PATH,
        fieldId: target(node)!.fieldId,
        value: literal,
        base
      })
    }
  })

  it('쓸 수 없으면 이유를 준다', () => {
    const block = (
      node: ValueNode,
      source: JavaSource | undefined = lift(),
      pending?: { value: string; base: string }
    ): unknown => {
      const check = checkApply(node, target(node), source, pending)
      return check.ok ? 'ok' : check.block
    }
    expect(block(value('double', '1', null))).toBe('noSource')
    expect(
      block(value('double', '1', 'x', 'org.firstinspires.ftc.teamcode.sandbot.RobotHardware'))
    ).toBe('notTeamCode')
    // 아직 읽지 않은 파일(기본 인자를 쓰지 않게 직접 부른다)
    const kP = value('double', '1', 'kP')
    expect(checkApply(kP, target(kP), undefined, undefined)).toEqual({
      ok: false,
      block: 'loading'
    })
    expect(block(value('double', '1', 'kP'), { status: 'missing' })).toBe('missing')
    expect(block(value('double', '1', 'kP'), { status: 'failed', detail: 'x' })).toBe('readFailed')
    expect(block(value('double', '1', 'kP'), sourceFromRead(ok(LIFT, false)))).toBe('file')
    expect(block(value('double', '1', 'nope'))).toBe('noField')
    expect(block(value('double', '1', 'HALF'))).toEqual({ readOnly: 'expression' })
    expect(block(value('enum', 'DOWN', 'MODE'))).toEqual({ readOnly: 'enum' })
    // 실행한 코드는 double인데 파일은 int(밖에서 형식을 바꿈)
    expect(block(value('double', '3.5', 'TICKS'))).toBe('typeChanged')
    expect(block(value('double', 'NaN', 'kP'))).toBe('value')
    expect(block(value('double', 'Infinity', 'kP'))).toBe('value')
    // Dashboard 글자(Double·Float.toString)가 파일 리터럴과 같은 값이면 파일 값이다
    expect(block(value('double', '0.5', 'kP'))).toBe('inFile')
    expect(block(value('float', '0.25', 'GAIN'))).toBe('inFile')
    expect(block(value('long', '5', 'LIMIT'))).toBe('inFile')
    expect(block(value('double', '0.75', 'kP'), lift(), { value: '0.75', base: '0.5' })).toBe(
      'applied'
    )
  })

  it('저장하지 않은 튜닝 값이 있으면 파일 값으로 되돌리는 반영도 받는다', () => {
    const node = value('double', '0.5', 'kP')
    expect(checkApply(node, target(node), lift(), { value: '0.9', base: '0.5' })).toEqual({
      ok: true,
      path: LIFT_PATH,
      fieldId: 'Lift#kP',
      value: '0.5',
      base: '0.5'
    })
  })
})

describe('[파일에 반영]', () => {
  const readJavaFile = vi.fn(async (): Promise<ReadJavaFileResult> => ok(LIFT))

  beforeEach(() => {
    readJavaFile.mockClear()
    vi.stubGlobal('window', { api: { readJavaFile } })
    useProjectStore.setState({ root: '/p', session: 1, busy: false })
    useJavaSourcesStore.setState(useJavaSourcesStore.getInitialState())
    useConfigSourcesStore.setState(useConfigSourcesStore.getInitialState())
    // Config 탭이 이 실행의 트리를 보였다
    syncConfigSourcesRun('run-1')
    useSceneStore.getState().replaceObjects({})
    useSceneStore.setState({ tunables: {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useProjectStore.setState(useProjectStore.getInitialState())
  })

  it('파일을 다시 읽고 인스펙터와 같은 길(setTunable)로 저장하지 않은 튜닝 값을 만든다', async () => {
    expect(await applyConfigValue(value('double', '0.75', 'kP'), 'run-1')).toBe(true)
    expect(readJavaFile).toHaveBeenCalledWith('/p', LIFT_PATH)
    expect(useSceneStore.getState().tunables).toEqual({
      [LIFT_PATH]: { 'Lift#kP': { value: '0.75', base: '0.5' } }
    })
    // 연결하지 않은 파일은 Config 탭의 캐시에 둔다
    expect(useConfigSourcesStore.getState().files[LIFT_PATH]).toMatchObject({ status: 'ready' })
  })

  it('다시 읽은 파일에서 고칠 수 없게 바뀌었으면 옮기지 않는다', async () => {
    readJavaFile.mockResolvedValueOnce(ok(LIFT.replace('kP = 0.5', 'kP = 1.0 / 2')))
    expect(await applyConfigValue(value('double', '0.75', 'kP'), 'run-1')).toBe(false)
    expect(useSceneStore.getState().tunables).toEqual({})
  })

  it('그사이 다른 프로젝트를 열었으면 옮기지 않는다', async () => {
    readJavaFile.mockImplementationOnce(async () => {
      useProjectStore.setState({ session: 2 })
      return ok(LIFT)
    })
    expect(await applyConfigValue(value('double', '0.75', 'kP'), 'run-1')).toBe(false)
    expect(useSceneStore.getState().tunables).toEqual({})
  })

  it('그사이 다른 실행의 트리가 왔으면 옮기되 읽은 내용을 그 실행의 캐시에 넣지 않는다', async () => {
    readJavaFile.mockImplementationOnce(async () => {
      syncConfigSourcesRun('run-2')
      return ok(LIFT)
    })
    expect(await applyConfigValue(value('double', '0.75', 'kP'), 'run-1')).toBe(true)
    const state = useConfigSourcesStore.getState()
    expect(state.runId).toBe('run-2')
    expect(state.files).toEqual({})
  })
})

describe('연결하지 않은 파일 읽기(Config 탭)', () => {
  const project = { root: '/p', session: 1 }
  let resolvers: ((result: ReadJavaFileResult) => void)[] = []
  const readJavaFile = vi.fn(
    (): Promise<ReadJavaFileResult> =>
      new Promise((resolve) => {
        resolvers.push(resolve)
      })
  )
  const settle = async (index: number, result: ReadJavaFileResult): Promise<void> => {
    resolvers[index](result)
    await Promise.resolve()
    await Promise.resolve()
  }
  const local = (runId: string): JavaSource | undefined =>
    localConfigSource(useConfigSourcesStore.getState(), project, runId, LIFT_PATH)

  beforeEach(() => {
    resolvers = []
    readJavaFile.mockClear()
    vi.stubGlobal('window', { api: { readJavaFile } })
    useProjectStore.setState({ root: '/p', session: 1, busy: false })
    useJavaSourcesStore.setState(useJavaSourcesStore.getInitialState())
    useConfigSourcesStore.setState(useConfigSourcesStore.getInitialState())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useProjectStore.setState(useProjectStore.getInitialState())
  })

  it('칸이 탭보다 먼저 읽기를 시작해도(자식 effect가 먼저 돈다) 탭이 실행을 맞추며 그 읽기를 버리지 않는다', async () => {
    // ApplyButton의 effect
    ensureConfigSource(LIFT_PATH, 'run-2')
    // ConfigView의 effect(이 실행의 트리를 처음 보임)
    syncConfigSourcesRun('run-2')
    expect(readJavaFile).toHaveBeenCalledTimes(1)
    await settle(0, ok(LIFT))
    expect(local('run-2')).toMatchObject({ status: 'ready' })
  })

  it('이전 실행에서 읽은 파일은 새 실행의 칸에 보이지 않고 새로 읽는다', async () => {
    ensureConfigSource(LIFT_PATH, 'run-1')
    await settle(0, ok(LIFT))
    expect(local('run-1')).toMatchObject({ status: 'ready' })
    // 새 실행의 칸이 탭보다 먼저 그려져도 이전 실행의 내용을 쓰지 않는다
    expect(local('run-2')).toBeUndefined()
    ensureConfigSource(LIFT_PATH, 'run-2')
    expect(readJavaFile).toHaveBeenCalledTimes(2)
    expect(local('run-1')).toBeUndefined()
    await settle(1, ok(LIFT))
    expect(local('run-2')).toMatchObject({ status: 'ready' })
  })

  it('실행이 바뀐 뒤 끝난 이전 읽기는 새 실행의 같은 파일 읽기를 덮지 않는다', async () => {
    ensureConfigSource(LIFT_PATH, 'run-1')
    ensureConfigSource(LIFT_PATH, 'run-2')
    expect(readJavaFile).toHaveBeenCalledTimes(2)
    await settle(0, ok(LIFT.replace('kP = 0.5', 'kP = 0.9')))
    expect(local('run-2')).toBeUndefined()
    // 같은 실행의 칸이 더 있어도 읽는 중이면 다시 읽지 않는다
    ensureConfigSource(LIFT_PATH, 'run-2')
    expect(readJavaFile).toHaveBeenCalledTimes(2)
    await settle(1, ok(LIFT))
    const source = local('run-2')
    expect(source?.status === 'ready' && source.hash).toBe(ok(LIFT).hash)
  })

  it('프로젝트를 열거나 저장하는 중에는 읽지 않는다', () => {
    useProjectStore.setState({ busy: true })
    ensureConfigSource(LIFT_PATH, 'run-1')
    expect(readJavaFile).not.toHaveBeenCalled()
  })
})

describe('Config 트리', () => {
  const tree: DashConfigNode = {
    kind: 'custom',
    children: [
      { name: '__hardware__', node: { kind: 'custom', children: [] } },
      {
        name: 'Lift',
        node: {
          kind: 'custom',
          children: [
            { name: 'kP', node: value('double', '0.5', 'kP') },
            {
              name: 'PARAMS',
              node: {
                kind: 'custom',
                children: [{ name: 'kS', node: value('double', '0.1', 'kS') }]
              }
            }
          ]
        }
      },
      { name: 'Drive', node: { kind: 'custom', children: [] } }
    ]
  }

  it('펼친 묶음의 자식만 보이고, withHardwareRoot 묶음은 맨 뒤다', () => {
    const collapsed = configRows(tree, () => false)
    expect(collapsed.map((row) => [row.name, row.depth])).toEqual([
      ['Lift', 0],
      ['Drive', 0],
      ['__hardware__', 0]
    ])
    const open = new Set([configPathKey(['Lift']), configPathKey(['Lift', 'PARAMS'])])
    expect(configRows(tree, (key) => open.has(key)).map((row) => row.path)).toEqual([
      ['Lift'],
      ['Lift', 'kP'],
      ['Lift', 'PARAMS'],
      ['Lift', 'PARAMS', 'kS'],
      ['Drive'],
      ['__hardware__']
    ])
  })

  it('시작 값은 처음 받은 값이고, 나중에 생긴 변수는 처음 보인 값이다', () => {
    const start = extendBaseline(null, tree)
    expect([...start]).toEqual([
      [configPathKey(['Lift', 'kP']), '0.5'],
      [configPathKey(['Lift', 'PARAMS', 'kS']), '0.1']
    ])
    const changed: DashConfigNode = {
      kind: 'custom',
      children: [
        {
          name: 'Lift',
          node: {
            kind: 'custom',
            children: [
              { name: 'kP', node: value('double', '0.9', 'kP') },
              { name: 'extra', node: value('int', '3', null) }
            ]
          }
        }
      ]
    }
    const next = extendBaseline(start, changed)
    expect(next.get(configPathKey(['Lift', 'kP']))).toBe('0.5')
    expect(next.get(configPathKey(['Lift', 'extra']))).toBe('3')
    // 새 변수가 없으면 같은 객체
    expect(extendBaseline(next, changed)).toBe(next)
    expect(hasChangedValue(changed, [], next)).toBe(true)
    expect(hasChangedValue(tree, [], next)).toBe(false)
    expect(configValues(changed).get(configPathKey(['Lift', 'kP']))).toBe('0.9')
  })

  it('형식별 입력을 확인한다', () => {
    expect(configInputValue('boolean', 'true', [])).toBe('true')
    expect(configInputValue('boolean', 'yes', [])).toBeNull()
    expect(configInputValue('int', ' +42 ', [])).toBe('42')
    expect(configInputValue('int', '2147483648', [])).toBeNull()
    expect(configInputValue('int', '1.5', [])).toBeNull()
    expect(configInputValue('long', '9223372036854775807', [])).toBe('9223372036854775807')
    expect(configInputValue('long', '9223372036854775808', [])).toBeNull()
    expect(configInputValue('double', '1e-3', [])).toBe('1e-3')
    expect(configInputValue('double', 'NaN', [])).toBeNull()
    expect(configInputValue('double', '1e999', [])).toBeNull()
    expect(configInputValue('float', '1e39', [])).toBeNull()
    expect(configInputValue('string', ' keep spaces ', [])).toBe(' keep spaces ')
    expect(configInputValue('enum', 'DOWN', ['UP', 'DOWN'])).toBe('DOWN')
    expect(configInputValue('enum', 'LEFT', ['UP', 'DOWN'])).toBeNull()
    expect(configInputValue('readonlyString', 'x', [])).toBeNull()
  })
})
