import { describe, expect, it } from 'vitest'
import type { OpModeInfo } from '../../../shared/play'
import {
  compareOpModes,
  findOpMode,
  opModeSections,
  orderedOpModes,
  preselectedTeleOp
} from './opModeList'

function opMode(
  className: string,
  flavor: OpModeInfo['flavor'],
  name: string,
  group = ''
): OpModeInfo {
  return {
    className,
    path: `src/main/java/${className.replace(/\$.*/, '').replace(/\./g, '/')}.java`,
    line: 1,
    flavor,
    name,
    group,
    preselectTeleOp: ''
  }
}

const LIST = [
  opMode('t.RedLeft', 'Autonomous', 'Red Left', 'Red'),
  opMode('t.Drive', 'TeleOp', 'drive'),
  opMode('t.Tune', 'TeleOp', 'Tune Lift', 'Tuning'),
  opMode('t.BlueLeft', 'Autonomous', 'Blue Left', 'blue'),
  opMode('t.Arcade', 'TeleOp', 'Arcade'),
  opMode('t.Park', 'Autonomous', 'Park'),
  opMode('t.Outer$Inner', 'TeleOp', 'Inner', 'Tuning')
]

describe('OpMode 목록 묶음(DS처럼)', () => {
  it('TeleOp 다음 Autonomous, 기본 그룹을 먼저, 그룹·이름은 대소문자를 가리지 않는 순서', () => {
    const sections = opModeSections(LIST)
    expect(
      sections.map((section) => ({
        flavor: section.flavor,
        groups: section.groups.map((group) => [group.group, group.opModes.map((item) => item.name)])
      }))
    ).toEqual([
      {
        flavor: 'TeleOp',
        groups: [
          ['', ['Arcade', 'drive']],
          ['Tuning', ['Inner', 'Tune Lift']]
        ]
      },
      {
        flavor: 'Autonomous',
        groups: [
          ['', ['Park']],
          ['blue', ['Blue Left']],
          ['Red', ['Red Left']]
        ]
      }
    ])
    expect(orderedOpModes(sections).map((item) => item.className)).toEqual([
      't.Arcade',
      't.Drive',
      't.Outer$Inner',
      't.Tune',
      't.Park',
      't.BlueLeft',
      't.RedLeft'
    ])
  })

  it('같은 이름은 클래스 이름으로 정해 늘 같은 순서다', () => {
    const a = opMode('t.A', 'TeleOp', 'Same')
    const b = opMode('t.B', 'TeleOp', 'Same')
    expect([b, a].sort(compareOpModes)).toEqual([a, b])
    expect(opModeSections([])).toEqual([])
  })

  it('고른 클래스 찾기와 Autonomous 뒤의 preselectTeleOp(이름이 하나일 때만)', () => {
    expect(findOpMode(LIST, 't.Park')?.name).toBe('Park')
    expect(findOpMode(LIST, 't.Missing')).toBeNull()
    expect(findOpMode(LIST, null)).toBeNull()
    expect(preselectedTeleOp(LIST, 'drive')?.className).toBe('t.Drive')
    // Autonomous의 이름이나 없는 이름은 고르지 않는다
    expect(preselectedTeleOp(LIST, 'Park')).toBeNull()
    expect(preselectedTeleOp(LIST, '')).toBeNull()
    const twice = [...LIST, opMode('t.Drive2', 'TeleOp', 'drive')]
    expect(preselectedTeleOp(twice, 'drive')).toBeNull()
  })
})
