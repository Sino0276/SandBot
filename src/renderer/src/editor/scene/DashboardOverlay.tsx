import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  LineSegments,
  Mesh,
  SRGBColorSpace,
  Texture,
  type Group,
  type Object3D
} from 'three'
import type { ReadTeamCodeAssetResult } from '../../../../shared/ipc'
import { MAX_TEAMCODE_ASSET_BYTES } from '../../../../shared/teamCodeAssets'
import { ipcErrorDetail } from '../../java/ipcError'
import type { ConsoleNoticeKey } from '../../play/consoleModel'
import {
  apply,
  interpretDashOps,
  OVERLAY_Z,
  tessellateOverlay,
  type Affine,
  type OverlayRun
} from '../../play/dashOverlay'
import type { Rgba } from '../../play/cssColor'
import { usePlayStore } from '../../play/playStore'
import { useProjectStore } from '../../project/projectStore'
import { OverlayMaterials } from './overlayMaterials'

// FTC Dashboard 필드 오버레이(라이브러리 L2): 마지막 패킷의 field() + fieldOverlay() op를 Dashboard 웹 클라이언트처럼
// 필드 바닥 바로 위에 그린다(변환은 play/dashOverlay.ts). 씬 문서 밖이고(실행 취소·저장과 관계없음), 숨김과 관계없고,
// 클릭되지 않는다. 다음 INIT·프로젝트 열기까지 남는다(playStore.dashOverlay).
// 그리기 순서는 op 순서다: 묶음마다 renderOrder를 하나씩 올리고 깊이를 쓰지 않아 뒤의 것이 위에 쌓인다(바닥·로봇과는
// 깊이 검사를 한다). 반투명 잔상·벽보다 먼저 그려 그것들이 오버레이 위에 비친다. 패킷마다 형상만 다시 만들고 재질은
// 이어 쓴다(overlayMaterials.ts, 셰이더를 다시 컴파일하지 않게).

const RENDER_ORDER_BASE = -100_000
// 글자 텍스처의 글꼴 크기(px). 글자 틀 단위(font.size)를 이 픽셀로 그린다.
const TEXT_PIXELS = 64
const MAX_TEXTURE_SIZE = 2048

const noRaycast = (): void => {}

// sRGB 성분(0–1) → 선형(three의 꼭짓점 색은 선형으로 읽는다)
function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearColors(colors: Float32Array): Float32Array {
  const out = new Float32Array(colors.length)
  for (let i = 0; i < colors.length; i += 4) {
    out[i] = srgbToLinear(colors[i])
    out[i + 1] = srgbToLinear(colors[i + 1])
    out[i + 2] = srgbToLinear(colors[i + 2])
    out[i + 3] = colors[i + 3]
  }
  return out
}

const cssColor = (color: Rgba): string =>
  `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`

// 틀 좌표의 사각형(왼쪽 위 x0, y0 → 오른쪽 아래 x1, y1, y 아래)을 필드 미터 사각형으로. UV는 텍스처 왼쪽 위가 (0, 0)이다
// (flipY를 끈 텍스처).
function quadGeometry(
  matrix: Affine,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): BufferGeometry {
  const corners: [number, number, number, number][] = [
    [x0, y0, 0, 0],
    [x1, y0, 1, 0],
    [x1, y1, 1, 1],
    [x0, y1, 0, 1]
  ]
  const positions: number[] = []
  const uvs: number[] = []
  for (const index of [0, 1, 2, 0, 2, 3]) {
    const [x, y, u, v] = corners[index]
    const [px, py] = apply(matrix, x, y)
    positions.push(px, py, OVERLAY_Z)
    uvs.push(u, v)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  return geometry
}

type TextRun = Extract<OverlayRun, { kind: 'text' }>
type TextEntry = { texture: Texture; quad: [number, number, number, number] }

const textKey = (run: TextRun): string =>
  JSON.stringify([run.text, run.font, run.color, run.stroke, run.stroke ? run.lineWidth : 0])

// 글자 하나를 캔버스 텍스처로(CDN 글꼴을 쓰지 않는다, CSP). quad는 글자 틀(기준선 왼쪽 끝 원점) 단위의 텍스처 범위다.
function textEntry(run: TextRun): TextEntry | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null
  let pixels = TEXT_PIXELS
  const fontText = (size: number): string => `${run.font.style} ${size}px ${run.font.family}`.trim()
  context.font = fontText(pixels)
  let metrics = context.measureText(run.text)
  // 너무 긴 글자는 텍스처 한도 안으로 줄인다
  if (metrics.width > MAX_TEXTURE_SIZE - 8) {
    pixels = Math.max(4, Math.floor((pixels * (MAX_TEXTURE_SIZE - 8)) / metrics.width))
    context.font = fontText(pixels)
    metrics = context.measureText(run.text)
  }
  const scale = pixels / run.font.size
  const ascent = metrics.fontBoundingBoxAscent ?? pixels * 0.8
  const descent = metrics.fontBoundingBoxDescent ?? pixels * 0.2
  const strokePixels = run.stroke ? run.lineWidth * scale : 0
  const pad = Math.ceil(strokePixels / 2) + 2
  const width = Math.min(MAX_TEXTURE_SIZE, Math.ceil(metrics.width + 2 * pad))
  const height = Math.min(MAX_TEXTURE_SIZE, Math.ceil(ascent + descent + 2 * pad))
  if (width <= 0 || height <= 0) return null
  canvas.width = width
  canvas.height = height
  // 크기를 바꾸면 캔버스 상태가 처음으로 돌아간다
  context.font = fontText(pixels)
  context.textBaseline = 'alphabetic'
  if (run.stroke) {
    context.strokeStyle = cssColor(run.color)
    context.lineWidth = strokePixels
    context.strokeText(run.text, pad, pad + ascent)
  } else {
    context.fillStyle = cssColor(run.color)
    context.fillText(run.text, pad, pad + ascent)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  return {
    texture,
    quad: [
      -pad / scale,
      -(ascent + pad) / scale,
      (width - pad) / scale,
      (height - ascent - pad) / scale
    ]
  }
}

// ---- 그림(TeamCode assets) ----

type ImageEntry = { status: 'loading' | 'ready' | 'failed'; texture: Texture | null }

type ImageFailure = {
  code: Extract<ReadTeamCodeAssetResult, { ok: false }>['code']
  detail: string
}

const FAILURE_NOTICES = {
  missing: 'dashImageMissing',
  notAllowed: 'dashImageNotAllowed',
  tooLarge: 'dashImageTooLarge',
  failed: 'dashImageFailed'
} as const satisfies Record<ImageFailure['code'], ConsoleNoticeKey>

// 그림 텍스처는 프로젝트 세션·실행(INIT)마다 한 번 읽는다(패킷마다 다시 읽지 않는다). 범위가 바뀌면 지우고 다시 읽어,
// 팀이 그림을 더하거나 고친 뒤 다시 INIT하면 보인다. 읽지 못한 그림은 창 포커스 때도 다시 읽고(다른 앱에서 고치고
// 돌아옴), 이유는 범위마다 그림 하나에 한 번 Console 경고로 알린다.
const images = new Map<string, ImageEntry>()
// 이 범위에서 읽지 못했다고 알린 그림
const reported = new Set<string>()
let imageScope = ''

const imageScopeOf = (root: string | null, session: number, runId: string | null): string =>
  `${root}\u0000${session}\u0000${runId ?? ''}`

function enterImageScope(scope: string): void {
  if (imageScope === scope) return
  for (const entry of images.values()) entry.texture?.dispose()
  images.clear()
  reported.clear()
  imageScope = scope
}

// 읽지 못한 그림을 잊어 다음 그리기에서 다시 읽게 한다(알림은 범위마다 한 번이라 다시 하지 않는다). 잊은 것이 있으면 true.
function forgetFailedImages(): boolean {
  let forgot = false
  for (const [path, entry] of images)
    if (entry.status === 'failed') {
      images.delete(path)
      forgot = true
    }
  return forgot
}

function reportImageFailure(path: string, failure: ImageFailure, tNanos: number): void {
  if (reported.has(path)) return
  reported.add(path)
  usePlayStore.getState().addConsole(
    {
      type: 'notice',
      key: FAILURE_NOTICES[failure.code],
      params: {
        path,
        detail: failure.detail,
        max: MAX_TEAMCODE_ASSET_BYTES / (1024 * 1024)
      }
    },
    tNanos
  )
}

// 그림 하나를 읽어 entry를 채운다. 읽지 못하면 그 이유를 돌려준다.
async function loadImage(
  root: string,
  path: string,
  entry: ImageEntry
): Promise<ImageFailure | null> {
  let result: ReadTeamCodeAssetResult
  try {
    result = await window.api.readTeamCodeAsset(root, path)
  } catch (error) {
    result = { ok: false, code: 'failed', detail: ipcErrorDetail(error) }
  }
  if (!result.ok) return { code: result.code, detail: result.detail }
  let bitmap: ImageBitmap
  try {
    // Blob → ImageBitmap은 URL을 쓰지 않아 CSP(img-src)와 관계없다
    // BlobPart 형식은 ArrayBuffer 바탕만 받으므로 복사한다(그림 하나라 비용이 작다)
    const bytes = new Uint8Array(result.bytes)
    // 곱하지 않은 alpha로 읽는다(three ImageBitmapLoader의 기본과 같다). 기본(premultiply)은 RGB에 alpha를 곱해 두는데
    // WebGL은 ImageBitmap에 UNPACK_PREMULTIPLY_ALPHA를 적용하지 않고 재질은 곱하지 않은 alpha로 섞으므로, 반투명
    // 픽셀이 Dashboard 캔버스보다 어두워진다.
    bitmap = await createImageBitmap(new Blob([bytes], { type: result.mime }), {
      premultiplyAlpha: 'none'
    })
  } catch (error) {
    // 머리는 그림이지만 풀 수 없다(깨진 파일 등)
    return { code: 'failed', detail: error instanceof Error ? error.message : String(error) }
  }
  if (images.get(path) !== entry) {
    bitmap.close()
    return null
  }
  const texture = new Texture(bitmap)
  texture.colorSpace = SRGBColorSpace
  // ImageBitmap은 flipY를 받지 않는다(UV가 왼쪽 위 원점이다)
  texture.flipY = false
  texture.needsUpdate = true
  entry.texture = texture
  return null
}

// 범위의 그림 텍스처(처음이면 읽기 시작한다). 다 읽으면(읽지 못해도) onLoaded. tNanos는 알림에 붙는 가상 시간이다.
function imageTexture(
  root: string,
  scope: string,
  path: string,
  tNanos: number,
  onLoaded: () => void
): ImageEntry {
  enterImageScope(scope)
  const existing = images.get(path)
  if (existing) return existing
  const entry: ImageEntry = { status: 'loading', texture: null }
  images.set(path, entry)
  void loadImage(root, path, entry).then((failure) => {
    // 그사이 범위가 바뀌었거나 다시 읽기로 잊은 그림이다
    if (images.get(path) !== entry) return
    entry.status = failure ? 'failed' : 'ready'
    if (failure) reportImageFailure(path, failure, tNanos)
    onLoaded()
  })
  return entry
}

function DashboardOverlay(): React.JSX.Element | null {
  const overlay = usePlayStore((state) => state.dashOverlay)
  const root = useProjectStore((state) => state.root)
  const session = useProjectStore((state) => state.session)
  const invalidate = useThree((state) => state.invalidate)
  const group = useRef<Group>(null)
  const materials = useRef<OverlayMaterials | null>(null)
  const texts = useRef(new Map<string, TextEntry>())
  // 그림을 다 읽으면 다시 만든다
  const [imageRevision, setImageRevision] = useState(0)
  const runs = useMemo(
    () => (overlay ? tessellateOverlay(interpretDashOps(overlay.ops)) : []),
    [overlay]
  )

  const scope = imageScopeOf(root, session, overlay?.runId ?? null)
  const tNanos = overlay?.tNanos ?? 0

  // 다른 프로젝트를 열거나 INIT으로 오버레이가 지워지면 그림 텍스처를 버린다(새 실행은 다시 읽는다)
  useEffect(() => enterImageScope(scope), [scope])

  // 창으로 돌아오면 읽지 못한 그림을 다시 읽는다(Android Studio·그림 편집기에서 넣거나 고치고 돌아옴)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const target = window
    const onFocus = (): void => {
      if (forgetFailedImages()) setImageRevision((revision) => revision + 1)
    }
    target.addEventListener('focus', onFocus)
    return () => target.removeEventListener('focus', onFocus)
  }, [])

  // 글자 텍스처는 오버레이가 바뀌어도 같은 글자면 다시 쓰고, 내려갈 때 해제한다(StrictMode가 다시 붙이면 새로 만든다)
  useEffect(() => {
    const cache = texts.current
    return () => {
      for (const entry of cache.values()) entry.texture.dispose()
      cache.clear()
    }
  }, [])

  // 재질은 오버레이가 바뀌어도 이어 쓰고 내려갈 때 해제한다. 그리기 effect보다 앞에 두어 붙을 때 먼저 만들어진다
  // (StrictMode가 떼었다 다시 붙이면 새로 만든다).
  useLayoutEffect(() => {
    const created = new OverlayMaterials()
    materials.current = created
    return () => {
      created.dispose()
      if (materials.current === created) materials.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const parent = group.current
    const pool = materials.current
    if (!parent || !pool) return
    const objects: Object3D[] = []
    const geometries: BufferGeometry[] = []
    const usedTexts = new Set<string>()
    pool.begin()
    const add = (object: Mesh | LineSegments, index: number): void => {
      object.renderOrder = RENDER_ORDER_BASE + index
      object.raycast = noRaycast
      object.frustumCulled = false
      objects.push(object)
      parent.add(object)
    }
    runs.forEach((run, index) => {
      switch (run.kind) {
        case 'mesh':
        case 'lines': {
          const geometry = new BufferGeometry()
          geometry.setAttribute('position', new BufferAttribute(run.positions, 3))
          geometry.setAttribute('color', new BufferAttribute(linearColors(run.colors), 4))
          geometries.push(geometry)
          if (run.kind === 'mesh') add(new Mesh(geometry, pool.mesh), index)
          else add(new LineSegments(geometry, pool.lines), index)
          break
        }
        case 'text': {
          const key = textKey(run)
          let entry = texts.current.get(key)
          if (!entry) {
            const created = textEntry(run)
            if (!created) break
            entry = created
            texts.current.set(key, entry)
          }
          usedTexts.add(key)
          const [x0, y0, x1, y1] = entry.quad
          const geometry = quadGeometry(run.matrix, x0, y0, x1, y1)
          geometries.push(geometry)
          add(new Mesh(geometry, pool.map(entry.texture, 1)), index)
          break
        }
        case 'image': {
          if (!root) break
          const entry = imageTexture(root, scope, run.path, tNanos, () =>
            setImageRevision((revision) => revision + 1)
          )
          if (!entry.texture) break
          const [x, y, width, height] = run.rect
          const geometry = quadGeometry(run.matrix, x, y, x + width, y + height)
          geometries.push(geometry)
          add(new Mesh(geometry, pool.map(entry.texture, run.alpha)), index)
          break
        }
      }
    })
    pool.end()
    // 이번 그림에 쓰지 않은 글자 텍스처는 해제한다(바뀌는 글자가 쌓이지 않게)
    for (const [key, entry] of texts.current)
      if (!usedTexts.has(key)) {
        entry.texture.dispose()
        texts.current.delete(key)
      }
    invalidate()
    return () => {
      for (const object of objects) parent.remove(object)
      for (const geometry of geometries) geometry.dispose()
      invalidate()
    }
  }, [runs, root, scope, tNanos, imageRevision, invalidate])

  return <group ref={group} />
}

export default DashboardOverlay
