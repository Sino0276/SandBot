import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorStore } from '../../editor/editorStore'
import { useSceneStore } from '../../scene/sceneStore'
import { deviceRows, type DeviceRow } from '../deviceRows'
import { formatDeviceValue } from '../playFormat'
import { usePlayStore } from '../playStore'

// 장치 탭: 사이드카가 보낸 장치 출력(약 20 Hz)을 하이어라키의 컴포넌트 순서로. 행을 누르거나 Enter를 누르면 그 컴포넌트가
// 붙은 오브젝트를 고른다(씬에 없는 장치는 고를 수 없다). 값은 SDK 단위 그대로다.
function DevicesView(): React.JSX.Element {
  const { t } = useTranslation()
  const run = usePlayStore((state) => state.run)
  const objects = useSceneStore((state) => state.objects)
  const selectedId = useEditorStore((state) => state.selectedId)
  const outputs = run?.devices?.outputs
  const rows = useMemo(
    () => (run && outputs ? deviceRows(objects, run.robotId, outputs) : []),
    [objects, run, outputs]
  )

  if (!run) return <p className="panel-empty">{t('devices.noRun')}</p>
  if (rows.length === 0)
    return (
      <p className="panel-empty">
        {run.configPath === null ? t('devices.noConfig') : t('devices.empty')}
      </p>
    )

  const pick = (row: DeviceRow): void => {
    if (row.objectId && objects[row.objectId]) useEditorStore.getState().select(row.objectId)
  }

  return (
    <table className="devices-table">
      <thead>
        <tr>
          <th scope="col">{t('devices.name')}</th>
          <th scope="col">{t('devices.type')}</th>
          <th scope="col">{t('devices.values')}</th>
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
                {row.values.length === 0
                  ? '—'
                  : row.values.map(([key, value]) => (
                      <span key={key} className="devices-value">
                        <span className="devices-key">{key}</span>={formatDeviceValue(value)}
                      </span>
                    ))}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default DevicesView
