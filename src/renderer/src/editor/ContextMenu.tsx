import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  closeContextMenu,
  useContextMenuStore,
  type ContextMenuEntry,
  type ContextMenuRequest
} from './dialogStore'

// 메뉴가 창 가장자리에서 띄울 최소 간격(px)
const EDGE = 4

// 메뉴를 새로 열 때마다 처음 상태(위치·포커스)로 다시 시작하도록 요청마다 key를 준다
const menuKeys = new WeakMap<ContextMenuRequest, number>()
let nextMenuKey = 0

function menuKey(menu: ContextMenuRequest): number {
  let key = menuKeys.get(menu)
  if (key === undefined) {
    key = nextMenuKey++
    menuKeys.set(menu, key)
  }
  return key
}

type Item = Extract<ContextMenuEntry, { type: 'item' }>

function MenuPopup({ menu }: { menu: ContextMenuRequest }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const items = menu.entries.filter((entry): entry is Item => entry.type === 'item')
  // 항목(구분선 제외)마다 키보드 이동 순번
  const itemIndexes: number[] = []
  let itemCount = 0
  for (const entry of menu.entries) itemIndexes.push(entry.type === 'item' ? itemCount++ : -1)

  // 창 밖으로 나가지 않게 크기를 잰 뒤 옮긴다(그리기 전에 해서 깜빡이지 않는다)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    element.style.left = `${Math.max(EDGE, Math.min(menu.x, window.innerWidth - width - EDGE))}px`
    element.style.top = `${Math.max(EDGE, Math.min(menu.y, window.innerHeight - height - EDGE))}px`
  }, [menu.x, menu.y])

  // 열리면 첫 항목에 포커스를 둔다(WAI-ARIA 메뉴 패턴)
  useEffect(() => {
    itemRefs.current[0]?.focus({ preventScroll: true })
  }, [])

  // 바깥을 누르거나, 바깥에서 휠을 굴리거나, 창이 포커스를 잃거나, 크기가 바뀌면 닫는다.
  // scroll 이벤트는 듣지 않는다. 우클릭한 행을 선택하며 하이어라키가 스스로 스크롤해도 메뉴가 바로 닫히지 않게.
  useEffect(() => {
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && ref.current !== null && ref.current.contains(target)
    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target)) closeContextMenu()
    }
    const onWheel = (event: WheelEvent): void => {
      if (!inside(event.target)) closeContextMenu()
    }
    const close = (): void => closeContextMenu()
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
  }, [])

  const activate = (item: Item): void => {
    if (item.disabled) return
    // 먼저 닫고 행에 포커스를 돌려준 뒤 실행한다(이름 바꾸기 입력칸·대화상자가 그다음에 포커스를 가져간다)
    closeContextMenu(true)
    item.onSelect()
  }

  const focusItem = (index: number): void => {
    const count = items.length
    if (count === 0) return
    itemRefs.current[(index + count) % count]?.focus({ preventScroll: true })
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const current = itemRefs.current.findIndex((element) => element === document.activeElement)
    let handled = true
    switch (event.key) {
      case 'ArrowDown':
        focusItem(current + 1)
        break
      case 'ArrowUp':
        focusItem(current < 0 ? -1 : current - 1)
        break
      case 'Home':
        focusItem(0)
        break
      case 'End':
        focusItem(items.length - 1)
        break
      case 'Enter':
      case ' ':
        if (current >= 0) activate(items[current])
        break
      case 'Escape':
      case 'Tab':
        closeContextMenu(true)
        break
      default:
        handled = false
    }
    // 메뉴가 쓴 키는 창 단축키로 넘기지 않는다
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={menu.label}
      style={{ left: menu.x, top: menu.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.entries.map((entry, position) => {
        if (entry.type === 'separator')
          return <div key={entry.id} className="context-menu-separator" role="separator" />
        const index = itemIndexes[position]
        return (
          <div
            key={entry.id}
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            className={entry.disabled ? 'context-menu-item is-disabled' : 'context-menu-item'}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={entry.disabled || undefined}
            aria-keyshortcuts={entry.ariaKeyShortcuts}
            onClick={() => activate(entry)}
            onPointerEnter={() => focusItem(index)}
          >
            <span className="context-menu-label">{entry.label}</span>
            {entry.shortcut && <span className="context-menu-shortcut">{entry.shortcut}</span>}
          </div>
        )
      })}
    </div>
  )
}

// 우클릭 메뉴(dialogStore의 openContextMenu로 연다). 열려 있는 동안 창 단축키는 쓰지 않는다(isModalOpen).
function ContextMenu(): React.JSX.Element | null {
  const menu = useContextMenuStore((state) => state.menu)
  if (!menu) return null
  return createPortal(<MenuPopup key={menuKey(menu)} menu={menu} />, document.body)
}

export default ContextMenu
