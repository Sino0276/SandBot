import { createHash } from 'crypto'
import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { crc32, deflateRawSync } from 'zlib'
import type { HttpGet, HttpResponse } from './http'

// 라이브러리 시험 지원(네트워크 없이): ZIP 만들기, 가짜 저장소(HttpGet), 가짜 Gradle 캐시, POM·.module 글자.

export type ZipInput = { name: string; data: Buffer | string; store?: boolean }

export function makeZip(entries: readonly ZipInput[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const compressed = entry.store ? data : deflateRawSync(data)
    const method = entry.store ? 0 : 8
    const name = Buffer.from(entry.name)
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + compressed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

// 클래스 이름들('com/x/A')로 jar(내용은 가짜 바이트)
export function makeJar(classes: readonly string[]): Buffer {
  return makeZip([
    { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\n' },
    ...classes.map((name) => ({ name: `${name}.class`, data: `class ${name}` }))
  ])
}

export function makeAar(classes: readonly string[], extra: readonly ZipInput[] = []): Buffer {
  return makeZip([
    { name: 'AndroidManifest.xml', data: '<manifest/>' },
    { name: 'classes.jar', data: makeJar(classes) },
    ...extra
  ])
}

export const hex = (algorithm: 'sha1' | 'sha256' | 'sha512', bytes: Buffer | string): string =>
  createHash(algorithm).update(bytes).digest('hex')

// ---- 가짜 저장소 ----

export type Route =
  | Buffer
  | string
  | { status: number; headers?: Record<string, string>; body?: Buffer | string }
  | (() => Route)
  | Error

export type FakeHttp = HttpGet & { requests: string[] }

function respond(route: Route): HttpResponse {
  if (typeof route === 'function') return respond(route())
  if (route instanceof Error) throw route
  const value =
    typeof route === 'string' || Buffer.isBuffer(route) ? { status: 200, body: route } : route
  const body = value.body === undefined ? null : Buffer.from(value.body)
  const headers = new Map(
    Object.entries(value.headers ?? {}).map(([key, val]) => [key.toLowerCase(), val])
  )
  return {
    status: value.status,
    header: (name) => headers.get(name.toLowerCase()) ?? null,
    body: body
      ? (async function* () {
          yield new Uint8Array(body)
        })()
      : null
  }
}

// 등록하지 않은 주소는 404. routes 값은 받을 때마다 다시 읽는다(시험이 바꿀 수 있다).
export function fakeHttp(routes: Map<string, Route> | Record<string, Route>): FakeHttp {
  const table = routes instanceof Map ? routes : new Map(Object.entries(routes))
  const requests: string[] = []
  const http = (async (url: string, options: { signal: AbortSignal }) => {
    if (options.signal.aborted) throw new Error('aborted')
    requests.push(url)
    const route = table.get(url)
    if (route === undefined) return respond({ status: 404, body: '<html>not found</html>' })
    return respond(route)
  }) as FakeHttp
  http.requests = requests
  return http
}

export const CENTRAL = 'https://repo1.maven.org/maven2/'
export const MIRROR = 'https://maven-central.storage-download.googleapis.com/maven2/'
export const BROTT = 'https://maven.brott.dev/'
export const GOOGLE = 'https://dl.google.com/dl/android/maven2/'

export function artifactUrl(base: string, coordinate: string, file: string): string {
  const [group, artifact, version] = coordinate.split(':')
  return `${base}${group.split('.').join('/')}/${artifact}/${version}/${file}`
}

// 저장소에 파일을 올린다(checksums면 .sha1·.sha256도, 'sha1'이면 .sha1만 — 오래된 Maven Central 파일처럼)
export function publish(
  routes: Map<string, Route>,
  base: string,
  coordinate: string,
  file: string,
  bytes: Buffer | string,
  checksums: boolean | 'sha1' = base !== BROTT
): void {
  const url = artifactUrl(base, coordinate, file)
  routes.set(url, Buffer.from(bytes))
  if (checksums) {
    routes.set(`${url}.sha1`, hex('sha1', bytes))
    if (checksums !== 'sha1' && !file.endsWith('.pom') && !file.endsWith('.module'))
      routes.set(`${url}.sha256`, `${hex('sha256', bytes)}  ${file}`)
  }
}

// ---- POM ----

export type PomDep = {
  coordinate: string
  scope?: string
  optional?: boolean
  type?: string
  exclusions?: string[]
}

export function pom(options: {
  coordinate: string
  packaging?: string
  parent?: string
  properties?: Record<string, string>
  dependencies?: PomDep[]
  managed?: PomDep[]
  marker?: boolean
  relocated?: boolean
}): string {
  const [group, artifact, version] = options.coordinate.split(':')
  const dep = (d: PomDep): string => {
    const [g, a, v] = d.coordinate.split(':')
    return [
      '    <dependency>',
      `      <groupId>${g}</groupId>`,
      `      <artifactId>${a}</artifactId>`,
      v ? `      <version>${v}</version>` : '',
      d.scope ? `      <scope>${d.scope}</scope>` : '',
      d.type ? `      <type>${d.type}</type>` : '',
      d.optional ? '      <optional>true</optional>' : '',
      d.exclusions
        ? `      <exclusions>${d.exclusions
            .map((e) => {
              const [eg, ea] = e.split(':')
              return `<exclusion><groupId>${eg}</groupId><artifactId>${ea}</artifactId></exclusion>`
            })
            .join('')}</exclusions>`
        : '',
      '    </dependency>'
    ]
      .filter(Boolean)
      .join('\n')
  }
  const parent = options.parent?.split(':')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0">',
    options.marker ? '  <!-- do_not_remove: published-with-gradle-metadata -->' : '',
    '  <modelVersion>4.0.0</modelVersion>',
    parent
      ? `  <parent><groupId>${parent[0]}</groupId><artifactId>${parent[1]}</artifactId><version>${parent[2]}</version></parent>`
      : '',
    group ? `  <groupId>${group}</groupId>` : '',
    `  <artifactId>${artifact}</artifactId>`,
    version ? `  <version>${version}</version>` : '',
    options.packaging ? `  <packaging>${options.packaging}</packaging>` : '',
    options.properties
      ? `  <properties>${Object.entries(options.properties)
          .map(([k, v]) => `<${k}>${v}</${k}>`)
          .join('')}</properties>`
      : '',
    options.relocated
      ? '  <distributionManagement><relocation><groupId>x</groupId></relocation></distributionManagement>'
      : '',
    options.managed
      ? `  <dependencyManagement><dependencies>\n${options.managed.map(dep).join('\n')}\n  </dependencies></dependencyManagement>`
      : '',
    options.dependencies
      ? `  <dependencies>\n${options.dependencies.map(dep).join('\n')}\n  </dependencies>`
      : '',
    '</project>',
    ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export function moduleJson(options: {
  coordinate: string
  file: { name: string; bytes: Buffer }
  api?: { coordinate: string; excludes?: string[] }[]
  runtime?: { coordinate: string; excludes?: string[] }[]
  constraints?: string[]
}): string {
  const [group, module, version] = options.coordinate.split(':')
  const deps = (list: { coordinate: string; excludes?: string[] }[]): unknown[] =>
    list.map((d) => {
      const [g, a, v] = d.coordinate.split(':')
      return {
        group: g,
        module: a,
        version: { requires: v },
        ...(d.excludes
          ? {
              excludes: d.excludes.map((e) => {
                const [eg, ea] = e.split(':')
                return { group: eg, module: ea }
              })
            }
          : {})
      }
    })
  const files = [
    {
      name: options.file.name,
      url: options.file.name,
      size: options.file.bytes.length,
      sha256: hex('sha256', options.file.bytes),
      sha512: hex('sha512', options.file.bytes),
      sha1: hex('sha1', options.file.bytes)
    }
  ]
  const constraints = (options.constraints ?? []).map((c) => {
    const [g, a, v] = c.split(':')
    return { group: g, module: a, version: { requires: v } }
  })
  return JSON.stringify({
    formatVersion: '1.1',
    component: { group, module, version },
    variants: [
      {
        name: 'apiElements',
        attributes: { 'org.gradle.category': 'library', 'org.gradle.usage': 'java-api' },
        dependencies: deps(options.api ?? options.runtime ?? []),
        dependencyConstraints: constraints,
        files
      },
      {
        name: 'runtimeElements',
        attributes: { 'org.gradle.category': 'library', 'org.gradle.usage': 'java-runtime' },
        dependencies: deps(options.runtime ?? options.api ?? []),
        dependencyConstraints: constraints,
        files
      },
      {
        name: 'sourcesElements',
        attributes: { 'org.gradle.category': 'documentation', 'org.gradle.usage': 'java-runtime' },
        files: [
          { name: `${module}-${version}-sources.jar`, url: `${module}-${version}-sources.jar` }
        ]
      }
    ]
  })
}

// ---- 폴더 ----

export async function tempDir(prefix = 'sandbot-lib-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

// 가짜 Gradle 캐시에 파일을 넣는다(폴더 이름 = 내용 sha1)
export async function putGradleCache(
  gradleHome: string,
  coordinate: string,
  file: string,
  bytes: Buffer | string,
  folder: string = hex('sha1', bytes)
): Promise<string> {
  const [group, artifact, version] = coordinate.split(':')
  const dir = join(gradleHome, 'caches', 'modules-2', 'files-2.1', group, artifact, version, folder)
  await mkdir(dir, { recursive: true })
  const path = join(dir, file)
  await writeFile(path, bytes)
  return path
}
