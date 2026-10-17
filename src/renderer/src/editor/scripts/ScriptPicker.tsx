import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { refreshJavaIndex, scriptChoices, useJavaIndexStore } from '../../java/javaIndex'
import { useProjectStore } from '../../project/projectStore'
import { useSceneStore } from '../../scene/sceneStore'
import { closeScriptPicker, useScriptPickerStore, type ScriptPickerRequest } from '../dialogStore'

// 한 번에 그리는 최대 항목 수(TeamCode 파일은 수천 개까지 올 수 있다). 나머지는 검색으로 좁힌다.
const MAX_SHOWN = 200
// 창 가장자리 간격과 선택창 크기(px)
const EDGE = 4
const MIN_WIDTH = 260
const MAX_HEIGHT = 320

// 요청마다 새로 시작하도록(검색어·위치) key를 준다
const requestKeys = new WeakMap<ScriptPickerRequest, number>()
let nextKey = 0

function requestKey(request: ScriptPickerRequest): number {
  let key = requestKeys.get(request)
  if (key === undefined) {
    key = nextKey++
    requestKeys.set(request, key)
  }
  return key
}

function PickerPopup({ request }: { request: ScriptPickerRequest }): React.JSX.Element {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useProjectStore((state) => state.root)
  const status = useJavaIndexStore((state) => state.status)
  const indexRoot = useJavaIndexStore((state) => state.root)
  const files = useJavaIndexStore((state) => state.files)
  const truncated = useJavaIndexStore((state) => state.truncated)
  const scripts = useSceneStore((state) => state.objects[request.objectId]?.scripts)
  const objectExists = useSceneStore((state) => request.objectId in state.objects)
  const addScriptLink = useSceneStore((state) => state.addScriptLink)

  const linked = useMemo(() => new Set((scripts ?? []).map((script) => script.path)), [scripts])
  const current = root !== null && indexRoot === root
  const choices = useMemo(
    () => (current ? scriptChoices(files, linked, query) : []),
    [current, files, linked, query]
  )
  const shown = choices.slice(0, MAX_SHOWN)
  const activeIndex = Math.min(active, Math.max(shown.length - 1, 0))

  // 열 때 목록을 새로 읽는다(Android Studio에서 방금 만든 파일도 보이게)
  useEffect(() => {
    void refreshJavaIndex()
    inputRef.current?.focus()
  }, [])

  // 연 오브젝트가 사라지면 닫는다
  useEffect(() => {
    if (!objectExists) closeScriptPicker()
  }, [objectExists])

  // 연 컨트롤 아래에 두고, 자리가 없으면 위로 올린다. 창 밖으로 나가지 않게 옮긴다.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const { anchor } = request
    const width = Math.max(anchor.width, MIN_WIDTH)
    const { height } = element.getBoundingClientRect()
    const below = anchor.bottom + 2
    const top =
      below + height + EDGE <= window.innerHeight || anchor.top - height - 2 < EDGE
        ? below
        : anchor.top - height - 2
    element.style.width = `${width}px`
    element.style.left = `${Math.max(EDGE, Math.min(anchor.left, window.innerWidth - width - EDGE))}px`
    element.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE))}px`
  }, [request, shown.length])

  // 바깥을 누르거나, 창이 포커스를 잃거나, 크기가 바뀌면 닫는다(ContextMenu와 같음)
  useEffect(() => {
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && ref.current !== null && ref.current.contains(target)
    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target)) closeScriptPicker()
    }
    const close = (): void => closeScriptPicker()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [])

  // 키보드로 고른 항목이 보이게 스크롤한다
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const choose = (index: number): void => {
    const entry = shown[index]
    if (!entry) return
    addScriptLink(request.objectId, { path: entry.path, className: entry.className })
    closeScriptPicker()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    let handled = true
    switch (event.key) {
      case 'ArrowDown':
        setActive(shown.length === 0 ? 0 : (activeIndex + 1) % shown.length)
        break
      case 'ArrowUp':
        setActive(shown.length === 0 ? 0 : (activeIndex - 1 + shown.length) % shown.length)
        break
      case 'PageDown':
        setActive(Math.min(activeIndex + 10, Math.max(shown.length - 1, 0)))
        break
      case 'PageUp':
        setActive(Math.max(activeIndex - 10, 0))
        break
      case 'Enter':
        choose(activeIndex)
        break
      case 'Escape':
      case 'Tab':
        closeScriptPicker()
        break
      default:
        handled = false
    }
    // 선택창이 쓴 키는 창 단축키나 인스펙터로 넘기지 않는다
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  // 목록 대신 보일 안내
  let message: string | null = null
  if (!root) message = t('scripts.picker.noProject')
  else if (!current || status === 'loading' || status === 'none')
    message = t('scripts.picker.loading')
  else if (status === 'noTeamCode') message = t('scripts.picker.noTeamCode')
  else if (status === 'failed' && files.length === 0) message = t('scripts.picker.failed')
  else if (files.length === 0) message = t('scripts.picker.empty')
  else if (choices.length === 0)
    message = query.trim()
      ? t('scripts.picker.noMatch', { query: query.trim() })
      : t('scripts.picker.allLinked')

  const listId = `script-picker-list-${requestKey(request)}`
  const optionId = (index: number): string => `${listId}-${index}`

  return (
    <div
      ref={ref}
      className="script-picker"
      role="dialog"
      aria-label={t('scripts.picker.label')}
      style={{ left: request.anchor.left, top: request.anchor.bottom + 2, maxHeight: MAX_HEIGHT }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <input
        ref={inputRef}
        type="text"
        className="text-field script-picker-search"
        role="combobox"
        aria-label={t('scripts.picker.label')}
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={shown.length > 0 ? optionId(activeIndex) : undefined}
        aria-autocomplete="list"
        spellCheck={false}
        placeholder={t('scripts.picker.placeholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
      />
      {message ? (
        <p className="script-picker-message">{message}</p>
      ) : (
        <ul ref={listRef} id={listId} className="script-picker-list" role="listbox">
          {shown.map((entry, index) => (
            <li
              key={entry.path}
              id={optionId(index)}
              data-index={index}
              role="option"
              aria-selected={index === activeIndex}
              className={
                index === activeIndex ? 'script-picker-option is-active' : 'script-picker-option'
              }
              title={entry.path}
              // 검색 입력칸의 포커스를 지킨다
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span className="script-picker-name">{entry.simpleName}</span>
              <span className="script-picker-package">
                {entry.packageName || t('scripts.picker.defaultPackage')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!message && choices.length > shown.length && (
        <p className="script-picker-message">
          {t('scripts.picker.more', { count: choices.length - shown.length })}
        </p>
      )}
      {truncated && current && (
        <p className="script-picker-message">{t('scripts.picker.truncated')}</p>
      )}
    </div>
  )
}

// 스크립트 선택창(dialogStore의 openScriptPicker로 연다). 열려 있는 동안 창 단축키는 쓰지 않는다(isModalOpen).
function ScriptPicker(): React.JSX.Element | null {
  const request = useScriptPickerStore((state) => state.request)
  if (!request) return null
  return createPortal(<PickerPopup key={requestKey(request)} request={request} />, document.body)
}

export default ScriptPicker
