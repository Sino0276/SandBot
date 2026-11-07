import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { SEASON_IDS, resolveSeason } from '../../../shared/sim/seasons/seasons'
import en from '../i18n/locales/en'
import ko, { type Messages } from '../i18n/locales/ko'
import {
  hiveLabelKey,
  overlapTargetLabel,
  seasonLabelKey,
  startPresetLabelKey,
  structureLabelKey,
  tapeLabelKey,
  wallLabelKey,
  zoneLabelKey
} from './fieldLabels'

// K10(spec-4ab §5): 시즌 데이터의 key는 i18n 키라 t()의 타입 검사를 받지 못하므로 여기서 확인한다(hardware/labels.test.ts와
// 같은 방법)

function lookup(messages: Messages, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  }, messages)
}

const keys: string[] = ['field.wallGeneric', 'field.unknownSeason']
for (const id of SEASON_IDS) {
  const spec = resolveSeason(id)
  keys.push(seasonLabelKey(id))
  if (spec.walls) for (const name of Object.values(spec.walls)) keys.push(wallLabelKey(name))
  for (const s of spec.structures) keys.push(structureLabelKey(s.key))
  for (const t of spec.tape) keys.push(tapeLabelKey(t.key))
  for (const z of spec.zones) keys.push(zoneLabelKey(z.key))
  for (const h of spec.hives) keys.push(hiveLabelKey(h.key))
  for (const p of spec.startPresets) keys.push(startPresetLabelKey(p.key))
}

describe('시즌 필드 번역', () => {
  it.each([
    ['ko', ko],
    ['en', en]
  ])('%s에 두 시즌의 모든 key와 시즌 이름이 있다', (_, messages) => {
    const missing = keys.filter((key) => typeof lookup(messages, key) !== 'string')
    expect(missing).toEqual([])
  })
})

describe('overlapTargetLabel', () => {
  // 키를 그대로 돌려주는 t
  const t = ((key: string) => key) as unknown as TFunction

  it('벽은 시즌 벽 이름, 구조물·구역은 key, 같은 글자는 한 번만 처음 순서로', () => {
    const biobuzz = resolveSeason('biobuzz')
    expect(
      overlapTargetLabel(
        biobuzz,
        [
          { kind: 'wall', wall: 'y-' },
          { kind: 'structure', index: 2 },
          { kind: 'structure', index: 4 },
          { kind: 'wall', wall: 'x+' },
          { kind: 'zone', index: 0 }
        ],
        t
      )
    ).toBe('field.walls.red, field.structures.leg, field.walls.audience, field.zones.loadingZone')
    expect(overlapTargetLabel(resolveSeason('none'), [{ kind: 'wall', wall: 'x+' }], t)).toBe(
      'field.wallGeneric'
    )
    expect(overlapTargetLabel(biobuzz, [], t)).toBe('')
  })
})
