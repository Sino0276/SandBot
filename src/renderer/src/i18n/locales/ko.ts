// 기준 로케일. 키 구조는 여기서 정의하고, 다른 로케일은 같은 구조(Messages)를 따라야 타입 검사를 통과한다.
const ko = {
  toolbar: {
    language: '언어'
  },
  panels: {
    hierarchy: '하이어라키',
    scene: '씬',
    inspector: '인스펙터'
  },
  hierarchy: {
    empty: '씬에 오브젝트가 없습니다'
  },
  inspector: {
    empty: '선택된 오브젝트가 없습니다'
  }
}

export type Messages = typeof ko
export default ko
