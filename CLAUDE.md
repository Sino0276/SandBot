# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

SandBot은 Unity 에디터 스타일의 FTC(FIRST Tech Challenge) 로봇 개발 도구다. 씬 뷰에 팀의 로봇 CAD(STEP)를 불러온다. 파트를 선택하면 인스펙터에서 하드웨어 컴포넌트를 설정하고, 동작 로직은 Java 스크립트로 작성한다. 작성한 코드는 필드 위 운동학 시뮬레이션으로 확인한다.

**현재 상태:** 에디터 뼈대 단계다. 툴바(언어 선택)와 크기 조절이 되는 3패널(하이어라키 · 씬 뷰 · 인스펙터), i18n, 필드/로봇 기준 좌표계 전환, STEP 임포트(방향 맞춤 포함)가 있다. 처음에는 임시 씬(18 in 상자 로봇과 웹캠, `scene/sceneStore.ts`)이 보이고, 첫 STEP 임포트 때 사라진다. 프로젝트 파일이 없어서 불러온 로봇은 앱을 다시 켜면 사라진다. 하드웨어 컴포넌트와 사이드카는 아직 없다. 아래 내용은 사용자와 합의한 설계 결정이며 구현은 이를 따른다.

## 확정된 설계 결정

| 항목        | 결정                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 플랫폼      | Electron 데스크톱 앱 · TypeScript · React · Three.js · Monaco 에디터                                                                                                                                                                       |
| 인스펙터    | Unity 방식. 파트에 하드웨어 컴포넌트(DcMotorEx, Servo, 센서 등)를 붙여 속성(설정 이름, 허브/포트, 방향, 런 모드 등)을 편집하고, 동작 로직은 붙어 있는 Java 스크립트로 작성                                                                 |
| CAD         | STEP(.step/.stp)만 지원. occt-import-js(OpenCascade WASM, LGPL-2.1)로 워커에서 읽는다. CAD 프로그램마다 위·앞 축이 달라서(팀이 여러 CAD를 섞어 씀) 파일마다 방향을 고른다. 기본값은 마지막에 고른 방향이고, 처음에는 Y-up(Fusion 360 기본) |
| 시뮬레이션  | 운동학 수준. 드라이브트레인/메커니즘을 OpMode 코드와 게임패드로 구동하고, 충돌·물리는 단순화                                                                                                                                               |
| OpMode 실행 | JVM 사이드카 + 가짜 FTC SDK. 팀의 실제 Java OpMode를 수정 없이 실행                                                                                                                                                                        |
| 배포        | 팀의 FtcRobotController 프로젝트 `TeamCode`에 Java 파일을 직접 저장. 빌드/설치는 Android Studio에서 함 (도구 내 ADB 배포, OnBot Java 업로드는 범위 밖)                                                                                     |
| 언어        | UI는 i18n(한국어 기본, 영어). CLAUDE.md·코드 주석·커밋 메시지는 한국어                                                                                                                                                                     |
| 툴체인      | pnpm · electron-vite(빌드) · electron-builder(패키징) · ESLint + Prettier · Vitest                                                                                                                                                         |
| 단위        | 세 층으로 분리. 내부(저장·계산)는 미터·라디안으로 고정. 표시·입력 단위는 사용자 개인 앱 설정. 생성 Java 코드의 단위는 프로젝트(팀) 설정                                                                                                    |
| 좌표계      | 저장은 FTC 필드 좌표계(원점 필드 중앙 바닥, Z 위). 로봇 좌표계는 X 앞·Y 왼쪽·Z 위, 원점 로봇 중심 바닥. 보기 기준(필드/로봇)은 사용자가 전환                                                                                               |

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
- **좌표 저장은 한 가지, 보기 기준 전환은 표시만 바꾼다.** 씬 오브젝트의 `transform`은 부모 기준 로컬 값이고, 최상위는 필드 좌표계 값이다. 필드/로봇 전환은 축 표시, 핸들 방향, 인스펙터 값, 카메라에만 적용한다. 좌표 변환은 `scene/model.ts`의 함수(`getTransformInFrame`, `localTransformFromFrame` 등)로만 한다.
- **회전은 X(롤)·Y(피치)·Z(요) 라디안이고, 적용 순서는 Three.js Euler `'ZYX'`다.** 렌더링(`rotation={[rx, ry, rz, 'ZYX']}`)과 계산이 같은 순서를 써야 한다.
- **Z-up은 `scene/coordinates.ts`가 `Object3D.DEFAULT_UP`을 바꿔서 적용한다.** 이 모듈은 `main.tsx`에서 가장 먼저 import해야 한다.
- **최상위 로봇은 바닥 평면에만 있다(높이·롤·피치 0).** `constrainTransform`이 강제하고, 핸들과 인스펙터도 해당 축을 막는다.

## 미결정 사항

아래 항목은 아직 정하지 않았다. 스캐폴딩이나 구현 중에 이 항목을 만나면 추측해서 정하지 말고 사용자에게 확인한다.

- 필드 X·Y축이 어느 벽(얼라이언스·관중석)을 향하는지. FTC가 시즌별로 정하므로 시즌별 필드 모델과 함께 정한다.
- 표시 단위의 첫 실행 기본값 (언어·지역으로 추정할지, 처음에 묻게 할지)
- 사이드카 IPC 방식(stdio JSON-RPC 또는 WebSocket)과 시뮬레이션 동기화 방식(lockstep 또는 실시간)
- JDK를 앱에 번들할지 여부
- 지원할 FTC 라이브러리 범위(Road Runner, Pedro Pathing 등)와 시즌별 필드 모델
- 프로젝트 파일 형식과 저장 위치. 불러온 CAD 경로, 정렬, 파트 위치, 하드웨어 설정을 저장해야 한다. CAD를 프로젝트에 복사할지 경로만 참조할지, 메시를 캐시할지도 정해야 한다.

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
- 렌더러 UI는 `src/renderer/src/editor/`에 있다. `EditorLayout`이 툴바와 react-resizable-panels(v4: `Group`/`Panel`/`Separator`)의 3패널을 구성한다. 각 패널(`editor/panels/`)은 `PanelFrame`으로 헤더와 본문을 감싼다.
- 씬 상태는 zustand 스토어 두 개로 나뉜다. `scene/sceneStore.ts`는 문서 데이터(오브젝트 트리)를, `editor/editorStore.ts`는 편집기 상태(선택, 보기 기준, 조작 모드, 카메라 포커스 요청)를 맡는다. 스토어에는 직렬화할 수 있는 값만 둔다. CAD 메시 형상(`BufferGeometry`)은 `scene/geometryRegistry.ts`에 id로 보관하고, 오브젝트의 `visual.geometryId`가 그것을 가리킨다.
- STEP 임포트 흐름은 다음 순서다.
  - `cad/stepWorker.ts`(웹 워커)가 occt-import-js로 미터 단위로 읽고 `convertOcctResult`로 계층과 피벗 중심 메시로 바꾼다.
  - `cad/importStep.ts`(메인 스레드)가 `buildSceneObjects`로 오브젝트를 만들고, 형상을 등록해 스토어에 넣는다.
  - 오브젝트 구조는 로봇 → CAD 루트(`cad` 메타데이터, transform이 곧 정렬) → 어셈블리·파트다.
  - 각 노드의 피벗은 CAD 경계 상자의 중심이다. CAD 루트 아래 노드는 회전 없이 위치만 가진다.
  - 정렬 계산은 `cad/alignment.ts`의 `cadRootTransform`이 한다. CAD 위축을 로봇 +Z, 앞축을 +X로 돌리고, 바닥 면 중심을 로봇 원점에 둔다.
- occt-import-js는 어셈블리 계층을 **최상위 컴포넌트 한 단계까지만** 노드로 준다. 그 아래 서브어셈블리는 솔리드 목록으로 평탄화되고, 이름 없는 솔리드는 `노드 이름 + 순번`이 된다. 더 깊은 계층이 필요하면 OCCT XCAF를 직접 순회하는 다른 빌드가 필요하다.
- OCCT WASM 때문에 `index.html` CSP의 script-src에 `'wasm-unsafe-eval'`이 있다. 렌더러 워커는 ES 모듈 형식으로 번들한다(`electron.vite.config.ts`의 `worker.format`). STEP 테스트는 occt-import-js 패키지에 들어 있는 CAx-IF 샘플(`node_modules/occt-import-js/test/testfiles/`)을 쓴다.
- 단축키(`EditorLayout`): F는 선택한 오브젝트에 카메라 맞추기(하이어라키 더블클릭, 임포트 직후도 같은 동작), Delete/Backspace는 선택 삭제. 창에 STEP 파일을 끌어다 놓아도 불러온다.
- 이동·회전 핸들(`editor/scene/TransformHandles.tsx`)은 선택한 오브젝트가 아니라 대리 객체에 붙는다. 대리 객체는 "오브젝트 위치 + 보기 기준 좌표계 방향"을 갖고, 드래그한 변화량을 오브젝트에 옮긴다. 그래야 로봇 안의 파트도 로봇 축 방향으로 끌 수 있다. 핸들 클릭이 R3F에서는 빗나간 클릭(선택 해제)으로 처리되므로 `markHandleInteraction`으로 막는다.
- 오른쪽 위 축 표시(`ViewGizmo`)는 drei `GizmoHelper`의 HUD만 쓰고 축은 직접 그린다. drei `GizmoViewport`는 회전된 축을 클릭했을 때 시점 방향을 잘못 계산한다.
- 씬 뷰는 @react-three/fiber + drei다. `Canvas`가 `frameloop="demand"`이므로 R3F 바깥에서 Three.js 객체를 직접 바꾸면 `invalidate()`를 호출해야 다시 그려진다. drei 컴포넌트 중 CDN에서 리소스를 받는 것(`Environment` 프리셋, `Text` 기본 폰트 등)은 `index.html`의 CSP에 막힌다.
- i18n은 `src/renderer/src/i18n/`(react-i18next)에 있다.
  - `locales/ko.ts`가 키 구조의 기준이다. `en.ts`는 같은 타입(`Messages`)을 따라야 하고, `i18next.d.ts`가 `t()` 키를 타입 검사한다. 따라서 키 오타나 누락 번역은 `pnpm typecheck`에서 실패한다.
  - 문자열을 추가할 때는 `ko.ts`와 `en.ts`에 같은 키를 넣고 `t('그룹.키')`로 쓴다.
  - 언어 이름(`LANGUAGE_NAMES`)과 제품명 "SandBot"은 의도적으로 번역하지 않는다.
- 개인 UI 설정(언어 `sandbot:language`, 패널 크기 `react-resizable-panels:editor-main`, 마지막 CAD 방향 `sandbot:cadAlignment`)은 렌더러 `localStorage`에 저장된다.
- 렌더러에서만 쓰는 라이브러리는 Vite가 번들하므로 `devDependencies`에 넣는다. `dependencies`는 main/preload가 런타임에 쓰는 것만 둔다(electron-builder가 패키지에 포함).
- ESLint의 `react/no-unknown-property`는 R3F 요소 속성을 오인해서 껐다. JSX 속성은 TypeScript가 검사한다.
- 테스트는 `src/**/*.test.{ts,tsx}`에 소스와 나란히 두고 `vitest`에서 명시적으로 import한다(globals 미사용). Vitest는 electron-vite 설정이 아니라 `vitest.config.ts`를 읽는다.
- pnpm 10은 의존성의 빌드 스크립트를 기본으로 막는다. 설치 스크립트가 필요한 패키지(네이티브 모듈 등)를 추가하면 `package.json`의 `pnpm.onlyBuiltDependencies`에 넣는다.
- `.gitignore`의 Java 항목은 원래 템플릿에서 온 것이다. 나중에 만들 JVM 사이드카에 필요하므로 유지한다.
- `.mcp.json`은 sequential-thinking MCP 서버를 등록한다.
