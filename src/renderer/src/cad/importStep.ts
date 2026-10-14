import { BufferAttribute, BufferGeometry } from 'three'
import type { StepReadResult } from '../../../shared/ipc'
import { showDialog } from '../editor/dialogStore'
import { useEditorStore } from '../editor/editorStore'
import {
  dismissNotice,
  setNoticePhase,
  showNotice,
  type ImportPhase,
  type NoticeKey
} from '../editor/noticeStore'
import i18n from 'i18next'
import { useProjectStore } from '../project/projectStore'
import { disposeGeometry, geometryIds, registerGeometry } from '../scene/geometryRegistry'
import type { MeshIndexing } from '../scene/model'
import { useSceneStore } from '../scene/sceneStore'
import { loadAlignmentPreference } from './alignmentPreference'
import { beginImport, endImport } from './importStore'
import {
  buildSceneObjects,
  droppedMeshCount,
  isImportedModel,
  MESH_CACHE_TAG,
  meshGeometryIds,
  type ImportedMesh,
  type ImportedModel
} from './stepImport'
import type { StepImportErrorCode, StepWorkerRequest, StepWorkerResponse } from './stepWorker'

// STEP 변환기: 네이티브(메인 프로세스가 실행하는 native/step-converter) 또는 내장 WASM(렌더러 워커).
// 네이티브는 WASM과 같은 C++ 코드라 결과가 같고, 메모리 한도(2 GB)가 없다. 이 PC에서 쓸 수 없으면 WASM으로 읽는다.
export type StepEngine = 'native' | 'wasm'

export class StepImportError extends Error {
  constructor(
    readonly code: StepImportErrorCode,
    detail: string,
    // 실패한 변환기. 알림 문구를 고를 때 쓴다(WASM의 메모리 실패는 대개 파일 크기 문제).
    readonly engine: StepEngine
  ) {
    super(detail || code)
  }
}

export function isStepFileName(name: string): boolean {
  return /\.(step|stp)$/i.test(name)
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

let converterAvailable: Promise<boolean> | null = null

// 네이티브 변환기를 쓸 수 있는지(앱을 실행하는 동안 한 번 확인)
export function hasNativeConverter(): Promise<boolean> {
  converterAvailable ??= window.api.hasStepConverter().catch(() => false)
  return converterAvailable
}

function cancelled(engine: StepEngine): StepImportError {
  return new StepImportError('cancelled', '', engine)
}

// 워커에서 STEP(WASM) 또는 네이티브 결과를 변환한다. buffer는 워커로 넘어가므로 이후 쓸 수 없다.
// 취소하면 워커를 멈춘다.
export function parseStep(
  kind: StepWorkerRequest['kind'],
  buffer: ArrayBuffer,
  fileName: string,
  signal?: AbortSignal
): Promise<ImportedModel> {
  const engine: StepEngine = kind
  if (signal?.aborted) return Promise.reject(cancelled(engine))
  const worker = new Worker(new URL('./stepWorker.ts', import.meta.url), { type: 'module' })
  return new Promise<ImportedModel>((resolve, reject) => {
    const onAbort = (): void => {
      worker.terminate()
      reject(cancelled(engine))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (): void => {
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    worker.onmessage = (event: MessageEvent<StepWorkerResponse>) => {
      finish()
      if (event.data.ok) resolve(event.data.model)
      else reject(new StepImportError(event.data.code, event.data.detail, engine))
    }
    worker.onerror = (event) => {
      finish()
      reject(new StepImportError('unknown', event.message, engine))
    }
    const request: StepWorkerRequest = { kind, buffer, fileName }
    worker.postMessage(request, [buffer])
  })
}

export type LoadStepOptions = {
  signal?: AbortSignal
  // 진행 단계와 그 단계 안의 진행률(0~1, 모르면 null)
  onPhase?: (phase: ImportPhase, fraction?: number | null) => void
  // 이미 찾아 둔 캐시 결과(큰 파일 확인 때 읽었으면 다시 읽지 않는다)
  lookup?: StepReadResult
}

// untranslated: 네이티브 변환기가 예외로 건너뛴 STEP 엔티티 수(일부 형상이 빠졌을 수 있다)
export type LoadedStep = {
  model: ImportedModel
  engine: StepEngine | 'cache'
  untranslated?: number
}

// 메시 캐시 저장(모델 전체를 메인 프로세스로 복사)은 화면에 먼저 보여 준 뒤에 한다. 실패해도 불러오기는 계속한다.
function storeCacheLater(key: string, model: ImportedModel): void {
  setTimeout(() => {
    window.api.storeMeshCache(key, model).catch((error) => {
      console.warn('메시 캐시 저장 실패', error)
    })
  }, 500)
}

// 워커로 넘길 제 크기 버퍼(IPC로 받은 배열은 다른 데이터와 버퍼를 나눠 쓸 수 있다)
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer)
}

const convertErrorCodes = {
  readFailed: 'readFailed',
  outOfMemory: 'outOfMemory',
  cancelled: 'cancelled',
  failed: 'unknown'
} as const satisfies Record<string, StepImportErrorCode>

// 네이티브 변환기로 변환한다. 쓸 수 없으면(unavailable) null.
async function convertNative(
  path: string,
  fileName: string,
  options: LoadStepOptions
): Promise<LoadedStep | null> {
  const { signal, onPhase } = options
  const requestId = crypto.randomUUID()
  const unsubscribe = window.api.onStepConvertProgress((id, progress, fraction) => {
    if (id === requestId) onPhase?.(progress, fraction)
  })
  const onAbort = (): void => window.api.cancelStepConversion(requestId)
  signal?.addEventListener('abort', onAbort, { once: true })
  let result
  try {
    result = await window.api.convertStep(path, MESH_CACHE_TAG, requestId)
  } finally {
    unsubscribe()
    signal?.removeEventListener('abort', onAbort)
  }
  if (!result.ok) {
    if (result.code === 'unavailable') return null
    throw new StepImportError(convertErrorCodes[result.code], result.detail, 'native')
  }
  onPhase?.('build')
  const model = await parseStep('native', ownBuffer(result.bytes), fileName, signal)
  // OCCT가 예외로 건너뛰었거나 삼각형을 만들지 못한 형상이 있으면(대개 메모리 부족) 캐시하지 않는다(다음에 다시 시도하게)
  if (result.untranslated === 0 && droppedMeshCount(model) === 0) storeCacheLater(result.key, model)
  return { model, engine: 'native', untranslated: result.untranslated }
}

// 디스크의 STEP을 변환 결과로 읽는다. 메시 캐시(앱 데이터 폴더)에 있으면 변환하지 않는다. 파일이 없으면 null.
export async function loadStepModel(
  path: string,
  fileName: string,
  options: LoadStepOptions = {}
): Promise<LoadedStep | null> {
  const { signal, onPhase } = options
  const native = await hasNativeConverter()
  if (signal?.aborted) throw cancelled(native ? 'native' : 'wasm')
  if (!options.lookup) onPhase?.('checking')
  // 네이티브는 파일을 직접 읽으므로 내용을 렌더러로 보내지 않는다
  const lookup = options.lookup ?? (await window.api.readStepCached(path, MESH_CACHE_TAG, !native))
  // 캐시를 찾는 동안(큰 파일은 몇 초) 취소했으면 결과를 쓰지 않는다
  if (signal?.aborted) throw cancelled(native ? 'native' : 'wasm')
  if (!lookup) return null
  if (isImportedModel(lookup.model)) return { model: lookup.model, engine: 'cache' }

  if (native) {
    const converted = await convertNative(path, fileName, options)
    if (converted) return converted
    // 실행할 수 없는 변환기는 다시 확인하지 않는다
    converterAvailable = Promise.resolve(false)
  }

  const read = lookup.bytes ? lookup : await window.api.readStepCached(path, MESH_CACHE_TAG, true)
  if (signal?.aborted) throw cancelled('wasm')
  if (!read) return null
  if (isImportedModel(read.model)) return { model: read.model, engine: 'cache' }
  if (!read.bytes) throw new StepImportError('unknown', 'empty read result', 'wasm')
  onPhase?.('wasm')
  const model = await parseStep('wasm', ownBuffer(read.bytes), fileName, signal)
  // 메모리 한도로 일부 메시가 빠진 결과는 캐시하지 않는다(다음에 다시 시도하거나 네이티브로 읽게)
  if (droppedMeshCount(model) === 0) storeCacheLater(read.key, model)
  return { model, engine: 'wasm' }
}

function createGeometry(mesh: ImportedMesh): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  if (mesh.colors) geometry.setAttribute('color', new BufferAttribute(mesh.colors, 3))
  geometry.setIndex(new BufferAttribute(mesh.indices, 1))
  if (mesh.normals) geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  else geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

// 모델의 메시를 CAD 루트 기준 id(cadGeometryId)로 등록하고 씬을 다시 그리게 한다.
export function registerModelGeometries(
  cadRootId: string,
  model: ImportedModel,
  indexing: MeshIndexing
): void {
  const ids = meshGeometryIds(cadRootId, model, indexing)
  model.meshes.forEach((mesh, index) => registerGeometry(ids[index], createGeometry(mesh)))
  // 이 CAD의 이전 형상 중 새 결과에 없는 id(다시 찾기로 바꾼 파일에 없는 파트 등)는 지운다.
  // 남겨 두면 그 파트가 이전 파일의 모양으로 보인다.
  const current = new Set(ids)
  for (const id of geometryIds()) {
    if (id.startsWith(`${cadRootId}:`) && !current.has(id)) disposeGeometry(id)
  }
  useSceneStore.getState().bumpGeometryRevision()
}

// 실패 알림 문구. 취소는 알리지 않는다(null).
export function importErrorNotice(error: unknown): NoticeKey | null {
  if (!(error instanceof StepImportError)) return 'importFailed'
  switch (error.code) {
    case 'cancelled':
      return null
    case 'readFailed':
      return 'importReadFailed'
    case 'empty':
      return 'importEmpty'
    // WASM의 삼각분할 실패·메모리 부족은 대개 파일이 2 GB 한도에 비해 너무 큰 것이다
    case 'meshFailed':
      return error.engine === 'wasm' ? 'importTooLarge' : 'importMeshFailed'
    case 'outOfMemory':
      return error.engine === 'wasm' ? 'importTooLarge' : 'importOutOfMemory'
    default:
      return 'importFailed'
  }
}

function notifyError(error: unknown, fileName: string): void {
  const key = importErrorNotice(error)
  if (!key) return
  console.error('STEP 불러오기 실패', error)
  showNotice('error', key, { fileName })
}

// 일부 형상이 빠진 결과를 알린다
function notifyIncomplete(loaded: LoadedStep, fileName: string): void {
  const count = droppedMeshCount(loaded.model)
  if (count > 0) showNotice('warning', 'importPartial', { fileName, count })
  if ((loaded.untranslated ?? 0) > 0) showNotice('warning', 'importIncomplete', { fileName })
}

// 이보다 큰 STEP은 캐시에 없으면 불러오기 전에 확인한다(처음 변환에 몇 분 걸리거나 WASM이 실패할 수 있다)
export const LARGE_STEP_BYTES = 100 * 1000 * 1000

export function formatFileSize(bytes: number): string {
  return `${Math.round(bytes / (1000 * 1000))} MB`
}

// 큰 파일 확인 문구. 네이티브 변환기가 없으면 실패할 수 있다고 알린다.
export function largeImportMessage(
  files: { name: string; size: number }[],
  native: boolean
): string {
  const size = formatFileSize(files.reduce((sum, file) => sum + file.size, 0))
  if (files.length === 1) {
    return i18n.t(native ? 'dialog.importLarge' : 'dialog.importLargeWasm', {
      fileName: files[0].name,
      size
    })
  }
  return i18n.t(native ? 'dialog.importLargeMany' : 'dialog.importLargeManyWasm', {
    count: files.length,
    size
  })
}

// 큰 파일(캐시에 없는 것)을 불러올지 묻는다. 묻지 않아도 되면 true.
export async function confirmLargeImport(
  files: { name: string; size: number }[]
): Promise<boolean> {
  if (files.length === 0) return true
  const answer = await showDialog({
    message: largeImportMessage(files, await hasNativeConverter()),
    buttons: [
      { id: 'import', label: i18n.t('dialog.import'), primary: true },
      { id: 'cancel', label: i18n.t('dialog.cancel') }
    ],
    cancelId: 'cancel'
  })
  return answer === 'import'
}

type PendingImport = { file: File; path: string; lookup: StepReadResult | null }

// 드래그 앤 드롭·파일 선택으로 받은 STEP들을 하나씩 새 로봇으로 씬에 추가한다.
// 캐시에 없는 큰 파일이 있으면 한 번에 묻고, 취소하면 아무것도 불러오지 않는다.
export async function importStepFiles(files: File[]): Promise<void> {
  if (files.length === 0) return
  const controller = beginImport()
  const session = useProjectStore.getState().session
  const progress = showNotice(
    'progress',
    'importing',
    { fileName: files.map((file) => file.name).join(', ') },
    { onCancel: () => controller.abort() }
  )
  const { signal } = controller
  try {
    setNoticePhase(progress, 'checking')
    // 큰 파일은 캐시부터 찾는다(캐시에 있으면 금방 끝나므로 묻지 않는다). 내용은 받지 않는다
    // (메인이 해시와 크기만 알려 주고, WASM으로 변환할 때 그 파일만 읽는다).
    const pending: PendingImport[] = []
    for (const file of files) {
      const path = window.api.getPathForFile(file)
      let lookup: StepReadResult | null = null
      if (path && file.size > LARGE_STEP_BYTES) {
        try {
          lookup = await window.api.readStepCached(path, MESH_CACHE_TAG, false)
        } catch (error) {
          // 읽을 수 없는 파일(권한, 잠김 등)은 알리고 건너뛴다
          notifyError(error, file.name)
          continue
        }
      }
      pending.push({ file, path, lookup })
      if (signal.aborted) return
    }
    const large = pending.filter(
      ({ file, lookup }) => file.size > LARGE_STEP_BYTES && !isImportedModel(lookup?.model)
    )
    setNoticePhase(progress, undefined)
    if (!(await confirmLargeImport(large.map(({ file }) => file)))) return

    for (const item of pending) {
      if (signal.aborted || useProjectStore.getState().session !== session) return
      await importOne(item, progress, signal, session)
    }
  } finally {
    dismissNotice(progress)
    endImport(controller)
  }
}

async function importOne(
  { file, path, lookup }: PendingImport,
  progress: number,
  signal: AbortSignal,
  session: number
): Promise<void> {
  const onPhase = (phase: ImportPhase, fraction?: number | null): void =>
    setNoticePhase(progress, phase, fraction)
  try {
    // 디스크 파일이면 캐시를 거쳐 읽고, 아니면(경로 없음) 바로 WASM으로 변환한다
    let loaded = path
      ? await loadStepModel(path, file.name, { signal, onPhase, lookup: lookup ?? undefined })
      : null
    if (!loaded) {
      onPhase('wasm')
      const model = await parseStep('wasm', await file.arrayBuffer(), file.name, signal)
      loaded = { model, engine: 'wasm' }
    }
    // 오래 걸리는 사이 다른 프로젝트를 열었으면 버린다
    if (useProjectStore.getState().session !== session) return
    const { model } = loaded
    const { objects, robotId, cadRootId } = buildSceneObjects(model, {
      fileName: file.name,
      absolutePath: path,
      alignment: loadAlignmentPreference(localStorage),
      createId: () => crypto.randomUUID()
    })
    registerModelGeometries(cadRootId, model, 'source')
    useSceneStore.getState().addObjects(objects)
    useEditorStore.getState().select(robotId)
    useEditorStore.getState().focus(robotId)
    notifyIncomplete(loaded, file.name)
  } catch (error) {
    notifyError(error, file.name)
  } finally {
    setNoticePhase(progress, undefined)
  }
}

// 다시 읽은 CAD의 형상 id 방식. 예전 프로젝트(meshIndexing 없음)는 저장한 메시 수가 지금 파일의 전체 메시 수와
// 같으면 빠진 메시가 없었던 것이므로 원래 순번과 같다.
export function reloadIndexing(
  cad: { meshCount: number; meshIndexing?: MeshIndexing },
  model: ImportedModel
): MeshIndexing {
  return cad.meshIndexing ?? (cad.meshCount === model.sourceMeshCount ? 'source' : 'packed')
}

// 다시 읽은 CAD가 저장할 때와 다른 파일 구조인지(파트 수가 다르면 일부 파트가 맞지 않을 수 있다)
export function cadStructureChanged(
  cad: { meshCount: number; meshIndexing?: MeshIndexing },
  model: ImportedModel,
  indexing: MeshIndexing
): boolean {
  return cad.meshCount !== (indexing === 'source' ? model.sourceMeshCount : model.meshes.length)
}

export type CadLoadStatus = 'loaded' | 'missing' | 'failed' | 'cancelled'

// 디스크의 STEP을 읽어 기존 CAD 루트의 형상으로 등록한다(프로젝트 열기, 파일 다시 찾기, 다시 불러오기).
// 파일이 없으면 missing, 읽지 못하면 failed(알림을 띄움), 취소하면 cancelled. 실패하면 이전 형상을 그대로 둔다.
export async function loadCadGeometry(
  cadRootId: string,
  path: string,
  options: LoadStepOptions = {}
): Promise<CadLoadStatus> {
  const fileName = fileNameOf(path)
  // 형상 id 방식은 읽기 시작할 때의 CAD 정보로 정한다. 읽는 동안 CAD를 지웠다가 실행 취소로 되살려도 맞게 연결되도록,
  // 지워졌어도 형상은 등록한다(기록이 그 id를 쓴다).
  const cad = useSceneStore.getState().objects[cadRootId]?.cad
  let loaded: LoadedStep | null
  try {
    loaded = await loadStepModel(path, fileName, options)
  } catch (error) {
    if (error instanceof StepImportError && error.code === 'cancelled') return 'cancelled'
    notifyError(error, fileName)
    return 'failed'
  }
  // 다른 프로젝트를 열어 취소됐으면 형상을 등록하지 않는다
  if (options.signal?.aborted) return 'cancelled'
  if (!loaded) return 'missing'
  // OCCT가 엔티티를 건너뛰었으면(대개 메모리 부족) 솔리드가 통째로 빠져 뒤 메시 순번이 밀린다.
  // 저장한 형상 id와 맞지 않으므로 등록하지 않는다(다시 불러오기로 재시도).
  if ((loaded.untranslated ?? 0) > 0) {
    showNotice('error', 'cadLoadIncomplete', { fileName })
    return 'failed'
  }
  const { model } = loaded
  const indexing = cad ? reloadIndexing(cad, model) : 'source'
  registerModelGeometries(cadRootId, model, indexing)
  if (cad && cadStructureChanged(cad, model, indexing)) {
    showNotice('warning', 'cadChanged', { fileName })
  } else {
    notifyIncomplete(loaded, fileName)
  }
  return 'loaded'
}

// CAD 하나의 형상을 진행 알림(경과 시간·[취소])과 함께 읽는다
export async function loadCadWithProgress(
  cadRootId: string,
  path: string,
  lookup?: StepReadResult
): Promise<CadLoadStatus> {
  const controller = beginImport()
  const progress = showNotice(
    'progress',
    'importing',
    { fileName: fileNameOf(path) },
    { onCancel: () => controller.abort() }
  )
  try {
    return await loadCadGeometry(cadRootId, path, {
      signal: controller.signal,
      onPhase: (phase, fraction) => setNoticePhase(progress, phase, fraction),
      lookup
    })
  } finally {
    dismissNotice(progress)
    endImport(controller)
  }
}
