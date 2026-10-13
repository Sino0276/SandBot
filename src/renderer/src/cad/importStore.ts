import { create } from 'zustand'
import type { StepImportErrorCode } from './stepWorker'

type ImportState = {
  status: 'idle' | 'loading' | 'error'
  fileName: string
  errorCode: StepImportErrorCode | null
  setLoading: (fileName: string) => void
  setError: (fileName: string, code: StepImportErrorCode) => void
  reset: () => void
}

export const useImportStore = create<ImportState>()((set) => ({
  status: 'idle',
  fileName: '',
  errorCode: null,
  setLoading: (fileName) => set({ status: 'loading', fileName, errorCode: null }),
  setError: (fileName, errorCode) => set({ status: 'error', fileName, errorCode }),
  reset: () => set({ status: 'idle', fileName: '', errorCode: null })
}))
