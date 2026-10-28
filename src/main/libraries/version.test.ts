import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  highestVersion,
  isDynamicVersion,
  isValidArtifact,
  isValidGroup,
  isValidVersion,
  majorVersion,
  versionParts
} from './version'

const lt = (a: string, b: string): void => {
  expect(compareVersions(a, b), `${a} < ${b}`).toBeLessThan(0)
  expect(compareVersions(b, a), `${b} > ${a}`).toBeGreaterThan(0)
}

describe('Gradle 버전 순서', () => {
  it('부분 나누기: 구분자와 숫자·글자 경계', () => {
    expect(versionParts('1.0.0-beta3')).toEqual(['1', '0', '0', 'beta', '3'])
    expect(versionParts('1a1')).toEqual(['1', 'a', '1'])
    expect(versionParts('2.1.20')).toEqual(['2', '1', '20'])
    expect(versionParts('1..2')).toEqual(['1', '2'])
  })

  it('숫자는 값으로 비교한다', () => {
    lt('0.4.10', '0.5.1')
    lt('1.9.0', '2.1.20')
    lt('2.1.20', '2.4.10')
    lt('1.0.9', '1.0.10')
    expect(compareVersions('1.01', '1.1')).toBe(0)
  })

  it('충돌 시험의 실제 버전들', () => {
    expect(highestVersion(['0.4.10', '0.5.1'])).toBe('0.5.1')
    expect(highestVersion(['1.9.0', '2.1.20', '2.4.10'])).toBe('2.4.10')
    expect(highestVersion(['2.0.21', '2.3.21', '2.4.10'])).toBe('2.4.10')
    expect(highestVersion([])).toBeNull()
  })

  it('정식 버전이 미리보기보다 높다', () => {
    lt('1.0.0-beta3', '1.0.0')
    lt('1.0.3-beta.1', '1.0.3')
    lt('1.0-rc1', '1.0')
    lt('1.0-SNAPSHOT', '1.0')
  })

  it('특별한 글자: dev < 그 밖 < rc < snapshot < final < ga < release < sp', () => {
    lt('1.0-dev', '1.0-alpha')
    lt('1.0-alpha', '1.0-beta')
    lt('1.0-beta', '1.0-rc')
    lt('1.0-rc', '1.0-snapshot')
    lt('1.0-snapshot', '1.0-final')
    lt('1.0-final', '1.0-ga')
    lt('1.0-ga', '1.0-release')
    lt('1.0-release', '1.0-sp')
    lt('1.0-RC-1', '1.0-release-1')
  })

  it('부분이 더 있으면: 숫자면 높고 글자면 낮다', () => {
    lt('1.1', '1.1.0')
    lt('1.1.a', '1.1')
    lt('1.2.3', '1.2.3.4')
  })

  it('숫자는 글자보다 높다, 구분자는 상관없다', () => {
    lt('1.a', '1.1')
    expect(compareVersions('1.a.1', '1-a+1')).toBe(0)
    expect(compareVersions('1.a-1', '1a1')).toBe(0)
  })

  it('주 버전', () => {
    expect(majorVersion('3.0.2')).toBe(3)
    expect(majorVersion('2.1.1')).toBe(2)
    expect(majorVersion('beta')).toBeNull()
  })

  it('동적 버전', () => {
    for (const v of [
      '+',
      '1.+',
      '1.0+',
      'latest.release',
      'latest.integration',
      '[1.0,2.0)',
      '(,1.0]',
      '[1.0]',
      '1.0-SNAPSHOT'
    ])
      expect(isDynamicVersion(v), v).toBe(true)
    for (const v of ['1.0.0', '0.1.25', '1.0.3-beta.1', '2.1.20'])
      expect(isDynamicVersion(v), v).toBe(false)
  })

  it('좌표 글자', () => {
    expect(isValidGroup('com.pedropathing')).toBe(true)
    expect(isValidGroup('com..x')).toBe(false)
    expect(isValidGroup('../etc')).toBe(false)
    expect(isValidGroup('a/b')).toBe(false)
    expect(isValidArtifact('kotlin-stdlib-jdk8')).toBe(true)
    expect(isValidArtifact('..')).toBe(false)
    expect(isValidArtifact('a/b')).toBe(false)
    expect(isValidVersion('1.0.3-beta.1')).toBe(true)
    expect(isValidVersion('1.0/../x')).toBe(false)
    expect(isValidVersion('$v')).toBe(false)
  })
})
