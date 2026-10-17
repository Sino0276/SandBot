import { describe, expect, it } from 'vitest'
import { GENERATED_JAVA_DIR, isAllowedGeneratedPath } from './generatedFiles'
import {
  isLinkableJavaPath,
  isWindowsReservedName,
  javaClassNameOfPath,
  JAVA_SOURCE_PREFIX,
  normalizeLinkPath,
  WINDOWS_RESERVED_NAMES
} from './teamCodePaths'

const TEAMCODE = 'src/main/java/org/firstinspires/ftc/teamcode'

describe('isLinkableJavaPath', () => {
  it('src/main/java 아래 Java 식별자 폴더의 .java를 받는다', () => {
    expect(isLinkableJavaPath(`${TEAMCODE}/Lift.java`)).toBe(true)
    expect(isLinkableJavaPath(`${TEAMCODE}/subsystems/Lift.java`)).toBe(true)
    expect(isLinkableJavaPath(`${TEAMCODE}/$Gen/_Lift2.java`)).toBe(true)
    // 기본 패키지
    expect(isLinkableJavaPath(`${JAVA_SOURCE_PREFIX}Lift.java`)).toBe(true)
  })

  it('한글 식별자 폴더·파일도 받는다', () => {
    expect(isLinkableJavaPath(`${TEAMCODE}/메커니즘/리프트.java`)).toBe(true)
    expect(javaClassNameOfPath(`${TEAMCODE}/메커니즘/리프트.java`)).toBe(
      'org.firstinspires.ftc.teamcode.메커니즘.리프트'
    )
  })

  it('경로 이동과 다른 구분자를 받지 않는다', () => {
    for (const path of [
      `${TEAMCODE}/../Lift.java`,
      `${TEAMCODE}/./Lift.java`,
      `${TEAMCODE}//Lift.java`,
      `src/main/java/../../build.gradle.java`,
      `../${TEAMCODE}/Lift.java`,
      `/${TEAMCODE}/Lift.java`,
      `${TEAMCODE}\\Lift.java`,
      `src\\main\\java\\Lift.java`,
      `C:/${TEAMCODE}/Lift.java`,
      `C:${TEAMCODE}/Lift.java`,
      `//server/share/${TEAMCODE}/Lift.java`,
      `src/main/kotlin/Lift.java`,
      `src/main/java`,
      `src/main/java/`,
      `src/main/java/.java`
    ]) {
      expect(isLinkableJavaPath(path), path).toBe(false)
    }
  })

  it('Windows가 다르게 읽는 이름을 받지 않는다', () => {
    for (const path of [
      // 대체 데이터 스트림
      `${TEAMCODE}/Lift.java:secret`,
      `${TEAMCODE}/Lift:x.java`,
      // 끝의 점·공백은 Windows가 지운다
      `${TEAMCODE}/Lift.java.`,
      `${TEAMCODE}/Lift.java `,
      `${TEAMCODE}/Lift .java`,
      `${TEAMCODE}/sub./Lift.java`,
      `${TEAMCODE}/sub /Lift.java`,
      // 8.3 짧은 이름
      `${TEAMCODE}/SANDBO~1/RobotHardware.java`,
      `${TEAMCODE}/LIFTSU~1.JAV`,
      // 확장자 대소문자, 이중 확장자
      `${TEAMCODE}/Lift.JAVA`,
      `${TEAMCODE}/Lift.Java`,
      `${TEAMCODE}/Lift.java.java`,
      `${TEAMCODE}/Lift.kt`,
      // 제어 문자, 식별자에 못 쓰는 글자
      `${TEAMCODE}/Li\u0000ft.java`,
      `${TEAMCODE}/Li\nft.java`,
      `${TEAMCODE}/Lift-2.java`,
      `${TEAMCODE}/2Lift.java`,
      `${TEAMCODE}/my lift/Lift.java`
    ]) {
      expect(isLinkableJavaPath(path), JSON.stringify(path)).toBe(false)
    }
  })

  it('Windows 장치 이름을 폴더·파일 어디에서도 받지 않는다', () => {
    for (const name of ['CON', 'con', 'Aux', 'NUL', 'prn', 'COM1', 'com9', 'LPT0', 'Lpt3']) {
      expect(isLinkableJavaPath(`${TEAMCODE}/${name}.java`), name).toBe(false)
      expect(isLinkableJavaPath(`${TEAMCODE}/${name}/Lift.java`), name).toBe(false)
    }
    expect(isLinkableJavaPath(`${TEAMCODE}/CONIN$.java`)).toBe(false)
    expect(isLinkableJavaPath(`${TEAMCODE}/conout$/Lift.java`)).toBe(false)
    // 장치 이름으로 시작할 뿐인 이름은 괜찮다
    expect(isLinkableJavaPath(`${TEAMCODE}/Console.java`)).toBe(true)
    expect(isLinkableJavaPath(`${TEAMCODE}/COM10.java`)).toBe(true)
    expect(isLinkableJavaPath(`${TEAMCODE}/Auxiliary/Nullable.java`)).toBe(true)
  })

  it('생성 패키지 폴더는 대소문자와 관계없이 받지 않는다', () => {
    expect(isLinkableJavaPath(`${GENERATED_JAVA_DIR}/RobotHardware.java`)).toBe(false)
    expect(isLinkableJavaPath(`${GENERATED_JAVA_DIR}/sub/Helper.java`)).toBe(false)
    expect(isLinkableJavaPath(`${TEAMCODE}/SANDBOT/RobotHardware.java`)).toBe(false)
    expect(isLinkableJavaPath(`${TEAMCODE}/SandBot/RobotHardware.java`)).toBe(false)
    expect(isLinkableJavaPath(`src/main/java/ORG/FirstInspires/FTC/TeamCode/sandbot/A.java`)).toBe(
      false
    )
    // 'ſ'(긴 s)는 대문자로 S가 된다
    expect(isLinkableJavaPath(`${TEAMCODE}/ſandbot/RobotHardware.java`)).toBe(false)
    // 이름이 비슷할 뿐인 폴더·파일은 괜찮다
    expect(isLinkableJavaPath(`${TEAMCODE}/sandbotx/A.java`)).toBe(true)
    expect(isLinkableJavaPath(`${TEAMCODE}/sandbot.java`)).toBe(true)
  })

  it('NFC로 정규화한 경로만 받는다', () => {
    // '가'를 자모로 나눈 NFD
    const nfd = `${TEAMCODE}/\u1100\u1161.java`
    expect(nfd).not.toBe(normalizeLinkPath(nfd))
    expect(isLinkableJavaPath(nfd)).toBe(false)
    expect(normalizeLinkPath(nfd)).toBe(`${TEAMCODE}/가.java`)
    expect(isLinkableJavaPath(normalizeLinkPath(nfd))).toBe(true)
    // 미리 합친 글자가 없는 결합 문자(f + U+0301)는 식별자 둘째 글자부터 쓸 수 있다
    expect(isLinkableJavaPath(`${TEAMCODE}/Lif\u0301t.java`)).toBe(true)
    expect(isLinkableJavaPath(`${TEAMCODE}/\u0301Lift.java`)).toBe(false)
  })

  it('문자열이 아니거나 너무 긴 경로를 받지 않는다', () => {
    expect(isLinkableJavaPath(undefined as unknown as string)).toBe(false)
    expect(isLinkableJavaPath(`${TEAMCODE}/${'a'.repeat(2000)}.java`)).toBe(false)
  })
})

describe('javaClassNameOfPath', () => {
  it('폴더와 파일 이름으로 패키지까지 붙인 이름을 만든다', () => {
    expect(javaClassNameOfPath(`${TEAMCODE}/subsystems/Lift.java`)).toBe(
      'org.firstinspires.ftc.teamcode.subsystems.Lift'
    )
    expect(javaClassNameOfPath(`${JAVA_SOURCE_PREFIX}Lift.java`)).toBe('Lift')
  })
})

describe('Windows 장치 이름', () => {
  it('확장자나 끝의 공백·점이 붙어도 장치 이름이다', () => {
    expect(WINDOWS_RESERVED_NAMES).toContain('AUX')
    for (const name of ['AUX', 'aux.java', 'Con.txt', 'CON .txt', 'nul.', 'COM¹', 'lpt².log']) {
      expect(isWindowsReservedName(name), name).toBe(true)
    }
    for (const name of ['AUXX', 'Console', 'COM', 'COM10', 'LPT', 'sandbot_aux.xml', '']) {
      expect(isWindowsReservedName(name), name).toBe(false)
    }
  })

  it('생성 파일 경로도 장치 이름을 받지 않는다', () => {
    expect(isAllowedGeneratedPath(`${GENERATED_JAVA_DIR}/Aux.java`)).toBe(false)
    expect(isAllowedGeneratedPath(`${GENERATED_JAVA_DIR}/COM1.java`)).toBe(false)
    expect(isAllowedGeneratedPath(`${GENERATED_JAVA_DIR}/nul.java`)).toBe(false)
    expect(isAllowedGeneratedPath(`${GENERATED_JAVA_DIR}/Auxiliary.java`)).toBe(true)
    expect(isAllowedGeneratedPath(`src/main/res/xml/sandbot_aux.xml`)).toBe(true)
  })
})
