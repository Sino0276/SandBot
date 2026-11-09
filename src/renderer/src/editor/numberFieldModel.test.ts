import { describe, expect, it } from 'vitest'
import { parseAngle } from '../units/units'
import { numberCommit } from './numberFieldModel'

// NumberField 확정 판정(4c 리뷰, spec-4c E2E 1: 조준 각도 칸의 잘못된 글자는 틀렸다고 보이고 지우지 않음)
describe('numberCommit', () => {
  const degrees = (text: string): number | null => {
    const radians = parseAngle(text)
    return radians === null ? null : (radians * 180) / Math.PI
  }

  it('읽은 유한 수는 set, 읽지 못한 글자·무한대는 rejected', () => {
    expect(numberCommit('270', degrees)).toEqual({ kind: 'set', value: 270 })
    expect(numberCommit('1.5708rad', degrees)).toEqual({
      kind: 'set',
      value: expect.closeTo(90, 3)
    })
    expect(numberCommit('abc', degrees)).toEqual({ kind: 'rejected' })
    expect(numberCommit('', degrees)).toEqual({ kind: 'rejected' })
    expect(numberCommit('1', () => Infinity)).toEqual({ kind: 'rejected' })
  })
})
