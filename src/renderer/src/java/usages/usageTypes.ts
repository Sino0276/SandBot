// 사용처(4단계)의 공용 타입: 스토어(java/usageIndex.ts)·워커(usageWorker.ts)·화면(editor/usages/)이 같이 쓴다.
// Android Studio의 Find Usages처럼 생성 하드웨어 클래스의 필드·상수·형식을 javac가 묶는 곳(코드)과, 장치를 구성
// 이름으로 찾는 문자열(이름으로)을 TeamCode에서 찾는다. 설계는 scratchpad의 p4design/spec.md를 따른다.
// 키 도우미 밖의 논리는 두지 않는다.

// 사용처를 모으는 대상. 이름을 바꿔도 그대로인 id로 짓는다.
// - d:<objectId>\n<componentId>: 장치(codeScopes의 deviceKey와 같은 쌍)
// - g:<groupId>: 메커니즘 그룹(클래스가 있는 것)
// - r:<robotId>: 로봇 하드웨어 클래스
// - '*': 생성 패키지에 없는 형식(모든 로봇 카드에 보인다)
export type UsageKey = string

export const deviceUsageKey = (objectId: string, componentId: string): UsageKey =>
  `d:${objectId}\n${componentId}`
export const groupUsageKey = (groupId: string): UsageKey => `g:${groupId}`
export const robotUsageKey = (robotId: string): UsageKey => `r:${robotId}`
export const MISSING_GENERATED_TYPE: UsageKey = '*'

// 키가 가리키는 오브젝트 id(장치는 오브젝트, 그룹·로봇은 그 오브젝트). '*'는 null.
export function usageKeyObjectId(key: UsageKey): string | null {
  if (key.startsWith('d:')) {
    const end = key.indexOf('\n')
    return end < 0 ? null : key.slice(2, end)
  }
  if (key.startsWith('g:') || key.startsWith('r:')) return key.slice(2)
  return null
}

// 워커가 보는 생성 클래스 트리(구조화 복제할 수 있는 평범한 데이터). codeScopes의 결과에서만 만든다.
export type SymbolClass = {
  // r: 또는 g:
  key: UsageKey
  // 단순 클래스 이름(scope.className)
  name: string
  // 장치 필드는 group null, 그룹 필드는 그 그룹의 클래스
  fields: { name: string; key: UsageKey; group: SymbolClass | null }[]
  // 장치 상수. 로봇 클래스는 CONFIGURATION_NAME → r:도 있다.
  constants: { name: string; key: UsageKey }[]
}

export type UsageSymbols = {
  // 카탈로그 컴포넌트가 하나 이상이고 쓸 수 있는 클래스 이름의 로봇(하이어라키 순서)
  robots: SymbolClass[]
  // 클래스 이름이 잘못됐거나 겹치는 로봇(코드 사용처를 찾을 수 없다. 이름으로 찾기는 한다)
  unavailable: {
    key: UsageKey
    className: string
    reason: 'invalidClassName' | 'duplicateClassName'
  }[]
  // 앞뒤 공백을 뺀 구성 이름 → 장치 키들(unavailable 로봇 포함, 모든 로봇)
  lookupNames: { name: string; keys: UsageKey[] }[]
  // 위 세 칸의 JSON(하이어라키 순서라 결정적). 같으면 다시 맞출 필요가 없다.
  signature: string
}

// field: 장치·그룹 필드, constant: 상수, type: 형식 이름(선언·캐스트·extends 등), new: 생성(new T(…)),
// lookup: 구성 이름으로 찾는 문자열, text: 같은 글자의 다른 문자열(세지 않음), unresolved: 생성 코드에 없는 이름
export type UsageKind = 'field' | 'constant' | 'type' | 'new' | 'lookup' | 'text' | 'unresolved'

export type UsageHit = {
  // TeamCode 기준 경로(목록의 것)
  path: string
  // 1부터. 사용처 토큰(연쇄의 마지막 생성 멤버, 마지막 형식 이름, 문자열 리터럴)의 줄·열(UTF-16)
  line: number
  col: number
  kind: UsageKind
  // 보일 글자(예: 'lift.liftLeft.setPower(…)', 'hardwareMap.get(…, "liftLeft")'), 96자 이하
  snippet: string
  // snippet 안에서 맞은 토큰의 [시작, 끝) 오프셋
  mark: [number, number]
  // unresolved: 없는 멤버·형식 이름
  member?: string
}

export type UsageCounts = Record<UsageKind, number>

export type UsageResult = {
  // (path, line, col) 순서. 키마다 MAX_HITS_PER_KEY개까지
  hits: Map<UsageKey, UsageHit[]>
  // 한도로 자르기 전의 개수
  totals: Map<UsageKey, UsageCounts>
  // 찾지 못한 멤버가 있던 범위의 키(r:·g:), 또는 '*'
  unresolved: Map<UsageKey, UsageHit[]>
  // 어느 장치에도 없는 찾기 이름(앞뒤 공백 뺀 글자) → 찾기 사용처
  unknownNames: Map<string, UsageHit[]>
  // scanned: 사실을 만든 파일 수. tooLarge는 너무 커서 읽지 않은 파일(워커)과 사실 한도를 넘은 파일(capped,
  // 맞추기)이다. failed는 워커가 읽기 결과로, unicodeEscape는 맞추기가 사실(skipped)로 채운다.
  files: { scanned: number; tooLarge: string[]; unicodeEscape: string[]; failed: string[] }
}

// 키마다 남기는 사용처 수(인스펙터의 한도)
export const MAX_HITS_PER_KEY = 200
// 구성에 없는 이름의 수와 이름마다 남기는 사용처 수
export const MAX_UNKNOWN_NAMES = 200
export const MAX_HITS_PER_UNKNOWN_NAME = 50

// 렌더러 → 워커. files는 stamp('size:mtimeMs')와 글자(tooLarge·failed는 글자 없이 problem)를 넘기고,
// removes는 목록에서 빠진 경로다. match는 지금 씬의 기호로 맞춘다(seq가 결과에 돌아온다).
export type ToWorker =
  | {
      type: 'files'
      batch: number
      upserts: {
        path: string
        stamp: string
        text: string | null
        problem?: 'tooLarge' | 'failed'
      }[]
      removes: string[]
    }
  | { type: 'match'; seq: number; symbols: UsageSymbols }

export type FromWorker =
  | { type: 'filesDone'; batch: number }
  | { type: 'result'; seq: number; result: UsageResult }
  | { type: 'error'; detail: string }
