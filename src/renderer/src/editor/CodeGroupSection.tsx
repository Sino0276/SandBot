import { useTranslation } from 'react-i18next'
import { groupClassName, groupCodePath } from '../hardware/codeScopes'
import { objectLevelIssues, useSceneIssues } from '../hardware/sceneIssues'
import type { IssueCode } from '../hardware/validation'
import { findRobotId, type SceneObject } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import IssueList from './hardware/IssueList'
import TextField from './TextField'

// 클래스 이름 칸을 빨갛게 표시하는 문제(그 칸을 고쳐 해결한다)
const CLASS_NAME_ISSUES = new Set<IssueCode>([
  'invalidGroupName',
  'reservedGroupName',
  'duplicateGroupClass'
])

// 메커니즘 그룹(Create Empty로 만든 그룹)이 생성 하드웨어 클래스에서 갖는 모습: 중첩 클래스 이름, 접근 경로
// (robot.lift), 상수의 형식 이름(MyBotHardware.Lift)과 이 그룹의 문제. 이름은 모두 codeScopes가 정한 값을 읽는다.
function CodeGroupSection({ group }: { group: SceneObject }): React.JSX.Element {
  const { t } = useTranslation()
  const objects = useSceneStore((state) => state.objects)
  const setCodeClassName = useSceneStore((state) => state.setCodeClassName)
  const issues = objectLevelIssues(useSceneIssues(), group.id)

  // 장치가 없거나 로봇 밖이면 클래스를 만들지 않아 경로가 없다
  const path = groupCodePath(objects, group.id)
  const inRobot = findRobotId(objects, group.id) !== null
  // 덮어쓰기를 비웠을 때 쓰는 이름(그룹 이름에서 만든 클래스 이름)
  const derivedClassName = groupClassName({ ...group, codeClassName: undefined })

  return (
    <section className="inspector-section" aria-label={t('inspector.group.title')}>
      <header className="inspector-section-header">
        <span>{t('inspector.group.title')}</span>
      </header>
      <div className="hw-row" title={t('inspector.group.classNameHint')}>
        <span className="hw-row-label">{t('inspector.group.className')}</span>
        <TextField
          label={t('inspector.group.className')}
          value={group.codeClassName ?? ''}
          placeholder={derivedClassName}
          invalid={issues.some((issue) => CLASS_NAME_ISSUES.has(issue.code))}
          onCommit={(className) => setCodeClassName(group.id, className)}
        />
      </div>
      {path ? (
        <>
          <div className="hw-row" title={t('inspector.group.accessHint')}>
            <span className="hw-row-label">{t('inspector.group.access')}</span>
            <code className="hw-path hw-code">{['robot', ...path.fieldPath].join('.')}</code>
          </div>
          <div className="hw-row" title={t('inspector.group.constantsHint')}>
            <span className="hw-row-label">{t('inspector.group.constants')}</span>
            <code className="hw-path hw-code">{path.typeName}</code>
          </div>
        </>
      ) : (
        <p className="inspector-note">
          {inRobot ? t('inspector.group.noHardware') : t('hardware.orphan')}
        </p>
      )}
      <IssueList issues={issues} />
    </section>
  )
}

export default CodeGroupSection
