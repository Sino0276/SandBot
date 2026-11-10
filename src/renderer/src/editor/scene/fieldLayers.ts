// 씬 뷰 필드 표시 층(spec-4e §1.6). 필드 CAD(보기용)가 그려져 있으면 같은 자리의 단순 형상은 그리지 않고(깊이 싸움),
// CAD와 함께 그리는 단순 형상(태그·벽 라벨·넘어간 HIVE CELL)만 남긴다. 필드 요소를 숨기거나 고립 보기 중이면 CAD 층을
// 통째로 숨기고 지금 그대로의 단순 바닥·벽·테이프로 돌아간다. 윤곽선("단순 형상도 보기")은 CAD 층이 그려질 때만이다.

export type FieldLayers = {
  // 필드 CAD 묶음을 보이는가
  cad: boolean
  // 단순 형상: 'all'은 지금 그대로, 'companion'은 CAD와 함께 그리는 것만
  simple: 'all' | 'companion'
  // 단순 형상의 충돌체 윤곽선(초록)
  outlines: boolean
}

export function fieldLayers(input: {
  // visual이 있고 그 경로의 형상이 fieldVisualStore에 있다
  cadReady: boolean
  // sceneVisibility.fieldShapesShown
  shapesShown: boolean
  // fieldElementsHidden(state): fieldHidden || 고립 보기
  elementsHidden: boolean
}): FieldLayers {
  if (!input.cadReady || input.elementsHidden) return { cad: false, simple: 'all', outlines: false }
  return { cad: true, simple: 'companion', outlines: input.shapesShown }
}
