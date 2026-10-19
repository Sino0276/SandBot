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
  // 파일 자체를 쓸 수 있는지(UTF-8 왕복, 생성 표식 없음, 1 MB 이하)
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
  pending
}: {
  context: RowContext
  name: string
  declaration: string
  line: number
  pending: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const hint = t('inspector.tunables.fieldHint', { declaration, line })
  return (
    <span
      className={pending ? 'hw-row-label tunable-label is-pending' : 'hw-row-label tunable-label'}
      title={pending ? `${hint}\n${t('inspector.tunables.pending')}` : hint}
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
        />
        {control}
      </div>
      {display.fileValue !== null && entry && (
        <div className="tunable-file-changed">
          <span title={t('inspector.tunables.fileChangedHint')}>
            ⚠ {t('inspector.tunables.fileChanged', { value: display.fileValue })}
          </span>
          {/* 같은 값은 입력칸·체크박스로 다시 확정할 수 없으므로 고르는 버튼을 둔다(둘 다 실행 취소 한 단계) */}
          {editable && base !== null && (
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
  if (file.blocks.length === 0) return noConfig || null

  return (
    <div className="tunables">
      {fileNote && (
        <p className="inspector-note">{t(`inspector.tunables.fileReadOnly.${fileNote}`)}</p>
      )}
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
