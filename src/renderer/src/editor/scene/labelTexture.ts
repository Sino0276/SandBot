import { CanvasTexture, SRGBColorSpace } from 'three'
import { WALL_LABEL_HEIGHT, WALL_LABEL_WIDTH } from './fieldViewModel'

// 씬 뷰 벽 라벨의 글자 텍스처(spec-4ab §1.9). CDN 글꼴을 쓰지 않는다(CSP).

// 라벨 텍스처 해상도(px)·글꼴·색 [가정: 표시만]. 높이는 평면 0.9 × 0.15 m와 같은 비. 텍스처 위 행(flipY) = 평면 +y = 바깥쪽
const LABEL_PIXELS_WIDTH = 512
const LABEL_PIXELS_HEIGHT = Math.round((LABEL_PIXELS_WIDTH * WALL_LABEL_HEIGHT) / WALL_LABEL_WIDTH)
const LABEL_FONT = '600 48px system-ui, sans-serif'
const LABEL_COLOR = '#d0d4da'
// 글자가 텍스처 가장자리에 닿지 않게 줄이는 폭(px, 양쪽 합) [가정: 표시만]
const LABEL_PADDING = 8

// 글자 하나를 캔버스 텍스처로(CDN 글꼴을 쓰지 않는다, CSP). DOM이 없으면(시험) null
export function createLabelTexture(text: string): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = LABEL_PIXELS_WIDTH
  canvas.height = LABEL_PIXELS_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) return null
  context.font = LABEL_FONT
  context.fillStyle = LABEL_COLOR
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(
    text,
    LABEL_PIXELS_WIDTH / 2,
    LABEL_PIXELS_HEIGHT / 2,
    LABEL_PIXELS_WIDTH - LABEL_PADDING
  )
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
