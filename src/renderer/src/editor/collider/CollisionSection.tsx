import { useTranslation } from 'react-i18next'
import { EDIT_OVERLAP_TOLERANCE } from '../../../../shared/sim/collision3d'
import { forceCollideKey } from '../../scene/collider'
import { subtreeIds } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { usePlayStore } from '../../play/playStore'
import { staleForcePairs, type IgnoredPair } from '../../play/worldColliders'
import { useUnitStore } from '../../units/unitStore'
import { formatLength } from '../../units/units'
import { MAX_BODY_COLLIDERS, MAX_WORLD_COLLIDERS } from '../../../../shared/sim/worldSpec'
import { useEditorStore } from '../editorStore'
import { runLocksField } from '../field/fieldDisplay'
import { bodyShapeReason } from './colliderCardModel'
import { useCollisionModel } from './useCollisionModel'

// Rigidbody(섀시, body −1)·Articulation Body(관절 몸체) 카드의 "충돌" 구역(spec-5 §6.3). 몸체 충돌 형상의 출처 줄, 읽는 중 메시,
// 고정 기저 안내, 바닥 닿음(관절), 자기 충돌 안내와 "처음부터 겹쳐 무시함" 목록([그래도 충돌] 확인란, 줄을 누르면 상대 몸체를
// 고른다), 지금은 겹치지 않는 [그래도 충돌] 설정([지우기], 섀시 구역)을 보인다. 계산은 useCollisionModel(몸체 단위 기억)이다.
function CollisionSection({
  robotId,
  bodyObjectId
}: {
  robotId: string
  // 섀시는 로봇 id, 관절 몸체는 관절 오브젝트 id
  bodyObjectId: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const setRobotCollision = useSceneStore((state) => state.setRobotCollision)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const running = usePlayStore((state) => runLocksField(state.run) && state.run.robotId === robotId)
  const collision = useCollisionModel(robotId)
  const body = collision?.model.bodies.find((entry) => entry.objectId === bodyObjectId)
  if (!collision || !body) return null
  const { model } = collision
  const chassis = body.body < 0
  const symbol = t(`units.symbols.${lengthUnit}`)
  const lengthText = (meters: number): string => `${formatLength(meters, lengthUnit)} ${symbol}`
  const nameOf = (index: number): string =>
    model.bodies.find((entry) => entry.body === index)?.name ?? ''
  const hasWheels = subtreeIds(objects, robotId).some((id) => id !== robotId && !!objects[id].wheel)
  const pairs = chassis
    ? model.pairs
    : model.pairs.filter((pair) => pair.a === body.body || pair.b === body.body)
  const forceCollide = objects[robotId]?.collision?.forceCollide ?? []

  const toggleForce = (pair: IgnoredPair, on: boolean): void => {
    const key = forceCollideKey(pair.aObjectId, pair.bObjectId)
    const rest = forceCollide.filter(([a, b]) => !(a === key[0] && b === key[1]))
    setRobotCollision(robotId, { forceCollide: on ? [...rest, key] : rest })
  }
  const clearStale = (): void => {
    const stale = new Set(
      staleForcePairs(objects, robotId, model).map((pair) => JSON.stringify(pair))
    )
    setRobotCollision(robotId, {
      forceCollide: forceCollide.filter((pair) => !stale.has(JSON.stringify(pair)))
    })
  }

  const shapeLine = ((): string => {
    switch (body.source) {
      case 'colliders':
        return t('collider.body.colliders', { count: body.colliders.length })
      case 'disabled':
        return t('collider.body.disabled')
      case 'auto': {
        const entry = body.colliders[0]
        return t('collider.body.auto', {
          points: entry?.hullPoints ?? 0,
          error: lengthText(entry?.error ?? 0)
        })
      }
      case 'fallback':
      case 'none':
        return t(`collider.body.${body.source}`, {
          reason: t(`collider.body.reasons.${bodyShapeReason(body)}`)
        })
    }
  })()
  const capped = body.states.filter((state) => state.capped).length

  return (
    <div className="collision-section" aria-label={t('collider.body.title')}>
      <div className="inspector-section-title collision-section-title">
        <span>{t('collider.body.title')}</span>
        {running && (
          <span className="frame-badge is-running" title={t('collider.runningHint')}>
            {t('inspector.running')}
          </span>
        )}
      </div>
      <p
        className="hw-derived"
        title={body.source === 'auto' ? t('collider.body.autoHint') : undefined}
      >
        {shapeLine}
      </p>
      <ul className="hw-issues">
        {body.pendingMeshes > 0 && (
          <li className="hw-issue is-info">
            {t('collider.body.pending', { count: body.pendingMeshes })}
          </li>
        )}
        {capped > 0 && (
          <li className="hw-issue is-warning">
            {t('collider.body.capped', {
              count: capped,
              body: MAX_BODY_COLLIDERS,
              world: MAX_WORLD_COLLIDERS
            })}
          </li>
        )}
        {chassis && !hasWheels && (
          <li className="hw-issue is-info">{t('collider.body.fixedBase')}</li>
        )}
        {!chassis && body.floorGap !== null && body.floorGap <= EDIT_OVERLAP_TOLERANCE && (
          <li className="hw-issue is-info">{t('collider.body.floorTouch')}</li>
        )}
      </ul>
      <div className="collision-self">
        <span className="hw-row-label">{t('collider.self.title')}</span>
        <p className="inspector-note">
          {chassis || body.parent === null
            ? t('collider.self.adjacentHint')
            : t('collider.self.adjacentParent', { name: nameOf(body.parent) })}
        </p>
        <span className="hw-row-label">{t('collider.self.ignoredTitle')}</span>
        {pairs.length === 0 ? (
          <p className="inspector-note">{t('collider.self.none')}</p>
        ) : (
          <ul className="hw-issues collision-pairs">
            {pairs.map((pair) => {
              // 줄을 누르면 상대 몸체를 고른다(섀시 구역은 b)
              const other = !chassis && pair.b === body.body ? pair.aObjectId : pair.bObjectId
              return (
                <li key={`${pair.aObjectId}|${pair.bObjectId}`} className="hw-issue is-info">
                  <span className="hw-inline">
                    <button
                      type="button"
                      className="hw-issue-link"
                      onClick={() => useEditorStore.getState().select(other)}
                    >
                      {t('collider.self.pair', {
                        a: nameOf(pair.a),
                        b: nameOf(pair.b),
                        depth: lengthText(pair.depth)
                      })}
                    </button>
                    <label className="hw-check" title={t('collider.self.forceHint')}>
                      <input
                        type="checkbox"
                        checked={pair.forced}
                        onChange={(event) => toggleForce(pair, event.target.checked)}
                      />
                      {t('collider.self.force')}
                    </label>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {chassis && model.staleForced > 0 && (
          <p className="inspector-note">
            <span className="hw-inline">
              {t('collider.self.staleForced', { count: model.staleForced })}
              <button type="button" className="panel-button" onClick={clearStale}>
                {t('collider.self.clearStale')}
              </button>
            </span>
          </p>
        )}
      </div>
    </div>
  )
}

export default CollisionSection
