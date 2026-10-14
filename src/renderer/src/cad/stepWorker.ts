// STEP 변환 워커. UI 스레드를 막지 않도록 무거운 일은 여기서 한다.
// - wasm: occt-import-js(OpenCascade WASM)로 STEP을 읽는다(메모리 한도 2 GB).
// - native: 네이티브 변환기(메인 프로세스가 실행)의 출력(SBSTEP01)을 읽는다.
// 어느 쪽이든 occt-import-js 결과 모양을 convertOcctResult로 계층과 피벗 중심 메시로 바꾼다.
import occtimportjs from 'occt-import-js'
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url'
import { NativeResultError, parseNativeResult } from './nativeResult'
import {
  convertOcctResult,
  emptyResultReason,
  isOutOfMemoryError,
  transferablesOf,
  type ImportedModel
} from './stepImport'

export type StepWorkerRequest = { kind: 'wasm' | 'native'; buffer: ArrayBuffer; fileName: string }
// - readFailed: STEP으로 읽지 못함, empty: 형상이 없음, meshFailed: 삼각형을 하나도 만들지 못함(대개 메모리 한도),
//   outOfMemory: 메모리 부족, cancelled: 사용자가 취소, unknown: 그 밖의 오류
export type StepImportErrorCode =
  'readFailed' | 'empty' | 'meshFailed' | 'outOfMemory' | 'cancelled' | 'unknown'
export type StepWorkerResponse =
  { ok: true; model: ImportedModel } | { ok: false; code: StepImportErrorCode; detail: string }

const scope = self as unknown as {
  onmessage: (event: MessageEvent<StepWorkerRequest>) => void
  postMessage: (message: StepWorkerResponse, transfer?: Transferable[]) => void
}

scope.onmessage = async (event) => {
  const { kind, buffer, fileName } = event.data
  try {
    let result
    if (kind === 'native') {
      result = parseNativeResult(buffer)
    } else {
      const occt = await occtimportjs({ locateFile: () => wasmUrl })
      // 파일에 선언된 단위와 관계없이 미터로 받는다
      result = occt.ReadStepFile(new Uint8Array(buffer), { linearUnit: 'meter' })
    }
    if (!result.success) {
      scope.postMessage({ ok: false, code: 'readFailed', detail: '' })
      return
    }
    const model = convertOcctResult(result, fileName)
    if (!model) {
      scope.postMessage({ ok: false, code: emptyResultReason(result), detail: '' })
      return
    }
    scope.postMessage({ ok: true, model }, transferablesOf(model))
  } catch (error) {
    const code =
      error instanceof NativeResultError
        ? 'unknown'
        : isOutOfMemoryError(error)
          ? 'outOfMemory'
          : 'unknown'
    scope.postMessage({ ok: false, code, detail: String(error) })
  }
}
