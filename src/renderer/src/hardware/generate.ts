import { stampGenerated, type GeneratedFile } from '../../../shared/generatedFiles'
import { childrenOf, type SceneObjects } from '../scene/model'
import { robotComponents, robotHardwareSettings } from './components'
import { generateConfigXml } from './configXml'
import { generateHardwareJava } from './javaCodegen'
import { configXmlFilePath, javaFilePath } from './naming'
import { hasErrors, validateScene, type Issue } from './validation'

// 저장할 때 TeamCode에 쓸 파일들. 컴포넌트가 있는 로봇마다 하드웨어 클래스와 구성 XML을 하나씩 만든다.
// 검증 오류가 하나라도 있으면 아무 파일도 만들지 않는다(blocked). 경고는 생성을 막지 않는다.
export function generateTeamCodeFiles(objects: SceneObjects): {
  files: GeneratedFile[]
  issues: Issue[]
  blocked: boolean
} {
  const issues = validateScene(objects)
  if (hasErrors(issues)) return { files: [], issues, blocked: true }

  const files: GeneratedFile[] = []
  for (const robot of childrenOf(objects, null)) {
    if (robot.kind !== 'robot' || robotComponents(objects, robot.id).length === 0) continue
    const { className } = robotHardwareSettings(objects, robot.id)
    // 표식 뒤에 내용 해시를 붙여, 팀이 고친 파일과 도구가 쓴 그대로인 파일을 구별한다
    files.push({
      path: javaFilePath(className),
      content: stampGenerated(generateHardwareJava(objects, robot.id))
    })
    files.push({
      path: configXmlFilePath(className),
      content: stampGenerated(generateConfigXml(objects, robot.id))
    })
  }
  return { files, issues, blocked: false }
}
