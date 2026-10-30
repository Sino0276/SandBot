import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { availableAtInRepository, ModuleError, parseGradleModule } from './gradleModule'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8')

function variant(
  name: string,
  attributes: Record<string, string>,
  extra: Record<string, unknown> = {}
): unknown {
  return { name, attributes, ...extra }
}

const LIBRARY = { 'org.gradle.category': 'library' }

describe('Gradle 모듈 메타데이터', () => {
  it('Pedro revhub 3.0.2(실제 파일): Android 라이브러리의 api·runtime 변형', () => {
    const parsed = parseGradleModule(fixture('revhub-3.0.2.module'))
    expect(parsed.kind).toBe('module')
    if (parsed.kind !== 'module') return
    expect(parsed.module.dependencies).toEqual([
      {
        group: 'com.pedropathing',
        artifact: 'core',
        version: '3.0.2',
        scope: 'compile',
        exclusions: []
      },
      {
        group: 'org.jetbrains.kotlin',
        artifact: 'kotlin-stdlib',
        version: '2.3.21',
        scope: 'compile',
        exclusions: []
      }
    ])
    // sources 변형의 파일은 고르지 않는다
    expect(parsed.module.files.map((f) => f.name)).toEqual(['revhub-3.0.2.aar'])
    expect(parsed.module.files[0].sha256).toBe(
      'e1c00eb5aa2e767b7045811070045e06ac14363475bcdb09e0ad1cee24ce723e'
    )
    expect(parsed.module.files[0].size).toBe(40216)
  })

  it('kotlin-stdlib 2.3.21(실제 파일): JVM 변형과 제약, js·wasm 변형은 건너뜀', () => {
    const parsed = parseGradleModule(fixture('kotlin-stdlib-2.3.21.module'))
    if (parsed.kind !== 'module') throw new Error('expected module')
    expect(parsed.module.dependencies.map((d) => `${d.group}:${d.artifact}:${d.version}`)).toEqual([
      'org.jetbrains:annotations:13.0'
    ])
    expect(parsed.module.constraints.map((c) => `${c.artifact}:${c.version}`)).toContain(
      'kotlin-stdlib-jdk8:1.8.0'
    )
    expect(parsed.module.files.map((f) => f.name)).toEqual(['kotlin-stdlib-2.3.21.jar'])
  })

  it('Ivy pedro 1.1.1(실제 파일)', () => {
    const parsed = parseGradleModule(fixture('pedro-1.1.1.module'))
    if (parsed.kind !== 'module') throw new Error('expected module')
    expect(parsed.module.dependencies.map((d) => `${d.artifact}:${d.version}:${d.scope}`)).toEqual([
      'core:1.1.1:compile'
    ])
  })

  it('runtime 변형에만 있는 의존성은 실행 범위', () => {
    const parsed = parseGradleModule(
      JSON.stringify({
        formatVersion: '1.1',
        variants: [
          variant(
            'apiElements',
            { ...LIBRARY, 'org.gradle.usage': 'java-api' },
            {
              dependencies: [{ group: 'a', module: 'api', version: { requires: '1' } }]
            }
          ),
          variant(
            'runtimeElements',
            { ...LIBRARY, 'org.gradle.usage': 'java-runtime' },
            {
              dependencies: [
                { group: 'a', module: 'api', version: { requires: '1' } },
                {
                  group: 'a',
                  module: 'impl',
                  version: { prefers: '2' },
                  excludes: [{ group: '*', module: 'nanohttpd' }]
                }
              ],
              files: [{ name: 'x-1.jar', url: 'x-1.jar' }]
            }
          )
        ]
      })
    )
    if (parsed.kind !== 'module') throw new Error('expected module')
    expect(parsed.module.dependencies).toEqual([
      { group: 'a', artifact: 'api', version: '1', scope: 'compile', exclusions: [] },
      {
        group: 'a',
        artifact: 'impl',
        version: '2',
        scope: 'runtime',
        exclusions: [{ group: null, module: 'nanohttpd' }]
      }
    ])
  })

  it('available-at(같은 저장소 안의 상대 주소만)', () => {
    const parsed = parseGradleModule(
      JSON.stringify({
        formatVersion: '1.1',
        variants: [
          variant(
            'jvmRuntimeElements-published',
            {
              ...LIBRARY,
              'org.gradle.usage': 'java-runtime',
              'org.jetbrains.kotlin.platform.type': 'jvm'
            },
            {
              'available-at': {
                url: '../../kotlinx-coroutines-core-jvm/1.8.0/kotlinx-coroutines-core-jvm-1.8.0.module',
                group: 'org.jetbrains.kotlinx',
                module: 'kotlinx-coroutines-core-jvm',
                version: '1.8.0'
              }
            }
          )
        ]
      })
    )
    expect(parsed.kind).toBe('availableAt')
    if (parsed.kind !== 'availableAt') return
    const from = {
      group: 'org.jetbrains.kotlinx',
      artifact: 'kotlinx-coroutines-core',
      version: '1.8.0'
    }
    expect(availableAtInRepository(from, parsed.target)).toBe(true)
    expect(
      availableAtInRepository(from, { ...parsed.target, url: 'https://evil.example/x.module' })
    ).toBe(false)
    expect(
      availableAtInRepository(from, { ...parsed.target, url: '../../../../../../other/x.module' })
    ).toBe(false)
  })

  it('실패: strictly·rejects, JVM 변형 없음, 폴더 밖 파일, JSON 아님', () => {
    const doc = (deps: unknown[], files: unknown[] = []): string =>
      JSON.stringify({
        formatVersion: '1.1',
        variants: [
          variant(
            'r',
            { ...LIBRARY, 'org.gradle.usage': 'java-runtime' },
            { dependencies: deps, files }
          )
        ]
      })
    expect(() =>
      parseGradleModule(doc([{ group: 'a', module: 'b', version: { strictly: '1' } }]))
    ).toThrow(ModuleError)
    expect(() =>
      parseGradleModule(
        doc([{ group: 'a', module: 'b', version: { requires: '1', rejects: ['2'] } }])
      )
    ).toThrow(/strictly/)
    expect(() => parseGradleModule(doc([], [{ name: '../x.jar', url: '../x.jar' }]))).toThrow(
      /module folder/
    )
    expect(() =>
      parseGradleModule(
        JSON.stringify({
          formatVersion: '1.1',
          variants: [variant('js', { ...LIBRARY, 'org.gradle.usage': 'kotlin-runtime' })]
        })
      )
    ).toThrow(/no JVM/)
    expect(() => parseGradleModule('<html/>')).toThrow(ModuleError)
    expect(() => parseGradleModule(JSON.stringify({ formatVersion: '2.0', variants: [] }))).toThrow(
      /formatVersion/
    )
  })
})
