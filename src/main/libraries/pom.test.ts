import { describe, expect, it } from 'vitest'
import { effectivePom, parseRawPom, PomError, type RawPom } from './pom'
import { pom } from './testkit'
import { parseXml, XmlError } from './xml'

function loader(poms: Record<string, string>) {
  return async (group: string, artifact: string, version: string): Promise<RawPom> => {
    const text = poms[`${group}:${artifact}:${version}`]
    if (text === undefined) throw new PomError(`missing ${group}:${artifact}:${version}`)
    return parseRawPom(text)
  }
}

describe('XML', () => {
  it('요소·글자·주석·CDATA·엔티티', () => {
    const root = parseXml(
      '<?xml version="1.0"?>\n<!-- c --><a x="1 > 2"><b>&lt;x&amp;y&gt; &#65;&#x42;</b><c><![CDATA[<raw>]]></c><d/></a>'
    )
    expect(root.name).toBe('a')
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c', 'd'])
    expect(root.children[0].text).toBe('<x&y> AB')
    expect(root.children[1].text).toBe('<raw>')
  })

  it('DTD·알 수 없는 엔티티를 거부한다(XXE·billion laughs)', () => {
    expect(() => parseXml('<!DOCTYPE lolz [<!ENTITY lol "lol">]><project>&lol;</project>')).toThrow(
      XmlError
    )
    expect(() => parseXml('<project>&foo;</project>')).toThrow(XmlError)
    expect(() => parseXml('<a><b></a>')).toThrow(XmlError)
    expect(() => parseXml('<a></a><b></b>')).toThrow(XmlError)
  })

  it('깊이 한도', () => {
    expect(() => parseXml(`${'<a>'.repeat(100)}${'</a>'.repeat(100)}`)).toThrow(XmlError)
  })
})

describe('POM', () => {
  it('범위·optional·자기 자신·packaging(Road Runner core 1.0.1 모양)', async () => {
    const raw = parseRawPom(
      pom({
        coordinate: 'com.acmerobotics.roadrunner:core:1.0.1',
        marker: true,
        dependencies: [
          { coordinate: 'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0', scope: 'compile' },
          { coordinate: 'com.acmerobotics.roadrunner:core:1.0.1', scope: 'compile', optional: true }
        ]
      })
    )
    expect(raw.gradleMetadata).toBe(true)
    const effective = await effectivePom(raw, loader({}))
    expect(effective.extension).toBe('jar')
    expect(
      effective.dependencies.map((d) => `${d.group}:${d.artifact}:${d.version}:${d.scope}`)
    ).toEqual(['org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0:compile'])
  })

  it('runtime 범위와 건너뛰는 범위(Road Runner ftc 0.1.25 모양)', async () => {
    const raw = parseRawPom(
      pom({
        coordinate: 'com.acmerobotics.roadrunner:ftc:0.1.25',
        packaging: 'aar',
        dependencies: [
          { coordinate: 'com.acmerobotics.roadrunner:core:1.0.1', scope: 'compile' },
          { coordinate: 'com.acmerobotics.dashboard:dashboard:0.4.10' },
          { coordinate: 'com.fasterxml.jackson.core:jackson-databind:2.12.7', scope: 'runtime' },
          { coordinate: 'junit:junit:4.13', scope: 'test' },
          { coordinate: 'x:provided:1', scope: 'provided' },
          { coordinate: 'x:system:1', scope: 'system' }
        ]
      })
    )
    const effective = await effectivePom(raw, loader({}))
    expect(effective.extension).toBe('aar')
    expect(effective.dependencies.map((d) => `${d.artifact}:${d.scope}`)).toEqual([
      'core:compile',
      'dashboard:compile',
      'jackson-databind:runtime'
    ])
  })

  it('부모 사슬·속성 보간·BOM import(jackson-databind 2.12.7 모양)', async () => {
    const poms = {
      'org.sonatype.oss:oss-parent:41': pom({
        coordinate: 'org.sonatype.oss:oss-parent:41',
        packaging: 'pom'
      }),
      'com.fasterxml.jackson:jackson-parent:2.12': pom({
        coordinate: 'com.fasterxml.jackson:jackson-parent:2.12',
        parent: 'org.sonatype.oss:oss-parent:41',
        packaging: 'pom'
      }),
      'com.fasterxml.jackson:jackson-bom:2.12.7': pom({
        coordinate: 'com.fasterxml.jackson:jackson-bom:2.12.7',
        parent: 'com.fasterxml.jackson:jackson-parent:2.12',
        packaging: 'pom',
        properties: { 'jackson.version': '2.12.7', 'jackson.version.core': '${jackson.version}' },
        managed: [{ coordinate: 'com.fasterxml.jackson.core:jackson-core:${jackson.version.core}' }]
      }),
      'com.fasterxml.jackson:jackson-base:2.12.7': pom({
        coordinate: 'com.fasterxml.jackson:jackson-base:2.12.7',
        parent: 'com.fasterxml.jackson:jackson-bom:2.12.7',
        packaging: 'pom',
        managed: [
          {
            coordinate: 'com.fasterxml.jackson:jackson-bom:${jackson.version}',
            scope: 'import',
            type: 'pom'
          }
        ]
      }),
      'com.example:annotations-bom:1.0': pom({
        coordinate: 'com.example:annotations-bom:1.0',
        packaging: 'pom',
        managed: [{ coordinate: 'com.fasterxml.jackson.core:jackson-annotations:2.12.7' }]
      })
    }
    const raw = parseRawPom(
      pom({
        coordinate: ':jackson-databind:2.12.7',
        parent: 'com.fasterxml.jackson:jackson-base:2.12.7',
        packaging: 'bundle',
        managed: [{ coordinate: 'com.example:annotations-bom:1.0', scope: 'import', type: 'pom' }],
        dependencies: [
          { coordinate: 'com.fasterxml.jackson.core:jackson-annotations' },
          { coordinate: 'com.fasterxml.jackson.core:jackson-core:${jackson.version.core}' }
        ]
      })
    )
    const effective = await effectivePom(raw, loader(poms))
    expect(effective.group).toBe('com.fasterxml.jackson')
    expect(effective.version).toBe('2.12.7')
    // bundle → jar
    expect(effective.extension).toBe('jar')
    expect(effective.dependencies.map((d) => `${d.artifact}:${d.version}`)).toEqual([
      'jackson-annotations:2.12.7',
      'jackson-core:2.12.7'
    ])
  })

  it('부모의 dependencies를 물려받고 자식 선언이 이긴다', async () => {
    const poms = {
      'p:parent:1': pom({
        coordinate: 'p:parent:1',
        packaging: 'pom',
        dependencies: [{ coordinate: 'x:a:1' }, { coordinate: 'x:b:1' }]
      })
    }
    const raw = parseRawPom(
      pom({
        coordinate: 'p:child:1',
        parent: 'p:parent:1',
        dependencies: [{ coordinate: 'x:a:2' }]
      })
    )
    const effective = await effectivePom(raw, loader(poms))
    expect(effective.dependencies.map((d) => `${d.artifact}:${d.version}`)).toEqual(['a:2', 'b:1'])
  })

  it('실패: relocation, 버전 없음, 풀지 못한 속성, 부모 순환', async () => {
    await expect(
      effectivePom(parseRawPom(pom({ coordinate: 'a:b:1', relocated: true })), loader({}))
    ).rejects.toThrow(/relocated/)
    await expect(
      effectivePom(
        parseRawPom(pom({ coordinate: 'a:b:1', dependencies: [{ coordinate: 'x:y' }] })),
        loader({})
      )
    ).rejects.toThrow(/no version/)
    await expect(
      effectivePom(
        parseRawPom(pom({ coordinate: 'a:b:1', dependencies: [{ coordinate: 'x:y:${nope}' }] })),
        loader({})
      )
    ).rejects.toThrow(/unresolved/)
    const cycle = { 'a:p:1': pom({ coordinate: 'a:p:1', parent: 'a:p:1' }) }
    await expect(
      effectivePom(parseRawPom(pom({ coordinate: 'a:b:1', parent: 'a:p:1' })), loader(cycle))
    ).rejects.toThrow(/cycle/)
  })

  it('packaging pom은 파일이 없다', async () => {
    const effective = await effectivePom(
      parseRawPom(pom({ coordinate: 'org.ejml:ejml-all:0.39', packaging: 'pom' })),
      loader({})
    )
    expect(effective.extension).toBeNull()
  })

  it('POM이 아닌 문서', () => {
    expect(() => parseRawPom('<html><body>Not Found</body></html>')).toThrow(PomError)
    expect(() => parseRawPom('<!DOCTYPE html><html></html>')).toThrow(PomError)
  })
})
