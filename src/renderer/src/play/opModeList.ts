import type { OpModeFlavor, OpModeInfo } from '../../../shared/play'

// 툴바 OpMode 선택 목록. Driver Station처럼 TeleOp·Autonomous를 따로 묶고, 그 안을 group으로 나눈다.
// 기본 그룹('')은 머리 없이 맨 앞에 두고, 나머지 그룹과 이름은 대소문자를 가리지 않는 순서로 놓는다.

export const OPMODE_FLAVORS: readonly OpModeFlavor[] = ['TeleOp', 'Autonomous']

export type OpModeGroup = { group: string; opModes: OpModeInfo[] }
export type OpModeSection = { flavor: OpModeFlavor; groups: OpModeGroup[] }

// 대소문자를 가리지 않고 비교하고, 같으면 원래 글자로 정한다(같은 목록이면 늘 같은 순서)
function compareText(a: string, b: string): number {
  const lower = a.toLowerCase().localeCompare(b.toLowerCase(), 'en')
  if (lower !== 0) return lower
  return a < b ? -1 : a > b ? 1 : 0
}

function compareGroup(a: string, b: string): number {
  if (a === b) return 0
  if (a === '') return -1
  if (b === '') return 1
  return compareText(a, b)
}

export function compareOpModes(a: OpModeInfo, b: OpModeInfo): number {
  return (
    OPMODE_FLAVORS.indexOf(a.flavor) - OPMODE_FLAVORS.indexOf(b.flavor) ||
    compareGroup(a.group, b.group) ||
    compareText(a.name, b.name) ||
    compareText(a.className, b.className)
  )
}

// 비어 있는 묶음은 넣지 않는다
export function opModeSections(opModes: readonly OpModeInfo[]): OpModeSection[] {
  const sorted = [...opModes].sort(compareOpModes)
  const sections: OpModeSection[] = []
  for (const opMode of sorted) {
    let section = sections[sections.length - 1]
    if (!section || section.flavor !== opMode.flavor) {
      section = { flavor: opMode.flavor, groups: [] }
      sections.push(section)
    }
    let group = section.groups[section.groups.length - 1]
    if (!group || group.group !== opMode.group) {
      group = { group: opMode.group, opModes: [] }
      section.groups.push(group)
    }
    group.opModes.push(opMode)
  }
  return sections
}

// 목록에 보이는 순서 그대로(키보드로 위·아래 움직일 때)
export function orderedOpModes(sections: readonly OpModeSection[]): OpModeInfo[] {
  return sections.flatMap((section) => section.groups.flatMap((group) => group.opModes))
}

export function findOpMode(
  opModes: readonly OpModeInfo[],
  className: string | null
): OpModeInfo | null {
  if (className === null) return null
  return opModes.find((opMode) => opMode.className === className) ?? null
}

// Autonomous가 끝나면 DS처럼 preselectTeleOp(TeleOp의 DS 이름)을 고른다. 없거나 이름이 겹치지 않으면 null.
export function preselectedTeleOp(opModes: readonly OpModeInfo[], name: string): OpModeInfo | null {
  if (name === '') return null
  const matches = opModes.filter((opMode) => opMode.flavor === 'TeleOp' && opMode.name === name)
  return matches.length === 1 ? matches[0] : null
}
