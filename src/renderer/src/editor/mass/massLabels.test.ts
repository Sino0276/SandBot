import i18n, { type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en'
import ko, { type Messages } from '../../i18n/locales/ko'
import { MATERIAL_KEYS, type MassSource, type MassWarning } from '../../mass/types'
import type { SceneObjects } from '../../scene/model'
import {
  massSymbols,
  MATERIAL_GROUPS,
  robotMassBreakdown,
  sourceText,
  warningText
} from './massCardModel'

function lookup(messages: Messages, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  }, messages)
}

// 키 이름 전부(잎만, 점으로 이은 것)
function leafKeys(node: unknown, prefix: string): string[] {
  if (typeof node !== 'object' || node === null) return [prefix]
  return Object.entries(node).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key)
  )
}

const SOURCES: MassSource[] = ['override', 'cots', 'material', 'nameRule', 'default', 'none']
const WARNINGS: MassWarning[] = [
  { kind: 'scaleUnusual', scale: 2 },
  { kind: 'scaleImpossible', fixed: 3, weighed: 2 },
  { kind: 'defaultMass' },
  { kind: 'pending', meshes: 1 }
]

// 재질 키·묶음은 템플릿 글자로 만든 번역 키라 여기서도 확인한다(hardware/labels.test.ts와 같은 방법)
describe('질량 카드 번역', () => {
  it.each([
    ['ko', ko],
    ['en', en]
  ])('%s에 모든 재질·재질 묶음 이름이 있다', (_, messages) => {
    const keys = [
      ...MATERIAL_KEYS.map((key) => `mass.materials.${key}`),
      ...MATERIAL_GROUPS.map((group) => `mass.materialGroups.${group.key}`)
    ]
    expect(keys.filter((key) => typeof lookup(messages, key) !== 'string')).toEqual([])
  })

  it('en의 질량 키 구조가 ko와 같다', () => {
    expect(leafKeys(en.mass, 'mass')).toEqual(leafKeys(ko.mass, 'mass'))
    expect(leafKeys(en.units.massSymbols, 'massSymbols')).toEqual(
      leafKeys(ko.units.massSymbols, 'massSymbols')
    )
  })

  it('재질 묶음은 모든 재질을 한 번씩 담는다', () => {
    expect(MATERIAL_GROUPS.flatMap((group) => group.materials).sort()).toEqual(
      [...MATERIAL_KEYS].sort()
    )
  })

  describe.each(['ko', 'en'] as const)('%s 문구', (lng) => {
    let t: TFunction
    beforeAll(async () => {
      const instance = i18n.createInstance()
      await instance.init({
        resources: { ko: { translation: ko }, en: { translation: en } },
        lng,
        initAsync: false,
        interpolation: { escapeValue: false }
      })
      t = instance.t
    })

    it('모든 출처·경고가 키가 아닌 문구가 되고 자리표시가 남지 않는다', () => {
      const objects: SceneObjects = {}
      const texts = [
        ...SOURCES.map((source) =>
          sourceText(t, objects, {
            mass: 1,
            centerOfMass: [0, 0, 0],
            source,
            detail: source === 'material' || source === 'default' ? 'steel' : 'x',
            inheritedFrom: null,
            scaled: false
          })
        ),
        ...WARNINGS.map((warning) => warningText(t, warning, 'mm')),
        // 저울 무게가 있으면 다른 문구
        ...WARNINGS.map((warning) => warningText(t, warning, 'in', 14)),
        ...[undefined, 14].map((weighed) =>
          robotMassBreakdown(
            t,
            {
              robotId: 'R',
              mass: 1,
              centerOfMass: [0, 0, 0],
              inertia: [0, 0, 0, 0, 0, 0],
              principalMoments: [0, 0, 0],
              fixedMass: 0,
              estimatedMass: 1,
              scale: 1,
              warnings: [{ kind: 'defaultMass' }]
            },
            'mm',
            weighed
          )
        )
      ]
      // 질량 기호도 리소스에서 온다(formatMass에 넘기는 글자)
      expect(Object.values(massSymbols(t)).filter((text) => text.startsWith('units.'))).toEqual([])
      for (const text of texts) {
        expect(text).not.toMatch(/^mass\./)
        expect(text).not.toContain('{{')
      }
    })
  })
})
