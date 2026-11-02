import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  dashImageAssetPath,
  isTeamCodeAssetPath,
  MAX_TEAMCODE_ASSET_BYTES
} from '../shared/teamCodeAssets'
import { clearTrustedRoots, trustRoot } from './projectRoots'
import { imageMime, readTeamCodeAsset } from './teamCodeAssets'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const GIF = new TextEncoder().encode('GIF89a....')
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')

describe('TeamCode assets 경로 규칙', () => {
  it('images 아래 그림만 받는다', () => {
    expect(isTeamCodeAssetPath('images/field.png')).toBe(true)
    expect(isTeamCodeAssetPath('images/sub/Field Map.JPEG')).toBe(true)
    expect(isTeamCodeAssetPath('images/한글.webp')).toBe(true)
    expect(isTeamCodeAssetPath('images/a.gif')).toBe(true)
    expect(isTeamCodeAssetPath('images/a.jpg')).toBe(true)
  })

  it('images 밖, 그림이 아닌 확장자, 위험한 이름은 받지 않는다', () => {
    for (const path of [
      'field.png',
      '/images/field.png',
      'Images/field.png',
      'images/../secret.png',
      'images/./a.png',
      'images//a.png',
      'images/.hidden.png',
      'images/a.svg',
      'images/a.png.exe',
      'images/a',
      'images\\a.png',
      'images/C:a.png',
      'images/a.png ',
      'images/a.png.',
      'images/CON.png',
      'images/aux/a.png',
      'images/a\u0000.png',
      'images/a?.png',
      `images/${'a'.repeat(1100)}.png`,
      // NFD 글자는 NFC가 아니다
      'images/가.png',
      42,
      null
    ])
      expect(isTeamCodeAssetPath(path), String(path)).toBe(false)
  })

  it('Dashboard 그림 경로를 assets 기준으로 바꾼다(퍼센트 인코딩·쿼리)', () => {
    expect(dashImageAssetPath('/images/field.png')).toBe('images/field.png')
    expect(dashImageAssetPath('/images/my%20field.png?v=2#x')).toBe('images/my field.png')
    expect(dashImageAssetPath('/dash/decode.webp')).toBeNull()
    expect(dashImageAssetPath('https://example.com/images/a.png')).toBeNull()
    expect(dashImageAssetPath('/images/%2e%2e/secret.png')).toBeNull()
    expect(dashImageAssetPath('/images/%E0%A4%A.png')).toBeNull()
    expect(dashImageAssetPath('images/a.png')).toBeNull()
  })
})

describe('그림 형식', () => {
  it('파일 머리로 정한다', () => {
    expect(imageMime(PNG)).toBe('image/png')
    expect(imageMime(JPEG)).toBe('image/jpeg')
    expect(imageMime(GIF)).toBe('image/gif')
    expect(imageMime(WEBP)).toBe('image/webp')
    expect(imageMime(new TextEncoder().encode('<svg></svg>'))).toBeNull()
    expect(imageMime(new Uint8Array())).toBeNull()
  })
})

describe('readTeamCodeAsset', () => {
  let root: string
  let outside: string
  const asset = (...parts: string[]): string =>
    join(root, 'TeamCode', 'src', 'main', 'assets', ...parts)
  const put = async (target: string, content: Uint8Array | string): Promise<void> => {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sandbot-assets-'))
    outside = await mkdtemp(join(tmpdir(), 'sandbot-assets-outside-'))
    trustRoot(root)
  })

  afterEach(async () => {
    clearTrustedRoots()
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('assets/images의 그림을 형식과 함께 읽는다', async () => {
    await put(asset('images', 'field.png'), PNG)
    const result = await readTeamCodeAsset(root, 'images/field.png')
    expect(result).toEqual({ ok: true, mime: 'image/png', bytes: PNG })
    // 제 크기 버퍼(IPC가 바탕 버퍼 전체를 복사하지 않게)
    if (result.ok) expect(result.bytes.buffer.byteLength).toBe(PNG.length)
  })

  it('열거나 저장하지 않은 루트와 규칙에 맞지 않는 경로는 거부한다', async () => {
    await put(asset('images', 'field.png'), PNG)
    clearTrustedRoots()
    expect(await readTeamCodeAsset(root, 'images/field.png')).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
    trustRoot(root)
    expect(await readTeamCodeAsset(root, 'images/../images/field.png')).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
    expect(await readTeamCodeAsset(root, 'images/a.txt')).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
  })

  it('없는 파일·폴더는 missing이다', async () => {
    expect(await readTeamCodeAsset(root, 'images/none.png')).toMatchObject({
      ok: false,
      code: 'missing'
    })
  })

  it('그림 머리가 아니면 읽지 않는다', async () => {
    await put(asset('images', 'fake.png'), '<html>not an image</html>')
    expect(await readTeamCodeAsset(root, 'images/fake.png')).toMatchObject({
      ok: false,
      code: 'failed'
    })
  })

  it('크기 한도를 넘으면 tooLarge다', async () => {
    const big = new Uint8Array(MAX_TEAMCODE_ASSET_BYTES + 1)
    big.set(PNG)
    await put(asset('images', 'big.png'), big)
    expect(await readTeamCodeAsset(root, 'images/big.png')).toMatchObject({
      ok: false,
      code: 'tooLarge'
    })
  })

  it('폴더는 읽지 않는다', async () => {
    await mkdir(asset('images', 'dir.png'), { recursive: true })
    expect(await readTeamCodeAsset(root, 'images/dir.png')).toMatchObject({
      ok: false,
      code: 'notAllowed'
    })
  })

  it.skipIf(process.platform === 'win32')(
    'assets 밖을 가리키는 링크는 거부하고, 안을 가리키는 링크는 읽는다',
    async () => {
      await put(join(outside, 'secret.png'), PNG)
      await mkdir(asset('images'), { recursive: true })
      await symlink(join(outside, 'secret.png'), asset('images', 'link.png'))
      expect(await readTeamCodeAsset(root, 'images/link.png')).toMatchObject({
        ok: false,
        code: 'notAllowed'
      })
      // 폴더 링크로 밖에 나가는 것도
      await symlink(outside, asset('images', 'out'))
      expect(await readTeamCodeAsset(root, 'images/out/secret.png')).toMatchObject({
        ok: false,
        code: 'notAllowed'
      })
      // assets 안의 다른 그림을 가리키는 링크
      await put(asset('real.png'), PNG)
      await symlink(asset('real.png'), asset('images', 'inner.png'))
      expect(await readTeamCodeAsset(root, 'images/inner.png')).toMatchObject({
        ok: true,
        mime: 'image/png'
      })
      // 그림이 아닌 확장자를 가리키는 링크
      await put(asset('notes.txt'), PNG)
      await symlink(asset('notes.txt'), asset('images', 'notes.png'))
      expect(await readTeamCodeAsset(root, 'images/notes.png')).toMatchObject({
        ok: false,
        code: 'notAllowed'
      })
    }
  )
})
