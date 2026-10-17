import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearTrustedRoots, isTrustedRoot, trustRoot } from './projectRoots'

describe('projectRoots', () => {
  afterEach(() => clearTrustedRoots())

  it('열거나 저장한 폴더만 믿는다', () => {
    const root = resolve('/work/FtcRobotController')
    expect(isTrustedRoot(root)).toBe(false)
    trustRoot(root)
    expect(isTrustedRoot(root)).toBe(true)
    // 같은 폴더를 다르게 적어도 같다
    expect(isTrustedRoot(`${root}/`)).toBe(true)
    expect(isTrustedRoot(join(root, 'TeamCode', '..'))).toBe(true)
    // 안쪽·바깥 폴더는 다른 폴더다
    expect(isTrustedRoot(join(root, 'TeamCode'))).toBe(false)
    expect(isTrustedRoot(resolve('/work'))).toBe(false)
  })

  it('문자열이 아니거나 빈 값은 믿지 않는다', () => {
    trustRoot(process.cwd())
    expect(isTrustedRoot('')).toBe(false)
    expect(isTrustedRoot(undefined)).toBe(false)
    expect(isTrustedRoot(42)).toBe(false)
  })
})
