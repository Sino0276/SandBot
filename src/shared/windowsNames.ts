// Windows 장치 이름. 이 이름의 파일·폴더는 확장자가 붙어도(AUX.java) 디스크 파일이 아니라 장치를 가리킨다
// (Windows 10 이하). 쓰기가 실패하거나 javac가 .class를 쓰지 못하고, CON을 읽으면 멈출 수 있다.
// 생성 파일 경로(generatedFiles.ts)와 연결 스크립트 경로(teamCodePaths.ts)가 함께 쓴다.

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '¹', '²', '³']

export const WINDOWS_RESERVED_NAMES: readonly string[] = [
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...DIGITS.map((digit) => `COM${digit}`),
  ...DIGITS.map((digit) => `LPT${digit}`),
  'CONIN$',
  'CONOUT$'
]

const RESERVED = new Set(WINDOWS_RESERVED_NAMES)

// 파일·폴더 이름 하나(경로 구분자 없음). 첫 점 앞부분이 예약 이름이면 장치다(대소문자 무시).
// Windows는 이름 끝의 공백·점을 지우므로 'CON .txt'도 장치다.
export function isWindowsReservedName(name: string): boolean {
  const stem = name.split('.')[0].replace(/[ .]+$/, '')
  return RESERVED.has(stem.toUpperCase())
}
