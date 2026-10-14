import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { DEG } from '../../scene/coordinates'
import {
  ancestorIds,
  findRobotId,
  getTransformInFrame,
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
  formatLength,
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

  // 인스펙터 값은 Unity처럼 항상 부모 기준 로컬 값(저장값 그대로)이다. 최상위 오브젝트의 부모는 필드다.
  // 보기 기준(필드/로봇) 전환은 핸들 축·축 표시·카메라에만 적용한다.
  const value = object.transform
  const parent = object.parentId ? objects[object.parentId] : undefined
  const isRobotRoot = object.kind === 'robot' && object.parentId === null
  const unitSymbol = t(`units.symbols.${lengthUnit}`)

  // CAD 루트 아래 파트의 부모 축은 CAD 파일의 축이다(위가 +Y일 수도 있다). 중간 노드를 돌렸으면 알리지 않는다.
  const ancestors = ancestorIds(objects, object.id)
  const cadIndex = ancestors.findIndex((id) => objects[id].cad)
  const cadAxes =
    cadIndex >= 0 &&
    ancestors.slice(0, cadIndex).every((id) => objects[id].transform.rotation.every((r) => r === 0))
      ? objects[ancestors[cadIndex]].cad
      : undefined

  // 로봇 안의 오브젝트는 로봇 중심(원점) 기준 위치도 읽기 전용으로 보여 준다
  const robotCenter =
    !isRobotRoot && findRobotId(objects, object.id) !== null
      ? getTransformInFrame(objects, object.id, 'robot').position
      : undefined

  // CAD 정렬은 CAD 루트를 직접 골랐거나, 그 CAD를 가진 로봇을 골랐을 때 보여 준다
  const cadObjectId = object.cad
    ? object.id
    : object.kind === 'robot'
      ? subtreeIds(objects, object.id).find((id) => objects[id].cad)
      : undefined

  const commit = (key: keyof Transform, axis: 0 | 1 | 2, input: number): void => {
    const next: Transform = { position: [...value.position], rotation: [...value.rotation] }
    next[key][axis] = input
    setLocalTransform(object.id, next)
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
            <span
              className="frame-badge"
              title={
                parent
                  ? t('inspector.frameParentHint', { name: parent.name })
                  : t('inspector.frameFieldHint')
              }
            >
              {parent ? t('inspector.frameParent') : t('inspector.frameField')}
            </span>
          </header>
          {cadAxes && (
            <p className="inspector-note">
              {t('inspector.cadAxes', { up: cadAxes.upAxis, forward: cadAxes.forwardAxis })}
            </p>
          )}
          <VectorRow
            label={t('inspector.position')}
            values={value.position.map((meters) => toDisplayLength(meters, lengthUnit)) as Vec3}
            unit={unitSymbol}
            digits={LENGTH_DIGITS[lengthUnit]}
            // 최상위 로봇은 바닥 위에만 있다(높이·롤·피치 0)
            disabled={[false, false, isRobotRoot]}
            parse={(text) => {
              const meters = parseLength(text, lengthUnit)
              return meters === null ? null : toDisplayLength(meters, lengthUnit)
            }}
            hint={t('units.lengthInputHint', { unit: unitSymbol })}
            onCommit={(axis, input) =>
              commit('position', axis, fromDisplayLength(input, lengthUnit))
            }
          />
          <VectorRow
            label={t('inspector.rotation')}
            values={value.rotation.map((radians) => radians / DEG) as Vec3}
            unit="°"
            digits={ANGLE_DIGITS}
            disabled={[isRobotRoot, isRobotRoot, false]}
            parse={(text) => {
              const radians = parseAngle(text)
              return radians === null ? null : radians / DEG
            }}
            hint={t('units.angleInputHint')}
            onCommit={(axis, input) => commit('rotation', axis, input * DEG)}
          />
          {robotCenter && (
            <div className="robot-center" title={t('inspector.robotCenterHint')}>
              <span className="robot-center-label">
                {t('inspector.robotCenter')} <span className="vector-row-unit">{unitSymbol}</span>
              </span>
              <div className="vector-row-fields">
                {AXES.map((axis, index) => (
                  <span key={axis} className={`number-field is-readonly axis-${axis}`}>
                    <span className="number-field-label">{axis.toUpperCase()}</span>
                    <output>{formatLength(robotCenter[index], lengthUnit)}</output>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
        {cadObjectId && <CadAlignmentSection cadObject={objects[cadObjectId]} />}
        {isRobotRoot && <RobotHardwareSection robot={object} />}
        <HardwareComponentsSection object={object} />
      </Fragment>
    </PanelFrame>
  )
}

export default InspectorPanel
