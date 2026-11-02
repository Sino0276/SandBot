import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashConfigNode } from '../../../shared/dashboard'
import type { ReadJavaFileResult } from '../../../shared/ipc'
import {
  currentJavaSource,
  putJavaSource,
  refreshJavaSources,
  useJavaSourcesStore
} from '../java/javaSources'
import { useProjectStore } from '../project/projectStore'
import { useSceneStore } from '../scene/sceneStore'
import {
  applyConfigValue,
  ensureConfigSource,
  initConfigSources,
  localConfigSource,
  refreshConfigSources,
  syncConfigSourcesRun,
  useConfigSourcesStore
} from './dashConfigApply'
import { checkApply, tunableTarget, type ApplyCheck } from './dashConfigModel'

// [파일에 반영]이 보는 연결하지 않은 파일(Config 탭이 직접 읽은 사본)을 고친 뒤 다시 읽는지. 연결한 파일은
// javaSources가 창 포커스·저장 뒤에 다시 읽는다.

const PATH = 'src/main/java/org/firstinspires/ftc/teamcode/Lift.java'
const lift = (init: string): string => `package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.config.Config;

@Config
public class Lift {
    public static double kP = ${init};
}
`
const RUN = 'run-1'
const PROJECT = { root: '/p', session: 1 }
const NODE: Extract<DashConfigNode, { kind: 'value' }> = {
  kind: 'value',
  type: 'double',
  value: '0.75',
  enumValues: [],
  source: { declaringClass: 'org.firstinspires.ftc.teamcode.Lift', field: 'kP' }
}

let disk: string
let editable: boolean
const ok = (text: string): ReadJavaFileResult => ({ ok: true, text, hash: `#${text}`, editable })
const readJavaFile = vi.fn(async (): Promise<ReadJavaFileResult> => ok(disk))
const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

// ApplyButton이 그리는 판정(연결 캐시가 먼저, 없으면 Config 탭의 사본)
function button(): ApplyCheck {
  const target = tunableTarget(NODE.source!)!
  const linked = currentJavaSource(useJavaSourcesStore.getState(), PROJECT, PATH)
  const local = localConfigSource(useConfigSourcesStore.getState(), PROJECT, RUN, PATH)
  return checkApply(
    NODE,
    target,
    linked ?? local,
    useSceneStore.getState().tunables[PATH]?.['Lift#kP']
  )
}

beforeAll(() => {
  initConfigSources()
})

beforeEach(() => {
  disk = lift('1.0 / 2')
  editable = true
  readJavaFile.mockClear()
  vi.stubGlobal('window', { api: { readJavaFile } })
  useProjectStore.setState({ root: '/p', session: 1, busy: false })
  useJavaSourcesStore.setState(useJavaSourcesStore.getInitialState())
  useConfigSourcesStore.setState(useConfigSourcesStore.getInitialState())
  useSceneStore.setState({ tunables: {} })
  syncConfigSourcesRun(RUN)
})

afterEach(() => {
  vi.unstubAllGlobals()
  useProjectStore.setState(useProjectStore.getInitialState())
  useSceneStore.setState({ tunables: {} })
})

describe('Config 탭이 읽은 파일 다시 읽기', () => {
  it('막힌 이유(식 초기값)를 Android Studio에서 고치고 창으로 돌아오면 다시 읽어 막힘이 풀린다', async () => {
    ensureConfigSource(PATH, RUN)
    await flush()
    expect(button()).toEqual({ ok: false, block: { readOnly: 'expression' } })
    disk = lift('0.5')
    // 창 포커스(playActions가 OpMode 목록과 함께 부른다)
    refreshConfigSources()
    await flush()
    expect(readJavaFile).toHaveBeenCalledTimes(2)
    expect(button()).toMatchObject({ ok: true, value: '0.75', base: '0.5' })
  })

  it('읽기 전용을 풀고 돌아와도 다시 읽는다', async () => {
    disk = lift('0.5')
    editable = false
    ensureConfigSource(PATH, RUN)
    await flush()
    expect(button()).toEqual({ ok: false, block: 'file' })
    editable = true
    refreshConfigSources()
    await flush()
    expect(button()).toMatchObject({ ok: true })
  })

  it('[파일에 반영] 뒤 저장하면 저장이 쓴 내용을 사본에도 넣는다(목록을 다시 읽어 연결 캐시에서 빠져도 다시 켜지지 않는다)', async () => {
    disk = lift('0.5')
    ensureConfigSource(PATH, RUN)
    await flush()
    expect(await applyConfigValue(NODE, RUN)).toBe(true)
    expect(button()).toEqual({ ok: false, block: 'applied' })
    // 저장: 파일에 쓰고(applyTunableSaveOutcome이 연결 캐시에 넣는다) 저장하지 않은 값이 사라진다
    disk = lift('0.75')
    putJavaSource('/p', 1, PATH, ok(disk))
    useSceneStore.setState({ tunables: {} })
    expect(button()).toEqual({ ok: false, block: 'inFile' })
    // 저장 뒤 refreshJavaIndex → refreshJavaSources가 연결하지 않은 파일을 캐시에서 뺀다
    await refreshJavaSources()
    expect(currentJavaSource(useJavaSourcesStore.getState(), PROJECT, PATH)).toBeUndefined()
    expect(button()).toEqual({ ok: false, block: 'inFile' })
  })

  it('그사이 끝난 이전 읽기가 연결 캐시에서 온 더 새 내용을 덮지 않는다', async () => {
    disk = lift('0.5')
    let release: (() => void) | null = null
    readJavaFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          const stale = ok(lift('1.0 / 2'))
          release = () => resolve(stale)
        })
    )
    ensureConfigSource(PATH, RUN)
    putJavaSource('/p', 1, PATH, ok(lift('0.5')))
    release!()
    await flush()
    await refreshJavaSources()
    expect(button()).toMatchObject({ ok: true, base: '0.5' })
  })

  it('프로젝트를 열거나 저장하는 중이거나 읽은 파일이 없으면 읽지 않는다', async () => {
    refreshConfigSources()
    expect(readJavaFile).not.toHaveBeenCalled()
    ensureConfigSource(PATH, RUN)
    await flush()
    useProjectStore.setState({ busy: true })
    refreshConfigSources()
    expect(readJavaFile).toHaveBeenCalledTimes(1)
  })
})
