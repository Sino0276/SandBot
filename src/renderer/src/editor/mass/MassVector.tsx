import type { Vec3 } from '../../scene/model'
import NumberField from '../NumberField'

const AXES = ['x', 'y', 'z'] as const

// 질량 카드의 세 값(무게중심·주관성). 읽기 전용은 인스펙터의 "로봇 중심 기준"과 같은 모양이다. 축 값이 아니면(주관성은
// 주축 방향의 값이라 X·Y·Z가 아니다) names로 칸 이름을 주고 축 색을 쓰지 않는다.
export function ReadonlyVector({
  label,
  unit,
  values,
  names,
  title
}: {
  label: string
  unit: string
  // 이미 형식을 맞춘 글자
  values: [string, string, string]
  names?: [string, string, string]
  title?: string
}): React.JSX.Element {
  return (
    <div className="mass-vector" title={title}>
      <span className="hw-row-label">
        {label} <span className="vector-row-unit">{unit}</span>
      </span>
      <div className="vector-row-fields">
        {AXES.map((axis, index) => (
          <span
            key={axis}
            className={names ? 'number-field is-readonly' : `number-field is-readonly axis-${axis}`}
          >
            <span className="number-field-label">{names ? names[index] : axis.toUpperCase()}</span>
            <output>{values[index]}</output>
          </span>
        ))}
      </div>
    </div>
  )
}

// 고칠 수 있는 세 축 값(표시 단위). parse는 입력 글자를 표시 단위 값으로 읽는다(단위를 붙인 입력).
export function EditableVector({
  values,
  digits,
  parse,
  title,
  onCommit
}: {
  values: Vec3
  digits: number
  parse: (text: string) => number | null
  title?: string
  onCommit: (axis: 0 | 1 | 2, value: number) => void
}): React.JSX.Element {
  return (
    <div className="vector-row-fields">
      {AXES.map((axis, index) => (
        <NumberField
          key={axis}
          label={axis.toUpperCase()}
          axis={axis}
          value={values[index]}
          digits={digits}
          parse={parse}
          title={title}
          onCommit={(value) => onCommit(index as 0 | 1 | 2, value)}
        />
      ))}
    </div>
  )
}
