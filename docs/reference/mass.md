# 질량 모델(3a) 기준 문서

이 문서는 SandBot의 3a 단계(질량 모델: CAD 메시의 부피·무게중심·관성 계산, 재질 밀도, 출력물 채움률, 상용 부품(COTS) 데이터시트 질량, CAD 이름 규칙, 덮어쓰기와 저울 맞추기, 로봇·오브젝트의 질량·무게중심·관성 합성)가 쓰는 모든 치수·상수·표·수식·결정사항을 한곳에 적는다. 원본 조사·명세 문서(코드 주석이 `spec-3a`·`method.md`·`materials.md`라는 이름으로 인용한 것. 이 문서들이 든 폴더 이름은 코드·CLAUDE.md에 기록이 없다. `docs/assumptions.md`와 3b 코드가 `p10mass`를 적은 것은 3b 조사 `actuators.md`의 폴더로서뿐이다)는 저장소 밖 작업 폴더에 있다가 사라졌으므로, 코드(`src/renderer/src/mass/*`, `src/renderer/src/cad/meshMass.ts`, `src/renderer/src/scene/massSettings.ts`와 이 값들을 읽는 `cad/stepImport.ts`·`scene/geometryRegistry.ts`·`project/projectFile.ts`·`editor/mass/*`·`play/worldSpec.ts`·`play/worldJoints.ts`)와 CLAUDE.md·`docs/assumptions.md`의 서술이 곧 원본이다. 이 영역의 코드 주석은 `[가정: …]` 같은 괄호 표기를 쓰지 않고 "가정"·"판단값"·출처 URL을 문장으로 적으므로, 상태 열은 그 문장을 그대로 옮겼다. 코드에 출처가 없으면 "출처 기록 없음"이라고 썼고, 코드에 상수로 없고 이 문서를 쓰며 코드의 식으로 다시 계산한 값은 "계산값"이라고 표시했다. 수식은 코드의 변수 이름을 그대로 써서 다시 구현할 수 있게 했다. 내부 단위는 kg·m·kg·m²이고, 질량 설정은 시뮬레이터 전용이라 생성 코드·구성 XML·하드웨어 검증·사용처와 관계없다. 로봇 전체 질량은 저울 무게로 맞추므로 결과를 좌우하는 것은 재질 사이의 비율이다.

## 목차

0. 읽는 법
1. 범위·파일·데이터 흐름
2. 단위·좌표·자료형 규약
3. 한눈에 보는 상수 표
4. 메시 질량 성질 계산(`cad/meshMass.ts`)
5. 닫힘 지표와 메시 상태 분류
6. 재질 밀도 표
7. 출력 재질의 유효 밀도(껍질·채움률)
8. 질량 설정(`MassSettings`·`RigidbodySettings`)의 범위·정리·저장
9. COTS(상용 부품) 질량 표
10. COTS 키 고르기 규칙
11. 이름 규칙(`nameRules.ts`)
12. 추정 알고리즘(`computeMassModel`)
13. 저울 맞추기와 정보 없음 대체의 수식·한도
14. 경고·알림 종류
15. 오브젝트 자기 몫(`own`)과 3b·3c 연결
16. 인스펙터·씬 뷰·표시 규칙
17. 설계 결정·Unity 대응·임시 편차
18. 시험 기준
19. 외부 출처 상태(죽은 링크·엇갈린 출처·주석과 다시 계산한 값의 차이)
20. 알려진 한계·남은 일
21. 원본 조사 자료 상태

---

## 0. 읽는 법

| 표시           | 뜻                                                                          |
| -------------- | --------------------------------------------------------------------------- |
| 출처 기재      | 코드 주석이 제조사·공급사 페이지나 데이터시트 URL(또는 문서 이름)을 적은 값 |
| 가정(주석)     | 코드 주석이 "가정"이라고 적은 값. `docs/assumptions.md`의 3a 표에도 있다    |
| 판단값(주석)   | 코드 주석이 "판단값"이라고 적은 값                                          |
| 설계 값        | 식이나 구현 선택으로 정해진 값(주석에 태그 없음)                            |
| 계산값         | 코드에 상수로 없고 이 문서를 쓸 때 코드의 식으로 다시 계산한 값             |
| 출처 기록 없음 | 코드·CLAUDE.md·`docs/assumptions.md` 어디에도 출처가 적혀 있지 않은 값      |

위치는 줄 번호 없이 파일과 상수·함수 이름으로 적는다. 파일 경로는 따로 적지 않으면 `src/renderer/src/` 기준이다.

---

## 1. 범위·파일·데이터 흐름

### 1.1 파일 지도

| 파일                                       | 역할                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mass/types.ts`                            | 타입(`MeshMassProps`, `MassSettings`, `RigidbodySettings`, `ObjectMass`, `RobotMass`, `OwnMass`, `MassModel`, `MassWarning`, `MassNotice`, `MassLookup`, `SourceNode`, `CadMassSummary`), `MATERIAL_KEYS`, `MASS_CLOSURE_LIMIT`·`MASS_CLOSURE_OPEN`, `DEFAULT_INFILL`, `DEFAULT_ROBOT_MASS` |
| `mass/materials.ts`                        | 재질 밀도 표 `MATERIALS`, `DEFAULT_MATERIAL`, 출력물 껍질 `PRINTED_SHELL_THICKNESS`·`printedFillFraction`·`effectiveDensity`                                                                                                                                                                |
| `mass/cotsTable.ts`                        | COTS 질량 표 `COTS_ENTRIES`, 키 고르기(`componentCotsKey`·`wheelCotsKey`·`pinpointPodCotsKey`·`skuCotsKey`)                                                                                                                                                                                 |
| `mass/nameRules.ts`                        | CAD 이름 규칙(낱말 규칙 `WORD_RULES`, goBILDA SKU 시리즈 `GOBILDA_SERIES`, `matchNameRule`·`matchAncestorRule`)                                                                                                                                                                             |
| `mass/massModel.ts`                        | `computeMassModel`(순수 함수): 덩어리·COTS·제품·재질 추정, 저울 맞추기, 로봇 합성, 오브젝트별 합계·자기 몫                                                                                                                                                                                  |
| `mass/chassis.ts`                          | 섀시 몸체 = 로봇 전체 − 관절 몸체(`subtractMassProps`), 관성 하한(`floorInertia`)                                                                                                                                                                                                           |
| `cad/meshMass.ts`                          | 메시 하나의 단위 밀도 질량 성질 `computeMeshMass`, 상태 분류 `meshMassState`, 캐시 값 확인 `isMeshMassProps`                                                                                                                                                                                |
| `cad/stepImport.ts`                        | 워커의 `convertMesh`가 변환할 때 `computeMeshMass`를 한 번 부름, `meshSourcePaths`(원래 이름 경로), `MESH_CACHE_TAG`                                                                                                                                                                        |
| `scene/geometryRegistry.ts`                | 형상과 같은 id·수명으로 `meshMassProps`·`meshSourcePath` 보관, `cadMassSummary`, `beginCadLoad`                                                                                                                                                                                             |
| `scene/massSettings.ts`                    | 질량 설정의 범위·정리·비교(스토어·프로젝트 파일 읽기·Add Component가 같이 씀)                                                                                                                                                                                                               |
| `project/projectFile.ts`                   | `PROJECT_VERSION` 7의 `mass`·`rigidbody` 읽기                                                                                                                                                                                                                                               |
| `editor/mass/*`                            | 인스펙터 질량 카드·Rigidbody 카드·추정 한 줄, 씬 뷰 무게중심 표시, `useMassModel`(계산 캐시)                                                                                                                                                                                                |
| `units/units.ts`                           | 질량 표시·입력 단위(`massDisplay`·`formatMass`·`parseMass`)                                                                                                                                                                                                                                 |
| `play/worldSpec.ts`, `play/worldJoints.ts` | 소비자: 섀시 몸체(`chassisBody`), 바퀴 회전 질량(`wheelSpinMass`), 관절 몸체 질량(`MassModel.own`)                                                                                                                                                                                          |

### 1.2 데이터 흐름

```
STEP 파일 ─▶ (워커) convertMesh: computeMeshMass(피벗 기준 double 좌표) ─▶ ImportedMesh.mass ─▶ 메시 캐시(MESH_CACHE_TAG)
                                                                              │
                          registerGeometry ─▶ geometryRegistry (meshMassProps, meshSourcePath)   ← 씬 문서 밖
                                                                              │
 씬 문서(SceneObject.mass / robot.rigidbody / components / wheel) ─┐           │
                                                                    ▼           ▼
                                              computeMassModel(objects, lookup) ─▶ MassModel { objects, robots, own }
                                                       │
         ┌─────────────────────┬───────────────────────┼────────────────────────┐
         ▼                     ▼                       ▼                        ▼
 인스펙터 카드·무게중심 표시   play/worldSpec.ts         play/worldJoints.ts       편집 자세 줄(바퀴 카드 등)
                              (섀시 몸체, 바퀴 회전 질량)  (관절 몸체 질량·관성)
```

씬 문서에는 사용자 설정만 들어가고 메시의 질량 성질은 형상과 함께 문서 밖에 있다. 모델은 같은 문서와 같은 메시 성질이면 같은 결과를 내는 순수 함수이고 `objects` 키 순서로 센다(결정적).

---

## 2. 단위·좌표·자료형 규약

| 항목                  | 규약                                                                                                                                                     | 위치                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 내부 단위             | 질량 kg, 길이 m, 부피 m³, 단위 밀도 관성 m⁵, 관성 kg·m²                                                                                                  | `mass/types.ts` 머리 주석                                          |
| 관성 자료형           | `SymMatrix3 = [Ixx, Iyy, Izz, Ixy, Ixz, Iyz]`, 관성 행렬 I = ∫(\|r\|²E − r rᵀ) dm. 비대각은 행렬 값 그대로라 Ixy = −∫xy dm                               | `SymMatrix3`                                                       |
| 메시 질량 성질의 좌표 | 피벗(이 메시를 쓰는 파트 오브젝트의 원점 = 메시 경계 상자 중심) 기준, CAD 파일 축. 질량 = 밀도 × volume, 관성 = 밀도 × inertia                           | `MeshMassProps`                                                    |
| 모델 결과의 좌표      | 로봇 안 오브젝트는 로봇 좌표(X 앞·Y 왼쪽·Z 위, 원점 로봇 중심 바닥), 로봇 밖 오브젝트는 필드 좌표. 로봇 밖은 로봇 합계에 넣지 않는다                     | `ObjectMass`, `computeMassModel`                                   |
| 변환                  | 부모 사슬 행렬(`transformToMatrix`, three.js `Matrix4`)로 무게중심을 옮기고 회전 부분 R로 관성을 R·I·Rᵀ로 돌린다. transform에 척도는 없다고 본다         | `visit`, `rotateInertia`                                           |
| 로봇 행렬             | 로봇은 자기 좌표가 기준이라 단위 행렬                                                                                                                    | `visit`                                                            |
| 질량 입력 표시        | 길이 표시 단위를 따른다: mm·cm·m는 1 kg 미만 g(정수), 그 위 kg(소수 셋). in은 lb(소수 둘), 0.1 lb 미만이면 oz(소수 하나)                                 | `units/units.ts` `massDisplay`                                     |
| 질량 입력 파싱        | `g`·`gram(s)`·`kg(s)`·`lb(s)`·`pound(s)`·`oz`·`ounce(s)`, 대소문자 무시. 단위 없는 숫자는 칸에 보이는 값의 기호(없으면 파트 g·로봇 kg, in이면 lb)로 읽음 | `parseMass`, `bareMassSymbol`                                      |
| 질량 단위 환산        | 1 lb = 0.45359237 kg, 1 oz = 1/16 lb(국제 야드·파운드 정의)                                                                                              | `units/units.ts` `KG_PER_LB`·`KG_PER_OZ`, `cotsTable.ts` `LB`·`OZ` |
| COTS 표 단위 환산     | `G` = 0.001(g → kg), `OZ` = 0.028349523125, `LB` = 0.45359237                                                                                            | `mass/cotsTable.ts`                                                |

---

## 3. 한눈에 보는 상수 표

상태 표기의 뜻은 §0. "assumptions" 열은 `docs/assumptions.md` 3a 표의 분류다(그 표에 있을 때).

| 항목                              | 값                                                                | 단위                              | 위치                                                                                | 상태·근거                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 닫힌 메시 문턱                    | 0.02                                                              | 무차원                            | `mass/types.ts` `MASS_CLOSURE_LIMIT`                                                | 이하면 부피를 쓰고 넘으면 표면(질량 0). 판단값. 코드에 출처 없음(assumptions: 가정)                                                                                                                                                                                                                 |
| 열린 메시 표시 문턱               | 0.001                                                             | 무차원                            | `mass/types.ts` `MASS_CLOSURE_OPEN`                                                 | 이 값을 넘고 0.02 이하면 "열린 메시(근사)"로 센다. 출처 기록 없음                                                                                                                                                                                                                                   |
| 최소 부피(표면 판정)              | 1e-12                                                             | m³                                | `cad/meshMass.ts` `MASS_MIN_VOLUME`, `mass/massModel.ts` `MIN_SOLID_VOLUME`         | 이보다 작은 부피는 표면. 주석: "가장 작은 실제 파트(M3 나사)도 약 1e-8 m³"(`spec-3a §1` 인용), 1 mm³의 1/1000. 두 파일에 같은 값이 따로 있다                                                                                                                                                        |
| 기본 채움률                       | 0.15                                                              | 무차원                            | `mass/types.ts` `DEFAULT_INFILL`                                                    | 출처 기록 없음(assumptions: 가정)                                                                                                                                                                                                                                                                   |
| 정보 없는 로봇 질량               | 13.6                                                              | kg                                | `mass/types.ts` `DEFAULT_ROBOT_MASS`                                                | 주석: "FTC 대회 로봇은 대개 25–35 lb다". 13.6 kg ≈ 29.98 lb(계산값). 3c 섀시 대체 상자도 씀(assumptions: 가정)                                                                                                                                                                                      |
| 정보 없는 로봇 무게중심 높이 비율 | 0.35                                                              | 외곽 높이 비율                    | `mass/massModel.ts` `DEFAULT_COM_HEIGHT`                                            | 주석: "구동계·배터리·허브가 아래에 몰린 FTC 로봇을 가정한 판단값"(assumptions: 가정)                                                                                                                                                                                                                |
| 기본 재질                         | `aluminum6061`                                                    | -                                 | `mass/materials.ts` `DEFAULT_MATERIAL`                                              | 주석: "팀 로봇 대부분이 알루미늄 구조라 고른 판단값"(assumptions: 가정)                                                                                                                                                                                                                             |
| 출력물 껍질 두께                  | 0.0011                                                            | m                                 | `mass/materials.ts` `PRINTED_SHELL_THICKNESS`                                       | §7(assumptions: 가정)                                                                                                                                                                                                                                                                               |
| 저울 맞추기 정상 범위             | 0.6 – 1.6                                                         | 비율                              | `mass/massModel.ts` `SCALE_USUAL_MIN`·`SCALE_USUAL_MAX`                             | 판단값. §13(assumptions: 가정, 경고 문턱)                                                                                                                                                                                                                                                           |
| COTS 하나로 볼 크기 배수(부품)    | 1.6                                                               | 알루미늄 6061 환산 질량 ÷ 표 질량 | `mass/massModel.ts` `COTS_SIZE_FACTOR`                                              | 판단값. §12.4(assumptions: 근사)                                                                                                                                                                                                                                                                    |
| COTS 하나로 볼 크기 배수(바퀴)    | 4                                                                 | 같음                              | `mass/massModel.ts` `WHEEL_SIZE_FACTOR`                                             | 판단값. §12.4(assumptions: 근사)                                                                                                                                                                                                                                                                    |
| COTS 크기 검사용 밀도             | 2700                                                              | kg/m³                             | `mass/massModel.ts` `cotsRejection`이 쓰는 `MATERIALS.aluminum6061.density`         | 알루미늄 6061 값(§6)                                                                                                                                                                                                                                                                                |
| 질량 덮어쓰기 상한                | 100                                                               | kg                                | `scene/massSettings.ts` `MAX_OVERRIDE_MASS`                                         | 0 < m ≤ 100. 주석: "FTC 로봇 하나(대개 25–35 lb)를 넉넉히 넘는다"                                                                                                                                                                                                                                   |
| 저울 무게 상한                    | 200                                                               | kg                                | `scene/massSettings.ts` `MAX_WEIGHED_MASS`                                          | 0 < m ≤ 200. 출처 기록 없음                                                                                                                                                                                                                                                                         |
| 무게중심 덮어쓰기 한도            | 10                                                                | m(성분별 절댓값)                  | `scene/massSettings.ts` `MAX_CENTER_OF_MASS`                                        | 주석: 세계 설명의 위치 한도(`MAX_COORD`)와 같다                                                                                                                                                                                                                                                     |
| 메카넘 바퀴 지름 허용 오차        | 0.0015(+1e-12)                                                    | m                                 | `mass/cotsTable.ts` `WHEEL_DIAMETER_TOLERANCE`                                      | 표 제품으로 볼 지름 ±1.5 mm. 출처 기록 없음                                                                                                                                                                                                                                                         |
| UltraPlanetary 한 단 최대 감속비  | 5.23 × 1.01 = 5.2823                                              | 비                                | `mass/cotsTable.ts` `ULTRA_PLANETARY_MAX_STAGE`                                     | 가장 큰 카트리지 5.23:1에 반올림한 감속비(5.2·27)도 받도록 1 % 넉넉하게                                                                                                                                                                                                                             |
| UltraPlanetary 최대 카트리지 수   | 3                                                                 | 개                                | `mass/cotsTable.ts` `ULTRA_PLANETARY_MAX_CARTRIDGES`                                | 한 기어박스에 3개까지                                                                                                                                                                                                                                                                               |
| UltraPlanetary 기본 질량          | (234 + 33.5 + 66.5) g = 334 g(0.334 kg)                           | kg                                | `mass/cotsTable.ts` `ULTRA_PLANETARY_BASE`                                          | §9.2                                                                                                                                                                                                                                                                                                |
| UltraPlanetary 감속 카트리지 하나 | 35 g(0.035 kg)                                                    | kg                                | `mass/cotsTable.ts` `ULTRA_PLANETARY_CARTRIDGE`                                     | §9.2                                                                                                                                                                                                                                                                                                |
| 정보 없는 로봇 외곽(CAD 없음)     | 0.4572 × 0.4572 × 0.4572 정육면체(18 in), x·y ±0.2286, z 0–0.4572 | m                                 | `scene/coordinates.ts` `ROBOT_SIZE`(= 18 × 0.0254)를 `massModel.ts` `robotBox`가 씀 | 임시 씬의 18 in 상자 로봇 크기                                                                                                                                                                                                                                                                      |
| 섀시 질량 하한                    | 0.1                                                               | kg                                | `play/worldSpec.ts` `MIN_CHASSIS_MASS`                                              | 주석: "가정: FTC 로봇 섀시는 수 kg이다". 3c                                                                                                                                                                                                                                                         |
| 섀시 관성 주관성 값 하한          | 1e-6                                                              | kg·m²                             | `play/worldSpec.ts` `MIN_CHASSIS_INERTIA`                                           | 주석: 가정. 18 in 정사각 13.6 kg 상자의 요 관성 0.48의 약 50만분의 1                                                                                                                                                                                                                                |
| 섀시 대체 상자 높이               | 0.2(무게중심 0.1)                                                 | m                                 | `play/worldSpec.ts` `PLACEHOLDER_CHASSIS_HEIGHT`                                    | 주석: "높이 0.2 m, 무게중심 높이 0.1 m, 가정". 섀시 몸체를 모를 때 쓰는 `placeholderChassisBody`의 높이다: 질량 모델이 없을 때(인스펙터 경로, 경고 없음)와, 관절 몸체를 뺀 남은 섀시 질량·관성이 쓸 수 없을 때(경고 `worldChassisMass`, §15.3)                                                      |
| 몸체 질량을 모를 때               | 0.001                                                             | kg                                | `play/worldJoints.ts` `FALLBACK_BODY_MASS`                                          | 3b, spec-3b §1-10(1 g)                                                                                                                                                                                                                                                                              |
| 몸체 관성 하한                    | 4e-8                                                              | kg·m²                             | `play/worldJoints.ts` `MIN_BODY_INERTIA`                                            | 3b. 주석: 1 g 질량을 반지름 1 cm 구로 본 관성(2/5 × 0.001 × 0.01² = 4e-8)이고 "가정, 보통 몸체 관성 1e-4–1e-2보다 훨씬 작다". 몸체 관성의 대각 최솟값이 이보다 작으면 하한만큼의 등방 관성을 세 대각에 더한다(`withInertiaFloor`). 점질량 몸체가 관절 축 위에 있어도 질량 행렬이 특이하지 않게 한다 |
| 바퀴 회전 관성 계수               | 0.53                                                              | 무차원                            | `src/shared/sim/wheelData.ts` `WHEEL_SPIN_INERTIA_FACTOR`                           | 3c(`drivetrain.md` §4). 주석: goBILDA GripForce 104 mm(236 g)·96 mm 메카넘(207 g) STEP을 재질 밀도로 적분하면 회전 반지름이 R의 0.72–0.73배라 0.72² ≈ 0.53(`data.md` §5.1, 두 바퀴의 J가 3.34e-4·2.55e-4 kg·m²). J = 0.53 · m · R²                                                                  |
| 바퀴 질량 범위                    | 0.01 – 2                                                          | kg                                | `src/shared/sim/wheelData.ts` `MIN_WHEEL_MASS`·`MAX_WHEEL_MASS`                     | 3c. 주석: 질량 모델의 바퀴 하위가 구조물을 품었을 때 회전 관성이 터무니없이 커지지 않게. `effectiveWheelMass`가 유한한 양수 질량을 이 범위로 자르고, 아니면(null·0·비유한) 종류 기본 질량을 쓴다                                                                                                    |
| 종류별 기본 바퀴 질량             | 메카넘 0.236, 옴니 0.119, 일반(트랙션) 0.082                      | kg                                | `src/shared/sim/wheelData.ts` `DEFAULT_WHEEL_MASS`                                  | 3c. 주석: goBILDA GripForce 104 mm 메카넘 236 g, 96 mm 옴니 119 g, 96 mm Hogback 트랙션 82 g(제조사 상품 페이지, `data.md` §2.2–2.3). 질량 모델이 바퀴 질량을 모를 때 쓴다. COTS 표에는 메카넘 104·96 mm만 있다(메카넘 종류 기본 0.236 kg은 `wheel:gripForce104`와 같은 값)                         |
| 무게중심 표시 크기                | 로봇 공 반지름 0.018, 십자 반 길이 0.06, 오브젝트 공 반지름 0.01  | m                                 | `editor/mass/CenterOfMassIndicator.tsx`                                             | 표시만. §16                                                                                                                                                                                                                                                                                         |

---

## 4. 메시 질량 성질 계산(`cad/meshMass.ts`)

STEP 솔리드 하나(메시 하나)의 단위 밀도(1 kg/m³) 질량 성질을 구한다. 워커의 `convertMesh`가 변환할 때 한 번 계산해 메시 캐시에 넣는다. WASM과 네이티브 변환기가 같은 경로다. 계산은 삼각형을 입력 순서대로 한 번 훑고, 사칙연산과 제곱근만 써서 결정적이다. 발산 정리로 삼각형마다 닫힌 형태의 부분식을 더한다(Eberly, "Polyhedral Mass Properties (Revisited)", Geometric Tools 2002/2009 — Mirtich 1996과 같은 결과).

### 4.1 입력

| 항목      | 값                                                                       | 비고                                                                                               |
| --------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| positions | CAD 좌표 정점(미터, xyz 반복)                                            | 원래 double 값(Float32로 줄인 positions가 아니다)                                                  |
| indices   | 삼각형                                                                   | 3개씩. `count = len − len % 3`만 씀                                                                |
| bounds    | positions의 경계 상자                                                    | 그 중심 o가 피벗                                                                                   |
| 감김      | 바깥에서 볼 때 반시계라고 봄(occt-import-js가 REVERSED 면을 뒤집어 맞춤) | 전체가 반대면(부호 있는 부피 < 0) 모든 적분의 부호를 바꿈. 적분이 모두 면적 벡터에 선형이라 정확함 |

### 4.2 삼각형마다 더하는 값

삼각형의 세 꼭짓점을 피벗 기준으로 p0, p1, p2라 하고 d = (p1 − p0) × (p2 − p0)(면적 벡터의 2배)라 한다. 성분 k ∈ {x, y, z}마다 (코드의 s0·s1·s2는 중간값):

```
f1_k = k0 + k1 + k2
s2   = k0² + k1·(k0 + k1)
f2_k = s2 + k2·f1_k                       (= k0² + k1² + k2² + k0k1 + k0k2 + k1k2)
f3_k = k0·k0² + k1·s2 + k2·f2_k
```

누적(코드 이름):

```
vx += dx·f1x    vy += dy·f1y    vz += dz·f1z          (부피, 축마다 한 형식)
ix += dx·f2x    iy += dy·f2y    iz += dz·f2z          (∫x, ∫y, ∫z)
ixx += dx·f3x   iyy += dy·f3y   izz += dz·f3z         (∫x², ∫y², ∫z²)
g_i,x = f2x + x_i·(f1x + x_i)  (i = 0, 1, 2; y·z축도 같은 꼴)
ixy += dx·(y0·g0x + y1·g1x + y2·g2x)                  (∫xy)
iyz += dy·(z0·g0y + z1·g1y + z2·g2y)                  (∫yz)
izx += dz·(x0·g0z + x1·g1z + x2·g2z)                  (∫zx)
sx, sy, sz += dx, dy, dz       area2 += |d|
```

### 4.3 결과

| 값                                 | 식                                                                                                                                                                     | 비고                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| volume                             | V = (vx + vy + vz) / 18                                                                                                                                                | 원점(피벗)을 꼭짓점으로 하는 사면체 부피의 합과 같다. 닫히면 vx/6 = vy/6 = vz/6 = V. V < 0이면 부호를 바꿔 양수로 |
| centroid (피벗 기준)               | (cx, cy, cz) = (ix, iy, iz) / 24 / V                                                                                                                                   |                                                                                                                   |
| 2차 적분                           | ∫x² = ixx/60, ∫y² = iyy/60, ∫z² = izz/60, ∫xy = ixy/120, ∫yz = iyz/120, ∫zx = izx/120                                                                                  | 부호 보정(sign) 곱함                                                                                              |
| inertia (무게중심 기준, 단위 밀도) | Ixx = ∫y² + ∫z² − V(cy² + cz²), Iyy = ∫z² + ∫x² − V(cz² + cx²), Izz = ∫x² + ∫y² − V(cx² + cy²), Ixy = −(∫xy − V·cx·cy), Ixz = −(∫zx − V·cz·cx), Iyz = −(∫yz − V·cy·cz) | 배열 순서 [Ixx, Iyy, Izz, Ixy, Ixz, Iyz]. 비대각은 행렬 값(곱관성의 음수)                                         |
| area                               | A = (Σ \|d\|) / 2                                                                                                                                                      | m². 깨진 입력이면 0                                                                                               |
| 면적 벡터 크기                     | \|ΣndA\| = \|(sx, sy, sz)\| / 2                                                                                                                                        | 닫힘 지표(§5)에 씀                                                                                                |
| closure                            | §5                                                                                                                                                                     | 닫히면 0, 부피가 0이면 Infinity                                                                                   |

부피가 없는 메시(\|signed V\| < `MASS_MIN_VOLUME`)는 무게중심이 정해지지 않으므로 `surfaceProps(area)` = `{ volume: 0, centroid: [0,0,0], inertia: 0 여섯, area, closure: Infinity }`를 돌려준다(피벗을 두고 질량 0으로 씀). centroid·inertia·volume 가운데 유한하지 않은 것이 있거나 closure ≥ 0이 아니면 같은 표면 값이다(깨진 좌표·범위 밖 인덱스도 유한한 값으로 둠).

### 4.4 성능·정확도(시험이 고정)

| 항목                                                    | 값                                                                                                                                                                                                                                                                                                       | 출처                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| goBILDA 키트(메시 1761개, 삼각형 약 860만 개) 계산 시간 | 실측 약 0.5 s, 명세 한도 1 s                                                                                                                                                                                                                                                                             | `meshMass.test.ts` 시험 이름                      |
| 86만 삼각형 원기둥(원점에서 약 1 m, Float32 입력) 시간  | 약 60 ms(키트 크기로 0.6 s), 시험 상한 500 ms                                                                                                                                                                                                                                                            | `meshMass.test.ts`                                |
| 같은 원기둥의 상대 오차                                 | 부피·관성 대각 1e-6 아래, 무게중심 절댓값 1e-7 아래, closure 1e-6 아래                                                                                                                                                                                                                                   | `meshMass.test.ts` (Float32 좌표 반올림만 남는다) |
| 네이티브·WASM 질량 차                                   | 약 2e-6 상대                                                                                                                                                                                                                                                                                             | CLAUDE.md 3a 한계                                 |
| CAx-IF 기준 부피 허용                                   | io1-tu-203 0.2 %, as1-tu-203 파트마다 ±1 %·전체 ±0.05 %, sg1-c5-214 0.5 %, as1_pe_203 판 0.1 %, dm1-pe-214 L-BRACKET·BOLT·NUT 파트마다 ±1 %(시험 주석: 이 파일들의 실측 최악은 dm1-pe-214 볼트 −0.92 %, 원을 내접 다각형으로 바꾸므로 볼록한 둥근 파트는 작게·구멍 난 파트는 크게 나온다), 무게중심 1e-5 | `meshMass.test.ts`                                |

---

## 5. 닫힘 지표와 메시 상태 분류

### 5.1 닫힘 지표 closure

```
hx, hy, hz = (bounds.max − bounds.min) / 2            (경계 상자 반 크기)
R  = sqrt(hx² + hy² + hz²)                             (경계 상자 반 대각선, 피벗에서 상자 안 어디까지의 최대 거리)
c1 = |ΣndA| · R / (3·V)
V_k = sign · v_k / 6                                   (k = x, y, z: 축마다 부피 형식)
c2 = max_k |V_k − V| / V                               (축별 부피의 퍼짐)
closure = max(c1, c2)
```

- c1: 원점을 경계 상자 안에서 옮길 때 사면체 합 부피가 바뀌는 상한(o·ΣndA/3, \|o\| ≤ R)을 부피로 나눈 것이다. `types.ts`는 이것을 "경계 상자 반대각선"이라고 적었는데 코드가 쓰는 R은 반 대각선이다.
- c2: 양쪽 뚜껑이 빠진 관처럼 면적 벡터가 상쇄돼 c1이 0인 열린 메시도 잡는다(뚜껑 법선 축의 V_k만 다르다). `meshMass.ts` 주석은 이것을 "method.md §3.3의 ε_V"라고 인용한다(원문 사라짐, §21).
- 닫히면 c1 = c2 = 0이다.

### 5.2 분류

| 상태                    | 조건                                         | 질량                             |
| ----------------------- | -------------------------------------------- | -------------------------------- |
| `surface`(표면)         | `!(volume ≥ 1e-12)` 또는 `!(closure ≤ 0.02)` | 0(재질 추정에서 volume 0으로 침) |
| `open`(열린 메시, 근사) | `closure > 0.001`이고 위 표면 조건이 아님    | 부피를 그대로 씀                 |
| `closed`                | 그 밖                                        | 부피를 씀                        |

`massModel.ts`의 `usableVolume(props)` = `closure ≤ 0.02 && volume ≥ 1e-12`이면 volume, 아니면 0(열린 메시도 쓴다). 로봇의 CAD 요약(`cadMassSummary`)은 씬이 쓰는 메시만 세어 meshes(형상 등록), openMeshes, surfaceMeshes, pendingMeshes(그 CAD를 읽는 중이거나 읽을 차례를 기다리면 씬이 쓰는 그 CAD의 메시 수)와 `openVolumeFraction = Σ 열린 메시 부피 / Σ 질량에 쓰는(닫힘·열림) 메시 부피`를 낸다. 인스펙터는 이 비율을 퍼센트 소수 한 자리로 보인다.

### 5.3 시험이 고정한 사례

| 메시                                                          | closure                                             | 상태                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 윗뚜껑이 빠진 원기둥(r 0.02, h 0.1, 64각)                     | 0.4(= \|V/2 − 5V/6\| / (5V/6), c1은 약 0.23)        | surface. 피벗 기준 부피는 전체의 5/6                                                              |
| 옆면 조각 하나가 빠진 원기둥(1024각)                          | 0.001 초과 0.02 이하                                | open, 부피 오차 < closure                                                                         |
| 양쪽 뚜껑이 빠진 관(64각)                                     | 1.0(V_x = V_y = V, V_z = 0 → \|0 − 2V/3\| / (2V/3)) | surface. 부피는 전체의 2/3                                                                        |
| 정육면체에서 여섯 면의 삼각형 하나씩(맞은편끼리 상쇄)을 뺀 것 | 1e-12 아래                                          | closed로 보임. 부피 0.5. 한계: 구멍이 세 축 모두 대칭이면 두 지표가 모두 0이라 닫힌 것으로 보인다 |
| 면만 있는 판                                                  | Infinity                                            | surface, 무게중심은 피벗                                                                          |
| 1e-5 m 정육면체(부피 1e-15 m³)                                | Infinity(표면으로 처리)                             | surface                                                                                           |

---

## 6. 재질 밀도 표

`mass/materials.ts` `MATERIALS`(키 순서는 `MATERIAL_KEYS`). 주석의 머리 설명: "줄마다 단 제조사·공급사 데이터시트 값이다(범위가 있으면 함께 적는다)". 로봇 전체는 저울 무게로 맞추므로 결과를 좌우하는 것은 재질 사이의 비율이고 2–3 % 차이는 남지 않는다. STEP 안의 재질 정보는 쓰지 않는다(§17).

| 키              | 밀도(kg/m³) | 출력 재질 | 근거(코드 주석 그대로, 출처 기재)                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ----------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aluminum6061`  | 2700        | 아니오    | Protolabs 6061-T651 데이터시트 2.70 g/cm³ — https://www.protolabs.com/media/h54d0gnp/2026-026-cnc-material-data-sheet_aluminum-6061-t651_t6.pdf . 교차 검증: goBILDA 예제 STEP의 U-channel 5종(1120-0001-0048 … 1120-0015-0384)의 CAD 부피 × 2.70이 goBILDA 공시 무게와 0–1.4 % 안(예: https://www.gobilda.com/1120-series-u-channel-1-hole-48mm-length/ 35 g, `massModel.test.ts`) |
| `aluminum7075`  | 2810        | 아니오    | nTop 재료 문서(MatWeb 인용) 2.81 g/cc, MakeItFrom 2.80(범위 2.80–2.81) — https://docs.ntop.com/Product-Documentation/ntop/block-documentation/blocks/design-analysis/sample-materials/al-7075-t6.md                                                                                                                                                                                 |
| `steel`         | 7850        | 아니오    | 탄소강·합금강(축, 나사, 핀). Elgin 4140 7.85 g/cc(범위 7.83–7.87, 1018은 7.87) — https://www.mwcomponents.com/uploads/Resource-Center/Elgin-Material-Sheets/Alloy-Steel-Grade-4140-Fact-Sheet_Elgin-Website.pdf                                                                                                                                                                     |
| `stainless`     | 7900        | 아니오    | 304/304L 오스테나이트 일반값 7.90(범위 7.90–8.00, 8.0으로 적는 곳도 있다) — https://www.mechanics-industry.org/articles/meca/full_html/2020/06/mi200126/T1.html                                                                                                                                                                                                                     |
| `brass`         | 8500        | 아니오    | 황동 C360. Fictiv 0.307 lb/in³ = 8.50, Xometry 8.49(범위 8.47–8.53) — https://www.xometry.com/capabilities/cnc-machining-service/brass/                                                                                                                                                                                                                                             |
| `polycarbonate` | 1200        | 아니오    | SABIC LEXAN EXELL-D ISO 1183 1.20(범위 1.20–1.23) — https://amariplastics.com/media/import/AMARI_LEXAN-EXELL_D.pdf                                                                                                                                                                                                                                                                  |
| `acetal`        | 1410        | 아니오    | Delrin(POM-H). Sterling Plastics D792 1.41, Delrin 150 TDS 1.42(범위 1.41–1.42) — https://sterlingplasticsinc.com/product/delrin-150-homo-polymer/                                                                                                                                                                                                                                  |
| `hdpe`          | 955         | 아니오    | HDPE 판 ASTM D792: A&C Plastics 0.955(https://www.acplasticsinc.com/media/HDPE%20Typical Properties.pdf, 주소에 공백이 있고 2026-11에 404), Spartech 0.96(https://www.spartech.com/media/tds/HDPE.pdf). 범위 0.947–0.96                                                                                                                                                             |
| `nylon`         | 1140        | 아니오    | 나일론 PA6(케이블 타이 PA66 포함). Xometry Nylon 6 데이터시트 1.14(범위 1.10–1.14) — https://xometry.pro/wp-content/uploads/2023/12/Nylon-6.pdf                                                                                                                                                                                                                                     |
| `carbonFiber`   | 1480        | 아니오    | 탄소섬유 판(3K 능직, 에폭시). Rock West Composites 판 1.45 g/cm³, 섬유 비율에 따라 1.45–1.6(± 출처끼리 엇갈림) — https://www.rockwestcomposites.com/400-2mm-22.html . 1480이 출처 값 1.45와 다른 이유는 코드에 기록 없음(범위 1.45–1.6 안)                                                                                                                                          |
| `plywood`       | 680         | 아니오    | 자작 합판. Metsä Wood 성능 선언서 680 kg/m³(RH 65 %, 범위 0.64–0.74) — https://www.metsagroup.com/globalassets/metsa-wood/dop-documents/dop_metsa_wood_birch_plywood_muf_2019-12-2_en.pdf                                                                                                                                                                                           |
| `rubber`        | 1150        | 아니오    | 고무 배합물(바퀴 트레드, 롤러, 벨트 근사). 배합물 1.1–1.3, 순수 천연고무 0.93, 우레탄 1.02–1.14(± 엇갈림) — https://www.induflex.dk/media/5luly3w1/rubber-table.pdf                                                                                                                                                                                                                 |
| `foam`          | 100         | 아니오    | EVA 폼. Gumex EVA 판 85–90 kg/m³, 등급에 따라 30–200+ kg/m³ — https://racklify.com/encyclopedia/what-is-eva-foam-uses-grades-and-properties/ . 100이 85–90과 다른 이유는 코드에 기록 없음(범위 안)                                                                                                                                                                                  |
| `pla`           | 1240        | 예        | Prusament PLA TDS v1.1 ISO 1183 1.24 — https://www.matterhackers.com/r/xFvGl8                                                                                                                                                                                                                                                                                                       |
| `petg`          | 1270        | 예        | Prusament PETG TDS v1.1 ISO 1183 1.27 — https://www.3dprintergear.com.au/assets/files/technical-data-sheet%20(1).pdf , 판매처 사양 1.27 — https://botland.store/petg-filaments/26760-filament-prusa-refill-petg-175mm-1kg-signal-white.html                                                                                                                                         |
| `abs`           | 1040        | 예        | Tiertime ABS ISO 1183 1.04(범위 1.03–1.07) — https://cdn.robotshop.com/rbm/45fee604-4605-428c-a971-be4a96a14b16/2/24ee28b9-1431-4ffa-b7a4-0ae382ac9555/c8fcd696_technical-data-tiertime-abs-material.pdf                                                                                                                                                                            |
| `tpu`           | 1210        | 예        | TPU 95A. Bambu 1.20, Polymaker 1.20–1.24, Ultimaker 1.22(범위 1.20–1.25) — https://um-support-files.ultimaker.com/materials/2.85mm/tds/TPU-95A/TDS-TPU95A-V2.01-250915.pdf                                                                                                                                                                                                          |

표에서 데이터시트 범위가 넓은 재질: 폼 30–200+, 고무 0.93–1.3 g/cm³, 탄소섬유 1.45–1.6 g/cm³(assumptions: 근사). 다른 재질은 범위가 2–3 %다. 인스펙터는 재질 고르기를 "재료"(출력 재질이 아닌 것)와 "3D 출력"(`printed: true`) 두 묶음으로 나누며 순서는 `MATERIAL_KEYS` 그대로다(`MATERIAL_GROUPS`).

기본 재질은 `aluminum6061`(`DEFAULT_MATERIAL`)이다. 로봇의 `rigidbody.defaultMaterial`이 있으면 그것을 쓴다.

---

## 7. 출력 재질의 유효 밀도(껍질·채움률)

출력 재질(pla·petg·abs·tpu)의 파트는 껍질 + 채움이라 유효 밀도가 낮다.

```
f_shell = min(1, A · t / V)             (A: 메시 면적 m², V: 부피 m³, t = PRINTED_SHELL_THICKNESS)
f       = f_shell + (1 − f_shell) · infill
ρ_eff   = ρ · f                         (출력 재질만. 아니면 ρ 그대로, infill을 쓰지 않음)
```

V ≤ 0이거나 A ≤ 0이면 f_shell = 0(채움만). 채움률 infill은 `context.infill ?? DEFAULT_INFILL`이고 [0, 1]이며 재질처럼 위에서 아래로 상속한다(`settings.infill ?? parent.infill`). 가까운 상위 오브젝트가 다시 정하면 그것을 쓴다.

| 항목        | 값                      | 단위 | 위치                      | 상태·근거                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ----------------------- | ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 껍질 두께 t | 0.0011                  | m    | `PRINTED_SHELL_THICKNESS` | 벽 3개 × 선 폭 0.45 mm = 1.35 mm와 위·아래 단단한 층 0.8 mm(0.2 mm × 4)의 평균(계산값: (1.35 + 0.8)/2 = 1.075 mm를 1.1 mm로 적음). 출력 방향을 모르므로 평균한다. 벽 3은 FTC 문서의 일반 파트 "3 alternating 4 Walls"(https://ftc-docs.firstinspires.org/manufacturing/3d_printing/designing_and_slicing/slicing_settings/slicing_settings.html), 선 폭은 PrusaSlicer 0.4 노즐 기본 0.45 mm(https://forum.prusa3d.com/forum/prusaslicer/prusaslicer-problem-wall-perimeters/). 위·아래 0.8 mm는 "흔한 슬라이서 값이라 출처를 확인하지 못한 가정"(assumptions: 가정) |
| 기본 채움률 | 0.15                    | -    | `DEFAULT_INFILL`          | 출처 기록 없음                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 식의 근사   | 껍질 100 %, 안은 채움률 | -    | `printedFillFraction`     | 직육면체의 정확한 안쪽 상자 (a − 2t_벽)(b − 2t_벽)(c − 2t_위아래)와 견주면 덩어리 파트(20–80 mm)에서 ±0.02 안, 눕혀 출력한 얇은 판(5 mm 이하)은 0.1–0.15 무겁게 본다(100×50×5 판, 벽 3·채움 25 %: 정확 0.53, 근사 0.63). assumptions: 근사                                                                                                                                                                                                                                                                                                                          |

계산값 예(PLA 1240 kg/m³, 정육면체는 f_shell = 6t/a):

| 모양           | f_shell | f(infill 0.15) | ρ_eff(0.15)    | f(infill 0.25)      |
| -------------- | ------- | -------------- | -------------- | ------------------- |
| 20 mm 정육면체 | 0.33    | 0.4305         | 약 533.8 kg/m³ | 0.4975              |
| 50 mm 정육면체 | 0.132   | 0.2622         | 약 325.1       | 0.349               |
| 80 mm 정육면체 | 0.0825  | 0.2201         | 약 273.0       | 0.3119              |
| 100×50×5 mm 판 | 0.506   | 0.5801         | 약 719.3       | 0.6295(시험이 0.63) |

---

## 8. 질량 설정(`MassSettings`·`RigidbodySettings`)의 범위·정리·저장

### 8.1 자료형·범위

| 필드                        | 대상                         | 범위·의미                                                                          | 위치                 |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- | -------------------- |
| `mass.material`             | assembly·part·group·CAD 루트 | `MATERIAL_KEYS` 17개 가운데 하나. 이 오브젝트 하위로 상속, 하위가 다시 정하면 그것 | `MassSettings`       |
| `mass.infill`               | 같음                         | 0–1, 출력 재질에서만 씀(없으면 0.15)                                               | `sanitizeMass`       |
| `mass.mass`                 | 같음                         | kg, 0 < m ≤ 100. 이 오브젝트 하위 전체의 질량을 덮어씀                             | `MAX_OVERRIDE_MASS`  |
| `mass.centerOfMass`         | 같음                         | m, 오브젝트 로컬, 성분 \|x\| ≤ 10. 덮어쓴 질량(또는 COTS 덩어리)의 무게중심        | `MAX_CENTER_OF_MASS` |
| `rigidbody.weighedMass`     | robot                        | kg, 0 < m ≤ 200. 저울에 단 전체 무게                                               | `MAX_WEIGHED_MASS`   |
| `rigidbody.defaultMaterial` | robot                        | 없으면 `aluminum6061`                                                              | `RigidbodySettings`  |

`canHaveMass`는 `kind !== 'robot'`이고 `canHaveRigidbody`는 `kind === 'robot'`이다.

### 8.2 정리 규칙(`sanitizeMass`·`sanitizeRigidbody`)

- 모르는 재질 키, 범위 밖·유한하지 않은 수, 형식이 틀린 값은 그 필드만 버린다(바퀴와 달리 기본값으로 바꾸지 않는다: 비어 있으면 "추정"이라는 뜻이다).
- 빈 설정 `{}`은 질량 카드만 붙이고 아직 아무것도 정하지 않은 상태라 그대로 둔다.
- 키 순서는 늘 `material`, `infill`, `mass`, `centerOfMass`이다(저장한 파일이 바이트 단위로 같게 다시 써진다).
- `sanitizeRigidbody`는 정한 것이 없으면 `null`을 돌려주고 필드를 두지 않는다(Rigidbody 카드는 로봇이면 늘 보인다).

### 8.3 프로젝트 파일

`PROJECT_VERSION` 7에서 `SceneObject.mass`와 로봇 `rigidbody`가 들어왔다. `parseProject`는 `mass`·`rigidbody`가 객체가 아니면 파일 오류(`invalidData`)이고, `mass`를 로봇에 두거나 `rigidbody`를 로봇이 아닌 오브젝트에 두면 오류다. 객체 안의 틀린 값은 `sanitizeMass`·`sanitizeRigidbody`가 그 필드만 버린다(재질 목록이 줄거나 범위가 좁아져도 예전 파일이 열린다). 메시의 질량 성질 자체는 프로젝트 파일이 아니라 메시 캐시(`MESH_CACHE_TAG`, 질량 성질은 `model-v3`에서 들어왔고 지금 `model-v5`)에 있다. `isImportedModel`이 `isMeshMassProps`(volume ≥ 0 유한, area ≥ 0 유한, closure ≥ 0 숫자(Infinity 허용), centroid 3개·inertia 6개 모두 유한)로 캐시 값을 확인한다.

---

## 9. COTS(상용 부품) 질량 표

모터·서보·배터리·카메라는 CAD 부피 × 재질로 풀면 크게 틀리므로 제조사가 공개한 질량을 쓴다. 주석의 근거: 제조사 STEP을 occt-import-js로 읽어 잰 겉보기 밀도가 1.9–7.4 g/cm³로 4배 차이 났다. 단순화한 CAD라 모두 알루미늄으로 보면 goBILDA 5203은 161 g(실제 437 g), Limelight 3A는 48 g(실제 93 g)이 된다. 조사일은 2026-11-02(goBILDA·REV 페이지는 "Specs › Weight"). 출처를 찾지 못한 것(OTOS, 컬러·거리 센서, 웹캠, 허브 IMU)은 넣지 않는다(재질 추정으로 간다). 질량 표는 SDK 값이 아니라 시뮬레이터 값이라 생성 코드와 관계없다. 표는 모두 71개 항목이고(계산값: 직접 적은 23개 + goBILDA 모터 42개 + REV HD Hex 3개 + UltraPlanetary 3개), 시험이 모든 항목이 0 < 질량 < 1 kg이고 제품명이 비어 있지 않음을 확인한다.

항목은 `CotsEntry { mass(kg), product(고유 제품명, 번역하지 않음), ratio?(모터 감속비 N:1), cartridges?(UltraPlanetary 감속 카트리지 수) }`이다. 키는 질량 출처 표시(`ObjectMass.detail`)에 그대로 쓴다.

### 9.1 goBILDA Yellow Jacket 모터(감속비별, 단위 g)

칸마다 goBILDA 상품 페이지의 "Specs › Weight"다. 주소는 계열별 틀에 `<비>`(감속비의 점을 '-'로 바꾸고 '-1'을 붙인 것: 3-7-1, 19-2-1, 139-1)와 `<rpm>`을 넣은 것이다(goBILDA 상품 사이트맵 https://www.gobilda.com/xmlsitemap.php?type=products&page=1 …5 에 있다). SKU 끝 네 자리는 감속비 코드이고 상품 페이지의 SKU와 감속비를 맞춰 확인했다. 키는 `motor:<계열>:<감속비>`(계열: `goBilda5203`, `goBilda5204`, `goBilda5202`, `goBilda5202Plate`)이고 질량은 g × 0.001 kg이다.

| 감속비 | SKU 코드 | 무부하 출력축 RPM(주소 `<rpm>`) | 5203 (24 mm, 8 mm REX 축) | 5204 (80 mm, 8 mm REX 축) | 5202 (24 mm, 6 mm D 축) | 5202 판 (36 mm 기어박스 판) |
| ------ | -------- | ------------------------------- | ------------------------- | ------------------------- | ----------------------- | --------------------------- |
| 1      | 0001     | 6000                            | 391                       | 없음                      | 383                     | 없음                        |
| 3.7    | 0003     | 1620                            | 396                       | 411                       | 394                     | 387                         |
| 5.2    | 0005     | 1150                            | 399                       | 412                       | 398                     | 387                         |
| 13.7   | 0014     | 435                             | 438                       | 435                       | 435                     | 420                         |
| 19.2   | 0019     | 312                             | 437                       | 458                       | 435                     | 420                         |
| 26.9   | 0027     | 223                             | 437                       | 458                       | 435                     | 420                         |
| 50.9   | 0051     | 117                             | 481                       | 465                       | 479                     | 450                         |
| 71.2   | 0071     | 84                              | 486                       | 501                       | 484                     | 456                         |
| 99.5   | 0100     | 60                              | 486                       | 501                       | 486                     | 456                         |
| 139    | 0139     | 43                              | 485                       | 501                       | 483                     | 456                         |
| 188    | 0188     | 30                              | 524                       | 543                       | 522                     | 495                         |

계열별 비고(코드 주석):

| 계열                       | SKU 틀                            | 주소 틀                                                                                                                                              | 비고                                                                                                                                                                                                                                             |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5203                       | 5203-2402-*                       | https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-\<비\>-ratio-24mm-length-8mm-rex-shaft-\<rpm\>-rpm-3-3-5v-encoder/            | 3.7:1만 https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-3-7-1-ratio-1620-rpm-3-3-5v-encoder/ , 1:1은 https://www.gobilda.com/5203-series-yellow-jacket-motor-1-1-ratio-24mm-length-8mm-rex-shaft-6000-rpm-3-3-5v-encoder/ |
| 5204                       | 5204-8002-*                       | https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-\<비\>-ratio-80mm-length-8mm-rex-shaft-\<rpm\>-rpm-3-3-5v-encoder/            | 1:1은 없다. 99.5:1 페이지는 "Weight 501"로 단위가 빠져 g로 읽었다(옆 감속비가 501 g)                                                                                                                                                             |
| 5202(24 mm 6 mm D 축)      | 5202-2402-*, 1:1은 5202-0002-0001 | https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-\<비\>-ratio-24mm-length-6mm-d-shaft-\<rpm\>-rpm-36mm-gearbox-3-3-5v-encoder/ | 1:1은 https://www.gobilda.com/5202-series-yellow-jacket-motor-1-1-ratio-24mm-length-6mm-d-shaft-6000-rpm-3-3-5v-encoder/                                                                                                                         |
| 5202 판(36 mm 기어박스 판) | 5202-0002-*                       | https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-\<비\>-ratio-\<rpm\>-rpm-3-3-5v-encoder/                                      | 1:1은 24 mm 축 하나뿐이라 판 계열에는 없다                                                                                                                                                                                                       |

제품명(`product`): 5203 → "goBILDA 5203", 5204 → "goBILDA 5204", 5202와 5202 판 → "goBILDA 5202". 감속비는 `ratio` 칸에 `GOBILDA_RATIOS` = [1, 3.7, 5.2, 13.7, 19.2, 26.9, 50.9, 71.2, 99.5, 139, 188]이다.

### 9.2 REV 모터

| 키                          | 질량                         | 제품명                           | 근거(코드 주석)                                                                                                                  |
| --------------------------- | ---------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `motor:revHdHex:1`          | 234 g                        | REV HD Hex(ratio 1)              | 기어박스 없음(REV-41-1291). https://docs.revrobotics.com/duo-build/motion/motors/hd-hex-motor                                    |
| `motor:revHdHex:20`         | 350 g                        | REV HD Hex(ratio 20)             | 20:1 스퍼(REV-41-1298), 모터 포함                                                                                                |
| `motor:revHdHex:40`         | 350 g                        | REV HD Hex(ratio 40)             | 40:1 스퍼(REV-41-1301), 모터 포함. https://www.revrobotics.com/rev-41-1301/                                                      |
| `motor:revUltraPlanetary:1` | 369 g                        | REV UltraPlanetary(cartridges 1) | 아래 식                                                                                                                          |
| `motor:revUltraPlanetary:2` | 404 g                        | REV UltraPlanetary(cartridges 2) | 같음                                                                                                                             |
| `motor:revUltraPlanetary:3` | 439 g                        | REV UltraPlanetary(cartridges 3) | 같음                                                                                                                             |
| `motor:revCoreHex`          | 7 oz = 198.447 g(계산값)     | REV Core Hex                     | REV-41-1300 7 oz. https://www.revrobotics.com/rev-41-1300/ , https://docs.revrobotics.com/duo-build/motion/motors/core-hex-motor |
| `motor:neverest40`          | 0.767 lb = 347.905 g(계산값) | NeveRest Classic 40(ratio 40)    | AndyMark NeveRest Classic 40 "Weight: 0.767 lbs." https://www.andymark.com/products/neverest-classic-40-gearmotor                |

UltraPlanetary 식: 질량 = 모터 234 g + 장착판 33.5 g + 출력 카트리지 66.5 g + 감속 카트리지 수 n × 35 g(= 334 + 35n g). 감속 카트리지 35 g은 3:1 35.5 g, 4:1 34.0 g, 5:1 36.0 g의 가운데다. 출처: https://www.revrobotics.com/rev-41-1600/ , https://www.revrobotics.com/rev-41-1601/ , …/rev-41-1602/ , …/rev-41-1603/ . 코드 주석은 REV 문서의 조합 표(카트리지 1·2·3개: 371·405·441.5 g, https://docs.revrobotics.com/duo-build/motion/motors/hd-hex-motor)와 "2 g 안에서 맞는다"고 적었다. 다시 계산하면 차이는 2.0 g(369 대 371), 1.0 g(404 대 405), 2.5 g(439 대 441.5)다(계산값). 3개일 때는 2 g을 넘는다.

### 9.3 서보

| 키                             | 질량 | 제품명                              | 근거(코드 주석)                                                                                            |
| ------------------------------ | ---- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `servo:gobildaTorque`          | 60 g | goBILDA 2000 Torque                 | goBILDA 2000 Dual Mode 서보 Torque(25-2). https://www.gobilda.com/2000-series-dual-mode-servo-25-2-torque/ |
| `servo:gobildaSpeed`           | 58 g | goBILDA 2000 Speed                  | Speed(25-3). …-25-3-speed/                                                                                 |
| `servo:gobildaSuperSpeed`      | 58 g | goBILDA 2000 Super Speed            | Super Speed(25-4). …-25-4-super-speed/                                                                     |
| `servo:gobilda5TurnTorque`     | 64 g | goBILDA 2000 5-Turn Torque          | https://www.gobilda.com/2000-series-5-turn-dual-mode-servo-25-2-torque/                                    |
| `servo:gobilda5TurnSpeed`      | 60 g | goBILDA 2000 5-Turn Speed           | …-25-3-speed/                                                                                              |
| `servo:gobilda5TurnSuperSpeed` | 58 g | goBILDA 2000 5-Turn Super Speed     | …-25-4-super-speed/                                                                                        |
| `servo:axonMaxMk2`             | 78 g | Axon MAX MK2                        | goBILDA 판매 페이지. Axon 문서는 MAX 85 g이라 엇갈린다. https://www.gobilda.com/axon-max-servo-mk2/        |
| `servo:axonMiniMk2`            | 67 g | Axon MINI MK2                       | https://www.gobilda.com/axon-mini-servo-mk2/                                                               |
| `servo:axonMicro`              | 21 g | Axon MICRO+                         | 단종. https://docs.axon-robotics.com/archive/micro.md                                                      |
| `servo:revSrsV2`               | 62 g | REV Smart Robot Servo V2            | V2 Balanced. https://www.revrobotics.com/Smart-servo-v2                                                    |
| `servo:revSrsV2UltraSpeed`     | 60 g | REV Smart Robot Servo V2 UltraSpeed | 같은 페이지                                                                                                |

### 9.4 센서·전자부품·배터리·바퀴

| 키                   | 질량        | 제품명                          | 근거(코드 주석)                                                                                                                                                                    |
| -------------------- | ----------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pinpoint`           | 40 g        | goBILDA Pinpoint                | Pinpoint(v1·v2) 40 g, 선·장착 나사 포함. https://www.gobilda.com/pinpoint-odometry-computer-imu-sensor-fusion-for-2-wheel-odometry/                                                |
| `pod:fourBar`        | 84 g        | goBILDA 4-Bar Odometry Pod      | 4-Bar 포드 32 mm 84 g, 선·장착 나사 포함. https://www.gobilda.com/4-bar-odometry-pod-32mm-wheel/                                                                                   |
| `pod:swingarm`       | 121 g       | goBILDA Swingarm Odometry Pod   | Swingarm 포드 48 mm 121 g, 선·장착 나사 포함. https://www.gobilda.com/swingarm-odometry-pod-48mm-wheel/                                                                            |
| `limelight3a`        | 93 g        | Limelight 3A                    | 나사·케이블 포함. https://www.gobilda.com/limelight-3a-smart-camera/                                                                                                               |
| `battery:gobilda`    | 597 g       | goBILDA 12V NiMH 3000mAh        | 12V NiMH Nested Battery 3000 mAh. https://www.gobilda.com/12v-nimh-nested-battery-3000mah-mh-fc-xt30-connector/                                                                    |
| `battery:rev`        | 567 g       | REV 12V Slim Battery            | https://www.revrobotics.com/rev-31-1302/                                                                                                                                           |
| `hub:control`        | 209 g       | REV Control Hub                 | REV Control Hub·Expansion Hub 209 g(두 페이지가 크기까지 같아 복사일 수 있다, 저울 확인 권장). https://docs.revrobotics.com/duo-control/control-system-overview/control-hub-basics |
| `hub:expansion`      | 209 g       | REV Expansion Hub               | https://docs.revrobotics.com/duo-control/control-system-overview/expansion-hub-basics                                                                                              |
| `wheel:gripForce104` | 236 g(하나) | goBILDA GripForce Mecanum 104mm | GripForce 메카넘 104 mm 40A. https://www.gobilda.com/gripforce-mecanum-wheel-set-o104mm-40a-durometer-rollers/                                                                     |
| `wheel:mecanum96`    | 207 g(하나) | goBILDA Mecanum 96mm            | 메카넘 96 mm 70A. https://www.gobilda.com/96mm-mecanum-wheel-set-70a-durometer-bearing-supported-rollers/                                                                          |

### 9.5 표에 없는 것(재질 추정으로 간다)

- 모터 모델: goBILDA 5201, NeveRest 20·60, TETRIX, Matrix 12V, Studica Maverick, 모델 모름(`unspecified`).
- 컴포넌트 종류: OTOS, 컬러·거리 센서, 웹캠, IMU, 데드휠(별도 질량 없음).
- 바퀴: 메카넘 104·96 mm 외의 지름·종류(옴니·일반). 3c의 종류별 기본 바퀴 질량(`DEFAULT_WHEEL_MASS`: 옴니 96 mm 119 g, Hogback 트랙션 82 g — "제조사 상품 페이지, data §2.2–2.3")은 회전 관성 계산에만 쓰고 COTS 표에는 없다.
- REV Smart Robot Servo V1(REV-41-1097)의 질량은 찾지 못했다("지금 파는 V2 Balanced(62 g)로 본다").

---

## 10. COTS 키 고르기 규칙

### 10.1 하드웨어 컴포넌트 → 표 키(`componentCotsKey`)

| 컴포넌트 종류                            | 표 키                                                                    | 비고                  |
| ---------------------------------------- | ------------------------------------------------------------------------ | --------------------- |
| `motor`                                  | `motorCotsKey(props)` §10.2                                              | 표에 없는 모델은 null |
| `servo`·`crServo`                        | `SERVO_COTS_KEYS[servoModel]`, 없거나 모르는 값이면 기본 `gobildaTorque` | §10.3                 |
| `pinpoint`                               | `pinpoint`                                                               |                       |
| `limelight`                              | `limelight3a`                                                            |                       |
| 그 밖(otos·컬러·거리·웹캠·imu·데드휠 등) | null                                                                     | 시험이 확인           |

### 10.2 모터

모터 컴포넌트의 `motorModel`과 `gearbox`(실제 감속비, 0이면 모델 기본 = SDK 형식의 gearing, 유효 범위 [0.01, 10000])로 정한다. 감속비는 곱으로 쌓이므로 로그 거리로 잰다(`nearestRatio`: `|ln(표 감속비 / gearbox)|`가 가장 작은 것, 같으면 앞의 것).

| `motorModel`                                                                                           | SDK 기본 gearing | 표 키                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goBilda5202`(5202·5203·5204가 같은 구성 태그)                                                         | 99.5             | 5203 열의 가장 가까운 감속비: `motor:goBilda5203:<ratio>` (기본 99.5 → 486 g). 계열을 알 수 없어 "지금 goBILDA가 FTC에 파는 기본 계열인 5203 열"을 쓴다(5203 열은 11개 감속비가 모두 있어 후보가 11개이고, 5204·5202·판 열은 컴포넌트 키로 쓰지 않고 CAD의 SKU 이름으로만 닿는다, §10.5) |
| `revHdHex20`                                                                                           | 20               | `motor:revHdHex:<가장 가까운 {1, 20, 40}>`                                                                                                                                                                                                                                               |
| `revHdHex40`                                                                                           | 40               | 같음                                                                                                                                                                                                                                                                                     |
| `revUltraPlanetary`                                                                                    | 20               | `motor:revUltraPlanetary:<n>`, n은 아래                                                                                                                                                                                                                                                  |
| `revCoreHex`                                                                                           | 36.25            | `motor:revCoreHex`                                                                                                                                                                                                                                                                       |
| `neverest40`                                                                                           | 40               | `motor:neverest40`                                                                                                                                                                                                                                                                       |
| 그 밖(goBilda5201, neverest20, neverest60, tetrix, matrix12v, studicaMaverick, unspecified, 모르는 값) | -                | null                                                                                                                                                                                                                                                                                     |

UltraPlanetary 카트리지 수: `cartridges = 1, reach = 5.2823`에서 시작해 `cartridges < 3`이고 `gearbox > reach`인 동안 `cartridges++`, `reach *= 5.2823`. 곧 gearbox ≤ 5.2823이면 1개, ≤ 27.9027(= 5.2823², 계산값)이면 2개, 그 위는 3개다. SDK 기본 20:1은 2개(404 g)다. 시험: 5.23 → 1, 2.89 → 1, 27 → 2, 54.8 → 3, 500 → 3, `revHdHex20`에 gearbox 1 → 234 g.

코드 주석의 주장: "같은 감속비에서 계열 차이는 위 표에서 최대 38 g"(5203 열을 기준으로 삼는 이유). 표를 다시 계산하면 같은 감속비의 네 계열 사이 최대 차이는 188:1의 48 g(5204 543 g 대 5202 판 495 g)이고, 5203 열 대비 최대 차이는 50.9:1 5202 판의 31 g(450 대 481)이다. 38 g은 19.2:1·26.9:1의 네 계열 폭(458 − 420)과 같다. 주석의 값과 다르다(계산값, §19).

### 10.3 서보 모델 → 표 키

| `servoModel`(`src/shared/sim/actuatorData.ts`) | 표 키                                   |
| ---------------------------------------------- | --------------------------------------- |
| `gobildaTorque`(기본 `DEFAULT_SERVO_MODEL`)    | `servo:gobildaTorque`                   |
| `gobildaSpeed`                                 | `servo:gobildaSpeed`                    |
| `gobildaSuperSpeed`                            | `servo:gobildaSuperSpeed`               |
| `axonMax`                                      | `servo:axonMaxMk2`                      |
| `axonMini`                                     | `servo:axonMiniMk2`                     |
| `axonMicro`                                    | `servo:axonMicro`                       |
| `revSmartServo`                                | `servo:revSrsV2` (UltraSpeed는 SKU로만) |

5-Turn 서보(`servo:gobilda5Turn*`)와 `servo:revSrsV2UltraSpeed`는 `servoModel`에 없어 SKU 이름으로만 닿는다. 카탈로그의 모든 서보 모델이 표에 있음을 시험이 확인한다.

### 10.4 바퀴·Pinpoint 포드

- 바퀴 설정 `WheelSettings`(`kind`, `diameter`): `kind === 'mecanum'`이고 지름이 0.104 ± 0.0015 m면 `wheel:gripForce104`, 0.096 ± 0.0015 m면 `wheel:mecanum96`, 아니면 null(옴니·일반 바퀴도 null). 시험: 0.1055·0.1025 → 104 mm, 0.106 → null, 0.1 → null.
- Pinpoint 포드: Pinpoint 컴포넌트의 `xPod`·`yPod`가 가리키는 오브젝트. 키는 `podType === 'swingarm'`이면 `pod:swingarm`, 아니면 `pod:fourBar`(`undefined`도).

### 10.5 SKU 이름 → 표 키(`skuCotsKey`)

원래 CAD 이름(§12.3의 SKU 제품)에서 찾는다. goBILDA SKU 정규식 `(?<![0-9])([0-9]{4})-([0-9]{4})-([0-9]{4})(?![0-9]|-[0-9A-Za-z])`(전역): 숫자에 이어진 것과 SKU 뒤에 `-`와 글자·숫자가 이어지는 것(제품 안의 낱개 부품 이름 "3110-0001-0002-V1.0 main body v2", "3110-0001-0001-PSYCHO")은 SKU로 보지 않는다. 뒤에 공백·괄호·밑줄이 오거나 `-` 뒤에 글자가 없으면("3110-0001-0002 - pod") 그대로 SKU다. REV 정규식 `(?<![0-9A-Za-z])REV-[0-9]{2}-[0-9]{4}(?![0-9])`(대소문자 무시, 접미사를 견딤: "REV-41-3334_RevB_UNLINKED"). 이름 안에서 표 키가 있는 처음 맞는 것을 쓴다(goBILDA 맞음을 나온 순서로 먼저 보고, 맞아도 모터 규칙·SKU 표에 없으면 다음 맞음으로 넘어가며, 그다음 REV 맞음을 나온 순서로 본다. 모두 없으면 null). 한 맞음에서는 goBILDA 모터 규칙(`goBildaMotorKey`)을 SKU 표(`GOBILDA_SKUS`)보다 먼저 본다.

goBILDA 모터 SKU(`goBildaMotorKey(series, shaft, code)`): code가 `GOBILDA_RATIO_CODES`(0001, 0003, 0005, 0014, 0019, 0027, 0051, 0071, 0100, 0139, 0188)에 없으면 null. 시리즈 5203 → 5203 열, 5204 → 5204 열, 5202 → 축 코드가 `0002`이고 code가 `0001`이 아니면 판 열, 아니면 24 mm 열, 다른 시리즈 → null. 해당 칸이 없음(null)이면 null(예: 5204-8002-0001, 5203-2402-0099 → null).

| 패턴(전체 SKU)                     | 표 키                                                         | 근거                                                                                        |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `3100-0012-0020`                   | `battery:gobilda`                                             | 배터리                                                                                      |
| `3625-NNNN-0104`                   | `wheel:gripForce104`                                          | GripForce 104 mm: 세트 3625-0202-0104, 키트 STEP의 낱개 3625-0100-0104·3625-0001-0104(좌우) |
| `3606-NNNN-0096`                   | `wheel:mecanum96`                                             | 96 mm 메카넘: 세트 3213-3606-0002 STEP 안의 낱개 3606-0000-0096·3606-0100-0096(좌우)        |
| `3110-0002-0001`, `3110-0002-0002` | `pinpoint`                                                    | Pinpoint v1·v2                                                                              |
| `3110-0001-0001`                   | `pod:swingarm`                                                | Swingarm 포드                                                                               |
| `3110-0001-0002`                   | `pod:fourBar`                                                 | 4-Bar 포드                                                                                  |
| `3122-0002-0001`                   | `limelight3a`                                                 | Limelight 3A(goBILDA SKU)                                                                   |
| `2000-0025-0002` / `0003` / `0004` | `servo:gobildaTorque` / `Speed` / `SuperSpeed`                | 2000 Dual Mode                                                                              |
| `2000-0025-0502` / `0503` / `0504` | `servo:gobilda5TurnTorque` / `5TurnSpeed` / `5TurnSuperSpeed` | 5-Turn                                                                                      |
| `2004-0025-0001`                   | `servo:axonMiniMk2`                                           | Axon MINI MK2                                                                               |
| `2004-0025-0002`                   | `servo:axonMaxMk2`                                            | Axon MAX MK2                                                                                |

주석: "SKU → 표 키. 상품 페이지에서 SKU를 확인한 것만 둔다."

| REV 부품 번호 | 표 키                      |
| ------------- | -------------------------- |
| `REV-41-1300` | `motor:revCoreHex`         |
| `REV-41-1291` | `motor:revHdHex:1`         |
| `REV-41-1298` | `motor:revHdHex:20`        |
| `REV-41-1301` | `motor:revHdHex:40`        |
| `REV-41-3334` | `servo:revSrsV2`           |
| `REV-41-3336` | `servo:revSrsV2UltraSpeed` |
| `REV-31-1302` | `battery:rev`              |
| `REV-31-1595` | `hub:control`              |
| `REV-31-1153` | `hub:expansion`            |

---

## 11. 이름 규칙(`nameRules.ts`)

CAD 이름으로 재질을 고르는 규칙이다. 이름은 메시의 원래 이름 경로(불러올 때의 CAD 노드 이름, 파트부터 CAD 루트 쪽으로)이고 가까운 이름부터 본다. 지금 오브젝트 이름과 사용자가 만든 그룹 이름은 보지 않으므로 이름을 바꾸거나 `IntakeRoller` 그룹으로 옮겨도 재질이 바뀌지 않는다. STEP 안의 재질 정보는 쓰지 않는다(Fusion 기본값 "Steel, Mild"가 바퀴 고무에도 남아 있어 믿을 수 없다). 맞은 낱말열이나 `gobilda-<시리즈>`가 출처 표시(`ObjectMass.detail`)가 된다.

### 11.1 이름 처리

1. `nameWords(name)`: goBILDA SKU(`(?<![0-9])([0-9]{4})-[0-9]{4}-[0-9]{4}(?![0-9])`)를 먼저 공백으로 지운다(SKU 자리의 6061·7075가 재질로 읽히지 않게). camelCase를 끊고(`([a-z])([A-Z])` → 공백) 소문자로 바꾸고 글자·숫자가 아닌 것(`[^a-z0-9]+`)으로 나눈다. 예: `RollerTire` → `['roller', 'tire']`, `2106-6061-7075 shaft` → `['shaft']`.
2. 낱말마다 `baseForms`: 낱말 자신, 끝이 `s`면 `s`를 뗀 것, 끝이 `es`면 `es`를 뗀 것(복수형). 낱말 경계로만 맞으므로 Spinner의 pin, Gearbox의 gear, plate의 pla는 잡지 않는다.
3. 낱말열 규칙은 공백으로 나눈 낱말들이 이름 안에 이어서 나올 때 맞는다(`phraseAt`).

코드 주석이 적은 goBILDA 예제 STEP의 이름 통계: PRODUCT 이름 374개 가운데 221개가 SKU뿐이고 낱말이 없다(`nameRules.ts`, 그래서 SKU 시리즈 규칙이 있다). 같은 STEP의 PRODUCT 이름 374개 가운데 고유한 것은 144개라 이름 규칙·SKU 찾기는 한 계산 안에서 이름마다 한 번만 한다(`massModel.ts` `nameCaches`·`memo`).

### 11.2 맞추는 순서(`matchNameRule`)

1. 재질 이름 무리(`MATERIAL_RULES`): 이름의 어디에 있든 먼저. 낱말열을 규칙 순서(위에서)대로 보아 처음 맞는 규칙. 맞은 규칙에서 출처 표시의 낱말열은 그 규칙의 `phrases` 배열 순서로 처음 맞는 것(`first ?? phrase`).
2. 부품 종류 무리(`PART_RULES`): 이름 하나에서 중심 명사에서 끝나는 낱말열만(`partRule`). 중심 명사(`headIndex`) = 이름 끝에서 앞으로 가며 길이가 2 이상이고 숫자가 없고 `TRAILING_MODIFIERS`에 없는 가장 오른쪽 낱말의 자리. 같은 자리에서 끝나는 낱말열이 여럿이면 긴 것, 길이가 같으면 규칙 순서가 위인 것. 이름이 여럿이면 이름 순서로 처음 맞는 이름. 수식어는 정하지 않는다("Nut Strip"·"Chain Guard"·"Roller Arm"은 규칙 없음, "Bearing Plate"는 판, "Shaft Collar"는 칼라, "Belt Pulley"는 풀리).
3. goBILDA SKU 시리즈(`seriesRule`): 이름 순서로, 이름 안의 나온 순서로 처음 `GOBILDA_SERIES`에 있는 시리즈. 이름은 `gobilda-<시리즈>`.
4. 모두 아니면 null.

`TRAILING_MODIFIERS`(이름 끝에 붙어도 중심 명사가 아닌 낱말): `mm`, `cm`, `in`, `od`, `id`, `rev`, `ver`, `copy`, `mirror`, `mirrored`, `left`, `right`, `front`, `back`, `rear`, `top`, `bottom`, `upper`, `lower`, `inner`, `outer`, `side`. 한 글자 낱말(Plate A)과 숫자가 든 낱말(8mm, v2, m4x10)도 건너뛴다.

`matchAncestorRule(name)`(상위 노드: 어셈블리·CAD 루트): 재질 이름 무리 → goBILDA SKU 시리즈만. 부품 종류 낱말은 그 노드 아래 솔리드의 종류가 아니므로 보지 않는다("Roller Intake" 어셈블리의 판은 롤러가 아니고, "Chain Lift"의 판은 체인이 아니다).

`nameRuleMaterial(ruleName)`: 규칙 이름 → 재질. `gobilda-`로 시작하면 시리즈 표, 아니면 `WORD_RULES`에서 그 낱말열을 가진 규칙의 재질. 모르면 `undefined`, 질량 0 규칙이면 `null`. 낱말열은 규칙 사이에 겹치지 않아야 한다(출처 표시의 낱말열로 재질을 다시 찾으므로, 시험이 확인).

### 11.3 낱말을 넣는 원칙(주석)

- 키트 이름에 OR·IR·OD·ID 같은 치수 약어가 나오므로 오인하기 쉬운 3글자 이하 낱말(ss, pc, or, id, cf, ply, alu, pom, eva)은 넣지 않는다. 재질 키와 같은 pla·abs·tpu와 하드웨어 이름 pin·nut만 짧은 낱말로 둔다.
- 출처 없이 가정할 일반 낱말(mount·block·hub)은 넣지 않는다(로봇 기본 재질을 이기면 출력물 "Camera Mount"가 알루미늄이 된다).
- 질량 0 규칙(`label`·`sticker`·`decal`)은 goBILDA 예제 STEP의 Top Label·Side Label·Labels가 장식 솔리드(실제로는 스티커)라서 있다. 자리와 관계없이 질량 0이다.

### 11.4 재질 이름 무리(`MATERIAL_RULES`, 위에서 첫 맞는 것)

| 순서 | 재질            | 낱말열                                          | 비고(코드 주석)                                                                                           |
| ---- | --------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1    | `stainless`     | stainless                                       |                                                                                                           |
| 2    | `brass`         | brass                                           |                                                                                                           |
| 3    | `steel`         | steel                                           | goBILDA 2303·2320·2920 이름에 "Steel". carbon steel이 탄소섬유가 되지 않게 carbon보다 먼저                |
| 4    | `aluminum7075`  | 7075                                            |                                                                                                           |
| 5    | `aluminum6061`  | aluminum, aluminium, 6061, 6063                 | goBILDA 2302·2910·3310 이름에 "Aluminum". 6063(REV 압출재 2.69)은 6061과 0.4 % 차이라 묶는다              |
| 6    | `acetal`        | acetal, delrin                                  | goBILDA 3413, ServoCity #25 스프로킷                                                                      |
| 7    | `polycarbonate` | polycarbonate, polycarb, lexan                  |                                                                                                           |
| 8    | `hdpe`          | hdpe, uhmw                                      | UHMW(0.93)는 HDPE(0.955)와 3 % 차이라 묶는다                                                              |
| 9    | `nylon`         | nylon                                           |                                                                                                           |
| 10   | `carbonFiber`   | carbon fiber, carbon fibre, carbonfiber, carbon |                                                                                                           |
| 11   | `plywood`       | plywood, birch                                  |                                                                                                           |
| 12   | `foam`          | foam                                            |                                                                                                           |
| 13   | `rubber`        | rubber, neoprene, urethane                      |                                                                                                           |
| 14   | `pla`           | pla                                             |                                                                                                           |
| 15   | `petg`          | petg                                            |                                                                                                           |
| 16   | `abs`           | abs                                             |                                                                                                           |
| 17   | `tpu`           | tpu                                             |                                                                                                           |
| 18   | `acetal`        | plastic chain                                   | 플라스틱 체인 링크(goBILDA 3309, 아세탈로 가정)는 plastic보다 먼저                                        |
| 19   | `polycarbonate` | plastic                                         | 일반 플라스틱 1.20(PC·나일론·아세탈 1.14–1.42의 가운데). goBILDA 1500 Plastic Spacer, 3402 Plastic Pulley |
| 20   | 질량 0(`null`)  | label, sticker, decal                           | 장식 솔리드                                                                                               |

### 11.5 부품 종류 무리(`PART_RULES`, 중심 명사에서 끝날 때만)

| 순서 | 재질            | 낱말열                                                  | 근거(코드 주석)                                                                                                                                                                                       |
| ---- | --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `steel`         | set screw collar, set screw clamp                       | goBILDA 2920 세트 스크루 칼라(아연 도금 강철, 6 mm 7.1 g). collar(알루미늄)·screw보다 긴 낱말열. https://core-electronics.com.au/2920-series-steel-set-screw-collar-6mm-bore-2-pack.html              |
| 2    | `steel`         | screw, bolt, shcs, bhcs, fhcs, rivet                    | goBILDA 2800 아연 도금 강철 나사, 2801·2809·2810 와셔, 2816 hook-nut                                                                                                                                  |
| 3    | `steel`         | pin, dowel, e clip, circlip, snap ring                  |                                                                                                                                                                                                       |
| 4    | `steel`         | nut, nylock                                             |                                                                                                                                                                                                       |
| 5    | `steel`         | washer                                                  |                                                                                                                                                                                                       |
| 6    | `stainless`     | threaded plate                                          | goBILDA 2803 스테인리스 나사산 판                                                                                                                                                                     |
| 7    | `steel`         | bearing                                                 | goBILDA 1611·1601 고탄소강 플랜지 볼 베어링                                                                                                                                                           |
| 8    | `aluminum6061`  | servo shaft                                             | goBILDA 8 mm REX Servo Shaft는 알루미늄이라 shaft보다 먼저. https://ca.robotshop.com/products/8mm-rex-servo-shaft-25-tooth-spline-36mm-length                                                         |
| 9    | `steel`         | shaft, axle                                             |                                                                                                                                                                                                       |
| 10   | `aluminum6061`  | collar                                                  | goBILDA 2910 클램핑 칼라(세트 스크루 칼라 2920은 위 set screw collar). https://core-electronics.com.au/2910-series-aluminum-clamping-collar-12mm-id-x-26mm-od-9mm-length.html                         |
| 11   | `steel`         | pinion, miter, worm, pinion gear, miter gear, worm gear | goBILDA 2303 피니언, 2320 마이터 기어. "Pinion Gear"처럼 gear가 뒤에 와도 강철이게 낱말열을 둔다. worm gear는 강철로 가정                                                                             |
| 12   | `aluminum6061`  | gear, sprocket                                          | goBILDA 2302 허브 마운트 기어, 3310 스프로킷                                                                                                                                                          |
| 13   | `steel`         | chain, master link                                      | goBILDA 8 mm 피치 강철 체인. https://uk.robotshop.com/products/gobilda-1m-8mm-pitch-steel-chain                                                                                                       |
| 14   | `rubber`        | belt, tire, tyre, tread, roller, o ring                 | goBILDA 3412 HTD 벨트(네오프렌 1.23 + 유리섬유 심, 고무 1.15로 근사), 바퀴 트레드·롤러                                                                                                                |
| 15   | `acetal`        | idler                                                   | goBILDA 3413 아세탈 아이들러                                                                                                                                                                          |
| 16   | `aluminum6061`  | pulley                                                  | goBILDA 3401 풀리(알루미늄으로 가정, 플라스틱 3402는 이름의 Plastic이 정한다). https://core-electronics.com.au/3402-series-3mm-htd-pitch-plastic-hub-mount-timing-belt-pulley-14mm-bore-36-tooth.html |
| 17   | `aluminum6061`  | spacer, standoff                                        | goBILDA 1501 스탠드오프, 1502·1505·1514 스페이서                                                                                                                                                      |
| 18   | `polycarbonate` | control hub, expansion hub                              | REV Control Hub·Expansion Hub(플라스틱 케이스로 가정). 데이터시트 질량 209 g은 REV SKU가 정한다                                                                                                       |
| 19   | `aluminum6061`  | channel, extrusion, tube, bracket, plate                | goBILDA 1120 U-channel, REV 15 mm 압출재, Studica 채널, 1201–1222 패턴 판·브래킷(알루미늄으로 가정, `materials.md §4.4` 인용 — 원문 사라짐, §21)                                                      |
| 20   | `nylon`         | zip tie, cable tie                                      | goBILDA 2909 케이블 타이(나일론 PA66)                                                                                                                                                                 |

### 11.6 goBILDA SKU 시리즈 → 재질(`GOBILDA_SERIES`, 52개)

줄마다 그 시리즈 상품 페이지(재질이 이름이나 사양 표에 있음)를 단다. 확인하지 못한 시리즈는 "가정"이라고 적었다. 3625(GripForce 메카넘)·3606(메카넘)·3100(배터리)·2000·2004(서보)·3110(Pinpoint·포드)·3122(Limelight)·5202–5204(모터)는 재질이 아니라 COTS 질량이다. 맞는 SKU가 COTS 표에 없으면 여기에도 없으므로 기본 재질이다.

| 재질            | 시리즈                                   | 상태·근거(코드 주석)                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aluminum6061`  | 1120                                     | U-Channel(알루미늄 clear anodized, 사양 표). https://core-electronics.com.au/1120-series-u-channel-21-hole-528mm-length.html                                                                                                                                                                                                                                           |
| `aluminum6061`  | 1121                                     | Low-Side U-Channel(1120과 같은 목록). https://www.gobilda.com/1120-series-u-channel                                                                                                                                                                                                                                                                                    |
| `aluminum6061`  | 1143, 1201, 1205, 1208, 1209, 1222       | 패턴 판·브래킷·마운트. 가정: 시리즈별 재질은 확인 못 함. 상품 예 https://core-electronics.com.au/1208-series-surface-mount-1-1.html                                                                                                                                                                                                                                    |
| `aluminum6061`  | 1309, 1310                               | Sonic Hub·Hyper Hub. 가정. https://core-electronics.com.au/1310-series-hyper-hub-12mm-bore.html                                                                                                                                                                                                                                                                        |
| `polycarbonate` | 1500                                     | Plastic Spacer(일반 플라스틱 1.20). https://core-electronics.com.au/1500-series-plastic-spacer-25mm-id-x-27mm-od-1mm-thickness-12-pack.html                                                                                                                                                                                                                            |
| `aluminum6061`  | 1501                                     | M4 알루미늄 스탠드오프. https://robotshop.com/products/gobilda-1501-series-m4-x-07mm-aluminum-standoff-16mm-length-6mm-od-4x                                                                                                                                                                                                                                           |
| `aluminum6061`  | 1502, 1505, 1512, 1514                   | 스페이서(알루미늄). https://core-electronics.com.au/1502-series-4mm-id-spacer-5mm-od-10mm-length-4-pack.html , https://www.gobilda.com/1505-series-32mm-od-counterbored-pattern-spacer-16mm-length/ , https://core-electronics.com.au/1514-series-8mm-id-spacer-10mm-od-12mm-length-4-pack.html                                                                        |
| `aluminum6061`  | 1516, 1522                               | REX 스페이서(1514를 잇는 시리즈라 알루미늄으로 가정). https://core-electronics.com.au/1514-series-8mm-id-spacer-10mm-od-8mm-length-4-pack.html                                                                                                                                                                                                                         |
| `steel`         | 1521                                     | 6 mm ID 스페이서(사양 표는 강철, 판매처 본문과 엇갈림). https://core-electronics.com.au/1521-series-6mm-id-spacer-8mm-od-2mm-length-4-pack.html                                                                                                                                                                                                                        |
| `steel`         | 1600, 1601, 1611                         | 플랜지 볼 베어링(고탄소강). https://core-electronics.com.au/1611-series-flanged-ball-bearing-8mm-id-x-14mm-od-5mm-thickness-2-pack.html , https://core-electronics.com.au/gobilda-6mm-id-flanged-ball-bearing-12mm-od-4mm-thickness-pack-of-2.html                                                                                                                     |
| `stainless`     | 2100, 2106                               | 스테인리스 REX 축. https://core-electronics.com.au/2106-series-stainless-steel-rex-shaft-8mm-diameter-48mm-length.html                                                                                                                                                                                                                                                 |
| `aluminum6061`  | 2302                                     | 허브 마운트 기어(알루미늄). https://core-electronics.com.au/2302-series-aluminum-mod-08-hub-mount-gear-14mm-bore-60-tooth.html                                                                                                                                                                                                                                         |
| `steel`         | 2303                                     | 피니언(강철). https://www.gobilda.com/2303-series-steel-mod-0-8-pinion-gear-8mm-rex-bore-36-tooth                                                                                                                                                                                                                                                                      |
| `steel`         | 2320                                     | 클램핑 마이터 기어(강철). https://core-electronics.com.au/clamping-steel-miter-gear-6mm-d-bore-24-tooth-mod-1-gobilda.html                                                                                                                                                                                                                                             |
| `steel`         | 2800, 2801, 2804, 2816                   | 28xx 체결 부품(아연 도금 강철). 2800·2804 나사 https://core-electronics.com.au/2800-series-zinc-plated-steel-socket-head-screw-m4-x-07mm-10mm-length-25-pack.html , 2801 와셔 https://core-electronics.com.au/2801-series-zinc-plated-steel-washer-4mm-id-x-8mm-od-25-pack.html , 2816 hook-nut https://core-electronics.com.au/hook-nut-m4-x-07mm-thread-25-pack.html |
| `steel`         | 2806, 2807, 2809, 2810, 2812, 2822, 2824 | "같은 시리즈라 강철로 가정"(assumptions: 가정)                                                                                                                                                                                                                                                                                                                         |
| `stainless`     | 2803                                     | 나사산 판(스테인리스). https://core-electronics.com.au/2803-series-stainless-steel-threaded-plate-7-7-24-pack.html                                                                                                                                                                                                                                                     |
| `nylon`         | 2909                                     | 케이블 타이. 시리즈는 키트 목록 https://core-electronics.com.au/ftc-starter-kit-2023-2024-season.html , 재질은 일반 케이블 타이의 나일론 PA66으로 가정                                                                                                                                                                                                                 |
| `aluminum6061`  | 2910                                     | 클램핑 칼라(알루미늄). https://core-electronics.com.au/2910-series-aluminum-clamping-collar-12mm-id-x-26mm-od-9mm-length.html                                                                                                                                                                                                                                          |
| `steel`         | 2920                                     | 세트 스크루 칼라(아연 도금 강철). https://core-electronics.com.au/2920-series-steel-set-screw-collar-6mm-bore-2-pack.html                                                                                                                                                                                                                                              |
| `aluminum6061`  | 3217                                     | ServoBlock(알루미늄으로 가정). https://gobilda.com/gobilda-servo-starter-pack                                                                                                                                                                                                                                                                                          |
| `acetal`        | 3309                                     | 8 mm 플라스틱 체인 링크(재질 미확인, 아세탈로 가정). https://www.gobilda.com/sitemap/categories                                                                                                                                                                                                                                                                        |
| `aluminum6061`  | 3310                                     | 8 mm 피치 스프로킷(알루미늄). https://core-electronics.com.au/3310-series-8mm-pitch-aluminum-hub-mount-sprocket-14mm-bore-42-tooth.html                                                                                                                                                                                                                                |
| `polycarbonate` | 3402                                     | 플라스틱 벨트 풀리. https://core-electronics.com.au/3402-series-3mm-htd-pitch-plastic-hub-mount-timing-belt-pulley-14mm-bore-36-tooth.html                                                                                                                                                                                                                             |
| `rubber`        | 3403, 3412                               | HTD 타이밍 벨트(네오프렌 + 유리섬유 심, 고무로 근사). https://core-electronics.com.au/3412-series-5mm-htd-pitch-timing-belt-9mm-width-840mm-pitch-length-168-tooth.html                                                                                                                                                                                                |
| `acetal`        | 3413                                     | 아세탈 벨트 아이들러. https://core-electronics.com.au/acetal-timing-belt-idler-6mm-id-x-12mm-od-12mm-width-1-1-2-pack.html                                                                                                                                                                                                                                             |
| `rubber`        | 3613, 3618, 3626                         | 3613(Gecko·48 mm 바퀴)·3626(96 mm 50A 바퀴)·3618(16 mm 롤러): goBILDA 검색 https://www.gobilda.com/search.php?search_query=\<SKU\>로 종류를 확인했다. COTS 질량을 찾지 못해 고무로 근사한다(알루미늄으로 보면 2.70 / 1.15 ≈ 2.3배 무겁다)                                                                                                                              |

(위 합계 52개: 1120, 1121, 1143·1201·1205·1208·1209·1222(6), 1309·1310(2), 1500, 1501, 1502·1505·1512·1514(4), 1516·1522(2), 1521, 1600·1601·1611(3), 2100·2106(2), 2302, 2303, 2320, 2800·2801·2804·2816(4), 2806·2807·2809·2810·2812·2822·2824(7), 2803, 2909, 2910, 2920, 3217, 3309, 3310, 3402, 3403·3412(2), 3413, 3613·3618·3626(3).)

---

## 12. 추정 알고리즘(`computeMassModel`)

`computeMassModel(objects, lookup): MassModel`. `lookup: MassLookup = { props(geometryId) → MeshMassProps | undefined, sourcePath(geometryId) → SourceNode[] | undefined }`(앱은 `geometryRegistry`, 시험은 인자로 바꿈). 결과는 `{ objects: Record<id, ObjectMass>, robots: Record<robotId, RobotMass>, own: Record<id, OwnMass> }`이다.

### 12.1 파트 질량의 출처 우선순위

위가 먼저다.

1. **덮어쓰기**(`mass.mass`): 그 오브젝트 하위 전체가 한 덩어리다. 하위 형상의 부피 비율로 나누고, 형상이 없으면 점질량(오브젝트 원점)이다. 덮어쓰기 안의 덮어쓰기는 안쪽 값을 고정하고 남은 질량을 나머지에 나눈다. 안쪽 합이 바깥 값보다 크면 안쪽 값을 그대로 쓰고(바깥 하위 합계가 바깥 값보다 커진다) `innerMassExceeds`로 알린다.
2. **COTS**(§9): 하드웨어 컴포넌트·바퀴·Pinpoint 포드는 붙은 오브젝트(지금 계층) 하위 전체를 덮고 나누는 방법은 1과 같다. 덩어리(덮어쓰기·COTS) 안의 COTS는 쓰지 않는다(두 번 세지 않게 위의 것을 쓴다). 그 하위를 그 부품 하나로 볼 수 없으면 쓰지 않고 `cotsIgnored`로 알린다(§12.4).
3. **SKU 제품**(§12.3): 원래 이름 경로에서 가장 바깥의 SKU 노드가 제품이고 제품 데이터시트 질량을 그 메시들에 부피 비율로 나눈다.
4. **재질 × 부피**: 위로 가장 가까운 `mass.material`(지금 계층), 없으면 이름 규칙(§11), 없으면 로봇 기본 재질(`rigidbody.defaultMaterial ?? aluminum6061`).

이름 규칙 풀이(`estimate`): 명시 재질(`context.material`)이 있으면 그것(`source: 'material'`)이 이름 규칙보다 먼저다. 없으면 원래 이름 경로를 파트 노드부터 CAD 루트 쪽으로 가며(붙인 "노드 + 순번" 이름(`generated`)은 건너뜀) 파트 노드 자신은 `matchNameRule([name])`(재질 이름 → 부품 종류 → 시리즈), 상위 노드는 `matchAncestorRule`(재질 이름 → 시리즈)로 처음 맞는 규칙을 쓴다(`source: 'nameRule'`, 질량 0 규칙이면 mass 0). 규칙이 없으면 기본 재질(`source: 'default'`). 상속 출처 오브젝트(`inheritedFrom`)는 상위 노드의 규칙이면 `nodeHomes`가 정한 그 노드의 대표 오브젝트다.

출력 재질 파트: `mass = effectiveDensity(material, V, A, infill ?? 0.15) × V`(§7). 일반 재질: `mass = ρ × V`. 모든 `volume`은 `usableVolume`이다(표면이면 0이라 추정 파트가 되지 않고 질량 0).

### 12.2 덩어리(`Block`)와 풀기(`resolveBlock`)

문서 순서(위에서 아래로)로 오브젝트를 방문하며 `Context { robot, matrix, material, infill, block }`을 내려준다. 로봇이 아닌 오브젝트마다:

- `mass.mass`가 있으면 `override` 덩어리(바깥 덩어리 안에서도 만든다, 부모 = 바깥 덩어리).
- 아니고 아직 덩어리 안이 아니면(`context.block === null`) 붙은 COTS 키들(`ownCotsKeys`: 컴포넌트마다 `componentCotsKey`, Pinpoint 포드 키, 바퀴 키를 모두)이 있고 `cotsRejection`이 null이면 `cots` 덩어리(질량 = Σ 키의 표 질량, `detail` = 키를 `+`로 이음). 거절되면 알림만.
- 덩어리를 정하지 않은 오브젝트의 `mass.centerOfMass`는 쓰이지 않으므로 `centerOfMassIgnored` 알림(SKU 제품의 주인이면 제품 덩어리가 쓴다).

메시 파트는 `lookup.props`가 있으면 `Part { com = M·centroid, unitInertia = R·I·Rᵀ(volume > 0일 때), volume = usableVolume }`을 만들고, 덩어리 안이면 그 덩어리의 member, SKU 제품이면 제품의 free 파트, 아니면(volume > 0) 재질로 추정한다. 형상 정보가 없는 메시(읽는 중·못 읽음)는 `unloaded`에 모은다.

풀기(안쪽 덩어리부터, 만든 순서의 반대):

```
inner   = Σ children.resolvedMass
rest    = max(0, block.mass − inner)
total   = inner + rest
exceeded = (inner > block.mass) → exceededBy = inner
ΣV      = Σ members.volume
member i 질량 = rest · V_i / ΣV            (rest > 0 이고 ΣV > 0 일 때. 아니면 0)
점질량  : rest > 0 이고 ΣV = 0 이면 mass rest 점을 block.origin(정한 오브젝트 원점)에 둠(volume 0, 자체 관성 0)
```

무게중심 덮어쓰기(`block.centerOfMass`, 로봇 좌표): `rest > 0`이면 자기 몫(own members + 점질량)을 같은 변위로 옮긴다.

```
delta = (total · target − innerMoment − restMoment) / rest       (innerMoment = Σ child.resolvedMass · child.resolvedCom)
own parts의 com += delta       (관성의 모양은 형상 그대로 옮김)
resolvedCom = (innerMoment + restMoment) / total      (total = 0이면 block.origin)
```

안쪽이 질량을 다 써서 `rest === 0`이면 옮길 몫이 없어 `centerOfMassIgnored`(안쪽 값이 먼저라 안쪽을 옮기지 않는다).

### 12.3 SKU 제품과 원래 노드의 주인(`sourceIndex`·`nodeHomes`)

- 메시 오브젝트(로봇·그룹 제외)마다 `lookup.sourcePath(geometryId)`의 노드 경로를 본다. 경로의 바깥(CAD 루트)부터 안쪽으로 훑으며, 붙인 이름(`generated`)이거나 이름 규칙이 질량 0(라벨)이면 그 노드의 SKU는 쓰지 않고(모터 STEP 안의 "5203-2402-0019 Label" 같은 장식 솔리드가 모터 질량을 받지 않게), 처음 `skuCotsKey(node.name)`가 있는 노드가 그 메시의 제품이다(가장 바깥).
- 제품 질량은 제품 노드를 경로에 가진 메시들에 부피 비율로 나눈다(지금 계층의 어디로 옮겼든, 노드 이름을 바꿨든).
- 제품의 일부가 1·2의 덩어리 안에 있으면: 같은 부품(`sameCotsItem`: 키가 같거나 둘 다 `motor:`이거나 둘 다 `servo:`)의 컴포넌트 COTS 덩어리면 나머지 메시도 그 덩어리에 넣고, 아니면 덩어리 안 몫을 뺀 질량으로 제품 덩어리를 만든다: `질량 = 표 질량 × share`, `share = freeVolume / allVolume`(allVolume > 0일 때, 아니면 `free 개수 / all 개수`; all은 읽은 제품 메시의 파트 전부, free는 덩어리 밖에 남은 것).
- 제품 덩어리의 주인(무게중심 덮어쓰기를 쓰는 오브젝트) = `nodeHomes(key)`: 그 노드를 경로에 가진 메시마다 위로 그 노드의 메시만 품은(다른 메시가 없는) 오브젝트를 따라 올라가며 후보를 모은다(로봇은 고르지 않는다). ① 후보 가운데 그 노드에서 만든 CAD 오브젝트(그룹이 아님, 어셈블리는 하위 메시 경로의 공통 앞부분에서 가장 깊은 중간 노드, CAD 루트는 첫 노드, 파트는 경로의 마지막 노드)가 있으면 그것(여럿이면 노드 메시를 가장 많이 품은 것, 같으면 먼저 본 것). 메시 일부를 지우거나 옮겨 원래 어셈블리에 메시가 하나만 남아도 원래 어셈블리이고 노드를 그룹으로 감싸도 그 그룹이 아니다. ② 없으면(그 노드의 CAD 오브젝트를 지움) 메시마다 노드 메시를 더 많이 품게 되는 가장 아래 후보를 고르고 그중 노드 메시를 가장 많이 품은 것(같으면 문서 순서로 앞 메시의 것). 메시가 없는 노드는 null.

### 12.4 COTS 하나로 볼 수 있는지(`cotsRejection`)

COTS 질량은 하위 전체를 덮으므로(인스펙터는 아무 오브젝트에나 컴포넌트를 붙이고 포드를 고르게 한다) 하위를 그 부품 하나로 볼 수 없으면 쓰지 않는다. 검사 순서(처음 걸린 이유를 낸다):

1. 하위(자기 제외)에 다른 COTS(컴포넌트가 COTS 키를 가짐·바퀴가 COTS 키를 가짐·포드 대상) → `containsCots`.
2. 하위 메시의 SKU 제품 각각이 자기 키(`ownKeys`) 가운데 같은 부품(`sameCotsItem`)과 하나씩 짝지어져야 한다(제품 하나당 키 하나까지 그 부품 자신). 짝이 없으면(둘 이상이면 여럿을 품은 상위 어셈블리) → `containsCots`.
3. 하위(자기 제외)에 CAD 루트 → `containsCad`(오브젝트 자신이 CAD 루트인 것은 거르지 않는다: 로봇 전체 CAD는 다른 COTS를 품거나 너무 커서 걸리고, 부품만 따로 불러온 작은 STEP은 그 부품이다).
4. 크기: `Σ usableVolume × 2700 kg/m³ > Σ_key 배수(key) × 표 질량(key)` → `tooLarge`. 배수는 `wheel:` 키는 `WHEEL_SIZE_FACTOR` 4, 나머지는 `COTS_SIZE_FACTOR` 1.6이다. 키가 여럿이면 각자의 배수 × 질량을 더한다(여러 모터 컴포넌트를 한 그룹에 두면 한도가 더해진다).

크기 배수의 근거(코드 주석, 판단값): "실제 상용 부품 CAD(scratchpad CAD 실측: goBILDA 5204 모터 0.4, REV Core Hex 0.49, Limelight 3A 0.52, Pinpoint 0.78, REV Smart Robot Servo 1.12, 4-Bar 포드 1.10, Swingarm 포드 1.04, Axon MAX 1.02, 메카넘 96 mm 1.17)는 부피 × 2.70 / 표 질량이 1.2 이하이므로 모터·서보·Pinpoint·포드·Limelight는 1.6배까지 받는다. 몸체를 속이 찬 솔리드로 그린 서보(1.4쯤)는 받고, 서브시스템 어셈블리(인테이크의 옆판·롤러, 집게의 판)에 붙인 컴포넌트는 걸린다. 바퀴는 팀 CAD가 속이 찬 원기둥으로 그리기도 해서(GripForce 104 × 38 mm 원기둥 3.7배) 4배까지다." 계산값: 104 mm × 38 mm 원기둥 부피 322.8 cm³ × 2700 = 0.8716 kg = 236 g의 3.69배. 시험이 고정한 CAD 부피: REV Smart Robot Servo 25.75 cm³, 4-Bar 포드 34.2 cm³, Pinpoint 11.59 cm³, Limelight 3A 17.92 cm³. 시험(`massModel.test.ts`, 인테이크에 붙인 goBILDA 19.2:1 모터 컴포넌트 437 g)은 인테이크(옆판 둘 0.2 × 0.004 × 0.12 m·롤러 관 0.3 × 0.03 × 0.03 m·모터 몸체 0.037 × 0.1 × 0.037 m의 상자 네 개)가 1.6배 한도(437 g × 1.6 = 0.699 kg)를 넘어 `tooLarge`로 걸리는 것을 확인한다. 시험 주석은 이 인테이크가 "알루미늄으로 쳐서 0.96 kg: 4배 한도(1.75 kg)는 받았지만 1.6배(0.70 kg)는 넘는다"고 적었으나 0.96 kg은 시험의 상자 치수와 맞지 않는다. 다시 계산하면 부피 5.989e-4 m³ × 2700 = 1.617 kg(계산값)이고, 437 g × 4 = 1.748 kg보다는 작아 4배였다면 받았을 크기다(결론은 같다).

### 12.5 Pinpoint 포드(`pinpointPods`)

Pinpoint 컴포넌트의 `xPod`·`yPod`(존재하는 오브젝트 id)마다 요청(키 = `pinpointPodCotsKey(podType)`)을 만든다. 같은 포드를 여러 Pinpoint가 가리키면 앞의 것이고, Pinpoint와 다른 로봇(또는 로봇 밖)이면 `otherRobot`, Pinpoint 오브젝트 자신이거나 그 상위(`isInSubtree(pinpoint, target)`)면 `containsPinpoint`로 그 Pinpoint의 로봇에 알린다(`xPod`·`yPod`가 같은 오브젝트를 가리켜도 한 번). 남은 포드는 오브젝트의 다른 COTS 키와 함께 `cotsRejection`을 거친다.

### 12.6 로봇 질량·무게중심·관성 합성

저울 맞추기(§13) 뒤에, 로봇에 속한 파트 전부(`list`)로 합친다. 읽는 중인 메시는 뺀다(읽은 만큼).

```
mass          M = fixed + estimated                        (fixed: 추정 파트가 아닌 파트(덩어리·제품 덩어리의 member와 점질량)의 질량 합, estimated: 추정 파트의 질량 합(저울 맞춘 뒤, 질량 0인 라벨 규칙 파트 포함))
무게중심      c = Σ m_i · c_i / M                          (M = 0이면 [0,0,0])
파트 자체 관성 I_i = unitInertia_i · (m_i / V_i)           (V_i > 0일 때. 점질량(V = 0)은 0)
평행축 합성    I = Σ_i [ I_i + m_i · (|d_i|²·E − d_i d_iᵀ) ],  d_i = c_i − c
              (성분: Ixx += I_i,xx + m(dy² + dz²), Ixy += I_i,xy − m·dx·dy 등 addParallelAxis)
주관성 값     principalMoments = symmetricEigen3(I)의 고윳값을 오름차순으로 (drivetrain.md §14의 Jacobi)
```

파트의 단위 밀도 관성은 만들 때 `R·I·Rᵀ`(R = 파트 행렬의 회전 부분)로 로봇 축에 돌려 두고, 합성 때 밀도 m/V를 곱한다.

### 12.7 오브젝트별 하위 합계(`ObjectMass`)와 자기 몫

- `objects[id]`: 하위 전체 질량·무게중심(질량 가중)·출처. 출처는 하위 중 가장 큰 질량의 출처(`source`+`detail`로 묶은 그룹의 합이 가장 큰 것, 같으면 먼저 나온 것, 질량이 0이면 처음 나온 출처: 라벨 규칙처럼 0을 정한 것). `inheritedFrom`은 그 출처를 정한 오브젝트이고 이 오브젝트나 그 하위면 null. `scaled`(저울 맞추기 비율이 곱해졌는지), `pendingMeshes`(질량에 들어가지 않은 읽는 중 메시 수, 덮어쓰기·COTS·제품 덩어리 안의 메시는 세지 않음).
- `source`(`MassSource`)는 `override`(질량 덮어쓰기 덩어리), `cots`(COTS 컴포넌트·바퀴·포드·SKU 제품 덩어리, `detail`은 표 키를 `+`로 이은 것), `material`(명시 재질, `detail`은 재질 키), `nameRule`(이름 규칙, `detail`은 맞은 낱말열 또는 `gobilda-<시리즈>`), `default`(로봇 기본 재질 또는 정보 없음 대체값, `detail`은 재질 키 또는 빈 글자), `none`(질량 출처 없음: 파트가 없는 오브젝트의 빈 결과)이다.
- 정보 없음 대체값을 쓴 로봇의 결과는 `{ mass: 대체 질량, centerOfMass: 대체 무게중심, source: 'default', detail: '', pendingMeshes: 0 }`이다(자식 오브젝트의 결과는 그대로).
- `own[id]`: §15.

---

## 13. 저울 맞추기와 정보 없음 대체의 수식·한도

로봇마다 (`fixed`: 추정 파트가 아닌 파트 곧 덮어쓰기·COTS·제품 덩어리의 member와 점질량의 질량 합, `estimated`: 재질로 추정한 파트의 질량 합, `weighed = rigidbody.weighedMass`, `total = fixed + estimated`):

```
estimable = ∃ 추정 파트 with mass > 0
surfaces  = ∃ 파트 with (덩어리 밖, volume = 0)          (표면 메시)
unknown   = (덩어리 밖 읽는 중·못 읽은 메시 수 > 0) ∨ surfaces ∨ (로봇의 메시 형상 수 = 0) ∨ (total = 0)
```

| 경우              | 조건                                    | 동작                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 정보 없음 대체 | `!estimable && unknown`                 | `weighed`가 있으면 `rest = weighed − fixed`. `rest ≤ 0`이면 `rest = 0`, 경고 `scaleImpossible { fixed, weighed }`, 고정 질량만 씀. 아니면 경고 `defaultMass { weighed: true, fixed, rest }`. `weighed`가 없으면 `rest = max(0, 13.6 − fixed)`, 경고 `defaultMass { weighed: false, fixed, rest }`(rest가 0이어도 낸다). `defaultBox = rest > 0`이면 외곽 상자에 rest를 둔다 |
| B. 저울 맞추기    | A가 아니고 `weighed`가 있고 `total > 0` | `fixed ≥ weighed` 또는 `estimated === 0`이면 `scaleImpossible { fixed, weighed }`이고 맞추지 않음(scale 1). 아니면 `scale = (weighed − fixed) / estimated`, 추정 파트(mass ≠ 0)에만 곱한다(`scaled: true`, 관성도 질량에 비례해 늘어남). `scale < 0.6` 또는 `scale > 1.6`이면 `scaleUnusual { scale }`                                                                      |
| C. 그 밖          |                                         | 추정 그대로(scale 1)                                                                                                                                                                                                                                                                                                                                                        |

고정 질량(덮어쓰기·COTS)은 맞출 때 건드리지 않는다. 질량을 셀 수 있는 형상(질량이 0이 아닌 추정 파트)이 하나라도 있으면 읽은 만큼으로 계산하고 맞춘다(`pending` 경고). 덮어쓰기·COTS·SKU 제품 덩어리가 덮은 메시는 질량이 이미 들어 있어 상자를 더하지 않는다(CAD 전체를 덮은 직접 입력은 CAD를 못 찾아도 같은 질량).

### 13.1 정보 없음 대체의 외곽 상자(`robotBox`와 대체 합성)

외곽 상자(로봇 좌표): 로봇 하위 CAD 루트마다 `cad.bounds`의 8꼭짓점(경계 상자 중심을 원점으로 옮겨 CAD 루트 행렬로 변환)의 축 정렬 경계. CAD 루트가 없거나 퇴화(어느 축이든 min ≥ max)면 18 in 정육면체: x·y ∈ [−0.2286, 0.2286], z ∈ [0, 0.4572].

```
a, b, c = 외곽의 x, y, z 폭
boxCenter = ( (xmin + xmax)/2 , (ymin + ymax)/2 , zmin + 0.35 · c )
boxInertia = rest · diag( (b² + c²)/12 , (a² + c²)/12 , (a² + b²)/12 )      (균일 직육면체 식, 비대각 0)
fixed = 0:  M = rest,  c = boxCenter,  I = boxInertia
fixed > 0:  M = fixed + rest,  c = (rest·boxCenter + Σ m_i·c_i) / M,
            I = addParallelAxis(boxInertia, rest, boxCenter − c) + Σ 파트 관성(평행축)
estimated(표시) = rest
```

기본 18 in 상자 13.6 kg의 값(계산값): 무게중심 z = 0.35 × 0.4572 = 0.16002 m, Ixx = Iyy = Izz = 13.6 × 2 × 0.4572² / 12 ≈ 0.4738 kg·m²(시험 `side = DEFAULT_ROBOT_MASS · 2 · ROBOT_SIZE² / 12`와 같다). 균일 직육면체 관성식을 기하 중심이 아닌 낮춘 무게중심(0.35 c)에 그대로 쓰는 근사다(코드 동작).

### 13.2 한도·결과의 의미

| 항목                                | 값                                     | 이유                                                                                                                                                                                                             |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 정상 비율                           | 0.6 ≤ scale ≤ 1.6                      | 주석: CAD에 없는 전선·나사·허브는 보통 전체의 5–15 %이고 알루미늄 구조재는 부피 × 밀도가 공시 무게와 1.4 % 안에서 맞으므로(goBILDA U-channel) 그보다 큰 차이는 재질·채움률·빠진 부품을 확인하라는 뜻이다(판단값) |
| `fixedMass`·`estimatedMass`·`scale` | 로봇 결과에 출처별 합계와 비율을 담음  | 인스펙터 Rigidbody 카드                                                                                                                                                                                          |
| 대체 상자                           | rest = 저울 무게(또는 13.6 kg) − fixed | 질량을 모르는 부분을 외곽 상자에 고르게 둠                                                                                                                                                                       |

---

## 14. 경고·알림 종류

### 14.1 `MassWarning`(로봇 결과의 `warnings`, 갈래 사이 계약)

| 종류                                   | 내용                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scaleUnusual { scale }`               | 저울 맞추기 비율이 [0.6, 1.6] 밖                                                                                                                                         |
| `scaleImpossible { fixed, weighed }`   | 고정 질량 ≥ 저울 무게이거나 추정 질량이 0이라 맞추지 않음(대체 경로에서는 저울 무게 − 고정 ≤ 0)                                                                          |
| `defaultMass { weighed, fixed, rest }` | 질량을 셀 수 있는 형상이 없고 모르는 메시가 있거나 CAD가 없어 저울 무게(없으면 13.6 kg)에서 고정을 뺀 나머지 rest를 외곽 상자에 고르게 둠. rest가 0이면 상자를 두지 않음 |
| `pending { meshes, covered? }`         | 형상 정보가 없는 메시. meshes = 질량이 빠진 것(덩어리 밖), covered = 덩어리 안이라 질량은 들어가고 분포만 남은 것(0이면 없음)                                            |

### 14.2 `MassNotice`(로봇 결과의 `notices`, 문서 순서)

| 종류                                                  | 내용                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `innerMassExceeds { objectId, mass, inner }`          | 덩어리 안의 덮어쓰기 합이 그 질량보다 커서 안쪽 값을 그대로 씀                                                                                                                        |
| `centerOfMassIgnored { objectId }`                    | 무게중심 덮어쓰기를 쓰지 못함: 안쪽 덮어쓰기가 덩어리 질량을 다 써서 옮길 몫이 없음, 또는 덩어리를 정하지 않음(질량 덮어쓰기·COTS 없음, COTS가 다른 덩어리 안)                        |
| `cotsIgnored { objectId, keys, reason, pinpointId? }` | COTS를 쓰지 않음. reason은 `otherRobot`(포드가 Pinpoint와 다른 로봇이거나 로봇 밖), `containsPinpoint`(포드가 Pinpoint 자신이거나 그 상위), `containsCots`, `containsCad`, `tooLarge` |

알림 순서: 먼저 COTS 알림(`pinpointPods`의 것과 오브젝트별 거절), 그다음 `noticeOrder`(덩어리마다 `innerMassExceeds`·`centerOfMassIgnored`, 덩어리를 정하지 않은 오브젝트의 `centerOfMassIgnored`).

---

## 15. 오브젝트 자기 몫(`own`)과 3b·3c 연결

### 15.1 `OwnMass`

오브젝트 자기 몫(하위 오브젝트 제외: 이 오브젝트에 매인 메시 파트와 덮어쓰기·COTS 점질량만)의 질량 성질이다. 저울 맞추기 비율이 곱해진 값이다. 정보 없는 로봇의 외곽 상자 질량(`defaultMass`)은 어느 오브젝트의 몫도 아니다. `own`에는 자기 몫이 있거나 읽는 중 메시가 매인 오브젝트만 `objects` 키 순서로 들어간다(없는 오브젝트의 자기 몫은 0).

```
mass    = Σ part.mass
c       = Σ part.mass · part.com / mass            (mass = 0이면 오브젝트 원점)
inertia = Σ [ own_i + m_i (|d_i|² E − d_i d_iᵀ) ],  d_i = part.com − c      (무게중심 기준, 로봇 좌표)
pendingMeshes = 자기 메시 중 형상 질량 성질이 아직 없어 mass에 들어가지 않은 것의 수
```

### 15.2 3b 관절 몸체

관절 몸체는 관절 오브젝트 하위에서 안쪽 관절의 하위를 뺀 오브젝트들의 `own`을 합친다(`play/worldJoints.ts` `buildWorldJoints`): `total = Σ own.mass`, `com = Σ(own.mass·own.centerOfMass)/total`, 관성은 각 own 관성을 평행축 정리로 com에 옮겨 합한다. 몸체 질량이 0이거나 유한하지 않으면(질량 모델을 계산하는 경우만) 대체 몸체 질량 `FALLBACK_BODY_MASS` 0.001 kg과 경고 `worldJointNoMass`, 읽는 중 메시가 있으면 `worldJointMassPending`. 자세한 내용은 `motors-joints.md` §11.

### 15.3 3c 섀시 몸체(`mass/chassis.ts`, `play/worldSpec.ts` `chassisBody`)

바퀴가 있는 로봇의 부유 기저가 싣는 섀시 몸체 = 질량 모델의 로봇 전체(`RobotMass`)에서 관절 몸체들을 평행축 정리로 뺀 것이다.

```
(subtractMassProps) total에서 parts를 뺀다:
  mass = total.mass − Σ part.mass
  moment = total.mass·total.com − Σ part.mass·part.com
  mass > 0이면 com = moment / mass
  I = inertiaAbout(total, com) − Σ inertiaAbout(part, com)     (inertiaAbout: I + m(|d|²E − ddᵀ), d = center − 점)
  mass ≤ 0이면 com은 전체의 것, 관성 0 (호출하는 쪽이 대체)
```

`floorInertia(inertia, floor)`: 관성의 주관성 값을 하한 `floor` 이상으로 올린다. 올린 뒤 삼각 부등식(I_small + I_middle ≥ I_large, 실제 질량 분포의 관성은 늘 지킨다)이 반올림으로 깨졌으면 작은 두 값을 같은 만큼(gap/2씩) 올려 맞춘다. 반올림 차는 대각 합의 1e-12배까지 둔다. 고칠 것이 없으면 값을 그대로 돌려준다(고유 분해로 다시 만들면 반올림이 바뀌므로). 고쳤다면 V·Λ·Vᵀ로 다시 만든다.

사용 조건(3c): 질량 모델이 있고(`mass?.robots[robotId]`, 없으면 경고 없이 기본 상자), 남은 질량이 `MIN_CHASSIS_MASS` 0.1 kg 이상이고 `floorInertia(…, 1e-6)`로 고친 관성이 `isValidInertia`를 통과하며 무게중심이 유한해야 한다. 아니면 기본 상자(`placeholderChassisBody`)와 경고 `worldChassisMass`(남은 질량을 g 단위로 반올림해 0 이상으로, 대체 질량 `DEFAULT_ROBOT_MASS`를 params로 알린다). 질량 모델이 형상을 읽는 중·못 읽은 메시(`pending` 경고, 덩어리 밖이라 질량이 빠진 것)를 섀시 쪽에 남겼으면(관절 몸체의 것은 그 관절이 알린다) 경고 `worldChassisMassPending`이다. 질량을 셀 수 있는 형상이 없어 질량 모델이 외곽 상자로 대신한 로봇(`defaultMass` 경고가 있는 로봇)은 일부가 빠진 것이 아니라 정해진 대체값이라 이 경고를 내지 않는다(Rigidbody 카드가 알린다). 기본 상자: 외곽의 경계 상자(a × b) × 높이 0.2 m에 13.6 kg을 고르게 둔 직육면체, 무게중심 z = 0.1 m, 관성 diag(m(b² + h²)/12, m(a² + h²)/12, m(a² + b²)/12). 자세한 내용은 `drivetrain.md` §4.

### 15.4 3c 바퀴 회전 질량(`wheelSpinMass`)

바퀴 오브젝트 하위 질량에서 그 하위에 붙은 하드웨어 컴포넌트의 데이터시트 질량(`componentCotsKey`의 표 질량)을 뺀다(모터 회전자는 전기자 관성으로 이미 들어가 있고 하우징은 돌지 않는다). 바퀴 설정이 표의 제품(goBILDA 메카넘 104·96 mm)이고 바퀴 오브젝트에 질량 덮어쓰기가 없으면 그 제품의 데이터시트 질량 그대로다(하위가 커서 COTS를 거절한 바퀴 그룹도). 질량 모델이 없거나, 그 오브젝트가 없거나, 빼고 남은 것이 0 이하면 null(종류 기본 질량). 회전 관성은 `0.53 · m · R²`(`wheelData.ts`, `drivetrain.md` §4).

---

## 16. 인스펙터·씬 뷰·표시 규칙

### 16.1 인스펙터

| 항목                 | 규칙                                                                                                                                                                      | 위치                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Rigidbody 카드       | 로봇이면 늘 보임: 출처별 합계, 저울 무게, 기본 재질, 무게중심·주관성 읽기 전용, 비율·경고·알림, CAD 루트별 열린·표면·읽는 중·못 읽음 요약                                 | `editor/mass/RigidbodyCard.tsx`, `massCardModel.ts` |
| 질량 카드            | Add Component "시뮬레이션 › 질량"이 붙임: 재질과 상속 출처, 출력 재질이면 채움률, 질량·무게중심 덮어쓰기, 결과                                                            | `MassCard.tsx`                                      |
| 추정 한 줄           | 카드가 없는 오브젝트는 추정 한 줄(누르면 카드를 붙임, 도움말에 전체 출처)                                                                                                 | `MassEstimateLine.tsx`, `estimateLine`              |
| 재질 상속 보기       | 자기를 뺀 위로 가장 가까운 재질: 위 오브젝트의 질량 카드, 로봇 기본 재질(정하지 않았으면 알루미늄 6061), 로봇 밖이면 기본(`inheritedMaterial`)                            | `massCardModel.ts`                                  |
| 채움률 칸을 보일지   | 직접 정한 재질(자기·위)이 출력 재질이거나, 이 채움률이 닿는 파트를 모델이 출력 재질로 추정했거나(로봇 기본·이름 규칙), 이미 채움률을 정했을 때                            | `showInfill`                                        |
| 무게중심 칸을 보일지 | 질량을 덮어썼거나, 이 오브젝트가 데이터시트 질량을 정했거나, 이미 정했을 때. 그 밖의 무게중심은 형상에서 나오므로 덮어쓰기가 쓰이지 않는다                                | `showCenterOfMass`                                  |
| 채움률 입력          | "15", "15%", "15 %" → 0.15. 0–100 밖이거나 읽지 못하면 null                                                                                                               | `parseInfillPercent`                                |
| 질량 입력 범위       | 0 < m ≤ 100(파트), 0 < m ≤ 200(로봇). 받지 않는 값은 지우지 않고 틀렸다고 보임                                                                                            | `acceptMass`, `parseMassInput`                      |
| 질량 계산 시점       | 문서(`objects`)와 형상 revision마다 한 번. 핸들 드래그 중(`isChangeOpen`)은 마지막 결과를 쓰고 묶음이 닫힐 때 한 번 다시 계산. 큰 CAD(메시 1761개)에서 한 번 약 60–100 ms | `editor/mass/useMassModel.ts`                       |

### 16.2 씬 뷰 무게중심 표시(`CenterOfMassIndicator`)

활성 오브젝트가 속한 로봇의 무게중심(큰 표시, 청록 `#2dd4bf`: 반지름 0.018 m 공 + 반 길이 0.06 m 십자)과 활성 오브젝트 하위 전체의 무게중심(작은 표시, `#f8fafc`: 반지름 0.01 m 공)을 그린다. 축 색(빨강·초록·파랑)과 IMU 표시(보라·주황)와 겹치지 않는 색이다. 형상은 `SphereGeometry(1, 16, 12)`와 6점 십자 선이고 재질은 `depthTest: false`, `depthWrite: false`, `transparent: true`, `toneMapped: false`, `renderOrder` 11(IMU 표시와 같은 단계)이다. 클릭되지 않는다(raycast 없음). 질량이 0이거나 계산이 없으면 그리지 않고, 로봇을 골랐으면 로봇 표시만(둘이 같은 자리), 로봇 밖 오브젝트는 필드 좌표다. 실행 중에는 시뮬레이터 자세를 따르고 오브젝트 표시는 관절 자세도 따르며, 로봇 표시는 편집 자세의 무게중심을 로봇 틀로만 옮긴다(관절이 움직여 바뀐 로봇 무게중심은 시뮬레이터가 보내지 않는다). 숨긴 오브젝트도 질량 계산에는 들어간다.

---

## 17. 설계 결정·Unity 대응·임시 편차

| 결정                                                      | 내용·이유                                                                                                                                                                                                                                                 | 위치                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 저울 무게로 전체를 맞춘다                                 | 로봇 전체 질량은 팀이 저울로 단 값(Rigidbody 카드)으로 맞추고, 추정이 좌우하는 것은 파트 사이 비율(무게중심·관성)이다. 그래서 재질 밀도의 2–3 % 차이는 남지 않는다                                                                                        | `materials.ts` 머리 주석, `massModel.ts` |
| 고정 질량(덮어쓰기·COTS)은 맞출 때 건드리지 않는다        | 저울 맞추기는 추정 파트에만 같은 비율을 곱한다                                                                                                                                                                                                            | `massModel.ts`                           |
| 제조사 질량을 쓴다                                        | 모터·서보·배터리·카메라는 단순화한 CAD라 부피 × 재질이 크게 틀리다(겉보기 밀도 1.9–7.4 g/cm³, 4배 차이)                                                                                                                                                   | `cotsTable.ts`                           |
| STEP 안의 재질 정보를 쓰지 않는다                         | Fusion 기본값 "Steel, Mild"가 바퀴 고무에도 남아 있어 믿을 수 없다                                                                                                                                                                                        | `nameRules.ts` 머리 주석                 |
| 이름 규칙은 원래 CAD 이름 경로만 본다                     | 오브젝트 이름을 바꾸거나 옮기거나 그룹으로 묶어도 질량이 바뀌지 않게 하고, 팀이 지은 메커니즘 이름(생성 Java 클래스)이 재질을 바꾸지 않게 한다. 붙인 "노드 + 순번" 이름은 CAD 이름이 아니라 건너뛴다                                                      | `massModel.ts` 머리 주석                 |
| 상위 노드 이름은 부품 종류 낱말을 내려주지 않는다         | "Roller Intake" 어셈블리의 판은 롤러가 아니다                                                                                                                                                                                                             | `nameRules.ts` `matchAncestorRule`       |
| 부품 종류는 중심 명사에서 끝날 때만                       | 수식어는 정하지 않는다("Nut Strip", "Chain Guard", "Roller Arm" 규칙 없음)                                                                                                                                                                                | `nameRules.ts` `partRule`                |
| 출처 없는 일반 낱말(mount·block·hub)은 규칙에 넣지 않는다 | 로봇 기본 재질을 이기면 출력물 "Camera Mount"가 알루미늄이 된다                                                                                                                                                                                           | `nameRules.ts` 주석                      |
| 명시한 재질이 이름 규칙보다 먼저, 라벨 규칙은 질량 0      | 코드(`estimate`)가 명시 재질(`mass.material`, 상속 포함)을 이름 규칙보다 먼저 본다. 시험은 명시 재질(PLA) 아래의 "Steel Bolt"가 PLA(`source: 'material'`)이고 명시 재질이 없는 "Top Label"이 질량 0(`source: 'nameRule'`, `detail: 'label'`)임을 확인한다 | `estimate`, `massModel.test.ts`          |
| COTS는 하위가 그 부품 하나로 보일 때만 하위를 덮는다      | 로봇 전체 CAD 루트나 서브시스템 어셈블리에 붙인 Pinpoint·서보 컴포넌트가 그 하위 질량을 지우지 않게                                                                                                                                                       | `cotsRejection`                          |
| 덩어리 안 COTS는 쓰지 않는다                              | 두 번 세지 않게 위의 것을 쓴다                                                                                                                                                                                                                            | `visit`                                  |
| SKU 제품은 지금 계층이 아니라 원래 노드로 정한다          | 노드 이름을 바꾸거나 옮겨도 제품 질량은 한 번만                                                                                                                                                                                                           | `sourceIndex`, `nodeHomes`               |
| 질량 정보가 없는 로봇은 상자                              | 임시 씬의 상자 로봇·못 찾은 CAD는 13.6 kg(또는 저울 무게)의 외곽 상자. 고정 질량은 제자리에 둠                                                                                                                                                            | `massModel.ts` `defaultBox`              |
| 표면 메시(닫히지 않음)는 질량 0                           | 부피가 정해지지 않고 무게중심이 없다                                                                                                                                                                                                                      | `meshMassState`                          |
| 질량 설정은 시뮬레이터 전용                               | 바퀴(`wheel`)·`joint`처럼 생성 코드·구성 XML·하드웨어 검증·사용처와 관계없다. 내부 단위 kg·m                                                                                                                                                              | CLAUDE.md 불변 조건                      |
| 질량 입력 단위는 길이 표시 단위를 따른다                  | 개인 설정을 따로 늘리지 않음                                                                                                                                                                                                                              | `units/units.ts`                         |
| 메시 질량 성질은 형상과 함께 문서 밖에 둔다               | 씬 문서에는 사용자 설정만 둬서 실행 취소·dirty가 질량 계산과 무관                                                                                                                                                                                         | `geometryRegistry.ts`                    |
| Unity 대응                                                | 질량 칸은 Unity Rigidbody·ArticulationBody의 질량 칸에 해당(CLAUDE.md). 로봇의 Rigidbody 카드와 Add Component "시뮬레이션 › 질량" 카드로 Unity 인스펙터 방식을 따름                                                                                       | CLAUDE.md                                |
| 사용자 결정 표시                                          | 3a의 코드 주석과 CLAUDE.md 3a 항목에는 "사용자 결정"으로 표시된 값이 없다                                                                                                                                                                                 | -                                        |

---

## 18. 시험 기준

| 시험                     | 고정하는 것                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cad/meshMass.test.ts`   | 단위 정육면체(부피 1, 관성 1/6, 곱관성 0, 닫힘 0), 떨어진 상자 둘의 평행축 정리와 곱관성 부호, 원점에서 먼 메시, 거울상·감김 뒤집기, 열린 메시·표면·한계 사례(§5.3), 86만 삼각형 Float32 원기둥(상대 오차 1e-6, 약 60 ms, 상한 500 ms, 결정성), `isMeshMassProps`, CAx-IF 기준 부피(허용은 §4.4)                                                                                                                                                               |
| `mass/materials.test.ts` | 100×50×5 판·채움 25 %: 근사 0.63(정확 0.53), `PRINTED_SHELL_THICKNESS` = 0.0011, 부피·면적 0이면 채움만, 껍질은 1을 넘지 않음                                                                                                                                                                                                                                                                                                                                  |
| `mass/cotsTable.test.ts` | 모든 항목 0 < 질량 < 1 kg, 모터·서보·바퀴·SKU 키 고르기(§10), REV 모델의 질량 g 값(350·234·404·198.4·347.9)                                                                                                                                                                                                                                                                                                                                                    |
| `mass/nameRules.test.ts` | 이름 나누기·복수형·낱말 경계·규칙 이름·재질 먼저·긴 낱말열 먼저·`nameRuleMaterial`                                                                                                                                                                                                                                                                                                                                                                             |
| `mass/massModel.test.ts` | 재질 상속·채움률 상속·출력 재질, 표면·열린 메시, 이름 규칙(원래 이름 경로·옮기기·이름 바꾸기), goBILDA U-channel 5종(아래), 덮어쓰기·무게중심 덮어쓰기·COTS·SKU 제품·Pinpoint 포드·크기 한도, 저울 맞추기(비율·scaleUnusual·scaleImpossible), 평행축 합성(단위 정육면체 둘: M 2, Ixx 2/6, Iyy = Izz = 2/6 + 2; 1×2×3 상자의 주관성 값 {5, 10, 13}/12), 자기 몫(own)의 합 = 로봇 전체, 정보 없음 대체, 결정성(같은 입력 → 같은 결과, 결과 키는 objects 키 순서) |
| `mass/chassis.test.ts`   | 섀시 몸체 빼기·관성 하한                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `editor/mass/*.test.*`   | 카드 모델·표시 문구·레이아웃·무게중심 표시                                                                                                                                                                                                                                                                                                                                                                                                                     |

goBILDA U-channel 5종(시험이 고정한 값, "goBILDA 예제 STEP(3200-2627-0004)을 occt-import-js로 읽은 CAD 부피"와 공시 무게, 공시 무게 주소 https://www.gobilda.com/1120-series-u-channel-\<N\>-hole-\<L\>mm-length/):

| SKU            | CAD 부피(cm³) | 공시 무게(g) | 부피 × 2.70(g, 계산값) | 차이(계산값) |
| -------------- | ------------- | ------------ | ---------------------- | ------------ |
| 1120-0001-0048 | 13.142        | 35           | 35.48                  | +1.38 %      |
| 1120-0002-0072 | 18.907        | 51           | 51.05                  | +0.10 %      |
| 1120-0008-0216 | 53.499        | 144          | 144.45                 | +0.31 %      |
| 1120-0010-0264 | 65.029        | 175          | 175.58                 | +0.33 %      |
| 1120-0015-0384 | 93.856        | 253          | 253.41                 | +0.16 %      |

시험 허용: 차이 ≤ 1.4 %. 기본 재질을 PLA로 둬도 SKU 시리즈 규칙(1120 → 알루미늄 6061)이 정한다. CLAUDE.md 3a 항목의 실제 goBILDA 키트 전체: 8.07 kg(데이터시트 4.38 + 추정 3.68; 합을 반올림한 값).

---

## 19. 외부 출처 상태(죽은 링크·엇갈린 출처·주석과 다시 계산한 값의 차이)

| 항목                           | 내용                                                                                                                                                                                                                            | 위치                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 죽은 링크                      | HDPE A&C Plastics `https://www.acplasticsinc.com/media/HDPE%20Typical Properties.pdf` — "주소에 공백이 있고 2026-11에 404"                                                                                                      | `materials.ts` `hdpe`          |
| 판매처 간접 출처               | PETG 판매처 사양, goBILDA 상품 페이지의 간접 SKU 확인, core-electronics 등 재판매처 사양 표                                                                                                                                     | `materials.ts`, `nameRules.ts` |
| 출처끼리 엇갈림                | 탄소섬유 1.45–1.6 g/cm³, 고무 0.93–1.3, 폼 30–200+, Axon MAX 78 g(goBILDA)와 85 g(Axon 문서), REV Control Hub·Expansion Hub 209 g(두 페이지가 크기까지 같아 복사일 수 있음), goBILDA 1521 스페이서(사양 표 강철 대 판매처 본문) | 해당 줄 주석                   |
| 단위가 빠진 값                 | goBILDA 5204 99.5:1 "Weight 501"을 g로 읽음                                                                                                                                                                                     | `cotsTable.ts`                 |
| 재질 미확인                    | goBILDA 3309(플라스틱 체인, 아세탈로 가정), 1143·1201·1205·1208·1209·1222·1309·1310·1516·1522·3217(알루미늄으로 가정), 2806·2807·2809·2810·2812·2822·2824(강철로 가정), 2909(나일론 PA66으로 가정)                              | `nameRules.ts`                 |
| 주석과 다시 계산한 값의 차이 1 | 계열 사이 질량 차이 "최대 38 g"(`motorCotsKey` 주석) — 표에서 다시 계산하면 5203 열 대비 최대 31 g, 네 열 사이 최대 48 g                                                                                                        | `cotsTable.ts`                 |
| 주석과 다시 계산한 값의 차이 2 | UltraPlanetary 식과 REV 조합 표가 "2 g 안에서 맞는다" — 카트리지 3개는 2.5 g 차이(439 대 441.5)                                                                                                                                 | `cotsTable.ts`                 |
| 주석과 다시 계산한 값의 차이 3 | 밀도 1480(탄소섬유), 100(폼)은 출처 값(1.45 g/cm³, 85–90 kg/m³)과 다르다. 범위 안이고 이유는 기록 없음                                                                                                                          | `materials.ts`                 |
| 출처가 없는 가정               | 출력물 위·아래 0.8 mm, 기본 채움률 0.15, 13.6 kg(30 lb) 근거는 "대개 25–35 lb" 문장뿐, 무게중심 0.35                                                                                                                            | §3·§7                          |

---

## 20. 알려진 한계·남은 일

CLAUDE.md 3a 한계와 코드 주석에서 모은 것이다.

| 한계                         | 내용                                                                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COTS 크기 한도               | 컴포넌트 COTS는 하위가 크기 한도(부품 종류 배수 × 표 질량) 안이면 구조물이 섞여 있어도 덮는다(여러 모터 컴포넌트를 한 그룹에 두면 한도가 더해진다)                                                                         |
| 겹친 솔리드                  | 겹치는 솔리드는 두 번 센다                                                                                                                                                                                                 |
| 대칭 구멍                    | 세 축 모두 대칭인 구멍은 닫힘 지표가 잡지 못한다(§5.3)                                                                                                                                                                     |
| CAD에 없는 부품              | 전선·나사·허브는 저울 맞추기에 퍼진다(추정 파트에만 같은 비율이 곱해져 분포가 실제와 다를 수 있다)                                                                                                                         |
| 단순화한 모터·서보 CAD       | 컴포넌트를 붙여야 데이터시트 질량이 된다(붙이지 않으면 재질 × 부피로 크게 틀린다)                                                                                                                                          |
| 서보 질량 서술               | CLAUDE.md 3a 한계의 "서보 모델 속성이 없어 서보는 60 g 하나다"는 3b가 `servoModel`을 더하기 전의 서술이다. 지금 코드는 `servoModel`별 질량 표(§10.3)를 쓰고, 속성이 없거나 모르는 값이면 기본 goBILDA 2000 Torque 60 g이다 |
| 출력물                       | 근사다(얇은 판은 0.1–0.15 무겁게 본다)                                                                                                                                                                                     |
| 이름이 SKU도 낱말도 아닌 CAD | 기본 재질이다                                                                                                                                                                                                              |
| 네이티브·WASM 질량           | 약 2e-6 상대 차                                                                                                                                                                                                            |
| 표에 없는 부품               | OTOS·컬러·거리 센서·웹캠·IMU, goBILDA 5201·NeveRest 20·60·TETRIX·Matrix·Studica 모터, 메카넘 104·96 mm 외 바퀴, REV Smart Robot Servo V1은 질량이 없다(재질 추정)                                                          |
| goBILDA 5202 계열            | 5202·5203·5204가 같은 구성 태그라 5203 열로 본다(계열 질량 차이는 §10.2)                                                                                                                                                   |
| 대체 상자 관성               | 균일 직육면체 식을 낮춘 무게중심(0.35 c)에 그대로 쓴다                                                                                                                                                                     |
| 저울 맞추기                  | 모든 추정 파트에 같은 비율. 재질별·부품별 보정 없음                                                                                                                                                                        |
| 로봇 무게중심 표시           | 실행 중 관절이 움직여 바뀐 로봇 무게중심은 시뮬레이터가 보내지 않아 표시되지 않는다                                                                                                                                        |
| 위치 표기                    | 코드 변경에 맞춰 이 문서의 위치(파일·상수)도 고친다. `docs/assumptions.md` 3a 표와 같은 이름을 쓴다                                                                                                                        |

남은 일(실측으로 바꿀 값, `docs/assumptions.md` 3a 표의 측정 방법):

| 값                                    | 측정 방법                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 로봇 질량(13.6 kg)                    | 로봇을 저울로 단다. 팀 칸: Rigidbody 카드 저울 무게                                                                                        |
| 무게중심 높이(외곽 높이 × 0.35)       | 기울임 시험: 한쪽 바퀴 줄을 축으로 들어 올려 저절로 넘어가기 시작하는 각 θ를 잰다. 무게중심 높이 ≈ (축에서 무게중심까지 수평 거리) ÷ tan θ |
| 기본 재질                             | 팀 칸: Rigidbody 카드 기본 재질                                                                                                            |
| 출력물 껍질 두께·채움률               | 팀 슬라이서의 벽 수 × 선 폭, 위·아래 층 수 × 층 높이를 읽는다. 출력물 하나를 달아 CAD 부피와 견준다. 채움률은 팀 칸                        |
| 출력물 유효 밀도 식                   | 출력물을 달아 견준다. 다르면 질량 카드 질량 덮어쓰기                                                                                       |
| 넓은 범위 재질 밀도(폼·고무·탄소섬유) | 재질 시편을 달아 부피로 나눈다                                                                                                             |
| 이름 규칙 재질(시리즈·낱말)           | 상품 페이지 사양 표를 확인하거나 부품을 달아 CAD 부피로 나눈 밀도를 본다                                                                   |
| 저울 맞추기 정상 범위                 | 재지 않음(경고 문턱)                                                                                                                       |
| COTS 크기 배수                        | 상용 부품 CAD의 비를 더 모아 조정한다                                                                                                      |
| 메시 닫힘 문턱                        | 재지 않음(메시 품질 문턱). 문제 메시는 질량 덮어쓰기                                                                                       |

---

## 21. 원본 조사 자료 상태

아래 문서는 원래 저장소 밖 작업 폴더에 있었고 **사라졌다**. 코드 주석이 이름과 절 번호로 인용하며, 인용한 결론만 이 문서에 옮겼다. 이 문서의 값 가운데 아래 문서에서만 나오는 근거는 **1차 출처로 추적할 수 없다**.

| 사라진 문서                                                             | 코드가 인용한 곳                                                                                                                                                                                                                                                                                   | 이 문서에서 추적 불가능한 것                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec-3a`(3a 명세)                                                      | §1(메시 질량 성질, `MASS_MIN_VOLUME`), §2(`MassSettings.centerOfMass`), §3.1(재질 상속), §3.3(정보 없음 대체값), §6(`useMassModel`·`CenterOfMassIndicator`)                                                                                                                                        | 명세 본문 전체. 코드가 명세에서 왔다고 밝힌 것은 §1의 최소 부피 1e-12와 "M3 나사 약 1e-8 m³" 서술, §3.3의 정보 없음 대체값 규칙, 시험 이름의 "명세 한도 1 s"(키트 메시 질량 계산 시간)뿐이다. 닫힘 문턱 0.02·0.001과 정상 비율 0.6–1.6이 어느 문서에서 왔는지, 대체 상자 규칙을 고른 이유는 기록 없음 |
| `method.md`(§3.3 "ε_V")                                                 | `meshMass.ts` 닫힘 지표의 두 번째 항(축별 부피 퍼짐)                                                                                                                                                                                                                                               | 퍼짐 지표(ε_V)의 유도(코드가 문서가 든 폴더 이름을 적지 않았다. 3a 조사로 추정하지만 기록은 없다). 문턱 0.02·0.001이 이 문서에서 왔는지는 기록 없음                                                                                                                                                   |
| `materials.md`(§4.4)                                                    | `nameRules.ts`: channel·extrusion·tube·bracket·plate·1201–1222 패턴 판 → 알루미늄 가정                                                                                                                                                                                                             | 알루미늄으로 가정한 근거의 원문                                                                                                                                                                                                                                                                       |
| scratchpad CAD 실측(작업 폴더의 상용 부품 STEP)                         | `massModel.ts` `COTS_SIZE_FACTOR` 주석의 9개 부피 ÷ 표 질량 비(goBILDA 5204 모터 0.4, REV Core Hex 0.49, Limelight 3A 0.52, Pinpoint 0.78, REV Smart Robot Servo 1.12, 4-Bar 포드 1.10, Swingarm 포드 1.04, Axon MAX 1.02, 메카넘 96 mm 1.17)와 겉보기 밀도 1.9–7.4 g/cm³, 단순화 CAD의 161 g·48 g | 실측에 쓴 STEP 파일과 CAD 부피 원자료. 시험이 고정한 네 부피(서보 25.75, 4-Bar 34.2, Pinpoint 11.59, Limelight 17.92 cm³)만 남아 있다                                                                                                                                                                 |
| goBILDA 예제 STEP(3200-2627-0004)                                       | `massModel.test.ts` U-channel 시험의 CAD 부피 5개, CLAUDE.md의 키트 8.07 kg·메시 1761개·삼각형 860만 개                                                                                                                                                                                            | STEP 파일 자체는 저장소에 없다(시험은 고정값만 쓴다). 데이터시트 4.38 kg·추정 3.68 kg의 내역                                                                                                                                                                                                          |
| 조사일 2026-11-02의 상품 페이지 값                                      | `cotsTable.ts`의 모든 질량(goBILDA·REV 페이지 "Specs › Weight")                                                                                                                                                                                                                                    | 페이지 사본. 지금 페이지와 다를 수 있고 URL만 남아 있다                                                                                                                                                                                                                                               |
| 3c 조사·명세(`p12drive/research/data.md` §2.2–2.3·§5.1, `spec-3c` §1.7) | `play/worldSpec.ts`·`wheelData.ts`의 바퀴 질량·회전 관성·섀시 하한                                                                                                                                                                                                                                 | `drivetrain.md` §21에 같은 목록이 있다                                                                                                                                                                                                                                                                |
| 3b 명세(`spec-3b` §1-10)                                                | `play/worldJoints.ts` 대체 몸체 질량 1 g                                                                                                                                                                                                                                                           | `motors-joints.md`에 같은 목록이 있다                                                                                                                                                                                                                                                                 |

남아 있는 1차 출처는 코드 주석에 적힌 URL뿐이다(§6, §7, §9, §11). URL이 죽었거나 페이지가 바뀌었을 수 있다(§19). "출처 기록 없음"이라고 쓴 값은 코드·CLAUDE.md·`docs/assumptions.md` 어디에도 출처가 없는 값이다. 해석 시험(`meshMass.test.ts`: 해석해·CAx-IF 부피, `massModel.test.ts`: 합성·U-channel)이 계산의 정합성을 고정하지만, 재질 밀도·COTS 질량·이름 규칙의 재질 배정·문턱 값이 실제 팀 로봇에 맞는지는 저울 무게와 실측 전까지 가정이다.
