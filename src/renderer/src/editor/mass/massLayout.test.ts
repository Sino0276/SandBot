import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 인스펙터 CSS(assets/main.css)의 질량 카드 배치. jsdom은 배치를 계산하지 않으므로 규칙을 읽어 확인한다.
const css = readFileSync(new URL('../../assets/main.css', import.meta.url), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  expect(match, selector).not.toBeNull()
  return match![1]
}

describe('질량 카드 배치', () => {
  it('읽기 전용 세 값은 인스펙터의 "로봇 중심 기준"처럼 이름을 한 줄에 두고 값 칸을 폭 전체로 쓴다', () => {
    // 이름 칸과 값 칸을 한 줄에 나누면(38% + 1fr) 값 칸이 50 px쯤이라 "-10.00"·"Center of mass (robot frame)"가 잘린다
    expect(rule('.mass-vector')).not.toMatch(/grid-template-columns/)
    const label = rule('.mass-vector > .hw-row-label')
    expect(label).toMatch(/display:\s*block/)
    expect(label).toMatch(/white-space:\s*normal/)
  })
})
