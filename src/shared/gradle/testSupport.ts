// 시험용 Gradle 파일 소스(메모리의 파일 표, 또는 __fixtures__ 폴더)
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { GradleFileProblem, GradleFileSource } from './types'

export type MemoryFiles = Record<string, string | GradleFileProblem>

// 읽은 경로를 순서대로 남긴다(무엇을 읽으려 했는지 확인)
export function memorySource(files: MemoryFiles): GradleFileSource & { requested: string[] } {
  const requested: string[] = []
  return {
    requested,
    read: (relPath) => {
      requested.push(relPath)
      return Promise.resolve(files[relPath] ?? null)
    }
  }
}

export const FIXTURES = join(__dirname, '__fixtures__')

export function fixtureSource(name: string): GradleFileSource {
  const root = join(FIXTURES, name)
  return {
    read: (relPath) => {
      const file = join(root, ...relPath.split('/'))
      try {
        if (!statSync(file).isFile()) return Promise.resolve(null)
        return Promise.resolve(readFileSync(file, 'utf8'))
      } catch {
        return Promise.resolve(null)
      }
    }
  }
}
