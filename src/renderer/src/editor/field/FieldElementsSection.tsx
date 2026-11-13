import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { FieldSpec } from '../../../../shared/sim/seasons/fieldSpec'
import { usePlayStore } from '../../play/playStore'
import { RUN_ELEMENT_GROUPS } from '../../play/worldElements'
import type { SceneObjects } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { preloadSourceText, robotPreloadSource } from '../preload/preloadCardModel'
import { documentSeasonId, runLocksField } from './fieldDisplay'

// Field 인스펙터 '경기 요소' 구역(6a, spec-6a §4): 개인 실행 설정 gameElements(환경 설정 › 시뮬레이션과 같은 값, 다음 INIT부터),
// 보이는 시즌의 배치 묶음별 공 수(6a에 생기는 GARDEN만 수, 다른 묶음은 어느 단계에서 생기는지), 실행 중이면 그 실행의 공 수,
// 로봇마다 프리로드 출처(문서 시즌, 세계 설명 빌더와 같은 규칙). 시즌에 경기 요소가 없으면 그 사실만 보인다.

// 6a에 아직 없는 배치 묶음과 생기는 단계(plan: 6b HIVE·FLOWER, 6d 사람 선수)
const DEFERRED_GROUPS = [
  { key: 'flower', stage: '6b' },
  { key: 'hiveCell', stage: '6b' },
  { key: 'humanPlayer', stage: '6d' }
] as const

// 최상위 로봇(문서 순서)
function topRobots(objects: SceneObjects): { id: string; name: string }[] {
  return Object.values(objects)
    .filter((object) => object.kind === 'robot' && object.parentId === null)
    .map((object) => ({ id: object.id, name: object.name }))
}

function FieldElementsSection({ spec }: { spec: FieldSpec }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const season = useSceneStore((state) => documentSeasonId(state.field))
  const gameElements = usePlayStore((state) => state.settings.gameElements)
  const updateSettings = usePlayStore((state) => state.updateSettings)
  const locked = usePlayStore((state) => runLocksField(state.run))
  const runCount = usePlayStore((state) =>
    runLocksField(state.run) ? (state.run.elements?.kinds.length ?? 0) : 0
  )
  const lines = useMemo(
    () =>
      topRobots(objects).map((robot) => ({
        ...robot,
        text: preloadSourceText(t, robotPreloadSource(objects, robot.id, season))
      })),
    [objects, season, t]
  )
  const elements = spec.elements
  const groupCount = (group: string): number =>
    elements ? elements.layout.filter((entry) => entry.group === group).length : 0

  return (
    <section className="inspector-section" aria-label={t('field.inspector.elements.title')}>
      <header className="inspector-section-header">
        <span className="inspector-section-title">{t('field.inspector.elements.title')}</span>
      </header>
      <label className="field-check" title={t('field.inspector.elements.hint')}>
        <input
          type="checkbox"
          data-field-elements="enabled"
          checked={gameElements}
          onChange={(event) => updateSettings({ gameElements: event.target.checked })}
        />
        {t('field.inspector.elements.enabled')}
      </label>
      <p className="inspector-note">{t('field.inspector.elements.hint')}</p>
      {!elements ? (
        <p className="inspector-note" data-field-elements="none">
          {t('field.inspector.elements.none')}
        </p>
      ) : (
        <>
          {RUN_ELEMENT_GROUPS.map((group) => (
            <div key={group} className="field-row" data-field-elements-group={group}>
              <span className="field-row-label">
                {t(`field.inspector.elements.groups.${group}`)}
              </span>
              <output className="field-inspector-value">
                {t('field.inspector.elements.count', { count: groupCount(group) })}
              </output>
            </div>
          ))}
          {DEFERRED_GROUPS.map(({ key, stage }) => (
            <div key={key} className="field-row is-disabled" data-field-elements-group={key}>
              <span className="field-row-label">{t(`field.inspector.elements.groups.${key}`)}</span>
              <output className="field-inspector-value">
                {t('field.inspector.elements.deferred', { stage })}
              </output>
            </div>
          ))}
          {!gameElements && (
            <p className="inspector-note" data-field-elements="off">
              {t('field.inspector.elements.off')}
            </p>
          )}
        </>
      )}
      {locked && (
        <p className="inspector-note" data-field-elements="running">
          {runCount > 0
            ? t('field.inspector.elements.running', { count: runCount })
            : t('field.inspector.elements.runningOff')}
        </p>
      )}
      {elements && lines.length > 0 && (
        <>
          <span className="field-row-label">{t('field.inspector.elements.preloads')}</span>
          {lines.map((line) => (
            <p key={line.id} className="inspector-note" data-field-elements-robot={line.id}>
              {t('field.inspector.elements.robotLine', { robot: line.name, source: line.text })}
            </p>
          ))}
        </>
      )}
    </section>
  )
}

export default FieldElementsSection
