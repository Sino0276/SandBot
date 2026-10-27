import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { PlayStackFrame } from '../../../../shared/play'
import { displayJavaPath } from '../../java/javaIndex'
import { openScriptFile, useLineSupportStore } from '../../java/openScript'
import { useProjectStore } from '../../project/projectStore'
import {
  consoleCounts,
  entryDetailLines,
  entryInProject,
  entrySummary,
  entryTarget,
  formatCount,
  frameText,
  visibleEntries,
  type ConsoleEntry
} from '../consoleModel'
import { formatVirtualTime } from '../playFormat'
import { browserStorage, type ConsoleLevel } from '../playSettings'
import { usePlayStore } from '../playStore'
import { LevelIcon } from './PlayIcons'

const LEVELS: readonly ConsoleLevel[] = ['info', 'warning', 'error']
const DETAIL_LAYOUT_ID = 'play-console'
// 목록이 맨 아래에서 이만큼(px) 안이면 새 항목이 올 때 따라 내려간다(Unity Console과 같음)
const STICK_PX = 8
const PAGE = 10

// 지금 프로젝트의 항목만 연다(다른 프로젝트를 연 뒤 남은 항목은 열 곳이 없다)
const openTarget = (entry: ConsoleEntry): void => {
  const target = entryTarget(entry, useProjectStore.getState().root)
  if (target) void openScriptFile(target.path, target.line)
}

type RowProps = {
  entry: ConsoleEntry
  index: number
  selected: boolean
  t: TFunction
  openHint: string
  root: string | null
}

// 행 하나. 항목은 바뀌지 않으므로(새 항목만 붙는다) 같은 항목은 다시 그리지 않는다.
const ConsoleRow = memo(function ConsoleRow({
  entry,
  index,
  selected,
  t,
  openHint,
  root
}: RowProps): React.JSX.Element {
  const target = entryTarget(entry, root)
  return (
    <div
      id={`console-entry-${entry.id}`}
      role="option"
      aria-selected={selected}
      data-console-index={index}
      className={[
        'console-row',
        `is-${entry.level}`,
        selected && 'is-selected',
        index % 2 === 1 && 'is-odd'
      ]
        .filter(Boolean)
        .join(' ')}
      title={target ? `${displayJavaPath(target.path)}:${target.line}\n${openHint}` : undefined}
    >
      <LevelIcon level={entry.level} />
      <span className="console-time">
        {entry.tNanos === null ? '' : formatVirtualTime(entry.tNanos)}
      </span>
      <span className="console-summary">{entrySummary(entry, t)}</span>
    </div>
  )
})

function FrameLine({
  frame,
  openHint,
  openable
}: {
  frame: PlayStackFrame
  openHint: string
  openable: boolean
}): React.JSX.Element {
  const text = frameText(frame)
  if (!frame.path || !openable) return <div className="console-frame">{text}</div>
  const path = frame.path
  return (
    <div className="console-frame">
      <button
        type="button"
        className="console-frame-link"
        title={`${displayJavaPath(path)}:${frame.line}\n${openHint}`}
        onClick={() => void openScriptFile(path, Math.max(1, frame.line))}
      >
        {text}
      </button>
    </div>
  )
}

// 고른 항목의 전체 글자. 오류 스택의 팀 코드 줄은 누르면 외부 편집기로 그 줄을 연다(Unity Console의 링크).
function ConsoleDetail({ entry }: { entry: ConsoleEntry | null }): React.JSX.Element {
  const { t } = useTranslation()
  const lineSupport = useLineSupportStore((state) => state.support)
  const root = useProjectStore((state) => state.root)
  if (!entry) return <p className="console-detail-empty">{t('console.noSelection')}</p>
  const openHint =
    lineSupport === 'no'
      ? `${t('console.openLink')}\n${t('usages.noLineHint')}`
      : t('console.openLink')
  const target = entryTarget(entry, root)
  const openable = entryInProject(entry, root)
  return (
    <div className="console-detail-text">
      {entryDetailLines(entry, t).map((line, index) => (
        <div key={index} className="console-detail-line">
          {line}
        </div>
      ))}
      {entry.type === 'error' &&
        entry.stack.map((frame, index) => (
          <FrameLine key={index} frame={frame} openHint={openHint} openable={openable} />
        ))}
      {entry.type === 'diagnostic' && target && (
        <div className="console-frame">
          <button
            type="button"
            className="console-frame-link"
            title={openHint}
            onClick={() => openTarget(entry)}
          >
            {`${displayJavaPath(target.path)}:${target.line}`}
          </button>
        </div>
      )}
    </div>
  )
}

// Console(Unity Console): 머리줄(지우기, 실행할 때 지우기, 검색, 로그·경고·오류 개수 토글), 항목 목록, 고른 항목의 전체.
// 목록은 하나의 탭 멈춤(role="listbox", aria-activedescendant)이고 위/아래·Home/End·PageUp/PageDown으로 고르며,
// 더블클릭·Enter로 컴파일 진단·오류의 팀 코드 줄을 외부 스크립트 편집기로 연다.
function ConsoleView(): React.JSX.Element {
  const { t } = useTranslation()
  const entries = usePlayStore((state) => state.entries)
  const selectedId = usePlayStore((state) => state.selectedEntryId)
  const query = usePlayStore((state) => state.consoleQuery)
  const prefs = usePlayStore((state) => state.consolePrefs)
  const { clearConsole, selectEntry, setConsoleQuery, toggleLevel, setClearOnPlay } =
    usePlayStore.getState()
  const lineSupport = useLineSupportStore((state) => state.support)
  const root = useProjectStore((state) => state.root)
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const storage = useMemo(() => browserStorage() ?? undefined, [])
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: DETAIL_LAYOUT_ID, storage })

  const counts = useMemo(() => consoleCounts(entries), [entries])
  const shown = useMemo(
    () => visibleEntries(entries, prefs.show, query, t),
    [entries, prefs.show, query, t]
  )
  const selectedIndex = shown.findIndex((entry) => entry.id === selectedId)
  const selected = selectedIndex >= 0 ? shown[selectedIndex] : null
  const openHint =
    lineSupport === 'no'
      ? `${t('console.openHint')}\n${t('usages.noLineHint')}`
      : t('console.openHint')

  // 맨 아래를 보고 있었으면 새 항목을 따라 내려간다
  useLayoutEffect(() => {
    const list = listRef.current
    if (list && stickRef.current) list.scrollTop = list.scrollHeight
  }, [shown])

  const scrollToIndex = (index: number): void => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-console-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const selectIndex = (index: number): void => {
    if (shown.length === 0) return
    const clamped = Math.max(0, Math.min(shown.length - 1, index))
    selectEntry(shown[clamped].id)
    // 그리고 나서 보이게 한다
    requestAnimationFrame(() => scrollToIndex(clamped))
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const current = selectedIndex
    switch (event.key) {
      case 'ArrowDown':
        selectIndex(current < 0 ? 0 : current + 1)
        break
      case 'ArrowUp':
        selectIndex(current < 0 ? shown.length - 1 : current - 1)
        break
      case 'PageDown':
        selectIndex(current + PAGE)
        break
      case 'PageUp':
        selectIndex(current - PAGE)
        break
      case 'Home':
        selectIndex(0)
        break
      case 'End':
        selectIndex(shown.length - 1)
        break
      case 'Enter':
        if (selected && !event.repeat) openTarget(selected)
        break
      case 'Escape':
        if (selectedId === null) return
        selectEntry(null)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const rowOf = (target: EventTarget | null): ConsoleEntry | null => {
    const element =
      target instanceof Element ? target.closest<HTMLElement>('[data-console-index]') : null
    return element ? (shown[Number(element.dataset.consoleIndex)] ?? null) : null
  }

  return (
    <div className="console">
      <div className="console-toolbar">
        {/* Unity처럼 늘 누를 수 있다(눌러서 꺼지면 포커스가 <body>로 떨어진다) */}
        <button type="button" className="panel-button" onClick={clearConsole}>
          {t('console.clear')}
        </button>
        <label className="console-check" title={t('console.clearOnPlayHint')}>
          <input
            type="checkbox"
            checked={prefs.clearOnPlay}
            onChange={(event) => setClearOnPlay(event.target.checked)}
          />
          {t('console.clearOnPlay')}
        </label>
        <input
          type="search"
          className="text-field console-search"
          aria-label={t('console.search')}
          placeholder={t('console.search')}
          spellCheck={false}
          value={query}
          onChange={(event) => setConsoleQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault()
              setConsoleQuery('')
            }
          }}
        />
        <div className="console-levels" role="group" aria-label={t('console.levels')}>
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={prefs.show[level] ? 'console-level is-on' : 'console-level'}
              aria-pressed={prefs.show[level]}
              title={t(`console.levelToggle.${level}`, { count: counts[level] })}
              onClick={() => toggleLevel(level)}
            >
              <LevelIcon level={level} />
              <span>{formatCount(counts[level])}</span>
            </button>
          ))}
        </div>
      </div>
      <Group
        id={DETAIL_LAYOUT_ID}
        className="console-split"
        orientation="vertical"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <Panel id="console-list" minSize={48}>
          <div
            ref={listRef}
            className="console-list"
            role="listbox"
            tabIndex={0}
            aria-label={t('console.list')}
            aria-activedescendant={selected ? `console-entry-${selected.id}` : undefined}
            onKeyDown={onKeyDown}
            onScroll={(event) => {
              const list = event.currentTarget
              stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_PX
            }}
            onMouseDown={(event) => {
              const entry = rowOf(event.target)
              if (entry) selectEntry(entry.id)
            }}
            onDoubleClick={(event) => {
              const entry = rowOf(event.target)
              if (entry) openTarget(entry)
            }}
          >
            {shown.length === 0 && (
              <p className="console-empty">
                {entries.length === 0 ? t('console.empty') : t('console.noMatch')}
              </p>
            )}
            {shown.map((entry, index) => (
              <ConsoleRow
                key={entry.id}
                entry={entry}
                index={index}
                selected={entry.id === selectedId}
                t={t}
                openHint={openHint}
                root={root}
              />
            ))}
          </div>
        </Panel>
        <Separator className="panel-separator panel-separator--row" />
        <Panel id="console-detail" defaultSize="30%" minSize={36}>
          <div className="console-detail" aria-live="off">
            <ConsoleDetail entry={selected} />
          </div>
        </Panel>
      </Group>
    </div>
  )
}

export default ConsoleView
