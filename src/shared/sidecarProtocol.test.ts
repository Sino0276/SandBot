import { describe, expect, it } from 'vitest'
import {
  isTagsInput,
  MAX_TAG_DETECTIONS,
  SIDECAR_PROTOCOL_VERSION,
  TAG_INPUT_STRIDE
} from './sidecarProtocol'

// K7(spec-4d §3.2): 프로토콜 4와 웹캠 입력 tags 규칙(세계·호스트·사이드카가 같은 규칙)
describe('프로토콜 4', () => {
  it('판과 한도', () => {
    expect(SIDECAR_PROTOCOL_VERSION).toBe(4)
    expect(TAG_INPUT_STRIDE).toBe(9)
    expect(MAX_TAG_DETECTIONS).toBe(64)
  })

  const tag = (id: number): number[] => [id, 1, 2, 3.5, 4, 5, 6, 7, 8]
  const tags = (n: number): number[] => Array.from({ length: n }, (_, i) => tag(i)).flat()

  it('길이 경계: 0·9·576은 받고 10·577·585는 받지 않는다', () => {
    expect(isTagsInput('tags', [])).toBe(true)
    expect(isTagsInput('tags', tags(1))).toBe(true)
    expect(tags(64)).toHaveLength(576)
    expect(isTagsInput('tags', tags(64))).toBe(true)
    expect(isTagsInput('tags', [...tags(1), 0])).toBe(false)
    expect(isTagsInput('tags', [...tags(64), 0])).toBe(false)
    expect(isTagsInput('tags', tags(65))).toBe(false)
  })

  it('원소와 id', () => {
    expect(isTagsInput('tags', [30, NaN, 2, 3, 4, 5, 6, 7, 8])).toBe(false)
    expect(isTagsInput('tags', [30, Infinity, 2, 3, 4, 5, 6, 7, 8])).toBe(false)
    expect(isTagsInput('tags', [30, '1', 2, 3, 4, 5, 6, 7, 8])).toBe(false)
    expect(isTagsInput('tags', [30, null, 2, 3, 4, 5, 6, 7, 8])).toBe(false)
    expect(isTagsInput('tags', tag(-1))).toBe(false)
    expect(isTagsInput('tags', tag(1.5))).toBe(false)
    expect(isTagsInput('tags', tag(2 ** 53))).toBe(false)
    expect(isTagsInput('tags', tag(0))).toBe(true)
    // 꼭짓점은 음수·소수 모두 된다
    expect(isTagsInput('tags', [3, -0.5, -1, 0.25, 0, 0, 0, 0, 0])).toBe(true)
  })

  it('키가 tags가 아니거나 배열이 아니면 거짓', () => {
    expect(isTagsInput('velocityPidf', tags(1))).toBe(false)
    expect(isTagsInput('tags', 3)).toBe(false)
    expect(isTagsInput('tags', null)).toBe(false)
    expect(isTagsInput('tags', { length: 0 })).toBe(false)
  })
})
