# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

SandBot은 Unity 에디터 스타일의 FTC(FIRST Tech Challenge) 로봇 개발 도구다. 씬 뷰에 팀의 로봇 CAD(STEP)를 불러온다. 파트를 선택하면 인스펙터에서 하드웨어 컴포넌트를 설정하고, 동작 로직은 Java 스크립트로 작성한다. 작성한 코드는 필드 위 운동학 시뮬레이션으로 확인한다.

**현재 상태:** electron-vite `react-ts` 템플릿으로 만든 최소 골격만 있다. 렌더러 화면(`App.tsx`, `Versions.tsx`)은 템플릿 데모이고 영어 문자열이 하드코딩되어 있으므로, 에디터 UI를 구현할 때 통째로 교체한다. 아래 내용은 사용자와 합의한 설계 결정이며 구현은 이를 따른다.

## 확정된 설계 결정

| 항목        | 결정                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 플랫폼      | Electron 데스크톱 앱 · TypeScript · React · Three.js · Monaco 에디터                                                                                                       |
| 인스펙터    | Unity 방식. 파트에 하드웨어 컴포넌트(DcMotorEx, Servo, 센서 등)를 붙여 속성(설정 이름, 허브/포트, 방향, 런 모드 등)을 편집하고, 동작 로직은 붙어 있는 Java 스크립트로 작성 |
| CAD         | STEP(.step/.stp)만 지원. 어셈블리 계층을 유지해 파트별 선택이 가능해야 함. OpenCascade WASM(예: occt-import-js)으로 로드                                                   |
| 시뮬레이션  | 운동학 수준. 드라이브트레인/메커니즘을 OpMode 코드와 게임패드로 구동하고, 충돌·물리는 단순화                                                                               |
| OpMode 실행 | JVM 사이드카 + 가짜 FTC SDK. 팀의 실제 Java OpMode를 수정 없이 실행                                                                                                        |
| 배포        | 팀의 FtcRobotController 프로젝트 `TeamCode`에 Java 파일을 직접 저장. 빌드/설치는 Android Studio에서 함 (도구 내 ADB 배포, OnBot Java 업로드는 범위 밖)                     |
| 언어        | UI는 i18n(한국어 기본, 영어). CLAUDE.md·코드 주석·커밋 메시지는 한국어                                                                                                     |
| 툴체인      | pnpm · electron-vite(빌드) · electron-builder(패키징) · ESLint + Prettier · Vitest                                                                                         |
| 단위        | 세 층으로 분리. 내부(저장·계산)는 미터·라디안으로 고정. 표시·입력 단위는 사용자 개인 앱 설정. 생성 Java 코드의 단위는 프로젝트(팀) 설정                                    |

## 아키텍처

세 개의 프로세스로 구성한다.

- **Electron main**: 파일 시스템 접근, 프로젝트 열기/저장, `TeamCode`에 Java 파일 쓰기, JVM 사이드카의 시작·종료를 맡는다.
- **Renderer (React)**: 씬 뷰(Three.js), 하이어라키, 인스펙터, 스크립트 에디터(Monaco), 운동학 시뮬레이터를 둔다.
- **JVM 사이드카**: 가짜 FTC SDK 위에서 OpMode를 실행한다. `hardwareMap`은 가상 하드웨어를 반환한다. 한 방향으로는 모터 출력·서보 위치를 시뮬레이터로 보내고, 반대 방향으로는 엔코더·IMU 등 센서 값을 받는다.

데이터 흐름:

```
STEP 파일 ─▶ OCCT(WASM, 워커) ─▶ 파트 계층 메시 ─▶ 씬 그래프
                                                  │
                         노드에 하드웨어 컴포넌트·스크립트 부착 (인스펙터)
                                                  │
                 ┌────────────────────────────────┴───────────────┐
                 ▼                                                ▼
   TeamCode에 Java 저장 (생성 코드 + 사용자 스크립트)    JVM 사이드카 ◀─IPC─▶ 운동학 시뮬레이터
```

## 지켜야 할 불변 조건

- **로봇 코드의 원본은 `TeamCode`의 Java 파일이다.** 도구는 스크립트의 별도 사본을 두지 않고, 같은 파일을 편집·실행·저장한다.
- **생성 코드와 사용자 코드를 분리한다.** 인스펙터 속성에서 만들어지는 코드(hardwareMap 매핑 등)는 다시 생성해도 사용자가 작성한 스크립트를 덮어쓰지 않아야 한다.
- **가짜 FTC SDK는 실제 SDK의 API 표면을 그대로 따른다.** 패키지·클래스·메서드 시그니처(`com.qualcomm.robotcore.hardware.*`, `com.qualcomm.robotcore.eventloop.opmode.*` 등)가 같아야 한다. 같은 소스가 Android Studio(실제 SDK)와 사이드카(가짜 SDK) 양쪽에서 수정 없이 컴파일되어야 한다.
- **STEP 파싱은 UI 스레드에서 하지 않는다.** OCCT WASM은 무거우므로 워커에서 돌리고 결과 메시만 넘긴다.
- **UI 문자열을 하드코딩하지 않는다.** 모든 문자열은 i18n 리소스(ko 기본, en)를 거친다.
- **단위 변환은 경계에서만 한다.** 씬 파일·씬 그래프·시뮬레이터 등 내부 값은 항상 미터·라디안이다. 변환은 세 곳에서만 일어난다.
  - STEP 임포트: 파일에 선언된 단위에서 미터로 변환
  - UI 표시·입력: 사용자 표시 단위로 변환. 입력칸은 `12in`, `30cm`처럼 단위를 붙인 값도 받는다.
  - 코드 생성: 프로젝트의 코드 단위로 변환
- **표시 단위는 개인 앱 설정에, 코드 단위는 프로젝트 설정에 저장한다.** 같은 프로젝트를 여는 팀원마다 표시 단위가 달라도 프로젝트 파일과 생성 코드는 바뀌지 않아야 한다.

## 미결정 사항

아래 항목은 아직 정하지 않았다. 스캐폴딩이나 구현 중에 이 항목을 만나면 추측해서 정하지 말고 사용자에게 확인한다.

- 좌표계 규약 (Three.js는 Y-up, FTC 공식 필드 좌표계는 Z-up·필드 중앙 원점)
- 표시 단위의 첫 실행 기본값 (언어·지역으로 추정할지, 처음에 묻게 할지)
- 사이드카 IPC 방식(stdio JSON-RPC 또는 WebSocket)과 시뮬레이션 동기화 방식(lockstep 또는 실시간)
- JDK를 앱에 번들할지 여부
- 지원할 FTC 라이브러리 범위(Road Runner, Pedro Pathing 등)와 시즌별 필드 모델

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
```

root 권한·디스플레이가 없는 컨테이너에서는 `xvfb-run -a pnpm start --noSandbox`로 실행해야 한다.

## 코드 구조 메모

- `src/main`(메인 프로세스), `src/preload`(contextBridge로 렌더러에 API 노출, 타입은 `src/preload/index.d.ts`), `src/renderer/src`(React)로 나뉜다. 렌더러는 Node API에 직접 접근하지 않고 preload를 거친 IPC만 쓴다.
- 타입 검사는 `tsconfig.node.json`(main/preload/설정 파일)과 `tsconfig.web.json`(renderer) 두 갈래다. 새 최상위 설정 파일을 추가하면 `tsconfig.node.json`의 `include`에도 넣는다.
- `@renderer` 경로 별칭은 `electron.vite.config.ts`, `tsconfig.web.json`, `vitest.config.ts` 세 곳에 정의되어 있다. 별칭을 추가·변경할 때는 세 곳을 함께 고친다.
- 테스트는 `src/**/*.test.{ts,tsx}`에 소스와 나란히 두고 `vitest`에서 명시적으로 import한다(globals 미사용). Vitest는 electron-vite 설정이 아니라 `vitest.config.ts`를 읽는다.
- pnpm 10은 의존성의 빌드 스크립트를 기본으로 막는다. 설치 스크립트가 필요한 패키지(네이티브 모듈 등)를 추가하면 `package.json`의 `pnpm.onlyBuiltDependencies`에 넣는다.
- `.gitignore`의 Java 항목은 원래 템플릿에서 온 것이다. 나중에 만들 JVM 사이드카에 필요하므로 유지한다.
- `.mcp.json`은 sequential-thinking MCP 서버를 등록한다.
