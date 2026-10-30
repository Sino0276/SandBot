import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_GRADLE_FILE_BYTES, readGradleProject, type GradleProject } from '.'
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

// 한도 안의 작은 파일로 일을 부풀리는 입력(리뷰에서 찾은 것). 읽기는 Electron 메인 프로세스에서 하므로 어떤 입력도
// 오래 붙잡지 않고 진단으로 끝나야 한다.
describe('일을 부풀리는 입력', () => {
  async function timed(files: MemoryFiles, limit = 1000): Promise<GradleProject> {
    const started = performance.now()
    const project = await readGradleProject(memorySource(files))
    expect(performance.now() - started).toBeLessThan(limit)
    return project
  }

  // 한도(256 KB) 가까이 unit을 되풀이한 글자
  function fill(unit: string, size = MAX_GRADLE_FILE_BYTES - 64): string {
    return unit.repeat(Math.floor(size / unit.length))
  }

  // TeamCode가 body를 담은 파일 30개를 apply from 한다
  function applied(body: string, kotlin = false): MemoryFiles {
    const ext = kotlin ? '.gradle.kts' : '.gradle'
    const files: MemoryFiles = {
      [`TeamCode/build${ext}`]: Array.from({ length: 30 }, (_, i) =>
        kotlin ? `apply(from = "f${i}${ext}")` : `apply from: 'f${i}${ext}'`
      ).join('\n')
    }
    for (let i = 0; i < 30; i++) files[`TeamCode/f${i}${ext}`] = body
    return files
  }

  function details(project: GradleProject): string[] {
    return project.diagnostics.map((d) => `${d.code} ${d.detail}`)
  }

  it('작은 파일 몇 개를 줄마다 겹겹이 apply from(예전에는 줄 수의 7제곱 번 실행)', async () => {
    const files: MemoryFiles = { 'TeamCode/build.gradle': "apply from: 'f1.gradle'\n".repeat(16) }
    for (let d = 1; d < 7; d++)
      files[`TeamCode/f${d}.gradle`] = `apply from: 'f${d + 1}.gradle'\n`.repeat(16)
    files['TeamCode/f7.gradle'] = "dependencies { implementation 'a.b:c:1' }\n"
    const project = await timed(files)
    expect(project.dependencies.map((d) => d.artifact)).toEqual(['c'])
    expect(details(project)).toEqual(['tooMany apply from runs more than 64 scripts'])
  })

  it('큰 파일을 수천 번 apply from', async () => {
    const line = "    implementation 'com.example:library:1.0.0'\n"
    const project = await timed({
      'TeamCode/build.gradle': "apply from: 'b.gradle'\n".repeat(10000),
      'TeamCode/b.gradle': `dependencies {\n${line.repeat(Math.floor((210 * 1024) / line.length))}}\n`
    })
    expect(project.diagnostics.map((d) => d.code)).toContain('tooMuchWork')
  })

  it('같은 목록을 겹쳐 넣은 목록(555바이트로 2^24개, 예전에는 메모리가 넘쳐 앱이 죽음)', async () => {
    const lines = ["def l0 = ['com.pedropathing:core:3.0.2']"]
    for (let i = 1; i <= 24; i++) lines.push(`def l${i} = [l${i - 1}, l${i - 1}]`)
    lines.push('dependencies {\n    implementation l24\n}')
    const project = await timed({ 'TeamCode/build.gradle': lines.join('\n') })
    expect(project.dependencies).toEqual([])
    expect(details(project)).toEqual([
      'tooMany dependency list has more than 1000 entries: implementation l24'
    ])
  })

  it('보간이 닫는 /를 삼킨 슬래시 문자열 시도가 겹친 파일', async () => {
    const filler = 'x '.repeat(2000)
    const text = `dependencies { implementation "a:b:1" }\n${Array.from({ length: 16 }, () => `(/\${ ${filler}`).join('\n')}`
    const project = await timed({ 'TeamCode/build.gradle': text })
    // 실패한 시도는 나눗셈·글자로 다시 읽어 앞의 선언은 그대로 남는다
    expect(project.dependencies.map((d) => d.artifact)).toEqual(['b'])
    const dollar = await timed({ 'TeamCode/build.gradle': '$/ '.repeat(85000) })
    expect(dollar.dependencies).toEqual([])
  })

  it('표기가 많은 선언에 exclude가 많다', async () => {
    const notations = Array.from({ length: 900 }, (_, i) => `'g:a${i}:1'`).join(', ')
    const excludes = Array.from({ length: 2000 }, () => `exclude group: '${'x'.repeat(40)}'`)
    const block = `  implementation(${notations}) {\n${excludes.join('\n')}\n  }`
    const project = await timed({
      'TeamCode/build.gradle': `dependencies {\n${block}\n${block}\n}\n`
    })
    expect(project.diagnostics.map((d) => d.code)).toEqual(['tooMuchWork'])
  })

  it('큰 묶음(libs.bundles)을 여러 번', async () => {
    const libraries = Array.from({ length: 1000 }, (_, i) => `l${i} = "g:a${i}:1"`).join('\n')
    const bundle = Array.from({ length: 1000 }, (_, i) => `"l${i}"`).join(',')
    const line = '    implementation libs.bundles.b\n'
    const project = await timed({
      'gradle/libs.versions.toml': `[libraries]\n${libraries}\n[bundles]\nb = [${bundle}]\n`,
      'TeamCode/build.gradle': `dependencies {\n${line.repeat(Math.floor((MAX_GRADLE_FILE_BYTES - 64) / line.length))}}\n`
    })
    expect(project.dependencies).toHaveLength(1000)
  })

  it('gradle.properties의 줄 잇기가 많다(예전에는 이은 글자를 줄마다 다시 훑었다)', async () => {
    const lines = 'a\\\n'.repeat(85000)
    const project = await timed({ 'gradle.properties': lines, 'TeamCode/gradle.properties': lines })
    expect(project.diagnostics).toEqual([])
  })

  // 일 한도는 단위로 세므로, 단위 하나가 보통 글자보다 훨씬 무거운 입력(읽지 못한 것마다 Error를 만들어 스택을 잡았다)은
  // 한도 안에서도 몇 초씩 붙잡았다. 이제는 무거운 것을 그만큼 여러 단위로 세어 한도가 시간도 묶는다.
  it('읽지 못하는 문장·보간·카탈로그 줄이 가득한 큰 파일(예전에는 2–3초)', async () => {
    for (const files of [
      applied(fill(')\n')),
      applied(fill('=\n')),
      applied(fill(';)')),
      applied(fill('"${)}"\n')),
      applied(fill('"${}${}${}${}${}${}${}${}"\n')),
      applied(`a "${fill('${)}', MAX_GRADLE_FILE_BYTES - 74)}"\n`),
      applied(fill('a {)}\n')),
      applied(fill('`a\n'), true),
      { 'gradle/libs.versions.toml': fill('x\n'), ...applied(fill(')\n')) },
      { 'gradle/libs.versions.toml': fill('=\n') },
      { 'gradle/libs.versions.toml': fill('"\n') }
    ]) {
      const project = await timed(files, 500)
      expect(project.diagnostics.at(-1)?.code).toBe('tooMuchWork')
    }
  })

  it('같은 자리의 진단을 되풀이하는 입력(진단도 그 일만큼 센다)', async () => {
    // 인자마다 같은 줄의 같은 진단(풀지 못한 이름)
    const project = await timed(
      applied(`dependencies {\n  implementation ${fill('x, ', MAX_GRADLE_FILE_BYTES - 128)}x\n}\n`),
      500
    )
    expect(project.diagnostics.map((d) => d.code)).toEqual(['unresolvedValue', 'tooMuchWork'])
  })

  it('exclude에 큰 맵 변수를 되풀이해 넣는다(예전에는 맵을 복사하는 일을 세지 않아 1.5초)', async () => {
    const map = `def m = [${Array.from({ length: 1000 }, (_, i) => `k${i}: 'v'`).join(', ')}]\n`
    const head = `${map}dependencies {\n implementation('a:b:1') {\n`
    const size = MAX_GRADLE_FILE_BYTES - 64 - head.length
    // 한 문장의 인자마다, 줄마다, 여러 파일에서
    const wide = `${head}  exclude ${fill('m, ', size)}m\n }\n}\n`
    const tall = `${head}${fill('  exclude m\n', size)} }\n}\n`
    for (const files of [
      { 'TeamCode/build.gradle': wide },
      { 'TeamCode/build.gradle': tall },
      applied(wide)
    ]) {
      const project = await timed(files, 500)
      expect(project.diagnostics.at(-1)?.code).toBe('tooMuchWork')
    }
  })

  it('카탈로그의 긴 이름을 되풀이해 쓴다(예전에는 쓸 때마다 이름을 찾는 일을 세지 않아 1–2초)', async () => {
    const long = 'b'.repeat(120 * 1024)
    const library = `[libraries]\nx = { module = "a:b", version.ref = "${long}" }\n`
    const uses = (accessor: string): string =>
      `dependencies {\n${fill(` implementation libs.${accessor}\n`)}}\n`
    for (const [toml, accessor] of [
      // [versions]에 없는 version.ref(진단)와 있는 version.ref
      [library, 'x'],
      [`[versions]\n"${long}" = "1"\n${library}`, 'x'],
      // 묶음의 긴 별칭(쓰는 쪽은 짧다)
      [`[libraries]\n"${long}" = "a:b:1"\n[bundles]\nx = ["${long}"]\n`, 'bundles.x']
    ]) {
      const project = await timed(
        { 'gradle/libs.versions.toml': toml, 'TeamCode/build.gradle': uses(accessor) },
        500
      )
      expect(project.diagnostics.at(-1)?.code).toBe('tooMuchWork')
    }
  })

  it('목록 항목마다 같은 진단이 부모 식에 붙는다(예전에는 항목마다 부모의 글자 조각을 다시 만들어 0.6초)', async () => {
    for (const separator of [' , ', ', ']) {
      const list = `[${Array.from({ length: 1000 }, () => 'x').join(separator)}]`
      const project = await timed(
        applied(
          `dependencies {\n${fill(` implementation(${list})\n`, MAX_GRADLE_FILE_BYTES - 84)}}\n`
        ),
        500
      )
      expect(project.diagnostics.at(-1)?.code).toBe('tooMuchWork')
    }
  })

  it('아주 긴 카탈로그 이름을 변수로 받아 되풀이해 쓴다(예전에는 쓸 때마다 긴 이름을 다시 이어 5–16초)', async () => {
    const long = 'v'.repeat(150_000)
    for (const use of [
      'y = "$x"\n',
      'y = x.get()\n',
      `y = [${Array(50).fill('"$x"').join(', ')}]\n`
    ]) {
      const files: MemoryFiles = {
        'gradle/libs.versions.toml': `[versions]\n${long} = "1"\n`,
        'TeamCode/build.gradle': `ext.x = libs.versions.${long}\n${"apply from: 'u.gradle'\n".repeat(64)}`,
        'TeamCode/u.gradle': use.repeat(1000)
      }
      const project = await timed(files, 500)
      expect(project.diagnostics.length).toBeGreaterThan(0)
    }
  })

  it('괄호로 감싼 아주 긴 이름 사슬을 부르는 문장(예전에는 사슬을 문장마다 제곱 시간으로 펼쳐 9초)', async () => {
    let chain = 'a'
    for (let level = 0; level < 30; level++) chain = `(${chain}${'.b'.repeat(255)})`
    const files: MemoryFiles = {
      'TeamCode/build.gradle': `dependencies { implementation 'g:a:1' }\n${"apply from: 'u.gradle'\n".repeat(60)}`,
      'TeamCode/u.gradle': `${chain}()\n`
    }
    const project = await timed(files, 500)
    expect(project.dependencies.map((d) => d.artifact)).toEqual(['a'])
    // 한 파일에 그런 문장을 가득
    await timed({ 'TeamCode/build.gradle': fill(`${chain}()\n`) }, 500)
  })

  it('settings의 include에 같은 목록을 여러 번 넣는다(예전에는 몇 초 뒤 Invalid array length)', async () => {
    const list = `def l = [${Array.from({ length: 1000 }, (_, i) => `':m${i}'`).join(', ')}]\n`
    // 64 KB면 예전에는 2천만 개를 넣었다
    const wide = await timed({
      'settings.gradle': `${list}include ${fill('l, ', 64 * 1024)}l\n`,
      'TeamCode/build.gradle': "dependencies { implementation 'g:a:1' }"
    })
    expect(wide.dependencies).toHaveLength(1)
    expect(wide.diagnostics.map((d) => d.code)).toEqual(['tooMany'])
    const tall = await timed({
      'settings.gradle': `${list}${fill('include l\n', MAX_GRADLE_FILE_BYTES - 64 - list.length)}`,
      'TeamCode/build.gradle': "dependencies { implementation 'g:a:1' }"
    })
    expect(tall.diagnostics.map((d) => d.code)).toEqual(['tooMuchWork'])
  })
})
