// CI(.github/workflows/step-converter.yml)가 GitHub Release에 올린 네이티브 STEP 변환기를 받아
// resources/step-converter/<platform>-<arch>/에 둔다. 지금 작업 폴더의 변환기 소스 해시와 같은 태그만 받으므로,
// 받은 실행 파일은 지금 소스로 빌드한 것과 같다(scripts/step-converter-source.mjs). 지금은 win32-x64만 올린다.
//
// 사용법: node scripts/fetch-step-converter.mjs [--target <platform-arch>] [--repo <owner/name>] [--optional]
//   --target   받을 대상(기본: 이 PC). 예: win32-x64
//   --repo     Release를 찾을 저장소(기본: package.json의 repository)
//   --optional 받지 못해도 실패하지 않고 경고만 한다(설치 파일 빌드에서 씀. 앱은 변환기가 없으면 WASM으로 읽는다).
//              이때 남아 있던 다른 소스의 실행 파일은 지운다(설치 파일에 들어가지 않게)
//   --out-dir  넣을 폴더(기본: resources/step-converter/<target>)
// 환경 변수: GITHUB_TOKEN 또는 GH_TOKEN(API 호출 한도), SANDBOT_GITHUB_API(테스트용 API 주소)
// 프록시 뒤에서는 NODE_USE_ENV_PROXY=1로 HTTPS_PROXY를 쓰게 한다(Node 22.21 이상).

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import {
  converterExe,
  PROVENANCE_FILE,
  releaseAssetName,
  releaseTag,
  repoRoot,
  targetMismatch
} from './step-converter-source.mjs'

// 실패 이유를 알리는 오류(--optional이면 경고로 바꾼다)
class FetchError extends Error {}

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function defaultRepo() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const match = /github(?:\.com[/:]|:)([^/]+\/[^/.#]+)/.exec(url ?? '')
  if (!match)
    throw new FetchError('package.json has no GitHub repository; pass --repo <owner/name>')
  return match[1]
}

function readProvenance(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, PROVENANCE_FILE), 'utf8'))
  } catch {
    return null
  }
}

async function request(url, accept) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  let response
  try {
    response = await fetch(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'sandbot-fetch-step-converter',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })
  } catch (error) {
    throw new FetchError(
      `cannot reach ${new URL(url).host} (${error.cause?.code ?? error.message}). ` +
        'Behind a proxy, set NODE_USE_ENV_PROXY=1'
    )
  }
  return response
}

// 자산은 API 주소(url)로 받는다. 공개 저장소는 토큰 없이, 비공개 저장소는 토큰으로 받을 수 있다
// (browser_download_url은 비공개 저장소에서 토큰을 받지 않는다)
async function download(asset) {
  const url = asset.url ?? asset.browser_download_url
  const response = await request(url, 'application/octet-stream')
  if (!response.ok) throw new FetchError(`download failed: ${response.status} ${url}`)
  try {
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    throw new FetchError(`download was cut off (${error.cause?.code ?? error.message}): ${url}`)
  }
}

async function install(target, tag, outDir, outPath) {
  const repo = option('repo') ?? defaultRepo()
  const exe = converterExe(target)
  const api = (process.env.SANDBOT_GITHUB_API ?? 'https://api.github.com').replace(/\/$/, '')
  const releaseUrl = `${api}/repos/${repo}/releases/tags/${tag}`
  const response = await request(releaseUrl, 'application/vnd.github+json')
  if (response.status === 404) {
    throw new FetchError(
      `no prebuilt STEP converter for this source (${tag} in ${repo}). ` +
        'If you just changed native/step-converter, wait for the "STEP converter" workflow on main, ' +
        'or build it yourself: pnpm build:step-converter'
    )
  }
  if (!response.ok) throw new FetchError(`GitHub API ${response.status}: ${releaseUrl}`)
  let release
  try {
    release = await response.json()
  } catch {
    throw new FetchError(`GitHub API answered with something that is not JSON: ${releaseUrl}`)
  }
  const assets = Array.isArray(release.assets) ? release.assets : []
  const assetName = releaseAssetName(target)
  const asset = assets.find((item) => item.name === assetName)
  const sums = assets.find((item) => item.name === 'SHA256SUMS')
  if (!asset || !sums) {
    throw new FetchError(
      `release ${tag} has no ${assetName} (only: ${assets.map((a) => a.name).join(', ')})`
    )
  }

  // 자산 목록(SHA256SUMS)의 해시와 받은 파일이 같아야 한다(받다 끊긴 파일·다른 파일을 쓰지 않게)
  const sumsText = (await download(sums)).toString('utf8')
  const expected = sumsText
    .split('\n')
    .map((line) => line.trim().split(/\s+\*?/))
    .find(([, name]) => name === assetName)?.[0]
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new FetchError(`SHA256SUMS of ${tag} has no hash for ${assetName}`)
  }
  console.log(`downloading ${assetName} (${tag})`)
  const bytes = await download(asset)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) {
    throw new FetchError(`${assetName}: SHA-256 ${actual} does not match ${expected}`)
  }

  // 새 파일을 옆에 쓰고 확인한 뒤 바꾼다(확인에 실패하면 원래 파일은 그대로)
  mkdirSync(outDir, { recursive: true })
  const temp = join(outDir, `.${exe}.download`)
  writeFileSync(temp, bytes)
  try {
    const mismatch = targetMismatch(temp, target)
    if (mismatch) throw new FetchError(`${assetName} is ${mismatch}`)
    if (!target.startsWith('win32')) chmodSync(temp, 0o755)
    // 이 PC용이면 실행해서 같은 소스(version.json)로 빌드됐는지 앱처럼 확인한다
    if (target === `${process.platform}-${process.arch}`) checkIdentity(temp)
    try {
      rmSync(outPath, { force: true })
      renameSync(temp, outPath)
    } catch (error) {
      // Windows는 실행 중인 파일을 바꾸지 못한다
      if (error.code === 'EBUSY' || error.code === 'EPERM')
        throw new FetchError(
          `cannot replace ${outPath} (${error.code}). Close SandBot and try again`
        )
      throw error
    }
  } finally {
    rmSync(temp, { force: true })
  }
  writeFileSync(
    join(outDir, PROVENANCE_FILE),
    `${JSON.stringify({ tag, origin: 'release', sha256: actual }, null, 2)}\n`
  )
  console.log(`STEP converter: ${outPath}`)
}

function checkIdentity(path) {
  const version = JSON.parse(
    readFileSync(join(repoRoot, 'native', 'step-converter', 'version.json'), 'utf8')
  )
  const run = spawnSync(path, ['--version'], { timeout: 15000 })
  let identity = null
  try {
    identity = JSON.parse(run.stdout?.toString() ?? '')
  } catch {
    // 아래에서 알린다
  }
  if (
    run.status !== 0 ||
    identity?.format !== version.format ||
    identity?.occtImportJs !== version.occtImportJs.commit ||
    identity?.occt !== version.occt.commit
  ) {
    throw new FetchError(
      `downloaded converter does not run or reports another build: ${run.error?.message ?? run.stdout}`
    )
  }
}

async function main() {
  const optional = process.argv.includes('--optional')
  const target = option('target') ?? `${process.platform}-${process.arch}`
  const tag = releaseTag()
  const outDir = option('out-dir')
    ? resolve(option('out-dir'))
    : join(repoRoot, 'resources', 'step-converter', target)
  const outPath = join(outDir, converterExe(target))

  const provenance = readProvenance(outDir)
  if (existsSync(outPath) && provenance?.tag === tag) {
    console.log(`STEP converter is up to date (${tag}, ${provenance.origin}): ${outPath}`)
    return
  }
  try {
    await install(target, tag, outDir, outPath)
  } catch (error) {
    if (!(error instanceof FetchError)) throw error
    // 있던 실행 파일은 지금 소스의 것이 아니다(같으면 위에서 끝났다)
    const stale = existsSync(outPath)
    const staleTag = provenance?.tag ?? 'unknown sources'
    if (!optional) {
      console.error(`error: ${error.message}`)
      if (stale) console.error(`${outPath} is still the converter from ${staleTag}`)
      process.exitCode = 1
      return
    }
    console.warn(`warning: ${error.message}`)
    // 설치 파일에 다른 소스로 만든 변환기를 넣지 않는다. 앱은 --version이 같으면 그대로 쓰기 때문이다.
    if (stale) {
      try {
        rmSync(outPath, { force: true })
        rmSync(join(outDir, PROVENANCE_FILE), { force: true })
      } catch (removeError) {
        console.error(
          `error: cannot remove ${outPath} (${removeError.code}), which is from ${staleTag}. ` +
            'Close SandBot and try again'
        )
        process.exitCode = 1
        return
      }
      console.warn(`removed ${outPath}: it was built from ${staleTag}, not the current sources`)
    }
    console.warn('the app will read STEP files with the built-in WASM converter instead')
  }
}

await main()
