import { useTranslation } from 'react-i18next'
import type { Issue } from '../../hardware/validation'
import { useEditorStore } from '../editorStore'

type IssueListProps = {
  issues: Issue[]
  // 문제가 있는 오브젝트를 선택하는 링크로 보여 줄지(로봇 전체 목록)
  linkObjects?: boolean
}

function IssueList({ issues, linkObjects = false }: IssueListProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const select = useEditorStore((state) => state.select)
  if (issues.length === 0) return null
  return (
    <ul className="hw-issues">
      {issues.map((issue, index) => {
        const text = t(`hardware.issues.${issue.code}`, issue.params)
        return (
          <li key={index} className={`hw-issue is-${issue.severity}`}>
            {linkObjects && issue.objectId ? (
              <button
                type="button"
                className="hw-issue-link"
                onClick={() => select(issue.objectId!)}
              >
                {text}
              </button>
            ) : (
              text
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default IssueList
