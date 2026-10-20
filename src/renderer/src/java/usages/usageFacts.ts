// 계약 자리(구현은 사용처 핵심 작업이 채운다). spec §4 Facts, §6.2.
// 파일 하나의 씬과 관계없는 사실. 워커 안에만 있고, 파일 글자를 잘라 두지 않는다(intern으로 복사).

// 핵심 작업이 spec §4의 모양(pkg, imports, classes, chains, typeUses, strings, lookupRefs …)으로 채운다.
// 워커는 skipped만 본다.
export type FileFacts = {
  skipped?: 'unicodeEscape' | 'capped'
}

// Java 소스 → 사실. 예외를 던지지 않는다. 리터럴 밖 \u가 있으면 { skipped: 'unicodeEscape' }만.
export function extractFacts(text: string): FileFacts {
  void text
  throw new Error('extractFacts: not implemented')
}
