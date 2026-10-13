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
  objectKind: {
    robot: '로봇',
    part: '파트'
  },
  scene: {
    transformMode: '조작 모드',
    translate: '이동',
    rotate: '회전',
    frame: '기준 좌표계',
    field: '필드',
    robot: '로봇'
  },
  hierarchy: {
    empty: '씬에 오브젝트가 없습니다'
  },
  inspector: {
    empty: '선택된 오브젝트가 없습니다',
    transform: '변환',
    position: '위치',
    rotation: '회전',
    frameField: '필드 기준',
    frameRobot: '로봇 기준',
    robotOrigin: '로봇 기준 좌표계의 원점이라 값이 항상 0입니다.',
    notInRobot: '로봇에 속하지 않은 오브젝트라 필드 기준으로 표시합니다.'
  }
}

export type Messages = typeof ko
export default ko
