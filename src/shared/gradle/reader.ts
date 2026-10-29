// 팀 Gradle 파일 읽기(GradleProject 만들기). Gradle이 TeamCode 모듈을 구성하는 순서를 글자로만 따라간다:
// gradle.properties(루트·TeamCode) → settings.gradle(.kts) → gradle/libs.versions.toml → 루트 build.gradle(.kts)
// (allprojects·subprojects·project(':TeamCode') 블록은 TeamCode에 적용) → TeamCode/build.gradle(.kts). 각 파일의
// apply from: '…'은 그 자리에서 따라간다(프로젝트 안만, 깊이 한도). 상대 경로는 Gradle처럼 그 스크립트가 구성하는
// 프로젝트의 폴더 기준이다(ProjectScript.apply가 Project.apply로 넘긴다: TeamCode에 적용한 build.common.gradle 안의
// 'x.gradle'은 TeamCode/x.gradle, allprojects { } 안도 TeamCode 기준). file('…')도 같다.
//
// 값은 리터럴로 풀 수 있는 것만 쓴다: 문자열·숫자·불리언, 문자열 보간과 +, def·val 지역 변수(같은 파일, 블록 범위),
// ext·extra 속성(그 프로젝트, TeamCode에서는 루트 것도 물려받음), gradle.properties, findProperty·property,
// providers.gradleProperty(…).get(), 버전 카탈로그 libs.x.y·libs.versions.x.get()·libs.bundles.x. 그 밖(메서드 호출,
// 조건문 안의 선언, 환경 변수 등)은 추측하지 않고 쓰는 자리에서 진단으로 남긴다. 쓰지 않는 블록(signingConfigs 등)
// 안의 식은 보지 않는다.
//
// gradle.properties는 Gradle처럼 프로젝트마다 ext 속성으로도 본다(ProjectPropertySettingBuildLoader가 루트의 것,
// 그다음 그 프로젝트 폴더의 것을 프로젝트 ext에 넣어 둔다). 그래서 TeamCode의 이름 찾기는 TeamCode의 ext →
// gradle.properties(TeamCode, 루트) → 물려받는 루트 ext 순서이고, ext.x·ext.get·by extra도 gradle.properties를 본다.
//
// 읽기는 메인 프로세스에서 하므로 일의 양에 한도가 있다: apply from 실행 횟수(같은 파일을 되풀이해도 센다), 한 문장에서
// 펼치는 의존성·include 목록 항목 수(tooMany), 한 번 읽기 전체의 일(글자·구문 나누기, 실행한 스크립트 글자 수, 값 계산
// 단계, 읽지 못한 것 버리기와 진단, tooMuchWork). 넘으면 진단을 남긴다.
import { type GradleDialect } from './lexer'
import { parseNotation, isNotationName, isNotationVersion, type Notation } from './notation'
import {
  parseGradleScript,
  type Arg,
  type ClosureExpr,
  type Expr,
  type ParsedScript,
  type Stmt
} from './parser'
import { MAX_GRADLE_FILE_BYTES, resolveProjectPath } from './paths'
import { parseGradleProperties } from './properties'
import { parseVersionCatalog, type VersionCatalog } from './toml'
import type {
  GradleConfiguration,
  GradleDependency,
  GradleDiagnostic,
  GradleDiagnosticCode,
  GradleExclude,
  GradleFileSource,
  GradleLocation,
  GradleProject,
  GradleRepository,
  GradleRepositoryKind
} from './types'

// apply from 사슬 깊이(처음 파일 포함)
export const MAX_APPLY_DEPTH = 8
// 한 번 읽기에서 읽는 파일 수
export const MAX_GRADLE_FILES = 32
// 한 번 읽기에서 apply from으로 스크립트를 실행하는 횟수(같은 파일을 여러 번 적용해도 실행마다 센다. 파일 수 한도는
// 처음 읽을 때만 세므로, 작은 파일 몇 개를 겹겹이 되풀이해 적용하면 실행이 지수로 늘어난다)
export const MAX_APPLIED_SCRIPTS = 64
// 한 번 읽기 전체의 일 한도(단위: 나눈 글자·토큰 하나, 실행한 스크립트 글자 하나, 값 계산 한 단계 — 식 하나, 이은 글자
// 하나, 펼친 목록 항목 하나, 복사한 맵 항목 하나, 카탈로그에서 찾은 이름 글자 하나, 의존성에 붙인 exclude 글자 하나 등.
// 이름 하나로 쓰는 변수·별칭도 그 값을 훑는 만큼 센다. 단위 하나에 드는 시간이 비슷하도록, 그보다 무거운 것은
// 여러 단위로 센다: 읽지 못한 문장·보간 하나는 RECOVERY_STEPS(parser.ts), 카탈로그 줄 하나는 CATALOG_RECOVERY_WORK
// (toml.ts), 진단 하나는 DIAGNOSTIC_WORK). 넘으면 tooMuchWork 진단 하나를 남기고 거기까지 읽은 것만 돌려준다. 시간이
// 아니라 단위로 세므로 같은 입력이면 늘 같은 자리에서 멈춘다. 실제 FTC 프로젝트는 이 한도의 2% 안을 쓰고, 256 KB짜리
// 보통 의존성 파일 하나는 80%쯤이다.
export const MAX_GRADLE_WORK = 1_000_000
// 진단 하나를 만들거나 같은 진단을 다시 거르는 일(글자 조각·키 만들기)
const DIAGNOSTIC_WORK = 16
const MAX_DIAGNOSTICS = 200
const MAX_DEPENDENCIES = 1000
const MAX_REPOSITORIES = 200
// 이어 붙여 만든 문자열·목록 길이 한도
const MAX_VALUE_LENGTH = 4096
// 목록·맵 항목 수. 의존성 선언 한 문장에서 펼치는 항목 수도(목록 안의 목록, 같은 목록을 여러 번 넣은 [l, l]은 펼친 만큼)
const MAX_COLLECTION = 1000
const MAX_DETAIL = 160
// 진단에 넣는 글자 조각은 식의 앞부분만 본다(긴 식에 진단이 여러 개 붙어도 식 전체를 매번 훑지 않는다)
const MAX_SNIPPET_SCAN = 1024

export const TEAMCODE_MODULE_DIR = 'TeamCode'
export const VERSION_CATALOG_PATH = 'gradle/libs.versions.toml'

type ProjectId = 'settings' | 'root' | 'module'

type Value =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'map'; entries: Map<string, Value> }
  | { kind: 'list'; items: Value[] }
  | { kind: 'project'; project: ProjectId }
  | { kind: 'ext'; project: ProjectId }
  | { kind: 'catalog'; path: string[] }
  | { kind: 'providers' }
  | { kind: 'provider'; value: Value }
  // 프로젝트 기준 폴더 base 아래의 rest(rootDir·projectDir·file(…)로 만든 경로)
  | { kind: 'path'; base: string; rest: string }
  // missing: 정의되지 않은 이름·속성(?:가 오른쪽을 쓴다). catalog: 버전 카탈로그에서 찾지 못함.
  | { kind: 'unresolved'; reason: string; missing?: boolean; catalog?: boolean }

type Unresolved = Extract<Value, { kind: 'unresolved' }>

// 의존성 선언 한 문장에서 펼친 목록 항목 수
type Flat = { items: number }

// props: 그 프로젝트가 보는 gradle.properties(루트의 것에 그 프로젝트 폴더의 것을 덮은 것, settings는 루트의 것).
// Gradle은 이것을 ext에 넣어 두고 스크립트의 ext 쓰기가 덮으므로, ext에 없으면 props를 보는 것과 같다.
type ProjectState = { ext: Map<string, Value>; props: Map<string, Value> }

type Ctx = {
  file: string
  text: string
  dialect: GradleDialect
  // 이 스크립트가 구성하는 프로젝트
  target: ProjectId
  // allprojects { }: ext 쓰기를 루트에도
  alsoRoot: boolean
  // [파일 범위, …블록 범위]
  scopes: Array<Map<string, Value>>
  // apply from 사슬(순환·깊이)
  chain: string[]
  // ext { } 안: 이름 대입이 ext 속성이다
  extBlock: boolean
}

// 읽은 파일 하나(소스가 준 결과)
type FileRead =
  | { kind: 'text'; text: string }
  | { kind: 'missing' }
  | { kind: 'problem'; code: GradleDiagnosticCode; detail: string }

const SUPPORTED_CONFIGURATIONS: ReadonlySet<string> = new Set<GradleConfiguration>([
  'implementation',
  'api',
  'compileOnly',
  'runtimeOnly'
])
// 실행하지 않는 주석 처리기(진단으로 알린다)
const PROCESSOR_CONFIGURATIONS = new Set(['annotationProcessor', 'kapt', 'ksp'])
// 조용히 넘기는 구성(시험·린트·desugaring)
const SILENT_CONFIGURATIONS = new Set([
  'coreLibraryDesugaring',
  'lintChecks',
  'lintPublish',
  'detektPlugins',
  'classpath'
])
// 빌드 종류·제품 변형별 구성(debugImplementation 등)
const VARIANT_CONFIGURATION = /^[a-z][A-Za-z0-9]*(?:Implementation|Api|CompileOnly|RuntimeOnly)$/
const REPOSITORY_KINDS: ReadonlySet<string> = new Set<GradleRepositoryKind>([
  'mavenCentral',
  'google',
  'mavenLocal',
  'jcenter',
  'gradlePluginPortal'
])
// 모르는 블록 안에 이 이름의 호출이 있으면 의존성 선언이다(진단)
const DECLARATION_NAMES: ReadonlySet<string> = new Set([
  'implementation',
  'api',
  'compileOnly',
  'runtimeOnly'
])
// 조건문·읽지 못한 문장 안에 이 이름이 있으면 선언이 숨어 있을 수 있다(진단)
const RELEVANT_NAMES = new Set([
  'dependencies',
  'repositories',
  'implementation',
  'api',
  'compileOnly',
  'runtimeOnly',
  'apply',
  'compileSdk',
  'compileSdkVersion',
  'ext',
  'extra',
  'allprojects',
  'subprojects',
  'include',
  'maven',
  'mavenCentral',
  'google',
  'dependencyResolutionManagement'
])

function newProject(): ProjectState {
  return { ext: new Map(), props: new Map() }
}

// 한 번 읽기의 일 한도를 넘었다(run이 받아 거기까지 읽은 것을 돌려준다)
class OverBudget extends Error {}

function unresolved(
  reason: string,
  flags: { missing?: boolean; catalog?: boolean } = {}
): Unresolved {
  // 이유는 진단에 붙는다. 긴 이름을 담아도 값마다 한 번만 자른다(진단마다 긴 글자를 다시 훑지 않게).
  return { kind: 'unresolved', reason: clip(reason), ...flags }
}

// 진단에 넣을 글자(팀 파일에서 온 긴 글자는 앞부분만)
function clip(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 3)}...` : text
}

function isScalar(
  value: Value
): value is Extract<Value, { kind: 'string' | 'number' | 'boolean' }> {
  return value.kind === 'string' || value.kind === 'number' || value.kind === 'boolean'
}

function scalarText(value: Extract<Value, { kind: 'string' | 'number' | 'boolean' }>): string {
  return String(value.value)
}

// name·member·index(글자 키) 사슬의 이름들. 그 밖이면 null.
function pathOf(expr: Expr): string[] | null {
  if (expr.kind === 'name') return [expr.name]
  if (expr.kind === 'member') {
    const base = pathOf(expr.target)
    return base ? [...base, expr.name] : null
  }
  if (expr.kind === 'index') {
    const base = pathOf(expr.target)
    const key = literalString(expr.index)
    return base && key !== null ? [...base, key] : null
  }
  return null
}

function literalString(expr: Expr): string | null {
  if (expr.kind !== 'string') return null
  let text = ''
  for (const part of expr.parts) {
    if (typeof part !== 'string') return null
    text += part
  }
  return text
}

function samePath(path: string[] | null, ...expected: string[]): boolean {
  return path !== null && path.length === expected.length && path.every((p, i) => p === expected[i])
}

type CallStmt = { path: string[] | null; call: Extract<Expr, { kind: 'call' }> }

function callOf(stmt: Stmt): CallStmt | null {
  if (stmt.kind !== 'expr' || stmt.expr.kind !== 'call') return null
  return { path: pathOf(stmt.expr.callee), call: stmt.expr }
}

function namedArg(args: Arg[], name: string): Arg | undefined {
  return args.find((arg) => arg.name === name)
}

function positional(args: Arg[]): Expr[] {
  return args.filter((arg) => arg.name === null).map((arg) => arg.value)
}

// 이 식 안에 나오는 이름들(조건문처럼 건너뛴 곳에 선언이 숨어 있는지)
function mentions(expr: Expr | ClosureExpr | null, names: ReadonlySet<string>): boolean {
  if (!expr) return false
  switch (expr.kind) {
    case 'name':
      return names.has(expr.name)
    case 'member':
      return names.has(expr.name) || mentions(expr.target, names)
    case 'index':
      return mentions(expr.target, names) || mentions(expr.index, names)
    case 'call':
      return (
        mentions(expr.callee, names) ||
        expr.args.some(
          (arg) => (arg.name !== null && names.has(arg.name)) || mentions(arg.value, names)
        ) ||
        mentions(expr.closure, names)
      )
    case 'closure':
      return expr.body.some((stmt) => stmtMentions(stmt, names))
    case 'list':
      return expr.items.some((item) => mentions(item, names))
    case 'map':
      return expr.entries.some((entry) => mentions(entry.value, names))
    case 'binary':
      return mentions(expr.left, names) || mentions(expr.right, names)
    case 'unary':
      return mentions(expr.operand, names)
    case 'cast':
      return mentions(expr.expr, names)
    case 'string':
      return expr.parts.some((part) => typeof part !== 'string' && mentions(part, names))
    default:
      return false
  }
}

function stmtMentions(stmt: Stmt, names: ReadonlySet<string>): boolean {
  switch (stmt.kind) {
    case 'expr':
      return mentions(stmt.expr, names)
    case 'assign':
      return mentions(stmt.target, names) || mentions(stmt.value, names)
    case 'decl':
      return mentions(stmt.value, names) || mentions(stmt.by, names)
    case 'control':
    case 'unknown':
      return stmt.idents.some((name) => names.has(name))
    default:
      return false
  }
}

class GradleReader {
  private readonly dependencies: GradleDependency[] = []
  private readonly dependencyKeys = new Set<string>()
  private readonly repositories: GradleRepository[] = []
  private readonly repositoryKeys = new Set<string>()
  private readonly diagnostics: GradleDiagnostic[] = []
  private readonly diagnosticKeys = new Set<string>()
  private readonly limits = new Set<string>()
  private readonly files: string[] = []
  private compileSdk: number | null = null
  private catalog: VersionCatalog | null = null
  private reads = 0
  private applied = 0
  private work = 0
  private readonly cache = new Map<string, FileRead>()
  // 읽은 스크립트의 구문 트리(같은 파일을 다시 적용하면 다시 나누지 않는다. 트리는 읽기만 한다)
  private readonly scripts = new Map<string, ParsedScript>()
  private readonly projects: Record<ProjectId, ProjectState> = {
    settings: newProject(),
    root: newProject(),
    module: newProject()
  }
  // settings의 include: 이름 수와 TeamCode가 있는지(풀지 못한 인자가 있거나 한도를 넘은 문장이 있으면 complete false)
  private includes: { count: number; teamCode: boolean; complete: boolean; file: string } | null =
    null

  constructor(private readonly source: GradleFileSource) {}

  async run(): Promise<GradleProject> {
    try {
      await this.runAll()
    } catch (error) {
      if (!(error instanceof OverBudget)) throw error
    }
    return {
      dependencies: this.dependencies,
      repositories: this.repositories,
      compileSdk: this.compileSdk,
      diagnostics: this.diagnostics,
      files: this.files
    }
  }

  private async runAll(): Promise<void> {
    // gradle.properties: 루트의 것은 settings·루트·TeamCode 모두, TeamCode 폴더의 것은 TeamCode만 본다(앞의 것을 덮는다)
    const rootProps = await this.loadProperties('gradle.properties')
    const moduleProps = await this.loadProperties(`${TEAMCODE_MODULE_DIR}/gradle.properties`)
    for (const project of [this.projects.settings, this.projects.root, this.projects.module])
      for (const [key, value] of rootProps) project.props.set(key, value)
    for (const [key, value] of moduleProps) this.projects.module.props.set(key, value)
    await this.runFirst(['settings.gradle', 'settings.gradle.kts'], 'settings')
    await this.loadCatalog()
    await this.runFirst(['build.gradle', 'build.gradle.kts'], 'root')
    await this.runFirst(
      [`${TEAMCODE_MODULE_DIR}/build.gradle`, `${TEAMCODE_MODULE_DIR}/build.gradle.kts`],
      'module'
    )
    // 다 읽었을 때만 본다(멈춘 읽기는 settings의 include를 다 보았는지 모른다). 이 진단도 일로 세므로 여기(run의 try 안)다.
    const includes = this.includes
    if (includes && includes.complete && includes.count > 0 && !includes.teamCode)
      this.diag(
        'unsupportedSyntax',
        { file: includes.file, line: 1 },
        `settings does not include ':TeamCode'`
      )
  }

  // 일을 센다. 한 번 읽기 전체가 한도를 넘으면 그 자리에 진단을 남기고 읽기를 멈춘다. 읽다 멈춘 까닭은 진단이 한도까지
  // 찼어도 보이도록 마지막 진단 자리에 둔다.
  private spend(units: number, file: string, line: number): void {
    this.work += units
    if (this.work <= MAX_GRADLE_WORK) return
    const stopped: GradleDiagnostic = {
      code: 'tooMuchWork',
      at: { file, line },
      detail: `reading the Gradle files takes more than ${MAX_GRADLE_WORK} steps`
    }
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) this.diagnostics[MAX_DIAGNOSTICS - 1] = stopped
    else this.diagnostics.push(stopped)
    throw new OverBudget()
  }

  // ---- 파일 ----

  private async read(path: string): Promise<FileRead> {
    const cached = this.cache.get(path)
    if (cached) return cached
    let result: FileRead
    if (this.reads >= MAX_GRADLE_FILES) {
      result = {
        kind: 'problem',
        code: 'tooMany',
        detail: `more than ${MAX_GRADLE_FILES} Gradle files`
      }
    } else {
      this.reads++
      let raw: Awaited<ReturnType<GradleFileSource['read']>>
      try {
        raw = await this.source.read(path)
      } catch (error) {
        raw = {
          problem: 'unreadable',
          detail: error instanceof Error ? error.message : String(error)
        }
      }
      if (raw === null) result = { kind: 'missing' }
      else if (typeof raw === 'string')
        result =
          raw.length > MAX_GRADLE_FILE_BYTES
            ? { kind: 'problem', code: 'tooLarge', detail: `${path} is larger than 256 KB` }
            : { kind: 'text', text: raw }
      else if (raw.problem === 'tooLarge')
        result = { kind: 'problem', code: 'tooLarge', detail: `${path} is larger than 256 KB` }
      else if (raw.problem === 'outsideProject')
        result = {
          kind: 'problem',
          code: 'outsideProject',
          detail: `${path} links outside the project`
        }
      else
        result = {
          kind: 'problem',
          code: 'missingFile',
          detail: `cannot read ${path}${raw.detail ? `: ${raw.detail}` : ''}`
        }
    }
    if (result.kind === 'text' && !this.files.includes(path)) this.files.push(path)
    this.cache.set(path, result)
    return result
  }

  private async loadProperties(path: string): Promise<Map<string, Value>> {
    const props = new Map<string, Value>()
    const read = await this.read(path)
    if (read.kind === 'problem') this.diag(read.code, { file: path, line: 1 }, read.detail)
    if (read.kind !== 'text') return props
    const entries = parseGradleProperties(read.text)
    this.spend(read.text.length, path, 1)
    for (const [key, entry] of entries)
      props.set(
        key,
        entry.value.length > MAX_VALUE_LENGTH
          ? unresolved(`gradle property '${key}' is too long`)
          : { kind: 'string', value: entry.value }
      )
    return props
  }

  private async loadCatalog(): Promise<void> {
    const read = await this.read(VERSION_CATALOG_PATH)
    if (read.kind === 'problem')
      this.diag(read.code, { file: VERSION_CATALOG_PATH, line: 1 }, read.detail)
    if (read.kind !== 'text') return
    // 카탈로그 읽기도 한 번 읽기의 일에 센다(남은 일보다 많이 돌면 거기서 멈추고, 읽은 줄의 진단을 남긴 뒤 spend가 읽기를
    // 끝낸다)
    const catalog = parseVersionCatalog(read.text, MAX_GRADLE_WORK - this.work)
    this.catalog = catalog
    for (const problem of catalog.problems)
      this.diag(
        'unsupportedSyntax',
        { file: VERSION_CATALOG_PATH, line: problem.line },
        problem.detail
      )
    this.spend(catalog.work, VERSION_CATALOG_PATH, catalog.line)
  }

  // 같은 스크립트의 Groovy·Kotlin 이름 중 먼저 있는 것을 읽는다(Gradle도 .gradle을 먼저 찾는다)
  private async runFirst(paths: string[], target: ProjectId): Promise<void> {
    for (const path of paths) {
      const read = await this.read(path)
      if (read.kind === 'missing') continue
      if (read.kind === 'problem') {
        this.diag(read.code, { file: path, line: 1 }, read.detail)
        return
      }
      await this.runScript(path, read.text, target, false, [])
      return
    }
  }

  private async runScript(
    path: string,
    text: string,
    target: ProjectId,
    alsoRoot: boolean,
    chain: string[]
  ): Promise<void> {
    const dialect: GradleDialect = path.endsWith('.kts') ? 'kotlin' : 'groovy'
    let parsed = this.scripts.get(path)
    if (!parsed) {
      // 글자 나누기도 한 번 읽기의 일에 센다(남은 일보다 많이 돌면 거기서 멈추고 spend가 읽기를 끝낸다)
      parsed = parseGradleScript(text, dialect, MAX_GRADLE_WORK - this.work)
      this.scripts.set(path, parsed)
      this.spend(parsed.steps, path, 1)
      // 구문 문제는 처음 나눌 때 한 번만 알린다
      if (parsed.tooDeep)
        this.diag('tooDeep', { file: path, line: 1 }, `${path} is nested too deeply or too complex`)
      else
        for (const problem of parsed.problems)
          this.diag('unsupportedSyntax', { file: path, line: problem.line }, problem.detail)
    }
    if (parsed.tooDeep) return
    // 실행 한 번의 일은 스크립트 글자 수에 비례한다(문장·블록을 한 번씩 본다)
    this.spend(text.length, path, 1)
    const ctx: Ctx = {
      file: path,
      text,
      dialect,
      target,
      alsoRoot,
      scopes: [new Map()],
      chain: [...chain, path],
      extBlock: false
    }
    if (target === 'settings') await this.settingsBlock(parsed.statements, ctx)
    else if (target === 'root') await this.rootBlock(parsed.statements, ctx)
    else await this.moduleBlock(parsed.statements, ctx)
  }

  // ---- 진단 ----

  private snippet(ctx: Ctx, node: { start: number; end: number }): string {
    // 진단이 한도까지 찼으면 조각은 어디에도 보이지 않는다(진단과 풀지 못한 값의 이유에만 쓴다)
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) return ''
    const end = Math.min(node.end, node.start + MAX_SNIPPET_SCAN)
    const text = ctx.text.slice(node.start, end).replace(/\s+/g, ' ').trim()
    return text.length > 80 || end < node.end ? `${text.slice(0, 77)}...` : text
  }

  private diag(code: GradleDiagnosticCode, at: GradleLocation, detail: string): void {
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) return
    this.spend(DIAGNOSTIC_WORK, at.file, at.line)
    const clipped = clip(detail)
    const key = `${code}\u0000${at.file}\u0000${at.line}\u0000${clipped}`
    if (this.diagnosticKeys.has(key)) return
    this.diagnosticKeys.add(key)
    this.diagnostics.push({ code, at, detail: clipped })
  }

  // 개수 한도는 처음 넘은 자리에서 한 번만 알린다
  private limitOnce(what: string, at: GradleLocation, detail: string): void {
    if (this.limits.has(what)) return
    this.limits.add(what)
    this.diag('tooMany', at, detail)
  }

  private at(ctx: Ctx, node: { line: number }): GradleLocation {
    return { file: ctx.file, line: node.line }
  }

  private unresolvedDiag(
    ctx: Ctx,
    node: Expr | { start: number; end: number; line: number },
    value: Unresolved
  ): void {
    this.diag(
      value.catalog ? 'versionCatalogEntry' : 'unresolvedValue',
      this.at(ctx, node),
      `${this.snippet(ctx, node)}: ${value.reason}`
    )
  }

  // 조건문·읽지 못한 문장 안에 선언이 숨어 있으면 알린다(names가 null이면 늘: dependencies·repositories 블록 안)
  private hidden(
    ctx: Ctx,
    stmt: Extract<Stmt, { kind: 'control' | 'unknown' }>,
    names: ReadonlySet<string> | null = RELEVANT_NAMES
  ): void {
    if (names && !stmt.idents.some((name) => names.has(name))) return
    const what =
      stmt.kind === 'control'
        ? `declarations inside '${stmt.keyword}' are not read`
        : 'statement could not be read'
    this.diag('unsupportedSyntax', this.at(ctx, stmt), `${what}: ${this.snippet(ctx, stmt)}`)
  }

  // ---- 블록 ----

  private child(ctx: Ctx, extra: Partial<Ctx> = {}): Ctx {
    return { ...ctx, scopes: [...ctx.scopes, new Map()], extBlock: false, ...extra }
  }

  // decl·대입·ext.set 등 어느 블록에서나 같은 문장. 처리했으면 true.
  private common(stmt: Stmt, ctx: Ctx): boolean {
    this.spend(1, ctx.file, stmt.line)
    if (stmt.kind === 'skip') return true
    if (stmt.kind === 'decl') {
      this.declare(stmt, ctx)
      return true
    }
    if (stmt.kind === 'assign') {
      this.assign(stmt, ctx)
      return true
    }
    const call = callOf(stmt)
    if (!call) return false
    const { path } = call
    if (path && path[path.length - 1] === 'set' && call.call.args.length === 2) {
      const owner = this.evaluate(
        call.call.callee.kind === 'member' ? call.call.callee.target : call.call.callee,
        ctx
      )
      if (owner.kind === 'ext') {
        const key = this.evaluate(call.call.args[0].value, ctx)
        if (key.kind === 'string')
          this.setExt(ctx, owner.project, key.value, this.evaluate(call.call.args[1].value, ctx))
        return true
      }
    }
    if ((samePath(path, 'ext') || samePath(path, 'project', 'ext')) && call.call.closure) {
      this.extBlock(call.call.closure, ctx, this.projectOf(ctx))
      return true
    }
    if (samePath(path, 'rootProject', 'ext') && call.call.closure) {
      this.extBlock(call.call.closure, ctx, 'root')
      return true
    }
    return false
  }

  private extBlock(closure: ClosureExpr, ctx: Ctx, project: ProjectId): void {
    const inner = this.child(ctx, { extBlock: true })
    for (const stmt of closure.body) {
      if (stmt.kind === 'assign' && stmt.op === '=') {
        const path = pathOf(stmt.target)
        if (path && path.length === 1) {
          this.setExt(inner, project, path[0], this.evaluate(stmt.value, inner))
          continue
        }
      }
      const call = callOf(stmt)
      if (call && samePath(call.path, 'set') && call.call.args.length === 2) {
        const key = this.evaluate(call.call.args[0].value, inner)
        if (key.kind === 'string')
          this.setExt(inner, project, key.value, this.evaluate(call.call.args[1].value, inner))
        continue
      }
      this.common(stmt, inner)
    }
  }

  private projectOf(ctx: Ctx): ProjectId {
    return ctx.target
  }

  private setExt(ctx: Ctx, project: ProjectId, name: string, value: Value): void {
    this.projects[project].ext.set(name, value)
    if (project === 'module' && ctx.alsoRoot) this.projects.root.ext.set(name, value)
  }

  private declare(stmt: Extract<Stmt, { kind: 'decl' }>, ctx: Ctx): void {
    const scope = ctx.scopes[ctx.scopes.length - 1]
    if (stmt.by) {
      // Kotlin 위임: val x by extra("v") / val x: String by extra / val x: String by project
      const by = stmt.by
      if (by.kind === 'call' && samePath(pathOf(by.callee), 'extra') && by.args.length === 1) {
        const value = this.evaluate(by.args[0].value, ctx)
        this.setExt(ctx, this.projectOf(ctx), stmt.name, value)
        scope.set(stmt.name, value)
        return
      }
      const owner = pathOf(by)
      if (
        samePath(owner, 'extra') ||
        samePath(owner, 'project', 'extra') ||
        samePath(owner, 'rootProject', 'extra')
      ) {
        const project = owner?.[0] === 'rootProject' ? 'root' : this.projectOf(ctx)
        scope.set(
          stmt.name,
          this.extValue(project, stmt.name) ??
            unresolved(`extra property '${stmt.name}' is not set`, { missing: true })
        )
        return
      }
      if (samePath(owner, 'project') || samePath(owner, 'rootProject')) {
        const project = owner?.[0] === 'rootProject' ? 'root' : this.projectOf(ctx)
        scope.set(
          stmt.name,
          this.property(project, stmt.name) ??
            unresolved(`project property '${stmt.name}' is not set`, { missing: true })
        )
        return
      }
      scope.set(stmt.name, unresolved(`cannot evaluate delegate '${this.snippet(ctx, by)}'`))
      return
    }
    scope.set(stmt.name, stmt.value ? this.evaluate(stmt.value, ctx) : { kind: 'null' })
  }

  private assign(stmt: Extract<Stmt, { kind: 'assign' }>, ctx: Ctx): void {
    if (stmt.op !== '=') return
    const target = stmt.target
    if (target.kind === 'name') {
      const value = this.evaluate(stmt.value, ctx)
      if (ctx.extBlock) {
        this.setExt(ctx, this.projectOf(ctx), target.name, value)
        return
      }
      for (let i = ctx.scopes.length - 1; i >= 0; i--) {
        if (ctx.scopes[i].has(target.name)) {
          ctx.scopes[i].set(target.name, value)
          return
        }
      }
      // 선언 없는 대입: 그 스크립트의 변수
      ctx.scopes[0].set(target.name, value)
      return
    }
    // a.b = v / a['b'] = v
    if (target.kind !== 'member' && target.kind !== 'index') return
    const key = target.kind === 'member' ? target.name : this.evaluate(target.index, ctx)
    const keyText = typeof key === 'string' ? key : key.kind === 'string' ? key.value : null
    if (keyText === null) return
    const owner = this.evaluate(target.target, ctx)
    if (owner.kind === 'ext')
      this.setExt(ctx, owner.project, keyText, this.evaluate(stmt.value, ctx))
    else if (owner.kind === 'map' && owner.entries.size < MAX_COLLECTION)
      owner.entries.set(keyText, this.evaluate(stmt.value, ctx))
  }

  // ---- settings.gradle ----

  private async settingsBlock(statements: Stmt[], ctx: Ctx): Promise<void> {
    for (const stmt of statements) {
      if (stmt.kind === 'control' || stmt.kind === 'unknown') {
        this.hidden(ctx, stmt)
        continue
      }
      if (stmt.kind === 'assign' && this.relocatesTeamCode(stmt)) {
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `TeamCode project directory is changed: ${this.snippet(ctx, stmt)}`
        )
        continue
      }
      if (this.common(stmt, ctx)) continue
      const call = callOf(stmt)
      if (!call || !call.path) continue
      const name = call.path.join('.')
      if (name === 'include') this.include(call.call, ctx)
      else if (name === 'dependencyResolutionManagement' && call.call.closure) {
        const inner = this.child(ctx)
        for (const child of call.call.closure.body) {
          if (child.kind === 'control' || child.kind === 'unknown') {
            this.hidden(ctx, child)
            continue
          }
          if (this.common(child, inner)) continue
          const nested = callOf(child)
          if (!nested) continue
          if (samePath(nested.path, 'repositories') && nested.call.closure)
            this.repositoryBlock(nested.call.closure, inner)
          else if (samePath(nested.path, 'versionCatalogs') && nested.call.closure?.body.length)
            this.diag(
              'unsupportedSyntax',
              this.at(ctx, child),
              'versionCatalogs { } is not read (only gradle/libs.versions.toml)'
            )
        }
      } else if (name === 'apply') await this.applyFrom(call.call, ctx)
    }
  }

  // project(':TeamCode').projectDir = …
  private relocatesTeamCode(stmt: Extract<Stmt, { kind: 'assign' }>): boolean {
    const target = stmt.target
    if (target.kind !== 'member' || target.name !== 'projectDir' || target.target.kind !== 'call')
      return false
    const call = target.target
    const arg = positional(call.args)[0]
    return (
      samePath(pathOf(call.callee), 'project') &&
      arg !== undefined &&
      literalString(arg)?.replace(/^:/, '') === TEAMCODE_MODULE_DIR
    )
  }

  // include ':a', ':b' / include([…]). 한 문장에서 펼치는 이름 수에 의존성 목록과 같은 한도가 있다(같은 목록을 여러 번
  // 넣은 include l, l, …는 값으로는 작아도 펼친 만큼). 넘으면 그 문장의 나머지를 버리고 TeamCode가 없다고 알리지 않는다.
  private include(call: Extract<Expr, { kind: 'call' }>, ctx: Ctx): void {
    const includes = this.includes ?? { count: 0, teamCode: false, complete: true, file: ctx.file }
    this.includes = includes
    let items = 0
    const add = (value: Value): void => {
      if (value.kind !== 'string') {
        includes.complete = false
        return
      }
      includes.count++
      if (value.value.replace(/^:/, '') === TEAMCODE_MODULE_DIR) includes.teamCode = true
    }
    for (const arg of call.args) {
      const value = this.evaluate(arg.value, ctx)
      const values = value.kind === 'list' ? value.items : [value]
      items += values.length
      if (items > MAX_COLLECTION) {
        this.diag(
          'tooMany',
          this.at(ctx, call),
          `include lists more than ${MAX_COLLECTION} projects: ${this.snippet(ctx, call)}`
        )
        includes.complete = false
        return
      }
      this.spend(values.length, ctx.file, call.line)
      for (const item of values) add(item)
    }
  }

  // ---- 루트 build.gradle ----

  private async rootBlock(statements: Stmt[], ctx: Ctx): Promise<void> {
    for (const stmt of statements) {
      if (stmt.kind === 'control' || stmt.kind === 'unknown') {
        this.hidden(ctx, stmt)
        continue
      }
      if (this.common(stmt, ctx)) continue
      const call = callOf(stmt)
      if (!call || !call.path) continue
      const closure = call.call.closure
      const name = call.path.join('.')
      if (name === 'buildscript' && closure) this.buildscriptBlock(closure, ctx)
      else if (name === 'allprojects' && closure)
        await this.moduleBlock(closure.body, this.child(ctx, { target: 'module', alsoRoot: true }))
      else if (name === 'subprojects' && closure)
        await this.moduleBlock(closure.body, this.child(ctx, { target: 'module', alsoRoot: false }))
      else if (name === 'project' && closure && this.isTeamCodeProject(call.call, ctx))
        await this.moduleBlock(closure.body, this.child(ctx, { target: 'module', alsoRoot: false }))
      else if (name === 'apply') await this.applyFrom(call.call, ctx)
    }
  }

  private isTeamCodeProject(call: Extract<Expr, { kind: 'call' }>, ctx: Ctx): boolean {
    const arg = positional(call.args)[0]
    if (!arg) return false
    const value = this.evaluate(arg, ctx)
    return value.kind === 'string' && value.value.replace(/^:/, '') === TEAMCODE_MODULE_DIR
  }

  // buildscript { ext.x = … }: buildscript의 저장소·classpath는 빌드 도구용이라 읽지 않고, ext만 그 프로젝트에 둔다
  private buildscriptBlock(closure: ClosureExpr, ctx: Ctx): void {
    const inner = this.child(ctx)
    for (const stmt of closure.body) {
      if (stmt.kind === 'assign') {
        const path = pathOf(stmt.target)
        if (path && (path[0] === 'ext' || path[0] === 'rootProject' || path[0] === 'project'))
          this.assign(stmt, inner)
        continue
      }
      if (stmt.kind === 'decl') continue
      const call = callOf(stmt)
      if (call && (samePath(call.path, 'ext') || call.path?.[call.path.length - 1] === 'set'))
        this.common(stmt, inner)
    }
  }

  // ---- TeamCode 모듈(TeamCode/build.gradle, allprojects·subprojects, 거기서 apply from 한 파일) ----

  private async moduleBlock(statements: Stmt[], ctx: Ctx): Promise<void> {
    for (const stmt of statements) {
      if (stmt.kind === 'control' || stmt.kind === 'unknown') {
        this.hidden(ctx, stmt)
        continue
      }
      if (stmt.kind === 'assign') {
        const path = pathOf(stmt.target)
        if (
          samePath(path, 'android', 'compileSdk') ||
          samePath(path, 'android', 'compileSdkVersion')
        ) {
          this.setCompileSdk(stmt.value, ctx)
          continue
        }
      }
      if (this.common(stmt, ctx)) continue
      const call = callOf(stmt)
      if (!call || !call.path) continue
      const closure = call.call.closure
      const name = call.path.join('.')
      if (name === 'repositories' && closure) this.repositoryBlock(closure, ctx)
      else if (name === 'dependencies' && closure) this.dependencyBlock(closure, ctx)
      else if (name === 'android' && closure) this.androidBlock(closure, ctx)
      else if (name === 'android.compileSdk' || name === 'android.compileSdkVersion') {
        const arg = positional(call.call.args)[0]
        if (arg) this.setCompileSdk(arg, ctx)
      } else if (name === 'apply') await this.applyFrom(call.call, ctx)
      else if (name === 'buildscript' && closure) this.buildscriptBlock(closure, ctx)
      else if (call.path[0] === 'configurations') {
        if (
          mentions(
            call.call,
            new Set(['exclude', 'resolutionStrategy', 'force', 'dependencySubstitution'])
          )
        )
          this.diag(
            'unsupportedSyntax',
            this.at(ctx, stmt),
            `configurations rules are not read: ${this.snippet(ctx, stmt)}`
          )
      } else if (name === 'afterEvaluate' && closure && mentions(call.call, RELEVANT_NAMES))
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `declarations inside 'afterEvaluate' are not read`
        )
      else if (
        (call.path[0] === 'dependencies' || call.path[0] === 'repositories') &&
        call.path.length > 1
      )
        // dependencies.add('implementation', …), repositories.maven { … } 등
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `${name} is not read: ${this.snippet(ctx, stmt)}`
        )
      else if (closure && mentions(closure, DECLARATION_NAMES))
        // 플러그인 DSL 안의 선언(Dairy의 ftc { dairy { implementation(Sloth) } } 등)
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `dependencies declared inside '${name} { }' are not read`
        )
    }
  }

  // apply from: '…'(Groovy) / apply(from = "…")(Kotlin). apply plugin은 넘긴다.
  private async applyFrom(call: Extract<Expr, { kind: 'call' }>, ctx: Ctx): Promise<void> {
    const from = namedArg(call.args, 'from')
    if (!from) return
    if (namedArg(call.args, 'to')) {
      this.diag(
        'unsupportedSyntax',
        this.at(ctx, call),
        `apply ... to: is not read: ${this.snippet(ctx, call)}`
      )
      return
    }
    const value = this.evaluate(from.value, ctx)
    let resolved: ReturnType<typeof resolveProjectPath>
    if (value.kind === 'string') {
      this.spend(value.value.length, ctx.file, call.line)
      resolved = resolveProjectPath(this.projectDir(ctx.target), value.value)
    } else if (value.kind === 'path') {
      this.spend(value.rest.length, ctx.file, call.line)
      resolved = resolveProjectPath(value.base, value.rest)
    } else if (value.kind === 'unresolved') {
      this.unresolvedDiag(ctx, from.value, value)
      return
    } else {
      this.diag(
        'unsupportedSyntax',
        this.at(ctx, call),
        `apply from: ${this.snippet(ctx, from.value)}`
      )
      return
    }
    if (!resolved.ok) {
      this.diag(resolved.code, this.at(ctx, call), resolved.detail)
      return
    }
    const path = resolved.path
    if (ctx.chain.includes(path)) {
      this.diag(
        'tooDeep',
        this.at(ctx, call),
        `apply from cycle: ${[...ctx.chain, path].join(' -> ')}`
      )
      return
    }
    if (ctx.chain.length >= MAX_APPLY_DEPTH) {
      this.diag(
        'tooDeep',
        this.at(ctx, call),
        `apply from is nested more than ${MAX_APPLY_DEPTH} levels: ${path}`
      )
      return
    }
    if (this.applied >= MAX_APPLIED_SCRIPTS) {
      this.limitOnce(
        'applied',
        this.at(ctx, call),
        `apply from runs more than ${MAX_APPLIED_SCRIPTS} scripts`
      )
      return
    }
    this.applied++
    const read = await this.read(path)
    if (read.kind === 'missing') {
      this.diag('missingFile', this.at(ctx, call), path)
      return
    }
    if (read.kind === 'problem') {
      this.diag(read.code, this.at(ctx, call), read.detail)
      return
    }
    await this.runScript(path, read.text, ctx.target, ctx.alsoRoot, ctx.chain)
  }

  // ---- android { compileSdk } ----

  private androidBlock(closure: ClosureExpr, ctx: Ctx): void {
    const inner = this.child(ctx)
    const sdkNames = new Set(['compileSdk', 'compileSdkVersion', 'compileSdkPreview'])
    for (const stmt of closure.body) {
      if (stmt.kind === 'control' || stmt.kind === 'unknown') {
        this.hidden(inner, stmt, sdkNames)
        continue
      }
      if (stmt.kind === 'decl') {
        this.declare(stmt, inner)
        continue
      }
      const path = stmt.kind === 'assign' ? pathOf(stmt.target) : (callOf(stmt)?.path ?? null)
      if (!path || path.length !== 1) continue
      const name = path[0]
      if (name === 'compileSdkPreview') {
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `compileSdkPreview is not supported: ${this.snippet(ctx, stmt)}`
        )
        continue
      }
      if (name !== 'compileSdk' && name !== 'compileSdkVersion' && name !== 'setCompileSdkVersion')
        continue
      if (stmt.kind === 'assign') {
        this.setCompileSdk(stmt.value, inner)
        continue
      }
      const call = callOf(stmt)
      if (!call) continue
      const arg = positional(call.call.args)[0]
      if (arg) this.setCompileSdk(arg, inner)
      else if (call.call.closure) this.compileSdkBlock(call.call.closure, inner)
    }
  }

  // compileSdk { version = release(36) }(AGP 8.12 이후의 새 표기)
  private compileSdkBlock(closure: ClosureExpr, ctx: Ctx): void {
    for (const stmt of closure.body) {
      if (stmt.kind !== 'assign' || !samePath(pathOf(stmt.target), 'version')) continue
      const value = stmt.value
      if (value.kind === 'call' && samePath(pathOf(value.callee), 'release')) {
        const arg = positional(value.args)[0]
        if (arg) this.setCompileSdk(arg, ctx)
      } else
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `compileSdk ${this.snippet(ctx, stmt)} is not supported`
        )
    }
  }

  private setCompileSdk(expr: Expr, ctx: Ctx): void {
    const value = this.evaluate(expr, ctx)
    if (value.kind === 'unresolved') {
      this.unresolvedDiag(ctx, expr, value)
      return
    }
    const text = isScalar(value) ? scalarText(value) : ''
    const match = /^(?:android-)?(\d{1,4})$/.exec(text)
    const api = match ? Number(match[1]) : NaN
    if (!(api >= 1 && api <= 1000)) {
      this.diag(
        'unsupportedSyntax',
        this.at(ctx, expr),
        `compileSdk '${this.snippet(ctx, expr)}' is not an API level`
      )
      return
    }
    this.compileSdk = api
  }

  // ---- repositories { } ----

  private repositoryBlock(closure: ClosureExpr, ctx: Ctx): void {
    const inner = this.child(ctx)
    for (const stmt of closure.body) {
      if (stmt.kind === 'control' || stmt.kind === 'unknown') {
        this.hidden(ctx, stmt, null)
        continue
      }
      if (this.common(stmt, inner)) continue
      const call = callOf(stmt)
      const name = call?.path?.length === 1 ? call.path[0] : null
      if (!call || name === null) {
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `repository could not be read: ${this.snippet(ctx, stmt)}`
        )
        continue
      }
      if (REPOSITORY_KINDS.has(name))
        this.addRepository(name as GradleRepositoryKind, null, this.at(ctx, stmt))
      else if (name === 'flatDir') this.addRepository('flatDir', null, this.at(ctx, stmt))
      else if (name === 'maven') this.mavenRepository(call.call, inner)
      else if (name === 'exclusiveContent' && call.call.closure) {
        // exclusiveContent { forRepository { maven { … } } filter { … } }: 저장소만 읽는다
        for (const child of call.call.closure.body) {
          const nested = callOf(child)
          if (nested && samePath(nested.path, 'forRepository') && nested.call.closure)
            this.repositoryBlock(nested.call.closure, inner)
        }
      } else this.diag('unsupportedSyntax', this.at(ctx, stmt), `repository '${name}' is not read`)
    }
  }

  private mavenRepository(call: Extract<Expr, { kind: 'call' }>, ctx: Ctx): void {
    let urlExpr: Expr | null = namedArg(call.args, 'url')?.value ?? positional(call.args)[0] ?? null
    if (call.closure) {
      const inner = this.child(ctx)
      for (const stmt of call.closure.body) {
        if (stmt.kind === 'decl') {
          this.declare(stmt, inner)
          continue
        }
        if (stmt.kind === 'assign' && samePath(pathOf(stmt.target), 'url')) {
          urlExpr = stmt.value
          continue
        }
        const nested = callOf(stmt)
        if (nested && (samePath(nested.path, 'url') || samePath(nested.path, 'setUrl')))
          urlExpr = positional(nested.call.args)[0] ?? urlExpr
      }
    }
    if (!urlExpr) {
      this.diag('unsupportedSyntax', this.at(ctx, call), 'maven repository without a url')
      return
    }
    const value = this.evaluate(urlExpr, ctx)
    if (value.kind === 'string') {
      this.spend(value.value.length, ctx.file, urlExpr.line)
      this.addRepository('maven', value.value, this.at(ctx, urlExpr))
    } else if (value.kind === 'unresolved') this.unresolvedDiag(ctx, urlExpr, value)
    else
      this.diag(
        'unsupportedSyntax',
        this.at(ctx, urlExpr),
        `local maven repository is not read: ${this.snippet(ctx, urlExpr)}`
      )
  }

  private addRepository(kind: GradleRepositoryKind, url: string | null, at: GradleLocation): void {
    const key = `${kind}\u0000${url ?? ''}\u0000${at.file}\u0000${at.line}`
    if (this.repositoryKeys.has(key)) return
    if (this.repositories.length >= MAX_REPOSITORIES) {
      this.limitOnce('repositories', at, `more than ${MAX_REPOSITORIES} repositories`)
      return
    }
    this.repositoryKeys.add(key)
    this.repositories.push({ kind, url, at })
  }

  // ---- dependencies { } ----

  private dependencyBlock(closure: ClosureExpr, ctx: Ctx): void {
    const inner = this.child(ctx)
    for (const stmt of closure.body) {
      if (stmt.kind === 'control' || stmt.kind === 'unknown') {
        this.hidden(ctx, stmt, null)
        continue
      }
      if (this.common(stmt, inner)) continue
      const call = callOf(stmt)
      // Kotlin 스크립트 플러그인(apply(from = "x.gradle.kts"))에는 형식 있는 접근자가 없어 "implementation"(…)로 쓴다
      const name =
        call?.path?.length === 1 ? call.path[0] : call ? literalString(call.call.callee) : null
      if (!call || name === null) {
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `dependency could not be read: ${this.snippet(ctx, stmt)}`
        )
        continue
      }
      if (SUPPORTED_CONFIGURATIONS.has(name))
        this.declaration(name as GradleConfiguration, call.call, inner)
      else if (
        /^(?:test|androidTest|testFixtures)[A-Z]/.test(name) ||
        SILENT_CONFIGURATIONS.has(name)
      )
        continue
      else if (PROCESSOR_CONFIGURATIONS.has(name))
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `${name} is not run by SandBot: ${this.snippet(ctx, stmt)}`
        )
      else if (
        name === 'constraints' ||
        name === 'components' ||
        name === 'modules' ||
        name === 'add'
      )
        this.diag('unsupportedSyntax', this.at(ctx, stmt), `dependencies ${name} is not read`)
      else if (VARIANT_CONFIGURATION.test(name))
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `build variant configuration '${name}' is not read`
        )
      // 그 밖의 구성(팀이 만든 구성 등)은 TeamCode 컴파일과 관계없다
    }
  }

  private declaration(
    configuration: GradleConfiguration,
    call: Extract<Expr, { kind: 'call' }>,
    ctx: Ctx
  ): void {
    const named = call.args.filter((arg) => arg.name !== null)
    const notations: Array<{ notation: Notation; line: number }> = []
    if (named.length > 0) {
      if (named.length !== call.args.length) {
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, call),
          `mixed dependency notation: ${this.snippet(ctx, call)}`
        )
        return
      }
      const entries = new Map<string, Value>()
      for (const arg of named) entries.set(arg.name as string, this.evaluate(arg.value, ctx))
      const notation = this.mapNotation(entries, ctx, call)
      if (notation) notations.push({ notation, line: call.line })
    } else {
      const flat: Flat = { items: 0 }
      for (const arg of call.args) {
        const found = this.notations(arg.value, ctx, flat)
        if (found === null) {
          this.diag(
            'tooMany',
            this.at(ctx, call),
            `dependency list has more than ${MAX_COLLECTION} entries: ${this.snippet(ctx, call)}`
          )
          return
        }
        for (const notation of found) notations.push({ notation, line: arg.value.line })
      }
    }
    if (notations.length === 0) return
    const modifiers = call.closure
      ? this.dependencyModifiers(call.closure, ctx)
      : { excludes: [], transitive: null }
    // 표기마다 exclude를 복사하고 의존성 키(JSON)에 넣는다
    const excludeSize = modifiers.excludes.reduce(
      (size, e) => size + 1 + (e.group?.length ?? 0) + (e.module?.length ?? 0),
      0
    )
    this.spend(notations.length * excludeSize, ctx.file, call.line)
    for (const { notation, line } of notations)
      this.addDependency({
        configuration,
        group: notation.group,
        artifact: notation.artifact,
        version: notation.version,
        classifier: notation.classifier,
        extension: notation.extension,
        // 한 문장의 여러 표기가 같은 배열을 나눠 갖지 않게
        excludes: modifiers.excludes.map((exclude) => ({ ...exclude })),
        // Gradle은 확장자('g:a:v@aar', ext:)가 있으면 전이 의존성을 끈다
        // (ModuleFactoryHelper.addExplicitArtifactsIfDefined). 클로저의 transitive는 그 뒤에 적용되어 이긴다.
        transitive: modifiers.transitive ?? notation.extension === null,
        at: { file: ctx.file, line }
      })
  }

  private addDependency(dependency: GradleDependency): void {
    // 한도를 이미 알렸으면 더 볼 것이 없다(키를 만들지 않는다)
    if (this.dependencies.length >= MAX_DEPENDENCIES && this.limits.has('dependencies')) return
    const key = JSON.stringify(dependency)
    if (this.dependencyKeys.has(key)) return
    if (this.dependencies.length >= MAX_DEPENDENCIES) {
      this.limitOnce('dependencies', dependency.at, `more than ${MAX_DEPENDENCIES} dependencies`)
      return
    }
    this.dependencyKeys.add(key)
    this.dependencies.push(dependency)
  }

  // 인자 하나의 표기들. project(':FtcRobotController')는 조용히 넘기고, 읽지 못하면 진단을 남기고 []다.
  // 펼친 목록 항목이 그 문장에서 한도를 넘으면 null이다(flat에 센다).
  private notations(expr: Expr, ctx: Ctx, flat: Flat): Notation[] | null {
    if (expr.kind === 'call') {
      const callee = pathOf(expr.callee)
      const name = callee?.length === 1 ? callee[0] : null
      if (name === 'project') {
        const arg = namedArg(expr.args, 'path')?.value ?? positional(expr.args)[0]
        const value = arg ? this.evaluate(arg, ctx) : null
        if (value?.kind === 'string' && value.value === ':FtcRobotController') return []
        this.diag('localDependency', this.at(ctx, expr), this.snippet(ctx, expr))
        return []
      }
      if (name === 'files' || name === 'fileTree') {
        this.diag('localDependency', this.at(ctx, expr), this.snippet(ctx, expr))
        return []
      }
      if (name === 'platform' || name === 'enforcedPlatform' || name === 'testFixtures') {
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, expr),
          `${name}(...) dependencies are not read: ${this.snippet(ctx, expr)}`
        )
        return []
      }
      if (name === 'gradleApi' || name === 'localGroovy') {
        this.diag('localDependency', this.at(ctx, expr), this.snippet(ctx, expr))
        return []
      }
      if (name === 'kotlin' && ctx.dialect === 'kotlin') return this.kotlinModule(expr, ctx)
    }
    const value = this.evaluate(expr, ctx)
    return this.notationsOf(value, expr, ctx, flat)
  }

  private notationsOf(value: Value, expr: Expr, ctx: Ctx, flat: Flat): Notation[] | null {
    switch (value.kind) {
      case 'string': {
        this.spend(value.value.length, ctx.file, expr.line)
        const notation = parseNotation(value.value)
        if (typeof notation === 'string') {
          this.diag('unsupportedSyntax', this.at(ctx, expr), notation)
          return []
        }
        return [notation]
      }
      case 'map': {
        const notation = this.mapNotation(value.entries, ctx, expr)
        return notation ? [notation] : []
      }
      case 'list': {
        // 같은 목록을 여러 번 넣은 목록([l, l], l = [m, m] …)은 값으로는 작아도 펼치면 지수로 커진다
        flat.items += value.items.length
        if (flat.items > MAX_COLLECTION) return null
        this.spend(value.items.length, ctx.file, expr.line)
        const out: Notation[] = []
        for (const item of value.items) {
          const found = this.notationsOf(item, expr, ctx, flat)
          if (found === null) return null
          out.push(...found)
        }
        return out
      }
      case 'catalog':
        return this.catalogNotations(value.path, expr, ctx, flat)
      case 'unresolved':
        this.unresolvedDiag(ctx, expr, value)
        return []
      default:
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, expr),
          `not a dependency notation: ${this.snippet(ctx, expr)}`
        )
        return []
    }
  }

  // group: 'g', name: 'a', version: 'v'(classifier:, ext:). group 없이 name만이면 flatDir 의존성이다.
  private mapNotation(entries: Map<string, Value>, ctx: Ctx, node: Expr): Notation | null {
    const text: Record<string, string> = {}
    for (const [key, value] of entries) {
      if (value.kind === 'string') this.spend(value.value.length, ctx.file, node.line)
      if (!['group', 'name', 'version', 'classifier', 'ext'].includes(key)) {
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, node),
          `dependency attribute '${key}' is not read`
        )
        return null
      }
      if (value.kind === 'unresolved') {
        this.unresolvedDiag(ctx, node, value)
        return null
      }
      if (value.kind !== 'string') {
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, node),
          `dependency ${key} is not a string: ${this.snippet(ctx, node)}`
        )
        return null
      }
      text[key] = value.value
    }
    if (text.name !== undefined && text.group === undefined) {
      this.diag('localDependency', this.at(ctx, node), this.snippet(ctx, node))
      return null
    }
    if (text.group === undefined || text.name === undefined || text.version === undefined) {
      this.diag(
        'unsupportedSyntax',
        this.at(ctx, node),
        `dependency needs group, name and version: ${this.snippet(ctx, node)}`
      )
      return null
    }
    const classifier = text.classifier ?? null
    const extension = text.ext ?? null
    if (
      !isNotationName(text.group) ||
      !isNotationName(text.name) ||
      !isNotationVersion(text.version) ||
      (classifier !== null && !isNotationName(classifier)) ||
      (extension !== null && !/^[A-Za-z0-9]+$/.test(extension))
    ) {
      this.diag(
        'unsupportedSyntax',
        this.at(ctx, node),
        `invalid dependency: ${this.snippet(ctx, node)}`
      )
      return null
    }
    return { group: text.group, artifact: text.name, version: text.version, classifier, extension }
  }

  // Kotlin DSL kotlin("stdlib", "1.9.0") → org.jetbrains.kotlin:kotlin-stdlib:1.9.0
  private kotlinModule(expr: Extract<Expr, { kind: 'call' }>, ctx: Ctx): Notation[] {
    const args = positional(expr.args)
    const module = args[0] ? this.evaluate(args[0], ctx) : null
    const versionExpr = args[1] ?? namedArg(expr.args, 'version')?.value
    const version = versionExpr ? this.evaluate(versionExpr, ctx) : null
    if (module?.kind === 'unresolved') {
      this.unresolvedDiag(ctx, expr, module)
      return []
    }
    if (version?.kind === 'unresolved') {
      this.unresolvedDiag(ctx, expr, version)
      return []
    }
    if (module?.kind !== 'string' || version?.kind !== 'string') {
      this.diag(
        'unsupportedSyntax',
        this.at(ctx, expr),
        `kotlin(...) needs a module and a version: ${this.snippet(ctx, expr)}`
      )
      return []
    }
    const notation = parseNotation(`org.jetbrains.kotlin:kotlin-${module.value}:${version.value}`)
    if (typeof notation === 'string') {
      this.diag('unsupportedSyntax', this.at(ctx, expr), notation)
      return []
    }
    return [notation]
  }

  private catalogNotations(path: string[], expr: Expr, ctx: Ctx, flat: Flat): Notation[] | null {
    const catalog = this.catalog
    const accessor = path.join('.')
    if (!catalog) {
      this.diag(
        'versionCatalogEntry',
        this.at(ctx, expr),
        `libs.${accessor}: ${VERSION_CATALOG_PATH} not found`
      )
      return []
    }
    if (path[0] === 'bundles') {
      const bundle = catalog.bundles.get(path.slice(1).join('.'))
      if (!bundle) {
        this.diag(
          'versionCatalogEntry',
          this.at(ctx, expr),
          `libs.${accessor} is not in ${VERSION_CATALOG_PATH}`
        )
        return []
      }
      flat.items += bundle.aliases.length
      if (flat.items > MAX_COLLECTION) return null
      this.spend(bundle.aliases.length, ctx.file, expr.line)
      return bundle.aliases.flatMap((alias) => this.catalogLibrary(alias, expr, ctx))
    }
    if (path[0] === 'versions' || path[0] === 'plugins') {
      this.diag('unsupportedSyntax', this.at(ctx, expr), `libs.${accessor} is not a library`)
      return []
    }
    return this.catalogLibrary(accessor, expr, ctx)
  }

  private catalogLibrary(accessor: string, expr: Expr, ctx: Ctx): Notation[] {
    const catalog = this.catalog as VersionCatalog
    // 찾는 일은 이름 글자 수만큼이다(묶음의 별칭은 카탈로그에서 온 글자라 쓰는 쪽보다 훨씬 길 수 있다)
    this.spend(accessor.length, ctx.file, expr.line)
    const library = catalog.libraries.get(accessor)
    if (!library) {
      this.diag(
        'versionCatalogEntry',
        this.at(ctx, expr),
        `libs.${accessor} is not in ${VERSION_CATALOG_PATH}`
      )
      return []
    }
    if (library.problem) {
      this.diag(
        'versionCatalogEntry',
        this.at(ctx, expr),
        `libs.${accessor}: ${clip(library.problem)}`
      )
      return []
    }
    let version = library.version
    if (library.versionRef !== null) {
      // 쓸 때마다 ref를 접근자로 바꿔 찾는다(글자 수만큼)
      this.spend(library.versionRef.length, ctx.file, expr.line)
      const ref = catalog.versions.get(library.versionRef.replace(/[-_.]/g, '.'))
      if (!ref || ref.problem || ref.version === null) {
        this.diag(
          'versionCatalogEntry',
          this.at(ctx, expr),
          `libs.${accessor}: version.ref '${clip(library.versionRef)}' ${ref?.problem ?? `is not in [versions] of ${VERSION_CATALOG_PATH}`}`
        )
        return []
      }
      version = ref.version
    }
    if (version === null) {
      this.diag('unsupportedSyntax', this.at(ctx, expr), `libs.${accessor} has no version`)
      return []
    }
    const coordinate = `${library.group}:${library.artifact}:${version}`
    this.spend(coordinate.length, ctx.file, expr.line)
    const notation = parseNotation(coordinate)
    if (typeof notation === 'string') {
      this.diag('versionCatalogEntry', this.at(ctx, expr), `libs.${accessor}: ${notation}`)
      return []
    }
    return [notation]
  }

  // implementation('…') { exclude group: …; transitive = false }. transitive는 정하지 않았으면 null.
  private dependencyModifiers(
    closure: ClosureExpr,
    ctx: Ctx
  ): { excludes: GradleExclude[]; transitive: boolean | null } {
    const inner = this.child(ctx)
    const excludes: GradleExclude[] = []
    let transitive: boolean | null = null
    const setTransitive = (expr: Expr | undefined, node: Stmt): void => {
      const value = expr ? this.evaluate(expr, inner) : null
      if (value?.kind === 'boolean') transitive = value.value
      else if (value?.kind === 'unresolved') this.unresolvedDiag(ctx, expr as Expr, value)
      else
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, node),
          `transitive is not a boolean: ${this.snippet(ctx, node)}`
        )
    }
    for (const stmt of closure.body) {
      if (stmt.kind === 'decl' || stmt.kind === 'skip') {
        this.common(stmt, inner)
        continue
      }
      if (stmt.kind === 'assign') {
        const path = pathOf(stmt.target)
        if (samePath(path, 'transitive') || samePath(path, 'isTransitive'))
          setTransitive(stmt.value, stmt)
        else if (samePath(path, 'changing') || samePath(path, 'isChanging')) continue
        else
          this.diag(
            'unsupportedSyntax',
            this.at(ctx, stmt),
            `dependency setting is not read: ${this.snippet(ctx, stmt)}`
          )
        continue
      }
      const call = callOf(stmt)
      const name = call?.path?.length === 1 ? call.path[0] : null
      if (call && name === 'exclude') {
        const exclude = this.exclude(call.call, inner)
        if (exclude) excludes.push(exclude)
      } else if (call && (name === 'transitive' || name === 'setTransitive'))
        setTransitive(positional(call.call.args)[0], stmt)
      else if (call && (name === 'because' || name === 'changing')) continue
      else
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, stmt),
          `dependency setting is not read: ${this.snippet(ctx, stmt)}`
        )
    }
    return { excludes, transitive }
  }

  private exclude(call: Extract<Expr, { kind: 'call' }>, ctx: Ctx): GradleExclude | null {
    const entries = new Map<string, Value>()
    for (const arg of call.args) {
      if (arg.name !== null) entries.set(arg.name, this.evaluate(arg.value, ctx))
      else {
        const value = this.evaluate(arg.value, ctx)
        if (value.kind === 'map') {
          // 맵 변수는 이름 하나로 쓰지만 복사는 항목 수만큼이다(exclude m, m, …나 줄마다 exclude m)
          this.spend(value.entries.size, ctx.file, call.line)
          for (const [key, item] of value.entries) entries.set(key, item)
        } else entries.set('', value)
      }
    }
    const exclude: GradleExclude = { group: null, module: null }
    for (const [key, value] of entries) {
      if (value.kind === 'unresolved') {
        this.unresolvedDiag(ctx, call, value)
        return null
      }
      if ((key !== 'group' && key !== 'module') || value.kind !== 'string') {
        this.diag(
          'unsupportedSyntax',
          this.at(ctx, call),
          `exclude is not read: ${this.snippet(ctx, call)}`
        )
        return null
      }
      exclude[key] = value.value
    }
    if (exclude.group === null && exclude.module === null) {
      this.diag(
        'unsupportedSyntax',
        this.at(ctx, call),
        `exclude is not read: ${this.snippet(ctx, call)}`
      )
      return null
    }
    return exclude
  }

  // ---- 값 ----

  // 그 프로젝트의 ext 속성(ext.x·ext.get·by extra). Gradle은 gradle.properties를 ext에 넣어 두므로 ext에 없으면 그것을 본다.
  private extValue(project: ProjectId, name: string): Value | null {
    const own = this.projects[project]
    return own.ext.get(name) ?? own.props.get(name) ?? null
  }

  // 프로젝트 속성($x·findProperty·property): 그 프로젝트의 ext 속성(gradle.properties 포함) → TeamCode면 물려받는 루트의
  // ext 속성. 루트의 gradle.properties는 TeamCode의 것에 이미 들어 있어 물려받는 루트 ext보다 먼저다.
  private property(project: ProjectId, name: string): Value | null {
    const value = this.extValue(project, name)
    if (value || project !== 'module') return value
    return this.extValue('root', name)
  }

  private projectDir(project: ProjectId): string {
    return project === 'module' ? TEAMCODE_MODULE_DIR : ''
  }

  private lookup(name: string, ctx: Ctx): Value {
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
      const value = ctx.scopes[i].get(name)
      if (value) return value
    }
    const project = this.projectOf(ctx)
    switch (name) {
      case 'rootProject':
        return { kind: 'project', project: 'root' }
      case 'project':
        return { kind: 'project', project }
      case 'ext':
        return { kind: 'ext', project }
      case 'extra':
        if (ctx.dialect === 'kotlin') return { kind: 'ext', project }
        break
      case 'rootDir':
        return { kind: 'path', base: '', rest: '' }
      case 'projectDir':
        return { kind: 'path', base: this.projectDir(project), rest: '' }
      case 'providers':
        return { kind: 'providers' }
    }
    const value = this.property(project, name)
    if (value) return value
    if (name === 'libs') {
      if (this.catalog) return { kind: 'catalog', path: [] }
      return unresolved(`${VERSION_CATALOG_PATH} not found`, { catalog: true })
    }
    return unresolved(`unknown name '${name}'`, { missing: true })
  }

  private member(base: Value, name: string): Value {
    switch (base.kind) {
      case 'unresolved':
        return base
      case 'project':
        if (name === 'ext' || name === 'extra') return { kind: 'ext', project: base.project }
        if (name === 'rootProject') return { kind: 'project', project: 'root' }
        if (name === 'rootDir') return { kind: 'path', base: '', rest: '' }
        if (name === 'projectDir')
          return { kind: 'path', base: this.projectDir(base.project), rest: '' }
        return (
          this.property(base.project, name) ??
          unresolved(`project property '${name}' is not set`, { missing: true })
        )
      case 'ext':
        return (
          this.extValue(base.project, name) ??
          unresolved(`extra property '${name}' is not set`, { missing: true })
        )
      case 'map':
        return base.entries.get(name) ?? unresolved(`no key '${name}'`, { missing: true })
      case 'catalog':
        return { kind: 'catalog', path: [...base.path, name] }
      case 'provider':
        if (name === 'orNull') return base.value
        break
    }
    return unresolved(`cannot read '${name}'`)
  }

  private evaluate(expr: Expr, ctx: Ctx): Value {
    this.spend(1, ctx.file, expr.line)
    switch (expr.kind) {
      case 'string':
        return this.interpolate(expr, ctx)
      case 'number': {
        const text = expr.text.replace(/_/g, '').replace(/[lLiIgG]$/, '')
        if (/^[0-9]+$/.test(text)) return { kind: 'number', value: Number(text) }
        if (/^0[xX][0-9a-fA-F]+$/.test(text))
          return { kind: 'number', value: parseInt(text.slice(2), 16) }
        return unresolved(`number '${expr.text}' is not an integer`)
      }
      case 'name':
        if (expr.name === 'true' || expr.name === 'false')
          return { kind: 'boolean', value: expr.name === 'true' }
        if (expr.name === 'null') return { kind: 'null' }
        return this.lookup(expr.name, ctx)
      case 'member':
        return this.member(this.evaluate(expr.target, ctx), expr.name)
      case 'index': {
        const base = this.evaluate(expr.target, ctx)
        const key = this.evaluate(expr.index, ctx)
        if (key.kind === 'unresolved') return key
        if (key.kind === 'string') return this.member(base, key.value)
        if (key.kind === 'number' && base.kind === 'list')
          return base.items[key.value] ?? unresolved(`index ${key.value} is out of range`)
        return base.kind === 'unresolved'
          ? base
          : unresolved(`cannot evaluate '${this.snippet(ctx, expr)}'`)
      }
      case 'call':
        return this.call(expr, ctx)
      case 'list': {
        if (expr.items.length > MAX_COLLECTION) return unresolved('list is too long')
        return { kind: 'list', items: expr.items.map((item) => this.evaluate(item, ctx)) }
      }
      case 'map': {
        if (expr.entries.length > MAX_COLLECTION) return unresolved('map is too long')
        const entries = new Map<string, Value>()
        for (const entry of expr.entries)
          if (entry.key !== null) entries.set(entry.key, this.evaluate(entry.value, ctx))
        return { kind: 'map', entries }
      }
      case 'binary':
        return this.binary(expr, ctx)
      case 'cast': {
        const value = this.evaluate(expr.expr, ctx)
        if (value.kind === 'unresolved' || !isScalar(value)) return value
        if (['String', 'CharSequence', 'GString'].includes(expr.type))
          return { kind: 'string', value: scalarText(value) }
        if (['int', 'Integer', 'Int', 'long', 'Long'].includes(expr.type))
          return this.toInteger(value)
        return value
      }
      default:
        return unresolved(`cannot evaluate '${this.snippet(ctx, expr)}'`)
    }
  }

  private toInteger(value: Value): Value {
    if (value.kind === 'number') return value
    if (value.kind === 'string' && value.value.length <= 32 && /^\s*-?[0-9]+\s*$/.test(value.value))
      return { kind: 'number', value: Number(value.value.trim()) }
    return unresolved('not an integer')
  }

  private interpolate(expr: Extract<Expr, { kind: 'string' }>, ctx: Ctx): Value {
    let text = ''
    // "$rootDir/x": 폴더 값 뒤의 글자는 그 폴더 기준이다(앞의 '/'를 뗀다)
    let path: { base: string; dir: boolean } | null = null
    for (let i = 0; i < expr.parts.length; i++) {
      const part = expr.parts[i]
      if (typeof part === 'string') {
        text += part
      } else {
        const value = this.evaluate(part, ctx)
        if (value.kind === 'unresolved') return value
        if (value.kind === 'path' && i === 0) {
          path = { base: value.base, dir: value.rest === '' }
          text += value.rest
        } else if (isScalar(value)) text += scalarText(value)
        else if (value.kind === 'null')
          return unresolved(`'${this.snippet(ctx, part)}' is null`, { missing: true })
        else if (value.kind === 'catalog')
          return unresolved(`use libs.${value.path.join('.')}.get() for the value`, {
            catalog: true
          })
        else return unresolved(`cannot use '${this.snippet(ctx, part)}' in a string`)
      }
      if (text.length > MAX_VALUE_LENGTH) return unresolved('string is too long')
    }
    // 새로 이은 글자(쓰는 쪽이 글자를 훑는다)
    this.spend(text.length, ctx.file, expr.line)
    if (path)
      return { kind: 'path', base: path.base, rest: path.dir ? text.replace(/^[\\/]+/, '') : text }
    return { kind: 'string', value: text }
  }

  private binary(expr: Extract<Expr, { kind: 'binary' }>, ctx: Ctx): Value {
    if (expr.op === '?:') {
      const left = this.evaluate(expr.left, ctx)
      if (left.kind === 'null' || (left.kind === 'unresolved' && left.missing))
        return this.evaluate(expr.right, ctx)
      return left
    }
    if (expr.op !== '+') return unresolved(`cannot evaluate '${this.snippet(ctx, expr)}'`)
    const left = this.evaluate(expr.left, ctx)
    if (left.kind === 'unresolved') return left
    const right = this.evaluate(expr.right, ctx)
    if (right.kind === 'unresolved') return right
    if (left.kind === 'number' && right.kind === 'number')
      return { kind: 'number', value: left.value + right.value }
    if (left.kind === 'string' && isScalar(right)) {
      const value = left.value + scalarText(right)
      if (value.length > MAX_VALUE_LENGTH) return unresolved('string is too long')
      this.spend(value.length, ctx.file, expr.line)
      return { kind: 'string', value }
    }
    if (left.kind === 'path' && right.kind === 'string') {
      const rest = left.rest === '' ? right.value.replace(/^[\\/]+/, '') : left.rest + right.value
      if (rest.length > MAX_VALUE_LENGTH) return unresolved('path is too long')
      this.spend(rest.length, ctx.file, expr.line)
      return { kind: 'path', base: left.base, rest }
    }
    if (
      left.kind === 'list' &&
      right.kind === 'list' &&
      left.items.length + right.items.length <= MAX_COLLECTION
    ) {
      this.spend(left.items.length + right.items.length, ctx.file, expr.line)
      return { kind: 'list', items: [...left.items, ...right.items] }
    }
    return unresolved(`cannot evaluate '${this.snippet(ctx, expr)}'`)
  }

  private call(expr: Extract<Expr, { kind: 'call' }>, ctx: Ctx): Value {
    const args = positional(expr.args)
    const arg = (index: number): Value =>
      args[index] ? this.evaluate(args[index], ctx) : unresolved('missing argument')
    const project = this.projectOf(ctx)
    const propertyCall = (owner: ProjectId, method: string): Value | null => {
      const key = arg(0)
      if (key.kind === 'unresolved') return key
      if (key.kind !== 'string') return null
      const value = this.property(owner, key.value)
      if (method === 'findProperty') return value ?? { kind: 'null' }
      if (method === 'property')
        return value ?? unresolved(`project property '${key.value}' is not set`, { missing: true })
      if (method === 'hasProperty') return { kind: 'boolean', value: value !== null }
      return null
    }
    if (expr.callee.kind === 'name') {
      const name = expr.callee.name
      const shadowed = ctx.scopes.some((scope) => scope.has(name))
      if (!shadowed) {
        if (name === 'uri' && args.length === 1) return arg(0)
        if (name === 'file' && args.length === 1) {
          const value = arg(0)
          return value.kind === 'string'
            ? { kind: 'path', base: this.projectDir(project), rest: value.value }
            : value
        }
        if (['findProperty', 'property', 'hasProperty'].includes(name)) {
          const value = propertyCall(project, name)
          if (value) return value
        }
      }
    } else if (expr.callee.kind === 'member') {
      const method = expr.callee.name
      const owner = this.evaluate(expr.callee.target, ctx)
      if (owner.kind === 'unresolved') return owner
      if (owner.kind === 'project') {
        if (['findProperty', 'property', 'hasProperty'].includes(method)) {
          const value = propertyCall(owner.project, method)
          if (value) return value
        }
        if (method === 'file' && args.length === 1) {
          const value = arg(0)
          return value.kind === 'string'
            ? { kind: 'path', base: this.projectDir(owner.project), rest: value.value }
            : value
        }
        if (method === 'uri' && args.length === 1) return arg(0)
      }
      if (
        owner.kind === 'ext' &&
        (method === 'get' || method === 'getProperty') &&
        args.length === 1
      ) {
        const key = arg(0)
        if (key.kind === 'string')
          return (
            this.extValue(owner.project, key.value) ??
            unresolved(`extra property '${key.value}' is not set`, { missing: true })
          )
      }
      if (owner.kind === 'ext' && method === 'has' && args.length === 1) {
        const key = arg(0)
        if (key.kind === 'string')
          return { kind: 'boolean', value: this.extValue(owner.project, key.value) !== null }
      }
      if (owner.kind === 'providers' && method === 'gradleProperty' && args.length === 1) {
        // Gradle 속성(gradle.properties)만 본다(ext는 아니다)
        const key = arg(0)
        if (key.kind === 'unresolved') return key
        if (key.kind === 'string')
          return {
            kind: 'provider',
            value: this.projects.root.props.get(key.value) ?? { kind: 'null' }
          }
      }
      if (owner.kind === 'provider') {
        if (method === 'get' && args.length === 0)
          return owner.value.kind === 'null'
            ? unresolved('Gradle property is not set', { missing: true })
            : owner.value
        if (method === 'getOrElse' && args.length === 1)
          return owner.value.kind === 'null' ? arg(0) : owner.value
        if (method === 'getOrNull' && args.length === 0) return owner.value
      }
      if (owner.kind === 'catalog' && method === 'get' && args.length === 0)
        return this.catalogVersion(owner.path)
      if (isScalar(owner) && args.length === 0) {
        if (method === 'toString') return { kind: 'string', value: scalarText(owner) }
        if (method === 'trim' && owner.kind === 'string')
          return { kind: 'string', value: owner.value.trim() }
        if (method === 'toInteger' || method === 'toInt' || method === 'toLong')
          return this.toInteger(owner)
      }
    }
    return unresolved(`cannot evaluate '${this.snippet(ctx, expr)}'`)
  }

  // libs.versions.x.get()
  private catalogVersion(path: string[]): Value {
    if (path[0] !== 'versions' || path.length < 2)
      return unresolved(`libs.${path.join('.')} is not a version`, { catalog: true })
    const accessor = path.slice(1).join('.')
    const entry = this.catalog?.versions.get(accessor)
    if (!entry)
      return unresolved(`libs.versions.${accessor} is not in ${VERSION_CATALOG_PATH}`, {
        catalog: true
      })
    if (entry.problem || entry.version === null)
      return unresolved(`libs.versions.${accessor}: ${entry.problem ?? 'no version'}`, {
        catalog: true
      })
    if (entry.version.length > MAX_VALUE_LENGTH)
      return unresolved(`libs.versions.${accessor} is too long`, { catalog: true })
    return { kind: 'string', value: entry.version }
  }
}

export function readGradle(source: GradleFileSource): Promise<GradleProject> {
  return new GradleReader(source).run()
}
