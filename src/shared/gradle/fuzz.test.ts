import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_GRADLE_FILE_BYTES, readGradleProject } from '.'
import { FIXTURES, memorySource, type MemoryFiles } from './testSupport'

// 팀 Gradle 파일은 믿지 않는 입력이다. 말뭉치를 망가뜨린 입력(글자 지우기·넣기·자르기)에도 예외 없이 끝나고, 같은 입력이면
// 결과가 같고, 한도를 지키는지 본다(난수는 시드 고정).

function corpus(): MemoryFiles[] {
  const projects: MemoryFiles[] = []
  for (const name of readdirSync(FIXTURES)) {
    const root = join(FIXTURES, name)
    // SOURCES.txt 같은 설명 파일은 프로젝트가 아니다
    if (!statSync(root).isDirectory()) continue
    const files: MemoryFiles = {}
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else files[relative(root, path).split('\\').join('/')] = readFileSync(path, 'utf8')
      }
    }
    walk(root)
    projects.push(files)
  }
  return projects
}

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const PIECES = [
  '{',
  '}',
  '(',
  ')',
  '[',
  ']',
  "'",
  '"',
  '"""',
  "'''",
  '$',
  '${',
  '/',
  '/*',
  '//',
  '\n',
  '\\',
  ':',
  '=',
  ',',
  'apply from: ',
  'implementation ',
  'ext.',
  '?.',
  '->',
  '\r'
]

function mutate(text: string, next: () => number): string {
  let out = text
  const edits = 1 + Math.floor(next() * 6)
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(next() * (out.length + 1))
    const choice = next()
    if (choice < 0.4)
      out = out.slice(0, at) + PIECES[Math.floor(next() * PIECES.length)] + out.slice(at)
    else if (choice < 0.8) out = out.slice(0, at) + out.slice(at + 1 + Math.floor(next() * 20))
    else out = out.slice(0, at)
  }
  return out
}

describe('망가진 입력', () => {
  it('예외 없이 끝나고 같은 입력이면 같은 결과', async () => {
    const next = random(20261028)
    const projects = corpus()
    for (let round = 0; round < 300; round++) {
      const base = projects[round % projects.length]
      const files: MemoryFiles = {}
      for (const [path, text] of Object.entries(base))
        files[path] = typeof text === 'string' && next() < 0.5 ? mutate(text, next) : text
      const first = await readGradleProject(memorySource(files))
      const second = await readGradleProject(memorySource(files))
      expect(JSON.stringify(second)).toBe(JSON.stringify(first))
      expect(first.diagnostics.length).toBeLessThanOrEqual(200)
      for (const dependency of first.dependencies) {
        expect(dependency.group).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/)
        expect(dependency.artifact).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/)
      }
    }
  })

  it('아무 글자나 넣어도 예외가 없다', async () => {
    const next = random(7)
    for (let round = 0; round < 200; round++) {
      let text = ''
      const length = Math.floor(next() * 400)
      for (let i = 0; i < length; i++)
        text +=
          next() < 0.7
            ? PIECES[Math.floor(next() * PIECES.length)]
            : String.fromCharCode(Math.floor(next() * 0x3000))
      for (const path of [
        'TeamCode/build.gradle',
        'TeamCode/build.gradle.kts',
        'gradle/libs.versions.toml'
      ]) {
        const project = await readGradleProject(memorySource({ [path]: text }))
        expect(Array.isArray(project.dependencies)).toBe(true)
      }
    }
  })

  it('한도 가까운 큰 파일도 빨리 읽는다', async () => {
    const line = "    implementation 'com.example:library:1.0.0' // a comment {\n"
    const body = line.repeat(Math.floor((MAX_GRADLE_FILE_BYTES - 32) / line.length))
    const started = performance.now()
    const project = await readGradleProject(
      memorySource({ 'TeamCode/build.gradle': `dependencies {\n${body}}\n` })
    )
    expect(performance.now() - started).toBeLessThan(3000)
    // 같은 좌표지만 줄이 다르므로 한도(1000개)까지 남는다
    expect(project.dependencies).toHaveLength(1000)
  })

  it('끝없이 이은 식(+·.·!·@·명령식 사슬)은 그 문장만 버리고 스택을 넘기지 않는다', async () => {
    // 합쳐 256 KB 안(한 줄에 수천 번 이은 식)
    const n = 5000
    const long = [
      `def a = ${Array(n).fill("'x'").join(' + ')}`,
      `def b = libs${'.x'.repeat(n)}`,
      `def c = ${'!'.repeat(n)}true`,
      `${'@A '.repeat(n)}\ndef d = '1'`,
      `id 'a'${" b 'c'".repeat(n)}`,
      `def e = f${'()'.repeat(n)}`,
      `def g = h${'[0]'.repeat(n)}`
    ].join('\n')
    const project = await readGradleProject(
      memorySource({
        'TeamCode/build.gradle': `${long}\ndependencies { implementation "g:after:$d" }`
      })
    )
    expect(
      project.dependencies.map((dep) => `${dep.group}:${dep.artifact}:${dep.version}`)
    ).toEqual(['g:after:1'])
  })

  it('긴 목록·맵과 많은 인자는 그대로 읽는다', async () => {
    const items = Array.from({ length: 900 }, (_, i) => `'g:a${i}:1'`)
    const project = await readGradleProject(
      memorySource({
        'TeamCode/build.gradle': [
          `ext.list = [${items.join(', ')}]`,
          `ext.map = [${items.map((item, i) => `k${i}: ${item}`).join(', ')}]`,
          'dependencies {',
          `  implementation ${items.join(', ')}`,
          '  implementation list[899]',
          '  implementation map.k5',
          '}'
        ].join('\n')
      })
    )
    expect(project.diagnostics).toEqual([])
    expect(project.dependencies).toHaveLength(902)
  })
})
