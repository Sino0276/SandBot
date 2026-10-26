import { useId, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useJavaIndexStore } from '../../java/javaIndex'
import { useUsageIndexStore } from '../../java/usageIndex'
import type { UsageResult } from '../../java/usages/usageTypes'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { focusDropped, focusMovedOut } from './focusRestore'
import { useUsageOpenStore } from './usageOpenStore'
import UsageTree from './UsageTree'
import {
  hasUsageSection,
  searchedTerms,
  unlistedCount,
  usageView,
  type UsageCardKind,
  type UsageSectionView,
  type UsageTarget,
  type UsageView
} from './usageView'

// 카드가 넘긴 대상을 원시 값에서 다시 만든다(카드는 렌더마다 새 객체를 넘기므로 useMemo는 id로 비교한다)
function targetOf(kind: UsageCardKind, id: string, componentId: string): UsageTarget {
  switch (kind) {
    case 'device':
      return { kind, objectId: id, componentId }
    case 'group':
      return { kind, groupId: id }
    case 'robot':
      return { kind, robotId: id }
  }
}

// 보기 모델. 기호표·범위를 만들다 던지면(코드 생성 쪽 버그) 인스펙터를 깨지 않고 결과가 없는 것처럼 둔다.
function safeView(
  objects: SceneObjects,
  result: UsageResult | null,
  baseline: SceneObjects | null,
  target: UsageTarget
): UsageView | null {
  if (!result) return null
  try {
    return usageView(objects, result, baseline, target)
  } catch (error) {
    console.error('사용처 보기를 만들지 못했다', error)
    return null
  }
}

function SectionTitle({
  id,
  section
}: {
  id: string
  section: UsageSectionView
}): React.JSX.Element {
  const { t } = useTranslation()
  const count = section.total
  let text: string
  let hint: string | undefined
  switch (section.id) {
    case 'renamedCode':
      text = t('usages.renamedCode', { old: section.old ?? '', count })
      break
    case 'renamedName':
      text = t('usages.renamedName', { old: section.old ?? '', count })
      break
    case 'unresolved':
      text = t('usages.unresolved', { count })
      hint = t('usages.unresolvedHint')
      break
    case 'unresolvedInClass':
      text = t('usages.unresolvedInClass', { count })
      hint = t('usages.unresolvedHint')
      break
    case 'constructs':
      text = t('usages.constructs')
      break
    case 'code':
      text = t('usages.sectionCode')
      break
    case 'byName':
      text = t('usages.sectionByName')
      hint = t('usages.byNameHint')
      break
    case 'sameText':
      text = t('usages.sameText', { count })
      hint = t('usages.sameTextHint')
      break
    case 'unknownNames':
      text = t('usages.unknownNames', { count })
      hint = t('usages.unknownNamesHint')
      break
  }
  return (
    <span id={id} className="usage-part-title" title={hint}>
      {section.tone === 'warning' && '⚠ '}
      {text}
      {hint && (
        <span className="usage-info" aria-hidden="true">
          {' ⓘ'}
        </span>
      )}
    </span>
  )
}

// 부분 하나: 제목과 파일별 트리. 접어 두는 부분(세지 않는 것)은 제목이 펼침 단추이고 처음에는 접혀 있다.
function Section({
  kind,
  section,
  view
}: {
  kind: UsageCardKind
  section: UsageSectionView
  view: UsageView
}): React.JSX.Element {
  const { t } = useTranslation()
  const partOpen = useUsageOpenStore((state) => state.parts[`${kind}:${section.id}`] ?? false)
  const setPartOpen = useUsageOpenStore((state) => state.setPartOpen)
  const titleId = useId()
  const bodyId = useId()
  // 결과의 한도(키마다 200개 등)로 받지 못한 행. 파일 묶음에 넣을 수 없어 부분 끝에 개수만 보인다. 파일별 개수를
  // 알면 행이 있는 파일의 나머지는 그 묶음의 '외 N곳'이 세므로, 행이 하나도 없는 파일의 것만 남는다.
  const beyond = unlistedCount(section)
  const body = (
    <>
      <UsageTree
        label={t('usages.listLabel', { name: view.name })}
        describedBy={titleId}
        hits={section.hits}
        cut={section.cut}
        fileCounts={section.fileCounts}
        defaultKind={section.defaultKind}
      />
      {beyond > 0 && <p className="usage-more">{t('usages.more', { count: beyond })}</p>}
    </>
  )

  if (section.tone === 'folded') {
    return (
      <div className="usage-part is-folded">
        <button
          type="button"
          className="usage-fold"
          aria-expanded={partOpen}
          aria-controls={partOpen ? bodyId : undefined}
          onClick={() => setPartOpen(kind, section.id, !partOpen)}
        >
          <span className="usage-twisty" aria-hidden="true">
            {partOpen ? '▾' : '▸'}
          </span>
          <SectionTitle id={titleId} section={section} />
        </button>
        {partOpen && <div id={bodyId}>{body}</div>}
      </div>
    )
  }
  return (
    <div className={section.tone === 'warning' ? 'usage-part is-warning' : 'usage-part'}>
      <div className="usage-part-header">
        <SectionTitle id={titleId} section={section} />
      </div>
      {body}
      {section.id === 'byName' && view.sharedName && (
        <p className="inspector-note usage-note">{t('usages.sharedName')}</p>
      )}
      {section.id === 'byName' && view.samePortName && (
        <p className="inspector-note usage-note">{t('usages.samePortName')}</p>
      )}
    </div>
  )
}

function Busy(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className="usage-busy"
      role="img"
      aria-label={t('usages.scanning')}
      title={t('usages.scanning')}
    >
      {' …'}
    </span>
  )
}

// 사용처 칸의 바깥 틀. 안에 포커스가 있었는데 다시 찾아 트리·부분이 통째로 사라지면(마지막 사용처를 고침) 포커스가
// <body>로 떨어진다. 그때 머리줄로 되돌려 인스펙터(localKeys) 안에 남긴다(트리 안의 행 되돌리기는 UsageTree).
// 상태마다 같은 자리에 그려 칸이 바뀌어도 기억이 남는다.
function SectionFrame({
  stale,
  children
}: {
  stale: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null)
  const hadFocusRef = useRef(false)
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame || !hadFocusRef.current || frame.contains(document.activeElement)) return
    if (focusDropped()) frame.querySelector<HTMLElement>('.usage-header')?.focus()
  })
  return (
    <div
      ref={frameRef}
      className={stale ? 'usage-section is-stale' : 'usage-section'}
      onFocus={() => {
        hadFocusRef.current = true
      }}
      onBlur={(event) => {
        if (focusMovedOut(event)) hadFocusRef.current = false
      }}
    >
      {children}
    </div>
  )
}

// 장치·그룹·로봇 카드의 접힌 "사용처"(Android Studio의 Find Usages, 개수를 늘 보이는 것은 JetBrains Code Vision).
// 머리줄: ▸ 사용처   코드 7 · 이름 2   ⚠ 3. 찾는 중에는 이전 개수 뒤에 …를 붙인다(깜박이지 않게).
// 찾은 것이 없으면 흐린 머리줄(펼치지 않음)에 도움말로 찾은 이름을 보인다. 펼침 상태는 카드 종류마다 메모리에만 둔다.
function UsageSection({ target }: { target: UsageTarget }): React.JSX.Element | null {
  const { t } = useTranslation()
  const kind = target.kind
  const id =
    target.kind === 'device'
      ? target.objectId
      : target.kind === 'group'
        ? target.groupId
        : target.robotId
  const componentId = target.kind === 'device' ? target.componentId : ''
  const objects = useSceneStore((state) => state.objects)
  const status = useUsageIndexStore((state) => state.status)
  const result = useUsageIndexStore((state) => state.result)
  const baseline = useUsageIndexStore((state) => state.baseline)
  const truncated = useUsageIndexStore((state) => state.truncated)
  const detail = useUsageIndexStore((state) => state.detail)
  const listed = useJavaIndexStore((state) => state.files.length)
  const open = useUsageOpenStore((state) => state.open[kind])
  const setOpen = useUsageOpenStore((state) => state.setOpen)
  const bodyId = useId()

  const exists = useMemo(
    () => hasUsageSection(objects, targetOf(kind, id, componentId)),
    [objects, kind, id, componentId]
  )
  const view = useMemo(
    () => safeView(objects, result, baseline, targetOf(kind, id, componentId)),
    [objects, result, baseline, kind, id, componentId]
  )
  if (!exists) return null

  const title = <span className="usage-title">{t('usages.title')}</span>
  const stateNote =
    status === 'none'
      ? t('usages.noProject')
      : status === 'noTeamCode'
        ? t('usages.noTeamCode')
        : status === 'failed'
          ? detail
            ? t('usages.failed', { detail })
            : t('usages.failedNoDetail')
          : null

  // 아직 결과가 없다: 찾는 중이면 그렇게, 프로젝트 없음·TeamCode 없음·실패면 그 이유
  // 흐린 머리줄은 펼치지 않지만 포커스는 받는다(tabIndex -1, 사라진 트리에서 포커스를 되돌릴 곳)
  if (!view) {
    return (
      <SectionFrame stale={false}>
        <div className="usage-header is-muted" tabIndex={-1}>
          <span className="usage-twisty" aria-hidden="true" />
          {title}
          {status === 'scanning' && <span className="usage-summary">{t('usages.scanning')}</span>}
        </div>
        {stateNote && <p className="inspector-note usage-note">{stateNote}</p>}
      </SectionFrame>
    )
  }

  const { files } = result!
  const partialCount = files.tooLarge.length + files.unicodeEscape.length + files.failed.length
  const partial = partialCount > 0 || truncated
  // 실패·TeamCode 없음: 이전 결과를 흐리게 보이고, 펼치면 이유를 알린다
  const stale = status === 'failed' || status === 'noTeamCode'
  const scanning = status === 'scanning'
  const searched = `${t('usages.searched', { terms: searchedTerms(view) })}\n${t('usages.kotlin')}`

  // 찾은 것이 없고 일부만 찾지도 않았다: 흐린 머리줄(펼치지 않음), 도움말은 찾은 것
  if (view.empty && !partial && !stale) {
    return (
      <SectionFrame stale={false}>
        <div className="usage-header is-muted" title={searched} tabIndex={-1}>
          <span className="usage-twisty" aria-hidden="true" />
          {title}
          <span className="usage-summary">
            {t('usages.none')}
            {scanning && <Busy />}
          </span>
        </div>
      </SectionFrame>
    )
  }

  const { counts } = view
  const summary = [t('usages.code', { count: counts.code })]
  if (counts.byName > 0) summary.push(t('usages.byName', { count: counts.byName }))
  if (counts.descendants > 0) summary.push(t('usages.descendants', { count: counts.descendants }))
  const notes = [
    stale ? stateNote : null,
    view.unavailable ? t('usages.unavailable') : null,
    truncated ? t('usages.truncated', { count: listed }) : null,
    partialCount > 0 ? t('usages.partial', { count: partialCount }) : null
  ].filter((note): note is string => note !== null)
  const sectionsOf = (tone: UsageSectionView['tone']): React.JSX.Element[] =>
    view.sections
      .filter((section) => section.tone === tone)
      .map((section) => <Section key={section.id} kind={kind} section={section} view={view} />)

  return (
    <SectionFrame stale={stale}>
      <button
        type="button"
        className="usage-header"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        title={stale && stateNote ? stateNote : searched}
        onClick={() => setOpen(kind, !open)}
      >
        <span className="usage-twisty" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {title}
        <span className="usage-summary">
          {summary.join(' · ')}
          {partial && ` ${t('usages.partialBadge')}`}
          {scanning && <Busy />}
        </span>
        {counts.warnings > 0 && (
          <span
            className="usage-warnings"
            role="img"
            aria-label={t('usages.warnings', { count: counts.warnings })}
            title={t('usages.warnings', { count: counts.warnings })}
          >
            ⚠ {counts.warnings}
          </span>
        )}
      </button>
      {open && (
        <div id={bodyId} className="usage-body">
          {notes.map((note) => (
            <p key={note} className="inspector-note usage-note">
              {note}
            </p>
          ))}
          {sectionsOf('warning')}
          {sectionsOf('main')}
          {counts.descendants > 0 && (
            <p className="usage-descendants">
              {t('usages.descendants', { count: counts.descendants })}
            </p>
          )}
          {sectionsOf('folded')}
        </div>
      )}
    </SectionFrame>
  )
}

export default UsageSection
