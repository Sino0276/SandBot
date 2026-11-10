import { generatedHash } from '../../../shared/generatedFiles'
import { robotComponents, robotHardwareSettings } from '../hardware/components'
import { generateTeamCodeFiles } from '../hardware/generate'
import { configXmlFilePath } from '../hardware/naming'
import { uniqueIssues } from '../hardware/validation'
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

// 지금 씬으로 만들 생성 코드(저장할 때와 같은 generateTeamCodeFiles). blocked면 하드웨어 검증 오류(errors개, 저장 알림과
// 같이 겹친 것은 한 번)로 아무 파일도 만들 수 없다. configHash는 configPath 구성 XML의 표식 해시(막혔거나 없으면 null)로,
// INIT이 메인에 보내 디스크 파일과 비교한다(다르면 configStale). 저장하지 않고 연 프로젝트도 이것으로 확인한다.
export type ExpectedConfig = { blocked: boolean; errors: number; configHash: string | null }

export function expectedConfig(objects: SceneObjects, configPath: string | null): ExpectedConfig {
  const { files, issues, blocked } = generateTeamCodeFiles(objects)
  const errors = blocked ? uniqueIssues(issues).filter((i) => i.severity === 'error').length : 0
  const file = configPath === null ? undefined : files.find((f) => f.path === configPath)
  return { blocked, errors, configHash: file ? generatedHash(file.content) : null }
}

// INIT 때 Console에 남길 구성 경고(디스크 구성이 지금 씬과 다를 수 있다).
// - 지금 씬에 하드웨어 검증 오류가 있으면 구성을 만들 수 없다: 마지막 저장이 이미 막혔으면 generationBlocked, 아니면
//   (이번 세션에 저장하지 않고 연 프로젝트 등) configBlocked(TeamCode에 남은 구성으로 실행, 고치고 저장하라고).
//   하드웨어가 있는 로봇이 없으면(configPath null) 쓸 구성이 없으므로 알리지 않는다
// - 아니면 마지막 저장의 코드 생성이 그 구성 파일을 맞추지 못한 경우. 저장하지 않고 연 프로젝트의 오래된 구성은
//   메인의 해시 비교(configStale)가 알린다.
export function generationWarning(
  generation: GenerationResult | null,
  configPath: string | null,
  current: Pick<ExpectedConfig, 'blocked' | 'errors'> | null = null
): { key: ConsoleNoticeKey; params: Record<string, string | number> } | null {
  if (current?.blocked && configPath !== null && generation?.status !== 'blocked')
    return { key: 'configBlocked', params: { count: current.errors, file: configPath } }
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
