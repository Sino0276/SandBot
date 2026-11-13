import { useTranslation } from 'react-i18next'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { usePlayStore } from '../../play/playStore'
import { findRobotId, type SceneObject, type Vec3 } from '../../scene/model'
import {
  MAX_PRELOAD_EXTENT,
  MAX_ROBOT_PRELOADS,
  PRELOAD_KINDS,
  preloadEnabled,
  type PreloadSettings
} from '../../scene/preload'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { LengthVector } from '../collider/ColliderCard'
import { useCollisionModel } from '../collider/useCollisionModel'
import { documentSeasonId, runLocksField } from '../field/fieldDisplay'
import { preloadCardView } from './preloadCardModel'

// Preload Slot 카드(6a, spec-6a §3, Unity의 빈 GameObject에 붙인 생성 지점 컴포넌트). 시뮬레이터 설정이라 생성 코드·구성 XML과
// 관계없다. 머리줄은 Collider 카드처럼 확인란(켬)·제목(번역하지 않음)·시뮬레이터 배지·[제거]이고, 칸은 경기 요소(지금은 POLLEN만,
// 고를 수 없음)와 공 중심(오브젝트 로컬, 표시 단위, 12in 같은 입력)이다. 칸 하나를 확정할 때마다 setPreload 한 번(실행 취소 한
// 단계). 아래 줄은 세계 설명 빌더와 같은 규칙(robotPreloads)으로 이 자리가 쓰이는지·어느 몸체에 실리는지·겹침을 알린다.
function PreloadCard({ object }: { object: SceneObject }): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const season = useSceneStore((state) => documentSeasonId(state.field))
  const setPreload = useSceneStore((state) => state.setPreload)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const gameElements = usePlayStore((state) => state.settings.gameElements)
  const robotId = findRobotId(objects, object.id)
  const collision = useCollisionModel(robotId)
  // 실행이 이 로봇을 잠갔으면 "실행 중" 배지(시뮬레이터는 INIT 때의 자리를 쓴다, 편집은 막지 않는다)
  const running = usePlayStore((state) => runLocksField(state.run) && state.run.robotId === robotId)
  const preload = object.preload
  if (!preload) return null
  const view = preloadCardView(objects, object.id, resolveSeason(season), collision)
  const enabled = preloadEnabled(preload)
  const title = t('preload.title')
  // 아래 한 줄: 로봇 밖·시즌에 없음·끔이면 그 까닭, 쓰이면 자리 순서와 실리는 몸체(다른 제외 이유는 경고 줄이 말한다)
  const status =
    view.status === 'orphan'
      ? t('preload.orphan')
      : view.status === 'season'
        ? t('preload.season')
        : view.status === 'excluded'
          ? view.exclusion === 'disabled'
            ? t('preload.excluded.disabled')
            : ''
          : `${t('preload.slot', { index: view.index, max: MAX_ROBOT_PRELOADS })} · ${
              view.body.kind === 'chassis'
                ? t('preload.bodyChassis')
                : t('preload.bodyJoint', { name: view.body.name })
            }`

  const update = (next: PreloadSettings): void => setPreload(object.id, next)
  const setEnabled = (on: boolean): void =>
    update(on ? { kind: preload.kind, center: preload.center } : { ...preload, enabled: false })

  return (
    <li className={enabled ? 'hw-card' : 'hw-card is-disabled'} data-component-type="preloadSlot">
      <header className="hw-card-header">
        <span className="hw-check">
          <input
            type="checkbox"
            data-preload="enabled"
            checked={enabled}
            title={t('preload.enabled')}
            aria-label={`${title}: ${t('preload.enabled')}`}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span className="hw-card-type" title={t('preload.help', { max: MAX_ROBOT_PRELOADS })}>
            {title}
          </span>
        </span>
        <span className="hw-inline">
          {running && (
            <span className="frame-badge is-running" title={t('preload.runningHint')}>
              {t('inspector.running')}
            </span>
          )}
          <span className="inspector-file">{t('collider.simulationOnly')}</span>
          <button
            type="button"
            className="hw-card-remove"
            data-preload="remove"
            title={t('collider.remove')}
            aria-label={t('hardware.removeLabel', { name: title })}
            onClick={() => setPreload(object.id, null)}
          >
            ×
          </button>
        </span>
      </header>
      <div className="collider-fields">
        <div className="hw-row" title={t('preload.elementHint')}>
          <span className="hw-row-label">{t('preload.element')}</span>
          <select
            className="field-select"
            data-preload="kind"
            aria-label={t('preload.element')}
            value={preload.kind}
            // 지금은 POLLEN 하나뿐이다(BIOBUZZ 프리로드 규칙)
            disabled
          >
            {PRELOAD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`preload.kinds.${kind}`)}
              </option>
            ))}
          </select>
        </div>
        <LengthVector
          label={t('preload.center')}
          title={t('preload.centerHint')}
          values={preload.center}
          unit={lengthUnit}
          min={-MAX_PRELOAD_EXTENT}
          max={MAX_PRELOAD_EXTENT}
          invalidTitle={t('collider.invalid.length')}
          onCommit={(axis, meters) => {
            const center: Vec3 = [...preload.center]
            center[axis] = meters
            update({ ...preload, center })
          }}
        />
      </div>
      <ul className="hw-issues">
        {view.status === 'excluded' && view.exclusion !== 'disabled' && (
          <li className="hw-issue is-warning" data-preload="excluded">
            {t(`preload.excluded.${view.exclusion}`, { max: MAX_ROBOT_PRELOADS })}
          </li>
        )}
        {view.status === 'used' && view.overlap !== null && (
          <li className="hw-issue is-warning" data-preload="overlap">
            {t('preload.overlap', { target: view.overlap })}
          </li>
        )}
        {view.status !== 'orphan' && view.status !== 'season' && !gameElements && (
          <li className="hw-issue is-info" data-preload="off">
            {t('preload.off')}
          </li>
        )}
      </ul>
      {status !== '' && (
        <p className="inspector-note" data-preload="status">
          {status}
        </p>
      )}
    </li>
  )
}

export default PreloadCard
