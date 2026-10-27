import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { OpModeInfo } from '../../../../shared/play'
import { displayJavaPath } from '../../java/javaIndex'
import { useProjectStore } from '../../project/projectStore'
import { findOpMode, opModeSections, orderedOpModes } from '../opModeList'
import { refreshOpModes, selectOpMode } from '../playActions'
import { isRunActive, usePlayStore } from '../playStore'
import { PlayIcon } from './PlayIcons'

// 창 가장자리 간격·선택 목록 크기(px)
const EDGE = 4
const MIN_WIDTH = 240
const PAGE = 8

type Anchor = { left: number; top: number; bottom: number; width: number }

function simpleClassName(className: string): string {
  return className.slice(Math.max(className.lastIndexOf('.'), className.lastIndexOf('$')) + 1)
}

// Driver Station처럼 TeleOp·Autonomous를 나누고 group 머리를 단 선택 목록(role="listbox"). 목록이 포커스를 갖고
// 위/아래·Home/End·PageUp/PageDown으로 움직이며 Enter·Space로 고른다. 열려 있는 동안의 키는 창 단축키로 넘기지 않는다.
// 바깥을 누르거나 창이 포커스를 잃으면 닫는다(우클릭 메뉴와 같음).
function OpModePopup({
  anchor,
  onClose
}: {
  anchor: Anchor
  onClose: (restoreFocus: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const list = usePlayStore((state) => state.opModeList)
  const selectedClass = usePlayStore((state) => state.selectedClass)
  const root = useProjectStore((state) => state.root)
  const current = list.root === root
  const sections = useMemo(() => (current ? opModeSections(list.opModes) : []), [current, list])
  const ordered = useMemo(() => orderedOpModes(sections), [sections])
  // 키보드로 가리킨 항목(클래스 이름). 목록이 다시 읽혀도 같은 항목을 가리킨다.
  const [activeClass, setActiveClass] = useState<string | null>(selectedClass)
  const activeIndex = Math.max(
    0,
    ordered.findIndex((opMode) => opMode.className === activeClass)
  )

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const width = Math.max(anchor.width, MIN_WIDTH)
    const { height } = element.getBoundingClientRect()
    const below = anchor.bottom + 2
    const top =
      below + height + EDGE <= window.innerHeight || anchor.top - height - 2 < EDGE
        ? below
        : anchor.top - height - 2
    element.style.minWidth = `${width}px`
    const actualWidth = element.getBoundingClientRect().width
    element.style.left = `${Math.max(EDGE, Math.min(anchor.left, window.innerWidth - actualWidth - EDGE))}px`
    element.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE))}px`
  }, [anchor, ordered.length, list.status])

  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>(`[data-opmode-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && ref.current !== null && ref.current.contains(target)
    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target)) onClose(false)
    }
    const onWheel = (event: WheelEvent): void => {
      if (!inside(event.target)) onClose(false)
    }
    const close = (): void => onClose(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('wheel', onWheel, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  const choose = (opMode: OpModeInfo): void => {
    selectOpMode(opMode.className)
    onClose(true)
  }

  const move = (index: number): void => {
    if (ordered.length === 0) return
    setActiveClass(ordered[Math.max(0, Math.min(ordered.length - 1, index))].className)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // 열려 있는 동안의 키는 이 목록 몫이다(Delete·F·Ctrl+Z 등이 뒤의 씬에 가지 않게)
    event.stopPropagation()
    switch (event.key) {
      case 'ArrowDown':
        move(activeIndex + 1)
        break
      case 'ArrowUp':
        move(activeIndex - 1)
        break
      case 'PageDown':
        move(activeIndex + PAGE)
        break
      case 'PageUp':
        move(activeIndex - PAGE)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(ordered.length - 1)
        break
      case 'Enter':
      case ' ':
        if (ordered[activeIndex]) choose(ordered[activeIndex])
        break
      case 'Escape':
      case 'Tab':
        onClose(true)
        break
      default:
        return
    }
    event.preventDefault()
  }

  const message = !current
    ? t('play.list.loading')
    : list.status === 'loading'
      ? t('play.list.loading')
      : list.status === 'failed'
        ? t('play.list.failed', { detail: list.detail })
        : !list.hasTeamCode
          ? t('play.list.noTeamCode')
          : ordered.length === 0
            ? t('play.list.empty')
            : null

  let index = 0
  return (
    <div
      ref={ref}
      className="opmode-popup"
      role="listbox"
      tabIndex={-1}
      aria-label={t('play.opModeList')}
      aria-activedescendant={ordered.length > 0 ? `opmode-option-${activeIndex}` : undefined}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {message && <p className="opmode-message">{message}</p>}
      {sections.map((section) => (
        <div key={section.flavor} className="opmode-section">
          <div className="opmode-flavor" aria-hidden="true">
            {t(`play.flavors.${section.flavor}`)}
          </div>
          {section.groups.map((group) => (
            <div
              key={group.group}
              role="group"
              aria-label={
                group.group
                  ? `${t(`play.flavors.${section.flavor}`)} · ${group.group}`
                  : t(`play.flavors.${section.flavor}`)
              }
            >
              {group.group && (
                <div className="opmode-group" aria-hidden="true">
                  {group.group}
                </div>
              )}
              {group.opModes.map((opMode) => {
                const position = index++
                const simple = simpleClassName(opMode.className)
                return (
                  <div
                    key={opMode.className}
                    id={`opmode-option-${position}`}
                    data-opmode-index={position}
                    role="option"
                    aria-selected={opMode.className === selectedClass}
                    className={
                      position === activeIndex ? 'opmode-option is-active' : 'opmode-option'
                    }
                    title={`${opMode.className}\n${opMode.path}`}
                    onPointerMove={() => setActiveClass(opMode.className)}
                    onClick={() => choose(opMode)}
                  >
                    <span className="opmode-check" aria-hidden="true">
                      {opMode.className === selectedClass ? '✓' : ''}
                    </span>
                    <span className="opmode-name">{opMode.name}</span>
                    {opMode.name !== simple && <span className="opmode-class">{simple}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ))}
      {current && list.truncated && <p className="opmode-message">{t('play.list.truncated')}</p>}
    </div>
  )
}

// 툴바의 OpMode 선택(DS의 OpMode 목록). 실행하는 동안에는 바꾸지 않는다.
function OpModePicker(): React.JSX.Element {
  const { t } = useTranslation()
  const root = useProjectStore((state) => state.root)
  const list = usePlayStore((state) => state.opModeList)
  const selectedClass = usePlayStore((state) => state.selectedClass)
  const runActive = usePlayStore((state) => isRunActive(state.run))
  const runOpMode = usePlayStore((state) => (isRunActive(state.run) ? state.run.opMode : null))
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  const selected =
    runOpMode ?? (list.root === root ? findOpMode(list.opModes, selectedClass) : null)
  const disabled = !root || runActive
  const label = selected
    ? selected.name
    : !root
      ? t('play.noProjectShort')
      : list.root === root && list.status === 'ready' && list.opModes.length === 0
        ? t('play.noOpModes')
        : t('play.chooseOpMode')

  const open = (): void => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect || disabled) return
    // 열 때 목록을 다시 읽는다(Android Studio에서 방금 만든 OpMode도 보이게)
    void refreshOpModes()
    setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width })
  }

  const close = useCallback((restoreFocus: boolean): void => {
    setAnchor(null)
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true })
  }, [])

  const title = selected
    ? t('play.opModeTooltip', {
        flavor: t(`play.flavors.${selected.flavor}`),
        name: selected.name,
        className: selected.className,
        file: displayJavaPath(selected.path)
      })
    : !root
      ? t('play.disabled.noProject')
      : t('play.chooseOpModeTooltip')

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={selected ? 'opmode-button' : 'opmode-button is-placeholder'}
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        aria-label={`${t('play.opMode')}: ${label}`}
        title={title}
        disabled={disabled}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !event.altKey && !event.ctrlKey) {
            event.preventDefault()
            open()
          }
        }}
      >
        {selected && (
          <span className={`opmode-flavor-badge is-${selected.flavor}`}>
            {t(`play.flavorShort.${selected.flavor}`)}
          </span>
        )}
        <span className="opmode-button-name">{label}</span>
        <PlayIcon name="caret" size={12} />
      </button>
      {anchor && createPortal(<OpModePopup anchor={anchor} onClose={close} />, document.body)}
    </>
  )
}

export default OpModePicker
