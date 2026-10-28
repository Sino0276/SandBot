// 사이드카 라이브러리 통합 시험(sidecar/tests/libraries.test.ts)이 쓰는 실제 FTC 라이브러리를 받는다. 받은 것은
// sidecar/build/test-libs/(gitignore)에 두고 git에 넣지 않는다. 앱은 이 스크립트를 쓰지 않는다(앱의 라이브러리 받기는
// src/main/libraries/). 해시는 이 파일에 고정했고(받아서 SHA-256을 재고 저장소의 .sha1·.module과 대조한 값), 이미 있고
// 해시가 맞으면 다시 받지 않는다. AAR은 안의 classes.jar만 꺼내 <이름>.jar로 둔다(R·res·manifest는 쓰지 않는다).
//
//   Pedro Pathing 3.0.2   com.pedropathing:core(jar), com.pedropathing:revhub(AAR)
//   Ivy 1.1.1             com.pedropathing.ivy:core(jar), com.pedropathing.ivy:pedro(AAR)
//   FTCLib 2.1.1          org.ftclib.ftclib:core(AAR) + EJML 0.39(ejml-simple가 끌어오는 묶음) + jsr305 3.0.2
//   androidx.annotation   androidx.annotation:annotation:1.1.0(Google Maven)
//
// 사용법: node scripts/fetch-test-libraries.mjs [--json]
//   --json이면 마지막 줄에 { dir, jars: { id: 절대 경로 } }를 쓴다(시험이 child process로 부를 때).
// 프록시 뒤에서는 NODE_USE_ENV_PROXY=1로 HTTPS_PROXY를 쓰게 한다(Node 22.21 이상). Maven Central은 자주 429를 준다:
// 그때는 Google의 Maven Central 미러로 넘어가고, 둘 다 안 되면 기다렸다가(지수) 다시 한 바퀴 돈다.
// 종료 코드: 0 성공, 1 받지 못함(네트워크) 또는 해시가 다름.

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { download, FetchError, fileHash, readZip, sha256, writeAtomic } from './fetch-ftc-sdk.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const testLibrariesDir = join(repoRoot, 'sidecar', 'build', 'test-libs')

const CENTRAL = [
  'https://repo1.maven.org/maven2',
  'https://maven-central.storage-download.googleapis.com/maven2'
]
const GOOGLE = ['https://dl.google.com/dl/android/maven2']

// [id, group, artifact, version, 확장자(aar이면 classes.jar를 꺼낸다), 저장소, 받은 파일의 SHA-256]
const LIBRARIES = [
  [
    'pedroCore',
    'com.pedropathing',
    'core',
    '3.0.2',
    'jar',
    CENTRAL,
    '6920f9bab25b72fa0347c9d6d452d33784ded36849f3d34ce095c5c1421ad06e'
  ],
  [
    'pedroRevhub',
    'com.pedropathing',
    'revhub',
    '3.0.2',
    'aar',
    CENTRAL,
    'e1c00eb5aa2e767b7045811070045e06ac14363475bcdb09e0ad1cee24ce723e'
  ],
  [
    'ivyCore',
    'com.pedropathing.ivy',
    'core',
    '1.1.1',
    'jar',
    CENTRAL,
    '0a0d074263dc8e1872aa205b836f5a65b0cd08778dea23a3747f486f402783ed'
  ],
  [
    'ivyPedro',
    'com.pedropathing.ivy',
    'pedro',
    '1.1.1',
    'aar',
    CENTRAL,
    'a7cb598c3246f58a17ab2c4827b79147c42f6738f2bccc16b0793b628a51f67f'
  ],
  [
    'ftclibCore',
    'org.ftclib.ftclib',
    'core',
    '2.1.1',
    'aar',
    CENTRAL,
    '756de2bc0d2533c8614711df59f87263679e2bea07fe5bba2be491669a0363be'
  ],
  [
    'ejmlSimple',
    'org.ejml',
    'ejml-simple',
    '0.39',
    'jar',
    CENTRAL,
    '7639609431b267091f81362c70897768a3b8193836206d344c08b2004934d2ef'
  ],
  [
    'ejmlCore',
    'org.ejml',
    'ejml-core',
    '0.39',
    'jar',
    CENTRAL,
    '937fb1b1a0859d88e76b5cf0b2ddc62d03198120fbf213b5cdf2d6c950abc995'
  ],
  [
    'ejmlFdense',
    'org.ejml',
    'ejml-fdense',
    '0.39',
    'jar',
    CENTRAL,
    '9deed9648a6954c37f79543630638689fc683fb341154bf265cf41aa019e8d38'
  ],
  [
    'ejmlDdense',
    'org.ejml',
    'ejml-ddense',
    '0.39',
    'jar',
    CENTRAL,
    '28bb9c06901211de146d80ef4ef0299c5dae468a8f9d585d016c19479ed93ef2'
  ],
  [
    'ejmlCdense',
    'org.ejml',
    'ejml-cdense',
    '0.39',
    'jar',
    CENTRAL,
    'ab333ff4984a8b8d7c5ef5015f52ea27f1a2fc24ee377f2e5dab31da0a10165c'
  ],
  [
    'ejmlZdense',
    'org.ejml',
    'ejml-zdense',
    '0.39',
    'jar',
    CENTRAL,
    '475ac2a2cf4467f814a54f13fa68c1345f82cd2cabaa23757e96e2c0cb2c80d3'
  ],
  [
    'ejmlDsparse',
    'org.ejml',
    'ejml-dsparse',
    '0.39',
    'jar',
    CENTRAL,
    'c45113df12bb5ca6f6d69e6c2b5dfb74e91acb518c90adc75fa90225c4c1616e'
  ],
  [
    'ejmlFsparse',
    'org.ejml',
    'ejml-fsparse',
    '0.39',
    'jar',
    CENTRAL,
    '8e588f16233c5961ddc0f517a165ca35c46f85136756ee6119727885b375d1b9'
  ],
  [
    'jsr305',
    'com.google.code.findbugs',
    'jsr305',
    '3.0.2',
    'jar',
    CENTRAL,
    '766ad2a0783f2687962c8ad74ceecc38a28b9f72a2d085ee438b7813e928d0c7'
  ],
  [
    'androidxAnnotation',
    'androidx.annotation',
    'annotation',
    '1.1.0',
    'jar',
    GOOGLE,
    'd38d63edb30f1467818d50aaf05f8a692dea8b31392a049bfa991b159ad5b692'
  ]
]

// 시험에서 쓰는 묶음(실행 클래스패스 순서). 좌표는 위 표의 id.
export const TEST_LIBRARY_SETS = {
  pedro: ['pedroCore', 'pedroRevhub'],
  ivy: ['ivyCore', 'ivyPedro', 'pedroCore', 'pedroRevhub'],
  ftclib: [
    'ftclibCore',
    'ejmlSimple',
    'ejmlCore',
    'ejmlFdense',
    'ejmlDdense',
    'ejmlCdense',
    'ejmlZdense',
    'ejmlDsparse',
    'ejmlFsparse',
    'jsr305'
  ],
  annotations: ['androidxAnnotation']
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// 미러를 차례로(한 번씩) 시도하고, 한 바퀴가 모두 일시적 오류(네트워크·429·5xx)면 기다렸다가 다시 돈다.
// 해시가 다르거나 404 같은 오류는 바로 실패다(다른 미러가 다른 바이트를 주어도 받지 않는다).
async function downloadFromAny(urls, expected, log) {
  const rounds = 4
  let lastError
  for (let round = 1; round <= rounds; round++) {
    for (const url of urls) {
      try {
        return await download(url, expected, log, { attempts: 1 })
      } catch (error) {
        if (!(error instanceof FetchError)) throw error
        const transient = /download failed: (429|5\d\d)|cannot download/.test(error.message)
        if (!transient) throw error
        lastError = error
        log(`  ${error.message}`)
      }
    }
    if (round < rounds) {
      const wait = 2000 * 2 ** (round - 1)
      log(`  retrying in ${Math.round(wait / 1000)} s`)
      await sleep(wait)
    }
  }
  throw lastError
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 시험용 라이브러리를 받아 둔다(있고 맞으면 그대로).
 * @returns {Promise<{ dir: string, jars: Record<string, string> }>} id → jar 절대 경로
 */
export async function ensureTestLibraries({ log = console.log } = {}) {
  const jars = {}
  for (const [id, group, artifact, version, extension, repositories, hash] of LIBRARIES) {
    const base = `${artifact}-${version}`
    const dir = join(testLibrariesDir, group)
    const downloaded = join(dir, `${base}.${extension}`)
    const jar = join(dir, `${base}.jar`)
    let bytes = null
    if (fileHash(downloaded) !== hash) {
      log(`downloading ${group}:${artifact}:${version}`)
      const path = `${group.replace(/\./g, '/')}/${artifact}/${version}/${base}.${extension}`
      bytes = await downloadFromAny(
        repositories.map((repository) => `${repository}/${path}`),
        hash,
        log
      )
      mkdirSync(dir, { recursive: true })
      writeAtomic(downloaded, bytes)
    }
    if (extension === 'aar') {
      // classes.jar는 이 AAR에서 꺼낸 것일 때만 쓴다
      const stamp = join(dir, `${base}.extracted`)
      const extracted = readJson(stamp)
      if (extracted?.aar !== hash || fileHash(jar) !== extracted.jar) {
        const classes = readZip(bytes ?? readFileSync(downloaded)).read('classes.jar')
        if (!classes) throw new FetchError(`${group}:${artifact}:${version} has no classes.jar`)
        writeAtomic(jar, classes)
        writeAtomic(stamp, `${JSON.stringify({ aar: hash, jar: sha256(classes) }, null, 2)}\n`)
      }
    }
    jars[id] = jar
  }
  return { dir: testLibrariesDir, jars }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes('--json')
  try {
    const result = await ensureTestLibraries({ log: json ? console.error : console.log })
    if (json) console.log(JSON.stringify(result))
    else console.log(`test libraries (${Object.keys(result.jars).length}): ${result.dir}`)
  } catch (error) {
    if (!(error instanceof FetchError)) throw error
    console.error(`error: ${error.message}`)
    process.exitCode = 1
  }
}
