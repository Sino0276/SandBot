import type { TFunction } from 'i18next'
import type { FieldSpec } from '../../../shared/sim/seasons/fieldSpec'
import type { StartConflict } from '../../../shared/sim/seasons/startPose'
import { looseT } from '../hardware/labels'

// 필드 요소의 이름(spec-4ab §1.8 대상 이름). 시즌 데이터의 key가 i18n 키(field.*)라 t()의 키 타입 검사를 받지 못한다.
// fieldLabels.test.ts가 두 시즌의 모든 key가 ko·en에 있는지 확인한다.

const WALL_SIDE = { 'x+': 'plusX', 'x-': 'minusX', 'y+': 'plusY', 'y-': 'minusY' } as const

export function seasonLabelKey(season: string): string {
  return `field.seasons.${season}`
}

export function wallLabelKey(name: string): string {
  return `field.walls.${name}`
}

export function structureLabelKey(key: string): string {
  return `field.structures.${key}`
}

export function tapeLabelKey(key: string): string {
  return `field.tape.${key}`
}

export function zoneLabelKey(key: string): string {
  return `field.zones.${key}`
}

export function hiveLabelKey(key: string): string {
  return `field.hives.${key}`
}

export function startPresetLabelKey(key: string): string {
  return `field.startPresets.${key}`
}

// 겹침·충돌 대상 이름: 벽은 spec.walls의 이름('none'은 field.wallGeneric), 구조물은 field.structures.<key>, 구역은
// field.zones.<key>. 같은 글자는 한 번만, 처음 나온 순서로 ", "로 잇는다(알림·Console에 쓴다).
export function overlapTargetLabel(
  spec: FieldSpec,
  overlaps: readonly StartConflict[],
  t: TFunction
): string {
  const tt = looseT(t)
  const labels: string[] = []
  for (const overlap of overlaps) {
    let label: string
    if (overlap.kind === 'wall')
      label = spec.walls
        ? tt(wallLabelKey(spec.walls[WALL_SIDE[overlap.wall]]))
        : tt('field.wallGeneric')
    else if (overlap.kind === 'structure')
      label = tt(structureLabelKey(spec.structures[overlap.index].key))
    else label = tt(zoneLabelKey(spec.zones[overlap.index].key))
    if (!labels.includes(label)) labels.push(label)
  }
  return labels.join(', ')
}
