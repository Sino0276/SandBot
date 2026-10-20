import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useJavaIndexStore } from '../../java/javaIndex'
import { useUsageIndexStore } from '../../java/usageIndex'
import { usageSymbols } from '../../java/usages/usageSymbols'
import { robotUsageKey } from '../../java/usages/usageTypes'
import { findRobotId, type SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUsageOpenStore } from './usageOpenStore'
import UsageTree from './UsageTree'
import {
  hasUsageSection,
  searchedTerms,
  usageView,
  type UsageCardKind,
  type UsageSectionView,
  type UsageTarget,
  type UsageView
} from './usageView'

// 대상의 로봇이 클래스 이름 문제(잘못됐거나 겹침)로 코드 사용처를 찾을 수 없는지. 기호표(usageSymbols)가 정한 것을
// 읽는다(다시 판단하지 않는다). 기호표를 만들지 못하면 모른다(false).
function robotUnavailable(objects: SceneObjects, robotId: string | null): boolean {
  if (!robotId) return false
  try {
    const key = robotUsageKey(robotId)
    return usageSymbols(objects).unavailable.some((entry) => entry.key === key)
  } catch {
    return false
  }
}

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

function SectionTitle({
  section,
  view
}: {
  section: UsageSectionView
  view: UsageView
}): React.JSX.Element {
  const { t } = useTranslation()
  const count = section.total
  let text: string
  let hint: string | undefined
  switch (section.id) {
    case 'renamedCode':
      text = t('usages.renamedCode', { old: section.old, count })
      break
    case 'renamedName':
      text = t('usages.renamedName', { old: section.old, count })
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
  void view
  return (
    <span className="usage-section-title" title={hint}>
      {section.warning && '⚠ '}
      {text}
      {hint && (
        <span className="usage-info" aria-hidden="true">
          {' ⓘ'}
        </span>
      )}
    </span>
  )
}

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
  const folded = useUsageOpenStore((state) => state.folded[`${kind}:${section.id}`] ?? false)
  const setFolded = useUsageOpenStore((state) => state.setFolded)
  const bodyId = useId()
  const sectionLabel = t('usages.listLabel', { name: view.name })
  const more = section.total - section.hits.length
  const body = (
    <>
      <UsageTree label={sectionLabel} hits={section.hits} defaultKind={section.defaultKind} />
      {more > 0 && <p className="usage-more">{t('usages.more', { count: more })}</p>}
    </>
  )
  const className = section.warning ? 'usage-part is-warning' : 'usage-part'

  // 접어 두는 부분은 제목이 펼침 단추다(세지 않는 것이라 처음에는 접혀 있다)
  if (section.collapsible) {
    return (
      <div className={className}>
        <button
          type="button"
          className="usage-fold"
          aria-expanded={folded}
          aria-controls={bodyId}
          onClick={() => setFolded(kind, section.id, !folded)}
        >
          <span className="usage-twisty" aria-hidden="true">
            {folded ? '▾' : '▸'}
          </span>
          <SectionTitle section={section} view={view} />
        </button>
        {folded && <div id={bodyId}>{body}</div>}
      </div>
    )
  }
  return (
    <div className={className}>
      <div className="usage-part-header">
        <SectionTitle section={section} view={view} />
      </div>
      {body}
      {section.id === 'byName' && view.sharedName && (
        <p className="inspector-note">{t('usages.sharedName')}</p>
      )}
    </div>
  )
}

// 장치·그룹·로봇 카드의 접힌 "사용처"(Android Studio의 Find Usages, JetBrains Code Vision처럼 개수를 늘 보인다).
// 머리줄: ▸ 사용처   코드 7 · 이름 2   ⚠ 3. 찾는 중에는 이전 개수 뒤에 …를 붙인다(깜박이지 않게).
// 펼침 상태는 카드 종류마다 메모리에만 둔다(usageOpenStore).
function UsageSection({ target }: { target: UsageTarget }): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const status = useUsageIndexStore((state) => state.status)
  const result = useUsageIndexStore((state) => state.result)
  const baseline = useUsageIndexStore((state) => state.baseline)
  const truncated = useUsageIndexStore((state) => state.truncated)
  const detail = useUsageIndexStore((state) => state.detail)
  const listed = useJavaIndexStore((state) => state.files.length)
  const kind = target.kind
  const open = useUsageOpenStore((state) => state.open[kind])
  const setOpen = useUsageOpenStore((state) => state.setOpen)
  const bodyId = useId()

  const id =
    target.kind === 'device'
      ? target.objectId
      : target.kind === 'group'
        ? target.groupId
        : target.robotId
  const componentId = target.kind === 'device' ? target.componentId : ''
  const exists = useMemo(
    () => hasUsageSection(objects, targetOf(kind, id, componentId)),
    [objects, kind, id, componentId]
  )
  const view = useMemo(
    () => (result ? usageView(objects, result, baseline, targetOf(kind, id, componentId)) : null),
    [objects, result, baseline, kind, id, componentId]
  )
  const unavailable = useMemo(
    () => robotUnavailable(objects, kind === 'robot' ? id : findRobotId(objects, id)),
    [objects, kind, id]
  )
  if (!exists) return null

  const title = <span className="usage-title">{t('usages.title')}</span>
  const failedText = detail ? t('usages.failed', { detail }) : t('usages.failedNoDetail')
  const stateNote =
    status === 'none'
      ? t('usages.noProject')
      : status === 'noTeamCode'
        ? t('usages.noTeamCode')
        : status === 'failed'
          ? failedText
          : null

  // 아직 결과가 없다: 프로젝트 없음·TeamCode 없음·실패는 그 이유, 찾는 중이면 찾는 중
  if (!view) {
    return (
      <div className="usage-section">
        <div className="usage-header is-muted">
          <span className="usage-twisty" aria-hidden="true" />
          {title}
          {status === 'scanning' && (
            <span className="usage-summary">{t('usages.scanning')}</span>
          )}
        </div>
        {stateNote && <p className="inspector-note">{stateNote}</p>}
      </div>
    )
  }

  const partialCount =
    result!.files.tooLarge.length + result!.files.unicodeEscape.length + result!.files.failed.length
  const partial = partialCount > 0 || truncated
  // 실패·TeamCode 없음: 이전 결과를 흐리게 보이고 펼치면 이유를 알린다
  const stale = status === 'failed' || status === 'noTeamCode'
  const terms = `${t('usages.searched', { terms: searchedTerms(view) })}\n${t('usages.kotlin')}`

  // 찾은 것이 없고 일부만 찾지도 않았다: 흐린 머리줄(펼치지 않음), 도움말은 찾은 것
  if (view.empty && !partial && !unavailable && !stale) {
    return (
      <div className="usage-section">
        <div className="usage-header is-muted" title={terms}>
          <span className="usage-twisty" aria-hidden="true" />
          {title}
          <span className="usage-summary">
            {t('usages.none')}
            {status === 'scanning' && <Busy />}
          </span>
        </div>
      </div>
    )
  }

  const { counts } = view
  const summary = [t('usages.code', { count: counts.code })]
  if (counts.byName > 0) summary.push(t('usages.byName', { count: counts.byName }))
  if (counts.descendants > 0) summary.push(t('usages.descendants', { count: counts.descendants }))
  const notes = [
    stale ? stateNote : null,
    unavailable ? t('usages.unavailable') : null,
    truncated ? t('usages.truncated', { count: listed }) : null,
    partialCount > 0 ? t('usages.partial', { count: partialCount }) : null
  ].filter((note): note is string => note !== null)
  // 하위 장치 개수는 코드 부분 뒤(없으면 문제 부분 뒤)에 둔다
  const descendants =
    counts.descendants > 0 ? (
      <p className="usage-descendants">{t('usages.descendants', { count: counts.descendants })}</p>
    ) : null
  const lastCodeIndex = view.sections.findLastIndex(
    (section) => section.id === 'code' || section.id === 'constructs' || section.warning
  )

  return (
    <div className={stale ? 'usage-section is-stale' : 'usage-section'}>
      <button
        type="button"
        className="usage-header"
        aria-expanded={open}
        aria-controls={bodyId}
        title={stale ? stateNote! : terms}
        onClick={() => setOpen(kind, !open)}
      >
        <span className="usage-twisty" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {title}
        <span className="usage-summary">
          {summary.join(' · ')}
          {partial && ` ${t('usages.partialBadge')}`}
          {status === 'scanning' && <Busy />}
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
            <p key={note} className="inspector-note">
              {note}
            </p>
          ))}
          {view.sections.map((section, index) => (
            <SectionWithDescendants
              key={section.id}
              kind={kind}
              section={section}
              view={view}
              after={index === lastCodeIndex ? descendants : null}
            />
          ))}
          {lastCodeIndex < 0 && descendants}
        </div>
      )}
    </div>
  )
}

function SectionWithDescendants({
  kind,
  section,
  view,
  after
}: {
  kind: UsageCardKind
  section: UsageSectionView
  view: UsageView
  after: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <Section kind={kind} section={section} view={view} />
      {after}
    </>
  )
}

function Busy(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="usage-busy" role="img" aria-label={t('usages.scanning')} title={t('usages.scanning')}>
      {' …'}
    </span>
  )
}

export default UsageSection
