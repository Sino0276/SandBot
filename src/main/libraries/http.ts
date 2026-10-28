import { allowedHosts, type Repository } from './repositories'

// 저장소에서 파일 하나 받기. 받는 함수는 주입한다(메인은 Electron net — 시스템 프록시를 따른다, 시험은 가짜).
// - https만, 리디렉트는 직접 따라가며(최대 3번) 그 저장소에 허용한 호스트로만, 쿠키·인증은 보내지 않는다(받는 함수의 몫).
// - 상태 코드로만 판단한다(404 본문이 HTML 페이지인 저장소가 있다). 200만 내용으로 본다.
// - 크기 한도(Content-Length와 실제로 받은 바이트 둘 다).
// - 429·5xx·네트워크 오류면 거울로 바꿔 보고, 모두 막히면 Retry-After(없으면 지수)만큼 기다렸다가 다시 한다.
// - 취소(signal)면 바로 멈춘다.

export type HttpResponse = {
  status: number
  // 머리글 하나(이름은 대소문자 무시). 없으면 null.
  header: (name: string) => string | null
  // 200일 때 본문. 다른 상태면 읽지 않는다(null이어도 된다).
  body: AsyncIterable<Uint8Array> | null
}

// 리디렉트를 따라가지 않고(3xx와 Location을 그대로 돌려준다) GET 한다
export type HttpGet = (url: string, options: { signal: AbortSignal }) => Promise<HttpResponse>

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>

export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancelledError())
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new CancelledError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}

// 받지 못한 이유. LibraryReason과 같은 이름(notFound·offline·rateLimited·tooLarge).
export type FetchFailureCode = 'notFound' | 'offline' | 'rateLimited' | 'tooLarge'

export class FetchFailure extends Error {
  constructor(
    readonly code: FetchFailureCode,
    detail: string
  ) {
    super(detail)
  }
}

const MAX_REDIRECTS = 3
const ROUNDS = 3
// Retry-After를 따르더라도 이보다 오래 기다리지 않는다(INIT을 붙잡지 않게)
const MAX_WAIT_MS = 15_000

type Attempt =
  | { kind: 'ok'; bytes: Buffer }
  | { kind: 'notFound'; detail: string }
  // network: 응답 없이 실패했다(연결 안 됨). 한 바퀴가 모두 그렇면 기다리지 않고 offline으로 끝낸다.
  | {
      kind: 'retry'
      detail: string
      code: 'offline' | 'rateLimited'
      retryAfterMs: number
      network: boolean
    }

function retryAfter(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  return 0
}

async function readBody(
  body: AsyncIterable<Uint8Array> | null,
  limit: number,
  url: string,
  onBytes: (count: number) => void
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  if (body)
    for await (const chunk of body) {
      total += chunk.byteLength
      if (total > limit) throw new FetchFailure('tooLarge', `${url} is larger than ${limit} bytes`)
      chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      onBytes(chunk.byteLength)
    }
  return Buffer.concat(chunks, total)
}

export type DownloadOptions = {
  http: HttpGet
  signal: AbortSignal
  limit: number
  sleep?: Sleep
  // 받은 바이트(진행 표시)
  onBytes?: (count: number) => void
  // 첫 요청을 보내기 직전(진행 표시를 켠다)
  onRequest?: () => void
}

async function attempt(
  url: string,
  hosts: Set<string>,
  options: DownloadOptions
): Promise<Attempt> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current)
    if (parsed.protocol !== 'https:' || parsed.port !== '' || !hosts.has(parsed.host))
      return { kind: 'notFound', detail: `${current}: not an allowed address` }
    if (parsed.username || parsed.password)
      return { kind: 'notFound', detail: `${current}: not an allowed address` }
    let response: HttpResponse
    try {
      options.onRequest?.()
      response = await options.http(current, { signal: options.signal })
    } catch (error) {
      if (options.signal.aborted) throw new CancelledError()
      const reason = error instanceof Error ? error.message : String(error)
      return {
        kind: 'retry',
        code: 'offline',
        detail: `${current}: ${reason}`,
        retryAfterMs: 0,
        network: true
      }
    }
    if (options.signal.aborted) throw new CancelledError()
    const status = response.status
    if (status >= 300 && status < 400 && status !== 304) {
      const location = response.header('location')
      if (!location)
        return { kind: 'notFound', detail: `${current}: HTTP ${status} without Location` }
      try {
        current = new URL(location, current).toString()
      } catch {
        return { kind: 'notFound', detail: `${current}: bad redirect` }
      }
      continue
    }
    if (status === 200) {
      const length = Number(response.header('content-length'))
      if (Number.isFinite(length) && length > options.limit)
        throw new FetchFailure('tooLarge', `${current} is larger than ${options.limit} bytes`)
      try {
        return {
          kind: 'ok',
          bytes: await readBody(
            response.body,
            options.limit,
            current,
            options.onBytes ?? (() => {})
          )
        }
      } catch (error) {
        if (options.signal.aborted) throw new CancelledError()
        if (error instanceof FetchFailure) throw error
        const reason = error instanceof Error ? error.message : String(error)
        return {
          kind: 'retry',
          code: 'offline',
          detail: `${current}: ${reason}`,
          retryAfterMs: 0,
          network: true
        }
      }
    }
    if (status === 429)
      return {
        kind: 'retry',
        code: 'rateLimited',
        detail: `${current}: HTTP 429`,
        retryAfterMs: retryAfter(response.header('retry-after')),
        network: false
      }
    if (status >= 500)
      return {
        kind: 'retry',
        code: 'offline',
        detail: `${current}: HTTP ${status}`,
        retryAfterMs: 0,
        network: false
      }
    return { kind: 'notFound', detail: `${current}: HTTP ${status}` }
  }
  return { kind: 'notFound', detail: `${url}: too many redirects` }
}

// 저장소 안 경로(modulePath)의 파일을 받는다. 없으면(404 등) FetchFailure notFound.
export async function downloadFile(
  repository: Repository,
  path: string,
  options: DownloadOptions
): Promise<{ bytes: Buffer; url: string }> {
  const hosts = allowedHosts(repository)
  const bases = [repository.base, ...repository.mirrors]
  const wait = options.sleep ?? sleep
  let last: Extract<Attempt, { kind: 'retry' }> | null = null
  for (let round = 0; round < ROUNDS; round++) {
    let waitMs = 0
    let unreachable = true
    for (const base of bases) {
      const url = `${base}${path}`
      const result = await attempt(url, hosts, options)
      if (result.kind === 'ok') return { bytes: result.bytes, url }
      // 처음 저장소가 없다고 하면 거울에도 없다
      if (result.kind === 'notFound') throw new FetchFailure('notFound', result.detail)
      last = result
      waitMs = Math.max(waitMs, result.retryAfterMs)
      unreachable &&= result.network
    }
    // 어느 주소도 응답하지 않았다(네트워크 없음): 기다려도 소용없다
    if (unreachable) break
    if (round < ROUNDS - 1)
      await wait(Math.min(MAX_WAIT_MS, Math.max(waitMs, 1000 * 2 ** round)), options.signal)
  }
  throw new FetchFailure(last?.code ?? 'offline', last?.detail ?? path)
}
