import { ElectronAPI } from '@electron-toolkit/preload'
import type { SandbotApi } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    api: SandbotApi
  }
}
