import type { TFunction } from 'i18next'
import type { SurfaceRef, WallSide } from '../../../shared/sim/fieldRaycast'
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

// 벽 이름: spec.walls의 이름('none'은 field.wallGeneric, overlapTargetLabel과 같은 규칙)
function wallName(spec: FieldSpec, wall: WallSide, t: TFunction): string {
  const tt = looseT(t)
  return spec.walls ? tt(wallLabelKey(spec.walls[wall])) : tt('field.wallGeneric')
}

// 센서 광선이 맞은 면의 이름(4c 인스펙터 값 줄, spec-4c §1.9 U7): 바닥 타일, "빨강 LOADING ZONE 앞 테이프"(얼라이언스 +
// 테이프 이름), "빨강 벽 레일"·"필드 벽 투명판", 구조물 이름. 시즌 데이터 밖 순번(시즌이 바뀐 직후 등)은 빈 글자다.
export function sensorSurfaceLabel(spec: FieldSpec, surface: SurfaceRef, t: TFunction): string {
  const tt = looseT(t)
  switch (surface.kind) {
    case 'floor':
      return t('hardware.sensorReading.surfaces.floor')
    case 'tape': {
      const tape = spec.tape[surface.index]
      if (!tape) return ''
      return t('hardware.sensorReading.surfaces.tape', {
        alliance: t(`hardware.sensorReading.surfaces.alliances.${tape.alliance}`),
        name: tt(tapeLabelKey(tape.key))
      })
    }
    case 'rail':
      return t('hardware.sensorReading.surfaces.rail', { wall: wallName(spec, surface.wall, t) })
    case 'panel':
      return t('hardware.sensorReading.surfaces.panel', { wall: wallName(spec, surface.wall, t) })
    case 'structure': {
      const structure = spec.structures[surface.index]
      return structure ? tt(structureLabelKey(structure.key)) : ''
    }
  }
}
