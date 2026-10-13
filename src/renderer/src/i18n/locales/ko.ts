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
    assembly: '어셈블리',
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
    empty: '씬에 오브젝트가 없습니다',
    emptyHint: 'STEP 파일을 창에 끌어다 놓거나 [STEP 불러오기]를 누르세요.',
    importStep: 'STEP 불러오기',
    importing: '{{fileName}} 불러오는 중…',
    dismiss: '닫기',
    expand: '펼치기',
    collapse: '접기'
  },
  importError: {
    readFailed: '{{fileName}}을(를) STEP 파일로 읽지 못했습니다.',
    empty: '{{fileName}}에 불러올 형상이 없습니다.',
    unknown: '{{fileName}}을(를) 불러오는 중 오류가 발생했습니다.'
  },
  inspector: {
    empty: '선택된 오브젝트가 없습니다',
    transform: '변환',
    position: '위치',
    rotation: '회전',
    frameField: '필드 기준',
    frameRobot: '로봇 기준',
    robotOrigin: '로봇 기준 좌표계의 원점이라 값이 항상 0입니다.',
    notInRobot: '로봇에 속하지 않은 오브젝트라 필드 기준으로 표시합니다.',
    cad: {
      title: 'CAD 정렬',
      hint: 'CAD의 위·앞 축을 로봇의 위(Z)·앞(X)에 맞추고, 바닥 면 중심을 로봇 원점에 둡니다.',
      preset: '프리셋',
      presetYUp: 'Y-up (Fusion 360 기본 · SolidWorks · Inventor)',
      presetZUp: 'Z-up (Onshape · Fusion 360 Z-up)',
      presetCustom: '직접 지정',
      upAxis: '위쪽 축',
      forwardAxis: '앞쪽 축'
    }
  }
}

export type Messages = typeof ko
export default ko
