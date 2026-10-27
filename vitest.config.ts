import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// electron-vite 설정과 별개로, 테스트는 일반 Vite 설정으로 실행한다.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    // sidecar/**: 사이드카(JVM) 빌드·실행 테스트. JDK가 없으면 건너뛴다(sidecar/tests/support.ts).
    include: ['src/**/*.test.{ts,tsx}', 'sidecar/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'sidecar/build/**'],
    passWithNoTests: true
  }
})
