// 구성 이름 → Java 식별자·상수 이름, 클래스 이름 → 생성 파일 경로

const JAVA_KEYWORDS = new Set(
  (
    'abstract assert boolean break byte case catch char class const continue default do double else enum ' +
    'extends final finally float for goto if implements import instanceof int interface long native new ' +
    'package private protected public return short static strictfp super switch synchronized this throw ' +
    'throws transient try void volatile while true false null var record yield sealed permits'
  ).split(' ')
)

// 생성 코드가 직접 쓰는 이름. 필드가 이 이름이면 생성자 매개변수를 가린다.
const RESERVED_FIELDS = new Set(['hardwareMap'])

// 이름에 쓸 글자가 하나도 없을 때의 필드 이름('_'는 Java 9부터 키워드다)
const FALLBACK_IDENTIFIER = 'device'

// "front_left" → frontLeft, "Webcam 1" → webcam1, "2m sensor" → _2mSensor, "왼쪽 모터" → 왼쪽모터
// Java 식별자는 유니코드 글자를 쓸 수 있으므로 한글 이름도 그대로 둔다.
export function javaIdentifier(name: string): string {
  // Java 식별자 글자: 유니코드 글자, 십진 숫자, 글자 숫자(로마 숫자 등). ²·① 같은 기타 숫자는 쓸 수 없다.
  const words = name.split(/[^\p{L}\p{Nd}\p{Nl}]+/u).filter(Boolean)
  if (words.length === 0) return FALLBACK_IDENTIFIER
  const camel = words
    .map((word, i) => {
      const [first, ...rest] = Array.from(word)
      return (i === 0 ? first.toLowerCase() : first.toUpperCase()) + rest.join('')
    })
    .join('')
  const safe = /^\p{Nd}/u.test(camel) ? `_${camel}` : camel
  return JAVA_KEYWORDS.has(safe) || RESERVED_FIELDS.has(safe) ? `${safe}_` : safe
}

// frontLeft → FRONT_LEFT, _2mSensor → _2M_SENSOR(숫자로 시작하지 않게 밑줄을 남긴다)
export function constantName(identifier: string): string {
  const upper = identifier
    .replace(/^_+/, '')
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, '$1_$2')
    .toUpperCase()
  return !upper || /^\p{Nd}/u.test(upper) ? `_${upper}` : upper
}

// 장치 하나가 생성 코드에 만드는 상수(위치 오프셋 등). 검증이 로봇 안의 상수 이름 충돌을 찾는 데도 쓴다.
const CONSTANT_SUFFIXES: Record<string, string[]> = {
  pinpoint: ['_X_OFFSET_MM', '_Y_OFFSET_MM'],
  otos: ['_OFFSET_X_IN', '_OFFSET_Y_IN', '_OFFSET_H_DEG'],
  deadWheel: ['_X_MM', '_Y_MM', '_X_IN', '_Y_IN', '_MEASURES_FORWARD', '_REVERSED']
}

export function generatedConstantNames(type: string, name: string): string[] {
  const prefix = constantName(javaIdentifier(name))
  return (CONSTANT_SUFFIXES[type] ?? []).map((suffix) => `${prefix}${suffix}`)
}

export function isValidJavaClassName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !JAVA_KEYWORDS.has(name) && name !== '_'
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
