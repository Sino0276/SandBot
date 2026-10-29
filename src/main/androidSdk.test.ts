import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, posix, win32 } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crc32, deflateRawSync } from 'zlib'
import {
  detectAndroidSdks,
  getAndroidSdkState,
  installedPlatforms,
  localPropertiesSdkDir,
  nodeAndroidSdkFs,
  parseProperties,
  parseStoredAndroidSdk,
  platformOverride,
  resolveAndroidPlatform,
  setAndroidSdkChoice,
  type AndroidSdkDeps,
  type AndroidSdkDetectDeps,
  type AndroidSdkFs
} from './androidSdk'
import { readCentralDirectory, resetPlatformJarMemo } from './platformJar'
import { clearTrustedRoots, trustRoot } from './projectRoots'

// 메모리 안의 가짜 폴더 구조. files는 파일 경로 → 내용, links는 링크 경로 → 대상(절대 경로). 폴더는 파일 경로에서 정한다.
function fakeFs(
  files: Record<string, string>,
  links: Record<string, string> = {},
  api: typeof posix = posix
): AndroidSdkFs {
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
    readSmallText: async (target, maxBytes) => {
      // 링크는 따라가지 않는다(진짜 구현의 lstat처럼)
      if (target in links) return null
      const text = target in files ? files[target] : null
      return text !== null && Buffer.byteLength(text) <= maxBytes ? text : null
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

// SDK 폴더 하나(platforms/android-<버전>/android.jar들, 버전은 30·'37.0' 같은 폴더 이름의 뒷부분)
function sdkFiles(
  home: string,
  levels: (number | string)[],
  api: typeof posix = posix
): Record<string, string> {
  const files: Record<string, string> = { [api.join(home, 'platforms', '.keep')]: '' }
  for (const level of levels)
    files[api.join(home, 'platforms', `android-${level}`, 'android.jar')] = 'jar'
  return files
}

function linuxDeps(
  files: Record<string, string>,
  env: NodeJS.ProcessEnv = {},
  links: Record<string, string> = {}
): AndroidSdkDetectDeps {
  return { platform: 'linux', env, home: '/home/me', fs: fakeFs(files, links) }
}

describe('local.properties', () => {
  it('Android Studio가 쓴 sdk.dir(이스케이프 \\: \\\\)를 푼다', () => {
    const text = [
      '## This file must *NOT* be checked into Version Control Systems,',
      '# Location of the SDK. This is only used by Gradle.',
      '#Mon Oct 27 10:00:00 KST 2026',
      'sdk.dir=C\\:\\\\Users\\\\me\\\\AppData\\\\Local\\\\Android\\\\Sdk',
      ''
    ].join('\r\n')
    expect(parseProperties(text).get('sdk.dir')).toBe('C:\\Users\\me\\AppData\\Local\\Android\\Sdk')
    expect(localPropertiesSdkDir(text, 'win32')).toBe('C:\\Users\\me\\AppData\\Local\\Android\\Sdk')
  })

  it('java.util.Properties 규칙: 구분자, 이어진 줄, \\u, 주석, BOM, 같은 키는 뒤의 것', () => {
    const props = parseProperties(
      '\ufeff  a = 1\nb:2\nc 3\n! comment\n  # comment\nd=one \\\n    two\ne=\\u0041\\t\\=\\:\\\\\nf\\ g=x\nh=\na=last\n'
    )
    expect(Object.fromEntries(props)).toEqual({
      a: 'last',
      b: '2',
      c: '3',
      d: 'one two',
      e: 'A\t=:\\',
      'f g': 'x',
      h: ''
    })
    // 끝의 \\는 이스케이프된 역슬래시라 다음 줄로 잇지 않는다
    expect(Object.fromEntries(parseProperties('x=a\\\\\ny=b'))).toEqual({ x: 'a\\', y: 'b' })
  })

  it('상대 경로·빈 값·잘못된 \\u는 받지 않고, 끝의 구분자는 뗀다', () => {
    expect(localPropertiesSdkDir('sdk.dir=../sdk', 'linux')).toBeNull()
    expect(localPropertiesSdkDir('sdk.dir=', 'linux')).toBeNull()
    expect(localPropertiesSdkDir('other=1', 'linux')).toBeNull()
    expect(localPropertiesSdkDir('sdk.dir=\\uZZZZ/sdk', 'linux')).toBeNull()
    expect(localPropertiesSdkDir('sdk.dir=/opt/android-sdk/', 'linux')).toBe('/opt/android-sdk')
    expect(localPropertiesSdkDir('sdk.dir=/Users/me/Library/Android/sdk', 'darwin')).toBe(
      '/Users/me/Library/Android/sdk'
    )
    expect(localPropertiesSdkDir('sdk.dir=C\\:\\\\', 'win32')).toBe('C:\\')
  })
})

describe('Android SDK 찾기', () => {
  it('플랫폼은 android-N(숫자만)이고 android.jar가 있어야 한다', async () => {
    const deps = linuxDeps({
      ...sdkFiles('/sdk', [34, 30, 28]),
      '/sdk/platforms/android-VanillaIceCream/android.jar': 'jar',
      '/sdk/platforms/android-34-ext7/android.jar': 'jar',
      '/sdk/platforms/android-35/source.properties': '',
      '/sdk/platforms/android-033/android.jar': 'jar'
    })
    expect(await installedPlatforms('/sdk', deps)).toEqual([
      'android-28',
      'android-30',
      'android-34'
    ])
  })

  it('부 버전이 붙은 android-N.M(android-36.1, android-37.0)도 플랫폼이고, 주 버전 → 부 버전 순이다', async () => {
    // Google은 API 36부터 부 버전 플랫폼(platforms;android-36.1)을 내고, API 37은 platforms;android-37.0으로만 낸다
    const deps = linuxDeps({
      ...sdkFiles('/sdk', ['37.0', 34, '36.1', '37.1', 36, '36.10']),
      '/sdk/platforms/android-37.00/android.jar': 'jar',
      '/sdk/platforms/android-36.01/android.jar': 'jar',
      '/sdk/platforms/android-37./android.jar': 'jar',
      '/sdk/platforms/android-37.0.1/android.jar': 'jar',
      '/sdk/platforms/android-37.0-ext20/android.jar': 'jar',
      '/sdk/platforms/android-37.2-beta1/android.jar': 'jar',
      '/sdk/platforms/android-37.2/source.properties': ''
    })
    expect(await installedPlatforms('/sdk', deps)).toEqual([
      'android-34',
      'android-36',
      'android-36.1',
      'android-36.10',
      'android-37.0',
      'android-37.1'
    ])
    // 환경 설정의 플랫폼 목록(AndroidSdkInfo.platforms)도 같다
    expect(await detectAndroidSdks({ ...deps, env: { ANDROID_HOME: '/sdk' } }, null)).toEqual([
      {
        home: '/sdk',
        platforms: [
          'android-34',
          'android-36',
          'android-36.1',
          'android-36.10',
          'android-37.0',
          'android-37.1'
        ],
        source: 'env'
      }
    ])
  })

  it('local.properties → ANDROID_HOME → ANDROID_SDK_ROOT → 기본 위치 순이고, 같은 폴더는 한 번만', async () => {
    const files = {
      '/proj/local.properties': 'sdk.dir=/opt/team-sdk\n',
      ...sdkFiles('/opt/team-sdk', [30]),
      ...sdkFiles('/opt/home-sdk', [34]),
      ...sdkFiles('/opt/root-sdk', []),
      ...sdkFiles('/home/me/Android/Sdk', [33]),
      // platforms가 없는 폴더는 SDK가 아니다
      '/opt/not-sdk/tools/x': ''
    }
    const env = { ANDROID_HOME: '/opt/home-sdk', ANDROID_SDK_ROOT: '"/opt/root-sdk/"' }
    const found = await detectAndroidSdks(linuxDeps(files, env), '/proj')
    expect(found).toEqual([
      { home: '/opt/team-sdk', platforms: ['android-30'], source: 'localProperties' },
      { home: '/opt/home-sdk', platforms: ['android-34'], source: 'env' },
      { home: '/opt/root-sdk', platforms: [], source: 'env' },
      { home: '/home/me/Android/Sdk', platforms: ['android-33'], source: 'default' }
    ])
    // 프로젝트를 모르면 local.properties는 보지 않는다. 링크로 같은 폴더면 한 번만.
    const linked = await detectAndroidSdks(
      linuxDeps(
        files,
        { ANDROID_HOME: '/opt/link', ANDROID_SDK_ROOT: '/opt/team-sdk' },
        {
          '/opt/link': '/opt/team-sdk'
        }
      ),
      null
    )
    expect(linked.map((s) => [s.home, s.source])).toEqual([
      ['/opt/link', 'env'],
      ['/home/me/Android/Sdk', 'default']
    ])
    // SDK가 아닌 sdk.dir·상대 경로 환경 변수는 건너뛴다
    const skipped = await detectAndroidSdks(
      linuxDeps(
        { ...files, '/proj/local.properties': 'sdk.dir=/opt/not-sdk' },
        { ANDROID_HOME: 'relative/sdk' }
      ),
      '/proj'
    )
    expect(skipped.map((s) => s.home)).toEqual(['/home/me/Android/Sdk'])
  })

  it('링크인 local.properties·큰 local.properties는 읽지 않는다', async () => {
    const files = {
      '/elsewhere/local.properties': 'sdk.dir=/opt/sdk',
      ...sdkFiles('/opt/sdk', [34])
    }
    const viaLink = await detectAndroidSdks(
      linuxDeps(files, {}, { '/proj/local.properties': '/elsewhere/local.properties' }),
      '/proj'
    )
    expect(viaLink).toEqual([])
    const huge = await detectAndroidSdks(
      linuxDeps({ ...files, '/proj/local.properties': `sdk.dir=/opt/sdk\n#${'x'.repeat(70_000)}` }),
      '/proj'
    )
    expect(huge).toEqual([])
  })

  it('Windows: %LOCALAPPDATA%\\Android\\Sdk, 환경 변수 이름의 대소문자, 대소문자만 다른 같은 폴더', async () => {
    const files = {
      ...sdkFiles('C:\\Users\\me\\AppData\\Local\\Android\\Sdk', [34], win32),
      'C:\\proj\\local.properties':
        'sdk.dir=C\\:\\\\Users\\\\me\\\\AppData\\\\Local\\\\Android\\\\Sdk'
    }
    const deps: AndroidSdkDetectDeps = {
      platform: 'win32',
      env: {
        LocalAppData: 'C:\\Users\\me\\AppData\\Local',
        Android_Home: 'c:\\users\\me\\appdata\\local\\android\\sdk'
      },
      home: 'C:\\Users\\me',
      fs: {
        ...fakeFs(files, {}, win32),
        // 대소문자를 구분하지 않는 파일 시스템
        realpath: async (target) => target.toLowerCase(),
        isDirectory: async (target) =>
          Object.keys(files).some((f) => f.toLowerCase().startsWith(target.toLowerCase() + '\\'))
      }
    }
    const found = await detectAndroidSdks(deps, 'C:\\proj')
    expect(found.map((s) => [s.home, s.source])).toEqual([
      ['C:\\Users\\me\\AppData\\Local\\Android\\Sdk', 'localProperties']
    ])
  })

  it('macOS: ~/Library/Android/sdk', async () => {
    const files = sdkFiles('/Users/me/Library/Android/sdk', [34])
    const found = await detectAndroidSdks(
      { platform: 'darwin', env: {}, home: '/Users/me', fs: fakeFs(files) },
      null
    )
    expect(found).toEqual([
      { home: '/Users/me/Library/Android/sdk', platforms: ['android-34'], source: 'default' }
    ])
  })
})

describe('Android SDK 설정(환경 설정 창)', () => {
  let dir: string
  let settingsFile: string

  const files = {
    ...sdkFiles('/home/me/Android/Sdk', [30, 34]),
    ...sdkFiles('/opt/other-sdk', [33]),
    ...sdkFiles('/opt/picked', [35])
  }

  function deps(extra: Record<string, string> = {}, env: NodeJS.ProcessEnv = {}): AndroidSdkDeps {
    return {
      ...linuxDeps({ ...files, ...extra }, { ANDROID_HOME: '/opt/other-sdk', ...env }),
      settingsFile,
      cacheDir: join(dir, 'cache')
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-android-sdk-'))
    settingsFile = join(dir, 'android-sdk.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('설정이 없으면 자동: 찾은 것 중 첫 SDK', async () => {
    const state = await getAndroidSdkState(null, deps())
    expect(state.choice).toEqual({ kind: 'auto' })
    expect(state.active).toEqual({
      home: '/opt/other-sdk',
      platforms: ['android-33'],
      source: 'env'
    })
    expect(state.detected.map((s) => s.home)).toEqual(['/opt/other-sdk', '/home/me/Android/Sdk'])
  })

  it('찾은 목록의 SDK를 고르면 저장하고, 목록에 없는 폴더는 무시한다', async () => {
    const chosen = await setAndroidSdkChoice(
      { kind: 'detected', home: '/home/me/Android/Sdk' },
      null,
      deps(),
      async () => null
    )
    expect(chosen.choice).toEqual({ kind: 'custom', home: '/home/me/Android/Sdk' })
    expect(chosen.active).toEqual({
      home: '/home/me/Android/Sdk',
      platforms: ['android-30', 'android-34'],
      source: 'setting'
    })
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      kind: 'custom',
      home: '/home/me/Android/Sdk'
    })
    const ignored = await setAndroidSdkChoice(
      { kind: 'detected', home: '/opt/picked' },
      null,
      deps(),
      async () => null
    )
    expect(ignored.choice).toEqual({ kind: 'custom', home: '/home/me/Android/Sdk' })
    const auto = await setAndroidSdkChoice({ kind: 'auto' }, null, deps(), async () => null)
    expect(auto.choice).toEqual({ kind: 'auto' })
    const junk = await setAndroidSdkChoice('nonsense', null, deps(), async () => null)
    expect(junk.choice).toEqual({ kind: 'auto' })
  })

  it('찾아보기: SDK가 아니면 notSdk, platforms·platforms/android-N 폴더를 고르면 위의 SDK, 취소하면 그대로', async () => {
    const titles: string[] = []
    const browse =
      (picked: string | null) =>
      async (title: string): Promise<string | null> => {
        titles.push(title)
        return picked
      }
    const bad = await setAndroidSdkChoice(
      { kind: 'browse', title: '고르기' },
      null,
      deps(),
      browse('/opt')
    )
    expect(bad.error).toBe('notSdk')
    expect(bad.choice).toEqual({ kind: 'auto' })
    expect(titles).toEqual(['고르기'])
    const sdk = await setAndroidSdkChoice(
      { kind: 'browse', title: '' },
      null,
      deps(),
      browse('/opt/picked')
    )
    expect(sdk.error).toBeUndefined()
    expect(sdk.active).toEqual({
      home: '/opt/picked',
      platforms: ['android-35'],
      source: 'setting'
    })
    const viaPlatforms = await setAndroidSdkChoice(
      { kind: 'browse', title: '' },
      null,
      deps(),
      browse('/opt/other-sdk/platforms')
    )
    expect(viaPlatforms.choice).toEqual({ kind: 'custom', home: '/opt/other-sdk' })
    const viaLevel = await setAndroidSdkChoice(
      { kind: 'browse', title: '' },
      null,
      deps(),
      browse('/home/me/Android/Sdk/platforms/android-34')
    )
    expect(viaLevel.choice).toEqual({ kind: 'custom', home: '/home/me/Android/Sdk' })
    const cancelled = await setAndroidSdkChoice(
      { kind: 'browse', title: '' },
      null,
      deps(),
      browse(null)
    )
    expect(cancelled.choice).toEqual({ kind: 'custom', home: '/home/me/Android/Sdk' })
  })

  it('고른 폴더를 쓸 수 없게 되면 active는 null이다(자동으로 넘어가지 않는다)', async () => {
    await writeFile(settingsFile, JSON.stringify({ kind: 'custom', home: '/opt/gone' }))
    const state = await getAndroidSdkState(null, deps())
    expect(state.choice).toEqual({ kind: 'custom', home: '/opt/gone' })
    expect(state.active).toBeNull()
    expect(await resolveAndroidPlatform('/proj', 34, deps())).toEqual({
      ok: false,
      code: 'noAndroidSdk',
      detail: ''
    })
  })

  it('깨진 설정 파일은 자동으로 읽는다', () => {
    expect(parseStoredAndroidSdk('{')).toEqual({ kind: 'auto' })
    expect(parseStoredAndroidSdk('{"kind":"custom","home":""}')).toEqual({ kind: 'auto' })
    expect(parseStoredAndroidSdk('{"kind":"custom","home":3}')).toEqual({ kind: 'auto' })
    expect(parseStoredAndroidSdk('{"kind":"custom","home":"/x"}')).toEqual({
      kind: 'custom',
      home: '/x'
    })
  })
})

// ───────────────────────── 컴파일 기준 ─────────────────────────

// 아주 작은 android.jar(시험용, deflate 엔트리)
function tinyAndroidJar(names: string[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const name of names) {
    const data = Buffer.from(`class ${name}`)
    const stored = deflateRawSync(data)
    const nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    parts.push(local, nameBytes, stored)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(8, 10)
    record.writeUInt32LE(crc32(data), 16)
    record.writeUInt32LE(stored.length, 20)
    record.writeUInt32LE(data.length, 24)
    record.writeUInt16LE(nameBytes.length, 28)
    record.writeUInt32LE(offset, 42)
    central.push(record, nameBytes)
    offset += 30 + nameBytes.length + stored.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

describe('컴파일 기준(플랫폼 jar)', () => {
  let dir: string

  // levels는 platforms/android-<버전> 폴더(30, '37.0' …). 각 jar에는 그 버전 표시 클래스(java/util/Api37_0.class)가 있다.
  async function realSdk(
    levels: (number | string)[],
    broken: (number | string)[] = [],
    name = 'sdk'
  ): Promise<string> {
    const home = join(dir, name)
    await mkdir(join(home, 'platforms'), { recursive: true })
    for (const level of levels) {
      const jar = join(home, 'platforms', `android-${level}`, 'android.jar')
      await mkdir(dirname(jar), { recursive: true })
      await writeFile(
        jar,
        broken.includes(level)
          ? 'broken'
          : tinyAndroidJar([
              'java/lang/Object.class',
              `java/util/Api${String(level).replace('.', '_')}.class`,
              'android/app/Activity.class',
              'android/annotation/TargetApi.class'
            ])
      )
    }
    return home
  }

  // 컴파일 기준 jar가 어느 플랫폼 폴더에서 왔나(realSdk의 표시 클래스)
  async function platformMarker(result: unknown): Promise<string> {
    const resolved = result as { ok: boolean; bootClasspath?: string[] }
    if (!resolved.ok || !resolved.bootClasspath) return `not ok: ${JSON.stringify(result)}`
    const names = readCentralDirectory(await readFile(resolved.bootClasspath[0])).map((e) => e.name)
    return names.find((n) => n.startsWith('java/util/Api')) ?? 'none'
  }

  function deps(env: NodeJS.ProcessEnv): AndroidSdkDeps {
    return {
      platform: process.platform,
      env,
      home: join(dir, 'home'),
      fs: nodeAndroidSdkFs,
      settingsFile: join(dir, 'android-sdk.json'),
      cacheDir: join(dir, 'platform-cache')
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbot-platform-sdk-'))
    resetPlatformJarMemo()
    clearTrustedRoots()
  })

  afterEach(async () => {
    clearTrustedRoots()
    await rm(dir, { recursive: true, force: true })
  })

  it('SDK가 없으면 noAndroidSdk', async () => {
    expect(await resolveAndroidPlatform(join(dir, 'proj'), 34, deps({}))).toEqual({
      ok: false,
      code: 'noAndroidSdk',
      detail: ''
    })
  })

  it('compileSdk의 플랫폼에서 Java API만 고른 jar를 캐시에 만든다', async () => {
    const home = await realSdk([30, 34])
    const result = await resolveAndroidPlatform(join(dir, 'proj'), 30, deps({ ANDROID_HOME: home }))
    expect(result).toMatchObject({ ok: true, api: 30, guessed: false })
    if (!result.ok) throw new Error('unreachable')
    expect(result.bootClasspath).toHaveLength(1)
    expect(dirname(result.bootClasspath[0])).toBe(join(dir, 'platform-cache'))
    const names = readCentralDirectory(await readFile(result.bootClasspath[0])).map((e) => e.name)
    expect(names).toEqual([
      'android/annotation/TargetApi.class',
      'java/lang/Object.class',
      'java/util/Api30.class'
    ])
    // 두 번째는 같은 파일
    const again = await resolveAndroidPlatform(join(dir, 'proj'), 30, deps({ ANDROID_HOME: home }))
    expect(again).toEqual(result)
    expect(await readdir(join(dir, 'platform-cache'))).toHaveLength(1)
  })

  it('플랫폼이 없으면 noAndroidPlatform(detail android-N), compileSdk를 모르면 가장 높은 것(guessed)', async () => {
    const home = await realSdk([30, 34])
    expect(
      await resolveAndroidPlatform(join(dir, 'proj'), 33, deps({ ANDROID_HOME: home }))
    ).toEqual({
      ok: false,
      code: 'noAndroidPlatform',
      detail: 'android-33'
    })
    const guessed = await resolveAndroidPlatform(
      join(dir, 'proj'),
      null,
      deps({ ANDROID_HOME: home })
    )
    expect(guessed).toMatchObject({ ok: true, api: 34, guessed: true })
    const empty = await realSdk([], [], 'empty-sdk')
    expect(
      await resolveAndroidPlatform(join(dir, 'proj'), null, deps({ ANDROID_HOME: empty }))
    ).toEqual({
      ok: false,
      code: 'noAndroidPlatform',
      detail: 'android-*'
    })
  })

  it('compileSdk N은 android-N, 없으면 android-N.0을 쓰고(API 37부터의 이름), 부 버전 플랫폼도 가장 높은 것으로 고른다', async () => {
    const home = await realSdk(['37.0', '36.1', 36])
    const env = { ANDROID_HOME: home }
    const project = join(dir, 'proj')
    const r37 = await resolveAndroidPlatform(project, 37, deps(env))
    expect(r37).toMatchObject({ ok: true, api: 37, guessed: false })
    expect(await platformMarker(r37)).toBe('java/util/Api37_0.class')
    const r36 = await resolveAndroidPlatform(project, 36, deps(env))
    expect(r36).toMatchObject({ ok: true, api: 36, guessed: false })
    expect(await platformMarker(r36)).toBe('java/util/Api36.class')
    // compileSdk를 모르면 주 버전 → 부 버전 순으로 가장 높은 것(api는 주 버전)
    const guessed = await resolveAndroidPlatform(project, null, deps(env))
    expect(guessed).toMatchObject({ ok: true, api: 37, guessed: true })
    expect(await platformMarker(guessed)).toBe('java/util/Api37_0.class')
    const upTo36 = await realSdk([36, '36.1', 34], [], 'sdk-36')
    const guessed36 = await resolveAndroidPlatform(project, null, deps({ ANDROID_HOME: upTo36 }))
    expect(guessed36).toMatchObject({ ok: true, api: 36, guessed: true })
    expect(await platformMarker(guessed36)).toBe('java/util/Api36_1.class')
    // 둘 다 있으면 android-N
    const both = await realSdk([37, '37.0'], [], 'sdk-both')
    expect(
      await platformMarker(await resolveAndroidPlatform(project, 37, deps({ ANDROID_HOME: both })))
    ).toBe('java/util/Api37.class')
    // android-36.1은 compileSdk 36의 플랫폼이 아니다(Android Studio도 compileSdk 36이면 android-36을 찾는다)
    const minorOnly = await realSdk(['36.1'], [], 'sdk-36.1')
    expect(await resolveAndroidPlatform(project, 36, deps({ ANDROID_HOME: minorOnly }))).toEqual({
      ok: false,
      code: 'noAndroidPlatform',
      detail: 'android-36'
    })
    // 부 버전 플랫폼만 있어도 compileSdk를 모르면 그것을 쓴다
    const minorGuessed = await resolveAndroidPlatform(
      project,
      null,
      deps({ ANDROID_HOME: minorOnly })
    )
    expect(minorGuessed).toMatchObject({ ok: true, api: 36, guessed: true })
    expect(await platformMarker(minorGuessed)).toBe('java/util/Api36_1.class')
  })

  it('android.jar를 읽지 못하면 failed(이유)', async () => {
    const home = await realSdk([34], [34])
    const result = await resolveAndroidPlatform(join(dir, 'proj'), 34, deps({ ANDROID_HOME: home }))
    expect(result).toMatchObject({ ok: false, code: 'failed' })
    expect(!result.ok && result.detail).toMatch(/android-34.*not a ZIP file/)
  })

  it('local.properties는 열거나 저장한 프로젝트일 때만 본다', async () => {
    const home = await realSdk([34])
    const project = join(dir, 'proj')
    await mkdir(project, { recursive: true })
    await writeFile(
      join(project, 'local.properties'),
      `sdk.dir=${home.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`
    )
    expect(await resolveAndroidPlatform(project, 34, deps({}))).toMatchObject({
      ok: false,
      code: 'noAndroidSdk'
    })
    trustRoot(project)
    expect(await resolveAndroidPlatform(project, 34, deps({}))).toMatchObject({ ok: true, api: 34 })
  })

  it('링크인 local.properties는 읽지 않는다(진짜 파일 시스템)', async () => {
    const home = await realSdk([34])
    const project = join(dir, 'proj')
    await mkdir(project, { recursive: true })
    const outside = join(dir, 'outside.properties')
    await writeFile(outside, `sdk.dir=${home.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`)
    try {
      await symlink(outside, join(project, 'local.properties'))
    } catch {
      return // 링크를 만들 수 없는 환경(Windows 권한)
    }
    trustRoot(project)
    expect(await resolveAndroidPlatform(project, 34, deps({}))).toMatchObject({
      ok: false,
      code: 'noAndroidSdk'
    })
  })

  it('시험 전용 SANDBOT_ANDROID_PLATFORM_JAR는 SDK를 찾지 않고 그 jar를 그대로 쓴다', async () => {
    const jar = join(dir, 'test-platform.jar')
    await writeFile(jar, 'anything')
    const isFile = nodeAndroidSdkFs.isFile
    expect(await platformOverride({}, 34, { isFile })).toBeNull()
    expect(
      await resolveAndroidPlatform(
        join(dir, 'proj'),
        34,
        deps({ SANDBOT_ANDROID_PLATFORM_JAR: jar })
      )
    ).toEqual({ ok: true, bootClasspath: [jar], api: 34, guessed: false })
    expect(
      await platformOverride(
        { SANDBOT_ANDROID_PLATFORM_JAR: jar, SANDBOT_ANDROID_PLATFORM_API: '30' },
        34,
        { isFile }
      )
    ).toEqual({ ok: true, bootClasspath: [jar], api: 30, guessed: false })
    expect(await platformOverride({ SANDBOT_ANDROID_PLATFORM_JAR: jar }, null, { isFile })).toEqual(
      {
        ok: true,
        bootClasspath: [jar],
        api: 0,
        guessed: false
      }
    )
    expect(
      await platformOverride({ SANDBOT_ANDROID_PLATFORM_JAR: join(dir, 'missing.jar') }, 34, {
        isFile
      })
    ).toMatchObject({ ok: false, code: 'failed' })
    expect(
      await platformOverride({ SANDBOT_ANDROID_PLATFORM_JAR: 'relative.jar' }, 34, { isFile })
    ).toMatchObject({ ok: false, code: 'failed' })
  })
})
