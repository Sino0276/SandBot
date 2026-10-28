import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_EXPANSION_HUB_ADDRESS } from '../../hardware/catalog'
import { robotComponents, robotHardwareSettings } from '../../hardware/components'
import { configXmlFilePath, isValidJavaClassName, javaFilePath } from '../../hardware/naming'
import { useSceneIssues } from '../../hardware/sceneIssues'
import { uniqueIssues } from '../../hardware/validation'
import { useProjectStore, type GenerationResult } from '../../project/projectStore'
import type { RobotHardwareSettings, SceneObject } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import NumberField from '../NumberField'
import TextField from '../TextField'
import UsageSection from '../usages/UsageSection'
import { usePlayStore } from '../../play/playStore'
import IssueList from './IssueList'
import { drivetrainSummary } from './wheelCardModel'

type FileState = 'written' | 'unchanged' | 'skipped' | 'modified' | 'missing'

// 마지막 저장에서 이 파일이 어떻게 되었는지(생성 결과는 프로젝트 전체에 하나다)
function fileState(generation: GenerationResult | null, path: string): FileState | null {
  if (generation?.status !== 'synced') return null
  if (generation.written.includes(path)) return 'written'
  if (generation.unchanged.includes(path)) return 'unchanged'
  if (generation.skipped.includes(path)) return 'skipped'
  if (generation.modified.includes(path)) return 'modified'
  // 마지막 저장 뒤에 클래스 이름을 바꿨다
  return 'missing'
}

function GeneratedFiles({ paths }: { paths: string[] }): React.JSX.Element {
  const { t } = useTranslation()
  const generation = useProjectStore((state) => state.generation)
  const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

  let status: string | null = null
  switch (generation?.status) {
    case undefined:
      status = t('hardware.generation.notSaved')
      break
    case 'blocked':
      status = t('hardware.generation.blocked', { count: generation.errors })
      break
    case 'failed':
      status = t('hardware.generation.failed', { detail: generation.detail })
      break
    case 'noTeamCode':
      status = t('hardware.generation.noTeamCode')
      break
    case 'synced':
      if (generation.deleted.length > 0)
        status = t('hardware.generation.deleted', {
          files: generation.deleted.map(fileName).join(', ')
        })
  }

  return (
    <div className="hw-files">
      <span className="hw-row-label">{t('hardware.robot.files')}</span>
      {paths.map((path) => {
        const state = fileState(generation, path)
        return (
          <div key={path} className="hw-file">
            <code className="hw-path">{path}</code>
            {state && (
              <span className={`hw-file-state is-${state}`}>
                {t(`hardware.generation.fileStates.${state}`)}
              </span>
            )}
          </div>
        )
      })}
      {status && <p className="inspector-note">{status}</p>}
    </div>
  )
}

// 구동계 요약(시뮬레이터): 바퀴 수·종류와 INIT 때 Console에 남을 경고. 바퀴는 생성 코드와 관계없다.
function Drivetrain({ robotId }: { robotId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const batteryVoltage = usePlayStore((state) => state.settings.batteryVoltage)
  const summary = useMemo(
    () => drivetrainSummary(objects, robotId, { batteryVoltage }),
    [objects, robotId, batteryVoltage]
  )
  // 바퀴가 없다는 경고는 아래 안내 문장이 대신한다
  const warnings = summary.warnings.filter((warning) => warning.key !== 'worldNoWheels')
  return (
    <div className="hw-files">
      <span className="hw-row-label">{t('hardware.drivetrain.title')}</span>
      {summary.count === 0 ? (
        <p className="inspector-note">{t('hardware.drivetrain.none')}</p>
      ) : (
        <span className="hw-static">
          {t('hardware.drivetrain.summary', {
            count: summary.count,
            kinds: summary.kinds
              .map(({ kind, count }) =>
                t('hardware.drivetrain.kindCount', {
                  kind: t(`hardware.wheel.kinds.${kind}`),
                  count
                })
              )
              .join(', ')
          })}
        </span>
      )}
      {warnings.length > 0 && (
        <ul className="hw-issues">
          {warnings.map((warning, index) => (
            <li key={index} className="hw-issue is-warning">
              {t(`console.notices.${warning.key}`, warning.params)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// 로봇 하나의 생성 설정(하드웨어 클래스 이름, DS 구성 이름, Expansion Hub)과 생성 파일·문제 목록
function RobotHardwareSection({ robot }: { robot: SceneObject }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const setRobotHardware = useSceneStore((state) => state.setRobotHardware)
  const issues = uniqueIssues(useSceneIssues().filter((issue) => issue.robotId === robot.id))
  const settings = robotHardwareSettings(objects, robot.id)
  const componentCount = robotComponents(objects, robot.id).length

  const update = (patch: Partial<RobotHardwareSettings>): void =>
    setRobotHardware(robot.id, { ...settings, ...patch })

  return (
    <section className="inspector-section" aria-label={t('hardware.robot.title')}>
      <header className="inspector-section-header">
        <span>{t('hardware.robot.title')}</span>
        <span className="inspector-file">
          {t('hardware.robot.componentCount', { count: componentCount })}
        </span>
      </header>
      <div className="hw-row">
        <span className="hw-row-label">{t('hardware.robot.className')}</span>
        <TextField
          label={t('hardware.robot.className')}
          value={settings.className}
          invalid={!isValidJavaClassName(settings.className)}
          onCommit={(className) => update({ className: className.trim() })}
        />
      </div>
      <div className="hw-row">
        <span className="hw-row-label">{t('hardware.robot.configName')}</span>
        <TextField
          label={t('hardware.robot.configName')}
          value={settings.configName}
          invalid={!settings.configName.trim()}
          onCommit={(configName) => update({ configName: configName.trim() })}
        />
      </div>
      <div className="hw-row">
        <span className="hw-row-label">{t('hardware.robot.expansionHub')}</span>
        <div className="hw-inline">
          <label className="hw-check">
            <input
              type="checkbox"
              checked={settings.expansionHub.enabled}
              onChange={(event) =>
                update({
                  expansionHub: { ...settings.expansionHub, enabled: event.target.checked }
                })
              }
            />
            {t('hardware.robot.expansionHubEnabled')}
          </label>
          {settings.expansionHub.enabled && (
            <span className="hw-row-label">{t('hardware.robot.address')}</span>
          )}
          {settings.expansionHub.enabled && (
            <NumberField
              ariaLabel={t('hardware.robot.address')}
              value={settings.expansionHub.address}
              digits={0}
              onCommit={(address) =>
                update({
                  expansionHub: {
                    ...settings.expansionHub,
                    address: Number.isFinite(address)
                      ? Math.round(address)
                      : DEFAULT_EXPANSION_HUB_ADDRESS
                  }
                })
              }
            />
          )}
        </div>
      </div>
      {componentCount === 0 ? (
        <p className="inspector-note">{t('hardware.robot.noComponents')}</p>
      ) : (
        <>
          <GeneratedFiles
            paths={[javaFilePath(settings.className), configXmlFilePath(settings.className)]}
          />
          <div className="hw-files">
            <span className="hw-row-label">{t('hardware.robot.usage')}</span>
            <code className="hw-path">
              {`${settings.className} robot = new ${settings.className}(hardwareMap);`}
            </code>
          </div>
        </>
      )}
      <Drivetrain robotId={robot.id} />
      {/* 장치가 없는 로봇도 보인다(마지막 장치를 지운 뒤에도 TeamCode가 쓰는 없는 형식이 보이게) */}
      <UsageSection target={{ kind: 'robot', robotId: robot.id }} />
      {issues.length > 0 && (
        <>
          <span className="hw-row-label">
            {t('hardware.robot.issues', { count: issues.length })}
          </span>
          <IssueList issues={issues} linkObjects />
        </>
      )}
    </section>
  )
}

export default RobotHardwareSection
