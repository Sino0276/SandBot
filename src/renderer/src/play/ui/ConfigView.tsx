import type { TFunction } from 'i18next'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import type { DashConfigNode } from '../../../../shared/dashboard'
import { currentJavaSource, useJavaSourcesStore } from '../../java/javaSources'
import { tunableFieldLabel } from '../../java/tunableEdits'
import { useProjectStore } from '../../project/projectStore'
import { useSceneStore } from '../../scene/sceneStore'
import {
  applyConfigValue,
  ensureConfigSource,
  localConfigSource,
  syncConfigSourcesRun,
  useConfigSourcesStore
} from '../dashConfigApply'
import {
  checkApply,
  configInputValue,
  configRows,
  hasChangedValue,
  HARDWARE_CATEGORY,
  tunableTarget,
  type ApplyCheck,
  type ConfigRow
} from '../dashConfigModel'
import { canEditDashConfig, sendDashConfig } from '../playActions'
import { usePlayStore, type DashConfigState } from '../playStore'

// Config 탭(FTC Dashboard 설정 패널처럼): @Config 클래스와 addConfigVariable 변수의 트리. 묶음은 접고 펼치고, 값은
// 형식별 입력(boolean 체크, enum 선택, 수·글자 입력)으로 실행 중에 고친다(Enter·포커스 이동에 보냄). 실행이 아니면
// 읽기 전용이고, 마지막 트리는 다음 INIT까지 남는다. 실행 중 바꾼 값(시작 값과 다른 값)에는 [파일에 반영]을 둔다.

// 펼친 묶음(경로 키). 메모리에만 둔다(Dashboard처럼 처음에는 접혀 있다).
const useExpandedStore = create<{ expanded: Readonly<Record<string, boolean>> }>()(() => ({
  expanded: {}
}))

function toggleExpanded(key: string): void {
  useExpandedStore.setState((state) => ({
    expanded: { ...state.expanded, [key]: !state.expanded[key] }
  }))
}

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

// 수·글자 입력칸: 확정하지 않은 글자는 이 칸에만 있고(씬 문서의 초안이 아니다), Enter·포커스 이동에 보낸다. Esc는 취소.
// 형식에 맞지 않는 글자는 보내지 않고 테두리로 알린다(포커스를 잃으면 버린다).
function ValueInput({
  row,
  node,
  shown
}: {
  row: ConfigRow
  node: Extract<DashConfigNode, { kind: 'value' }>
  shown: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const invalid = draft !== null && configInputValue(node.type, draft, node.enumValues) === null
  const commit = (): void => {
    if (draft !== null && !cancelled.current && draft !== shown) {
      const value = configInputValue(node.type, draft, node.enumValues)
      if (value !== null) sendDashConfig(row.path, value)
    }
    cancelled.current = false
    setDraft(null)
  }
  return (
    <input
      type="text"
      className={invalid ? 'text-field config-input is-invalid' : 'text-field config-input'}
      aria-label={row.name}
      aria-invalid={invalid || undefined}
      title={invalid ? t('config.invalidHint') : undefined}
      spellCheck={false}
      value={draft ?? shown}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          cancelled.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function applyBlockText(
  check: Extract<ApplyCheck, { ok: false }>,
  target: { path: string; fieldId: string } | null,
  t: TFunction
): string {
  const params = {
    file: target ? fileNameOf(target.path) : '',
    field: target ? tunableFieldLabel(target.fieldId) : ''
  }
  const { block } = check
  if (typeof block === 'object')
    return t('config.applyBlocked.readOnly', {
      ...params,
      reason: t(`inspector.tunables.readOnly.${block.readOnly}`)
    })
  return t(`config.applyBlocked.${block}`, params)
}

// 실행 중 바꾼 값의 [파일에 반영]. 쓸 수 없으면 버튼을 막고 이유를 도움말로 보인다.
function ApplyButton({
  node
}: {
  node: Extract<DashConfigNode, { kind: 'value' }>
}): React.JSX.Element {
  const { t } = useTranslation()
  const target = useMemo(() => (node.source ? tunableTarget(node.source) : null), [node.source])
  const root = useProjectStore((state) => state.root)
  const session = useProjectStore((state) => state.session)
  const linked = useJavaSourcesStore((state) =>
    target ? currentJavaSource(state, { root, session }, target.path) : undefined
  )
  const local = useConfigSourcesStore((state) =>
    target ? localConfigSource(state, { root, session }, target.path) : undefined
  )
  const pending = useSceneStore((state) =>
    target ? state.tunables[target.path]?.[target.fieldId] : undefined
  )
  // 프로젝트를 열거나 저장하는 중에는 읽지 않으므로 끝나면 다시 해 본다
  const projectBusy = useProjectStore((state) => state.busy)
  const source = linked ?? local
  const check = checkApply(node, target, source, pending)
  const [applying, setApplying] = useState(false)
  useEffect(() => {
    if (target && !source && !projectBusy) ensureConfigSource(target.path)
  }, [target, source, projectBusy])

  if (!check.ok && check.block === 'applied')
    return (
      <span className="config-applied" title={applyBlockText(check, target, t)}>
        {t('config.applied')}
      </span>
    )
  const title = check.ok
    ? t('config.applyHint', {
        file: fileNameOf(check.path),
        field: tunableFieldLabel(check.fieldId)
      })
    : applyBlockText(check, target, t)
  return (
    <button
      type="button"
      className="panel-button config-apply"
      // 막힌 버튼에도 도움말이 보이게 aria-disabled로 둔다(disabled는 마우스를 올려도 title이 안 보일 수 있다)
      aria-disabled={!check.ok || applying}
      title={title}
      onClick={() => {
        if (!check.ok || applying) return
        setApplying(true)
        void applyConfigValue(node).finally(() => setApplying(false))
      }}
    >
      {t('config.apply')}
    </button>
  )
}

function ValueRow({
  row,
  node,
  config,
  editable
}: {
  row: ConfigRow
  node: Extract<DashConfigNode, { kind: 'value' }>
  config: DashConfigState
  editable: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const pending = config.pending[row.key]
  const shown = pending ?? node.value
  const start = config.baseline.get(row.key)
  const changed = start !== undefined && start !== node.value
  let control: React.JSX.Element
  switch (node.type) {
    case 'boolean':
      control = (
        <label className="hw-check">
          <input
            type="checkbox"
            aria-label={row.name}
            checked={shown === 'true'}
            disabled={!editable}
            onChange={(event) => sendDashConfig(row.path, event.target.checked ? 'true' : 'false')}
          />
        </label>
      )
      break
    case 'enum':
      control = (
        <select
          className="field-select config-input"
          aria-label={row.name}
          value={shown}
          disabled={!editable}
          onChange={(event) => sendDashConfig(row.path, event.target.value)}
        >
          {/* 지금 값이 상수 목록에 없으면(null 등) 그대로 보인다 */}
          {!node.enumValues.includes(shown) && <option value={shown}>{shown}</option>}
          {node.enumValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      )
      break
    case 'readonlyString':
      control = <code className="tunable-code config-value">{shown}</code>
      break
    default:
      control = editable ? (
        <ValueInput row={row} node={node} shown={shown} />
      ) : (
        <code className="tunable-code config-value">{shown}</code>
      )
  }
  return (
    <div className={changed ? 'config-row is-changed' : 'config-row'}>
      <span
        className="config-name"
        style={{ paddingLeft: `${row.depth * 14 + 18}px` }}
        title={node.type}
      >
        {row.name}
      </span>
      <span className="config-control">
        {control}
        {pending !== undefined && (
          <span className="config-sent" title={t('config.sentHint')}>
            ⋯
          </span>
        )}
        {changed && (
          <span className="config-start" title={t('config.startValueHint')}>
            {t('config.startValue', { value: start })}
          </span>
        )}
        {changed && <ApplyButton node={node} />}
      </span>
    </div>
  )
}

function GroupRow({
  row,
  config,
  expanded
}: {
  row: ConfigRow
  config: DashConfigState
  expanded: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const changed = useMemo(
    () => !expanded && hasChangedValue(row.node, row.path, config.baseline),
    [expanded, row, config.baseline]
  )
  const name = row.depth === 0 && row.name === HARDWARE_CATEGORY ? t('config.hardware') : row.name
  return (
    <div className="config-row is-group">
      <button
        type="button"
        aria-expanded={expanded}
        className="config-toggle"
        style={{ paddingLeft: `${row.depth * 14}px` }}
        aria-label={`${expanded ? t('config.collapse') : t('config.expand')}: ${name}`}
        onClick={() => toggleExpanded(row.key)}
      >
        <span className="config-caret" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="config-group-name">{name}</span>
        {changed && (
          <span className="config-changed-dot" title={t('config.changed')} aria-hidden="true">
            •
          </span>
        )}
      </button>
    </div>
  )
}

function ConfigView(): React.JSX.Element {
  const { t } = useTranslation()
  const run = usePlayStore((state) => state.run)
  const config = usePlayStore((state) => state.dashConfig)
  const editable = usePlayStore(canEditDashConfig)
  const expanded = useExpandedStore((state) => state.expanded)
  const runId = config?.runId ?? null
  // 실행마다 [파일에 반영]이 볼 파일을 새로 읽는다
  useEffect(() => {
    if (runId !== null) syncConfigSourcesRun(runId)
  }, [runId])
  const rows = useMemo(
    () => (config ? configRows(config.tree, (key) => expanded[key] === true) : []),
    [config, expanded]
  )

  if (!config) {
    const ran = run !== null && run.phase !== 'preparing' && run.phase !== 'compiling'
    return <p className="panel-empty">{ran ? t('config.empty') : t('config.noRun')}</p>
  }
  if (config.tree.kind !== 'custom' || config.tree.children.length === 0)
    return <p className="panel-empty">{t('config.empty')}</p>
  return (
    <div className="config">
      <p className="config-hint">{t('config.revertHint')}</p>
      {!editable && <p className="config-hint">{t('config.readOnlyHint')}</p>}
      <div className="config-tree" role="group" aria-label={t('config.tree')}>
        {rows.map((row) =>
          row.node.kind === 'custom' ? (
            <GroupRow
              key={row.key}
              row={row}
              config={config}
              expanded={expanded[row.key] === true}
            />
          ) : (
            <ValueRow key={row.key} row={row} node={row.node} config={config} editable={editable} />
          )
        )}
      </div>
    </div>
  )
}

export default ConfigView
