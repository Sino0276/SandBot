import { BIOBUZZ_FIELD } from './biobuzz'
import type { FieldSpec, SeasonId } from './fieldSpec'
import { NONE_FIELD } from './none'

// 시즌 고르기(spec-4ab §1.3). 시즌 데이터는 이 폴더 한곳이고, 프로젝트 파일은 시즌 id 문자열만 둔다(모르는 값은 보존한다).

// UI 순서(새 시즌이 앞)
export const SEASON_IDS: readonly SeasonId[] = Object.freeze(['biobuzz', 'none'])

// 새 씬·앱 시작·v9 이하 프로젝트의 시즌(synthesis §2.8·§9.8). 세계 설명 시험 고정값의 기본은 이것이 아니라 'none'이다
// ('none'은 3c와 바이트까지 같다).
export const DEFAULT_PROJECT_SEASON: SeasonId = 'biobuzz'

const SEASONS: Record<SeasonId, FieldSpec> = { biobuzz: BIOBUZZ_FIELD, none: NONE_FIELD }

export function isSeasonId(value: unknown): value is SeasonId {
  return typeof value === 'string' && (SEASON_IDS as readonly string[]).includes(value)
}

// 깊게 얼린 모듈 상수(같은 id는 같은 객체). 바꾼 판이 필요하면 얕은 복사를 쓴다
export function resolveSeason(id: SeasonId): FieldSpec {
  return SEASONS[id]
}
