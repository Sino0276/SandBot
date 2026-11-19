# 메커니즘 충돌(5) 기준 문서

이 문서는 SandBot 시뮬레이터의 5단계(섀시·관절 몸체의 3D 충돌체가 필드 벽·고정 구조물·바닥·같은 로봇의 다른 몸체와 부딪히는 계산, 그 충돌체를 만드는 렌더러 쪽 규칙)가 쓰는 모든 치수·공차·한도·수식·알고리즘·결정사항을 한곳에 적는다. 원본 조사·명세 문서(`p14collide` 폴더의 `research/methods.md`와 명세 `spec-5`)는 저장소 밖 작업 폴더에 있다가 사라졌으므로, 코드(`src/shared/sim/hull.ts`, `collision3d.ts`, `bodyCollision.ts`, `articulation.ts`의 접촉 틀·야코비안·LCP, `src/renderer/src/scene/collider.ts`, `meshHull.ts`, `src/renderer/src/play/worldColliders.ts`, `worldSpec.ts`의 충돌 형상 검증, `world.ts`의 배선)와 CLAUDE.md, `docs/assumptions.md`의 "5 메커니즘 충돌" 표가 곧 원본이다. 각 값은 값 · 단위 · 위치(파일·상수·함수 이름, 줄 번호 없음) · 상태(`[확인: …]`, `[가정: …]`, `[결정: …]`, 표시 없는 코드 값)와 근거를 적었고, 코드에 출처가 없으면 "출처 기록 없음"이라고 썼다. 수식은 코드의 변수 이름을 그대로 써서 다시 구현할 수 있게 했다. 단위는 내부 SI(미터·라디안·N·초)다. 필드 치수(벽·구조물 17개)의 원천 데이터는 `docs/reference/field-biobuzz.md`가 맡고, 여기서는 5단계가 읽는 값만 다시 적는다.

## 목차

0. 읽는 법
1. 범위와 설계 결정
2. 상수 총표(공차·한도·마찰)
3. 볼록 껍질(`hull.ts`)
4. 정적 형상(`staticShapes`)
5. 몸체 형상(`bodyShape`·`placeShape`)
6. 좁은 단계(`collision3d.ts`): SAT·매니폴드·GJK·둥근 짝
7. 충돌 행 만들기(`bodyCollision.ts`)
8. 접촉 틀·야코비안·상자 LCP(`articulation.ts`)
9. 편집 자세 겹침 앞 계산과 시작 겹침
10. 세계 설명 v6·v7의 충돌 칸 검증(`worldSpec.ts`)
11. 렌더러: Collider 설정·몸체 모델 빌더·메시 껍질
12. 알림·경고 목록
13. 인스펙터·씬 뷰 기즈모
14. Unity 대응과 임시 편차
15. 기준 해시 여덟째 장면
16. 성능 예산과 시험
17. 알려진 한계·남은 일
18. 원본 조사 자료 상태

---

## 0. 읽는 법

### 0.1 상태 표기

코드 주석의 표기를 그대로 쓴다. 이 문서의 `[확인]`은 "코드 주석이 출처를 적었다"는 뜻이지, 이 세션에서 출처를 다시 열어 본 것이 아니다.

| 표기        | 뜻                                                                     |
| ----------- | ---------------------------------------------------------------------- |
| `[확인: …]` | 공식 문서·라이브러리 소스·데이터시트 등 출처를 주석이 적은 값          |
| `[가정: …]` | 출처 없이 정한 값. 실측으로 바꿀 대상                                  |
| `[결정: …]` | 설계로 정한 값(이유가 주석에 있음). `사용자 결정`은 사용자와 합의한 값 |
| 표시 없음   | 수치·안정화 상수이거나 다른 상수에서 계산한 값                         |

### 0.2 단위·좌표·기호

| 항목                 | 규약                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 단위                 | 길이 m, 각 rad, 힘 N, 시간 s. 충격은 힘 × h                                                                                                             |
| 하위 단계 h          | 1 ms 절대 격자(`world.ts` `SUBSTEP_NANOS` 1 000 000 ns). 틱은 보통 5 ms                                                                                 |
| 필드 좌표            | 원점 필드 중앙 타일 윗면, +X 관중석 벽, +Y 파랑 벽, Z 위. 벽 이름 `x+`·`x-`·`y+`·`y-`                                                                   |
| 로봇 좌표            | X 앞, Y 왼쪽, Z 위, 원점 로봇 중심 바닥                                                                                                                 |
| 몸체 틀              | 섀시(몸체 −1) = 로봇 좌표. 관절 몸체 i = 그 관절 틀(앵커에서 q = 0일 때의 틀). 충돌체는 몸체 틀로 적는다                                                |
| 접촉 틀 C            | 축은 관절 나무 틀(바퀴가 있어 부유 기저면 필드 축, 없어 고정 기저면 로봇 축), 원점 O는 지금 섀시 원점(부유 (basePose.x, basePose.y, 0), 고정 (0, 0, 0)) |
| 법선                 | 매니폴드 법선은 B → A(A를 B에서 밀어내는 쪽). A는 순서가 앞인 몸체, 정적 형상은 늘 B                                                                    |
| 분리 g(`separation`) | + 면 떨어짐, − 면 겹침(침투 깊이의 음수)                                                                                                                |
| 행 의미              | 구속 행은 J·v⁺ ≥ target(법선 행). J = J_A − J_B이고 + 방향이 떨어짐                                                                                     |
| 행렬                 | 회전은 행 우선 9개                                                                                                                                      |

### 0.3 파일 지도

| 파일                                                                  | 역할                                                                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/sim/hull.ts`                                              | 볼록 껍질(결정적 Quickhull, 면 합치기), 상자·기둥의 정확한 껍질, 껍질 기억                                                             |
| `src/shared/sim/collision3d.ts`                                       | 정적 형상, 몸체 형상, 원기둥 근사, SAT·매니폴드·GJK·둥근 짝, 편집 자세 겹침·시작 겹침                                                  |
| `src/shared/sim/bodyCollision.ts`                                     | `BodyCollision`: 짝 목록, 넓은 단계, 법선·마찰 행, 행 한도, 알림                                                                       |
| `src/shared/sim/articulation.ts`                                      | 접촉 틀 `contactFrames`, `relativeJacobian`·`twistJacobian`·`pointVelocity`, `ContactFriction` 상자, 상자 LCP `solveBoxLcp`            |
| `src/shared/sim/world.ts`                                             | 하위 단계 배선: 바퀴 행 → (평면 경로의 벽·구조물 행) → 충돌 행 → 공 행 → `Articulation.step`                                           |
| `src/shared/sim/worldSpec.ts`                                         | 세계 설명 v6·v7의 충돌 칸 타입·검증·한도·마찰 상수                                                                                     |
| `src/shared/sim/wheelData.ts`·`fieldContact.ts`·`contact.ts`          | 다른 단계에서 정한 `WALL_FRICTION`·`SUPPORT_NOTICE_DELAY`·`SUPPLEMENT_TOLERANCE`·`REFERENCE_TOLERANCE`·`WALL_MARGIN`을 5가 가져다 쓴다 |
| `src/renderer/src/scene/collider.ts`                                  | `SceneObject.colliders`·`collision`의 타입·범위 정리·기본값                                                                            |
| `src/renderer/src/scene/meshHull.ts`                                  | 오브젝트의 충돌 형상 점 조회(메시 껍질 읽기, 임시 모양 상자)                                                                           |
| `src/renderer/src/cad/stepImport.ts`                                  | STEP 워커가 메시마다 만드는 메시 껍질 `meshHullOf`                                                                                     |
| `src/renderer/src/play/worldColliders.ts`                             | 몸체마다 충돌체 정하기(`buildCollisionModel`), 편집 자세 겹침 앞 계산 호출, 경고                                                       |
| `src/renderer/src/play/worldJoints.ts`                                | 몸체 나누기 `jointBodyFrames`(관절 순번·부모·몸체 소속·관절 틀)                                                                        |
| `src/renderer/src/scene/robotMeshIndex.ts`                            | 오브젝트 → 로봇 좌표 행렬 표(센서·카메라 자기 가림과 같이 씀)                                                                          |
| `src/renderer/src/editor/collider/`, `editor/scene/colliderColors.ts` | Collider 카드·충돌 구역·기즈모(13절)                                                                                                   |
| `src/shared/sim/worldGolden.test.ts`                                  | 기준 해시 여덟째 `mechanismCollision()`(15절)                                                                                          |

### 0.4 데이터 흐름

1. 팀이 하이어라키 오브젝트에 Box·Capsule·Mesh·Cylinder Collider를 붙인다(없으면 몸체 메시의 자동 볼록 껍질).
2. INIT 때 렌더러가 `buildWorldSpec`의 `shapes`(메시 껍질 조회)로 `buildCollisionModel`을 돌려 몸체마다 충돌체(`SimCollider`)를 정하고 편집 자세 겹침 짝을 `collisionIgnore`에 넣어 세계 설명 v6·v7의 `robot.colliders`·`joints[i].colliders`·`collisionIgnore`로 보낸다.
3. 메인 `parseWorldSpec`이 모양·한도를 검증하고 `PhysicsWorld`가 `bodyCollisionNeeded`면 `BodyCollision`을 만든다(껍질은 렌더러가 보낸 점 V로 `canonicalHull(V)`를 다시 만든다).
4. 하위 단계(1 ms)마다 접촉 틀을 한 번 만들고 `BodyCollision.rows`가 짝마다 SAT·GJK 좁은 단계 → 매니폴드 → 법선·마찰 행을 만든다. 행은 바퀴 행 뒤에 붙어 `Articulation.step`의 한 상자 LCP에 들어간다.
5. 풀이 뒤 `afterStep`이 바닥·윗면을 누르는 합력을 감시하고, `blocked`는 섀시–정적 법선 행의 충격이 있었는지로 정한다.

---

## 1. 범위와 설계 결정

### 1.1 충돌하는 짝(사용자 결정 11/10)

| 짝                   | 규칙                                                                                                                        | 근거·위치                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 섀시 ↔ 필드 벽 넷    | 바퀴가 있을 때만(부유 기저). 법선을 수평으로 투영                                                                           | `bodyCollision.ts` 생성자(`floating`), `pairRows`의 수평 투영 |
| 섀시 ↔ 고정 구조물   | `solid && carrier === 'field'`인 구조물(4ab `solidFootprints`와 같은 집합). 높이 거르기 없음                                | `staticShapes`의 `chassis` 플래그                             |
| 섀시 ↔ 바닥          | 없음(바퀴가 맡는다)                                                                                                         | `staticShapes` 바닥의 `chassis: false`                        |
| 관절 몸체 ↔ 벽 넷    | 벽은 높이 `perimeter.height`까지의 상자라 윗면에 얹힌다. 바퀴 유무와 관계없음                                               | `staticShapes`의 `joints: true`                               |
| 관절 몸체 ↔ 구조물   | `carrier === 'field'`이고 `solid` 또는 `occludes`인 구조물. HIVE carrier 요소는 늘 뺀다                                     | `staticShapes` 규칙                                           |
| 관절 몸체 ↔ 바닥     | z = 0 평면, 법선 +z                                                                                                         | `staticShapes` `fl`                                           |
| 같은 로봇의 몸체끼리 | ① 같은 몸체의 충돌체끼리는 아님 ② 바로 붙은 부모–자식(`joints[i].parent`)은 아님 ③ `collisionIgnore` 짝은 아님. 나머지 모두 | `BodyCollision` 생성자 2단계                                  |
| 다른 로봇            | 없음(시뮬레이터는 한 로봇만 돈다)                                                                                           | 4ab 한계                                                      |

섀시 ↔ 정적 짝은 고정 기저(바퀴 없음)이면 목록에 넣지 않고 SAT도 돌리지 않는다. `blocked`는 섀시–정적 법선 행만 센다(관절 몸체가 바닥에 닿을 때마다 켜지지 않게).

### 1.2 섀시의 평면 경로와 3D 경로

| 경로      | 조건                                    | 계산                                                                                      |
| --------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| 평면(4ab) | 세계 설명에 `robot.colliders` 칸이 없음 | 외곽 × [0, height] 프리즘, `wallRows`·`structureRows`(5 전의 연산 그대로, 기준 해시 일곱) |
| 3D(5)     | `robot.colliders`가 있음(빈 배열 포함)  | 평면 행을 부르지 않고 바퀴 행만 둔 뒤 3D 충돌 행을 붙임                                   |

INIT의 실제 실행은 형상 조회를 늘 넘기므로 섀시가 늘 3D 경로이고(형상이 없으면 외곽 대체 상자, 모든 Collider를 끄면 빈 배열), 평면 경로는 형상 키가 없는 세계 설명(로봇 카드·`motorDrivesJoint`의 빌더 호출, 시험, 기준 해시 일곱)에만 남는다. `bodyCollisionNeeded(spec)` = `robot.colliders !== undefined` 또는 관절 하나라도 `colliders`가 1개 이상. 아니면 5 전의 연산·바이트 그대로다.

### 1.3 사용자 결정·설계 결정 목록

| 결정                        | 값·내용                                                         | 이유                                                     |
| --------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| 편집 자세 겹침 문턱         | 1 mm(`EDIT_OVERLAP_TOLERANCE`)                                  | 사용자 결정 11/10. 이보다 깊이 겹친 몸체 짝은 서로 무시  |
| 실행 중 겹침 알림 깊이      | 1 mm(`OVERLAP_NOTICE_DEPTH`)                                    | 사용자 결정 11/10                                        |
| Collider 기본 마찰          | 0.4                                                             | 사용자 결정 11/10, 3c `WALL_FRICTION`과 같게             |
| 바닥 마찰(관절 몸체–타일)   | 0.4                                                             | 사용자 결정 11/10, 타일 위 알루미늄·PLA(실측 없음)       |
| 마찰 합치기                 | 두 면의 평균(Unity Average)                                     | Unity Physics Material 규칙                              |
| 끈 Collider도 "있음"        | 모두 끄면 그 몸체는 충돌하지 않음(자동 껍질도 꺼짐)             | 휘는 인테이크·케이블 체인을 끄는 길(§17 확인, 명세 항목) |
| 정적 형상은 양자화하지 않음 | 벽 안쪽 면은 `innerHalf` 그대로, 구조물은 FieldSpec 값 그대로   | P-M4·C-M9                                                |
| 위치 보정 없음              | 행은 간격 0으로 쉬고(목표 −max(gap, 0)/h) 반발·위치 자르기 없음 | M§1.1: 피부가 없는 SAT                                   |
| 충돌 행은 바퀴 행 뒤        | 모두 한 상자 LCP에서 같이 풀림                                  | 3b·3c의 풀이 구조                                        |
| 모든 새 행 키는 `c`로 시작  | `cn.`·`ct1.`·`ct2.`·`cw.`                                       | 기존 접두어 `w`·`n`·`t`·`f`·`l`·`u`와 겹치지 않게        |
| 새 Euler·sin·cos 없음       | 세계 설명은 행렬만, 원기둥 근사는 제곱근 식만                   | 시뮬레이터 쪽에 Euler → 행렬 변환이 없다(결정성)         |

---

## 2. 상수 총표(공차·한도·마찰)

### 2.1 `hull.ts`

| 항목                     | 값                              | 단위   | 위치                                  | 상태·근거                                                                                                                                                                                          |
| ------------------------ | ------------------------------- | ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 양자화 격자              | 1e-4                            | m      | `HULL_GRID`                           | `[조사 결정 M§3 2]`(원문 소실). 0.1 mm. 구현은 GRID_SCALE 10000(정수라 x·10000이 결정적)을 곱해 `Math.round`                                                                                       |
| 기본 꼭짓점 한도         | 32                              | 개     | `HULL_DEFAULT_VERTEX_LIMIT`           | Box3D "boulder" 32점 껍질(59면·89모서리, M§3)이라고 주석이 적음                                                                                                                                    |
| 꼭짓점 하드 한도         | 64                              | 개     | `MAX_HULL_POINTS`                     | `[결정]` SAT 비용                                                                                                                                                                                  |
| 면 바깥 판정             | 1e-9                            | m      | `HULL_EPSILON`                        | `[결정: ‖좌표‖ ≤ 10 m의 배정밀도 외적 잡음(~1e-14)보다 크고 격자보다 훨씬 작다]`                                                                                                                   |
| 면 합치기 문턱 cos       | 0.9986295347545738              | 무차원 | `HULL_MERGE_COS`                      | `[조사 결정 M§3 5]` = cos 3°(리터럴: 모듈이 `Math.cos`를 부르지 않게)                                                                                                                              |
| 합친 면 평면 허용        | 1e-4                            | m      | `HULL_MERGE_DISTANCE`                 | 격자 한 칸, M§3 5 Newell 0.1 mm                                                                                                                                                                    |
| 부피 하한                | 1e-9                            | m³     | `HULL_MIN_VOLUME`                     | `[결정, M§3 7]` = 1 mm³                                                                                                                                                                            |
| 가장 얇은 폭 하한        | 1e-3                            | m      | `HULL_MIN_THICKNESS`                  | `[P-L17, 결정: 0.1 mm 양자화 잡음이 만든 얇은 판 껍질이 SAT 법선 뒤집힘으로 통과되지 않게]`                                                                                                        |
| 좌표 한도                | 6.5                             | m      | `HULL_MAX_COORD`                      | `[결정]` 양자화 키를 double 정수로 정확히 묶으려는 한도: ‖round(x·1e4)‖ ≤ 65000 < 2¹⁶                                                                                                              |
| 키 오프셋                | 65536 (2¹⁶)                     | —      | `KEY_OFFSET`                          | 키 = (k_x+2¹⁶)·2³⁴ + (k_y+2¹⁶)·2¹⁷ + (k_z+2¹⁶), 각 성분 [0, 2¹⁷), 키 < 2⁵¹                                                                                                                         |
| 키 밑                    | 131072 (2¹⁷), 17179869184 (2³⁴) | —      | `KEY_BASE`·`KEY_BASE2`                | 같은 식                                                                                                                                                                                            |
| 정확한 껍질 평면 허용    | 1e-9                            | m      | `EXACT_LIMITS.plane` = `HULL_EPSILON` | 반올림만 허용(좌표 10 m에서 1e-14 크기)                                                                                                                                                            |
| 정확한 껍질 부피·폭 하한 | `Number.MIN_VALUE`              | —      | `EXACT_LIMITS`                        | `[결정: 상자 반 크기 하한 MIN_BOX_SIZE/2에서는 폭이 정확히 HULL_MIN_THICKNESS라 반올림으로 하한 아래가 될 수 있다. 퇴화 하한은 점 구름의 양자화 잡음을 거르는 것이라 정해진 위상에는 쓰지 않는다]` |

### 2.2 `collision3d.ts`

| 항목                     | 값    | 단위   | 위치                          | 상태·근거                                                                                                                 |
| ------------------------ | ----- | ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 편집 자세 겹침 문턱      | 1e-3  | m      | `EDIT_OVERLAP_TOLERANCE`      | `[사용자 결정 11/10]` 분리 < −이 값이면 겹침. 시작 겹침·인스펙터 `floorTouch`도 같은 값                                   |
| 세운 원기둥 외접 변 수   | 16    | 개     | `CYLINDER_SIDES`              | Box3D `b3CreateCylinder`. 반지름 R = r / cos 11.25° = 1.0195911582·r(+1.96 %)                                             |
| 원기둥 충돌체 외접 변 수 | 32    | 개     | `CYLINDER_COLLIDER_SIDES`     | `[가정: 외접 32각 기둥]`. 반지름 r / cos(π/32) = 1.0048385724·r(+0.48 %). 64점 = `MAX_HULL_POINTS`                        |
| "깊음" 거리              | 1e-9  | m      | `GJK_MIN_DISTANCE`            | `[결정: Box3D 100·FLT_EPSILON의 배정밀도 판]`                                                                             |
| GJK 반복 상한            | 32    | 회     | `GJK_MAX_ITERATIONS`          | `[결정]`                                                                                                                  |
| GJK 수렴 판정            | 1e-12 | m      | `GJK_TOLERANCE`               | `[결정]` 거리 상한 ‖v‖와 하한 v·w/‖v‖의 차                                                                                |
| 구로 보는 선분           | 1e-6  | m      | `MIN_CAPSULE_SEGMENT`         | `[P-M7, 결정]` 이 아래 선분은 구                                                                                          |
| 캡슐 면 나란함           | 0.998 | cos    | `CAPSULE_FACE_PARALLEL`       | Box3D `kTolerance`(convex_manifold.c:685). acos 0.998 = 3.62°                                                             |
| 특징 히스테리시스        | 5e-4  | m      | `FEATURE_TOLERANCE`           | = 4ab `REFERENCE_TOLERANCE`(Box2D k_tol = 0.1·linearSlop)                                                                 |
| 거의 나란한 모서리       | 0.005 | 무차원 | `PARALLEL_EDGE_TOLERANCE`     | Box3D `B3_PARALLEL_EDGE_TOL`(convex_manifold.c:140). asin 0.005 = 0.2865°                                                 |
| 짝마다 점 수             | 4     | 개     | `MAX_MANIFOLD_POINTS`         | Box3D `B3_MAX_MANIFOLD_POINTS`                                                                                            |
| 벽 아래 늘임             | 0.05  | m      | `WALL_BASE_DEPTH`             | `[결정: 벽 밑면이 분리 축으로 뽑히지 않게. 바닥 아래에는 아무것도 없다]`                                                  |
| 모서리 지지 분리 공차    | 1e-9  | m      | `EDGE_SUPPORT_TOLERANCE`      | `[결정: 5 리뷰]` 4ab 수용 기준 1e-6 m의 1/1000                                                                            |
| 점 줄이기 공차           | 1e-3  | m      | `REDUCE_TOLERANCE`(내부)      | `[결정: FTC 부품 크기에 맞춰 예측 띠 여유 COLLISION_MARGIN 1 mm]`. Box3D는 `B3_SPECULATIVE_DISTANCE`(4·linearSlop = 2 cm) |
| 점 줄이기 순위 치우침    | 0.95  | 무차원 | `REDUCE_BIAS`(내부)           | Box3D `b3ReduceManifoldPoints`의 치우침. 결정적이라 그대로 둠                                                             |
| 나란한 캡슐 사인         | 0.005 | 무차원 | `PARALLEL_CAPSULE_SINE`(내부) | Box3D `b3CollideCapsules alphaTol 0.05`의 자리, spec-5 §3.6 표 "사인 < 0.005"                                             |

### 2.3 `bodyCollision.ts`

| 항목                            | 값                                     | 단위   | 위치                                            | 상태·근거                                                                                                                                                                |
| ------------------------------- | -------------------------------------- | ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 예측 띠 여유                    | 1e-3                                   | m      | `COLLISION_MARGIN`                              | = `contact.ts` `WALL_MARGIN`(1 mm, 3b 관절 한계 근방 `LIMIT_MARGIN`과 같은 크기). `assumptions.md`: 실측 필요                                                            |
| 섀시–정적 수평 자리 합치기 공차 | 5e-4                                   | m      | `CHASSIS_MERGE_TOLERANCE`                       | = `FEATURE_TOLERANCE`                                                                                                                                                    |
| 짝마다 행                       | 7                                      | 개     | `MAX_PAIR_ROWS`                                 | 법선 4 + 접선 둘 + 비틀림 하나(코드는 따로 자르지 않고, 점 ≤ 4 규칙이 상한을 지킨다)                                                                                     |
| 하위 단계 충돌 행 한도          | 28                                     | 개     | `MAX_COLLISION_ROWS`                            | `[P-M10, 결정: 4짝 × 7. LCP 측정에서 행 ~70이면 한 풀이가 수십 ms]`                                                                                                      |
| 행 최소 ‖j‖²                    | 1e-12                                  | —      | `MIN_ROW_NORM2`                                 | `solveBoxLcp`는 대각 ≤ 0이면 던진다(M§5 함정 5)                                                                                                                          |
| 섀시–정적 수평 법선 하한        | 0.25                                   | 무차원 | `MIN_HORIZONTAL_NORMAL`                         | `[가정: 75.5° 넘게 누운 면은 섀시에 행이 없다. BIOBUZZ 다리 면 ‖n_h‖ ≈ 0.89, M§5 함정 4]`. acos 0.25 = 75.52°                                                            |
| 미끄러짐 방향 문턱              | 1e-3                                   | m/s    | `SLIP_DIRECTION_SPEED`                          | Bullet 속도 방향 마찰(M§5 함정 7)                                                                                                                                        |
| 지난 접선 이어쓰기 최소 길이    | 0.5                                    | 무차원 | `TANGENT_KEEP_MIN`                              | `[P-L22, 결정: M§5 함정 7 중간 단계]`                                                                                                                                    |
| 패치 무게 하한                  | 1e-3                                   | 무차원 | `PATCH_WEIGHT_MIN`                              | `[가정: Box3D relax 무게, spec-5 §1.6]`                                                                                                                                  |
| 윗면 법선 z 하한                | 0.5                                    | 무차원 | `UPWARD_NORMAL_Z`                               | `[P-M8, 가정]` 마찰 하중 상한을 거는 정적 법선(60° 이하로 누운 면)                                                                                                       |
| 실행 중 겹침 알림 깊이          | 1e-3                                   | m      | `OVERLAP_NOTICE_DEPTH`                          | `[사용자 결정 11/10]`                                                                                                                                                    |
| 받침 알림 지속                  | 0.1                                    | s      | `SUPPORT_NOTICE_DELAY`(`wheelData.ts`)          | `[가정: 급정거 한 번마다 알리지 않게]`. `collisionLift`가 `afterStep`에서 쓴다                                                                                           |
| 로봇 무게 W                     | (섀시 질량 + Σ 관절 몸체 질량)·9.80665 | N      | `BodyCollision.weight`, `GRAVITY`(`physics.ts`) | 바닥·윗면 마찰 하중 상한 h·W와 `collisionLift` 문턱이 쓴다(§7.5, §7.8). 질량은 세계 설명 `robot.body.mass`·`joints[i].body.mass`                                         |
| 참 분리 축 보충 문턱            | 1e-7                                   | m      | `SUPPLEMENT_TOLERANCE`(`fieldContact.ts`)       | `[가정: 구조물 접촉 수용 기준(침투 증가 < 1e-6 m)의 1/10]`                                                                                                               |
| 벽·구조물 마찰                  | 0.4                                    | 무차원 | `WALL_FRICTION`(`wheelData.ts`)                 | `[가정: 벽은 알루미늄 틀 + 3 mm 폴리카보네이트(AndyMark am-0481), 알루미늄–알루미늄 운동 0.4(Engineering Toolbox), 폴리카보네이트–강철 0.50–0.55의 가운데 쪽 (data §7)]` |
| 구조물 마찰                     | 0.4                                    | 무차원 | `STRUCTURE_FRICTION`(`seasons/biobuzz.ts`)      | `[가정: 구조물 접선 μ 0.4, 3c 벽 마찰과 같다(실측 없음)]`                                                                                                                |

### 2.4 `worldSpec.ts`(충돌 칸)

| 항목                       | 값        | 단위   | 위치                                      | 상태·근거                                                                                  |
| -------------------------- | --------- | ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| 몸체 하나의 충돌체 수      | 16        | 개     | `MAX_BODY_COLLIDERS`                      | `[결정: LCP·넓은 단계 비용, spec-5 부록 A]`                                                |
| 세계 전체 충돌체 수        | 64        | 개     | `MAX_WORLD_COLLIDERS`                     | 같은 근거                                                                                  |
| 무시 짝 수                 | 136       | 개     | `MAX_COLLISION_IGNORE`                    | 몸체 17개(섀시 + 관절 16)의 짝 수 17·16/2                                                  |
| 관절 수                    | 16        | 개     | `MAX_WORLD_JOINTS`                        | 3b                                                                                         |
| 캡슐·원기둥 반지름         | [5e-4, 1] | m      | `MIN_CAPSULE_RADIUS`·`MAX_CAPSULE_RADIUS` | `[결정]`                                                                                   |
| 충돌체 마찰 한도           | [0, 2]    | 무차원 | `MAX_COLLIDER_FRICTION`                   | `[결정: Unity Physics Material 칸과 같은 0 이상, FTC 재질에는 2면 넉넉하다]`               |
| 기본 마찰                  | 0.4       | 무차원 | `DEFAULT_COLLIDER_FRICTION`               | `[가정: 사용자 결정 11/10, 3c WALL_FRICTION과 같다]`                                       |
| 바닥 마찰                  | 0.4       | 무차원 | `FLOOR_FRICTION`                          | `[가정: 사용자 결정 11/10, 타일 위 알루미늄·PLA, 실측 없음]`                               |
| 상자 크기 하한             | 1e-3      | m      | `MIN_BOX_SIZE`                            | `[결정: spec-5 §2.1]` 세계 설명의 반 크기는 MIN_BOX_SIZE/2 = 5e-4 이상                     |
| 상자 회전 행렬 공차        | 1e-9      | —      | `BOX_ROTATION_TOLERANCE`                  | `[결정: three Matrix4 곱 사슬의 반올림 ~1e-15보다 넉넉히]`                                 |
| 원기둥 높이 하한           | 1e-3      | m      | `MIN_CYLINDER_HEIGHT`                     | `[결정: 상자 크기 하한과 같은 값]`                                                         |
| 원기둥 뚜껑 중심 간격 하한 | 5e-4      | m      | `MIN_CYLINDER_SEGMENT`                    | = `MIN_CYLINDER_HEIGHT` / 2 `[결정]`(몸체 틀 행렬로 옮긴 끝점의 반올림 여유)               |
| 좌표 한도                  | 10        | m      | `MAX_COORD`(내부)                         | 상자 중심·캡슐 끝점·상자 반 크기 위 한도                                                   |
| 상자 회전 원소 한도        | 2         | —      | `boxRotation`(내부)                       | `[결정]` 정규 직교 행렬 원소는 ≤ 1이지만 곱을 재기 전에 터무니없는 수를 거르는 넉넉한 한도 |

### 2.5 렌더러(`scene/collider.ts`·`worldColliders.ts`·`meshHull.ts`·`stepImport.ts`)

| 항목                         | 값                                                              | 단위 | 위치                                                             | 상태·근거                                                                      |
| ---------------------------- | --------------------------------------------------------------- | ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 오브젝트당 Collider          | 8                                                               | 개   | `MAX_OBJECT_COLLIDERS`                                           | `[결정: 몸체 16 한도 아래에서 부품마다 몇 개]`                                 |
| center·size 위 한도          | 10                                                              | m    | `MAX_COLLIDER_EXTENT`                                            | 세계 설명 `MAX_COORD`와 같다. 캡슐·원기둥 height는 그 두 배(20 m)까지          |
| Mesh Collider 꼭짓점 한도 칸 | [8, 64]                                                         | 개   | `MIN_VERTEX_LIMIT`·`MAX_VERTEX_LIMIT`                            | `[결정: spec-5 §1.2 Vertex Limit 8–64]`, PhysX `vertexLimit`에 대응            |
| 기본 꼭짓점 한도             | 32                                                              | 개   | `DEFAULT_VERTEX_LIMIT`                                           | = `HULL_DEFAULT_VERTEX_LIMIT`(Box3D boulder)                                   |
| 껍질 오차 경고               | 2e-3                                                            | m    | `HULL_ERROR_WARN`                                                | `[조사 결정 M§3 6, F7]` 사용자 Mesh Collider만 경고(자동 껍질은 경고하지 않음) |
| 자기 충돌 [그래도 충돌] 목록 | 136                                                             | 짝   | `MAX_FORCE_COLLIDE`                                              | 몸체 17개의 짝 수                                                              |
| 추가 기본 크기               | Box 0.1 m 정육면체, Capsule r 0.05·h 0.2, Cylinder r 0.05·h 0.1 | m    | `FALLBACK_BOX_SIZE`·`FALLBACK_CAPSULE_*`·`FALLBACK_CYLINDER_*`   | `[결정: spec-5 §1.2]`, 원기둥은 `[결정: 6a, 롤러 한 토막 어림]`                |
| 메시 껍질 꼭짓점 한도        | 64                                                              | 개   | `MESH_HULL_VERTEX_LIMIT`                                         | = `MAX_HULL_POINTS`                                                            |
| 메시 캐시 형식 태그          | `model-v5`                                                      | —    | `MESH_CACHE_TAG`                                                 | 메시 껍질(`model-v4`) + 5 리뷰의 껍질 삼각형 대체(`model-v5`)로 올림           |
| 임시 상자 로봇               | 18 in = 0.4572 m 정육면체 [−0.2286, 0.2286]² × [0, 0.4572]      | m    | `ROBOT_SIZE`(`scene/coordinates.ts`), `PLACEHOLDER_BOUNDS.robot` | 임시 상자 로봇도 18 in 상자 섀시를 갖는다                                      |
| 임시 웹캠 상자               | (−0.015, −0.045, −0.015)–(0.026, 0.045, 0.015)                  | m    | `PLACEHOLDER_BOUNDS.webcam`                                      | 코드 값                                                                        |
| 충돌 모델 기억               | 로봇 16개                                                       | 개   | `ENTRY_LIMIT`(`editor/collider/useCollisionModel.ts`)            | `[가정: 한 씬의 로봇은 이보다 적다]`                                           |

### 2.6 `articulation.ts`의 LCP(충돌 행이 쓰는 풀이)

| 항목                   | 값                                               | 위치                             | 상태·근거                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 정칙화                 | 행마다 대각에 1e-9·A_ii                          | `LCP_REGULARIZATION`             | `[가정: 1e-9면 조건수 1e9라 배정밀도 LDLᵀ가 다룬다]`. ODE CFM·MuJoCo 방식                                                                                                                                                                  |
| 블록 전환 허락 횟수    | 3                                                | `BPP_TRIES`                      | `[가정: 문헌(Júdice–Pires)의 보통 값 3–10]`                                                                                                                                                                                                |
| 근접점 반복 상한       | 8                                                | `LCP_PROXIMAL_STEPS`             | `[가정]` Rockafellar 1976                                                                                                                                                                                                                  |
| 상보성·경계 허용       | 1e-12 × max(1, ‖b‖) · 1e-12 × max(1, ‖lo‖, ‖hi‖) | `LCP_RELATIVE_TOLERANCE`         | `[가정(출처 없음): 배정밀도 반올림의 약 4500배]`                                                                                                                                                                                           |
| 주축 전환 반복 상한    | 2000                                             | `LCP_MAX_ITERATIONS`             | `[가정: 행이 50개 아래면 보통 10번 안에 끝난다]`. 넘으면 던짐                                                                                                                                                                              |
| Murty만 쓰는 시작 반복 | 200                                              | `LCP_MURTY_ONLY_AFTER`           | `[결정: 5 LCP 퍼즈(spec-5 A26, P-M10)에서 블록 전환과 Murty의 혼합이 순위가 크게 모자란 접촉꼴 문제(행 40·좌표 12)를 2000회 안에 끝내지 못했다(Murty만은 562회)]`. 이 수 안에 끝나는 풀이는 연산이 그대로라 기준 해시 일곱이 그대로        |
| 한계 근방 여유         | 1e-3 (m 또는 rad)                                | `LIMIT_MARGIN`(export)           | `[가정: FTC 관절이 한 하위 단계(1 ms)에 움직이는 양(1 m/s·10 rad/s에서 1 mm·0.01 rad)과 같은 크기]`. 한계 행을 늘 넣는 범위: 간격 ≤ ‖q̇‖·h + 이 값(§8.4). `contact.ts`의 `WALL_MARGIN`(= `COLLISION_MARGIN`)이 이 값과 같은 크기로 정해졌다 |
| 한계 초과 허용         | 1e-12 (m 또는 rad)                               | `LIMIT_TOLERANCE`                | `[가정: FTC 관절 값(1e-3–10 m·rad)의 배정밀도 반올림보다 크고 측정할 수 있는 침투(µm)보다 훨씬 작다]`. 풀고 난 위치가 한계를 이만큼 넘으면 빠진 한계 행을 더해 다시 푼다                                                                   |
| 질량 행렬 대각 바닥    | 1e-9 (kg 또는 kg·m²)                             | `MIN_COORDINATE_INERTIA`(export) | `[가정: 1 g 점질량이 1 mm 떨어진 관성]`. 몸체 관성이 축 둘레로 0이고 회전자도 없는 관절에서 질량 행렬이 특이해지지 않게 `coordinateMass`가 대각에 더한다                                                                                   |
| 부유 기저 가상 관절 수 | 3                                                | `BASE_JOINTS`(export)            | 필드 X 직선, 필드 Y 직선, Z 회전. `relativeJacobian`의 기저 열(k < 3)이 이 순번이다                                                                                                                                                        |

---

## 3. 볼록 껍질(`hull.ts`)

### 3.1 목적과 성질

순수 TS이고 결정적이다(배열 순서만 쓰고, 같으면 작은 순번을 고르고, Map은 키 찾기에만 쓴다). Box3D `hull.c`(MIT)의 구조를 따른다: 가장 먼 점부터 넣어 꼭짓점 한도까지 채우는 "안에 그린" 껍질과 거의 같은 평면의 면 합치기. three `ConvexHull`은 같은 평면 면을 합치지 않고 공차가 기계 오차 수준이라 쓰지 않고 시험 오라클로만 쓴다(`scene/hullOracle.test.ts`). 사칙연산과 `Math.sqrt`만 쓴다. `Hull` = 꼭짓점·면(꼭짓점 번호 반시계 목록, 단위 법선, offset)·모서리(a < b, left·right 면 번호)·무게중심·부피·`error`. 같은 입력이면 같은 껍질이다(입력 순서와 무관).

### 3.2 양자화(입력 정규화)

1. 입력은 `Vec3[]` 또는 xyz를 이어 붙인 수 배열(`Float32Array`: 워커의 메시 position). 수 배열 길이가 3의 배수가 아니면 null.
2. 각 성분이 유한하지 않거나 ‖x‖ > 6.5(`HULL_MAX_COORD`)이면 null(`quantizePoints`는 `RangeError`).
3. k = Math.round(x · 10000) + 65536. 키 = k_x · 2³⁴ + k_y · 2¹⁷ + k_z.
4. 키 배열을 `Float64Array.sort()`로 정렬하고 같은 키를 뺀다(사전식 x, y, z 정렬과 같다). 복원은 (k − 65536) / 10000(−0이 나오지 않는다).
5. 점이 4개 미만이면 null.

### 3.3 Quickhull(`buildHull`)

꼭짓점 한도 `limit` = `Math.floor`한 뒤 [4, 64]로 자름(유한하지 않으면 32).

1. 처음 단체:
   - p0 = 정렬 첫 점. i1 = p0에서 제곱 거리가 가장 큰 점(엄격한 `>`, 같으면 작은 순번). 거리 ≤ 1e-9이면 null.
   - i2 = p0–i1 직선에서 ‖(p − p0) × axis‖²가 가장 큰 점. 거리 ≤ 1e-9이면 null.
   - 평면 법선 = unit((p1 − p0) × (p2 − p0)). i3 = 그 평면에서 ‖n·(p − p0)‖가 가장 큰 점, 부호 side 기억. 거리 ≤ 1e-9이면 null.
   - 밑면 (a, b, c) = side > 0이면 (0, i2, i1), 아니면 (0, i1, i2). 삼각형 (a,b,c), (b,a,d), (c,b,d), (a,c,d)(d = i3). 삼각형마다 법선 n = unit((b − a) × (c − a)), d_f = n·a.
2. 충돌점: 단체 밖의 점을 정렬 순서로 보며 처음으로 n·p − d_f > 1e-9인 면(면 순번 순)에 넣는다. 면마다 가장 먼 점(엄격한 `>`, 같으면 먼저 들어온 작은 순번).
3. 가장 먼 점 넣기(꼭짓점 수 < limit인 동안):
   - 살아 있는 면 가운데 가장 먼 점이 가장 먼 면(같으면 점 순번이 작은 면)의 그 점 = eye. 충돌점이 있는 면이 없으면 끝.
   - 보이는 면 = eye 면에서 시작한 깊이 우선 탐색(이웃은 모서리 순서, 이웃 면에서 eye까지 거리 > 1e-9이면 보임). 보이지 않는 이웃과의 모서리가 지평선(quickhull3d `computeHorizon` 꼴).
   - 지평선이 닫힌 단순 고리(≥ 3개, 끝이 다음 시작과 이어지고 꼭짓점이 반복되지 않음)가 아니면 넣기를 멈춘다(공차 근처의 드문 퇴화면: 남은 충돌점은 오차에 든다).
   - 버려진 면의 충돌점(eye 제외)은 점 순번 순으로 모아 지평선 순서로 만든 새 삼각형 (from, to, eye)에 처음으로 거리 > 1e-9인 면에 다시 넣는다. 새 삼각형이 퇴화하면 null.
   - 꼭짓점 수 += 1 − (보이는 면의 꼭짓점 가운데 지평선에 없는 것의 수).
4. 넣지 못한 충돌점은 오차 계산에 쓴다.

### 3.4 면 합치기(`mergeFaces`·`mergePolygons`)

삼각형을 모서리 (작은 꼭짓점, 큰 꼭짓점) 사전순으로 보며 처음으로 합칠 수 있는 두 면을 합치고, 합치면 합친 면이 든 앞 모서리부터 다시 본다(면 수가 줄기만 해서 끝난다). 합치기를 거절한 짝은 기억해 다시 재지 않는다(결과는 매번 처음부터 모두 다시 재는 것과 같다). 두 면 L, R을 모서리 (u, v)로 합치는 조건:

- 법선 내적 `dot(n_L, n_R) ≥ HULL_MERGE_COS`(3° 안).
- L은 u → v, R은 v → u 방향으로 이 모서리를 가져야 하고, 합친 목록에 꼭짓점이 겹치지 않는다.
- 합친 다각형의 Newell 법선과 꼭짓점 평균의 평면에서 모든 꼭짓점의 거리 ≤ 1e-4(`HULL_MERGE_DISTANCE`).
- 볼록: 연속한 세 꼭짓점(prev, here, next)마다 turn = ((here − prev) × (next − here)·n) / ‖next − prev‖ > −1e-9(같은 직선 위 점은 받고 뒤의 차수 2 빼기가 지운다).

합친 뒤 꼭짓점이 정확히 면 둘에만 속하는(차수 2) 꼭짓점을 두 면에서 뺀다.

### 3.5 정규화·검사(`finishHull`)

1. 면 목록을 가장 작은 꼭짓점 번호부터 돌리고 사전순으로 정렬한다. 꼭짓점은 사용된 것만 오름차순으로 다시 번호를 매긴다.
2. 면 법선은 Newell(단위), offset = 면 꼭짓점의 n·v 최대.
3. 방향 있는 모서리마다 면이 하나, 반대 방향도 정확히 하나(다양체). 모서리 (a < b)는 (a, b) 사전순.
4. Euler V − E + F = 2이고 모든 꼭짓점이 면에 속함.
5. 모든 꼭짓점이 모든 면 평면 안쪽(n·q − offset ≤ limits.plane)이고 가장 얇은 폭 min_f(offset_f − min_v n_f·v) ≥ limits.thickness.
6. 부피 = 꼭짓점 평균을 기준으로 면 부채꼴 사면체 합(발산 정리) ≥ limits.volume. 무게중심 = ref + Σ(six·(a + b + c)) / (24·V).

limits: 점 구름(`CLOUD_LIMITS`) plane 1e-4·volume 1e-9·thickness 1e-3, 정확한 껍질(`EXACT_LIMITS`) plane 1e-9·volume/thickness `Number.MIN_VALUE`.

합치기·차수 2 빼기가 위상을 깨면(얇은 조각 삼각형이 합친 면과 모서리 둘을 나눠 꼭짓점 둘로 줄거나, 빼낸 꼭짓점이 새 면 밖에 남음) 합치지 않은 Quickhull 삼각형으로 마친다. `[결정: 5 리뷰, 얇은 판 구름 0.3%가 퇴화가 아닌데 null이었다. 합치기가 되는 입력은 그대로다]`. 삼각형 껍질은 늘 볼록 다양체라 퇴화(부피·폭)만 null이 된다.

### 3.6 `error`(오차)

넣지 못한 충돌점 q마다 `max_f(n_f·q − offset_f)`의 최대(≥ 0). 실제 거리의 하한(평면 거리)이므로 인스펙터는 "약"이라고 말한다. 위상이 정해진 껍질은 0. `hullError(points, hull)`는 시험·진단용 전수 오차(양자화한 모든 입력 점).

### 3.7 정확한 껍질

| 함수                              | 입력                                                | 위상                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boxHull(center, rotation, half)` | 중심, 행 우선 회전 9개(정규 직교, det > 0), 반 크기 | 꼭짓점 k의 비트 0·1·2가 자기 x·y·z의 +쪽(`seasons/fieldGeometry.ts boxVertices`와 같은 순서), center + R·(±half). 면(바깥에서 반시계): −x [0,4,6,2], +x [1,3,7,5], −y [0,1,5,4], +y [2,6,7,3], −z [0,2,3,1], +z [4,5,7,6] |
| `prismHull(points)`               | 2n점(아래 n각형 반시계 + 같은 순서의 위 n점, n ≥ 3) | 아래·위 면과 사각 옆면 n개. 아래 다각형이 위 면 쪽에서 볼 때 시계 방향이면 면 방향을 뒤집는다. 꼭짓점 순서는 입력 그대로                                                                                                  |
| `transformHull(hull, R, t)`       | 강체 변환                                           | 새 객체. 꼭짓점 R·v + t, 법선 R·n, offset d + (R·n)·t. 면의 꼭짓점 목록과 모서리 배열은 같은 배열을 함께 쓴다(얼린 껍질도 받는다)                                                                                         |

위상이 틀리면 던진다(호출하는 쪽의 버그).

### 3.8 정규 껍질 `canonicalHull(V)`

`canonicalHull(points)` = `buildHull(points, MAX_HULL_POINTS)`(64). 렌더러 표시·앞 계산·메인 생성이 모두 이것을 쓴다(spec-5 §1.11 정규 입력: 렌더러가 보낸 점 V로 메인이 같은 함수를 다시 부른다. 합치기는 탐욕적이라 "같은 꼭짓점 → 같은 껍질"은 보장되지 않으므로 같은 입력 V에 같은 함수로만 맞춘다). 점 배열 객체를 키로 `WeakMap`에 마지막 결과를 기억하고, 지금 좌표가 기억한 좌표와 `Object.is`로 모두 같을 때만 쓴다(배열을 고쳐 쓰면 다시 만든다). 결과는 깊게 얼린다. 이유: 64점 껍질 하나가 0.5–0.7 ms라 충돌체 64개 세계에서 `parseWorldSpec` 검사와 `BodyCollision` 생성이 각각 만들면 생성자 예산(30 ms)을 넘었다(spec-5 §12). 값은 기억 없이 만든 것과 같다.

### 3.9 껍질을 만드는 곳과 한도

| 쓰이는 곳            | 점                                                 | 꼭짓점 한도                           | 위치                            |
| -------------------- | -------------------------------------------------- | ------------------------------------- | ------------------------------- |
| 메시 하나(STEP 워커) | 피벗 기준 메시 position                            | 64                                    | `stepImport.ts meshHullOf`      |
| 몸체 자동 껍질       | 같은 몸체 메시 껍질 점들을 몸체 틀로 옮겨 모은 것  | 32                                    | `worldColliders.ts computeBody` |
| 사용자 Mesh Collider | 그 오브젝트 하위의 같은 몸체 메시 껍질 점          | Collider `vertexLimit`(8–64, 기본 32) | `computeBody`                   |
| 세계 설명 convex     | 렌더러가 V = `buildHull(점, 한도).vertices`를 보냄 | 4–64개 점                             | `worldSpec.ts`                  |
| 메인·표시·오차       | `canonicalHull(V)`                                 | 64                                    | 모든 곳                         |

---

## 4. 정적 형상(`staticShapes(field)`)

얼린 `FieldSpec`마다 하나를 `WeakMap`에 기억하고 결과를 깊게 얼린다(`BodyCollision`은 `transformHull`로 새 객체만 만든다, P-M11). 순서: 벽 넷(+x, −x, +y, −y, `contact.ts WALLS` 순서) → 구조물(배열 순번 순, 규칙에 맞는 것) → 바닥. 토큰은 `w0`…`w3`, `s<구조물 순번>`, `fl`이다. 양자화하지 않는다(P-M4·C-M9).

### 4.1 벽 넷

`axisBox`가 꼭짓점 기둥(`prismHull`: 아래 4점 반시계 + 위 4점)으로 상자를 만든다(`boxHull`의 중심 ± 반 크기는 (ih + t/2) − t/2가 ih와 1 ulp 다를 수 있어 벽 안쪽 면이 `innerHalf`와 어긋나므로, 면 평면이 받은 좌표와 비트로 같도록 꼭짓점을 직접 준다 `[결정: spec-5 §3.2]`). 판 inset·이음은 무시하고(4ab 접촉 기준면과 같은 평면, 레일 윗면이 벽 윗면), 모서리에서 두 벽 상자가 겹친다(정적끼리라 무관).

기호: ih = `perimeter.innerHalf`, t = `perimeter.thickness`, H = `perimeter.height`, o = ih + t, z₀ = −`WALL_BASE_DEPTH` = −0.05.

| 토큰 | 이름 | x 범위    | y 범위    | z 범위  | 마찰 | 섀시 | 관절 |
| ---- | ---- | --------- | --------- | ------- | ---- | ---- | ---- |
| `w0` | `x+` | [ih, o]   | [−o, o]   | [z₀, H] | 0.4  | 예   | 예   |
| `w1` | `x-` | [−o, −ih] | [−o, o]   | [z₀, H] | 0.4  | 예   | 예   |
| `w2` | `y+` | [−o, o]   | [ih, o]   | [z₀, H] | 0.4  | 예   | 예   |
| `w3` | `y-` | [−o, o]   | [−o, −ih] | [z₀, H] | 0.4  | 예   | 예   |

벽 값(시즌 데이터, 출처는 `field-biobuzz.md`):

| 시즌    | ih                             | t                             | H                                               | o         |
| ------- | ------------------------------ | ----------------------------- | ----------------------------------------------- | --------- |
| BIOBUZZ | 1.79286 m(레일 안쪽 면)        | 0.02705 m(레일 두께 1.065 in) | 0.29576 m(타일 윗면부터 위 레일 윗면 11.644 in) | 1.81991 m |
| 'none'  | 1.8163 m (= 12 ft/2 − 0.025/2) | 0.025 m                       | 0.3 m                                           | 1.8413 m  |

### 4.2 구조물

배열 순서대로 `carrier === 'field'`이고 (`solid` 또는 `occludes`)인 구조물만 넣는다. 섀시는 `solid`만, 관절 몸체는 `solid ∨ occludes`("실체가 있는 물체", 4d 가림과 같은 집합) `[결정: FieldSpec에 새 플래그를 두지 않는다]`. HIVE carrier(`hiveRed`·`hiveBlue`) 요소는 움직이는 경기 요소라 늘 뺀다. 마찰은 구조물 `friction`(BIOBUZZ 0.4). 상자는 `boxHull(center, rotationMatrix(rotation), size/2)`, 세운 원기둥은 `prismHull(cylinderPrism(center, rotation, radius, height))`(BIOBUZZ에 원기둥은 없다).

BIOBUZZ 17개 가운데 5가 쓰는 것(필드 좌표 m, 회전은 라디안 X·Y·Z, 짝은 정확한 Rz(π)로 생성한 180° 짝):

| 순번  | 종류                                    | 중심                           | 크기(자기 축)               | 회전                        | solid  | occludes | 섀시   | 관절   |
| ----- | --------------------------------------- | ------------------------------ | --------------------------- | --------------------------- | ------ | -------- | ------ | ------ |
| 0     | 발판 막대(−Y)                           | (0, −0.60303, 0.02728)         | (0.98938, 0.05037, 0.05456) | 0                           | 예     | 예       | 예     | 예     |
| 1     | 발판 막대 짝                            | 0의 Rz(π)                      | 같음                        | —                           | 예     | 예       | 예     | 예     |
| 2     | 다리 (+X,+Y)                            | (0.24216, 0.46404, 0.52853)    | (0.03023, 0.02541, 1.16215) | (0.43065, 0.2265, −1.46769) | 예     | 예       | 예     | 예     |
| 3     | 다리 (−X,+Y)                            | (−0.24216, 0.46404, 0.52853)   | 같음                        | (−0.43065, 0.2265, −1.6739) | 예     | 예       | 예     | 예     |
| 4, 5  | 다리 짝                                 | 2, 3의 Rz(π)                   | 같음                        | —                           | 예     | 예       | 예     | 예     |
| 6     | 위 막대                                 | (0, 0, 1.05283)                | (0.0254, 0.6096, 0.0254)    | 0                           | 아니오 | 예       | 아니오 | 예     |
| 7     | 로고 판(+X)                             | (0.07407, 0, 0.94097)          | (0.00297, 0.76606, 0.16408) | (0, −0.41888, 0)            | 아니오 | 예       | 아니오 | 예     |
| 8     | 로고 판 짝                              | 7의 Rz(π)                      | 같음                        | —                           | 아니오 | 예       | 아니오 | 예     |
| 9     | FLOWER `<1>`(−X 벽)                     | (−1.72993, −0.59417, 0.287705) | (0.12586, 0.151, 0.57541)   | 0                           | 예     | 예       | 예     | 예     |
| 10    | FLOWER 짝                               | 9의 Rz(π)                      | 같음                        | —                           | 예     | 예       | 예     | 예     |
| 11    | FLOWER `<3>`(빨강 벽)                   | (0.59417, −1.72993, 0.287705)  | (0.151, 0.12586, 0.57541)   | 0                           | 예     | 예       | 예     | 예     |
| 12    | FLOWER 짝                               | 11의 Rz(π)                     | 같음                        | —                           | 예     | 예       | 예     | 예     |
| 13–16 | HIVE CELL(carrier `hiveRed`·`hiveBlue`) | —                              | —                           | —                           | 아니오 | 아니오   | 아니오 | 아니오 |

결과: BIOBUZZ에서 섀시 정적 짝은 충돌체 하나당 14개(벽 4 + 구조물 0–5와 9–12 = 10), 관절 몸체 정적 짝은 18개(벽 4 + 구조물 0–12 = 13 + 바닥 1). 이 개수는 위 데이터에서 센 것이다. 'none' 시즌은 구조물이 0개라 섀시 4개·관절 5개다. 다리 값은 CAD 메시 SVD 맞춤 OBB(주석: 재구성 오차 3e-16, 메시가 OBB 밖으로 나간 양 최대 0.19 mm), FLOWER는 Layer B 범위 상자(`am-5855`)이고 벽 쪽 면이 벽 안쪽 면과 같은 평면이다(상세는 `field-biobuzz.md`).

### 4.3 바닥

`token: 'fl'`, 껍질 없음(z = 0, 법선 +z), 마찰 `FLOOR_FRICTION` 0.4, 섀시 `chassis: false`, 관절 `joints: true`. 각 정적 형상은 알림·경고용 `target`(`wall:x+` 등, `structure:<i>`, `floor`)을 갖는다.

### 4.4 세운 원기둥 외접 16각 기둥(`cylinderPrism`)

사분면 하나의 cos θ_k(θ_k = k·22.5°, k = 0…3)를 제곱근 식으로 쓴다: cos 22.5° = √(2 + √2)/2, cos 45° = √2/2, cos 67.5° = √(2 − √2)/2. 꼭짓점 각 k·22.5°, 반지름 R = r / cos 11.25°(cos 11.25° = √(2 + √(2 + √2))/2)이고 사분면 q는 (x, y) → (−y, x)를 q번 돌려 만든다. 32점 = 아래 고리(z = −height/2) 16 + 위 고리(z = +height/2) 16(같은 각 순서), 회전은 `rotationMatrix(rotation)`(4ab와 같은 sin·cos)이고 자기 z가 축이다. R = 1.0195911582·r.

---

## 5. 몸체 형상(`bodyShape`·`placeShape`)

### 5.1 충돌체 → 형상

| `SimCollider`  | 형상                                                                | 비고                                                                  |
| -------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `convex`       | `canonicalHull(points)`(null이면 null 반환)                         | 렌더러가 보내는 점은 이미 0.1 mm 격자 위                              |
| `box`          | `boxHull(center, rotation, half)`                                   | 양자화 없음                                                           |
| `capsule`      | 선분 a–b + 반지름 r. sphere = ‖b − a‖ < `MIN_CAPSULE_SEGMENT`(1e-6) |                                                                       |
| `cylinder`(6a) | `prismHull(cylinderColliderPoints(a, b, radius))`                   | 공이 아닌 짝의 근사(외접 32각 기둥). 공과의 짝은 정확한 구–원기둥(6a) |

`radius`(넓은 단계용): 껍질 = 몸체 원점에서 가장 먼 꼭짓점 거리, 캡슐 = max(‖a‖, ‖b‖) + r.

### 5.2 원기둥 충돌체 외접 32각 기둥(`cylinderColliderPoints`)

입력: 두 뚜껑 중심 a, b, 반지름 r. 축 d = unit(b − a)(길이 0이면 던짐; `parseWorldSpec`이 `MIN_CYLINDER_SEGMENT`로 막는다). k = |d_k|가 가장 작은 틀 축(같으면 x → y → z), e = 그 축의 단위 벡터, u = unit(d × e), v = d × u, 외접 반지름 R = r / cos(π/32), cos(π/32) = √(2 + √(2 + √(2 + √2)))/2. 사분면 하나의 각 k·11.25°(k = 0…7)의 cos·sin을 제곱근 식으로 쓴다: cos 11.25° = √(2 + √(2 + √2))/2, cos 22.5° = √(2 + √2)/2, cos 33.75° = √(2 + √(2 − √2))/2, cos 45° = √2/2, cos 56.25° = √(2 − √(2 − √2))/2, cos 67.5° = √(2 − √2)/2, cos 78.75° = √(2 − √(2 + √2))/2. 고리 j번 점 = center + R·(x_j·u + y_j·v), 사분면 q = ⌊j/8⌋만큼 (x, y) → (−y, x)를 돌린다. 점 순서: a 쪽 고리 32점 + b 쪽 고리 32점. `prismHull`이 받는 순서이고 64점 = `MAX_HULL_POINTS`이다.

### 5.3 몸체 틀에서 접촉 틀로(`placeShape`)

껍질은 `transformHull(R, o)`, 캡슐은 끝점을 R·v + o로 옮긴다(R·o는 접촉 틀 C에서 본 그 몸체의 틀 `frames.bodies[body + 1]`). 몸체 틀 → 접촉 틀 속도는 `contactFrames().velocities`.

---

## 6. 좁은 단계(`collision3d.ts`)

좁은 단계는 GJK/EPA가 아니라 SAT다(M§1.1). 행이 간격 0으로 쉬므로(목표 −max(gap, 0)/h, 피부 없음) 분리 축과 그 위의 자른 점이 바로 필요하다. 면 축과 Gauss 지도로 거른 모서리–모서리 축(Gregorius GDC 2013, Box3D `convex_manifold.c`)을 쓰고, 기준 면에 사건 면을 잘라 점을 낸 뒤 4점까지 줄인다. 짝마다 지난 분리 특징을 기억해(`SatCache`) 하위 단계 사이에 기준이 뒤집히지 않게 하고(히스테리시스 `FEATURE_TOLERANCE`), 닿은 동안 기억이 맞으면 모서리 질의를 건너뛴다(Box3D `:1330`·`1369`·`1445`). 둥근 형상(캡슐·구)이 든 짝은 Box3D처럼 GJK 거리가 먼저다(얕음 1–2점, 깊음만 SAT, convex_manifold.c:647–775, P-H2). 점 위치는 두 표면의 가운데(기준이 A·B 사이에서 바뀌어도 자리가 안정, Box3D)다.

### 6.1 껍질 준비(`prepare`)

A의 0번 꼭짓점 o로 옮긴 틀에서 계산한다(Box2D v3처럼 반올림을 줄인다). 꼭짓점 p − o, 면 법선 n_f, 면 offset d_f = offset − n_f·o, 모서리마다 방향 e = p_b − p_a와 left·right 면 법선(9·E 배열), 무게중심 − o. 위상 `topology`는 모서리 배열을 키로 기억한다(면의 꼭짓점 k → k+1 모서리 순번, 꼭짓점마다 그 꼭짓점을 가진 면(오름차순)).

### 6.2 면 질의

```
면 f의 분리   sep_f = min_{q ∈ 다른 껍질 꼭짓점} ( n_f·q − d_f )      (선형 탐색, 같으면 작은 순번, P-L23 1)
faceQuery     = max_f sep_f  (엄격한 >, 같으면 작은 순번). sep > band 면 바로 반환(분리)
```

### 6.3 모서리 질의(Gauss 지도)

A 모서리 e_A(양쪽 면 법선 u_A = left, v_A = right)와 B 모서리 e_B(u_B, v_B):

```
cba = u_B·e_A      dba = v_B·e_A      adc = −u_A·e_B      bdc = −v_A·e_B
Minkowski 면이다  ⇔  cba·dba < 0  ∧  adc·bdc < 0  ∧  cba·bdc > 0          (Box3D :1395–1401 꼴, 모서리 방향으로 쓴 Gregorius 판정)
거의 나란하다     ⇔  max(cba², dba²) < PARALLEL_EDGE_TOLERANCE² · ‖e_A‖²   → 건너뜀
축 u = unit(e_A × e_B), A 무게중심 → A 모서리 점 방향이 되게 부호 맞춤(dot(u, p_A − centroid_A) < 0 이면 −u)
공식 분리 sep_formula = u·(p_B − p_A)
지지 분리 sep_support = min_{q∈B} u·q − max_{p∈A} u·p
모서리 분리 = sep_formula > sep_support + EDGE_SUPPORT_TOLERANCE ? sep_support : sep_formula
```

공식 값이 지지 분리를 `EDGE_SUPPORT_TOLERANCE`(1e-9) 넘게 넘으면 지지 분리로 자른다 `[결정: 5 리뷰]`: 합친 면(`buildHull`)의 Newell 법선은 짧은 모서리에 수직이 아니라(면이 평면에서 `HULL_MERGE_DISTANCE`까지 벗어나 5 mm 모서리에 약 2° 기움) 거의 나란한 짝에서 Gauss 판정이 틀리게 지나가고, 공식이 +0.6 m 같은 거짓 분리를 내 닿은 짝을 분리로 보고 기억(`SatCache`)까지 이어졌다. 정확한 껍질(`boxHull`·`prismHull`)의 참 Minkowski 면에서는 두 값이 반올림(1e-15)만 달라 값이 그대로이고(기준 해시), 거짓 분리는 잡는다. 어느 쪽이든 지지 분리는 거리의 하한이라 거짓 분리가 없다. 모서리 전체 질의는 `edgeQuery`(최대 분리, band 넘으면 바로 반환). 시험 감시용 `SAT_COUNTERS.edgeQueries`가 횟수를 센다(결과에 쓰지 않음).

모서리 접촉 법선(B → A) = −u.

### 6.4 전체 SAT와 특징 고르기(`collidePrepared`)

입력: 두 준비한 껍질, band(짝의 예측 띠), cache(`SatCache`: kind faceA·faceB·edge, 면·모서리 번호, 지난 분리, touching).

1. 기억한 특징의 지금 분리를 잰다(`cachedFeature`: 면이면 `faceSeparation`, 모서리면 `edgeAxis`+`edgeSeparation`, 모서리 짝이 더는 Minkowski 면이 아니면 없음). 지금 분리 > band면 분리로 끝.
2. 닿은 동안 빠른 길: `cache.touching`이고 ‖remembered.sep − cache.separation‖ ≤ `FEATURE_TOLERANCE`이면 면 질의만 한다(`P-L14`). 두 면 질의가 band를 넘으면 분리로 끝. faceMax = 더 큰 쪽(같으면 A 면). faceMax.sep ≤ remembered.sep + `FEATURE_TOLERANCE`이면 기억한 특징으로 접촉을 만든다. 가장 깊은 점이 기억한 분리에서 `FEATURE_TOLERANCE` 안이거나 모서리 특징일 때만(`realized`) 모서리 질의를 건너뛴다(면 분리를 이루는 꼭짓점이 자른 영역 밖이면 참 축은 다른 축이라 전체 SAT를 한다 `[결정: 5 A16 퍼즈에서 섀시 면 분리가 −1.2 mm로 그대로인 동안 섀시 세로 모서리가 다리 모서리로 들어갔다]`). 기억한 분리(`cache.separation`)는 바꾸지 않는다(Box3D: 맞으면 cache를 그대로 둔다, `:1330`). 그래야 모서리 질의를 건너뛰는 동안 분리가 하위 단계마다 `FEATURE_TOLERANCE`씩 흘러가 전체 SAT를 끝없이 미루지 않는다.
3. 전체 SAT: faceA 질의 → faceB 질의(각각 band 넘으면 분리로 끝) → 모서리 질의(band 넘으면 분리로 끝). bestFace = faceB.sep > faceA.sep ? faceB : faceA. best = 모서리가 bestFace보다 크면 모서리, 아니면 bestFace.
4. 히스테리시스: remembered.sep ≥ best.sep − `FEATURE_TOLERANCE`이면 기억한 특징을 쓴다(접촉 점이 있을 때).
5. 특징 고르기(절대 공차만): chosen = faceB.sep > faceA.sep + `FEATURE_TOLERANCE` ? faceB : faceA. 면 접촉을 만든다. 모서리 후보로 바꾸는 조건: (면 접촉이 비었고 edge.sep > chosen.sep) 또는 edge.sep > (면 접촉의 가장 깊은 점 분리) + `FEATURE_TOLERANCE`(Box3D `clipSeparation` = 자른 점의 최소 분리, convex_manifold.c:1567). 모서리 접촉에 점이 있거나 면 접촉이 비었을 때만 실제로 바꾼다.
6. 면 접촉도 모서리 접촉도 비면(꼭짓점–꼭짓점: 어느 SAT 축의 자른 점도 띠 안에 없음) GJK 대체 점 하나 `[결정: spec-5 §3.6은 모서리 접촉이 선분 밖일 때만 적지만, 면 축이 최선인 꼭짓점–꼭짓점(A7)도 같은 경우다. 기억은 고른 특징 그대로]`.
7. 참 분리 축 보충(`finish`, 다음 절).

돌려주는 `separation` = max(best.sep, chosen.sep)(분리된 짝은 band를 넘는 처음 축의 값: 실제 거리의 하한). 반환 `cache` = `cacheOf(chosen, touching = 점이 있음)`.

### 6.5 면 접촉(`faceContact`)

기준 껍질 r의 면 f(법선 n, offset d)에 사건 껍질(inc)의 면을 자른다.

1. 지지 꼭짓점 = inc에서 n·v가 가장 작은 꼭짓점(같으면 작은 순번). 사건 면 = 그 꼭짓점을 가진 면 가운데 dot(n_g, n)이 가장 작은 면(같으면 작은 순번)(Box3D 꼭짓점 안내식).
2. 사건 면의 다각형을 기준 면의 옆 평면들로 Sutherland–Hodgman으로 자른다(옆 평면 법선 side = unit((v2 − v1) × n), 오프셋 side·v1, `d ≤ 0` 쪽을 남김). 나가는 교점은 사건 모서리 → 기준 모서리, 들어오는 교점은 기준 모서리 → 사건 모서리(Box3D `b3ClipPolygon`과 같은 꼴). 다각형이 3점 미만이면 접촉 없음.
3. 자른 점마다 s = n·p − d(기준 면과의 분리), s > band이면 버림. 점 위치 = p − ½·s·n, 분리 = s, 법선 = refIsA ? −n : n(B → A).

점 id(부록 B): 사건 꼭짓점 `v<들어오는 모서리>.<나가는 모서리>`, 자른 교점 `x<기준 옆 모서리>.<사건 모서리>`. 기준 면 옆 모서리 둘이 만나는 점(사건 면이 기준 면 모서리를 덮을 때)은 `x<들어오는>.r<나가는>` `[결정: 부록 B에 없는 경우, 앞의 꼴과 겹치지 않게]`. `tie` 방향 = 기준 면 첫 모서리(면의 첫 두 꼭짓점) 방향.

### 6.6 모서리 접촉(`edgeContact`)

두 직선 p₁ + s·e₁, p₂ + t·e₂의 가장 가까운 매개변수(Ericson §5.1.8). 거의 나란하거나(denom ≤ 0) s 또는 t가 [0, 1] 밖이면 null(꼭짓점–꼭짓점으로 간주해 GJK 대체). 점 = 두 가장 가까운 점의 가운데(id `e`), 법선 −u, 분리 u·(q₂ − q₁).

### 6.7 점 줄이기(`reducePoints`, ≤ 4점)

Gregorius 2015·Box3D `b3ReduceManifoldPoints`. 점이 4개 이하면 그대로. 아니면:

1. 가장 깊은 점(분리가 가장 작은 점, 같으면 tie 방향 지지 dot(tie, p)가 큰 점, 그다음 작은 순번).
2. 그 점에서 법선에 수직인 평면에서 가장 먼 점(점수 = 수직 성분 제곱 길이, `0.95·score > best` 때 갱신, 점수 < `REDUCE_TOLERANCE`² 면 1점으로 끝).
3. 둘과 만드는 부호 넓이(법선·(ba × (p − a)))의 절댓값이 가장 큰 점(`0.95·‖area‖ ≥ best`, best 초기값 `REDUCE_TOLERANCE`²).
4. 세 점 삼각형 밖에 가장 큰 넓이를 더하는 점(세 변 기준 부호 있는 넓이의 최댓값, 같은 `0.95` 치우침, 초기값 `REDUCE_TOLERANCE`²).

### 6.8 참 분리 축 보충과 기억(`finish`)

위치 보정이 없어 기준 면만으로는 거의 나란한 면이 짧은 면 끝을 넘어 걸칠 때 침투가 남는다(4ab 교훈, `SUPPLEMENT_TOLERANCE` 1e-7).

- best.sep > chosen.sep + 1e-7이고 best ≠ chosen이면 best 특징의 점을 id 앞에 `+<기준>.`을 붙여 더한다(자기 법선). `[결정: spec-5 §3.5 9는 최대가 면 축일 때만이지만, 최대가 모서리 축이어도 그 점(하나)을 보충한다. 5 A16 퍼즈(BIOBUZZ 기운 다리)에서 섀시 면이 기준인 채 섀시 세로 모서리가 다리 모서리로 들어갔다(참 축은 두 모서리의 축)]`.
- 아니고 기준이 `gv`(GJK 대체)이거나 chosen이 모서리면, 최선 면(bestFace) 축의 점 가운데 `pt.sep ≥ chosen.sep − FEATURE_TOLERANCE`인 것(모서리 분리보다 0.5 mm 넘게 깊지 않은 것)만 보충한다. 모서리 접촉은 점 하나라 모서리가 면과 거의 나란하면(기운 다리 모서리가 섀시 면을 따라 미끄러질 때) 그 점을 축으로 돌아 반대쪽 끝이 면으로 들어가고 되돌아오지 않기 때문이다. 더 깊은 점은 그 면 축이 실제 분리를 과하게 재는 자리라 넣지 않는다 `[결정: 5 A16 퍼즈(BIOBUZZ 다리)에서 모서리 기억이 이어지는 동안 반대쪽 끝이 수 cm까지 들어갔다]`.
- 그 뒤 `reducePoints`로 ≤ 4점. 기억은 고른 특징 그대로.

### 6.9 GJK(Montanari 2017 부호 부피식)

`gjkArrays(a, b)`: 두 점 집합(껍질 꼭짓점·선분 끝점·점)의 거리와 가장 가까운 점. 결정적: 단체 점 순서 고정, 새 점을 앞에, 지지 점은 같으면 작은 순번. 부분 단체 풀이 `s1d`(선분)·`s2d`(삼각형)·`s3d`(사면체)가 부호 부피(여인수) 식으로 원점의 무게중심 좌표를 구하고, 사영 축은 |성분|이 가장 큰 축(삼각형은 |n_k|가 가장 큰 축을 뺀 평면의 부호 넓이)이다. 처음 단체는 점 하나 w = a[0] − b[0](v = w)이고 v = 0이면 바로 끝낸다. 반복(≤ 32 = `GJK_MAX_ITERATIONS`): v = 지금 단체의 원점에 가장 가까운 점. 새 단체 = [새 w, ...지금 단체]를 점 수(2·3·4)에 따라 `s1d`·`s2d`·`s3d`로 푼다. 지지 점 ia = support(a, −v), ib = support(b, v), w = a[ia] − b[ib]. 끝 조건: ‖v‖² − v·w ≤ 1e-12·‖v‖(거리 상한과 하한의 차), 또는 단체에 같은 (ia, ib)가 있음, 또는 단체가 4점(원점 포함 = 거리 0), 또는 반올림으로 더 가까워지지 않음(순환 막기). 거리 = ‖pointA − pointB‖(단체 4점이면 0).

### 6.10 껍질–껍질 GJK 대체(`gjkFallback`)

꼭짓점–꼭짓점처럼 SAT 접촉이 비면 점 하나. p = 두 가장 가까운 점의 가운데. d > `GJK_MIN_DISTANCE`(1e-9)이고 d ≤ band: 법선 (p_A − p_B)/d, 분리 d, id `g`, 기준 `gv`. d > band: 점 없음. d ≤ 1e-9: SAT 축 법선(`featureNormal`: A 면 −n_A, B 면 n_B, 모서리 −u)·그 분리로 같은 자리(가운데)에 점 하나.

### 6.11 껍질–캡슐·구(`collideHullRound`, Box3D `b3CollideHullAndCapsule`·`b3CollideHullAndSphere`)

법선은 껍질 → 캡슐로 내고 hullIsA면 뒤집어 B → A로 둔다. 구는 선분을 점 하나(a)로 본다.

1. GJK(껍질 꼭짓점 ↔ 선분 끝점)로 거리 d. d > r + band면 접촉 없음(분리 d − r).
2. 얕음(d > `GJK_MIN_DISTANCE`): δ = unit(pointB − pointA)(껍질 → 캡슐). 캡슐이면 δ와 가장 나란한 껍질 면(법선 내적 최대)을 ref로 하고, 면 법선과 δ가 거의 나란하면(‖n·δ‖ > `CAPSULE_FACE_PARALLEL` 0.998) 선분을 ref 면의 옆 평면들로 잘라(`clipSegmentToFace`: 두 점이 다 남아야 함) 2점: 점마다 거리 dist_i = n·c_i − d_ref, 한쪽이라도 dist ≤ r + band이면 점 위치 = c_i − n·(r + dist_i)/2, 분리 dist_i − r, id `c<끝점 번호>`, 기준 `fa<ref>`·`fb<ref>`. 짝의 분리는 GJK 거리 − r(자른 점의 평면 거리는 자른 구간 밖에 가장 가까운 점이 있으면 그보다 커서 겹침을 작게 잰다). 아니면 가장 가까운 점 하나: 위치 (pointA + (pointB − δ·r))/2, 법선 δ, 분리 d − r, id `g`, 기준 `gc`.
3. 깊음(d ≤ 1e-9, 선분이 껍질 안): SAT 면 축(선분 끝 지지 − r) 최대 faceSep. faceSep > band면 접촉 없음. 구(선분이 점 하나)이면 그 면의 점 하나(위치 선분점 − n·(r + dist)/2, id `g`). 캡슐이면 껍질 모서리 × 선분 축(Box3D `b3QueryEdgeDirectionHullAndCapsule`: 고립된 모서리는 Gauss 지도의 원점 지나는 원): cba = u_B·e_seg, dba = v_B·e_seg, cba·dba < 0이고 max(cba², dba²) ≥ 0.005²·‖e_seg‖²인 모서리, t = cba/(cba − dba), axis = unit(u_B + (v_B − u_B)·t), 분리 = axis·(seg.b − p_b) − r을 지지 분리(선분 끝 최소 − 껍질 꼭짓점 최대 − r)로 `EDGE_SUPPORT_TOLERANCE` 넘게 넘으면 자른다 `[결정: 5 리뷰]`. 면 축에서 선분을 자른 2점을 만들고, edgeSep > clippedSep + `FEATURE_TOLERANCE`이면(또는 점이 없으면) 모서리 접촉 점 하나(id `ce`, 기준 `ee<모서리>.s`)로 바꾼다(선분 최근접이 구간 안일 때). 짝의 분리 = max(faceSep, edgeSep).

### 6.12 캡슐–캡슐(`collideCapsules`, Box3D `b3CollideCapsules`)

가장 가까운 점 쌍(Ericson §5.1.9 `closestSegments`, 구는 방향 0). distance > r_A + r_B + band면 접촉 없음. 둘 다 선분이고 사인 sin = ‖e_A × e_B‖ < `PARALLEL_CAPSULE_SINE`(0.005)이면(Gregorius 2015 "parallel capsules") B 선분을 A의 끝 평면(e_A·x ≥ e_A·A.a, e_A·x ≤ e_A·A.b)으로 잘라 2점: 점마다 A 선분 위 가장 가까운 점 cp와 거리, 모두 `> GJK_MIN_DISTANCE`이고 ≤ r_A + r_B + band일 때만. 법선 = −unit(n₁ + n₂)(n_i = unit(x_i − cp_i), A → B 평균), 점 위치 = (cp + n·r_A + x − n·r_B)/2, 분리 = 거리 − 반지름 합, id `c<끝점 번호>`, 기준 `cc`. 아니면 점 하나: 거리 > 1e-9면 법선 unit(c₁ − c₂)(B → A), 교차(거리 ≤ 1e-9)면 unit(d_A × d_B)를 무게중심 차로 B → A에 맞춘다(나란하면 d에 수직인 축 `perpendicularTo`: |d_k|가 가장 작은 필드 축과의 외적). 위치 = (c₁ − n·r_A + c₂ + n·r_B)/2, 분리 distance − r_A − r_B, id `c`.

### 6.13 바닥(`collideHullFloor`·`collideRoundFloor`)

- 껍질–바닥: z ≤ band인 꼭짓점 모두(위치 (x, y, z/2), 법선 +z, 분리 z, id `v<꼭짓점>`), `reducePoints`로 ≤ 4점. 기준 `fl`. 분리 = 가장 낮은 z.
- 캡슐·구–바닥: 끝점마다 분리 z_end − r ≤ band인 것(위치 (x, y, 분리/2), id `e<0|1>`), 분리 = 가장 낮은 분리.
- 바닥 짝은 기억(`SatCache`)을 쓰지 않는다(null).

### 6.14 진입점 `collideShapes`와 분리 함수

| 짝                  | 처리                                        | 기억       |
| ------------------- | ------------------------------------------- | ---------- |
| 형상–바닥(b = null) | 위 6.13                                     | 없음       |
| 껍질–껍질           | `collideHulls` → `collidePrepared`          | `SatCache` |
| 캡슐–캡슐(구 포함)  | `collideCapsules`                           | 없음       |
| 껍질–캡슐           | `collideHullRound`(껍질을 A로 보면 hullIsA) | 없음       |

`shapeSeparation(a, b)`(겹침 깊이·편집 자세 겹침): 껍질–껍질 = SAT 최선 분리(`satSeparation`: `faceQuery`·`edgeQuery`를 band = ∞로 돌려 일찍 끝내지 않음, 세 질의의 최댓값), 캡슐–캡슐 = 선분 거리 − r_A − r_B, 껍질–둥근 = GJK 거리 − r(`collideHullRound`를 band = ∞로 부른 짝의 분리, 깊으면 SAT 축). 음수 = 겹침 깊이. 겹친 볼록 형상의 SAT 최선 분리는 정확한 침투 깊이다.

`collision3d.ts`가 내보내는 함수(다른 파일이 쓰는 것):

| 함수                                       | 쓰는 곳                                                                                   | 비고                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `staticShapes(field)`                      | `bodyCollision.ts`, 같은 파일의 `startOverlaps`, 시험                                     | 얼린 `FieldSpec`마다 한 번(§4)                           |
| `bodyShape(collider)`                      | `bodyCollision.ts`, 같은 파일의 `placeColliders`                                          | `SimCollider` → `BodyShape`(§5.1). 볼록 점이 퇴화면 null |
| `placeShape(shape, frame)`                 | `bodyCollision.ts`, 같은 파일의 `placeColliders`                                          | 몸체 틀 → 접촉 틀(§5.3)                                  |
| `cylinderPrism`                            | `staticShapes`(안), 시험                                                                  | 세운 원기둥 외접 16각 기둥 점(§4.4)                      |
| `cylinderColliderPoints`                   | `bodyShape`(안), 렌더러 `worldColliders.ts`의 `floorGapOf`                                | Cylinder Collider 외접 32각 기둥 점(§5.2)                |
| `collideShapes(a, b \| null, band, cache)` | `bodyCollision.ts`, 6a `elements/ballContact.ts`(공–껍질·캡슐)                            | 짝 하나의 좁은 단계(위 표)                               |
| `collideHulls(a, b, band, cache)`          | `collideShapes`(안), 시험                                                                 | 껍질–껍질 SAT(§6.4). A의 0번 꼭짓점을 원점으로 옮겨 계산 |
| `gjkDistance(a, b)`                        | 시험만(제품 코드는 안쪽 `gjkArrays`를 씀)                                                 | 점 집합 둘의 거리와 가장 가까운 점(§6.9, `Vec3` 입출력)  |
| `shapeBounds(shape)`                       | `bodyCollision.ts`, 6a `elements/elementWorld.ts`·렌더러 `worldElements.ts`               | 축 정렬 상자(캡슐은 끝점 ± r)                            |
| `shapeSeparation(a, b)`                    | `editPoseOverlaps`·`startOverlaps`(안), 6a `elements/elementWorld.ts`(프리로드 자리 겹침) | 겹침 깊이(위)                                            |
| `editPoseOverlaps(bodies, tolerance)`      | 렌더러 `worldColliders.ts` `buildCollisionModel`                                          | §9.1                                                     |
| `startOverlaps(spec, field)`               | 렌더러 `play/worldSpec.ts`(INIT 경고)                                                     | §9.2                                                     |
| `SAT_COUNTERS`                             | 시험                                                                                      | `edgeQueries`는 시험 감시용(결과에 쓰지 않음)            |

---

## 7. 충돌 행 만들기(`bodyCollision.ts`)

### 7.1 짝 목록(배열 순서가 행 순서다)

생성자가 한 번 만든다(행 순서가 LCP 주축 선택과 기준 해시에 묶인다).

1. 몸체 × 정적(몸체 −1(섀시), 0, 1, …; 몸체 안 충돌체 k 순; 정적 `staticShapes` 순서). 섀시는 3D 경로이고 부유 기저(`floating`)일 때만. 섀시는 `st.shape.chassis`, 관절 몸체는 `st.shape.joints`인 정적만. 토큰 `<몸체>k<k>/<정적>`(몸체 토큰: 섀시 `r`, 관절 `j<i>`), 마찰 μ = (충돌체 마찰 + 정적 마찰)/2.
2. 자기 짝(몸체 i < j): 바로 붙은 부모–자식 짝이 아니고 `collisionIgnore`에 없는 것. 충돌체 ka, kb 순. 토큰 `<몸체>k<ka>/<몸체>k<kb>`(예 `j1k0/j2k0`), μ = 두 충돌체 마찰 평균. 공통 조상 = y의 조상 사슬에서 x의 조상 사슬에 처음 들어 있는 몸체(없으면 −1). 조상 사슬은 자기부터 섀시(−1)까지.

고정 기저면 정적 형상을 시작 자세의 역(Rz(yaw)ᵀ, 평행이동 −Rz(yaw)ᵀ·(x, y, 0))으로 로봇 좌표에 한 번 옮긴다(면 법선·offset도 함께, P-L18). 부유 기저면 하위 단계마다 −O만큼 옮긴다(넓은 단계를 지난 것만). 얼린 원본은 고치지 않는다. 로봇 무게 W = (섀시 질량 + Σ 관절 몸체 질량)·g(g = 9.80665, `GRAVITY`).

### 7.2 하위 단계마다의 계산(`rows(art, h, m, frames)`)

1. 접촉 틀 C(`art.contactFrames()`, 한 번)를 만들고 몸체 충돌체를 C로 옮겨(`placeShape`) 축 정렬 상자를 잰다. 몸체마다 넓은 단계 여유 margin_body = (‖v_o‖ + ‖ω‖·r_max)·h + `COLLISION_MARGIN`(r_max = 몸체 충돌체 radius의 최대).
2. 짝마다:
   - 정적 짝: margin = margin_body. 바닥이면 `A.bounds.min.z ≤ margin`, 아니면 축 정렬 상자가 margin 안으로 다가왔는가(`near`: 축마다 겹친 폭 > −margin). 닿으면 그 정적 형상을 C로 옮겨 쓴다.
   - 자기 짝: margin = Σ_{o ∈ {a, b}} (‖v_o − (v_c + ω_c × (o_o − o_c))‖ + ‖ω_o − ω_c‖·r_max,o)·h + `COLLISION_MARGIN`(c = 공통 조상 몸체. P-L20: 같이 달리는 로봇의 기저 속도가 여유를 늘리지 않게).
   - 닿지 않으면 `cache`와 지난 접선 t1을 지운다.
   - `collideShapes(A.shape, other, margin, cache)`. 기억을 갱신한다.
   - 깊이 depth = max(0, −result.separation)(투영·빼기 전, P-L21. 겹친 볼록 형상의 SAT 최선 분리는 정확한 침투 깊이라서 `[결정: spec-5 §4.2 3은 점 분리의 최소지만, 보충 점(+)은 다른 축의 분리라 깊이를 부풀린다]`). 첫 하위 단계(t = 0)이면 `baseline = depth`(그 뒤로 바꾸지 않는다, P-M9. 첫 하위 단계에 넓은 단계를 지나지 못한 짝의 baseline은 0이다). 그 뒤 depth − baseline > `OVERLAP_NOTICE_DEPTH`이고 아직 알리지 않았으면 `collisionOverlap`(첫 짝만).
   - 매니폴드가 없으면 t1을 지운다. 있으면 시험 훅 `BodyCollision.manifoldHook(token, manifold)`(제품 코드는 쓰지 않음) 뒤 행을 만든다. 행의 j·target에 비유한 값이 있으면 그 짝만 빼고 `worldError { detail: 'collision <짝 토큰>' }`.
   - 순위 rank = (매니폴드 점 분리의 최소) + baseline.
3. 행 한도(7.7).
4. 반환: rows(짝 순서), blocking(섀시–정적 짝의 법선 행), upward(윗면 법선 행 키), notices.

### 7.3 법선 행(점마다 하나)

`pairRows`의 후보 점 목록을 먼저 만든다.

- **섀시–정적 짝**(수평 투영, §1.7): 점마다 법선의 수평 성분 l = hypot(n_x, n_y). l < `MIN_HORIZONTAL_NORMAL`(0.25)이면 그 점을 뺀다. 아니면 n̂ = (n_x/l, n_y/l, 0), 간격 g′ = g/l(깊이는 투영 전). 점이 하나도 없으면 짝 행 없음. `robotFace` = 정적 면이 기준(`fb…`, 보충 점이면 `+fb…`)이 아님(법선이 섀시와 함께 돈다고 본다).
- **그 밖의 짝**: 점 그대로(법선 n, 간격 g).

각 점의 행:

```
d = 법선(섀시–정적은 n̂),  p = 점 위치
j = art.relativeJacobian(frames, a, b, p, d)                  (b가 null이면 정적)
행 제외: ‖j‖² < 1e-12  또는  g > ‖j·v‖·h + COLLISION_MARGIN    (u = j·v, v = art.v)
key    = cn.<짝 토큰>.<기준>.<점 id>
target = −max(g, 0)/h + tighten                              (tighten은 아래 곡률 보정, 섀시–정적만)
lo = 0, hi = ∞                                                (J·v⁺ ≥ target: 반발·위치 보정 없음)
offset = max(g, 0) − h·tighten                                (섀시–정적 합치기용)
```

**곡률 보정**(4ab `fieldContact.ts structureRows`와 같은 식·같은 연산 순서, P-H1): 섀시–정적만(`base = art.baseVelocity()`). 점의 섀시 원점 기준 위치 r = (p.x, p.y), t = (−d.y, d.x), nr = d·r, ω = base.omega:

```
robotFace(법선이 섀시와 함께 돈다: fa…·ee…·gv):   g̈ = ω²·nr + 2ω·(t·(vx, vy))
정적 면이 기준(fb…):                              g̈ = −ω²·nr
tighten = max(0, −g̈)·h/2                                       (g̈가 음수일 때만 목표를 (h/2)·‖g̈‖ 조인다)
```

`[결정: 명세 §1.7은 ee를 정적 법선 식으로 보지만, 섀시 수평 모서리 × 기운 다리 모서리의 축은 투영하면 섀시 면 법선처럼 돌아(평면에서는 다리 꼭짓점 대 섀시 변) 5 A16 퍼즈에서 2ω·(t·v) 항만큼(하위 단계마다 5e-8 m) 파고들었다. 세로 모서리면 법선이 고정이라 이 식은 조금 일찍 멈출 뿐이다(안전 쪽)]`. 관절 몸체·자기 짝에는 곡률 보정이 없다.

### 7.4 섀시–정적 수평 자리 합치기(`mergeHorizontal`)

같은 수평 자리의 점은 한 점으로 본다. 투영 뒤 섀시 열의 행은 J = (n̂.x, n̂.y, ±s)라 s만 다르다.

1. 법선이 같은 점 묶음(기준 점 묶음과 `+` 보충 점 묶음을 따로, 보충 점은 기준 점과 법선이 달라 같은 행이 아니므로 `[결정]`)마다 접선 t = ẑ × n̂ 위 s = −n̂_y·x + n̂_x·y로 점을 늘어놓는다(s 오름차순, 같으면 작은 순번).
2. 같은 s(첫 점부터 `CHASSIS_MERGE_TOLERANCE` 5e-4 안의 창)는 한 점: g′가 가장 작은 점(같으면 작은 순번). 같은 (x, y)의 점(상자 면 대 벽 면의 z = 0·H 짝)은 J가 같아 LCP를 정확히 특이하게 만들기 때문이다(P-M5).
3. 남은 점의 (s, c = max(g′, 0) − h·tighten) 아래 볼록 껍질(Andrew 단조 사슬, 같은 직선 위 가운데 점은 뺀다) 꼭짓점만 남긴다. 껍질 위나 그 위쪽 점의 행은 양옆 두 점 행의 볼록 결합으로 이미 지켜진다. `[결정: 명세 §1.7은 s의 두 끝만 남기지만, 기운 면(곡면 CAD 껍질, 기운 다리 면)에서는 가운데 s의 점이 더 깊을 수 있다. 두 끝만 남기면 그 점에 행이 없어 하위 단계마다 파고들었다(32점 둥근 섀시가 발판 막대 면을 따라 돌며 0.5 s에 1 mm). 아래 껍질은 두 끝을 포함하므로 두 끝만으로 되는 경우의 행은 바뀌지 않는다]`. 벽 수직 면 대 섀시 상자면은 s의 두 끝(4ab 접촉 띠의 두 끝)만 남아 4ab 평면 경로와 같은 수의 행이다.

남긴 점은 원래 순서다. 법선 행이 없으면 짝 행이 없다(null).

### 7.5 마찰 행(패치)

짝(패치)마다 접선 둘 `ct1.`·`ct2.`와 비틀림 `cw.`(μ > 0일 때만).

- **패치 법선** n = 매니폴드 법선(섀시–정적은 수평 투영, 수평 성분 < 0.25면 남은 첫 점의 n̂).
- **패치 중심** c = Σ w_k·p_k / Σ w_k, w_k = clamp(2 − max(g_k, 0)/`COLLISION_MARGIN`, `PATCH_WEIGHT_MIN`, 1)(Box3D relax 무게, P-L13: 띠 안이지만 아직 닿지 않은 점이 마찰 자리를 끌지 않게. g ≤ 1 mm이면 1, 1→2 mm에서 선형으로 줄어 2 mm에서 1e-3). 점은 합치기 뒤 남은 점이다.
- **접선 t1**(`frictionTangent(n, slip, previous)`, 순수·결정적): 상대 미끄럼 w = v_A(c) − v_B(c)의 접선 성분 w_t = w − (w·n)n. ‖w_t‖ > `SLIP_DIRECTION_SPEED`(1 mm/s)이면 t1 = w_t/‖w_t‖(Bullet 속도 방향 마찰). 아니면 지난 t1을 새 접선 평면에 투영한 τ가 ‖τ‖ ≥ `TANGENT_KEEP_MIN`(0.5)이면 τ/‖τ‖(P-L22). 아니면 k = |n_k|가 가장 작은 필드 축(같으면 작은 k), t1 = unit(n × e_k). Duff·Frisvad 기저는 n_z = 0(모든 벽 법선)에서 뛰므로 쓰지 않는다(M§5 함정 7). 섀시–정적은 t1 = (−n_y, n_x, 0)(수직 접선·비틀림의 섀시 J가 0이므로 접선 하나만).
- t2 = n × t1.
- **행**(`friction(key, j, twist)`, ‖j‖² < 1e-12이면 넣지 않음):

| 행    | 키                | j                               | target | 상자(`friction` 필드)                                                                                                                                             |
| ----- | ----------------- | ------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ct1` | `ct1.<짝>.<기준>` | `relativeJacobian(a, b, c, t1)` | 0      | `{ patch: [{ normal: 법선 행 키, weight: 1 }…], mu, cap? }` → μ·min(Σ w·max(0, λ_n), cap)                                                                         |
| `ct2` | `ct2.…`           | `relativeJacobian(a, b, c, t2)` | 0      | 같음(섀시–정적은 없음)                                                                                                                                            |
| `cw`  | `cw.…`            | `twistJacobian(a, b, n)`        | 0      | `{ patch: [{ normal: 키, weight: lever_i }…], mu, cap? }` → μ·min(Σ lever_i·max(0, λ_i), cap). 법선 행이 둘 이상이고 지렛대 하나라도 > 0일 때만. 섀시–정적은 없음 |

lever_i = ‖p_i − c‖. 행의 lo/hi는 0이고 실제 상자는 `externalRows`가 법선 충격으로 정한다(§8.4).

- **바닥·윗면 마찰 하중 상한**(P-M8, §1.6): 정적 법선(패치 n)의 z ≥ `UPWARD_NORMAL_Z`(0.5)이면(정적 짝만) cap = h·W, 비틀림 cap = h·W·max_i lever_i `[결정: 비틀림 상자는 Σ rₖλₙ,ₖ라 같은 하중 상한에 가장 긴 지렛대를 곱해 단위를 맞춘다]`. 이유(`[가정]`): 기저에 z·롤·피치가 없어 바닥·벽 윗면을 누르는 팔이 로봇 무게보다 세게 마찰을 낼 수 없게 한다.

### 7.6 행 키·기준·점 id 요약

| 요소    | 형식                                                         | 뜻                                                                                         |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 짝 토큰 | `<몸체>k<k>/<상대>`                                          | 몸체: 섀시 `r`, 관절 `j<i>`. 상대: `w0`–`w3`, `s<i>`, `fl`, 다른 몸체(`j<i>k<k>`, `rk<k>`) |
| 기준    | `fa<f>` / `fb<f>`                                            | A 면 f가 기준 / B 면 f가 기준                                                              |
|         | `ee<ea>.<eb>`                                                | 모서리 짝                                                                                  |
|         | `gv` / `gc`                                                  | 껍질–껍질 GJK 대체 / 껍질–둥근 얕은 GJK                                                    |
|         | `cc` / `ee<edge>.s`                                          | 캡슐–캡슐 / 껍질 모서리 × 선분                                                             |
|         | `fl`                                                         | 바닥                                                                                       |
| 점 id   | `v<in>.<out>`, `x<refEdge>.<incEdge>`, `x<in>.r<out>`        | 면 접촉의 사건 꼭짓점·자른 교점                                                            |
|         | `e`                                                          | 모서리 접촉                                                                                |
|         | `g`                                                          | GJK                                                                                        |
|         | `c<k>` / `c` / `ce`                                          | 캡슐 끝점 번호 / 캡슐–캡슐 하나 / 껍질–캡슐 모서리                                         |
|         | `v<i>` / `e<i>`                                              | 바닥: 껍질 꼭짓점 / 캡슐 끝점                                                              |
|         | `+<기준>.<id>`                                               | 참 분리 축 보충 점                                                                         |
| 행 키   | `cn.<짝>.<기준>.<점 id>`, `ct1.<짝>.<기준>`, `ct2.…`, `cw.…` | 예 `cn.j1k0/w3.fb4.v2.5`, `cn.rk0/s11.…`                                                   |

법선이 바뀌면 키도 바뀐다(앞 하위 단계 충격·LCP 활성 집합을 다른 법선에 쓰지 않음).

### 7.7 행 한도(`collisionLimit`)

하위 단계의 충돌 행 합이 `MAX_COLLISION_ROWS`(28)를 넘으면: 짝을 (섀시–정적 먼저) → (rank 오름차순) → (짝 순서)로 정렬해 짝을 통째로 넣다가 다음 짝이 한도를 넘기면 거기서 멈추고(건너뛰지 않음), 다시 짝 순서로 되돌린다(P-L19). 알림 `collisionLimit`(params 없음, 실행마다 한 번). 28은 `[P-M10, 결정]`이다(`assumptions.md`: 인테이크가 벽·바닥에 동시에 닿는 장면에서 `collisionLimit`가 뜨는지 보고 성능 시험과 함께 다시 정한다).

### 7.8 `blocked`와 윗면 하중 알림(`afterStep`)

`world.ts`가 `art.step` 뒤에 `blocking.some(row => art.contactImpulse(row.key) > 0)`이면 `blocked = true`(섀시–정적 법선 행만). `afterStep(art, h)`는 `upward` 법선 행 키의 충격 합 Σ λ를 보고:

```
liftTime = Σλ > h·W ? liftTime + h : 0
liftTime ≥ SUPPORT_NOTICE_DELAY − h/2  (0.1 s − h/2)  →  collisionLift (한 번)
```

(3c `SupportMonitor`와 같은 꼴: 반올림 여유로 하위 단계의 절반을 둔다.)

---

## 8. 접촉 틀·야코비안·상자 LCP(`articulation.ts`)

### 8.1 접촉 틀 `contactFrames()`

지금 z·v로 한 번 계산한다. 축은 나무 틀(부유 기저면 필드 축, 고정 기저면 로봇 축), 원점 O = 지금 섀시 원점. 필드 좌표가 1.8 m까지 가므로 지렛대를 섀시 가까이에서 재 반올림을 줄인다. `bodies()`를 한 번만 부르고, 섀시 회전은 `planarFrame(basePose())`의 c·s 연산 그대로다(평면 경로 `wallRows`와 같은 비트). 반환:

- `origin` = O.
- `bodies[0]` = 섀시 `{ rotation: planarFrame(base).rotation(고정 기저는 단위), origin: 0 }`, `bodies[i + 1]` = 세계 설명 관절 i `{ rotation: 나무 몸체 회전, origin: 몸체 원점 − O }`.
- `velocities[idx]` = 몸체 속도(C 축). 나무 경로의 관절 속도 q̇ = treeQ(v)로: ω = Σ_{회전 관절 k} a_k·q̇_k, v_o = Σ_{회전} (a_k × (o − anchor_k))·q̇_k + Σ_{직선} a_k·q̇_k. 앵커 anchor_k = 관절 틀 원점 − O.
- `tree[k]` = 나무 관절 축 a_k와 앵커(C 좌표).

`Body`가 `jointAxis`·`jointOrigin`을 담기만 한다(연산을 더하지 않아 기준 해시가 그대로).

### 8.2 야코비안

```
relativeJacobian(frames, a, b, p, d) = J_a − J_b       (b가 null이면 정적, J_a만)
  두 몸체의 경로(뿌리에서 그 몸체까지 나무 관절 순번)의 같은 앞부분(공통 조상)은 더하지 않는다(정확한 0, M§5 함정 1).
  기저 가상 관절(k < offset):  k=0: d.x,  k=1: d.y,  k=2: −d.x·p.y + d.y·p.x
      (contact.ts wallRows의 row()와 같은 식·같은 결합 순서. 섀시 원점이 C 원점이라 지렛대가 p 그대로)
  세계 설명 관절 k:   회전: d·(a_k × (p − anchor_k))      직선: d·a_k
      (지렛대는 p − o_k: Plücker v_O + ω×p의 상쇄를 피한다, M§5 함정 2)
  j[c] += sign · value · S[k][c]   (S 행의 0이 아닌 좌표 c 순으로)

twistJacobian(frames, a, b, n)         축 n 둘레 상대 각속도(비틀림):
  경로의 회전 관절: a_k·n (기저 요 열은 n.z, 기저 직선 둘과 직선 관절은 0). 공통 조상은 뺀다
pointVelocity(frames, body, p) = v_o + ω × (p − o)
bodyPoses()                                   세계 설명 관절 몸체들의 자세(로봇 좌표, 부유 기저면 필드 좌표). 센서·4d 카메라·시작 겹침이 씀
```

### 8.3 하위 단계 풀이에서의 위치

1 ms 하위 단계마다 `Articulation.step(h, drive, contacts)`가 속도 암시 오일러 (M̂ = M + hD + h²K)·v⁺ = M·v + h·(f − c) + Jᵀλ를 풀고(3b), 구속 행을 한 상자 LCP에 넣는다: 행 순서는 `[마찰(관절 쿨롱·구동 상자), 한계, 외부 행]`이고 외부 행 안에서 바퀴 행 → (평면 경로의 벽·구조물 행) → 충돌 행 → 공 행(6a) 순이다. 풀이 구조:

```
y_k = M̂⁻¹ j_kᵀ                 (LDLᵀ)
A = [ j_k·y_l ] (+ 6a 공 부분 + 순응 γ),   b_k = j_k·v* − target_k
w = A·λ + b,   lo ≤ λ ≤ hi:  λ = lo 면 w ≥ 0, λ = hi 면 w ≤ 0, 사이면 w = 0
v⁺ = v* + Σ y_k·λ_k
```

외부 행이 하나도 없는 풀이는 5 전과 같은 연산이다. 마찰 행이 있는 풀이는 아래 엇갈림 2회로 푼다.

### 8.4 마찰 상자 엇갈림 2회(`pass`)와 `externalRows`

마찰 행의 상자는 법선 충격에 기대므로 고정 2회로 푼다: 1회차의 법선 충격은 앞 하위 단계의 같은 키 충격을 이번 h로 바꾼 값(`previous(key) = impulse·h/lastH`), 2회차는 1회차 해의 같은 키 충격. 한계 행은 한계 근처(간격 ≤ ‖q̇‖·h + `LIMIT_MARGIN`)이면 늘 넣고 풀고 난 위치가 한계를 `LIMIT_TOLERANCE`(1e-12) 넘으면 행을 더해 다시 푼다(3b).

```
externalRows:  마찰 행(friction 있음):
    normal 꼴:  bound = μ·max(0, λ_n)
    patch 꼴:   bound = μ·min( Σ weight_i·max(0, λ_i),  cap ?? ∞ )
    bound > 0 이 아니면 행을 넣지 않음, 아니면 lo = −bound, hi = +bound
  그 밖의 행: lo, hi 그대로
```

법선 행은 lo = 0, hi = ∞이다.

### 8.5 LCP 풀이(`solveBoxLcp`)

상자 혼합 LCP. A는 대각이 양수인 대칭 양반정치(특이해도 됨). 대각이 0 이하이면 던진다("constraint row has no effect"). 풀이:

1. 정칙화 E = diag(1e-9·A_ii)를 더한 문제를 블록 주축 전환(Júdice & Pires 1994, 상자 제약)으로 푼다. 행 상태 = 아래 경계 / 자유(w = 0) / 위 경계. 시작 상태는 앞 하위 단계의 같은 키 상태(없으면 lo = 0이면 아래, hi = 0이면 위, 아니면 자유). 반복마다 자유 행의 부분 문제를 LDLᵀ로 풀고 어긋난 행(`bad`)을 센다.
2. 반복마다 어긋난 행(`bad`)이 지금까지의 최소보다 줄면 기회(`BPP_TRIES` 3)를 되살리고, 줄지 않으면 기회를 하나 쓰며 어긋난 행을 모두 뒤집는다. 기회가 없는데도 줄지 않으면 가장 큰 첨자 하나만 뒤집는 Murty 규칙으로 바꾼다. 반복이 200번(`LCP_MURTY_ONLY_AFTER`)에 이르면 그 뒤로는 계속 Murty 규칙만 쓴다. 2000번(`LCP_MAX_ITERATIONS`)을 넘으면 던진다(`world.ts`가 그 하위 단계의 모든 속도를 0으로 두고 `worldError`로 알린다).
3. 근접점 반복(Rockafellar 1976, 최대 8번): LCP(A + E, b − E·λ_k)를 다시 풀어 원래 A의 해에 맞춘다. 상보성 위반이 `LCP_RELATIVE_TOLERANCE`·max(1, ‖b‖) 아래가 되면 멈춘다.
4. 마지막으로 λ를 [lo, hi]로 자른다(허용 오차 안 반올림).

자유 행(w = 0)이 좌표 하나에만 걸리면 그 속도를 목표에 정확히 맞춘다(반올림 잡음을 지운다). 상세한 한계 충격·결합 충격(`clampLimits`)과 6a 공 행의 조밀 LCP는 `motors-joints.md`와 6a 문서의 몫이다.

---

## 9. 편집 자세 겹침 앞 계산과 시작 겹침

### 9.1 `editPoseOverlaps(bodies, tolerance = 1e-3)`

입력: 몸체마다 `{ body(−1 섀시, ≥ 0 관절), parent(섀시는 −2), frame(로봇 좌표 몸체 틀), colliders(켠 충돌체, 몸체 틀) }`.

1. 몸체마다 충돌체를 로봇 좌표로 옮기고(`placeShape`) 축 정렬 상자를 잰다.
2. 몸체 짝 i < j마다: 같은 몸체이거나 바로 붙은 부모–자식(x.parent === y.body 또는 반대)이면 건너뜀. 충돌체 짝마다 축 정렬 상자가 축마다 tolerance 넘게 겹칠 때만(겹침 깊이가 tolerance를 넘으면 상자도 축마다 그만큼 겹친다) `shapeSeparation`을 잰다.
3. 몸체 짝의 최소 분리 least < −tolerance이면 `{ a: min(body), b: max(body), depth: −least }`.
4. 결과는 (a, b) 사전순.

겹침 문턱 1 mm(`EDIT_OVERLAP_TOLERANCE`)는 사용자 결정 11/10이다. 닿기만 한 짝(깊이 ≤ 1 mm)은 무시하지 않는다(CLAUDE.md). 코드 주석은 1 mm의 다른 근거를 적지 않았다(출처 기록 없음).

### 9.2 `startOverlaps(spec, field)`(INIT 시작 겹침)

형상이 없는 세계(`needed` 거짓)는 []. 정적 형상(`staticShapes`)과 축 정렬 상자를 만든다. 섀시 틀 = `planarFrame(robot.start)`, 관절 몸체 틀 = `Articulation.bodyPoses()`와 섀시를 `composeFrames`한 것(관절 q = 0). 몸체마다 충돌체의 어느 정적 형상과의 분리가 < −`EDIT_OVERLAP_TOLERANCE`이면 그 정적의 `target`을 모은다. 섀시는 바퀴가 있을 때만(바닥 제외, `s.chassis`), 관절 몸체는 늘(`s.joints`). 바닥은 충돌체 상자 min z < −1e-3이면 겹침. 결과 `{ body, targets }[]`(몸체 순서 섀시, 관절 0…, 대상은 `staticShapes` 순서).

---

## 10. 세계 설명 v6·v7의 충돌 칸 검증(`worldSpec.ts`)

| 칸                     | 규칙                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `robot.colliders?`     | 있으면(빈 배열도) 섀시 3D 경로. 빈 배열은 팀이 섀시 Collider를 모두 껐을 때만. 몸체당 ≤ 16                            |
| `joints[i].colliders?` | 없거나 비면 그 몸체는 충돌하지 않음. ≤ 16                                                                             |
| `collisionIgnore?`     | 정수 −1 ≤ a < b < joints.length인 짝 [a, b], ≤ 136, 같은 짝 둘은 `duplicate` 오류                                     |
| 세계 전체 충돌체       | ≤ 64                                                                                                                  |
| `convex`               | 점 4–64개, 각 성분 ‖좌표‖ ≤ 6.5(`HULL_MAX_COORD`), `canonicalHull`이 null이면 `degenerate` 오류                       |
| `box`                  | 중심 ‖성분‖ ≤ 10, 회전 행렬(길이 9, ‖원소‖ ≤ 2, 모든 (i, j)에 ‖RᵀR − I‖ ≤ 1e-9, det > 0), 반 크기 각 [5e-4, 10], 마찰 |
| `capsule`              | 끝점 a·b ‖성분‖ ≤ 10, 반지름 [5e-4, 1], 선분 < 1e-6면 구로 다룸                                                       |
| `cylinder`(v7)         | 끝점 ‖성분‖ ≤ 10, 반지름 [5e-4, 1], ‖b − a‖ ≥ 5e-4                                                                    |
| 공통                   | friction [0, 2]. 다른 키는 버리고 받은 수를 그대로 돌려줌(껍질은 `PhysicsWorld`가 다시 만든다). Euler를 담지 않는다   |

파싱 순서: 지금 칸을 모두 읽은 뒤 `robot.colliders` → 관절별 `colliders` → `collisionIgnore` → 충돌체 합 ≤ 64 → (v7) `elements`. 키가 없으면 결과에도 없어 형상 없는 세계의 결과 객체는 v5와 키·값이 같다(판만 6, 이후 7). v5 이하는 받지 않는다. `WORLD_SPEC_VERSION`은 6(충돌 형상), 7(6a: 원기둥 충돌체·경기 요소), 8(6b: 경기 요소 묶음 flower·hiveCell, HIVE 동역학).

---

## 11. 렌더러: Collider 설정·몸체 모델 빌더·메시 껍질

### 11.1 `SceneObject.colliders`와 `collision`(`scene/collider.ts`, `PROJECT_VERSION` 13, Cylinder는 14)

시뮬레이터 설정이라 생성 코드·구성 XML·하드웨어 검증·사용처와 관계없다(바퀴·관절과 같은 원칙). 틀은 그 오브젝트의 로컬 틀(피벗, 자기 축, CAD 파트는 CAD 파일 축)이고 길이는 m.

| 종류                     | 칸                                                                                      | 정리(`sanitizeCollider`) 범위                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 공통                     | `id`(UUID, 1–64자), `enabled?: false`(끈 것만 키), `friction?`                          | friction은 [0, 2]일 때만(밖·유한하지 않음이면 키를 지워 기본값 0.4). 키 순서 id, kind, enabled?, 종류 칸, friction. −0 없음 |
| `box`                    | `center`, `size`                                                                        | center ±10, size [1e-3, 10]                                                                                                 |
| `capsule`                | `center`, `radius`, `height`(반구 포함 전체, 2·radius보다 작으면 구), `direction` x·y·z | radius [5e-4, 1], height [0, 20]                                                                                            |
| `cylinder`(Unity에 없음) | 같음                                                                                    | radius [5e-4, 1], height [1e-3, 20](납작한 뚜껑까지의 전체)                                                                 |
| `mesh`                   | `vertexLimit`(Convex는 늘 켬)                                                           | 반올림 뒤 [8, 64], 기본 32                                                                                                  |

- 오브젝트당 최대 8개(`MAX_OBJECT_COLLIDERS`), 같은 id는 앞의 것만. 모든 kind(robot·CAD 루트·group·assembly·part)에 붙인다(Unity처럼).
- 형식 검사(`isWellFormedCollider`): id 1–64자, 종류·방향이 아는 값, 모든 칸이 유한(유한하지 않은 수는 정리를 그대로 지나 JSON에서 null이 되어 저장한 프로젝트를 다시 열지 못하기 때문).
- `collision`(robot에만): `forceCollide: [string, string][]`, 몸체 오브젝트 id 짝(섀시 = 로봇 id, 관절 몸체 = 관절 오브젝트 id). 짝 안 사전순, 목록도 사전순·중복 없음·같은 id 둘(a = b)은 뺌, ≤ 136. 끊긴 id(지운 관절)는 남긴다(실행 취소·되살림, 빌더가 무시).
- 마찰 합치기: 두 면의 평균(Unity Average, 0.4끼리 정확히 0.4). 벽 `WALL_FRICTION`, 구조물 `friction`, 바닥 `FLOOR_FRICTION`.
- 기본 충돌체(`defaultBox`·`defaultCapsule`·`defaultCylinder`·`defaultMesh`): 하위 같은 몸체 메시의 형상 `boundingBox` 8꼭짓점을 오브젝트 틀로 옮겨 합친 축 정렬 경계(Unity `BoxColliderFitUtility`처럼 렌더러 AABB, 꼭짓점·껍질을 훑지 않음)에서 만든다.

| 종류     | 기본값(경계가 있을 때)                                                                                                                                                   | 경계가 없을 때                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Box      | Center = 경계 중심, Size = 경계 크기                                                                                                                                     | Center 0, 0.1 m 정육면체                                                                             |
| Capsule  | Direction = 경계의 가장 긴 축(같으면 x → y → z), Height = 그 길이, Radius = 나머지 두 길이 중 큰 것의 절반, Center = 중심                                                | Radius 0.05, Height 0.2, Direction = `upAxis`(오브젝트 로컬 축 가운데 로봇 +Z와 가장 나란한 축, F13) |
| Cylinder | Direction = 나머지 두 길이가 가장 비슷한 축(같으면 x → y → z: 롤러는 긴 축, 원판은 얇은 축), Height = 그 축 길이, Radius = 나머지 두 길이 중 큰 것의 절반, Center = 중심 | Radius 0.05, Height 0.1, Direction = `upAxis`                                                        |
| Mesh     | Vertex Limit 32, 마찰 빈 칸                                                                                                                                              | 같음                                                                                                 |

### 11.2 메시 껍질

`meshHullOf(positions)`(`stepImport.ts`): STEP 워커의 `convertMesh`가 질량 성질 옆에서 WASM·네이티브 같은 경로로 메시마다 `buildHull(position, 64)`를 만들어 `ImportedMesh.hull: { points, error }`(피벗 기준 xyz 이어 붙임, 퇴화면 빈 배열·오차 0)로 둔다. 인덱스는 보지 않는다(점 집합만으로 정해짐). 메시 캐시 `MESH_CACHE_TAG` = `model-v4`(메시 껍질 포함, 기존 캐시는 한 번 다시 변환, `isImportedModel`이 hull 없는 v3 값을 거부)에서 5 리뷰의 껍질 삼각형 대체로 `model-v5`가 되었다. `registerGeometry(…, { hull })`가 형상과 같은 id·수명으로 `geometryRegistry`에 두고(`meshHull(id)`), 렌더러 메인 스레드는 메시 꼭짓점을 훑지 않는다. 필드 CAD 보기(4e)도 같은 `loadStepModel`이라 쓰지 않는 껍질을 만든다. goBILDA 키트(메시 1761개) 어림: 워커 메시 껍질 약 4.2 s(목표 5 s).

`objectHullPoints(objects, id)`(`meshHull.ts`)의 결과: `points`(오브젝트 로컬 점·오차), `degenerate`(메시는 있으나 껍질이 퇴화), `pending`(형상을 읽는 중이거나 읽지 못함, 껍질 없이 등록된 형상 포함), `none`(모양 없음). 임시 모양(`placeholder`)은 `PLACEHOLDER_BOUNDS`의 상자 8꼭짓점(꼭짓점 k의 비트 0·1·2가 x·y·z의 +쪽, 오차 0)이라 임시 상자 로봇도 18 in 상자 섀시를 갖는다. 껍질 객체마다 한 번 `WeakMap`에 기억해 같은 껍질이면 같은 결과 객체(참조 비교).

### 11.3 몸체 나누기(`jointBodyFrames`, `worldJoints.ts`)

- 관절 오브젝트 = 로봇 하위에서 `joint`가 있는 오브젝트(깊이 우선 문서 순서, 부모가 먼저), 한도 `MAX_WORLD_JOINTS`(16) 앞의 N개(남은 관절의 부모 관절은 늘 남음).
- `bodyOf(id)` = 그 오브젝트가 관절이면 자기 관절 순번, 아니면 부모의 몸체. 로봇 = −1(섀시). 한도로 뺀 관절의 하위는 가까운 남은 관절(또는 로봇)의 몸체.
- `parents[i]` = 관절 i 오브젝트의 부모가 속한 몸체.
- 관절 틀 `frames[i]` = (로봇 좌표 행렬) × 앵커 이동. 섀시 틀은 단위.
- 오브젝트 → 몸체 틀 행렬 = 로봇 좌표 표(`scene/robotMeshIndex.ts`: 부모 사슬을 한 번만 곱함)에 관절 틀의 역을 곱한 것. 충돌은 `mesh`·`placeholder` 둘 다 쓴다.

### 11.4 몸체 충돌 모델 빌더(`buildCollisionModel`)

몸체마다(섀시 −1, 관절 0…) 충돌체를 정하는 순수 함수다.

**충돌체 소스(`BodyShapeSource`)**

| 값          | 의미                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- |
| `colliders` | 켠 Collider에서 형상이 나옴                                                               |
| `disabled`  | Collider가 있으나 모두 꺼짐 → 충돌하지 않음(자동 껍질도 꺼짐)                             |
| `auto`      | Collider가 하나도 없어 몸체 메시의 자동 볼록 껍질 하나(32점, 마찰 0.4, `colliderId` null) |
| `fallback`  | 섀시에 Collider가 있는데 켠 것이 모두 빠졌거나 섀시 메시가 하나도 없음 → 외곽 대체 상자   |
| `none`      | 관절 몸체의 형상 없음(같은 이유)                                                          |

**규칙**

1. 몸체 소속 오브젝트(문서 순서, 몸체 오브젝트가 처음)의 모든 Collider를 본다. 끈 Collider도 "있음"으로 센다(`hasColliders`). 켠 것이 하나도 없으면 `disabled`.
2. 켠 Collider마다 상태(`ColliderState.status`): `ok`, `pending`(메시를 읽는 중), `none`(이 몸체의 메시가 없음), `degenerate`(껍질이 평평하거나 얇음), `outOfRange`(몸체 틀 좌표가 세계 한도를 넘음). 끈 Collider도 기즈모가 흐리게 그리도록 형상을 만든다(세계 설명에는 넣지 않음).
3. Box·Capsule·Cylinder(`primitiveEntry`): 오브젝트 로컬 → 몸체 틀(위치·회전만이라 회전은 정규 직교). Box = 몸체 틀 중심·회전 행렬 행 우선 9개·반 크기 size/2(양자화 없음). Capsule 끝점 = toBody·(center ∓ max(0, h/2 − r)·e), Cylinder 끝점 = toBody·(center ∓ (h/2)·e)(e = Direction 단위 축).
4. Mesh Collider(`convexEntry`): 그 오브젝트 하위의 같은 몸체 모양 오브젝트의 메시 껍질 점을 몸체 틀로 옮겨 모아(`gatherPoints`) V = `buildHull(점, vertexLimit).vertices`(−0 없는 `plain`)를 세계 설명에 보내고, 표시·개수·오차는 H = `canonicalHull(V)`. 오차 = max(V의 오차, H의 오차, 메시 껍질 오차 최대). 점이 ‖좌표‖ > 6.5(`HULL_MAX_COORD`)면 `outOfRange`.
5. 점이 있는데 껍질이 없으면 퇴화, 점이 없으면 읽는 중이 먼저(다 읽으면 점이 생길 수 있음), 없고 퇴화 메시만이면 퇴화, 아니면 `none`.
6. 자동 껍질: Collider가 하나도 없을 때만. 몸체 전체 메시 껍질 점을 모아(`HULL_DEFAULT_VERTEX_LIMIT` 32) V → H. 좌표 한도 밖이면 `outOfRange`, 껍질이 없으면 `degenerate`.
7. Collider가 있는데 켠 것이 모두 빠지면(읽는 중·퇴화·메시 없음, 이유는 그 Collider 상태가 말함) 자동 껍질을 쓰지 않고(C-M6) 섀시는 외곽 대체 상자, 관절 몸체는 형상 없음.
8. 몸체 한도(16) 앞의 켠 충돌체만 쓴다(`bodyCapped`, 넘은 것은 `capped`), 세계 한도 64는 몸체 순서로 앞의 것만.
9. 편집 자세 겹침 짝(바로 붙은 부모–자식이 아니고 양쪽에 충돌체가 있는 몸체 짝)을 `editPoseOverlaps`로 계산한다. 겹친 짝은 `collisionIgnore` 후보가 되고, 로봇 `forceCollide`에 있는 짝은 `forced`로 표시해 무시에서 뺀다. 계산은 세계 한도를 적용한 뒤의 충돌체 목록으로 하고, 두 몸체 결과·틀이 같은 짝은 기억을 쓴다.

**월드 한도 검사**: Box 중심·Capsule/Cylinder 끝점은 ‖성분‖ ≤ 10(`inWorld`), 볼록 점은 ≤ 6.5. 넘으면 그 충돌체만 빼고 `worldColliderOutOfRange`로 알린다(넣으면 메인의 같은 검사가 세계 설명 전체를 거절해 시뮬레이터 없이 실행한다).

**섀시 대체 상자(`fallbackBox`)**: 외곽(`robotOutline`의 footprint와 높이: 편집 자세 CAD 경계 상자에서 구하고, CAD가 없으면 18 in) 사각형의 경계 × [0, 외곽 높이]: 중심 ((minX + maxX)/2, (minY + maxY)/2, height/2), 회전 단위, 반 크기 x·y = max(`MIN_BOX_SIZE`/2, (max − min)/2)·z = max(`MIN_BOX_SIZE`/2, height/2)(1 mm보다 얇은 외곽이어도 세계 설명 전체가 거절되지 않게), 마찰 `DEFAULT_COLLIDER_FRICTION` 0.4, `colliderId` null.

**몸체 이름**: 같은 이름이 둘 이상이면 부모 오브젝트 이름을 괄호로(`이름 (부모)`), 그래도 같으면 ` #<body + 2>`(섀시 #1). Console 대체 글자는 `collider.self.chassis`.

**관절 몸체 편집 자세 바닥 간격 `floorGap`**: 로봇 좌표에서 그 몸체 충돌체의 가장 낮은 z(캡슐은 끝점 z − r, 원기둥은 시뮬레이터가 바닥 짝에 쓰는 외접 32각 기둥의 가장 낮은 점, 상자는 8꼭짓점, 볼록은 점). ≤ 1 mm면 인스펙터가 `floorTouch` 줄을 보인다.

**기억(`CollisionModelCache`)**: 몸체 결과는 몸체 소속 오브젝트의 형상 칸(부모·transform(몸체 오브젝트 자신은 제외)·모양·Collider 참조)과 메시 껍질 조회 결과, 관절 몸체는 관절 설정 참조와 관절 틀 값(`bodyKey`)이 같으면 다시 쓴다. 이름 바꾸기·하드웨어 속성 같은 충돌 무관 편집은 다시 계산하지 않는다. 짝 기억은 두 몸체 결과·틀과 깊이를 잰 세계 한도 뒤 충돌체 목록이 모두 같을 때만 쓴다(몸체 결과가 같아도 앞 몸체의 충돌체 수가 바뀌면 세계 한도로 자른 목록이 달라지기 때문, 5 리뷰). 로봇 16개까지 기억(`ENTRY_LIMIT`).

**`staleForced`**: 지금 무시 목록에 없는 `forceCollide` 짝 수(둘 다 지금 몸체 오브젝트인 것만. 끊긴 id 짝은 실행 취소로 되살릴 수 있어 남김). [지우기]는 `staleForcePairs`만 뺀다.

---

## 12. 알림·경고 목록

### 12.1 실행 중 알림(simNotice, 실행마다 한 번)

| 코드               | params                                                                                                     | 조건                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `collisionOverlap` | `body`('-1' 섀시 또는 관절 순번), `target`(`wall:x+`·`x-`·`y+`·`y-`, `structure:<i>`, `floor`, `body:<j>`) | 기준 깊이는 실행의 첫 하위 단계(t = 0)에서 잰 시작 겹침. 깊이가 그보다 1 mm(`OVERLAP_NOTICE_DEPTH`) 넘게 커지면 첫 짝만. 시작 겹침은 INIT 경고가 맡고 다시 알리지 않는다 |
| `collisionLimit`   | 없음                                                                                                       | 충돌 행 합 > 28                                                                                                                                                          |
| `collisionLift`    | 없음                                                                                                       | 위를 향한 정적 짝의 Σλₙ > h·W가 `SUPPORT_NOTICE_DELAY` 0.1 s 이어짐                                                                                                      |
| `worldError`       | `detail` = `collision <짝 토큰>`                                                                           | 짝의 j·target에 비유한 값(그 짝만 뺌), 충돌 행 만들기가 던지면 `art.step`이 던진 것과 같은 복구(그 하위 단계의 모든 속도 0, 위치 그대로, 다음 하위 단계에서 다시 푼다)   |

### 12.2 INIT 경고(렌더러 빌더·`withRunField`)

| 키                                         | 조건                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `worldColliderPending`                     | 몸체의 메시를 읽는 중이거나 못 읽음(몸체 순서, params `name`·`count`)                                              |
| `worldColliderDegenerate`                  | 평평하거나 얇아 뺀 Mesh Collider·자동 껍질 수                                                                      |
| `worldColliderOutOfRange`                  | 몸체 틀 좌표가 세계 설명 한도를 넘어 뺀 충돌체                                                                     |
| `worldColliderNoMeshes`                    | 이 몸체의 메시를 하나도 품지 않은 켠 Mesh Collider(빈 그룹·관절 하위 메시만 품은 그룹, 그 몸체의 자동 껍질도 꺼짐) |
| `worldTooManyColliders`                    | 몸체 충돌체 > 16(params `max` 16)                                                                                  |
| `worldTooManyWorldColliders`               | 세계 충돌체 > 64(params `max` 64)                                                                                  |
| `worldStartOverlap`                        | 바퀴 있는 로봇 섀시가 시작에서 벽·구조물과 > 1 mm 겹침(5의 3D `startOverlaps`)                                     |
| `worldJointStartOverlap { name, targets }` | 관절 몸체의 시작 겹침(바닥은 `collider.target.floor`). 바퀴와 관계없음                                             |

메시 없는 'none' 몸체는 경고 없음(카드 줄만). 경고 순서: 질량 뒤·센서 앞. 그 안에서 몸체 순서(섀시 → 관절 순번)로, 몸체마다 `worldColliderPending` → `worldColliderDegenerate` → `worldColliderOutOfRange` → `worldColliderNoMeshes` → `worldTooManyColliders`, 마지막에 세계 한도의 `worldTooManyWorldColliders` 하나(`buildCollisionModel`이 이 순서로 낸다).

---

## 13. 인스펙터·씬 뷰 기즈모(CLAUDE.md 서술)

### 13.1 Collider 카드(`editor/collider/ColliderCard.tsx`·`colliderCardModel.ts`)

- Add Component "시뮬레이션"에 Box·Capsule·Mesh·Cylinder Collider(8개면 비활성).
- 카드 순서 하드웨어 → 바퀴 → 관절 → 질량 → Collider → 스크립트(Preload Slot은 Collider 다음).
- 머리줄: 확인란(Unity `Collider.enabled`), 제목 `Box Collider` 등(번역 안 함), 시뮬레이터 배지, [제거].
- 칸(Unity 순서): 마찰(Material 자리, Center 앞, 빈 칸 = 흐린 0.4), Center, Size/Radius/Height/Direction. 길이는 표시 단위(`12in` 입력). 받지 않는 값은 지우지 않고 틀렸다고 보임(`collider.invalid.*`).
- [하위에 맞추기](Box·Capsule·Cylinder, 읽는 중 메시 수 도움말).
- Mesh: Convex 켠 채 비활성, Vertex Limit, 결과 줄 "볼록 껍질 N점 · 오차 약 N mm"(사용자 Mesh Collider만 `HULL_ERROR_WARN` 2 mm 넘으면 경고).
- 축 줄(자기 회전이 CAD 루트와 같으면 CAD 파일 축), 소속 줄(섀시·관절 몸체·로봇 밖 `collider.orphan`: 정적 장애물이 아님), `meshesInOtherBody`, 그 몸체 첫 Collider면 `replacesAuto`, `outOfRange`, 한도로 뺐으면 `collider.capped`, 실행이 잠그면 "실행 중" 배지(다음 INIT부터).
- Rigidbody·Articulation Body 카드의 충돌 구역(`CollisionSection.tsx`): 형상 줄(Collider N개·모두 꺼짐·자동 껍질 N점 오차(경고 없음, 도움말)·외곽 상자·없음, 외곽 상자·없음은 까닭: 켠 Collider가 형상을 못 만듦 → 좌표 한도 → 퇴화 → 읽는 중 → 메시 없음), 읽는 중 수, 한도로 뺀 수, 바퀴가 없으면 `fixedBase`, 관절 몸체 바닥 간격 ≤ 1 mm면 `floorTouch`, 자기 충돌 목록(인접 안내, "처음부터 겹쳐 무시함" 짝마다 이름·깊이·[그래도 충돌] 확인란(`setRobotCollision` 한 단계), 줄을 누르면 b 몸체를 고름, 지금 겹치지 않는 [그래도 충돌] 수와 [지우기]).
- 계산은 `useCollisionModel.ts collisionModelFor`(문서·`geometryRevision`마다, 핸들 드래그 중에는 미뤘다가 놓을 때 한 번).

### 13.2 씬 뷰 기즈모(`ColliderGizmos.tsx`·`colliderGizmoModel.ts`, Unity Collider 기즈모)

고른 오브젝트들의 몸체(하위 관절 몸체 포함, 로봇을 고르면 모든 몸체)의 충돌 형상. 볼록은 정규 껍질 모서리(합친 면이라 대각선 없음, 메인 껍질과 같음), 상자 12모서리, 캡슐은 Unity 캡슐 기즈모(32분할 `CAPSULE_SEGMENTS`), 구는 큰 원 셋, 원기둥은 원 둘 + 선 넷.

| 항목                               | 값                               | 위치                                   | 상태                                                           |
| ---------------------------------- | -------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| 켬 색                              | `#91f48b`                        | `COLLIDER_OUTLINE_COLOR`               | Unity `Handles.s_ColliderHandleColor` (145, 244, 139, 210)/255 |
| 끈 Collider·한도로 뺀 것 색        | `#54c84d`                        | `COLLIDER_DISABLED_COLOR`              | (84, 200, 77, 140)/255, `[가정: 표시만]`                       |
| 앞 패스(깊이 검사 켬) 불투명도     | 0.9                              | `COLLIDER_OUTLINE_OPACITY`             | `[가정: 표시만]`                                               |
| 가려진 패스(깊이 검사 끔) 불투명도 | 0.2                              | `COLLIDER_OUTLINE_HIDDEN_OPACITY`      | 가려진 선은 흐리게(로봇 하부를 가로지르지 않게)                |
| 끈 Collider 앞 불투명도            | 0.55(가려진 쪽은 0.55 × 0.2/0.9) | `COLLIDER_DISABLED_OPACITY`            |                                                                |
| 활성 오브젝트의 Collider           | 1.0(앞 패스)                     | 코드                                   |                                                                |
| 섀시 대체 상자                     | 점선                             | `DASH_SIZE` 0.01 m, `GAP_SIZE` 0.006 m |                                                                |
| 렌더 순서                          | 11                               | `RENDER_ORDER`                         | 클릭되지 않음                                                  |

잠그는 실행이면 `run.colliders`를 표시 자세 몸체 틀로 그린다(실행 중 바꾼 문서 Collider는 그리지 않음, 숨김은 몸체 오브젝트만, 고른 오브젝트의 몸체는 실행의 번호 `run.joints`로 정한다 `gizmoBodyNumbers`). 아니면 문서 형상을 관절 미리보기 값으로 그린다. 무시 짝·접촉점은 그리지 않는다. 재질은 컴포넌트 수명 동안 쓰고 해제는 미룬다(StrictMode).

---

## 14. Unity 대응과 임시 편차

| 항목                              | Unity                                           | SandBot                                                                                      |
| --------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Collider.enabled`                | 있음                                            | 같음(머리줄 확인란)                                                                          |
| BoxCollider Center/Size           | 있음                                            | 같음                                                                                         |
| CapsuleCollider                   | Center·Radius·Height(반구 포함)·Direction X·Y·Z | 같음                                                                                         |
| MeshCollider Convex               | 볼록 껍질                                       | 같음(Convex 늘 켬)                                                                           |
| Physics Material Friction Combine | Average                                         | 같음(두 면의 평균)                                                                           |
| ArticulationBody 부모–자식 무시   | PhysX `filterArticulationLinks`                 | 같음(바로 붙은 부모–자식, [그래도 충돌]도 바꾸지 못함)                                       |
| Fit 버튼                          | `BoxColliderFitUtility`(Box만)                  | [하위에 맞추기](Box·Capsule·Cylinder) — 임시 편차: Capsule [하위에 맞추기], Fit to Self 없음 |

**임시 편차**

- 편집 자세에서 겹친 몸체 짝 자동 무시와 [그래도 충돌](몸체 단위, Unity `Physics.IgnoreCollision`의 반대).
- Edit Collider 핸들 없음(숫자 칸·[하위에 맞추기]·기즈모).
- Mesh Collider Vertex Limit 칸(PhysX `vertexLimit`에 대응).
- Cylinder Collider(Unity에 없음. 롤러·플라이휠을 캡슐보다 정확히, 사용자 결정 11/13).
- 끈 Collider도 자동 껍질을 끈다(Unity에는 자동 껍질이 없다).
- Is Trigger·Provides Contacts·Material 에셋·Layer Overrides·Cooking Options·오목 Mesh Collider·Physics Debugger 접촉 표시는 없다.
- 예측 띠는 Contact Offset 0.01 m 대신 ‖v·n‖·h + 1 mm다.
- 섀시 `forceCollide`·`collisionIgnore`(몸체 단위, Unity에는 `Physics.IgnoreCollision`이 Collider 단위).

---

## 15. 기준 해시 여덟째 장면(`worldGolden.test.ts` `mechanismCollision()`)

BIOBUZZ 시즌, 섀시·관절 몸체의 3D 충돌체(spec-5 §11, 기하와 덮을 키는 명세 고정, 시각·출력 크기는 5 A가 맞춤). 형상 없는 세계는 5 전의 연산 그대로라 앞의 일곱 해시는 5가 바꾸지 않는다. 여덟째는 3D 충돌의 `Math.sqrt`·`cos`·`sin`(섀시 틀)과 SAT·GJK 반올림에 기대므로 Node·Electron을 올릴 때 다시 볼 해시가 하나 는다.

### 15.1 기하

| 항목           | 값                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 세계 설명      | `robotSpec`(driveTestkit) + `field: { season: 'biobuzz', hiveTipped: [false, false] }`, 버전 7(시험이 확인)                                               |
| 로봇 시작 자세 | (x, y, yaw) = (0.25, −(1.79286 − 0.2286 − 0.4), −π/2) = (0.25, −1.16426, −π/2). 앞(로봇 +X)이 필드 −Y(빨강 벽 `w3`)를 봄. 앞면에서 벽 안쪽 면까지 0.4 m   |
| 외곽·높이      | 18 in 정사각 ±0.2286 m(`HALF`), `robot.height` 0.4572 m(`TEST_ROBOT_HEIGHT`)                                                                              |
| 섀시 질량      | 13.6 kg(`testChassis`), 무게중심 (0, 0, 0.1), 관성 Ixx = Iyy = m(side² + h²)/12 = 0.282236 kg·m²(side 0.4572, h 0.2), Izz = 2·m·side²/12 = 0.473806 kg·m² |
| 바퀴           | 메카넘 4개, 위치 (±0.15, ±0.16) m, 반지름 0.052 m, 외부 감속비 1, μ 종류 기본 0.6, 롤러형 앞왼·뒤오른 flbr·앞오른·뒤왼 frbl                               |
| 모터           | goBILDA 5202 계열 `gearbox` 19.2, 배터리 12 V, 인스펙터 방향 fl −1·fr +1·bl −1·br +1, 허브 하나('Control Hub'), IMU 하나, 리프트 모터 `lift`              |
| 섀시 충돌체    | `box` center (0, 0, 0.1), 회전 단위, half (0.2286, 0.2286, 0.1), 마찰 0.4(외곽 × [0, 0.2])                                                                |

**관절 0: 리프트**(부모 −1 = 섀시)

| 칸          | 값                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 종류·축     | prismatic, 축 +z                                                                                                                          |
| 원점        | position (0, 0, 0.1), 회전 0                                                                                                              |
| 한계        | [0, 0.4] m                                                                                                                                |
| 몸체        | mass 1.5 kg, 무게중심 0, 관성 [1e-3, 1e-3, 1e-3, 0, 0, 0]                                                                                 |
| 마찰·스프링 | 쿨롱 1 N, 점성 0, 스프링 없음                                                                                                             |
| 구동        | motor `['lift']`, ratio 0.112/(2π) = 0.017825 m/rad, 파라미터 = goBILDA 5202 19.2 데이터시트(`testMotorParams`), 리깅 direct, 스위치 없음 |
| 충돌체      | `box` center 0, 회전 단위, half (0.02, 0.15, 0.09), 마찰 0.4(섀시와 인접)                                                                 |

**관절 1: 팔**(부모 0 = 리프트)

| 칸      | 값                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| 종류·축 | revolute, 축 +y(로봇 +Y)                                                                                             |
| 원점    | position (0.27, 0, 0.15), 회전 0(피벗이 섀시 앞면 0.27 − 0.2286 = 0.0414 앞)                                         |
| 한계    | [−0.6, 1.4] rad                                                                                                      |
| 몸체    | mass 0.3 kg, 무게중심 (0.125, 0, 0), 관성 [2e-5, 1.6e-3, 1.6e-3, 0, 0, 0]                                            |
| 마찰    | 쿨롱 0.02 N·m, 점성 0.001 N·m·s/rad, 스프링 없음                                                                     |
| 구동    | servo `armServo`, ratio 1, 파라미터 `resolveServoParams('gobildaTorque', 'servo')`, `zeroPulseUs` 1500, direction +1 |
| 충돌체  | `capsule` a (0, 0, 0), b (0.25, 0, 0), 반지름 0.02, 마찰 0.4                                                         |

### 15.2 출력열

틱 시각 t_k = k·5 ms + (k mod 3)·1.3 ms(`uneven`: 하위 단계 격자와 어긋난 경계). 총 680틱(약 3.4 s).

| k 범위  | 시간      | 출력                                                                                        |
| ------- | --------- | ------------------------------------------------------------------------------------------- |
| 0–79    | 0–0.4 s   | 서보 끔(`pulseUs: null`, `pwm: false`; 팔이 떨어져 바닥 `j1k0/fl`에 닿음). 리프트 0         |
| 80–139  | 0.4–0.7 s | 서보 켬(position 0.5, pulseUs 1500, pwm true)                                               |
| 140–259 | 0.7–1.3 s | 앞 0.3(`mecanum(0.3, 0, 0)`; 팔 끝이 벽 판 `j1k0/w3` +y에 막힘)                             |
| 260–359 | 1.3–1.8 s | 앞 0.1·리프트 up 0.8                                                                        |
| 360–539 | 1.8–2.7 s | 앞 0.6·리프트 −0.1(팔이 레일 윗면 +z에 얹힘, 섀시 앞면이 벽 `rk0/w3`에 막힘)                |
| 540–639 | 2.7–3.2 s | 옆걸음 `mecanum(0, −0.5, 0)`(주석: 필드 +X 방향, 섀시 왼쪽이 FLOWER `<3>` `rk0/s11`에 막힘) |
| 640–679 | 3.2–3.4 s | 모두 0                                                                                      |

`[결정: 명세 출력열의 앞 0.4는 팔이 벽 판에 부딪힐 때 서보(정지 토크 약 1.8 N·m)가 버티지 못해 팔이 접혀 0.3으로, 단계 4의 앞은 0.1(팔이 벽 위를 넘기 전에 로봇이 다시 다가가 팔이 판에 다시 걸리지 않게), 리프트 up 0.8은 1.8 s까지, 단계 5는 리프트 down 0.1·앞 0.6(레일 윗면 접촉과 섀시 벽 막힘이 함께 나오게)으로 맞췄다]`.

### 15.3 검증 항목

| 항목                                                | 값                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 해시                                                | `0875627f0125888141e3521b5c11fabab22cb4373bf4d69af57761ec62bf728e`(6b에서 다시 잼: FLOWER <3>이 케이지 로봇 부품, 섀시 짝 토큰 `rk0/s11p<j>`. 5단계 값 `c98655b20b36b68af6a3cb5fa0abaf8e4a9b684a0f623c1d8bab814735d7e6cf`)                                                                              |
| 해시 입력                                           | `JSON.stringify(ticks.map(t => [t.k, t.input, t.pose, t.loads, t.notices]))`의 sha256 hex. `input` = `world.step(tNanos, 출력)`이 돌려준 입력, `pose` = `world.pose()`(x·y·yaw·blocked·관절 `joints`), `loads` = `world.supportLoads()`, `notices` = `world.drainNotices()`. 시험 함수 `trace`가 만든다 |
| 시작 겹침                                           | `startOverlaps(spec, resolveSeason('biobuzz'))`이 []                                                                                                                                                                                                                                                    |
| `worldError`                                        | 알림에 없다. JSON 글자에 `null`이 없다(모든 수가 유한)                                                                                                                                                                                                                                                  |
| 덮는 행 키                                          | `cn.j1k0/fl`, `cn.j1k0/w3`, `cn.rk0/w3`, `cn.rk0/s11`                                                                                                                                                                                                                                                   |
| 매니폴드 법선(시험 훅 `BodyCollision.manifoldHook`) | 짝 `j1k0/w3`에서 `normal.y > 0.99`(벽 판 옆, 접촉 틀은 필드 축) 와 `normal.z > 0.99`(레일 윗면) 둘 다 관찰                                                                                                                                                                                              |
| `blocked` 틱                                        | 20틱 넘게                                                                                                                                                                                                                                                                                               |
| 결정성                                              | 같은 프로세스에서 두 번 돌려 해시가 같다                                                                                                                                                                                                                                                                |

---

## 16. 성능 예산과 시험

### 16.1 성능(시험이 기록, 이 판의 측정, CLAUDE.md)

측정값과 목표는 CLAUDE.md의 서술이고, CI 상한은 시험 파일(`collisionPerf.test.ts`, `worldCollidersPerf.test.ts`)의 `expect`에서 읽은 값이다. 하위 단계 시간은 틱 하나의 `world.step` 시간을 5(5 ms 틱 = 하위 단계 다섯)로 나눈 값이다(680틱 장면, 첫 틱 뺌).

| 항목                                                                                            | 측정                                                           | 목표                                         | CI 상한                                                        |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| 형상 있는 하위 단계(메카넘 4 + 관절 3, 32점 볼록 넷, 빨강 벽 모서리 + FLOWER + 팔 바닥·벽 윗면) | 중앙값 0.33 ms, p99 1.8 ms(충돌 행 0–3이 절반, 8–11은 1% 아래) | 0.5 / 2 ms                                   | 5 / 10 ms. 시험이 최대 충돌 행 ≤ 28과 `worldError` 없음도 본다 |
| 좁은 단계 전체 SAT 32점(둥근 상자 둘, 한 개를 0.4 rad 돌려 걸침, 300번 중앙값)                  | 0.11 ms                                                        | 0.3 ms(CLAUDE.md가 32·64점을 한 목표로 적음) | 3 ms                                                           |
| 좁은 단계 전체 SAT 64점                                                                         | 0.40 ms                                                        | 같은 0.3 ms(측정이 목표보다 큼)              | 없음(기록만)                                                   |
| 생성자(충돌체 64개 × 64점: 관절 15개 × 4 + 섀시 4, 검사 + 생성, 5번 중앙값)                     | 약 50–80 ms                                                    | 30 ms 목표에 못 미침                         | 300 ms                                                         |
| 64점 껍질 하나                                                                                  | 0.5–0.7 ms                                                     | —                                            | —                                                              |
| 생성(`canonicalHull` 기억 사용)                                                                 | 약 2 ms                                                        | —                                            | —                                                              |
| 앞 계산(`editPoseOverlaps`, 몸체 16 × 충돌체 4)                                                 | 1.5 ms                                                         | 20 ms                                        | 200 ms                                                         |
| INIT 몸체 모델(goBILDA 1761메시, 메시마다 64점 껍질, 섀시 자동 껍질 32점)                       | 86 ms                                                          | 150 ms                                       | 1.5 s                                                          |
| 무관 편집(이름 바꾸기) 뒤 다시 계산                                                             | 2.5 ms                                                         | 5 ms                                         | 50 ms                                                          |
| 워커 메시 껍질(메시 200개 × 꼭짓점 2400개를 잰 뒤 1761메시로 환산)                              | 4.2 s                                                          | 5 s                                          | 없음(기록만)                                                   |

형상 없는 세계는 4ab 예산 그대로다. 행 한도 28은 `[P-M10]`: LCP 측정에서 행 ~70이면 한 풀이가 수십 ms였다.

### 16.2 시험(CLAUDE.md)

- 계약(K1–K12): 기준 해시 일곱·v6 검사·껍질·externalRows·collider 정리·스토어·i18n·가짜 없는 빌더·정규 껍질 고정점·임시 씬·Console 꼴.
- A: `hull.test.ts`, `collision3d.test.ts`(SAT 면·모서리·GJK·히스테리시스·보충·캡슐·원기둥·앞 계산·시작 겹침), `bodyCollision.test.ts`(0 행·합치기·`wallRows`와 J·g·알림 기준·패치 중심·비유한), `worldCollision.test.ts`(팔이 바닥에 멈춤·벽 판과 윗면·구조물 규칙·마찰(tan 15°·30°, 비틀림, t1)·자기 충돌·섀시 3D 경로의 3c·4ab 시험(침투 증가 < 1e-6 m, 퍼즈 48개)·밀어내지 않음·알림·결정성·복구·하중 상한), `articulation.test.ts`(접촉 틀·야코비안 수치·LCP 퍼즈 100개), `collisionPerf.test.ts`.
- B: `projectFile.test.ts` v13, `stepImport.test.ts`·`meshHull.test.ts`, `worldColliders.test.ts`·`worldSpec.test.ts`·`worldJoints.test.ts`, `colliderCard.test.tsx`·`collisionSection.test.tsx`·`ColliderGizmos.test.tsx`·`useCollisionModel.test.ts`, `worldCollidersPerf.test.ts`, `playStore.test.ts`, `scene/hullOracle.test.ts`(three 오라클).
- 통합: `play/worldCollidersFirstTick.test.ts`(I1: 손 씬 → 빌더 → JSON → `parseWorldSpec` → `PhysicsWorld`, 시뮬레이터 껍질 = 렌더러 정규 껍질·기즈모 선분 = 그 모서리; I2: 접은 팔이 섀시 자동 껍질 안이면 앞 계산이 무시 짝(깊이 0.06 m)·섀시에 뒤쪽 Box Collider를 붙이면 사라짐·[그래도 충돌]), `playActions.test.ts` I3(프리셋에 스냅한 18 in 바퀴 로봇은 진짜 `startOverlaps`로 경고 없음·벽 너머 팔 관절은 `worldJointStartOverlap`), `sidecar/tests/sim.test.ts` I4(렌더러 빌더 팔 세계와 생성 구성 XML로 고치지 않은 사이드카에서 RUN_TO_POSITION 팔이 바닥에 막혀 엔코더가 638틱에서 멈추고 바닥에 파고들지 않음).
- 퍼즈 번호 A16(BIOBUZZ 기운 다리·모서리 파고듦), A20(매니폴드 감시 훅), A26(LCP 접촉꼴 순환), A7(꼭짓점–꼭짓점)은 명세의 시험 번호다.

---

## 17. 알려진 한계·남은 일

- 기저에 z·롤·피치가 없어 바닥·벽 윗면을 누르는 팔은 로봇을 들지 못하고 바퀴 하중도 바꾸지 않는다(`baseWrench`는 외력 없는 RNEA. 마찰 하중은 로봇 무게로 자르고 넘으면 `collisionLift`). 한계에 걸린 관절이 바닥에도 닿으면 지지 나눔은 LCP 정칙화가 정해 그 마찰은 근사다.
- 자동 껍질은 몸체마다 볼록 하나라 오목한 집게 안쪽·U 채널 안이 막히고(Collider 여러 개로 푼다, 부품마다 한 번에 붙이는 버튼은 없다), 접은 팔이 섀시 껍질 안이면 그 짝은 무시되어 서로 통과하며, 첫 Collider를 붙이면 그 몸체의 자동 껍질 전체가 꺼진다(카드가 알린다).
- [그래도 충돌]을 켠 짝은 겹친 채 시작해도 밀어내지 않아 그 자리에서 서로 묶일 수 있다(인스펙터 도움말 `collider.self.forceHint`).
- 안에 그린 껍질(최대 64점)이라 실제보다 작고, 보이는 오차는 평면 거리 최대(하한)와 메시 껍질 오차를 합친 추정이다.
- 곡률 보정은 섀시–정적 짝에만 있어 도는 관절 몸체가 면을 따라 미끄러지면 하위 단계마다 (h²/2)·ω²·r만큼 파고들 수 있다(ω 10 rad/s·r 0.35 m면 약 1.75e-5 m, 1 mm 넘으면 알림). 1 ms보다 빠른 터널링은 넓은 단계 여유로만 막는다.
- 분리된 모서리–모서리는 band(수 mm)만큼 일찍 멈출 수 있다.
- 캡슐 선분이 껍질 안으로 반지름보다 깊이 들어간 짝은 무작위 자세의 약 0.4 %에서 그 하위 단계에 접촉 행이 없다(최선 면에서 선분이 잘려 나가고 모서리 최근접점이 선분 밖일 때, 분리 값은 맞다. 이미 깊이 파고든 뒤의 일이라 대체 접촉점은 두지 않았다).
- 행 한도 28을 넘으면 섀시–정적을 먼저 두고 얕은 짝을 뺀다.
- HIVE 몸체·CELL은 통과하고(공과의 접촉은 6a 항목), 벽은 판 inset·이음을 무시한 상자로 모서리까지 이어지며, 레일 아래(z < 0)는 비었다.
- 로봇 밖에 붙인 Collider는 정적 장애물이 아니다(사용자 정적 충돌체 없음).
- 원기둥은 외접 16각 기둥(+1.96 %, 구조물)·외접 32각 기둥(+0.48 %, Cylinder Collider의 공이 아닌 짝)이고 섀시 평면 경로만 정확한 원이다.
- 섀시–정적은 75.5° 넘게 누운 면에 행이 없다(비탈을 오르지 않음).
- 센서 광선·카메라 시야는 충돌체를 쓰지 않는다(자기 로봇 몸체가 가리지 않음, 4c·4d 그대로).
- 섀시 메시를 읽기 전에 INIT하면 섀시가 외곽 상자다.
- 메시 캐시가 한 번 다시 변환되고(`model-v4`→`model-v5`) 필드 CAD 보기도 쓰지 않는 껍질을 만든다.
- 64개 × 64점 세계의 생성자는 목표 30 ms보다 느리다(§16).
- 관절 원점의 −0(`matrixToTransform`)은 JSON에서 0이 되어 JSON 왕복 뒤 `toEqual`이 다를 수 있다(값은 같다).
- 시작 프리셋·열기·시즌 알림은 CAD 외곽(`cad.bounds`)이라 CAD보다 큰 Collider나 `cad.bounds` 밖으로 옮긴 파트는 스냅 뒤 INIT에서 겹친다고 알릴 수 있다.
- 실측이 필요한 값(`assumptions.md` 5): Collider·바닥 마찰 0.4, 마찰 평균 규칙, 마찰 하중 상한 h·W, 행 한도 28, `MIN_HORIZONTAL_NORMAL` 0.25, 넓은 단계 여유 1 mm, 패치 무게 상수. 측정 방법 열이 있는 값: Collider 기본 마찰·바닥 마찰은 부품 재질 블록을 타일·벽 판·다른 부품 위에 놓고 기울여 미끄러지는 각 θ를 재 μ = tan θ로(팀 칸: Collider 카드 마찰), 마찰 하중 상한은 팔로 바닥·벽 윗면을 누르는 실험에서 로봇이 들리기 시작하는 모터 전류를 재 `collisionLift` 알림과 견주고, `MIN_HORIZONTAL_NORMAL`은 실제 로봇이 기운 면을 오르는지 보고, 패치 무게는 벽 모서리에 비스듬히 닿아 미끄러지는 몸체의 마찰·비틀림을 실물 영상과 견주고, 넓은 단계 여유는 빠르게 도는 관절이 얇은 면(벽 판·발판 막대)을 지나치지 않는지 실물과 같은 속도로 시험하고, 행 한도는 인테이크가 벽·바닥에 동시에 닿는 장면에서 `collisionLimit`가 뜨는지 보고 성능 시험과 함께 다시 정한다.
- 근사 항목(측정 대상 아님): 볼록 껍질(안에 그린 최대 64점·0.1 mm 격자), 자동 껍질(몸체마다 볼록 하나), 구조물 원기둥(외접 16각).
- 결정 항목: 편집 자세 겹침 문턱 1 mm(사용자 결정).

---

## 18. 원본 조사 자료 상태

- **사라진 원본**: 5단계의 조사 `p14collide/research/methods.md`(코드 주석의 표식 `M§…`)와 명세 `spec-5`(`spec-5 §…`, 부록 A·B), 그리고 이 단계의 시험 계획 번호(`A16`·`A20`·`A26`, `K1–K12`, `I1–I4`, `B9`, `C-M…`·`C-H…`, `P-M…`·`P-L…`·`P-H…`, `F7·F10·F13·F16`). 모두 저장소 밖 작업 폴더에 있다가 사라졌다.
- **코드와 CLAUDE.md로 복원된 것**: 모든 상수의 값, 알고리즘의 단계·분기, 행 키 형식, 결정의 이유 문장(주석에 적힌 만큼). 아래 표식의 뜻은 해당 표식이 달린 주석 문장에서 복원한 것이고 원문 자체를 보지 못했다.

| 표식                                      | 코드 주석에서 복원한 뜻(위치)                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| M§1.1                                     | 좁은 단계는 GJK/EPA가 아니라 SAT(`collision3d.ts`)                                                      |
| M§3, M§3 2, M§3 5, M§3 6, M§3 7           | 볼록 껍질 조사: Quickhull, 0.1 mm 양자화, 3° 합치기·Newell 0.1 mm, 껍질 오차 경고 2 mm, 부피 하한 1 mm³ |
| M§5 함정 1·2·4·5·7                        | 접촉 행: 공통 조상 야코비안 상쇄, 지렛대 p − o_k, 수평 법선 하한, ‖j‖² 하한, 접선 선택                  |
| P-M4·C-M9                                 | 정적 형상 양자화 없음(벽 면 = innerHalf, 구조물 = FieldSpec)                                            |
| P-M5                                      | 같은 (x, y)의 섀시–정적 점 병합                                                                         |
| P-M7                                      | `MIN_CAPSULE_SEGMENT` 1e-6                                                                              |
| P-M8                                      | 바닥·윗면 마찰 하중 상한 h·W                                                                            |
| P-M9                                      | `baseline`: t = 0 시작 겹침 깊이                                                                        |
| P-M10                                     | 행 한도 28, LCP 측정(행 ~70이면 수십 ms), 주축 전환 Murty 전환                                          |
| P-M11                                     | `staticShapes` 얼림·`transformHull` 새 객체                                                             |
| P-L13                                     | 패치 중심 무게(Box3D relax)                                                                             |
| P-L14                                     | 기억이 맞으면 모서리 질의 건너뛰기                                                                      |
| P-L17                                     | 가장 얇은 폭 하한                                                                                       |
| P-L18                                     | 고정 기저 정적 형상을 로봇 좌표로 한 번 옮김                                                            |
| P-L19                                     | 행 한도 고르기(통째로 넣다 멈춤, 짝 순서로 되돌림)                                                      |
| P-L20                                     | 자기 짝 상대 속도 여유                                                                                  |
| P-L21                                     | 깊이는 투영·빼기 전                                                                                     |
| P-L22                                     | 지난 t1 이어쓰기                                                                                        |
| P-L23 1·2                                 | 면 분리 선형 탐색, 모서리 법선 −u                                                                       |
| P-H1                                      | 곡률 보정                                                                                               |
| P-H2                                      | 둥근 짝은 GJK 먼저                                                                                      |
| C-M6                                      | 켠 Collider가 모두 빠지면 자동 껍질을 쓰지 않음                                                         |
| C-H2                                      | 충돌 상수는 `worldSpec.ts` 한곳                                                                         |
| spec-5 §1.2                               | Collider 규칙(자동 껍질·끈 Collider·기본 크기·Vertex Limit)                                             |
| spec-5 §1.6                               | 마찰·패치·바닥·윗면 하중 상한                                                                           |
| spec-5 §1.7                               | 섀시–정적 수평 투영·자리 합치기                                                                         |
| spec-5 §1.11                              | 정규 입력: 렌더러가 V, 메인이 `canonicalHull(V)`                                                        |
| spec-5 §2.1, §2.2, §2.4                   | 설정 범위, 세계 설명 검증, `ContactFriction` 상자 모양                                                  |
| spec-5 §3.1, §3.2, §3.5, §3.6, §3.7, §3.8 | 껍질, 정적 형상, SAT, GJK·둥근 짝, 겹침 깊이, 시작 겹침                                                 |
| spec-5 §4.1, §4.2, §4.3                   | 접촉 틀, 행, world 배선                                                                                 |
| spec-5 §5.3, §5.4                         | 메시 껍질, 몸체 충돌 모델 빌더                                                                          |
| spec-5 §11, §12                           | 기준 해시 장면, 성능 예산                                                                               |
| spec-5 부록 A·B                           | 한도 표, 점 id 형식                                                                                     |
| F7·F10·F13·F16                            | 비평 항목: 자동 껍질 오차 경고 없음, 관절 몸체 바닥 간격, Capsule `upAxis`, 끊긴 id 짝                  |

- **그래서 1차 출처로 추적할 수 없는 것**:
  - 모든 `[가정]` 값(마찰 0.4들, 구조물 μ, `MIN_HORIZONTAL_NORMAL`, `PATCH_WEIGHT_MIN`, `UPWARD_NORMAL_Z`, LCP 상수, 외접 32각 근사 폭 등)은 원래 출처가 없다.
  - `[결정]` 값의 근거로 "명세 §…"이라고 적힌 것(예: 한도 16·64·136, `REDUCE_TOLERANCE` 1 mm, `GJK_*`)은 원문이 사라져 코드 주석의 이유 문장만 남아 있다.
  - Box3D·Gregorius·Montanari·Ericson·Box2D·Bullet·PhysX·MuJoCo의 알고리즘 인용(파일 이름·줄 번호·알고리즘 이름)은 주석에 적힌 그대로이고 이 문서가 원본을 다시 열어 확인한 것이 아니다. 특히 `convex_manifold.c:647–775`·`:1330`·`:1369`·`:1445`·`:1567`·`:140`·`:685`·`:1430` 같은 줄 번호는 사라진 조사가 보았던 Box3D 판의 줄이다.
  - 벽 마찰의 재질 근거(Engineering Toolbox 등)는 3c 조사(`p12drive`) 쪽 문서에서 온 것이고 여기서는 `wheelData.ts` 주석을 옮겼다.
  - BIOBUZZ 벽·구조물 치수의 출처(공식 CAD·FAC·CM)는 4ab 문서(`field-biobuzz.md`)가 맡고, 사라진 `p13field`에 묶인다.
- 남아 있는 1차 근거: 코드(위 파일들), CLAUDE.md의 5단계 서술, `docs/assumptions.md` "5 메커니즘 충돌" 표(측정 방법과 상태), 시험 파일(`worldGolden.test.ts`와 위 시험 목록)이 값을 고정한다.
