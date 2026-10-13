// STEP 파싱 워커. OCCT WASM은 무거우므로 UI 스레드가 아니라 여기서 돈다.
import occtimportjs from 'occt-import-js'
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url'
import { convertOcctResult, transferablesOf, type ImportedModel } from './stepImport'

export type StepWorkerRequest = { buffer: ArrayBuffer; fileName: string }
export type StepImportErrorCode = 'readFailed' | 'empty' | 'unknown'
export type StepWorkerResponse =
  { ok: true; model: ImportedModel } | { ok: false; code: StepImportErrorCode; detail: string }

const scope = self as unknown as {
  onmessage: (event: MessageEvent<StepWorkerRequest>) => void
  postMessage: (message: StepWorkerResponse, transfer?: Transferable[]) => void
}

scope.onmessage = async (event) => {
  try {
    const occt = await occtimportjs({ locateFile: () => wasmUrl })
    // 파일에 선언된 단위와 관계없이 미터로 받는다
    const result = occt.ReadStepFile(new Uint8Array(event.data.buffer), { linearUnit: 'meter' })
    if (!result.success) {
      scope.postMessage({ ok: false, code: 'readFailed', detail: '' })
      return
    }
    const model = convertOcctResult(result, event.data.fileName)
    if (!model) {
      scope.postMessage({ ok: false, code: 'empty', detail: '' })
      return
    }
    scope.postMessage({ ok: true, model }, transferablesOf(model))
  } catch (error) {
    scope.postMessage({ ok: false, code: 'unknown', detail: String(error) })
  }
}
