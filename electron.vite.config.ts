import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    // STEP 파서(OCCT WASM)를 도는 워커를 ES 모듈로 번들한다
    worker: {
      format: 'es'
    }
  }
})
