# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

SandBot은 Unity 에디터 스타일의 FTC(FIRST Tech Challenge) 로봇 개발 도구다. 씬 뷰에 팀의 로봇 CAD(STEP)를 불러온다. 파트를 선택하면 인스펙터에서 하드웨어 컴포넌트를 설정하고, 하이어라키에서 메커니즘을 묶는다(생성 하드웨어 클래스의 중첩 클래스). 동작 로직은 팀의 일반 FTC Java(TeamCode)로 작성하고, 오브젝트에 그 파일을 연결해 외부 편집기로 연다. 작성한 코드는 필드 위 운동학 시뮬레이션으로 확인한다.

**현재 상태:** 에디터 뼈대 단계다. 툴바, 크기 조절이 되는 3패널(하이어라키 · 씬 뷰 · 인스펙터), i18n, 핸들 축 전역/로컬 전환, STEP 임포트(방향 맞춤 포함), 프로젝트 열기·저장이 있다. 프로젝트 없이 시작하면 임시 씬(18 in 상자 로봇과 웹캠, `scene/sceneStore.ts`)이 보이고, 첫 STEP 임포트 때 사라진다. 하드웨어 컴포넌트(인스펙터 편집, 검증, 저장 때 TeamCode에 하드웨어 클래스·로봇 구성 XML 생성), 표시 단위 설정, 실행 취소, 메시 캐시, Unity식 씬 뷰 조작, Unity식 하이어라키 편집(다중 선택, Create Empty·Create Empty Parent, 드래그·잘라내기/붙여넣기로 부모 바꾸기, 이름 바꾸기, 검색, 전체·하위 선택, 씬 뷰 보이기·숨기기와 고립 보기)과 메커니즘 그룹(생성 하드웨어 클래스의 중첩 클래스), 네이티브 STEP 변환기(Windows x64는 CI가 빌드해 GitHub Release로 배포)와 불러오기 진행·취소가 있다. 스크립트 연결(오브젝트 → TeamCode Java 파일, Unity식 외부 스크립트 편집기로 열기)과 튜닝 값(연결한 파일의 FTC Dashboard `@Config` 필드를 인스펙터에서 고치고 Ctrl+S에 리터럴만 씀)이 있다. 사용처(생성 하드웨어 클래스의 필드·형식·상수를 TeamCode에서 쓰는 곳과 구성 이름 문자열을 장치·그룹·로봇 카드에 보이고, 더블클릭하면 외부 편집기로 그 줄을 연다. 스크립트 카드에는 그 파일이 쓰는 하드웨어)가 있다. 코드 단위 프로젝트 설정, 사이드카·시뮬레이터는 아직 없다. 아래 내용은 사용자와 합의한 설계 결정이며 구현은 이를 따른다.

**설계 원칙:** Unity 환경을 최대한 그대로 가져온다. Unity를 써 본 사람이 익숙하게 바로 쓸 수 있는 것이 개발 효율과 직관성의 기준이다. 기능을 설계할 때 Unity에 대응하는 것이 있으면 그 이름·조작·동작을 먼저 따르고, FTC 구조와 맞지 않는 부분만 바꾼다.

## 확정된 설계 결정

| 항목        | 결정                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 플랫폼      | Electron 데스크톱 앱 · TypeScript · React · Three.js. 스크립트는 외부 편집기로 연다(앱 안 편집기는 범위 밖)                                                                                                                                                                                                                                                                                          |
| 인스펙터    | Unity 방식. 파트에 하드웨어 컴포넌트(DcMotorEx, Servo, 센서 등)를 붙여 속성(설정 이름, 허브/포트, 방향, 런 모드 등)을 편집한다. 동작 로직은 일반 FTC Java로 쓰고(SandBot 전용 런타임·생명주기 없음), 스크립트 카드는 그 파일로 가는 연결이다. 생성 코드는 연결 파일을 참조하지 않는다                                                                                                                |
| CAD         | STEP(.step/.stp)만 지원. occt-import-js(OpenCascade WASM, LGPL-2.1)로 워커에서 읽는다. 같은 C++ 코드를 네이티브로 빌드한 변환기(`native/step-converter`)가 이 PC에서 실행되면 메인 프로세스가 그것으로 변환한다(WASM의 2 GB 메모리 한도가 없음). CAD 프로그램마다 위·앞 축이 달라서(팀이 여러 CAD를 섞어 씀) 파일마다 방향을 고른다. 기본값은 마지막에 고른 방향이고, 처음에는 Y-up(Fusion 360 기본) |
| 시뮬레이션  | 운동학 수준. 드라이브트레인/메커니즘을 OpMode 코드와 게임패드로 구동하고, 충돌·물리는 단순화                                                                                                                                                                                                                                                                                                         |
| OpMode 실행 | JVM 사이드카 + 가짜 FTC SDK. 팀의 실제 Java OpMode를 수정 없이 실행                                                                                                                                                                                                                                                                                                                                  |
| 배포        | 팀의 FtcRobotController 프로젝트 `TeamCode`에 Java 파일을 직접 저장. 빌드/설치는 Android Studio에서 함 (도구 내 ADB 배포, OnBot Java 업로드는 범위 밖)                                                                                                                                                                                                                                               |
| 언어        | UI는 i18n(한국어 기본, 영어). CLAUDE.md·코드 주석·커밋 메시지는 한국어                                                                                                                                                                                                                                                                                                                               |
| 툴체인      | pnpm · electron-vite(빌드) · electron-builder(패키징) · ESLint + Prettier · Vitest                                                                                                                                                                                                                                                                                                                   |
| 단위        | 세 층으로 분리. 내부(저장·계산)는 미터·라디안으로 고정. 표시·입력 단위는 사용자 개인 앱 설정(mm·cm·m·in, 각도는 °). 첫 실행 때 묻는다. 생성 Java 코드의 단위는 프로젝트(팀) 설정                                                                                                                                                                                                                     |
| 좌표계      | 저장은 FTC 필드 좌표계(원점 필드 중앙 바닥, Z 위). 로봇 좌표계는 X 앞·Y 왼쪽·Z 위, 원점 로봇 중심 바닥. 인스펙터는 Unity처럼 부모 기준 값을 편집하고(최상위의 부모는 필드), 로봇 안 오브젝트에는 로봇 중심 기준 위치를 읽기 전용으로 함께 보여 준다. 이동·회전 핸들 축은 Unity처럼 전역(필드 축)·로컬(오브젝트 자신의 축) 중에서 고른다. STEP 파트의 자기 축은 CAD 파일 축이다                       |
| 씬 뷰 조작  | Unity 씬 뷰와 같다. 우클릭 드래그로 둘러보기, 우클릭+W/A/S/D·Q/E로 비행(Shift 빠르게, 휠로 속도), 가운데 드래그 팬, Alt+왼쪽 궤도, Alt+오른쪽·휠 줌, F 포커스. 카메라는 순간 이동하지 않는다(F·축 표시 클릭은 짧게 날아가고, 휠 줌은 부드럽게 따라가고, 비행은 가속·감속, 드래그는 약 50 ms 감쇠로 따라감). 도구는 Q 손·W 이동·E 회전, X로 핸들 축 전역/로컬 전환(버튼과 단축키)                     |
| 메시 캐시   | STEP 변환 결과를 개인 PC의 앱 데이터 폴더(`userData/mesh-cache`)에 둔다. 키는 STEP 내용·파일 이름·형식 태그의 해시라 파일이 바뀌면 다시 변환한다. 프로젝트 폴더·git에는 넣지 않는다                                                                                                                                                                                                                  |
| 프로젝트    | 팀의 FtcRobotController 폴더가 곧 프로젝트다. 도구 데이터는 `sandbot/project.json`에 둔다. STEP은 복사하지 않고 원래 위치를 프로젝트 루트 기준 상대 경로와 절대 경로로 함께 기억한다. 저장은 수동(Ctrl+S)이다                                                                                                                                                                                        |
| 변환기 배포 | 팀은 Windows를 쓴다. Windows x64 네이티브 STEP 변환기만 CI(GitHub Actions, Linux 러너에서 MinGW 교차 빌드, wine으로 WASM과 결과 비교)가 빌드해 GitHub Release에 올리고, 팀원은 `pnpm fetch:step-converter`로 받는다(`pnpm build:win`도 먼저 받는다). 실행 파일은 git에 넣지 않는다. 코드 서명(Windows·macOS)은 하지 않는다                                                                           |

## 아키텍처

세 개의 프로세스로 구성한다.

- **Electron main**: 파일 시스템 접근, 프로젝트 열기/저장, `TeamCode`에 Java 파일 쓰기, JVM 사이드카의 시작·종료를 맡는다.
- **Renderer (React)**: 씬 뷰(Three.js), 하이어라키, 인스펙터, 운동학 시뮬레이터를 둔다. 스크립트는 메인 프로세스가 외부 편집기(Unity의 External Script Editor처럼 고른 앱)로 연다.
- **JVM 사이드카**: 가짜 FTC SDK 위에서 OpMode를 실행한다. `hardwareMap`은 가상 하드웨어를 반환한다. 한 방향으로는 모터 출력·서보 위치를 시뮬레이터로 보내고, 반대 방향으로는 엔코더·IMU 등 센서 값을 받는다.

데이터 흐름:

```
STEP 파일 ─▶ OCCT(WASM, 워커) ─▶ 파트 계층 메시 ─▶ 씬 그래프(메커니즘 그룹)
                                                  │
              노드에 하드웨어 컴포넌트 부착, TeamCode Java 파일 연결 (인스펙터)
                                                  │
        ┌─────────────────────────┬───────────────┴───────────────────────┐
        ▼                         ▼                                       ▼
 생성 코드(하드웨어 클래스·   사용자 코드(TeamCode Java):             JVM 사이드카 ◀─IPC─▶ 운동학 시뮬레이터
 구성 XML)를 TeamCode에 저장   외부 편집기로 열기·연결 표시
```

## 지켜야 할 불변 조건

- **로봇 코드의 원본은 `TeamCode`의 Java 파일이다.** 도구는 스크립트의 별도 사본을 두지 않는다. 튜닝 값의 원본도 Java 파일이고, SandBot은 저장하지 않은 편집(`tunables`)만 들고 있다. 스크립트 연결(`SceneObject.scripts`)은 TeamCode 기준 경로와 클래스 이름만 기억하고, 파일은 외부 편집기로 연다.
- **생성 코드와 사용자 코드를 분리한다.** 인스펙터 속성에서 만들어지는 코드(hardwareMap 매핑 등)는 다시 생성해도 사용자가 작성한 스크립트를 덮어쓰지 않아야 한다.
- **가짜 FTC SDK는 실제 SDK의 API 표면을 그대로 따른다.** 패키지·클래스·메서드 시그니처(`com.qualcomm.robotcore.hardware.*`, `com.qualcomm.robotcore.eventloop.opmode.*` 등)가 같아야 한다. 같은 소스가 Android Studio(실제 SDK)와 사이드카(가짜 SDK) 양쪽에서 수정 없이 컴파일되어야 한다.
- **STEP 파싱은 UI 스레드에서 하지 않는다.** OCCT WASM은 무거우므로 워커에서 돌리고 결과 메시만 넘긴다. 네이티브 변환기는 별도 프로세스다.
- **네이티브 STEP 변환기는 렌더러 WASM과 같은 소스로 빌드한다.** occt-import-js와 OCCT의 버전·커밋은 `native/step-converter/version.json`에 있고, 빌드 스크립트·앱(`--version` 확인)·테스트가 이 파일을 쓴다. occt-import-js를 올리면 version.json도 맞춰 올린다(테스트가 확인한다). 소스(`occt-import-js/src`, OCCT)는 고치지 않는다. 그래야 노드 계층·메시 순서가 WASM과 같다.
- **UI 문자열을 하드코딩하지 않는다.** 모든 문자열은 i18n 리소스(ko 기본, en)를 거친다.
- **단위 변환은 경계에서만 한다.** 씬 파일·씬 그래프·시뮬레이터 등 내부 값은 항상 미터·라디안이다. 변환은 세 곳에서만 일어난다.
  - STEP 임포트: 파일에 선언된 단위에서 미터로 변환
  - UI 표시·입력: 사용자 표시 단위로 변환. 입력칸은 `12in`, `30cm`처럼 단위를 붙인 값도 받는다.
  - 코드 생성: 프로젝트의 코드 단위로 변환
- **표시 단위는 개인 앱 설정에, 코드 단위는 프로젝트 설정에 저장한다.** 같은 프로젝트를 여는 팀원마다 표시 단위가 달라도 프로젝트 파일과 생성 코드는 바뀌지 않아야 한다.
- **좌표 저장은 한 가지다.** 씬 오브젝트의 `transform`은 부모 기준 로컬 값이고, 최상위는 필드 좌표계 값이다. 인스펙터는 `transform`(부모 기준 값)을 그대로 보여 주고 편집한다. 핸들 축 전역/로컬 전환은 핸들 방향에만 적용한다. 로봇 좌표계는 계산(로봇 중심 기준 위치, 센서 오프셋)에 쓴다. 좌표 변환은 `scene/model.ts`의 함수(`getTransformInFrame`, `localTransformFromWorld` 등)로만 한다.
- **회전은 X(롤)·Y(피치)·Z(요) 라디안이고, 적용 순서는 Three.js Euler `'ZYX'`다.** 렌더링(`rotation={[rx, ry, rz, 'ZYX']}`)과 계산이 같은 순서를 써야 한다.
- **Z-up은 `scene/coordinates.ts`가 `Object3D.DEFAULT_UP`을 바꿔서 적용한다.** 이 모듈은 `main.tsx`에서 가장 먼저 import해야 한다.
- **최상위 로봇은 바닥 평면에만 있다(높이·롤·피치 0).** `constrainTransform`이 강제하고, 핸들과 인스펙터도 해당 축을 막는다.
- **CAD 메시 형상 id는 `cadGeometryId(CAD 루트 id, 메시 순번)`이고 프로젝트 파일에 저장된다.** 프로젝트를 열면 STEP을 다시 읽어 같은 id로 등록한다. 새로 불러온 CAD(`cad.meshIndexing: 'source'`, `PROJECT_VERSION` 3)의 순번은 occt-import-js 결과의 원래 메시 순번(`ImportedMesh.sourceIndex`)이라, 삼각형을 만들지 못해 빠진 메시가 있어도 다른 파트의 id가 밀리지 않는다. 예전 프로젝트(meshIndexing 없음)는 빈 메시를 빼고 다시 매긴 순번이고, 저장한 메시 수가 지금 전체 수와 같으면 두 순번이 같다(`reloadIndexing`). `convertOcctResult`가 메시를 나열하는 순서를 바꾸면 기존 프로젝트의 파트와 형상 연결이 깨진다. `convertOcctResult`의 출력이나 occt-import-js 버전을 바꾸면 메시 캐시 형식 태그(`MESH_CACHE_TAG`)도 올린다.
- **형제 순서는 `objects`의 키 순서다.** 직렬화·파싱·실행 취소가 모두 이 순서를 지킨다. 오브젝트를 다시 만들 때 키 순서를 바꾸지 않는다(부모 바꾸기·순서 바꾸기는 `scene/hierarchy.ts`만 한다). 정수처럼 보이는 id는 JavaScript가 먼저 나열하므로 쓰지 않는다(앱은 UUID만 만든다).
- **하이어라키 편집은 `scene/hierarchy.ts`의 순수 함수로만 한다.** 부모를 바꿔도 월드 자세를 지킨다. 로봇은 최상위에서만 순서를 바꾸고, CAD 루트는 지금 부모(로봇) 안에서만 순서를 바꾸며(CAD 루트 transform이 곧 정렬), 나머지는 소속 로봇이 바뀌지 않는 곳으로만 옮긴다(`moveRejection`).
- **CAD 루트 밖으로 옮긴 CAD 노드는 `cadOrigin`(그 CAD 루트 id)을 갖는다.** group·robot·CAD 루트에는 두지 않고, 부모에게서 물려받는 출처와 다를 때만 둔다(`cadOriginOf`). CAD 루트를 지우면 옮긴 파트도 함께 지우고(하이어라키가 확인을 묻는다), CAD 루트의 변환(정렬 변경, 직접 편집)이 바뀌면 옮긴 파트도 같은 만큼 움직인다(`carryCadDependents`). 프로젝트를 열 때 끊긴 `cadOrigin`은 버리고, 메시 파트는 형상 id 접두어로 출처를 고친다.
- **씬 문서는 바꿀 때마다 새 객체를 만든다(불변).** 실행 취소(`editor/history.ts`)가 바뀌기 전 `objects`를 그대로 스냅샷으로 쌓기 때문이다. 형상(`geometryRegistry`) 해제도 기록에서 쓰지 않게 된 것만 history가 한다. sceneStore에서 직접 해제하지 않는다.
- **프로젝트 파일 형식을 바꾸면 `PROJECT_VERSION`을 올리고 이전 버전을 읽는 경로를 남긴다.** `parseProject`가 형식을 검증한다. 더 새 버전의 파일은 열지 않는다.
- **TeamCode 접근은 열거나 저장한 프로젝트 루트에만 한다.** 메인 프로세스(`src/main/projectRoots.ts`)가 `openProject`·`saveProject`로 받은 루트를 기억하고, TeamCode IPC(생성 파일 맞추기, Java 목록, 외부 편집기로 열기, 튜닝 값 읽기·쓰기, 사용처 읽기)는 다른 루트를 거부한다. 사용자 Java 경로는 `src/shared/teamCodePaths.ts`의 규칙(`src/main/java/` 아래 Java 식별자 세그먼트, 소문자 `.java`, Windows 장치 이름 제외, 생성 폴더는 대소문자 무시로 제외, NFC)으로만 받고, 실제 경로가 그 폴더 안인지(`containedIn`, 다른 드라이브 포함) 확인한다. project.json의 스크립트 경로도 git에서 온 값이라 같은 규칙으로 검사한다.
- **TeamCode에 쓰는 것은 두 가지뿐이다.**
  - **생성 파일:** 도구가 만든 파일만 쓰고 지운다. 생성 파일은 앞부분에 `@sandbot-generated <내용 해시>` 표식을 넣는다(`stampGenerated`). 메인 프로세스는 표식과 해시가 맞는, 도구가 쓴 그대로인 파일만 덮어쓰거나 지운다. 팀이 고쳤거나 복사·이름 변경한 생성 파일(해시 불일치)과 사람이 만든 파일은 건너뛰고 알린다. 경로는 `src/shared/generatedFiles.ts`의 허용 규칙(생성 패키지 폴더의 `.java`, `res/xml`의 `sandbot_*.xml`)으로만 받는다.
  - **사용자 Java 파일:** 사용자가 인스펙터에서 바꾼 튜닝 값(FTC Dashboard가 보여 주는 `@Config` 필드)의 초기값 리터럴만 고쳐 쓴다. 쓰는 때는 저장(Ctrl+S)뿐이고, 그 전까지 값은 SandBot의 저장하지 않은 변경이다(창 제목 `*`, 실행 취소 가능, `project.json`에 넣지 않음). 파일을 만들거나 지우거나 이름을 바꾸지 않고(같은 폴더의 `.<이름>.sandbot.tmp` 임시 파일만 예외), 리터럴 밖의 글자(주석·서식·CRLF·BOM)는 그대로 둔다. 저장할 때 파일을 다시 읽어 그 필드의 지금 리터럴이 편집할 때 본 값(`base`)과 다르면(다른 편집기에서 바뀜) 쓰지 않고 파일 값을 따른 뒤 알린다. 메인 프로세스는 렌더러가 읽은 내용의 해시가 디스크와 같고, 바꿀 자리의 글자가 예상한 리터럴이고, 새 글자가 그 필드 형식(박싱 포함)에 javac가 받는 리터럴 하나(`src/shared/java/javaLiteral.ts`의 `isWritableLiteral`·`literalFitsType`)일 때만 임시 파일에 쓴 뒤 바꿔치기한다(Windows에서 rename을 다시 할 때마다 파일이 그대로인지 다시 확인한다). 경로는 `src/shared/teamCodePaths.ts`의 규칙으로만 받는다. 생성 표식이 있거나, UTF-8로 읽어 그대로 되돌릴 수 없거나, 이 사용자가 파일·폴더에 쓸 수 없거나(읽기 전용), 1 MB를 넘거나, 리터럴 밖에 `\u`가 있는 파일은 쓰지 않는다. 이때는 값을 저장하지 않은 채로 남기고 알린다(충돌처럼 버리지 않는다). 메인이 받지 않는 경로가 된 파일(밖을 가리키는 링크 등)은 스크립트 카드도 보일 수 없으므로 없는 파일처럼 버리고 알린다.
- **사용처는 읽기만 한다.** TeamCode에 쓰지 않고, project.json·실행 취소 기록·localStorage에 넣지 않는다. 결과는 파일 내용과 지금 씬으로 다시 계산한다. 생성 코드의 이름은 `codeScopes`의 결과(`usageSymbols`)에서만 가져오고 다시 만들지 않는다. 생성 패키지의 형식은 씬(기호표)만 정의한다(팀 파일이 같은 패키지를 선언해도 쓰지 않는다).
- **하드웨어 카탈로그(`hardware/catalog.ts`)에는 FTC SDK 소스에서 확인한 값만 넣는다.** 구성 XML 태그는 대소문자를 구분하고, 틀린 태그는 SDK가 오류 없이 장치를 버린다. Java 타입·메서드·I2C 주소도 SDK 소스로 확인한다. 가짜 SDK는 카탈로그의 Java 타입을 모두 지원해야 한다.
- **하드웨어 검증 오류가 하나라도 있으면 아무 파일도 생성하지 않는다.** 이전 생성 파일도 그대로 둔다. 경고는 생성을 막지 않는다(`hardware/validation.ts`의 심각도).

## 미결정 사항

아래 항목은 아직 정하지 않았다. 스캐폴딩이나 구현 중에 이 항목을 만나면 추측해서 정하지 말고 사용자에게 확인한다.

- 필드 X·Y축이 어느 벽(얼라이언스·관중석)을 향하는지. FTC가 시즌별로 정하므로 시즌별 필드 모델과 함께 정한다.
- 사이드카 IPC 방식(stdio JSON-RPC 또는 WebSocket)과 시뮬레이션 동기화 방식(lockstep 또는 실시간)
- JDK를 앱에 번들할지 여부
- 지원할 FTC 라이브러리 범위(Road Runner, Pedro Pathing 등)와 시즌별 필드 모델. 튜닝 값은 FTC Dashboard의 `@Config` 규칙을 따르기로 정했다. 사이드카가 Dashboard API(`@Config`, `FtcDashboard`, `TelemetryPacket`)를 제공할지, Pedro Pathing Panels의 `@Configurable`도 인식할지는 아직 정하지 않았다.
- macOS·Linux용 네이티브 STEP 변환기 배포(macOS 서명, Linux는 오래된 glibc 환경에서 빌드할지). 쓰는 사람이 생기면 정한다. 그전까지는 직접 빌드한다(`pnpm build:step-converter`).

## 개발 명령어

```bash
pnpm install                 # 의존성 설치 (postinstall에서 electron-builder install-app-deps 실행)
pnpm dev                     # 개발 모드 실행 (HMR)
pnpm lint                    # ESLint
pnpm format                  # Prettier로 전체 포맷
pnpm typecheck               # main/preload(tsconfig.node.json) + renderer(tsconfig.web.json) 타입 검사
pnpm test                    # Vitest 전체 1회 실행 (test:watch는 감시 모드)
pnpm test src/path/foo.test.ts   # 단일 테스트 파일
pnpm test -t "테스트 이름"        # 이름으로 필터
pnpm build                   # typecheck 후 out/에 빌드
pnpm start                   # 빌드 결과 미리보기 실행
pnpm build:win | build:mac | build:linux   # electron-builder로 설치 파일 생성 (dist/)
pnpm fetch:step-converter    # 네이티브 STEP 변환기(Windows x64)를 GitHub Release에서 받기(지금 소스와 같은 빌드만)
pnpm build:step-converter    # 네이티브 STEP 변환기 직접 빌드(git·CMake·C++ 컴파일러 필요, OCCT 전체 컴파일로 오래 걸림)
pnpm usage-oracle            # 사용처 정답표(javac) 다시 만들기(JDK 11+ 필요, CI는 쓰지 않음)
```

root 권한·디스플레이가 없는 컨테이너에서는 `xvfb-run -a pnpm start --noSandbox`로 실행해야 한다.

## 코드 구조 메모

- `src/main`(메인 프로세스), `src/preload`(contextBridge로 렌더러에 API 노출, 타입은 `src/preload/index.d.ts`), `src/renderer/src`(React)로 나뉜다. 렌더러는 Node API에 직접 접근하지 않고 preload를 거친 IPC만 쓴다.
- 타입 검사는 `tsconfig.node.json`(main/preload/설정 파일)과 `tsconfig.web.json`(renderer) 두 갈래다. 새 최상위 설정 파일을 추가하면 `tsconfig.node.json`의 `include`에도 넣는다.
- `@renderer` 경로 별칭은 `electron.vite.config.ts`, `tsconfig.web.json`, `vitest.config.ts` 세 곳에 정의되어 있다. 별칭을 추가·변경할 때는 세 곳을 함께 고친다.
- 렌더러 UI는 `src/renderer/src/editor/`에 있다. `EditorLayout`이 툴바와 react-resizable-panels(v4: `Group`/`Panel`/`Separator`)의 3패널을 구성한다. 각 패널(`editor/panels/`)은 `PanelFrame`으로 헤더와 본문을 감싼다.
- 씬 상태는 zustand 스토어 두 개로 나뉜다. `scene/sceneStore.ts`는 문서 데이터(오브젝트 트리 `objects`와 저장 전 튜닝 값 `tunables`)를, `editor/editorStore.ts`는 편집기 상태(선택, 도구, 핸들 축 전역/로컬, 카메라 포커스 요청)를 맡는다. 선택은 Unity처럼 여러 개(`selectedIds`, Ctrl은 토글·Shift는 보이는 행 범위)와 활성 오브젝트(`selectedId`)다. 여러 개를 고르면 핸들을 숨기고 인스펙터는 요약(누르면 그 오브젝트로 좁힘)만 보인다(Unity의 다중 편집과 다른 임시 편차). 씬 뷰 클릭은 하나만 고른다. 스토어에는 직렬화할 수 있는 값만 둔다. CAD 메시 형상(`BufferGeometry`)은 `scene/geometryRegistry.ts`에 id로 보관하고, 오브젝트의 `visual.geometryId`가 그것을 가리킨다.
- STEP 임포트 흐름은 다음 순서다.
  - `cad/importStep.ts`의 `loadStepModel`이 메시 캐시를 먼저 찾는다. 없으면 네이티브 변환기(쓸 수 있을 때) 또는 WASM으로 변환한다.
  - `cad/stepWorker.ts`(웹 워커)가 WASM이면 occt-import-js로 미터 단위로 읽고, 네이티브면 변환기 출력(SBSTEP01, `cad/nativeResult.ts`)을 읽어, 둘 다 `convertOcctResult`로 계층과 피벗 중심 메시로 바꾼다.
  - `cad/importStep.ts`(메인 스레드)가 `buildSceneObjects`로 오브젝트를 만들고, 형상을 등록해 스토어에 넣는다.
  - 오브젝트 구조는 로봇 → CAD 루트(`cad` 메타데이터, transform이 곧 정렬) → 어셈블리·파트다.
  - 각 노드의 피벗은 CAD 경계 상자의 중심이다. 불러올 때 CAD 루트 아래 노드는 회전 없이 위치만 가진다(그룹으로 옮기면 회전이 생길 수 있다).
  - 정렬 계산은 `cad/alignment.ts`의 `cadRootTransform`이 한다. CAD 위축을 로봇 +Z, 앞축을 +X로 돌리고, 바닥 면 중심을 로봇 원점에 둔다.
- occt-import-js는 어셈블리 계층을 **최상위 컴포넌트 한 단계까지만** 노드로 준다. 그 아래 서브어셈블리는 솔리드 목록으로 평탄화되고, 이름 없는 솔리드는 `노드 이름 + 순번`이 된다. 더 깊은 계층이 필요하면 OCCT XCAF를 직접 순회하는 다른 빌드가 필요하다.
- 네이티브 STEP 변환기(`native/step-converter`, 메인 쪽은 `src/main/stepConverter.ts`):
  - occt-import-js 0.0.23의 C++ 가져오기 코드와 OCCT 7.6.1을 고치지 않고 빌드하고, `src/main.cpp`가 같은 순서로 결과를 쓴다(SBSTEP01: 메시 배열들 + 끝의 JSON). GCC 13은 `<cstdint>` 누락이라 C++ 파일만 `-include cstdint`로 빌드한다. 빌드는 `scripts/build-step-converter.mjs`가 태그를 얕게 받아 커밋을 확인한 뒤 CMake로 하고, 결과를 `resources/step-converter/<platform>-<arch>/`에 둔다(gitignore). 64비트(x64·arm64)만 만든다. 빌드한 실행 파일의 CPU가 폴더 이름과 다르면 실패한다(Windows의 기본 개발자 프롬프트는 x86이라 그때는 Ninja 대신 Visual Studio 생성기에 CPU를 지정). 배포 앱에는 electron-builder의 OS별 `extraResources`로 대상 OS·CPU용 하나만 들어간다(`${platform}`은 빌드하는 PC의 OS라 쓰지 않는다).
  - 배포(`.github/workflows/step-converter.yml`): 변환기 소스가 바뀌어 main에 들어오면 CI가 Windows x64용을 빌드·검증해 Release `step-converter-<소스 해시 16자리>`에 실행 파일과 `SHA256SUMS`를 올린다(PR에서는 빌드·검증과 아티팩트만). 소스 해시는 `scripts/step-converter-source.mjs`가 version.json·CMake·`native/step-converter/src`·빌드 스크립트의 내용(CR 뺀 것)으로 계산한다. 결과를 바꿀 수 있는 파일을 추가하면 그 목록(`SOURCE_PATHS`)과 워크플로의 `paths`에 넣는다.
  - 받기(`scripts/fetch-step-converter.mjs`)는 지금 작업 폴더의 소스 해시로 Release를 찾고, SHA-256·실행 파일 CPU(이 PC용이면 `--version`까지)를 확인한 뒤 넣는다. 빌드·받기는 실행 파일 옆 `source.json`에 소스 해시를 남기고, 받기는 같은 해시면 다시 받지 않는다(직접 빌드한 것도 덮어쓰지 않음). 그 소스의 Release가 없으면(변환기 소스를 고친 뒤 main에 들어가기 전) 직접 빌드하라고 알린다. `--optional`(`pnpm build:win`)로 받지 못하면 남아 있던 다른 소스의 실행 파일을 지운다. 앱은 `--version`(version.json)만 확인하므로, 지우지 않으면 오래된 main.cpp로 만든 변환기가 설치 파일에 들어간다.
  - 앱은 처음 쓸 때 `--version`으로 실행되는지·같은 소스인지 확인하고, 아니면 WASM으로 읽는다. 변환은 한 번에 하나씩(대기 중이면 queued), STEP 내용은 캐시 키 해시와 함께 표준 입력으로 흘려보낸다(두 번 읽다 파일이 바뀌어 다른 내용이 그 키로 캐시되지 않게). OCCT 환경 변수(CSF_* 등)는 넘기지 않는다. 출력은 `userData/step-convert/`에 쓰고 읽은 뒤 지운다.
  - 변환기는 stderr에 `phase`, `progress`, `warning untranslated`, 마지막에 `result <ok|readFailed|outOfMemory|failed>` 줄을 쓴다. 앱은 result 줄로 결과를 판단한다(없으면 비정상 종료). 네이티브 실패(메모리 부족 등) 뒤에는 WASM으로 다시 읽지 않는다(실행 파일이 없거나 실행되지 않을 때만 WASM).
  - 메모리 한도로 일부 메시가 빠졌거나 OCCT가 엔티티를 건너뛴 결과는 캐시하지 않는다. 엔티티를 건너뛰면 솔리드가 통째로 빠져 뒤 메시 순번이 밀리므로, 프로젝트를 열거나 다시 읽을 때는 그 결과를 등록하지 않고 실패로 알린다.
  - CAD 형상을 등록할 때 그 CAD의 이전 형상 id 중 새 결과에 없는 것은 지운다(다시 찾기 뒤 이전 파일 모양이 남지 않게). 형상 id 방식은 읽기 시작할 때의 CAD 정보로 정한다.
- 불러오기 진행은 `cad/importStore.ts`가 센다(한 번에 하나, [STEP 불러오기]·드롭·다시 찾기·다시 불러오기를 막음, 창을 닫을 때 확인). 진행 알림은 단계(`importPhase.*`)·진행률·경과 시간·[취소]를 보인다(`noticeStore`의 `startedAt`·`phase`·`cancellable`, 취소 처리기는 스토어 밖). 캐시에 없는 100 MB 넘는 파일은 시작 전에 묻는다(드롭 묶음당 한 번, 네이티브가 없으면 실패할 수 있다고 알림).
- OCCT WASM 때문에 `index.html` CSP의 script-src에 `'wasm-unsafe-eval'`이 있다. 렌더러 워커는 ES 모듈 형식으로 번들한다(`electron.vite.config.ts`의 `worker.format`). STEP 테스트는 occt-import-js 패키지에 들어 있는 CAx-IF 샘플(`node_modules/occt-import-js/test/testfiles/`)을 쓴다.
- 단축키(`EditorLayout`, 키 → 명령 대응과 처리 순서는 `editor/shortcuts.ts`의 순수 함수 `shortcutCommand`, 메뉴·툴팁에 붙는 단축키 글자도 같은 표):
  - Ctrl/Cmd+S 저장, Ctrl/Cmd+O 열기, Ctrl/Cmd+Z 실행 취소, Ctrl/Cmd+Shift+Z·Ctrl+Y 다시 실행(입력칸 안에서는 입력칸의 실행 취소).
  - F는 선택한 오브젝트에 카메라 맞추기(여러 개면 전체, 하이어라키 더블클릭, 임포트 직후도 같은 동작), Delete/Backspace는 선택 삭제(CAD 루트를 지우면 다른 그룹으로 옮긴 그 CAD의 파트도 함께 지워지므로 그때만 확인을 묻는다), Q/W/E는 손·이동·회전 도구, X는 핸들 축 전역/로컬 전환.
  - Unity와 같은 하이어라키 명령(`editor/sceneCommands.ts`): Ctrl+Shift+N 빈 그룹(Create Empty, Unity의 Default Parent 자리는 활성 오브젝트의 로봇), Alt+Shift+N 활성 오브젝트의 자식, Ctrl+Shift+G 선택을 묶는 부모(Create Empty Parent), F2 이름 바꾸기(하나만 선택했을 때). 새 그룹은 바로 이름 바꾸기 상태다. 기본 이름은 `Group`, `Group (1)`…이다(Unity의 `GameObject` 대신. 이름이 곧 Java 클래스가 되므로).
  - Unity와 같은 선택·이동 명령: Ctrl+A 전체 선택(검색 중이면 결과만), Ctrl+X 잘라내기(씬은 붙일 때 바뀐다, 행이 흐려짐), Ctrl+V 활성 오브젝트 다음 형제로·Ctrl+Shift+V 자식으로 붙여넣기(이동 규칙 `moveRejection`을 따르고, 안 되면 이유를 알린다), 메뉴의 Select Children(하위 전체). 복사·복제(Ctrl+C·D)는 없다(CAD 파트는 CAD에서 온다). 잘라낸 것은 `editorStore.cutIds`(보기 상태)다.
  - 검색(Ctrl+F, Unity 하이어라키 검색칸): 이름과 장치 이름(구성 이름)으로 찾아 계층 없이 문서 순서로 보이고(상위 경로를 함께), Esc로 지운다. 아래 화살표로 첫 결과로 간다. 검색 중에는 끌어 옮기지 않는다. 검색어를 지우면 선택을 트리에 펼친다(`hierarchyTree.ts`의 `searchRows`).
  - 보이기·숨기기(`editor/sceneVisibility.ts`, Unity Scene Visibility): 행의 눈 아이콘(하위 전체, Alt+클릭은 그 오브젝트만), H(선택), Shift+H(고립 보기, 씬 뷰 위 [나가기]). 화면에서만 숨기는 보기 상태라 씬 문서·실행 취소·저장에 넣지 않고, 프로젝트를 열면 버린다. 숨긴 것은 그리지 않고 씬 뷰에서 클릭되지 않는다(하이어라키에서는 고를 수 있다). 숨김은 오브젝트마다 따로다.
  - 하이어라키 행 우클릭 메뉴는 Unity 순서(잘라내기, 붙여넣기, 자식으로 붙여넣기 | 이름 바꾸기, 삭제 | 하위 모두 선택 | Create Empty(그 행의 자식), Create Empty Parent)다. Shift+F10·메뉴 키로도 연다. 행은 위/아래(Shift로 범위)·왼쪽/오른쪽(접기·펼치기)으로 움직인다.
  - 하이어라키 드래그 앤 드롭(`editor/hierarchyDnd.ts`): 행 위·아래 4분의 1은 형제 앞·뒤, 가운데는 자식, 빈 공간은 로봇의 마지막 자식, 접힌 행 위에 머물면 펼친다. 내부 형식(`application/x-sandbot-object`)만 처리하고 파일 드래그는 창으로 올려 보낸다(막으면 Electron이 파일로 페이지를 옮긴다. 메인도 `will-navigate`를 막는다).
  - 창에 STEP 파일을 끌어다 놓아도 불러온다.
  - 문자 키는 `event.code`로 받는다(한글 입력 상태에서도 동작). 누르고 있어 반복되는 입력은 도구를 바꾸지 않는다.
  - 앱 안 대화상자·우클릭 메뉴·환경 설정 창·스크립트 선택창이 떠 있거나(`dialogStore.ts`의 `isModalOpen`) 비행 중(`editor/flyStore.ts`)이면 단축키와 파일 드롭을 무시한다. 핸들을 드래그하는 중(`isChangeOpen`)에는 실행 취소·삭제·도구 전환을 하지 않는다. 입력칸이나 `PanelFrame`의 `localKeys` 패널(인스펙터) 안에 포커스가 있으면 F·Delete·Q/W/E를 쓰지 않는다. Ctrl+Z는 입력칸에 확정하지 않은 글자가 있을 때만 입력칸에 맡긴다.
- 파일 접근은 메인 프로세스만 한다.
  - IPC 채널 이름과 `window.api` 타입(`SandbotApi`)은 `src/shared/ipc.ts`에 있다. preload(`src/preload/index.ts`)가 이를 구현해 노출하고, 메인(`src/main/project.ts`)이 대화상자와 파일 읽기·쓰기를 처리한다.
  - 렌더러는 fs를 직접 쓰지 않는다. 경로 계산(`relativePath`, `resolvePath`)과 드롭한 파일의 경로(`getPathForFile`)는 preload가 Node `path`·`webUtils`로 처리한다.
  - STEP은 `readStepCached`로 읽는다(STEP 확장자만). 메인 프로세스(`src/main/meshCache.ts`)가 내용을 SHA-256으로 해시해 캐시에 변환 결과가 있으면 그것을, 없으면 파일 내용을 돌려준다(네이티브 변환기를 쓸 때는 내용 없이 해시만 스트림으로). 파일 크기도 함께 준다. 렌더러(`cad/importStep.ts`의 `loadStepModel`)가 워커로 변환한 뒤 `storeMeshCache`로 저장한다(v8 직렬화, 2 GB를 넘으면 오래 쓰지 않은 것부터 지움). 저장은 형상을 먼저 보여 준 뒤 한다. 캐시에서 읽은 타입 배열은 배열마다 제 크기 버퍼로 복사해 보낸다(contextBridge가 배열마다 바탕 버퍼 전체를 복사하므로). 캐시 값은 `isImportedModel`로 확인하고 쓴다.
- 프로젝트 흐름은 `project/projectActions.ts`에 있다.
  - 열기는 `project.json`을 검증(`project/projectFile.ts`)한 뒤 씬을 바꾸고, CAD를 상대 경로 → 절대 경로 순으로 찾는다(`statStepFile`, 내용은 읽지 않음). 고친 경로까지 연 상태(`savedObjects`)로 삼고 실행 취소 기록을 다시 켠 뒤, 바쁨(busy)을 풀고 CAD 형상을 하나씩 읽는다. 그동안에도 편집·저장할 수 있다(형상은 씬 문서를 바꾸지 않는다). 다른 프로젝트를 열면 읽던 것을 취소하고(`cancelAllImports`), 늦게 끝난 결과는 `projectStore.session`으로 버린다.
  - CAD 형상 상태(`projectStore.cadStatus`: loading·failed·cancelled)를 인스펙터가 보여 주고, 실패·취소면 [다시 불러오기](저장된 경로)를 띄운다. 못 찾은 CAD는 [파일 다시 찾기]로 연결한다. 다시 찾기는 새 파일을 다 읽었을 때만 경로를 바꾼다.
  - 저장할 때 프로젝트가 없으면 폴더를 고르게 한다.
  - 씬 변경을 구독해 dirty를 표시한다(창 제목 `*`). 프로젝트를 여는 동안의 변경과, 프로젝트 없이 임시 씬만 만진 것은 제외한다.
  - 창을 닫을 때 dirty거나 STEP을 불러오는 중이면 메인 프로세스가 닫기를 막고 렌더러에 묻는다. 렌더러가 i18n 대화상자를 띄운 뒤 `confirmClose`로 닫는다.
  - 앱을 시작하면 마지막 프로젝트(`sandbot:lastProject`)를 다시 연다.
- 스크립트 연결(`SceneObject.scripts`: `{path, className}`, `PROJECT_VERSION` 5)은 Unity의 스크립트 컴포넌트처럼 인스펙터의 컴포넌트 목록 안 카드다(`editor/scripts/`). Add Component의 "TeamCode 스크립트…"가 검색 선택창을 열고, 카드의 "Script: Lift.java" 줄을 더블클릭하거나 [열기]로 외부 편집기에서 연다. 연결은 탐색용이라 생성 코드는 참조하지 않는다. 파일을 못 찾으면 같은 클래스나 같은 파일 이름이 하나뿐일 때만 [다시 연결]을 보인다(자동으로 바꾸지 않음). project.json의 허용되지 않는 스크립트 경로는 열 때 버리고 알린다(파일 전체를 거부하지 않음).
  - TeamCode Java 목록은 메인(`src/main/teamCodeJava.ts`)이 `TeamCode/src/main/java`만 훑어 준다(점 폴더·`build` 제외, 5000개 한도, 진짜 링크·정션은 건너뛰고 Windows 재분석 지점은 lstat로 다시 분류). 렌더러(`java/javaIndex.ts`)는 프로젝트를 열 때, 저장 뒤, 창 포커스 때(300 ms 묶음, 바쁠 때 건너뜀) 다시 읽고, 다른 세션·루트의 늦은 결과는 버린다. 클래스 이름은 파일 이름이다.
  - 튜닝 값(`src/shared/java/tunables.ts`, 렌더러 `java/`)은 FTC Dashboard 0.6.0(`FtcDashboard.addConfigClasses`·`ReflectionConfig`)과 같은 규칙으로 고른다: `@Config`가 있고 `@Disabled`가 없는 클래스(중첩 포함, 묶음 이름은 `@Config` 값 또는 단순 이름)의 public static non-final 필드(`getFields`처럼 같은 파일의 상위 클래스 필드도, 이름이 겹치면 Dashboard처럼 가장 위 상위 클래스의 것). 형식은 boolean·int·long·float·double(박싱 포함)·String이고, 같은 파일의 `new T()` 객체(Road Runner 1.0의 `PARAMS`)는 펼친다. 리터럴 하나인 초기값만 고칠 수 있다. 식·enum·초기값 없음·줄바꿈이 든 문자열(한 줄 입력칸이 지운다)은 읽기 전용이고, 리터럴 밖 `\u`가 있으면 파일 전체가 읽기 전용이다. 실행 때 값이 초기값과 다를 수 있는 필드도 읽기 전용(`initializedInType`)이다: 선언한 클래스나 그 아래 클래스의 생성자(빈 것 제외)·인스턴스 초기화 블록이 있는 객체의 자식, 그리고 클래스를 초기화할 때 도는 코드(묶음 클래스부터 선언 클래스까지의 static 블록·static 필드 초기값, 거기서 부르는 같은 클래스의 static 메서드, `new T(…)` 싱글턴의 생성자)가 대입하는 필드(객체 필드는 멤버를 읽기만 하는 것이 아니면). 새 리터럴 형식은 `javaLiteral.ts`의 `formatTunableLiteral`이 정한다(long은 `L`, float은 `f`, 문자열에 `\u`를 쓰지 않음, 문자열은 class 파일 한도 65535바이트). 실행 취소로 되돌린 값은 디스크의 원래 글자(`0`, `0x10`, `- 5`)를 그대로 다시 쓰므로, 저장 → 실행 취소 → 저장하면 파일이 바이트 그대로 돌아간다. 인스펙터는 다른 형식으로 쓴 리터럴을 실행 때 값으로 보인다(long의 `0xFFFFFFFF`는 -1, double의 `0.1f`는 0.10000000149011612). 한계: 다른 파일의 상위 클래스 필드와 다른 파일 형식의 객체는 보이지 않고, 다른 클래스가 대입하는 것·메서드 참조·인스턴스 메서드는 따라가지 않는다. 저장 순서는 project.json → 튜닝 값 → 생성 코드이고(튜닝 값은 하드웨어 검증 오류에 막히지 않는다), 충돌·실패가 있으면 `saveProject`가 false를 돌려 창 닫기·열기를 멈춘다. 저장하지 않은 값이 있는데 지금 고칠 수 없는 칸(파일을 쓸 수 없게 됨, 식으로 바뀜, 필드가 사라짐)은 그 값과 파일 값, [파일 값 따르기](실행 취소 가능)를 보인다. 창 포커스 때 다시 읽은 파일 값이 편집할 때 본 값과 다르면 ⚠ 파일 값을 보이고 [SandBot 값 쓰기]·[파일 값 따르기]로 고르게 한다. Java 파일은 메인에서 `Buffer.toString('utf8')`로 읽는다(BOM을 남겨 오프셋이 쓰기와 같다, TextDecoder 금지). 값은 static이라 같은 파일을 연결한 오브젝트끼리 같다.
  - 외부 스크립트 편집기(Unity Preferences > External Tools)는 툴바의 [환경 설정] 창에서 고른다. 확장자로 열기(`shell.openPath`, 기본값), 이 PC에서 찾은 Android Studio·IntelliJ IDEA·VS Code(줄 번호로 열기), 찾아보기 + 인자 템플릿(`$(File)` `$(Line)` `$(Column)` `$(ProjectPath)`). 설정은 실행 파일 경로를 담으므로 개인 설정 중 이것만 렌더러 localStorage가 아니라 메인의 `userData/external-editor.json`에 둔다. 렌더러는 고르기만 하고 경로를 보내지 않는다. 메인(`src/main/externalEditor.ts`)은 템플릿을 셸 없이 나누고 `.exe`만 실행한다(`.bat`·`.cmd`는 Node가 셸 없이 실행하지 못한다). JetBrains는 프로젝트 루트를 먼저 넘겨 LightEdit 대신 열린 프로젝트에서 연다. 확장자로 열기·`$(Line)` 없는 템플릿은 줄 번호를 넘기지 못한다(`openJavaFile`이 `lineIgnored`로 알리고, 렌더러가 세션에 한 번 알린다).
- 사용처(`java/usageIndex.ts`, `java/usages/`, `editor/usages/`)는 Android Studio의 Find Usages처럼 생성 하드웨어 필드·상수·형식을 javac가 묶는 곳(코드)과 구성 이름 문자열(이름으로)을 찾는다.
  - 수집: 메인의 `readJavaSources`가 목록(javaIndex)의 파일을 읽어 준다(열거나 저장한 루트만, 경로 규칙, 256 KB 넘는 파일은 tooLarge, 한 번에 256개·4 MB, 동시 2개). 렌더러는 크기·수정 시각(stamp)이 바뀐 파일만 다시 읽는다. 읽기 오류(failed: 잠금, 오프라인 파일 등)가 난 파일은 크기·시각이 같아도 다음 읽기(새 목록, 열기·저장 끝, 목록이 그대로인 창 포커스 때도 javaIndex `listedAt`으로)에 그 파일만 다시 읽는다(받지 않는 경로는 바뀔 때까지 읽지 않는다).
  - 워커(`usageWorker.ts`, 논리는 `usageWorkerCore.ts`, ES 모듈)가 파일마다 씬과 관계없는 사실(형식 개요, 범위, 연쇄, 형식 사용, 문자열, `usageFacts.ts`)을 만들어 갖고(파일 글자를 잘라 두지 않고 intern으로 복사), 씬에서 만든 작은 기호표(`usageSymbols.ts`, buildCodeScopes)와 맞춘다(`usageResolve.ts`). 이름을 바꾸면 파일을 읽지 않고 맞추기만 한다(200 ms 묶음).
  - 이름 풀이는 Java 8 JLS 순서다: 형식 매개변수 → 감싸는 클래스의 멤버 형식(상속 포함) → 파일·단일 import·단일 static import → 같은 패키지 → on-demand(후보가 하나일 때만) → 전체 이름. 변수는 지역 → 클래스 필드(상속, private 제외, package-private는 같은 패키지) → 잡힌 지역 → 바깥 클래스 → static import → 형식 → 패키지 순이고 변수가 형식을 가린다. 연쇄에서는 마지막 생성 멤버만 사용처다. import는 보이지 않는다(풀리지 않을 때만). 깨진 단일 import(생성 코드에서 사라진 이름)는 javac처럼 범위에 들어가지 않아 같은 패키지·on-demand(변수는 static on-demand)로 이어서 찾고, 아무 데도 없을 때만 쓰는 자리마다 알린다. 그렇게 찾은 팀 클래스에 없는 멤버는 상속 계층을 모두 알 때 그 import의 키에 둔다.
  - 문자열은 두 등급이다. 찾기(hardwareMap 식이 받는 쪽이나 다른 인자에 있는 호출, 이름이 Name으로 끝나는 메서드, 그런 인자로 쓰는 String 상수의 초기값)는 세고, 나머지 같은 글자는 접어 두고 세지 않는다. 앞뒤 공백을 빼고 비교한다(SDK가 trim한다). 어느 로봇에도 없는 찾기 이름은 로봇 카드에 접어 두고 세지 않는다.
  - 생성 코드에 없는 이름(생성 형식 받는 쪽의 없는 멤버, 생성 패키지의 없는 형식)과 구성에 없는 찾기 이름은 상태 없이 계산한다. 마지막으로 열거나 생성 코드를 맞춘(synced) 저장의 씬(baseline, `projectActions`의 `generatedObjects`)과 비교해 바꾼 카드에 "이전 이름"으로 붙이고(옮겨서 클래스를 잃은 그룹은 지금도 있는 상위 범위에서 그 그룹의 이름으로), 로봇 카드는 그 로봇의 것을 모두 모은다. 생성이 막히거나 실패한 저장은 디스크의 생성 코드·구성을 바꾸지 않으므로 baseline을 옮기지 않는다. 저장해 생성 코드를 맞춘 뒤 깨지는 곳이 있으면 경고 알림 하나(교체)를 띄운다(구성에 없는 찾기 이름은 이 프로젝트를 연 뒤 생성 코드를 맞춘 저장들이 없앤 이름만 세고, 다시 넣으면 뺀다. 바꾼 것 없이 다시 저장해도 남는다. 생성이 막히거나 실패했으면 띄우지 않고, 다음에 생성 코드를 맞춘 저장이 baseline과 비교해 알린다). 이 확인은 저장 뒤 목록을 다시 읽어 바뀐 파일(저장이 쓴 튜닝 값, 저장 직전 밖에서 고친 파일)을 워커에 넘긴 다음 저장한 씬의 기호로 맞춘다(그사이 이름을 또 바꿔도 저장한 씬으로, 스토어의 결과는 지금 씬의 것으로 둔다). 그 읽기가 끝까지 가지 못하면(TeamCode 없음, 읽기 실패, 워커 멈춤) 이전 알림을 둔다. 실행 취소로 이름을 되돌리면 상태 없이 사라진다.
  - 실행 시점: 프로젝트를 열고 목록이 준비되면 전부, javaIndex revision이 바뀔 때마다 바뀐 파일만, 씬 기호가 바뀌면 맞추기만. refreshJavaIndex의 묶음에 넣지 않는다(튜닝 값 다시 읽기를 기다리게 하지 않음). 다른 프로젝트를 열면 워커를 끝낸다.
  - 카드: 장치·그룹·로봇 카드의 접힌 "사용처"(코드 N · 이름 N · ⚠ N, 파일별 묶음, 한 번 누르면 고르고 더블클릭·Enter로 그 줄 열기, Unity Console과 같음). 펼침 상태는 메모리에만 둔다. 다시 찾아 포커스한 행이 사라지면 옆 행·파일 행·머리줄로 포커스를 옮긴다(`<body>`로 떨어지면 Delete·F·Q/W/E가 씬에 간다, `editor/usages/focusRestore.ts`). 하위 장치 수는 자리 수다(같은 포트의 모터·데드휠이 함께 가진 찾기 문자열은 한 번). 키마다 200곳 한도로 자른 키는 맞추기가 자르기 전의 파일별 개수(`fileTotals`)를 넘겨, 잘린 파일도 정확한 개수와 '외 N곳'을 보인다(행을 하나도 받지 못한 파일의 것만 부분 끝에 남는다). 스크립트 카드의 "이 스크립트가 쓰는 하드웨어" 칩을 누르면 그 오브젝트를 고른다.
  - 정답표: `scripts/usage-oracle`(javac Tree API)이 `java/usages/__fixtures__/golden*.txt`를 만든다(JDK 11+, CI는 쓰지 않음, 말뭉치 해시가 머리에 있어 말뭉치가 바뀌면 테스트가 다시 만들라고 알린다). 말뭉치의 생성 클래스는 generateHardwareJava 출력과 같아야 한다(테스트가 확인). 차분 테스트는 코드 사용처가 정답표에서 받아들인 누락(`ACCEPTED_FN`)만 빼고 같아야 하고 거짓 양성이 없어야 한다.
  - 한계: Kotlin, 리플렉션, 제네릭 치환·제네릭 메서드 반환, 형식 없는 람다 매개변수, 조건식·대입식 받는 쪽, 지역 클래스 이름, 알 수 없는(SDK) 상위 클래스의 필드(없는 것으로 봄), 생성 로봇 클래스를 상속한 팀 클래스 안에서 받는 쪽 없이 쓴 이름과 상속 계층에 알 수 없는 형식이 있는 하위 클래스로 쓴 없는 이름(알리지 않음), `…sandbot.*`로 들여온 이름의 클래스 이름 바꾸기, 256 KB 넘는 파일, 리터럴 밖 `\u`가 있는 파일, 5000개 넘는 목록, 크기·시각이 같은 내용 변경(다시 열면 찾음)은 찾지 못하거나 다를 수 있다. 생성이 막힌 저장 뒤 닫은 프로젝트를 다시 열면 연 씬이 baseline이라, 디스크 구성에 남은 이전 구성 이름을 다음 저장이 "없앤 이름"으로 알리지 못한다(생성 코드에 없는 이름은 알린다).
- 진행·경고·오류 알림은 `editor/noticeStore.ts`로 띄우고, 하이어라키 위에 표시한다. 문구 키는 `notice.*`다.
- 하드웨어 컴포넌트는 `src/renderer/src/hardware/`에 있다.
  - 컴포넌트는 씬 오브젝트의 `components`(종류·장치 이름·허브·포트·속성)이고, 로봇별 생성 설정(클래스 이름, DS 구성 이름, Expansion Hub)은 로봇의 `hardware`다. 프로젝트 파일 `PROJECT_VERSION` 2에서 추가했고 v1도 읽는다. `PROJECT_VERSION` 4에서 group·`cadOrigin`·`codeClassName`을, 5에서 `scripts`를 추가했다.
  - 종류는 `catalog.ts`의 데이터로 정의한다(포트 종류, Java 타입·import, I2C 주소, 속성 정의). 인스펙터의 입력칸과 번역 키는 속성 정의에서 만든다. 카탈로그에서 나온 번역 키는 `t()` 타입 검사를 받지 못하므로 `labels.test.ts`가 ko·en에 키가 있는지 확인한다.
  - 저장(`saveProject`)하면 `generate.ts`가 검증(`validation.ts`) 후 컴포넌트가 있는 로봇마다 Java 하드웨어 클래스(`javaCodegen.ts`, 패키지 `org.firstinspires.ftc.teamcode.sandbot`)와 로봇 구성 XML(`configXml.ts`, `TeamCode/src/main/res/xml/sandbot_<클래스>.xml`)을 만든다. 메인 프로세스(`src/main/teamCode.ts`)가 내용이 바뀐 파일만 쓰고, 이번에 만들지 않은 이전 생성 파일은 지운다. 결과는 `projectStore.generation`과 알림으로 보여 준다.
  - 생성 Java의 주석은 팀이 Android Studio에서 읽으므로 영어로 쓴다. 주석에 넣는 이름은 `commentText`로 거른다(javac는 주석 안의 `\u`도 해석한다).
  - 메커니즘 그룹(`kind: 'group'`, 하이어라키의 Create Empty)은 생성 클래스 안의 `public static final class`가 된다(`robot.lift.liftLeft`, 상수는 `RobotHardware.Lift.X`). 범위 트리와 클래스·필드·상수 이름은 `codeScopes.ts`가 한 번 정하고 코드 생성과 검증이 같이 읽는다. 하드웨어가 없는 그룹은 클래스를 만들지 않는다. 그룹 클래스 이름은 `codeClassName ?? javaClassName(이름)`이고 ASCII(`^[A-Z][A-Za-z0-9]*$`)여야 한다(중첩 클래스는 `.class` 파일 이름이 된다). 예약 형식(`RESERVED_TYPE_NAMES`: 카탈로그 import·HardwareMap·String 등)과 같거나, 감싸는 클래스와 같거나, 형제끼리 대소문자만 다르면 오류다. 그룹 필드는 클래스 이름의 lowerCamel이다. 그룹이 없으면 출력이 바이트 단위로 같아야 한다(`generatedOutput.test.ts`의 파일 스냅샷).
  - 필드 이름은 장치 이름에서 만든다(`naming.ts`). 그룹 안에서도 같다(구성 이름 그대로). Java는 유니코드 글자를 식별자로 쓸 수 있으므로 한글 이름도 그대로 둔다. 숫자로 시작하면 `_`를 붙이고, 키워드와 `hardwareMap`은 뒤에 `_`를 붙인다. 상수 이름은 `generatedConstantNames`로 만들고, 겹치면 검증 오류다.
  - 구성 XML과 Java는 같은 장치 목록을 가져야 한다(`isInConfiguration`). 시리얼이 없어 XML에 넣지 않는 웹캠·Limelight는 Java에서 `tryGet`으로 null을 허용한다. `get`은 장치가 없으면 예외를 던져 클래스 전체를 못 쓰게 한다.
  - 오프셋 계산은 `mounting.ts`가 파트의 로봇 기준 위치로 한다. Pinpoint `setOffsets`는 X 포드의 옆 위치(왼쪽 +)와 Y 포드의 앞 위치(mm)다. OTOS `setOffset`은 SDK 샘플 규약(X 오른쪽 +, Y 앞 +, 반시계 +, in·deg)이고, Road Runner·Pedro Pathing은 자체 오프셋을 쓴다. OTOS 방향은 장착 각도 속성만 쓴다. CAD 파트의 회전은 CAD 파일 축의 정렬일 뿐 센서 방향과 관계없다. Limelight의 구성 XML 주소는 시리얼의 IP(Control Hub 주소)에서 마지막 자리를 1로 바꾼 값이다(SDK와 같음). 데드휠은 같은 번호 모터 포트의 장치 이름으로 엔코더를 읽는다.
  - 코드 단위 프로젝트 설정이 생기기 전까지 생성 코드는 SDK API가 받는 단위를 쓰고, 상수 이름에 단위를 붙인다(`_MM`, `_IN`, `_DEG`).
  - 검증 결과는 `sceneIssues.ts`가 씬마다 한 번 계산해 하이어라키(문제 표시, 상위 오브젝트에도 흐리게 표시)와 인스펙터(카드별·로봇별 목록)가 같이 쓴다.
- 인스펙터의 위치·회전은 부모 기준 로컬 값이다(Unity와 같음). CAD 루트 아래 파트의 부모 축은 CAD 파일의 축이라(Y-up CAD면 Y가 위) 인스펙터가 그 축을 알린다. 로봇 안 오브젝트에는 로봇 중심 기준 위치(`getTransformInFrame(…, 'robot')`)를 읽기 전용으로 함께 보여 준다.
- 인스펙터 입력칸(`TextField`, `NumberField`)은 Enter나 포커스 이동 때 확정한다. 확정 전 초안이 있으면 `useDraft`가 `projectStore.pendingEdit`를 켜고, 창을 닫을 때 초안을 먼저 확정한 뒤 저장 여부를 묻는다. 인스펙터 내용은 선택한 오브젝트 id로 key를 걸어, 선택이 바뀌면 초안을 버린다.
- 표시 단위는 `units/`에 있다. `units.ts`가 변환·입력 파싱(`parseLength`는 `12in`, `30 cm`, `6"`, `1ft`를 받고 단위가 없으면 표시 단위로 읽는다, `parseAngle`은 °·rad)·형식을 맡고, `unitStore.ts`가 개인 설정과 첫 실행 질문을 맡는다. 길이를 보여 주거나 받는 입력칸은 `NumberField`의 `parse`로 이 함수들을 쓴다. 하드웨어 카드의 오프셋 계산값은 생성 코드 값이라 코드 단위(mm·in)로 보여 준다.
- 실행 취소(`editor/history.ts`)는 sceneStore 변경을 구독해 이전 문서 `{objects, tunables}`를 쌓는다(최대 200단계). `tunables`는 디스크 값과 다른 필드만 `{value, base}`로 둔다(디스크와 같아지면 지운다). 저장해 파일에 쓰면 `rewriteTunableHistory`로 기록 전체를 새 디스크 값 기준으로 옮긴다(rebase, 항목이 없던 스냅샷은 쓰기 전 디스크 글자를 되돌릴 값으로 갖는다). 그래서 저장한 뒤 실행 취소하면 dirty가 되고, 다시 저장하면 파일 값이 원래 글자 그대로 되돌아간다. 값과 디스크 글자는 공백·주석을 뺀 글자로 비교한다(`sameLiteralKey`). 튜닝 값의 dirty는 `tunables`가 비어 있지 않은 것이다. 핸들 드래그는 `beginChange`/`endChange`로 한 단계로 묶고, 드래그 도중 선택·도구가 바뀌면 `TransformHandles`가 묶음을 닫고 카메라 조작을 다시 켠다. 프로젝트를 여는 동안에는 기록과 실행 취소를 멈추고(`suspendHistory`), 씬을 바꿨으면 기록과 이전 형상을 지운다. CAD 다시 찾기처럼 형상 자체가 바뀌는 수정은 `rewriteHistory`로 기록 전체에 적용해 실행 취소로 경로만 되돌아가지 않게 한다. 선택은 기록하지 않고, 되돌린 씬에 없는 오브젝트의 선택만 푼다. 저장한 씬과 같아지면 dirty를 끈다(`projectActions`의 `savedObjects`).
- 씬 뷰 카메라는 `editor/scene/EditorCameraControls.tsx`다. drei OrbitControls를 그대로 두고, 누를 때마다(캡처 단계) 버튼 배정을 바꿔 궤도·팬·줌을 쓰고, 우클릭 둘러보기와 WASD/QE 비행은 직접 처리한다. 다른 코드(포커스, 축 표시 클릭)는 계속 OrbitControls의 `target`을 중심점으로 쓴다. 우클릭을 놓을 때의 contextmenu는 빗나간 클릭(선택 해제)으로 치지 않는다. Alt+드래그는 기즈모 위에서 시작해도 카메라만 움직이도록 그 동안 핸들(`getActiveGizmo`)을 끈다. `autoHideMenuBar`를 켜면 Windows·Linux에서 Alt가 숨긴 메뉴 막대를 열어 Alt+드래그를 방해하므로, 끄고 `setMenuBarVisibility(false)`로 숨긴다(메뉴 단축키 F11 등은 남는다). 비행 키와 문자 단축키는 한글 입력 상태에서도 동작하도록 `event.code`(키 위치)로 받는다. Linux 데스크톱 환경에 따라 Alt+드래그가 창 이동으로 먼저 잡힐 수 있다. 포커스·축 표시 클릭의 이동과 휠 줌은 `editor/scene/cameraMotion.ts`가 진행한다(OrbitControls의 휠 줌은 쓰지 않음, 캔버스를 누르면 진행 중인 이동은 멈춤). 마우스 드래그(둘러보기·궤도·팬·Alt+오른쪽 줌)도 직접 받아 움직일 양을 `addCameraInput`으로 쌓고 프레임마다 남은 양의 일부를 적용한다(`stepCameraInput`, 약 50 ms 감쇠, 반 화소 아래는 한 번에. 이벤트 박자가 고르지 않아도 고르게 움직이고 합은 마우스와 같다. Unity는 감쇠가 없다). OrbitControls는 중심점과 터치 조작만 맡는다(마우스 버튼은 모두 끔). 이동량은 `clientX` 차이로 센다(`movementX`는 HiDPI Windows에서 물리 화소이고, 합성 이벤트에서는 `movementX`·`screenX`가 0이다). demand 모드에서 쉬다 그린 첫 프레임의 delta는 쉰 시간이라 1/60초로 본다(`frameStep`, 비행 시작이 튀지 않게). CAD 메시 재질은 (색, 꼭짓점 색, 강조)마다 하나를 함께 쓴다(`SceneObjectsView`, 메시마다 재질을 바꾸지 않게).
- IMU 컴포넌트가 있는 오브젝트(또는 그 상위)를 선택하면 씬에 방향을 그린다(`editor/scene/ImuIndicators.tsx`, 로고 보라·USB 주황, 축 색과 겹치지 않게).
- drei `TransformControls`는 내려갈 때 three-stdlib 인스턴스를 해제하지 않으므로(캔버스 리스너가 남는다) `TransformHandles`가 직접 `dispose()`한다. 개발 모드(`pnpm dev`)의 React StrictMode는 effect를 정리했다가 같은 인스턴스로 곧바로 다시 실행하므로, 해제는 미뤘다가 다시 붙으면 취소한다(바로 해제하면 핸들이 보이기만 하고 끌리지 않는다).
- effect 정리에서 외부 객체를 해제·변경할 때는 StrictMode의 정리→재실행을 견뎌야 한다. 배포 빌드(`pnpm build`)로만 확인하면 이런 문제가 드러나지 않으므로, 씬 상호작용은 `pnpm dev`에서도 확인한다.
- 이동·회전 핸들(`editor/scene/TransformHandles.tsx`)은 선택한 오브젝트가 아니라 대리 객체에 붙는다. 대리 객체는 "오브젝트 위치 + 핸들 축 방향(전역이면 필드 축, 로컬이면 오브젝트의 월드 회전)"을 갖고, 드래그한 변화량을 오브젝트에 옮긴다. 그래야 부모가 회전해 있어도 전역 축으로 끌 수 있다. 핸들 클릭이 R3F에서는 빗나간 클릭(선택 해제)으로 처리되므로 `markHandleInteraction`으로 막는다.
- 오른쪽 위 축 표시(`ViewGizmo`)는 drei `GizmoHelper`의 HUD만 쓰고 축은 직접 그린다. drei `GizmoViewport`는 회전된 축을 클릭했을 때 시점 방향을 잘못 계산한다.
- 큰 CAD(goBILDA 예제: 메시 1761개, 삼각형 860만 개)를 위해, 씬 뷰·하이어라키·`subtreeIds`는 자식을 `childrenInDocument`(불변 씬 문서마다 한 번 만드는 부모→자식 목록)로 찾는다. CAD 메시는 `scene/meshBvh.ts`의 `cadMeshRaycast`(three-mesh-bvh, `indirect`라 인덱스 순서를 바꾸지 않음)로 클릭을 검사하고, BVH는 형상을 등록할 때 쉬는 시간에 미리 만든다.
- 씬 뷰는 @react-three/fiber + drei다. `Canvas`가 `frameloop="demand"`이므로 R3F 바깥에서 Three.js 객체를 직접 바꾸면 `invalidate()`를 호출해야 다시 그려진다. drei 컴포넌트 중 CDN에서 리소스를 받는 것(`Environment` 프리셋, `Text` 기본 폰트 등)은 `index.html`의 CSP에 막힌다.
- i18n은 `src/renderer/src/i18n/`(react-i18next)에 있다.
  - `locales/ko.ts`가 키 구조의 기준이다. `en.ts`는 같은 타입(`Messages`)을 따라야 하고, `i18next.d.ts`가 `t()` 키를 타입 검사한다. 따라서 키 오타나 누락 번역은 `pnpm typecheck`에서 실패한다.
  - 문자열을 추가할 때는 `ko.ts`와 `en.ts`에 같은 키를 넣고 `t('그룹.키')`로 쓴다.
  - 언어 이름(`LANGUAGE_NAMES`)과 제품명 "SandBot"은 의도적으로 번역하지 않는다.
- 개인 UI 설정(언어 `sandbot:language`, 길이 단위 `sandbot:lengthUnit`, 패널 크기 `react-resizable-panels:editor-main`, 마지막 CAD 방향 `sandbot:cadAlignment`, 마지막 프로젝트 `sandbot:lastProject`)은 렌더러 `localStorage`에 저장된다. 외부 스크립트 편집기만 메인의 `userData/external-editor.json`이다(실행 파일 경로라서).
- 렌더러에서만 쓰는 라이브러리는 Vite가 번들하므로 `devDependencies`에 넣는다. `dependencies`는 main/preload가 런타임에 쓰는 것만 둔다(electron-builder가 패키지에 포함).
- ESLint의 `react/no-unknown-property`는 R3F 요소 속성을 오인해서 껐다. JSX 속성은 TypeScript가 검사한다.
- 테스트는 `src/**/*.test.{ts,tsx}`에 소스와 나란히 두고 `vitest`에서 명시적으로 import한다(globals 미사용). Vitest는 electron-vite 설정이 아니라 `vitest.config.ts`를 읽는다.
- pnpm은 11을 쓴다(`package.json`의 `packageManager`). pnpm 설정은 `pnpm-workspace.yaml`에 둔다(pnpm 11은 `package.json`의 `pnpm` 필드를 읽지 않는다).
  - 설치 스크립트가 있는 의존성은 `allowBuilds`에 실행 여부(`true`/`false`)를 적는다. 정하지 않은 스크립트가 있으면 설치가 실패한다.
  - pnpm 11은 배포된 지 하루가 안 된 패키지를 lockfile에 두면 설치를 막는다(`minimumReleaseAge`). 의존성을 올릴 때 너무 새 버전이 잡히면 하루 지난 버전으로 지정한다.
- `.gitignore`의 Java 항목은 원래 템플릿에서 온 것이다. 나중에 만들 JVM 사이드카에 필요하므로 유지한다.
- `.mcp.json`은 sequential-thinking MCP 서버를 등록한다.
