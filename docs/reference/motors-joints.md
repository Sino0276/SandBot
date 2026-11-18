# 모터·서보·관절 동역학(3b) 기준 문서

이 문서는 SandBot 시뮬레이터의 3b 단계(기어모터·허브 펌웨어 제어·서보·메커니즘 관절 동역학)가 쓰는 모든 치수·상수·표·수식·결정사항을 한곳에 적는다. 원본 조사·명세 문서(`p10mass`, `p11joint` 폴더)는 저장소 밖 작업 폴더에 있다가 사라졌으므로, 코드(`src/shared/sim/actuators.ts`, `actuatorData.ts`, `motorTypes.ts`, `motorOutputs.ts`, `physics.ts`, `articulation.ts`, `encoderVelocity.ts`, `world.ts`의 구동 부분, `src/renderer/src/scene/joint.ts`, `src/renderer/src/play/worldJoints.ts`, `worldSpec.ts`의 관절·구동기 검증)와 CLAUDE.md의 서술이 곧 원본이다. 각 값은 값 · 단위 · 위치(파일·상수·함수 이름, 줄 번호 없음) · 상태(`[확인: …]` 출처 기재, `[가정: …]` 출처 없는 가정, `[결정: …]` 설계 결정, 표시 없는 코드 값 — 정확한 뜻은 아래 "상태 표기의 뜻")와 근거를 적었고, 코드에 출처가 없으면 "출처 기록 없음"이라고 썼다. 수식은 코드의 변수 이름을 그대로 써서 다시 구현할 수 있게 했다. 단위는 내부 SI(미터·라디안·N·N·m·초)다.

상태 표기의 뜻: 이 문서의 `[가정: …]`은 코드 주석이 "가정"이라고 적었거나 출처가 없다고 밝힌 값, `[결정: …]`은 코드 주석이 설계 결정이라고 적은 값(`articulation.ts`의 LCP 상수처럼 괄호 표기가 실제로 있는 곳도 있고, 다른 파일은 "결정"·"사용자 결정"이라는 글로만 적혀 있다), `[확인: …]`은 코드 주석이 제조사 데이터시트·SDK 소스·공식 문서(URL이나 조사 문서 절)를 근거로 적은 값이다. 이 파일들의 주석은 `[확인: …]` 괄호를 직접 쓰지 않고 출처만 적으므로, 이 문서의 `[확인]`은 "출처가 기재됨"이라는 분류이지 이 세션에서 출처를 다시 열어 본 것이 아니다. 표시가 없는 값은 설계상 정한 코드 값이거나 수치·안정화 상수다.

## 목차

1. 범위·파일·데이터 흐름
2. 공통 상수(중력·전압·격자)
3. SDK 모터 형식 표와 엔코더 틱
4. 기어모터 데이터시트 표(모델·감속비별 토크·속도·전류)
5. DC 모터 식과 VNH5050 전원단
6. 허브 펌웨어 제어 루프(주기·PIDF·16.16·속도 측정)
7. 서보 모델
8. 관절 동역학(좌표·CRBA·RNEA·암시 오일러·구속 LCP)
9. 구동기를 관절 좌표에 거는 방법(`world.ts`)
10. 관절 설정 기본값·범위와 세계 설명 한도
11. 세계 설명 빌더 규칙(`worldJoints.ts`)
12. 리밋 스위치
13. 인스펙터 계산값(`jointCardModel.ts`)
14. 설계 결정·Unity 대응·임시 편차
15. 알려진 한계·남은 일
16. 원본 조사 자료 상태
17. 외부 출처 목록(코드 주석에 적힌 것)

---

## 1. 범위·파일·데이터 흐름

### 1.1 파일 지도

| 파일                                                            | 역할                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/shared/sim/motorTypes.ts`                                  | 구성 XML 태그 → SDK 모터 형식(틱·기어·RPM·회전 방향). 사이드카 `MotorConfigurationType`과 같은 표            |
| `src/shared/sim/motorOutputs.ts`                                | 사이드카 motor 출력 해석(`readMotorOutputs`), 기준 전압 `NOMINAL_VOLTAGE`                                    |
| `src/shared/sim/actuatorData.ts`                                | 모델·감속비별 기어모터 데이터시트 표, 서보 모델 표, 엔코더 카운트. `resolveMotorParams`·`resolveServoParams` |
| `src/shared/sim/actuators.ts`                                   | `DcGearMotor`(DC 모터·VNH5050), `HubMotorController`(허브 펌웨어), `servoCommand`·`servoTerms`(서보)         |
| `src/shared/sim/encoderVelocity.ts`                             | 허브 50 ms 속도 측정 `HubVelocityWindow`                                                                     |
| `src/shared/sim/physics.ts`                                     | 중력 `GRAVITY`                                                                                               |
| `src/shared/sim/articulation.ts`                                | 감소 좌표 관절 나무(CRBA·RNEA·암시 오일러·상자 LCP·한계 충격). 3c 기저·접촉 행도 같은 파일                   |
| `src/shared/sim/world.ts`                                       | `PhysicsWorld`: 허브 제어 표본, 구동 힘 조립(`driveForces`), 하위 단계 격자, 엔코더 틱, 리밋 스위치 입력     |
| `src/shared/sim/worldSpec.ts`                                   | 세계 설명 타입(`SimJointSpec`·`SimMotorParams`·`SimServoParams`)과 메인 쪽 검증·한도                         |
| `src/renderer/src/scene/joint.ts`                               | 관절 설정(`SceneObject.joint`) 기본값·범위·정리(`sanitizeJoint`)                                             |
| `src/renderer/src/play/worldJoints.ts`                          | 씬의 관절 설정·질량 모델 → 세계 설명 관절(`buildWorldJoints`), 몸체 나누기(`jointBodyFrames`)                |
| `src/renderer/src/editor/joint/jointCardModel.ts`               | 인스펙터 Articulation Body 카드의 계산값(최고 속도·정지 토크 대비 부하)                                      |
| `sidecar/sdk/org/sandbot/sdk/devices/SimDcMotorController.java` | 팀 코드 쪽 허브 컨트롤러 흉내: 모드·power·목표 속도·PIDF 16.16 저장. 시뮬레이터가 읽는 출력의 원천           |

### 1.2 데이터 흐름

1. 팀이 하이어라키 오브젝트에 관절(`SceneObject.joint`)을 붙이고, 모터(`motors`)·서보(`servo`)·다단 단(`stages`)을 인스펙터에서 연결한다.
2. INIT 때 렌더러가 `buildWorldJoints`로 세계 설명 `SimJointSpec[]`(최대 16개, 부모가 먼저)를 만든다. 모터는 `resolveMotorParams`, 서보는 `resolveServoParams`로 데이터시트 값을 풀어 넣는다.
3. 메인 `parseWorldSpec`이 모양·한도·참조를 검증하고, `PhysicsWorld`(`world.ts`)가 `Articulation`(`articulation.ts`)을 만든다.
4. 사이드카가 틱마다(기본 5 ms 가상) 모터 `mode`·`power`·`velocity`·`enabled`·`zeroPower`·`targetPosition`·`encoderOffset`·`encoderResets`·`velocityPidf`·`positionPidf`, 서보 `pulseUs`·`pwm` 출력을 보낸다.
5. `PhysicsWorld.integrate`가 앞 틱의 출력을 그 구간 동안 일정하다고 보고, 구간을 1 ms 절대 격자 하위 단계로 나눠 `substep`마다 ① 10 ms 표본 시각이면 허브 제어기를 한 번 돌리고 ② 전력단 상태를 정하고 ③ `Articulation.step`으로 푼 뒤 ④ 엔코더 원시 틱을 센다.
6. 틱 경계에서 `position`(원시 틱 floor)·`velocity`(허브 50 ms 측정)·`current`·리밋 스위치 입력을 사이드카로 돌려준다.

### 1.3 좌표·부호 규약

| 항목        | 규약                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 로봇 좌표   | X 앞·Y 왼쪽·Z 위, 원점 로봇 중심 바닥. 중력은 (0, 0, −GRAVITY). 바퀴가 있으면(3c) 몸체 틀은 필드 좌표                                 |
| 관절 변위 q | 회전 rad, 직선 m. 편집 자세가 q = 0                                                                                                   |
| 관절 축     | 오브젝트 로컬 x·y·z 중 하나 × 부호(`axisSign`). 회전은 오른손 +, 직선은 그 방향 +                                                     |
| 회전 행렬   | X(롤)·Y(피치)·Z(요) 라디안, R = Rz·Ry·Rx(Three.js Euler 'ZYX', `rotationZYX`)                                                         |
| 공간 6-벡터 | [각; 선], 로봇(관절 나무 틀) 원점 기준 Plücker 좌표                                                                                   |
| 관성 6성분  | [Ixx, Iyy, Izz, Ixy, Ixz, Iyz], 행렬 값 그대로(Ixy = −∫xy dm)                                                                         |
| 허브 부호   | 사이드카 power·velocity는 허브 방향(형식 회전 방향·setDirection을 SDK가 적용한 뒤). 시뮬레이터는 `forwardSign`으로 "앞" 부호로 바꾼다 |

---

## 2. 공통 상수(중력·전압·격자)

| 항목                     | 값                           | 단위          | 위치                                           | 상태·근거                                                                                                                                                                                                               |
| ------------------------ | ---------------------------- | ------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 표준 중력 가속도         | 9.80665                      | m/s²          | `physics.ts` `GRAVITY`                         | [확인: NIST g_n 정의값, CGPM 1901, https://physics.nist.gov/cgi-bin/cuu/Value?gn ]. 3b는 로봇이 바닥 평면에 있어 로봇 좌표의 중력이 늘 (0, 0, −GRAVITY)                                                                 |
| 중력 복제                | 9.80665                      | m/s²          | `jointCardModel.ts` `GRAVITY`                  | 인스펙터 계산값용 같은 값(코드에 따로 적힘)                                                                                                                                                                             |
| 기준(정격) 전압          | 12                           | V             | `motorOutputs.ts` `NOMINAL_VOLTAGE`            | 데이터시트 값(정지 토크·무부하 속도·전류)이 12 V 기준이라 R·Ke 유도에 쓴다. 형식의 maxRPM도 12 V 무부하 값                                                                                                              |
| 기본 배터리 전압         | 12.5                         | V             | `src/shared/play.ts` `DEFAULT_BATTERY_VOLTAGE` | docs/assumptions.md 상태 "근사". 실행 동안 일정(전압 강하 모델 없음). 설정 범위 `MIN_BATTERY_VOLTAGE` 9 ~ `MAX_BATTERY_VOLTAGE` 14.5 V, 세계 설명 검사 범위는 1–30 V                                                    |
| 모터 토크·속도 전압 비례 | 정지 토크·무부하 속도 ∝ V/12 | -             | `jointCardModel.ts` `RATED_VOLTAGE` = 12       | 근사(DC 모터 식, 인덕턴스 무시). 시뮬레이터 본체는 `DcGearMotor`에서 단자 전압 u에 배터리 전압 V를 직접 쓴다(§5)                                                                                                        |
| 서보 전원                | 허브 5 V, 배터리와 무관      | -             | `jointCardModel.ts` 서보 계산값 줄             | [가정: 허브 서보 레귤레이터]                                                                                                                                                                                            |
| 하위 단계 길이           | 1 000 000                    | ns            | `world.ts` `SUBSTEP_NANOS`                     | 0 ns부터의 절대 격자(1 ms 배수). 틱 경계가 격자 사이에 있으면 그 틱 구간 끝이 짧은 하위 단계가 된다                                                                                                                     |
| 하위 단계 수 한도        | 10 000                       | 개            | `world.ts` `MAX_SUBSTEPS`                      | 구간이 길어 `dtNanos/cell > MAX_SUBSTEPS − 2`이면 `cell`을 ×10 하며 키운다(`gridSubsteps`)                                                                                                                              |
| 허브 제어 주기           | 10 000 000                   | ns            | `actuators.ts` `HUB_CONTROL_PERIOD_NANOS`      | [가정: 공개 출처 없음. gm0 "a 5 value ring buffer, which has a new value added to it every 10 ms"와 WPILib ExpansionHubVelocityConstants "The motor control period is 10ms"에 맞춤]. 0 ns부터 고정 격자에서 표본을 뜬다 |
| 허브 PWM 듀티 전체값     | 32767                        | 카운트        | `actuators.ts` `DUTY_FULL_SCALE`               | gm0 sdk-motors "a two byte short from -32767 to 32767"(코드 주석 인용). 속도 루프 출력 u의 포화 한계                                                                                                                    |
| 질량 행렬 대각 바닥      | 1e-9                         | kg·m² 또는 kg | `articulation.ts` `MIN_COORDINATE_INERTIA`     | [가정: 1 g 점질량이 1 mm 떨어진 관성]. 몸체 관성이 축 둘레로 0이고 회전자도 없는 관절에서 질량 행렬이 특이해지지 않게 `M_z` 대각에 더한다                                                                               |
| 한계 근처 범위           | 1e-3                         | m 또는 rad    | `articulation.ts` `LIMIT_MARGIN`               | [가정: FTC 관절이 한 하위 단계(1 ms)에 움직이는 양(1 m/s·10 rad/s에서 1 mm·0.01 rad)과 같은 크기]. 한계 행을 늘 넣는 범위                                                                                               |
| 한계 초과 허용           | 1e-12                        | m 또는 rad    | `articulation.ts` `LIMIT_TOLERANCE`            | [가정: 배정밀도 반올림(상대 2.2e-16 × 크기 × 연산 수십 번)보다 크고 µm 침투보다 훨씬 작음]. 풀이 뒤 이만큼 넘으면 빠진 한계 행을 더해 다시 푼다                                                                         |

---

## 3. SDK 모터 형식 표와 엔코더 틱

### 3.1 SDK `@MotorType` 표(`motorTypes.ts` `MOTOR_TYPES`)

[확인: SDK 12.0 `@MotorType` 값. 사이드카 `MotorConfigurationType.java`와 같은 표이며 `motorTypes.test.ts`가 그 Java 파일과 값을 대조한다.] 형식은 계열당 감속비 하나만 안다. 구성 XML에 없는 태그는 `Motor`(UnspecifiedMotor)로 본다(`motorType`).

| 구성 태그                              | ticksPerRev(형식 기어비에서 출력축 1회전) | gearing(형식이 가정하는 감속비) | maxRPM(12 V 출력축 무부하) | orientation | ticksPerRev ÷ gearing(모터축 카운트로 환산한 값) | `hubMaxTicksPerSecond`(틱/s) |
| -------------------------------------- | ----------------------------------------- | ------------------------------- | -------------------------- | ----------- | ------------------------------------------------ | ---------------------------- |
| `goBILDA5201SeriesMotor`               | 1500                                      | 54                              | 104                        | CCW         | 27.7778                                          | 2210                         |
| `goBILDA5202SeriesMotor`               | 2786                                      | 99.5                            | 60                         | CCW         | 28                                               | 2368                         |
| `Matrix12vMotor`                       | 1478.4                                    | 52.8                            | 190                        | CW          | 28                                               | 3979                         |
| `NeveRest20Gearmotor`                  | 560                                       | 20                              | 315                        | CW          | 28                                               | 2499                         |
| `NeveRest3.7v1Gearmotor`               | 44.4                                      | 3.7                             | 1784                       | CCW         | 12                                               | 1122                         |
| `NeveRest40Gearmotor`                  | 1120                                      | 40                              | 160                        | CCW         | 28                                               | 2539                         |
| `NeveRest60Gearmotor`                  | 1680                                      | 60                              | 105                        | CCW         | 28                                               | 2499                         |
| `RevRobotics20HDHexMotor`              | 560                                       | 20                              | 300                        | CCW         | 28                                               | 2380                         |
| `RevRobotics40HDHexMotor`              | 1120                                      | 40                              | 150                        | CCW         | 28                                               | 2380                         |
| `RevRoboticsCoreHexMotor`              | 288                                       | 36.25                           | 137                        | CCW         | 7.9448                                           | 559                          |
| `RevRoboticsUltraplanetaryHDHexMotor`  | 560                                       | 20                              | 300                        | CW          | 28                                               | 2380                         |
| `StudicaMaverick`                      | 1464                                      | 61                              | 100                        | CW          | 24                                               | 2074                         |
| `TetrixMotor`                          | 1440                                      | 52                              | 165                        | CW          | 27.6923                                          | 3366                         |
| `Motor`(UnspecifiedMotor, 모르는 태그) | 1440                                      | 52                              | 165                        | CW          | 27.6923                                          | 3366                         |

### 3.2 형식 값에서 파생되는 식

| 항목                            | 식                                                    | 위치                                           | 비고                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 달성 가능 최대 RPM 비율         | 0.85                                                  | `motorTypes.ts` `ACHIEVEABLE_MAX_RPM_FRACTION` | [확인: SDK `@MotorType` `achieveableMaxRPMFraction` 기본값, 모든 내장 형식]                                                                                                                                |
| 허브 최대 엔코더 속도(틱/s)     | `hubMax = round(ticksPerRev · maxRPM · 0.85 / 60)`    | `hubMaxTicksPerSecond`                         | SDK `getAchieveableMaxTicksPerSecondRounded`와 같은 반올림. 엔코더는 모터축에 있어 기어박스와 관계없다. 엔코더 모드 `setPower(p)`는 목표 속도 `p · hubMax`(사이드카 `SimDcMotorController`가 `(int)` 절삭) |
| 출력축 1회전 틱(바퀴·자유 모터) | `ticksPerOutputRev = ticksPerRev / gearing · gearbox` | `motorTypes.ts` `ticksPerOutputRev`            | 예: goBILDA 312 RPM은 2786 ÷ 99.5 × 19.2 = 537.6. `gearbox`는 모터 컴포넌트가 정한 실제 감속비                                                                                                             |
| 12 V 무부하 출력축 각속도       | `ω_free = maxRPM · gearing / gearbox · 2π/60`         | `noLoadOutputRadPerSec`                        | 인스펙터 계산값용                                                                                                                                                                                          |
| 형식 회전 부호                  | CCW 형식 −1, CW 형식 +1                               | `rotationSign`                                 | 실제 `DcMotorImpl`이 CCW 형식의 FORWARD를 뒤집어 허브에 보낸다                                                                                                                                             |
| 허브 각 → 모터 좌표("앞") 부호  | `forwardSign = rotationSign(type) · directionSign`    | `world.ts` `Motor.forwardSign`                 | `directionSign`은 인스펙터 방향(forward +1, reverse −1). 인스펙터 방향이 "+power면 바퀴가 앞으로 구르는 방향"의 기준                                                                                       |

### 3.3 관절 모터의 출력축 1회전 엔코더 틱

관절을 구동하는 모터는 SDK 규칙(위 `ticksPerRev ÷ gearing × gearbox`)이 아니라 **제조사 모터축 카운트 × 물리 감속비**를 쓴다(`actuatorData.ts` `jointEncoderTicksPerOutputRev(modelTag, gearbox) = encoderCountsPerMotorRev × gearbox`, `world.ts`가 관절 모터에만 적용). 바퀴·어디에도 붙지 않은 모터는 SDK 규칙이다(`world.ts` 모터 생성부). 그래서 감속비 칸이 0인 Core Hex 등은 토크와 엔코더의 감속비가 두 출처다(§15).

| 계열(구성 태그)                    | `encoderCountsPerMotorRev`(모터축 카운트) | 상태·근거                                                                                                                      |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| goBILDA 5202 계열                  | 28                                        | [확인: goBILDA 5203 Specs "Encoder Countable Events Per Revolution (Encoder Shaft)", [ACT] §2.1]                               |
| goBILDA 5201                       | 28                                        | [확인: 5201 페이지 Specs 엔코더축 28, 출력축 1,497.325 = 28 × 53.475] (SDK 형식 1500 ÷ 54 = 27.78이 아님)                      |
| REV HD Hex·UltraPlanetary          | 28                                        | [확인: REV motor-based-encoders "At the motor - 28 counts/revolution", HD Hex 표의 출력축 560·1120 = 28 × 20·40]               |
| REV Core Hex                       | 4                                         | [확인: REV 페이지 "Encoder Counts per Revolution" 출력축 288 = 4 × 72]                                                         |
| NeveRest Classic 40·60, Orbital 20 | 28                                        | [확인: 맨 모터 엔코더 7 ppr × 4 = 28, [ACT] §2.4, AndyMark neverest-classic-motor-only]                                        |
| NeveRest Orbital 3.7               | 28                                        | [가정: AndyMark Orbital 3.7 페이지의 출력축 카운트를 열지 못했다. SDK 형식 44.4(= 12 × 3.7)는 이 엔코더와 맞지 않아 쓰지 않음] |
| TETRIX TorqueNADO                  | 24                                        | [확인: 같은 데이터시트의 출력축 480·960·1440 cpr(20·40·60:1)] (SDK TetrixMotor 1440 ÷ 52 = 27.7은 옛 모터 값)                  |
| Studica Maverick                   | 24                                        | 6 펄스 × 4 = 24(SDK StudicaMaverick 1464 = 24 × 61과 같음)                                                                     |
| MATRIX 12V                         | 28                                        | goBILDA와 같은 맨 모터·엔코더(SDK Matrix12vMotor 1478.4 = 28 × 52.8과 같음)                                                    |
| 형식을 모르는 모터(`Motor`)        | 28(goBILDA 계열 값)                       | [가정: FTC에서 가장 흔한 goBILDA 계열로 봄]                                                                                    |

원시 엔코더(소수): `raw = forwardSign · (ticksPerRev / 2π) · z[coordinate]`(`world.ts` `substep`, `ticksPerRad = ticksPerRev/(2π)`, `z`는 모터 출력축 각 φ). 사이드카로 보내는 `position`은 `floor(raw)`.

---

## 4. 기어모터 데이터시트 표(모델·감속비별 토크·속도·전류)

`resolveMotorParams(modelTag, gearbox | 'default', overrides)`가 `SimMotorParams`(출력축 정지 토크·무부하 속도, 정지·무부하 전류, 물리 감속비, 효율, 회전자 관성, 모터축 역구동 마찰)를 돌려준다. 정지 토크·무부하 속도는 **12 V 출력축 제조사 값(기어 손실 포함)**이다(사용자 결정, spec-3b 결정 1). 정지·무부하 전류도 제조사 값이다.

### 4.1 단위 환산 상수(`actuatorData.ts`)

| 상수   | 값                | 의미          |
| ------ | ----------------- | ------------- |
| `KGCM` | 0.0980665         | 1 kg·cm → N·m |
| `OZIN` | 0.00706155        | 1 oz-in → N·m |
| `RPM`  | 2π/60 = 0.1047198 | 1 rpm → rad/s |
| `DEG`  | π/180             | 1° → rad      |

### 4.2 공통 물리 가정(`actuatorData.ts`)

| 항목                                                                                      | 값                           | 단위  | 위치(상수)                    | 상태·근거                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ---------------------------- | ----- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RS-555급 맨 모터 회전자 관성(goBILDA·REV HD Hex·NeveRest·TorqueNADO·Maverick·MATRIX 공통) | 3.0e-6                       | kg·m² | `RS555_ROTOR_INERTIA`         | [가정: 제조사가 공개하지 않아 같은 급 철심 모터(Pittman 8224S006 1.62e-6, 9234S006 4.17e-6)의 지름 축척과 기하 추정의 가운데로 정함. 범위 2–5e-6, [DATA] §1.3]. 측정: 기어박스를 뗀 맨 모터를 일정 전압으로 돌린 뒤 단자를 열고 감속을 엔코더로 기록(J = τ_f ÷ 각감속) 또는 전압 계단 응답 τ_m = J·R/(Kt·Ke)                                  |
| Core Hex 맨 모터 회전자 관성                                                              | 5e-7                         | kg·m² | `CORE_HEX_ROTOR_INERTIA`      | [가정: 크기를 380급 Ø24 × 30 mm로 보고 Pittman 축척, 범위 2e-7–1e-6, [DATA] §1.4]                                                                                                                                                                                                                                                             |
| RS-555 모터축 역구동(정지) 마찰                                                           | 2.3e-3                       | N·m   | `RS555_BACKDRIVE_FRICTION`    | NeveRest Classic 40·60의 출력축 역구동 토크(0.067 ft-lb = 0.0908 N·m, 0.1 ft-lb = 0.1356 N·m)를 감속비로 나누면 2.27·2.26 mN·m로 거의 같아 모터 쪽 쿨롱 마찰로 봄([DATA] §3.2, critique §1.3). goBILDA·REV도 같은 RS-555라 같이 씀(가정). 측정: 전원을 뗀 기어모터 출력축 레버에 추를 늘려 돌기 시작하는 질량 m, 모터축 마찰 = m·g·L ÷ 감속비 |
| Core Hex 모터축 역구동 마찰                                                               | 0.7e-3                       | N·m   | `CORE_HEX_BACKDRIVE_FRICTION` | [가정: 모터축 정지 토크 3.2/72 = 0.044 N·m가 goBILDA 맨 모터 0.144 N·m의 0.31배라 그 비율로 줄임]                                                                                                                                                                                                                                             |
| 유성 기어 단당 효율                                                                       | 0.95                         | -     | `PLANETARY_STAGE_EFFICIENCY`  | [결정: spec-3b 결정 2, 사용자 결정 여부는 코드에 기록 없음]. gm0 gearbox-anatomy "two stage planetary gearboxes are 94% efficient"와 goBILDA 표에서 파생한 2단 ≈0.90의 가운데([DATA] §3.1)                                                                                                                                                    |
| 평기어 박스 효율                                                                          | 0.85                         | -     | `SPUR_EFFICIENCY`             | gm0 "two-stage spur gearbox is about 85%"                                                                                                                                                                                                                                                                                                     |
| Core Hex 효율                                                                             | 0.7                          | -     | `CORE_HEX_EFFICIENCY`         | [가정: 90° 단의 기어 형식이 공개되지 않음]                                                                                                                                                                                                                                                                                                    |
| 표 감속비 일치 허용 오차                                                                  | ln(1.015) (로그 거리 ±1.5 %) | -     | `RATIO_TOLERANCE`             | goBILDA의 반올림한 감속비(5.2 대 5.1818, 188 대 188.61)를 받으려는 값. 설계 값                                                                                                                                                                                                                                                                |

기어 효율의 측정 방법(assumptions.md): 12 V에서 출력축 정지 토크를 레버·저울로 짧게 재고 같은 전류의 맨 모터 토크 × 감속비와 견준다(η = τ_출력 ÷ (G·Kt·I)).

### 4.3 계열 표(`MOTOR_FAMILIES`)

구성 태그 하나가 계열 하나다. 모르는 태그는 `Motor` 계열(= goBILDA 5202 계열 값 + 감속비 기본 52)로 본다.

| 계열(구성 태그)                     | 정지 전류 12 V (A) | 무부하 전류 12 V (A) | 회전자 관성 | 역구동 마찰 | 고정 효율 `efficiency` | `maxStageRatio`(유성 한 단의 최대 감속비) | `defaultRatio`(gearbox 0일 때 실제 감속비) | 엔코더 카운트/모터축 |
| ----------------------------------- | ------------------ | -------------------- | ----------- | ----------- | ---------------------- | ----------------------------------------- | ------------------------------------------ | -------------------- |
| goBILDA5202SeriesMotor              | 9.2                | 0.25                 | 3.0e-6      | 2.3e-3      | 없음(유성 단당 0.95)   | 1 + 46/11 = 5.1818                        | (1+46/17)·(1+46/11)² = 99.5075             | 28                   |
| goBILDA5201SeriesMotor              | 9.2                | 0.25                 | 3.0e-6      | 2.3e-3      | 0.85                   | 53.475                                    | 53.475                                     | 28                   |
| RevRoboticsUltraplanetaryHDHexMotor | 8.5                | 0.4                  | 3.0e-6      | 2.3e-3      | 없음(유성 단당 0.95)   | 68/13 = 5.2308                            | (76/21)·(68/13) = 18.9304                  | 28                   |
| RevRobotics20HDHexMotor             | 8.5                | 0.4                  | 3.0e-6      | 2.3e-3      | 0.85                   | 20                                        | 20                                         | 28                   |
| RevRobotics40HDHexMotor             | 8.5                | 0.4                  | 3.0e-6      | 2.3e-3      | 0.85                   | 40                                        | 40                                         | 28                   |
| RevRoboticsCoreHexMotor             | 4.4                | 0.2                  | 5e-7        | 0.7e-3      | 0.7                    | 72                                        | 72                                         | 4                    |
| NeveRest40Gearmotor                 | 11.5               | 0.4                  | 3.0e-6      | 2.3e-3      | 0.85                   | 40                                        | 40                                         | 28                   |
| NeveRest60Gearmotor                 | 11.5               | 0.4                  | 3.0e-6      | 2.3e-3      | 0.85                   | 60                                        | 60                                         | 28                   |
| NeveRest20Gearmotor(Orbital 20)     | 11                 | 0.4                  | 3.0e-6      | 2.3e-3      | 없음(2단: 0.9025)      | 5.2                                       | 19.2                                       | 28                   |
| NeveRest3.7v1Gearmotor(Orbital 3.7) | 11                 | 0.4                  | 3.0e-6      | 2.3e-3      | 없음(1단: 0.95)        | 5.2                                       | 3.7                                        | 28                   |
| TetrixMotor(TorqueNADO)             | 8.7                | 0.3                  | 3.0e-6      | 2.3e-3      | 0.85                   | 60                                        | 60                                         | 24                   |
| StudicaMaverick                     | 11                 | 0.6                  | 3.0e-6      | 2.3e-3      | 0.85                   | 61                                        | 61                                         | 24                   |
| Matrix12vMotor                      | 9.2                | 0.25                 | 3.0e-6      | 2.3e-3      | 0.85                   | 52.8                                      | 52.8                                       | 28                   |
| Motor(형식 모름)                    | 9.2                | 0.25                 | 3.0e-6      | 2.3e-3      | 없음(유성 단당 0.95)   | 5.1818                                    | 52(SDK `Motor` gearing)                    | 28                   |

전류 값의 상태·근거:

| 항목                            | 값                                                                       | 상태·근거                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| goBILDA 정지·무부하 전류        | 9.2 A, 0.25 A(모든 감속비)                                               | [확인: goBILDA 5203 상품 페이지 Specs 표, [ACT] §2.1]                                                     |
| REV HD Hex 정지·무부하 전류     | 8.5 A, 0.4 A                                                             | [확인: REV-41-1291 REV 문서(12 V, 6000 rpm, 0.105 N·m, 8.5 A, 0.4 A)]                                     |
| REV Core Hex 정지 전류          | 4.4 A                                                                    | [확인: REV 문서]                                                                                          |
| REV Core Hex 무부하 전류        | 0.2 A                                                                    | REV 페이지에 없어 gm0 motor-power 표의 Core Hex 줄(제품 값)을 씀(코드 주석)                               |
| NeveRest 맨 모터                | 정지 11.5 A, 무부하 0.4 A                                                | [확인: AndyMark neverest-classic-motor-only, 12 V, 6000 rpm, 0.062 N·m]                                   |
| NeveRest Classic 60 무부하 전류 | 0.4 A                                                                    | [가정: 같은 맨 모터라 40과 같게 봄]                                                                       |
| NeveRest Orbital 정지 전류      | 11 A                                                                     | [확인: AndyMark Orbital 20 페이지]                                                                        |
| TETRIX TorqueNADO 정지 전류     | 8.7 A                                                                    | [확인: Pitsco 44260 데이터시트 PDF]                                                                       |
| TETRIX 무부하 전류              | 0.3 A                                                                    | [가정: 공개되지 않아 같은 급 goBILDA 0.25 A와 NeveRest 0.4 A 사이(gm0 다이노는 0.2 A)]                    |
| Studica Maverick 전류           | 정지 11 A, 무부하 0.6 A                                                  | [확인: Studica Maverick 문서(61:1, 무부하 100 rpm·0.6 A, 정지 11 A, 708 oz-in)]                           |
| MATRIX 12V                      | 맨 모터가 goBILDA 맨 모터와 같은 값(6000 rpm, 1.47 kg·cm, 9.2 A, 0.25 A) | [ACT] §2.7. 옛 MR 기어모터 키트의 기어비·토크는 출처가 없어 SDK gearing 52.8과 평기어 효율로 만듦([가정]) |
| goBILDA 5201                    | 9.2 A, 0.25 A                                                            | [확인: 5201 페이지(단종, SKU 5201-0002-0053)]                                                             |
| 기어 형식 미공개 모터 효율      | 평기어 0.85                                                              | [가정: HD Hex 20:1(유성·평기어가 한 SDK 형식), TETRIX, Studica Maverick, MATRIX]                          |

### 4.4 goBILDA 5202/5203/5204 행(`GOBILDA.rows`)

감속비는 goBILDA 식 `S17 = 1 + 46/17 = 3.70588`, `S11 = 1 + 46/11 = 5.18182`의 곱이다. 토크·속도는 5203 상품 페이지 Specs 표 값이다(예: https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-19-2-1-ratio-24mm-length-8mm-rex-shaft-312-rpm-3-3-5v-encoder/ , [확인: [ACT] §2.1]). 정지 토크는 표의 kg·cm 값 × 0.0980665이고 기어 손실을 포함한 출력축 값이다. 효율 η는 `0.95^단수`이며 모터 상수 유도에만 쓴다(`efficiency` 필드가 없으므로).

| 감속비(식) | 감속비 값 | 단수 | 정지 토크(kg·cm) | 정지 토크(N·m) | 무부하(rpm) | η       | 출력축 1회전 카운트(28 × 감속비) |
| ---------- | --------- | ---- | ---------------- | -------------- | ----------- | ------- | -------------------------------- |
| 1(맨 모터) | 1         | 0    | 1.47             | 0.14416        | 6000        | 1       | 28                               |
| S17        | 3.70588   | 1    | 5.4              | 0.52956        | 1620        | 0.95    | 103.76                           |
| S11        | 5.18182   | 1    | 7.9              | 0.77473        | 1150        | 0.95    | 145.09                           |
| S17²       | 13.7336   | 2    | 18.7             | 1.8338         | 435         | 0.9025  | 384.54                           |
| S17·S11    | 19.2032   | 2    | 24.3             | 2.3830         | 312         | 0.9025  | 537.69                           |
| S11²       | 26.8512   | 2    | 38.0             | 3.7265         | 223         | 0.9025  | 751.83                           |
| S17³       | 50.8950   | 3    | 68.4             | 6.7077         | 117         | 0.85737 | 1425.1                           |
| S17²·S11   | 71.1648   | 3    | 93.6             | 9.1790         | 84          | 0.85737 | 1992.6                           |
| S17·S11²   | 99.5075   | 3    | 133.2            | 13.062         | 60          | 0.85737 | 2786.2                           |
| S11³       | 139.138   | 3    | 185              | 18.142         | 43          | 0.85737 | 3895.9                           |
| S17⁴       | 188.611   | 4    | 250              | 24.517         | 30          | 0.81451 | 5281.1                           |

모델 기본(`gearbox` 0) 감속비는 S17·S11² = 99.5075(SDK goBILDA5202Series gearing 99.5와 같은 행). 맨 모터 1:1 행의 정지 토크 0.14416 N·m는 goBILDA 맨 모터 값이다.

### 4.5 REV UltraPlanetary + HD Hex 행(`ultraPlanetaryRows`)

맨 모터: REV-41-1291, 12 V, 6000 rpm, 0.105 N·m(`HD_HEX_STALL` 0.105, `HD_HEX_FREE_RPM` 6000), 정지 8.5 A, 무부하 0.4 A [확인: https://docs.revrobotics.com/duo-build/motion/motors/hd-hex-motor ]. 카트리지 실제 감속비는 3:1 = 84/29, 4:1 = 76/21, 5:1 = 68/13(`UP_CARTRIDGES`, 호칭 `nominal` 3·4·5) [확인: REV cartridge-details 문서]. REV는 토크를 맨 모터 × 감속비(효율 1의 이론값)로 공개하므로 같은 식으로 만들고(견본 표 5.23:1 0.55 N·m·1147 rpm, 18.9:1 1.98 N·m·317 rpm, 54.8:1 5.75 N·m·109.5 rpm과 맞음, [ACT] §2.2), 출력 정지 토크는 기어 손실 포함 값이어야 하므로 기어 효율을 곱한다:

- 카트리지 1–3개(같은 것 반복 가능, 순서 무관: 작은 것부터 고른 중복 조합, `UP_MAX_CARTRIDGES` 3).
- `stallTorque = 0.105 · ratio · 0.95^count` (N·m), `freeRpm = 6000 / ratio`(이론값 그대로, 무부하 손실은 무부하 전류가 나타냄), `stages = count`, 호칭 감속비 `nominal` = 카트리지 호칭(3·4·5)의 곱.
- 1:1 행: 0.105 N·m, 6000 rpm, 0단.
- 모델 기본(`gearbox` 0)은 4:1 + 5:1 = (76/21)·(68/13) = 18.9304:1(SDK RevRoboticsUltraplanetaryHDHexMotor gearing 20 = 호칭 20:1 = 실제 18.93:1).

| 호칭(nominal) | 구성  | 실제 감속비 | 정지 토크(N·m) | 무부하(rpm) | η       | 출력축 1회전 카운트(28 × 감속비) |
| ------------- | ----- | ----------- | -------------- | ----------- | ------- | -------------------------------- |
| 3             | 3     | 2.89655     | 0.28893        | 2071.4      | 0.95    | 81.1                             |
| 4             | 4     | 3.61905     | 0.36100        | 1657.9      | 0.95    | 101.3                            |
| 5             | 5     | 5.23077     | 0.52177        | 1147.1      | 0.95    | 146.5                            |
| 9             | 3·3   | 8.39001     | 0.79506        | 715.14      | 0.9025  | 234.9                            |
| 12            | 3·4   | 10.4828     | 0.99337        | 572.37      | 0.9025  | 293.5                            |
| 15            | 3·5   | 15.1512     | 1.4358         | 396.01      | 0.9025  | 424.2                            |
| 16            | 4·4   | 13.0975     | 1.2412         | 458.10      | 0.9025  | 366.7                            |
| 20            | 4·5   | 18.9304     | 1.7939         | 316.95      | 0.9025  | 530.05                           |
| 25            | 5·5   | 27.3609     | 2.5928         | 219.29      | 0.9025  | 766.1                            |
| 27            | 3·3·3 | 24.3021     | 2.1878         | 246.89      | 0.85737 | 680.5                            |
| 36            | 3·3·4 | 30.3639     | 2.7335         | 197.60      | 0.85737 | 850.2                            |
| 45            | 3·3·5 | 43.8862     | 3.9508         | 136.72      | 0.85737 | 1228.8                           |
| 48            | 3·4·4 | 37.9376     | 3.4153         | 158.15      | 0.85737 | 1062.3                           |
| 60            | 3·4·5 | 54.8329     | 4.9363         | 109.42      | 0.85737 | 1535.3                           |
| 64            | 4·4·4 | 47.4005     | 4.2672         | 126.58      | 0.85737 | 1327.2                           |
| 75            | 3·5·5 | 79.2524     | 7.1346         | 75.707      | 0.85737 | 2219.1                           |
| 80            | 4·4·5 | 68.5100     | 6.1676         | 87.578      | 0.85737 | 1918.3                           |
| 100           | 4·5·5 | 99.0206     | 8.9143         | 60.593      | 0.85737 | 2772.6                           |
| 125           | 5·5·5 | 143.119     | 12.884         | 41.923      | 0.85737 | 4007.3                           |

(출력축 카운트 열은 `jointEncoderTicksPerOutputRev` 식 28 × 실제 감속비로 계산한 값이며 코드가 표로 갖고 있지는 않다. 표의 다른 값은 코드에서 `resolveMotorParams`로 출력한 값이다.)

### 4.6 단일 행 계열

| 계열(구성 태그)                     | 감속비(실제) | 정지 토크 표 값                | 정지 토크(N·m, `resolveMotorParams` 결과) | 무부하(rpm)           | 효율   | 단수 | 상태·근거                                                                                                                                                               |
| ----------------------------------- | ------------ | ------------------------------ | ----------------------------------------- | --------------------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RevRobotics20HDHexMotor             | 20           | 2.1 N·m × 0.85                 | 1.785                                     | 300                   | 0.85   | 0    | [확인: REV 문서 20:1 2.1 N·m·300 rpm]. 표 토크는 0.105 × 감속비(효율 1 이론값)라 평기어 효율을 곱함. 20:1은 유성·평기어가 같은 값이고 SDK 형식이 하나라 평기어로 가정   |
| RevRobotics40HDHexMotor             | 40           | 4.2 N·m × 0.85                 | 3.57                                      | 150                   | 0.85   | 0    | [확인: REV 문서 40:1 Spur 4.2 N·m·150 rpm]                                                                                                                              |
| RevRoboticsCoreHexMotor             | 72           | 3.2                            | 3.2                                       | 125                   | 0.7    | 0    | [확인: REV-41-1300 72:1, 125 rpm, 3.2 N·m, 정지 4.4 A]. 효율 0.7은 [가정]. 토크 값은 효율을 곱하지 않는다                                                               |
| NeveRest40Gearmotor(Classic 40)     | 40           | 2.472 N·m(1.823 ft-lb) × 0.85  | 2.1012                                    | 160                   | 0.85   | 0    | [확인: AndyMark am-2964a 160 rpm]. 표 토크는 맨 모터 × 감속비(0.062 × 40 = 2.48)와 거의 같아 효율을 곱함. Classic은 평기어 박스                                         |
| NeveRest60Gearmotor(Classic 60)     | 60           | 3.707 N·m × 0.85               | 3.15095                                   | 105                   | 0.85   | 0    | [확인: AndyMark am-3103 105 rpm, 3.707 N·m]. 무부하 전류는 40과 같게([가정])                                                                                            |
| NeveRest20Gearmotor(Orbital 20)     | 19.2         | 0.062 × 19.2 × 0.95² (파생)    | 1.0743                                    | 344                   | 0.9025 | 2    | AndyMark 페이지의 19.2:1 ~344 rpm, 정지 11 A는 확인. 감속비별 토크가 페이지에 없어 맨 모터 0.062 N·m × 감속비 × 유성 단 효율로 만든 파생값(Classic과 같이 손실 포함 값) |
| NeveRest3.7v1Gearmotor(Orbital 3.7) | 3.7          | 0.062 × 3.7 × 0.95 (파생)      | 0.21793                                   | 1784                  | 0.95   | 1    | 위와 같음(~1784 rpm)                                                                                                                                                    |
| TetrixMotor 20:1                    | 20           | 233 oz-in                      | 1.64534                                   | 300                   | 0.85   | 0    | [확인: Pitsco 44260 TorqueNADO 데이터시트 PDF]                                                                                                                          |
| TetrixMotor 40:1                    | 40           | 466 oz-in                      | 3.29068                                   | 150                   | 0.85   | 0    | 위와 같음                                                                                                                                                               |
| TetrixMotor 60:1(모델 기본)         | 60           | 700 oz-in                      | 4.94309                                   | 100                   | 0.85   | 0    | 위와 같음. SDK TetrixMotor(옛 W39530, 52:1 165 rpm)의 데이터시트를 찾지 못해 모델 기본은 60:1로 둠([가정])                                                              |
| StudicaMaverick                     | 61           | 708 oz-in(표의 Min 칸)         | 4.99958                                   | 100                   | 0.85   | 0    | [확인: Studica Maverick 문서]                                                                                                                                           |
| Matrix12vMotor                      | 52.8         | 1.47 × 0.0980665 × 52.8 × 0.85 | 6.46980                                   | 113.64(= 6000 / 52.8) | 0.85   | 0    | [가정: 옛 MR 기어모터 키트의 기어비·토크 출처 없음, SDK gearing 52.8과 평기어 효율로 만듦]                                                                              |
| goBILDA5201SeriesMotor              | 53.475       | 51.8 kg·cm                     | 5.07984(표 값 그대로)                     | 105                   | 0.85   | 0    | [확인: goBILDA 5201(단종) 페이지 53.475:1 평기어, 105 rpm, 51.8 kg·cm]. 효율 0.85는 평기어 가정                                                                         |

`NEVEREST_STALL`(맨 모터 정지 토크) 0.062 N·m, `MATRIX_RATIO` 52.8은 위 표의 NeveRest·MATRIX 줄의 근거 상수다. 감속비 52인 `Motor`(형식 모름) 계열은 goBILDA 5202 계열 값(위 §4.4 행, 전류, 관성)을 쓰되 `defaultRatio`만 SDK `Motor` gearing 52로 둔다.

### 4.7 행 선택·외삽(`resolveMotorParams`)

입력: `wanted` = 모터 컴포넌트의 `gearbox`(`MIN_GEARBOX` 0.01 ≤ gearbox ≤ `MAX_GEARBOX` 10000이면 그 값, 아니면 `'default'` = 계열 `defaultRatio`).

1. 계열 행 중 `d = min(logDistance(row.ratio, wanted), logDistance(row.nominal, wanted))`가 가장 작은 행을 `nearest`로 고른다(`logDistance(a, b) = abs(ln(a/b))`, 같으면 먼저 나온 행).
2. `d ≤ RATIO_TOLERANCE`(±1.5 %)이면 그 행의 `ratio`·`stallTorque`·`freeRpm`·`stages`를 그대로 쓴다.
3. 아니면(외삽) 같은 맨 모터로 보고: `ratio = wanted`, `stages = stagesFor(family, ratio)`(1 이하 0, 아니면 `max(1, ceil(ln(ratio)/ln(maxStageRatio) − 1e-9))`), `stallTorque = nearest.stallTorque · (ratio/nearest.ratio) · (η(stages)/η(nearest.stages))`, `freeRpm = nearest.freeRpm · nearest.ratio / ratio`. (토크 ∝ 감속비 × 효율, 속도 ∝ 1/감속비.) 효율 `η(stages) = family.efficiency ?? 0.95^stages`.
4. 결과 `SimMotorParams`: `stallTorque`(덮어쓰기 적용), `freeSpeed = freeRpm · RPM`(rad/s, 덮어쓰기 적용), `stallCurrent`·`freeCurrent`(계열), `gearbox = ratio`, `efficiency = η`, `rotorInertia`·`backdriveFriction`(계열).

예: `Motor`(52:1)는 가장 가까운 행 S17³ = 50.895(로그 거리 약 2.1 % > 1.5 %)에서 외삽해 6.8534 N·m, 114.51 rpm.

### 4.8 팀 덮어쓰기 범위(`MotorOverrides`)

모터 컴포넌트의 `stallTorque`(N·m)·`freeSpeed`(rpm)는 12 V 출력축 값이고 0이면 데이터시트다. 범위 밖(0, 음수, NaN, 손으로 고친 파일의 너무 크거나 작은 값)은 데이터시트를 쓴다(`overrideOr`).

| 항목                    | 값    | 단위 | 위치                          | 근거                                                                                                                     |
| ----------------------- | ----- | ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 정지 토크 덮어쓰기 하한 | 0.001 | N·m  | `MIN_STALL_TORQUE_OVERRIDE`   | 인스펙터 표시 자릿수 한 칸이라 0처럼 보이는 값이 데이터시트와 다르게 돌지 않는다. 세계 설명이 받는 하한(1e-6 N·m)보다 큼 |
| 정지 토크 덮어쓰기 상한 | 100   | N·m  | `MAX_STALL_TORQUE_OVERRIDE`   | goBILDA 188:1 정지 24.5 N·m를 넉넉히 넘고 세계 설명 상한(1e3 N·m)보다 작다                                               |
| 무부하 속도 하한        | 1     | rpm  | `MIN_FREE_SPEED_OVERRIDE_RPM` | 세계 설명 하한(1e-3 rad/s ≈ 0.0095 rpm)보다 큼                                                                           |
| 무부하 속도 상한        | 20000 | rpm  | `MAX_FREE_SPEED_OVERRIDE_RPM` | 맨 모터 6000 rpm을 넉넉히 넘고 세계 설명 상한(1e5 rad/s)보다 작다                                                        |

덮어쓰기는 효율 η와 전류를 바꾸지 않는다(그래서 Kt = 덮어쓴 정지 토크 ÷ (I_stall·G·η)로 유도된다).

### 4.9 계열 기본 감속비에서 유도한 전기 상수(예시 표)

`DcGearMotor`가 §5.1 식으로 낸 값(모델 기본 감속비, 덮어쓰기 없음). R = 12/I_stall, Kt·Ke는 모터축 기준.

| 구성 태그                           | 감속비(실제) | 정지 토크(N·m) | 무부하(rpm) | η       | R(Ω)   | Kt(N·m/A) | Ke(V·s/rad) | 점성 b(N·m·s/rad, 모터축) | 출력축 카운트/회전 |
| ----------------------------------- | ------------ | -------------- | ----------- | ------- | ------ | --------- | ----------- | ------------------------- | ------------------ |
| goBILDA5201SeriesMotor              | 53.475       | 5.0798         | 105         | 0.85    | 1.3043 | 0.01215   | 0.01985     | 4.785e-7                  | 1497.3             |
| goBILDA5202SeriesMotor              | 99.5075      | 13.062         | 60          | 0.85737 | 1.3043 | 0.01664   | 0.01867     | 2.027e-6                  | 2786.2             |
| Matrix12vMotor                      | 52.8         | 6.4698         | 113.64      | 0.85    | 1.3043 | 0.01567   | 0.01858     | 1.639e-6                  | 1478.4             |
| NeveRest20Gearmotor                 | 19.2         | 1.0743         | 344         | 0.9025  | 1.0909 | 0.005636  | 0.01672     | 0                         | 537.6              |
| NeveRest3.7v1Gearmotor              | 3.7          | 0.21793        | 1784        | 0.95    | 1.0909 | 0.005636  | 0.01673     | 0                         | 103.6              |
| NeveRest40Gearmotor                 | 40           | 2.1012         | 160         | 0.85    | 1.0435 | 0.005374  | 0.01728     | 0                         | 1120               |
| NeveRest60Gearmotor                 | 60           | 3.1509         | 105         | 0.85    | 1.0435 | 0.005372  | 0.01756     | 0                         | 1680               |
| RevRobotics20HDHexMotor             | 20           | 1.785          | 300         | 0.85    | 1.4118 | 0.01235   | 0.0182      | 3.024e-6                  | 560                |
| RevRobotics40HDHexMotor             | 40           | 3.57           | 150         | 0.85    | 1.4118 | 0.01235   | 0.0182      | 3.024e-6                  | 1120               |
| RevRoboticsCoreHexMotor             | 72           | 3.2            | 125         | 0.7     | 2.7273 | 0.01443   | 0.01215     | 1.401e-6                  | 288                |
| RevRoboticsUltraplanetaryHDHexMotor | 18.9304      | 1.7939         | 316.95      | 0.9025  | 1.4118 | 0.01235   | 0.0182      | 3.437e-6                  | 530.05             |
| StudicaMaverick                     | 61           | 4.9996         | 100         | 0.85    | 1.0909 | 0.008766  | 0.01776     | 3.398e-6                  | 1464               |
| TetrixMotor                         | 60           | 4.9431         | 100         | 0.85    | 1.3793 | 0.01114   | 0.01844     | 8.608e-7                  | 1440               |
| Motor(형식 모름)                    | 52           | 6.8534         | 114.51      | 0.85737 | 1.3043 | 0.01671   | 0.01872     | 2.055e-6                  | 1456               |

NeveRest의 점성 b가 0인 것은 `η·Kt·I_free − τ_c`가 음수라 0으로 잘리기 때문이다(예: 0.85 × 0.005374 × 0.4 = 1.83e-3 < 2.3e-3). Ke가 Kt와 같지 않은 것(SI에서는 같아야 함)은 두 값이 서로 다른 데이터시트 항목(정지 토크·무부하 속도·전류)에서 따로 유도되기 때문이다.

---

## 5. DC 모터 식과 VNH5050 전원단

### 5.1 DC 모터 상수 유도(`DcGearMotor` 생성자)

사용자 결정(spec-3b §1.1): 데이터시트 값에서 상수를 구한다(인덕턴스는 무시, [ACT] §3.1). V = 12 V(`NOMINAL_VOLTAGE`), G = 감속비(`gearbox`), η = `efficiency`, τ_s = `stallTorque`, I_s = `stallCurrent`, I_0 = `freeCurrent`, ω_f = `freeSpeed`(출력축 rad/s).

| 기호/필드            | 식                                         | 단위      | 의미                                                                    |
| -------------------- | ------------------------------------------ | --------- | ----------------------------------------------------------------------- |
| `resistance` R       | `R = 12 / I_s`                             | Ω         | 정지 전류에서의 단자 저항                                               |
| `torqueConstant` Kt  | `Kt = τ_s / (I_s · G · η)`                 | N·m/A     | 모터축. 출력 정지 토크가 기어 손실 η를 포함한 값이라 η로 되돌림         |
| `backEmfConstant` Ke | `Ke = (12 − I_0·R) / (ω_f · G)`            | V·s/rad   | 모터축. 무부하에서 V = I_0·R + Ke·ω_m이 되도록                          |
| `coulomb` τ_c        | `τ_c = backdriveFriction`                  | N·m       | 모터축 쿨롱 마찰(NeveRest 역구동 마찰에서 유도한 2.3 mN·m, §4.2)        |
| `viscous` b          | `b = max(0, (η·Kt·I_0 − τ_c) / (ω_f · G))` | N·m·s/rad | 모터축 점성. 무부하 전류에 맞춤(3b 비평 C9: 모터축 마찰은 한 번만 센다) |

모터 식: V = I·R + Ke·ω_m, τ_m = Kt·I, ω_m = G·ω_out(출력축 ω).

### 5.2 전력단(`DcGearMotor.terminal`)

VNH5050 H-브리지를 **비동기(asynchronous) PWM**으로 모델링한다(gm0 control-system-internals "does not brake the H-bridge during the PWM off cycle", [ACT] §3.3). 켜짐 구간은 FET가 단자를 ±V_bat에 잇고 꺼짐 구간은 본체 다이오드로만 환류한다. 입력: 전력단 상태(`duty` d ∈ [−1, 1] / `brake` / `float`), 배터리 전압 V_bat(`voltage`), 역기전력 e = Ke·G·ω.

| 상태·조건                                                            | 평균 단자 전압 u                 | 영역 코드              | 해설                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| BRAKE                                                                | u = 0                            | `b`                    | 단자 단락. 결정적(영역은 지금 ω만으로 정함)                                                                            |
| FLOAT 또는 d = 0, 그리고 abs(e) ≤ V_bat + 2·V_f                      | 전류 0(u 없음)                   | `f`(FLOAT)·`0`(듀티 0) | 본체 다이오드 둘을 넘지 못함                                                                                           |
| FLOAT 또는 d = 0, 그리고 abs(e) > V_bat + 2·V_f                      | u = sign(e)·(V_bat + 2·V_f)      | `F`(FLOAT)·`z`(듀티 0) | 회생 전류가 본체 다이오드 둘을 거침. FLOAT로 내리는 속도가 어느 부하에서나 약 0.12·ω_free 올라감                       |
| 0 < abs(d) < 1, 그리고 s·e ≤ abs(d)·V_bat (s = sign(d))              | u = d·V_bat                      | `l`                    | 연속 전도의 평균. 직선 d·V                                                                                             |
| abs(d) ≥ 1                                                           | u = d·V_bat                      | `l`                    | 꺼짐 구간 없음. abs(d) → 1에서 연속                                                                                    |
| 0 < abs(d) < 1, 그리고 s·e > V_bat + (1 − abs(d))·V_f                | u = s·(V_bat + (1 − abs(d))·V_f) | `g`                    | 회생 제동: 켜짐 구간 sign(d)·V_bat, 꺼짐 구간 sign(d)·(V_bat + V_f)의 평균. 경계에서 전류 0이라 토크가 연속            |
| 0 < abs(d) < 1, 그리고 abs(d)·V_bat < s·e ≤ V_bat + (1 − abs(d))·V_f | 전류 0(u 없음)                   | `c`                    | 역기전력이 명령 쪽으로 d·V를 넘으면 전류가 역전해야 하지만 꺼짐 구간의 다이오드가 길을 막아 전류 0으로 자름(회생 없음) |

| 항목                          | 값  | 단위 | 위치                             | 상태·근거                                                                                                                                                                                                                                                             |
| ----------------------------- | --- | ---- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 본체 다이오드 순방향 강하 V_f | 0.7 | V    | `actuators.ts` `BODY_DIODE_DROP` | [가정: 실리콘 본체 다이오드의 보통 값. VNH5050A-E 데이터시트(ST DocID 16009)의 free-wheeling diode 순방향 전압 표를 열지 못했다 — 회생 전류 몇 A에서 0.7–1 V 범위로 봄]. 측정: 데이터시트 Vf 표 확인, 또는 FLOAT·power 0으로 리프트를 떨어뜨린 속도를 power −1과 견줌 |

설계 효과: 1.4 V(= 2·V_f)는 무부하 속도의 역기전력(12 − I_0·R ≈ 11.67 V, goBILDA 0.25 A × 1.3043 Ω = 0.326 V를 뺀 값)의 약 12 %라 FLOAT로 내리는 속도가 power −1보다 약 0.12·ω_free 빠르다. 무시하면 시뮬레이터가 실제보다 느리게 내린다. 전력단 모델은 docs/assumptions.md 상태 "근사".

### 5.3 출력축 일반화 힘·전류(`terms`, `current`)

- `terms(stage, V_bat, ω)`: `u === null`(전류 없음)이면 `{force: 0, damping: 0}`. 아니면
  - `force = G · Kt · u / R` (N·m, 출력축)
  - `damping = G² · Kt · Ke / R` (N·m·s/rad, 출력축 역기전력 감쇠)
  - 출력 토크 `τ_elec = force − damping · ω` = `G·Kt·(u − Ke·G·ω)/R`(효율 없이 G·τ_m).
- `current(stage, V_bat, ω) = (u − Ke·G·ω)/R`(u 없음이면 0, 부호 있음). `world.ts`는 구간 끝 값의 크기만 허브 `current` 입력으로 보낸다(허브 전류 측정이 크기만 본다는 [가정]).

### 5.4 기어 효율·마찰(`world.ts` `driveForces`)

기어 효율은 힘이 흐르는 방향에 따라 다르다(spec-3b §1.2): 모터가 밀면 출력 = η·G·τ_m, 부하가 역구동하면 G·τ_m(손실은 역구동 마찰이 맡음). 그래서 출력 토크를 G·τ_m(선형, 암시 감쇠)으로 두고 **모터가 미는 쪽으로의 움직임을 막는 한쪽 마찰 상자** (1 − η)·abs(τ)를 더한다(움직이면 상자가 차서 η·G·τ_m이 되고, 역구동이면 상자가 힘을 내지 않으며, 멈춰 있으면 그 사이의 기어 정지 마찰이다. 영역을 나눠 바꾸지 않아 경계에서 떨지 않는다). 모터 장치마다 출력축 좌표 c에 대해:

```
τ        = terms.force − terms.damping · ω                 // 전기 토크(출력축)
loss     = (1 − η) · abs(τ)
coulomb  = G · τ_c                                         // 모터축 쿨롱 마찰을 출력축으로
force[c]   += terms.force
damping[c] += terms.damping + G² · b                       // b: 모터축 점성
boxLo[c]   −= coulomb + (τ > 0 ? loss : 0)
boxHi[c]   += coulomb + (τ < 0 ? loss : 0)
regions    += terms.region
```

마찰 상자 [boxLo, boxHi]는 그 좌표 속도를 0으로 두려는 마찰 힘의 한도다(`DriveForces` 주석: "마찰 힘 ∈ [boxLo, boxHi], 목표 속도 0"). 같은 관절을 구동하는 모터가 여럿이면 장치마다 같은 식으로 같은 좌표에 더해진다(토크 N배, 회전자 관성도 N배, §8.1).

---

## 6. 허브 펌웨어 제어 루프(주기·PIDF·16.16·속도 측정)

### 6.1 사이드카 출력 해석(`motorOutputs.ts` `readMotorOutputs`)

| 키                            | 해석                                                                                    | 기본·보정                                 |
| ----------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| `mode`                        | RUN_WITHOUT_ENCODER·RUN_USING_ENCODER·RUN_TO_POSITION·STOP_AND_RESET_ENCODER            | 모르는 값 → RUN_WITHOUT_ENCODER           |
| `power`                       | −1..1(엔코더 없음이면 정전력 값, 엔코더 모드면 목표 속도 ÷ 형식 최대 틱/s). 허브 부호   | 유한 수로 자르고 ±1로 clamp, 없으면 0     |
| `velocity`                    | 엔코더 모드의 목표 속도(틱/s, 허브 부호), 아니면 null                                   | 유한 수 아니면 null                       |
| `enabled`                     | 꺼짐(false)은 FLOAT                                                                     | `=== true`가 아니면 false                 |
| `zeroPower`                   | BRAKE·FLOAT                                                                             | FLOAT 아니면 BRAKE                        |
| `targetPosition`              | 허브 틱(리셋 기준), 받은 적 없으면 null                                                 | 유한 수 아니면 null                       |
| `encoderOffset`               | 마지막 STOP_AND_RESET_ENCODER 때의 원시 틱                                              | 유한 수 아니면 0                          |
| `encoderResets`               | 허브에 보낸 STOP_AND_RESET_ENCODER 횟수                                                 | 유한 수 아니면 0                          |
| `velocityPidf`·`positionPidf` | 숫자 4개 배열 [p, i, d, f](`readPidf`: 길이 4이고 모두 유한 수일 때만, 아니면 fallback) | 속도 [10, 3, 0, 0], 위치 [10, 0.05, 0, 0] |

`velocityAlgorithm`·`positionAlgorithm`(LegacyPID·PIDF)과 `targetTolerance`(기본 5틱)는 사이드카가 보내지만 시뮬레이터는 쓰지 않는다(`isBusy` 판정은 사이드카 `isAtTarget`: `abs(targetPosition − encoderPosition) ≤ targetTolerance`).

사이드카 power → 목표 속도(`SimDcMotorController.internalSetMotorPower`): 엔코더 모드는 `target = (int)(sign(p) · abs(p) · hubMax)`(`hubMax`는 §3.2), RUN_WITHOUT_ENCODER는 `constantPower = (int)(p · 32767)`이고 `power = constantPower / 32767`로 발행. `setVelocity`는 `round(ticksPerSecond)`를 ±32767로 clamp(`HUB_VELOCITY_LAST`).

### 6.2 제어 주기·표본 시각

| 항목                 | 값/규칙                                                                                                                                   | 위치                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 제어 주기            | 10 ms(§2). 표본 시각은 0 ns부터의 고정 격자                                                                                               | `HUB_CONTROL_PERIOD_NANOS`  |
| 첫 틱 다음 표본      | `nextSample = ceil(t₀ / 10 ms) · 10 ms`                                                                                                   | `PhysicsWorld.step` (first) |
| 표본 시점            | 하위 단계 시작 시각 `t ≥ nextSample`이면 모든 모터 `controller.sample`을 한 번 돌리고 `nextSample = (floor(t/10 ms) + 1) · 10 ms`         | `PhysicsWorld.substep`      |
| 표본 입력            | `position = floor(raw)`, `velocity = control.ticksPerSecond()`(§6.5, 50 ms 창), `rawTarget = targetPosition + shaftOffset`(null이면 null) | `substep`                   |
| 표본 사이            | 듀티 유지(`controller.duty`)                                                                                                              | `HubMotorController`        |
| RUN_TO_POSITION 기준 | `shaftOffset`은 포드와 포트를 함께 쓰지 않으면 `encoderOffset`, 함께 쓰면 리셋 횟수가 바뀐 때의 축 틱 `floor(raw)`                        | `PhysicsWorld.integrate`    |

### 6.3 기본 PIDF·고정소수점

| 항목            | 값                                          | 위치                                                                                        | 상태·근거                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 속도 PIDF  | [P 10, I 3, D 0, F 0] (LegacyPID)           | `actuators.ts` `DEFAULT_VELOCITY_PIDF`, `SimDcMotorController.DEFAULT_VELOCITY_PIDF`        | 허브 LegacyPID 기본 계수(spec-3b §3). SDK 12.0에서 계수를 정한 형식은 Core Hex 하나(`RevRoboticsCoreHexMotor`의 `@ExpansionHubMotorControllerVelocityParams` P=10, I=3, D=0, LegacyPID)이고 SDK 6.0 릴리스 노트는 REV 모터 기본값을 2018-19 시즌 기본 PID로 되돌렸다고 쓰지만 숫자는 공개되지 않았다([가정: Core Hex 주석이 그 값을 옮긴 것], 측정이 아닌 근사). 상태 "실측 필요" |
| 기본 위치 PIDF  | [P 10, I 0.05, D 0, F 0] (LegacyPID)        | `DEFAULT_POSITION_PIDF`                                                                     | 위와 같음(`@…PositionParams` P=10, I=0.05, D=0). 시뮬레이터는 위치 루프에서 P만 쓴다                                                                                                                                                                                                                                                                                              |
| 계수 저장 형식  | 16.16 고정소수점                            | `SimDcMotorController.internalCoefficientFromExternal`·`externalCoefficientFromInternal`    | 실제 `LynxSetMotorPIDControlLoopCoefficientsCommand`의 변환: `internal = (int)(abs(c) · 65536.0 + 0.5) · (int)signum(c)`, `external = internal / 65536.0`                                                                                                                                                                                                                         |
| 16.16 반올림 예 | 0.05 → 3277 → 0.0500030517578125            | `package-info.java` 설명, `DeviceBehaviorTest.java`(`sidecar/tests/devices.test.ts`가 실행) | 사이드카가 시뮬레이터로 보내는 `velocityPidf`·`positionPidf`는 이 되돌린 값이다(`getPIDFCoefficients`와 같음)                                                                                                                                                                                                                                                                     |
| 기본값 시점     | OpMode마다 SDK가 처음 쓰기 전 계수로 되돌림 | `package-info.java`                                                                         | 실제 `resetDeviceConfigurationForOpMode`                                                                                                                                                                                                                                                                                                                                          |

PIDF 명령은 실제처럼 LastKnown 없이 늘 허브로 보낸다(비용 모델, 사이드카).

### 6.4 제어기 식(`HubMotorController`)

전력단 선택(`stage(out)`, 허브 부호):

- `out.enabled` false → FLOAT.
- `zero = (out.zeroPower === 'FLOAT') ? FLOAT : BRAKE`.
- STOP_AND_RESET_ENCODER → `zero`.
- RUN_WITHOUT_ENCODER → `power === 0 ? zero : duty = power`(바로 적용).
- RUN_USING_ENCODER·RUN_TO_POSITION → `duty = this.duty`(마지막 표본 결과). 이때 `duty === 0`은 BRAKE가 아니라 `{kind: 'duty', duty: 0}`이라 전력단에서 "듀티 0"(다이오드 둘, §5.2)이다.
- `PhysicsWorld.substep`이 듀티에 `forwardSign`을 곱해 "앞" 부호로 바꾼다(`brake`·`float`는 그대로).

표본(`sample(input)`, 10 ms마다):

```
encoder = out.enabled && mode ∈ {RUN_USING_ENCODER, RUN_TO_POSITION}
mode가 바뀌면(encoder 모드 이름 ↔ null, 또는 두 엔코더 모드 사이) integral = 0, lastError = 0, (encoder가 아니면 duty = 0)
encoder가 아니면 return

goal(RUN_TO_POSITION) = rawTarget === null ? 0
                      : clamp( P_pos · (rawTarget − position), ±abs(out.velocity ?? 0) )
goal(RUN_USING_ENCODER) = out.velocity ?? 0

[p, i, d, f] = velocityPidf
error    = goal − velocity                       // velocity: 50 ms 창 측정(틱/s)
integral += i · error                            // 주기마다 오차를 더함(dt를 곱하지 않음)
u        = f·goal + p·error + integral + d·(error − lastError)
lastError = error
if abs(u) > 32767: clamped = sign(u)·32767; integral −= (u − clamped); u = clamped   // 포화 방지
duty = u / 32767
```

- 위치 루프는 P(`positionPidf[0]`)만 쓴다(SDK 주석 "only the proportional ('p') coefficient makes logical sense", 3b 비평 §2.4: 위치 I를 주기 합으로 넣으면 넘치고 흔들림). 위치 루프는 허용 오차 안에서도 계속 돈다([DATA] §4.3). SDK DcMotorEx 설명: "calculates an on-the-fly velocity goal on each control cycle, then (logically) runs the RUN_WITH_ENCODER logic".
- 속도 루프의 LegacyPID 해석 — 적분은 10 ms마다 `I·e`의 합(3b 비평 §2.3에서 목표에 닿는 유일한 해석), 포화하면 넘친 만큼 적분에서 뺀다(`p11joint/tools/rtp_check.py`와 같은 포화 방지) — 은 **[가정: 펌웨어 공개 자료 없음]** 이다(assumptions.md 상태 "가정"). 측정 방법: `setVelocity` 계단 응답 기록을 시뮬레이터와 견준다.
- RUN_TO_POSITION의 `out.velocity`는 사이드카가 `power × hubMax`로 정한 속도 한도다(RTP에서 power는 속도 한도).
- 포트의 `isBusy`는 시뮬레이터가 아니라 사이드카가 판단한다.

### 6.5 허브 속도 측정(`encoderVelocity.ts`)

| 항목              | 값                    | 위치                        | 근거                                                                                                                                                                                     |
| ----------------- | --------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 측정 창           | 50 000 000 ns (50 ms) | `HUB_VELOCITY_WINDOW_NANOS` | Road Runner ftc `OverflowEncoder`(Encoders.kt `inverseOverflow`: "the velocity is always a multiple of 20 cps due to Expansion Hub's 50ms measurement window")을 코드 주석이 근거로 인용 |
| 틱 수 → 틱/s 배율 | 1e9 / 5e7 = 20        | `HUB_VELOCITY_SCALE`        | 같은 근거                                                                                                                                                                                |

규칙: 시각 t(틱 경계의 가상 시각)에서 `velocity = (floor(raw(t)) − floor(raw(t − 50 ms))) × 20`. `raw`는 하위 단계마다 `record(tNanos, raw)`로 쌓은 소수 원시 틱이고 `raw(t − 50 ms)`는 기록 사이를 선형 보간한다. 창은 틱마다 미끄러진다(펌웨어가 50 ms마다 한 번만 새로 재는지는 공개 자료로 확인하지 못했다 — 코드 주석. 20의 배수인 것은 같다). 첫 기록 전에는 정지해 있었다고 보고, 시작 뒤 처음 50 ms는 시작 위치부터 센다(시작 틱 속도 0). 값은 늘 20의 배수라 창 가운데 평균 속도이며 약 25 ms 늦다. 기록 중 창 시작 이전은 보간에 쓸 마지막 하나만 남긴다. `velocity === 0`은 +0으로. `record(tNanos, raw)`는 앞 기록보다 뒤가 아닌 시각(같거나 앞)을 무시하고, 기록이 없으면 `ticksPerSecond()`는 0이다. 사이드카 `SimDcMotorController.encoderVelocity`가 감기 전 값을 `(short)`로 int16에 감는다(실제 bulk read의 short와 같음).

모터 제어기는 포드와 포트를 함께 쓰더라도 **축 엔코더**의 별도 50 ms 창(`dyn.control`)으로 돈다(가정: 시뮬레이터는 축 엔코더로 제어한다고 가정하고 simNotice `sharedEncoderMode`로 알린다).

---

## 7. 서보 모델

### 7.1 서보 모델 표(`SERVO_MODELS`)

서보 컴포넌트의 `servoModel` 속성(시뮬레이터 전용)이 고른다. 구성 태그에는 제조사가 없어 팀이 고른다(`actuatorData.ts` 주석은 "Servo·ServoFullRange·CRServo"라고 적었다. 구성 XML에서 CR 서보의 실제 태그는 `ContinuousRotationServo`이고 `CRServo`는 생성 Java 타입이다: `configXml.ts`·`catalog.ts`). 모르는 키는 기본 모델로 본다(`isServoModelKey`, `SERVO_MODEL_KEYS` 일곱: `gobildaTorque`·`gobildaSpeed`·`gobildaSuperSpeed`·`axonMax`·`axonMini`·`axonMicro`·`revSmartServo`). 기본은 `gobildaTorque`(goBILDA 2000 Torque, 25-2, `DEFAULT_SERVO_MODEL`). 정지 토크·무부하 속도는 **허브 서보 포트 5 V에서의 값으로 데이터시트 4.8 V·6.0 V 값의 선형 보간**이다([ACT] §5.2 "허브 5 V 보간값", Control Hub 서보 전원 5 V https://docs.revrobotics.com/duo-control/control-system-overview/control-hub-basics ). 보간 전 원값은 코드에 없다(출처 기록 없음 — 원본 [ACT] §5.2).

| `servoModel`        | 정지 토크 τ_s(N·m)      | 무부하 속도 ω_f(rad/s) | 위치 각 범위(600–2400 µs 전체)                | 데드밴드(µs) | CR 반범위 `crHalfRangeUs`(µs)                                | 출처·가정                                                                                                                                                                                                                     |
| ------------------- | ----------------------- | ---------------------- | --------------------------------------------- | ------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gobildaTorque`     | 1.76                    | 4.33                   | 270°                                          | 4            | 600 (900–2100 µs)                                            | goBILDA 2000 Dual Mode 25-2: 0.150°/µs → 600–2400 µs가 270°, 데드밴드 4 µs, 연속 회전 900–2100 µs                                                                                                                             |
| `gobildaSpeed`      | 0.8                     | 9.82                   | 270°                                          | 4            | 500 (1000–2000 µs)                                           | goBILDA 25-3                                                                                                                                                                                                                  |
| `gobildaSuperSpeed` | 0.4                     | 19.8                   | 270°                                          | 4            | 500 (1000–2000 µs)                                           | goBILDA 25-4                                                                                                                                                                                                                  |
| `axonMax`           | 2.84                    | 7.71                   | 315°                                          | 2            | 450 (1050–1950 µs)                                           | Axon MK2: 0.175°/µs → 315°, 데드밴드 2 µs, 연속 회전 1050–1950 µs                                                                                                                                                             |
| `axonMini`          | 2.04                    | 9.82                   | 315°                                          | 2            | 450                                                          | Axon MK2                                                                                                                                                                                                                      |
| `axonMicro`         | 0.66                    | 12.6                   | 315°                                          | 2            | 450                                                          | Axon MICRO+(단종). [가정: 펄스 범위·데드밴드가 문서에 없어 MK2와 같게 둠]                                                                                                                                                     |
| `revSmartServo`     | (1.324 × 5/6) = 1.10333 | (7.48 × 5/6) = 6.23333 | 243°(500–2500 µs가 270°라 600–2400 µs는 243°) | 4            | 1000 (500–2500 µs, 연속 모드는 같은 펄스 범위를 속도에 대응) | REV Smart Robot Servo V2 Balanced. SRS는 4.8 V 값이 없어 6 V 값(7.48 rad/s, 1.324 N·m, srs-v2-specifications) × 5/6([가정/근사: DC 모터 직선(전압 비례)으로 환산, [ACT] §5.2]). 데드밴드는 문서에 없어 goBILDA와 같게([가정]) |

출처 URL(코드 주석): https://www.gobilda.com/2000-series-dual-mode-servo-25-2-torque/ , …-25-3-speed/ , …-25-4-super-speed/ ; https://docs.axon-robotics.com/servos/max , …/servos/mini , https://docs.axon-robotics.com/archive/micro.md ; https://docs.revrobotics.com/rev-crossover-products/servo/srs.md , https://docs.revrobotics.com/rev-crossover-products/servo/smart-robot-servo-v2/srs-v2-specifications .

### 7.2 서보 상수와 `resolveServoParams`

| 항목                      | 값                                | 단위 | 위치                                                                                | 상태·근거                                                                                                                                                                 |
| ------------------------- | --------------------------------- | ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK 기본 PWM 범위 반폭    | 900 (600–2400 µs, 가운데 1500 µs) | µs   | `SDK_HALF_RANGE_US`, `actuators.ts` `SERVO_CENTER_US` 1500·`SERVO_HALF_SPAN_US` 900 | SDK `PwmControl.PwmRange` 기본, CRServoImpl([ACT] §5.1)                                                                                                                   |
| 허브 서보 포트 출력 범위  | 500–2500                          | µs   | `worldSpec.ts` `MIN_SERVO_PULSE_US`·`MAX_SERVO_PULSE_US`                            | REV Control Hub 서보 포트 사양(코드 주석). 범위 밖 펄스는 이 범위로 자른다                                                                                                |
| 내부 위치 제어 포화 오차  | 5°(= 0.0872665 rad)               | rad  | `actuatorData.ts` `SERVO_SATURATION_ERROR`                                          | [가정, [ACT] §5.4 근사, 출처 없음]: 오차 5°에서 정지 토크에 닿는 비례 이득. 측정: 서보에 레버·추를 달고 같은 명령에서 처짐 각 Δθ를 재 비례 이득 ≈ 부하 토크 ÷ Δθ          |
| PWM 꺼진 서보의 기어 마찰 | 정지 토크의 5 %                   | -    | `SERVO_LIMP_FRACTION` 0.05                                                          | [가정: 출처 없음. goBILDA 감속비 300·135·67:1에 소형 모터 쿨롱 마찰 0.3 mN·m를 곱한 값 0.09·0.04·0.02 N·m와 비슷]. 측정: `setPwmDisable` 뒤 출력축을 돌리기 시작하는 토크 |
| 서보 전류 제한            | 넣지 않음                         | -    | `saturatedServo` 주석                                                               | [가정: 서보 내부 회로의 전류 제한은 공개 출처가 없음]                                                                                                                     |

`resolveServoParams(model, kind)`:

```
servo   = SERVO_MODELS[model 또는 gobildaTorque]
crFull  = servo.crHalfRangeUs / 900                 // CR 서보가 최대 속도에 닿는 |offset|/900 µs
reach   = (kind === 'crServo' && crFull > 1) ? 1 / crFull : 1       // REV SRS 0.9
stallTorque = servo.stallTorque · reach
freeSpeed   = servo.freeSpeed · reach
rangeAngle  = (kind === 'servo') ? rangeDegrees · DEG : 0
deadbandUs  = servo.deadbandUs
kp          = stallTorque / SERVO_SATURATION_ERROR        // N·m/rad
kd          = stallTorque / freeSpeed                      // N·m·s/rad (모터 토크-속도 직선 기울기)
crFullPower = (kind === 'crServo') ? min(crFull, 1) : 1
limpFriction = servo.stallTorque · SERVO_LIMP_FRACTION     // 줄이기 전 실제 정지 토크로
```

REV SRS의 CR 모드는 500–2500 µs가 속도에 대응해 SDK 범위(600–2400)의 power 1에서도 최고 속도의 90 %다. 세계 설명의 `crFullPower`는 1 이하라서 그때는 `crFullPower` 1에 정지 토크·무부하 속도를 0.9배로 줄여 같은 곡선을 낸다(τ_s·(0.9u′ − ω/ω_f) = 0.9·τ_s·(u′ − ω/(0.9ω_f)), 기울기와 kd도 같다). 팀이 PWM 범위를 SDK 기본보다 넓히면(2500 µs) 실제는 최고 속도에 닿지만 시뮬레이터는 90 %에서 멈춘다(한계).

계산된 값(`resolveServoParams` 출력):

| `servoModel`        | kp(N·m/rad) 위치 서보 | kd(N·m·s/rad) | limpFriction(N·m) | CR: 정지 토크 / 무부하 / crFullPower / kp / limp         |
| ------------------- | --------------------- | ------------- | ----------------- | -------------------------------------------------------- |
| `gobildaTorque`     | 20.168                | 0.40647       | 0.088             | 1.76 / 4.33 / 0.66667 / 20.168 / 0.088                   |
| `gobildaSpeed`      | 9.1673                | 0.081466      | 0.04              | 0.8 / 9.82 / 0.55556 / 9.1673 / 0.04                     |
| `gobildaSuperSpeed` | 4.5837                | 0.020202      | 0.02              | 0.4 / 19.8 / 0.55556 / 4.5837 / 0.02                     |
| `axonMax`           | 32.544                | 0.36835       | 0.142             | 2.84 / 7.71 / 0.5 / 32.544 / 0.142                       |
| `axonMini`          | 23.377                | 0.20774       | 0.102             | 2.04 / 9.82 / 0.5 / 23.377 / 0.102                       |
| `axonMicro`         | 7.563                 | 0.052381      | 0.033             | 0.66 / 12.6 / 0.5 / 7.563 / 0.033                        |
| `revSmartServo`     | 12.643                | 0.17701       | 0.055167          | 0.993 / 5.61 / 1 / 11.379 / 0.055167 (kd 0.17701은 같다) |

### 7.3 펄스 → 명령(`servoCommand`)

입력: 사이드카 서보 출력 `pwm`(boolean)·`pulseUs`(µs), `SimServoParams`, `continuous`(CR 서보), `zeroPulseUs`(편집 자세 q = 0의 펄스, 위치 서보만, 기본 `SERVO_CENTER_US` 1500), `direction`(+펄스가 관절 +축 1·−축 −1).

- `pwm !== true` 또는 `pulseUs`가 유한 수가 아니면 `limp`(허브는 PWM이 꺼지면 서보 5 V 전원도 끈다: gm0, [DATA] §4.4).
- `clamped = clamp(pulseUs, 500, 2500)`(실제 서보는 펄스만 본다. 팀이 `setPwmRange`로 범위를 바꿔도 펄스가 기준).
- 위치 서보: `angle = direction · ((clamped − zeroPulseUs) / (2·900)) · rangeAngle`. 서보 혼이 어느 각에 끼워졌는지는 팀마다 달라서 편집 자세의 펄스를 기준으로 잰다. 데이터시트는 펄스가 늘면 혼이 시계 방향이라고 하지만 관절 축을 어느 쪽으로 잡았는지에 따라 달라서 `direction`을 둔다.
- CR 서보: `offset = clamped − 1500`(CR의 정지는 서보 회로가 정하므로 늘 1500 µs). `abs(offset) ≤ deadbandUs/2`이면 `speed 0`, 아니면 `fraction = direction · clamp(offset / (900 · crFullPower), −1, 1)`.

`servoPositionPulseUs(position) = 1500 + (2·position − 1)·900`(SDK 위치 → 펄스, 0 → 600, 0.5 → 1500, 1 → 2400). 렌더러의 `servoEditPulseUs`는 §11.4.

### 7.4 서보 토크 항(`servoTerms`)

서보 출력축에서 `τ = force − damping·ω − stiffness·Δθ`(암시), `friction`은 쿨롱 상자. 모터 직선 한도 `slope = τ_s / ω_f`.

| 명령                    | 항                                                                                                                                                                                                     | 영역 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `limp`                  | force 0, damping 0, stiffness 0, `friction = limpFriction`                                                                                                                                             | `x`  |
| `speed`(CR)             | `force = τ_s · fraction`, `damping = slope`(DC 모터 직선 τ = τ_s·(u − ω/ω_f))                                                                                                                          | `r`  |
| `position`, 데드밴드 안 | `deadband = (deadbandUs/2)·(rangeAngle / 1800 µs)` (rad); `error = command.angle − θ`; `abs(error) ≤ deadband`이면 force 0, `damping = kd`(D만)                                                        | `d`  |
| `position`, 비례 영역   | `effective = error − sign(error)·deadband`; `torque = kp·effective − kd·ω`; `torque`가 직선 안(`−τ_s − slope·ω ≤ torque ≤ τ_s − slope·ω`)이면 `force = kp·effective`, `damping = kd`, `stiffness = kp` | `p`  |
| 포화(+)                 | `torque > τ_s − slope·ω` → `force = +τ_s`, `damping = slope`                                                                                                                                           | `h`  |
| 포화(−)                 | `torque < −τ_s − slope·ω` → `force = −τ_s`, `damping = slope`                                                                                                                                          | `n`  |

해설: 내부 PD τ = kp·e − kd·ω를 모터 직선 τ ∈ [−τ_s(1 + ω/ω_f), τ_s(1 − ω/ω_f)]로 자른다([ACT] §5.4, [가정]). 명령 쪽으로 돌면 무부하 속도에서 0이 되고, 부하가 서보를 명령 반대로 돌리면(역구동) 역기전력이 더해져 빨리 돌릴수록 더 버틴다(ω = −ω_f에서 2τ_s). 그래서 정지 토크보다 무거운 팔은 정적 평형 근처로 과감쇠로 내려앉고 역구동 속도는 ω_f·(부하/τ_s − 1)이다. 감쇠 τ_s/ω_f는 늘 암시 D 항이라 하위 단계가 커도 안정하다. (예전에는 spec-3b §1.9 "토크는 정지 토크까지"를 역구동에도 적용해 ±τ_s에서 잘랐지만, 그러면 역구동 토크가 속도와 관계없이 일정해 과부하 팔이 감쇠 없는 진자처럼 평형을 넘어 흔들리고 무부하 속도보다 빨라졌다.) 비례 영역의 `force`는 현재 θ에서의 힘(−kp·(θ − 기준) 포함)이고 `stiffness = kp`는 암시 K 항에 들어간다.

### 7.5 서보 → 관절 좌표 환산(`world.ts` `driveForces`)

서보 관절의 좌표 z는 관절 변위 q 자체이고, 서보 출력축 변수는 `θ_s = z / r`, `ω_s = v / r`(`r = drive.ratio`, 서보 출력축 rad당 관절 rad 또는 m, 양수):

```
terms = servoTerms(command, params, z/r, v/r)
force[c]    += terms.force / r
damping[c]  += terms.damping / r²
stiffness[c]+= terms.stiffness / r²
boxLo[c]    −= terms.friction / abs(r);  boxHi[c] += terms.friction / abs(r)
```

---

## 8. 관절 동역학(`articulation.ts`)

Unity ArticulationBody·PhysX articulation처럼 Featherstone 계열 감소 좌표로 푼다. 순수 TS·결정적(배열 순서만 쓰고 벽시계·난수·Map 순서를 쓰지 않음). 이 파일이 쓰는 `Math` 함수는 `abs`·`max`·`min`·`sin`·`cos`(`rotationZYX`·`axisRotation`)·`exp`(기저 렌치 가속의 저역 통과, 8.5절 10단계)이고 `sqrt`는 쓰지 않는다(`articulation.ts` 안 `Math.` 호출 목록).

### 8.1 좌표(`Articulation` 생성자)

관절 변위 q(나무 관절별)는 독립 좌표 z의 선형 함수다: `q = S · z` (`s`: 나무 관절 수 × 좌표 수). 좌표 종류(`Coordinate.kind`): `joint`(관절 q 자체), `motor`(모터 출력축 각 φ), `base`(3c 기저), `free`(관절에 묶이지 않은 좌표, 3c).

| 구동·리깅 종류                 | 좌표                                                                     | S 행                                                                                                                   | armature(좌표 회전자 반사 관성)                          |
| ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 구동 없음·서보·CR 서보         | `joint` 하나(z = q)                                                      | 관절 i의 행: `S[i][z] = 1`                                                                                             | 0                                                        |
| `stage`(다단 슬라이드의 위 단) | 자기 좌표 없음(아래 단 구동의 좌표를 공유)                               | 아래 단 구동이 채움                                                                                                    | -                                                        |
| 모터, `direct`                 | `motor` φ 하나                                                           | `S[i][φ] = ratio`                                                                                                      | `devices.length · rotorInertia · gearbox²` (모터 N개 합) |
| 모터, `cascade`                | φ 하나                                                                   | 관절 i와 모든 위 단 k: `S[k][φ] = ratio`(상대 이동이 같음, q_k = ratio·φ, 자유도 1)                                    | 같음                                                     |
| 모터, `continuous`             | φ와 맨 위 단을 뺀 단(관절 i 포함)마다 `joint` 좌표 하나 `(φ, q_member…)` | 각 member: `S[member][own] = 1`; 맨 위 단: `S[top][φ] = ratio`, `S[top][own_member] = −1` (Σq = ratio·φ, 줄 길이 하나) | 같음                                                     |

회전 관절의 `ratio`는 모터 출력축 rad당 관절 rad(`1/gearRatio`), 직선 관절은 출력축 rad당 m(`spoolDiameter/2/gearRatio`). 어느 단이 먼저 움직일지(continuous)는 중력·마찰·한계가 정한다. 서보·구동 없음 관절은 회전자 관성이 없다(armature 0).

### 8.2 운동학(`bodies(q)`)

나무 순서는 부모가 먼저다. 관절 i(부모 몸체 틀 R_p, 원점 o_p):

```
R_0 = R_p · Rzyx(origin.rotation)          // 관절 틀(q=0)의 회전
p_0 = o_p + R_p · origin.position           // 관절 틀 원점
a   = R_0 · axis                             // 로봇(나무) 틀의 관절 축
회전:  R = R_0 · AxisRotation(axis, q),   o = p_0,           s = [a ; p_0 × a]       // 로드리게스 회전
직선:  R = R_0,                           o = p_0 + q·a,     s = [0 ; a]
COM  = o + R · centerOfMass
I_c  = R · I_body · Rᵀ
공간 관성 (원점 기준, 운동 [ω ; v_O] → 운동량 [L_O ; p]):
  [[ I_c − m·[c]×[c]× ,  m·[c]× ],
   [ −m·[c]×          ,  m·1₃   ]]           // c = COM, [c]×는 반대칭 행렬
```

### 8.3 질량 행렬 CRBA(`crba`)

합성 관성 `I^C_i = I_i + Σ_{자식 k} I^C_k`(뒤 순번에서 앞으로 누적, 로봇 좌표라 좌표 변환 없이 더함). 그리고

```
f_i = I^C_i · s_i
M_q[i][i] = s_iᵀ · f_i
M_q[i][j] = M_q[j][i] = s_jᵀ · f_i          // j: i의 모든 조상
```

좌표 공간: `M_z = Sᵀ · M_q · S + diag(armature_c + MIN_COORDINATE_INERTIA)` (`coordinateMass`).

### 8.4 중력·코리올리 RNEA(`rnea`)

고정 기저를 위로 g만큼 가속시키는 Featherstone의 표준 처리로 중력을 준다: 기저 가속 `a_base = [0,0,0, 0,0,+g]`. 각 몸체:

```
v_i = v_p + s_i · q̇_i
a_i = a_p + (v_i ×ₘ s_i)·q̇_i  [+ s_i · q̈_i  (qdd를 줄 때만)]
f_i = I_i · a_i + v_i ×* (I_i · v_i)
τ_i = s_iᵀ · f_i       (자식의 f를 부모에 더하며 뒤 순번에서 앞으로)
```

`bias()`(q̈ = 0)가 중력·코리올리·원심력 `c_q`를 준다. `M·q̈ + c = τ`. 좌표 공간 `c_z = Sᵀ · c_q`.

### 8.5 하위 단계 풀이(`step(h, drive, contacts)`)

1. `q = S z`, `q̇ = S v`, 몸체 `bodies(q)`, `M_z = coordinateMass(crba)`, `c_q = rnea(bodies, q̇)`, `c_z = Sᵀ c_q`.
2. 나무 관절 수동 힘: 점성 `passiveDamping[i] = joint.friction.viscous`; 스프링 `constantForce`는 `passiveForce[i] = spring.force`(+q 방향 일정한 힘), `linear`는 `passiveForce[i] = −stiffness·(q_i − rest)`와 `passiveStiffness[i] = stiffness`. 좌표 공간으로: `baseForce = Sᵀ passiveForce`, `baseDamping = Sᵀ diag(passiveDamping) S`, `baseStiffness = Sᵀ diag(passiveStiffness) S`. (3c 행 점성 감쇠 `Σ c·j jᵀ`도 `baseDamping`에 더함.)
3. 구동 힘 `forces = drive(z, v)`(`DriveForces`: force, damping, stiffness, boxLo, boxHi, regions). 모든 값이 z 좌표 단위다.
4. **속도 암시 오일러**(MuJoCo implicitfast·discrete 방식, https://mujoco.readthedocs.io/en/stable/computation/index.html ):

```
M̂   = M_z + h·(baseDamping + diag(forces.damping)) + h²·(baseStiffness + diag(forces.stiffness))
rhs = M_z·v + h·(baseForce + forces.force − c_z)
v*  = M̂⁻¹ · rhs                                    // LDLᵀ 분해(`ldlFactor(a, minPivot = 0)`, 피벗이 `minPivot` 이하면 예외 'joint dynamics: matrix not positive definite')
(M_z + h·D + h²·K)·v⁺ = M_z·v + h·(f − c) + Jᵀλ     // λ: 구속 충격
z⁺  = z + h · v⁺
```

D는 역기전력·BRAKE·점성·서보 D, K는 서보 P·스프링(대각 또는 SᵀdiagS). f는 지금 z에서의 힘(−K(z − 기준) 포함).

5. 구속(Jᵀλ)은 한 상자 LCP로 푼다(§8.6): 한계(반발 0, 예측 간격 `J·v⁺ ≥ −gap/h`)와 쿨롱 마찰(상자 `abs(λ) ≤ h·F`).
6. 풀고 난 뒤 빠진 한계가 `LIMIT_TOLERANCE` 넘으면 그 행을 더해 다시 푼다(`included` 갱신 후 `continue`).
7. 영역 재풀이: 힘이 영역(모터 회생 자르기·서보 포화)에 따라 다르면 지금 v로 정한 영역으로 풀고(`first = drive(z, v)`), v⁺의 영역이 다르면(`second = drive(z, solution.v)`, `regions` 문자열 비교) 그 영역으로 한 번 더 푼다(많아야 두 번, 결정적).
8. 마찰 행이 있으면(3c) 엇갈림 2회(`pass(previous, 0)` → `pass(once.impulses, 1)`): 마찰 상자를 정하는 법선 충격을 1회차는 앞 하위 단계의 같은 키 힘(`× h/lastH`), 2회차는 1회차 값으로 쓴다. 3b 단독(마찰 행 없음)은 1회.
9. 한계 충격(`clampLimits`, §8.7)으로 한계에 닿은 좌표를 멈추고 위치를 자른다. 유한성 검사(`z`·`v`가 유한 수가 아니면 'joint dynamics diverged').
10. 기저가 있으면(3c) 기저 렌치용 가속의 저역 통과: `α = 1 − exp(−h/τ)`, `filteredAccel += α·((v⁺ − v)/h − filteredAccel)` (`loadFilterTau` = `LOAD_FILTER_TAU` 0.02 s, wheelData.ts).

### 8.6 구속 행과 상자 LCP

행 만들기(`frictionRows`, `limitRows`, 밖에서 주는 행은 3c·5):

| 행 종류                     | J                                               | 목표(target)       | λ 상자(충격)                                                               | 키                               |
| --------------------------- | ----------------------------------------------- | ------------------ | -------------------------------------------------------------------------- | -------------------------------- |
| 관절 쿨롱 마찰(나무 관절 i) | `S_i`를 첫 0 아닌 성분(lead)으로 나눈 단위 방향 | 0                  | `[−h·c·abs(lead), +h·c·abs(lead)]`(방향 같은 행은 상자를 더해 하나로 합침) | `f<첫 성분 순번 또는 단위 벡터>` |
| 구동의 좌표 상자(§5.4·§7.5) | `e_c`(좌표 c)                                   | 0                  | `[h·boxLo, h·boxHi]`(같은 방향 행과 합침)                                  | `f<c>`                           |
| 한계 아래(관절 i)           | `S_i`                                           | `−(q_i − lower)/h` | `[0, ∞)`                                                                   | `l<i>`                           |
| 한계 위(관절 i)             | `−S_i`                                          | `−(upper − q_i)/h` | `[0, ∞)`                                                                   | `u<i>`                           |

한계 행은 한계 근처면 늘 넣는다: `included[아래] = (q_i − lower ≤ abs(q̇_i)·h + LIMIT_MARGIN)`, `included[위] = (upper − q_i ≤ abs(q̇_i)·h + LIMIT_MARGIN)`. 결합 관절에서 행을 v*로 고르면 떨리기 때문이다(3b 비평 §2.5). 마찰 행의 `lo`·`hi`는 이미 충격 단위(힘 × h).

LCP: `A = J·M̂⁻¹·Jᵀ`, `b = J·v* − target`, `w = A·λ + b`, `lo ≤ λ ≤ hi`에서 `λ = lo`이면 `w ≥ 0`, `λ = hi`이면 `w ≤ 0`, 그 사이면 `w = 0`. 해 후 `v⁺ = v* + M̂⁻¹Jᵀλ`. 행마다 `A_ii > 0`이어야 한다(아니면 'constraint row has no effect').

풀이(`solveBoxLcp`): 정칙화한 행렬 `A + diag(LCP_REGULARIZATION·A_ii)`로 블록 주축 전환(Júdice & Pires 1994, 상자 제약)을 하고 감염 수가 줄지 않으면 Murty 최소 첨자 규칙(가장 큰 첨자 하나만 바꿈)으로 바꾼다. 그 뒤 근접점 반복(Rockafellar 1976)으로 원래 A의 해에 맞춘다.

| 상수                       | 값    | 위치              | 상태·근거                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ----- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BPP_TRIES`                | 3     | `articulation.ts` | [가정: 블록 전환이 감염 수를 줄이지 못한 채 모두 바꾸기를 허락하는 횟수(Júdice–Pires의 p̄), 문헌의 보통 값 3–10]                                                                                                                                                                                                                                  |
| `LCP_REGULARIZATION`       | 1e-9  | `articulation.ts` | [가정: 조건수 1e9라 배정밀도 LDLᵀ가 다루고, 근접점 반복은 한 번에 차이를 약 1e-9배로 줄임]. ODE의 CFM·MuJoCo 구속 정칙화 R과 같은 방식. 같은 방향의 행(관절의 쿨롱 마찰과 한계, 모터 손실 상자와 한계, continuous 리깅의 세 행)이 있으면 A가 특이한 양반정치라 주축 전환이 끝난다는 보장이 없으므로 대각을 정칙화해 대칭 양정치(P 행렬)로 만든다 |
| `LCP_PROXIMAL_STEPS`       | 8     | `articulation.ts` | [가정: 특이하지 않은 방향의 차이가 한 번에 1e-9배로 줄어 2–3번이면 반올림 수준]. 그래도 남으면 정칙화한 해를 씀                                                                                                                                                                                                                                  |
| `LCP_RELATIVE_TOLERANCE`   | 1e-12 | `articulation.ts` | [가정(출처 없음): 배정밀도 반올림(2.2e-16)의 약 4500배]. 상보성 판정 `tolW = 1e-12·max(1, max abs(b_i))`, 경계 판정 `tolL = 1e-12·max(1, max abs(lo_i·hi_i 유한값))`                                                                                                                                                                             |
| `LCP_MAX_ITERATIONS`       | 2000  | `articulation.ts` | [가정: 행이 50개 아래면 보통 10번 안에 끝남]. 넘으면 던져 world.ts가 그 하위 단계 모든 속도를 0으로 두고 `worldError`로 알린다(조용히 상자로 자르지 않음)                                                                                                                                                                                        |
| `LCP_MURTY_ONLY_AFTER`     | 200   | `articulation.ts` | [결정: 5 LCP 퍼즈(spec-5 A26, P-M10)에서 블록 전환과 Murty를 오가는 혼합이 순위가 크게 모자란 접촉꼴 문제(행 40·좌표 12)를 2000회 안에 끝내지 못함(Murty만 쓰면 562회). 이 수 안에 끝나는 풀이는 연산이 그대로라 기준 해시가 그대로]                                                                                                             |
| `DENSE_RESTART_ITERATIONS` | 32    | `articulation.ts` | [결정: 6a 최종 확인 2]. 공 행이 있는 풀이(`constrainedCoupled`, 이 문서 범위 밖)만 쓴다: 고른 시작 상태에서 32번 넘게 돈 마찰 엇갈림 회차는 다음부터 앞 하위 단계의 같은 회차가 끝난 상태에서 시작한다. 공 행이 없는 3b 풀이는 이 상수를 읽지 않는다                                                                                             |

시작 상태: 행마다 앞 하위 단계의 상태(키로 찾음, `lcpStates`). 없으면 `lo === 0`이면 아래 경계, `hi === 0`이면 위 경계, 아니면 자유. 시작 상태는 반복 수만 줄이고 해(w, 속도)는 바꾸지 않는다. 풀이 뒤 `λ`는 `[lo, hi]`로 자른다.

단일 좌표 자유 행 보정(`constrained`): 상태가 `free`이고 `J`의 0 아닌 성분이 하나뿐인 행은 그 속도를 `v[c] = target / J[c]`로 정확히 맞춘다(정지 마찰로 멈춘 관절의 엔코더가 0과 −1 사이에서 깜빡이지 않게).

### 8.7 한계 충격·위치 자르기(`clampLimits`)

위치 자르기는 z 공간에서만 한다(리깅 구속을 깨지 않게).

- 성분 하나인 한계 관절(`S` 행의 0 아닌 성분이 z_c 하나, 값 k): `[low_c, high_c] = [lower/k, upper/k]`(k < 0이면 순서 바꿈)로 z_c를 자른다. 한계에 닿은(넘은) 좌표는 한계에 두고(`z_c = low_c` 또는 `high_c`) 구속 행 `J = ±e_c`(안쪽이 +)를 만든다. 한계에 멈춘 좌표의 속도는 정확히 +0.
- 성분이 여럿인 한계(continuous 리깅 맨 위 단 `q = r·φ − Σq`): 적분한 뒤 간격 `gap = sign·(S_i·z − limit) ≤ LIMIT_TOLERANCE·max(1, abs(limit))`이면 `J = sign·S_i` 행. 이 행이 없으면 다른 좌표를 멈추는 충격이 M̂로 묶인 φ를 바꿔 그 단을 한계 밖으로 밀고 다음 하위 단계의 간격 항이 그 침투를 바깥 속도로 바꿔 단이 튀어 오른다(수평 리프트에서 정확한 비탄성 충돌보다 운동 에너지가 늘었다).
- 바깥으로 움직이는 한계 행(`J·v < 0`)이 하나도 없으면 충격 없음(λ = 0이 해).
- 있으면 한계 행 뒤에 밖에서 준 행을 두고 한쪽 구속 LCP를 푼다: `y_k = M̂⁻¹J_kᵀ`, `A = J·M̂⁻¹·Jᵀ`, `w = A·λ + J·v − 목표 = J·v⁺ − 목표`, 한계 행 `λ ≥ 0`(`w ≥ 0`, 상보), 밖에서 준 행은 `λ ∈ [lo − λ_본, hi − λ_본]`(본 LCP와 같은 계를 이어 푸는 것이라 합 λ가 본 상자 안). 구속이 걸린(λ ≠ 0) 행이나 바깥 속도를 정확히 지운(`w = 0`) 행의 좌표는 멈춘다(`held`, `v_c = 0`). 멈추지 않은 좌표는 `dv = Σ_k y_k[c]·λ_k`를 받아 `v_c += dv`, `z_c += h·dv`(그 좌표 한계로 다시 자름). 그래서 결합된 자식 관절의 일반화 운동량이 보존되고 한계에 멈춰 있던 좌표가 안쪽으로 밀리면 한계에서 떨어진다(두 방향 구속으로 묶으면 그 운동량을 잃는다). 반발은 없다.
- 그 뒤 걸린 여러 성분 행이나 한계를 넘은 여러 성분 관절은 멈추지 않은 좌표만 그 행 방향(J를 그 좌표로 제한한 것)으로 최소 이동 `α = −gap/abs(J_free)²`만큼 움직여 한계에 놓는다(`placeCoupled`, 다른 행을 넘게 하면 다시 보되 많아야 4번).
- 밖에서 준 행(3c 바퀴·벽, 5 충돌)도 같은 충격 LCP에 넣는다(벽에 붙은 기저를 한계 충격이 벽 안으로 밀지 않게). 3b 마찰 상자(관절 쿨롱·구동 상자)는 넣지 않는다.

### 8.8 에너지·시험용 함수

`potentialEnergy(q) = Σ m_i·g·COM_z`(바닥 z = 0 기준, 섀시 포함), `kineticEnergy() = ½ vᵀ M_z v`(회전자 포함), `massMatrix()`, `bias()`, `bodyPose(i)`, `bodyPoses()`(센서·카메라용), `q()`·`qd()`.

### 8.9 부유 기저(3c)와의 관계(3b 단독일 때는 연산이 같음)

바퀴가 하나라도 있으면 나무 앞에 가상 관절 셋(필드 X 직선, 필드 Y 직선, Z 회전, 원점은 시작 자세)을 둔다(`BASE_JOINTS` = 3, `baseJoints`). 직선 관절 몸체는 질량 0이고(`MIN_COORDINATE_INERTIA`가 특이를 막고 섀시·자식 질량이 CRBA로 대각에 들어옴), 섀시 몸체(`robot.body`)는 Z 회전에 달린다. 세계 설명의 부모 −1 관절은 섀시의 자식이다. 필드 축 직선이라 q̇ = v가 정확해 같은 CRBA·RNEA·암시 오일러·상자 LCP를 그대로 쓴다. 바퀴 없는 로봇은 기저가 고정이며 3b와 바이트 그대로다. 자세한 3c 내용은 별도 문서의 몫이다.

---

## 9. 구동기를 관절 좌표에 거는 방법(`world.ts`)

### 9.1 생성(`PhysicsWorld` 생성자)

- 관절 모터 장치 → `jointMotors: 장치 이름 → {coordinate(φ), dc: DcGearMotor(drive.params)}`. 한 관절에 모터가 여럿이면 같은 `DcGearMotor` 인스턴스·같은 좌표를 가리키고, 장치마다 `driveForces`에서 같은 좌표에 더해진다(토크 N배).
- 관절 모터가 아닌 모터는 `free` 좌표(armature = `rotorInertia·gearbox²` + 그 모터가 구동하는 바퀴의 회전 관성 ÷ 외부 감속비², 3c).
- 서보·CR 서보: 관절 좌표 `z = q`에 `JointServo{coordinate, device, ratio, params, continuous, zeroPulseUs, direction, command}`.
- 모터 한 대: `DynamicMotor{coordinate, dc, ticksPerRad, controller: HubMotorController, control: HubVelocityWindow, out, velocityPidf, positionPidf, stage, raw, current}`. 기본 PIDF는 `DEFAULT_VELOCITY_PIDF`·`DEFAULT_POSITION_PIDF`, 기본 전력단은 FLOAT.

### 9.2 한 틱의 처리(`integrate`)

1. 모터마다 앞 틱의 출력으로 `out = readMotorOutputs(values)`, `velocityPidf`·`positionPidf = readPidf(…)`를 갱신하고 `shaftOffset`·`lastEncoderResets`를 정한다. 서보마다 `command = servoCommand(values, params, continuous, zeroPulseUs, direction)`.
2. `gridSubsteps(tStart, dtNanos)`로 1 ms 절대 격자 하위 단계 `(start, end, h)`를 만든다(`h = (end − start)/1e9`).
3. 하위 단계마다 `substep(art, t, h, voltage, tEnd)` 후 `recordEncoders(end)`(모터 `hubVelocity`·`control` 창에 `(tNanos, raw)`를 기록).
4. 구간 끝에서 `motorCurrents`: `current = abs(dc.current(stage, voltage, v[coordinate]))`.

### 9.3 `substep` 순서

1. `t ≥ nextSample`이면 모든 모터 `controller.sample(...)`(§6.4).
2. `stage = controller.stage(out)`, `duty`에 `forwardSign`을 곱함.
3. (3c/5/6a: 접촉·충돌·공 행을 모음)
4. `art.step(h, (z, v) => driveForces(z, v, voltage), contacts)`. 던지면 `v` 전체를 0으로 두고 위치는 그대로 둔 채 `worldError`(같은 detail은 실행마다 한 번), 다음 하위 단계에서 다시 푼다.
5. `raw = forwardSign · ticksPerRad · z[coordinate]` 갱신.

`driveForces`는 모터마다 §5.4, 서보마다 §7.5, 바퀴 좌표(3c)마다 굴림 저항 마찰을 `force`·`damping`·`stiffness`·`boxLo`·`boxHi`·`regions`에 더한다.

### 9.4 엔코더·입력

| 입력 키        | 값                                                                                  |
| -------------- | ----------------------------------------------------------------------------------- |
| `position`     | `floor(raw)`(원시 허브 틱, 정수). 포드와 포트를 함께 쓰는 모터는 포드 값(실제 배선) |
| `velocity`     | `hubVelocity.ticksPerSecond()`(§6.5, 20의 배수). 포드와 함께 쓰면 포드 값           |
| `current`      | 단자 전류 크기(A)                                                                   |
| 허브 `voltage` | 배터리 전압(일정)                                                                   |

---

## 10. 관절 설정 기본값·범위와 세계 설명 한도

### 10.1 관절 설정 기본값(`scene/joint.ts`)

`SceneObject.joint`(`PROJECT_VERSION` 8, Unity ArticulationBody)는 시뮬레이터 전용 설정이라 생성 코드·구성 XML·검증·사용처와 관계없다. 내부 값은 미터·라디안·N·N·m. `defaultJoint(type = 'revolute')`: 앵커 [0, 0, 0], 축 `'x'`(Unity ArticulationBody처럼 앵커의 X: 회전은 X 둘레, 직선은 X 방향), `axisSign` 1, 스프링 없음, 구동 `none`.

| 항목                  | 회전(revolute)                                 | 직선(prismatic)                            | 상태·근거                                                                                                                                                 |
| --------------------- | ---------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 한계             | lower −π/2, upper +π/2 (±90°)                  | lower 0, upper 0.5 m                       | [가정: 회전은 편집 자세에서 위아래로 접는 팔, 직선은 goBILDA 2단 키트 이동 488 mm에 가까운 수]. spec-3b §2                                                |
| 기본 쿨롱 마찰        | 0.02 N·m                                       | 1 N                                        | [가정: 회전은 베어링 축 하나, 직선은 볼 서랍 슬라이드 μ 0.01 × 옆 하중 ~100 N 수준, [DATA] §5.4]. 측정: 모터를 뗀 관절을 아주 천천히 끄는 힘(용수철 저울) |
| 기본 점성 마찰        | 0.001 N·m·s/rad                                | 0.5 N·s/m                                  | [가정]. 측정: 두 속도에서 끄는 힘의 차 ÷ 속도 차                                                                                                          |
| 리밋 스위치 눌림 거리 | 1° (`π/180`) (`DEFAULT_LIMIT_WITHIN.revolute`) | 0.002 m (`DEFAULT_LIMIT_WITHIN.prismatic`) | [가정: spec-3b §1-12]. 팀 칸: touch·digital 컴포넌트의 limitDistance·limitAngle                                                                           |

종류 값은 `JOINT_TYPES` revolute·prismatic, 축 `JOINT_AXES` x·y·z, 구동 `JOINT_DRIVE_KINDS` none·motor·servo·crServo·stage, 리깅 `JOINT_RIGGING_KINDS` direct·cascade·continuous다. 위 기본 한계·마찰은 `scene/joint.ts`의 `DEFAULTS` 표다.

종류를 바꿀 때(`jointTypePatch`): 한계·마찰이 이전 종류의 기본값 그대로면 새 종류의 기본값으로 바꾸고 고친 값은 그대로 둔다(바퀴 지름과 같은 규칙).

### 10.2 구동 기본값(`defaultJointDrive`)

| 구동 종류      | 기본값                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `motor`        | `motors: []`, `gearRatio: 1`, `spoolDiameter: DEFAULT_SPOOL_DIAMETER`, `rigging: {kind: 'direct'}` |
| `servo`        | `servo: ''`, `gearRatio: 1`, `editPosition: 0.5`, `direction: 1`                                   |
| `crServo`      | `servo: ''`, `gearRatio: 1`, `spoolDiameter: DEFAULT_SPOOL_DIAMETER`, `direction: 1`               |
| `none`·`stage` | `{kind}`만                                                                                         |

| 항목                | 값                                                 | 위치                          | 상태·근거                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 스풀 지름      | 0.112/π = 0.0356507 m (둘레 112 mm, 지름 35.65 mm) | `DEFAULT_SPOOL_DIAMETER`      | [확인: goBILDA 2단 Viper-Slide 키트의 Hub-Mount Winch Pulley, https://www.gobilda.com/2-stage-viper-slide-kit/ "each rotation of the pulley will cause the slide kit to move that amount", spec-3b data §5.1] |
| 편집 자세 서보 위치 | 0.5 (1500 µs)                                      | `DEFAULT_SERVO_EDIT_POSITION` | 서보 혼을 가운데에서 끼우는 것이 흔한 조립 방법이지만 팀마다 다르므로 관절 카드에서 고침                                                                                                                      |

### 10.3 설정 범위·정리(`sanitizeJoint`와 상수)

범위 밖·유한하지 않은 수는 기본값으로 바꾸고 새 객체를 만든다(키 순서 고정). 장치·관절 id는 남긴다(지운 장치를 가리키는 id는 세계 설명을 만들 때 경고).

| 항목                       | 범위                                                                                                                                             | 위치(상수)                                               | 비고                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 앵커 성분                  | abs(x) ≤ 10 m (아니면 [0,0,0])                                                                                                                   | `MAX_JOINT_ANCHOR`                                       | 세계 설명의 위치 한도 `MAX_COORD`와 같음                                                                                                                                     |
| 회전 한계                  | ±4π rad                                                                                                                                          | `MAX_REVOLUTE_LIMIT`                                     | 회전은 null(제한 없음)도 허용, 직선은 늘 있어야 함                                                                                                                           |
| 직선 한계                  | ±10 m                                                                                                                                            | `MAX_PRISMATIC_LIMIT`                                    | -                                                                                                                                                                            |
| 한계 규칙                  | `lower ≤ upper`, 둘 다 범위 안, **0을 품어야 함**                                                                                                | `sanitizeLimits`                                         | 한계는 편집 자세(q = 0) 기준이라 0을 품어야 시작 자세가 한계 밖이 아니다(첫 틱에 튐). 0을 품지 않으면 가까운 끝을 0으로 넓힘([0.1, 0.5] → [0, 0.5]). 어기면 그 종류의 기본값 |
| 장치 출력축 → 관절 감속비  | 0.01–1000                                                                                                                                        | `MIN_JOINT_GEAR_RATIO`·`MAX_JOINT_GEAR_RATIO` (아니면 1) | -                                                                                                                                                                            |
| 스풀 지름                  | 1 mm–0.5 m                                                                                                                                       | `MIN_SPOOL_DIAMETER`·`MAX_SPOOL_DIAMETER` (아니면 기본)  | -                                                                                                                                                                            |
| 다단 슬라이드 위 단 수     | 15 (`MAX_WORLD_JOINTS − 1`)                                                                                                                      | `MAX_JOINT_STAGES`                                       | 관절 한도에서 아래 단 하나를 뺀 수                                                                                                                                           |
| 구동 모터 수               | 4                                                                                                                                                | `worldSpec.ts` `MAX_JOINT_MOTORS`                        | 양쪽 리프트 등                                                                                                                                                               |
| 모터·위 단 id 목록         | 빈 id·겹치는 id를 빼고 앞의 모터 4개(`MAX_JOINT_MOTORS`)·단 15개(`MAX_JOINT_STAGES`)만 둠                                                        | `idList`                                                 | 지운 장치·관절을 가리키는 id는 남긴다(세계 설명을 만들 때 경고)                                                                                                              |
| 쿨롱 마찰·정전력 스프링    | 0–1e4 N 또는 N·m (유한한 0 이상이면 한도로 자름. 쿨롱 마찰이 음수·비유한 수면 그 종류의 기본 마찰, 정전력 스프링이 음수·비유한 수면 스프링을 뗌) | `MAX_JOINT_FORCE`                                        | [가정: FTC 메커니즘보다 넉넉히 두고 틀린 단위·폭주 값만 막음]. 점성도 같은 규칙(음수·비유한 수면 기본 점성)                                                                  |
| 점성                       | 0–1e4 N·s/m 또는 N·m·s/rad                                                                                                                       | `MAX_JOINT_DAMPING`                                      | 같음                                                                                                                                                                         |
| 스프링 강성                | 0–1e6 N/m 또는 N·m/rad                                                                                                                           | `MAX_JOINT_STIFFNESS`                                    | 쉬는 자리 `rest`는 한도 안(회전 4π, 직선 10 m)이어야 하고 아니면 스프링을 뗌                                                                                                 |
| 서보 편집 위치             | 0–1 (아니면 0.5)                                                                                                                                 | `servoPosition`                                          | -                                                                                                                                                                            |
| 서보 direction             | 1 또는 −1 (아니면 1)                                                                                                                             | `direction`                                              | -                                                                                                                                                                            |
| 리밋 스위치 눌림 거리 상한 | 1 (m 또는 rad)                                                                                                                                   | `hardware/catalog.ts` `MAX_LIMIT_WITHIN`                 | 세계 설명이 받는 스위치 `within` 상한                                                                                                                                        |
| 모터 gearbox 속성          | 0(모델 기본) 또는 0.01–10000                                                                                                                     | `catalog.ts` `MIN_GEARBOX`·`MAX_GEARBOX`                 | -                                                                                                                                                                            |

스프링 종류: `constantForce {force}`(+q 방향 일정한 힘, CLAUDE.md의 "정하중"), `linear {stiffness, rest}`(F = −stiffness·(q − rest)).

관절을 붙일 수 있는 오브젝트(`canHaveJoint`): group·assembly·part·CAD 루트(robot은 아님, 움직이지 않는 뿌리) **그리고 바퀴가 없는 오브젝트**.

### 10.4 세계 설명 한도·검증(`worldSpec.ts`, 메인이 렌더러 값을 믿지 않음)

| 항목                        | 한도                                                                                                                                                                                    | 위치                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 관절 수                     | 16                                                                                                                                                                                      | `MAX_WORLD_JOINTS`                                      |
| 관절당 리밋 스위치 수       | 8                                                                                                                                                                                       | `MAX_JOINT_SWITCHES`                                    |
| 관절 부모                   | 정수, −1 ≤ parent < 자기 순번(부모가 먼저)                                                                                                                                              | `joint()`                                               |
| 한계                        | 회전 lower ∈ [−4π, 0], upper ∈ [0, 4π]; 직선 ±10 m; 직선은 null 불가                                                                                                                    | `joint()` ("편집 자세가 한계 안")                       |
| 몸체 질량                   | 1e-9 ≤ mass ≤ 1000 kg                                                                                                                                                                   | `MAX_BODY_MASS`, `body(…, 1e-9)`                        |
| 관성 성분                   | abs ≤ 1000 kg·m², 대칭 양반정치(주관성 값 ≥ −tol), 삼각 부등식(I1 + I2 ≥ I3), tol = 1e-9 × (대각 합)                                                                                    | `MAX_INERTIA`·`INERTIA_TOLERANCE`·`isValidInertia`      |
| 단위 축 길이                | abs(길이 − 1) ≤ 1e-3(받으면 정규화), 축 성분 abs ≤ 2                                                                                                                                    | `AXIS_TOLERANCE`, `unitAxis`                            |
| 관절 몸체 무게중심          | 각 성분 abs ≤ 10 m                                                                                                                                                                      | `MAX_COORD`, `body()`                                   |
| 섀시 몸체(`robot.body`, 3c) | 질량 1e-3 ≤ mass ≤ 1000 kg(관절 몸체는 1e-9부터), 무게중심·관성은 관절 몸체와 같은 한도                                                                                                 | `parseWorldSpec` `body(robot.body, 'robot.body', 1e-3)` |
| 관절 원점 위치              | abs ≤ 10 m; 회전 abs ≤ 4π                                                                                                                                                               | `MAX_COORD`                                             |
| 마찰·스프링                 | 위 §10.3 한도와 같음(`MAX_JOINT_FORCE` 등)                                                                                                                                              | `worldSpec.ts` 같은 이름 상수                           |
| 구동 전달비 abs(ratio)      | 1e-6 ≤ abs ≤ 1e3                                                                                                                                                                        | `MIN_RATIO`·`MAX_RATIO`                                 |
| 모터 params                 | stallTorque 1e-6–1e3; freeSpeed 1e-3–1e5; stallCurrent 1e-3–1e3; freeCurrent 0–1e3 이고 < stallCurrent; gearbox 0.01–10000; efficiency 0.01–1; rotorInertia 0–1; backdriveFriction 0–10 | `motorParams()`                                         |
| 서보 params                 | stallTorque 1e-6–1e3; freeSpeed 1e-3–1e4; rangeAngle 0–4π; deadbandUs 0–100; kp 0–1e6; kd 0–1e4; crFullPower 0.01–1; limpFriction 0–1e3                                                 | `servoParams()`                                         |
| 서보 `zeroPulseUs`          | 500–2500 µs(위치 서보만)                                                                                                                                                                | `jointDrive()`                                          |
| 리밋 스위치                 | `within` 0–1; 한계 없는 관절에는 둘 수 없음                                                                                                                                             | `jointSwitch()`                                         |
| 다단 리깅 위 단 목록        | 1–15개 정수 ≥ 0; 단은 `drive 'stage'`인 직선 관절이고 구동 관절 하나에만 들어 있음                                                                                                      | `rigging()`·`checkJointReferences`                      |
| 배터리 전압                 | 1–30 V                                                                                                                                                                                  | `parseWorldSpec`                                        |

---

## 11. 세계 설명 빌더 규칙(`play/worldJoints.ts`)

순수 함수(씬 문서와 질량 모델만으로 정해짐). 끊긴 참조·쓸 수 없는 설정은 Console 경고(`console.notices.world*`)로 알리고 그 부분만 빼서 실행은 막지 않는다.

### 11.1 상수

| 항목                        | 값        | 단위  | 위치                                | 상태·근거                                                                                                                                                                                            |
| --------------------------- | --------- | ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 몸체 질량 없을 때 대체 질량 | 0.001     | kg    | `FALLBACK_BODY_MASS`                | spec-3b §1-10(1 g)                                                                                                                                                                                   |
| 몸체 관성 대각 하한         | 4e-8      | kg·m² | `MIN_BODY_INERTIA`                  | [가정: 1 g 질량을 반지름 1 cm 구로 본 관성 2/5 · 0.001 · 0.01²]. 점질량 몸체(형상 없는 그룹의 질량 덮어쓰기)가 관절 축 위에 있어도 질량 행렬이 특이하지 않게. 보통 몸체 관성 1e-4–1e-2보다 훨씬 작음 |
| 관절당 리밋 스위치 수       | 8         | 개    | `MAX_JOINT_SWITCHES`                | 세계 설명 검증 한도와 같음(가정: 넉넉히 두고 틀린 단위·폭주만 막음)                                                                                                                                  |
| 구동 전달비 하한·상한       | 1e-6, 1e3 | -     | `MIN_DRIVE_RATIO`·`MAX_DRIVE_RATIO` | 같음. 직선 관절의 ratio는 스풀 반지름 ÷ 외부 감속이라 1 mm 스풀 × 1000:1이면 5e-7로 범위 밖                                                                                                          |

### 11.2 몸체 나누기와 관절 틀(`jointBodyFrames`)

- 관절 오브젝트: 로봇 하위 문서 순서(깊이 우선이라 부모가 먼저). 한도(`MAX_WORLD_JOINTS` 16)를 넘는 관절은 쓰지 않고 경고 `worldTooManyJoints`. 뺀 관절의 하위는 가장 가까운 남은 관절(또는 로봇)의 몸체로 센다.
- 몸체(`bodyOf`): 오브젝트마다 가장 가까운 자신·상위 관절의 순번(로봇 몸체 −1). `jointBodyIds`는 관절 오브젝트 하위에서 안쪽 관절의 하위를 뺀 것.
- 관절 틀(편집 자세 q = 0): `frames[i] = robotFrame(object) · Translate(anchor)`(오브젝트의 로봇 좌표 행렬에 앵커만큼 이동, 회전은 오브젝트 로컬 축 그대로라 관절 축은 관절 틀의 x·y·z 중 하나). 부모가 로봇이 아니면 `relative = inverse(frames[parent]) · frames[i]`, 로봇이면 `frames[i]`. 그 변환을 `matrixToTransform`으로 위치와 ZYX 오일러로 바꿈.
- 축: `AXES[axis]`의 성분 × `axisSign`(0이 −0이 되지 않게 `signed`).

### 11.3 몸체 질량 성질(`bodies`)

몸체 i의 오브젝트들의 질량 모델 자기 몫(`MassModel.own`, 로봇 좌표)을 합친다:

```
total = Σ own.mass
com   = Σ(own.mass · own.centerOfMass) / total
I_body(로봇 좌표, com 기준) = Σ [ own.inertia + m·(평행축 항: [dy²+dz², dx²+dz², dx²+dy², −dx·dy, −dx·dz, −dy·dz]) ]   // d = own.com − com
관절 틀로: com_joint = inverse(frames[i]) · com;  I_joint = Rᵀ · I_body · R   (R = frames[i]의 회전, inertiaInFrame)
withInertiaFloor: 대각의 최솟값이 MIN_BODY_INERTIA보다 작으면 세 대각 모두에 MIN_BODY_INERTIA를 더함(등방 관성 가산)
```

- `total`이 0이거나 유한하지 않으면 대체 몸체 `{mass: FALLBACK_BODY_MASS, com: 0, inertia: withInertiaFloor(0)}`와 경고 `worldJointNoMass`(질량 모델을 계산하는 경우만).
- 읽는 중인 메시가 있으면 `worldJointMassPending`.
- 질량 모델이 없는 호출(로봇 카드의 구동계 요약)은 몸체를 모두 대체 질량으로 두고 질량 경고를 내지 않는다(`mass: null`).
- `bodyMasses[i]`는 질량을 아는 몸체의 로봇 좌표 질량 성질(섀시 몸체는 로봇 전체에서 이것을 뺌), 모르는 몸체는 null.

### 11.4 구동 만들기

**모터(`drive.kind === 'motor'`)**

- `ratio = (revolute) ? 1/gearRatio : spoolDiameter/2/gearRatio`. 범위 밖이면 `worldJointRatioRange`, 구동 없음.
- 모터 목록: 같은 로봇의 `motor` 컴포넌트(`components.get`)이고 세계 설명에 들어간(`motorDevices`) 것만. 없음/지움 `worldJointMotorMissing`, 모터 없음 `worldJointNoMotor`, 바퀴 모터와 겹침 `worldJointMotorOnWheel`, 앞 관절이 이미 씀 `worldJointMotorShared`(먼저 온 관절에 준다).
- 같이 묶은 모터는 **첫 모터의 `SimMotorParams`** 하나를 모든 장치에 쓰고 시뮬레이터가 장치마다 그 토크를 더한다(`jointMotorParams`). 형식·감속비·덮어쓰기가 달라 값이 다르면 `worldJointMotorsDiffer`. 모터가 하나도 없으면 구동 없음.
- 모터 컴포넌트 → 물리 값(`motorComponentParams`): `motorModel`(모르면 `unspecified`), `gearbox`(0.01–10000이면 그 값, 아니면 `'default'`), 덮어쓰기 `stallTorque`·`freeSpeed`(0이면 데이터시트) → `resolveMotorParams(MOTOR_MODEL_TAGS[model], gearbox, overrides)`.
- 다단 슬라이드(`rigging`): 직선 관절의 모터 구동만. 위 단은 아래에서 위 순서로, 단마다 앞 단(첫 단은 이 관절)을 부모로 둔 직선 관절이고 구동이 `'stage'`이며 다른 리깅이 이미 쓰지 않은 것이어야 한다. 맞지 않는 단에서 멈추고 그 뒤 단은 쓰지 않음(`worldJointStageInvalid`). 단이 하나도 유효하지 않으면 `direct`. 어느 리깅에도 들지 않은 `stage` 관절은 구동 없음(`worldJointStageOrphan`).

**서보·CR 서보**

- 서보 컴포넌트가 없거나 종류가 다르면 `worldJointServoMissing`. 위치 서보는 회전 관절만(직선이면 `worldJointServoOnSlide`, CR 서보 + 스풀로). `ratio = (CR 서보 && 직선) ? spoolDiameter/2/gearRatio : 1/gearRatio`, 범위 밖이면 `worldJointRatioRange`.
- 서보 장치 이름은 모터 이름·다른 서보·리밋 스위치와 겹치지 않는다(`worldJointServoShared`).
- `params = resolveServoParams(servoModel, kind)`. 위치 서보는 `zeroPulseUs = servoEditPulseUs(editPosition, props)`, `direction`.

**`servoEditPulseUs(position, props)`** — 팀 코드가 `setPosition(position)`을 주었을 때 허브가 내는 펄스(µs). SDK `ServoImpl.setPosition`과 같은 순서로 거친다:

```
p = clamp(position, 0, 1)
direction === 'reverse'  →  p = 1 − p
min = clamp(scaleMin, 0, 1), max = clamp(scaleMax, 0, 1)      // 유한 수 아니면 0, 1
min < max  →  p = min + p·(max − min)                         // Range.scale (min ≥ max면 비율 없이)
[lo, hi] = (pulseRange === 'fullRange') ? [500, 2500] : [600, 2400]    // `SERVO_PULSE_RANGES`. 구성 XML Servo·ServoFullRange의 @ServoType PwmRange(사이드카 SandbotHardware.SERVO_TYPES: Servo·ContinuousRotationServo 600–2400, ServoFullRange 500–2500)
pulse = lo + p·(hi − lo)
```

팀 코드가 실행 중 다른 방향·범위를 쓰는 것은 인스펙터 기준이라 따르지 않는다(모터 방향과 같은 규칙).

### 11.5 리밋 스위치 목록

`touchSensor`·`digitalDevice` 컴포넌트의 `limitJoint`가 가리키는 관절(`indexOf`)에 `{device, kind: 'touch'|'digital', at: limitAt === 'upper' ? 'upper' : 'lower', within}`을 건다. `within = (prismatic ? limitDistance : limitAngle)`이 유한한 양수면 `min(within, MAX_LIMIT_WITHIN)`, 아니면 `DEFAULT_LIMIT_WITHIN[type]`. 경고: 관절 없음 `worldLimitSwitchJointMissing`, 한계 없음 `worldLimitSwitchNoLimit`, 이름 중복 `worldLimitSwitchDuplicate`, 관절당 8개 초과 `worldLimitSwitchTooMany`.

### 11.6 관절 하위 센서·바퀴

3b는 관절 하위의 IMU·OTOS·데드휠·Pinpoint(와 그 포드)·바퀴를 로봇 몸체에 붙은 것으로 계산하고 경고만 낸다(`worldSensorOnJoint`, `worldWheelOnJoint`). 거리·컬러 센서·웹캠은 관절 몸체에 붙는다(4c·4d).

### 11.7 세계 설명 관절 한 개의 출력

`{parent(몸체 부모 순번, −1 섀시), type, origin{position, rotation(ZYX)}, axis, limits, body, friction{coulomb, viscous}, spring, drive, switches}`.

---

## 12. 리밋 스위치(시뮬레이터, `world.ts` `inputs`)

스위치가 걸린 관절의 한계가 있을 때: `pressed = (at === 'lower') ? q_i ≤ lower + within : q_i ≥ upper − within`. touch는 `pressed = pressed`, digital은 `state = !pressed`(풀업 핀이 눌리면 LOW). 한계에 닿으면 실제 한계에서 멈추고(§8.7) 스위치가 눌린다.

---

## 13. 인스펙터 계산값(`editor/joint/jointCardModel.ts`)

Articulation Body 카드의 계산값 줄(세계 설명과 같은 값을 읽도록 같은 함수를 쓴다).

| 항목                | 식                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전압 척도           | `voltageScale = batteryVoltage / 12`(모터만, 서보는 5 V 허브 전원이라 적용하지 않음)                                                                                                                                            |
| 전달비              | `perOutputRad = (prismatic ? spoolDiameter/2 : 1) / gearRatio`                                                                                                                                                                  |
| 모터 최고 속도      | `maxSpeed = freeSpeed · voltageScale · perOutputRad`(같이 묶은 모터는 첫 모터 값)                                                                                                                                               |
| 모터 정지 토크 용량 | `capacity = n_motors · stallTorque · voltageScale / perOutputRad`(관절 좌표의 힘/토크, 같이 묶은 모터는 모터 수배)                                                                                                              |
| 서보                | `maxSpeed = servo.freeSpeed · perOutputRad`, `capacity = servo.stallTorque / perOutputRad`(CR 서보의 직선이면 스풀 반영)                                                                                                        |
| 중력·스프링 부하    | 관절 좌표(다단이면 첫 단 좌표, 연속 리깅은 줄 길이)의 `abs(Σ 중력 + 스프링)`. 캐스케이드는 단마다 상대 이동이 같아 각 단의 하위 짐이 모두 걸려 합(Σ), 연속은 줄 장력 하나가 모든 단에 걸려 가장 무거운 짐(max, 첫 단이 진 전체) |
| 여유 `margin`       | `capacity / load`(`load > NEGLIGIBLE_LOAD` 1e-6일 때만). `margin < 1`이면 경고 `cannotHold`                                                                                                                                     |
| 끝 단 속도          | 캐스케이드 `(단 수 + 1) · maxSpeed`(맨 위 단), 연속 `1 · maxSpeed`                                                                                                                                                              |

몸체 질량 0이면 시뮬레이터는 1 g으로 두므로 `noMass`, 읽는 중 메시는 `massPending`을 알린다.

부하 계산의 세부(`jointCardModel.ts`):

| 항목                                     | 식·값                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 관절 하나의 중력(`gravityForce`)         | q = 0에서 하위 전체(안쪽 관절도 편집 자세)의 질량 m·무게중심 c(질량 모델 `ObjectMass`, 로봇 좌표), 중력 `weight = (0, 0, −GRAVITY·m)`. 회전 `u·((c − p) × weight)`(p = 앵커의 로봇 좌표, u = 관절 축), 직선 `weight·u`. 질량이 없거나 0 이하면 0                                                               |
| 스프링 힘(`springForce`)                 | q = 0에서 관절 좌표 +방향으로 미는 힘: `constantForce`는 `force`, `linear`는 `stiffness · rest`(= −stiffness·(0 − rest))                                                                                                                                                                                       |
| 다단 부하                                | `stageForces = [관절, …유효한 위 단].map(중력 + 스프링)`. cascade·direct는 합, continuous는 절댓값이 가장 큰 값. `load = abs(…)`. 유효한 위 단은 단마다 가장 가까운 관절 상위가 바로 아래 단이고 구동이 `stage`인 직선 관절이며 겹치지 않아야 한다(`validStages`, 맞지 않는 단에서 멈추고 경고 `stageInvalid`) |
| `NEGLIGIBLE_LOAD`                        | 1e-6 N 또는 N·m [가정: 표시 자릿수 아래]. 이보다 작은 부하는 여유(`margin`)를 계산하지 않는다                                                                                                                                                                                                                  |
| 미리보기 슬라이더 범위(`previewRange`)   | 한계가 있으면 [lower, upper], 한계 없는 회전 관절은 [−π, π]. 문서를 바꾸지 않는 보기 상태                                                                                                                                                                                                                      |
| 한계 칸 편집(`withLimit`)                | 아래 ≤ 0 ≤ 위로 자르고 `lower ≤ upper`를 지킨다(−0은 0)                                                                                                                                                                                                                                                        |
| 칸 상한(`NON_NEGATIVE_MAX`)              | 쿨롱 `MAX_JOINT_FORCE` 1e4, 점성 `MAX_JOINT_DAMPING` 1e4, 정전력 스프링 `MAX_JOINT_FORCE`, 강성 `MAX_JOINT_STIFFNESS` 1e6. 0 이상으로 자르고 비유한 수는 0(`nonNegativeJointValue`)                                                                                                                            |
| 선형 스프링 기준 위치(`springRestValue`) | 회전 ±`MAX_REVOLUTE_LIMIT`(4π rad), 직선 ±`MAX_PRISMATIC_LIMIT`(10 m)로 자른다(비유한 수는 0)                                                                                                                                                                                                                  |
| 축 이름(`robotAxisName`)                 | 로봇 축 하나와 `abs(abs(성분) − 1) < 1e-6`이면 그 축(+X 앞·+Y 왼쪽·+Z 위…), 아니면 벡터 [가정: CAD 정렬 회전의 반올림 오차, 0.06° 아래]                                                                                                                                                                        |

---

## 14. 설계 결정·Unity 대응·임시 편차

### 14.1 설계 결정 요약

| 결정                                                                                          | 이유·근거                                                                                                                                                                                 | 표시        |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 기어모터는 제조사 데이터시트 출력축 정지 토크·무부하 속도(감속비별 표)에서 R·Kt·Ke를 유도한다 | 사용자 결정(spec-3b §1.1·결정 1). gm0 다이노 값(goBILDA 0.19 N·m·11 A, HD Hex 0.18 N·m·11 A, NeveRest 0.17 N·m·9.8 A)은 데이터시트보다 1.3–2.7배 커서 쓰지 않는다(`actuatorData.ts` 주석) | 사용자 결정 |
| 기어 효율 유성 단당 0.95, 평기어 0.85, Core Hex 0.7                                           | spec-3b 결정 2. 힘 흐름 방향마다 효율이 다르다는 모델(§5.4)과 함께                                                                                                                        | 결정        |
| 출력 토크를 G·τ_m(선형, 암시 감쇠) + 한쪽 마찰 상자(1 − η)·abs(τ)로 둔다                      | 영역을 나눠 바꾸지 않아 경계에서 떨지 않음(spec-3b §1.2)                                                                                                                                  | 결정        |
| 모터축 마찰은 한 번만 센다(쿨롱 τ_c + 무부하 전류에 맞춘 점성 b)                              | 3b 비평 C9                                                                                                                                                                                | 결정        |
| 전력단은 VNH5050 비동기 PWM + 본체 다이오드 하나(`BODY_DIODE_DROP`)                           | gm0 control-system-internals. FLOAT로 내리는 속도가 power −1보다 약 0.12·ω_free 빠르게                                                                                                    | 결정/근사   |
| 위치 루프는 P만, 속도 루프에서 I는 10 ms마다 I·e 합, 포화 시 적분에서 넘친 만큼 뺌            | 3b 비평 §2.3·§2.4(위치 I를 주기 합으로 넣으면 넘침·진동, 목표에 닿는 유일한 해석). 펌웨어 공개 자료 없음                                                                                  | [가정]      |
| 허브는 BRAKE·FLOAT를 `zeroPower`와 `enabled false`(FLOAT)로 나눔(spec-3b §1.8)                | 실제 허브 동작                                                                                                                                                                            | 결정        |
| 서보 내부 PD를 모터 직선으로 자르고 역구동에서는 속도에 따라 더 버틴다                        | 정지 토크 고정 잘림은 과부하 팔을 감쇠 없는 진자로 만들었음(§7.4)                                                                                                                         | 결정        |
| 서보 방향·편집 위치를 관절 카드에서 팀이 정한다(`direction`, `editPosition`)                  | 혼을 끼운 각과 관절 축 방향이 팀마다 다름                                                                                                                                                 | 결정        |
| 관절 좌표는 감소 좌표(z), 다단 슬라이드는 전달 행렬 S로 리깅한다                              | cascade는 자유도 1, continuous는 줄 길이 하나(Σq = r·θ). 어느 단이 먼저 움직일지는 중력·마찰·한계가 정함(§8.1)                                                                            | 결정        |
| 한계는 상자 LCP + 한계 충격으로, 반발 0(비탄성)                                               | 결합 자식의 운동량을 보존(예전 v_C = 0 방식은 0–100 % 잃음), 에너지 증가 방지(§8.7)                                                                                                       | 결정        |
| 한계는 q = 0(편집 자세)을 늘 포함                                                             | 시작 자세가 한계 밖이면 첫 틱에 튐. 세계 설명 검증도 받지 않음(§10.3)                                                                                                                     | 결정        |
| 같이 묶은 모터는 첫 모터 값 × 개수, 형식이 다르면 경고                                        | 세계 설명의 모터 구동은 값 하나를 모든 장치에 씀                                                                                                                                          | 결정        |
| 몸체 질량 없으면 1 g과 경고, 관성 하한 4e-8                                                   | 질량 행렬이 특이하지 않게(§11)                                                                                                                                                            | 결정/[가정] |
| 배터리 전압 일정(전압 강하 모델 없음)                                                         | 3b·3c 한계. 모터는 단자 전압에 V_bat를 직접 씀                                                                                                                                            | 근사        |
| 풀이 실패는 조용히 자르지 않고 하위 단계의 모든 속도를 0으로 두고 `worldError`로 알림         | 결정성·진단                                                                                                                                                                               | 결정        |
| `[가정]` 값은 상수 옆 주석과 `docs/assumptions.md`에 함께 적는다                              | CLAUDE.md 불변 조건(가정값은 두 곳에 적는다)                                                                                                                                              | 규칙        |

### 14.2 Unity 대응

| SandBot                                                         | Unity                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `SceneObject.joint`(회전·직선, 앵커·축·한계·마찰·스프링)        | ArticulationBody(Joint Type·Anchor·Axis·Limits·Friction·Damping). 인스펙터 카드 이름이 같다 |
| 감소 좌표 관절 나무(Featherstone: CRBA·RNEA)                    | PhysX articulation                                                                          |
| 기본 축 'x'(회전은 X 둘레, 직선은 X 방향), 앵커는 오브젝트 로컬 | ArticulationBody 기본 축                                                                    |
| 속도 암시 오일러 `(M + hD + h²K)v⁺ = …`                         | MuJoCo implicitfast·discrete 방식을 참고(Unity가 아닌 외부 출처)                            |
| 바로 붙은 부모–자식 충돌 무시(5)                                | PhysX `filterArticulationLinks`와 같음                                                      |

### 14.3 Unity에 대응이 없는 것(임시 편차 표시 여부)

CLAUDE.md의 3b 항목은 이 구성요소들에 "임시 편차"라는 표시를 따로 달지 않았다. 코드·CLAUDE.md 서술에서 Unity 이름을 따랐다고 적힌 범위는 §14.2까지이고, 아래는 FTC 하드웨어(허브·모터·서보·리밋 스위치)를 나타내려고 SandBot이 더한 구성요소를 이 문서가 나열한 것이다(Unity와의 대응 여부는 코드에 기록 없음): 다단 슬라이드 리깅(cascade·continuous), 모터·서보·CR 서보 구동 칸과 스풀 지름, 서보 편집 자세 위치·방향, 리밋 스위치 연결(`limitJoint`), 미리보기 슬라이더(문서를 바꾸지 않는 보기 상태), 인스펙터 계산값 줄(정지 토크 대비 부하).

---

## 15. 알려진 한계·남은 일

CLAUDE.md "메커니즘 관절(3b)·구동계(3c)" 한계와 코드 주석·assumptions.md에서 3b에 해당하는 것.

| 한계                                                                                                                                                  | 위치·비고                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 관절 하위의 IMU·OTOS·데드휠·Pinpoint 움직임은 표현하지 않는다(경고만, 섀시에 붙은 것으로 계산)                                                        | §11.6                           |
| 배터리 전압 강하 없음(일정)                                                                                                                           | §2                              |
| SPARK Mini 구동 관절 없음(drive none + 경고): 서보 포트 모터 컨트롤러는 모터 컴포넌트가 아니라 형식·감속비가 없어 세계 설명 관절 구동이 나타내지 못함 | `actuators.ts` 머리 주석        |
| continuous 리깅이 내려갈 때 단 순서는 마찰·중력이 정해 실제와 다를 수 있다                                                                            | §8.1                            |
| 팀 코드가 실행 중 서보 방향·scaleRange를 인스펙터와 다르게 쓰는 것은 따르지 않는다                                                                    | §11.4                           |
| 실물로만 재는 값(허브 기본 PIDF·주기, 회전자 관성, 역구동 토크, 기어 효율, 슬라이드 마찰)은 가정이다(`p11joint/research/data.md` §9)                  | §4.2·§6.3·§10.1                 |
| REV SRS처럼 CR 펄스 범위가 SDK 기본보다 넓은 서보: 팀이 PWM 범위를 2500 µs로 넓히면 실제는 최고 속도에 닿지만 시뮬레이터는 90 %에서 멈춘다            | §7.2                            |
| 엔코더·토크 감속비 두 출처: 감속비 칸이 0인 Core Hex·TETRIX 바퀴는 토크(제조사 표)와 엔코더(SDK 규칙)의 감속비가 다르다                               | §3.3                            |
| 데드휠(포드)과 포트를 함께 쓰는 모터는 엔코더 모드여도 시뮬레이터가 축 엔코더로 제어한다고 가정(실제는 포드 엔코더로 제어)                            | §6.5, `sharedEncoderMode` 알림  |
| 허브 속도 측정 창이 틱마다 미끄러진다는 가정(펌웨어가 50 ms마다 한 번만 새로 재는지 미확인)                                                           | `encoderVelocity.ts`            |
| 허브 전류 측정은 크기만 보고한다고 본 것은 가정                                                                                                       | `world.ts`                      |
| 모터 토크·속도의 전압 비례는 근사(인덕턴스 무시)                                                                                                      | §2                              |
| 서보 모델: 내부 PD·포화 오차 5°·limp 마찰 5 %·전류 제한 없음은 가정. Axon MICRO+·REV SRS의 데드밴드는 문서에 없어 가정                                | §7.2                            |
| 관절·모터의 풀이가 던지면 그 하위 단계 속도가 0이 된다(LCP 반복 상한 2000)                                                                            | §8.6                            |
| 고속 감속비·무거운 로봇의 RUN_TO_POSITION은 허브 루프가 목표 근처에서 흔들릴 수 있음(3c 한계 서술)                                                    | §6.4                            |
| 팔 반력의 운동량은 O(h)만 보존(속도 암시 오일러, 3c 한계 서술)                                                                                        | §8.5                            |
| 질량 행렬 대각에 더하는 1e-9, 한계 여유 1e-3, 한계 초과 허용 1e-12 등 수치 상수는 물리 값이 아니라 안정화·반올림 상수                                 | §2                              |
| 남은 일: 실측(위 "실물로만 재는 값")을 해서 해당 주석을 `[확인: …]`으로 바꾸고 `docs/assumptions.md` 줄을 "실측으로 바꾼 값"으로 옮긴다               | `docs/assumptions.md` 고치는 법 |

---

## 16. 원본 조사 자료 상태

아래 문서는 원래 저장소 밖 작업 폴더(scratchpad)에 있었고 **사라졌다**. 코드 주석과 CLAUDE.md가 이 문서들을 이름으로 인용하며, 인용한 결론만 이 문서에 옮겼다. 이 문서의 값 가운데 아래 문서에서만 나오는 근거는 **1차 출처로 추적할 수 없다**.

| 사라진 문서                              | 코드가 인용한 곳                                                                                                                                                                         | 이 문서에서 추적 불가능한 것                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `p10mass/research/actuators.md` ([ACT])  | §2.1(goBILDA), §2.2(REV 효율 곱), §2.4(NeveRest), §2.7(MATRIX), §3.1(DC 모터 식), §3.3(H-브리지·gm0), §5.1–§5.4(서보)                                                                    | 서보 4.8 V·6.0 V 원값과 5 V 보간 계산 과정(코드에는 보간 결과만 있음), 서보 PD 근사 §5.4의 유도, gm0 문서 구절의 정확한 위치, MATRIX 옛 키트 값 |
| `p11joint/research/data.md` ([DATA])     | §1.3·§1.4(회전자 관성 범위), §3.1(기어 효율), §3.2(역구동 마찰), §4.1–§4.4(허브 PIDF·제어·서보 전원), §5.1(스풀)·§5.3·§5.4(슬라이드 마찰), §9(실측 목록)                                 | Pittman 8224S006·9234S006 값의 원본 확인, 회전자 관성·역구동·슬라이드 마찰의 추정 과정, 허브 PIDF 기본값 조사 결과                              |
| `p11joint/research/critique.md`(3b 비평) | §1.3(역구동 마찰), §2.3(속도 루프 적분 해석), §2.4(위치 I), §2.5(한계 행 고르기 떨림), §4.3-14(부분 듀티 평균), C9(모터축 마찰 한 번만)                                                  | 비평 본문(검토 대안과 기각 이유의 자세한 기록)                                                                                                  |
| `spec-3b`(3b 명세)                       | §1.1·결정 1(데이터시트 값), §1.2·결정 2(기어 효율), §1.8(BRAKE·FLOAT·enabled), §1.9(서보 토크), §1.10(몸체 질량 1 g), §1.12(리밋 스위치), §2(관절 기본), §3(허브 PIDF), §4(세계 설명 v2) | 명세 본문 전체(사용자 결정의 원문 맥락)                                                                                                         |
| `p11joint/tools/rtp_check.py`            | 속도 루프 포화 방지(`HubMotorController` 주석)                                                                                                                                           | 확인 스크립트와 그 결과                                                                                                                         |
| `method`(3c 방법 문서, §3.1·§5.1)        | 인스펙터 캐스케이드·연속 부하 합산 방식(`jointCardModel.ts`), 기저 렌치                                                                                                                  | 해당 절의 유도                                                                                                                                  |

남아 있는 1차 출처는 코드 주석에 적힌 URL뿐이다(§17). 값마다 "출처 기록 없음"이라고 쓴 것은 코드·CLAUDE.md·assumptions.md 어디에도 출처가 없는 값이다. 해석 시험(`articulation.test.ts`, `actuators.test.ts`, `actuatorData.test.ts`, `worldJoints.test.ts`, `src/renderer/src/play/worldJoints.test.ts`)이 진자 주기·FLOAT 낙하·BRAKE 처짐·정전력 정상 속도·한계 멈춤(침투 0, 엔코더 그대로)·결합 충격·continuous 리깅 위 한계·상자 LCP 성질·하위 단계 수렴·결정성·RUN_TO_POSITION 리프트 유지·서보 처짐·속도·PWM 꺼짐·과부하 팔(기준 진자와 비교)·CR 서보 반전·발전 제동(power −1은 무부하 속도의 1.2배 아래, FLOAT·부분 듀티는 다이오드 강하만큼만 더 빠름)을 확인하므로, 값을 다시 계산하는 쪽은 이 시험을 기준으로 삼으면 된다.

---

## 17. 외부 출처 목록(코드 주석에 적힌 것)

- gm0 motor-power: https://gm0.org/en/latest/_sources/docs/power-and-electronics/motor-guide/motor-power.rst.txt (다이노 값, 쓰지 않음), gm0 sdk-motors(듀티 ±32767), gm0 control-system-internals(비동기 PWM, 5 값 링 버퍼 10 ms), gm0 gearbox-anatomy(유성 2단 94 %, 평기어 2단 85 %).
- WPILib ExpansionHubVelocityConstants "The motor control period is 10ms".
- Road Runner ftc `Encoders.kt` `OverflowEncoder`/`inverseOverflow`(20 cps 배수·50 ms 창).
- NIST g_n: https://physics.nist.gov/cgi-bin/cuu/Value?gn
- MuJoCo computation: https://mujoco.readthedocs.io/en/stable/computation/index.html
- goBILDA 5203: https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-19-2-1-ratio-24mm-length-8mm-rex-shaft-312-rpm-3-3-5v-encoder/ ; 5201: https://www.gobilda.com/5201-series-53-1-ratio-105-rpm-spur-gear-motor-w-encoder ; 2단 Viper-Slide: https://www.gobilda.com/2-stage-viper-slide-kit/ ; 서보 25-2/25-3/25-4: https://www.gobilda.com/2000-series-dual-mode-servo-25-2-torque/ , …-25-3-speed/ , …-25-4-super-speed/
- REV: https://docs.revrobotics.com/duo-build/motion/motors/hd-hex-motor , https://docs.revrobotics.com/rev-crossover-products/ultraplanetary/cartridge-details.md , https://docs.revrobotics.com/duo-build/motion/motors/core-hex-motor , https://docs.revrobotics.com/duo-control/control-system-overview/control-hub-basics , https://docs.revrobotics.com/rev-crossover-products/servo/srs.md , https://docs.revrobotics.com/rev-crossover-products/servo/smart-robot-servo-v2/srs-v2-specifications
- AndyMark: https://www.andymark.com/products/neverest-classic-motor-only , …/neverest-classic-40-gearmotor , …/neverest-classic-60-gearmotor , …/neverest-orbital-20-gearmotor
- TETRIX TorqueNADO: https://cdn.shopify.com/s/files/1/0869/9363/3572/files/torquenado_dcmotorspecs.pdf
- Studica Maverick: https://studica-docs-worldskills.readthedocs.io/en/latest/docs/Motors/maverick-dc-motor.html
- Axon: https://docs.axon-robotics.com/servos/max , https://docs.axon-robotics.com/servos/mini , https://docs.axon-robotics.com/archive/micro.md
- STMicroelectronics VNH5050A-E 데이터시트(DocID 16009): 코드 주석이 "이 세션에서 열지 못했다"고 적었다(확인되지 않음).
- Júdice & Pires 1994(블록 주축 전환), Rockafellar 1976(근접점 반복): 코드 주석의 문헌 인용.
- FTC SDK 12.0 소스(`@MotorType`, `LynxSetMotorPIDControlLoopCoefficientsCommand`, `ServoImpl`, `PwmControl`, `DcMotorEx` 주석)와 FTC SDK 6.0 릴리스 노트: 사이드카 `MotorConfigurationType.java`·`SimDcMotorController.java`가 옮긴 값.
