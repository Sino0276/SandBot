import { BufferAttribute, BufferGeometry } from 'three'
import { useEditorStore } from '../editor/editorStore'
import { dismissNotice, showNotice } from '../editor/noticeStore'
import { registerGeometry } from '../scene/geometryRegistry'
import { useSceneStore } from '../scene/sceneStore'
import { loadAlignmentPreference } from './alignmentPreference'
import {
  buildSceneObjects,
  cadGeometryId,
  isImportedModel,
  MESH_CACHE_TAG,
  type ImportedMesh,
  type ImportedModel
} from './stepImport'
import type { StepImportErrorCode, StepWorkerRequest, StepWorkerResponse } from './stepWorker'

export class StepImportError extends Error {
  constructor(
    readonly code: StepImportErrorCode,
    detail: string
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

// STEP 내용을 워커에서 읽어 계층과 메시로 바꾼다. buffer는 워커로 넘어가므로 이후 쓸 수 없다.
export function parseStep(buffer: ArrayBuffer, fileName: string): Promise<ImportedModel> {
  const worker = new Worker(new URL('./stepWorker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<StepWorkerResponse>) => {
      worker.terminate()
      if (event.data.ok) resolve(event.data.model)
      else reject(new StepImportError(event.data.code, event.data.detail))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new StepImportError('unknown', event.message))
    }
    const request: StepWorkerRequest = { buffer, fileName }
    worker.postMessage(request, [buffer])
  })
}

// 디스크의 STEP을 변환 결과로 읽는다. 메시 캐시(앱 데이터 폴더)에 있으면 변환하지 않는다. 파일이 없으면 null.
export async function loadStepModel(path: string, fileName: string): Promise<ImportedModel | null> {
  const result = await window.api.readStepCached(path, MESH_CACHE_TAG)
  if (!result) return null
  if (isImportedModel(result.model)) return result.model
  if (!result.bytes) throw new StepImportError('unknown', 'empty read result')
  const { bytes } = result
  // 워커로 넘기면 버퍼를 쓸 수 없게 되므로, 다른 데이터와 버퍼를 나눠 쓰는 경우에만 복사한다
  const buffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : bytes.slice().buffer
  const model = await parseStep(buffer, fileName)
  // 캐시 저장(모델 전체를 메인 프로세스로 복사)은 화면에 먼저 보여 준 뒤에 한다. 실패해도 불러오기는 계속한다.
  setTimeout(() => {
    window.api.storeMeshCache(result.key, model).catch((error) => {
      console.warn('메시 캐시 저장 실패', error)
    })
  }, 500)
  return model
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
export function registerModelGeometries(cadRootId: string, model: ImportedModel): void {
  model.meshes.forEach((mesh, index) => {
    registerGeometry(cadGeometryId(cadRootId, index), createGeometry(mesh))
  })
  useSceneStore.getState().bumpGeometryRevision()
}

function noticeKeyOf(error: unknown): 'importReadFailed' | 'importEmpty' | 'importFailed' {
  const code = error instanceof StepImportError ? error.code : 'unknown'
  return code === 'readFailed'
    ? 'importReadFailed'
    : code === 'empty'
      ? 'importEmpty'
      : 'importFailed'
}

// 드래그 앤 드롭·파일 선택으로 받은 STEP을 새 로봇으로 씬에 추가하고 선택한다.
export async function importStepFile(file: File): Promise<void> {
  const progress = showNotice('progress', 'importing', { fileName: file.name })
  try {
    // 디스크 파일이면 캐시를 거쳐 읽고, 아니면(경로 없음) 바로 변환한다
    const absolutePath = window.api.getPathForFile(file)
    const model =
      (absolutePath ? await loadStepModel(absolutePath, file.name) : null) ??
      (await parseStep(await file.arrayBuffer(), file.name))
    const { objects, robotId, cadRootId } = buildSceneObjects(model, {
      fileName: file.name,
      absolutePath,
      alignment: loadAlignmentPreference(localStorage),
      createId: () => crypto.randomUUID()
    })
    registerModelGeometries(cadRootId, model)
    useSceneStore.getState().addObjects(objects)
    useEditorStore.getState().select(robotId)
    useEditorStore.getState().focus(robotId)
  } catch (error) {
    console.error('STEP 불러오기 실패', error)
    showNotice('error', noticeKeyOf(error), { fileName: file.name })
  } finally {
    dismissNotice(progress)
  }
}

// 디스크의 STEP을 읽어 기존 CAD 루트의 형상으로 등록한다(프로젝트 열기, 파일 다시 찾기).
// 파일이 없으면 false. 메시 수가 저장된 값과 다르면 경고한다.
export async function loadCadGeometry(cadRootId: string, path: string): Promise<boolean> {
  const fileName = fileNameOf(path)
  let model: ImportedModel | null
  try {
    model = await loadStepModel(path, fileName)
  } catch (error) {
    // 파일은 있지만 STEP으로 읽지 못했다. 읽기 자체가 실패하면(권한 등) 호출한 쪽으로 넘긴다.
    if (!(error instanceof StepImportError)) throw error
    console.error('CAD 다시 읽기 실패', error)
    showNotice('error', noticeKeyOf(error), { fileName })
    return true
  }
  if (!model) return false
  registerModelGeometries(cadRootId, model)
  const expected = useSceneStore.getState().objects[cadRootId]?.cad?.meshCount
  if (expected !== undefined && expected !== model.meshes.length) {
    showNotice('warning', 'cadChanged', { fileName })
  }
  return true
}
