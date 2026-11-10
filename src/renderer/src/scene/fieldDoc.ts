import type { SeasonId } from '../../../shared/sim/seasons/fieldSpec'
import { DEFAULT_PROJECT_SEASON, isSeasonId } from '../../../shared/sim/seasons/seasons'
import {
  ALIGNMENT_PRESETS,
  AXIS_DIRECTIONS,
  isValidAlignment,
  type CadAlignment
} from '../cad/alignment'
import type { AxisDirection } from './model'

// 씬 문서의 필드 설정(spec-4ab §2.2). 프로젝트 설정이라 project.json(v10 field)·실행 취소·dirty에 들어간다. 시즌은 id
// 문자열이고 모르는 값(새 SandBot이 더한 시즌)도 모양이 맞으면 보존한다(표시·시뮬레이터는 'none'으로 처리한다).
// 4e부터 보기용 필드 CAD 설정(visual)도 든다. visual은 없을 때 키를 아예 두지 않는다(`visual: undefined`를 쓰지 않는다).
export type FieldDoc = { season: string; visual?: FieldVisual }

// 필드 CAD 보기(spec-4e §2.1). 로봇 CadSource와 같은 꼴: 파일 이름, 원본 절대 경로(열 때 상대 경로로 찾아 고친 값), 정렬.
// 보기 전용이라 시뮬레이터·센서·비전·시작 자세는 쓰지 않는다.
export type FieldVisual = {
  fileName: string
  absolutePath: string
  upAxis: AxisDirection
  forwardAxis: AxisDirection
}

// 필드 CAD의 기본 정렬: 공식 필드 CAD는 Y-up이고 FTC (X, Y, Z) = (CAD z, x, y)다(seasons/biobuzz.ts, spec-4e §1.3).
// 로봇 CAD의 마지막 방향 기억(sandbot:cadAlignment)은 쓰지 않는다.
export const DEFAULT_FIELD_VISUAL_ALIGNMENT: CadAlignment = ALIGNMENT_PRESETS.yUp

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

// ---- 필드 CAD 보기(spec-4e §2.1) ----

function isAxisDirection(value: unknown): value is AxisDirection {
  return typeof value === 'string' && (AXIS_DIRECTIONS as string[]).includes(value)
}

// 모양 검사: 파일 이름·절대 경로가 문자열이고 두 축이 축 방향이며 글자가 다르다(스토어·프로젝트 파일이 같이 쓴다)
export function isFieldVisual(value: unknown): value is FieldVisual {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.fileName === 'string' &&
    typeof v.absolutePath === 'string' &&
    isAxisDirection(v.upAxis) &&
    isAxisDirection(v.forwardAxis) &&
    isValidAlignment({ upAxis: v.upAxis, forwardAxis: v.forwardAxis })
  )
}

// 값 비교(네 칸). 둘 다 없으면 같다.
export function sameFieldVisual(a: FieldVisual | undefined, b: FieldVisual | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.fileName === b.fileName &&
    a.absolutePath === b.absolutePath &&
    a.upAxis === b.upAxis &&
    a.forwardAxis === b.forwardAxis
  )
}

// 시즌과 visual 네 칸을 값으로 비교한다(dirty)
export function sameFieldDoc(a: FieldDoc, b: FieldDoc): boolean {
  return a.season === b.season && sameFieldVisual(a.visual, b.visual)
}

// visual의 경로가 from이면 경로를 to, 이름을 fileName으로 바꾼 새 FieldDoc(정렬 그대로), 아니면 같은 객체다.
// 파일 다시 찾기가 실행 취소 기록 전체에 적용한다(다른 파일을 가리킨 옛 스냅샷은 그대로).
export function withFieldVisualFile(
  field: FieldDoc,
  from: string,
  to: string,
  fileName: string
): FieldDoc {
  const { visual } = field
  if (!visual || visual.absolutePath !== from) return field
  if (visual.absolutePath === to && visual.fileName === fileName) return field
  return { ...field, visual: { ...visual, absolutePath: to, fileName } }
}
