import { useTranslation } from 'react-i18next'
import { DEG } from '../../scene/coordinates'
import {
  findRobotId,
  getTransformInFrame,
  localTransformFromFrame,
  type Transform,
  type Vec3
} from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import { useEditorStore } from '../editorStore'
import NumberField from '../NumberField'
import PanelFrame from '../PanelFrame'

const AXES = ['x', 'y', 'z'] as const

type VectorRowProps = {
  label: string
  values: Vec3
  unit: string
  digits: number
  disabled: [boolean, boolean, boolean]
  onCommit: (axis: 0 | 1 | 2, value: number) => void
}

function VectorRow({
  label,
  values,
  unit,
  digits,
  disabled,
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

  const object = selectedId ? objects[selectedId] : undefined
  if (!object) {
    return (
      <PanelFrame title={t('panels.inspector')}>
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

  const commit = (key: keyof Transform, axis: 0 | 1 | 2, input: number): void => {
    const next: Transform = { position: [...value.position], rotation: [...value.rotation] }
    next[key][axis] = input
    setLocalTransform(object.id, localTransformFromFrame(objects, object.id, shownFrame, next))
  }

  return (
    <PanelFrame title={t('panels.inspector')}>
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
          values={value.position}
          unit="m"
          digits={3}
          disabled={[isFrameOrigin, isFrameOrigin, isFrameOrigin || isRobotRoot]}
          onCommit={(axis, input) => commit('position', axis, input)}
        />
        <VectorRow
          label={t('inspector.rotation')}
          values={value.rotation.map((radians) => radians / DEG) as Vec3}
          unit="°"
          digits={1}
          disabled={[isFrameOrigin || isRobotRoot, isFrameOrigin || isRobotRoot, isFrameOrigin]}
          onCommit={(axis, input) => commit('rotation', axis, input * DEG)}
        />
      </section>
    </PanelFrame>
  )
}

export default InspectorPanel
