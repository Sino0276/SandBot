import { describe, expect, it } from 'vitest'
import type { HardwareComponent, SceneObjects } from '../scene/model'
import { COMPONENT_TYPE_KEYS } from './catalog'
import { createComponent } from './components'
import { generateTeamCodeFiles } from './generate'
import { validateScene } from './validation'

// 생성 파일 전체(스탬프 줄 포함)를 파일 스냅샷으로 고정한다. 출력이 한 글자라도 바뀌면 저장할 때 모든 팀 프로젝트의
// 생성 파일이 다시 쓰이고 Android Studio가 다시 빌드하므로, 의도한 변경일 때만 스냅샷을 고친다(vitest -u).

const DEG = Math.PI / 180

// 카탈로그의 모든 종류를 한 번씩 붙인 로봇. 파트는 서로 다른 위치·회전에 둔다.
function everyComponentScene(): SceneObjects {
  const objects: SceneObjects = {
    robot: {
      id: 'robot',
      name: 'Every Bot',
      kind: 'robot',
      parentId: null,
      transform: { position: [0.3, -0.2, 0], rotation: [0, 0, 30 * DEG] },
      hardware: {
        className: 'EveryBotHardware',
        configName: 'Every Bot',
        expansionHub: { enabled: true, address: 2 }
      }
    }
  }
  const all: HardwareComponent[] = []
  let n = 0
  for (const type of COMPONENT_TYPE_KEYS) {
    const component = createComponent(type, all, () => `c${n}`)
    all.push(component)
    objects[`p${n}`] = {
      id: `p${n}`,
      name: `part ${n}`,
      kind: 'part',
      parentId: 'robot',
      transform: {
        position: [0.01 * n - 0.1, 0.02 * (n % 5) - 0.04, 0.01 * (n % 3)],
        rotation: [0, 0, (n % 4) * 15 * DEG]
      },
      components: [component]
    }
    n++
  }
  // 두 번째 허브와 그 포트를 쓰는 장치
  objects.ex = {
    id: 'ex',
    name: 'expansion parts',
    kind: 'part',
    parentId: 'robot',
    transform: { position: [-0.1, 0.1, 0.05], rotation: [0, 0, 0] },
    components: [
      { ...createComponent('motor', [], () => 'ex1'), name: 'liftLeft', hub: 'expansionHub' },
      { ...createComponent('servo', [], () => 'ex2'), name: 'wrist', hub: 'expansionHub' }
    ]
  }
  return objects
}

describe('생성 파일 출력 고정', () => {
  it('모든 컴포넌트 종류', async () => {
    const objects = everyComponentScene()
    expect(validateScene(objects).filter((issue) => issue.severity === 'error')).toEqual([])
    const { files, blocked } = generateTeamCodeFiles(objects)
    expect(blocked).toBe(false)
    expect(files.map((file) => file.path)).toMatchInlineSnapshot(`
      [
        "src/main/java/org/firstinspires/ftc/teamcode/sandbot/EveryBotHardware.java",
        "src/main/res/xml/sandbot_every_bot_hardware.xml",
      ]
    `)
    for (const file of files) {
      await expect(file.content).toMatchFileSnapshot(
        `./__snapshots__/${file.path.split('/').pop()}`
      )
    }
  })
})
