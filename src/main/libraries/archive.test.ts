import { describe, expect, it } from 'vitest'
import { aarJars, ArchiveError, classpathJars, inspectJar } from './archive'
import { makeAar, makeJar, makeZip } from './testkit'
import { readZip, ZipError } from './zip'

describe('ZIP', () => {
  it('저장·deflate 엔트리를 읽는다', () => {
    const zip = readZip(
      makeZip([
        { name: 'a.txt', data: 'hello', store: true },
        { name: 'b/c.txt', data: 'world'.repeat(100) }
      ])
    )
    expect(zip.entries.map((e) => e.name)).toEqual(['a.txt', 'b/c.txt'])
    expect(zip.read('a.txt')?.toString()).toBe('hello')
    expect(zip.read('b/c.txt')?.toString()).toBe('world'.repeat(100))
    expect(zip.read('missing')).toBeNull()
  })

  it('같은 이름 두 번·ZIP 아님·CRC 틀림을 거부한다', () => {
    expect(() =>
      readZip(
        makeZip([
          { name: 'x', data: '1' },
          { name: 'x', data: '2' }
        ])
      )
    ).toThrow(/duplicate/)
    expect(() => readZip(Buffer.from('not a zip at all, definitely not'))).toThrow(ZipError)
    const zip = makeZip([{ name: 'a', data: 'abc', store: true }])
    // 내용 한 바이트를 바꾼다(로컬 머리 30 + 이름 1 뒤)
    zip[31] = 'x'.charCodeAt(0)
    expect(() => readZip(zip).read('a')).toThrow(/CRC/)
  })

  it('압축 폭탄(비율·크기)을 거부한다', () => {
    const bomb = makeZip([{ name: 'big', data: Buffer.alloc(8 * 1024 * 1024) }])
    expect(() =>
      readZip(bomb, { maxEntries: 10, maxEntrySize: 64 * 1024 * 1024, maxRatio: 100 }).read('big')
    ).toThrow(/suspiciously/)
    expect(() =>
      readZip(bomb, { maxEntries: 10, maxEntrySize: 1024, maxRatio: 1e9 }).read('big')
    ).toThrow(/too large/)
    expect(() =>
      readZip(
        makeZip([
          { name: 'a', data: '' },
          { name: 'b', data: '' }
        ]),
        { maxEntries: 1, maxEntrySize: 1, maxRatio: 1 }
      )
    ).toThrow(/too many/)
  })
})

describe('jar·AAR', () => {
  it('jar의 패키지 목록(멀티 릴리스 포함)', () => {
    const jar = inspectJar(
      'x.jar',
      makeZip([
        { name: 'com/pedropathing/follower/Follower.class', data: '' },
        { name: 'com/pedropathing/math/Pose.class', data: '' },
        { name: 'META-INF/versions/9/kotlin/Foo.class', data: '' },
        { name: 'META-INF/versions/9/module-info.class', data: '' },
        { name: 'module-info.class', data: '' },
        { name: 'Root.class', data: '' }
      ])
    )
    expect(jar.packages).toEqual(['com.pedropathing.follower', 'com.pedropathing.math', 'kotlin'])
  })

  it('보호 패키지를 거부한다(멀티 릴리스 접두 아래도)', () => {
    for (const name of [
      'java/lang/Evil',
      'javax/net/Evil',
      'org/sandbot/sim/SimClock',
      'com/qualcomm/robotcore/hardware/DcMotor',
      'org/firstinspires/ftc/robotcore/X',
      'META-INF/versions/17/com/qualcomm/X',
      'javax/annotation/processing/Processor'
    ]) {
      const bytes = makeJar([name])
      expect(() => inspectJar('x.jar', bytes), name).toThrow(ArchiveError)
      try {
        inspectJar('x.jar', bytes)
      } catch (error) {
        expect((error as ArchiveError).code).toBe('protectedPackage')
      }
    }
  })

  it('jar 안의 같은 클래스 두 번은 거부하고, META-INF 자원의 중복은 받는다', () => {
    const resources = makeZip([
      { name: 'META-INF/LICENSE', data: 'a' },
      { name: 'META-INF/LICENSE', data: 'b' },
      { name: 'p/A.class', data: '' }
    ])
    expect(inspectJar('x.jar', resources).packages).toEqual(['p'])
    const classes = makeZip([
      { name: 'p/A.class', data: '1' },
      { name: 'p/A.class', data: '2' }
    ])
    expect(() => inspectJar('x.jar', classes)).toThrow(/duplicate/)
  })

  it('JSR 305의 javax.annotation은 받는다', () => {
    const jar = inspectJar(
      'jsr305-3.0.2.jar',
      makeJar(['javax/annotation/Nonnull', 'javax/annotation/meta/When'])
    )
    expect(jar.packages).toEqual(['javax.annotation', 'javax.annotation.meta'])
  })

  it('AAR에서 classes.jar와 libs/*.jar만(assets·res는 풀지 않음)', () => {
    const aar = makeAar(
      ['com/x/A'],
      [
        { name: 'libs/zz.jar', data: makeJar(['com/x/lib/Z']) },
        { name: 'libs/aa.jar', data: makeJar(['com/x/lib/A']) },
        { name: 'libs/nested/no.jar', data: makeJar(['com/x/no/N']) },
        { name: 'assets/big.bin', data: Buffer.alloc(1000) },
        { name: 'res/values/values.xml', data: '<resources/>' }
      ]
    )
    const jars = aarJars('x-1.0.aar', aar)
    expect(jars.map((j) => j.name)).toEqual(['classes.jar', 'libs/aa.jar', 'libs/zz.jar'])
    expect(jars.map((j) => j.packages)).toEqual([['com.x'], ['com.x.lib'], ['com.x.lib']])
  })

  it('AAR의 jni·손상·보호 패키지', () => {
    expect(() =>
      aarJars('x.aar', makeAar(['com/x/A'], [{ name: 'jni/arm64-v8a/libx.so', data: 'elf' }]))
    ).toThrow(/native/)
    expect(() => aarJars('x.aar', Buffer.from('garbage garbage garbage garbage'))).toThrow(
      ArchiveError
    )
    expect(() => aarJars('x.aar', makeAar(['org/firstinspires/ftc/X']))).toThrow(/contains/)
  })

  it('확장자로 jar·AAR을 고른다', () => {
    expect(classpathJars('a.jar', makeJar(['p/A'])).map((j) => j.name)).toEqual(['a.jar'])
    expect(classpathJars('a.aar', makeAar(['p/A'])).map((j) => j.name)).toEqual(['classes.jar'])
  })
})
