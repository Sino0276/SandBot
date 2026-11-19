import { BufferGeometry, Float32BufferAttribute } from 'three'

// 볼록 기둥 형상(6b 구조물·HIVE 부품 prism, spec-6b §1.1): 자기 x·y 평면의 볼록 반시계 다각형을 자기 z로 ±height/2 밀어낸
// 것. 색인 없는 삼각형이라 면마다 법선이 따로다(computeVertexNormals가 평평한 법선을 낸다). 윗면은 +z, 아랫면은 −z, 옆면은
// 변 (a → b)의 바깥 법선 (dy, −dx)를 본다(반시계라 바깥). 표시만이고 계산은 시즌 데이터의 다각형을 그대로 쓴다.
export function prismGeometry(
  polygon: readonly { x: number; y: number }[],
  height: number
): BufferGeometry {
  const n = polygon.length
  const top = height / 2
  const bottom = -height / 2
  const positions: number[] = []
  const push = (x: number, y: number, z: number): void => {
    positions.push(x, y, z)
  }
  // 위·아래 뚜껑: 첫 꼭짓점에서 부채꼴(볼록이라 그대로)
  for (let i = 1; i + 1 < n; i++) {
    const a = polygon[0]
    const b = polygon[i]
    const c = polygon[i + 1]
    push(a.x, a.y, top)
    push(b.x, b.y, top)
    push(c.x, c.y, top)
    push(a.x, a.y, bottom)
    push(c.x, c.y, bottom)
    push(b.x, b.y, bottom)
  }
  // 옆면: 변마다 사각형 둘
  for (let i = 0; i < n; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % n]
    push(a.x, a.y, bottom)
    push(b.x, b.y, bottom)
    push(b.x, b.y, top)
    push(a.x, a.y, bottom)
    push(b.x, b.y, top)
    push(a.x, a.y, top)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

// 원기둥 윤곽(6b 충돌체 윤곽의 원기둥 부품): 위·아래 원과 옆 선 넷(Collider 기즈모의 원기둥과 같은 모양, EdgesGeometry는 분할마다
// 세로선을 남긴다). CylinderGeometry와 같은 틀(자기 y가 축, 높이 가운데가 원점)이라 같은 변환으로 놓인다. LineSegments용 점 짝
export function cylinderOutlineGeometry(
  radius: number,
  height: number,
  segments: number
): BufferGeometry {
  const positions: number[] = []
  const top = height / 2
  const bottom = -height / 2
  const point = (k: number): [number, number] => {
    const angle = (2 * Math.PI * k) / segments
    return [radius * Math.cos(angle), radius * Math.sin(angle)]
  }
  for (const y of [top, bottom])
    for (let k = 0; k < segments; k++) {
      const [x0, z0] = point(k)
      const [x1, z1] = point(k + 1)
      positions.push(x0, y, z0, x1, y, z1)
    }
  for (const [x, z] of [
    [radius, 0],
    [0, radius],
    [-radius, 0],
    [0, -radius]
  ])
    positions.push(x, bottom, z, x, top, z)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  return geometry
}
