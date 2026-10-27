import type { ReactNode } from 'react'
import type { ConsoleLevel } from '../playSettings'

// 실행 툴바·Console의 작은 아이콘(ToolButtons처럼 currentColor SVG). 글자는 붙이지 않는다(버튼 이름은 aria-label).

export type PlayIconName = 'play' | 'stop' | 'pause' | 'step' | 'gamepad' | 'caret'

const PATHS: Record<PlayIconName, ReactNode> = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  step: (
    <>
      <path d="M5 5v14l10-7z" fill="currentColor" stroke="none" />
      <rect x="16" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  gamepad: (
    <path d="M7 8h10a4 4 0 0 1 4 4.5l-.6 3.6a2.2 2.2 0 0 1-3.9.9L15 15H9l-1.5 2a2.2 2.2 0 0 1-3.9-.9L3 12.5A4 4 0 0 1 7 8zM7.5 11v3M6 12.5h3M15.5 12h.01M17.5 13.5h.01" />
  ),
  caret: <path d="M7 10l5 5 5-5" />
}

export function PlayIcon({
  name,
  size = 14
}: {
  name: PlayIconName
  size?: number
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}

// Console 수준 아이콘(정보 i, 경고 !, 오류 ×). 색은 CSS(.console-icon.is-*)가 정한다.
export function LevelIcon({ level }: { level: ConsoleLevel }): React.JSX.Element {
  return (
    <svg
      className={`console-icon is-${level}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      {level === 'warning' ? (
        <>
          <path d="M8 1.8 15 14H1z" fill="currentColor" />
          <path d="M8 6v3.6M8 11.6v.4" stroke="#1e1f22" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" />
          {level === 'error' ? (
            <path
              d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"
              stroke="#1e1f22"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M8 7.2V11.4M8 4.6v.4"
              stroke="#1e1f22"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          )}
        </>
      )}
    </svg>
  )
}
