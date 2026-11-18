# 6a 공 물리: POLLEN·NECTAR 자유 몸체와 로봇의 양방향 결합 (6단계의 첫 하위 단계)

## Context

CLAUDE.md는 "움직이는 경기 요소(HIVE 넘어감·득점 요소)는 아직 없다"고 적고 있다. 그래서 인테이크·슈터·득점 오토를 시험할 수 없다. 흡입구 컬러 센서도 늘 '물체 없음'이다.

사용자는 6단계를 넷으로 나눴다.

- **6a 공 물리** (이번)
- **6b HIVE 넘어감·FLOWER 안쪽 형상** (HIVE 태그도 움직임)
- **6c 센서·웹캠이 공을 봄**
- **6d 점수·규칙 알림·사람 선수 NECTAR·AUTO→TELEOP 이어서**

### 조사로 확인한 것 (BIOBUZZ CM·EFG·AndyMark)

| 공                | 지름     | 질량   | 구멍         | 개수  |
| ----------------- | -------- | ------ | ------------ | ----- |
| POLLEN(노랑)      | 0.0711 m | 24.9 g | Ø0.4 in 26개 | 40    |
| NECTAR(빨강·파랑) | 0.0914 m | 41.3 g | Ø0.6 in 26개 | 8 + 8 |

- 둘 다 PE 위플형 공이다.
- 시작 배치
  - GARDEN마다 POLLEN 4개(구석부터 벽에 붙여 한 줄)
  - FLOWER마다 POLLEN 4개
  - 올라간 CELL마다 NECTAR 3개
  - 로봇마다 프리로드 POLLEN 4개
- 필드 밖으로 나간 POLLEN은 경기 요원이 다시 넣는다(10.8.2).

### 사용자 결정 (11/13)

- **하위 단계 순서:** 물리 → HIVE·FLOWER → 센서 → 점수.
- **메커니즘은 실제 물리로 한다.** 롤러·플라이휠은 지금의 모터·CR 서보 관절과 Collider다. 공이 눌리는 부드러운 접촉과 마찰로 물고 던진다. 로봇과 양방향으로 묶어 발사하면 플라이휠이 느려진다.
- **AUTO→TELEOP은 AUTO 끝 상태에서 이어 간다(6d).** 6a는 그 이음새만 남긴다.
- **프리로드**
  - 팀이 하이어라키 오브젝트에 시뮬레이터 전용 컴포넌트로 자리를 둔다(로봇마다 4개까지).
  - 자리가 없으면 로봇 앞 타일에 자동으로 둔다. 앞이 막혔으면 뒤 → 왼쪽 → 오른쪽 순서다.
  - 네 면이 다 막혔으면 프리로드 없이 돌리고 경고한다.
- **공 물리 값은 가정값으로 시작한다.** 가정값과 정확하지 않은 값은 따로 정리해 둔다.
- **공은 기본으로 켠다.** 개인 실행 설정이고, 환경 설정 › 시뮬레이션과 Field 인스펙터에서 끈다.
- **FLOWER 안 POLLEN은 6b로 미룬다.** 지금 FLOWER는 꽉 찬 상자다.
- **필드 밖 POLLEN**
  - 확실히 나가면 물리에서 뺀다.
  - 3초 뒤([가정]) 나간 곳에서 가까운 LOADING ZONE에 다시 넣는다(벽에 붙인 빈 자리, 없으면 빌 때까지 기다림).
  - Console에 알린다. 시뮬레이션은 멈추지 않는다.
- **Cylinder Collider를 추가한다.** Unity에 없는 임시 편차다.
- **성능은 정확도를 우선한다.** 로봇에 닿은 공은 로봇과 한 풀이로 푼다. 실시간보다 조금 느려도 된다.

### 권장 기본값 (따로 묻지 않음, 바꿀 수 있음)

- 로봇 없는 세계는 6a에 없다(`EMPTY_WORLD` 그대로).
- 공은 하이어라키에 행을 두지 않는다. Field 인스펙터에 개수만 보인다.
- 굴림·회전 저항은 명시 충격으로 준다.
- gameState는 16 ms마다 보낸다(좌표 1e-4 양자화).
- 잡은 공을 로봇에 붙이는 최적화(weld)는 성능 목표를 못 맞출 때만 넣는다.

## 설계

### 1. 시뮬레이터 (순수·결정적, `src/shared/sim/elements/` 새 모듈)

- **공은 관절 나무 밖의 6자유도 몸체다.** 질량 m·I₃, 등방 관성 0.6344·m·r²(속이 빈 껍질). 상태는 SoA `Float64Array`다.
- **적분은 같은 속도 암시 오일러다.** 1 ms 절대 격자에서 로봇과 같은 하위 단계를 쓴다.
  - 중력, 항력, Magnus(명시적)를 넣는다.
  - 굴림·회전 저항은 앞 하위 단계의 λₙ로 낸 상한 있는 각충격이다.
  - 사원수 적분은 `sqrt`만 써서 정규화한다.
- **접촉:** 지금 `collideShapes`(collision3d.ts)를 공 = 구 캡슐로 재사용한다. 대상은 바닥·벽·구조물(`staticShapes`), 로봇 Collider(섀시·관절 몸체), 다른 공이다.
  - **부드러운 법선:** ODE/MuJoCo식 순응 γ = 1/(h(h·k + c)), c = 2√(k·m)이고 목표 = (h·k/(h·k + c))·δ/h다.
  - **딱딱한 심:** δ ≥ 0.3·r이면 강체 행으로 바꾸고 `elementCrushed` 알림을 낸다.
  - **반발:** 표면 종류별 e로 투기적 목표 e·(−vₙ*) − (1 + e)·max(g, 0)/h를 쓴다.
  - **마찰:** 쿨롱 상자 둘(Unity Average 결합)이고 기존 2회 엇갈림을 쓴다.
  - **키:** 새 접두어 `g`(`gn.e3/rk0`, `gt1.e3/j1k0`, `gn.e2/e5` …).
- **로봇 결합:** `Articulation.constrained`·`clampLimits`에 Schur 보수를 넣는다. 공 몸체가 있는 행만 새 분기를 타고, 없으면 지금 코드가 그대로 돈다.
  - A = J_r M̂⁻¹ J_rᵀ + Σ a W_e aᵀ + γ
  - 공 부분 a = [d; (p − x)×d]
  - 로봇 부분은 `relativeJacobian`이다.
  - 이 결합에서 플라이휠 감속과 롤러 반력이 저절로 나온다.
- **섬과 결정성:**
  - union-find로 섬을 묶고 뿌리는 가장 작은 번호다. 로봇 섬(로봇에 닿은 공)은 `art.step`에서 푼다.
  - 나머지 섬은 작은 조밀 LCP로 푼다(60행을 넘으면 PGS 30회, 알림).
  - 짝·행 순서는 (작은 번호, 큰 번호, 토큰) 정렬로 정한다.
  - 넓은 단계는 0.125 m 정수 격자다.
  - 잠들기: 5 mm/s 아래로 0.5 s가 지나면 섬 단위로 잠들고, 깨면 정확히 0에서 시작한다.
  - 로봇 섬 행 한도는 `MAX_COUPLED_ROWS` 48이다. 넘는 공은 v*의 로봇에 한쪽 방향으로만 풀고 `elementCouplingLimit`로 알린다.
  - 실패는 섬 단위로 가둔다. 공 섬이 던지면 그 섬만 속도를 0으로 하고 `worldError`를 낸다.
- **Cylinder Collider:** 몸체 틀의 끝점 둘과 반지름이다.
  - 공과의 짝은 정확한 구–원기둥 최근접(옆면·뚜껑·모서리)이다.
  - 벽·구조물·바닥·자기 충돌은 외접 32각 기둥 껍질로 근사한다(`cylinderPrism` 꼴, [가정]).
- **필드 밖과 다시 넣기:**
  - 공 중심이 벽 바깥면을 r만큼 넘거나 z < −0.05면 '나감'이다. 물리에서 빼고 표시에서도 감춘다.
  - 3 s([가정]) 뒤 나간 자리에서 가까운 LOADING ZONE(빨강·파랑 중심 거리)의 벽에 붙인 칸 가운데 로봇 외곽·공과 겹치지 않는 첫 칸에 쉬는 상태로 넣는다.
  - 빈 칸이 없으면 틱마다 다시 본다. 시각은 tNanos로만 센다.
  - simNotice는 `elementOutOfField`·`elementReentered`이고 실행마다 한 번이다.
- **`world.ts`:**
  - `spec.elements`가 있을 때만 `ElementWorld`를 만든다. 관절이 없어도 공 하위 단계를 돈다.
  - 공 행은 BodyCollision 행 뒤, `blocking` 거르기 뒤에 붙인다(공은 `blocked`를 켜지 않음).
  - `pose()`는 바꾸지 않는다. 새로 `gameState()`·`elementSnapshot()`(6d용)을 둔다.
- **세계 설명 v7:** 선택 칸 `elements?: { groups: ['garden'], preloads: {kind, body, position}[] }`을 둔다.
  - 물리 값·배치는 시즌 데이터(`resolveSeason`)에서 오고 렌더러 값을 믿지 않는다.
  - 칸이 없으면 v6과 같은 결과 객체다. 기준 해시 여덟은 그대로이고 버전 단언만 7로 고친다.
- **시즌 데이터:** `FieldSpec.elements: { types, layout } | null`.
  - BIOBUZZ에 POLLEN·NECTAR 형식과 GARDEN 배치를 넣는다. 빨강을 적고 파랑은 `symmetry.ts` Rz(π)로 만든다.
  - `'none'`은 null이다.
  - `checkFieldSpec`이 짝 대칭, 구조물과 겹치지 않음, 바닥 위를 확인한다.
- **6a에서 생기는 공:** GARDEN 8 + 로봇 프리로드 4. FLOWER·CELL·사람 선수 NECTAR는 6b·6d에서 생긴다.

### 2. 메인·프로토콜

- `SimWorld.gameState?()`를 둔다.
- `session.ts`가 `gameThrottle`(16 ms)로 `gameState` 이벤트 `{runId, tNanos, revision, poses(7N 정수), flags, final?}`를 보낸다. 일시 정지·Step·끝에 pose처럼 바로 보낸다.
- 사이드카 프로토콜은 바꾸지 않는다(팀 코드는 공을 보지 않음).

### 3. 렌더러·편집기

- **Preload 컴포넌트:** `SceneObject.preload {kind:'pollen', enabled?, center}`, `PROJECT_VERSION` 14.
  - 둘 수 있는 곳은 group·assembly·part이고 로봇·CAD 루트는 안 된다.
  - 스토어는 `setPreload`이고 실행 취소 한 단계다.
  - 카드 이름은 "Preload Slot"(번역 안 함)이고 시뮬레이터 배지가 붙는다. 카드 순서는 Collider 다음이다.
  - 기즈모는 노랑 큰 원 셋이다.
  - 경고는 `worldTooManyPreloads`·`worldPreloadOverlap`·`worldPreloadBelowFloor`·`worldPreloadNoRoom`이다.
  - 자동 배치(`autoPreloadSlots`)는 공유 함수라 렌더러 표시와 같다.
- **Cylinder Collider:** `colliders` kind `'cylinder'`(Center·Radius·Height·Direction)이고 v14에 들어간다.
  - Add Component, 카드, [하위에 맞추기], 기즈모(원 둘 + 선 넷)가 있다.
  - 세계 빌더(`play/worldColliders.ts`)가 끝점을 보낸다.
  - 도움말과 CLAUDE.md에 임시 편차로 적는다.
- **공 표시:** `ElementsView`가 InstancedMesh 3개(POLLEN·NECTAR 빨강·파랑)로 그린다.
  - 편집 중에는 시작 배치와 대상 로봇 프리로드를 보이고, 자동 배치는 반투명이다.
  - 실행 중에는 `simGame`을 명령형으로 갱신한다.
  - STOP 뒤에는 잔상 `ghostGame`(renderOrder 5)이고, 마지막 상태는 `lastRunElements`에 둔다(6d용).
  - `fieldHidden`·고립 보기를 지키고 클릭되지 않는다. 재질 해제는 StrictMode를 견디게 미룬다.
- **설정:** `RendererPlaySettings.gameElements`(기본 켬, 개인 설정, `runSettings`에 보내지 않음).
  - Field 인스펙터 '경기 요소' 구역에 켜기·끄기, 묶음별 개수(6b·6d 표시), 로봇마다 프리로드 출처를 둔다.
  - `PlayRun.field`에 실행의 값을 둔다.
- **Console:** 새 경고·알림의 ko·en 문구.

### 4. 가정값 정리 (사용자 요청)

- `docs/assumptions.md`(한국어)를 새로 만든다. 표는 항목 · 값 · 위치(파일·상수) · 근거 · 측정 방법 · 단계다.
- 6a 가정값
  - 강성 POLLEN 3000·NECTAR 4500 N/m
  - 반발 바닥 0.30·딱딱한 면 0.64·공 0.5·로봇 0.5
  - μ 0.5, 굴림 저항 0.05, C_d 0.5, Magnus 0.5/0.3, 심 0.3·r
  - 다시 넣기 3 s
  - 원기둥 32각 근사
  - 잠들기 문턱
- 지금 코드·CLAUDE.md의 `[가정]` 전부도 훑어 함께 적는다(3b·3c·4ab·4c·4d·5).
- CLAUDE.md에 "새 가정값은 이 파일에도 적는다"를 더한다.

## 진행 (Ultracode: Workflow)

1. **계약 커밋(한 에이전트):**
   - 형식: 세계 설명 v7, `FieldSpec.elements`, `SimCollider` cylinder, `SceneObject.preload`, v14, `gameState` 이벤트, notice 코드, 상수
   - 파싱·검증 뼈대, i18n 키, 시험 고정값의 버전 단언
   - 기준 해시 여덟이 그대로인지 확인한다.
2. **병렬 구현(worktree):**
   - **A 물리:** `elements/` 모듈, Articulation 결합, `world.ts`, 구–원기둥, 필드 밖과 다시 넣기, 해석·성능·결정성 시험, 아홉째 기준 해시
   - **B 렌더러·메인:** Preload 컴포넌트와 v14, Cylinder Collider 편집기, `worldElements` 빌더, `ElementsView`, playStore, session gameState, 설정·Field 인스펙터
   - **C 가정값 문서:** 전체 훑기
3. **합치기:** 통합 시험(렌더러 빌더 → JSON → `parseWorldSpec` → `PhysicsWorld` 첫 틱 위치 = `elementSpawns`)을 돌리고 전체 검사를 한다.
4. **확인과 수정:** 렌즈별 적대적 리뷰(물리·결정성·성능, Unity·편집기, 문서·시험)와 실제 앱 E2E를 함께 돌린다. 이어서 검증, 수정, 전체 재검사를 한다.
5. **올리기:** CLAUDE.md(현재 상태, 불변 조건: 기준 해시 아홉·v7·v14·가정값 문서, 6a 코드 구조)를 고친다. PR 하나를 만들어 병합하고(merge, 40자 SHA) 브랜치를 main에 다시 맞춘다.

## 검증

- **명령:** `pnpm typecheck`·`lint`·`npx prettier --check .`·`build:sidecar`·`build`, `SANDBOT_TEST_LIBRARIES_REQUIRED=1 pnpm test`
- **해석 시험** (끌개·공기 끄고)
  - 미끄러지다 구름 v₀/(1 + I/mr²), 굴림 감속 — 2%
  - 반발 높이 e²·h₀ — 2%
  - 쉬는 공 10 s 떨림 없음, 침하 mg/k
  - 쌓기 안정, 에너지 늘지 않음
  - 섀시가 미는 공의 운동량 보존 — 1%
  - CR 서보 롤러 인테이크가 공을 끌어당김, 법선력 ≈ k·δ
  - 플라이휠 + 고정 후드: 발사 속도 ωR/2와 ω₁ = ω₀/(1 + 0.4085·mR²/I) — 5%, 각충격 = I·Δω — 1%
  - Mesh 64점과 Cylinder 비교
  - 5 m/s 터널링 없음
  - 섬 실패 가두기
- **필드 밖:** 벽 너머로 던진 POLLEN이 3 s 뒤 가까운 LOADING ZONE에 들어간다. 칸이 막히면 기다린다. 결정적이다.
- **기준 해시:** 여덟은 그대로다. 아홉째는 BIOBUZZ 빨강 GARDEN, 메카넘 + 상자 섀시, Cylinder 인테이크 롤러, 프리로드 4다.
- **결정성:** 같은 과정을 두 번 돌리면 바이트가 같다(스냅숏 포함). 만드는 순서를 바꿔도 같다.
- **성능** (시험이 기록, CI 상한 5배)

  | 경우                     | 하위 단계 중앙값 목표 |
  | ------------------------ | --------------------- |
  | 공 56개가 잠듦           | 기준 + 0.02 ms 이하   |
  | 바닥에서 깸              | 0.3 ms                |
  | 프리로드 4개를 들고 주행 | 0.7 ms                |
  | 결합 8개                 | 1.5 ms (p99 4 ms)     |
  | 12개 더미                | 0.4 ms                |

- **실제 앱 E2E:**
  - INIT에 GARDEN 공과 프리로드가 보인다.
  - 키보드로 인테이크·발사한다.
  - STOP 뒤 잔상이 남는다.
  - 벽 너머로 쏜 공이 LOADING ZONE으로 돌아온다.
  - Field 인스펙터에서 끌 수 있다.
  - v14로 저장·열기, Preload·Cylinder를 실행 취소할 수 있다.
  - 실시간 비율을 기록한다.

## 6b–6d에 남길 이음새

- **6b:** 공 행의 몸체 부분을 일반화해 HIVE를 1자유도 동적 몸체로 둔다. FLOWER 안쪽 형상과 `flower`·`hiveCell` 배치 묶음을 넣고, 카메라가 HIVE 각을 틱마다 읽는다.
- **6c:** `tickState()`의 구 층을 광선·가림에 넣는다.
- **6d:** 득점 판정, G407류 알림, 사람 선수 NECTAR, `final` 스냅숏 + 로봇 끝 자세로 이어 가기.
