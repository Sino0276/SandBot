import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorStore, type EditorTool } from './editorStore'

// Unity 툴바처럼 아이콘으로 고르는 씬 도구. 단축키는 Q·W·E(EditorLayout).
const ICONS: Record<EditorTool, ReactNode> = {
  // 손
  view: (
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.6a5 5 0 0 1-3.9-1.9L4 14.5a1.5 1.5 0 0 1 2.3-1.9L8 14.5" />
  ),
  // 네 방향 화살표
  translate: (
    <path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />
  ),
  // 회전 화살표
  rotate: <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
}

const TOOLS: { tool: EditorTool; labelKey: `scene.tools.${EditorTool}` }[] = [
  { tool: 'view', labelKey: 'scene.tools.view' },
  { tool: 'translate', labelKey: 'scene.tools.translate' },
  { tool: 'rotate', labelKey: 'scene.tools.rotate' }
]

function ToolButtons(): React.JSX.Element {
  const { t } = useTranslation()
  const tool = useEditorStore((state) => state.tool)
  const setTool = useEditorStore((state) => state.setTool)
  return (
    <div className="tool-buttons" role="radiogroup" aria-label={t('scene.tool')}>
      {TOOLS.map((item) => (
        <button
          key={item.tool}
          type="button"
          role="radio"
          aria-checked={tool === item.tool}
          aria-label={t(item.labelKey)}
          title={t(item.labelKey)}
          className={tool === item.tool ? 'tool-button is-active' : 'tool-button'}
          onClick={() => setTool(item.tool)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {ICONS[item.tool]}
          </svg>
        </button>
      ))}
    </div>
  )
}

export default ToolButtons
