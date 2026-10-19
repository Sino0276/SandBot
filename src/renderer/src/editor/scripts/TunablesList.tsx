import { useTranslation } from 'react-i18next'
import type {
  TunableBlock,
  TunableNode,
  TunableReadOnlyReason,
  TunableValueType
} from '../../../../shared/java/tunableTypes'
import { currentJavaSource, useJavaSourcesStore } from '../../java/javaSources'
import { openScriptFile } from '../../java/openScript'
import {
  diskLiteralKey,
  displayTunable,
  isEditableValue,
  tunableEditValue,
  type TunableFileEdits,
  type TunableValueNode
} from '../../java/tunableEdits'
import { useProjectStore } from '../../project/projectStore'
import { useSceneStore } from '../../scene/sceneStore'
import TextField from '../TextField'

// 연결한 Java 파일의 튜닝 값(FTC Dashboard와 같은 @Config 필드, shared/java/tunables.ts). 스크립트 카드 안에
// @Config 클래스마다 한 묶음(Dashboard에 보이는 이름)을 두고, 필드를 소스 순서로 보인다. 객체 필드(RR 1.0 PARAMS)의
// 자식은 들여 쓴다. 고친 값은 저장(Ctrl+S)할 때 파일에 쓰고, 그 전까지 저장하지 않은 값이다(굵게, 실행 취소 가능).
// 코드 값이라 표시 단위로 바꾸지 않는다.

// 칸 제목에 보일 Java 형식
const BOXED: Record<TunableValueType, string> = {
  boolean: 'Boolean',
  int: 'Integer',
  long: 'Long',
  float: 'Float',
  double: 'Double',
  String: 'String'
}

const javaTypeName = (node: TunableValueNode): string => (node.boxed ? BOXED[node.type] : node.type)

type RowContext = {
  path: string
  // 파일 자체를 쓸 수 있는지(UTF-8 왕복, 생성 표식 없음, 읽기 전용 아님, 1 MB 이하)
  fileEditable: boolean
  edits: TunableFileEdits | undefined
}

function ReadOnlyValue({
  text,
  reason
}: {
  text: string
  reason: TunableReadOnlyReason
}): React.JSX.Element {
  const { t } = useTranslation()
  const why = t(`inspector.tunables.readOnly.${reason}`)
  return (
    <span className="tunable-readonly" title={why}>
      <code className="tunable-code">{text || '—'}</code>
      <span className="tunable-reason">{why}</span>
    </span>
  )
}

function FieldLabel({
  context,
  name,
  declaration,
  line,
  pending,
  pendingHint
}: {
  context: RowContext
  name: string
  declaration: string
  line: number
  pending: boolean
  // 저장하지 않은 값의 설명(없으면 저장할 때 쓴다는 기본 설명)
  pendingHint?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const hint = t('inspector.tunables.fieldHint', { declaration, line })
  return (
    <span
      className={pending ? 'hw-row-label tunable-label is-pending' : 'hw-row-label tunable-label'}
      title={pending ? `${hint}\n${pendingHint ?? t('inspector.tunables.pending')}` : hint}
      onDoubleClick={() => void openScriptFile(context.path, line)}
    >
      {name}
    </span>
  )
}

function ValueRow({
  context,
  node
}: {
  context: RowContext
  node: TunableValueNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const setTunable = useSceneStore((state) => state.setTunable)
  const entry = context.edits?.[node.id]
  const editable = context.fileEditable && isEditableValue(node)
  const display = displayTunable(node, entry, editable)
  const base = diskLiteralKey(node)
  // [SandBot 값 쓰기]로 남길 값: 저장하지 않은 값을 지금 필드 형식으로 다시 만든다(밖에서 형식이 바뀌면 그대로는 맞지
  // 않는다: double 0.25 → float 0.25f). 지금 형식으로 받을 수 없으면(double → int) null이라 버튼을 숨긴다.
  const kept = editable && base !== null ? tunableEditValue(node, display.text) : null
  // 저장하지 않은 값이 있지만 지금은 고칠 수 없다. 파일을 쓸 수 없으면 저장이 값을 남기고(실패), 필드가 고칠 수 없게
  // 바뀌었으면 저장이 파일 값을 따른다(충돌, java/tunableSave.ts). 어느 쪽이든 [파일 값 따르기]로 버릴 수 있다.
  const lockedHint =
    entry && !editable
      ? t(
          context.fileEditable
            ? 'inspector.tunables.pendingFieldLocked'
            : 'inspector.tunables.pendingFileLocked'
        )
      : undefined
  const declaration = `${javaTypeName(node)} ${node.name}`
  // 받을 수 없는 입력은 버린다(입력칸은 초안을 지우고 이전 값으로 돌아간다, NumberField와 같음)
  const commit = (input: string): void => {
    const value = tunableEditValue(node, input)
    if (value !== null && base !== null) setTunable(context.path, node.id, value, base)
  }

  let control: React.JSX.Element
  if (!editable) {
    control = (
      <ReadOnlyValue
        text={display.text}
        reason={node.reason ?? (context.fileEditable ? 'expression' : 'file')}
      />
    )
  } else if (node.type === 'boolean') {
    control = (
      <label className="hw-check">
        <input
          type="checkbox"
          aria-label={node.name}
          checked={display.text === 'true'}
          onChange={(event) => commit(event.target.checked ? 'true' : 'false')}
        />
      </label>
    )
  } else {
    control = <TextField label={node.name} value={display.text} onCommit={commit} />
  }

  return (
    <>
      <div className={display.pending ? 'hw-row tunable-row is-pending' : 'hw-row tunable-row'}>
        <FieldLabel
          context={context}
          name={node.name}
          declaration={declaration}
          line={node.line}
          pending={display.pending}
          pendingHint={lockedHint}
        />
        {control}
      </div>
      {display.fileValue !== null && entry && editable && (
        <div className="tunable-file-changed">
          <span title={t('inspector.tunables.fileChangedHint')}>
            ⚠ {t('inspector.tunables.fileChanged', { value: display.fileValue })}
          </span>
          {/* 같은 값은 입력칸·체크박스로 다시 확정할 수 없으므로 고르는 버튼을 둔다(둘 다 실행 취소 한 단계) */}
          {base !== null && (
            <>
              {kept !== null && (
                <button
                  type="button"
                  className="panel-button"
                  title={t('inspector.tunables.keepValueHint')}
                  onClick={() => setTunable(context.path, node.id, kept, base)}
                >
                  {t('inspector.tunables.keepValue')}
                </button>
              )}
              <button
                type="button"
                className="panel-button"
                title={t('inspector.tunables.useFileValueHint')}
                onClick={() => setTunable(context.path, node.id, base, base)}
              >
                {t('inspector.tunables.useFileValue')}
              </button>
            </>
          )}
        </div>
      )}
      {/* 칸은 저장하지 않은 값을 보이고, 여기에 파일 값과 버리는 버튼을 둔다. 버튼은 편집의 base를 value·base로
          넘긴다(withTunable은 value === base면 항목을 지운다). 지금 디스크 글자(식 등)는 base가 될 수 없어서다. */}
      {entry && lockedHint && (
        <div className="tunable-file-changed">
          <span title={lockedHint}>
            {display.fileValue !== null && '⚠ '}
            {t('inspector.tunables.fileChanged', {
              value: display.fileValue ?? node.literal ?? '—'
            })}
          </span>
          <button
            type="button"
            className="panel-button"
            title={t('inspector.tunables.useFileValueHint')}
            onClick={() => setTunable(context.path, node.id, entry.base, entry.base)}
          >
            {t('inspector.tunables.useFileValue')}
          </button>
        </div>
      )}
    </>
  )
}

function NodeRow({ context, node }: { context: RowContext; node: TunableNode }): React.JSX.Element {
  if (node.kind === 'value') return <ValueRow context={context} node={node} />
  const declaration = `${node.kind === 'object' ? node.typeName : node.typeText} ${node.name}`
  if (node.kind === 'other')
    return (
      <div className="hw-row tunable-row">
        <FieldLabel
          context={context}
          name={node.name}
          declaration={declaration}
          line={node.line}
          pending={false}
        />
        <ReadOnlyValue text={node.text ?? ''} reason={node.reason} />
      </div>
    )
  return (
    <>
      <div className="hw-row tunable-row">
        <FieldLabel
          context={context}
          name={node.name}
          declaration={declaration}
          line={node.line}
          pending={false}
        />
        {node.reason ? (
          <ReadOnlyValue text={node.text ?? ''} reason={node.reason} />
        ) : (
          <code className="tunable-code tunable-type">{node.typeName}</code>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="tunable-children">
          {node.children.map((child) => (
            <NodeRow key={child.id} context={context} node={child} />
          ))}
        </div>
      )}
    </>
  )
}

function BlockView({
  context,
  block
}: {
  context: RowContext
  block: TunableBlock
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      className="tunable-block"
      aria-label={t('inspector.tunables.blockLabel', { name: block.name })}
    >
      <header
        className="tunable-block-header"
        title={t('inspector.tunables.blockHint', { name: block.name, classPath: block.classPath })}
      >
        <span className="tunable-block-name">{block.name}</span>
        <span className="script-tag">{t('inspector.tunables.configTag')}</span>
      </header>
      {block.fields.map((field) => (
        <NodeRow key={field.id} context={context} node={field} />
      ))}
    </section>
  )
}

function TunablesList({ path }: { path: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  const root = useProjectStore((state) => state.root)
  const session = useProjectStore((state) => state.session)
  const source = useJavaSourcesStore((state) => currentJavaSource(state, { root, session }, path))
  const edits = useSceneStore((state) => state.tunables[path])

  if (!root) return null
  if (!source) return <p className="script-status">{t('inspector.tunables.loading')}</p>
  // 없는 파일은 카드가 [다시 연결]과 함께 알린다
  if (source.status === 'missing') return null
  if (source.status === 'failed')
    return <p className="inspector-note">{t('inspector.tunables.readFailed')}</p>

  const file = source.tunables
  const context: RowContext = { path, fileEditable: source.editable, edits }
  const fileNote = !source.editable
    ? (source.reason ?? 'encoding')
    : file.unicodeEscapes
      ? 'unicodeEscape'
      : null
  const noConfig = file.staticFieldsWithoutConfig && (
    <p className="inspector-note">{t('inspector.tunables.noConfig')}</p>
  )
  const note = fileNote && (
    <p className="inspector-note">{t(`inspector.tunables.fileReadOnly.${fileNote}`)}</p>
  )
  // 묶음이 없을 때: 1 MB를 넘은 파일은 내용을 읽지 않았으므로(빈 글자) 늘 알린다. 그 밖의 이유는 @Config 안내가
  // 보일 때만 함께 보인다(튜닝 값이 없는 파일마다 "보기만 한다"고 하지 않게).
  if (file.blocks.length === 0)
    return source.reason === 'tooLarge' || noConfig ? (
      <>
        {note}
        {noConfig}
      </>
    ) : null

  return (
    <div className="tunables">
      {note}
      {file.blocks.map((block) => (
        <BlockView key={block.classPath} context={context} block={block} />
      ))}
      {noConfig}
      <p className="inspector-note">{t('inspector.tunables.sharedHint')}</p>
      <p className="inspector-note">{t('inspector.tunables.dashboardHint')}</p>
    </div>
  )
}

export default TunablesList
