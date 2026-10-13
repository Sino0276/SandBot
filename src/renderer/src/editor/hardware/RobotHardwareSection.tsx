import { useTranslation } from 'react-i18next'
import { DEFAULT_EXPANSION_HUB_ADDRESS } from '../../hardware/catalog'
import { robotComponents, robotHardwareSettings } from '../../hardware/components'
import { configXmlFilePath, isValidJavaClassName, javaFilePath } from '../../hardware/naming'
import { useSceneIssues } from '../../hardware/sceneIssues'
import { uniqueIssues } from '../../hardware/validation'
import { useProjectStore } from '../../project/projectStore'
import type { RobotHardwareSettings, SceneObject } from '../../scene/model'
import { useSceneStore } from '../../scene/sceneStore'
import NumberField from '../NumberField'
import TextField from '../TextField'
import IssueList from './IssueList'

function GenerationStatus(): React.JSX.Element {
  const { t } = useTranslation()
  const generation = useProjectStore((state) => state.generation)
  if (!generation) return <p className="inspector-note">{t('hardware.generation.notSaved')}</p>
  switch (generation.status) {
    case 'blocked':
      return (
        <p className="inspector-note">
          {t('hardware.generation.blocked', { count: generation.errors })}
        </p>
      )
    case 'failed':
      return (
        <p className="inspector-note">
          {t('hardware.generation.failed', { detail: generation.detail })}
        </p>
      )
    case 'noTeamCode':
      return <p className="inspector-note">{t('hardware.generation.noTeamCode')}</p>
    case 'synced':
      return (
        <p className="inspector-note">
          {t('hardware.generation.synced', {
            written: generation.written.length,
            unchanged: generation.unchanged.length,
            deleted: generation.deleted.length
          })}
          {generation.skipped.length > 0 && (
            <>
              <br />
              {t('hardware.generation.skipped', {
                files: generation.skipped.map((path) => path.split('/').pop()).join(', ')
              })}
            </>
          )}
        </p>
      )
  }
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
          <div className="hw-files">
            <span className="hw-row-label">{t('hardware.robot.files')}</span>
            <code className="hw-path">{javaFilePath(settings.className)}</code>
            <code className="hw-path">{configXmlFilePath(settings.className)}</code>
            <span className="hw-row-label">{t('hardware.robot.usage')}</span>
            <code className="hw-path">
              {`${settings.className} robot = new ${settings.className}(hardwareMap);`}
            </code>
          </div>
          <GenerationStatus />
        </>
      )}
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
