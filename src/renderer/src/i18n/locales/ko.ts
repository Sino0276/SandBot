// 기준 로케일. 키 구조는 여기서 정의하고, 다른 로케일은 같은 구조(Messages)를 따라야 타입 검사를 통과한다.
const ko = {
  common: {
    dismiss: '닫기',
    cancel: '취소'
  },
  toolbar: {
    language: '언어',
    lengthUnit: '길이 단위',
    noProject: '저장 안 된 씬',
    open: '열기',
    openShortcut: 'FtcRobotController 폴더 열기 (Ctrl+O)',
    save: '저장',
    saveShortcut: '저장 (Ctrl+S)',
    undo: '실행 취소',
    undoShortcut: '실행 취소 (Ctrl+Z)',
    redo: '다시 실행',
    redoShortcut: '다시 실행 (Ctrl+Shift+Z 또는 Ctrl+Y)',
    // 환경 설정 창(Unity의 Edit > Preferences)
    preferences: '환경 설정',
    preferencesTooltip: '환경 설정 (외부 스크립트 편집기, JDK, 시뮬레이션)'
  },
  project: {
    chooseFolderTitle: 'FtcRobotController 폴더 선택',
    chooseStepTitle: 'STEP 파일 선택'
  },
  dialog: {
    unsavedChanges: '저장하지 않은 변경 사항이 있습니다. 저장할까요?',
    chooseLengthUnit: '길이를 어떤 단위로 볼까요? 툴바에서 언제든 바꿀 수 있습니다.',
    overwriteProject: '{{name}} 폴더에 이미 SandBot 프로젝트가 있습니다. 지금 씬으로 덮어쓸까요?',
    save: '저장',
    discard: '저장 안 함',
    overwrite: '덮어쓰기',
    cancel: '취소',
    importLarge:
      '{{fileName}}은(는) {{size}}입니다. 처음 불러올 때는 몇 분 걸릴 수 있습니다. 불러올까요?',
    importLargeMany:
      '큰 STEP 파일 {{count}}개(모두 {{size}})를 불러옵니다. 처음 불러올 때는 몇 분 걸릴 수 있습니다. 불러올까요?',
    importLargeWasm:
      '{{fileName}}은(는) {{size}}입니다. 이 PC에는 빠른 변환기가 없어 내장 변환기로 읽는데, 내장 변환기는 이렇게 큰 파일을 읽지 못하거나 아주 오래 걸릴 수 있습니다. 그래도 불러올까요?',
    importLargeManyWasm:
      '큰 STEP 파일 {{count}}개(모두 {{size}})를 불러옵니다. 이 PC에는 빠른 변환기가 없어 내장 변환기로 읽는데, 내장 변환기는 이렇게 큰 파일을 읽지 못하거나 아주 오래 걸릴 수 있습니다. 그래도 불러올까요?',
    import: '불러오기',
    closeWhileImporting:
      'STEP 파일을 불러오는 중입니다. 지금 닫으면 불러오기가 취소됩니다. 닫을까요?',
    close: '닫기',
    // 하이어라키 삭제(editor/sceneCommands.ts). {{undo}}는 실행 취소 단축키
    deleteWithCadParts:
      '지우는 CAD에서 다른 그룹으로 옮긴 오브젝트 {{count}}개와 거기 붙은 하드웨어 컴포넌트 {{components}}개도 함께 삭제됩니다. {{undo}}로 되돌릴 수 있습니다. 삭제할까요?',
    deleteWithCadPartsNoHardware:
      '지우는 CAD에서 다른 그룹으로 옮긴 오브젝트 {{count}}개도 함께 삭제됩니다. {{undo}}로 되돌릴 수 있습니다. 삭제할까요?',
    delete: '삭제'
  },
  notice: {
    // 잘라낸 오브젝트를 붙일 수 없는 이유(하이어라키 이동 규칙)
    pasteRejectedRobot:
      '로봇은 다른 오브젝트 아래에 붙일 수 없습니다. 로봇끼리 순서만 바꿀 수 있습니다.',
    pasteRejectedCadRoot:
      'CAD 루트는 지금 로봇 안에서 순서만 바꿀 수 있습니다(CAD 루트의 위치가 곧 CAD 정렬입니다).',
    pasteRejectedOtherRobot: '다른 로봇으로는 옮길 수 없습니다. 같은 로봇 안에 붙이세요.',
    pasteRejectedDescendant: '자기 자신이나 하위 오브젝트 아래에는 붙일 수 없습니다.',
    pasteRejectedMissing: '붙일 자리나 잘라낸 오브젝트가 없습니다.',
    importing: '{{fileName}} 불러오는 중…',
    importReadFailed: '{{fileName}}을(를) STEP 파일로 읽지 못했습니다.',
    importEmpty: '{{fileName}}에 불러올 형상이 없습니다.',
    importFailed: '{{fileName}}을(를) 불러오는 중 오류가 발생했습니다.',
    importMeshFailed:
      '{{fileName}}의 형상(삼각형)을 만들지 못했습니다. CAD에서 다시 내보내 보세요.',
    importOutOfMemory:
      '{{fileName}}을(를) 불러오다 메모리가 부족했습니다. 다른 프로그램을 닫고 다시 해 보세요. 그래도 안 되면 CAD에서 나사 같은 작은 부품을 빼고 다시 내보내 보세요.',
    importTooLarge:
      '{{fileName}}은(는) 내장 변환기로 읽기에 너무 큽니다. CAD(Onshape, Fusion 360 등)에서 나사 같은 작은 부품이나 필요 없는 부분을 빼고 다시 내보내 보세요.',
    importPartial: '{{fileName}}의 파트 {{count}}개는 형상을 만들지 못해 보이지 않습니다.',
    importIncomplete:
      '{{fileName}}의 일부 형상을 변환하지 못해 빠졌을 수 있습니다(메모리가 부족했을 수 있음). 다른 프로그램을 닫고 다시 불러오거나, CAD에서 다시 내보내 보세요.',
    cadLoadIncomplete:
      '{{fileName}}의 일부 형상을 변환하지 못해 불러오지 않았습니다(메모리가 부족했을 수 있음). 다른 프로그램을 닫고 인스펙터의 [다시 불러오기]를 눌러 보세요.',
    cadLoadCancelled:
      '{{fileName}} 불러오기를 취소했습니다. 인스펙터의 [다시 불러오기]로 다시 불러올 수 있습니다.',
    openingProject: '{{name}} 여는 중…',
    openFailed: '프로젝트를 열지 못했습니다 ({{detail}}).',
    saveFailed: '저장하지 못했습니다 ({{detail}}).',
    noTeamCode: '{{name}}에 TeamCode 폴더가 없습니다. FtcRobotController 폴더가 맞는지 확인하세요.',
    cadMissing: 'CAD 파일 {{count}}개를 찾지 못했습니다. 인스펙터의 [파일 다시 찾기]로 연결하세요.',
    cadChanged:
      '{{fileName}}의 파트 수가 저장할 때와 다릅니다. CAD가 바뀌어 일부 파트가 맞지 않을 수 있습니다.',
    codegenBlocked:
      '하드웨어 설정에 오류가 {{count}}개 있어 TeamCode 코드를 만들지 않았습니다. 인스펙터에서 확인하세요.',
    codegenNoTeamCode: 'TeamCode 폴더가 없어 하드웨어 코드를 만들지 못했습니다.',
    codegenSkipped:
      '직접 만든 파일과 이름이 겹쳐 덮어쓰지 않았습니다: {{files}}. 로봇 하드웨어의 클래스 이름을 바꾸세요.',
    codegenModified:
      '고친 생성 파일이라 덮어쓰지 않았습니다: {{files}}. SandBot이 다시 만들게 하려면 그 파일을 지우세요.',
    codegenCaseRenamed:
      '생성 파일 이름의 대소문자가 바뀌었습니다({{files}}). Windows·macOS의 git은 이 변경을 기록하지 않으니 커밋할 때 git mv -f로 이름을 바꾸세요.',
    codegenFailed: 'TeamCode에 생성 코드를 쓰지 못했습니다 ({{detail}}).',
    // 스크립트 연결·외부 편집기(2단계)
    scriptOpenFailed:
      '{{fileName}}을(를) 열지 못했습니다 ({{detail}}). .java 파일에 연결된 앱이 없을 수 있습니다. 툴바의 [환경 설정] > 외부 도구에서 외부 스크립트 편집기를 고르세요.',
    scriptLaunchFailed:
      '외부 스크립트 편집기로 {{fileName}}을(를) 열지 못했습니다 ({{detail}}). 툴바의 [환경 설정] > 외부 도구에서 편집기를 확인하세요.',
    scriptMissing: '{{fileName}}이(가) TeamCode에 없습니다. 인스펙터에서 연결을 확인하세요.',
    scriptNotAllowed:
      '{{fileName}}은(는) 열 수 없는 경로입니다. TeamCode/src/main/java 안의 Java 파일만 엽니다.',
    // 줄로 열기(사용처·튜닝 값)를 편집기가 받지 못함. 앱을 켠 동안 한 번만 띄운다.
    lineIgnored:
      '외부 스크립트 편집기가 줄 번호를 받지 않아 파일만 열었습니다. 환경 설정에서 Android Studio 등을 고르면 그 줄로 엽니다.',
    // 사용처(4단계): 저장해 생성 코드를 맞춘 뒤 깨지는 TeamCode. 저장할 때마다 하나로 바꾼다. {{files}}는 파일 이름 3개까지.
    usagesBroken:
      'TeamCode {{count}}곳({{files}})이 저장한 생성 코드에 없는 이름을 씁니다. 인스펙터의 사용처에서 열 수 있습니다.',
    usagesBrokenByName:
      '구성 이름이 바뀌어 TeamCode 문자열 {{count}}곳({{files}})이 실행할 때 장치를 찾지 못합니다.',
    scriptLinksDropped:
      'project.json의 스크립트 연결 {{count}}개는 허용하지 않는 경로이거나 같은 오브젝트에 겹친 경로라 버렸습니다. 저장하면 파일에서도 빠집니다.',
    externalEditorFailed: '외부 스크립트 편집기 설정을 바꾸지 못했습니다 ({{detail}}).',
    externalEditorUnsupportedFile:
      '고른 파일은 외부 스크립트 편집기로 실행할 수 없습니다. 편집기의 실행 파일(Windows는 .exe)을 고르세요. .bat·.cmd·.lnk·.ps1은 쓸 수 없습니다.',
    externalEditorInvalidArgs:
      '인자를 바꾸지 않았습니다. $(File)을 넣고, 큰따옴표를 닫고, 줄바꿈 없이 너무 길지 않게 쓰세요.',
    // 튜닝 값 저장(3단계). 값은 Java 리터럴 글자다.
    tunableConflict:
      '{{file}}의 {{field}} 값이 SandBot 밖에서 바뀌어(파일 값 {{fileValue}}) SandBot 값 {{value}}을(를) 저장하지 않고 파일 값을 따랐습니다.',
    tunableMissing:
      '{{file}}에서 튜닝 값을 쓸 파일이나 필드를 찾지 못해(지워졌거나 이름이 바뀜) 저장하지 않았습니다: {{fields}}',
    tunableWriteFailed:
      '{{file}}에 튜닝 값을 쓰지 못했습니다 ({{detail}}). 값은 저장하지 않은 채로 남아 있으니 다시 저장해 보세요.',
    tunableFileBusy:
      '{{file}}이(가) 저장하는 동안 계속 바뀌어 튜닝 값을 쓰지 못했습니다. 값은 저장하지 않은 채로 남아 있으니 잠시 뒤 다시 저장하세요.',
    // 파일 상태 때문에 쓰지 못함(파일을 바꿔야 다시 저장할 수 있다)
    tunableFileReadOnly:
      '{{file}}이(가) 읽기 전용이라(이 사용자가 파일이나 그 폴더에 쓸 수 없음) 튜닝 값을 쓰지 못했습니다. 파일과 폴더를 쓰기 가능하게 바꾼 뒤 다시 저장하세요. 값은 저장하지 않은 채로 남아 있습니다.',
    tunableFileTooLarge:
      '{{file}}이(가) 1 MB를 넘어 튜닝 값을 쓰지 못했습니다. 파일을 1 MB 아래로 줄인 뒤 다시 저장하세요. 값은 저장하지 않은 채로 남아 있습니다.',
    tunableFileEncoding:
      '{{file}}은(는) UTF-8로 그대로 되돌릴 수 없어(다른 인코딩) 튜닝 값을 쓰지 못했습니다. 편집기에서 파일 인코딩을 UTF-8로 바꾼 뒤 다시 저장하세요. 값은 저장하지 않은 채로 남아 있습니다.',
    tunableFileGenerated:
      '{{file}}에 SandBot 생성 표식(@sandbot-generated)이 있어 튜닝 값을 쓰지 않았습니다. 팀이 직접 관리하는 파일이면 표식을 지운 뒤 다시 저장하세요. 값은 저장하지 않은 채로 남아 있습니다.',
    tunableFileUnicodeEscape:
      '{{file}}의 리터럴 밖(주석 등)에 \\u 이스케이프가 있어(javac가 먼저 바꾸므로 위치를 믿을 수 없음) 튜닝 값을 쓰지 못했습니다. 그 \\u를 지운 뒤 다시 저장하세요. 값은 저장하지 않은 채로 남아 있습니다.',
    tunableFileNotAllowed:
      '{{file}}이(가) 이제 TeamCode/src/main/java 안의 보통 파일이 아니라(밖을 가리키는 링크 등) 튜닝 값을 쓰지 않고 버렸습니다: {{fields}}',
    // 실행(사이드카 1단계): playInit이 받지 않은 이유. {{detail}}은 메인 프로세스의 영어 문장이다.
    playNotAllowed:
      '이 프로젝트에서는 실행할 수 없습니다 ({{detail}}). 프로젝트를 다시 열어 보세요.',
    playMissing:
      'OpMode 파일이나 TeamCode 폴더를 찾지 못해 실행하지 않았습니다 ({{detail}}). OpMode 목록을 다시 읽었습니다.',
    playNoJdk:
      '실행할 JDK가 없습니다. 환경 설정에서 고른 JDK 폴더를 쓸 수 없거나, 이 PC에서 JDK 17 이상을 찾지 못했습니다(Android Studio를 설치했다면 자동으로 찾습니다).',
    playNoSidecar:
      '실행기(사이드카)가 빌드되지 않았습니다. 개발 중이면 pnpm build:sidecar를 실행한 뒤 다시 INIT하세요.',
    playBusy: '이전 실행이 아직 끝나지 않았습니다. 잠시 뒤 다시 INIT하세요.',
    playFailed: 'JVM을 시작하지 못했습니다 ({{detail}}).',
    playInitFailed: '실행을 시작하지 못했습니다 ({{detail}}).'
  },
  // 알림의 행동 버튼
  noticeAction: {
    openJdkPreferences: 'JDK 설정 열기'
  },
  // 진행 알림에 덧붙이는 STEP 불러오기 단계
  importPhase: {
    checking: '파일 확인 중',
    queued: '다른 파일이 끝나기를 기다리는 중',
    read: '파일 읽는 중',
    transfer: '형상 변환 중',
    mesh: '삼각형 만드는 중',
    write: '결과 정리 중',
    build: '화면에 올리는 중',
    wasm: '내장 변환기로 읽는 중'
  },
  units: {
    // 툴바·입력칸 옆에 쓰는 기호
    symbols: {
      mm: 'mm',
      cm: 'cm',
      m: 'm',
      in: 'in'
    },
    names: {
      mm: 'mm (밀리미터)',
      cm: 'cm (센티미터)',
      m: 'm (미터)',
      in: 'in (인치)'
    },
    lengthInputHint:
      '단위를 붙여 입력할 수 있습니다 (예: 12in, 30cm, 150mm). 없으면 {{unit}}로 읽습니다.',
    angleInputHint: '도(°) 단위입니다. rad를 붙여 라디안으로 입력할 수도 있습니다.'
  },
  panels: {
    hierarchy: '하이어라키',
    scene: '씬',
    inspector: '인스펙터',
    // 씬 뷰 아래 패널(Unity의 Console 자리)의 탭
    dock: '콘솔·텔레메트리·장치',
    console: '콘솔',
    telemetry: '텔레메트리',
    devices: '장치'
  },
  objectKind: {
    robot: '로봇',
    assembly: '어셈블리',
    part: '파트',
    group: '그룹'
  },
  scene: {
    tool: '도구',
    tools: {
      view: '손 도구: 왼쪽 드래그로 화면 이동 (Q)',
      translate: '이동 (W)',
      rotate: '회전 (E)'
    },
    flySpeed: '비행 속도 {{speed}} {{unit}}/s · 휠로 조절, Shift로 빠르게',
    handleSpace: '핸들 축: 전역(필드 축) · 로컬(오브젝트 자신의 축) (X)',
    global: '전역',
    local: '로컬',
    // 고립 보기(Shift+H)
    isolation: '고립 보기: 선택한 오브젝트만 보입니다',
    exitIsolation: '나가기 ({{shortcut}})',
    // 실행 중 키보드 게임패드(씬 뷰에 포커스가 있을 때만)
    keyboardPad: {
      active: '키보드 → 게임패드 {{slot}}',
      inactive: '씬 뷰를 누르면 키보드 → 게임패드 {{slot}}',
      helpTitle: '키보드 게임패드 배치',
      layout: {
        leftStick: { keys: 'W A S D', field: '왼쪽 스틱' },
        rightStick: { keys: '↑ ← ↓ →', field: '오른쪽 스틱' },
        buttons: { keys: 'I J K L', field: 'Y X A B (패드 모양)' },
        bumpers: { keys: 'U O', field: '왼쪽·오른쪽 범퍼' },
        triggers: { keys: 'Q E', field: '왼쪽·오른쪽 트리거' },
        dpad: { keys: 'T F G H', field: '방향 패드 위·왼쪽·아래·오른쪽' },
        startBack: { keys: 'Enter · Backspace', field: 'start · back' }
      },
      hint: '씬 뷰에 포커스가 있는 동안 편집 단축키(F·Q/W/E·H·Delete 등)는 쓰지 않습니다. Ctrl 조합(저장·실행 취소·Ctrl+P)은 그대로입니다. 다른 곳을 누르면 모든 키를 뗍니다.'
    }
  },
  hierarchy: {
    empty: '씬에 오브젝트가 없습니다',
    emptyHint: 'STEP 파일을 창에 끌어다 놓거나 [STEP 불러오기]를 누르세요.',
    importStep: 'STEP 불러오기',
    expand: '펼치기',
    collapse: '접기',
    // 헤더 [+] 버튼(Unity의 Create Empty)
    create: '빈 그룹 만들기',
    createTooltip: '빈 그룹 만들기 ({{shortcut}})',
    renameLabel: '오브젝트 이름',
    // 검색(Unity 하이어라키 검색칸). 이름과 장치 이름(구성 이름)으로 찾는다.
    search: '하이어라키 검색',
    searchPlaceholder: '검색 ({{shortcut}})',
    searchClear: '검색 지우기',
    searchNoResults: '"{{query}}"에 맞는 오브젝트가 없습니다',
    // 눈 아이콘(씬 뷰에서만 숨김)
    hide: '씬 뷰에서 숨기기',
    show: '씬 뷰에 보이기',
    visibilityTitle: '{{action}} (H, Alt+클릭은 이 오브젝트만)',
    cutTitle: '잘라냄: 붙일 행을 고르고 {{paste}}(다음 형제) 또는 {{child}}(자식)',
    menu: {
      label: '하이어라키 메뉴',
      cut: '잘라내기',
      paste: '붙여넣기',
      pasteAsChild: '자식으로 붙여넣기',
      selectChildren: '하위 모두 선택',
      rename: '이름 바꾸기',
      delete: '삭제',
      createEmpty: '빈 그룹 만들기',
      createEmptyParent: '빈 부모 그룹 만들기'
    }
  },
  inspector: {
    empty: '선택된 오브젝트가 없습니다',
    transform: '변환',
    position: '위치',
    rotation: '회전',
    frameField: '필드 기준',
    frameFieldHint: '필드 좌표계 값입니다. 원점은 필드 중앙 바닥이고 Z가 위입니다.',
    frameParent: '부모 기준',
    frameParentHint:
      '부모 오브젝트 ‘{{name}}’의 위치와 축을 기준으로 한 값입니다. 부모가 움직이면 함께 움직입니다.',
    // 실행 중인 로봇(과 그 하위)의 변환은 고칠 수 없다
    running: '실행 중',
    runningHint:
      '실행 중에는 이 로봇과 하위 오브젝트의 위치·회전을 고칠 수 없습니다. 씬 뷰는 시뮬레이터 자세로 그리고, 끝나면 편집 위치로 돌아갑니다(값은 바뀌지 않습니다).',
    cadAxes: 'CAD 파일의 축 방향으로 표시합니다 (위 {{up}} · 앞 {{forward}}).',
    robotCenter: '로봇 중심 기준',
    robotCenterHint:
      '로봇 원점(중심 바닥)에서 본 위치입니다. X 앞 · Y 왼쪽 · Z 위. 계산한 값이라 고칠 수 없습니다.',
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
      loading: '불러오는 중',
      failed: '형상을 불러오지 못함',
      cancelled: '불러오기 취소됨',
      relink: '파일 다시 찾기',
      reload: '다시 불러오기'
    },
    // 메커니즘 그룹(1단계): 이름 칸, 다중 선택, 그룹 코드, CAD 밖으로 옮긴 파트
    name: '이름',
    multiple: '{{count}}개 선택됨',
    multipleHint:
      '여러 오브젝트를 함께 편집하는 기능은 아직 없습니다. 목록에서 하나를 누르면 그것만 선택합니다. Ctrl+클릭은 선택에서 뺍니다.',
    multipleMore: '외 {{count}}개',
    group: {
      title: '메커니즘 그룹',
      className: 'Java 클래스 이름',
      classNameHint:
        '생성 하드웨어 클래스 안의 중첩 클래스 이름입니다. 비워 두면 그룹 이름에서 만듭니다(흐린 글자). 영문 대문자로 시작하고 영문·숫자만 씁니다.',
      access: '접근 경로',
      accessHint: 'OpMode에서 이 그룹을 쓰는 식입니다. robot은 하드웨어 클래스 변수입니다.',
      constants: '형식 이름',
      constantsHint:
        '이 그룹 장치의 상수(오프셋 등)는 이 형식 이름으로 씁니다. robot.…처럼 변수로 쓰면 Android Studio가 경고합니다.',
      noHardware: '하드웨어가 없는 그룹은 클래스를 만들지 않습니다.'
    },
    cadOrigin: {
      title: 'CAD 원본',
      hint: 'CAD ‘{{name}}’ 밖으로 옮겼습니다. 그 CAD의 정렬을 바꾸면 함께 움직이고, CAD를 지우면 함께 지워집니다.',
      select: 'CAD 루트 선택'
    },
    // 컴포넌트 목록(하드웨어 컴포넌트와 스크립트 연결 카드, Unity의 컴포넌트 목록)
    components: '컴포넌트',
    componentsEmpty: '붙은 컴포넌트가 없습니다.',
    // 튜닝 값(3단계): 스크립트 카드 안의 FTC Dashboard @Config 필드
    tunables: {
      loading: '튜닝 값을 읽는 중…',
      readFailed: '파일을 읽지 못해 튜닝 값을 보이지 못합니다.',
      configTag: '@Config',
      blockLabel: '튜닝 값 {{name}}',
      blockHint: 'FTC Dashboard에 ‘{{name}}’ 묶음으로 보이는 클래스 {{classPath}}입니다.',
      fieldHint:
        '{{declaration}} · {{line}}번째 줄. 더블클릭하면 이 줄을 외부 스크립트 편집기로 엽니다.',
      pending: '저장하지 않은 값입니다. 저장(Ctrl+S)할 때 Java 파일에 씁니다.',
      fileChanged: '파일 값: {{value}}',
      fileChangedHint:
        'SandBot 밖(Android Studio 등)에서 파일의 이 값이 바뀌었습니다. 이대로 저장하면 SandBot 값은 쓰지 않고 파일 값을 따릅니다. [SandBot 값 쓰기]를 누르거나 값을 새로 입력하면 저장할 때 파일 값 대신 그 값을 씁니다.',
      keepValue: 'SandBot 값 쓰기',
      keepValueHint: '저장할 때 바뀐 파일 값 대신 SandBot 값을 씁니다(실행 취소할 수 있음).',
      useFileValue: '파일 값 따르기',
      useFileValueHint: '저장하지 않은 SandBot 값을 버리고 파일 값을 씁니다(실행 취소할 수 있음).',
      // 저장하지 않은 값이 있지만 지금은 고칠 수 없는 칸(파일 자체를 쓸 수 없음 / 필드가 바뀜 / 필드를 찾지 못함)
      pendingFileLocked:
        '저장하지 않은 값입니다. 지금은 이 파일을 고칠 수 없어 저장해도 쓰지 못하고 저장하지 않은 채로 남습니다. 파일을 고칠 수 있게 바꾼 뒤 저장하면 씁니다.',
      pendingFieldLocked:
        '저장하지 않은 값입니다. SandBot 밖에서 이 필드가 고칠 수 없게 바뀌어, 저장하면 이 값을 쓰지 않고 파일 값을 따릅니다.',
      pendingFieldMissing:
        '저장하지 않은 값입니다. 파일에서 이 필드를 찾지 못해(지워졌거나 이름이 바뀜) 저장하면 이 값을 쓰지 않고 알립니다.',
      noConfig: 'FTC Dashboard의 @Config를 붙이면 public static 필드를 여기서 고칠 수 있습니다.',
      sharedHint:
        'static 값이라 이 파일을 연결한 모든 오브젝트가 같은 값을 봅니다. 저장(Ctrl+S)할 때 Java 파일에 씁니다.',
      dashboardHint:
        '로봇에서 FTC Dashboard로 바꾼 값은 로봇 메모리에만 있어 여기에 보이지 않습니다.',
      // 고칠 수 없는 칸의 이유
      readOnly: {
        expression: '식이라 고칠 수 없음',
        noInitializer: '초기값이 없어 고칠 수 없음',
        textBlock: '텍스트 블록이나 \\u가 든 문자열이라 고칠 수 없음',
        lineBreak: '줄바꿈이 든 문자열이라 고칠 수 없음',
        initializedInType: '생성자·초기화 블록이 값을 정할 수 있어 고칠 수 없음',
        unicodeEscape: '파일에 \\u 이스케이프가 있어 고칠 수 없음',
        null: 'null이라 고칠 수 없음',
        enum: 'enum 값은 아직 고칠 수 없음',
        object: '같은 파일의 new 형식()이 아니라 펼칠 수 없음',
        unsupportedType: '고칠 수 없는 형식',
        file: '파일을 고칠 수 없음'
      },
      // 파일 전체를 보기만 하는 이유
      fileReadOnly: {
        encoding: '이 파일은 UTF-8로 그대로 되돌릴 수 없어(다른 인코딩) 튜닝 값을 보기만 합니다.',
        generated: 'SandBot이 만든 파일이라 튜닝 값을 고치지 않습니다.',
        readOnly:
          '읽기 전용 파일이라(이 사용자가 파일이나 그 폴더에 쓸 수 없음) 튜닝 값을 보기만 합니다. 파일과 폴더를 쓰기 가능하게 바꾸면 고칠 수 있습니다.',
        tooLarge: '파일이 1 MB를 넘어 튜닝 값을 읽지 않습니다.',
        unicodeEscape:
          '파일에 \\u 이스케이프가 있어(javac가 먼저 바꾸므로 위치를 믿을 수 없음) 튜닝 값을 보기만 합니다.'
      }
    }
  },
  // 스크립트 연결(Unity의 스크립트 컴포넌트처럼 보이는 탐색용 연결, 2단계)
  scripts: {
    tag: '스크립트',
    field: '스크립트',
    fieldHint:
      '더블클릭하면 외부 스크립트 편집기로 엽니다. 편집기는 툴바의 [환경 설정]에서 고릅니다.',
    open: '열기',
    openLabel: '{{name}} 열기',
    remove: '제거',
    removeLabel: '{{name}} 연결 제거',
    navigationHint:
      '탐색용 연결입니다. 생성 하드웨어 코드는 이 파일을 참조하지 않고, 파일의 코드는 그대로 실행됩니다.',
    missing: '파일을 찾을 수 없음',
    checking: '확인 중…',
    relink: '다시 연결:',
    relinkHint:
      'TeamCode에서 같은 클래스(또는 같은 이름)의 파일을 이 위치에서 하나 찾았습니다. 누르면 연결을 이 파일로 바꿉니다(실행 취소할 수 있음).',
    notFound:
      'TeamCode에서 같은 클래스나 같은 이름의 파일을 하나로 찾지 못했습니다. 연결을 지우고 [컴포넌트 추가]에서 다시 연결하세요.',
    unknown: 'TeamCode 파일 목록을 다 읽지 못해 이 파일이 있는지 확인하지 못했습니다.',
    noProject: '프로젝트를 열거나 저장하면 TeamCode에서 이 파일을 찾아 열 수 있습니다.',
    noTeamCode: '프로젝트에 TeamCode 폴더가 없어 이 파일을 열 수 없습니다.',
    // 사용처(4단계)의 거꾸로 보기: 이 파일에서 사용처를 찾은 장치·그룹·로봇. 누르면 그 오브젝트를 고른다.
    usesHardware: '이 스크립트가 쓰는 하드웨어',
    usesHardwareHint:
      '사용처에서 이 파일이 쓰는 장치·그룹·로봇입니다(생성 코드와 구성 이름으로 찾는 문자열). 누르면 그 오브젝트를 고릅니다.',
    // Add Component 선택 상자의 항목
    addGroup: '스크립트',
    addOption: 'TeamCode 스크립트…',
    badge: '{ }',
    badgeTitle: '연결한 스크립트: {{names}}',
    picker: {
      label: 'TeamCode 스크립트 선택',
      placeholder: '클래스 이름으로 검색',
      loading: 'TeamCode 파일 목록을 읽는 중…',
      empty: '연결할 수 있는 Java 파일이 없습니다.',
      allLinked: 'TeamCode의 Java 파일을 모두 연결했습니다.',
      noMatch: '‘{{query}}’와 맞는 파일이 없습니다.',
      noProject: '프로젝트를 열거나 저장하면 TeamCode 스크립트를 고를 수 있습니다.',
      noTeamCode: '프로젝트에 TeamCode 폴더가 없습니다.',
      failed: 'TeamCode 파일 목록을 읽지 못했습니다.',
      truncated: '파일이 너무 많아 일부만 보입니다.',
      more: '외 {{count}}개 · 검색어로 좁히세요',
      defaultPackage: '(기본 패키지)'
    }
  },
  // 사용처(4단계, Android Studio의 Find Usages): 장치·그룹·로봇 카드의 접힌 "사용처"
  usages: {
    title: '사용처',
    // 머리줄 개수
    code: '코드 {{count}}',
    byName: '이름 {{count}}',
    warnings: '문제 {{count}}곳',
    none: '찾은 사용처 없음',
    searched: '찾은 것: {{terms}}',
    scanning: '찾는 중…',
    partialBadge: '(일부)',
    failed: '사용처를 찾지 못했습니다: {{detail}}',
    failedNoDetail: '사용처를 찾지 못했습니다.',
    noProject: '프로젝트를 열거나 저장하면 TeamCode에서 사용처를 찾습니다.',
    noTeamCode: '프로젝트에 TeamCode 폴더가 없어 사용처를 찾지 못합니다.',
    truncated: 'TeamCode 파일이 너무 많아 앞의 {{count}}개에서만 찾았습니다.',
    partial: '파일 {{count}}개는 찾지 않았습니다(너무 큰 파일, \\u 이스케이프, 읽기 실패).',
    kotlin: 'Kotlin(.kt) 파일은 찾지 않습니다.',
    unavailable:
      '로봇 클래스 이름 문제를 고치면 코드 사용처를 찾습니다. 이름으로 찾기는 그대로 합니다.',
    // 부분 제목
    sectionCode: '코드',
    sectionByName: '이름으로',
    byNameHint: '구성 이름으로 장치를 찾는 문자열입니다(hardwareMap.get, …Name(…) 등).',
    sharedName: '다른 로봇에도 같은 구성 이름의 장치가 있어 그 로봇의 사용처일 수도 있습니다.',
    samePortName:
      '같은 포트의 모터와 데드휠이 이 구성 이름을 함께 써서 다른 쪽 장치의 사용처일 수도 있습니다.',
    sameText: '같은 글자의 다른 문자열 {{count}}',
    sameTextHint:
      '장치를 찾는 데 쓰지 않는 문자열(텔레메트리 문구 등)입니다. 개수에 넣지 않습니다.',
    descendants: '하위 장치 {{count}}곳',
    constructs: '만드는 곳',
    // 행 배지와 읽어 주는 이름의 종류(lookup·text는 부분 제목이 이미 알려 배지로는 보이지 않는다)
    kinds: {
      field: '필드',
      constant: '상수',
      type: '형식',
      new: '생성',
      lookup: '이름',
      text: '문자열',
      unresolved: '없는 이름'
    },
    listLabel: '{{name}} 사용처',
    fileLabel: '{{file}}, {{count}}곳',
    // 결과 한도로 파일의 뒤가 잘렸을 수 있을 때(키마다 200곳까지만 받는다)
    fileLabelAtLeast: '{{file}}, {{count}}곳 이상',
    fileCountAtLeast: '{{count}}+',
    rowLabel: '{{file}} {{line}}번째 줄, {{kind}}: {{code}}',
    openHint: '더블클릭하거나 Enter를 누르면 외부 스크립트 편집기로 이 줄을 엽니다.',
    noLineHint:
      '지금 외부 스크립트 편집기는 줄 번호를 받지 않아 파일만 엽니다. 환경 설정에서 Android Studio 등을 고르면 이 줄로 엽니다.',
    more: '외 {{count}}곳',
    // 문제(⚠): 이름 바꾸기는 마지막으로 열거나 생성 코드를 맞춘 저장의 씬과 비교해 바꾼 카드에 붙인다
    renamedCode:
      '이전 이름 {{old}}을(를) 쓰는 곳 {{count}}곳: 지금 씬의 생성 코드로는 컴파일되지 않습니다.',
    renamedName:
      '이전 구성 이름 "{{old}}"을(를) 찾는 문자열 {{count}}곳: 지금 구성으로 실행하면 장치를 찾지 못합니다.',
    unresolved: '생성 코드에 없는 이름 {{count}}곳',
    unresolvedHint:
      '지금 씬으로 만드는 하드웨어 클래스에 없는 필드·형식을 쓰는 곳입니다. 그 코드로는 컴파일되지 않습니다.',
    unresolvedInClass: '이 클래스에 없는 이름 {{count}}곳',
    unknownNames: '구성에 없는 장치 이름 {{count}}곳',
    unknownNamesHint:
      'SandBot의 어느 로봇에도 이 구성 이름의 장치가 없습니다. 생성한 구성으로 실행하면 이 장치를 찾지 못합니다.'
  },
  // 환경 설정 창(Unity의 Edit > Preferences). 편집기 제품 이름(Android Studio 등)은 번역하지 않는다.
  preferences: {
    title: '환경 설정',
    close: '닫기',
    categories: '분류',
    externalTools: {
      title: '외부 도구',
      scriptEditor: '외부 스크립트 편집기',
      openByExtension: '확장자로 열기',
      browse: '찾아보기…',
      browseTitle: '외부 스크립트 편집기 선택',
      exe: '실행 파일',
      args: '외부 스크립트 편집기 인자',
      argsHint:
        '$(File) 파일 경로 · $(Line) 줄 · $(Column) 열 · $(ProjectPath) 프로젝트 폴더. 공백이 들어갈 수 있는 값은 큰따옴표로 감싸세요.',
      reset: '초기화',
      resetHint: '인자를 기본값({{args}})으로 되돌립니다.',
      systemHint: '운영체제에서 .java 파일에 연결된 앱으로 엽니다. 줄 번호는 넘기지 못합니다.',
      detectedHint: '이 PC에서 찾은 편집기입니다. 프로젝트 폴더와 줄 번호를 함께 넘겨 엽니다.',
      noneDetected:
        '이 PC에서 Android Studio, IntelliJ IDEA, VS Code를 찾지 못했습니다. 다른 편집기는 [찾아보기…]로 고르세요.',
      loading: '불러오는 중…',
      loadFailed: '외부 스크립트 편집기 설정을 읽지 못했습니다. 창을 닫았다 다시 열어 보세요.'
    },
    // 외부 도구의 JDK 칸(Unity External Tools의 JDK처럼). 실행(사이드카)에 쓴다.
    jdk: {
      title: 'JDK',
      label: '실행에 쓸 JDK',
      auto: '자동 (권장)',
      browse: '찾아보기…',
      browseTitle: 'JDK 폴더 선택',
      option: 'JDK {{version}} · {{source}} — {{home}}',
      optionTooOld: 'JDK {{version}} · {{source}} — {{home}} ({{min}} 미만이라 쓸 수 없음)',
      sources: {
        setting: '직접 고름',
        androidStudio: 'Android Studio',
        javaHome: 'JAVA_HOME',
        path: 'PATH'
      },
      errors: {
        notJdk:
          '고른 폴더는 JDK가 아닙니다(bin/java·bin/javac·release 파일이 없음, JRE일 수 있음). 설정은 그대로입니다.',
        tooOld: '고른 JDK는 {{min}}보다 오래되어 쓸 수 없습니다. 설정은 그대로입니다.'
      },
      applyFailed: 'JDK 설정을 바꾸지 못했습니다 ({{detail}}).',
      active: '사용 중',
      activeValue: 'JDK {{version}} ({{source}}) {{home}}',
      none: 'JDK를 찾지 못했습니다. Android Studio를 설치했다면 자동으로 찾습니다. JDK {{min}} 이상이 필요합니다.',
      customMissing:
        '고른 JDK 폴더를 쓸 수 없습니다(지웠거나 옮김). 자동으로 바꾸거나 다시 고르세요. JDK {{min}} 이상이 필요합니다.',
      hint: '자동은 Android Studio에 들어 있는 JDK(jbr) → JAVA_HOME → PATH 순으로 찾습니다. JDK {{min}} 이상이 필요합니다.',
      loading: 'JDK 찾는 중…',
      loadFailed: 'JDK를 찾지 못했습니다 ({{detail}}). 창을 닫았다 다시 열어 보세요.'
    },
    // 시뮬레이션(개인 설정, 다음 INIT부터)
    simulation: {
      title: '시뮬레이션',
      jitter: 'Hub 타이밍 오차',
      jitterOff: '끔 (늘 같은 결과)',
      jitterValue: '±{{percent}}%',
      jitterHint:
        '하드웨어 호출마다 가상 시간이 Hub 타이밍 표만큼 흐릅니다. 오차를 켜면 비용마다 그 범위 안에서 고르게 뽑아 실제 허브처럼 루프 시간이 조금씩 달라집니다. 시드가 같으면 결과도 같습니다.',
      seed: '시드',
      seedHint: '오차를 뽑는 순서(정수). 같은 코드·입력·시드면 같은 결과가 나옵니다.',
      autoStop: 'Autonomous는 START 뒤 {{seconds}}초에 자동으로 STOP (Driver Station과 같음)',
      battery: '배터리 전압',
      batteryHint:
        '시뮬레이터의 배터리 전압({{min}}–{{max}} V). 모터 무부하 속도가 전압 ÷ 12에 비례하고, 허브 getVoltage()가 이 값을 돌려줍니다.',
      nextRun: '바꾼 값은 다음 INIT부터 씁니다. 실행 속도는 툴바에서 바꿉니다.'
    }
  },
  // 실행(사이드카 1단계): 툴바의 OpMode 선택·INIT/START/STOP·일시 정지·한 단계·속도·가상 시간.
  // INIT·START·STOP은 Driver Station 버튼 이름 그대로다.
  play: {
    controls: '실행',
    opMode: 'OpMode',
    opModeList: 'OpMode 목록',
    chooseOpMode: 'OpMode 선택',
    chooseOpModeTooltip: '실행할 OpMode 선택 (Driver Station의 OpMode 목록)',
    noOpModes: 'OpMode 없음',
    noProjectShort: 'OpMode',
    opModeTooltip: '{{flavor}} · {{name}}\n{{className}} ({{file}})',
    flavors: {
      TeleOp: 'TeleOp',
      Autonomous: 'Autonomous'
    },
    flavorShort: {
      TeleOp: 'TeleOp',
      Autonomous: 'Auto'
    },
    list: {
      loading: 'OpMode 찾는 중…',
      failed: 'OpMode 목록을 읽지 못했습니다 ({{detail}}).',
      noTeamCode: '프로젝트에 TeamCode 폴더가 없습니다.',
      empty: 'TeamCode에 @TeleOp·@Autonomous OpMode가 없습니다(@Disabled는 보이지 않습니다).',
      truncated: 'TeamCode 파일이 너무 많아 일부 OpMode만 보입니다.'
    },
    init: 'INIT',
    start: 'START',
    stop: 'STOP',
    initTooltip: 'INIT: 저장한 TeamCode를 컴파일해 OpMode를 초기화합니다 ({{shortcut}})',
    startTooltip: 'START ({{shortcut}})',
    stopTooltip: 'STOP ({{shortcut}})',
    stoppingTooltip: '정지하는 중…',
    stopInit: 'START하지 않고 STOP',
    stopInitTooltip: 'START하지 않고 STOP',
    pause: '일시 정지',
    pauseTooltip: '일시 정지 ({{shortcut}}). 실행 전에 켜 두면 INIT 뒤 바로 멈춥니다.',
    step: '한 단계',
    stepTooltip: '한 단계: 일시 정지 중에 루프 하나만 진행합니다 ({{shortcut}})',
    speed: '실행 속도',
    speedTooltip:
      '실행 속도(가상 시간 ÷ 실제 시간). 최대는 기다리지 않고 최대한 빨리 돌립니다. 결과는 속도와 관계없이 같습니다.',
    speedMax: '최대',
    speedValue: '{{speed}}×',
    timeTooltip: '가상 시간 {{time}} (팀 코드가 보는 시간)',
    autonomousTooltip: 'Autonomous 남은 시간 · 가상 시간 {{time}}',
    timeIdleTooltip: '가상 시간 (실행하면 흐릅니다)',
    phase: {
      preparing: '준비 중…',
      compiling: '컴파일 중…',
      init: 'INIT',
      running: '실행 중',
      stopping: '정지 중…',
      finished: '끝남'
    },
    slow: '느림 {{ratio}}×',
    slowTooltip:
      '이 PC가 설정한 속도({{speed}}×)를 따라가지 못해 실제로는 {{ratio}}× 속도로 돌고 있습니다. 가상 시간 기준의 결과는 같습니다.',
    // INIT을 누를 수 없는 이유(버튼 도움말)
    disabled: {
      noProject:
        'FtcRobotController 프로젝트를 열거나 저장하면 TeamCode의 OpMode를 실행할 수 있습니다.',
      noTeamCode: '프로젝트에 TeamCode 폴더가 없어 실행할 수 없습니다.',
      noOpMode: '실행할 OpMode를 고르세요.',
      busy: '프로젝트를 열거나 저장하는 중입니다.',
      running: '실행 중입니다.'
    },
    saveBeforeRun:
      '저장하지 않은 변경 사항이 있습니다. 실행은 디스크의 TeamCode와 생성한 로봇 구성을 쓰므로 먼저 저장해야 합니다. 저장하고 실행할까요?',
    saveAndRun: '저장하고 실행',
    // 사이드카 오류의 머리말(뒤에 영어 원문이 붙는다)
    errorKind: {
      exception: '예외',
      unsupported: '지원하지 않는 SDK 기능',
      thread: '다른 스레드에서 호출',
      stall: '응답 없음',
      stuckInStop: 'STOP 뒤 끝나지 않음',
      load: 'OpMode를 불러오지 못함',
      config: '로봇 구성 오류',
      internal: '사이드카 내부 오류'
    },
    stallHint:
      '무한 루프일 수 있습니다. while 조건에 opModeIsActive()를 넣고, 루프 안에서 하드웨어를 쓰거나 sleep·idle()을 부르는지 확인하세요(가상 시계는 SDK 호출로만 흐릅니다). STOP을 누르면 JVM을 끝냅니다.',
    finishReason: {
      stopped: 'STOP으로 끝남',
      returned: 'OpMode가 스스로 끝남',
      terminated: '강제로 끝남 (terminateOpModeNow 또는 System.exit)',
      exception: '오류로 끝남',
      compileFailed: '컴파일 오류',
      loadFailed: 'OpMode나 로봇 구성을 불러오지 못함',
      stuck: 'STOP 뒤 끝나지 않아 포기함',
      shutdown: '정리하며 끝냄',
      killed: 'JVM을 강제로 끝냄',
      crashed: '실행기가 비정상 종료됨'
    },
    // finished killed의 detail(메인이 JVM을 끝낸 이유)
    killedDetail: {
      stopTimeout: 'STOP 뒤 5초 안에 끝나지 않아 JVM을 끝냈습니다.',
      stalled: '응답하지 않는(무한 루프일 수 있는) OpMode를 STOP해 JVM을 바로 끝냈습니다.',
      shutdownTimeout: '정리하는 동안 끝나지 않아 JVM을 끝냈습니다.'
    },
    gamepad: {
      disconnected: '게임패드 {{slot}}: 연결 안 됨',
      connected: '게임패드 {{slot}}: {{id}}',
      nonStandard: '게임패드 {{slot}}: {{id}} (표준 배치가 아니라 입력을 보내지 않음)',
      keyboard: '게임패드 {{slot}}: 키보드 (실행 중 씬 뷰를 누르면 입력)',
      hint: '실행 중에만 읽습니다. 연결한 뒤 버튼을 한 번 눌러야 보입니다. 처음·둘째로 연결한 패드가 gamepad1·gamepad2이고, 실행을 시작할 때 패드가 없는 첫 자리는 키보드가 맡습니다(실행하는 동안 자리는 바뀌지 않으므로 패드 버튼은 INIT 전에 누르세요).'
    }
  },
  // Console(Unity Console). 팀 코드·javac의 영어 문장은 그대로 보인다.
  console: {
    clear: '지우기',
    clearOnPlay: '실행할 때 지우기',
    clearOnPlayHint: 'INIT할 때마다 Console을 지웁니다.',
    search: 'Console 검색',
    levels: '보일 항목',
    levelToggle: {
      info: '로그 {{count}}개 보이기·숨기기',
      warning: '경고 {{count}}개 보이기·숨기기',
      error: '오류 {{count}}개 보이기·숨기기'
    },
    list: 'Console 항목',
    empty:
      '로그가 없습니다. OpMode를 실행하면 System.out·RobotLog 출력, 컴파일 오류, 실행 오류가 여기에 보입니다.',
    noMatch: '검색어나 보일 항목에 맞는 것이 없습니다.',
    noSelection: '항목을 고르면 전체 내용과 스택이 보입니다.',
    openHint: '더블클릭하거나 Enter를 누르면 외부 스크립트 편집기로 이 줄을 엽니다.',
    openLink: '누르면 외부 스크립트 편집기로 이 줄을 엽니다.',
    diagnosticKind: {
      error: '오류',
      warning: '경고',
      note: '참고'
    },
    compiled: '컴파일 완료 ({{millis}} ms)',
    compiledWithWarnings: '컴파일 완료, 경고 {{count}}개 ({{millis}} ms)',
    compileFailed: '컴파일 오류 {{count}}개 ({{millis}} ms). 항목을 더블클릭하면 그 줄을 엽니다.',
    runStarted: '{{name}} INIT · 로봇 구성 {{config}}',
    runStartedNoConfig:
      '{{name}} INIT · 하드웨어가 있는 로봇이 없어 장치 없는 hardwareMap으로 실행합니다',
    finished: 'OpMode 끝: {{reason}}',
    exception: '예외 클래스',
    thread: '스레드',
    code: '진단 코드',
    // 실행 흐름이 남기는 안내
    notices: {
      generationBlocked:
        '마지막 저장에서 하드웨어 설정 오류 {{count}}개 때문에 생성 코드를 만들지 않았습니다. TeamCode에 남아 있는 이전 하드웨어 클래스·구성으로 실행합니다.',
      generationFailed:
        '마지막 저장에서 생성 코드를 쓰지 못했습니다 ({{detail}}). TeamCode의 하드웨어 클래스·구성이 지금 씬과 다를 수 있습니다.',
      configNotGenerated:
        '{{file}}은(는) 팀이 고쳤거나 직접 만든 파일이라 SandBot이 덮어쓰지 않았습니다. 그 파일의 구성으로 실행합니다.',
      configMissing:
        '로봇 구성 {{file}}이(가) TeamCode에 없어 장치 없는 hardwareMap으로 실행합니다. 프로젝트를 저장하면 생성됩니다.',
      // 시뮬레이터 안내(simNotice, SimNoticeCode)
      sim: {
        sharedEncoderMode:
          '{{device}} 모터를 엔코더 모드(RUN_USING_ENCODER·RUN_TO_POSITION)로 돌립니다. 같은 포트에 데드휠이 연결되어 있어 실제 로봇에서는 포드 엔코더로 제어되지만, 시뮬레이터는 모터 축 엔코더로 제어한다고 가정합니다.',
        worldError: '시뮬레이터 계산 중 오류가 나 이전 센서 값을 계속 보냅니다 ({{detail}}).'
      }
    }
  },
  // 텔레메트리 탭(Driver Station 화면처럼)
  telemetry: {
    noRun: 'OpMode를 실행하면 Driver Station처럼 텔레메트리가 보입니다.',
    empty: '아직 받은 텔레메트리가 없습니다(telemetry.update()가 보낼 때 보입니다).',
    log: '텔레메트리 로그',
    sentAt: '보낸 가상 시간'
  },
  // 장치 탭(장치 출력 표)
  devices: {
    noRun: 'OpMode를 실행하면 장치 출력(모터 출력, 서보 위치 등)이 보입니다.',
    noConfig: '하드웨어가 있는 로봇이 없어 장치 없이 실행했습니다.',
    empty: '아직 받은 장치 출력이 없습니다.',
    name: '이름',
    type: '종류',
    values: '출력',
    inputs: '센서 값',
    inputsHint:
      '시뮬레이터가 보낸 허브 원시 값(엔코더 틱, IMU 각 등)입니다. 팀 코드가 읽는 값은 SDK가 방향·단위를 적용한 값입니다.',
    selectHint: '누르면 {{name}}을(를) 고릅니다.'
  },
  hardware: {
    // 생성 코드 경로(메커니즘 그룹 1단계)
    javaPath: 'Java 필드',
    javaPathHint:
      'OpMode에서 이 장치를 쓰는 식입니다. robot은 하드웨어 클래스 변수입니다 ({{className}} robot = new {{className}}(hardwareMap);).',
    javaConstants: 'Java 상수',
    badge: '⚙ {{count}}',
    severity: {
      error: '하드웨어 오류',
      warning: '하드웨어 경고'
    },
    severityBelow: {
      error: '하위 오브젝트에 하드웨어 오류',
      warning: '하위 오브젝트에 하드웨어 경고'
    },
    add: '컴포넌트 추가…',
    remove: '제거',
    removeLabel: '{{name}} 제거',
    orphan: '로봇에 속하지 않은 오브젝트라 코드를 만들지 않습니다.',
    deviceName: '장치 이름',
    hub: '허브',
    hubs: {
      controlHub: 'Control Hub',
      expansionHub: 'Expansion Hub'
    },
    hubOff: '{{hub}} (꺼짐)',
    portKinds: {
      motor: '모터 포트',
      servo: '서보 포트',
      digital: '디지털 포트',
      analog: '아날로그 포트',
      i2c: 'I2C 버스',
      encoder: '엔코더 포트',
      usb: '연결'
    },
    portUsedBy: '{{port}} · {{names}}',
    usb: 'Control Hub USB 포트',
    objectNone: '(없음)',
    categories: {
      actuator: '구동 장치',
      sensor: '센서',
      imu: 'IMU',
      odometry: '오도메트리',
      vision: '비전',
      other: '기타'
    },
    types: {
      motor: 'DC 모터',
      servo: '서보',
      crServo: '연속 회전 서보',
      sparkMini: 'REV SPARK Mini',
      imu: '허브 내장 IMU',
      distanceSensor: '거리 센서 (REV 2m)',
      colorSensor: '컬러 센서 (REV V3)',
      touchSensor: '터치 센서 (REV)',
      digitalDevice: '디지털 장치',
      analogInput: '아날로그 입력',
      led: 'LED',
      blinkin: 'REV Blinkin LED 드라이버',
      webcam: '웹캠',
      limelight: 'Limelight 3A',
      huskyLens: 'HuskyLens',
      pinpoint: 'goBILDA Pinpoint',
      otos: 'SparkFun OTOS',
      octoQuad: 'OctoQuad',
      deadWheel: '데드휠 (오도메트리 포드)'
    },
    props: {
      motorModel: '모터 종류',
      direction: '방향',
      runMode: '런 모드',
      zeroPowerBehavior: '0 출력 동작',
      pulseRange: '펄스 범위',
      scaleMin: '범위 최소',
      scaleMax: '범위 최대',
      chip: 'IMU 칩',
      logoFacing: '로고 방향',
      usbFacing: 'USB 방향',
      gain: '게인',
      mode: '모드',
      serialNumber: '시리얼',
      podType: '포드 종류',
      xPod: 'X 포드 파트',
      yPod: 'Y 포드 파트',
      xDirection: 'X 엔코더',
      yDirection: 'Y 엔코더',
      mountingAngle: '장착 각도 (°)',
      linearScalar: '거리 보정',
      angularScalar: '각도 보정',
      measures: '측정 방향',
      reversed: '엔코더 반전'
    },
    options: {
      motorModel: {
        goBilda5202: 'goBILDA 5202/5203/5204',
        goBilda5201: 'goBILDA 5201',
        revHdHex20: 'REV HD Hex 20:1',
        revHdHex40: 'REV HD Hex 40:1',
        revUltraPlanetary: 'REV UltraPlanetary',
        revCoreHex: 'REV Core Hex',
        neverest20: 'NeveRest 20',
        neverest40: 'NeveRest 40',
        neverest60: 'NeveRest 60',
        tetrix: 'TETRIX',
        matrix12v: 'MATRIX 12V',
        studicaMaverick: 'Studica Maverick',
        unspecified: '지정 안 함 (일반 모터)'
      },
      direction: {
        forward: '정방향 (FORWARD)',
        reverse: '역방향 (REVERSE)'
      },
      runMode: {
        withoutEncoder: '엔코더 없이',
        usingEncoder: '엔코더 사용',
        resetThenUsingEncoder: '엔코더 초기화 후 사용'
      },
      zeroPowerBehavior: {
        brake: '브레이크 (BRAKE)',
        float: '자유 회전 (FLOAT)'
      },
      pulseRange: {
        standard: '표준 (600–2400 µs)',
        fullRange: '전체 (500–2500 µs)'
      },
      chip: {
        bhi260ap: 'BHI260AP (2022년 9월 이후 Control Hub)',
        bno055: 'BNO055 (이전 허브)'
      },
      hubDirection: {
        up: '위',
        down: '아래',
        forward: '앞',
        backward: '뒤',
        left: '왼쪽',
        right: '오른쪽'
      },
      mode: {
        input: '입력',
        output: '출력'
      },
      podType: {
        fourBar: '4-Bar 포드',
        swingarm: '스윙암 포드'
      },
      encoderDirection: {
        forward: '정방향',
        reversed: '역방향'
      },
      measures: {
        forward: '앞뒤 (평행 포드)',
        strafe: '좌우 (수직 포드)'
      },
      reversed: {
        no: '아니오',
        yes: '예'
      }
    },
    hints: {
      imu: '허브의 REV 로고와 USB 포트가 로봇의 어느 쪽을 향하는지 고릅니다. 씬에서 보라 화살표는 로고 방향, 주황 화살표는 USB 방향입니다.',
      webcam:
        'Driver Station의 Configure Robot에서 스캔하면 보이는 USB 시리얼을 넣으세요. 비어 있으면 구성 XML에 넣지 않습니다.',
      limelight:
        'Driver Station 스캔으로 확인한 시리얼을 EthernetOverUsb:<인터페이스>:<IP> 형식으로 넣으세요.',
      pinpoint:
        'X 포드는 앞뒤, Y 포드는 좌우 이동을 잽니다. 오프셋은 고른 파트의 위치로 계산합니다.',
      otos: '오프셋 위치는 이 파트의 위치로 계산합니다. 방향은 센서 화살표가 로봇 앞에서 돌아간 각도(장착 각도, 반시계 +)로 정합니다.',
      deadWheel:
        '위치는 이 파트에서 계산합니다. 같은 번호 모터 포트에 모터가 있으면 그 모터 이름으로 엔코더를 읽습니다.'
    },
    derived: {
      pinpoint: '오프셋: X {{x}} mm, Y {{y}} mm',
      otos: '오프셋: X {{x}} in, Y {{y}} in, H {{h}}°',
      deadWheel: '위치: X {{x}} mm, Y {{y}} mm'
    },
    robot: {
      title: '로봇 하드웨어',
      className: '클래스 이름',
      configName: '구성 이름',
      expansionHub: 'Expansion Hub',
      expansionHubEnabled: '사용',
      address: '주소',
      noComponents:
        '파트에 하드웨어 컴포넌트를 붙이면, 저장할 때 TeamCode에 하드웨어 클래스와 로봇 구성 XML을 만듭니다.',
      files: '생성 파일 (TeamCode)',
      usage: 'OpMode에서 쓰는 법',
      componentCount: '컴포넌트 {{count}}개',
      issues: '문제 ({{count}})'
    },
    generation: {
      notSaved: '저장(Ctrl+S)하면 생성합니다.',
      blocked:
        '마지막 저장: 프로젝트에 하드웨어 오류가 {{count}}개 있어 아무 파일도 만들지 않았습니다.',
      failed: '마지막 저장: 파일을 쓰지 못했습니다 ({{detail}}).',
      noTeamCode: '마지막 저장: TeamCode 폴더가 없습니다.',
      deleted: '마지막 저장에서 지운 이전 생성 파일: {{files}}',
      fileStates: {
        written: '저장함',
        unchanged: '변경 없음',
        skipped: '직접 만든 파일이 있어 건너뜀',
        modified: '고친 파일이라 덮어쓰지 않음',
        missing: '아직 만들지 않음'
      }
    },
    issues: {
      emptyName: '장치 이름이 비어 있습니다.',
      nameWhitespace:
        '"{{name}}" 앞뒤에 공백이 있습니다. Driver Station 이름과 맞지 않을 수 있습니다.',
      duplicateName: '장치 이름 "{{name}}"이(가) 겹칩니다.',
      fieldNameCollision: '{{names}}이(가) 같은 Java 필드 {{field}}이(가) 됩니다.',
      portOutOfRange: '{{name}}: 포트 {{port}}은(는) 범위(0–{{max}}) 밖입니다.',
      portConflict: '포트 {{port}}을(를) {{names}}이(가) 같이 씁니다.',
      i2cAddressConflict: 'I2C 버스 {{bus}}에서 {{names}}의 주소가 겹칩니다. 다른 버스에 다세요.',
      imuOrientationInvalid: '{{name}}: 로고 방향과 USB 방향은 서로 수직이어야 합니다.',
      touchSensorEvenChannel:
        '{{name}}: REV 터치 센서는 홀수 디지털 채널(1, 3, 5, 7)에서 동작합니다.',
      encoderMotorConflict:
        '{{name}}: 같은 포트 {{port}}의 모터 {{motor}}이(가) 엔코더를 씁니다. 그 모터의 런 모드를 "엔코더 없이"로 바꾸세요.',
      deadWheelSlowPort:
        '{{name}}: 엔코더 포트 {{port}}은(는) 빠른 회전에서 값을 놓칠 수 있습니다. 앞뒤 포드는 0번이나 3번에 다세요.',
      expansionHubDisabled:
        '{{name}}이(가) 꺼진 Expansion Hub에 있습니다. 로봇 하드웨어에서 Expansion Hub를 켜세요.',
      serialMissing:
        '{{name}}: 시리얼이 없어 구성 XML에 넣지 않고, 하드웨어 클래스의 이 필드는 null이 됩니다.',
      limelightSerialInvalid:
        '{{name}}: 시리얼이 EthernetOverUsb:<인터페이스>:<IP> 형식이 아닙니다.',
      pinpointPodMissing:
        '{{name}}: 이 로봇의 X·Y 포드 파트를 고르세요. 고르기 전에는 오프셋을 0으로 만듭니다.',
      orphanComponent: '{{name}}: 로봇에 속하지 않은 오브젝트에 붙어 있어 코드를 만들지 않습니다.',
      invalidClassName: '"{{className}}"은(는) Java 클래스 이름으로 쓸 수 없습니다.',
      duplicateClassName: '다른 로봇과 생성 파일 이름이 겹칩니다 ({{className}}).',
      emptyConfigName: '로봇 구성 이름이 비어 있습니다.',
      duplicateConfigName: '다른 로봇과 구성 이름 "{{configName}}"이(가) 겹칩니다.',
      expansionHubAddressReserved:
        'Expansion Hub 주소 {{address}}은(는) SDK가 시스템용으로 남겨 둔 범위입니다(보통 1–10). 허브의 실제 주소와 같은지 확인하세요.',
      servoScaleInvalid:
        '{{name}}: 범위 최소가 범위 최대보다 작아야 합니다. 서보를 반대로 돌리려면 방향을 바꾸세요.',
      imuChipHub: '{{name}}: Expansion Hub의 내장 IMU는 BNO055입니다. IMU 칩을 BNO055로 바꾸세요.',
      constantNameCollision:
        '{{names}}이(가) 같은 상수 {{constant}}을(를) 만듭니다. 이름을 바꾸세요.',
      expansionHubAddressInvalid:
        'Expansion Hub 주소 {{address}}은(는) 쓸 수 없습니다 (1–254, 173 제외).',
      invalidGroupName:
        '그룹 "{{name}}": "{{className}}"은(는) Java 클래스 이름으로 쓸 수 없습니다. 하이어라키의 그룹 이름이 생성 코드의 클래스 이름이 되므로 영문 대문자로 시작하고 영문·숫자만 쓰세요. 이름을 그대로 두려면 그룹 인스펙터에서 "Java 클래스 이름"을 정하세요.',
      reservedGroupName:
        '그룹 "{{name}}": 클래스 이름 {{className}}은(는) 생성 코드가 쓰는 Java 타입과 같아 쓸 수 없습니다. 다른 이름을 쓰세요.',
      duplicateGroupClass:
        '{{names}}: Java 클래스 이름 {{className}}이(가) 겹칩니다. 같은 클래스 안의 그룹은 대소문자만 달라서는 안 되고, 그룹을 감싸는 클래스(로봇 클래스 포함)와 같은 이름도 쓸 수 없습니다.',
      reservedFileName:
        '클래스 이름 {{className}}은(는) Windows의 장치 이름이라 파일 이름({{className}}.java)으로 쓸 수 없습니다. 다른 이름을 쓰세요.'
    }
  }
}

export type Messages = typeof ko
export default ko
