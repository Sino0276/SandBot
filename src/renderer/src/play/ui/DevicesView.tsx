import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../../editor/editorStore'
import { DEG } from '../../scene/coordinates'
import { useSceneStore } from '../../scene/sceneStore'
import { useUnitStore } from '../../units/unitStore'
import { ANGLE_DIGITS, formatNumber, LENGTH_DIGITS, toDisplayLength } from '../../units/units'
import { deviceRows, jointRows, type DeviceRow, type JointRow } from '../deviceRows'
import { formatDeviceValue, tagsInputSummary } from '../playFormat'
import { usePlayStore } from '../playStore'

// 장치 탭: 사이드카가 보낸 장치 출력(약 20 Hz)과 시뮬레이터가 보낸 센서 값(허브 원시 값)을 하이어라키의 컴포넌트
// 순서로. 행을 누르거나 Enter를 누르면 그 컴포넌트가 붙은 오브젝트를 고른다(씬에 없는 장치는 고를 수 없다).
// 값은 SDK 단위 그대로다.
// 웹캠 입력 tags(4d)는 원소 대신 "태그 N장: id…"로 요약한다(다른 배열 — 모터 PIDF — 은 그대로)
function DeviceValueList({ values }: { values: DeviceRow['values'] }): React.JSX.Element {
  const { t } = useTranslation()
  if (values.length === 0) return <>—</>
  const text = (key: string, value: DeviceRow['values'][number][1]): string => {
    const tags = tagsInputSummary(key, value)
    if (!tags) return formatDeviceValue(value)
    return tags.count === 0 ? t('devices.tagsNone') : t('devices.tags', tags)
  }
  return (
    <>
      {values.map(([key, value]) => (
        <span key={key} className="devices-value">
          <span className="devices-key">{key}</span>={text(key, value)}
        </span>
      ))}
    </>
  )
}

// 관절 값 표(3b). 관절 값은 자세와 함께 약 60 Hz로 오므로 이 표만 자세를 구독한다(장치 표는 다시 그리지 않는다).
// 값은 표시 단위다(회전 °, 직선은 표시 길이 단위). 행을 누르면 그 관절 오브젝트를 고른다.
function JointsTable(): React.JSX.Element | null {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const selectedId = useEditorStore((state) => state.selectedId)
  const lengthUnit = useUnitStore((state) => state.lengthUnit)
  const data = usePlayStore(
    useShallow((state) => ({ run: state.run, simPose: state.simPose, ghostPose: state.ghostPose }))
  )
  const rows = useMemo(() => jointRows(objects, data), [objects, data])
  if (rows.length === 0) return null
  const valueText = (row: JointRow): string => {
    if (row.value === null) return '—'
    return row.type === 'revolute'
      ? `${formatNumber(row.value / DEG, ANGLE_DIGITS)}°`
      : `${formatNumber(toDisplayLength(row.value, lengthUnit), LENGTH_DIGITS[lengthUnit])} ${t(`units.symbols.${lengthUnit}`)}`
  }
  const pick = (row: JointRow): void => useEditorStore.getState().select(row.objectId)
  return (
    <table className="devices-table devices-joints" aria-label={t('devices.joints')}>
      <thead>
        <tr>
          <th scope="col" title={t('devices.jointsHint')}>
            {t('devices.jointName')}
          </th>
          <th scope="col">{t('devices.jointType')}</th>
          <th scope="col">{t('devices.jointValue')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.objectId}
            className={['is-selectable', row.objectId === selectedId && 'is-selected']
              .filter(Boolean)
              .join(' ')}
            tabIndex={0}
            title={t('devices.selectHint', { name: row.name })}
            onClick={() => pick(row)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                pick(row)
              }
            }}
          >
            <td className="devices-name">{row.name}</td>
            <td className="devices-type">{t(`joint.types.${row.type}`)}</td>
            <td className="devices-values">{valueText(row)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DevicesView(): React.JSX.Element {
  const { t } = useTranslation()
  const run = usePlayStore((state) => state.run)
  const objects = useSceneStore((state) => state.objects)
  const selectedId = useEditorStore((state) => state.selectedId)
  const outputs = run?.devices?.outputs
  const inputs = run?.devices?.inputs
  const rows = useMemo(
    () => (run && outputs ? deviceRows(objects, run.robotId, outputs, inputs) : []),
    [objects, run, outputs, inputs]
  )

  if (!run) return <p className="panel-empty">{t('devices.noRun')}</p>
  if (rows.length === 0)
    return (
      <>
        <p className="panel-empty">
          {run.configPath === null ? t('devices.noConfig') : t('devices.empty')}
        </p>
        <JointsTable />
      </>
    )

  const pick = (row: DeviceRow): void => {
    if (row.objectId && objects[row.objectId]) useEditorStore.getState().select(row.objectId)
  }

  return (
    <>
      <table className="devices-table">
        <thead>
          <tr>
            <th scope="col">{t('devices.name')}</th>
            <th scope="col">{t('devices.type')}</th>
            <th scope="col">{t('devices.values')}</th>
            <th scope="col" title={t('devices.inputsHint')}>
              {t('devices.inputs')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selectable = row.objectId !== null && objects[row.objectId] !== undefined
            return (
              <tr
                key={row.name}
                className={[
                  selectable && 'is-selectable',
                  selectable && row.objectId === selectedId && 'is-selected'
                ]
                  .filter(Boolean)
                  .join(' ')}
                tabIndex={selectable ? 0 : undefined}
                title={
                  selectable
                    ? t('devices.selectHint', { name: objects[row.objectId!].name })
                    : undefined
                }
                onClick={() => pick(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    pick(row)
                  }
                }}
              >
                <td className="devices-name">{row.name}</td>
                <td className="devices-type">{row.type ? t(`hardware.types.${row.type}`) : '—'}</td>
                <td className="devices-values">
                  <DeviceValueList values={row.values} />
                </td>
                <td className="devices-values devices-inputs">
                  <DeviceValueList values={row.inputs} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <JointsTable />
    </>
  )
}

export default DevicesView
