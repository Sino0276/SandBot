// 의존성 표기 'group:artifact:version[:classifier][@extension]'. 이름에 쓸 수 있는 글자를 좁혀 둔다(해석기가 이 글자로
// 저장소 주소와 캐시 경로를 만든다). 버전은 선언한 글자 그대로 두고(동적 버전 '+'·'latest.release'·범위·SNAPSHOT도)
// 해석기가 거부한다.

export type Notation = {
  group: string
  artifact: string
  version: string
  classifier: string | null
  extension: string | null
}

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/
// 범위('[1.0,2.0)')·동적('1.+', 'latest.release')·SNAPSHOT까지 받는다
const VERSION = /^[A-Za-z0-9_.+\-[\](),]+$/
const EXTENSION = /^[A-Za-z0-9]+$/
const MAX_PART_LENGTH = 200

export function isNotationName(text: string): boolean {
  return text.length <= MAX_PART_LENGTH && NAME.test(text) && !text.includes('..')
}

export function isNotationVersion(text: string): boolean {
  return text.length <= MAX_PART_LENGTH && VERSION.test(text)
}

// 문자열 표기를 나눈다. 틀리면 이유(영어).
export function parseNotation(text: string): Notation | string {
  let main = text
  let extension: string | null = null
  const at = text.lastIndexOf('@')
  if (at >= 0) {
    extension = text.slice(at + 1)
    main = text.slice(0, at)
    if (!EXTENSION.test(extension)) return `invalid artifact extension in '${text}'`
  }
  const parts = main.split(':')
  if (parts.length === 2 || (parts.length === 3 && parts[2] === ''))
    return `dependency '${text}' has no version`
  if (parts.length < 3 || parts.length > 4) return `'${text}' is not a group:name:version notation`
  const [group, artifact, version, classifier] = parts
  if (!isNotationName(group) || !isNotationName(artifact))
    return `invalid group or name in '${text}'`
  if (!isNotationVersion(version)) return `invalid version in '${text}'`
  if (classifier !== undefined && !isNotationName(classifier))
    return `invalid classifier in '${text}'`
  return { group, artifact, version, classifier: classifier ?? null, extension }
}
