type SegmentedControlProps<T extends string> = {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} title={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'segmented-option is-active' : 'segmented-option'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default SegmentedControl
