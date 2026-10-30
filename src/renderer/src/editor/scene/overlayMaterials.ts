import { DoubleSide, LineBasicMaterial, MeshBasicMaterial, type Texture } from 'three'

// FTC Dashboard 오버레이(DashboardOverlay.tsx)의 재질. 패킷마다 형상만 다시 만들고 재질은 이어 쓴다: 재질을 해제하면
// three가 그 재질만 쓰던 셰이더 프로그램을 지우므로(WebGLPrograms.releaseProgram), 오버레이가 바뀔 때마다(Road Runner는
// 1x에서 약 10 Hz) 프로그램을 다시 컴파일하게 된다. 채움·선 띠는 꼭짓점 색 재질 하나, 격자 선은 선 재질 하나를 함께 쓰고,
// 글자·그림은 묶음마다 텍스처만 바꿔 끼우는 재질을 돌려 쓴다(map을 다른 텍스처로 바꾸는 것은 프로그램을 바꾸지 않는다).

function overlayMaterial(
  params: ConstructorParameters<typeof MeshBasicMaterial>[0]
): MeshBasicMaterial {
  return new MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    ...params
  })
}

export class OverlayMaterials {
  // 채움·선 띠(꼭짓점 색과 alpha)
  readonly mesh = overlayMaterial({ vertexColors: true })
  // 격자 선(1 px)
  readonly lines = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    toneMapped: false
  })
  // 글자·그림 재질. 이번 그림은 앞의 used개를 쓴다.
  private readonly mapped: MeshBasicMaterial[] = []
  private used = 0

  // 한 번 그리기의 시작(글자·그림 재질을 처음부터 다시 나눠 준다)
  begin(): void {
    this.used = 0
  }

  // 글자·그림 묶음 하나의 재질
  map(texture: Texture, opacity: number): MeshBasicMaterial {
    let material = this.mapped[this.used]
    if (!material) {
      material = overlayMaterial({ map: texture })
      this.mapped.push(material)
    }
    this.used += 1
    material.map = texture
    material.opacity = opacity
    return material
  }

  // 한 번 그리기의 끝. 이번에 쓰지 않은 재질은 텍스처를 놓는다(해제한 글자 텍스처의 캔버스를 붙잡지 않게). 재질은
  // 남겨 두어 프로그램을 지키고, 다시 쓸 때 텍스처를 끼운다(그때까지 그리지 않으므로 빈 map으로 그려지는 일은 없다).
  end(): void {
    for (let index = this.used; index < this.mapped.length; index += 1)
      this.mapped[index].map = null
  }

  dispose(): void {
    this.mesh.dispose()
    this.lines.dispose()
    for (const material of this.mapped) material.dispose()
    this.mapped.length = 0
    this.used = 0
  }
}
