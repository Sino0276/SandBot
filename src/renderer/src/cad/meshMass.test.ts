import { readFileSync } from 'fs'
import { createRequire } from 'module'
import type { Occt } from 'occt-import-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { MASS_CLOSURE_LIMIT, MASS_CLOSURE_OPEN, type MeshMassProps } from '../mass/types'
import type { Vec3 } from '../scene/model'
import { boundsCenter } from './alignment'
import { computeMeshMass, isMeshMassProps, MASS_MIN_VOLUME, meshMassState } from './meshMass'
import { convertOcctResult, type ImportedModel } from './stepImport'

// 시험용 메시: 면마다 정점을 따로 둔다(occt-import-js처럼). 감김은 바깥에서 볼 때 반시계.
type Mesh = { positions: number[]; indices: number[] }

function emptyMesh(): Mesh {
  return { positions: [], indices: [] }
}

function addPolygon(mesh: Mesh, points: Vec3[]): void {
  const base = mesh.positions.length / 3
  for (const point of points) mesh.positions.push(...point)
  for (let i = 1; i + 1 < points.length; i++) mesh.indices.push(base, base + i, base + i + 1)
}

function addBox(mesh: Mesh, min: Vec3, max: Vec3): void {
  const p = (x: number, y: number, z: number): Vec3 => [
    x ? max[0] : min[0],
    y ? max[1] : min[1],
    z ? max[2] : min[2]
  ]
  addPolygon(mesh, [p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)]) // −X
  addPolygon(mesh, [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)]) // +X
  addPolygon(mesh, [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)]) // −Y
  addPolygon(mesh, [p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)]) // +Y
  addPolygon(mesh, [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)]) // −Z
  addPolygon(mesh, [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)]) // +Z
}

type CylinderOptions = { top?: boolean; bottom?: boolean; skipSide?: number }

// 바닥 중심 base, 반지름 r(외접원), 높이 h, 옆면 n개의 정다각기둥
function addCylinder(
  mesh: Mesh,
  base: Vec3,
  r: number,
  h: number,
  n: number,
  { top = true, bottom = true, skipSide }: CylinderOptions = {}
): void {
  const ring = (k: number, z: number): Vec3 => {
    const angle = (2 * Math.PI * (k % n)) / n
    return [base[0] + r * Math.cos(angle), base[1] + r * Math.sin(angle), base[2] + z]
  }
  for (let k = 0; k < n; k++) {
    if (k !== skipSide) addPolygon(mesh, [ring(k, 0), ring(k + 1, 0), ring(k + 1, h), ring(k, h)])
    const lower: Vec3 = [base[0], base[1], base[2]]
    const upper: Vec3 = [base[0], base[1], base[2] + h]
    if (top) addPolygon(mesh, [upper, ring(k, h), ring(k + 1, h)])
    if (bottom) addPolygon(mesh, [lower, ring(k + 1, 0), ring(k, 0)])
  }
}

function boundsOf(positions: ArrayLike<number>): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i])
    max[i % 3] = Math.max(max[i % 3], positions[i])
  }
  return { min, max }
}

function massOf(mesh: Mesh): MeshMassProps {
  return computeMeshMass(mesh.positions, mesh.indices, boundsOf(mesh.positions))
}

function expectClose(actual: number, expected: number, relative: number, absolute = 0): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    Math.max(absolute, Math.abs(expected) * relative)
  )
}

function expectProps(
  actual: MeshMassProps,
  expected: { volume: number; centroid: Vec3; inertia: number[] },
  relative: number
): void {
  expectClose(actual.volume, expected.volume, relative)
  // 무게중심·관성은 크기에 맞춘 절대 허용치로 본다(0인 성분도 있으므로)
  const length = Math.cbrt(expected.volume)
  actual.centroid.forEach((value, i) =>
    expectClose(value, expected.centroid[i], 0, length * relative)
  )
  const scale = Math.max(...expected.inertia.map(Math.abs))
  actual.inertia.forEach((value, i) => expectClose(value, expected.inertia[i], 0, scale * relative))
}

// 균일 직육면체 여러 개를 평행축 정리로 합친 해석해(단위 밀도, 피벗 기준 무게중심, [Ixx, Iyy, Izz, Ixy, Ixz, Iyz])
function boxesAnalytic(
  boxes: { min: Vec3; max: Vec3 }[],
  pivot: Vec3
): { volume: number; centroid: Vec3; inertia: number[] } {
  const parts = boxes.map(({ min, max }) => {
    const [a, b, c] = [0, 1, 2].map((i) => max[i] - min[i])
    const volume = a * b * c
    return {
      volume,
      center: boundsCenter({ min, max }),
      diagonal: [(b * b + c * c) / 12, (a * a + c * c) / 12, (a * a + b * b) / 12].map(
        (value) => value * volume
      )
    }
  })
  const volume = parts.reduce((sum, part) => sum + part.volume, 0)
  const center = [0, 1, 2].map(
    (i) => parts.reduce((sum, part) => sum + part.volume * part.center[i], 0) / volume
  ) as Vec3
  const inertia = [0, 0, 0, 0, 0, 0]
  for (const part of parts) {
    const [dx, dy, dz] = [0, 1, 2].map((i) => part.center[i] - center[i])
    inertia[0] += part.diagonal[0] + part.volume * (dy * dy + dz * dz)
    inertia[1] += part.diagonal[1] + part.volume * (dx * dx + dz * dz)
    inertia[2] += part.diagonal[2] + part.volume * (dx * dx + dy * dy)
    // 비대각은 행렬 값: Ixy = −∫xy dm
    inertia[3] -= part.volume * dx * dy
    inertia[4] -= part.volume * dx * dz
    inertia[5] -= part.volume * dy * dz
  }
  return { volume, centroid: [0, 1, 2].map((i) => center[i] - pivot[i]) as Vec3, inertia }
}

// 정n각기둥(외접원 반지름 r, 높이 h)의 해석해. 다각형 극관성 = n r⁴ sin θ (2 + cos θ) / 12, θ = 2π/n
function prismAnalytic(
  r: number,
  h: number,
  n: number
): { volume: number; inertia: number[]; area: number } {
  const theta = (2 * Math.PI) / n
  const area = (n / 2) * r * r * Math.sin(theta)
  const polar = (n * r ** 4 * Math.sin(theta) * (2 + Math.cos(theta))) / 12
  const volume = area * h
  const side = h * (polar / 2) + (volume * h * h) / 12
  const perimeter = n * 2 * r * Math.sin(theta / 2)
  return { volume, inertia: [side, side, h * polar, 0, 0, 0], area: 2 * area + perimeter * h }
}

describe('computeMeshMass: 해석해', () => {
  it('단위 정육면체: 부피 1, 피벗 = 무게중심, 관성 1/6, 곱관성 0, 닫힘 0', () => {
    const cube = emptyMesh()
    addBox(cube, [0, 0, 0], [1, 1, 1])
    const props = massOf(cube)
    expectProps(
      props,
      { volume: 1, centroid: [0, 0, 0], inertia: [1 / 6, 1 / 6, 1 / 6, 0, 0, 0] },
      1e-12
    )
    expect(props.area).toBeCloseTo(6, 12)
    expect(props.closure).toBeLessThan(1e-12)
    expect(meshMassState(props)).toBe('closed')
  })

  it('떨어진 상자 둘: 피벗 기준 무게중심과 평행축 정리, 곱관성의 부호(Ixy = −∫xy dm)', () => {
    const boxes: { min: Vec3; max: Vec3 }[] = [
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [2, 1, 0], max: [4, 2, 2] }
    ]
    const mesh = emptyMesh()
    for (const box of boxes) addBox(mesh, box.min, box.max)
    const expected = boxesAnalytic(boxes, [2, 1, 1])
    // 곱관성이 모두 0이 아닌 배치다(부호 관례를 시험하려고)
    expect(expected.inertia.slice(3).every((value) => Math.abs(value) > 0.1)).toBe(true)
    expectProps(massOf(mesh), expected, 1e-12)
  })

  it('원점에서 먼 메시도 피벗 기준이라 같은 값이다', () => {
    const near = emptyMesh()
    const far = emptyMesh()
    addBox(near, [0, 0, 0], [0.1, 0.2, 0.05])
    addBox(far, [300, -200, 500], [300.1, -199.8, 500.05])
    const a = massOf(near)
    const b = massOf(far)
    expectProps(b, a, 1e-9)
  })

  it.each([13, 26, 64, 4096])('떨어진 정%i각기둥: 부피·관성 해석해와 다각형 넓이 비', (n) => {
    const [r, h] = [0.02, 0.1]
    const base: Vec3 = [0.5, 0.3, 0]
    const mesh = emptyMesh()
    addCylinder(mesh, base, r, h, n)
    const props = massOf(mesh)
    const expected = prismAnalytic(r, h, n)
    // 피벗(경계 상자 중심)은 n이 홀수면 축에서 벗어난다
    const pivot = boundsCenter(boundsOf(mesh.positions))
    const centroid = [base[0] - pivot[0], base[1] - pivot[1], h / 2 - pivot[2]] as Vec3
    expectProps(props, { ...expected, centroid }, 1e-9)
    expectClose(props.area, expected.area, 1e-12)
    // 원을 내접 다각형으로 바꾼 부피 비 n·sin(2π/n)/(2π): 13각형 −3.848 %, 64각형 −0.161 %
    const ratio = props.volume / (Math.PI * r * r * h)
    expectClose(ratio, (n * Math.sin((2 * Math.PI) / n)) / (2 * Math.PI), 1e-12)
    expect(props.closure).toBeLessThan(1e-12)
  })

  it('거울상(감김 그대로, 부피 음수)은 부호를 바꿔 같은 부피·관성이고 x 무게중심과 x 곱관성이 반대다', () => {
    const boxes: { min: Vec3; max: Vec3 }[] = [
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [2, 1, 0], max: [4, 2, 2] }
    ]
    const mesh = emptyMesh()
    for (const box of boxes) addBox(mesh, box.min, box.max)
    const mirrored = { ...mesh, positions: mesh.positions.map((v, i) => (i % 3 === 0 ? -v : v)) }
    const original = massOf(mesh)
    const props = massOf(mirrored)
    expect(props.volume).toBeGreaterThan(0)
    const [xx, yy, zz, xy, xz, yz] = original.inertia
    expectProps(
      props,
      {
        volume: original.volume,
        centroid: [-original.centroid[0], original.centroid[1], original.centroid[2]],
        inertia: [xx, yy, zz, -xy, -xz, yz]
      },
      1e-12
    )
    expect(props.closure).toBeLessThan(1e-12)
  })

  it('모든 삼각형의 감김을 뒤집어도 같은 결과다', () => {
    const mesh = emptyMesh()
    addCylinder(mesh, [0.1, 0, 0.2], 0.03, 0.05, 37)
    const flipped = { ...mesh, indices: [...mesh.indices] }
    for (let t = 0; t < flipped.indices.length; t += 3) {
      ;[flipped.indices[t + 1], flipped.indices[t + 2]] = [mesh.indices[t + 2], mesh.indices[t + 1]]
    }
    expectProps(massOf(flipped), massOf(mesh), 1e-12)
  })
})

describe('computeMeshMass: 열린 메시와 표면', () => {
  const [r, h] = [0.02, 0.1]

  it('윗뚜껑이 빠진 원기둥은 닫힘 지표가 커서 표면이다(피벗 기준 부피 5/6)', () => {
    const mesh = emptyMesh()
    addCylinder(mesh, [0, 0, 0], r, h, 64, { top: false })
    const props = massOf(mesh)
    const full = prismAnalytic(r, h, 64).volume
    expectClose(props.volume, (5 / 6) * full, 1e-12)
    // 면적 벡터 항: |S| = 뚜껑 넓이, 반대각선 R → A·R / (3 · 5/6 · A·h) = 2R / (5h) ≈ 0.23
    // 축별 부피 항: V_x = V_y = V, V_z = V/2(바닥만) → |V/2 − 5V/6| / (5V/6) = 0.4
    const half = Math.hypot(r, r, h / 2)
    expect((2 * half) / (5 * h)).toBeLessThan(0.4)
    expectClose(props.closure, 0.4, 1e-9)
    expect(props.closure).toBeGreaterThan(MASS_CLOSURE_LIMIT)
    expect(meshMassState(props)).toBe('surface')
  })

  it('옆면 조각 하나가 빠진 원기둥은 열린 메시(근사)로 쓴다', () => {
    const mesh = emptyMesh()
    addCylinder(mesh, [0, 0, 0], r, h, 1024, { skipSide: 100 })
    const props = massOf(mesh)
    expect(props.closure).toBeGreaterThan(MASS_CLOSURE_OPEN)
    expect(props.closure).toBeLessThanOrEqual(MASS_CLOSURE_LIMIT)
    expect(meshMassState(props)).toBe('open')
    // 부피 오차는 closure 아래다
    const full = prismAnalytic(r, h, 1024).volume
    expect(Math.abs(props.volume - full) / full).toBeLessThan(props.closure)
  })

  it('양쪽 뚜껑이 빠진 관: 면적 벡터는 상쇄되지만 축별 부피가 달라 표면이다', () => {
    const mesh = emptyMesh()
    addCylinder(mesh, [0, 0, 0], r, h, 64, { top: false, bottom: false })
    const props = massOf(mesh)
    // 사면체 합은 2/3(V_x = V_y = V, V_z = 0)이고, 퍼짐 |0 − 2V/3| / (2V/3) = 1이 closure다
    expectClose(props.volume, (2 / 3) * prismAnalytic(r, h, 64).volume, 1e-12)
    expectClose(props.closure, 1, 1e-9)
    expect(meshMassState(props)).toBe('surface')
  })

  it('한계: 구멍이 세 축 모두 대칭이면 두 지표가 모두 0이라 닫힌 것으로 보인다', () => {
    // 정육면체의 여섯 면에서 삼각형 하나씩(맞은편끼리 면적 벡터가 상쇄)을 뺀다. V_x = V_y = V_z = V/2
    const mesh = emptyMesh()
    addBox(mesh, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
    mesh.indices = mesh.indices.filter((_, i) => i % 6 >= 3)
    const props = massOf(mesh)
    expect(props.closure).toBeLessThan(1e-12)
    expect(meshMassState(props)).toBe('closed')
    expectClose(props.volume, 0.5, 1e-12)
  })

  it('면만 있는 판은 부피 0·closure Infinity·표면이고 무게중심은 피벗이다', () => {
    const plate = emptyMesh()
    addPolygon(plate, [
      [0, 0, 0.3],
      [0.1, 0, 0.3],
      [0.1, 0.1, 0.3],
      [0, 0.1, 0.3]
    ])
    const props = massOf(plate)
    expect(props).toEqual({
      volume: 0,
      centroid: [0, 0, 0],
      inertia: [0, 0, 0, 0, 0, 0],
      area: expect.closeTo(0.01, 15),
      closure: Infinity
    })
    expect(meshMassState(props)).toBe('surface')
    expect(isMeshMassProps(props)).toBe(true)
  })

  it('MASS_MIN_VOLUME보다 작은 닫힌 솔리드와 깨진 좌표도 표면(유한한 값)으로 둔다', () => {
    const tiny = emptyMesh()
    addBox(tiny, [0, 0, 0], [1e-5, 1e-5, 1e-5])
    expect(1e-15).toBeLessThan(MASS_MIN_VOLUME)
    expect(massOf(tiny)).toMatchObject({ volume: 0, closure: Infinity })

    const broken = emptyMesh()
    addBox(broken, [0, 0, 0], [1, 1, 1])
    broken.positions[4] = NaN
    const props = computeMeshMass(broken.positions, broken.indices, {
      min: [0, 0, 0],
      max: [1, 1, 1]
    })
    expect(meshMassState(props)).toBe('surface')
    expect(isMeshMassProps(props)).toBe(true)
    // 범위 밖 인덱스도 같다
    const outside = computeMeshMass([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 7], {
      min: [0, 0, 0],
      max: [1, 1, 0]
    })
    expect(meshMassState(outside)).toBe('surface')
  })
})

describe('computeMeshMass: 큰 Float32 메시', () => {
  // 원점에서 약 1 m 떨어진 86만 삼각형 원기둥(goBILDA 키트 860만 삼각형의 10분의 1)
  const [r, h, n] = [0.05, 0.3, 215000]
  let positions: Float32Array
  let indices: Uint32Array

  beforeAll(() => {
    const mesh = emptyMesh()
    addCylinder(mesh, [0.7, -0.6, 0.2], r, h, n)
    positions = Float32Array.from(mesh.positions)
    indices = Uint32Array.from(mesh.indices)
  })

  it('부피·관성 상대 오차가 1e-6 아래다(Float32 좌표 반올림만 남는다)', () => {
    expect(indices.length / 3).toBe(860000)
    const props = computeMeshMass(positions, indices, boundsOf(positions))
    const expected = prismAnalytic(r, h, n)
    expectClose(props.volume, expected.volume, 1e-6)
    props.inertia.slice(0, 3).forEach((value, i) => expectClose(value, expected.inertia[i], 1e-6))
    // n이 4의 배수라 피벗이 축 위에 있다
    for (const value of props.centroid) expect(Math.abs(value)).toBeLessThan(1e-7)
    expect(props.closure).toBeLessThan(1e-6)
  })

  it('성능: 한 번 훑기로 끝난다(키트 860만 삼각형 실측 약 0.5 s, 명세 한도 1 s)', () => {
    const bounds = boundsOf(positions)
    computeMeshMass(positions, indices, bounds)
    const start = performance.now()
    computeMeshMass(positions, indices, bounds)
    // 지금 약 60 ms(키트 크기로 0.6 s). 다른 시험과 함께 돌 때를 생각해 몇 배 넉넉하게 둔다.
    expect(performance.now() - start).toBeLessThan(500)
  })

  it('같은 입력이면 비트까지 같다(결정성)', () => {
    const mesh = emptyMesh()
    addCylinder(mesh, [0.1, 0.2, 0.3], 0.04, 0.2, 999)
    expect(massOf(mesh)).toEqual(massOf(mesh))
  })
})

describe('isMeshMassProps', () => {
  const good: MeshMassProps = {
    volume: 1,
    centroid: [0, 0, 0],
    inertia: [1, 1, 1, 0, 0, 0],
    area: 6,
    closure: 0
  }

  it('모양을 확인한다(유한 수, volume ≥ 0, 성분 6개, closure는 Infinity 허용)', () => {
    expect(isMeshMassProps(good)).toBe(true)
    expect(isMeshMassProps({ ...good, closure: Infinity, volume: 0 })).toBe(true)
    for (const bad of [
      undefined,
      null,
      1,
      { ...good, volume: -1 },
      { ...good, volume: NaN },
      { ...good, area: Infinity },
      { ...good, closure: NaN },
      { ...good, closure: -1 },
      { ...good, centroid: [0, 0] },
      { ...good, centroid: [0, 0, '1'] },
      { ...good, inertia: [1, 1, 1, 0, 0] },
      { ...good, inertia: [1, 1, 1, 0, 0, Infinity] }
    ]) {
      expect(isMeshMassProps(bad)).toBe(false)
    }
  })
})

// CAx-IF 시험 파일의 검증 속성(원래 CAD가 B-rep으로 계산한 부피·무게중심)과 비교한다. 메시는 원을 내접 다각형으로
// 바꾸므로 볼록한 둥근 파트는 작게, 구멍 난 파트는 크게 나온다(이 파일들의 실측 최악은 dm1-pe-214 볼트 −0.92 %).
describe('CAx-IF 샘플의 기준 부피', () => {
  let occt: Occt
  const require = createRequire(import.meta.url)
  const read = (name: string): ImportedModel => {
    const file = require.resolve(`occt-import-js/test/testfiles/cax-if/${name}`)
    const result = occt.ReadStepFile(new Uint8Array(readFileSync(file)), { linearUnit: 'meter' })
    return convertOcctResult(result, name)!
  }
  const MM3 = 1e-9
  const IN3 = 0.0254 ** 3
  // 메시 이름 → 그 이름의 메시 부피 목록(m³)
  const volumes = (model: ImportedModel, name: string): number[] =>
    model.meshes.filter((mesh) => mesh.name === name).map((mesh) => mesh.mass.volume)
  // CAD 좌표 무게중심
  const centroidOf = (model: ImportedModel, index: number): Vec3 => {
    const mesh = model.meshes[index]
    const pivot = boundsCenter(mesh.bounds)
    return [0, 1, 2].map((i) => mesh.mass.centroid[i] + pivot[i]) as Vec3
  }
  const allClosed = (model: ImportedModel): void => {
    for (const mesh of model.meshes) {
      expect(mesh.mass.closure).toBeLessThan(1e-12)
      expect(meshMassState(mesh.mass)).toBe('closed')
    }
  }

  beforeAll(async () => {
    occt = await (require('occt-import-js') as () => Promise<Occt>)()
  })

  it('io1-tu-203 솔리드 하나: 부피와 무게중심', () => {
    const model = read('io1-tu-203.stp')
    allClosed(model)
    expect(model.meshes).toHaveLength(1)
    // io1-tu-203.stp:1411 VOLUME_MEASURE(78177.780226337), :1422 centre point (12.701639964, 0, 0) (mm)
    expectClose(model.meshes[0].mass.volume, 78177.780226337 * MM3, 0.002)
    const centroid = centroidOf(model, 0)
    ;[12.701639964e-3, 0, 0].forEach((value, i) => expectClose(centroid[i], value, 0, 1e-5))
  })

  it('as1-tu-203 어셈블리: 파트마다 ±1 %, 전체 ±0.05 %', () => {
    const model = read('as1-tu-203.stp')
    allClosed(model)
    // as1-tu-203.stp의 VOLUME_MEASURE(mm³): nut :353, rod :534, bolt :862, l-bracket :1612, plate :2500
    const reference: [string, number, number][] = [
      ['nut', 664.476451301, 8],
      ['rod', 15705.534251651, 1],
      ['bolt', 3199.194869827, 6],
      ['l-bracket', 96858.893149642, 2],
      ['plate', 530576.67944901, 1]
    ]
    for (const [name, volume, count] of reference) {
      const found = volumes(model, name)
      expect(found).toHaveLength(count)
      for (const value of found) expectClose(value, volume * MM3, 0.01)
    }
    // :2573 어셈블리 전체 VOLUME_MEASURE(764518.031066584)
    const total = model.meshes.reduce((sum, mesh) => sum + mesh.mass.volume, 0)
    expectClose(total, 764518.031066584 * MM3, 0.0005)
  })

  it('sg1-c5-214 곡면 파트: 부피와 무게중심', () => {
    const model = read('sg1-c5-214.stp')
    allClosed(model)
    // sg1-c5-214.stp:42 VOLUME_MEASURE(355877.882829), :152 centre point z −15.1684663878 (mm)
    expectClose(model.meshes[0].mass.volume, 355877.882829 * MM3, 0.005)
    expectClose(centroidOf(model, 0)[2], -15.1684663878e-3, 0, 1e-5)
  })

  it('인치 파일도 미터로 읽어 같은 값이다(as1_pe_203 판, dm1-pe-214)', () => {
    const plate = read('as1_pe_203.stp')
    allClosed(plate)
    // as1_pe_203.stp:764-765 PLATE VOLUME_MEASURE(5.305752176936E5) in³, :766 centre point (−50, −10, 1.55e-4) in
    expectClose(plate.meshes[0].mass.volume, 5.305752176936e5 * IN3, 0.001)
    const centroid = centroidOf(plate, 0)
    ;[-50, -10, 1.551408518876e-4].forEach((value, i) =>
      expectClose(centroid[i], value * 0.0254, 0, 1e-5)
    )

    const model = read('dm1-pe-214.stp')
    allClosed(model)
    // dm1-pe-214.stp(in³): L-BRACKET :650-651, BOLT :928-929, NUT :1279-1280
    const reference: [string, number, number][] = [
      ['L-BRACKET', 9.685840734641e4, 1],
      ['BOLT', 3.436116964864e3, 3],
      ['NUT', 6.643805509808e2, 3]
    ]
    for (const [name, volume, count] of reference) {
      const found = volumes(model, name)
      expect(found).toHaveLength(count)
      for (const value of found) expectClose(value, volume * IN3, 0.01)
    }
  })
})
