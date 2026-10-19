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
    preferencesTooltip: '환경 설정 (외부 스크립트 편집기)'
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
      '{{file}}이(가) 이제 TeamCode/src/main/java 안의 보통 파일이 아니라(밖을 가리키는 링크 등) 튜닝 값을 쓰지 않았습니다. 파일을 되돌리거나 스크립트를 다시 연결한 뒤 다시 저장하세요. 값은 저장하지 않은 채로 남아 있습니다.'
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
    inspector: '인스펙터'
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
    local: '로컬'
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
    menu: {
      label: '하이어라키 메뉴',
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
    }
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
