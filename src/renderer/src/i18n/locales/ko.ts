// 기준 로케일. 키 구조는 여기서 정의하고, 다른 로케일은 같은 구조(Messages)를 따라야 타입 검사를 통과한다.
const ko = {
  common: {
    dismiss: '닫기'
  },
  toolbar: {
    language: '언어',
    noProject: '저장 안 된 씬',
    open: '열기',
    openShortcut: 'FtcRobotController 폴더 열기 (Ctrl+O)',
    save: '저장',
    saveShortcut: '저장 (Ctrl+S)'
  },
  project: {
    chooseFolderTitle: 'FtcRobotController 폴더 선택',
    chooseStepTitle: 'STEP 파일 선택'
  },
  dialog: {
    unsavedChanges: '저장하지 않은 변경 사항이 있습니다. 저장할까요?',
    overwriteProject: '{{name}} 폴더에 이미 SandBot 프로젝트가 있습니다. 지금 씬으로 덮어쓸까요?',
    save: '저장',
    discard: '저장 안 함',
    overwrite: '덮어쓰기',
    cancel: '취소'
  },
  notice: {
    importing: '{{fileName}} 불러오는 중…',
    importReadFailed: '{{fileName}}을(를) STEP 파일로 읽지 못했습니다.',
    importEmpty: '{{fileName}}에 불러올 형상이 없습니다.',
    importFailed: '{{fileName}}을(를) 불러오는 중 오류가 발생했습니다.',
    openingProject: '{{name}} 여는 중…',
    openFailed: '프로젝트를 열지 못했습니다 ({{detail}}).',
    saveFailed: '저장하지 못했습니다 ({{detail}}).',
    noTeamCode: '{{name}}에 TeamCode 폴더가 없습니다. FtcRobotController 폴더가 맞는지 확인하세요.',
    cadMissing: 'CAD 파일 {{count}}개를 찾지 못했습니다. 인스펙터의 [파일 다시 찾기]로 연결하세요.',
    cadChanged:
      '{{fileName}}의 파트 수가 저장할 때와 다릅니다. CAD가 바뀌어 일부 파트가 맞지 않을 수 있습니다.'
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
    expand: '펼치기',
    collapse: '접기'
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
      forwardAxis: '앞쪽 축',
      missing: '파일을 찾을 수 없음',
      relink: '파일 다시 찾기'
    }
  }
}

export type Messages = typeof ko
export default ko
