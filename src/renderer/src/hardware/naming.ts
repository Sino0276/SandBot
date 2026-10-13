// 구성 이름 → Java 식별자·상수 이름, 클래스 이름 → 생성 파일 경로

const JAVA_KEYWORDS = new Set(
  (
    'abstract assert boolean break byte case catch char class const continue default do double else enum ' +
    'extends final finally float for goto if implements import instanceof int interface long native new ' +
    'package private protected public return short static strictfp super switch synchronized this throw ' +
    'throws transient try void volatile while true false null var record yield sealed permits'
  ).split(' ')
)

// "front_left" → frontLeft, "Webcam 1" → webcam1, "2m sensor" → _2mSensor
export function javaIdentifier(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (words.length === 0) return '_'
  const camel = words
    .map((word, i) =>
      i === 0 ? word[0].toLowerCase() + word.slice(1) : word[0].toUpperCase() + word.slice(1)
    )
    .join('')
  const safe = /^[0-9]/.test(camel) ? `_${camel}` : camel
  return JAVA_KEYWORDS.has(safe) ? `${safe}_` : safe
}

// frontLeft → FRONT_LEFT
export function constantName(identifier: string): string {
  return identifier
    .replace(/^_+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase()
}

export function isValidJavaClassName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !JAVA_KEYWORDS.has(name)
}

// Java 문자열 리터럴 안에 넣을 수 있게 이스케이프
export function javaString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`
}

export function xmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// 생성 파일 위치(TeamCode 폴더 기준). 메인 프로세스도 같은 규칙으로 경로를 검사한다(src/shared/generatedFiles.ts).
export const GENERATED_JAVA_PACKAGE = 'org.firstinspires.ftc.teamcode.sandbot'

export function javaFilePath(className: string): string {
  return `src/main/java/${GENERATED_JAVA_PACKAGE.replace(/\./g, '/')}/${className}.java`
}

// Android 리소스 이름은 소문자·숫자·밑줄만 쓸 수 있다. RobotHardware → sandbot_robot_hardware.xml
export function configXmlFilePath(className: string): string {
  const snake = className
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
  return `src/main/res/xml/sandbot_${snake || 'robot'}.xml`
}
