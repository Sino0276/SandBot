import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_GRADLE_FILE_BYTES, readGradleProject } from '../shared/gradle'
import { fixtureSource } from '../shared/gradle/testSupport'
import { gradleFileSource, readProjectGradle } from './gradleSource'
import { clearTrustedRoots, trustRoot } from './projectRoots'

const FIXTURES = join(__dirname, '..', 'shared', 'gradle', '__fixtures__')
const isWindows = process.platform === 'win32'

let base: string
let root: string
let outside: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'sandbot-gradle-'))
  root = join(base, 'project')
  outside = join(base, 'outside')
  await mkdir(join(root, 'TeamCode'), { recursive: true })
  await mkdir(outside, { recursive: true })
})

afterEach(async () => {
  clearTrustedRoots()
  await rm(base, { recursive: true, force: true })
})

describe('gradleFileSource', () => {
  it('프로젝트 안의 보통 파일을 글자로 준다(없으면 null)', async () => {
    await writeFile(
      join(root, 'TeamCode', 'build.gradle'),
      "dependencies { implementation 'a:b:1' }"
    )
    const source = gradleFileSource(root)
    expect(await source.read('TeamCode/build.gradle')).toBe(
      "dependencies { implementation 'a:b:1' }"
    )
    expect(await source.read('settings.gradle')).toBeNull()
    expect(await source.read('missing/dir/x.gradle')).toBeNull()
  })

  it('규칙에 맞지 않는 경로는 읽지 않는다', async () => {
    const source = gradleFileSource(root)
    for (const bad of [
      '../outside/x.gradle',
      '/etc/passwd',
      'a/../b',
      'C:/x',
      'con.gradle',
      'a:b',
      './x',
      ''
    ])
      expect(await source.read(bad), bad).toEqual({
        problem: 'outsideProject',
        detail: 'not a project path'
      })
  })

  it('256 KB까지만 읽는다', async () => {
    await writeFile(join(root, 'ok.gradle'), 'x'.repeat(MAX_GRADLE_FILE_BYTES))
    await writeFile(join(root, 'big.gradle'), 'x'.repeat(MAX_GRADLE_FILE_BYTES + 1))
    const source = gradleFileSource(root)
    expect(await source.read('ok.gradle')).toHaveLength(MAX_GRADLE_FILE_BYTES)
    expect(await source.read('big.gradle')).toEqual({ problem: 'tooLarge' })
  })

  it('폴더는 읽을 수 없는 파일이다', async () => {
    await mkdir(join(root, 'build.gradle'))
    expect(await gradleFileSource(root).read('build.gradle')).toEqual({
      problem: 'unreadable',
      detail: 'not a regular file'
    })
  })

  it.skipIf(isWindows)('링크가 프로젝트 밖을 가리키면 거부하고, 안을 가리키면 읽는다', async () => {
    await writeFile(join(outside, 'secret.gradle'), "dependencies { implementation 'evil:x:1' }")
    await writeFile(join(root, 'real.gradle'), "dependencies { implementation 'good:x:1' }")
    await symlink(join(outside, 'secret.gradle'), join(root, 'escape.gradle'))
    await symlink(join(root, 'real.gradle'), join(root, 'inside.gradle'))
    await symlink(outside, join(root, 'linkdir'), 'dir')
    const source = gradleFileSource(root)
    expect(await source.read('escape.gradle')).toEqual({ problem: 'outsideProject' })
    expect(await source.read('linkdir/secret.gradle')).toEqual({ problem: 'outsideProject' })
    expect(await source.read('inside.gradle')).toBe("dependencies { implementation 'good:x:1' }")
  })

  it.skipIf(isWindows)('apply from이 링크로 밖을 가리키면 그 파일을 읽지 않고 알린다', async () => {
    await writeFile(join(outside, 'secret.gradle'), "dependencies { implementation 'evil:x:1' }")
    await symlink(join(outside, 'secret.gradle'), join(root, 'shared.gradle'))
    await writeFile(join(root, 'TeamCode', 'build.gradle'), "apply from: '../shared.gradle'")
    trustRoot(root)
    const project = await readProjectGradle(root)
    expect(project.dependencies).toEqual([])
    expect(project.diagnostics).toEqual([
      {
        code: 'outsideProject',
        at: { file: 'TeamCode/build.gradle', line: 1 },
        detail: 'shared.gradle links outside the project'
      }
    ])
  })
})

describe('readProjectGradle', () => {
  it('열거나 저장한 프로젝트가 아니면 읽지 않는다', async () => {
    await writeFile(
      join(root, 'TeamCode', 'build.gradle'),
      "dependencies { implementation 'a:b:1' }"
    )
    expect(await readProjectGradle(root)).toEqual({
      dependencies: [],
      repositories: [],
      compileSdk: null,
      diagnostics: [],
      files: []
    })
    trustRoot(root)
    expect((await readProjectGradle(root)).dependencies).toHaveLength(1)
  })

  it('디스크의 FTC 12.0 템플릿을 말뭉치와 같게 읽는다', async () => {
    await cp(join(FIXTURES, 'ftc12'), root, { recursive: true })
    trustRoot(root)
    expect(await readProjectGradle(root)).toEqual(await readGradleProject(fixtureSource('ftc12')))
  })

  it('읽기가 예외를 던져도 INIT을 깨지 않고 진단 하나로 알린다', async () => {
    trustRoot(root)
    const project = await readProjectGradle(root, () => Promise.reject(new Error('boom')))
    expect(project.dependencies).toEqual([])
    expect(project.diagnostics).toEqual([
      {
        code: 'unsupportedSyntax',
        at: { file: 'TeamCode/build.gradle', line: 1 },
        detail: 'Gradle files could not be read: boom'
      }
    ])
  })
})
