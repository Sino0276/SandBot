// gradle/libs.versions.toml(Gradle 버전 카탈로그)의 [versions]·[libraries]·[bundles]. 작은 TOML 읽기: 표 머리
// [이름], key = value(점 키 포함), 문자열("…"·'…'·"""…"""·'''…'''), 정수·실수·불리언, 배열(여러 줄), 인라인 표 { … }.
// 다른 표([plugins] 등)도 문법은 맞춰 읽되 쓰지 않는다. 읽지 못한 줄은 problems에 남기고 다음 줄부터 계속한다.

export type TomlValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; text: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'array'; items: TomlValue[] }
  | { kind: 'table'; entries: Map<string, TomlValue> }

export type CatalogVersion = { version: string | null; problem: string | null; line: number }

export type CatalogLibrary = {
  group: string
  artifact: string
  // 직접 쓴 버전(version = "…" 또는 "g:a:v")
  version: string | null
  // version.ref
  versionRef: string | null
  // 읽을 수 없는 항목의 이유(영어)
  problem: string | null
  line: number
}

export type VersionCatalog = {
  // 별칭을 접근자 경로로 바꾼 이름('pedro-core' → 'pedro.core')
  versions: Map<string, CatalogVersion>
  libraries: Map<string, CatalogLibrary>
  bundles: Map<string, { aliases: string[]; line: number }>
  problems: Array<{ line: number; detail: string }>
}

// Gradle은 별칭의 '-'·'_'·'.'를 모두 접근자의 '.'로 바꾼다(libs.pedro.core)
export function catalogAccessor(alias: string): string {
  return alias.replace(/[-_.]/g, '.')
}

class TomlError extends Error {}

const MAX_TOML_NESTING = 16
const MAX_ARRAY_ITEMS = 1000

class TomlReader {
  pos = 0
  line = 1

  constructor(readonly text: string) {
    if (text.charCodeAt(0) === 0xfeff) this.pos = 1
  }

  private peek(offset = 0): string {
    return this.text[this.pos + offset] ?? ''
  }

  private skipSpaces(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++
  }

  private skipComment(): void {
    if (this.peek() === '#')
      while (this.pos < this.text.length && this.peek() !== '\n' && this.peek() !== '\r') this.pos++
  }

  // 공백·주석·줄바꿈을 모두 넘긴다(배열·여러 줄 인라인 표 안)
  private skipBlank(): void {
    for (;;) {
      this.skipSpaces()
      this.skipComment()
      if (!this.newline()) return
    }
  }

  private newline(): boolean {
    if (this.peek() === '\r') {
      this.pos += this.peek(1) === '\n' ? 2 : 1
      this.line++
      return true
    }
    if (this.peek() === '\n') {
      this.pos++
      this.line++
      return true
    }
    return false
  }

  atEnd(): boolean {
    return this.pos >= this.text.length
  }

  // 줄 끝까지 넘긴다(읽지 못한 줄)
  skipLine(): void {
    while (this.pos < this.text.length && !this.newline()) this.pos++
  }

  // 한 줄: 빈 줄 → null, [표] → {table}, key = value → {keys, value}
  statement():
    | null
    | { kind: 'table'; name: string[]; line: number }
    | { kind: 'pair'; keys: string[]; value: TomlValue; line: number } {
    this.skipSpaces()
    this.skipComment()
    if (this.newline() || this.atEnd()) return null
    const line = this.line
    if (this.peek() === '[') {
      const array = this.peek(1) === '['
      this.pos += array ? 2 : 1
      this.skipSpaces()
      const name = this.keys()
      this.skipSpaces()
      if (this.peek() !== ']' || (array && this.peek(1) !== ']'))
        throw new TomlError('bad table header')
      this.pos += array ? 2 : 1
      this.endOfLine()
      return { kind: 'table', name: array ? ['[]', ...name] : name, line }
    }
    const keys = this.keys()
    this.skipSpaces()
    if (this.peek() !== '=') throw new TomlError('expected =')
    this.pos++
    this.skipSpaces()
    const value = this.value(0)
    this.endOfLine()
    return { kind: 'pair', keys, value, line }
  }

  private endOfLine(): void {
    this.skipSpaces()
    this.skipComment()
    if (!this.newline() && !this.atEnd()) throw new TomlError('unexpected text after value')
  }

  private keys(): string[] {
    const keys: string[] = []
    for (;;) {
      this.skipSpaces()
      const ch = this.peek()
      if (ch === '"' || ch === "'") keys.push(this.string())
      else {
        const match = /^[A-Za-z0-9_-]+/.exec(this.text.slice(this.pos, this.pos + 256))
        if (!match) throw new TomlError('bad key')
        keys.push(match[0])
        this.pos += match[0].length
      }
      this.skipSpaces()
      if (this.peek() !== '.') return keys
      this.pos++
    }
  }

  private string(): string {
    const quote = this.peek()
    const triple = this.text.startsWith(quote.repeat(3), this.pos)
    const delimiter = triple ? quote.repeat(3) : quote
    this.pos += delimiter.length
    // 여러 줄 문자열은 여는 따옴표 바로 뒤의 줄바꿈 하나를 버린다
    if (triple) this.newline()
    let out = ''
    for (;;) {
      if (this.atEnd()) throw new TomlError('unterminated string')
      if (this.text.startsWith(delimiter, this.pos)) {
        this.pos += delimiter.length
        return out
      }
      const ch = this.peek()
      if ((ch === '\n' || ch === '\r') && !triple) throw new TomlError('unterminated string')
      if (ch === '\\' && quote === '"') {
        const next = this.peek(1)
        const simple: Record<string, string> = {
          b: '\b',
          t: '\t',
          n: '\n',
          f: '\f',
          r: '\r',
          '"': '"',
          '\\': '\\'
        }
        if (next in simple) {
          out += simple[next]
          this.pos += 2
          continue
        }
        const hex = next === 'u' ? 4 : next === 'U' ? 8 : 0
        const digits = this.text.slice(this.pos + 2, this.pos + 2 + hex)
        if (hex > 0 && new RegExp(`^[0-9a-fA-F]{${hex}}$`).test(digits)) {
          const code = parseInt(digits, 16)
          if (code > 0x10ffff) throw new TomlError('bad escape')
          out += String.fromCodePoint(code)
          this.pos += 2 + hex
          continue
        }
        throw new TomlError('bad escape')
      }
      if (this.newline()) {
        out += '\n'
        continue
      }
      out += ch
      this.pos++
    }
  }

  private value(depth: number): TomlValue {
    if (depth > MAX_TOML_NESTING) throw new TomlError('too deeply nested')
    const ch = this.peek()
    if (ch === '"' || ch === "'") return { kind: 'string', value: this.string() }
    if (ch === '[') {
      this.pos++
      const items: TomlValue[] = []
      for (;;) {
        this.skipBlank()
        if (this.peek() === ']') {
          this.pos++
          return { kind: 'array', items }
        }
        if (items.length >= MAX_ARRAY_ITEMS) throw new TomlError('array too long')
        items.push(this.value(depth + 1))
        this.skipBlank()
        if (this.peek() === ',') {
          this.pos++
          continue
        }
        this.skipBlank()
        if (this.peek() !== ']') throw new TomlError('expected , or ]')
      }
    }
    if (ch === '{') {
      this.pos++
      const entries = new Map<string, TomlValue>()
      for (;;) {
        this.skipBlank()
        if (this.peek() === '}') {
          this.pos++
          return { kind: 'table', entries }
        }
        const keys = this.keys()
        this.skipSpaces()
        if (this.peek() !== '=') throw new TomlError('expected =')
        this.pos++
        this.skipSpaces()
        setDotted(entries, keys, this.value(depth + 1))
        this.skipBlank()
        if (this.peek() === ',') {
          this.pos++
          continue
        }
        this.skipBlank()
        if (this.peek() !== '}') throw new TomlError('expected , or }')
      }
    }
    const match = /^[A-Za-z0-9_+.:-]+/.exec(this.text.slice(this.pos, this.pos + 128))
    if (!match) throw new TomlError('bad value')
    this.pos += match[0].length
    if (match[0] === 'true' || match[0] === 'false')
      return { kind: 'boolean', value: match[0] === 'true' }
    return { kind: 'number', text: match[0] }
  }
}

function setDotted(entries: Map<string, TomlValue>, keys: string[], value: TomlValue): void {
  let table = entries
  for (const key of keys.slice(0, -1)) {
    let next = table.get(key)
    if (!next) {
      next = { kind: 'table', entries: new Map() }
      table.set(key, next)
    }
    if (next.kind !== 'table') throw new TomlError(`'${key}' is not a table`)
    table = next.entries
  }
  table.set(keys[keys.length - 1], value)
}

// version = "…" | { ref | require | strictly | prefer | reject }
function versionOf(
  value: TomlValue | undefined,
  ref: TomlValue | undefined
): { version: string | null; versionRef: string | null; problem: string | null } {
  if (ref !== undefined) {
    if (ref.kind !== 'string')
      return { version: null, versionRef: null, problem: 'version.ref is not a string' }
    return { version: null, versionRef: ref.value, problem: null }
  }
  if (value === undefined) return { version: null, versionRef: null, problem: null }
  if (value.kind === 'string') return { version: value.value, versionRef: null, problem: null }
  if (value.kind === 'table') {
    const inner = value.entries
    if (inner.has('ref')) return versionOf(undefined, inner.get('ref'))
    for (const key of ['strictly', 'prefer', 'reject', 'rejectAll'])
      if (inner.has(key))
        return {
          version: null,
          versionRef: null,
          problem: `rich version '${key}' is not supported`
        }
    const require = inner.get('require')
    if (require?.kind === 'string')
      return { version: require.value, versionRef: null, problem: null }
  }
  return { version: null, versionRef: null, problem: 'unsupported version' }
}

function libraryOf(value: TomlValue, line: number): CatalogLibrary {
  const bad = (problem: string): CatalogLibrary => ({
    group: '',
    artifact: '',
    version: null,
    versionRef: null,
    problem,
    line
  })
  if (value.kind === 'string') {
    const parts = value.value.split(':')
    if (parts.length !== 2 && parts.length !== 3)
      return bad(`'${value.value}' is not group:name[:version]`)
    return {
      group: parts[0],
      artifact: parts[1],
      version: parts.length === 3 ? parts[2] : null,
      versionRef: null,
      problem: null,
      line
    }
  }
  if (value.kind !== 'table') return bad('library is not a string or table')
  const entries = value.entries
  let group: string
  let artifact: string
  const module = entries.get('module')
  if (module !== undefined) {
    if (module.kind !== 'string') return bad('module is not a string')
    const parts = module.value.split(':')
    if (parts.length !== 2) return bad(`module '${module.value}' is not group:name`)
    ;[group, artifact] = parts
  } else {
    const g = entries.get('group')
    const n = entries.get('name')
    if (g?.kind !== 'string' || n?.kind !== 'string')
      return bad('library needs module or group and name')
    group = g.value
    artifact = n.value
  }
  const versionValue = entries.get('version')
  const ref =
    versionValue?.kind === 'table' && versionValue.entries.has('ref')
      ? versionValue.entries.get('ref')
      : undefined
  const version = versionOf(ref === undefined ? versionValue : undefined, ref)
  return { group, artifact, ...version, line }
}

export function parseVersionCatalog(text: string): VersionCatalog {
  const catalog: VersionCatalog = {
    versions: new Map(),
    libraries: new Map(),
    bundles: new Map(),
    problems: []
  }
  const reader = new TomlReader(text)
  let table = ''
  while (!reader.atEnd()) {
    const line = reader.line
    let statement: ReturnType<TomlReader['statement']>
    try {
      statement = reader.statement()
    } catch (error) {
      if (!(error instanceof TomlError)) throw error
      catalog.problems.push({ line, detail: error.message })
      reader.skipLine()
      continue
    }
    if (statement === null) continue
    if (statement.kind === 'table') {
      table = statement.name.join('.')
      continue
    }
    // 점 키는 그 표 안의 표다(versions의 pedro.core = "…"는 별칭 'pedro.core')
    const alias = statement.keys.join('.')
    const accessor = catalogAccessor(alias)
    if (table === 'versions') {
      const version = versionOf(statement.value, undefined)
      catalog.versions.set(accessor, {
        version: version.version,
        problem: version.problem,
        line: statement.line
      })
    } else if (table === 'libraries') {
      catalog.libraries.set(accessor, libraryOf(statement.value, statement.line))
    } else if (table === 'bundles') {
      const value = statement.value
      if (value.kind !== 'array' || !value.items.every((item) => item.kind === 'string')) {
        catalog.problems.push({
          line: statement.line,
          detail: `bundle '${alias}' is not a list of aliases`
        })
        continue
      }
      catalog.bundles.set(accessor, {
        aliases: value.items.map((item) => catalogAccessor((item as { value: string }).value)),
        line: statement.line
      })
    }
  }
  return catalog
}
