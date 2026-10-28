// POM을 읽는 작은 XML 파서. 저장소 응답은 믿지 않는 입력이라 DTD·엔티티 선언을 받지 않는다(XXE, billion laughs):
// <!DOCTYPE>이 있으면 거부하고, 엔티티는 XML 기본 다섯 개와 문자 참조만 푼다. 속성·네임스페이스는 읽기만 하고 쓰지 않는다
// (POM은 요소와 글자로 충분하다). 깊이·요소 수를 제한한다.

export type XmlElement = {
  name: string
  children: XmlElement[]
  // 바로 아래 글자(자식 요소 사이의 글자도 이어 붙임). 앞뒤 공백은 그대로.
  text: string
}

export class XmlError extends Error {}

const MAX_DEPTH = 64
const MAX_ELEMENTS = 50_000

const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'"
}

function decode(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&([^;&\s]{0,16});/g, (_whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = Number.parseInt(name.slice(2), 16)
      if (!Number.isFinite(code) || code > 0x10ffff)
        throw new XmlError(`bad character reference &${name};`)
      return String.fromCodePoint(code)
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10)
      if (!Number.isFinite(code) || code > 0x10ffff)
        throw new XmlError(`bad character reference &${name};`)
      return String.fromCodePoint(code)
    }
    const value = ENTITIES[name]
    if (value === undefined) throw new XmlError(`unknown entity &${name};`)
    return value
  })
}

const NAME = /^[A-Za-z_][\w.:-]*/

// 문서의 뿌리 요소. 읽을 수 없으면 XmlError.
export function parseXml(source: string): XmlElement {
  let pos = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const stack: XmlElement[] = []
  let root: XmlElement | null = null
  let count = 0

  const fail = (message: string): never => {
    throw new XmlError(`${message} at offset ${pos}`)
  }

  while (pos < source.length) {
    const lt = source.indexOf('<', pos)
    const textEnd = lt < 0 ? source.length : lt
    if (textEnd > pos) {
      const text = source.slice(pos, textEnd)
      if (stack.length > 0) stack[stack.length - 1].text += decode(text)
      else if (text.trim() !== '') fail('text outside the root element')
    }
    if (lt < 0) break
    pos = lt
    if (source.startsWith('<!--', pos)) {
      const end = source.indexOf('-->', pos + 4)
      if (end < 0) fail('unterminated comment')
      pos = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', pos)) {
      const end = source.indexOf(']]>', pos + 9)
      if (end < 0) fail('unterminated CDATA')
      if (stack.length === 0) fail('CDATA outside the root element')
      stack[stack.length - 1].text += source.slice(pos + 9, end)
      pos = end + 3
      continue
    }
    if (source.startsWith('<?', pos)) {
      const end = source.indexOf('?>', pos + 2)
      if (end < 0) fail('unterminated processing instruction')
      pos = end + 2
      continue
    }
    if (source.startsWith('<!', pos)) fail('DTD and declarations are not allowed')
    if (source.startsWith('</', pos)) {
      const match = NAME.exec(source.slice(pos + 2, pos + 2 + 256))
      if (!match) fail('bad end tag')
      const name = match![0]
      const close = source.indexOf('>', pos + 2 + name.length)
      if (close < 0 || source.slice(pos + 2 + name.length, close).trim() !== '') fail('bad end tag')
      const open = stack.pop()
      if (!open || open.name !== name) fail(`unexpected </${name}>`)
      pos = close + 1
      continue
    }
    const match = NAME.exec(source.slice(pos + 1, pos + 1 + 256))
    if (!match) fail('bad start tag')
    const name = match![0]
    // 속성 건너뛰기(따옴표 안의 '>'도 고려)
    let i = pos + 1 + name.length
    let quote: string | null = null
    for (; i < source.length; i++) {
      const ch = source[i]
      if (quote) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>' || ch === '<') break
    }
    if (i >= source.length || source[i] !== '>') fail('unterminated start tag')
    const selfClosing = source[i - 1] === '/'
    if (stack.length === 0 && root !== null) fail('more than one root element')
    if (stack.length >= MAX_DEPTH) fail('elements are nested too deeply')
    if (++count > MAX_ELEMENTS) fail('too many elements')
    const element: XmlElement = { name, children: [], text: '' }
    if (stack.length > 0) stack[stack.length - 1].children.push(element)
    else root = element
    if (!selfClosing) stack.push(element)
    pos = i + 1
  }
  if (stack.length > 0) fail(`unclosed <${stack[stack.length - 1].name}>`)
  if (!root) fail('no root element')
  return root!
}

export function child(element: XmlElement | null | undefined, name: string): XmlElement | null {
  return element?.children.find((candidate) => candidate.name === name) ?? null
}

export function childrenNamed(element: XmlElement | null | undefined, name: string): XmlElement[] {
  return element ? element.children.filter((candidate) => candidate.name === name) : []
}

// 자식 요소의 글자(앞뒤 공백 없이). 없거나 비었으면 null.
export function childText(element: XmlElement | null | undefined, name: string): string | null {
  const found = child(element, name)
  if (!found) return null
  const text = found.text.trim()
  return text === '' ? null : text
}
