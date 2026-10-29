// gradle.properties(java.util.Properties 형식): key=value, key:value, key value, #·! 주석, 줄 끝 '\'로 잇기,
// \t·\n·\uXXXX 등 이스케이프. Gradle은 프로젝트 속성으로 읽는다(빌드 스크립트의 $name이 이 값을 본다).

export type PropertyEntry = { value: string; line: number }

const ESCAPES: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' }

function unescape(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = text[i + 1] ?? ''
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
      out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16))
      i += 5
      continue
    }
    out += ESCAPES[next] ?? next
    i++
  }
  return out
}

function oddTrailingBackslashes(text: string): boolean {
  let count = 0
  for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i--) count++
  return count % 2 === 1
}

// 뒤에 있는 같은 키가 앞의 것을 덮는다(Properties.load와 같다)
export function parseGradleProperties(text: string): Map<string, PropertyEntry> {
  const result = new Map<string, PropertyEntry>()
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\r|\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1
    let physical = lines[index].replace(/^[ \t\f]+/, '')
    if (physical === '' || physical.startsWith('#') || physical.startsWith('!')) continue
    // 끝의 역슬래시가 홀수 개면 다음 줄로 잇는다. Properties.load처럼 줄마다 센다(앞 줄을 이을 때 뗀 하나를 빼면
    // 앞 줄 끝의 역슬래시는 짝수라 이은 글자 전체로 세어도 같다). 이은 글자 전체를 줄마다 다시 훑지 않는다.
    const pieces: string[] = []
    while (oddTrailingBackslashes(physical) && index + 1 < lines.length) {
      pieces.push(physical.slice(0, -1))
      physical = lines[++index].replace(/^[ \t\f]+/, '')
    }
    pieces.push(physical)
    const logical = pieces.join('')
    let keyEnd = 0
    while (keyEnd < logical.length) {
      const ch = logical[keyEnd]
      if (ch === '\\') {
        keyEnd += 2
        continue
      }
      if (ch === '=' || ch === ':' || ch === ' ' || ch === '\t' || ch === '\f') break
      keyEnd++
    }
    const key = unescape(logical.slice(0, keyEnd))
    let rest = logical.slice(keyEnd).replace(/^[ \t\f]+/, '')
    if (rest.startsWith('=') || rest.startsWith(':')) rest = rest.slice(1).replace(/^[ \t\f]+/, '')
    result.set(key, { value: unescape(rest), line })
  }
  return result
}
