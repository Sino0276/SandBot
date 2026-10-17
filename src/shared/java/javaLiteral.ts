// 튜닝 값 리터럴의 형식·검사. 렌더러(입력 → 리터럴)와 메인(쓰기 전 검사)이 같은 규칙을 쓴다.
// 구현은 3단계 구현에서 채운다(계약만 먼저 둔다).
import type { TunableValueType } from './tunableTypes'

// 메인이 받는 새 리터럴: true|false, -?정수·소수[지수][L|f], \u·줄바꿈 없는 문자열
export function isWritableLiteral(text: string): boolean {
  void text
  throw new Error('not implemented')
}

// 바꿀 자리(expected)로 받는 글자: 부호가 붙을 수 있는 리터럴 토큰 하나(주석·줄바꿈 없음)
export function isLiteralSpanText(text: string): boolean {
  void text
  throw new Error('not implemented')
}

// 사용자 입력 → 그 형식의 정규 리터럴(받을 수 없으면 null). JS 숫자를 거치지 않는다(범위 확인 제외).
export function formatTunableLiteral(type: TunableValueType, input: string): string | null {
  void type
  void input
  throw new Error('not implemented')
}

// 리터럴 → 입력칸에 보일 글자(형식 접미사 L·f 없이, 문자열은 풀어서)
export function displayTunableLiteral(type: TunableValueType, literal: string): string {
  void type
  void literal
  throw new Error('not implemented')
}

// 비교용 정규화('- 1'과 '-1'은 같다)
export function normalizeLiteral(text: string): string {
  void text
  throw new Error('not implemented')
}
