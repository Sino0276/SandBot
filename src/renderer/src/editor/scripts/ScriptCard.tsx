import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  displayJavaPath,
  scriptLinkStatus,
  simpleNameOfPath,
  useJavaIndexStore
} from '../../java/javaIndex'
import { openScriptFile } from '../../java/openScript'
import { useUsageIndexStore } from '../../java/usageIndex'
import { useProjectStore } from '../../project/projectStore'
import type { ScriptLink } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import { scriptUsesHardware } from '../usages/usageView'
import TunablesList from './TunablesList'

// 이 파일이 쓰는 하드웨어(사용처의 거꾸로 보기). 이 파일에 코드·이름으로 찾기 사용처가 있는 장치·그룹·로봇을
// 하이어라키 순서로 칩으로 보인다. 누르면 그 오브젝트를 고른다(하이어라키 행 한 번 누르기와 같이 카메라는 그대로).
// 찾은 것이 없거나 아직 결과가 없으면 보이지 않는다.
function UsesHardware({ path }: { path: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const result = useUsageIndexStore((state) => state.result)
  const status = useUsageIndexStore((state) => state.status)
  const select = useEditorStore((state) => state.select)
  const chips = useMemo(
    () => (result ? scriptUsesHardware(result, path, objects) : []),
    [result, path, objects]
  )
  if (chips.length === 0) return null
  // 실패·TeamCode 없음이면 이전 결과라 흐리게 보인다
  const stale = status === 'failed' || status === 'noTeamCode'
  return (
    <div className={stale ? 'script-uses is-stale' : 'script-uses'}>
      <span className="hw-row-label" title={t('scripts.usesHardwareHint')}>
        {t('scripts.usesHardware')}
      </span>
      <div className="script-chips">
        {chips.map((chip) => {
          const objectName = objects[chip.objectId]?.name ?? ''
          return (
            <button
              key={chip.key}
              type="button"
              className="script-chip"
              title={
                objectName && objectName !== chip.label
                  ? `${objectName}\n${t('scripts.usesHardwareHint')}`
                  : t('scripts.usesHardwareHint')
              }
              onClick={() => select(chip.objectId)}
            >
              {chip.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// 연결한 TeamCode Java 파일 카드(Unity의 스크립트 컴포넌트). 첫 줄은 Unity의 회색 Script 칸처럼 파일 이름을
// 읽기 전용으로 보이고, 더블클릭하거나 [열기]를 누르면 외부 스크립트 편집기로 연다. 탐색용 연결이라 생성 코드와는
// 관계없다. 파일을 못 찾으면, 같은 클래스(없으면 같은 이름)의 파일이 하나뿐일 때만 [다시 연결]을 보인다.
// 파일이 있으면 그 파일의 튜닝 값(@Config 필드)을 카드 안에 보인다(TunablesList).
function ScriptCard({ objectId, link }: { objectId: string; link: ScriptLink }): React.JSX.Element {
  const { t } = useTranslation()
  const root = useProjectStore((state) => state.root)
  const indexStatus = useJavaIndexStore((state) => state.status)
  const indexRoot = useJavaIndexStore((state) => state.root)
  const files = useJavaIndexStore((state) => state.files)
  const truncated = useJavaIndexStore((state) => state.truncated)
  const removeScriptLink = useSceneStore((state) => state.removeScriptLink)
  const relinkScript = useSceneStore((state) => state.relinkScript)

  const status = scriptLinkStatus(
    { status: indexStatus, root: indexRoot, files, truncated },
    root,
    link
  )
  const fileName = link.path.slice(link.path.lastIndexOf('/') + 1)
  const name = simpleNameOfPath(link.path)
  // 못 찾았다고 확인한 파일과 TeamCode가 없는 프로젝트는 열지 않는다(목록을 다 읽지 못했으면 메인에 맡긴다)
  const canOpen =
    status.kind !== 'noProject' && status.kind !== 'noTeamCode' && status.kind !== 'missing'
  const open = (): void => {
    if (canOpen) void openScriptFile(link.path)
  }

  return (
    <li className="hw-card script-card" data-script-path={link.path}>
      <header className="hw-card-header">
        <span className="script-card-title">
          <span className="script-card-name" title={link.className}>
            {name}
          </span>
          <span className="script-tag">{t('scripts.tag')}</span>
        </span>
        <button
          type="button"
          className="hw-card-remove"
          title={t('scripts.remove')}
          aria-label={t('scripts.removeLabel', { name: fileName })}
          onClick={() => removeScriptLink(objectId, link.path)}
        >
          ×
        </button>
      </header>
      <div className="hw-row">
        <span className="hw-row-label">{t('scripts.field')}</span>
        <div className="script-field-row">
          <span
            className={canOpen ? 'script-field' : 'script-field is-disabled'}
            title={`${displayJavaPath(link.path)}\n${t('scripts.fieldHint')}`}
            onDoubleClick={open}
          >
            {fileName}
          </span>
          <button
            type="button"
            className="panel-button"
            disabled={!canOpen}
            aria-label={t('scripts.openLabel', { name: fileName })}
            title={t('scripts.fieldHint')}
            onClick={open}
          >
            {t('scripts.open')}
          </button>
        </div>
      </div>
      {status.kind === 'checking' && <p className="script-status">{t('scripts.checking')}</p>}
      {status.kind === 'missing' && (
        <div className="script-missing">
          <span className="cad-file-missing">{t('scripts.missing')}</span>
          {status.candidate ? (
            <button
              type="button"
              className="panel-button script-relink"
              title={`${status.candidate.path}\n${t('scripts.relinkHint')}`}
              onClick={() =>
                relinkScript(objectId, link.path, {
                  path: status.candidate!.path,
                  className: status.candidate!.className
                })
              }
            >
              <span>{t('scripts.relink')}</span>
              {/* 긴 경로는 앞쪽을 줄여 끝의 파일 이름이 보이게 한다(rtl). 경로는 ltr로 격리한다(CAD 파일 줄과 같음). */}
              <span className="script-relink-path">
                <bdi dir="ltr">{displayJavaPath(status.candidate.path)}</bdi>
              </span>
            </button>
          ) : (
            <p className="inspector-note">{t('scripts.notFound')}</p>
          )}
        </div>
      )}
      {status.kind === 'unknown' && <p className="inspector-note">{t('scripts.unknown')}</p>}
      {status.kind === 'noProject' && <p className="inspector-note">{t('scripts.noProject')}</p>}
      {status.kind === 'noTeamCode' && <p className="inspector-note">{t('scripts.noTeamCode')}</p>}
      {canOpen && <UsesHardware path={link.path} />}
      {canOpen && <TunablesList path={link.path} />}
      <p className="inspector-note">{t('scripts.navigationHint')}</p>
    </li>
  )
}

export default ScriptCard
