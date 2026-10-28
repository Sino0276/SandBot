// Gradle 버전 비교와 좌표 확인(src/main/libraries). 충돌은 Gradle처럼 가장 높은 버전이 이긴다.
// 순서 규칙은 Gradle StaticVersionComparator·VersionParser와 같다(docs: dependency_versions.html, Version ordering):
// - '.'·'-'·'_'·'+'로 나누고, 숫자와 글자가 만나는 곳에서도 나눈다(1a1 = 1.a.1). 구분자 종류는 순서와 관계없다.
// - 숫자끼리는 값으로, 숫자는 글자보다 높다. 글자끼리는 특별한 뜻(dev < 그 밖 < rc < snapshot < final < ga < release < sp,
//   대소문자 무시)을 먼저 보고, 없으면 글자 순서(대소문자 구분)로 본다.
// - 앞이 모두 같고 한쪽에 부분이 더 있으면, 그 부분이 숫자면 높고 글자면 낮다(1.1.0 > 1.1, 1.1.a < 1.1).

const SPECIAL: Readonly<Record<string, number>> = {
  dev: -1,
  rc: 1,
  snapshot: 2,
  final: 3,
  ga: 4,
  release: 5,
  sp: 6
}

const SEPARATOR = /[.\-_+]/

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

export function versionParts(version: string): string[] {
  const parts: string[] = []
  let current = ''
  for (const ch of version) {
    if (SEPARATOR.test(ch)) {
      if (current !== '') parts.push(current)
      current = ''
      continue
    }
    if (current !== '' && isDigit(ch) !== isDigit(current[current.length - 1])) {
      parts.push(current)
      current = ''
    }
    current += ch
  }
  if (current !== '') parts.push(current)
  return parts
}

function isNumber(part: string): boolean {
  return part !== '' && [...part].every(isDigit)
}

// 숫자 부분의 값 비교(앞의 0은 값에 영향이 없다, 큰 수도 정확히)
function compareNumbers(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, '')
  const y = b.replace(/^0+(?=\d)/, '')
  if (x.length !== y.length) return x.length < y.length ? -1 : 1
  return x < y ? -1 : x > y ? 1 : 0
}

// a < b면 음수, 같으면 0, a > b면 양수
export function compareVersions(a: string, b: string): number {
  if (a === b) return 0
  const left = versionParts(a)
  const right = versionParts(b)
  const shared = Math.min(left.length, right.length)
  for (let i = 0; i < shared; i++) {
    const x = left[i]
    const y = right[i]
    if (x === y) continue
    const xNumber = isNumber(x)
    const yNumber = isNumber(y)
    if (xNumber && !yNumber) return 1
    if (yNumber && !xNumber) return -1
    if (xNumber && yNumber) {
      const result = compareNumbers(x, y)
      if (result !== 0) return result
      continue
    }
    const xSpecial = SPECIAL[x.toLowerCase()]
    const ySpecial = SPECIAL[y.toLowerCase()]
    if (xSpecial !== undefined) return xSpecial - (ySpecial ?? 0)
    if (ySpecial !== undefined) return -ySpecial
    return x < y ? -1 : 1
  }
  if (left.length > right.length) return isNumber(left[shared]) ? 1 : -1
  if (right.length > left.length) return isNumber(right[shared]) ? -1 : 1
  return 0
}

// 가장 높은 버전(같은 값이면 먼저 나온 것). 비었으면 null.
export function highestVersion(versions: Iterable<string>): string | null {
  let best: string | null = null
  for (const version of versions)
    if (best === null || compareVersions(version, best) > 0) best = version
  return best
}

// 첫 숫자 부분(주 버전). 숫자로 시작하지 않으면 null.
export function majorVersion(version: string): number | null {
  const first = versionParts(version)[0]
  if (first === undefined || !isNumber(first) || first.length > 9) return null
  return Number(first)
}

// 결정성을 위해 받지 않는 버전: '+'·'1.+'(접두), latest.*, 범위 [a,b)·(,b]·[a], SNAPSHOT
export function isDynamicVersion(version: string): boolean {
  const v = version.trim()
  if (v === '' || v.endsWith('+')) return true
  if (/^latest\./i.test(v)) return true
  if (/^[[\]()]/.test(v) || /[[\]()]$/.test(v)) return true
  return /-SNAPSHOT$/i.test(v)
}

// ---- 좌표 글자 확인 ----
// 좌표는 저장소 주소의 경로와 캐시 색인 글자가 된다(믿지 않는 Gradle 파일·POM에서 온다). 경로를 벗어나는 글자('/'·'..')나
// 빈 부분이 생기지 않는 글자만 받는다.

const GROUP = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/
const VERSION = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/
const MAX_PART = 128

export function isValidGroup(group: string): boolean {
  return group.length <= MAX_PART && GROUP.test(group)
}

export function isValidArtifact(artifact: string): boolean {
  return artifact.length <= MAX_PART && NAME.test(artifact) && !artifact.includes('..')
}

export function isValidVersion(version: string): boolean {
  return version.length <= MAX_PART && VERSION.test(version) && !version.includes('..')
}

export function isValidClassifier(classifier: string): boolean {
  return isValidArtifact(classifier)
}

// 파일 확장자(jar·aar 등)
export function isValidExtension(extension: string): boolean {
  return /^[A-Za-z0-9]{1,16}$/.test(extension)
}
