import { describe, expect, it } from 'vitest'
import { ProgressTracker } from './fetcher'
import {
  CancelledError,
  downloadFile,
  FetchFailure,
  type DownloadOptions,
  type Sleep
} from './http'
import { REPOSITORIES } from './repositories'
import { BROTT, CENTRAL, fakeHttp, MIRROR, type FakeHttp, type Route } from './testkit'

const noSleep: Sleep = async () => undefined

function options(
  routes: Record<string, Route>,
  extra: { limit?: number; signal?: AbortSignal; waits?: number[] } = {}
): { http: FakeHttp; opts: DownloadOptions } {
  const http = fakeHttp(routes)
  const waits = extra.waits ?? []
  return {
    http,
    opts: {
      http,
      signal: extra.signal ?? new AbortController().signal,
      limit: extra.limit ?? 1024,
      sleep: (async (ms: number) => {
        waits.push(ms)
      }) as Sleep
    }
  }
}

describe('저장소에서 받기', () => {
  it('200이면 내용', async () => {
    const { opts } = options({ [`${CENTRAL}a/b/1/b-1.jar`]: 'jar' })
    const result = await downloadFile(REPOSITORIES.central, 'a/b/1/b-1.jar', opts)
    expect(result.bytes.toString()).toBe('jar')
  })

  it('maven.brott.dev의 302는 허용한 호스트로만 따라간다', async () => {
    const target = 'https://acmerobotics.z13.web.core.windows.net/a/b/1/b-1.jar'
    const ok = options({
      [`${BROTT}a/b/1/b-1.jar`]: {
        status: 302,
        headers: { location: target, 'set-cookie': 'crumb=x' }
      },
      [target]: 'jar'
    })
    expect(
      (await downloadFile(REPOSITORIES.brott, 'a/b/1/b-1.jar', ok.opts)).bytes.toString()
    ).toBe('jar')

    const evil = options({
      [`${BROTT}a/b/1/b-1.jar`]: {
        status: 302,
        headers: { location: 'https://evil.example/b-1.jar' }
      },
      'https://evil.example/b-1.jar': 'evil'
    })
    await expect(downloadFile(REPOSITORIES.brott, 'a/b/1/b-1.jar', evil.opts)).rejects.toThrow(
      /not an allowed/
    )
    expect(evil.http.requests).toEqual([`${BROTT}a/b/1/b-1.jar`])

    const downgrade = options({
      [`${BROTT}a/b/1/b-1.jar`]: {
        status: 302,
        headers: { location: 'http://acmerobotics.z13.web.core.windows.net/a/b/1/b-1.jar' }
      }
    })
    await expect(downloadFile(REPOSITORIES.brott, 'a/b/1/b-1.jar', downgrade.opts)).rejects.toThrow(
      /not an allowed/
    )
  })

  it('리디렉트는 3번까지', async () => {
    const host = 'https://acmerobotics.z13.web.core.windows.net/'
    const routes: Record<string, Route> = {
      [`${BROTT}x`]: { status: 302, headers: { location: `${host}1` } }
    }
    for (let i = 1; i <= 4; i++)
      routes[`${host}${i}`] = { status: 302, headers: { location: `${host}${i + 1}` } }
    const { opts } = options(routes)
    await expect(downloadFile(REPOSITORIES.brott, 'x', opts)).rejects.toThrow(/too many redirects/)
  })

  it('404는 거울을 보지 않고 notFound(본문은 보지 않는다)', async () => {
    const { http, opts } = options({
      [`${CENTRAL}a`]: { status: 404, body: '<html>9 KB page</html>' }
    })
    await expect(downloadFile(REPOSITORIES.central, 'a', opts)).rejects.toMatchObject({
      code: 'notFound'
    })
    expect(http.requests).toEqual([`${CENTRAL}a`])
  })

  it('처음 저장소가 막혔을 때 거울의 404는 처음 저장소의 실패를 따른다, 프록시 407은 다시 해 본다', async () => {
    const lagging = options({
      [`${CENTRAL}a`]: { status: 429 },
      [`${MIRROR}a`]: { status: 404 }
    })
    await expect(downloadFile(REPOSITORIES.central, 'a', lagging.opts)).rejects.toMatchObject({
      code: 'rateLimited'
    })
    let calls = 0
    const proxy = options({
      [`${BROTT}a`]: () => (++calls === 1 ? { status: 407 } : 'ok')
    })
    expect((await downloadFile(REPOSITORIES.brott, 'a', proxy.opts)).bytes.toString()).toBe('ok')
  })

  it('읽지 않는 응답 본문은 닫는다', async () => {
    let closed = false
    const http: DownloadOptions['http'] = async () => ({
      status: 404,
      header: () => null,
      body: {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true, value: undefined }),
          return: async () => {
            closed = true
            return { done: true, value: undefined }
          }
        })
      }
    })
    await expect(
      downloadFile(REPOSITORIES.central, 'a', {
        http,
        signal: new AbortController().signal,
        limit: 10
      })
    ).rejects.toMatchObject({ code: 'notFound' })
    expect(closed).toBe(true)
  })

  it('429면 Google 거울로 바꾼다', async () => {
    const { http, opts } = options({
      [`${CENTRAL}a`]: { status: 429, headers: { 'retry-after': '5' } },
      [`${MIRROR}a`]: 'from mirror'
    })
    expect((await downloadFile(REPOSITORIES.central, 'a', opts)).bytes.toString()).toBe(
      'from mirror'
    )
    expect(http.requests).toEqual([`${CENTRAL}a`, `${MIRROR}a`])
  })

  it('모두 429면 Retry-After만큼 기다렸다가 다시, 끝내 막히면 rateLimited', async () => {
    const waits: number[] = []
    const { http, opts } = options(
      {
        [`${BROTT}a`]: { status: 429, headers: { 'retry-after': '7' } }
      },
      { waits }
    )
    await expect(downloadFile(REPOSITORIES.brott, 'a', opts)).rejects.toMatchObject({
      code: 'rateLimited'
    })
    expect(waits).toEqual([7000, 7000])
    expect(http.requests.length).toBe(3)
  })

  it('네트워크가 없으면 기다리지 않고 offline', async () => {
    const waits: number[] = []
    const { http, opts } = options(
      {
        [`${CENTRAL}a`]: new Error('getaddrinfo ENOTFOUND'),
        [`${MIRROR}a`]: new Error('ENOTFOUND')
      },
      { waits }
    )
    await expect(downloadFile(REPOSITORIES.central, 'a', opts)).rejects.toMatchObject({
      code: 'offline'
    })
    expect(waits).toEqual([])
    expect(http.requests.length).toBe(2)
  })

  it('크기 한도(Content-Length와 실제 바이트)', async () => {
    const declared = options({
      [`${CENTRAL}a`]: { status: 200, headers: { 'content-length': '5000' }, body: 'x' }
    })
    await expect(downloadFile(REPOSITORIES.central, 'a', declared.opts)).rejects.toMatchObject({
      code: 'tooLarge'
    })
    const actual = options({ [`${CENTRAL}a`]: Buffer.alloc(2000) })
    await expect(downloadFile(REPOSITORIES.central, 'a', actual.opts)).rejects.toBeInstanceOf(
      FetchFailure
    )
  })

  it('취소하면 바로 멈춘다', async () => {
    const abort = new AbortController()
    const { opts } = options(
      {
        [`${CENTRAL}a`]: () => {
          abort.abort()
          return { status: 500 }
        }
      },
      { signal: abort.signal }
    )
    await expect(
      downloadFile(REPOSITORIES.central, 'a', { ...opts, sleep: noSleep })
    ).rejects.toBeInstanceOf(CancelledError)
  })
})

describe('진행 알림', () => {
  it('네트워크에 닿기 전에는 보내지 않고, 그 뒤로는 100 ms 간격 이하로', () => {
    const sent: { at: number; phase: string; done: number; total: number; bytes: number }[] = []
    let now = 0
    const tracker = new ProgressTracker(
      (p) => sent.push({ at: now, ...p }),
      () => now
    )
    tracker.setPhase('resolving', 0)
    tracker.begin()
    tracker.step()
    expect(sent).toEqual([])
    tracker.network()
    for (let i = 0; i < 50; i++) {
      now += 7
      tracker.addBytes(10)
    }
    tracker.setPhase('downloading', 3)
    now += 200
    tracker.step()
    expect(sent.length).toBeGreaterThan(2)
    for (let i = 1; i < sent.length; i++)
      expect(sent[i].at - sent[i - 1].at).toBeGreaterThanOrEqual(100)
    expect(sent[sent.length - 1]).toMatchObject({
      phase: 'downloading',
      done: 1,
      total: 3,
      bytes: 500
    })
  })
})
