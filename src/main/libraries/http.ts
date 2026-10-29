import { allowedHosts, type Repository } from './repositories'

// 저장소에서 파일 하나 받기. 받는 함수는 주입한다(메인은 Electron net — 시스템 프록시를 따른다, 시험은 가짜).
// - https만, 리디렉트는 직접 따라가며(최대 3번) 그 저장소에 허용한 호스트로만, 쿠키·인증은 보내지 않는다(받는 함수의 몫).
// - 상태 코드로만 판단한다(404 본문이 HTML 페이지인 저장소가 있다). 200만 내용으로 본다.
// - 크기 한도(Content-Length와 실제로 받은 바이트 둘 다).
// - 시간 제한: 응답 머리글이 오지 않거나 본문이 멈추면(Chromium net은 이 둘에 제한이 없다) 응답 없는 실패로 본다.
// - 429·5xx·네트워크 오류면 거울로 바꿔 보고, 모두 막히면 Retry-After(없으면 지수)만큼 기다렸다가 다시 한다. 어느 주소도
//   응답하지 않았으면(네트워크 없음) 잠깐 뒤 한 번만 더 해 본다.
// - 취소(signal)면 바로 멈춘다.

export type HttpResponse = {
  status: number
  // 머리글 하나(이름은 대소문자 무시). 없으면 null.
  header: (name: string) => string | null
  // 200일 때 본문. 다른 상태면 읽지 않는다(null이어도 된다).
  body: AsyncIterable<Uint8Array> | null
}

// 리디렉트를 따라가지 않고(3xx와 Location을 그대로 돌려준다) GET 한다. signal이 취소되면 요청(본문 읽기 포함)을 끊는다.
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
    detail: string,
    // offline 중 어느 주소도 응답하지 않았다(연결 안 됨·시간 초과, 다시 해 봐도): 그 저장소에 닿지 못한다
    readonly unreachable = false
  ) {
    super(detail)
  }
}

const MAX_REDIRECTS = 3
const ROUNDS = 3
// Retry-After를 따르더라도 이보다 오래 기다리지 않는다(INIT을 붙잡지 않게)
const MAX_WAIT_MS = 15_000
// 어느 주소도 응답하지 않았을 때 한 번 더 해 보기 전에 기다리는 시간(연결이 한 번 끊긴 것일 수 있다)
export const NETWORK_RETRY_MS = 500

export type DownloadTimeouts = {
  // 요청을 보내고 응답 머리글이 올 때까지
  requestMs: number
  // 본문을 읽는 동안 아무것도 오지 않는 시간
  idleMs: number
}

// 머리글을 보내지 않는 프록시·본문이 멈춘 CDN을 이만큼 기다리면 응답 없는 실패로 보고 거울·다시 하기·offline으로
// 넘어간다(Gradle의 연결·읽기 시간 제한처럼). 느린 망에서도 머리글이나 다음 조각이 이만큼 늦는 일은 드물다.
export const DEFAULT_TIMEOUTS: DownloadTimeouts = { requestMs: 20_000, idleMs: 20_000 }

type Attempt =
  | { kind: 'ok'; bytes: Buffer }
  | { kind: 'notFound'; detail: string }
  // network: 응답 없이 실패했다(연결 안 됨·시간 초과). 한 바퀴가 모두 그렇면 잠깐 뒤 한 번만 더 해 보고 offline으로 끝낸다.
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

class TimeoutError extends Error {}

// promise를 기다리되 ms가 지나면 TimeoutError, signal이 취소되면 CancelledError로 먼저 끝낸다(받는 함수가 signal을
// 따르지 않아도 붙잡히지 않게). 늦게 온 결과는 late로 넘긴다(닫기).
function within<T>(
  promise: Promise<T>,
  ms: number,
  signal: AbortSignal,
  message: string,
  late?: (value: T) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const settle = (): boolean => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      return true
    }
    const timer = setTimeout(() => {
      if (settle()) reject(new TimeoutError(message))
    }, ms)
    const onAbort = (): void => {
      if (settle()) reject(new CancelledError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    promise.then(
      (value) => {
        if (settle()) resolve(value)
        else late?.(value)
      },
      (error: unknown) => {
        if (settle()) reject(error)
      }
    )
  })
}

async function readBody(
  body: AsyncIterable<Uint8Array> | null,
  limit: number,
  url: string,
  onBytes: (count: number) => void,
  idleMs: number,
  signal: AbortSignal
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  if (!body) return Buffer.alloc(0)
  const iterator = body[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = await within(iterator.next(), idleMs, signal, `no data for ${idleMs} ms`)
      if (next.done) break
      const chunk = next.value
      total += chunk.byteLength
      if (total > limit) throw new FetchFailure('tooLarge', `${url} is larger than ${limit} bytes`)
      chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      onBytes(chunk.byteLength)
    }
  } catch (error) {
    // 끝까지 읽지 않는 본문(한도·멈춤·오류)은 닫는다
    close(iterator)
    throw error
  }
  return Buffer.concat(chunks, total)
}

function close(iterator: AsyncIterator<Uint8Array>): void {
  try {
    void iterator.return?.()?.catch(() => undefined)
  } catch {
    // 이미 닫힘
  }
}

// 읽지 않을 본문은 닫는다(연결을 붙잡지 않게). Node Readable·async generator 모두 return()으로 끝난다.
function discard(body: AsyncIterable<Uint8Array> | null): void {
  if (!body) return
  try {
    close(body[Symbol.asyncIterator]())
  } catch {
    // 이미 닫힘
  }
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
  // 없으면 DEFAULT_TIMEOUTS(시험이 줄인다)
  timeouts?: DownloadTimeouts
}

function networkFailure(url: string, error: unknown): Attempt {
  const reason = error instanceof Error ? error.message : String(error)
  return {
    kind: 'retry',
    code: 'offline',
    detail: `${url}: ${reason}`,
    retryAfterMs: 0,
    network: true
  }
}

// 요청 하나(리디렉트 한 번). 리디렉트면 다음 주소를 돌려준다.
async function exchange(
  url: string,
  signal: AbortSignal,
  timeouts: DownloadTimeouts,
  options: DownloadOptions
): Promise<Attempt | { kind: 'redirect'; location: string }> {
  let response: HttpResponse
  try {
    options.onRequest?.()
    response = await within(
      options.http(url, { signal }),
      timeouts.requestMs,
      signal,
      `no response in ${timeouts.requestMs} ms`,
      (late) => discard(late.body)
    )
  } catch (error) {
    if (options.signal.aborted) throw new CancelledError()
    return networkFailure(url, error)
  }
  if (options.signal.aborted) throw new CancelledError()
  const status = response.status
  if (status !== 200) discard(response.body)
  if (status >= 300 && status < 400 && status !== 304) {
    const location = response.header('location')
    if (!location) return { kind: 'notFound', detail: `${url}: HTTP ${status} without Location` }
    try {
      return { kind: 'redirect', location: new URL(location, url).toString() }
    } catch {
      return { kind: 'notFound', detail: `${url}: bad redirect` }
    }
  }
  if (status === 200) {
    const length = Number(response.header('content-length'))
    if (Number.isFinite(length) && length > options.limit) {
      discard(response.body)
      throw new FetchFailure('tooLarge', `${url} is larger than ${options.limit} bytes`)
    }
    try {
      return {
        kind: 'ok',
        bytes: await readBody(
          response.body,
          options.limit,
          url,
          options.onBytes ?? (() => {}),
          timeouts.idleMs,
          signal
        )
      }
    } catch (error) {
      if (options.signal.aborted) throw new CancelledError()
      if (error instanceof FetchFailure) throw error
      return networkFailure(url, error)
    }
  }
  if (status === 429)
    return {
      kind: 'retry',
      code: 'rateLimited',
      detail: `${url}: HTTP 429`,
      retryAfterMs: retryAfter(response.header('retry-after')),
      network: false
    }
  // 서버 오류, 프록시 인증(407)·시간 초과(408)는 다시 해 본다
  if (status >= 500 || status === 407 || status === 408)
    return {
      kind: 'retry',
      code: 'offline',
      detail: `${url}: HTTP ${status}`,
      retryAfterMs: 0,
      network: false
    }
  return { kind: 'notFound', detail: `${url}: HTTP ${status}` }
}

async function attempt(
  url: string,
  hosts: Set<string>,
  options: DownloadOptions
): Promise<Attempt> {
  const timeouts = options.timeouts ?? DEFAULT_TIMEOUTS
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (options.signal.aborted) throw new CancelledError()
    const parsed = new URL(current)
    if (parsed.protocol !== 'https:' || parsed.port !== '' || !hosts.has(parsed.host))
      return { kind: 'notFound', detail: `${current}: not an allowed address` }
    if (parsed.username || parsed.password)
      return { kind: 'notFound', detail: `${current}: not an allowed address` }
    // 요청마다 따로 끊는다(시간 제한). 취소는 이어 준다.
    const request = new AbortController()
    const cancel = (): void => request.abort()
    options.signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await exchange(current, request.signal, timeouts, options)
      if (result.kind !== 'redirect') return result
      current = result.location
    } finally {
      options.signal.removeEventListener('abort', cancel)
      // 끝난 요청은 닫는다(시간이 넘은 요청·읽지 않은 본문의 연결을 붙잡지 않게)
      request.abort()
    }
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
  // 이번 바퀴에 어느 주소도 응답하지 않았다(거울의 404도 응답이다)
  let unreachable = false
  let retriedNetwork = false
  for (let round = 0; round < ROUNDS; round++) {
    let waitMs = 0
    // 다시 해 볼 실패가 모두 응답 없는 실패다
    let network = true
    unreachable = true
    for (const base of bases) {
      const url = `${base}${path}`
      const result = await attempt(url, hosts, options)
      if (result.kind === 'ok') return { bytes: result.bytes, url }
      if (result.kind === 'notFound') {
        // 처음 저장소가 없다고 하면 거울에도 없다. 거울이 없다고 하면(아직 따라오지 않음) 처음 저장소의 실패를 따른다.
        if (base === repository.base) throw new FetchFailure('notFound', result.detail)
        unreachable = false
        continue
      }
      last = result
      waitMs = Math.max(waitMs, result.retryAfterMs)
      network &&= result.network
      unreachable &&= result.network
    }
    if (round === ROUNDS - 1) break
    if (network) {
      // 응답 없이 실패했다: 연결이 한 번 끊긴 것일 수 있어 잠깐 뒤 한 번만 더 해 본다(네트워크가 없으면 더 기다려도
      // 소용없다)
      if (retriedNetwork) break
      retriedNetwork = true
      await wait(NETWORK_RETRY_MS, options.signal)
    } else await wait(Math.min(MAX_WAIT_MS, Math.max(waitMs, 1000 * 2 ** round)), options.signal)
  }
  throw new FetchFailure(last?.code ?? 'offline', last?.detail ?? path, unreachable)
}
