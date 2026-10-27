import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, posix, win32 } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  detectJdks,
  getJdkState,
  inspectJdk,
  javaHomeCandidates,
  javaMajor,
  nodeJdkFs,
  parseReleaseVersion,
  parseStoredJdk,
  resetJdkCache,
  resolveActiveJdk,
  setJdkChoice,
  type JdkDeps,
  type JdkDetectDeps,
  type JdkFs
} from './jdk'

// 메모리 안의 가짜 폴더 구조. files는 파일 경로 → 내용, links는 링크 경로 → 대상(절대 경로). 폴더는 파일 경로에서 정한다.
function fakeFs(
  files: Record<string, string>,
  links: Record<string, string> = {},
  api: typeof posix = posix
): JdkFs {
  const exists = (target: string): boolean =>
    target in files ||
    Object.keys(files).some((file) =>
      file.startsWith(target.endsWith(api.sep) ? target : target + api.sep)
    )
  const resolveLinks = (target: string): string | null => {
    let current = api.normalize(target)
    for (let guard = 0; guard < 40; guard++) {
      const parts = current.split(api.sep)
      let changed = false
      for (let i = parts.length; i > 0; i--) {
        const prefix = parts.slice(0, i).join(api.sep) || api.sep
        const link = links[prefix]
        if (link !== undefined) {
          current = api.join(link, ...parts.slice(i))
          changed = true
          break
        }
      }
      if (!changed) return exists(current) ? current : null
    }
    return null
  }
  return {
    isFile: async (target) => {
      const real = resolveLinks(target)
      return real !== null && real in files
    },
    isDirectory: async (target) => {
      const real = resolveLinks(target)
      return real !== null && !(real in files)
    },
    readText: async (target) => {
      const real = resolveLinks(target)
      return real !== null && real in files ? files[real] : null
    },
    readdir: async (target) => {
      const real = resolveLinks(target)
      if (real === null) return []
      const prefix = real.endsWith(api.sep) ? real : real + api.sep
      const names = new Set<string>()
      for (const key of [...Object.keys(files), ...Object.keys(links)]) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split(api.sep)[0])
      }
      return [...names]
    },
    realpath: async (target) => resolveLinks(target)
  }
}

// JDK 폴더 하나의 파일들
function jdkFiles(
  home: string,
  version: string,
  options: { javac?: boolean; release?: boolean; exe?: boolean; api?: typeof posix } = {}
): Record<string, string> {
  const api = options.api ?? posix
  const ext = options.exe ? '.exe' : ''
  const files: Record<string, string> = { [api.join(home, 'bin', `java${ext}`)]: '' }
  if (options.javac !== false) files[api.join(home, 'bin', `javac${ext}`)] = ''
  if (options.release !== false)
    files[api.join(home, 'release')] = `IMPLEMENTOR="Test"\nJAVA_VERSION="${version}"\n`
  return files
}

function linuxDeps(fs: JdkFs, env: NodeJS.ProcessEnv = {}): JdkDetectDeps {
  return { platform: 'linux', env, home: '/home/team', fs, queryRegistry: async () => '' }
}

describe('release 파일과 버전', () => {
  it('JAVA_VERSION 값을 읽는다(따옴표·CRLF·BOM)', () => {
    expect(parseReleaseVersion('JAVA_VERSION="17.0.2"\n')).toBe('17.0.2')
    expect(parseReleaseVersion('\uFEFFIMPLEMENTOR="X"\r\nJAVA_VERSION="21"\r\n')).toBe('21')
    expect(parseReleaseVersion('JAVA_VERSION=11.0.21\n')).toBe('11.0.21')
    expect(parseReleaseVersion('JAVA_RUNTIME_VERSION="21+35"\n')).toBeNull()
    expect(parseReleaseVersion('JAVA_VERSION=""\n')).toBeNull()
    expect(parseReleaseVersion('')).toBeNull()
  })

  it('주 버전을 계산한다(1.x 방식 포함)', () => {
    expect(javaMajor('1.8.0_392')).toBe(8)
    expect(javaMajor('1.8')).toBe(8)
    expect(javaMajor('17.0.2')).toBe(17)
    expect(javaMajor('21')).toBe(21)
    expect(javaMajor('22-ea')).toBe(22)
    expect(javaMajor('11.0.21+9')).toBe(11)
    expect(javaMajor('abc')).toBeNull()
    expect(javaMajor('')).toBeNull()
  })

  it('bin/java·bin/javac·release가 모두 있어야 JDK다(JRE는 아니다)', async () => {
    const fs = fakeFs({
      ...jdkFiles('/jdk/full', '17.0.2'),
      ...jdkFiles('/jdk/jre', '17.0.2', { javac: false }),
      ...jdkFiles('/jdk/norelease', '17.0.2', { release: false })
    })
    const deps = { platform: 'linux' as const, fs }
    expect(await inspectJdk('/jdk/full', 'path', deps)).toEqual({
      home: '/jdk/full',
      version: '17.0.2',
      major: 17,
      source: 'path'
    })
    expect(await inspectJdk('/jdk/jre', 'path', deps)).toBeNull()
    expect(await inspectJdk('/jdk/norelease', 'path', deps)).toBeNull()
    expect(await inspectJdk('/jdk/missing', 'path', deps)).toBeNull()
    expect(await inspectJdk('relative/jdk', 'path', deps)).toBeNull()
  })
})

describe('JDK 찾기(Linux)', () => {
  it('Android Studio jbr → JAVA_HOME → PATH 순이고, 링크를 따라 같은 JDK는 한 번만', async () => {
    const fs = fakeFs(
      {
        ...jdkFiles('/opt/android-studio/jbr', '21.0.6'),
        ...jdkFiles('/usr/lib/jvm/java-17', '17.0.12'),
        ...jdkFiles('/usr/lib/jvm/java-11', '11.0.24'),
        ...jdkFiles('/usr/lib/jvm/java-8', '1.8.0_392')
      },
      {
        '/usr/bin/java': '/etc/alternatives/java',
        '/etc/alternatives/java': '/usr/lib/jvm/java-17/bin/java',
        '/home/team/bin/java': '/usr/lib/jvm/java-11/bin/java',
        '/opt/jdk8': '/usr/lib/jvm/java-8'
      }
    )
    const found = await detectJdks(
      linuxDeps(fs, {
        JAVA_HOME: '/opt/jdk8',
        PATH: 'relative/bin:/usr/bin:/home/team/bin:/opt/android-studio/jbr/bin'
      })
    )
    expect(found.map((info) => [info.source, info.home, info.major])).toEqual([
      ['androidStudio', '/opt/android-studio/jbr', 21],
      ['javaHome', '/opt/jdk8', 8],
      ['path', '/usr/lib/jvm/java-17', 17],
      ['path', '/usr/lib/jvm/java-11', 11]
    ])
  })

  it('Toolbox(2.x apps/android-studio, 1.x ch-*/<빌드> 새것부터)와 홈 폴더 설치를 본다', async () => {
    const apps = '/home/team/.local/share/JetBrains/Toolbox/apps'
    const fs = fakeFs({
      ...jdkFiles(`${apps}/AndroidStudio/ch-0/233.14808.21/jbr`, '17.0.9'),
      ...jdkFiles(`${apps}/AndroidStudio/ch-0/241.18034.62/jbr`, '21.0.3'),
      ...jdkFiles(`${apps}/android-studio/jbr`, '21.0.5'),
      ...jdkFiles('/home/team/android-studio/jbr', '17.0.6')
    })
    const found = await detectJdks(linuxDeps(fs))
    expect(found.map((info) => info.home)).toEqual([
      '/home/team/android-studio/jbr',
      `${apps}/android-studio/jbr`,
      `${apps}/AndroidStudio/ch-0/241.18034.62/jbr`,
      `${apps}/AndroidStudio/ch-0/233.14808.21/jbr`
    ])
    expect(found.every((info) => info.source === 'androidStudio')).toBe(true)
  })

  it('JAVA_HOME 끝의 bin과 따옴표를 받는다', () => {
    expect(javaHomeCandidates({ platform: 'linux', env: { JAVA_HOME: '/opt/jdk/' } })).toEqual([
      '/opt/jdk'
    ])
    expect(javaHomeCandidates({ platform: 'linux', env: { JAVA_HOME: '"/opt/jdk/bin"' } })).toEqual(
      ['/opt/jdk/bin', '/opt/jdk']
    )
    expect(javaHomeCandidates({ platform: 'linux', env: { JAVA_HOME: 'jdk' } })).toEqual([])
    expect(javaHomeCandidates({ platform: 'linux', env: {} })).toEqual([])
  })

  it('진짜 폴더의 심볼릭 링크 PATH java를 따라간다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbot-jdk-test-'))
    try {
      const home = join(dir, 'jdks', 'temurin-21')
      await mkdir(join(home, 'bin'), { recursive: true })
      await writeFile(join(home, 'bin', 'java'), '')
      await writeFile(join(home, 'bin', 'javac'), '')
      await writeFile(join(home, 'release'), 'JAVA_VERSION="21.0.4"\n')
      await mkdir(join(dir, 'bin'))
      await symlink(join(home, 'bin', 'java'), join(dir, 'bin', 'java'))
      const found = await detectJdks({
        platform: 'linux',
        env: { PATH: join(dir, 'bin') },
        home: join(dir, 'home'),
        fs: nodeJdkFs,
        queryRegistry: async () => ''
      })
      const fromPath = found.filter((info) => info.source === 'path')
      expect(fromPath).toEqual([{ home, version: '21.0.4', major: 21, source: 'path' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('JDK 찾기(Windows·macOS)', () => {
  it('Windows: 레지스트리 설치 위치의 jbr, java.exe 이름, Path 이름의 대소문자', async () => {
    const api = win32
    const fs = fakeFs(
      {
        ...jdkFiles('D:\\Android\\Android Studio\\jbr', '21.0.3', { exe: true, api }),
        ...jdkFiles('C:\\Users\\team\\AppData\\Local\\Programs\\Android Studio\\jbr', '17.0.7', {
          exe: true,
          api
        }),
        ...jdkFiles('C:\\Java\\jdk-17', '17.0.2', { exe: true, api }),
        ...jdkFiles('C:\\Java\\jdk-unix', '17.0.2', { api }),
        'C:\\Program Files\\Common Files\\Oracle\\Java\\javapath\\java.exe': ''
      },
      {},
      api
    )
    const registry = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Android Studio',
      '    DisplayName    REG_SZ    Android Studio',
      '    InstallLocation    REG_SZ    D:\\Android\\Android Studio',
      ''
    ].join('\r\n')
    const found = await detectJdks({
      platform: 'win32',
      env: {
        LOCALAPPDATA: 'C:\\Users\\team\\AppData\\Local',
        JAVA_HOME: 'C:\\Java\\jdk-unix',
        Path: 'C:\\Program Files\\Common Files\\Oracle\\Java\\javapath;"C:\\Java\\jdk-17\\bin"'
      },
      home: 'C:\\Users\\team',
      fs,
      queryRegistry: async (key) => (key.startsWith('HKLM\\SOFTWARE\\Microsoft') ? registry : '')
    })
    expect(found.map((info) => [info.source, info.home])).toEqual([
      ['androidStudio', 'D:\\Android\\Android Studio\\jbr'],
      ['androidStudio', 'C:\\Users\\team\\AppData\\Local\\Programs\\Android Studio\\jbr'],
      ['path', 'C:\\Java\\jdk-17']
    ])
  })

  it('Windows: Toolbox 1.x 빌드 폴더', async () => {
    const api = win32
    const builds = 'C:\\Users\\team\\AppData\\Local\\JetBrains\\Toolbox\\apps\\AndroidStudio\\ch-0'
    const fs = fakeFs(
      {
        ...jdkFiles(`${builds}\\223.8836.35.2231.9848316\\jbr`, '17.0.6', { exe: true, api }),
        ...jdkFiles(`${builds}\\241.18034.62.2412.12266719\\jbr`, '21.0.3', { exe: true, api })
      },
      {},
      api
    )
    const found = await detectJdks({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\team\\AppData\\Local' },
      home: 'C:\\Users\\team',
      fs,
      queryRegistry: async () => ''
    })
    expect(found.map((info) => info.major)).toEqual([21, 17])
  })

  it('macOS: /Applications와 ~/Applications의 Android Studio*.app 안 Contents/jbr/Contents/Home', async () => {
    const fs = fakeFs({
      ...jdkFiles('/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home', '21.0.5'),
      ...jdkFiles('/Applications/Android Studio.app/Contents/jbr/Contents/Home', '21.0.3'),
      ...jdkFiles(
        '/Users/team/Applications/Android Studio.app/Contents/jbr/Contents/Home',
        '17.0.9'
      ),
      ...jdkFiles('/Applications/Other.app/Contents/jbr/Contents/Home', '21.0.3')
    })
    const found = await detectJdks({
      platform: 'darwin',
      env: {},
      home: '/Users/team',
      fs,
      queryRegistry: async () => ''
    })
    expect(found.map((info) => info.home)).toEqual([
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      '/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home',
      '/Users/team/Applications/Android Studio.app/Contents/jbr/Contents/Home'
    ])
  })
})

describe('JDK 설정(환경 설정 창)', () => {
  let dir: string
  let deps: JdkDeps
  let picked: string | null

  beforeEach(async () => {
    resetJdkCache()
    dir = await mkdtemp(join(tmpdir(), 'sandbot-jdk-settings-'))
    const fs = fakeFs({
      ...jdkFiles('/opt/android-studio/jbr', '21.0.6'),
      ...jdkFiles('/usr/lib/jvm/java-11', '11.0.24'),
      ...jdkFiles('/opt/custom-17', '17.0.2'),
      ...jdkFiles('/opt/old-8', '1.8.0_392'),
      '/opt/not-jdk/readme.txt': ''
    })
    deps = {
      ...linuxDeps(fs, { JAVA_HOME: '/usr/lib/jvm/java-11' }),
      settingsFile: join(dir, 'jdk.json'),
      now: () => 0
    }
    picked = null
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const browse = async (): Promise<string | null> => picked

  it('설정이 없으면 자동: 찾은 것 중 17 이상인 첫 JDK', async () => {
    const state = await getJdkState(deps)
    expect(state.choice).toEqual({ kind: 'auto' })
    expect(state.active?.home).toBe('/opt/android-studio/jbr')
    expect(state.detected.map((info) => info.major)).toEqual([21, 11])
    expect((await resolveActiveJdk(deps))?.home).toBe('/opt/android-studio/jbr')
  })

  it('찾은 목록의 17 미만은 tooOld로 받지 않고, 목록에 없는 폴더는 무시한다', async () => {
    await getJdkState(deps)
    const old = await setJdkChoice({ kind: 'detected', home: '/usr/lib/jvm/java-11' }, deps, browse)
    expect(old.error).toBe('tooOld')
    expect(old.choice).toEqual({ kind: 'auto' })
    const unknown = await setJdkChoice({ kind: 'detected', home: '/opt/custom-17' }, deps, browse)
    expect(unknown.error).toBeUndefined()
    expect(unknown.choice).toEqual({ kind: 'auto' })
    const ok = await setJdkChoice(
      { kind: 'detected', home: '/opt/android-studio/jbr' },
      deps,
      browse
    )
    expect(ok.choice).toEqual({ kind: 'custom', home: '/opt/android-studio/jbr' })
    expect(ok.active?.source).toBe('setting')
  })

  it('찾아보기: JDK가 아니면 notJdk, 오래되면 tooOld, 맞으면 저장한다', async () => {
    picked = '/opt/not-jdk'
    expect((await setJdkChoice({ kind: 'browse', title: 't' }, deps, browse)).error).toBe('notJdk')
    picked = '/opt/old-8'
    expect((await setJdkChoice({ kind: 'browse', title: 't' }, deps, browse)).error).toBe('tooOld')
    picked = null
    const cancelled = await setJdkChoice({ kind: 'browse', title: 't' }, deps, browse)
    expect(cancelled.choice).toEqual({ kind: 'auto' })
    picked = '/opt/custom-17/bin'
    const state = await setJdkChoice({ kind: 'browse', title: 't' }, deps, browse)
    expect(state.error).toBeUndefined()
    expect(state.choice).toEqual({ kind: 'custom', home: '/opt/custom-17' })
    expect(state.active).toEqual({
      home: '/opt/custom-17',
      version: '17.0.2',
      major: 17,
      source: 'setting'
    })
    expect(JSON.parse(await readFile(deps.settingsFile, 'utf8'))).toEqual({
      kind: 'custom',
      home: '/opt/custom-17'
    })
    expect((await resolveActiveJdk(deps))?.home).toBe('/opt/custom-17')
    // 다시 자동으로
    expect((await setJdkChoice({ kind: 'auto' }, deps, browse)).choice).toEqual({ kind: 'auto' })
  })

  it('고른 폴더가 쓸 수 없게 되면 active는 null이다(자동으로 넘어가지 않는다)', async () => {
    await writeFile(deps.settingsFile, JSON.stringify({ kind: 'custom', home: '/opt/removed' }))
    const state = await getJdkState(deps)
    expect(state.choice).toEqual({ kind: 'custom', home: '/opt/removed' })
    expect(state.active).toBeNull()
    expect(await resolveActiveJdk(deps)).toBeNull()
  })

  it('깨진 설정 파일은 자동으로 읽는다', async () => {
    expect(parseStoredJdk('{')).toEqual({ kind: 'auto' })
    expect(parseStoredJdk('{"kind":"custom","home":""}')).toEqual({ kind: 'auto' })
    expect(parseStoredJdk('{"kind":"custom","home":"/x"}')).toEqual({ kind: 'custom', home: '/x' })
    await mkdir(dirname(deps.settingsFile), { recursive: true })
    await writeFile(deps.settingsFile, 'garbage')
    expect((await getJdkState(deps)).choice).toEqual({ kind: 'auto' })
  })
})
