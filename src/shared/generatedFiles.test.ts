import { describe, expect, it } from 'vitest'
import {
  GENERATED_MARKER,
  hasGeneratedMarker,
  isAllowedGeneratedPath,
  planGeneratedSync
} from './generatedFiles'

const JAVA = 'src/main/java/org/firstinspires/ftc/teamcode/sandbot'
const XML = 'src/main/res/xml'
const generated = (body: string): string => `// ${GENERATED_MARKER}\n${body}`

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

describe('hasGeneratedMarker', () => {
  it('파일 앞부분의 표식만 본다', () => {
    expect(hasGeneratedMarker(generated('class A {}'))).toBe(true)
    expect(hasGeneratedMarker('class A {}')).toBe(false)
    expect(hasGeneratedMarker(`${'x'.repeat(1000)}${GENERATED_MARKER}`)).toBe(false)
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

  it('대소문자만 바뀐 이름은 이전 파일을 지우고 새 이름으로 쓴다', () => {
    const plan = planGeneratedSync(
      [{ path: `${JAVA}/Robothardware.java`, content: generated('old') }],
      [{ path: javaPath, content: generated('new') }]
    )
    expect(plan.delete).toEqual([`${JAVA}/Robothardware.java`])
    expect(plan.write.map((f) => f.path)).toEqual([javaPath])
  })

  it('대소문자만 다른 사람이 만든 파일이 있으면 건너뛴다', () => {
    const plan = planGeneratedSync(
      [{ path: `${JAVA}/Robothardware.java`, content: 'class Robothardware {}' }],
      [{ path: javaPath, content: generated('new') }]
    )
    expect(plan.skipped).toEqual([javaPath])
    expect(plan.write).toEqual([])
    expect(plan.delete).toEqual([])
  })

  it('생성 위치가 아닌 경로는 거부한다', () => {
    expect(() =>
      planGeneratedSync([], [{ path: 'src/main/java/MyOpMode.java', content: '' }])
    ).toThrow()
  })
})
