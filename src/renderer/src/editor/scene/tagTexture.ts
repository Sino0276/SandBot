import { DataTexture, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three'
import { TAG36H11_TOTAL_WIDTH, tag36h11Image } from '../../../../shared/sim/seasons/tag36h11'

// AprilTag 그림 텍스처(spec-4ab §1.9). 칸당 8 px이고 가장 가까운 화소(NearestFilter)로 그려 칸 경계가 번지지 않는다.
// 캔버스 대신 DataTexture로 만든다(DOM이 없어도 같은 화소, 시험에서 바로 읽힌다).

// 칸당 화소(spec-4ab §1.9)
export const TAG_CELL_PIXELS = 8

// RGBA 화소. DataTexture의 첫 행은 v = 0(아래)이라, 그림의 위 행(태그 틀 −y)이 마지막 행이 되게 아래 행부터 쓴다.
// 평면(PlaneGeometry)의 v = 1이 평면 +y이므로 텍스처 위 행 = 평면 +y = 태그 −y, 왼쪽 열 = 평면 −x = 태그 −x다.
export function tagPixels(id: number): Uint8Array | null {
  const image = tag36h11Image(id)
  if (!image) return null
  const cells = TAG36H11_TOTAL_WIDTH
  const size = cells * TAG_CELL_PIXELS
  const data = new Uint8Array(size * size * 4)
  for (let row = 0; row < size; row++) {
    // 데이터 행 row는 그림 행 (size − 1 − row)
    const cellRow = Math.floor((size - 1 - row) / TAG_CELL_PIXELS)
    for (let column = 0; column < size; column++) {
      const value = image[cellRow][Math.floor(column / TAG_CELL_PIXELS)] ? 255 : 0
      const offset = (row * size + column) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  return data
}

export function createTagTexture(id: number): DataTexture | null {
  const data = tagPixels(id)
  if (!data) return null
  const size = TAG36H11_TOTAL_WIDTH * TAG_CELL_PIXELS
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

// 텍스처 좌표 (u, v)의 그림 칸이 흰색인가(시험용: 데이터 행·열을 거꾸로 따라간다)
export function tagTextureWhiteAt(data: Uint8Array, u: number, v: number): boolean {
  const size = TAG36H11_TOTAL_WIDTH * TAG_CELL_PIXELS
  const row = Math.min(size - 1, Math.floor(v * size))
  const column = Math.min(size - 1, Math.floor(u * size))
  return data[(row * size + column) * 4] === 255
}
