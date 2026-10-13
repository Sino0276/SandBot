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
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true
  }
})
