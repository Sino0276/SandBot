import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DEG } from '../../scene/coordinates'
import {
  childrenInDocument,
  findRobotId,
  getTransformInFrame,
  isCodeGroup,
  subtreeIds,
  type SceneObjects,
  type Transform,
  type Vec3
} from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import CadAlignmentSection, { CadOriginSection } from '../CadAlignmentSection'
import CodeGroupSection from '../CodeGroupSection'
import { useEditorStore } from '../editorStore'
import HardwareComponentsSection from '../hardware/HardwareComponentsSection'
import RobotHardwareSection from '../hardware/RobotHardwareSection'
import { movedOutCadRoot, parentCadAxes } from '../inspectorInfo'
import NumberField from '../NumberField'
import PanelFrame from '../PanelFrame'
import TextField from '../TextField'
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

// 목록에 보이는 최대 수(큰 CAD에서 범위 선택하면 수천 개가 될 수 있다)
const MAX_LISTED = 200

// 선택 id를 하이어라키 순서(부모 먼저, 형제 순서)로 늘어놓는다. 없는 id는 뺀다.
function inHierarchyOrder(objects: SceneObjects, ids: readonly string[]): string[] {
  const selected = new Set(ids.filter((id) => objects[id]))
  return childrenInDocument(objects, null)
    .flatMap((root) => subtreeIds(objects, root.id))
    .filter((id) => selected.has(id))
}

// 둘 이상 선택했을 때. 다중 편집은 아직 없으므로(Unity와 다른 임시 편차) 편집 칸 대신 선택 목록만 보이고,
// 누르면 그 오브젝트로 좁힌다(Unity의 Narrow the Selection). Ctrl/Cmd+클릭은 선택에서 뺀다.
function MultipleSelection({ ids }: { ids: string[] }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const activeId = useEditorStore((state) => state.selectedId)
  const select = useEditorStore((state) => state.select)
  const toggleSelect = useEditorStore((state) => state.toggleSelect)
  const listed = ids.slice(0, MAX_LISTED)

  return (
    <>
      <div className="inspector-object">
        <span className="inspector-name">{t('inspector.multiple', { count: ids.length })}</span>
      </div>
      <section className="inspector-section">
        <p className="inspector-note">{t('inspector.multipleHint')}</p>
        <ul className="inspector-selection">
          {listed.map((id) => (
            <li key={id}>
              <button
                type="button"
                className={
                  id === activeId
                    ? 'inspector-selection-item is-active'
                    : 'inspector-selection-item'
                }
                aria-current={id === activeId || undefined}
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey) toggleSelect(id)
                  else select(id)
                }}
              >
                <span className="inspector-selection-name">{objects[id].name}</span>
                <span className="inspector-kind">{t(`objectKind.${objects[id].kind}`)}</span>
              </button>
            </li>
          ))}
        </ul>
        {ids.length > listed.length && (
          <p className="inspector-note">
            {t('inspector.multipleMore', { count: ids.length - listed.length })}
          </p>
        )}
      </section>
    </>
  )
}

function InspectorPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const selectedId = useEditorStore((state) => state.selectedId)
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const objects = useSceneStore((state) => state.objects)
  const setLocalTransform = useSceneStore((state) => state.setLocalTransform)
  const renameObject = useSceneStore((state) => state.renameObject)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const multiple = useMemo(
    () => (selectedIds.length > 1 ? inHierarchyOrder(objects, selectedIds) : []),
    [objects, selectedIds]
  )

  if (multiple.length > 1) {
    return (
      <PanelFrame title={t('panels.inspector')} localKeys>
        <MultipleSelection ids={multiple} />
      </PanelFrame>
    )
  }

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

  // CAD 루트 아래 파트의 부모 축은 CAD 파일의 축이다(위가 +Y일 수도 있다). CAD 밖으로 옮긴 어셈블리의 하위도
  // cadOrigin을 따라 알린다. 부모의 방향이 CAD 루트와 다르면(중간 노드를 돌림) 알리지 않는다.
  const cadAxes = parentCadAxes(objects, object.id)

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
  // CAD 루트 밖으로 옮긴 파트는 어느 CAD에서 왔는지와 그 파일 상태를 보인다
  const originId = cadObjectId ? null : movedOutCadRoot(objects, object.id)

  const commit = (key: keyof Transform, axis: 0 | 1 | 2, input: number): void => {
    const next: Transform = { position: [...value.position], rotation: [...value.rotation] }
    next[key][axis] = input
    setLocalTransform(object.id, next)
  }

  return (
    <PanelFrame title={t('panels.inspector')} localKeys>
      {/* 선택이 바뀌면 입력칸을 새로 만든다. 그래야 이전 오브젝트에 쓰던 초안이 새 오브젝트에 확정되지 않는다. */}
      <Fragment key={object.id}>
        {/* Unity처럼 이름을 바로 고친다(Enter·포커스 이동으로 확정, Esc 취소, 빈 이름은 무시) */}
        <div className="inspector-object">
          <div className="inspector-name-field">
            <TextField
              label={t('inspector.name')}
              value={object.name}
              onCommit={(name) => renameObject(object.id, name)}
            />
          </div>
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
        {originId && <CadOriginSection cadObject={objects[originId]} />}
        {isCodeGroup(object) && <CodeGroupSection group={object} />}
        {isRobotRoot && <RobotHardwareSection robot={object} />}
        <HardwareComponentsSection object={object} />
      </Fragment>
    </PanelFrame>
  )
}

export default InspectorPanel
