import { net } from 'electron'
import type { HttpGet, HttpResponse } from './http'

// 메인 프로세스의 받기 함수: Electron net(Chromium 네트워크, 시스템 프록시·인증서를 따른다). 리디렉트는 따라가지 않고
// 3xx와 Location을 돌려준다(http.ts가 허용한 호스트로만 직접 따라간다). 쿠키는 보내지도 저장하지도 않고, 인증 정보도
// 보내지 않는다(useSessionCookies false, credentials omit).

function headerOf(headers: Record<string, string | string[]>, name: string): string | null {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers))
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? (value[0] ?? null) : value
  return null
}

export const electronHttpGet: HttpGet = (url, { signal }) =>
  new Promise<HttpResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    let settled = false
    const request = net.request({
      url,
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      useSessionCookies: false,
      cache: 'no-store'
    })
    request.setHeader('User-Agent', 'SandBot')
    const onAbort = (): void => {
      request.abort()
      if (!settled) {
        settled = true
        reject(new Error('aborted'))
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    request.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve({
        status: statusCode,
        header: (name) =>
          name.toLowerCase() === 'location' ? redirectUrl : headerOf(responseHeaders, name),
        body: null
      })
      // followRedirect를 부르지 않으면 요청이 취소된다
      request.abort()
    })
    request.on('response', (response) => {
      if (settled) return
      settled = true
      // 본문을 읽는 동안에도 취소할 수 있게 리스너는 남겨 둔다(끝나면 지운다)
      response.on('end', () => signal.removeEventListener('abort', onAbort))
      response.on('error', () => signal.removeEventListener('abort', onAbort))
      resolve({
        status: response.statusCode,
        header: (name) => headerOf(response.headers, name),
        body: response as unknown as AsyncIterable<Uint8Array>
      })
    })
    request.on('error', (error) => {
      signal.removeEventListener('abort', onAbort)
      if (settled) return
      settled = true
      reject(error)
    })
    request.end()
  })
