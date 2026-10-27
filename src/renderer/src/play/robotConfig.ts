import { robotComponents, robotHardwareSettings } from '../hardware/components'
import { configXmlFilePath } from '../hardware/naming'
import type { GenerationResult } from '../project/projectStore'
import { childrenOf, findRobotId, type SceneObjects } from '../scene/model'
import type { ConsoleNoticeKey } from './consoleModel'

// 실행할 로봇 구성(DS에서 활성화하는 구성). 저장할 때 TeamCode에 만든 구성 XML(sandbot_<클래스>.xml)을 쓴다.
// 활성 오브젝트의 로봇에 하드웨어가 있으면 그 로봇, 아니면 하드웨어가 있는 첫 로봇. 하드웨어가 있는 로봇이 없으면 null
// (장치 없는 hardwareMap).
export type RobotConfigChoice = { robotId: string; configPath: string }

function hasHardware(objects: SceneObjects, robotId: string): boolean {
  return robotComponents(objects, robotId).length > 0
}

export function chooseRobotConfig(
  objects: SceneObjects,
  activeId: string | null
): RobotConfigChoice | null {
  const activeRobot = activeId !== null ? findRobotId(objects, activeId) : null
  const robotId =
    activeRobot !== null && hasHardware(objects, activeRobot)
      ? activeRobot
      : (childrenOf(objects, null).find(
          (object) => object.kind === 'robot' && hasHardware(objects, object.id)
        )?.id ?? null)
  if (robotId === null) return null
  return {
    robotId,
    configPath: configXmlFilePath(robotHardwareSettings(objects, robotId).className)
  }
}

// 마지막 저장의 코드 생성이 그 구성 파일을 맞추지 못했으면 Console에 남길 경고(디스크 구성이 지금 씬과 다를 수 있다)
export function generationWarning(
  generation: GenerationResult | null,
  configPath: string | null
): { key: ConsoleNoticeKey; params: Record<string, string | number> } | null {
  if (!generation) return null
  switch (generation.status) {
    case 'blocked':
      return { key: 'generationBlocked', params: { count: generation.errors } }
    case 'failed':
      return { key: 'generationFailed', params: { detail: generation.detail } }
    case 'noTeamCode':
      return null
    case 'synced':
      if (configPath === null) return null
      if (generation.skipped.includes(configPath) || generation.modified.includes(configPath))
        return { key: 'configNotGenerated', params: { file: configPath } }
      return null
  }
}
