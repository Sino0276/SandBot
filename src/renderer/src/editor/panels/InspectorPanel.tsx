import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { DEG } from '../../scene/coordinates'
import {
  findRobotId,
  getTransformInFrame,
  localTransformFromFrame,
  subtreeIds,
  type Transform,
  type Vec3
} from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import CadAlignmentSection from '../CadAlignmentSection'
import { useEditorStore } from '../editorStore'
import HardwareComponentsSection from '../hardware/HardwareComponentsSection'
import RobotHardwareSection from '../hardware/RobotHardwareSection'
import NumberField from '../NumberField'
import PanelFrame from '../PanelFrame'
import { useUnitStore } from '../../units/unitStore'
import {
  ANGLE_DIGITS,
  fromDisplayLength,
  LENGTH_DIGITS,
  parseAngle,
  parseLength,
  toDisplayLength
} from '../../units/units'

const AXES = ['x', 'y', 'z'] as const

type VectorRowProps = {
  label: string
  values: Vec3
  unit: string
  digits: number
  disabled: [boolean, boolean, boolean]
  // 입력칸 문자열(단위를 붙일 수 있음)을 이 줄의 표시 단위 값으로 읽는다
  parse: (text: string) => number | null
  hint: string
  onCommit: (axis: 0 | 1 | 2, value: number) => void
}

function VectorRow({
  label,
  values,
  unit,
  digits,
  disabled,
  parse,
  hint,
  onCommit
}: VectorRowProps): React.JSX.Element {
  return (
    <div className="vector-row">
      <span className="vector-row-label">
        {label} <span className="vector-row-unit">{unit}</span>
      </span>
      <div className="vector-row-fields">
        {AXES.map((axis, index) => (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            axis={axis}
            value={values[index]}
            digits={digits}
            disabled={disabled[index]}
            parse={parse}
            title={hint}
            onCommit={(value) => onCommit(index as 0 | 1 | 2, value)}
          />
        ))}
      </div>
    </div>
  )
}

function InspectorPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const selectedId = useEditorStore((state) => state.selectedId)
  const frame = useEditorStore((state) => state.frame)
  const objects = useSceneStore((state) => state.objects)
  const setLocalTransform = useSceneStore((state) => state.setLocalTransform)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)

  const object = selectedId ? objects[selectedId] : undefined
  if (!object) {
    return (
      <PanelFrame title={t('panels.inspector')} localKeys>
        <p className="panel-empty">{t('inspector.empty')}</p>
      </PanelFrame>
    )
  }

  // 로봇에 속하지 않은 오브젝트는 로봇 기준 보기에서도 필드 기준으로 표시한다
  const inRobot = findRobotId(objects, object.id) !== null
  const shownFrame = frame === 'robot' && inRobot ? 'robot' : 'field'
  const value = getTransformInFrame(objects, object.id, shownFrame)
  const isRobotRoot = object.kind === 'robot' && object.parentId === null
  // 로봇 기준에서 로봇 자신은 좌표계의 원점이라 편집할 값이 없다
  const isFrameOrigin = isRobotRoot && shownFrame === 'robot'

  // CAD 정렬은 CAD 루트를 직접 골랐거나, 그 CAD를 가진 로봇을 골랐을 때 보여 준다
  const cadObjectId = object.cad
    ? object.id
    : object.kind === 'robot'
      ? subtreeIds(objects, object.id).find((id) => objects[id].cad)
      : undefined

  const commit = (key: keyof Transform, axis: 0 | 1 | 2, input: number): void => {
    const next: Transform = { position: [...value.position], rotation: [...value.rotation] }
    next[key][axis] = input
    setLocalTransform(object.id, localTransformFromFrame(objects, object.id, shownFrame, next))
  }

  return (
    <PanelFrame title={t('panels.inspector')} localKeys>
      {/* 선택이 바뀌면 입력칸을 새로 만든다. 그래야 이전 오브젝트에 쓰던 초안이 새 오브젝트에 확정되지 않는다. */}
      <Fragment key={object.id}>
        <div className="inspector-object">
          <span className="inspector-name">{object.name}</span>
          <span className="inspector-kind">{t(`objectKind.${object.kind}`)}</span>
        </div>
        <section className="inspector-section">
          <header className="inspector-section-header">
            <span>{t('inspector.transform')}</span>
            <span className="frame-badge">
              {shownFrame === 'robot' ? t('inspector.frameRobot') : t('inspector.frameField')}
            </span>
          </header>
          {frame === 'robot' && !inRobot && (
            <p className="inspector-note">{t('inspector.notInRobot')}</p>
          )}
          {isFrameOrigin && <p className="inspector-note">{t('inspector.robotOrigin')}</p>}
          <VectorRow
            label={t('inspector.position')}
            values={value.position.map((meters) => toDisplayLength(meters, lengthUnit)) as Vec3}
            unit={t(`units.symbols.${lengthUnit}`)}
            digits={LENGTH_DIGITS[lengthUnit]}
            disabled={[isFrameOrigin, isFrameOrigin, isFrameOrigin || isRobotRoot]}
            parse={(text) => {
              const meters = parseLength(text, lengthUnit)
              return meters === null ? null : toDisplayLength(meters, lengthUnit)
            }}
            hint={t('units.lengthInputHint', { unit: t(`units.symbols.${lengthUnit}`) })}
            onCommit={(axis, input) =>
              commit('position', axis, fromDisplayLength(input, lengthUnit))
            }
          />
          <VectorRow
            label={t('inspector.rotation')}
            values={value.rotation.map((radians) => radians / DEG) as Vec3}
            unit="°"
            digits={ANGLE_DIGITS}
            disabled={[isFrameOrigin || isRobotRoot, isFrameOrigin || isRobotRoot, isFrameOrigin]}
            parse={(text) => {
              const radians = parseAngle(text)
              return radians === null ? null : radians / DEG
            }}
            hint={t('units.angleInputHint')}
            onCommit={(axis, input) => commit('rotation', axis, input * DEG)}
          />
        </section>
        {cadObjectId && <CadAlignmentSection cadObject={objects[cadObjectId]} />}
        {isRobotRoot && <RobotHardwareSection robot={object} />}
        <HardwareComponentsSection object={object} />
      </Fragment>
    </PanelFrame>
  )
}

export default InspectorPanel
