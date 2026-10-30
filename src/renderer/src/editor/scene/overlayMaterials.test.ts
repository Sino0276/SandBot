import { Texture } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { OverlayMaterials } from './overlayMaterials'

// 오버레이 재질 묶음: 그릴 때마다 글자·그림 재질을 앞에서부터 다시 나눠 주고(텍스처·불투명도만 바꿈), 해제하지 않는다.
// 셰이더 프로그램은 그 프로그램을 쓰는 재질이 모두 해제될 때만 지워지므로, 재질을 이어 쓰면 다시 컴파일하지 않는다.

describe('오버레이 재질', () => {
  it('글자·그림 재질을 다음 그림에서 텍스처와 불투명도만 바꿔 다시 쓴다', () => {
    const pool = new OverlayMaterials()
    const [a, b, c] = [new Texture(), new Texture(), new Texture()]
    pool.begin()
    const first = pool.map(a, 1)
    const second = pool.map(b, 0.5)
    pool.end()
    expect(first).not.toBe(second)
    expect([first.map, second.map, second.opacity]).toEqual([a, b, 0.5])

    const disposed = vi.fn()
    for (const material of [pool.mesh, pool.lines, first, second])
      material.addEventListener('dispose', disposed)
    const version = first.version
    pool.begin()
    expect(pool.map(c, 0.25)).toBe(first)
    pool.end()
    expect([first.map, first.opacity]).toEqual([c, 0.25])
    // 바꾼 것은 uniform뿐이라 프로그램을 다시 고르지 않는다
    expect(first.version).toBe(version)
    // 쓰지 않은 재질은 텍스처를 놓지만 해제하지 않는다
    expect(second.map).toBeNull()
    expect(disposed).not.toHaveBeenCalled()

    pool.begin()
    expect(pool.map(a, 1)).toBe(first)
    expect(pool.map(b, 1)).toBe(second)
    pool.end()
    expect(second.map).toBe(b)

    pool.dispose()
    expect(disposed).toHaveBeenCalledTimes(4)
  })
})
