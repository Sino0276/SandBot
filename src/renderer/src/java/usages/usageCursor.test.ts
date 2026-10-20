import { describe, expect, it } from 'vitest'
import { createInterner, isPrimitiveRef, UsageCursor, type TypeRef } from './usageCursor'

// 토큰 글자로 위치를 찾는다(n번째 같은 글자)
function at(cursor: UsageCursor, text: string, nth = 0): number {
  let seen = 0
  for (let i = 0; i < cursor.n; i++) {
    if (cursor.texts[i] === text && seen++ === nth) return i
  }
  throw new Error(`no token ${text}#${nth}`)
}

// 형식을 글자로(이름.이름<인자, …>[])
function show(ref: TypeRef): string {
  return (
    ref.names.join('.') +
    (ref.args.length ? `<${ref.args.map(show).join(', ')}>` : '') +
    '[]'.repeat(ref.dims)
  )
}

function type(source: string, from = 0): { type: string; rest: string } | null {
  const cursor = new UsageCursor(source)
  const parsed = cursor.parseType(from, 0)
  if (!parsed) return null
  return { type: show(parsed.ref), rest: cursor.texts.slice(parsed.end).join(' ') }
}

describe('괄호 짝', () => {
  it('중첩된 괄호를 짝짓는다', () => {
    const c = new UsageCursor('f(a[1], { b(); })')
    const open = at(c, '(')
    expect(c.texts[c.end(open)]).toBe(')')
    expect(c.end(open)).toBe(c.n - 1)
    expect(c.pair[c.end(open)]).toBe(open)
    const brace = at(c, '{')
    expect(c.texts[c.end(brace)]).toBe('}')
    expect(c.after(brace)).toBe(at(c, ')', 1))
    const bracket = at(c, '[')
    expect(c.texts[c.end(bracket)]).toBe(']')
  })

  it('짝이 없는 여는 괄호는 파일 끝까지다', () => {
    const c = new UsageCursor('class A { void f() { g(')
    expect(c.end(at(c, '{'))).toBe(c.n)
    expect(c.after(at(c, '{', 1))).toBe(c.n)
    expect(c.after(at(c, '('))).toBe(at(c, '{', 1))
    expect(c.after(at(c, '(', 1))).toBe(c.n)
  })

  it("'}'는 그 안의 닫히지 않은 괄호를 함께 닫고, 건너뛰면 그 '}' 앞에 선다", () => {
    const c = new UsageCursor('{ f( a ; } x')
    const brace = at(c, '{')
    const paren = at(c, '(')
    const close = at(c, '}')
    expect(c.end(brace)).toBe(close)
    expect(c.pair[close]).toBe(brace)
    expect(c.end(paren)).toBe(close)
    expect(c.after(paren)).toBe(close)
    expect(c.after(brace)).toBe(close + 1)
  })

  it("')'·']'는 '{' 너머를 닫지 않는다(짝이 없는 닫는 괄호는 -1)", () => {
    const c = new UsageCursor('( { ) } ]')
    const paren = at(c, '(')
    const brace = at(c, '{')
    expect(c.pair[at(c, ')')]).toBe(-1)
    expect(c.end(brace)).toBe(at(c, '}'))
    expect(c.end(paren)).toBe(c.n)
    expect(c.pair[at(c, ']')]).toBe(-1)
  })

  it('종류가 다른 닫는 괄호: 안쪽 괄호를 함께 닫는다', () => {
    const c = new UsageCursor('( [ ) ]')
    expect(c.end(at(c, '('))).toBe(at(c, ')'))
    expect(c.after(at(c, '['))).toBe(at(c, ')'))
    expect(c.pair[at(c, ']')]).toBe(-1)
  })

  it('아주 깊은 중첩도 재귀 없이 짝짓는다', () => {
    const depth = 100_000
    const c = new UsageCursor('('.repeat(depth) + ')'.repeat(depth))
    expect(c.end(0)).toBe(2 * depth - 1)
    expect(c.end(depth - 1)).toBe(depth)
  })
})

describe('parseType', () => {
  it('이름·점 이름·기본형', () => {
    expect(type('RobotHardware robot')).toEqual({ type: 'RobotHardware', rest: 'robot' })
    expect(type('RobotHardware.Lift.Claw c')).toEqual({
      type: 'RobotHardware.Lift.Claw',
      rest: 'c'
    })
    expect(type('int x')).toEqual({ type: 'int', rest: 'x' })
    expect(isPrimitiveRef(new UsageCursor('double').parseType(0, 0)!.ref)).toBe(true)
    expect(type('= x')).toBeNull()
    expect(type('void f')).toBeNull()
  })

  it('형식 인자: 중첩, 연달아 닫는 >>·>>>, 와일드카드', () => {
    expect(type('Map<String, List<RobotHardware.Lift>> m')).toEqual({
      type: 'Map<String, List<RobotHardware.Lift>>',
      rest: 'm'
    })
    expect(type('A<B<C<D>>> x')?.type).toBe('A<B<C<D>>>')
    // 와일드카드는 경계만 남는다
    expect(type('List<? extends RobotHardware> a')?.type).toBe('List<RobotHardware>')
    expect(type('Class<?> k')?.type).toBe('Class')
    expect(type('Outer<A>.Inner<B> x')?.type).toBe('Outer.Inner<A, B>')
  })

  it('배열 차원과 기본형 배열', () => {
    expect(type('RobotHardware.Lift[] arr')).toEqual({ type: 'RobotHardware.Lift[]', rest: 'arr' })
    expect(type('int[][] grid')?.type).toBe('int[][]')
    expect(type('List<int[]>[] x')?.type).toBe('List<int[]>[]')
    // C 방식 차원(이름 뒤 [])은 형식이 아니라 선언자가 읽는다
    expect(type('Lift arr[]')).toEqual({ type: 'Lift', rest: 'arr [ ]' })
  })

  it('형식 애너테이션을 건너뛴다', () => {
    expect(type('@NonNull RobotHardware r')?.type).toBe('RobotHardware')
    expect(type('List<@NonNull String> l')?.type).toBe('List<String>')
    expect(type('@A(x = 1) Lift l')?.type).toBe('Lift')
  })

  it("형식 인자로 읽히지 않는 '<'(비교) 앞에서 멈춘다", () => {
    expect(type('a < b;')).toEqual({ type: 'a', rest: '< b ;' })
    expect(type('i < n && j > 0')).toEqual({ type: 'i', rest: '< n && j > 0' })
    expect(type('a.b.c(1)')).toEqual({ type: 'a.b.c', rest: '( 1 )' })
  })

  it('이름 토큰 위치를 기억한다(사실의 위치 계산용)', () => {
    const c = new UsageCursor('final RobotHardware.Lift x;')
    const parsed = c.parseType(1, 0)!
    expect(c.nameTokens.get(parsed.ref)).toEqual([1, 3])
  })

  it('형식 인자 깊이 한도를 넘으면 형식 인자가 아니다', () => {
    const deep = 'A<'.repeat(200) + 'B' + '>'.repeat(200)
    expect(type(deep)?.type).toBe('A')
  })

  it('typeArgs: 다이아몬드와 실패', () => {
    const c = new UsageCursor('new ArrayList<>() ; x<y')
    const lt = at(c, '<')
    expect(c.typeArgs(lt, 0)).toBeNull()
    expect(c.typeArgs(lt, 0, true)).toEqual({ args: [], end: lt + 2 })
    expect(c.typeArgs(at(c, '<', 1), 0)).toBeNull()
  })
})

describe('skipAnnotation', () => {
  it('@Name, @a.b.Name, @Name(…)을 건너뛰고 @interface는 두지 않는다', () => {
    const c = new UsageCursor('@Override @a.b.Config(name = "x", v = {1}) @interface X')
    const second = c.skipAnnotation(0)
    expect(c.texts[second]).toBe('@')
    const third = c.skipAnnotation(second)
    expect(c.texts[third]).toBe('@')
    expect(c.skipAnnotation(third)).toBe(third)
    expect(c.texts[c.skipAnnotations(0)]).toBe('@')
  })
})

describe('statementEnd', () => {
  // start 토큰에서 시작한 문장의 끝 다음 토큰 글자(없으면 '<끝>')
  function endText(source: string, start = 0): string {
    const c = new UsageCursor(source)
    const end = c.statementEnd(start)
    return end >= c.n ? '<끝>' : c.texts[end]
  }

  it('단순 문장과 블록', () => {
    expect(endText('x = f(a, {b;}); NEXT')).toBe('NEXT')
    expect(endText('{ a; b; } NEXT')).toBe('NEXT')
    expect(endText('; NEXT')).toBe('NEXT')
    expect(endText('return new Runnable() { public void run() { x(); } }; NEXT')).toBe('NEXT')
    expect(endText('Runnable r = () -> { a; }; NEXT')).toBe('NEXT')
  })

  it('if/else(중괄호 없는 중첩 포함)', () => {
    expect(endText('if (a) x(); NEXT')).toBe('NEXT')
    expect(endText('if (a) x(); else y(); NEXT')).toBe('NEXT')
    expect(endText('if (a) { } else if (b) { } else { } NEXT')).toBe('NEXT')
    expect(endText('if (a) if (b) x(); else y(); else z(); NEXT')).toBe('NEXT')
    expect(endText('if (a) for (;;) while (b) c(); NEXT')).toBe('NEXT')
  })

  it('for, while, do, 이름표', () => {
    expect(endText('for (int i = 0; i < n; i++) total += i; NEXT')).toBe('NEXT')
    expect(endText('for (Lift l : lifts) { l.go(); } NEXT')).toBe('NEXT')
    expect(endText('while (true) { } NEXT')).toBe('NEXT')
    expect(endText('do x(); while (a); NEXT')).toBe('NEXT')
    expect(endText('do { x(); } while (a); NEXT')).toBe('NEXT')
    expect(endText('outer: for (;;) inner: while (a) break outer; NEXT')).toBe('NEXT')
  })

  it('try(자원·catch·finally), switch, synchronized', () => {
    expect(endText('try { a(); } catch (A | B e) { } catch (C e) { } finally { } NEXT')).toBe(
      'NEXT'
    )
    expect(endText('try (R r = open()) { } NEXT')).toBe('NEXT')
    expect(endText('switch (k) { case 0: a(); break; default: b(); } NEXT')).toBe('NEXT')
    expect(endText('synchronized (lock) { a(); } NEXT')).toBe('NEXT')
  })

  it('지역 클래스 선언은 몸통에서 끝난다', () => {
    expect(endText('class L { void f() { } } NEXT')).toBe('NEXT')
    expect(endText('final class L extends Base { } NEXT')).toBe('NEXT')
  })

  it("블록이 닫히면 ';' 없이 끝난다", () => {
    const c = new UsageCursor('{ x = 1 }')
    expect(c.texts[c.statementEnd(1)]).toBe('}')
    expect(endText('', 0)).toBe('<끝>')
  })

  it('긴 중괄호 없는 중첩도 선형 시간(메모)', () => {
    const depth = 20_000
    const source = 'for (;;) '.repeat(depth) + 'x(); NEXT'
    const c = new UsageCursor(source)
    const started = performance.now()
    let end = 0
    // 모든 for에서 물어도(사실 추출이 그렇게 한다) 한 번씩만 계산한다
    for (let i = 0; i < c.n; i++) if (c.kw(i, 'for')) end = c.statementEnd(c.after(i + 1))
    expect(c.texts[end]).toBe('NEXT')
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('lambdaBodyEnd', () => {
  function bodyEnd(source: string): string {
    const c = new UsageCursor(source)
    const end = c.lambdaBodyEnd(at(c, '->') + 1)
    return end >= c.n ? '<끝>' : c.texts[end]
  }

  it('식 몸통은 짝이 없는 첫 , ) ] } ;에서 끝난다(Q2)', () => {
    expect(bodyEnd('both(robot -> robot.length(), robot.lift)')).toBe(',')
    expect(bodyEnd('f(x -> g(x, y))')).toBe(')')
    expect(bodyEnd('r = () -> a ? b : c;')).toBe(';')
    expect(bodyEnd('{ x -> new A() { void m() { } } }')).toBe('}')
    expect(bodyEnd('arr[x -> 1]')).toBe(']')
  })

  it('블록 몸통은 짝 } 다음이다', () => {
    expect(bodyEnd('f(() -> { a; b; }, c)')).toBe(',')
  })

  it('식 몸통 안의 람다는 같은 끝을 갖는다', () => {
    const c = new UsageCursor('f(a -> b -> c -> d, e)')
    const arrows = [at(c, '->'), at(c, '->', 1), at(c, '->', 2)]
    const comma = at(c, ',')
    expect(arrows.map((a) => c.lambdaBodyEnd(a + 1))).toEqual([comma, comma, comma])
  })

  it('끝나지 않은 몸통은 파일 끝까지다', () => {
    expect(bodyEnd('x -> foo(')).toBe('<끝>')
  })
})

describe('createInterner', () => {
  it('같은 글자는 한 번만 복사해 같은 값을 돌려준다', () => {
    const intern = createInterner()
    const source = 'robot.lift.liftLeft robot'
    const a = intern(source.slice(0, 5))
    const b = intern(source.slice(20, 25))
    expect(a).toBe('robot')
    expect(b).toBe('robot')
    expect(intern('lift')).toBe('lift')
  })
})
