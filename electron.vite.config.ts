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
    // 법적 주석(/*! … @license … */)을 번들에 남긴다. Vite 기본값은 'none'이라 minify 뒤 사라진다.
    // tag36h11 코드 표(AprilRobotics apriltag, BSD-2-Clause 2항: 바이너리 배포에 고지)가 이것을 쓴다(spec-4ab §1.6)
    esbuild: {
      legalComments: 'inline'
    },
    // STEP 파서(OCCT WASM)를 도는 워커를 ES 모듈로 번들한다
    worker: {
      format: 'es'
    }
  }
})
