import { Fragment, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { displayJavaPath } from '../../java/javaIndex'
import { openScriptFile, useLineSupportStore } from '../../java/openScript'
import type { UsageHit, UsageKind } from '../../java/usages/usageTypes'
import {
  fileGroups,
  groupsStartOpen,
  snippetWindow,
  usageRowTarget,
  usageTreeKey,
  usageTreeRows,
  type UsageTreeRow
} from './usageView'

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const open = (hit: UsageHit | null): void => {
  if (hit) void openScriptFile(hit.path, hit.line)
}

// 코드 조각: 맞은 토큰을 <mark>로, 앞이 길면 …로 줄인다. 코드는 ltr로 격리한다(아랍어 등 rtl 이름이 섞여도 순서 유지).
function Snippet({ hit }: { hit: UsageHit }): React.JSX.Element {
  const window = snippetWindow(hit.snippet, hit.mark)
  return (
    <code className="usage-code">
      <bdi dir="ltr">
        {window.lead && '…'}
        {window.before}
        <mark className="usage-mark">{window.mark}</mark>
        {window.after}
      </bdi>
    </code>
  )
}

type UsageTreeProps = {
  // 트리 이름(usages.listLabel)
  label: string
  hits: UsageHit[]
  // 이 종류와 다른 행에만 배지를 단다
  defaultKind: UsageKind
}

// 파일별로 묶은 사용처 트리(role="tree"). 한 번 누르면 행을 고르기만 하고, 더블클릭·Enter로 외부 스크립트 편집기에서
// 그 줄을 연다(Unity Console·튜닝 값 이름과 같음). 탭 멈춤은 하나(roving tabIndex)이고 위/아래·왼쪽/오른쪽·Home/End로
// 움직인다. 포커스는 키를 누른 처리기에서 바로 옮긴다(effect를 쓰지 않아 StrictMode의 정리→재실행에도 그대로다).
function UsageTree({ label, hits, defaultKind }: UsageTreeProps): React.JSX.Element {
  const { t } = useTranslation()
  const lineSupport = useLineSupportStore((state) => state.support)
  const treeRef = useRef<HTMLDivElement>(null)
  // 사용자가 펼치거나 접은 파일(경로 → 펼침). 나머지는 행 수로 정한다.
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({})
  // 마지막으로 포커스한 행(탭 멈춤)
  const [currentId, setCurrentId] = useState<string | null>(null)

  const groups = useMemo(() => fileGroups(hits), [hits])
  const startOpen = groupsStartOpen(hits.length)
  const rows = useMemo(
    () => usageTreeRows(groups, (path) => overrides[path] ?? startOpen),
    [groups, overrides, startOpen]
  )
  const tabStopId = rows.some((row) => row.id === currentId) ? currentId : (rows[0]?.id ?? null)
  const openHint =
    lineSupport === 'no'
      ? `${t('usages.openHint')}\n${t('usages.noLineHint')}`
      : t('usages.openHint')

  const setOpen = (path: string, value: boolean): void =>
    setOverrides((current) => ({ ...current, [path]: value }))

  const rowOf = (target: EventTarget): UsageTreeRow | undefined => {
    const element = (target as HTMLElement).closest<HTMLElement>('[data-usage-row]')
    return element ? rows[Number(element.dataset.usageRow)] : undefined
  }

  const focusRow = (id: string): void => {
    const index = rows.findIndex((row) => row.id === id)
    treeRef.current?.querySelector<HTMLElement>(`[data-usage-row="${index}"]`)?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    const row = rowOf(event.target)
    const action = usageTreeKey(rows, row?.id ?? tabStopId, event.key)
    if (!action) return
    event.preventDefault()
    event.stopPropagation()
    switch (action.type) {
      case 'focus':
        focusRow(action.id)
        return
      case 'setOpen':
        setOpen(action.path, action.open)
        return
      case 'open':
        open(action.hit)
        return
    }
  }

  return (
    <div
      ref={treeRef}
      className="usage-tree"
      role="tree"
      aria-label={label}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const row = rowOf(event.target)
        if (row && row.id !== currentId) setCurrentId(row.id)
      }}
      onDoubleClick={(event) => {
        const row = rowOf(event.target)
        if (row) open(usageRowTarget(row))
      }}
    >
      {rows.map((row, index) => {
        const tabIndex = row.id === tabStopId ? 0 : -1
        if (row.type === 'file') {
          const { group } = row
          const display = displayJavaPath(group.path)
          return (
            <div
              key={row.id}
              role="treeitem"
              aria-level={1}
              aria-posinset={row.posInSet}
              aria-setsize={groups.length}
              aria-expanded={group.rows.length > 0 ? row.open : undefined}
              aria-label={t('usages.fileLabel', { file: display, count: group.count })}
              tabIndex={tabIndex}
              data-usage-row={index}
              className="usage-row usage-file-row"
              title={`${group.path}\n${openHint}`}
            >
              <span
                className="usage-twisty"
                aria-hidden="true"
                // 누르면 접고 펴기만 한다(포커스는 파일 행으로)
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (group.rows.length === 0) return
                  setOpen(group.path, !row.open)
                  focusRow(row.id)
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {group.rows.length === 0 ? '' : row.open ? '▾' : '▸'}
              </span>
              {/* 긴 경로는 앞쪽을 줄여 끝의 파일 이름이 보이게 한다(rtl), 경로는 ltr로 격리한다 */}
              <span className="usage-file-path">
                <bdi dir="ltr">{display}</bdi>
              </span>
              <span className="usage-file-count">{group.count}</span>
            </div>
          )
        }
        const { hit } = row
        const kind = t(`usages.kinds.${hit.kind}`)
        // 파일의 마지막으로 그린 줄 뒤에 그리지 않은 줄 수를 붙인다
        const more =
          row.posInSet === row.setSize ? groups[row.groupIndex].more : 0
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
              <div role="none" className="usage-more">
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
