import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { displayJavaPath } from '../../java/javaIndex'
import { openScriptFile, useLineSupportStore } from '../../java/openScript'
import type { UsageHit, UsageKind } from '../../java/usages/usageTypes'
import { focusDropped, focusMovedOut } from './focusRestore'
import {
  canExpand,
  FILE_GROUP_CAPS,
  fileGroups,
  groupsStartOpen,
  snippetWindow,
  usageFocusFallback,
  usageRowTarget,
  usageTreeKey,
  usageTreeRows,
  type UsageTreeRow
} from './usageView'

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const openHit = (hit: UsageHit): void => void openScriptFile(hit.path, hit.line)

// 행 요소의 행(data-usage-row는 rows 안의 순번)
function rowOf(
  rows: readonly UsageTreeRow[],
  target: EventTarget | null
): UsageTreeRow | undefined {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-usage-row]') : null
  return element ? rows[Number(element.dataset.usageRow)] : undefined
}

function focusRow(tree: HTMLElement | null, rows: readonly UsageTreeRow[], id: string): void {
  const index = rows.findIndex((row) => row.id === id)
  tree?.querySelector<HTMLElement>(`[data-usage-row="${index}"]`)?.focus()
}

// 코드 조각: 맞은 토큰을 <mark>로, 앞이 길면 …로 줄인다(뒤는 CSS 말줄임). 코드는 ltr로 격리한다(rtl 글자가 섞여도
// 순서가 그대로다).
function Snippet({ hit }: { hit: UsageHit }): React.JSX.Element {
  const parts = snippetWindow(hit.snippet, hit.mark)
  return (
    <code className="usage-code">
      <bdi dir="ltr">
        {parts.lead && '…'}
        {parts.before}
        <mark className="usage-mark">{parts.mark}</mark>
        {parts.after}
      </bdi>
    </code>
  )
}

type UsageTreeProps = {
  // 트리 이름(usages.listLabel)
  label: string
  // 트리 설명(부분 제목의 id)
  describedBy?: string
  hits: UsageHit[]
  // 결과 한도로 뒤가 잘렸을 수 있는 파일(머리줄 개수를 'N+'로)
  cut: readonly string[]
  // 결과 한도로 자른 파일의 자르기 전 개수
  fileCounts?: ReadonlyMap<string, number>
  // 이 종류와 다른 행에만 배지를 단다
  defaultKind: UsageKind
}

// 파일별로 묶은 사용처 트리(role="tree"). 한 번 누르면 행에 포커스만 주고, 더블클릭·Enter로 외부 스크립트 편집기에서
// 그 줄을 연다(Unity Console·튜닝 값 이름과 같음. 잘못 누른 한 번에 느린 Android Studio가 뜨지 않게). 파일 행은
// 첫 사용처를 연다. 탭 멈춤은 하나(roving tabIndex)이고 위/아래·왼쪽/오른쪽·Home/End로 움직인다.
// 포커스는 키·클릭 처리기에서 바로 옮긴다. effect는 다시 찾아 포커스한 행이 사라졌을 때만 옆 행으로 되돌린다
// (focusRestore.ts, StrictMode의 정리→재실행에도 그대로다).
function UsageTree({
  label,
  describedBy,
  hits,
  cut,
  fileCounts,
  defaultKind
}: UsageTreeProps): React.JSX.Element {
  const { t } = useTranslation()
  const lineSupport = useLineSupportStore((state) => state.support)
  const treeRef = useRef<HTMLDivElement>(null)
  // 사용자가 펼치거나 접은 파일(경로 → 펼침). 나머지는 행 수로 정한다(20개 이하면 펼쳐서 시작).
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({})
  // 마지막으로 포커스한 행(탭 멈춤)
  const [currentId, setCurrentId] = useState<string | null>(null)
  // 포커스가 있는 행(사용자가 트리 밖으로 옮기면 null). 그 행이 지워지면 이 행 자리로 되돌린다.
  const focusedRef = useRef<UsageTreeRow | null>(null)

  const groups = useMemo(
    () => fileGroups(hits, FILE_GROUP_CAPS, cut, fileCounts),
    [hits, cut, fileCounts]
  )
  const startOpen = groupsStartOpen(hits.length)
  const rows = useMemo(
    () => usageTreeRows(groups, (path) => overrides[path] ?? startOpen),
    [groups, overrides, startOpen]
  )

  useLayoutEffect(() => {
    const tree = treeRef.current
    const lost = focusedRef.current
    if (!tree || !lost) return
    // 같은 id의 행이 남아 포커스도 그대로다: 그 행의 지금 자리(파일 순번 등)를 기억한다
    const active = document.activeElement
    if (active && tree.contains(active)) {
      focusedRef.current = rowOf(rows, active) ?? lost
      return
    }
    if (!focusDropped()) return
    const id = usageFocusFallback(rows, lost)
    if (id !== null) focusRow(tree, rows, id)
  }, [rows])

  // 포커스했던 행이 사라졌으면(결과가 바뀜, 접음) 첫 행이 탭 멈춤이다
  const tabStopId = rows.some((row) => row.id === currentId) ? currentId : (rows[0]?.id ?? null)
  const openHint =
    lineSupport === 'no'
      ? `${t('usages.openHint')}\n${t('usages.noLineHint')}`
      : t('usages.openHint')

  const setOpen = (path: string, value: boolean): void =>
    setOverrides((current) => ({ ...current, [path]: value }))

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const row = rowOf(rows, event.target)
    const action = usageTreeKey(rows, row?.id ?? tabStopId, event.key)
    if (!action) return
    event.preventDefault()
    event.stopPropagation()
    switch (action.type) {
      case 'focus':
        focusRow(treeRef.current, rows, action.id)
        return
      case 'setOpen':
        setOpen(action.path, action.open)
        return
      case 'open':
        if (!event.repeat) openHit(action.hit)
        return
    }
  }

  return (
    <div
      ref={treeRef}
      className="usage-tree"
      role="tree"
      aria-label={label}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const row = rowOf(rows, event.target)
        focusedRef.current = row ?? null
        if (row && row.id !== currentId) setCurrentId(row.id)
      }}
      onBlur={(event) => {
        if (focusMovedOut(event)) focusedRef.current = null
      }}
      onDoubleClick={(event) => {
        const row = rowOf(rows, event.target)
        if (row) openHit(usageRowTarget(row))
      }}
    >
      {rows.map((row, index) => {
        const tabIndex = row.id === tabStopId ? 0 : -1
        if (row.type === 'file') {
          const { group } = row
          const display = displayJavaPath(group.path)
          const expandable = canExpand(group)
          return (
            <div
              key={row.id}
              role="treeitem"
              aria-level={1}
              aria-posinset={row.posInSet}
              aria-setsize={groups.length}
              aria-expanded={expandable ? row.open : undefined}
              aria-label={t(group.atLeast ? 'usages.fileLabelAtLeast' : 'usages.fileLabel', {
                file: display,
                count: group.count
              })}
              tabIndex={tabIndex}
              data-usage-row={index}
              className="usage-row usage-file-row"
              title={`${group.path}\n${openHint}`}
            >
              <span
                className="usage-twisty"
                aria-hidden="true"
                // 누르면 접고 펴기만 한다(포커스는 파일 행으로, 더블클릭이 파일을 열지 않게)
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!expandable) return
                  setOpen(group.path, !row.open)
                  focusRow(treeRef.current, rows, row.id)
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {expandable ? (row.open ? '▾' : '▸') : ''}
              </span>
              {/* 긴 경로는 앞쪽을 줄여 끝의 파일 이름이 보이게 한다(rtl). 경로는 ltr로 격리한다. */}
              <span className="usage-file-path">
                <bdi dir="ltr">{display}</bdi>
              </span>
              <span className="usage-file-count">
                {group.atLeast ? t('usages.fileCountAtLeast', { count: group.count }) : group.count}
              </span>
            </div>
          )
        }
        const { hit } = row
        const kind = t(`usages.kinds.${hit.kind}`)
        // 파일의 마지막으로 그린 줄 뒤에 그리지 않은 줄 수를 붙인다(파일 행 이름에 전체 수가 있어 읽지 않게 숨긴다)
        const more = row.posInSet === row.setSize ? groups[row.groupIndex].more : 0
        return (
          <Fragment key={row.id}>
            <div
              role="treeitem"
              aria-level={2}
              aria-posinset={row.posInSet}
              aria-setsize={row.setSize}
              aria-label={t('usages.rowLabel', {
                file: fileNameOf(hit.path),
                line: hit.line,
                kind,
                code: hit.snippet
              })}
              tabIndex={tabIndex}
              data-usage-row={index}
              className="usage-row usage-line-row"
              title={openHint}
            >
              <span className="usage-line">{hit.line}</span>
              {hit.kind !== defaultKind && <span className="usage-badge">{kind}</span>}
              <Snippet hit={hit} />
            </div>
            {more > 0 && (
              <div className="usage-more usage-file-more" aria-hidden="true">
                {t('usages.more', { count: more })}
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

export default UsageTree
