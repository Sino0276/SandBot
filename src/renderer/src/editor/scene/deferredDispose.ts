import { useEffect } from 'react'

// 씬 뷰가 useMemo로 만든 three 자원(재질·텍스처·형상)의 해제. 개발 모드 StrictMode는 effect를 정리했다가 같은 인스턴스로
// 곧바로 다시 실행하므로, 해제는 미뤘다가 다시 붙으면 취소한다(TransformHandles와 같은 방식). 그래서 정리 → 재실행 뒤에도
// 자원이 남고, 바뀌거나 내려간 자원만 다음 작업 때 해제된다.

export type Disposable = { dispose: () => void }

const pendingDispose = new WeakMap<Disposable, ReturnType<typeof setTimeout>>()

export function useDeferredDispose(resource: Disposable): void {
  useEffect(() => {
    clearTimeout(pendingDispose.get(resource))
    pendingDispose.delete(resource)
    return () => {
      pendingDispose.set(
        resource,
        setTimeout(() => {
          pendingDispose.delete(resource)
          resource.dispose()
        }, 0)
      )
    }
  }, [resource])
}
