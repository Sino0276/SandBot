// 계약 자리(구현은 사용처 핵심 작업이 채운다). spec §6.3–6.5.
import type { FileFacts } from './usageFacts'
import type { UsageResult, UsageSymbols } from './usageTypes'

// 파일마다의 사실(경로 → 사실)과 씬 기호표 → 사용처. 순수 함수이고 결정적이다(같은 입력이면 같은 결과).
// files.tooLarge·failed는 빈 배열로 돌려준다(워커가 읽기 결과로 채운다). unicodeEscape는 skipped 사실의 경로다.
export function resolveUsages(
  files: ReadonlyMap<string, FileFacts>,
  symbols: UsageSymbols
): UsageResult {
  void files
  void symbols
  throw new Error('resolveUsages: not implemented')
}
