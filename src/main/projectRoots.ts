import { resolve } from 'path'

// 이 앱에서 열거나 저장한 프로젝트 폴더. 렌더러가 넘기는 root를 그대로 믿지 않고, 사용자 Java 파일을 다루는
// IPC(목록·외부 편집기로 열기)와 생성 파일 쓰기는 여기 있는 폴더만 받는다(렌더러가 잘못돼도 다른 폴더를 못 건드리게 하는
// 이중 방어). 앱이 실행되는 동안만 기억한다.
const trustedRoots = new Set<string>()

export function trustRoot(root: string): void {
  trustedRoots.add(resolve(root))
}

export function isTrustedRoot(root: unknown): root is string {
  return typeof root === 'string' && root !== '' && trustedRoots.has(resolve(root))
}

// 테스트용
export function clearTrustedRoots(): void {
  trustedRoots.clear()
}
