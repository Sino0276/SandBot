import { readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { generateHardwareJava } from '../../hardware/javaCodegen'
import { robotHardwareSettings } from '../../hardware/components'
import { validateScene } from '../../hardware/validation'
import type { SceneObjects } from '../../scene/model'
import {
  COMP_ROBOT_ID,
  corpusScene,
  PRACTICE_ROBOT_ID,
  renamedCorpusScene
} from './__fixtures__/corpusScene'

// 사용처 말뭉치의 생성 클래스는 코드 생성 출력 그대로다(손으로 고치지 않는다). 코드 생성이 바뀌면 이 테스트가
// 실패하고, vitest -u(또는 pnpm usage-oracle)가 파일을 다시 쓴다. 그러면 정답표의 말뭉치 해시도 바뀌므로
// pnpm usage-oracle로 javac 정답표를 다시 만든다.

const CORPUS = join(__dirname, '__fixtures__', 'corpus')
const GENERATED = 'org/firstinspires/ftc/teamcode/sandbot'
export const NORMAL_GENERATED_DIR = join(CORPUS, 'src/main/java', GENERATED)
export const RENAMED_GENERATED_DIR = join(CORPUS, 'renamed', GENERATED)

const ROBOTS = [COMP_ROBOT_ID, PRACTICE_ROBOT_ID]

async function expectGenerated(objects: SceneObjects, dir: string): Promise<void> {
  expect(validateScene(objects).filter((issue) => issue.severity === 'error')).toEqual([])
  const names: string[] = []
  for (const robotId of ROBOTS) {
    const { className } = robotHardwareSettings(objects, robotId)
    names.push(`${className}.java`)
    await expect(generateHardwareJava(objects, robotId)).toMatchFileSnapshot(
      join(dir, `${className}.java`)
    )
  }
  // 이전 이름의 파일이 남아 있으면 javac가 그 클래스도 보므로 지운다
  expect(readdirSync(dir).sort()).toEqual(names.sort())
}

describe('사용처 말뭉치의 생성 클래스', () => {
  it('보통 씬', async () => {
    await expectGenerated(corpusScene(), NORMAL_GENERATED_DIR)
  })

  it('이름을 바꾼 씬', async () => {
    await expectGenerated(renamedCorpusScene(), RENAMED_GENERATED_DIR)
  })
})
