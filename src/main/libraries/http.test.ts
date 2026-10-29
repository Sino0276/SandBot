import { describe, expect, it } from 'vitest'
import { ProgressTracker } from './fetcher'
import {
  CancelledError,
  downloadFile,
  FetchFailure,
  NETWORK_RETRY_MS,
  type DownloadOptions,
  type Sleep
} from './http'
import { REPOSITORIES } from './repositories'
import { BROTT, CENTRAL, fakeHttp, MIRROR, type FakeHttp, type Route } from './testkit'

const noSleep: Sleep = async () => undefined

async function* chunks(parts: readonly string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield Buffer.from(part)
}

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

  it('네트워크가 없으면 짧게 한 번만 더 해 보고 offline(닿지 못함)', async () => {
    const waits: number[] = []
    const { http, opts } = options(
      {
        [`${CENTRAL}a`]: new Error('getaddrinfo ENOTFOUND'),
        [`${MIRROR}a`]: new Error('ENOTFOUND')
      },
      { waits }
    )
    await expect(downloadFile(REPOSITORIES.central, 'a', opts)).rejects.toMatchObject({
      code: 'offline',
      unreachable: true
    })
    expect(waits).toEqual([NETWORK_RETRY_MS])
    expect(http.requests.length).toBe(4)
  })

  it('연결이 한 번 끊겨도 잠깐 뒤 한 번 더 해 본다(거울이 없는 저장소)', async () => {
    const waits: number[] = []
    let calls = 0
    const { opts } = options(
      {
        [`${BROTT}a`]: () => (++calls === 1 ? new Error('net::ERR_CONNECTION_RESET') : 'ok')
      },
      { waits }
    )
    expect((await downloadFile(REPOSITORIES.brott, 'a', opts)).bytes.toString()).toBe('ok')
    expect(waits).toEqual([NETWORK_RETRY_MS])
  })

  it('서버 오류(5xx)로 끝나면 offline이지만 닿지 못한 것은 아니다', async () => {
    const { opts } = options({ [`${BROTT}a`]: { status: 503 } })
    await expect(downloadFile(REPOSITORIES.brott, 'a', opts)).rejects.toMatchObject({
      code: 'offline',
      unreachable: false
    })
  })

  it('응답 머리글이 오지 않으면 시간 제한 뒤 거울로', async () => {
    const requests: string[] = []
    const http: DownloadOptions['http'] = async (url) => {
      requests.push(url)
      if (url.startsWith(CENTRAL)) return new Promise<never>(() => undefined)
      return { status: 200, header: () => null, body: chunks(['from mirror']) }
    }
    const result = await downloadFile(REPOSITORIES.central, 'a', {
      http,
      signal: new AbortController().signal,
      limit: 1024,
      sleep: noSleep,
      timeouts: { requestMs: 20, idleMs: 20 }
    })
    expect(result.bytes.toString()).toBe('from mirror')
    expect(requests).toEqual([`${CENTRAL}a`, `${MIRROR}a`])
  })

  it('본문이 멈추면 시간 제한 뒤 한 번 더 해 보고, 그래도 멈추면 offline(닿지 못함)', async () => {
    let calls = 0
    let closed = 0
    const http: DownloadOptions['http'] = async () => {
      calls++
      return {
        status: 200,
        header: () => null,
        body: {
          [Symbol.asyncIterator]: () => {
            let sent = false
            return {
              // 한 조각을 보내고 멈춘다
              next: async (): Promise<IteratorResult<Uint8Array>> => {
                if (sent) return new Promise(() => undefined)
                sent = true
                return { done: false, value: Buffer.from('par') }
              },
              return: async () => {
                closed++
                return { done: true, value: undefined }
              }
            }
          }
        }
      }
    }
    await expect(
      downloadFile(REPOSITORIES.brott, 'a', {
        http,
        signal: new AbortController().signal,
        limit: 1024,
        sleep: noSleep,
        timeouts: { requestMs: 20, idleMs: 20 }
      })
    ).rejects.toMatchObject({ code: 'offline', unreachable: true, message: /no data/ })
    expect(calls).toBe(2)
    expect(closed).toBe(2)
  })

  it('멈춘 응답을 기다리는 중에도 취소하면 바로 멈춘다', async () => {
    const abort = new AbortController()
    const http: DownloadOptions['http'] = async () => {
      setTimeout(() => abort.abort(), 5)
      return new Promise<never>(() => undefined)
    }
    const started = Date.now()
    await expect(
      downloadFile(REPOSITORIES.brott, 'a', {
        http,
        signal: abort.signal,
        limit: 1024,
        sleep: noSleep,
        timeouts: { requestMs: 60_000, idleMs: 60_000 }
      })
    ).rejects.toBeInstanceOf(CancelledError)
    expect(Date.now() - started).toBeLessThan(5_000)
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
