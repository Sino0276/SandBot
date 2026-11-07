import type { SeasonId } from '../../../shared/sim/seasons/fieldSpec'
import { DEFAULT_PROJECT_SEASON, isSeasonId } from '../../../shared/sim/seasons/seasons'

// 씬 문서의 필드 설정(spec-4ab §2.2). 프로젝트 설정이라 project.json(v10 field)·실행 취소·dirty에 들어간다. 시즌은 id
// 문자열이고 모르는 값(새 SandBot이 더한 시즌)도 모양이 맞으면 보존한다(표시·시뮬레이터는 'none'으로 처리한다).
export type FieldDoc = { season: string }

// 새 씬·앱 시작의 필드(시즌 리터럴은 seasons.ts 한곳)
export const DEFAULT_FIELD_DOC: FieldDoc = Object.freeze({ season: DEFAULT_PROJECT_SEASON })

// 시즌 문자열 모양: 1–64자, 소문자로 시작하는 영숫자(프로젝트 파일 검사와 스토어가 같이 쓴다)
const SEASON_PATTERN = /^[a-z][A-Za-z0-9]*$/
const MAX_SEASON_LENGTH = 64

export function isSeasonString(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_SEASON_LENGTH && SEASON_PATTERN.test(value)
  )
}

// 알려진 시즌만(모르는 문자열은 null)
export function fieldSeasonId(doc: FieldDoc): SeasonId | null {
  return isSeasonId(doc.season) ? doc.season : null
}
