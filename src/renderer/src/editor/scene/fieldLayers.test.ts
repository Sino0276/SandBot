import { describe, expect, it } from 'vitest'
import { fieldLayers } from './fieldLayers'

// spec-4e §6 K4: §1.6 표 여덟 조합
describe('K4 fieldLayers', () => {
  it('§1.6 표', () => {
    for (const elementsHidden of [false, true])
      for (const shapesShown of [false, true])
        expect(fieldLayers({ cadReady: false, shapesShown, elementsHidden })).toEqual({
          cad: false,
          simple: 'all',
          outlines: false
        })
    for (const shapesShown of [false, true])
      expect(fieldLayers({ cadReady: true, shapesShown, elementsHidden: true })).toEqual({
        cad: false,
        simple: 'all',
        outlines: false
      })
    expect(fieldLayers({ cadReady: true, shapesShown: false, elementsHidden: false })).toEqual({
      cad: true,
      simple: 'companion',
      outlines: false
    })
    expect(fieldLayers({ cadReady: true, shapesShown: true, elementsHidden: false })).toEqual({
      cad: true,
      simple: 'companion',
      outlines: true
    })
  })
})
