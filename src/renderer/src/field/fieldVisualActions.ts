// Field 인스펙터 "필드 CAD (보기용)" 구역의 동작과 열기의 읽기(spec-4e §3.3). 모두 시작할 때 projectStore.session을 잡고
// await 뒤마다 다르면 아무것도 하지 않는다. 계약 단계(spec-4e §6)는 빈 함수다. 구현은 갈래 A다.

// [필드 CAD 불러오기…]
export async function importFieldVisual(): Promise<void> {
  // 갈래 A가 구현한다(spec-4e §3.3)
}

// [다시 불러오기]
export async function reloadFieldVisual(): Promise<void> {
  // 갈래 A가 구현한다(spec-4e §3.3)
}

// [파일 다시 찾기]
export async function relinkFieldVisual(): Promise<void> {
  // 갈래 A가 구현한다(spec-4e §3.3)
}

// [지우기]
export function clearFieldVisual(): void {
  // 갈래 A가 구현한다(spec-4e §3.3)
}

// 프로젝트 열기가 로봇 CAD를 읽은 뒤 부른다
export async function loadProjectFieldVisual(path: string, session: number): Promise<void> {
  void path
  void session
}
