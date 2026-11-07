import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Alliance } from '../../../../shared/sim/seasons/fieldSpec'
import { START_FACINGS, type StartFacing } from '../../../../shared/sim/seasons/startPose'
import { overlapTargetLabel, startPresetLabelKey } from '../../field/fieldLabels'
import { looseT } from '../../hardware/labels'
import { usePlayStore } from '../../play/playStore'
import type { SceneObject } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { formatLength } from '../../units/units'
import { runLocksField } from './fieldDisplay'
import { snapRobotToPreset, startPresetModel } from './startPresetModel'

// 최상위 로봇 인스펙터의 "시작 위치"(spec-4ab §1.9, Transform 섹션 아래): 문서 시즌의 G304 시작 프리셋으로 로봇을 벽에 붙인다
// (setLocalTransform 한 번, 실행 취소 한 단계). 프리셋·면(벽을 보는 면)은 오브젝트에 저장하지 않고, 지금 자세가 맞는
// 프리셋·면(matchingPreset)을 보인다. 지금 면에서 너무 넓거나 겹치는 프리셋은 비활성이고 이유는 선택칸 아래 한 줄이다
// (Windows Electron 드롭다운은 option title을 보이지 않는다). 실행이 필드를 잠그면 섹션 전체를 잠근다.

const ALLIANCES: readonly Alliance[] = ['red', 'blue']

function StartPresetSection({ robot }: { robot: SceneObject }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const doc = useSceneStore((state) => state.field)
  const locked = usePlayStore((state) => runLocksField(state.run))
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  // 맞는 프리셋이 없을 때의 면: 마지막으로 고른 값(처음 기본)
  const [lastFacing, setLastFacing] = useState<StartFacing>('default')
  const model = useMemo(
    () => startPresetModel(objects, robot.id, doc, lastFacing),
    [objects, robot.id, doc, lastFacing]
  )
  const length = (meters: number): string =>
    `${formatLength(meters, lengthUnit)} ${t(`units.symbols.${lengthUnit}`)}`

  const header = (
    <header className="inspector-section-header">
      <span className="inspector-section-title">
        {t('inspector.startPreset')}
        {/* 프리셋이 없는 시즌(실행 중 실행 취소로 문서 시즌이 바뀐 경우 포함)에도 잠김을 보인다 */}
        {locked && (
          <span className="frame-badge is-running" title={t('inspector.runningHint')}>
            {t('inspector.running')}
          </span>
        )}
      </span>
    </header>
  )

  // 'none'·모르는 시즌: 프리셋이 없다
  if (!model)
    return (
      <section className="inspector-section">
        {header}
        <p className="inspector-note">{t('field.inspector.noStartPresets')}</p>
      </section>
    )

  const tt = looseT(t)
  const choosePreset = (key: string): void => {
    if (key) snapRobotToPreset(robot.id, key, model.facing)
  }
  const chooseFacing = (facing: StartFacing): void => {
    setLastFacing(facing)
    // 프리셋이 맞는 상태면 같은 프리셋을 그 면으로 다시 스냅한다(그 면이 tooWide·충돌이면 비활성이고
    // snapRobotToPreset도 쓰지 않는다)
    if (model.match) snapRobotToPreset(robot.id, model.match.key, facing)
  }

  return (
    <section className="inspector-section">
      {header}
      <label className="field-row">
        <span className="field-row-label">{t('inspector.startPreset')}</span>
        <select
          className="field-select"
          value={model.match?.key ?? ''}
          disabled={locked}
          onChange={(event) => choosePreset(event.target.value)}
        >
          {/* 맞는 프리셋이 없음(표시용, 고를 수 없음) */}
          <option value="" disabled>
            {t('inspector.startPresetNone')}
          </option>
          {ALLIANCES.map((alliance) => (
            <optgroup key={alliance} label={t(`inspector.startAlliance.${alliance}`)}>
              {model.options
                .filter((option) => option.preset.alliance === alliance)
                .map((option) => (
                  <option
                    key={option.preset.key}
                    value={option.preset.key}
                    disabled={option.disabled !== null}
                  >
                    {tt(startPresetLabelKey(option.preset.key))}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {model.tooWide && (
        <p className="inspector-note is-reason">
          {t('inspector.startPresetTooWide', {
            count: model.tooWide.count,
            width: length(model.tooWide.width),
            available: length(model.tooWide.available)
          })}
        </p>
      )}
      {model.conflict && (
        <p className="inspector-note is-reason">
          {t('inspector.startPresetConflict', {
            count: model.conflict.count,
            targets: overlapTargetLabel(model.spec, model.conflict.conflicts, t)
          })}
        </p>
      )}
      <label className="field-row">
        <span className="field-row-label">{t('inspector.startFacing.label')}</span>
        <select
          className="field-select"
          value={model.facing}
          disabled={locked}
          onChange={(event) => chooseFacing(event.target.value as StartFacing)}
        >
          {START_FACINGS.map((facing) => (
            <option
              key={facing}
              value={facing}
              disabled={facing !== model.facing && model.blockedFacings.includes(facing)}
            >
              {t(`inspector.startFacing.${facing}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="inspector-note">
        {model.oversize
          ? t('inspector.startOversize', {
              width: length(model.size.width),
              depth: length(model.size.depth)
            })
          : t('inspector.startOutline', {
              width: length(model.size.width),
              depth: length(model.size.depth)
            })}
      </p>
      <p className="inspector-note">
        {t('inspector.collisionHeight', { height: length(model.height) })}
      </p>
    </section>
  )
}

export default StartPresetSection
