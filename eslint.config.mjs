import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    // 변환기 빌드가 받은 occt-import-js·OCCT 소스와 빌드 결과는 검사하지 않는다(flat config는 .gitignore를 읽지 않음)
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      'native/step-converter/.cache',
      'resources/step-converter'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // R3F(Three.js) 요소의 속성을 DOM 속성으로 오인한다. JSX 속성은 TypeScript가 이미 검사한다.
      'react/no-unknown-property': 'off'
    }
  },
  {
    // 빌드 스크립트(Node .mjs)는 타입 표기를 쓸 수 없다
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
