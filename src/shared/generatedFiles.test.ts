import { describe, expect, it } from 'vitest'
import {
  GENERATED_MARKER,
  generatedState,
  isAllowedGeneratedPath,
  planGeneratedSync,
  stampGenerated
} from './generatedFiles'

const JAVA = 'src/main/java/org/firstinspires/ftc/teamcode/sandbot'
const XML = 'src/main/res/xml'
const generated = (body: string): string => stampGenerated(`// ${GENERATED_MARKER}\n${body}`)

describe('isAllowedGeneratedPath', () => {
  it('생성 패키지의 Java와 res/xml의 sandbot_*.xml만 허용한다', () => {
    expect(isAllowedGeneratedPath(`${JAVA}/RobotHardware.java`)).toBe(true)
    expect(isAllowedGeneratedPath(`${XML}/sandbot_robot_hardware.xml`)).toBe(true)

    expect(isAllowedGeneratedPath(`${JAVA}/../MyOpMode.java`)).toBe(false)
    expect(isAllowedGeneratedPath(`${JAVA}/sub/RobotHardware.java`)).toBe(false)
    expect(isAllowedGeneratedPath(`${JAVA}/Robot Hardware.java`)).toBe(false)
    expect(isAllowedGeneratedPath(`${JAVA}/RobotHardware.kt`)).toBe(false)
    expect(isAllowedGeneratedPath(`${XML}/robot.xml`)).toBe(false)
    expect(isAllowedGeneratedPath(`${XML}/sandbot_Robot.xml`)).toBe(false)
    expect(isAllowedGeneratedPath(`/${XML}/sandbot_robot.xml`)).toBe(false)
    expect(isAllowedGeneratedPath('RobotHardware.java')).toBe(false)
  })
})

describe('generatedState', () => {
  const content = generated('public class A {}\n')

  it('도구가 쓴 그대로인 파일만 pristine이다', () => {
    expect(content).toMatch(new RegExp(`${GENERATED_MARKER} [0-9a-f]{14}`))
    expect(generatedState(content)).toBe('pristine')
    // git autocrlf로 줄바꿈만 바뀐 것은 같은 내용으로 본다
    expect(generatedState(content.replace(/\n/g, '\r\n'))).toBe('pristine')
  })

  it('고쳤거나 복사해 이름을 바꾼 생성 파일은 modified다', () => {
    expect(generatedState(content.replace('class A', 'class MyA'))).toBe('modified')
    expect(generatedState(`${content}// my change\n`)).toBe('modified')
    // 해시가 없는 이전 형식
    expect(generatedState(`// ${GENERATED_MARKER}\nclass A {}`)).toBe('modified')
  })

  it('표식이 없거나 파일 앞부분에 없으면 none이다', () => {
    expect(generatedState('class A {}')).toBe('none')
    expect(generatedState(`${'x'.repeat(1000)}${GENERATED_MARKER}`)).toBe('none')
  })
})

describe('planGeneratedSync', () => {
  const javaPath = `${JAVA}/RobotHardware.java`
  const xmlPath = `${XML}/sandbot_robot_hardware.xml`

  it('없는 파일은 쓰고, 내용이 같으면 그대로 두고, 다르면 덮어쓴다', () => {
    const plan = planGeneratedSync(
      [
        { path: javaPath, content: generated('old') },
        { path: xmlPath, content: generated('same') }
      ],
      [
        { path: javaPath, content: generated('new') },
        { path: xmlPath, content: generated('same') },
        { path: `${JAVA}/Other.java`, content: generated('other') }
      ]
    )
    expect(plan.write.map((f) => f.path)).toEqual([javaPath, `${JAVA}/Other.java`])
    expect(plan.unchanged).toEqual([xmlPath])
    expect(plan.skipped).toEqual([])
    expect(plan.modified).toEqual([])
    expect(plan.delete).toEqual([])
  })

  it('표식이 없는(사람이 만든) 파일은 덮어쓰지도 지우지도 않는다', () => {
    const plan = planGeneratedSync(
      [
        { path: javaPath, content: 'public class RobotHardware {}' },
        { path: `${JAVA}/Helper.java`, content: 'public class Helper {}' }
      ],
      [{ path: javaPath, content: generated('new') }]
    )
    expect(plan.write).toEqual([])
    expect(plan.skipped).toEqual([javaPath])
    expect(plan.delete).toEqual([])
  })

  it('팀이 고친 생성 파일은 덮어쓰지 않고, 복사본은 지우지 않는다', () => {
    const original = generated('public class RobotHardware {}')
    const copy = original.replace('class RobotHardware', 'class MyRobot')
    const plan = planGeneratedSync(
      [
        { path: javaPath, content: `${original}// tuned\n` },
        { path: `${JAVA}/MyRobot.java`, content: copy }
      ],
      [{ path: javaPath, content: generated('new') }]
    )
    expect(plan.modified).toEqual([javaPath])
    expect(plan.write).toEqual([])
    expect(plan.delete).toEqual([])
  })

  it('이번에 만들지 않는 이전 생성 파일은 지운다', () => {
    const plan = planGeneratedSync(
      [
        { path: `${JAVA}/OldName.java`, content: generated('old') },
        { path: `${XML}/sandbot_old_name.xml`, content: generated('old') }
      ],
      []
    )
    expect(plan.delete).toEqual([`${JAVA}/OldName.java`, `${XML}/sandbot_old_name.xml`])
  })

  it('대소문자만 바뀐 이름은 이전 파일을 지우고 새 이름으로 쓰며, 이름 변경을 알린다', () => {
    const plan = planGeneratedSync(
      [{ path: `${JAVA}/Robothardware.java`, content: generated('old') }],
      [{ path: javaPath, content: generated('new') }]
    )
    expect(plan.delete).toEqual([`${JAVA}/Robothardware.java`])
    expect(plan.write.map((f) => f.path)).toEqual([javaPath])
    expect(plan.caseRenamed).toEqual([{ from: `${JAVA}/Robothardware.java`, to: javaPath }])
  })

  it('대소문자만 다른 파일 중 하나라도 사람이 만든 것이면 건너뛴다', () => {
    const plan = planGeneratedSync(
      [
        { path: javaPath, content: 'class RobotHardware {}' },
        { path: `${JAVA}/Robothardware.java`, content: generated('old') }
      ],
      [{ path: javaPath, content: generated('new') }]
    )
    expect(plan.skipped).toEqual([javaPath])
    expect(plan.write).toEqual([])
    expect(plan.delete).toEqual([])
  })

  it('생성 위치가 아닌 경로나 해시가 없는 내용은 거부한다', () => {
    expect(() =>
      planGeneratedSync([], [{ path: 'src/main/java/MyOpMode.java', content: generated('') }])
    ).toThrow()
    expect(() =>
      planGeneratedSync([], [{ path: javaPath, content: `// ${GENERATED_MARKER}\n` }])
    ).toThrow()
  })
})
