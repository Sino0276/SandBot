import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../project/projectStore'
import {
  CODE_ANGLE_UNITS,
  CODE_LENGTH_UNITS,
  type CodeAngleUnit,
  type CodeLengthUnit
} from '../scene/projectSettings'
import { useSceneStore } from '../scene/sceneStore'
import { closeProjectSettings, useProjectSettingsStore } from './dialogStore'
import SettingsDialog from './SettingsDialog'

// 프로젝트 설정 > 코드 생성: 생성 하드웨어 클래스 상수의 단위. 씬 문서의 일부라 실행 취소·dirty에 들어가고, 저장(Ctrl+S)할 때
// 생성 코드에 쓴다. 프로젝트를 열거나 저장하는 동안에는 고치지 않는다(열기는 연 상태를 그 뒤에 잡는다).
function CodeGenerationPage(): React.JSX.Element {
  const { t } = useTranslation()
  const units = useSceneStore((state) => state.settings.codeUnits)
  const setCodeUnits = useSceneStore((state) => state.setCodeUnits)
  const busy = useProjectStore((state) => state.busy)
  return (
    <section className="preferences-page" aria-labelledby="project-settings-code">
      <h2 id="project-settings-code" className="preferences-page-title">
        {t('projectSettings.codeGeneration.title')}
      </h2>
      <label className="preferences-row">
        <span className="preferences-row-label">
          {t('projectSettings.codeGeneration.lengthUnit')}
        </span>
        <select
          className="field-select"
          value={units.length}
          disabled={busy}
          onChange={(event) =>
            setCodeUnits({ ...units, length: event.target.value as CodeLengthUnit })
          }
        >
          {CODE_LENGTH_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`projectSettings.codeGeneration.lengthUnits.${unit}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="preferences-row">
        <span className="preferences-row-label">
          {t('projectSettings.codeGeneration.angleUnit')}
        </span>
        <select
          className="field-select"
          value={units.angle}
          disabled={busy}
          onChange={(event) =>
            setCodeUnits({ ...units, angle: event.target.value as CodeAngleUnit })
          }
        >
          {CODE_ANGLE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`projectSettings.codeGeneration.angleUnits.${unit}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="inspector-note">{t('projectSettings.codeGeneration.sdkHint')}</p>
      <p className="inspector-note">{t('projectSettings.codeGeneration.renameHint')}</p>
    </section>
  )
}

const CATEGORIES = ['codeGeneration'] as const
type Category = (typeof CATEGORIES)[number]

function ProjectSettingsDialog(): React.JSX.Element {
  const { t } = useTranslation()
  const [category, setCategory] = useState<Category>('codeGeneration')
  return (
    <SettingsDialog
      title={t('projectSettings.title')}
      categories={CATEGORIES.map((id) => ({ id, label: t(`projectSettings.${id}.title`) }))}
      category={category}
      onCategory={setCategory}
      onClose={closeProjectSettings}
      isOpen={() => useProjectSettingsStore.getState().open}
    >
      {category === 'codeGeneration' && <CodeGenerationPage />}
    </SettingsDialog>
  )
}

// 프로젝트 설정 창(Unity의 Edit > Project Settings). 툴바 버튼으로 열고, 열려 있는 동안 창 단축키는 쓰지 않는다(isModalOpen).
// 환경 설정(개인, 이 PC)과 달리 팀이 함께 쓰는 project.json의 설정이다.
function ProjectSettingsWindow(): React.JSX.Element | null {
  const open = useProjectSettingsStore((state) => state.open)
  return open ? <ProjectSettingsDialog /> : null
}

export default ProjectSettingsWindow
