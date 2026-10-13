import type { ReactNode } from 'react'

type PanelFrameProps = {
  title: string
  // 헤더 오른쪽에 둘 도구(전환 버튼 등)
  actions?: ReactNode
  // 씬 뷰처럼 내용이 패널을 꽉 채우고 스크롤하지 않는 경우 true
  fill?: boolean
  children: ReactNode
}

function PanelFrame({
  title,
  actions,
  fill = false,
  children
}: PanelFrameProps): React.JSX.Element {
  return (
    <section className="panel">
      <header className="panel-header">
        <span className="panel-title">{title}</span>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className={fill ? 'panel-body panel-body--fill' : 'panel-body'}>{children}</div>
    </section>
  )
}

export default PanelFrame
