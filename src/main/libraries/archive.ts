import { readZip, ZipError, type ZipLimits } from './zip'

// 받은 jar·AAR을 클래스패스 jar로. AAR은 메모리에서 classes.jar와 libs/*.jar만 꺼낸다(res·assets·R.txt는 쓰지 않는다,
// Pedro tuning의 10 MB assets도 풀지 않음). jni/(네이티브 코드)가 있으면 거부한다(가짜 SDK에서 돌 수 없다).
// jar마다 클래스 이름을 보고 보호 패키지(java.*·javax.*·org.sandbot.*·FTC SDK)의 클래스가 있으면 거부한다: 라이브러리가
// JDK·가짜 SDK의 클래스를 가리면 안 된다. 멀티 릴리스 jar의 META-INF/versions/N/ 아래 클래스도 같은 규칙으로 본다.
// 예외: JSR 305(com.google.code.findbugs:jsr305, ejml이 끌어옴)의 javax.annotation.*(Nonnull 등)은 JDK에 없는 패키지라
// 받는다(javax.annotation.processing은 JDK 것이라 보호한다).

export class ArchiveError extends Error {
  constructor(
    readonly code: 'badArchive' | 'protectedPackage',
    message: string
  ) {
    super(message)
  }
}

export type ClasspathJar = {
  // 'classes.jar', 'libs/x.jar' 또는 받은 jar의 파일 이름
  name: string
  bytes: Buffer
  // 이 jar의 클래스 패키지(점 이름, 정렬, 중복 없음)
  packages: string[]
}

const AAR_LIMITS: ZipLimits = { maxEntries: 20_000, maxEntrySize: 50 * 1024 * 1024, maxRatio: 200 }
const JAR_LIMITS: ZipLimits = { maxEntries: 65_535, maxEntrySize: 50 * 1024 * 1024, maxRatio: 200 }
// AAR에서 꺼내는 jar 전체 크기
const MAX_AAR_JARS_BYTES = 100 * 1024 * 1024
const LIB_JAR = /^libs\/[^/\\]+\.jar$/

const PROTECTED = ['java/', 'javax/', 'org/sandbot/', 'com/qualcomm/', 'org/firstinspires/']

function isProtected(className: string): boolean {
  if (
    className.startsWith('javax/annotation/') &&
    !className.startsWith('javax/annotation/processing/')
  )
    return false
  return PROTECTED.some((prefix) => className.startsWith(prefix))
}

// 클래스 엔트리 이름(멀티 릴리스 접두를 뺀 것). 클래스가 아니면 null.
function className(entryName: string): string | null {
  if (!entryName.endsWith('.class')) return null
  const versioned = /^META-INF\/versions\/\d+\/(.+)$/.exec(entryName)
  const name = versioned ? versioned[1] : entryName
  if (name.startsWith('META-INF/')) return null
  return name
}

// jar의 패키지 목록을 만들고 보호 패키지를 확인한다
export function inspectJar(name: string, bytes: Buffer): ClasspathJar {
  let entries
  try {
    entries = readZip(bytes, JAR_LIMITS).entries
  } catch (error) {
    throw new ArchiveError(
      'badArchive',
      `${name}: ${error instanceof ZipError ? error.message : String(error)}`
    )
  }
  const packages = new Set<string>()
  for (const entry of entries) {
    const cls = className(entry.name)
    if (cls === null) continue
    if (isProtected(cls))
      throw new ArchiveError('protectedPackage', `${name} contains ${cls.replace(/\.class$/, '')}`)
    const slash = cls.lastIndexOf('/')
    if (slash <= 0) continue
    packages.add(cls.slice(0, slash).split('/').join('.'))
  }
  return { name, bytes, packages: [...packages].sort() }
}

export function aarJars(name: string, bytes: Buffer): ClasspathJar[] {
  let zip
  try {
    zip = readZip(bytes, AAR_LIMITS)
  } catch (error) {
    throw new ArchiveError(
      'badArchive',
      `${name}: ${error instanceof ZipError ? error.message : String(error)}`
    )
  }
  if (zip.entries.some((entry) => entry.name.startsWith('jni/')))
    throw new ArchiveError('badArchive', `${name} contains native code (jni/)`)
  const wanted = zip.entries
    .map((entry) => entry.name)
    .filter((entry) => entry === 'classes.jar' || LIB_JAR.test(entry))
    .sort((a, b) =>
      a === 'classes.jar' ? -1 : b === 'classes.jar' ? 1 : a < b ? -1 : a > b ? 1 : 0
    )
  const jars: ClasspathJar[] = []
  let total = 0
  for (const entry of wanted) {
    let jar: Buffer | null
    try {
      jar = zip.read(entry)
    } catch (error) {
      throw new ArchiveError(
        'badArchive',
        `${name}: ${error instanceof ZipError ? error.message : String(error)}`
      )
    }
    if (!jar) continue
    total += jar.length
    if (total > MAX_AAR_JARS_BYTES)
      throw new ArchiveError('badArchive', `${name}: jars are too large`)
    jars.push(inspectJar(`${name}!/${entry}`, jar))
  }
  return jars.map((jar) => ({ ...jar, name: jar.name.slice(name.length + 2) }))
}

// 받은 파일(확장자로 구분) → 클래스패스 jar
export function classpathJars(fileName: string, bytes: Buffer): ClasspathJar[] {
  return fileName.endsWith('.aar') ? aarJars(fileName, bytes) : [inspectJar(fileName, bytes)]
}
