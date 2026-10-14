// 기준 로케일. 키 구조는 여기서 정의하고, 다른 로케일은 같은 구조(Messages)를 따라야 타입 검사를 통과한다.
const ko = {
  common: {
    dismiss: '닫기'
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
    redoShortcut: '다시 실행 (Ctrl+Shift+Z 또는 Ctrl+Y)'
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
    codegenFailed: 'TeamCode에 생성 코드를 쓰지 못했습니다 ({{detail}}).'
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
    part: '파트'
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
    collapse: '접기'
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
      relink: '파일 다시 찾기'
    }
  },
  hardware: {
    badge: '⚙ {{count}}',
    severity: {
      error: '하드웨어 오류',
      warning: '하드웨어 경고'
    },
    severityBelow: {
      error: '하위 오브젝트에 하드웨어 오류',
      warning: '하위 오브젝트에 하드웨어 경고'
    },
    title: '하드웨어 컴포넌트',
    add: '컴포넌트 추가…',
    remove: '제거',
    removeLabel: '{{name}} 제거',
    empty: '붙은 컴포넌트가 없습니다.',
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
        'Expansion Hub 주소 {{address}}은(는) 쓸 수 없습니다 (1–254, 173 제외).'
    }
  }
}

export type Messages = typeof ko
export default ko
