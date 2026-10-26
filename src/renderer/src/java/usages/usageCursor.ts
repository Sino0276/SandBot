// 사용처 사실(usageFacts.ts)을 만드는 토큰 커서. lexJava 결과 위에서 괄호 짝을 미리 구해 두고(괄호를 O(1)에
// 건너뛰고, 깊게 중첩돼도 재귀하지 않는다) 형식·형식 인자·애너테이션·문장 끝·람다 몸통 끝을 읽는다.
// tunables.ts의 skipBalanced는 부를 때마다 선형으로 훑으므로 따로 쓴다(3단계 코드는 고치지 않는다).
//
// - 같은 시작 위치의 형식 인자·문장 끝·람다 몸통 끝은 한 번만 계산한다(메모). 형식 중첩은 MAX_TYPE_DEPTH까지만
//   읽는다. 그래서 어떤 토큰 수프에도 파일 길이에 거의 비례한 시간에 끝나고 예외를 던지지 않는다.
// - 짝이 없는 여는 괄호는 파일 끝(n)과 짝이다. 닫는 괄호는 같은 종류의 여는 괄호가 있을 때만 짝을 짓는다.
//   ')'·']'는 가장 안쪽 '{' 너머의 괄호를 닫지 않고, '}'는 그 안의 닫히지 않은 '('·'['를 함께 닫는다(쓰는 중인 코드).
//   그렇게 함께 닫힌 괄호를 건너뛰면(after) 바깥 닫는 괄호 앞에 선다. 짝이 없는 닫는 괄호는 짝이 -1이다.
// - texts는 파일 글자의 조각이라 사실에 넣지 않는다. 사실에 넣는 글자는 intern으로 복사한다(V8의 잘린 문자열은
//   원래 파일 글자 전체를 붙잡는다).
import { lexJava, type JavaLexResult, type JavaToken } from '../../../../shared/java/lexer'

// 소스에 쓴 형식 하나. names는 점으로 나눈 이름(['RobotHardware', 'Lift'], 기본형은 ['int']), args는 모든 이름에
// 붙은 형식 인자를 차례로 모은 것(와일드카드는 경계만, ?만이면 넣지 않음), dims는 배열 차원([] 수, 가변 인자는 +1),
// scope는 이 이름을 풀 형식 범위(사실의 typeScopes 번호)다.
export type TypeRef = { names: string[]; args: TypeRef[]; dims: number; scope: number }

export const PRIMITIVE_TYPES: ReadonlySet<string> = new Set([
  'boolean',
  'byte',
  'char',
  'short',
  'int',
  'long',
  'float',
  'double'
])

// 기본형(배열 포함)이면 참조 형식이 아니다. 생성 클래스로 풀릴 일이 없으므로 사실에는 null로 둔다.
export function isPrimitiveRef(ref: TypeRef): boolean {
  return ref.names.length === 1 && PRIMITIVE_TYPES.has(ref.names[0])
}

// 형식 인자 중첩 한도(List<List<…>> 깊이). 넘으면 형식이 아닌 것으로 본다.
export const MAX_TYPE_DEPTH = 32

// 글자를 한 번 복사해 모아 두는 표. 사실에 넣는 모든 이름·스니펫이 이것을 거친다(파일 글자를 붙잡지 않게).
// 열쇠도 복사본이라 표가 원래 글자를 붙잡지 않는다.
export function createInterner(): (value: string) => string {
  const pool = new Map<string, string>()
  return (value) => {
    let copy = pool.get(value)
    if (copy === undefined) {
      copy = JSON.parse(JSON.stringify(value)) as string
      pool.set(copy, copy)
    }
    return copy
  }
}

export type ParsedType = { ref: TypeRef; end: number }
type ParsedArgs = { args: TypeRef[]; end: number }

export class UsageCursor {
  readonly tokens: readonly JavaToken[]
  readonly n: number
  // 토큰 글자(파일 글자의 조각, 사실에 넣지 않는다)
  readonly texts: string[]
  // 여는 괄호 → 닫는 괄호(짝이 없으면 n), 닫는 괄호 → 여는 괄호(짝이 없으면 -1), 괄호가 아니면 -1
  readonly pair: Int32Array
  // TypeRef마다 이름 토큰 번호(위치·스니펫 표시용). 사실에는 넣지 않는다.
  readonly nameTokens = new Map<TypeRef, number[]>()
  private readonly typeMemo = new Map<number, { scope: number; result: ParsedType | null }>()
  private readonly argsMemo = new Map<number, { scope: number; result: ParsedArgs | null }>()
  private readonly statementMemo: Int32Array
  private readonly lambdaMemo: Int32Array

  constructor(
    text: string,
    readonly intern: (value: string) => string = createInterner(),
    readonly lex: JavaLexResult = lexJava(text)
  ) {
    this.tokens = lex.tokens
    this.n = lex.tokens.length
    this.texts = lex.tokens.map((token) => text.slice(token.start, token.end))
    this.pair = new Int32Array(this.n).fill(-1)
    this.statementMemo = new Int32Array(this.n).fill(-1)
    this.lambdaMemo = new Int32Array(this.n).fill(-1)
    this.matchBrackets()
  }

  op(i: number, value: string): boolean {
    return this.tokens[i]?.kind === 'operator' && this.texts[i] === value
  }

  kw(i: number, value: string): boolean {
    return this.tokens[i]?.kind === 'keyword' && this.texts[i] === value
  }

  ident(i: number): boolean {
    return this.tokens[i]?.kind === 'identifier'
  }

  // 여는 괄호의 짝(닫는 괄호 번호). 짝이 없으면 그 괄호를 끝내는 바깥 닫는 괄호, 그것도 없으면 n.
  end(open: number): number {
    const close = this.pair[open]
    return close < 0 ? Math.min(open + 1, this.n) : close
  }

  // 여는 괄호의 짝 다음. 바깥 괄호가 대신 닫은 것이면 그 바깥 닫는 괄호(그 괄호는 바깥 것이 처리한다).
  after(open: number): number {
    const close = this.pair[open]
    if (close < 0) return Math.min(open + 1, this.n)
    if (close >= this.n) return this.n
    return this.pair[close] === open ? close + 1 : close
  }

  // 괄호 짝을 스택 하나로 구한다. '{' 안쪽마다 '('·'['의 수를 세어 두어, 짝이 없는 닫는 괄호가 스택을 끝까지
  // 뒤지지 않게 한다(뒤지면 '((((…]]]]' 같은 입력에서 제곱 시간이 걸린다).
  private matchBrackets(): void {
    const stack: number[] = []
    const counts: { paren: number; bracket: number }[] = [{ paren: 0, bracket: 0 }]
    let braces = 0
    for (let i = 0; i < this.n; i++) {
      if (this.tokens[i].kind !== 'operator') continue
      const t = this.texts[i]
      if (t === '(' || t === '[') {
        stack.push(i)
        counts[counts.length - 1][t === '(' ? 'paren' : 'bracket']++
      } else if (t === '{') {
        stack.push(i)
        counts.push({ paren: 0, bracket: 0 })
        braces++
      } else if (t === ')' || t === ']') {
        const open = t === ')' ? '(' : '['
        const count = counts[counts.length - 1]
        if (count[t === ')' ? 'paren' : 'bracket'] === 0) continue
        for (;;) {
          const o = stack.pop()!
          const ot = this.texts[o]
          count[ot === '(' ? 'paren' : 'bracket']--
          this.pair[o] = i
          if (ot === open) {
            this.pair[i] = o
            break
          }
        }
      } else if (t === '}') {
        if (braces === 0) continue
        for (;;) {
          const o = stack.pop()!
          this.pair[o] = i
          if (this.texts[o] === '{') {
            this.pair[i] = o
            counts.pop()
            braces--
            break
          }
        }
      }
    }
    for (const o of stack) this.pair[o] = this.n
  }

  // '@'에서 시작하는 애너테이션 하나(@Name, @a.b.Name, @Name(…)) 다음. @interface는 애너테이션이 아니다.
  skipAnnotation(i: number): number {
    if (!this.op(i, '@') || this.kw(i + 1, 'interface')) return i
    let j = i + 1
    if (!this.ident(j)) return j
    j++
    while (this.op(j, '.') && this.ident(j + 1)) j += 2
    return this.op(j, '(') ? this.after(j) : j
  }

  // 형식 앞의 애너테이션들(Java 8 형식 애너테이션 포함)
  skipAnnotations(i: number): number {
    let j = i
    while (this.op(j, '@') && !this.kw(j + 1, 'interface')) j = this.skipAnnotation(j)
    return j
  }

  // i에서 형식 하나를 읽는다: [애너테이션] (기본형 | 이름(<인자>)?(.이름(<인자>)?)*) ([])*.
  // 형식이 아니면 null. '<'가 형식 인자로 읽히지 않으면(a < b) 그 앞에서 끝난다. 뒤가 무엇인지는 부르는 쪽이 본다.
  parseType(i: number, scope: number, depth = 0): ParsedType | null {
    const start = this.skipAnnotations(i)
    let base: ParsedType | null
    if (this.tokens[start]?.kind === 'keyword' && PRIMITIVE_TYPES.has(this.texts[start])) {
      const ref: TypeRef = { names: [this.intern(this.texts[start])], args: [], dims: 0, scope }
      this.nameTokens.set(ref, [start])
      base = { ref, end: start + 1 }
    } else {
      base = this.typeCore(start, scope, depth)
    }
    if (!base) return null
    let j = base.end
    let dims = 0
    while (this.op(j, '[') && this.op(j + 1, ']')) {
      dims++
      j += 2
    }
    if (dims === 0) return base
    const ref: TypeRef = { ...base.ref, dims: base.ref.dims + dims }
    this.nameTokens.set(ref, this.nameTokens.get(base.ref) ?? [])
    return { ref, end: j }
  }

  // 이름(<인자>)?(.이름(<인자>)?)*(배열 차원 없이). 같은 위치는 한 번만 읽는다.
  private typeCore(i: number, scope: number, depth: number): ParsedType | null {
    if (!this.ident(i)) return null
    const memo = this.typeMemo.get(i)
    if (memo && memo.scope === scope) return memo.result
    const names: string[] = []
    const tokens: number[] = []
    const args: TypeRef[] = []
    let j = i
    for (;;) {
      names.push(this.intern(this.texts[j]))
      tokens.push(j)
      j++
      if (this.op(j, '<')) {
        const parsed = this.typeArgs(j, scope, false, depth + 1)
        if (!parsed) break
        args.push(...parsed.args)
        j = parsed.end
      }
      if (this.op(j, '.')) {
        const next = this.skipAnnotations(j + 1)
        if (this.ident(next)) {
          j = next
          continue
        }
      }
      break
    }
    const ref: TypeRef = { names, args, dims: 0, scope }
    this.nameTokens.set(ref, tokens)
    const result = { ref, end: j }
    this.typeMemo.set(i, { scope, result })
    return result
  }

  // '<'에서 형식 인자 목록 <A, B<C>, ? extends D>를 읽는다. diamond면 빈 <>도 받는다. 형식 인자가 아니면 null.
  typeArgs(i: number, scope: number, diamond = false, depth = 0): ParsedArgs | null {
    if (!this.op(i, '<')) return null
    if (this.op(i + 1, '>')) return diamond ? { args: [], end: i + 2 } : null
    if (depth > MAX_TYPE_DEPTH) return null
    const memo = this.argsMemo.get(i)
    if (memo && memo.scope === scope) return memo.result
    // 재귀 중에 같은 위치를 다시 묻지 않게 실패로 먼저 둔다
    this.argsMemo.set(i, { scope, result: null })
    const args: TypeRef[] = []
    let j = i + 1
    let result: ParsedArgs | null = null
    for (;;) {
      j = this.skipAnnotations(j)
      let parsed: ParsedType | null
      if (this.op(j, '?')) {
        j++
        if (this.kw(j, 'extends') || this.kw(j, 'super')) {
          parsed = this.parseType(j + 1, scope, depth)
          if (!parsed) break
          args.push(parsed.ref)
          j = parsed.end
        }
      } else {
        parsed = this.parseType(j, scope, depth)
        if (!parsed) break
        args.push(parsed.ref)
        j = parsed.end
      }
      if (this.op(j, ',')) {
        j++
        continue
      }
      if (this.op(j, '>')) result = { args, end: j + 1 }
      break
    }
    this.argsMemo.set(i, { scope, result })
    return result
  }

  private afterParen(i: number): number {
    return this.op(i, '(') ? this.after(i) : i
  }

  // i에서 시작하는 문장 하나의 끝(다음 토큰 번호). 중괄호 없는 중첩(if (a) for (…) x; else y;)도 재귀 없이
  // 스택으로 읽고, 거쳐 간 문장 시작마다 결과를 메모한다. 문장이 아니면(닫는 괄호) i를 돌려준다.
  statementEnd(start: number): number {
    type Pending = { start: number; kind: 'nested' | 'if' | 'do' }
    const stack: Pending[] = []
    let j = start
    outer: for (;;) {
      let k: number
      if (j >= this.n) k = this.n
      else if (this.statementMemo[j] >= 0) k = this.statementMemo[j]
      else if (this.op(j, '{')) k = this.after(j)
      else if (this.kw(j, 'if')) {
        stack.push({ start: j, kind: 'if' })
        j = this.afterParen(j + 1)
        continue
      } else if (this.kw(j, 'for') || this.kw(j, 'while')) {
        stack.push({ start: j, kind: 'nested' })
        j = this.afterParen(j + 1)
        continue
      } else if (this.kw(j, 'do')) {
        stack.push({ start: j, kind: 'do' })
        j++
        continue
      } else if (this.ident(j) && this.op(j + 1, ':')) {
        // 이름표: 뒤 문장이 곧 이 문장이다
        stack.push({ start: j, kind: 'nested' })
        j += 2
        continue
      } else if (this.kw(j, 'try')) k = this.tryEnd(j)
      else if (this.kw(j, 'switch') || this.kw(j, 'synchronized')) {
        const body = this.afterParen(j + 1)
        k = this.op(body, '{') ? this.after(body) : body
      } else k = this.simpleEnd(j)
      if (j < this.n) this.statementMemo[j] = k
      for (;;) {
        const pending = stack.pop()
        if (!pending) return k
        if (pending.kind === 'if' && this.kw(k, 'else')) {
          // else 몸통이 끝나면 이 if도 끝난다
          stack.push({ start: pending.start, kind: 'nested' })
          j = k + 1
          continue outer
        }
        if (pending.kind === 'do' && this.kw(k, 'while')) {
          k = this.afterParen(k + 1)
          if (this.op(k, ';')) k++
        }
        this.statementMemo[pending.start] = k
      }
    }
  }

  private tryEnd(j: number): number {
    let k = j + 1
    if (this.op(k, '(')) k = this.after(k)
    if (this.op(k, '{')) k = this.after(k)
    while (this.kw(k, 'catch')) {
      k = this.afterParen(k + 1)
      if (this.op(k, '{')) k = this.after(k)
    }
    if (this.kw(k, 'finally')) {
      k++
      if (this.op(k, '{')) k = this.after(k)
    }
    return k
  }

  // 식 문장·지역 변수 선언·return 등: 같은 깊이의 ';'까지. 지역 클래스 선언은 몸통 '}'에서 끝난다.
  private simpleEnd(j: number): number {
    let declaresClass = false
    for (let k = j; k < this.n;) {
      const token = this.tokens[k]
      if (token.kind === 'operator') {
        const t = this.texts[k]
        if (t === '(' || t === '[') {
          k = this.after(k)
          continue
        }
        if (t === '{') {
          if (declaresClass) return this.after(k)
          k = this.after(k)
          continue
        }
        if (t === ';') return k + 1
        // 바깥 괄호가 닫힌다(';' 없이 끝난 문장)
        if (t === ')' || t === ']' || t === '}') return k
      } else if (
        token.kind === 'keyword' &&
        (this.texts[k] === 'class' || this.texts[k] === 'interface' || this.texts[k] === 'enum') &&
        !this.op(k - 1, '.')
      ) {
        declaresClass = true
      }
      k++
    }
    return this.n
  }

  // '->' 다음(start)에서 람다 몸통의 끝(다음 토큰 번호, 식 몸통이면 끝내는 토큰). 블록 몸통은 짝 '}' 다음이고,
  // 식 몸통은 짝이 없는 첫 ','·')'·']'·'}'·';'이다. 식 몸통 안의 람다(a -> b -> c)는 끝이 같으므로 함께 메모한다.
  lambdaBodyEnd(start: number): number {
    if (start >= this.n) return this.n
    if (this.op(start, '{')) return this.after(start)
    if (this.lambdaMemo[start] >= 0) return this.lambdaMemo[start]
    const starts = [start]
    let k = start
    while (k < this.n) {
      if (this.tokens[k].kind === 'operator') {
        const t = this.texts[k]
        if (t === '(' || t === '[' || t === '{') {
          k = this.after(k)
          continue
        }
        if (t === ',' || t === ')' || t === ']' || t === '}' || t === ';') break
        if (t === '->' && !this.op(k + 1, '{')) {
          if (this.lambdaMemo[k + 1] >= 0) {
            k = this.lambdaMemo[k + 1]
            break
          }
          starts.push(k + 1)
        }
      }
      k++
    }
    for (const s of starts) if (s < this.n) this.lambdaMemo[s] = k
    return k
  }
}
