import { describe, expect, it } from 'vitest'
import { LibraryFailure, type Edge, type MetadataSource, type ModuleMetadata } from './metadata'
import { classifyModule } from './policy'
import { resolveGraph, type ResolvedModule, type Root } from './resolver'

type Spec = {
  deps?: (string | { coordinate: string; scope?: 'compile' | 'runtime'; exclude?: string[] })[]
  constraints?: string[]
  file?: string | null
}

// 'g:a:v' → 메타데이터. 없는 좌표는 notFound.
function source(graph: Record<string, Spec>): MetadataSource & { loads: string[] } {
  const loads: string[] = []
  const load = (async (
    group: string,
    artifact: string,
    version: string
  ): Promise<ModuleMetadata> => {
    const key = `${group}:${artifact}:${version}`
    loads.push(key)
    const spec = graph[key]
    if (!spec) throw new LibraryFailure('notFound', `${key}: HTTP 404`)
    const dependencies: Edge[] = (spec.deps ?? []).map((dep) => {
      const d = typeof dep === 'string' ? { coordinate: dep } : dep
      const [g, a, v] = d.coordinate.split(':')
      return {
        group: g,
        artifact: a,
        version: v,
        scope: d.scope ?? 'compile',
        exclusions: (d.exclude ?? []).map((e) => {
          const [eg, ea] = e.split(':')
          return { group: eg === '*' ? null : eg, module: ea === '*' ? null : ea }
        })
      }
    })
    return {
      dependencies,
      constraints: (spec.constraints ?? []).map((c) => {
        const [g, a, v] = c.split(':')
        return { group: g, artifact: a, version: v }
      }),
      artifact:
        spec.file === null
          ? null
          : { file: spec.file ?? `${artifact}-${version}.jar`, ext: 'jar', expected: undefined },
      files: []
    }
  }) as MetadataSource & { loads: string[] }
  load.loads = loads
  return load
}

function root(coordinate: string, extra: Partial<Root> = {}): Root {
  const [group, artifact, version] = coordinate.split(':')
  return {
    group,
    artifact,
    version,
    compile: true,
    runtime: true,
    transitive: true,
    exclusions: [],
    ...extra
  }
}

const summary = (modules: ResolvedModule[]): Record<string, string> =>
  Object.fromEntries(
    modules.map((m) => [
      `${m.group}:${m.artifact}`,
      `${m.version}${m.failure ? ` failed:${m.failure.reason}` : ''} ${m.policy.kind}${m.compile ? ' C' : ''}${m.runtime ? ' R' : ''}`
    ])
  )

const RR = {
  'com.acmerobotics.roadrunner:ftc:0.1.25': {
    file: 'ftc-0.1.25.aar',
    deps: [
      'com.acmerobotics.roadrunner:core:1.0.1',
      'com.acmerobotics.roadrunner:actions:1.0.1',
      'com.acmerobotics.dashboard:dashboard:0.4.10',
      'org.firstinspires.ftc:RobotCore:10.0.0',
      {
        coordinate: 'com.fasterxml.jackson.core:jackson-databind:2.12.7',
        scope: 'runtime' as const
      }
    ]
  },
  'com.acmerobotics.roadrunner:core:1.0.1': {
    deps: ['org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0']
  },
  'com.acmerobotics.roadrunner:actions:1.0.1': {
    deps: [
      'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0',
      'com.acmerobotics.roadrunner:core:1.0.1',
      'com.acmerobotics.dashboard:core:0.4.7'
    ]
  },
  'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0': {
    deps: [
      'org.jetbrains.kotlin:kotlin-stdlib:1.9.0',
      'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.0'
    ]
  },
  'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.0': {
    deps: ['org.jetbrains.kotlin:kotlin-stdlib:1.9.0']
  },
  'org.jetbrains.kotlin:kotlin-stdlib:1.9.0': {
    deps: ['org.jetbrains:annotations:13.0', 'org.jetbrains.kotlin:kotlin-stdlib-common:1.9.0']
  },
  'org.jetbrains.kotlin:kotlin-stdlib-common:1.9.0': {},
  'org.jetbrains:annotations:13.0': {},
  'com.fasterxml.jackson.core:jackson-databind:2.12.7': {
    deps: [
      'com.fasterxml.jackson.core:jackson-annotations:2.12.7',
      'com.fasterxml.jackson.core:jackson-core:2.12.7'
    ]
  },
  'com.fasterxml.jackson.core:jackson-annotations:2.12.7': {},
  'com.fasterxml.jackson.core:jackson-core:2.12.7': {},
  // FTC Dashboard(대체): 실제 POM처럼 core·FTC SDK·androidx.annotation·nanohttpd를 끌어온다
  'com.acmerobotics.dashboard:dashboard:0.5.1': {
    file: 'dashboard-0.5.1.aar',
    deps: [
      'com.acmerobotics.dashboard:core:0.5.1',
      'org.firstinspires.ftc:RobotCore:10.0.0',
      'androidx.annotation:annotation:1.1.0',
      'org.nanohttpd:nanohttpd-websocket:2.3.1'
    ]
  },
  'com.acmerobotics.dashboard:dashboard:0.4.10': {
    file: 'dashboard-0.4.10.aar',
    deps: ['com.acmerobotics.dashboard:core:0.4.10', 'org.firstinspires.ftc:RobotCore:9.0.0']
  },
  'com.acmerobotics.dashboard:core:0.5.1': {},
  'com.acmerobotics.dashboard:core:0.4.10': {},
  'com.acmerobotics.dashboard:core:0.4.7': {},
  'androidx.annotation:annotation:1.1.0': {}
}

describe('의존성 그래프', () => {
  it('Road Runner: 제공·지원 안 함은 펼치지 않고, 대체(Dashboard)는 펼치고, jackson은 실행 범위만', async () => {
    const load = source(RR)
    const modules = await resolveGraph(
      [
        root('com.acmerobotics.roadrunner:ftc:0.1.25'),
        root('com.acmerobotics.roadrunner:core:1.0.1'),
        root('com.acmerobotics.roadrunner:actions:1.0.1'),
        root('com.acmerobotics.dashboard:dashboard:0.5.1')
      ],
      load,
      classifyModule
    )
    const s = summary(modules)
    expect(s['com.acmerobotics.roadrunner:ftc']).toBe('0.1.25 supported C R')
    // 대시보드: 팀 0.5.1과 RR ftc의 0.4.10 중 높은 것. 대체라 지원 계열처럼 펼친다(core는 actions의 0.4.7과 0.5.1 중 높은 것)
    expect(s['com.acmerobotics.dashboard:dashboard']).toBe('0.5.1 replaced C R')
    expect(modules.find((m) => m.artifact === 'dashboard')?.requested).toEqual(['0.5.1', '0.4.10'])
    expect(s['com.acmerobotics.dashboard:core']).toBe('0.5.1 replaced C R')
    expect(s['androidx.annotation:annotation']).toBe('1.1.0 compileOnly C R')
    expect(s['org.nanohttpd:nanohttpd-websocket']).toBe('2.3.1 provided C R')
    expect(s['org.firstinspires.ftc:RobotCore']).toBe('10.0.0 provided C R')
    expect(s['com.fasterxml.jackson.core:jackson-databind']).toBe('2.12.7 other R')
    expect(s['com.fasterxml.jackson.core:jackson-core']).toBe('2.12.7 other R')
    expect(s['org.jetbrains.kotlin:kotlin-stdlib']).toBe('1.9.0 other C R')
    // 제공의 메타데이터는 받지 않는다
    expect(
      load.loads.some(
        (key) => key.startsWith('org.firstinspires') || key.startsWith('org.nanohttpd')
      )
    ).toBe(false)
    // 끌어온 쪽 사슬
    expect(modules.find((m) => m.artifact === 'jackson-core')?.requestedBy).toEqual([
      'com.acmerobotics.roadrunner:ftc:0.1.25',
      'com.fasterxml.jackson.core:jackson-databind:2.12.7'
    ])
  })

  it('가장 높은 버전이 이기고 그 버전의 의존성으로 다시 펼친다(kotlin 1.9.0 / 2.1.20 / 2.4.10)', async () => {
    const graph: Record<string, Spec> = {
      'x:a:1': { deps: ['org.jetbrains.kotlin:kotlin-stdlib:1.9.0'] },
      'x:b:1': { deps: ['org.jetbrains.kotlin:kotlin-stdlib:2.1.20'] },
      'x:c:1': { deps: ['x:d:1'] },
      'x:d:1': { deps: ['org.jetbrains.kotlin:kotlin-stdlib:2.4.10'] },
      'org.jetbrains.kotlin:kotlin-stdlib:1.9.0': {
        deps: ['org.jetbrains:annotations:13.0', 'old:only:1']
      },
      'org.jetbrains.kotlin:kotlin-stdlib:2.1.20': { deps: ['org.jetbrains:annotations:13.0'] },
      'org.jetbrains.kotlin:kotlin-stdlib:2.4.10': {
        deps: ['org.jetbrains:annotations:13.0'],
        constraints: [
          'org.jetbrains.kotlin:kotlin-stdlib-jdk8:2.4.10',
          'org.jetbrains.kotlin:never:9'
        ]
      },
      'org.jetbrains:annotations:13.0': {},
      'old:only:1': {}
    }
    const modules = await resolveGraph(
      [root('x:a:1'), root('x:b:1'), root('x:c:1')],
      source(graph),
      classifyModule
    )
    const s = summary(modules)
    expect(s['org.jetbrains.kotlin:kotlin-stdlib']).toBe('2.4.10 other C R')
    // 진 버전(1.9.0)의 의존성은 남지 않는다
    expect(s['old:only']).toBeUndefined()
    // 제약만으로는 모듈을 끌어오지 않는다
    expect(s['org.jetbrains.kotlin:never']).toBeUndefined()
    expect(modules.find((m) => m.artifact === 'kotlin-stdlib')?.requested).toEqual([
      '1.9.0',
      '2.1.20',
      '2.4.10'
    ])
    expect(modules.find((m) => m.artifact === 'kotlin-stdlib')?.requestedBy).toEqual([
      'x:c:1',
      'x:d:1'
    ])
  })

  it('제약은 다른 곳에서 쓰는 모듈의 버전을 올린다', async () => {
    const graph: Record<string, Spec> = {
      'x:a:1': { deps: ['k:stdlib:2.0', 'k:jdk8:1.0'] },
      'k:stdlib:2.0': { constraints: ['k:jdk8:2.0'] },
      'k:jdk8:1.0': {},
      'k:jdk8:2.0': {}
    }
    const modules = await resolveGraph([root('x:a:1')], source(graph), classifyModule)
    expect(summary(modules)['k:jdk8']).toBe('2.0 other C R')
    expect(modules.find((m) => m.artifact === 'jdk8')?.requested).toEqual(['1.0'])
  })

  it('exclude는 그 선언 아래 전체에, 다른 길로 닿으면 남는다', async () => {
    const graph: Record<string, Spec> = {
      'org.ftclib.ftclib:core:2.1.1': {
        deps: [
          { coordinate: 'org.ejml:ejml-simple:0.39', exclude: ['org.ejml:ejml-all'] },
          'x:other:1'
        ]
      },
      'org.ejml:ejml-simple:0.39': { deps: ['org.ejml:ejml-all:0.39', 'org.ejml:ejml-core:0.39'] },
      'org.ejml:ejml-all:0.39': { file: null },
      'org.ejml:ejml-core:0.39': {},
      'x:other:1': { deps: [{ coordinate: 'x:wild:1', exclude: ['*:*'] }] },
      'x:wild:1': { deps: ['x:gone:1'] },
      'x:gone:1': {}
    }
    const modules = await resolveGraph(
      [root('org.ftclib.ftclib:core:2.1.1')],
      source(graph),
      classifyModule
    )
    const s = summary(modules)
    expect(s['org.ejml:ejml-all']).toBeUndefined()
    expect(s['org.ejml:ejml-core']).toBe('0.39 other C R')
    expect(s['x:wild']).toBe('1 other C R')
    expect(s['x:gone']).toBeUndefined()
  })

  it('transitive = false와 선언 쪽 exclude', async () => {
    const graph: Record<string, Spec> = {
      'x:a:1': { deps: ['x:b:1'] },
      'x:c:1': { deps: ['x:d:1', 'y:e:1'] },
      'x:b:1': {},
      'x:d:1': {},
      'y:e:1': {}
    }
    const modules = await resolveGraph(
      [
        root('x:a:1', { transitive: false }),
        root('x:c:1', { exclusions: [{ group: 'y', module: null }] })
      ],
      source(graph),
      classifyModule
    )
    expect(Object.keys(summary(modules)).sort()).toEqual(['x:a', 'x:c', 'x:d'])
  })

  it('compileOnly·runtimeOnly 뿌리: 컴파일은 compile 범위로만, 실행은 모두', async () => {
    const graph: Record<string, Spec> = {
      'x:api:1': { deps: ['x:shared:1', { coordinate: 'x:impl:1', scope: 'runtime' }] },
      'x:rt:1': { deps: ['x:rtdep:1'] },
      'x:shared:1': {},
      'x:impl:1': {},
      'x:rtdep:1': {}
    }
    const modules = await resolveGraph(
      [root('x:api:1', { runtime: false }), root('x:rt:1', { compile: false })],
      source(graph),
      classifyModule
    )
    const s = summary(modules)
    // 뿌리는 지원 계열로 본다(해석기를 부른 쪽이 받기로 정했다)
    expect(s['x:api']).toBe('1 supported C')
    expect(s['x:shared']).toBe('1 other C')
    // compileOnly 아래 runtime 범위는 어느 클래스패스에도 없다(Gradle도 풀지 않음)
    expect(s['x:impl']).toBeUndefined()
    expect(s['x:rt']).toBe('1 supported R')
    expect(s['x:rtdep']).toBe('1 other R')
  })

  it('메타데이터 실패는 그 모듈만', async () => {
    const graph: Record<string, Spec> = {
      'x:a:1': { deps: ['x:missing:1', 'x:ok:1'] },
      'x:ok:1': {}
    }
    const modules = await resolveGraph([root('x:a:1')], source(graph), classifyModule)
    const s = summary(modules)
    expect(s['x:missing']).toBe('1 failed:notFound other C R')
    expect(s['x:ok']).toBe('1 other C R')
  })

  it('동적 버전만 요청된 전이 의존성은 실패', async () => {
    const graph: Record<string, Spec> = { 'x:a:1': { deps: ['x:range:[1.0,2.0)'] } }
    const modules = await resolveGraph([root('x:a:1')], source(graph), classifyModule)
    expect(summary(modules)['x:range']).toMatch(/failed:badMetadata/)
  })

  it('순환이 있어도 끝나고 결과 순서가 결정적이다', async () => {
    const graph: Record<string, Spec> = {
      'x:a:1': { deps: ['x:b:1'] },
      'x:b:1': { deps: ['x:a:1', 'x:c:2'] },
      'x:c:2': { deps: ['x:b:1'] }
    }
    const first = await resolveGraph([root('x:a:1')], source(graph), classifyModule)
    const second = await resolveGraph([root('x:a:1')], source(graph), classifyModule)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(Object.keys(summary(first))).toEqual(['x:a', 'x:b', 'x:c'])
  })

  it('모듈 수 한도', async () => {
    const graph: Record<string, Spec> = {}
    for (let i = 0; i < 20; i++) graph[`x:m${i}:1`] = { deps: [`x:m${i + 1}:1`] }
    const modules = await resolveGraph([root('x:m0:1')], source(graph), classifyModule, {
      maxModules: 5,
      maxIterations: 5,
      maxStates: 100
    })
    expect(modules.filter((m) => m.failure === null)).toHaveLength(5)
    expect(modules.some((m) => m.failure?.detail.includes('too large'))).toBe(true)
  })
})
