import { Euler, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { resolveSeason } from '../../../../shared/sim/seasons/seasons'
import { tagFieldPose } from '../../../../shared/sim/seasons/tagPoses'
import { fieldViewModel, TAG_FRONT_OFFSET, TAG_TOTAL_SCALE } from './fieldViewModel'

// 씬 뷰 태그 그림 = 시뮬레이터 판정 자세(spec-4d §1.6, C10). 씬 뷰 태그 메시(fieldViewModel의 carrier 그룹 안 평면)와 판정
// 자세(seasons/tagPoses.ts tagFieldPose)는 따로 쓴 변환이라, 메시의 월드 꼭짓점이 태그 틀 꼭짓점과 1e-9 m 안이고 그림의
// (0, 0) 픽셀(왼쪽 위)이 태그 틀 (−s/2, −s/2) 쪽인지 본다(4ab synthesis §9.7 규칙의 회귀 방지).

const BIOBUZZ = resolveSeason('biobuzz')

// 태그 틀 점 (x, y, 0)에 해당하는 평면 로컬 점: 메시 행렬 = 태그 자세 · Rx(π) · T(0, 0, 앞면 띄움)이라 (x, −y, −띄움)
const planePoint = (x: number, y: number): Vector3 => new Vector3(x, -y, -TAG_FRONT_OFFSET)

describe('C10: 태그 그림 = 판정 자세', () => {
  for (const hive of [
    [false, false],
    [true, true],
    [true, false]
  ] as const) {
    it(`HIVE ${hive.join('·')}: 16장의 검은 테두리 꼭짓점과 그림 왼쪽 위`, () => {
      const model = fieldViewModel(BIOBUZZ, hive, false)
      const tagMeshes = model.meshes.filter((mesh) => mesh.role === 'tag')
      expect(tagMeshes).toHaveLength(16)
      for (const mesh of tagMeshes) {
        const tag = BIOBUZZ.aprilTags.tags.find((candidate) => candidate.id === mesh.tagId)!
        // carrier 그룹(위치 pivot, 회전 R_y(angle), FieldView와 같은 three 변환) · 메시 행렬
        const carrier = model.carriers.find((candidate) => candidate.key === mesh.carrier)
        const group = carrier
          ? new Matrix4()
              .makeRotationFromEuler(new Euler(0, carrier.angle, 0))
              .setPosition(carrier.pivot.x, carrier.pivot.y, carrier.pivot.z)
          : new Matrix4()
        const world = group.multiply(new Matrix4().fromArray(mesh.matrix))
        const pose = tagFieldPose(BIOBUZZ, tag, hive)
        const r = pose.rotation
        const h = tag.size / 2
        // apriltag 순서 꼭짓점(태그 틀 (−s/2, +s/2), (+s/2, +s/2), (+s/2, −s/2), (−s/2, −s/2))
        for (const [x, y] of [
          [-h, h],
          [h, h],
          [h, -h],
          [-h, -h]
        ]) {
          const actual = planePoint(x, y).applyMatrix4(world)
          const expected = {
            x: pose.position.x + r[0] * x + r[1] * y,
            y: pose.position.y + r[3] * x + r[4] * y,
            z: pose.position.z + r[6] * x + r[7] * y
          }
          expect(Math.abs(actual.x - expected.x)).toBeLessThan(1e-9)
          expect(Math.abs(actual.y - expected.y)).toBeLessThan(1e-9)
          expect(Math.abs(actual.z - expected.z)).toBeLessThan(1e-9)
        }
        // 그림 (0, 0) 픽셀 = 텍스처 (u, v) = (0, 1) = 평면 (−w/2, +h/2): 태그 틀로 옮기면 (−, −) 쪽
        expect(mesh.geometry.kind).toBe('plane')
        const side = tag.size * TAG_TOTAL_SCALE
        const corner = new Vector3(-side / 2, side / 2, 0).applyMatrix4(world)
        const d = {
          x: corner.x - pose.position.x,
          y: corner.y - pose.position.y,
          z: corner.z - pose.position.z
        }
        const inTagX = r[0] * d.x + r[3] * d.y + r[6] * d.z
        const inTagY = r[1] * d.x + r[4] * d.y + r[7] * d.z
        const inTagZ = r[2] * d.x + r[5] * d.y + r[8] * d.z
        expect(inTagX).toBeCloseTo(-side / 2, 9)
        expect(inTagY).toBeCloseTo(-side / 2, 9)
        // 앞면(태그 −z) 쪽으로 띄운다
        expect(inTagZ).toBeCloseTo(-TAG_FRONT_OFFSET, 9)
      }
    })
  }
})
