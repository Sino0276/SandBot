# 공 물리(6a) 기준 문서

이 문서는 SandBot 시뮬레이터의 6a 단계(BIOBUZZ 경기 요소 POLLEN·NECTAR 공이 관절 나무 밖의 6자유도 몸체로 바닥·벽·구조물·로봇 Collider·서로와 부딪히고, 로봇에 닿은 공은 로봇과 한 풀이로 묶이는 계산, 로봇이 싣고 시작하는 프리로드 자리, 필드 밖으로 나간 공을 다시 넣는 규칙, 렌더러의 공 표시·설정)가 쓰는 모든 치수·상수·수식·알고리즘·결정사항을 한곳에 적는다. 6a의 명세와 계획(`docs/research/6a/spec-6a.md`, `docs/research/6a/plan-6a.md`)은 저장소에 있지만, 그 밑의 원 조사 자료(`plan-6a.md`가 "조사로 확인한 것"이라고 부른 BIOBUZZ CM·EFG·AndyMark 제품 정보, 접촉 모델 방법)는 저장소에 없고 위치도 코드·CLAUDE.md에 기록되어 있지 않다(출처 기록 없음). 그래서 코드(`src/shared/sim/elements/*`, `src/shared/sim/denseLcp.ts`, `src/shared/sim/articulation.ts`의 공 결합, `src/shared/sim/world.ts`의 배선, `src/shared/sim/seasons/biobuzz.ts`의 공 데이터, `src/shared/sim/worldSpec.ts`의 v7 검증, `src/renderer/src/scene/preload.ts`, `src/renderer/src/play/worldElements.ts`)와 CLAUDE.md, `docs/assumptions.md`의 "6a 경기 요소(공)" 표가 곧 원본이다. 각 값은 값 · 단위 · 위치(파일·상수·함수 이름, 줄 번호 없음) · 상태(`[확인: …]`, `[가정: …]`, `[결정: …]`, 표시 없는 코드 값)와 근거를 적었고, 코드에 출처가 없으면 "출처 기록 없음"이라고 썼다. 수식은 코드의 변수 이름을 그대로 써서 다시 구현할 수 있게 했다. 단위는 내부 SI(미터·라디안·킬로그램·N·초)다. 필드 치수(벽 반폭·구조물·LOADING ZONE)의 원천 데이터는 `docs/reference/field-biobuzz.md`가, 3D 충돌 좁은 단계(SAT·GJK·볼록 껍질·정적 형상)는 `docs/reference/collision.md`가 맡고, 여기서는 공이 읽는 값만 다시 적는다.

## 목차

0. 읽는 법
1. 범위와 설계 결정
2. 공 종류 데이터(BIOBUZZ)
3. 시즌 배치와 공 번호
4. 시즌과 관계없는 상수 총표
5. 하위 단계 한 번의 풀이 순서
6. 넓은 단계와 좁은 단계
7. 법선 행
8. 마찰 행과 굴림·회전 저항
9. 로봇과의 결합(Schur 보수)
10. 섬과 잠들기
11. 조밀 상자 LCP(`denseLcp.ts`)
12. 필드 밖과 다시 넣기
13. 표시 상태·프로토콜·알림
14. 세계 설명 v7과 Cylinder Collider
15. 프리로드(Preload Slot, 자동 배치, 겹침 판정)
16. 렌더러 표시와 설정
17. 기준 해시 아홉째 장면
18. 성능 목표와 측정
19. 시험이 지키는 성질
20. 알려진 한계·남은 일
21. 원본 조사 자료 상태

---

## 0. 읽는 법

### 0.1 상태 표기

코드 주석의 표기를 그대로 쓴다. 이 문서의 `[확인]`은 "코드 주석이 출처를 적었다"는 뜻이지, 이 세션에서 출처를 다시 열어 본 것이 아니다.

| 표기        | 뜻                                                                     |
| ----------- | ---------------------------------------------------------------------- |
| `[확인: …]` | 공식 문서·제품 정보·라이브러리 소스 등 출처를 주석이 적은 값           |
| `[가정: …]` | 출처 없이 정한 값. 실측으로 바꿀 대상                                  |
| `[결정: …]` | 설계로 정한 값(이유가 주석에 있음). `사용자 결정`은 사용자와 합의한 값 |
| 표시 없음   | 수치·안정화 상수이거나 다른 상수에서 계산한 값                         |

### 0.2 단위·좌표·기호

| 항목                 | 규약                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 단위                 | 길이 m, 각 rad, 질량 kg, 힘 N, 시간 s. 행의 충격 λ는 힘 × h(N·s, 회전이면 N·m·s)                                                                                                                                |
| 하위 단계 h          | `world.ts`의 `SUBSTEP_NANOS` 1 000 000 ns(1 ms) 절대 격자. 틱은 보통 5 ms라 틱 하나에 하위 단계 5개(허브 타이밍으로 고르지 않은 틱은 경계에서 끊김)                                                             |
| 필드 좌표            | 원점 필드 중앙 타일 윗면, +X 관중석 벽, +Y 파랑 벽, Z 위. 공 상태는 모두 필드 좌표                                                                                                                              |
| 공 상태              | 위치 x(3), 단위 사원수 q = [w, x, y, z], 속도 v(3), 각속도 ω(3)(필드 축). 한 몸체의 속도 묶음 u = [v; ω](6개)                                                                                                   |
| 공 질량 행렬         | 대각: m·1₃, 등방 관성 I·1₃. W = diag(1/m ×3, 1/I ×3)                                                                                                                                                            |
| 법선 n               | 다른 몸체(바닥·정적·로봇·다른 공)에서 공 쪽으로 가는 단위 벡터. 공끼리 짝은 f에서 e로                                                                                                                           |
| 분리 g(`separation`) | 두 표면 사이 거리. 음수 = 침투 깊이 δ = −g                                                                                                                                                                      |
| 행 속도              | 행 k의 w_k = j_k·v⁺ + Σ a_k·u⁺ + γ_k·λ_k − target_k. 법선 행은 w ≥ 0, λ ≥ 0이고 상보                                                                                                                            |
| 공 부분 a            | a = [d; (p − x)×d](d는 행 방향, p는 접촉점, x는 공 중심). 공끼리 행은 두 공에 +a와 −a 꼴의 부분이 하나씩                                                                                                        |
| 짝 토큰              | `e<공 번호>/<상대>`. 상대: 로봇 충돌체 `r`·`j<관절 순번>` + `k<충돌체 순번>`, 정적 `w0`–`w3`·`s<구조물 순번>`·`fl`, 다른 공 `e<번호>`                                                                           |
| 행 키                | `gn.<토큰>`(법선), `gt1.<토큰>`·`gt2.<토큰>`(마찰 접선). 접두어 `g`는 기존 접두어 `w`·`n`·`t`·`f`·`l`·`u`·`c`와 겹치지 않는다. 예: `gn.e0/j0k0`, `gt1.e0/j0k0`, `gn.e8/rk0`, `gn.e0/w0`, `gn.e0/fl`, `gn.e0/e1` |
| 접촉 틀 C            | `Articulation.contactFrames()`의 틀: 부유 기저면 축은 필드, 원점은 섀시 원점 (x, y, 0). 고정 기저·동역학 없는 로봇이면 로봇 좌표(시작 자세에 서 있는 정적 섀시)                                                 |

### 0.3 파일 지도

| 파일                                                                                                                                                                                                       | 역할                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/sim/elements/elementData.ts`                                                                                                                                                                   | 시즌과 관계없는 상수(풀이·잠들기·다시 넣기·끼임·되찾기), `resolveElementType`                                                                                                           |
| `src/shared/sim/elements/spawn.ts`                                                                                                                                                                         | `elementSpawns`(시작 공), `restBodyFrames`, `autoPreloadSlots`(자동 프리로드 자리), `reentryZones`·`nearestReentryZone`(다시 넣는 자리)                                                 |
| `src/shared/sim/elements/ballContact.ts`                                                                                                                                                                   | 공의 좁은 단계(구–바닥·상자·껍질·캡슐·원기둥·구)와 법선 행 값(`normalRow`·`springRow`·`pinchedSpringRow`·`coreRecoveryRow`)                                                             |
| `src/shared/sim/elements/broadPhase.ts`                                                                                                                                                                    | `BallGrid`: 0.125 m 정수 격자 넓은 단계                                                                                                                                                 |
| `src/shared/sim/elements/islands.ts`                                                                                                                                                                       | `UnionFind`, 로봇에 닿지 않은 공 섬의 풀이 `solveIsland`(조밀 LCP 또는 PGS)                                                                                                             |
| `src/shared/sim/elements/elementWorld.ts`                                                                                                                                                                  | `ElementWorld`: 상태 SoA, `prepare`·`finish`·`tick`·`updateDisplay`, 접촉·행 만들기, 끼임·붙들림, 섬 나누기, 잠들기, 필드 밖                                                            |
| `src/shared/sim/elements/gameState.ts`                                                                                                                                                                     | 표시 상태 줄이기(1e-4 정수 7칸), 표식 비트, 검증                                                                                                                                        |
| `src/shared/sim/elements/elementTestkit.ts`                                                                                                                                                                | 시험 전용 도구(공 만들기, `intakeWedge` 장면)                                                                                                                                           |
| `src/shared/sim/denseLcp.ts`                                                                                                                                                                               | 공 행이 있는 상자 LCP의 조밀 풀이 `solveDenseLcp`                                                                                                                                       |
| `src/shared/sim/articulation.ts`                                                                                                                                                                           | `ContactRow.elements`·`compliance`, `ContactSet.elements`, `CoupledElements`, `constrainedCoupled`, `coupledMatrix`, `writeCoupledMatrix`, `clampLimits`의 공 블록, `elementVelocities` |
| `src/shared/sim/world.ts`                                                                                                                                                                                  | 하위 단계 배선(공 행은 몸체 충돌 행 뒤), 틱 경계 `elements.tick`·`updateDisplay`, `gameState()`·`elementSnapshot()`·`elementTickState()`                                                |
| `src/shared/sim/seasons/biobuzz.ts`·`fieldSpec.ts`·`symmetry.ts`                                                                                                                                           | 공 종류·GARDEN 배치 데이터, `FieldElementType`·`FieldElements` 타입과 `checkFieldSpec`, `mirrorElementPlacement`·`mirrorElementKind`                                                    |
| `src/shared/sim/worldSpec.ts`                                                                                                                                                                              | 세계 설명 v7 `elements` 타입·검증·한도, Cylinder 충돌체 검증                                                                                                                            |
| `src/shared/sim/collision3d.ts`·`bodyCollision.ts`                                                                                                                                                         | 정적 형상 `staticShapes`, 원기둥 근사 `cylinderColliderPoints`, `frictionTangent`, `COLLISION_MARGIN`, `OVERLAP_NOTICE_DEPTH`                                                           |
| `src/main/sidecar/session.ts`                                                                                                                                                                              | `gameState` 이벤트 묶음·throttle·`final`                                                                                                                                                |
| `src/shared/play.ts`                                                                                                                                                                                       | `gameState` 이벤트 타입, 알림 코드                                                                                                                                                      |
| `src/renderer/src/scene/preload.ts`                                                                                                                                                                        | Preload Slot 설정·범위·정리                                                                                                                                                             |
| `src/renderer/src/play/worldElements.ts`                                                                                                                                                                   | 프리로드 자리 정하기 `robotPreloads`, 겹침 판정 `preloadOverlaps`, `withElements`                                                                                                       |
| `src/renderer/src/editor/preload/`, `editor/scene/ElementsView.tsx`·`elementsViewModel.ts`, `editor/field/FieldElementsSection.tsx`, `play/playSettings.ts`, `play/playStore.ts`, `project/projectFile.ts` | 카드·기즈모, 공 표시, Field 인스펙터 구역, 개인 설정, 실행 상태, 프로젝트 v14                                                                                                           |
| `src/shared/sim/worldGolden.test.ts`                                                                                                                                                                       | 기준 해시 아홉째 `gardenIntake()`(17절)                                                                                                                                                 |
| `src/shared/sim/elements/elementPerf.test.ts`                                                                                                                                                              | 성능 P1–P6(18절)                                                                                                                                                                        |

### 0.4 데이터 흐름

1. 팀이 로봇 하위 오브젝트에 Preload Slot(시뮬레이터 전용 컴포넌트)을 붙인다(없으면 자동 배치). 개인 설정 `gameElements`(기본 켬)가 켜져 있다.
2. INIT 때 `playActions`가 `buildWorldSpec` 결과에 `withElements`로 `elements: { groups: ['garden'], preloads: [...] }`를 넣는다(렌더러는 묶음·프리로드 자리만 보낸다). 공의 반지름·질량·접촉·공기 값과 시작 배치는 보내지 않고, 시뮬레이터가 `resolveSeason`으로 푼다.
3. 메인 `parseWorldSpec`이 v7 칸을 검증하고 `PhysicsWorld`가 시즌에 경기 요소가 있을 때만 `ElementWorld`를 만든다. 공 번호는 `elementSpawns` 순서(배치 → 프리로드)다.
4. 하위 단계(1 ms)마다 접촉 틀을 한 번 만들고, 로봇 몸체 충돌 행 뒤에 공 행을 붙여 `Articulation.step`이 한 상자 LCP로 함께 푼다(로봇에 닿은 공만). 나머지 공 섬은 `finish`에서 따로 푼다.
5. 틱 경계에서 나간 공을 다시 넣고 표시 상태를 줄인다. 메인 `session.ts`가 16 ms마다 `gameState` 이벤트로 렌더러에 보낸다. 끝에는 전체 정밀도 상태 `final`을 한 번 싣는다.
6. 렌더러 `ElementsView`가 인스턴스 행렬만 바꿔 그린다. STOP 뒤에는 끝난 자리가 반투명 잔상으로 남는다.

---

## 1. 범위와 설계 결정

### 1.1 6단계의 분할과 6a의 범위

| 하위 단계  | 내용                                                                                            | 상태            |
| ---------- | ----------------------------------------------------------------------------------------------- | --------------- |
| 6a 공 물리 | POLLEN·NECTAR 6자유도 몸체, 접촉·마찰·반발, 로봇 양방향 결합, 프리로드, 필드 밖 다시 넣기, 표시 | 구현됨(이 문서) |
| 6b         | HIVE 넘어감(1자유도 동적 몸체), FLOWER 안 POLLEN·안쪽 형상, HIVE CELL NECTAR                    | 아직 없음       |
| 6c         | 센서·웹캠이 보는 공(`tickState()`의 구 층을 광선·가림에 넣음)                                   | 아직 없음       |
| 6d         | 점수·규칙 알림(G407류)·사람 선수 NECTAR·AUTO→TELEOP 이어 가기(`final` 스냅샷 + 로봇 끝 자세)    | 아직 없음       |

| 6a에 생기는 공       | 수                       | 비고                                                      |
| -------------------- | ------------------------ | --------------------------------------------------------- |
| GARDEN POLLEN        | 8(빨강 4 + Rz(π) 파랑 4) | 잠든 채 시작                                              |
| 로봇 프리로드 POLLEN | 4까지                    | 깨어서 시작. 팀 Preload Slot 또는 자동 배치               |
| 합계                 | 최대 12                  | NECTAR는 형식만 있고(시험·6d 이음새) 실행에 생기지 않는다 |

로봇 없는 세계(`EMPTY_WORLD`)에는 공이 없다. 공은 하이어라키에 행이 없다(Field 인스펙터에 개수만 보인다). 세계 설명 `elements` 칸이 없으면 공 코드가 하나도 돌지 않아 6a 전과 연산 순서·바이트가 같다(기준 해시 여덟은 그대로, 판 번호만 7로 올랐다).

### 1.2 사용자 결정(11/13)

| 결정                 | 내용                                                                                                                                                                                 | 위치·근거                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 하위 단계 순서       | 물리 → HIVE·FLOWER → 센서 → 점수                                                                                                                                                     | `plan-6a.md`                                                            |
| 메커니즘은 실제 물리 | 롤러·플라이휠은 지금의 모터·CR 서보 관절과 Collider다. 공이 눌리는 부드러운 접촉과 마찰로 물고 던진다. 로봇과 양방향으로 묶어 발사하면 플라이휠이 느려진다                           | 9절                                                                     |
| AUTO→TELEOP          | AUTO 끝 상태에서 이어 간다(6d). 6a는 이음새만 남긴다                                                                                                                                 | `ElementWorldOptions.initial`, `final`, `lastRunElements`, `snapshot()` |
| 프리로드 자리        | 팀이 하이어라키 오브젝트에 시뮬레이터 전용 컴포넌트로 둔다(로봇마다 4개까지). 없으면 로봇 앞 타일, 막혔으면 뒤 → 왼쪽 → 오른쪽. 네 면이 다 막혔으면 프리로드 없이 돌리고 경고        | 15절                                                                    |
| 공 물리 값           | 가정값으로 시작하고, 가정·부정확한 값은 따로 정리한다                                                                                                                                | `docs/assumptions.md` 6a 표                                             |
| 공은 기본 켬         | 개인 실행 설정이고 환경 설정 › 시뮬레이션과 Field 인스펙터에서 끈다                                                                                                                  | `playSettings.ts` `gameElements`                                        |
| FLOWER 안 POLLEN     | 6b로 미룬다. 지금 FLOWER는 꽉 찬 상자다                                                                                                                                              | 6b                                                                      |
| 필드 밖 POLLEN       | 확실히 나가면 물리에서 뺀다. 3 s 뒤([가정]) 나간 곳에서 가까운 LOADING ZONE의 벽에 붙인 빈 자리에 다시 넣는다(없으면 빌 때까지 기다림). Console에 알린다. 시뮬레이션은 멈추지 않는다 | 12절                                                                    |
| Cylinder Collider    | 추가한다. Unity에 없는 임시 편차                                                                                                                                                     | 14절                                                                    |
| 성능은 정확도 우선   | 로봇에 닿은 공은 로봇과 한 풀이로 푼다. 실시간보다 조금 느려도 된다                                                                                                                  | 9·18절                                                                  |

권장 기본값(사용자에게 따로 묻지 않음, 바꿀 수 있음): 로봇 없는 세계는 6a에 없다, 공은 하이어라키에 행이 없다, 굴림·회전 저항은 명시 충격으로 준다, gameState는 16 ms마다 보낸다(좌표 1e-4 양자화), 잡은 공을 로봇에 붙이는 최적화(weld)는 성능 목표를 못 맞출 때만 넣는다(넣지 않았다).

### 1.3 설계 결정

| 결정                                 | 값·내용                                                                              | 이유                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 공은 관절 나무 밖 6자유도            | 공마다 대각 질량 m·1₃, 등방 관성 I·1₃(자이로 항 없음)                                | 로봇 질량 행렬이 공 수만큼 커지지 않게                                      |
| 로봇에 닿은 공은 Schur 보수로 접는다 | 공 부분 블록만 행렬 A·벡터 b에 더한다                                                | 질량 행렬을 키우지 않고 로봇과 공이 서로 민다                               |
| 공 행이 없으면 지금 코드 그대로      | 공 행이 있는 행만 새 분기(`constrainedCoupled`)를 탄다                               | 기준 해시 여덟 보존                                                         |
| 속도 암시 오일러                     | 로봇과 같은 1 ms 절대 격자 하위 단계                                                 | 같은 격자에서 로봇·공이 함께 풀림                                           |
| 부드러운 법선                        | ODE ERP·CFM 꼴의 암시 스프링–감쇠(ζ = 1)                                             | 판 사이에 눌린 공의 힘 = kδ                                                 |
| 딱딱한 심                            | 눌림이 0.3·r 이상이면 강체 행 + `elementCrushed`                                     | 위플 공이 그보다 깊게 눌리면 찌그러졌다고 봄                                |
| 반발 두 단계                         | 표면까지 오게 한 접근 속도를 적고 다음 하위 단계에 e·\|v\|로 튐                      | 한 행 투기 반발은 0.5 m 낙하가 e² 대신 약 0.03배만 튐                       |
| 끼인 행은 이력 스프링                | 반발 두 단계 없이 Walton–Braun 선형 이력(되돌림 에너지 e²)                           | 끼인 공의 양쪽 강체 반발 목표가 13.6 kg 로봇을 거꾸로 밀었다(공이 트램펄린) |
| 굴림·회전 저항은 명시 각충격         | LCP 행을 늘리지 않는다. 로봇은 반작용을 받지 않는다                                  | 모델 단순화                                                                 |
| 섬 = union-find                      | 뿌리는 가장 작은 번호. 로봇 섬은 `art.step`, 나머지는 작은 조밀 LCP(60행 초과는 PGS) | 결정성                                                                      |
| 결합 한도 96행                       | 넘는 공은 로봇 속도를 정해진 값으로 보는 한쪽 섬                                     | 성능 예산                                                                   |
| 실패는 섬 단위로 가둔다              | 공 섬이 던지면 그 섬만 속도 0 + `worldError`                                         | 멀리 있는 공 하나의 버그가 로봇을 멈추지 않게                               |
| Map은 키로 찾기만                    | 순서는 배열·정수 격자·번호 오름차순                                                  | 같은 입력 → 같은 바이트                                                     |
| 공은 `blocked`를 켜지 않는다         | 공 행은 `blocking` 거르기 뒤에 붙인다                                                | 공에 닿을 때마다 로봇이 막힌 것으로 보이지 않게                             |
| `pose()`는 바꾸지 않는다             | 공 상태는 `gameState()`·`elementSnapshot()`·`elementTickState()`로만 읽는다          | 기준 해시·프로토콜 보존                                                     |
| 사이드카 프로토콜은 그대로(4)        | 팀 코드는 공을 보지 않는다                                                           | 6c 전까지 센서가 공을 보지 않음                                             |

### 1.4 Unity 대응과 임시 편차

| 항목                  | 대응·편차                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 공 몸체               | Unity Rigidbody + SphereCollider에 해당(씬 오브젝트로는 노출하지 않음: 하이어라키 행 없음)                                                                    |
| 마찰 합치기           | Unity Physics Material의 Friction Combine Average(두 면의 평균)                                                                                               |
| Preload Slot          | 빈 GameObject에 붙인 생성 지점 MonoBehaviour와 `OnDrawGizmos` 와이어 구. 카드 이름 "Preload Slot"은 번역하지 않는다. 머리줄 확인란은 `Behaviour.enabled` 자리 |
| Cylinder Collider     | Unity에 없다(임시 편차, 사용자 결정 11/13: 롤러·플라이휠을 캡슐보다 정확히). 카드 도움말에 편차를 적는다                                                      |
| 공 하이어라키 행 없음 | 임시 편차(Unity에서는 GameObject)                                                                                                                             |

### 1.5 명세(spec-6a)와 구현이 다른 곳

`docs/research/6a/spec-6a.md`는 계약 커밋 전의 설계라 구현이 몇 군데 다르다. 명세와 계획이 어긋날 때는 계획(사용자 결정)이 이긴다고 명세가 적었다. 아래는 구현이 따른 값이다.

| 항목                    | 명세                                                                                             | 구현                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 결합 한도               | `MAX_COUPLED_ROWS` 48                                                                            | 96(6a 리뷰 2). 48은 붙은 공 8개, 72는 E2E 쐐기(84행)를 담지 못했다                                                                                                                                          |
| 반발                    | 한 행 투기 반발 `e·(−v_n*) − (1+e)·max(g,0)/h`                                                   | 두 단계(표면까지 오게 함 → 다음 하위 단계에 튐). 한 행 식은 두 번째 단계(`impact`)에만 남음                                                                                                                 |
| 끼임                    | 없음                                                                                             | 행마다 끼임 판정 + 이력 스프링(6a 리뷰·리뷰 2)                                                                                                                                                              |
| 심 행                   | 강체, 밀어내지 않음                                                                              | 붙드는 것이 없으면 되찾기(`coreRecoveryRow`, 6a 리뷰 3), 시작 겹침 짝은 강체 유지                                                                                                                           |
| 결합 한도를 넘는 행     | 로봇 속도 v*에 한쪽으로 푼다                                                                     | 부드러운 법선만(`softenOneWay`) + 로봇에 닿았거나 넣은 공에 닿은 공만 넣기(6a 리뷰·리뷰 2)                                                                                                                  |
| 풀이                    | 조밀 상자 LCP(`solveBoxLcp`)를 섬에 재사용                                                       | 새 `denseLcp.ts`(근접점 반복 없음, 작업 배열 재사용, 시작 상태 고르기, 일찍 쓰는 규칙, 상한 뒤 대체 규칙)                                                                                                   |
| 넓은 단계               | 로봇 형상 AABB를 덮는 칸을 찾음                                                                  | 몸체 원점 둘레 `rMax + 공 반지름 + 여유` 구 안의 공을 격자 상자 질의로 찾음                                                                                                                                 |
| 시즌 다시 넣기          | `FieldSpec.elements.reentry?`                                                                    | 종류마다 `FieldElementType.reentry: boolean`                                                                                                                                                                |
| `autoPreloadSlots` 인자 | `(footprint, field, start)`                                                                      | 넷째 인자 `groups`(같은 실행에 생길 시즌 공과 겹치는 면을 막음)                                                                                                                                             |
| `ElementWorld` API      | `constructor(spec, field, art)`, `finish(art, h, robotFailed)`                                   | `constructor(spec, field, options)`, `finish(art, h, failed, tEnd)`, `tick`·`updateDisplay`·`failSubstep`·`drainNotices` 추가                                                                               |
| 실패 가두기             | 공 섬이 던지면 그 섬만 속도 0, 비유한 값이 든 짝은 그 짝만 뺌, 로봇이 던지면 로봇 섬 공도 속도 0 | 접촉 만들기(공 하나)가 던지면 그 공만 그 하위 단계에 멈추고(`failBall`), 공 접촉 만들기 전체가 던지면 공이 모두 멈추고 로봇은 공 행 없이 간다(`failSubstep`), 접촉 틀 계산이 던지면 로봇과 공이 함께 멈춘다 |
| `gameState`             | 별도 `gameThrottle` 16 ms                                                                        | pose와 같은 throttle 하나(6a 리뷰: 따로 두면 실려 가는 공이 로봇과 다른 틱으로 그려졌다)                                                                                                                    |
| 성능 목표               | P1–P5                                                                                            | P6(결합 한도를 넘는 쐐기)을 더함                                                                                                                                                                            |
| 프리로드 겹침           | `worldPreloadOverlap` 하나                                                                       | 결과가 셋: Overlap(밀려남)·Embedded(박힘)·Squeezed(눌림)                                                                                                                                                    |

---

## 2. 공 종류 데이터(BIOBUZZ)

위치는 `src/shared/sim/seasons/biobuzz.ts`(`ELEMENT_TYPES`, `POLLEN`, `NECTAR_PHYSICS`, `BALL_CONTACT_COMMON`, `BALL_AIR`)와 타입은 `seasons/fieldSpec.ts`(`FieldElementType`)다. `'none'` 시즌은 `elements: null`이다.

### 2.1 치수·질량·관성

| 항목              | POLLEN         | NECTAR(빨강·파랑 같음)   | 단위      | 위치                                  | 상태·근거                                                                                                                  |
| ----------------- | -------------- | ------------------------ | --------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 종류 키           | `pollen`       | `nectarRed`·`nectarBlue` | —         | `FieldElementType.kind`               | `SimElementKind`(`worldSpec.ts` `ELEMENT_KINDS`)                                                                           |
| 지름              | 0.0711(2.8 in) | 0.0914(3.6 in)           | m         | `POLLEN_RADIUS`·`NECTAR_RADIUS`의 2배 | `[확인: CM·EFG·AndyMark 제품 정보]`                                                                                        |
| 반지름 r          | 0.03555        | 0.0457                   | m         | `POLLEN_RADIUS`·`NECTAR_RADIUS`       | 같음                                                                                                                       |
| 질량 m            | 0.0249         | 0.0413                   | kg        | `POLLEN_MASS`·`NECTAR_MASS`           | `[확인: CM·EFG·AndyMark 제품 정보(POLLEN 24.9 g, NECTAR 41.3 g)]` 코드 주석은 지름·질량에 한 표기를 같이 붙인다            |
| 안쪽 반지름 비 k  | 0.95           | 0.95                     | —         | `SHELL_INNER_RATIO`                   | `[가정: 위플형 PE 공의 벽 안쪽 반지름 = 0.95·r(구멍은 무시)]` 실측 없음                                                    |
| 관성 I            | 1.99651e-5     | 5.47238e-5               | kg·m²     | `shellInertia(m, r)`                  | 속 빈 껍질 I = 0.4·m·(r⁵ − rᵢ⁵)/(r³ − rᵢ³) = 0.4(1 − k⁵)/(1 − k³)·m·r² = 0.634444…·m·r². 속 찬 구 0.4와 얇은 껍질 2/3 사이 |
| I/(m·r²)          | 0.634444       | 0.634444                 | —         | 같음                                  | 계산값                                                                                                                     |
| 1/I (W의 각 성분) | 50087.3        | 18273.6                  | 1/(kg·m²) | 계산값                                | —                                                                                                                          |
| 개수(경기)        | 40             | 8 + 8                    | 개        | 코드에 없음, `plan-6a.md` 조사 요약   | 구멍 Ø0.4 in 26개 / Ø0.6 in 26개, 둘 다 PE 위플형. 코드는 구멍을 모델링하지 않는다                                         |

속 빈 껍질 관성의 상수 `0.4·(1 − k⁵)/(1 − k³)`을 풀어 쓴 값: k = 0.95 → (1 − 0.7737809375)/(1 − 0.857375) = 0.2262190625/0.142625 = 1.586…, × 0.4 = 0.63444…. `checkFieldSpec`은 I가 속 찬 구(0.4·m·r²)와 얇은 껍질(2/3·m·r²) 사이인지 확인한다.

### 2.2 접촉·공기 값

모두 `FieldElementType.contact`·`air`이고 BIOBUZZ에서 두 종류가 같은 공통 값(`BALL_CONTACT_COMMON`, `BALL_AIR`)을 쓴다. 판 강성만 다르다. `docs/assumptions.md` 6a 표에도 같은 값과 측정 방법이 있다.

| 항목                              | POLLEN   | NECTAR  | 단위 | 위치                                      | 상태·근거                                                                                                                                   | 측정·교체 방법                                                                                                     |
| --------------------------------- | -------- | ------- | ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 판 강성 `plateStiffness`          | 3000     | 4500    | N/m  | `POLLEN.contact`·`NECTAR_PHYSICS.contact` | `[가정: 판 강성 3000 N/m]` 손가락으로 누른 어림(1 kg에 약 3 mm). NECTAR는 `[가정: 4500 N/m]` POLLEN보다 큰 구멍·지름이지만 벽이 두꺼운 어림 | 공을 평평한 두 판 사이에 끼우고 추 0.5–2 kg을 올리며 판 간격 변화를 캘리퍼스로 잰다. k_plate = 힘 변화 ÷ 간격 변화 |
| 접촉 하나의 스프링 k_c            | 6000     | 9000    | N/m  | `CONTACT_STIFFNESS_PER_PLATE` = 2         | `[결정: 판 강성은 공을 두 판 사이에 끼운 직렬 접촉 둘이라 접촉 하나는 그 두 배]`                                                            | —                                                                                                                  |
| 심 깊이 비 `coreDepthRatio`       | 0.3      | 0.3     | —    | `BALL_CONTACT_COMMON.coreDepthRatio`      | `[가정: 0.3·r 넘게 눌리면 딱딱한 심]` 위플 공이 그보다 깊게 눌리는 메커니즘은 공을 찌그러뜨린다고 봄                                        | 판 시험에서 공이 급격히 딱딱해지거나 영구 변형되는 눌림을 잰다                                                     |
| 심 깊이(m)                        | 0.010665 | 0.01371 | m    | 계산 0.3·r                                | 계산값                                                                                                                                      | —                                                                                                                  |
| 표면 마찰 μ                       | 0.5      | 0.5     | —    | `BALL_CONTACT_COMMON.friction`            | `[가정: PE 공 표면 μ 0.5]` 타일·알루미늄·고무 롤러 사이의 중간값(짝은 평균)                                                                 | 공 둘을 테이프로 붙여 구르지 않게 하고 재질 판 위에서 기울여 미끄러지는 각 θ를 잰다. μ = tan θ                     |
| 굴림 저항 μ_rr                    | 0.05     | 0.05    | —    | `rollingResistance`                       | `[가정: 굴림 저항 0.05]` 구멍 난 속 빈 공이 타일 위를 구를 때의 감속(약 0.3 m/s²)                                                           | 타일 위에서 공을 속도 v₀로 굴려 멈출 때까지 거리 s를 잰다. a = v₀²/(2s), μ_rr ≈ a·(1 + I/(m r²))/g                 |
| 회전 저항 접촉 반경 r_s           | 0.002    | 0.002   | m    | `spinRadius`                              | `[가정: 회전 저항 접촉 반경 2 mm]` 쉬는 공의 접촉 반경 √(2r·mg/k) ≈ 1.7–2.0 mm를 올림(계산: POLLEN 1.70, NECTAR 2.03 mm)                    | 타일 위에서 팽이처럼 돌린 공이 멈출 때까지 시간을 영상으로 잰다                                                    |
| 반발 계수 e(바닥)                 | 0.30     | 0.30    | —    | `restitution.floor`                       | `[가정: 반발 바닥 0.30·딱딱한 면 0.64·공끼리 0.5·로봇 0.5]` 위플 공 낙하 영상 어림(타일 폼은 더 흡수한다)                                   | 0.5 m에서 떨어뜨려 튀어 오른 높이 h₁을 영상(240 fps)으로 잰다. e = √(h₁/h₀). 면마다                                |
| 반발 계수 e(딱딱한 면: 벽·구조물) | 0.64     | 0.64    | —    | `restitution.hard`                        | 같음                                                                                                                                        | 같음                                                                                                               |
| 반발 계수 e(공끼리)               | 0.5      | 0.5     | —    | `restitution.element`                     | 같음                                                                                                                                        | 공 둘을 부딪혀 튀는 속도를 영상으로 잰다                                                                           |
| 반발 계수 e(로봇 Collider)        | 0.5      | 0.5     | —    | `restitution.robot`                       | 같음                                                                                                                                        | 롤러 고무 등 면마다                                                                                                |
| 항력 계수 C_d                     | 0.5      | 0.5     | —    | `BALL_AIR.dragCoefficient`                | `[가정: C_d 0.5(구멍 난 구)]` 매끈한 구의 문헌값 어림                                                                                       | 발사 속도를 아는 슈터로 쏜 궤적을 영상으로 맞춘다                                                                  |
| Magnus 기울기 s                   | 0.5      | 0.5     | —    | `BALL_AIR.magnusSlope`                    | `[가정: Magnus 기울기 0.5·최대 0.3]`                                                                                                        | 역회전이 있을 때와 없을 때 사거리·최고점을 견준다                                                                  |
| Magnus 최대 C_Lmax                | 0.3      | 0.3     | —    | `BALL_AIR.magnusMax`                      | 같음                                                                                                                                        | 같음                                                                                                               |
| 다시 넣는 종류 `reentry`          | true     | false   | —    | `POLLEN.reentry`·`NECTAR_PHYSICS.reentry` | CM 10.8.2: 필드 밖 POLLEN은 경기 요원이 다시 넣는다. NECTAR는 사람 선수가 넣는다(6d)라 6a는 밖에 그대로 둔다                                | 해당 없음                                                                                                          |

### 2.3 표시 색과 반사율

6a 물리는 반사율을 쓰지 않는다(6c 센서용). 표시 색은 `[결정: 계산과 무관한 표시 색]`이다.

| 종류        | display   | rgb(반사율 3채널)  | nir | 위치                   | 상태                                                       |
| ----------- | --------- | ------------------ | --- | ---------------------- | ---------------------------------------------------------- |
| POLLEN      | `#f2d21b` | (0.65, 0.55, 0.08) | 0.7 | `POLLEN_MATERIAL`      | rgb·nir `[가정: 노랑·빨강·파랑 PE 공의 반사율, 실측 없음]` |
| NECTAR 빨강 | `#d32f2f` | (0.5, 0.1, 0.08)   | 0.6 | `NECTAR_RED_MATERIAL`  | 같음                                                       |
| NECTAR 파랑 | `#1e63c8` | (0.08, 0.2, 0.5)   | 0.5 | `NECTAR_BLUE_MATERIAL` | 같음                                                       |

### 2.4 이 값들에서 계산되는 값(h = 1 ms, ζ = 1)

| 항목                           | 식                    | POLLEN     | NECTAR     | 단위  |
| ------------------------------ | --------------------- | ---------- | ---------- | ----- |
| 감쇠 c                         | 2ζ√(k_c·m)            | 24.4459    | 38.5590    | N·s/m |
| 순응 γ                         | 1/(h(h·k_c + c))      | 32.845     | 21.026     | 1/kg  |
| 목표 이득                      | h·k_c/(h·k_c + c)     | 0.19707    | 0.18924    | —     |
| 쉬는 침하                      | m·g/k_c               | 40.70 µm   | 45.00 µm   | m     |
| 접선 순응 γ_t                  | 0.01/m                | 0.40161    | 0.24213    | 1/kg  |
| 굴림 감속                      | μ_rr·g/(1 + I/(m r²)) | 0.30000    | 0.30000    | m/s²  |
| 공끼리 스프링(같은 종류, 직렬) | k_c/2                 | 3000       | 4500       | N/m   |
| 공끼리 환산 질량(같은 종류)    | m/2                   | 0.01245    | 0.02065    | kg    |
| 공끼리 심 깊이(같은 종류)      | 0.3·2r                | 0.02133    | 0.02742    | m     |
| 항력 면적 πr²                  | —                     | 3.97035e-3 | 6.56118e-3 | m²    |

POLLEN–NECTAR 짝(다른 종류)은 두 접촉 스프링의 직렬 `(ke·kf)/(ke + kf)`(ke = 6000, kf = 9000 → 3600 N/m), 환산 질량 m_P·m_N/(m_P + m_N)(0.015534 kg), 심 깊이 0.3·r_P + 0.3·r_N = 0.024375 m이다(NECTAR는 6a에서 생기지 않아 시험·6d 이음새에서만 쓰인다).

---

## 3. 시즌 배치와 공 번호

### 3.1 GARDEN POLLEN 배치(`biobuzz.ts` `RED_GARDEN_POLLEN`)

CM 10.3.1 "line starting in the corner closest to the ALLIANCE AREA against the audience or rear wall"를 따른 배치다. 빨강 GARDEN은 관중석 벽(+X)을 따라 빨강 벽(−Y) 구석에서 시작하는 띠(FAC 3.5)라 공은 관중석 벽과 빨강 벽에 닿고 서로 닿게 한 줄로 바닥에 놓인다. 파랑은 `mirrorElementPlacement`(위치 정확한 부호 반전, 색 있는 종류는 상대 색)로 만든다.

| 공           | x        | y                                  | z       | 단위 | 식                                                      |
| ------------ | -------- | ---------------------------------- | ------- | ---- | ------------------------------------------------------- |
| 빨강 k = 0   | 1.75731  | −1.75731                           | 0.03555 | m    | x = INNER_HALF − r, y = −INNER_HALF + r·(1 + 2k), z = r |
| 빨강 k = 1   | 1.75731  | −1.68621                           | 0.03555 | m    | 같음                                                    |
| 빨강 k = 2   | 1.75731  | −1.61511                           | 0.03555 | m    | 같음                                                    |
| 빨강 k = 3   | 1.75731  | −1.54401                           | 0.03555 | m    | 같음                                                    |
| 파랑 k = 0…3 | −1.75731 | 1.75731, 1.68621, 1.61511, 1.54401 | 0.03555 | m    | Rz(π): (−x, −y, z)                                      |

INNER_HALF = 1.79286 m `[확인: CAD am-2556a FTC Rail 안쪽 면 70.585 in]`. 중심 x(1.75731)는 GARDEN 띠 [1.74206, 1.79286] 안이다. 공끼리는 정확히 닿는다(간격 0).

### 3.2 공 번호 순서(`spawn.ts` `elementSpawns`)

공 번호는 실행 동안 바뀌지 않는다.

| 번호     | 내용                       | 시작 상태                                                                                                     |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0–3      | 빨강 GARDEN POLLEN k = 0…3 | 잠듦(`asleep: true`), 속도 0, 단위 사원수                                                                     |
| 4–7      | 파랑 GARDEN POLLEN         | 같음                                                                                                          |
| 8…(≤ 11) | 프리로드(자리 순서)        | 깨어 있음(`asleep: false`). 위치 = 로봇 시작 자세 Rz(yaw)·(x, y, 0)로 옮긴 `bodyToRobot(몸체 틀 q = 0, 자리)` |

`elements.groups`에 든 묶음만 배치를 낸다(6a는 `['garden']`). 시즌 배치 → 프리로드 순서이고 배치는 `FieldSpec.elements.layout` 배열 순서다. 세계 설명에 경기 요소가 없거나 시즌에 없으면 `[]`다. 몸체 틀은 `restBodyFrames(joints)`(부모 몸체 틀 ∘ (origin.position, ZYX origin.rotation), q = 0)다.

### 3.3 `checkFieldSpec`의 공 규칙(`fieldSpec.ts` `checkElements`)

| 규칙 | 값·내용                                                                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 종류 | kind 유일, 반지름·질량 > 0, 관성은 속 찬 구(0.4 m r²) ≤ I ≤ 얇은 껍질(2/3 m r²), 판 강성 > 0, 심 비 ∈ (0, 1), 마찰·굴림·회전 저항 ≥ 0, 반발 ∈ [0, 1], 공기 계수 ≥ 0                                                                                                  |
| 짝   | 색 있는 종류는 상대 색 종류가 있고 반지름·질량이 같다                                                                                                                                                                                                                |
| 배치 | 아는 종류, z = r(허용 `ELEMENT_TOLERANCE` 1e-9), 필드 안(\|x\| + r ≤ innerHalf + 1e-9, y도), 구조물(carrier field이고 solid ∨ occludes)과 `sphereShapeSeparation ≥ −1e-9`, 다른 배치 공과 간격 ≥ −1e-9, 시작 프리셋 사각형과 `OVERLAP_TOLERANCE` 1e-6 m 안 겹침 없음 |
| 대칭 | 같은 묶음·상대 색 종류의 Rz(π) 짝 위치가 `SYMMETRY_TOLERANCE` 1e-12 안에 있다                                                                                                                                                                                        |

시작 프리셋이 피하는 GARDEN 공 자리(`RED_KEEP_OUT`, 파랑은 `mirrorKeepOut`)는 사각형 X [1.72176, 1.79286] × Y [−1.79286, −1.50404] m이다. Y 끝 −1.50404는 공 넷의 바깥 끝(−1.54401 + 0.03555 = −1.50846)보다 넓은 CAD 값 그대로다(`biobuzz.ts` 주석). `GARDEN_POLLEN_EDGE = INNER_HALF − 2r = 1.72176`(그 사각형의 x 경계): `[가정: GARDEN POLLEN 자리를 시작 프리셋에서 피함]` 규칙이 아니다(G304는 GARDEN 접촉을 허용한다). CAD 공 자리 1.7241이면 벽 관중석 쪽 프리셋 끝에 붙인 로봇이 첫 공과 2.3 mm 겹쳤다(6a에서 바꿈).

---

## 4. 시즌과 관계없는 상수 총표

### 4.1 `elements/elementData.ts`

| 항목                        | 값            | 단위    | 상수                                 | 상태·근거                                                                                                                                                                                                                            |
| --------------------------- | ------------- | ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 월드 공 한도                | 64            | 개      | `MAX_WORLD_ELEMENTS`(`worldSpec.ts`) | `[결정: BIOBUZZ 경기 요소 전체(POLLEN 40 + NECTAR 16 = 56)보다 넉넉히]`                                                                                                                                                              |
| 로봇 프리로드 한도          | 4             | 개      | `MAX_PRELOADS`(`worldSpec.ts`)       | BIOBUZZ 로봇마다 POLLEN 4개(사용자 결정 11/13)                                                                                                                                                                                       |
| 로봇 섬 공 행 한도          | 96            | 행      | `MAX_COUPLED_ROWS`                   | `[결정: 결합 8개 하위 단계 1.5 ms 예산]` 바닥의 공 하나는 로봇·바닥 짝으로 6행, 붙은 공끼리 짝이 공마다 3행이지만 인테이크가 벽에 끼운 공은 15–18행이라 E2E 쐐기 84행. 6a 리뷰 2에서 72 → 96(쐐기 첫 하위 단계가 72일 때보다 빨랐다) |
| 공끼리 섬 조밀 풀이 행 한도 | 60            | 행      | `ISLAND_DENSE_ROWS`                  | `[결정: 조밀 풀이 비용 O(n³)]` 넘으면 PGS                                                                                                                                                                                            |
| PGS 반복                    | 30            | 회      | `PGS_SWEEPS`                         | `[결정]` 고정 횟수, 행 순서                                                                                                                                                                                                          |
| 잠들기 속력                 | 0.005(5 mm/s) | m/s     | `SLEEP_SPEED`                        | `[가정: 5 mm/s·0.5 s]` 쉬는 공의 반올림 떨림보다 크고 눈에 띄는 굴림보다 작다                                                                                                                                                        |
| 잠들기 시간                 | 0.5           | s       | `SLEEP_TIME`                         | 같음                                                                                                                                                                                                                                 |
| 반발 문턱                   | 0.25          | m/s     | `V_BOUNCE`                           | `[가정: Box2D·Box3D restitution threshold 1 m/s보다 작은 공 크기 어림]` 이 접근 속도 아래는 반발하지 않는다                                                                                                                          |
| 접선 순응 비                | 0.01          | —       | `TANGENT_COMPLIANCE_RATIO`           | `[가정: 정지 마찰이 미끄럼 없이 붙되 LCP 조건수를 낮추는 작은 값]` γ_t = 이 값/m(m은 접촉의 유효 질량)                                                                                                                               |
| 공기 밀도                   | 1.2           | kg/m³   | `AIR_DENSITY`                        | `[가정: 대회장 실내 공기]`(20 °C 해수면)                                                                                                                                                                                             |
| 다시 넣기 지연              | 3 000 000 000 | ns(3 s) | `REENTRY_DELAY_NANOS`                | `[가정: 3 s, 사용자 결정 11/13]` 규칙(CM 10.8.2)은 시간을 정하지 않는다                                                                                                                                                              |
| 필드 밖 높이                | −0.05         | m       | `OUT_OF_FIELD_Z`                     | `[결정: 벽 바닥 깊이 WALL_BASE_DEPTH와 같다]`                                                                                                                                                                                        |
| 자리 간격                   | 5e-4          | m       | `SLOT_GAP`                           | `[결정: 놓은 공이 겹치지 않을 만큼, 반올림 여유]` 자동 프리로드·다시 넣기 자리 사이·벽·로봇 외곽에서 띄움                                                                                                                            |
| 넓은 단계 칸                | 0.125         | m       | `BROAD_PHASE_CELL`                   | `[결정: POLLEN 지름 0.071 m의 두 배 안쪽, 3×3 칸 질의]`                                                                                                                                                                              |
| 감쇠비 ζ                    | 1             | —       | `CONTACT_DAMPING_RATIO`              | `[가정: 임계 감쇠 1. 위플 공 판 시험의 감쇠 측정이 없어 튀지 않고 가장 빨리 가라앉는 값]` c = 2ζ√(k·m)                                                                                                                               |
| 끼임 문턱                   | −0.01         | —       | `PINCH_NORMAL_DOT`                   | `[결정: 바닥과 벽처럼 직각인 두 면은 끼임이 아니다. 0보다 조금 아래라 껍질 GJK 법선의 반올림이 직각 짝을 끼임으로 만들지 않는다]` acos(−0.01) = 90.57°                                                                               |
| 되찾는 빠르기               | 0.002         | m/s     | `PINCH_RECOVERY_SPEED`               | `[가정: 눌린 공이 모양을 되찾는 빠르기, 실측 없음]` 7.4절                                                                                                                                                                            |
| 접촉 스프링 배수            | 2             | —       | `CONTACT_STIFFNESS_PER_PLATE`        | `[결정: 직렬 접촉 둘]`                                                                                                                                                                                                               |

### 4.2 `elementWorld.ts`·`ballContact.ts`·`broadPhase.ts`의 안 상수

| 항목                                 | 값    | 단위  | 상수                                          | 상태·근거                                                                                                         |
| ------------------------------------ | ----- | ----- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 굴림·회전 저항을 걸 상대 각속도 하한 | 1e-30 | rad/s | `MIN_RESIST_RATE`                             | `[결정: 보이는 회전보다 한참 작고 비정규 수(1e-308)보다 한참 크다]`                                               |
| 공기 힘을 걸 속력 하한               | 1e-9  | m/s   | `MIN_AIR_SPEED`                               | `[결정: 항력이 보이지 않는 속력. 비정규 수 근처의 나눗셈을 피한다]`                                               |
| 이력 스프링 되돌림 비 하한           | 0.01  | —     | `MIN_PINCH_RETURN`                            | `[결정: e = 0이면 k_U가 무한대다. 0.01은 e = 0.1, 쓰는 반발 계수(0.3 이상)보다 작다]`                             |
| 격자 반폭                            | 2.5   | m     | `GRID_HALF`(`broadPhase.ts`)                  | `[결정: BIOBUZZ 벽 바깥면 1.81 m와 필드 밖으로 날아간 공(나감 판정 전)을 덮는다]`. 칸 수 40 × 40 = ceil(5/0.125)² |
| 충돌 여유                            | 1e-3  | m     | `COLLISION_MARGIN`(`bodyCollision.ts`)        | 몸체 충돌과 같은 값. 예측 띠 = ‖v_rel‖·h + 1 mm                                                                   |
| 시작 겹침 알림 깊이                  | 1e-3  | m     | `OVERLAP_NOTICE_DEPTH`(`bodyCollision.ts`)    | 5 `collisionOverlap`과 같은 규칙. `elementCrushed`가 시작 겹침보다 이만큼 넘게 더 눌릴 때만                       |
| GJK 최소 거리                        | 1e-9  | m     | `GJK_MIN_DISTANCE`(`collision3d.ts`)          | 구–상자·원기둥·구의 "겹침 판정"과 법선 나눗셈 하한으로도 씀                                                       |
| 접선 방향 속도 문턱                  | 1e-3  | m/s   | `SLIP_DIRECTION_SPEED`(`bodyCollision.ts`)    | `frictionTangent`: 상대 미끄럼이 이보다 크면 그 방향                                                              |
| 지난 t1 유지 문턱                    | 0.5   | —     | `TANGENT_KEEP_MIN`(`bodyCollision.ts`)        | 새 접선 평면에 투영한 길이 이 이상이면 지난 t1                                                                    |
| 조밀 LCP 시작 상태 바꾸기 문턱       | 32    | 회    | `DENSE_RESTART_ITERATIONS`(`articulation.ts`) | `[결정: 6a 최종 확인 2]` 고른 시작 상태에서 이만큼 넘게 돈 엇갈림 회차는 다음부터 시작 상태를 바꾼다. 11.4절      |

### 4.3 `denseLcp.ts`의 상수

| 항목                              | 값                                   | 상수                            | 상태·근거                                                                                                                                                                     |
| --------------------------------- | ------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 정칙화                            | 1e-9 × A_ii(대각에 더함)             | `DENSE_LCP_REGULARIZATION`      | `[결정: articulation.ts solveBoxLcp의 LCP_REGULARIZATION과 같은 크기. 공 행의 A는 순응·공 질량으로 거의 늘 양정치라 근접점 반복 없이 정칙화한 해를 쓴다. 충격 차이는 1e-9배]` |
| 상보성·경계 판정 상대 허용 오차   | 1e-12                                | `DENSE_LCP_TOLERANCE`           | solveBoxLcp와 같은 1e-12. tolW = 1e-12·max(1, max_i \|b_i\|), tolL = 1e-12·max(1, 유한한 \|lo_i\|·\|hi_i\| 가운데 가장 큰 값)                                                 |
| Murty 규칙 반복 상한              | 2000                                 | `DENSE_LCP_MAX_ITERATIONS`      | 표시 없음                                                                                                                                                                     |
| Murty 상한 뒤 대체 규칙 반복 상한 | 500                                  | `DENSE_LCP_FALLBACK_ITERATIONS` | `[결정: 6a 리뷰 3]` 11.3절                                                                                                                                                    |
| 일찍 쓰는 규칙 시작               | 32                                   | `DENSE_LCP_SINGLE_AFTER`        | `[결정: 6a 최종 확인 2]`                                                                                                                                                      |
| 일찍 쓰는 규칙 길이               | 96                                   | `DENSE_LCP_SINGLE_ITERATIONS`   | 같음                                                                                                                                                                          |
| 묶이지 않은 행 판정               | 1e-12 × √(A_ii·A_jj)                 | `DENSE_LCP_DECOUPLED`           | `[결정: 수직인 법선·접선의 내적 반올림(1e-16)보다 크고 풀이에 보이는 결합보다 훨씬 작다]`                                                                                     |
| 블록 전환을 그만두는 반복         | 200                                  | `DENSE_LCP_MURTY_AFTER`         | 표시 없음                                                                                                                                                                     |
| 블록 전환의 개선 없음 허용        | 3                                    | `DENSE_LCP_TRIES`               | 표시 없음                                                                                                                                                                     |
| 시험 훅                           | `{ fallback, early, iterations }` 수 | `DENSE_LCP_COUNTERS`            | 제품 코드는 쓰지 않는다. Murty 상한을 넘어 대체 규칙으로 간 풀이 수, 일찍 쓰는 규칙을 쓴 풀이 수, 행이 묶인 풀이들의 주축 반복 합                                             |
| 작업 배열 최소 크기               | 64                                   | `work()`·`factorCapacity()`     | 표시 없음. 성능용 재사용 버퍼(값은 매번 덮어써서 결과에 영향이 없다)                                                                                                          |

---

## 5. 하위 단계 한 번의 풀이 순서

### 5.1 `PhysicsWorld`의 배선(`world.ts`)

| 순서    | 일                                                            | 비고                                                                        |
| ------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1       | 바퀴·(평면 경로의) 벽·구조물 행 `contacts()`                  | 3c·4ab. 부유 기저일 때만                                                    |
| 2       | 접촉 틀 `art.contactFrames()` 한 번                           | 몸체 충돌(`BodyCollision.rows`)과 공이 같이 쓴다                            |
| 3       | 몸체 충돌 행(5)                                               | `blocking`에는 섀시–정적 법선 행만                                          |
| 4       | `elements.prepare(art, frames, h)`로 공 행을 만들어 붙임      | 행은 몸체 충돌 행 뒤, `blocking` 거르기 뒤. `ContactSet.elements = coupled` |
| 5       | `art.step(h, drive, contacts)`                                | 로봇과 로봇 섬 공이 한 상자 LCP                                             |
| 6       | 몸체 충돌(5단계)의 `afterStep` 감시                           | 바닥·윗면 누름 합력 감시. 공과 관계없음                                     |
| 7       | `elements.finish(art, h, failed, tEnd)`                       | 로봇 섬 공의 u⁺ 읽기, 나머지 섬 풀이, 적분, 잠들기, 필드 밖                 |
| 틱 경계 | `elements.tick(t, …)`(다시 넣기) → `elements.updateDisplay()` | `integrate` 끝. 알림은 `drainElements`                                      |

관절·바퀴가 없는 세계(동역학 없는 로봇)는 `elementSubstep`: `prepare(null, null, h)`(예외면 `worldError` + `failSubstep()`) → `finish(null, h, false, tEnd)`. 로봇은 시작 자세의 정적 섀시이고 `dynamic = false`다.

실패 가두기: 몸체 충돌 행이 던져도(접촉 틀은 있음) 공은 접촉을 만든다. 접촉 틀 계산이 던지면(frames null) 공도 멈춘다(`failSubstep`). `prepare`가 던지면 `worldError` + `failSubstep`이고 로봇은 공 행 없이 간다. 로봇 쪽 `art.step`이 던지면 속도를 모두 0으로 두고 `finish(art, h, true, tEnd)`가 로봇 섬 공 속도를 0으로 두고 나머지 섬은 푼다.

### 5.2 `ElementWorld.prepare` 단계

| 단계    | 일                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0       | 넓은 단계 격자를 짓는다(필드 안 공만). 깨어 있는 공의 최대 속력 `maxSpeed`를 재 둔다(넓은 단계 여유)                               |
| 1       | 로봇 짝(잠든 공 포함, 몸체·충돌체 순서). 움직이는 로봇 몸체(`dynamic`)에 닿은 잠든 공은 깨운다(`wake`)                             |
| 2       | 깨어 있는 공(큐)에 닿은 잠든 공을 깨운다(공끼리 퍼짐, 큐가 자라며 반복)                                                            |
| 빠른 길 | 큐가 비었으면(모두 잠들고 움직이는 로봇에 닿은 공도 없음) 짝 상태 지도를 모두 비우고 행 없이 돌아온다                              |
| 3       | 자유 예측 u*(깨어 있는 공)                                                                                                         |
| 4       | 접촉(공 오름차순: 로봇 짝 → 정적 → 뒤 번호 공). 던지면 그 공만 `failBall`(속도 0, 짝 모두 뺌, `worldError "element e<i>: …"`)      |
| 5       | 굴림·회전 저항(앞 하위 단계 법선 충격, 상한 있는 각충격)                                                                           |
| 6       | `pinchedContacts`(끼임·붙들림) → 접촉마다 행 만들기(`contactRows`). 던지면 그 짝만 뺌(`worldError "element <토큰>: …"`)            |
| 7       | 섬 나누기 → `softenOneWay` → 다음 하위 단계로 넘길 지도 교체(접선·도착·peak·깊이·restoring) → 로봇 섬 행을 `ContactRow[]`로 내보냄 |

### 5.3 자유 예측(`predict`)

깨어 있고 필드 안인 공마다 한 번.

| 식                                                                               | 설명                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------- |
| u*_v = v + h·(g_vec + (F_drag + F_Magnus)/m), g_vec = (0, 0, −`GRAVITY` 9.80665) | 중력·공기는 명시적                                 |
| u*_ω = ω                                                                         | 공기 토크 없음                                     |
| F_drag = −½·ρ·C_d·(π r²)·‖v‖·v                                                   | ‖v‖ > 1e-9일 때만                                  |
| C_L = min(C_Lmax, s·r·‖ω‖/‖v‖)                                                   | Magnus 양력 계수                                   |
| F_Magnus = ½·ρ·(π r²)·C_L·‖v‖²·(ω × v)/‖ω × v‖                                   | ‖ω‖ > 1e-30이고 ‖ω × v‖ > 1e-30일 때만. 방향 ω × v |

공기·잠들기는 `ElementWorldOptions.air`·`sleep`(시험이 끈다, 기본 켬)으로 끈다.

### 5.4 적분(`finish`의 끝, `rotate`)

| 식                                 | 설명                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| x⁺ = x + h·v⁺                      | 깨어 있고 필드 안인 공                                                                           |
| q⁺ = normalize(q + ½h·(0, ω⁺) ⊗ q) | (0, ω)⊗q = (−ω·q_v, q_w·ω + ω×q_v). `Math.sqrt`만 쓴다(새 sin·cos 없음). ω가 정확히 0이면 건너뜀 |

---

## 6. 넓은 단계와 좁은 단계

### 6.1 넓은 단계(`broadPhase.ts` `BallGrid`)

필드 [−2.5, 2.5]² 위 0.125 m 정수 격자(40 × 40 칸). 칸마다 `head`·`next` Int32Array 연결 목록이고 큰 번호부터 넣어 목록이 작은 번호부터 나온다(Map·Set 순서 없음). 격자 밖 공은 가장자리 칸에 넣는다(자르기). 질의는 축 정렬 상자 [x0, x1] × [y0, y1]가 걸친 칸을 x 칸 오름차순 → y 칸 오름차순 → 칸 안 번호 오름차순으로 방문한다. 같은 공은 한 칸에만 있어 한 번만 나온다.

| 질의                                  | 범위                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 로봇 몸체의 근처 공 `robotCandidates` | 몸체 원점 둘레 reach = rMax + 최대 공 반지름 + (몸체 속력 + maxSpeed)·h + 1 mm 안의 공(구 거름 포함). 번호 오름차순. 몸체 속력 = ‖v_linear‖ + ‖ω‖·rMax |
| 깨우기 퍼짐                           | reach = r_e + 최대 공 반지름 + (‖v_e‖·h + 1 mm). `sphereSphere`가 접촉 띠 안이면 깨움                                                                  |
| 공끼리 짝                             | reach = r + 최대 공 반지름 + 2·maxSpeed·h + 1 mm. 뒤 번호(f > e)이고 깨어 있는 공만 후보, 번호 오름차순                                                |

### 6.2 좁은 단계 함수(`ballContact.ts`)

모두 접촉 하나 `{ normal, point, separation }`을 내고 점은 두 표면의 가운데 `c − n·(r + 분리/2)`다. 띠(band) 안이 아니면 null. 띠 = ‖v_rel‖·h + `COLLISION_MARGIN`(1 mm).

| 상대                              | 함수             | 방법                                                                                                                                                                                                                                                |
| --------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 바닥(z = 0, 법선 +z)              | `sphereFloor`    | 분리 = c_z − r                                                                                                                                                                                                                                      |
| 벽 넷(축 정렬 상자)               | `sphereBox`      | 상자 위 최근접점 q(좌표마다 자름)에서 법선 (c − q)/\|c − q\|, 분리 = \|c − q\| − r. 중심이 안(\|c − q\| ≤ 1e-9)이면 가장 얕은 면(−x, +x, −y, +y, −z, +z 순, 엄격한 <)의 바깥 법선, 분리 = −depth − r. 할당 없이 낸다(공이 가장 자주 닿는 정적 형상) |
| 구조물(볼록 껍질)                 | `sphereHull`     | `collideShapes(공 = 선분 길이 0인 캡슐, 껍질)`: 얕으면 GJK, 깊으면 SAT                                                                                                                                                                              |
| 로봇 Box·Convex·Mesh 충돌체(껍질) | `sphereHull`     | 같음                                                                                                                                                                                                                                                |
| 로봇 Capsule 충돌체               | `sphereCapsule`  | `collideShapes`의 `collideCapsules`(선분 최근접)                                                                                                                                                                                                    |
| 로봇 Cylinder 충돌체              | `sphereCylinder` | 정확한 구–원기둥. 아래                                                                                                                                                                                                                              |
| 다른 공                           | `sphereSphere`   | 분리 = 중심 거리 − r_e − r_f, 법선 (c_e − c_f)/d, d ≤ 1e-9면 +z                                                                                                                                                                                     |

정적 형상(벽·구조물·바닥)은 `collision3d.ts` `staticShapes(field)` 중 `joints: true`인 것(벽 넷 `w0`(+x)·`w1`(−x)·`w2`(+y)·`w3`(−y), carrier field이고 solid ∨ occludes인 구조물 `s<순번>`, 바닥 `fl`)이다. 벽은 `x ∈ [innerHalf, innerHalf + thickness] × … × z ∈ [−0.05, height]` 상자(`WALL_BASE_DEPTH` 0.05)라 BIOBUZZ에서 높이 0.29576 m까지다(위 레일 윗면). 판 inset·이음은 무시한다.

정확한 구–원기둥(`sphereCylinder`): 뚜껑 중심 a·b, 반지름 R, 납작한 뚜껑, 축 e = (b − a)/L, t = e·(c − a), 반지름 성분 ρ = ‖(c − a) − t·e‖.

| 경우                                   | 법선·분리                                                                                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 중심이 밖(t < 0 또는 t > L 또는 ρ > R) | 원기둥 위 가장 가까운 점 q(축 좌표를 [0, L]로, 반지름 성분을 R로 자름: 옆면·뚜껑·모서리가 이 하나로 나옴)에서 법선 (c − q)/\|c − q\|, 분리 \|c − q\| − r                               |
| 중심이 안(또는 표면 위)                | 가장 가까운 면(뚜껑 a → 뚜껑 b → 옆면 순, 엄격한 <)의 바깥 법선, 분리 = −(그 면까지 깊이) − r. 축 위(ρ = 0)에서 옆면으로 나가면 축에 수직인 정해진 축(\|d_k\|가 가장 작은 축과의 외적) |

공이 아닌 짝(벽·구조물·바닥·자기 충돌·프리로드 겹침 검사)은 Cylinder를 외접 32각 기둥(`CYLINDER_COLLIDER_SIDES` 32, 반지름 R/cos(π/32) = 1.0048·R, 64점 `prismHull`)으로 본다(14절).

### 6.3 짝 하나의 값(`Contact`)

접촉마다 아래 값이 정해진다. 마찰 μ는 공 표면 μ와 상대 면의 평균(Unity Average)이다.

| 상대        | 스프링 k(N/m)                               | 유효 질량           | 반발 e                        | 마찰 μ                          | 심 깊이           | 비고                                                                                |
| ----------- | ------------------------------------------- | ------------------- | ----------------------------- | ------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| 바닥 `fl`   | 2·plateStiffness                            | 공 질량             | `restitution.floor`           | (μ_공 + `FLOOR_FRICTION` 0.4)/2 | 0.3·r             | `[가정: FLOOR_FRICTION 0.4, 사용자 결정 11/10, 타일 위 알루미늄·PLA, 실측 없음]`    |
| 벽·구조물   | 2·plateStiffness                            | 공 질량             | `restitution.hard`            | (μ_공 + 정적 형상 friction)/2   | 0.3·r             | 벽 friction = `WALL_FRICTION` 0.4, 구조물 = `FieldStructure.friction`(0.4 `[가정]`) |
| 로봇 충돌체 | 2·plateStiffness                            | 공 질량             | `restitution.robot`           | (μ_공 + 충돌체 friction)/2      | 0.3·r             | 충돌체 friction 기본 `DEFAULT_COLLIDER_FRICTION` 0.4                                |
| 다른 공     | (k_e·k_f)/(k_e + k_f), k = 2·plateStiffness | m_e·m_f/(m_e + m_f) | (e_element,e + e_element,f)/2 | (μ_e + μ_f)/2                   | 0.3·r_e + 0.3·r_f | 두 공이 같이 눌린다 [결정]                                                          |

로봇 짝의 유효 질량을 공 질량으로 잡은 것은 로봇이 공보다 훨씬 무겁기 때문이다(`docs/assumptions.md`: 근사). 로봇 짝의 `dynamic`은 `art !== null && (몸체 ≥ 0 이거나 부유 기저)`다. 고정 기저 로봇의 섀시와의 짝(j ≡ 0)은 움직이지 않는 정적 짝이라 로봇 섬에 들어가지 않는다. 로봇 몸체 점의 속도(공 중심 자리)는 `art.pointVelocity`, 각속도는 몸체 ω이고 모두 필드 축으로 돌린다.

---

## 7. 법선 행

법선 행의 목표와 순응은 `ballContact.ts`의 `normalRow`가 정한다. 입력: 분리 g(δ = −g), 자유 예측 접근 속도 v_n* = J·u*(음수 = 다가옴), 앞 하위 단계 도착 접근 속도 `impact`, h, 스프링 k, 유효 질량 m, 감쇠비 ζ, 심 깊이, 반발 e, 반발 문턱 `V_BOUNCE`, `pinched`, `peak`, `previous`(앞 하위 단계 깊이), `free`, `restoring`.

### 7.1 부드러운 법선(`springRow`)

c = 2ζ√(k·m). γ = 1/(h·(h·k + c)).

| 경우          | 목표(target)                                    | 순응 |
| ------------- | ----------------------------------------------- | ---- |
| 침투 δ > 0    | k·δ/(h·k + c) = (h·k/(h·k + c))·δ/h             | γ    |
| 떨어짐(δ ≤ 0) | −g/h(예측 목표: 다음 하위 단계에 닿을 위치까지) | γ    |

ODE ERP·CFM 꼴의 암시 스프링–감쇠이고 정지 상태 힘 = k·δ(충격 = h·k·δ)다.

### 7.2 결정 순서(`normalRow`)

hysteresis = `pinched` 또는 `peak` 있음. peak_in = max(peak − `PINCH_RECOVERY_SPEED`·h, δ)(있을 때만, 하위 단계마다 되찾음).

| 순서 | 조건                                           | 결과                                                                                                                          |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A1   | hysteresis가 아니고 `impact` < −V_BOUNCE       | 강체: target = e·(−impact) − (1 + e)·max(g, 0)/h, γ = 0, `bounced`                                                            |
| A2a  | hysteresis가 아니고 v_n* < −V_BOUNCE이고 g ≤ 0 | 강체: target = e·(−v_n*), γ = 0, `bounced`                                                                                    |
| A2b  | 같고 g > 0이고 (−v_n*)·h > g                   | 강체: target = −g/h, γ = 0, `arrival` = v_n*(다음 하위 단계 반발에 씀)                                                        |
| B    | δ ≥ 심 깊이                                    | `free`면 `coreRecoveryRow`. 아니면 강체 target 0, γ = 0, `crushed`; hysteresis이고 눌림 주기(`loading`)면 peak = max(peak, δ) |
| C1   | δ < 심, hysteresis 아님                        | `springRow`                                                                                                                   |
| C2   | δ < 심, hysteresis                             | `pinchedSpringRow`(7.3절). `restoring`이었고 새 peak > δ면 `restoring` 표시를 이어 감                                         |

반발 두 단계(A1–A2b): 표면까지 오게 한 접근 속도를 적어 두고(arrival) 다음 하위 단계에 e·\|v\|로 튄다. 위치·속도 모두 맞고 표면에 한 하위 단계(1 ms) 머문다. 문턱 아래(‖v_n*‖ < 0.25 m/s)는 튀지 않는다. `[결정: 한 행 투기 반발 e·(−v_n*) − (1+e)·분리/h는 속도에 위치 보정을 섞어, 닿기 전 하위 단계에 접근 속도를 깎고 다음 하위 단계가 그 깎인 속도로 반발해 0.5 m 낙하가 e² 대신 약 0.03배만 튀었다]`.

### 7.3 이력 스프링(`pinchedSpringRow`)

끼인 공의 눌림 힘을 Walton–Braun 선형 이력으로 낸다. ρ = returnRatio(e) = clamp(e², 0.01, 1).

| 기호                           | 식                                                                      |
| ------------------------------ | ----------------------------------------------------------------------- |
| 탄성(눌림) 선                  | F = k·δ(= `springRow`)                                                  |
| 풀림 선                        | F = k_U·(δ − δ₀), k_U = k/ρ, δ₀ = peak·(1 − ρ)                          |
| 두 선의 만남                   | δ = peak에서 힘이 같다(k_U·peak·ρ = k·peak)                             |
| 한 주기에 돌려주는 변형 에너지 | ½·k_U·(peak − δ₀)² = ρ·½·k·peak² (e²)                                   |
| 풀림 감쇠                      | c = 2ζ√(k·m)(k_U가 아니라 k로 낸 값, 탄성선 그대로)                     |
| 풀림 순응                      | γ = 1/(h·(h·k_U + c))                                                   |
| 풀림 목표                      | δ > δ₀: k_U·(δ − δ₀)/(h·k_U + c). δ ≤ δ₀: −(δ₀ − δ)/h(δ₀까지 예측 목표) |

주기 규칙: δ ≤ 0(떨어짐)이면 peak를 버린다. peak가 없거나 δ ≥ peak이면 탄성선이고 `loading`(이미 주기 안이거나, 앞 하위 단계에 이 짝이 있었고 지금 더 깊다)이면 peak = δ로 주기를 시작한다. `[가정: 끼인 공의 되돌림 에너지 비 = e²]` 6a 리뷰 2: 공 질량 기준 임계 감쇠만이면 13.6 kg 판의 유효 감쇠비가 약 0.03이라 판이 0.89배로 되튀었다(변형 에너지의 79 %). 이 모델에서는 질량과 관계없이 e 안팎으로 되튄다(면 0.5 → 0.50–0.46배, 바닥 → 0.43–0.38배, 0.05–0.33 m/s).

`[결정: 6a 최종 확인. 시작 겹침(첫 하위 단계)이나 잠에서 깬 공처럼 이미 겹친 채 처음 나온 짝은 눌린 이력이 아니다. 그 겹침을 peak로 적으면 벌어진 두 면(쐐기) 사이 프리로드가 쉼 깊이 peak·(1 − ρ)에 박힌 채 남아 INIT 겹침 결과('밀려납니다')와 달랐다]` — `loading`이 앞 깊이 표(`depths`)로 이것을 가른다.

### 7.4 되찾기(`PINCH_RECOVERY_SPEED`)

`[가정: 눌린 공이 모양을 되찾는 빠르기, 실측 없음]` 하위 단계마다 peak를 2 mm/s × h만큼, 지금 깊이까지만 줄인다. 풀림 선의 쉼 깊이 δ₀ = peak·(1 − ρ)가 2 mm/s × (1 − ρ)로 물러나 공이 탄성 평형 m·g/k로 돌아온다.

| 면          | e    | 1 − e² | 쉼 깊이가 물러나는 빠르기 | 심 10.665 mm에서 평형까지                                                         |
| ----------- | ---- | ------ | ------------------------- | --------------------------------------------------------------------------------- |
| 바닥        | 0.30 | 0.91   | 1.82 mm/s                 | 약 5.9 s                                                                          |
| 벽·구조물   | 0.64 | 0.5904 | 1.18 mm/s                 | 약 9 s                                                                            |
| 로봇·공끼리 | 0.5  | 0.75   | 1.5 mm/s                  | 로봇: 계산상 약 7.1 s(10.665/1.5). 공끼리는 두 공 합 21.3 mm라 약 14 s(주석 기록) |

이유: `[6a 최종 확인: 줄이지 않으면 바닥에 눌렸다 놓인 공·쐐기에 걸친 공처럼 떨어지지 않는 행이 쉼 깊이(심 가까이 눌렸으면 약 9 mm)에 박힌 채 남았다. 무거운 몸체가 누른 공이 풀리는 빠르기(0.05 m/s로 민 13.6 kg 판에서 행마다 약 10 mm/s)보다 느려야 이력 손실이 남는다]`. 0.05 m/s보다 느리게 누르면 누르는 동안 모양을 되찾아 판이 e보다 더 되튄다(0.03 m/s 0.53배, 0.01 m/s 0.67배, 0.005 m/s 0.78배; 바닥은 0.89배까지). 되찾는 중인 공은 잠들기 시간을 세지 않는다(`Pending.recovering`). 되찾는 빠르기는 고치지 않고 두었다(그 값이 치르는 값이다).

### 7.5 심 행과 되찾기(`coreRecoveryRow`)

심까지 눌린 공은 변형 에너지를 잃었다(심 넘는 충돌은 소성). 붙드는 것이 없는 심 행(`free`)은 강체로 버티지 않고 이력 스프링의 쉼 깊이를 지금 깊이로 다시 잡는다.

| 단계  | 식                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------- |
| loss  | max(1 − ρ, 0.01)                                                                               |
| peak′ | `restoring`이고 peak > δ면 넘겨받은 peak, 아니면 δ/loss(→ δ₀ = peak′(1 − ρ) = δ, 그 순간 힘 0) |
| 행    | `pinchedSpringRow({…, peak: peak′})`에 `crushed: true`, `restoring: true`를 붙임               |

붙들림(`free`가 아님)은 둘: (a) 실행의 첫 하위 단계부터 심 이상 겹친 짝(`startCrush`: 강체 그대로, INIT 경고 `worldPreloadEmbedded`가 맡음), (b) 끼임과 같은 꼴이지만 반대쪽 접촉이 단단한 행(`pinchedContacts`의 `held`, 7.6절). 이유(`[결정: 6a 리뷰 3]`): 누르던 몸체가 떠난 뒤에도 심 행(목표 0)이 밀어내지 않아 공이 심 깊이에 박힌 채 잠들었다(13.6 kg 판이 0.34 m/s 넘게 바닥에 누른 공은 10.7 mm 가라앉은 채, 0.6 출력 넘게 GARDEN 공에 달려든 상자 섀시 메카넘의 공은 10.7–11.3 mm 벽 안에 남았다). 눌린 깊이의 탄성 힘 k·δ(POLLEN 약 64 N)를 쓰면 25 g 공이 약 1.6 m/s로 튀고, 강체 행으로 2 mm/s씩 벌리면 심 아래로 나올 때 0.29–1.15 m/s로 튀었다(지금 0.004 m/s). 풀림 선 하나면 심 위아래가 같은 식이라 힘이 뛰지 않는다.

시작 겹침 처리(`startCrush` 지도): 첫 하위 단계의 접촉 가운데 δ ≥ 심인 짝을 적고(`recordStartCrush`), 그 짝은 `free`가 아니다. `elementCrushed`는 그 짝이 시작 깊이보다 `OVERLAP_NOTICE_DEPTH` 1 mm 넘게 더 눌릴 때만 낸다(`[결정: 6a 리뷰 2, 5 collisionOverlap과 같은 규칙]`). 심 아래로 풀리면(δ < 심, `crushed` 아님) 지운다(그 뒤의 눌림은 진짜 눌림).

### 7.6 끼임과 붙들림 판정(`pinchedContacts`)

접촉마다 그 법선(공 쪽으로, 공끼리 짝의 f 쪽은 −n)이 같은 공의 다른 접촉 법선과의 내적이 `PINCH_NORMAL_DOT`(−0.01)보다 작으면 그 공 쪽에서 끼였다(blocked 비트: e 쪽 1, f 쪽 2). 행마다 본다(`[결정: 6a 리뷰 2. 공마다 보면 y로 붙은 이웃이나 위에 얹힌 공 때문에 그 축과 직각으로 로봇이 쳐 내는 행까지 반발을 잃어 가운데 공이 (1 + e)·v 대신 판 속도로만 밀렸다]`).

| 판정             | 규칙                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pinched[k]`     | e 쪽이 끼였고 (공끼리가 아니거나 f 쪽도 끼임). 공끼리 짝은 두 공 모두 끼였을 때만(한 공이라도 튀어 나갈 수 있으면 반발)                    |
| `held[k]`        | 끼임과 같은 꼴이지만 반대쪽 접촉이 **단단**할 때만. 계산은 심 이상 눌린 접촉이 있는 하위 단계에만 한다(없으면 모두 0)                      |
| 단단함(`firm`)   | 로봇·정적 형상과의 접촉이거나(닿기만 해도), 그 너머의 공이 다시 단단한 것에 받쳐진 공끼리 접촉(받침을 공 사슬로 따라가는 가장 작은 고정점) |
| `held` 공끼리 짝 | 두 공 모두 받쳐졌을 때만                                                                                                                   |

결과: 판 → 공 → 공 → 벽 사슬은 모두 붙들리고, 판이 떠나면 벽 쪽 공까지 모두 풀린다. 위에 얹힌 공의 무게는 붙들지 않는다(더미 아래 공도 되찾는다). `[결정: 끼임(반대쪽에 무엇이든 닿음)으로 가르면 되찾은 공이 옆에 붙어 쉬거나 위에 얹혀 있는 동안 그 너머의 공이 심에 남았다(판이 0.5 m/s로 민 공 두 개 줄에서 벽 쪽 공 10.8 mm, 더미의 아래 공 10.7 mm). 로봇은 닿아 있기만 해도 센다: 멈춰 있는 로봇을 되찾기가 밀면 안 된다]`.

### 7.7 하위 단계 사이에 넘기는 짝 상태

짝 토큰(또는 행 키)을 키로 하는 지도이고 이번 하위 단계에 나온 짝만 다음으로 넘긴다(`tangents`·`arrivals`·`peaks`·`depths`·`restoring`은 `prepare`의 7단계에서, `impulses`·`states`는 `finish`에서 교체). 예외로 `startCrush`는 교체하지 않고 짝이 심 아래로 풀릴 때(7.5절) 그 항목만 지운다. `failSubstep`·`failBall`은 던지기 전에 쓴 것을 모두 버린다(앞 깊이만 남으면 다음 하위 단계에 접촉이 없던 짝이 그다음에 '앞에 있었다'로 보이기 때문: 6a 리뷰 3).

| 지도         | 값                      | 쓰임                                         |
| ------------ | ----------------------- | -------------------------------------------- |
| `tangents`   | 접선 t1(V3)             | 마찰 접선 선택(8절)                          |
| `arrivals`   | 접근 속도(음수)         | 반발 두 단계의 둘째 단계                     |
| `peaks`      | peak(m)                 | 이력 스프링 주기                             |
| `depths`     | 깊이(m)                 | 눌림 주기 시작 판정 `loading`                |
| `restoring`  | 집합                    | peak가 심에서 되찾기를 시작하며 다시 잡은 값 |
| `impulses`   | 행 키 → λ(앞 하위 단계) | 굴림·회전 저항, 마찰 상자의 첫 회차 법선     |
| `states`     | 행 키 → LCP 상태        | 섬 LCP 시작 상태                             |
| `startCrush` | 짝 토큰 → 시작 깊이     | 시작 겹침                                    |

### 7.8 한쪽 행(`softenOneWay`)

결합 한도로 로봇 섬에서 빠진 공(한쪽 섬)은 로봇(풀이 뒤 속도)·로봇 섬에 넣은 공(풀린 속도)을 정해진 속도로 본다. 그런 몸체와 잇는 강체 법선 행(심·반발·도착)은 늘 `springRow`(부드러운 법선: 심·반발 없음)로 바꾸고 그 짝의 `arrival`을 지운다. 이유(`[결정: 6a 리뷰]`): 강체 행이면 반대쪽 강체 행(벽 쪽 심 등)과 함께 풀 수 없는 LCP가 되어 정칙화한 풀이가 큰 충격(8.6e4 N·s)을 내 공이 수백 m/s로 날았다. 정해진 속도의 몸체는 공에 밀려나지 않으므로 공은 정해진 몸체에 밀리고 끼이면 눌릴 뿐 튀어 나가지 않는다(로봇은 그 공을 느끼지 못한다).

---

## 8. 마찰 행과 굴림·회전 저항

### 8.1 마찰 상자 행(`contactRows`)

접촉의 μ > 0이면 법선 행 뒤에 접선 행 둘.

| 항목    | 값                                                                                                                                                                                                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 접선 t1 | `frictionTangent(n, v_상대_접선, 지난 t1)`(`bodyCollision.ts`): 접점의 상대 미끄럼(공 점속도 − 상대 점속도)의 접선 성분이 1e-3 m/s보다 크면 그 방향, 아니면 지난 t1을 새 접선 평면에 투영한 길이가 ≥ 0.5이면 그 방향, 아니면 normalize(n × e_k)(\|n_k\|가 가장 작은 필드 축, 같으면 작은 k). Duff·Frisvad 기저는 n_z = 0에서 뛰어 쓰지 않는다 |
| 접선 t2 | n × t1                                                                                                                                                                                                                                                                                                                                        |
| 행      | target 0, lo = hi = 0(상자는 −μ·λ_n … +μ·λ_n으로 정함), 순응 γ_t = `TANGENT_COMPLIANCE_RATIO`/m_유효, `friction: { normal: 법선 행 키, mu }`                                                                                                                                                                                                  |
| 상자    | ±μ·max(0, λ_n). 상자가 0이면 행을 넣지 않는다(`externalRows`·`solveIsland`)                                                                                                                                                                                                                                                                   |
| 엇갈림  | 2회: 1회차 법선은 앞 하위 단계의 같은 키 충격을 이번 h로 바꾼 값(`previous = λ_prev·h/h_prev`), 2회차는 1회차 법선(articulation `pass(previous, 0)` → `pass(once.impulses, 1)`)                                                                                                                                                               |

접촉점에서 공 중심까지의 팔: e는 −s_e·n, f는 +s_f·n(s_e = r_e + 분리/2, s_f = r_f + 분리/2, 정적·로봇 짝은 s_f = 0). 마찰 행의 공 부분: a_e = [d; (−s_e·n) × d], a_f = [−d; −((s_f·n) × d)]. 법선 행의 공 부분은 각 성분이 0이다([d; 0], [−d; 0]).

### 8.2 굴림·회전 저항(`resist`, 명시 각충격)

LCP 행이 아니다. 접촉마다 앞 하위 단계의 이 짝 법선 충격 λ′ = λ_prev·h/h_prev(h_prev = `lastH`)로 자유 예측의 각속도를 줄인다. λ′ > 0일 때만.

| 항목                  | 식                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 상대 각속도           | rel = ω_e* − ω_상대(공끼리는 ω_f*, 로봇은 몸체 각속도, 정적은 0)                                                                |
| 법선 성분 / 접선 성분 | w_n = rel·n, along = n·w_n, tangent = rel − along                                                                               |
| 유효 관성 역          | inv = 1/I_e (+ 1/I_f, 공끼리)                                                                                                   |
| 굴림 저항 충격 한도   | μ_rr·r·λ′(공끼리는 두 공 값의 평균 μ_rr·평균 반지름)                                                                            |
| 회전 저항 충격 한도   | μ·r_s·λ′(μ는 이 접촉의 평균 마찰, r_s는 `spinRadius`, 공끼리는 평균)                                                            |
| 적용                  | impulse = min(한도, size/inv); ω_e* −= (impulse/I_e)·axis/size, 공끼리면 ω_f* += (impulse/I_f)·axis/size. 접선·법선 성분에 각각 |
| 건너뜀                | size ≤ 1e-30(`MIN_RESIST_RATE`)이면 해당 성분을 하지 않음                                                                       |

로봇은 반작용을 받지 않는다. `[가정: 공 굴림 저항 토크(μ_rr·r·N, 1 N에 약 2 mN·m)는 로봇 동역학에 보이지 않는다. 명시적 근사라 LCP 행을 늘리지 않는다]` 정상 굴림에서 마찰은 미끄럼 없이 붙으므로 굴림 감속은 μ_rr·g/(1 + I/(m r²))이 된다(0.3 m/s²).

---

## 9. 로봇과의 결합(Schur 보수)

### 9.1 식(`articulation.ts`, 명세 §2.5)

KKT [[M̂, 0], [0, M_E]]·[v⁺; u⁺] = [p; p_E] + [Jᵀ; J_Eᵀ]λ에서 M_E가 대각(공 질량 행렬)이라 공 몸체를 Schur 보수로 접는다. 행 k는 로봇 열 j_k(좌표 수 m개), 공 부분 목록 `elements`(공 순번과 6-벡터 a), 순응 γ_k를 가진다.

| 기호 | 식                                                                                    |
| ---- | ------------------------------------------------------------------------------------- |
| A_kl | j_kᵀ·M̂⁻¹·j_l + Σ_{e ∈ P_k ∩ P_l} a_kᵀ·W_e·a_l + δ_kl·γ_k                              |
| b_k  | j_k·v* + Σ_e a_k·u_e* − target_k                                                      |
| 풀이 | w = A·λ + b(= 행 속도 − 목표), lo ≤ λ ≤ hi, 상보. 마찰 행 상자는 ±μ·max(0, 법선 충격) |
| v⁺   | v* + Σ_k M̂⁻¹·j_kᵀ·λ_k                                                                 |
| u_e⁺ | u_e* + W_e·Σ_{k ∋ e} a_k·λ_k                                                          |

`M̂ = M + h·D + h²·K`(암시 오일러). 행 열 y_k = M̂⁻¹·j_kᵀ는 같은 분해 동안 j 배열마다 한 번만 푼다(`columns` 캐시). j가 모두 0인 행(공끼리·정적 행)은 M̂⁻¹을 풀지 않는다. 플라이휠 감속·롤러 반력이 이 결합에서 저절로 나온다. 좌표 하나 행의 속도 맞추기(자유 행의 반올림 잡음 지우기)는 공 부분이나 순응이 있는 행에는 하지 않는다(공 행은 목표가 j·v만의 것이 아니다).

### 9.2 `Articulation` 변경 요약

| 항목                                    | 내용                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContactRow`                            | `elements?: ElementPart[]`(공 순번과 a), `compliance?: number`를 더했다. 둘 다 없으면 5 전과 같은 행 객체(`externalRows`가 키를 두지 않음)                                                                                                                             |
| `ContactSet.elements?: CoupledElements` | `{ count, invMass[], invInertia[], velocity[6·count] }`(velocity = 자유 예측 u*)                                                                                                                                                                                       |
| `isElementRow`                          | 공 부분이나 순응이 있는 행. `constrained`는 `coupled !== undefined`이거나 어느 행이 공 행이면 `constrainedCoupled`를 탄다. 아니면 `solveBoxLcp`와 3b–5 연산 그대로                                                                                                     |
| `constrainedCoupled`                    | `coupledMatrix`(행렬 만들기·캐시) → b 계산 → 시작 상태 고르기 → `solveDenseLcp` → v⁺·u⁺ 갱신                                                                                                                                                                           |
| `coupledMatrix`                         | 같은 분해·같은 공 묶음에서 행마다 j(값)·공 부분(같은 배열)·순응이 앞 풀이와 같으면 앞 행렬을 그대로 쓴다(엇갈림 2회차가 상자만 바뀐 같은 행을 다시 푼다). 버퍼 재사용                                                                                                  |
| `writeCoupledMatrix`                    | 위 삼각(k ≤ l)만 계산해 대칭 칸에 같은 값을 적는다. 0인 항은 건너뛰되 칸 값은 모든 짝을 도는 식과 같다(바이트 동일, `coupledMatrix.test.ts`가 바꾸기 전 식과 비트로 대조). 공 블록은 `addElementBlocks`가 공마다 오름차순 행 목록으로 같은 공을 가리키는 행끼리만 더함 |
| `clampLimits`                           | 한계 충격 풀이에도 공 블록과 순응을 넣는다: 밖에서 준 행의 b에 a·u⁺ + γ·λ_본, A에 elementBlock과 γ, 상자 [lo − λ_본, hi − λ_본]. 이어서 u에 W·a·λ_충격을 더한다. 슬라이드를 한계에 박으며 공을 미는 관절이 공을 파고들지 않게 한다                                     |
| `elementVelocities()`                   | 마지막 `step`의 로봇 섬 공 u⁺ 사본(없으면 null). `ElementWorld.finish`가 읽음                                                                                                                                                                                          |
| `contactImpulse(key)`                   | 앞 하위 단계 행 충격(굴림·회전 저항과 마찰 상자가 읽음)                                                                                                                                                                                                                |
| 시작 상태 고르기                        | 마찰 상자 엇갈림 회차(0·1)마다 보통은 바로 앞 풀이가 끝난 상태. 11.4절                                                                                                                                                                                                 |

### 9.3 로봇 섬 결합 한도와 넣기 순서(`ElementWorld.islands`)

| 단계       | 규칙                                                                                                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | 공끼리 짝으로 union-find(`all`). 움직이는 로봇 몸체(`dynamic`)에 닿은 공의 뿌리(robotRoots)를 모은다                                                                                                                                                                                                      |
| 2          | 후보 = 깨어 있고 뿌리가 robotRoots인 공                                                                                                                                                                                                                                                                   |
| 3          | 후보의 행 수 합(`total`)이 `MAX_COUPLED_ROWS`(96) 이하면 후보 모두 로봇 섬. 아니면 `limited`                                                                                                                                                                                                              |
| 4(limited) | 우선순위: 로봇에 직접 닿음(내림) → 가장 깊은 짝(분리 오름차순) → 번호. 차례를 돌며 공을 넣는다: **로봇에 직접 닿았거나 이미 넣은 공에 닿은 공만**, 그 공의 비용(로봇·정적 행 + 넣은 공과의 행)이 한도에 들어갈 때. 넣은 공이 늘면 차례를 다시 돈다. 들어가지 않는 공은 건너뛰고 뒤의 더 싼 공을 계속 본다 |
| 5          | 알림 `elementCouplingLimit`(`limited`일 때)                                                                                                                                                                                                                                                               |
| 6          | 나머지(넣지 못한) 공의 섬: 넣은 공과의 짝은 잇지 않는 union-find(`rest`)의 뿌리 = 가장 작은 번호. 섬은 뿌리 오름차순                                                                                                                                                                                      |
| 7          | 행 분류: 모든 부분의 공이 넣은 공이면 로봇 섬 행(`robotRows`), 아니면 그 행의 넣지 못한 공이 속한 섬의 행(넣은 공 속도·로봇 속도는 `fixed`로 정해진 몫)                                                                                                                                                   |
| 8          | `softenOneWay`(7.8절)                                                                                                                                                                                                                                                                                     |

`[결정: 6a 리뷰 2. 건너뛴 공 너머의 공을 넣으면 그 공은 로봇 풀이에 바닥 행만 들고 들어가고, 건너뛴 공의 한쪽 섬은 그 공을 정해진 속도로 봐서 사슬로 미는 힘이 이어지지 않았다]` 한도 안이면 로봇에 닿은 공과 그 공끼리 이어진 공은 모두 로봇 섬이라 한쪽 행이 없다.

---

## 10. 섬과 잠들기

### 10.1 `UnionFind`(`islands.ts`)

뿌리는 두 뿌리 가운데 작은 번호(합치는 순서와 관계없다). 경로 압축은 뿌리를 바꾸지 않는다. 공끼리 짝(`c.f ≥ 0`)만 합친다.

### 10.2 로봇에 닿지 않은 섬의 풀이(`finish`와 `solveIsland`)

섬마다 차례: 시험 훅 `ElementWorld.islandHook` → 공 하나·접촉 하나 빠른 길 `solveSingleContact` → 일반 풀이. 섬이 던지면 그 섬만 속도 0 + `worldError "element island e<뿌리>: …"`(충격 0)이고 다른 섬·로봇은 그대로 간다. 풀이가 비유한 수를 내면 `'diverged'`로 던진다.

| 풀이                 | 조건                                                                                                     | 내용                                                                                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `solveSingleContact` | 섬의 공 하나, 행 1–3개(법선 + 같은 접촉의 접선), 비대각이 `DENSE_LCP_DECOUPLED`(1e-12·√(A_kk·A_ll)) 아래 | 공 질량이 대각이고 법선 n과 접선 t1 ⟂ t2 ⟂ n이라 A가 대각이다. λ_k = clamp(−b_k/(A_kk(1 + ε)), lo, hi), ε = 1e-9, 마찰 행 상자 = ±μ·max(0, λ_n)(법선 행 값으로 같은 연산). 일반 풀이의 엇갈림 두 회차를 거친 해와 같은 연산 순서. 해당하지 않으면 거짓(일반 풀이로)                                                            |
| 조밀(dense)          | 행 ≤ `ISLAND_DENSE_ROWS` 60                                                                              | A = Σ aᵀW a + γ(블록 `block`, 행 순서), b = 행 속도(자유 예측) − 목표, 시작 상태 = 앞 하위 단계 상태. 마찰 상자 엇갈림: 1회차 법선 = `previous(법선 키)`, 2회차 법선 = 1회차 해. 2회차 생략 조건(`sameSecondPass`): 모든 마찰 행이 1회차에 자유 상태이고 \|λ\| ≤ μ·max(0, λ_n)이면 같은 해(정칙화한 행렬이 양정치라 해가 하나) |
| PGS                  | 행 > 60                                                                                                  | 고정 30회 Gauss–Seidel, 행 순서. 앞 하위 단계 충격(마찰은 그 법선 상자 안으로 자른 값)으로 시작. 각 행: w = 행 속도 + γλ − 목표, λ ← clamp(λ − w/(A_kk + γ), 상자). 알림 `elementIslandLarge`                                                                                                                                  |

섬 풀이의 결과 충격은 `impulses`(행 키 → λ)로 넘겨 다음 하위 단계의 굴림·회전 저항·마찰 상자에 쓴다.

### 10.3 잠들기(`sleepStep`)

| 규칙    | 값                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------- |
| 느린 공 | ‖v‖ < 5 mm/s이고 ‖ω‖·r < 5 mm/s이고 이번 하위 단계에 이력 스프링 풀림 선에서 모양을 되찾는 중이 아님                      |
| 타이머  | 느리면 += h, 아니면 0                                                                                                     |
| 섬      | 공끼리 짝으로 묶은 그룹(`groups`)                                                                                         |
| 잠듦    | 그룹의 모든 깨어 있는 공이 타이머 ≥ 0.5 s이고 움직이는 로봇에 닿은 공이 없으면 함께 잠듦. v = ω = 정확히 0                |
| 깨움    | 움직이는 로봇 몸체(`dynamic`)에 닿은 잠든 공(1단계), 깨어 있는 공에 닿은 잠든 공(2단계 퍼짐), 다시 넣은 공은 깨어 있는 채 |
| 시작    | GARDEN은 잠든 채, 프리로드는 깬 채 시작                                                                                   |
| 끔      | `ElementWorldOptions.sleep = false`(시험)                                                                                 |

잠든 공은 넓은 단계 격자에는 들어가지만 예측·접촉 행(자기 쪽)을 만들지 않고, 로봇 짝만 검사한다. 되찾는 중인 공은 잠들기 문턱(5 mm/s)보다 느려도 잠들지 않는다(`recovering`). `[결정: 6a 최종 확인. 되찾기(PINCH_RECOVERY_SPEED)가 잠들기 문턱보다 느려 가라앉은 채 잠들었다]`.

---

## 11. 조밀 상자 LCP(`denseLcp.ts`)

공 행이 있는 상자 LCP(로봇 섬과 공끼리 섬)의 풀이다. `articulation.ts` `solveBoxLcp`(3b–5의 기준 해시가 기대는 풀이)는 바꾸지 않고, 공 행이 있는 새 경로만 이 풀이를 쓴다. 같은 블록 주축 전환 + Murty 틀이지만 근접점 반복이 없고(정칙화한 해) 작업 배열을 다시 써서 행이 수십 개인 로봇 섬에서 빠르다.

### 11.1 문제와 풀이

w = (A + ε·D)·λ + b, lo ≤ λ ≤ hi. λ_i = lo면 w_i ≥ 0, hi면 w_i ≤ 0, 사이면 w_i = 0. D = diag(A), ε = 1e-9. A는 행 우선 m×m, 대칭 양반정치(정칙화 뒤 양정치).

| 단계             | 내용                                                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 시작 상태        | start 값 0 → 아래(유한 lo일 때), 2 → 위(유한 hi일 때), 1 → 자유, 그 밖(3·모름) → lo = 0이면 아래, hi = 0이면 위, 아니면 자유                                                                                                                                                                    |
| 대각 검사        | 대각이 양수가 아니면 던짐 `'dense LCP: constraint row has no effect'`                                                                                                                                                                                                                           |
| 묶이지 않은 풀이 | 모든 i ≠ j에서 \|A_ij\| ≤ 1e-12·√(A_ii·A_jj)이면 행마다 value = −b_i/(A_ii(1 + ε))를 [lo, hi]로 자른다(반복 0)                                                                                                                                                                                  |
| 자유 행 풀이     | (A + εD)_FF·λ_F = −(b_F + A_FB·λ_B)를 콜레스키(LLᵀ)로. A_FB·λ_B는 경계 행 오름차순으로 더함. 양정치가 아니면 던짐 `'dense LCP: matrix not positive definite'`                                                                                                                                   |
| L 앞부분 재사용  | L의 p행은 자유 행 0..p의 부분 행렬 값만으로 정해지므로, 다음 분해의 앞 k행이 같은 값이면(같은 풀이 안은 자유 행 번호, 다른 풀이는 저장한 부분 행렬 값과 `Object.is` 비교) 그 L 행을 다시 쓴다. 같은 값에 같은 연산이라 비트로 같다(Murty 단계는 가장 큰 첨자 하나만 바뀌므로 그 뒤만 다시 분해) |
| 위반 행          | 자유 행이 상자를 벗어난 것(λ < lo − tolL 또는 > hi + tolL), 경계 행의 w가 부호가 틀린 것(아래 경계 w < −tolW, 위 경계 w > tolW). w = b_i + ε A_ii λ_i + Σ_j A_ij λ_j                                                                                                                            |
| 마무리           | λ를 [lo, hi]로 자른다. 상태(아래·자유·위)와 반복 수(시작 상태에서 답까지 상태를 바꾼 횟수)를 돌려줌                                                                                                                                                                                             |
| 던짐             | 반복 ≥ 2500이면 `'dense LCP: constraint solve did not converge'`                                                                                                                                                                                                                                |

### 11.2 반복 차례(iteration = 0, 1, 2, …)

| 반복 번호 | 규칙                                                                                                                                                                                                                           | 상수                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 0–31      | 블록 전환(Júdice–Pires): 위반 행 전부를 뒤집는다. 위반 행 수가 지금까지 최소(`best`)보다 줄면 `best`를 갱신하고 `tries`를 3으로, 아니면 `tries`가 남은 동안 `tries`를 줄이며 전부 뒤집고, 다 쓰면 가장 큰 첨자 하나만 뒤집는다 | `DENSE_LCP_TRIES` 3                                           |
| 32–127    | 일찍 쓰는 규칙: 가장 크게 어긋난 행 하나만 뒤집는다(자유 행은 상자를 벗어난 만큼 × A_ii, 경계 행은 \|w\|)                                                                                                                      | `DENSE_LCP_SINGLE_AFTER` 32, `DENSE_LCP_SINGLE_ITERATIONS` 96 |
| 128–199   | 다시 블록 전환(`best`·`tries` 상태를 이어서)                                                                                                                                                                                   | —                                                             |
| 200–1999  | Murty 최소 첨자 규칙: 가장 큰 첨자 하나만 뒤집는다                                                                                                                                                                             | `DENSE_LCP_MURTY_AFTER` 200, `DENSE_LCP_MAX_ITERATIONS` 2000  |
| 2000–2499 | 상한 뒤 대체 규칙: 가장 크게 어긋난 행 하나만 뒤집는다                                                                                                                                                                         | `DENSE_LCP_FALLBACK_ITERATIONS` 500                           |
| ≥ 2500    | 던짐                                                                                                                                                                                                                           | —                                                             |

뒤집는 규칙: 자유 행은 λ < lo면 아래, 아니면 위 경계로, 경계 행은 자유로.

### 11.3 상한 뒤 대체 규칙의 이유(`[결정: 6a 리뷰 3]`)

Murty 최소 첨자 규칙은 끝나는 것이 보장되지만 주축 수가 많을 수 있다. E2E 손 씬 로봇이 GARDEN 공으로 달려들어 공이 섀시·롤러·벽·바닥·이웃 공 사이에 끼는 하위 단계의 로봇 섬 LCP(85–102행) 열여섯이 Murty로 2061–8744번이었다(상한에서 던지면 그 하위 단계의 로봇·관절·로봇 섬 공 속도가 0이 되었다: 출력 0.3–1 × 시작 자리 아홉 × 인테이크 켬·끔 144번 가운데 16번, 끝 로봇 자세 차이 0.4–2.4 mm). 같은 문제를 상한에서 대체 규칙으로 이으면 6–64번에 끝났고, 같은 144번과 다른 시작 자리 64번에서 실패가 없다. 대체 규칙은 끝나는 것이 보장되지 않아 상한을 둔다(Murty 상한에 걸린 조건이 나쁜 무작위 문제 144개 가운데 138개가 152번 안에 끝나고 여섯은 돌고 돌아 던진다). Murty 상한 안에 끝나는 풀이는 이 규칙에 닿지 않아 바이트 그대로다.

### 11.4 일찍 쓰는 규칙과 시작 상태 고르기(`[결정: 6a 최종 확인 2]`)

| 항목                         | 내용                                                                                                                                                                                                                                                                                                                | 측정(주석 기록)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 일찍 쓰는 규칙(32번 뒤 96번) | 32번 안에 끝나지 않은 풀이는 이 규칙으로 돈 뒤 원래 차례를 이어 간다                                                                                                                                                                                                                                                | 인테이크 켜고 출력 0.4로 6 s 미는 여덟 실행에서 32번 넘은 풀이 416개가 블록 전환·Murty로 33–1264번(중앙값 147), 이 규칙으로 33–83번(중앙값 48). 실행마다 주축 반복 5446–16667 → 3221–6407번, 50 ms 넘는 틱 8–30 → 1–9개, 출력은 바이트 그대로(끈 여덟은 1526–2441 → 1049–1193번, 하나는 반올림 너머로 다름). 달려들기 144번에서 Murty 상한에 걸리던 풀이 26개(실행 24번)가 모두 상한 전에 끝남(주축 반복 합 349557 → 157364, 50 ms 넘는 틱 186–199 → 6–22개, 가장 긴 틱 425–487 → 88–97 ms) |
| 문턱 위치                    | `DENSE_LCP_SINGLE_AFTER`는 `DENSE_RESTART_ITERATIONS`(32)보다 작지 않게 둔다                                                                                                                                                                                                                                        | 더 일찍(8·16)이면 E2E 오프라인 출력이 바뀌고 6 s 실행 여덟 가운데 8번에서는 여섯이 2.6만–5.8만 번, 16번에서는 둘이 4.6만–5.2만 번으로 주축 반복이 늘었다                                                                                                                                                                                                                                                                                                                                    |
| 시작 상태 고르기             | 마찰 상자 엇갈림 회차(`round` 0·1)마다 보통은 바로 앞 풀이가 끝난 상태(1회차는 앞 하위 단계의 2회차, 2회차는 이번 1회차)에서 시작. 그 시작에서 `DENSE_RESTART_ITERATIONS`(32)번 넘게 돈 회차는 다음부터 앞 하위 단계의 같은 회차가 끝난 상태(없는 키는 `lcpStates`)에서 시작하고, 그 시작에서 또 넘게 돌면 되돌린다 | 로봇이 공 넷을 벽에 누른 채 멈춰 서면 엇갈림 1·2회차 답이 같은 두 상태를 오가 2회차 주축이 매번 60–600번(104행, 번마다 약 0.2 ms)이었다. 시작 상태 고르기만으로 달려들기 96번 모두 가장 느린 0.5 s 창이 0.39배 이상·실행 전체 0.76배 이상, `worldError` 없음                                                                                                                                                                                                                                |
| 결과의 성질                  | 시작 상태는 답을 찾는 길만 바꾼다(정칙화한 행렬이 양정치라 답 λ는 하나). 힘이 거의 걸리지 않는 행(판정 허용 오차 안에서 두 경계가 모두 맞는 행: 롤러와 벽 사이 비틀림 마찰)은 끝 상태가 길에 따라 달라, 문턱을 넘은 실행은 고친 전과 반올림 너머로 다를 수 있다(같은 입력이면 같은 출력은 그대로)                   | 달려들기 144번 가운데 40번 출력이 반올림 너머로 다름(끝 로봇 자세 차이 중앙값 4e-10 m, 최대 0.25 mm). 기준 해시 아홉과 E2E 손 씬 오프라인 출력은 바이트 그대로                                                                                                                                                                                                                                                                                                                              |

---

## 12. 필드 밖과 다시 넣기

### 12.1 필드 밖 판정(`outOfField`, 하위 단계 끝마다)

| 항목      | 값                                                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 나감 조건 | \|x\| > outer + r 또는 \|y\| > outer + r 또는 z < `OUT_OF_FIELD_Z`(−0.05). outer = innerHalf + thickness = 1.79286 + 0.02705 = 1.81991 m(벽 바깥면). BIOBUZZ POLLEN은 \|x\| 또는 \|y\| > 1.85546 m |
| 처리      | 물리에서 뺌(`out = 1`, 잠듦·타이머 해제, v = ω = 0), 표시에서 숨김(표식 비트 2), 나간 자리 (x, y)와 시각 tEnd(ns)를 적음. 알림 `elementOutOfField {kind}`                                          |

### 12.2 다시 넣기(`tick`, 틱 경계에서)

나간 지 `REENTRY_DELAY_NANOS`(3 s)가 지난 공마다(번호 오름차순):

| 단계    | 규칙                                                                                                                                                                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 구역    | `reentryZones(field, kind)`: 그 종류가 `reentry`가 아니거나 시즌에 없으면 `[]`(NECTAR는 밖에 그대로). `FieldSpec.zones`의 `loadingZone`이 벽에 닿은 것(배열 순서: BIOBUZZ 빨강 → 파랑). `nearestReentryZone`: 나간 자리에서 구역 가운데 거리가 가장 가까운 것(같으면 앞 구역 = 빨강)                             |
| 자리    | 구역 사각형이 닿은 벽의 안쪽 법선 n. 벽을 따른 방향 t = ẑ × n = (−n_y, n_x). 구역 벽 방향 반폭 halfWidth, reach = halfWidth − r. 깊이 depth = innerHalf − r − `SLOT_GAP`(공 중심이 벽 안쪽 면에서 r + 5e-4). 자리 간격 pitch = 2r + `SLOT_GAP` = 0.0716 m. 가운데(0), +t(1), −t(1), +2, −2 … k·pitch ≤ reach까지 |
| 빈 자리 | 첫 `slotFree`: 로봇 외곽 프리즘(자리 높이 z − r < 로봇 높이면 원–다각형 분리 < `SLOT_GAP`이면 막힘), 로봇 충돌체(분리 < `SLOT_GAP`이면 막힘, 원기둥은 정확한 `sphereCylinder`), 필드 안 다른 공(중심 거리 − r_f − r < `SLOT_GAP`이면 막힘). 없으면 다음 틱에 다시 본다(시뮬레이션은 멈추지 않음)                 |
| 넣기    | 위치 = 자리, 사원수 단위, v = ω = 0, 깨어 있음(`asleep = 0`, 타이머 0), `out = 0`. 알림 `elementReentered {kind}`                                                                                                                                                                                                |

BIOBUZZ 빨강 LOADING ZONE(rect X [−1.1939, −0.59695], Y [−1.79286, −1.51346], 벽 −Y, 안쪽 법선 (0, 1), t = (−1, 0)): 구역 가운데 x = −0.89542, 자리 y = −1.75681(= −(1.79286 − 0.03555 − 0.0005)), halfWidth = 0.298475, reach = 0.262925 → 7자리, 순서 x = −0.89542, −0.96702, −0.82382, −1.03862, −0.75222, −1.11022, −0.68062. 파랑은 Rz(π)로 (0.89542, 1.75681) 등 부호 반전(정확히 짝).

| 알림      | 코드                | params                                  |
| --------- | ------------------- | --------------------------------------- |
| 나감      | `elementOutOfField` | kind(`pollen`·`nectarRed`·`nectarBlue`) |
| 다시 넣음 | `elementReentered`  | kind                                    |

NECTAR가 밖으로 나가면 표식만 남고 다시 넣지 않는다(`NECTAR_PHYSICS.reentry` 주석: "NECTAR는 사람 선수가 넣는다(6d). 6a는 밖에 그대로 둔다"). 시각은 틱의 `tNanos` 차로만 센다(벽시계 없음). 렌더러 Console 문구는 `console.notices.sim.*`다.

---

## 13. 표시 상태·프로토콜·알림

### 13.1 표시 상태(`gameState.ts`)

| 항목                    | 값                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 공 하나의 칸 수         | 7: x, y, z, qw, qx, qy, qz (`GAME_POSE_STRIDE`)                                                                                                |
| 정수 단위               | 값 × 10⁴를 `Math.round`(−0 없이), 0.1 mm·사원수 1e-4 (`GAME_POSE_SCALE`) `[결정: 표시에 0.1 mm·1e-4면 충분, 정수라 JSON이 짧고 바이트로 같다]` |
| 표식 비트               | 1 잠듦(`ELEMENT_FLAG_ASLEEP`), 2 필드 밖(`ELEMENT_FLAG_OUT`)                                                                                   |
| revision                | 줄인 값·표식이 바뀔 때만 늘어난다(`updateDisplay`). 지난번 뒤 아무 공도 움직이지 않았으면(`moved` false) 다시 줄이지 않는다                    |
| 표시 자세               | 정수를 m로 되돌리고 사원수를 다시 정규화(줄인 사원수가 0이면 단위 사원수)                                                                      |
| 검증 `isValidGameState` | revision ≥ 0 정수, poses 길이는 7의 배수의 정수(공 ≤ 64개), flags가 있으면 공 수만큼 0–3 정수. count를 주면 공 수가 같아야 한다                |

`PhysicsWorld.gameState()`는 공이 없는 세계에서 null, `elementSnapshot()`은 전체 정밀도 `SimElementState[]`(−0 없이), `elementTickState()`는 6c 이음새(중심·반지름·종류·표식 비트, 공 순서)다. `ElementWorldOptions.initial`은 시험·6d 이어 가기의 시작 상태다.

### 13.2 `gameState` 이벤트(`play.ts`, `session.ts`)

`{ type: 'gameState', runId, tNanos, revision, poses: number[], flags?: number[], final?: SimElementState[] }`.

| 규칙    | 값                                                                                                                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 간격    | pose와 같은 throttle 하나 `POSE_INTERVAL_MS` 16 ms(약 60 Hz). 일시 정지·Step 멈춤·끝에는 바로 보냄                                                                                           |
| 같은 틱 | pose와 같은 틱의 값을 함께 보낸다(`[6a 리뷰: 따로 두면 공이 쉬다 움직이기 시작할 때 gameState만 새 박자로 나가 실려 가는 공이 로봇과 다른 틱으로 그려졌다]`). 자세가 틀린 틱에도 공은 보낸다 |
| 거름    | 모양이 맞고(공 수는 실행의 첫 상태 `gameCount`와 같음) revision이 바뀐 것만. 배열은 복사. 틀린 상태는 버리고 마지막 좋은 상태를 둠                                                           |
| `flags` | 모두 0이면 생략                                                                                                                                                                              |
| `final` | 끝에 `settleWorld` 뒤 pose 다음·phase·finished 전에 `elementSnapshot()`(모양이 틀리면 뺌, 읽기 예외는 `worldError` 한 번). 끝에만 같은 revision을 다시 보낸다                                |

### 13.3 알림 코드(`SimNoticeCode`, 같은 code·params는 실행마다 한 번, 실행당 최대 `MAX_SIM_NOTICES` 64)

| 코드                   | params | 뜻                                                                                                                                                                       |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `elementOutOfField`    | kind   | 공이 필드 밖으로 나가 물리에서 뺐다                                                                                                                                      |
| `elementReentered`     | kind   | 경기 요원이 나간 공을 가까운 LOADING ZONE에 다시 넣었다                                                                                                                  |
| `elementCrushed`       | 없음   | 공이 딱딱한 심 깊이까지 눌렸다(시작 겹침은 1 mm 넘게 더 눌릴 때만)                                                                                                       |
| `elementCouplingLimit` | 없음   | 로봇에 닿은 공 행이 결합 한도(96)를 넘어 일부 공을 한쪽으로만 풀었다                                                                                                     |
| `elementIslandLarge`   | 없음   | 공 더미가 커서 PGS로 풀었다                                                                                                                                              |
| `worldError`           | detail | `element island e<뿌리>: …`, `element e<번호>: …`, `element <토큰>: …`, `element <토큰>`(비유한), `dense LCP: …`(11.1절), `diverged`, `joint dynamics diverged: element` |

---

## 14. 세계 설명 v7과 Cylinder Collider

### 14.1 v7의 `elements`(`worldSpec.ts`)

`WORLD_SPEC_VERSION` 7(v6 이하는 받지 않음). 선택 칸 `elements?: { groups: SimElementGroup[]; preloads: SimPreloadSpec[] }`. 키가 없으면 결과에도 없다(v6과 같은 값, 판만 7).

| 검사       | 값                                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groups`   | 길이 ≤ `ELEMENT_GROUPS.length`(1), 값은 알려진 묶음(`'garden'`), 유일                                                                                                                                                  |
| `preloads` | ≤ `MAX_PRELOADS` 4. 원소 `{ kind: 'pollen', body, position }`: `kind`는 `'pollen'`만, body는 정수 −1 ≤ body < joints.length(−1 = 로봇 좌표, ≥ 0 = 관절 틀 q = 0), position은 유한하고 각 성분 \|·\| ≤ `MAX_COORD` 10 m |
| 시즌       | `resolveSeason(field.season).elements`가 null이 아님, 프리로드 종류를 그 시즌이 앎                                                                                                                                     |
| 총 공 수   | 고른 묶음의 시즌 배치 수 + 프리로드 수 ≤ `MAX_WORLD_ELEMENTS` 64                                                                                                                                                       |
| 오류 순서  | 충돌체 칸을 모두 읽은 뒤 `elements`를 읽는다(기존 오류 순서 유지)                                                                                                                                                      |

물리 값·배치는 렌더러가 보내지 않는다(시뮬레이터가 `resolveSeason`으로 푼다). `SimElementState`(6d 이음새)는 `{ kind, position, orientation[w,x,y,z], velocity, angularVelocity, asleep, out }`다.

### 14.2 Cylinder Collider 중 공과 관련된 값

Unity에 없는 임시 편차다. 칸은 Capsule과 같다(Center·Radius·Height·Direction X·Y·Z, `PROJECT_VERSION` 14).

| 항목                                                 | 값                                                                                                           | 위치                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 세계 설명 `SimCollider`                              | `{ kind: 'cylinder', a, b, radius, friction }`(a·b는 몸체 틀의 두 뚜껑 중심)                                 | `worldSpec.ts`                                                                            |
| 끝점 간격                                            | ≥ `MIN_CYLINDER_SEGMENT` = `MIN_CYLINDER_HEIGHT`/2 = 5e-4 m                                                  | `worldSpec.ts`                                                                            |
| 높이 하한                                            | 1e-3 m(납작한 뚜껑까지 전체 길이, 상자 크기 하한과 같음) `[결정]`                                            | `MIN_CYLINDER_HEIGHT`                                                                     |
| 반지름 범위                                          | [5e-4, 1] m(캡슐과 같음)                                                                                     | `MIN_CAPSULE_RADIUS`·`MAX_CAPSULE_RADIUS`                                                 |
| 끝점 좌표                                            | \|성분\| ≤ 10 m                                                                                              | `MAX_COORD`                                                                               |
| 씬 칸 범위                                           | center ±10 m, radius [5e-4, 1], height [1e-3, 20] m                                                          | `scene/collider.ts` `sanitizeCollider`                                                    |
| 공과의 짝                                            | 정확한 구–원기둥 최근접(6.2절). 로봇 몸체 짝은 `RobotShape.cylinder`(몸체 틀 끝점·반지름)를 C 틀로 옮겨 씀   | `ballContact.ts` `sphereCylinder`                                                         |
| 공이 아닌 짝(벽·구조물·바닥·자기 충돌·프리로드 겹침) | 외접 32각 기둥 `[가정: 외접 32각 기둥, 반지름 r/cos(π/32) = 1.0048·r]` 지금의 껍질 좁은 단계를 그대로 쓰려고 | `collision3d.ts` `CYLINDER_COLLIDER_SIDES` 32, `cylinderColliderPoints`(64점 `prismHull`) |
| 새 sin·cos                                           | 없음. 한 사분면 cos θ_k(k·11.25°)를 제곱근 식으로                                                            | `OCTANT_COS`·`OCTANT_SIN`, cos(π/32) = √(2 + √(2 + √(2 + √2)))/2                          |

정적 원기둥 구조물은 별개로 외접 16각 기둥(`cylinderPrism`, +1.96 %)이다. 플라이휠 시험에서 64점 볼록(=32각 외접 껍질)과 정확한 원기둥의 나가는 속도 차이는 5 % 안이고 정확한 원기둥이 이상 공식에 더 가깝다.

---

## 15. 프리로드(Preload Slot, 자동 배치, 겹침 판정)

### 15.1 씬 데이터(`scene/preload.ts`, `PROJECT_VERSION` 14)

| 항목          | 값                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 데이터        | `SceneObject.preload?: { kind: 'pollen'; enabled?: false; center: [x, y, z] }` — center는 오브젝트 로컬 틀(피벗·자기 축, m). 끈 것만 `enabled: false`(키 없음 = 켬)                                                |
| 둘 수 있는 곳 | group·assembly·part(로봇·CAD 루트는 안 됨: `canHavePreload`, 바퀴와 같은 규칙). 오브젝트마다 하나                                                                                                                  |
| 로봇당 한도   | `MAX_ROBOT_PRELOADS` = `MAX_PRELOADS` 4(끈 것 포함해 센 `canAddPreload`). 스토어는 한도를 강제하지 않는다(하이어라키 편집으로 넘을 수 있고, 세계 설명 빌더가 하이어라키 순서로 켠 앞 넷만 쓰고 `tooMany`로 알린다) |
| center 범위   | 성분 \|c\| ≤ `MAX_PRELOAD_EXTENT` 10 m로 자름(−0 없이). 키 순서 kind, enabled?, center                                                                                                                             |
| 스토어        | `setPreload`(불변, 같은 값·null은 떼기, 실행 취소 한 단계). `isPlaceholderScene`은 프리로드가 있으면 임시 씬이 아님                                                                                                |
| 파일          | v14: `kind`(enum)·`center`(유한한 수 셋)는 필수이고 `enabled`는 없거나 boolean(모양이 틀리면 `invalidData`, `true`는 정리가 지워 키를 두지 않음), 로봇·CAD 루트에 있으면 오류. v13 이하는 키 없음                  |
| 기본값        | `defaultPreload()` = `{ kind: 'pollen', center: [0, 0, 0] }`(Add Component가 붙일 때, 피벗 자리)                                                                                                                   |
| 생성 코드     | 관계없다(생성 코드·구성 XML·하드웨어 검증·사용처 모두)                                                                                                                                                             |
| 종류          | 지금은 POLLEN만(BIOBUZZ 프리로드 규칙)                                                                                                                                                                             |

### 15.2 자리 정하기(`play/worldElements.ts` `robotPreloads`, 인스펙터·로봇 카드·씬 뷰·INIT이 같이 씀)

문서·로봇·시즌마다 한 번 계산해 기억한다(`WeakMap<SceneObjects, Map<로봇id\0시즌, 결과>>`; 시험이 바꾼 시즌 판(얕은 복사)은 기억하지 않는다). 결과는 그 문서만으로 정한다(`[결정: 6a 리뷰. 부르는 쪽이 몸체 나누기를 넘기던 때는 핸들 드래그 중 카드가 드래그 전 문서의 관절 틀을 넘겨 INIT이 그린 자리에서 드래그한 만큼 떨어져 공이 생겼다]`).

| 규칙             | 내용                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 출처             | `slots`(팀 Preload Slot이 있음, 끈 것만 있어도), `auto`(자동 배치), `noRoom`(자동 배치 실패), `season`(시즌에 경기 요소 없음 또는 모르는 시즌)                                                                                                                                 |
| 팀 자리가 있으면 | 하이어라키 순서(문서 형제 순서의 깊이 우선)로 켠 자리를 `MAX_PRELOADS`개까지(앞 넷이 후보). 팀이 자리를 두었으면 모두 끄거나 쓸 수 없어도 자동 배치를 하지 않는다(팀이 정한 것을 바꾸지 않음)                                                                                  |
| 자리 위치        | 오브젝트 로컬 center를 로봇 좌표로(`robotObjectMatrix`: 충돌체 틀과 같은 곱셈 순서). 몸체 틀(`jointBodyFrames`: 가장 가까운 자신·상위 관절, q = 0)로 옮겨 세계 설명에 넣음 → 관절 하위 자리는 그 관절과 함께 움직인다                                                          |
| 빠지는 이유      | `disabled`(끔), `tooMany`(앞 넷 뒤), `belowFloor`(공 바닥 z − r < −`EDIT_OVERLAP_TOLERANCE` 1 mm), `outOfRange`(몸체 틀 좌표가 10 m 밖), `orphan`(어느 로봇의 하위도 아님). 앞 넷 가운데 빠진 자리를 다섯째가 채우지 않는다(어느 자리가 쓰이는지가 하이어라키 순서로만 정해짐) |
| 자동 배치        | 팀 자리가 하나도 없을 때 `autoPreloadSlots`(공유 함수, 15.3절)                                                                                                                                                                                                                 |
| 모든 면이 막힘   | 프리로드 없이 실행하고 `worldPreloadNoRoom`                                                                                                                                                                                                                                    |
| 심 깊이·반지름   | 시즌 POLLEN의 r(0.03555 m)·0.3·r(0.010665 m)                                                                                                                                                                                                                                   |

### 15.3 자동 배치(`spawn.ts` `autoPreloadSlots`)

사용자 결정 11/13: 팀이 자리를 두지 않으면 로봇 앞 타일, 막혔으면 뒤 → 왼쪽 → 오른쪽(`PRELOAD_FACES`).

| 항목       | 값·식                                                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 입력       | 로봇 외곽 다각형(로봇 좌표, CAD 루트 `cad.bounds` 8꼭짓점, 없으면 18 in), 필드, 시작 자세, 같은 실행에 생길 시즌 공 묶음                                                                                             |
| 면 안 자리 | `faceSlots`: 외곽 경계 상자(min/max X·Y) 기준. pitch = 2r + `SLOT_GAP` = 0.0716 m, offset = r + `SLOT_GAP` = 0.03605 m, along_k = (k − 1.5)·pitch(k = 0…3)                                                           |
| 앞         | x = maxX + offset, y = (minY + maxY)/2 + along, z = r                                                                                                                                                                |
| 뒤         | x = minX − offset, y 같음                                                                                                                                                                                            |
| 왼쪽       | x = (minX + maxX)/2 + along, y = maxY + offset                                                                                                                                                                       |
| 오른쪽     | x = 같음 + along, y = minY − offset                                                                                                                                                                                  |
| 막힘       | 필드 밖(\|x\| + r > innerHalf 또는 y), 공이 부딪히는 구조물(carrier field이고 solid ∨ occludes)과 `sphereShapeSeparation < 0`, 같은 실행에 생길 시즌 배치 공과 거리 − 반지름 합 < 0. 정확히 닿기만 한 것은 막지 않음 |
| 결과       | 네 자리가 모두 안 막힌 첫 면. 없으면 null. 시즌에 POLLEN이 없으면 null                                                                                                                                               |

18 in 정사각 외곽(HALF = 0.2286)이면 앞 면 자리: x = 0.26465, y = −0.1074, −0.0358, +0.0358, +0.1074, z = 0.03555(로봇 좌표).

### 15.4 INIT 때의 경고(`withElements`)

개인 설정 `gameElements`가 꺼졌거나 시즌에 경기 요소가 없거나 세계 설명이 없으면 그대로 둔다(`elements` 키 없음). 경고 순서: 한도 → 자리마다 바닥 아래 → 겹침 → 자동 배치 실패. 겹침 경고는 실행을 막지 않는다. 만든 세계 설명은 메인과 같은 `parseWorldSpec`으로 확인하고, 거절되면 경기 요소 없이 실행한다.

| 경고 키                  | params       | 뜻                                                                                                                                              |
| ------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `worldTooManyPreloads`   | max          | 켠 자리가 4개를 넘음(하이어라키 순서로 앞의 것만 씀)                                                                                            |
| `worldPreloadBelowFloor` | name         | 공이 바닥 아래(1 mm 넘게)                                                                                                                       |
| `worldPreloadOverlap`    | name, target | 얕은 겹침: 시작하면 보통 밀려난다(열린 각이 2·atan μ 아래로 벌어진 두 면 사이에서는 마찰에 붙잡혀 눌린 채 남을 수 있음: 기본 마찰 0.45면 48.5°) |
| `worldPreloadEmbedded`   | name, target | 어느 대상과 심 이상 겹쳐 심 행이 밀어내지 않는다: 박힌 채 남거나, 다른 겹침·중력에 밀려 풀리며 튀어 나갈 수 있다                                |
| `worldPreloadSqueezed`   | name, target | 겹침은 모두 심보다 얕지만 반대쪽에도 겹쳐 빠져나갈 자리가 없어 양쪽 스프링에 눌린 채 남는다                                                     |
| `worldPreloadNoRoom`     | 없음         | 자동 배치가 네 면 모두 막힘                                                                                                                     |

### 15.5 겹침 판정(`preloadOverlaps`, 시뮬레이터 규칙을 앞 계산한 것)

겹침 = 분리 < −`EDIT_OVERLAP_TOLERANCE`(1 mm). 대상은 그 로봇의 충돌 몸체(충돌체, 이름)와 앞 자리 공(두 자리의 겹침은 뒤 자리에 한 번). 겹친 대상을 모두 본다(`[결정: 6a 리뷰 2. 첫 대상만 보면 뒤에 적은 더 깊은 대상이나 반대쪽 겹침을 놓쳐 박힌 채 남을 공을 '밀려난다'고 알렸다]`).

| 단계         | 규칙                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1            | 자리마다 겹침 목록(충돌체 → 앞 자리 순). 충돌체와는 `targetContact`(원기둥은 정확한 구–원기둥, 껍질·캡슐은 6.2절)                                                                                                                                                                                                                                                             |
| 2(embedded)  | 어느 대상과 깊이 ≥ 심(충돌체 0.3·r, 앞 자리 공과는 두 공의 심 합 0.6·r)이면 박힘. 심 대비 깊이 비가 가장 큰 대상. 그 자리는 고정, 공끼리 짝은 뒤 자리에만 적고 풀이에서 그 짝의 겹침은 풀지 않음(`stuck`). 앞 자리 공은 고정하지 않는다(`[결정: 6a 리뷰 3]` 앞 자리 자신의 얕은 겹침 경고가 사라졌다)                                                                         |
| 3(위치 풀이) | 박히지 않은 자리 공을 모두 움직여(박힌 자리·충돌체 고정, 마찰·중력 없음, z ≥ r) 겹친 대상에서 법선으로 겹친 만큼 빼내기를 `PRELOAD_RELAX_SWEEPS` 50회 되풀이(Gauss–Seidel 투영, 두 공이 겹치면 상대가 고정이면 1·아니면 0.5 몫으로 나눠 밂). 그 자리의 겹침이 모두 1 mm 안으로 풀리면 `pushedOut`(대상은 처음 겹친 앞의 것), 남으면 `squeezed`(대상은 끝에 가장 깊이 남은 것) |

`[결정: 6a 리뷰 3. 박힘·밀려남을 더 가르는 장치를 두지 않는다]` 문구는 맞는 것만 말한다: 박힘 예측의 약 1/3은 다른 겹침·중력에 밀려 풀리며 1.3–2.4 m/s로 튀어 나가거나 껍질 안에서 떨어지고, 밀려남 예측의 약 1/5은 쐐기에서 마찰에 붙잡힌다. 시험은 2 s 시뮬레이터 결과와 맞추고 두 한계의 예도 본다. `PRELOAD_RELAX_SWEEPS`는 `[결정: 자리 넷·충돌체 수십에서 ms 아래. 서로 마주 본 면 사이처럼 자리가 없으면 끝까지 겹침이 남고, 아주 좁은 쐐기(열린 각 약 10° 아래)처럼 오래 걸리면 squeezed로 본다]`.

### 15.6 카드·기즈모

| 항목          | 값                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 카드          | 이름 "Preload Slot"(번역 안 함), 시뮬레이터 배지, 카드 순서 Collider 다음, 머리줄 확인란(enabled), 종류 POLLEN 고정, Center(표시 단위, `12in` 입력), "자리 n/4", 소속 몸체(섀시·관절 이름), 로봇 밖 `orphan`, 겹침·한도 줄                                                                                                                                                           |
| Add Component | "시뮬레이션" 아래. 이미 있거나 로봇 한도(4)면 비활성                                                                                                                                                                                                                                                                                                                                 |
| 로봇 카드     | 프리로드 출처 줄(slots·auto(면)·noRoom·season)                                                                                                                                                                                                                                                                                                                                       |
| 기즈모        | POLLEN 크기(지름 0.0711 m) 큰 원 셋 와이어 구, 색 `#fde047`(`PRELOAD_GIZMO_COLOR`, 둘 다 `[가정: 표시만]`), 빠진 자리 `#64748b`(`PRELOAD_GIZMO_EXCLUDED_COLOR`), 두 패스(깊이 검사 켬 `FRONT_OPACITY` 0.9 + 끔 `HIDDEN_OPACITY` 0.2, 빠진 자리는 둘 다 절반인 0.45·0.1), renderOrder 11(`RENDER_ORDER`), 클릭되지 않음. 실행 중에는 표시 자세를 따르고 관절 미리보기 슬라이더를 따름 |

---

## 16. 렌더러 표시와 설정

### 16.1 개인 설정 `gameElements`

`RendererPlaySettings.gameElements`(기본 켬, 개인 설정, `localStorage` `sandbot:playSettings`). 렌더러 전용이라 메인에는 `runSettings`로 보내지 않고(공유 다섯 키만), 세계 설명 `elements`로만 간다. 환경 설정 › 시뮬레이션과 Field 인스펙터 '경기 요소' 구역(`FieldElementsSection.tsx`: 켜기·끄기, 묶음별 공 수(GARDEN은 수, FLOWER·HIVE CELL은 6b, 사람 선수는 6d 표시), 실행 중 공 수, 로봇마다 프리로드 출처)에서 바꾼다. 실행의 값은 `PlayRunField.gameElements`다(실행 중 바꿔도 그 실행은 그 값).

### 16.2 `ElementsView`(`editor/scene/ElementsView.tsx`, `elementsViewModel.ts`)

| 항목        | 값                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 구성        | 층(solid·preview·ghost) × 종류(POLLEN·NECTAR 빨강·파랑)의 `InstancedMesh`. 구 `SphereGeometry(1, 24, 16)`(단위 구, 인스턴스 행렬로 반지름) `[가정: 표시만]`                                                                  |
| 재질        | `MeshStandardMaterial`, roughness 0.6(`BALL_ROUGHNESS`)·metalness 0 `[가정: 표시만]`. 색은 시즌 데이터 `material.display`                                                                                                    |
| 불투명도    | solid 1, preview 0.45(`PREVIEW_OPACITY`), ghost 0.35(`GHOST_OPACITY`) `[가정: 표시만]`                                                                                                                                       |
| renderOrder | solid 0, 반투명 층 5(`TRANSLUCENT_RENDER_ORDER`, 로봇 잔상과 같은 겹)                                                                                                                                                        |
| 편집 중     | `gameElements`가 켜졌고 문서 시즌에 경기 요소가 있으면 시작 배치(불투명)와 대상 로봇(활성 오브젝트의 로봇, 시작 표시와 같은 규칙)의 프리로드(팀 자리 불투명, 자동 자리 반투명). 팀 자리 공은 관절 미리보기 슬라이더를 따른다 |
| 실행 중     | `run.elements`(종류·시작 상태)를 `simGame`으로 그린다. 60 Hz로 바뀌므로 React로 다시 그리지 않고 스토어 구독에서 인스턴스 행렬만 바꾸고 `invalidate()`한다                                                                   |
| STOP 뒤     | 끝난 공이 `ghostGame` 잔상으로 다음 INIT·프로젝트 열기까지 남는다. 마지막 정밀 상태는 `lastRunElements`(6d 이음새: 다음 INIT에는 지우지 않고 프로젝트를 열면 지움)                                                           |
| 숨김        | 필드 밖 공(표식 비트 2)·`fieldHidden`·고립 보기에서는 그리지 않음                                                                                                                                                            |
| 클릭        | 안 됨(레이캐스트 끔)                                                                                                                                                                                                         |
| 해제        | 재질·형상은 컴포넌트 수명 동안 하나씩, 해제는 StrictMode를 견디게 미룬다                                                                                                                                                     |

`playStore`의 공 관련 슬라이스: `run.elements`(= `runElementsOf(spec)`, 공유 `elementSpawns`와 같은 순서·종류), `simGame`(run·simPose와 따로: 60 Hz 자세가 실행 상태 구독자를 다시 그리지 않게), `ghostGame`, `lastRunElements`. 공 수가 다른 이벤트는 무시한다.

---

## 17. 기준 해시 아홉째 장면(`worldGolden.test.ts` `gardenIntake()`)

6a의 움직이는 경기 요소 기준이다. 세계 설명 v7의 `elements`가 없으면 공 코드가 하나도 돌지 않아 앞의 여덟 해시는 6a가 바꾸지 않는다(판 번호만 7로 올랐다). 아홉째는 틱마다 `elementSnapshot()`(공 전체 정밀도 상태)을 이어 붙이고, 공 접촉의 sqrt·반발·마찰 반올림과 섬 LCP에 기대므로 Node·Electron을 올릴 때 다시 볼 해시가 하나 늘었다. 해시 입력: `JSON.stringify(ticks.map(t => [k, 입력, 자세, 하중, 알림, 공 상태]))`의 SHA-256. `worldError`가 없고 문자열에 `null`이 없어야 한다.

| 항목                | 값                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 시즌                | BIOBUZZ(`hiveTipped` [false, false]), 배터리 12 V(`robotSpec` 기본)                                                                                                                                                                                                                                                                            |
| 로봇                | 18 in 상자 섀시(HALF = 0.2286 m) 메카넘 4(`robotSpec`: goBILDA 5202 모터 기어 19.2, 바퀴 반지름 0.052 m, LX 0.15·LY 0.16, 질량 13.6 kg, 무게중심 (0, 0, 0.1)). 시작 자세 (x, y, yaw) = (1.2, −1.55, 0): 빨강 GARDEN 앞에서 관중석 벽(+X)을 봄                                                                                                  |
| 섀시 충돌체         | Box 중심 (0, 0, 0.1), 반 크기 (HALF, HALF, 0.1), 마찰 0.4                                                                                                                                                                                                                                                                                      |
| 바구니              | 섀시 윗면(0.2 m) 위 Box 넷, 반 크기·중심: ±y 벽 중심 (−0.1, ±0.165, 0.25) 반 (0.11, 0.005, 0.05), 앞벽 (0.015, 0, 0.25) 반 (0.005, 0.17, 0.05), 뒷벽 (−0.215, 0, 0.25) 반 (0.005, 0.17, 0.05)                                                                                                                                                  |
| 인테이크 롤러(관절) | revolute, 부모 −1, 위치 (HALF + R + 0.002, 0, 2r + R − 0.004) = (0.2606, 0, 0.0971)(R = 0.03, squeeze 0.004), 축 (0, 1, 0), 한계 없음, 질량 0.05 kg, 무게중심 0, 관성 diag 2e-5, 마찰 쿨롱 0.02·점성 0.001, 구동 CR 서보 `intake`(goBILDA Speed, ratio 1, direction 1), Cylinder 충돌체 a (0, −0.2, 0) b (0, 0.2, 0) 반지름 0.03, friction 1.0 |
| 프리로드            | 4개, kind pollen, body −1(섀시), 위치 (−0.1, (k − 1.5)·(2r + 0.003), 0.2 + r + 0.001): k = 0…3의 y = −0.11115, −0.03705, +0.03705, +0.11115(간격 2r + 0.003 = 0.0741 m), z = 0.23655                                                                                                                                                           |
| 입력                | 0 ≤ k < 500: `mecanum(0.3, 0, 0)` + `intake {position 0, power 0, pulseUs 2400, pwm true}`. 500 ≤ k < 600: `mecanum(−0.2, 0, 0)` + 같은 intake. k ≥ 600: 정지 + `intake.pwm = false`                                                                                                                                                           |
| 틱                  | 640개. `time(k) = k·TICK + (k mod 3)·1 300 000` ns(고르지 않은 틱, 하위 단계 격자와 어긋난 경계), TICK = 5 000 000 ns                                                                                                                                                                                                                          |
| 총 공 수            | 12(GARDEN 8 + 프리로드 4)                                                                                                                                                                                                                                                                                                                      |
| 해시                | `e498c93e3ead7b548e09033dff71cde9feb72b60103aed11f16c15316e8bed40`                                                                                                                                                                                                                                                                             |

시험이 확인하는 덮으려는 것: 같은 시나리오를 두 번 돌려 해시가 같다. 로봇 섬에서 함께 풀린 행 키 `gn.e0/j0k0`·`gn.e0/rk0`·`gn.e0/w0`(관중석 벽)·`gn.e0/w3`(빨강 벽)·`gn.e0/fl`·`gn.e0/e1`·`gt1.e0/j0k0`와 프리로드의 `gn.e8/rk0`(섀시 윗면)이 `art.step` 접촉 행에 나타난다. 파랑 GARDEN 넷(공 4–7)은 처음 자리에서 잠든 채. 롤러가 문 빨강 GARDEN 공(0번)이 관중석 벽에서 5 cm 넘게 끌려 나옴(`x < 시작 x − 0.05`). 프리로드 넷(8–11)이 바구니(z > 0.2)에 남음. `elementOutOfField` 없음.

해시가 바뀐 내력(주석 기록): 6a 리뷰에서 바뀜(롤러가 벽에 붙은 GARDEN 공을 무는 끼임과 결합 한도 72·건너뛰는 넣기가 이 장면에 걸림). 6a 리뷰 2에서 다시 바뀜(롤러가 바닥·벽에 누르는 끼인 행이 이력 스프링이 됨). 행마다 끼임·시작 겹침 눌림 알림·이어진 공만 넣기·한도 96은 이 장면의 바이트를 바꾸지 않았다. 6a 최종 확인에서 다시 바뀜(롤러가 누른 공의 이력 스프링이 모양을 되찾음). 깊어질 때만 주기를 시작하는 규칙은 바꾸지 않았다. 6a 리뷰 3(붙드는 것이 없는 심 행의 되찾기, 실패한 하위 단계 정리, Murty 상한 뒤 대체 규칙)은 바꾸지 않았다(붙드는 것 없이 심까지 눌린 행이 없고 실패한 하위 단계·Murty 상한에 닿는 풀이도 없다). 6a 최종 확인 2(시작 상태 고르기·일찍 쓰는 규칙)도 바꾸지 않았다(이 장면의 인테이크는 틱의 절반이 같은 회차 시작으로 돌고 32번 안에 끝나는 풀이는 연산이 그대로다).

---

## 18. 성능 목표와 측정

`elements/elementPerf.test.ts`가 하위 단계 시간(`world.step` 한 번의 벽시계 시간 ÷ 5, 첫 틱 k = 0은 뺌)의 중앙값·p99(정렬한 값의 `floor(q·개수)`번째, q = 0.5·0.99)를 로그로 남기고 CI 상한은 목표의 약 5배다(CI 기계가 느릴 수 있다). 명세 `spec-6a.md` §2.7의 목표는 P1–P5, P6은 구현 중 더한 시험이다. 사용자는 정확도를 우선했고 실시간보다 조금 느려도 된다.

### 18.1 목표·측정·CI 상한

| 장면                      | 구성                                                                                                                                                                     | 목표(중앙값)                | 측정(주석 기록)                                                                                                                                                 | CI 상한           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| P1 잠든 공 56             | GARDEN 8 + 바닥 격자 48(x = −1.5 + (k mod 8)·0.12, y = 0.3 + ⌊k/8⌋·0.12, z = r), 모두 잠듦, 400틱, 번갈아 세 번 재 가장 작은 중앙값                                      | 공 없는 같은 세계 + 0.02 ms | 차 약 0.015 ms 아래(잡음으로 음수도 나옴)                                                                                                                       | 차 < 0.1 ms       |
| P2 바닥에서 깬 공 56      | 같은 공을 깨워(잠들기 끔) 48개에 속도 0.05·(sin k, cos k), 300틱                                                                                                         | 0.3 ms                      | 약 0.45–0.55 ms(목표에 못 미침: 일이 작은 섬마다 흩어져 있다). 6a 최종 확인 2에서 0.48–0.68                                                                     | 1.5 ms            |
| P3 프리로드 4를 들고 주행 | 바구니(앞뒤·옆벽) 프리로드 4, k < 200 앞 0.3 → 회전 0.3, 400틱                                                                                                           | 0.7 ms                      | 약 0.4–0.5 ms                                                                                                                                                   | 3.5 ms            |
| P4 결합 공 8              | 섀시 앞에 두 줄 8개(66행 모두 로봇 섬, `elementCouplingLimit` 없음을 시험이 봄), 앞 0.2로 밂, 300틱                                                                      | 1.5 ms, p99 4 ms            | 약 0.35 ms, p99 약 1.2–1.9 ms                                                                                                                                   | 7.5 ms, p99 20 ms |
| P5 구석 더미 12           | 관중석·파랑 벽 구석에 떨어뜨린 12개, 300틱                                                                                                                               | 0.4 ms                      | 약 0.2 ms                                                                                                                                                       | 2 ms              |
| P6 쐐기(결합 한도 초과)   | 실제 앱 E2E 손 씬(인테이크·15° 경사 바구니·플라이휠·후드·게이트)에 GARDEN 앞 한 줄을 더 둬 로봇 섬 행이 96을 넘음. 500틱, 같은 실행 세 번 틱마다 최솟값, 쐐기 틱 > 100개 | P4와 같은 1.5 ms, p99 4 ms  | 약 1.0–1.2 ms, p99 약 5.9–7.0 ms(p99는 목표에 못 미침: 6a 최종 확인의 이력 스프링 되찾기로 쐐기 궤적이 바뀌어 p99가 약 3.8 ms에서 늘었다. 되찾기를 끄면 3.4 ms) | 7.5 ms, p99 20 ms |

6a 최종 확인 2(시작 상태 고르기·일찍 쓰는 규칙)가 P1–P6을 바꾸지 않았다(같은 기계에서 번갈아 두 번 잰 P6: 일찍 쓰는 규칙 없이 1.17–1.30 ms·p99 6.2–6.8 ms, 있으면 1.21–1.39 ms·p99 5.9–6.1 ms). 6a 리뷰 3(심 행 되찾기·붙들림 계산·대체 규칙)도 바꾸지 않았다(고친 전 1.13–1.15 ms·p99 6.1–6.5 ms, 뒤 1.13–1.18 ms·p99 6.2–7.0 ms). 붙들림은 심 이상 눌린 접촉이 있는 하위 단계에만 계산한다.

### 18.2 로봇 섬 풀이를 결과를 바꾸지 않고 빠르게 한 것

| 최적화                  | 내용                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L 앞부분 재사용         | `denseLcp.ts` 콜레스키 분해: 앞 분해의 L 앞부분을 부분 행렬 값이 같으면 다시 씀(엇갈림 2회차는 대개 분해 없이, Murty 단계는 바뀐 첨자 뒤만)                                                                  |
| 경계 행만 도는 A_FB·λ_B | 자유 행을 건너뛰는 같은 합                                                                                                                                                                                   |
| `coupledMatrix`         | 행 열 M̂⁻¹jᵀ를 j 배열마다 한 번만 풀고, 행(j 값·공 부분·순응)이 앞 풀이와 같으면 A를 그대로 씀                                                                                                                |
| `writeCoupledMatrix`    | 0인 항(j가 0인 행, 공을 함께 쓰지 않는 짝)을 건너뜀. 칸·λ마다 연산과 순서가 그대로라 기준 해시 아홉과 E2E 출력열이 바이트 그대로이고 `denseLcp.test.ts`·`coupledMatrix.test.ts`가 바꾸기 전 식과 비트로 대조 |
| 공 하나·접촉 하나       | `solveSingleContact` 빠른 길(할당 없음, 일반 풀이와 같은 연산 순서)                                                                                                                                          |
| 쉬는 하위 단계          | 모두 잠들고 로봇에 닿은 공이 없으면 행 없이 돌아온다                                                                                                                                                         |
| 쌍 키 문자열            | 짝 번호마다 한 번 만들어 다시 쓴다(하위 단계마다 이어 붙인 문자열을 Map 키로 쓰면 매번 펴고 해시해야 한다)                                                                                                   |

### 18.3 쐐기 측정과 실제 앱

| 항목                                                                                                           | 값(주석 기록)                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2E 쐐기 시작 하위 단계(4.56 s, 91행)                                                                          | 주축 전환이 Murty 단계로 384번 돌아 그 LCP 하나가 약 17 ms(빨라지기 전 20 ms). 한도 96에서 그 틱 37–44 ms(한도 72에서 50–65 ms). 쐐기 시작 0.25 s 창 하위 단계 약 1.4 ms(실시간 약 0.7배, 72에서 약 1.9 ms), 쐐기가 이어지는 동안 약 1.0 ms(실시간 안팎)         |
| Murty 상한에 걸리는 하위 단계                                                                                  | 그 틱이 약 60–280 ms(출력 1·0.7·0.4에서 67·91·274 ms, 86–102행). 일찍 쓰는 규칙 뒤 달려들기 144번에서는 없었고, 조건이 나쁜 무작위 문제 1200개에서는 12개가 걸린다                                                                                               |
| 실제 앱(빌드한 Electron, 4코어, Xvfb 소프트웨어 그리기)에서 E2E 손 씬 로봇을 키보드로 출력 0.4로 6 s 버틴 실행 | 인테이크를 끈 실행은 1 s 벽시계 창이 모두 0.5배 이상(실행 전체 0.68배). 켠 실행은 네 번 가운데 둘이 0.3배 아래인 창을 둘씩 가졌다(가장 낮은 창 0.22·0.13배, 실행 전체 0.48–0.65배, `worldError` 없음). 시작 상태 고르기 전에는 0.01–0.03배가 2분 가까이 이어졌다 |
| 같은 장면 오프라인                                                                                             | 시작 박자 16개로 버티면 가장 느린 시뮬레이션 1 초가 0.46배. 키보드 박자에 따른 자세 차이나 렌더러·사이드카와 CPU를 나눠 쓰는 것이 더한 것으로 보이지만 가르지 못했다(6a 마무리 확인)                                                                             |
| 겹친 채 시작해 인테이크를 켜고 미는 실행                                                                       | 빨강 벽에 36 mm 겹친 시작 48번 가운데 2번이 0.5 s 창 0.21–0.29배·실행 전체 0.53배 이상, 가장 긴 틱 약 90 ms. 시작이 겹치지 않은 96번은 가장 느린 창 0.41배 이상·실행 전체 0.84배 이상, 가장 긴 틱 약 60 ms                                                       |

실시간에 못 미치는 실행이 남는 것은 사용자 결정(정확도 우선) 안이다.

---

## 19. 시험이 지키는 성질

해석 시험은 로봇 없이(동역학 없는 로봇은 구석에 서 있고 충돌체가 없다) 넓은 빈 바닥(구조물 없음, 반폭 10 m)에서 공기·잠들기를 끄고 값을 해석해와 비교한다(`ballPhysics.test.ts`).

| 시험                                            | 기준·허용                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 쉬는 공                                         | 10 s 동안 \|v\| < 1e-5, 수평 드리프트 < 1e-6 m. 침하 / (m·g/k_c) = 1 ± 1 %                                                                                                                                                                                                                                                                                                               |
| 잠들기                                          | 0.5 s 뒤(가라앉는 몇 ms 뒤부터 0.5–0.6 s 사이) 잠들고 v = ω = 정확히 0                                                                                                                                                                                                                                                                                                                   |
| 0.5 m 낙하 반발                                 | 튀어 오른 높이 = e²·h₀(e = 바닥 0.30) ± 2 %. 하위 단계 1 ms                                                                                                                                                                                                                                                                                                                              |
| 미끄러지다 구름                                 | v = v₀/(1 + I/(m r²)) ± 2 %, ω = v/r ± 1 %(굴림 저항 0). v₀ = 2 m/s                                                                                                                                                                                                                                                                                                                      |
| 구름 감속                                       | μ_rr·g/(1 + I/(m r²)) ± 2 %(v₀ = 1.5 m/s)                                                                                                                                                                                                                                                                                                                                                |
| 5 m/s 벽 충돌                                   | 반발 속도 비 ∈ (0.97, 1.01)·e_hard, 침투 < 1 mm, 필드 밖으로 안 나감. 하위 단계 1 ms                                                                                                                                                                                                                                                                                                     |
| 벽에 기댄 한 줄 넷·피라미드                     | 5 s 동안 변위 < 2 mm·속도 < 1e-3, 에너지(스프링 포함) 늘지 않음, 심까지 안 눌림, 위 공이 아래 둘 위에 남음                                                                                                                                                                                                                                                                               |
| 항력·Magnus                                     | 항력 있으면 진공보다 0.05 m/s 넘게 느림, Magnus는 ω × v 쪽 > 0.05 m/s                                                                                                                                                                                                                                                                                                                    |
| 결합                                            | 미는 판과 공의 운동량 1e-9·로봇 반발 계수로 튐, 섀시가 미는 공 ω = v/r·침투 < 1 mm, CR 서보 롤러가 뒤판까지 끌어당기고 뒤판 법선 힘 = k·δ ± 5 %                                                                                                                                                                                                                                          |
| 플라이휠 + 고정 면                              | ω₁ = ω₀/(1 + 0.4085·m R²/I) ± 5 %, 나가는 속도 ω₁R/2 ± 5 %, 각충격 = I·Δω ± 1 %, 에너지는 줄기만. 원기둥과 64점 볼록이 5 % 안(`[이 문서의 유도: 0.4085 ≈ (1 + I_공/(m r²))/4 = 0.4086. 코드 주석에는 유도가 없다]`)                                                                                                                                                                      |
| 모터 플라이휠                                   | 공을 쏘면 느려졌다가 원래 속도로 돌아옴                                                                                                                                                                                                                                                                                                                                                  |
| 섬 실패 가두기                                  | 섬 하나가 던지면 그 섬만 속도 0, 로봇이 던지면 로봇 섬 공도 속도 0, 접촉 만들기·몸체 충돌 행·실패한 하위 단계 정리                                                                                                                                                                                                                                                                       |
| 끼임·되튐(6a 리뷰·리뷰 2)                       | 13.6 kg 판이 면에 붙은 공을 심보다 얕게 누르면 e 안팎으로 되튐(0.05–0.33 m/s: 면 0.50–0.46배, 바닥 0.43–0.38배), 바닥의 자유로운 공을 치면 (1 + e)·v, y로 붙은 공 셋의 가운데 공도 (1 + e)·v, 전출력 메카넘이 GARDEN 공에 달려들어도 공 변형 에너지보다 세게 되밀리지 않음                                                                                                               |
| 되찾기(6a 리뷰 3)                               | 판이 0.34·0.4·0.6·1.0 m/s로 바닥에 심까지 눌렀다 물러나면 공이 mg/k로 돌아와 잠듦(뜨지 않음), 되찾는 동안 0.05 m/s 아래, 되찾는 시간이 하위 단계 길이(1·0.5 ms)와 관계없음(± 2 %), 누른 채 멈춘 판과 공은 3 s 뒤에도 그대로, 벽에 민 공 두 개·세 개 줄이 공끼리도 벽에서도 떨어짐, 얹힌 공 더미도 되찾음, 박은 GARDEN 공 넷이 모두 벽 밖 mg/k로 잠듦, 틱 나눔과 관계없이 바이트까지 같음 |
| 결합 한도                                       | 한도 9로: 한도에 들어가지 않는 공을 건너뛰고 뒤의 싼 공을 넣음, 건너뛴 공 너머의 공은 넣지 않음(`couplingAdmission.test.ts`)                                                                                                                                                                                                                                                             |
| 필드 밖(`outOfField.test.ts`)                   | 빨강 벽 너머로 던진 POLLEN이 나가고 3 s 뒤 빨강 LOADING ZONE 가운데 벽 자리에 쉬는 채로 들어옴, 파랑 벽 쪽은 파랑 구역, NECTAR는 다시 넣지 않음, 로봇이 막은 자리는 기다림, 같은 입력이면 바이트까지 같음                                                                                                                                                                                |
| 조밀 LCP(`denseLcp.test.ts`, `islands.test.ts`) | 무작위 양정치 상자 문제에서 `solveBoxLcp`와 같은 해(1e-7), Murty 상한에 걸리는 조건이 나쁜 문제를 대체 규칙이 풂, 상한 안 문제는 바꾸기 전 식과 비트로 같음, 일찍 쓰는 규칙이 128번 안에 끝냄, 다시 풀어도 같은 답                                                                                                                                                                       |
| 결정성                                          | 같은 입력이면 공 상태 포함 바이트까지 같고 세계 둘을 번갈아 돌려도 같다(`elementWorld.test.ts`)                                                                                                                                                                                                                                                                                          |
| 계약                                            | v7 검증, 프로젝트 v14, Preload 정리·실행 취소, `checkFieldSpec`, `elementSpawns`·`autoPreloadSlots`·`reentryZones`, 렌더러 빌더 → JSON → `parseWorldSpec` → `PhysicsWorld` 첫 틱 위치 = `elementSpawns`(`play/worldElementsFirstTick.test.ts`)                                                                                                                                           |

---

## 20. 알려진 한계·남은 일

CLAUDE.md의 6a "한계" 항목과 코드 주석을 모은 것이다.

| 구분                   | 내용                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 범위                   | 6a에 생기는 공은 GARDEN·프리로드뿐이다(FLOWER는 꽉 찬 상자, HIVE·CELL은 공이 지나감: 6b). 센서·웹캠은 공을 보지 않는다(6c). 점수·규칙 알림·사람 선수 NECTAR·AUTO→TELEOP 이어 가기는 없다(6d, `final`·`lastRunElements`·`ElementWorldOptions.initial`이 이음새)                                                                                                                                                                                                                                                                                                         |
| 공 모델                | 강체 구 + 부드러운 법선이라 구멍·찌그러짐은 없다. 굴림·회전 저항은 명시 근사이고 로봇은 그 반작용을 받지 않는다                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 결합 한도              | 행 96을 넘는 공은 한쪽 풀이라 로봇이 그 공을 느끼지 못하고 정해진 속도의 몸체에 밀려 눌리기만 한다(부드러운 법선이라 깊이 눌릴 수 있다): 벽에 붙인 공 20개(4 × 5)를 상자 섀시 메카넘이 0.3–1 출력으로 밀면 미는 동안 공이 2–6 m/s로 튀고 공 중심이 0.07–0.30 m까지 떠오른다(6a 리뷰 3 전에도 4–7 m/s·0.04–0.65 m). 로봇이 물러나면 공끼리 21–46 mm 겹친 채 잠들던 짝도 이제 모두 떨어지지만 심을 넘은 peak가 줄어드는 데 걸려 그 섬은 약 25 s 동안 깨어 있다. 6a가 만드는 공 12개로는 두 GARDEN의 공 여덟을 한 벽에 모아 끼울 때만 한도를 넘는다(P6의 두 줄과 같은 꼴) |
| 끼인 행의 되튐 범위 밖 | 0.05 m/s보다 느리게 누르면 누르는 동안 공이 모양을 되찾아 더 되튀고(0.01 m/s 0.67배, 0.005 m/s 0.78배, 바닥 0.89배까지), 심까지 눌리면 강체 심 행이 몸체를 멈추고 그때까지의 변형 에너지는 돌려주지 않아(심 넘는 충돌은 소성) 되튐이 속도에 따라 끊긴다(13.6 kg 판은 약 0.33 m/s 넘으면 0배)                                                                                                                                                                                                                                                                           |
| 되찾는 빠르기          | 2 mm/s는 가정이라 심 가까이 눌렸다 놓인 공은 약 4–5 s, 심까지 눌렸던 공은 바닥 약 6 s·벽 약 9–10 s·공끼리 약 14 s에 걸쳐 돌아온다(0.6·전출력으로 박은 GARDEN 공 넷은 로봇이 떠난 뒤 약 10–11 s에 잠든다). 그동안 멈춘 실행의 잔상·`final`에 가라앉은 자리가 남는다                                                                                                                                                                                                                                                                                                     |
| `elementSnapshot()`    | 되찾는 중인 공의 짝마다 peak·되찾기 표시가 없어, 그것으로 이어 간 실행은 그 공이 탄성선의 힘으로 튄다(7 mm 가라앉은 바닥 공이 약 1 m/s로 5 cm). 6d가 이어 가려면 그 상태를 함께 넘겨야 한다                                                                                                                                                                                                                                                                                                                                                                            |
| 시작 겹침              | 시작부터 심 이상 박힌 짝(`worldPreloadEmbedded`)은 되찾지 않는다: 박힌 채 남거나 다른 힘에 밀려 심 아래로 풀리면 그 깊이의 탄성 힘이 한 번에 걸려 공이 튀어 나갈 수 있다(문구가 둘 다 말한다)                                                                                                                                                                                                                                                                                                                                                                          |
| 프리로드 겹침 판정     | 위치 풀이에 마찰·중력이 없다: 열린 각이 2·atan μ(기본 마찰 평균 0.45면 48.5°) 아래로 벌어진 두 면 사이에서 마찰에 붙잡히는 공(바닥과 20–48° 벌어진 판에 6 mm 겹치면 1.2–2.9 mm 눌린 채 잠든다)도 pushedOut으로 알리고(무작위 씬에서 밀려남 예측의 약 1/5), 박힘 예측의 약 1/3은 다른 겹침·중력에 밀려 풀리며 튀어 나가거나 껍질 안에서 떨어진다. 다른 쪽 공이 비키는 것은 50회 안에서만 본다. 뒤 자리가 심 이상 박힌 두 자리 사이는 풀지 않는다(앞 자리가 그 박힌 공 쪽으로만 빠져나갈 수 있는데 그 너머가 막혔으면 눌린 채 남는 앞 자리도 pushedOut으로 알림)         |
| 로봇 섬 LCP 실패       | Murty 2000번과 대체 규칙 500번에도 끝나지 않으면 그 하위 단계의 로봇·로봇 섬 공 속도를 0으로 두고 `worldError`를 한 번 알린다(E2E 손 씬 로봇의 달려들기 144번에는 없었다)                                                                                                                                                                                                                                                                                                                                                                                              |
| 느려지는 실행          | Murty 상한에 걸리는 하위 단계는 그 틱이 약 60–280 ms. 섀시가 시작부터 벽에 겹친 채 인테이크를 켜고 미는 실행은 여전히 느릴 수 있다(18.3절)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 충돌 형상              | Cylinder Collider의 공이 아닌 짝은 32각 근사(+0.48 %)다. 기저에 z·롤·피치가 없어 로봇이 공을 밟고 올라가지 않는다(5 한계와 같다). 큰 섬(60행 넘음)은 PGS 근사다                                                                                                                                                                                                                                                                                                                                                                                                        |
| 성능                   | P2는 목표 0.3 ms에 못 미친다(0.45–0.68 ms). P6의 p99는 목표 4 ms에 못 미친다(약 5.9–7.0 ms). 명세가 적은 weld(잡은 공을 로봇에 붙임)·Woodbury 구조 분해는 목표를 못 맞출 때만 넣기로 했고 넣지 않았다                                                                                                                                                                                                                                                                                                                                                                  |
| 가정값                 | 판 강성·반발·마찰·굴림 저항·회전 저항 접촉 반경·공기 계수·껍질 관성·심 깊이·다시 넣기 3 s·잠들기 문턱·되찾는 빠르기·이력 스프링 되돌림 비 e²는 모두 실측이 필요하다(`docs/assumptions.md` 6a 표)                                                                                                                                                                                                                                                                                                                                                                       |
| 6b에서                 | 공 행의 몸체 부분(`ElementPart`)을 일반화해 HIVE를 1자유도 동적 몸체로 둔다(W 제공자), FLOWER 안쪽 정적 형상·`flower`·`hiveCell` 배치 묶음, 카메라가 HIVE 각을 틱마다 읽는다                                                                                                                                                                                                                                                                                                                                                                                           |
| 6c에서                 | `tickState()`의 구 층을 `fieldRaycast`·비전 가림에 넣고 공 재질을 컬러 센서에 쓴다                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6d에서                 | 득점 판정, G407류 알림, 사람 선수 NECTAR 주입, `final` 스냅샷 + 로봇 끝 자세로 `elements.initial` 이어 가기                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 버전                   | 6a는 `PROJECT_VERSION` 14·`WORLD_SPEC_VERSION` 7·사이드카 프로토콜 4이고 메시 캐시 `model-v5`와 기준 해시 여덟은 그대로다                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

## 21. 원본 조사 자료 상태

| 자료                                                                                                                                                    | 상태                                                                                                                       | 이 문서에서 근거를 따라갈 수 없는 것                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/research/6a/spec-6a.md`, `docs/research/6a/plan-6a.md`                                                                                            | 저장소에 남아 있다. spec은 main `fbbf098` 기준 설계(줄 번호는 근사), plan은 사용자 결정(11/13)을 적은 승인 계획이다        | 구현은 두 문서와 여러 곳이 다르다(1.5절). 문서가 아니라 코드가 원본이다                                                                                                                                                        |
| BIOBUZZ CM·EFG·AndyMark 제품 정보 조사(공 지름·질량·구멍 수·시작 개수·10.8.2 규칙)                                                                      | 저장소에 없고 위치·이름도 코드·CLAUDE.md에 기록되어 있지 않다(출처 기록 없음). 결과 요약만 `plan-6a.md`와 코드 주석에 있다 | POLLEN Ø 2.8 in(0.0711 m)·24.9 g, NECTAR Ø 3.6 in(0.0914 m)·41.3 g의 원 출처 쪽 번호, 구멍(Ø0.4 in 26개·Ø0.6 in 26개)과 개수(POLLEN 40, NECTAR 8 + 8), 시작 배치(GARDEN 4·FLOWER 4·CELL 3·프리로드 4), CM 10.3.1·10.8.2의 원문 |
| 접촉 모델 방법(ODE ERP·CFM 순응, MuJoCo 정칙화, Box2D·Box3D 반발 문턱과 매니폴드, Walton–Braun 이력 모델, Júdice–Pires 블록 주축, Murty 최소 첨자 규칙) | 코드·CLAUDE.md 주석이 이름만 적고 원문·식 출처는 저장소 안에 없다(출처 기록 없음)                                          | 각 방법의 원 논문·소스 위치. 식은 코드가 곧 원본이다                                                                                                                                                                           |
| 가정값의 근거(위플 공 낙하 영상 어림, 손가락으로 누른 어림, 매끈한 구의 문헌값 등)                                                                      | 주석이 어림의 종류만 적고 수치 근거는 없다                                                                                 | 판 강성 3000·4500 N/m, 반발 0.30·0.64·0.5·0.5, μ 0.5, μ_rr 0.05, r_s 2 mm, C_d 0.5, Magnus 0.5·0.3, 안쪽 반지름 비 0.95, 반사율 표, 다시 넣기 3 s. 모두 `[가정]`이며 `docs/assumptions.md` 6a 표의 측정 방법으로 바꿀 대상     |
| 6a 리뷰·최종 확인의 측정값(되튐 비, 주축 반복 수, 틱 시간, 실제 앱 벽시계 창)                                                                           | 코드 주석·CLAUDE.md·`docs/assumptions.md`에만 있고 측정 스크립트·원 로그는 저장소에 없다                                   | 주석에 적힌 수치(예: 달려들기 144번의 가장 느린 창, 주축 반복 416개 분포, 실제 앱 E2E 창)를 다시 재현하려면 시험(`coupling.test.ts`·`elementPerf.test.ts`)과 E2E 손 씬(`intakeWedge`)을 새로 돌려야 한다                       |
| 플라이휠 이상 공식의 계수 0.4085                                                                                                                        | 시험 주석에 유도가 없다                                                                                                    | 이 문서 19절의 유도((1 + I/(m r²))/4)는 이 문서를 쓰며 맞춰 본 것이지 원 자료가 아니다                                                                                                                                         |

따라서 이 문서의 `[확인]` 값은 공 지름·질량·INNER_HALF·벽 높이 등 코드 주석이 출처를 적은 것뿐이고, 공의 접촉·공기·재질 값은 전부 가정이다.
