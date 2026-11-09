import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../worldSpec'
import type { FieldSpec, FieldTag } from './fieldSpec'
import { resolveSeason } from './seasons'
import { tag36h11Code, tag36h11Image } from './tag36h11'
import {
  clusterFieldPoses,
  clusterOriginFromMember,
  SDK_BIOBUZZ_CLUSTER_OFFSET_Y,
  SDK_BIOBUZZ_CLUSTER_OFFSET_Z,
  tagFieldPose as fieldPose
} from './tagPoses'

// K2·K3(spec-4ab §5): AprilTag 참값과 tag36h11 그림.
// 기대값 __fixtures__/biobuzz-tags.json은 조사 스크립트(scratchpad p13field/web/biobuzz_tags_computed.json, `compl/tags.py`)가
// 공식 CAD 스티커 + SDK getBioBuzzTagLibrary 오프셋 + 실물 화면으로 만든 16태그 × 2상태(시작·넘어감)의 필드 자세다
// (pos_m, q_wxyz: 태그 틀 → 필드 능동 회전, Hamilton w 먼저). CAD 비대칭(0.016 in)을 허용하려고 위치 0.02 in, 회전 원소
// 1e-4 안에서 맞춘다(다시 계산한 최대 차: 위치 2.03e-4 m, 회전 9.4e-6). prettier로 정리했다(값은 같다).

type Expected = {
  id: number | string
  state: 'start' | 'tipped'
  pos_m: [number, number, number]
  q_wxyz: [number, number, number, number]
}

const EXPECTED: Expected[] = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'biobuzz-tags.json'), 'utf8')
)

const biobuzz = resolveSeason('biobuzz')

// 4ab의 지역 함수 자리: 4d부터 seasons/tagPoses.ts의 tagFieldPose를 쓴다(두 HIVE를 같은 상태로)
function tagFieldPose(
  spec: FieldSpec,
  tag: FieldTag,
  state: 'start' | 'tipped'
): { position: Vec3; matrix: readonly number[] } {
  const tipped = state === 'tipped'
  const { position, rotation } = fieldPose(spec, tag, [tipped, tipped])
  return { position, matrix: rotation }
}

function quaternionMatrix([w, x, y, z]: [number, number, number, number]): number[] {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y)
  ]
}

describe('K2 태그 참값', () => {
  const numbered = EXPECTED.filter((e): e is Expected & { id: number } => typeof e.id === 'number')

  it('32개(16태그 × 2상태)가 기대값과 0.02 in·1e-4 안', () => {
    expect(numbered).toHaveLength(32)
    for (const expected of numbered) {
      const tag = biobuzz.aprilTags.tags.find((t) => t.id === expected.id)!
      const pose = tagFieldPose(biobuzz, tag, expected.state)
      const [x, y, z] = expected.pos_m
      expect(Math.abs(pose.position.x - x)).toBeLessThanOrEqual(5.08e-4)
      expect(Math.abs(pose.position.y - y)).toBeLessThanOrEqual(5.08e-4)
      expect(Math.abs(pose.position.z - z)).toBeLessThanOrEqual(5.08e-4)
      const m = quaternionMatrix(expected.q_wxyz)
      pose.matrix.forEach((v, i) => expect(Math.abs(v - m[i])).toBeLessThanOrEqual(1e-4))
    }
  })

  it('태그 30 시작 상태: 위치 (−0.29494, −0.15875, 0.90226), 축이 §1.6 표본과 같다', () => {
    const tag = biobuzz.aprilTags.tags.find((t) => t.id === 30)!
    const { position, matrix } = tagFieldPose(biobuzz, tag, 'start')
    expect(Math.abs(position.x + 0.29494)).toBeLessThan(1e-5)
    expect(Math.abs(position.y + 0.15875)).toBeLessThan(1e-5)
    expect(Math.abs(position.z - 0.90226)).toBeLessThan(1e-5)
    const c = Math.sqrt(3) / 2
    // 열 = 필드 좌표의 태그 x·y·z
    const column = (k: number): number[] => [matrix[k], matrix[3 + k], matrix[6 + k]]
    const close = (a: number[], b: number[]): void =>
      a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(1e-12))
    close(column(0), [0, -1, 0])
    close(column(1), [c, 0, 0.5])
    close(column(2), [-0.5, 0, c])
    // 앞면 법선 = −z
    close(
      column(2).map((v) => -v),
      [0.5, 0, -c]
    )
  })
})

describe('K3 tag36h11', () => {
  it('id 30 그림', () => {
    const image = tag36h11Image(30)!
    const text = image.map((row) => row.map((white) => (white ? '.' : '#')).join(''))
    expect(text).toEqual([
      '..........',
      '.########.',
      '.#...##.#.',
      '.###.#.##.',
      '.#.#...##.',
      '.#.###..#.',
      '.######.#.',
      '.#..#..##.',
      '.########.',
      '..........'
    ])
  })

  it('30–45 코드가 표와 같고 그 밖은 null', () => {
    const table: Record<number, number> = {
      30: 0xe2cfda160,
      31: 0x2ff497c63,
      32: 0x47240671b,
      33: 0x5047a2e55,
      34: 0x635ca87c7,
      35: 0x691254166,
      36: 0x68f43d94a,
      37: 0x6ef24bdb6,
      38: 0x8cdd8f886,
      39: 0x9de96b718,
      40: 0xaff6e5a8a,
      41: 0xbae46f029,
      42: 0xd225b6d59,
      43: 0xdf8ba8c01,
      44: 0xe3744a22f,
      45: 0xfbb59375d
    }
    for (let id = 30; id <= 45; id++) expect(tag36h11Code(id)).toBe(table[id])
    for (const id of [0, 29, 46, 586, -1, 30.5]) {
      expect(tag36h11Code(id)).toBeNull()
      expect(tag36h11Image(id)).toBeNull()
    }
    // 그림은 늘 10 × 10, 바깥 고리 흰색·안 고리 검정
    for (let id = 30; id <= 45; id++) {
      const image = tag36h11Image(id)!
      expect(image).toHaveLength(10)
      for (let k = 0; k < 10; k++) {
        expect(image[0][k] && image[9][k] && image[k][0] && image[k][9]).toBe(true)
        if (k >= 1 && k <= 8)
          expect(image[1][k] || image[8][k] || image[k][1] || image[k][8]).toBe(false)
      }
    }
  })
})

// K6(spec-4d §1.6, A9 앞부분): SDK 묶음 원점. 몸체 틀 값은 식으로 x = ±(0.36246 + 7.1874f·0.0254), z = −0.03792 −
// (−5.622f)·0.0254이다(4ab 값 0.54501과 1e-5 비교는 4.3e-8 여유라 쓰지 않는다)
describe('K6 묶음 원점', () => {
  const bodyX = 0.36246 + SDK_BIOBUZZ_CLUSTER_OFFSET_Y * 0.0254
  const bodyZ = -0.03792 - SDK_BIOBUZZ_CLUSTER_OFFSET_Z * 0.0254

  it('식 값과 상수', () => {
    expect(SDK_BIOBUZZ_CLUSTER_OFFSET_Y).toBe(Math.fround(7.1874))
    expect(SDK_BIOBUZZ_CLUSTER_OFFSET_Z).toBe(Math.fround(-5.622))
    expect(Math.abs(bodyX - 0.545019956)).toBeLessThan(1e-9)
    expect(Math.abs(bodyZ - 0.1048788055)).toBeLessThan(1e-9)
  })

  for (const tipped of [false, true] as const) {
    it(`HIVE ${tipped ? '넘어감' : '시작'}: 네 묶음, 몸체 틀 (±x, 0, z)를 1e-6로, 네 멤버가 같은 원점(1e-16 급)`, () => {
      const hiveTipped: [boolean, boolean] = [tipped, tipped]
      const poses = clusterFieldPoses(biobuzz, hiveTipped)
      expect(poses.map((p) => [p.name, p.firstId])).toEqual([
        ['RED SCORING', 30],
        ['RED AUDIENCE', 34],
        ['BLUE AUDIENCE', 38],
        ['BLUE SCORING', 42]
      ])
      for (const pose of poses) {
        const hive = biobuzz.hives.find(
          (h) => h.key === (pose.name.startsWith('RED') ? 'hiveRed' : 'hiveBlue')
        )!
        const theta = tipped ? hive.tippedAngle : hive.startAngle
        // 몸체 틀로 되돌림: R_y(−θ)·(p − pivot)
        const dx = pose.position.x - hive.pivot.x
        const dy = pose.position.y - hive.pivot.y
        const dz = pose.position.z - hive.pivot.z
        const local = {
          x: Math.cos(theta) * dx - Math.sin(theta) * dz,
          y: dy,
          z: Math.sin(theta) * dx + Math.cos(theta) * dz
        }
        // 득점 묶음(빨강 −X CELL, 파랑은 그 Rz(π) 상이라 몸체 틀에서도 같은 쪽)은 −x, 관중석은 +x
        const sign = pose.name.endsWith('SCORING') ? -1 : 1
        expect(Math.abs(local.x - sign * bodyX)).toBeLessThan(1e-6)
        expect(Math.abs(local.y)).toBeLessThan(1e-6)
        expect(Math.abs(local.z - bodyZ)).toBeLessThan(1e-6)
        // 같은 묶음의 네 멤버가 같은 원점
        const members = biobuzz.aprilTags.tags
          .filter((t) => t.cluster === pose.name)
          .sort((a, b) => a.id - b.id)
        expect(members).toHaveLength(4)
        members.forEach((tag, k) => {
          const o = clusterOriginFromMember(biobuzz, tag, k, hiveTipped).position
          expect(Math.abs(o.x - pose.position.x)).toBeLessThan(1e-15)
          expect(Math.abs(o.y - pose.position.y)).toBeLessThan(1e-15)
          expect(Math.abs(o.z - pose.position.z)).toBeLessThan(1e-15)
        })
        // 사원수: 단위, w ≥ 0, 회전 행렬과 같음
        const q = pose.quaternion
        expect(Math.abs(Math.hypot(...q) - 1)).toBeLessThan(1e-15)
        expect(q[0]).toBeGreaterThanOrEqual(0)
        quaternionMatrix(q).forEach((v, i) =>
          expect(Math.abs(v - pose.rotation[i])).toBeLessThan(1e-15)
        )
      }
    })
  }

  it("'none' 시즌은 묶음이 없다", () => {
    expect(clusterFieldPoses(resolveSeason('none'), [false, false])).toEqual([])
  })
})
