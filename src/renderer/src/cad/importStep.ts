import { BufferAttribute, BufferGeometry } from 'three'
import { useEditorStore } from '../editor/editorStore'
import { registerGeometry } from '../scene/geometryRegistry'
import { useSceneStore } from '../scene/sceneStore'
import { loadAlignmentPreference } from './alignmentPreference'
import { useImportStore } from './importStore'
import { buildSceneObjects, type ImportedMesh, type ImportedModel } from './stepImport'
import type { StepImportErrorCode, StepWorkerRequest, StepWorkerResponse } from './stepWorker'

class StepImportError extends Error {
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

function parseInWorker(buffer: ArrayBuffer, fileName: string): Promise<ImportedModel> {
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

// STEP 파일을 읽어 새 로봇으로 씬에 추가하고 선택한다.
export async function importStepFile(file: File): Promise<void> {
  const importState = useImportStore.getState()
  importState.setLoading(file.name)
  try {
    const model = await parseInWorker(await file.arrayBuffer(), file.name)
    const { objects, robotId, geometryIds } = buildSceneObjects(model, {
      fileName: file.name,
      alignment: loadAlignmentPreference(localStorage),
      createId: () => crypto.randomUUID()
    })
    for (const [meshIndex, geometryId] of geometryIds) {
      registerGeometry(geometryId, createGeometry(model.meshes[meshIndex]))
    }
    useSceneStore.getState().addObjects(objects)
    useEditorStore.getState().select(robotId)
    useEditorStore.getState().focus(robotId)
    importState.reset()
  } catch (error) {
    console.error('STEP 불러오기 실패', error)
    importState.setError(file.name, error instanceof StepImportError ? error.code : 'unknown')
  }
}
