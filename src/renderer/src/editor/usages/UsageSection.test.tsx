import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { propertyDefaults } from '../../hardware/catalog'
import ko from '../../i18n/locales/ko'
import { useJavaIndexStore } from '../../java/javaIndex'
import { useUsageIndexStore } from '../../java/usageIndex'
import {
  deviceUsageKey,
  groupUsageKey,
  robotUsageKey,
  type UsageCounts,
  type UsageHit,
  type UsageResult
} from '../../java/usages/usageTypes'
import { useProjectStore } from '../../project/projectStore'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import ScriptCard from '../scripts/ScriptCard'
import { useUsageOpenStore } from './usageOpenStore'
import UsageSection from './UsageSection'

// 그리기 확인(renderToStaticMarkup, DOM 없음): 머리줄·트리의 역할과 ARIA, 상태별 문구. 보기 모델 자체는
// usageView.test.ts가 확인한다. 기호표가 아직 자리 함수면 같은 규칙의 작은 대역을 쓴다(usageView.test.ts와 같음).
vi.mock('../../java/usages/usageSymbols', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../java/usages/usageSymbols')>()
  const types = await import('../../java/usages/usageTypes')
  type Objects = Parameters<typeof real.usageSymbols>[0]
  // 이 파일의 씬은 데드휠·겹치는 클래스 이름이 없다
  const lookupNamesOf = (objects: Objects): Map<string, string[]> => {
    const names = new Map<string, string[]>()
    for (const object of Object.values(objects))
      for (const component of object.components ?? [])
        names.set(component.name.trim(), [
          ...(names.get(component.name.trim()) ?? []),
          types.deviceUsageKey(object.id, component.id)
        ])
    return names
  }
  function orStandIn<T>(actual: (objects: Objects) => T, standIn: (objects: Objects) => T) {
    return (objects: Objects): T => {
      try {
        return actual(objects)
      } catch (error) {
        if (error instanceof Error && error.message.endsWith('not implemented'))
          return standIn(objects)
        throw error
      }
    }
  }
  return {
    ...real,
    usageSymbols: orStandIn(real.usageSymbols, () => ({
      robots: [],
      unavailable: [],
      lookupNames: [],
      signature: ''
    })),
    lookupNamesOf: orStandIn(real.lookupNamesOf, lookupNamesOf)
  }
})

// renderToStaticMarkup은 zustand의 서버 스냅숏(처음 상태 객체)을 읽는다. 테스트마다 그 객체에도 같은 값을 넣고
// 끝나면 되돌린다(이 파일의 모듈은 다른 테스트 파일과 나뉜다).
type TestStore<T> = {
  getInitialState: () => T
  setState: (patch: Partial<T>) => void
}
const restores: (() => void)[] = []

function setStore<T extends object>(store: TestStore<T>, patch: Partial<T>): void {
  const initial = store.getInitialState()
  const saved = { ...initial }
  restores.push(() => Object.assign(initial, saved))
  Object.assign(initial, patch)
  store.setState(patch)
}

afterEach(() => {
  while (restores.length > 0) restores.pop()!()
})

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { ko: { translation: ko } },
    lng: 'ko',
    initAsync: false,
    interpolation: { escapeValue: false }
  })
})

const transform = { position: [0, 0, 0], rotation: [0, 0, 0] } as const
const objects: SceneObjects = {
  robot: {
    id: 'robot',
    name: 'Bot',
    kind: 'robot',
    parentId: null,
    transform: { ...transform, position: [0, 0, 0], rotation: [0, 0, 0] },
    hardware: {
      className: 'MyBot',
      configName: 'Bot',
      expansionHub: { enabled: false, address: 2 }
    }
  },
  lift: {
    id: 'lift',
    name: 'Lift',
    kind: 'group',
    parentId: 'robot',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
  },
  liftMotor: {
    id: 'liftMotor',
    name: 'liftMotor',
    kind: 'part',
    parentId: 'lift',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    components: [
      {
        id: 'll',
        type: 'motor',
        name: 'liftLeft',
        hub: 'controlHub',
        port: 0,
        props: propertyDefaults('motor')
      }
    ]
  }
}

const PATH = 'src/main/java/org/firstinspires/ftc/teamcode/LiftOp.java'
const LL = deviceUsageKey('liftMotor', 'll')

const hit = (line: number, kind: UsageHit['kind'], extra: Partial<UsageHit> = {}): UsageHit => ({
  path: PATH,
  line,
  col: 3,
  kind,
  snippet: 'robot.lift.liftLeft.setPower(1)',
  mark: [11, 19],
  ...extra
})

function counts(hits: UsageHit[]): UsageCounts {
  const result: UsageCounts = {
    field: 0,
    constant: 0,
    type: 0,
    new: 0,
    lookup: 0,
    text: 0,
    unresolved: 0
  }
  for (const h of hits) result[h.kind]++
  return result
}

function resultWith(
  entries: [string, UsageHit[]][],
  extra: Partial<UsageResult> = {}
): UsageResult {
  return {
    hits: new Map(entries),
    totals: new Map(entries.map(([key, hits]) => [key, counts(hits)])),
    unresolved: new Map(),
    unknownNames: new Map(),
    files: { scanned: 1, tooLarge: [], unicodeEscape: [], failed: [] },
    ...extra
  }
}

beforeEach(() => {
  setStore(useSceneStore, { objects })
})

const device = (
  <UsageSection target={{ kind: 'device', objectId: 'liftMotor', componentId: 'll' }} />
)

describe('사용처 칸 그리기', () => {
  it('프로젝트가 없으면 흐린 머리줄과 이유', () => {
    const html = renderToStaticMarkup(device)
    expect(html).toContain('usage-header is-muted')
    expect(html).toContain(ko.usages.noProject)
    expect(html).not.toContain('<button')
  })

  it('찾은 것이 없으면 펼치지 않는 머리줄, 도움말은 찾은 이름과 Kotlin', () => {
    setStore(useUsageIndexStore, { status: 'ready', root: '/p', result: resultWith([]) })
    const html = renderToStaticMarkup(device)
    expect(html).toContain(ko.usages.none)
    expect(html).toContain('찾은 것: robot.lift.liftLeft, &quot;liftLeft&quot;')
    expect(html).toContain(ko.usages.kotlin)
    expect(html).not.toContain('aria-expanded')
  })

  it('접힌 머리줄: 코드·이름 개수, 찾는 중 표시, 본문 없음', () => {
    setStore(useUsageIndexStore, {
      status: 'scanning',
      root: '/p',
      result: resultWith([[LL, [hit(3, 'field'), hit(4, 'constant'), hit(5, 'lookup')]]])
    })
    const html = renderToStaticMarkup(device)
    expect(html).toMatch(/<button[^>]*class="usage-header"[^>]*aria-expanded="false"/)
    expect(html).toContain('코드 2 · 이름 1')
    expect(html).toContain(`aria-label="${ko.usages.scanning}"`)
    expect(html).not.toContain('role="tree"')
  })

  it('펼친 본문: 파일별 트리, 하나의 탭 멈춤, 줄 행 이름, 상수 배지, 맞은 토큰 표시', () => {
    setStore(useUsageOpenStore, { open: { device: true, group: false, robot: false } })
    setStore(useUsageIndexStore, {
      status: 'ready',
      root: '/p',
      result: resultWith([[LL, [hit(3, 'field'), hit(4, 'constant')]]])
    })
    const html = renderToStaticMarkup(device)
    expect(html).toMatch(/aria-expanded="true"/)
    expect(html).toContain('role="tree"')
    expect(html).toContain('aria-label="liftLeft 사용처"')
    // 파일 행(1단계)과 줄 행(2단계), 탭 멈춤은 첫 행 하나
    expect(html).toContain('aria-label="org/firstinspires/ftc/teamcode/LiftOp.java, 2곳"')
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html).toContain('aria-level="2"')
    expect(html).toContain(
      'aria-label="LiftOp.java 4번째 줄, 상수: robot.lift.liftLeft.setPower(1)"'
    )
    // 기본 종류(필드)가 아닌 상수에만 배지
    expect(html.match(/class="usage-badge"/g)).toHaveLength(1)
    expect(html).toContain('<mark class="usage-mark">liftLeft</mark>')
    expect(html).toContain('<bdi dir="ltr">robot.lift.<mark')
  })

  it('이름 바꾸기 문제는 ⚠ 개수와 맨 앞 부분', () => {
    const baseline = objects
    const renamedScene: SceneObjects = {
      ...objects,
      liftMotor: {
        ...objects.liftMotor,
        components: [{ ...objects.liftMotor.components![0], name: 'liftL' }]
      }
    }
    setStore(useSceneStore, { objects: renamedScene })
    setStore(useUsageOpenStore, { open: { device: true, group: false, robot: false } })
    setStore(useUsageIndexStore, {
      status: 'ready',
      root: '/p',
      baseline,
      result: resultWith([], {
        unresolved: new Map([
          [groupUsageKey('lift'), [hit(7, 'unresolved', { member: 'liftLeft' })]]
        ])
      })
    })
    const html = renderToStaticMarkup(device)
    expect(html).toContain('aria-label="문제 1곳"')
    expect(html).toContain('⚠ 이전 이름 robot.lift.liftLeft을(를) 쓰는 곳 1곳')
  })

  it('실패하면 이전 결과를 흐리게 보이고 이유를 알린다', () => {
    setStore(useUsageOpenStore, { open: { device: true, group: false, robot: false } })
    setStore(useUsageIndexStore, {
      status: 'failed',
      root: '/p',
      detail: 'EIO',
      result: resultWith([[LL, [hit(3, 'field')]]])
    })
    const html = renderToStaticMarkup(device)
    expect(html).toContain('usage-section is-stale')
    expect(html).toContain('사용처를 찾지 못했습니다: EIO')
  })

  it('일부만 찾았으면 (일부)와 펼친 본문의 이유', () => {
    setStore(useUsageOpenStore, { open: { device: true, group: false, robot: false } })
    setStore(useUsageIndexStore, {
      status: 'ready',
      root: '/p',
      result: resultWith([], {
        files: { scanned: 1, tooLarge: ['a.java'], unicodeEscape: [], failed: ['b.java'] }
      })
    })
    const html = renderToStaticMarkup(device)
    expect(html).toContain('(일부)')
    expect(html).toContain('파일 2개는 찾지 않았습니다')
  })

  it('로봇 카드는 장치가 없어도, 그룹 카드는 클래스가 있을 때만', () => {
    setStore(useUsageIndexStore, { status: 'ready', root: '/p', result: resultWith([]) })
    const robot = renderToStaticMarkup(
      <UsageSection target={{ kind: 'robot', robotId: 'robot' }} />
    )
    expect(robot).toContain(ko.usages.title)
    const group = renderToStaticMarkup(<UsageSection target={{ kind: 'group', groupId: 'lift' }} />)
    expect(group).toContain(ko.usages.title)
    setStore(useSceneStore, { objects: { robot: objects.robot, lift: objects.lift } })
    expect(renderToStaticMarkup(<UsageSection target={{ kind: 'group', groupId: 'lift' }} />)).toBe(
      ''
    )
  })
})

describe('스크립트 카드의 쓰는 하드웨어', () => {
  const link = { path: PATH, className: 'org.firstinspires.ftc.teamcode.LiftOp' }
  const listed = (): void => {
    setStore(useProjectStore, { root: '/p' })
    setStore(useJavaIndexStore, {
      status: 'ready',
      root: '/p',
      files: [
        {
          path: PATH,
          className: link.className,
          simpleName: 'LiftOp',
          packageName: 'org.firstinspires.ftc.teamcode',
          size: 10,
          mtimeMs: 1
        }
      ]
    })
  }

  it('이 파일에 사용처가 있는 오브젝트를 하이어라키 순서의 칩으로 보인다', () => {
    listed()
    setStore(useUsageIndexStore, {
      status: 'ready',
      root: '/p',
      result: resultWith([
        [LL, [hit(3, 'field')]],
        [robotUsageKey('robot'), [hit(1, 'new')]],
        [groupUsageKey('lift'), [hit(2, 'text')]]
      ])
    })
    const html = renderToStaticMarkup(<ScriptCard objectId="lift" link={link} />)
    expect(html).toContain(ko.scripts.usesHardware)
    const chips = [...html.matchAll(/class="script-chip"[^>]*>([^<]*)</g)].map((m) => m[1])
    // 같은 글자의 다른 문자열(text)만 있는 그룹은 넣지 않는다
    expect(chips).toEqual(['Bot', 'liftLeft'])
  })

  it('찾은 것이 없거나 결과가 없으면 줄을 보이지 않는다', () => {
    listed()
    expect(renderToStaticMarkup(<ScriptCard objectId="lift" link={link} />)).not.toContain(
      ko.scripts.usesHardware
    )
    setStore(useUsageIndexStore, { status: 'ready', root: '/p', result: resultWith([]) })
    expect(renderToStaticMarkup(<ScriptCard objectId="lift" link={link} />)).not.toContain(
      ko.scripts.usesHardware
    )
  })
})
