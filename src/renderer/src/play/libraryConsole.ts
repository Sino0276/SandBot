import type { LibraryReport, LibraryStatus } from '../../../shared/libraries'
import type { PlayLinkWarning } from '../../../shared/play'
import type { ConsoleBody, ConsoleLevel } from './consoleModel'

// 라이브러리 의존성 보고·링크 검사 → Console 항목(순수). 보고는 상태별 요약 한 줄(좌표가 있을 때), 컴파일 기준을 짐작했으면
// 경고, 불러오지 않았거나 받지 못한 좌표마다 경고 한 줄, SandBot 구현으로 실행하는 FTC Dashboard와 처음 받은 해시를 기록한
// 좌표는 정보(기록하지 못했으면 경고), Gradle 파일을 읽다 풀지 못한 것마다 경고. 링크 검사는 라이브러리별로 묶은 경고 한 줄
// (자세히 칸에 참조 하나씩).

export type ConsoleLine = { body: ConsoleBody; level: ConsoleLevel }

// 플랫폼 API 수준 글자(SDK Manager와 같게): android-30은 30, android-36.1은 36.1, android-37.0은 37.0
function platformApiText(platform: NonNullable<LibraryReport['platform']>): string {
  return platform.minor === null ? String(platform.api) : `${platform.api}.${platform.minor}`
}

export function libraryReportLines(report: LibraryReport): ConsoleLine[] {
  const lines: ConsoleLine[] = []
  if (report.entries.length > 0) {
    const counts: Record<LibraryStatus, number> = {
      used: 0,
      replaced: 0,
      provided: 0,
      unsupported: 0,
      failed: 0
    }
    for (const entry of report.entries) counts[entry.status]++
    const params = {
      count: report.entries.length,
      used: counts.used + counts.replaced,
      provided: counts.provided,
      unsupported: counts.unsupported,
      failed: counts.failed
    }
    lines.push({
      body:
        report.platform && !report.platform.guessed
          ? {
              type: 'notice',
              key: 'library.summaryPlatform',
              params: { ...params, api: platformApiText(report.platform) }
            }
          : { type: 'notice', key: 'library.summary', params },
      level: counts.failed > 0 || counts.unsupported > 0 ? 'warning' : 'info'
    })
  }
  if (report.platform?.guessed)
    lines.push({
      body: {
        type: 'notice',
        key: 'library.platformGuessed',
        params: { api: platformApiText(report.platform) }
      },
      level: 'warning'
    })
  for (const entry of report.entries) {
    const loaded = entry.status === 'used' || entry.status === 'replaced'
    if (entry.status === 'unsupported' || entry.status === 'failed')
      lines.push({ body: { type: 'library', library: entry }, level: 'warning' })
    else if (loaded && entry.integrity === 'firstUseUnrecorded')
      lines.push({ body: { type: 'library', library: entry }, level: 'warning' })
    else if (entry.status === 'replaced' || (loaded && entry.integrity === 'firstUse'))
      lines.push({ body: { type: 'library', library: entry }, level: 'info' })
  }
  for (const diagnostic of report.gradle)
    lines.push({ body: { type: 'gradle', diagnostic }, level: 'warning' })
  return lines
}

export function linkWarningLines(warnings: readonly PlayLinkWarning[]): ConsoleLine[] {
  const byLibrary = new Map<string, PlayLinkWarning[]>()
  for (const warning of warnings) {
    const list = byLibrary.get(warning.library)
    if (list) list.push(warning)
    else byLibrary.set(warning.library, [warning])
  }
  return [...byLibrary].map(([library, list]) => ({
    body: { type: 'linkWarnings', library, warnings: list },
    level: 'warning'
  }))
}

// 받은 바이트(진행 알림)
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
