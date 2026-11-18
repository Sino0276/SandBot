# 사이드카·가짜 SDK·Hub 타이밍·프로토콜 기준 문서

이 문서는 SandBot의 JVM 사이드카(팀의 실제 FTC Java OpMode를 가짜 FTC SDK 위에서 가상 시계로 실행하는 부분)가 쓰는 모든 시간 규칙·비용표·상수·한도·규약·결정사항을 한곳에 적는다. 다루는 것은 가상 시계와 틱(5 ms), Hub 타이밍 비용표와 오차, BulkCachingMode와 LastKnown(500 ms)의 청구 규칙, STOP·fail safe·끊긴 스레드 규칙, 장치 입력·출력 키의 이름·단위·부호 규약, 호스트(메인 프로세스)와 사이드카 사이 stdio 프로토콜(버전 4)의 메시지·한도, 호스트 세션의 페이스·일시 정지·Step·종료 규칙이다. 원래 이 단계들의 조사·명세 문서(주석이 `spec §2.4`, `spec §R-7`, `spec-4d §1.10` 등으로 인용하는 것)는 저장소 밖 작업 폴더에 있다가 사라졌으므로(§17), 코드(`sidecar/sim`, `sidecar/runtime`, `sidecar/sdk/org/sandbot/sdk/devices`, `src/shared/sidecarProtocol.ts`, `src/shared/play.ts`, `src/main/sidecar/session.ts`·`protocol.ts`·`launch.ts`·`controller.ts`)와 CLAUDE.md의 서술이 곧 원본이다. 코드에 출처가 없는 값은 "출처 기록 없음"이라고 적었고 출처를 지어내지 않았다. 센서·카메라 칩의 측정 시각(VL53L0X 33 ms, APDS-9151 등)과 비전 상태 기계는 `sensors-vision.md`가, 모터 물리와 허브 제어 루프(10 ms, PIDF)는 `motors-joints.md`가 맡고 여기서는 사이드카 쪽 규약만 적는다.

## 목차

0. 읽는 법
1. 범위·파일·프로세스·스레드
2. 가상 시계와 틱
3. 시간 API 대리 함수와 결정성 패치
4. Hub 타이밍 표(HubTiming)
5. 호출별 청구 규칙(Lynx 명령·bulk read·I2C·LastKnown 적중)
6. BulkCachingMode
7. LastKnown(500 ms)
8. STOP·fail safe·끊긴 스레드
9. 장치 출력·입력 키, 단위, 부호 규약
10. OpMode 실행 흐름(런타임)
11. 프로토콜(버전 4)
12. 메시지·텍스트·줄 한도 모음
13. 호스트 세션: 페이스·일시 정지·Step·종료
14. 감시(Watchdog)와 stall
15. 실행 설정과 요청 검증
16. 설계 결정·Unity 대응·임시 편차
17. 원본 조사 자료 상태
18. 알려진 한계·남은 일
19. 시험이 고정한 값

---

## 0. 읽는 법

### 0.1 상태 표기

코드 주석의 표기를 그대로 쓴다.

| 표기      | 뜻                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [확인: …] | 코드 주석이 실제 FTC SDK 소스·REV·gm0 등 출처를 적은 값. 이 세션에서 출처를 다시 열어 본 것이 아니라 "출처가 기재됨"이라는 분류다 |
| [가정: …] | 출처 없이 정한 값이거나 주석이 "가정"·"근사"라고 밝힌 값. `docs/assumptions.md`에 같은 줄이 있고, 실측으로 바꿀 대상이다          |
| [결정: …] | 설계로 정한 값(재는 값이 아님). 사용자가 정한 것은 "사용자 결정"으로 적는다                                                       |
| 코드 값   | 주석에 태그가 없는 값. 주석의 설명만 옮겼다                                                                                       |
| 계산값    | 코드에 그 글자가 없고 이 문서를 쓸 때 코드의 식으로 다시 계산한 값                                                                |

### 0.2 단위·표기 규약

- 사이드카의 시간은 정수 나노초(long)다. 표의 `ms`는 ns ÷ 10⁶ 환산이다. `0.005 ms` = 5 000 ns.
- 위치 열은 파일 경로와 상수·함수 이름이다(줄 번호 없음). `HubTiming.java` 등 `sidecar/sim/org/sandbot/sim/` 아래는 폴더를 생략하고, 다른 파일은 저장소 루트부터 적었다.
- 청구 규칙의 기호: C = Lynx 명령 하나(`LYNX_COMMAND`), B = bulk read 하나(`BULK_READ`), I = I2C 트랜잭션 하나(`I2C_TRANSACTION`), H = LastKnown 적중 하나(`CLOCK_READ`, §7).
- Control Hub = 구성의 `parentModuleAddress`(없으면 173)와 주소가 같은 허브(부모 모듈), Expansion Hub = 그 밖의 허브다(§4.4).
- 표의 `abs(x)`는 절댓값이다(세로 막대를 표 안에서 피하려고 이렇게 썼다).

---

## 1. 범위·파일·프로세스·스레드

### 1.1 파일 지도

| 파일                                                                                                                                                                                   | 역할                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidecar/sim/org/sandbot/sim/Sim.java`                                                                                                                                                 | 가짜 SDK와 패치한 코드가 쓰는 서비스 모음(시계·Hub 타이밍·호스트·장치 목록·Dashboard·모의 저장소·카메라 보정·틱 경계 듣기). 런타임이 실행마다 `install`로 한 번 넣는다 |
| `sim/SimClock.java`, `runtime/VirtualClock.java`                                                                                                                                       | 팀 코드가 보는 시계의 계약과 유일한 구현(가상 시계)                                                                                                                    |
| `sim/HubTiming.java`, `SimCost.java`, `HubKind.java`                                                                                                                                   | Hub 타이밍 비용표(키·기본값·오차)와 비용 종류                                                                                                                          |
| `sim/TimeRedirects.java`, `OrderedCollections.java`, `runtime/patch/ClassPatcher.java`                                                                                                 | 시간 API·해시 순서 컬렉션을 바꾸는 대리 함수와 바이트코드 패처                                                                                                         |
| `sim/SimDevice.java`, `SimDevices.java`, `SimHost.java`, `TelemetryFrame.java`                                                                                                         | 장치 한 개의 출력·입력 값 보관, 런타임에 알리는 인터페이스                                                                                                             |
| `sim/SimExit.java`, `SimThreadError.java`, `SimUnsupportedException.java`                                                                                                              | `System.exit`·다른 스레드 사용·미지원 SDK 호출이 던지는 Error                                                                                                          |
| `sidecar/runtime/org/sandbot/runtime/Main.java`                                                                                                                                        | 진입점: hello → run/list 읽기 → 컴파일 → Sim 설치 → OpMode 스레드·감시 시작                                                                                            |
| `runtime/OpModeRunner.java`                                                                                                                                                            | OpMode 하나의 실행(INIT·START·STOP·틱 경계의 일·끝내기)                                                                                                                |
| `runtime/RunRequest.java`, `ListRequest.java`, `HostInput.java`, `Protocol.java`, `Json.java`                                                                                          | 호스트 메시지 읽기·검사, 사이드카 메시지 쓰기, 작은 JSON                                                                                                               |
| `runtime/Watchdog.java`, `OutputCapture.java`, `StackFrames.java`                                                                                                                      | 실시간 감시, System.out·err 가로채기, 스택 → 프로토콜 프레임                                                                                                           |
| `runtime/TeamCompiler.java`, `TeamClassLoader.java`, `LibraryClassLoader.java`, `LinkCheck.java`                                                                                       | 팀 코드 컴파일(javax.tools, 메모리)과 클래스 로딩                                                                                                                      |
| `sidecar/sdk/org/sandbot/sdk/devices/SandbotHardware.java`                                                                                                                             | 구성 XML → hardwareMap, `beforeInit`·`stopRequested`·`afterStop`                                                                                                       |
| `devices/SimHub.java`, `SimLastKnown.java`                                                                                                                                             | 허브 하나의 비용 청구·BulkCachingMode·끊긴 스레드·fail safe, LastKnown 캐시                                                                                            |
| `devices/SimDcMotorController.java`, `SimServoController.java`, `SimDigitalChannelController.java`, `SimAnalogInputController.java`, `SimVoltageSensor.java`, `SimI2cDeviceSynch.java` | Lynx 컨트롤러를 옮긴 손 구현(호출별 명령 수가 여기서 정해진다)                                                                                                         |
| `devices/package-info.java`                                                                                                                                                            | 장치 종류(kind)별 출력·입력 키·단위·부호 규약의 기준 문서                                                                                                              |
| `sidecar/sdk/com/qualcomm/hardware/lynx/LynxModule.java`                                                                                                                               | 허브 전압·전류·온도·펌웨어·LED 읽기의 명령 수                                                                                                                          |
| `src/shared/sidecarProtocol.ts`                                                                                                                                                        | 프로토콜 타입·상수(`SIDECAR_PROTOCOL_VERSION`, `DEFAULT_TICK_NANOS`, `HUB_TIMING_KEYS`, 입력 배열 규칙)                                                                |
| `src/main/sidecar/protocol.ts`                                                                                                                                                         | 사이드카 stdout 한 줄 읽기·모양 확인(믿지 않는 입력)                                                                                                                   |
| `src/main/sidecar/session.ts`                                                                                                                                                          | 호스트 세션: 상태 기계, 페이스, 일시 정지, Step, 종료, 렌더러 이벤트                                                                                                   |
| `src/main/sidecar/launch.ts`, `controller.ts`, `process.ts`                                                                                                                            | 요청 확인·RunRequest 만들기·JVM 인자·프로세스                                                                                                                          |
| `src/shared/play.ts`                                                                                                                                                                   | 렌더러 ↔ 메인 실행 API 타입·설정 범위 상수                                                                                                                             |
| `src/shared/sim/motorOutputs.ts`, `encoderVelocity.ts`, `world.ts`                                                                                                                     | 시뮬레이터 쪽 장치 출력 해석·입력 만들기                                                                                                                               |

### 1.2 데이터 흐름

```
렌더러 ──playInit(세계 설명·설정)──▶ 메인(controller.ts: 확인·JDK·Gradle·라이브러리) ──JVM 실행(javaArgs)──▶ 사이드카
                                        │                                                         │
                                        ◀─────────── stdout JSON 줄: hello·compiled·state·tick·… ─┘
                                        │ session.ts: tick 도착 시 world.step(tNanos, outputs) → inputs
                                        └──────────── stdin JSON 줄: run → tickReply(events·gamepads·inputs·configSet)
```

사이드카는 틱 경계마다 `tick`(장치 출력 포함)을 보내고 `tickReply`가 올 때까지 OpMode 스레드를 멈춘다. 호스트가 답하는 때(벽시계 × 속도)가 실행 속도·일시 정지·Step을 정한다. 사이드카는 벽시계를 모른다.

### 1.3 스레드

| 스레드                   | 하는 일                                                                                                                   | 위치                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `OpModeThread`           | OpMode 본문, 가상 시계·하드웨어 호출, 틱 경계의 일을 시계 호출 안에서 한다. 이 스레드만 시계·하드웨어를 쓸 수 있다(1단계) | `Main.run`, `OpModeRunner.run` |
| `SandBotHostInput`(데몬) | stdin 줄 읽기·JSON 파싱·큐                                                                                                | `HostInput.start`              |
| `SandBotWatchdog`(데몬)  | 250 ms마다 OpMode 스레드 감시(§14)                                                                                        | `Watchdog`                     |
| main 스레드              | `parkForever`로 `halt`를 기다린다                                                                                         | `Main.main`                    |

---

## 2. 가상 시계와 틱

### 2.1 상수

| 항목                                      | 값                                 | 단위               | 위치                                                                                          | 상태·근거                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 틱 길이                                   | 5 000 000                          | ns(= 5 ms, 200 Hz) | `src/shared/sidecarProtocol.ts` `DEFAULT_TICK_NANOS`                                          | 주석: "실제 Robot Controller의 이벤트 루프 한 바퀴에 해당한다(LinearOpMode.waitForStart가 깨어나는 때, 게임패드가 바뀌는 때)". 수치 5 ms의 출처 기록 없음 [결정] |
| 시계 종류                                 | `'virtual'` 하나                   | -                  | `SimClockKind`, `RunRequest.checkProtocolAndClock`                                            | 실시간 실행은 구현하지 않고 길만 열어 둠(`RunRequest.clock`에 값 추가 + `SimClock` 구현 추가) [결정]                                                             |
| 팀 코드 `System.currentTimeMillis`의 시작 | 실행 요청을 만들 때의 `Date.now()` | ms                 | `src/main/sidecar/launch.ts` `buildRunRequest(now)`, `RunRequest.startEpochMillis`            | 코드 값. 이 값만 벽시계다. `currentTimeMillis = startEpochMillis + ⌊now / 10⁶⌋`                                                                                  |
| 시계 읽기·루프 표시·텔레메트리 비용       | §4.1                               |                    | `HubTiming`                                                                                   |                                                                                                                                                                  |
| 정지 후 강제 종료(가상)                   | 900                                | ms                 | `OpModeRunner.STUCK_IN_STOP_NANOS` = `OpMode.MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED` × 10⁶ | 주석: 실제 `OpModeInternal.MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED`(가상 시간). 손 구현 SDK의 값이 900                                                         |
| 시간 제한 없는 wait·join·park의 대기 단위 | 한 틱씩(`awaitNextTick` 반복)      | -                  | `TimeRedirects.waitForever`                                                                   | 코드 값                                                                                                                                                          |

### 2.2 `VirtualClock`의 상태와 규칙

상태: `now`(실행 시작부터의 가상 ns, volatile long), `nextTick`(다음에 처리할 경계 번호), `ticking`, `inBoundary`, `owner`(OpMode 스레드), `startEpochMillis`, `tickNanos`.

- 경계 시각: `tNanos(k) = k · tickNanos`.
- `nanoTime() = now`, `currentTimeMillis() = startEpochMillis + ⌊now / 1 000 000⌋`. 부르기만 해서는 시간이 흐르지 않는다(비용은 `TimeRedirects`가 청구).
- `charge(n)`: n < 0이면 IllegalArgumentException. `now ← saturatingAdd(now, n)`(Long.MAX_VALUE에서 포화) 뒤 `process()`. 끼어들기(interrupt) 플래그를 보지도 건드리지도 않는다.
- `process()`: `inBoundary`이거나 `!ticking`이면 아무것도 하지 않는다. 아니면 `while ticking ∧ now ≥ nextTick · tickNanos`: `k = nextTick++`, `inBoundary = true`, `boundary.onTick(k)`(호스트와 틱 교환, §10.3), `inBoundary = false`. 한 번의 charge가 여러 경계를 넘으면 경계마다 차례로 한다.
- 경계의 일 안에서 시계를 다시 부르면(텔레메트리의 ElapsedTime 등) 시간만 더하고 경계를 다시 처리하지 않는다. 그 일이 끝난 뒤 `process()`가 넘은 경계를 이어서 처리한다.
- `sleep(n)`: `check()`; 이미 끼어들기가 있으면 플래그를 지우고 `InterruptedException("sleep interrupted")`; `n ≤ 0`이면 돌아온다; 아니면 `advanceTo(saturatingAdd(now, n))`.
- `advanceTo(target)`: 경계의 일 안이거나 `!ticking`이면 `now ← max(now, target)`만 한다(기다리지 않음). 아니면 `while nextTick·tickNanos ≤ target`: `now ← max(now, b)`; `process()`; 끼어들기가 있으면 플래그를 지우고 InterruptedException; `!ticking`이면 중단. 끝에 `now ← max(now, target)`.
- `awaitNextTick()`: `check()`; 끼어들기면 InterruptedException; `!ticking ∨ inBoundary`이면 바로 돌아온다; 아니면 `advanceTo(nextTick · tickNanos)`. 이미 경계에 있으면 다음 경계까지(`nextTick`이 이미 증가했으므로).
- `beginTicks()`: tick 0을 연다(`ticking = true; process()`).
- `endTicks()`: `ticking = false`; `k = nextTick`; `now ← max(now, k · tickNanos)`; k를 돌려준다. 런타임이 마지막 tick 번호(다음 경계)로 쓴다.
- `peekNanos()`: 다른 스레드(로그·감시)가 읽는 `now`. 감시는 이 값이 바뀌지 않으면 멈춘 것으로 본다.

### 2.3 소유 스레드 규칙

1단계는 OpMode 스레드 하나만 시계·하드웨어를 쓴다. 다른 스레드가 `nanoTime`·`charge` 등을 부르면(`check()` → `foreign`):

1. 처음 한 번 `violation.report`(→ error kind `thread`, 그 스레드 이름과 호출 위치 스택, `pool-` 스레드가 FTCLib `command.old.`에서 왔으면 `CommandOpMode`를 쓰라는 안내 덧붙임)를 보낸다.
2. `fatalMessage`와 `fatalAtRealNanos`를 정한다. 그 뒤 OpMode 스레드도 다음 시계 호출에서 `SimThreadError(이미 알림)`를 받아 끝난다(finished `exception`).
3. 감시가 2초(실제) 안에 OpMode 스레드가 끝나지 않으면 `forceFinish("exception")`한다(§14).
4. `finishing`이 켜지면(끝내는 중) OpMode 스레드의 fatal 재던지기를 하지 않는다.

`Thread.join`으로 살아 있는 다른 스레드를 기다리는 것도 `SimThreadError`다(자기 자신이면 가상으로 기다린다).

### 2.4 계산값: 루프 시간의 구성

| 경우                                                | 한 번의 시간                      | 근거                                                                                                                                                           |
| --------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LinearOpMode.opModeIsActive()` 한 번(실행 중)      | 0.001 + 0.001 + 0.005 = 0.007 ms  | `isStopRequested`(CLOCK_READ) + `isStarted`(CLOCK_READ) + `idle()`의 `Sim.loopMarker()`(LOOP_MARKER). 빈 `while (opModeIsActive())`는 틱(5 ms)당 약 714회 돈다 |
| 반복 OpMode `loop()` 한 바퀴의 SDK 몫               | 0.005 + 0.001 + 1 = 1.006 ms      | `OpMode.internalRunOpMode`가 `Sim.loopMarker()`(0.005) 뒤 `TimeRedirects.sleep(1)`(들어올 때 CLOCK_READ 0.001 + 1 ms 대기). 팀 코드의 호출 비용이 더해진다     |
| Control Hub에서 새 power 모터 4개 `setPower`        | 4 × (1.5 + 3 × 0.001) = 6.012 ms  | §5.1 "다른 power = 1C + 3H"                                                                                                                                    |
| 같은 4개를 Expansion Hub에서                        | 4 × (2.5 + 3 × 0.001) = 10.012 ms | 같은 규칙, C = 2.5 ms                                                                                                                                          |
| BulkCachingMode OFF에서 엔코더 4개 읽기             | 4 × 1.5 = 6.0 ms(Control)         | §6                                                                                                                                                             |
| BulkCachingMode AUTO에서 엔코더 4개를 루프마다 읽기 | 2.0 ms(Control, bulk read 하나)   | §6                                                                                                                                                             |
| `telemetry.update()`가 실제로 보냄                  | 0.2 ms                            | `TelemetryImpl.tryUpdate`가 `Sim.charge(TELEMETRY_UPDATE)`. 전송 간격 기본 250 ms                                                                              |

---

## 3. 시간 API 대리 함수와 결정성 패치

### 3.1 패처가 바꾸는 호출(`ClassPatcher.TARGETS`, `TimeRedirects`)

런타임의 `ClassPatcher`가 팀 클래스·라이브러리 클래스·들여온 SDK 클래스의 상수 풀을 고쳐(코드 길이·오프셋 그대로) 아래 호출을 `org/sandbot/sim/TimeRedirects`의 같은 뜻 정적 메서드로 돌린다. 인스턴스 호출은 수신 객체를 첫 인수로 받는 정적 메서드가 된다. `org/sandbot/sim/` 클래스 자신은 패치하지 않는다.

| 원래 호출                                                                                                                                 | 대리 동작                                                                                                                                                                                                                       | 청구                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `System.nanoTime()`, `System.currentTimeMillis()`                                                                                         | 가상 시계 값                                                                                                                                                                                                                    | CLOCK_READ(0.001 ms) 먼저               |
| `System.exit(int)`, `Runtime.exit(int)`, `Runtime.halt(int)`                                                                              | `SimExit` Error를 던짐(런타임이 finished `terminated`로 봄. Error라 `catch (Exception)`이 삼키지 않음)                                                                                                                          | 없음                                    |
| `Thread.sleep(long)`, `sleep(long,int)`, `sleep(Duration)`                                                                                | JDK와 같은 인수 검사(음수 → IllegalArgumentException, nanos 범위 0–999 999) 뒤 가상 sleep. `Duration`이 음수면 끼어들기도 보지 않고 바로 돌아옴(JDK와 같음)                                                                     | 들어올 때 CLOCK_READ 한 번, 그다음 대기 |
| `TimeUnit.sleep(long)`                                                                                                                    | timeout ≤ 0이면 아무것도 안 함(끼어들기도 안 봄), 아니면 가상 sleep                                                                                                                                                             | CLOCK_READ 한 번(양수일 때)             |
| `Object.wait(long)`, `wait(long,int)`                                                                                                     | 모니터를 갖고 있지 않으면 IllegalMonitorStateException. 0이면 끼어들기까지 틱마다 기다림(`waitForever`), 아니면 가상 sleep. nanos > 0이면 ms를 1 올림(Long.MAX 제외). 기다리는 동안 모니터를 놓지 않음(스레드 하나라 차이 없음) | CLOCK_READ 한 번                        |
| `Thread.join(long)`, `join(long,int)`                                                                                                     | 끝났거나 시작 안 한 스레드면 바로 돌아옴. 자기 자신이면 가상으로 기다림. 살아 있는 다른 스레드면 `SimThreadError`                                                                                                               | CLOCK_READ 한 번(기다릴 때)             |
| `LockSupport.parkNanos(long)`, `(Object,long)`                                                                                            | nanos ≤ 0이면 돌아옴. 끼어들기가 있으면 플래그를 그대로 두고 돌아옴. 기다리는 중 끼어들기가 생기면 플래그를 다시 세움                                                                                                           | CLOCK_READ 한 번                        |
| `LockSupport.parkUntil(long)`, `(Object,long)`                                                                                            | deadline은 `currentTimeMillis` 기준 절대 ms. `millis = deadline − currentTimeMillis`가 ≤ 0이면 돌아옴. `nanos = millis · 10⁶ − (nanoTime mod 10⁶)`로 밀리초 경계에 맞춰 `parkNanos`                                             | 같음                                    |
| `Instant.now()`, `Clock.systemUTC()`, `Clock.systemDefaultZone()`, `LocalDateTime/LocalDate/LocalTime/ZonedDateTime/OffsetDateTime.now()` | 가상 시계 기반 `java.time.Clock`(`Clock.instant()`마다 CLOCK_READ). `instant() = Instant.ofEpochMilli(currentTimeMillis).plusNanos(nanoTime mod 10⁶)`. 기본 시간대는 `ZoneId.systemDefault()`                                   | 호출마다 CLOCK_READ                     |

변환: `millisToNanos(ms) = ms ≥ Long.MAX/10⁶ ? Long.MAX : ms · 10⁶`(포화). 인수 검사·끼어들기의 뜻은 JDK와 같고 다른 것은 시간이 가상이라는 것뿐이다(주석).

`android.os.SystemClock`은 `ClassPatcher.TARGETS`에 없다(패처가 바꾸는 호출이 아니다). 가짜 SDK의 손 구현(`sidecar/sdk/android/os/SystemClock.java`)이 가상 시계를 직접 쓴다: `uptimeMillis`·`elapsedRealtime`·`currentThreadTimeMillis`는 호출마다 CLOCK_READ를 청구하고 `⌊nanoTime / 10⁶⌋`를 돌려주며(로봇이 잠들지 않아 uptime = elapsedRealtime, 스레드 하나라 CPU 시간 = 가상 시간), `setCurrentTimeMillis`는 늘 false(앱은 시스템 시계를 바꿀 수 없음), `sleep(ms)`은 Android처럼 끼어들기로 끝나지 않고 끝까지 기다린 뒤 끼어들기 플래그를 다시 세운다.

### 3.2 해시 순서 컬렉션 → 삽입 순서(결정성)

enum·Object 키의 해시는 identity 해시라 JVM마다 다르고 JDK `Set.of`·`Map.of`는 JVM마다 정하는 SALT로 반복 순서를 섞는다. 그 순서가 하드웨어 호출 순서를 정하면(FTCLib `ParallelCommandGroup`, Ivy `parallel`) 같은 입력에서 다른 프로토콜 메시지가 나온다. 그래서 패처가 아래를 삽입 순서 구현으로 바꾼다.

| 원래                                                                                                                                                 | 대신                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `new HashMap`·`new HashSet`(공개 생성자 `()`, `(I)`, `(IF)`, `(Map)`/`(Collection)`)과 짝인 `invokespecial <init>`, 생성자 참조 `HashMap::new`       | `LinkedHashMap`·`LinkedHashSet`(서술자 같음). `extends HashMap`의 `super(...)`는 바꾸지 않음        |
| `Set.of`(인수 0–10개와 배열), `Map.of`(쌍 0–10개), `Set.copyOf`, `Map.copyOf`, `Map.ofEntries`, `HashMap.newHashMap(int)`, `HashSet.newHashSet(int)` | `OrderedCollections.setOf`·`mapOf`·`setCopyOf`·`mapCopyOf`·`mapOfEntries`·`newHashMap`·`newHashSet` |
| `Collectors.toSet`, `toMap`(2·3인수), `toUnmodifiableSet`, `toUnmodifiableMap`(2·3인수), `groupingBy`(1·2인수)                                       | `OrderedCollections`의 같은 이름                                                                    |

`OrderedCollections`의 결과는 넣은 순서로 반복한다. 예외(null → NPE, 중복 → "duplicate element/key", 불변 결과 변경 → UnsupportedOperationException)는 JDK 17+와 같다. 다른 것: 직렬화 형식과 NPE 메시지.

남는 구멍(결정성 밖, 주석): JDK 내부가 만드는 HashMap, `IdentityHashMap`·`WeakHashMap`·`ConcurrentHashMap`·`Hashtable`, `Object.hashCode`·기본 `toString`의 identity 해시 값, `new Date()`, 시간 없는 `wait()`·`join()`, JDK 동시성 도구의 시간 제한 대기, `Math.random`.

---

## 4. Hub 타이밍 표(HubTiming)

### 4.1 기본 비용표

작업 하나가 쓰는 가상 시간이다. 실제 Control Hub에서 팀 코드의 루프 시간이 대부분 하드웨어 호출에서 나오므로, 호출마다 이 비용을 청구하면 PC 성능과 관계없이 실제 로봇과 비슷한 루프 시간이 나온다(주석). `Math.round(ms · 10⁶)`으로 ns가 된다.

| 키(`HubTiming.KEYS`, `HUB_TIMING_KEYS` 순서) | 기본값(ms) | ns        | SimCost·허브                 | 의미                                                                                                                                                       |
| -------------------------------------------- | ---------- | --------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lynxCommandControl`                         | 1.5        | 1 500 000 | `LYNX_COMMAND`, Control      | Lynx 명령 하나(모터 출력·모드·목표 위치 쓰기, 캐시 없이 읽는 엔코더 위치·모터 전류 등. 모터 속도·과전류 읽기는 BulkCachingMode OFF에서도 bulk read 하나다) |
| `lynxCommandExpansion`                       | 2.5        | 2 500 000 | `LYNX_COMMAND`, Expansion    | 같음(RS-485를 한 번 더 거침)                                                                                                                               |
| `bulkReadControl`                            | 2.0        | 2 000 000 | `BULK_READ`, Control         | `LynxGetBulkInputDataCommand` 하나                                                                                                                         |
| `bulkReadExpansion`                          | 3.0        | 3 000 000 | `BULK_READ`, Expansion       | 같음                                                                                                                                                       |
| `i2cControl`                                 | 2.5        | 2 500 000 | `I2C_TRANSACTION`, Control   | I2C 트랜잭션 하나(읽기 또는 쓰기)                                                                                                                          |
| `i2cExpansion`                               | 3.5        | 3 500 000 | `I2C_TRANSACTION`, Expansion | 같음                                                                                                                                                       |
| `clockRead`                                  | 0.001      | 1 000     | `CLOCK_READ`(허브와 무관)    | 시계 읽기. 0이면 바쁜 대기 루프에서 시간이 흐르지 않으므로 아주 작은 값을 둔다                                                                             |
| `loopMarker`                                 | 0.005      | 5 000     | `LOOP_MARKER`                | 루프 표시 한 번(`opModeIsActive`·`opModeInInit`·`idle`, 반복 OpMode의 `init_loop`·`loop`)                                                                  |
| `telemetryUpdate`                            | 0.2        | 200 000   | `TELEMETRY_UPDATE`           | `telemetry.update`가 실제로 보낼 때                                                                                                                        |

상태: **[가정]** 주석: "FTC 커뮤니티에서 흔히 쓰는 근사치다(gm0 "Bulk Reads": 하드웨어 호출 하나 약 2–3 ms, bulk read 하나로 모든 엔코더·디지털·아날로그 입력)". `docs/assumptions.md`는 "실측 필요". 이 숫자 하나하나의 개별 출처 기록 없음.
측정·교체: 실제 로봇 OpMode에서 같은 호출을 1000번 하고 `ElapsedTime` 평균을 허브마다 잰다(BulkCachingMode OFF의 `getCurrentPosition`, 값이 바뀌는 `setPower`, I2C 센서 읽기, `telemetry.update`)(assumptions.md). 키 이름은 `src/shared/sidecarProtocol.ts`의 `HUB_TIMING_KEYS`와 `SimCost` 주석이 같아야 한다.

### 4.2 오차(jitter)

식: 오차가 켜져 있고(`jitter ≠ 0`) 기본 비용이 0이 아니면

```
factor = 1 + jitter · (u · 2 − 1),   u = SplittableRandom(seed).nextDouble()  (호출마다 한 번)
nanos  = max(0, round(base · factor))
```

비용마다 [1 − jitter, 1 + jitter]배를 고르게 뽑는다. 같은 seed·같은 호출 순서면 같은 값이다(결정적). OpMode 스레드 하나만 부른다. `jitter == 0`이거나 `base == 0`이면 난수를 뽑지 않는다.

| 항목                             | 값                                                                     | 위치                                                 | 상태·근거                                                                         |
| -------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| jitter 허용 범위(사이드카)       | 0 이상 1 미만(아니면 IllegalArgumentException → finished `loadFailed`) | `HubTiming` 생성자                                   | 코드 값                                                                           |
| jitter 허용 범위(메인 요청 검증) | 0 이상 1 미만                                                          | `src/main/sidecar/launch.ts` `validateRequest`       | 코드 값                                                                           |
| jitter 상한(렌더러 설정)         | 0.5(±50 %)                                                             | `src/renderer/src/play/playSettings.ts` `MAX_JITTER` | 주석: "이보다 크면 결과가 실제 허브와 너무 달라진다". 0.5의 근거 기록 없음 [결정] |
| 환경 설정 선택지                 | 0, 0.02, 0.05, 0.1, 0.2                                                | `JITTER_CHOICES`                                     | 코드 값. 0은 끔(같은 코드 → 같은 루프 시간)                                       |
| 기본값                           | jitter 0(끔), seed 1                                                   | `DEFAULT_PLAY_SETTINGS`                              | 주석: "결정성을 먼저 둔다. 실제 루프 시간은 흔들린다" [가정](assumptions.md)      |
| seed 범위                        | 정수, 절댓값 ≤ 2³¹ − 1(렌더러가 자름), 메인은 안전한 정수면 받음       | `clampSeed`, `validateRequest`                       | 주석: "시드는 Java long이지만 JSON 숫자로 정확히 보낼 수 있는 범위"               |

### 4.3 덮어쓰기

- `RunRequest.timing`(키 → 밀리초)로 기본값 일부를 덮어쓸 수 있다. 모르는 키·음수·NaN·무한대·null은 IllegalArgumentException(`HubTiming` 생성자).
- 앱은 지금 늘 `timing: {}`를 보낸다(`launch.ts` `buildRunRequest`: "1단계는 Hub 타이밍을 덮어쓰지 않는다(측정 보정은 나중)"). 환경 설정에는 jitter·seed 칸만 있고 비용표 칸은 없다. assumptions.md가 "팀 칸: 환경 설정 › 시뮬레이션 Hub 타이밍"이라고 쓴 것은 오차·시드 칸을 뜻한다(§18).
- 목록 모드(`ListRequest`)는 `HubTiming.defaults()`(오차 없음)를 쓴다.

### 4.4 허브 종류 판별

`SandbotHardware.lynxUsbDevice`: 구성의 `LynxUsbDevice`의 `parentModuleAddress`(없으면 173)를 읽고, 모듈의 주소(`port` 속성, 1–254)가 그것과 같으면 부모(Control Hub, `HubKind.CONTROL`), 아니면 `HubKind.EXPANSION`이다. 비용은 이 `HubKind`로 정해진다. 173은 코드 값이다(`SandbotHardware`의 기본값과 package-info의 "Control Hub는 173" 주석. 출처 기록 없음).

### 4.5 비용 청구가 켜지는 구간

`SimHub.charging`: `SandbotHardware.beforeInit`의 끝(`setCharging(true)`)부터 `afterStop` 시작(`setCharging(false)`)까지만 청구한다. 구성 읽기·OpMode 사이의 하드웨어 초기화·런타임의 `stopRequested` fail safe·`afterStop`은 청구하지 않는다(실제로 팀 코드가 보는 시간 밖이고 끊기지 않는 이벤트 루프 스레드의 일이기 때문). `create` 중에도 청구를 끈다. 청구가 꺼진 동안은 끊긴 스레드 검사(§8.4)도 하지 않는다.

### 4.6 허브가 받는 구성 태그(`SandbotHardware.lynxModule`)

`<LynxModule>`의 자식 태그를 이 표로 가른다. 표에 없는 태그는 `SandbotConfigException`("Unsupported device type <…> on hub …", 영어)이고 error `config` + finished `loadFailed`가 된다. 포트 범위(모터 0–3, 서보 0–5; 허브의 디지털 핀 0–7·아날로그 포트 0–3은 §5.3·§9.3의 `API_*_FIRST/LAST`)를 벗어나거나 같은 종류의 포트·장치 이름이 겹치면 같은 예외다. 허브 주소(`port` 속성)는 1–254여야 한다.

| 종류                           | 구성 태그(코드 순서)                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 모터(`MOTOR_CLASSES`, 15개 키) | `goBILDA5201SeriesMotor`, `goBILDA5202SeriesMotor`, `Matrix12vMotor`, `NeveRest20Gearmotor`, `NeveRest3.7v1Gearmotor`, `NeveRest40Gearmotor`, `NeveRest60Gearmotor`, `RevRobotics20HDHexMotor`, `RevRobotics40HDHexMotor`, `RevRoboticsHDHexMotor`(예전 태그, 40:1 HD Hex로 읽음: 주석), `RevRoboticsCoreHexMotor`, `RevRoboticsUltraplanetaryHDHexMotor`, `StudicaMaverick`, `TetrixMotor`, `Motor`(`UnspecifiedMotor`) |
| 서보(`SERVO_TYPES`)            | `Servo`, `ServoFullRange`, `ContinuousRotationServo`, `RevSPARKMini`, `RevBlinkinLedDriver`(펄스 범위는 §5.2)                                                                                                                                                                                                                                                                                                            |
| 디지털(`DIGITAL_TAGS`)         | `DigitalDevice`, `RevTouchSensor`, `Led`                                                                                                                                                                                                                                                                                                                                                                                 |
| 아날로그                       | `AnalogInput`                                                                                                                                                                                                                                                                                                                                                                                                            |
| I2C(`I2C_TAGS`)                | `ControlHubImuBHI260AP`, `LynxEmbeddedIMU`, `REV_VL53L0X_RANGE_SENSOR`, `RevColorSensorV3`, `HuskyLens`, `goBILDAPinpoint`, `SparkFunOTOS`, `OctoQuadFTC`                                                                                                                                                                                                                                                                |

주석: 이 태그들은 "FTC SDK 12.0 소스의 `@DeviceProperties xmlTag`"에서 옮겼다고 적혀 있다(카탈로그 규칙은 CLAUDE.md의 "하드웨어 카탈로그에는 FTC SDK 소스에서 확인한 값만" 불변 조건). `<Robot>`의 자식은 `LynxUsbDevice`·`Webcam`·`EthernetDevice`(Limelight 등)만 받고(그 밖은 "Unsupported device <…> in the robot configuration") 허브 밖 장치는 `build`가 따로 만든다. 구성 XML은 보안 처리(`FEATURE_SECURE_PROCESSING`)를 켜고 DOCTYPE을 거부하며(`disallow-doctype-decl`) 엔티티를 펼치지 않는다. 장치 이름은 `trim`한 뒤 비어 있으면 오류다.

---

## 5. 호출별 청구 규칙(Lynx 명령·bulk read·I2C·LastKnown 적중)

규칙은 실제 SDK의 컨트롤러 소스(`LynxDcMotorController`·`LynxServoController`·`LynxDigitalChannelController`·`LynxAnalogInputController`·`LynxModule`)를 옮긴 손 구현의 호출 순서다. 아래 표는 코드의 순서에서 읽은 명령 수이고, "시험" 열은 `sidecar/tests/java/org/sandbot/sdk/devices/HubCostTest.java`가 값까지 고정한 것이다. 비용은 호출 안에서 `SimHub.lynxCommand`·`bulkReadCommand`·`i2cTransaction`이 `Sim.charge`로 청구한다. 같은 값 쓰기를 건너뛰는 것은 LastKnown(§7)이다.

### 5.1 DC 모터(`SimDcMotorController`, 모터 0–3)

| 호출                                                                                                   | 청구                                                                                                                                                                                                                                                                                                                                  | 시험                  | 비고                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setPower` 처음(LastKnown 없음)                                                                        | 3C + 1H                                                                                                                                                                                                                                                                                                                               | 3 × 1.5 + 0.001       | 모드 묻기 + power + enable = 명령 3개, 컨트롤러가 다시 읽는 모드 적중 1(DcMotorImpl이 먼저 `getMode()`를 읽음)                                                                                               |
| `setPower` 같은 power(신선)                                                                            | 2H                                                                                                                                                                                                                                                                                                                                    | package-info          | 모드·power 적중. 허브에 안 감                                                                                                                                                                                |
| `setPower` 다른 power                                                                                  | 1C + 3H                                                                                                                                                                                                                                                                                                                               | 1.5 + 3 × 0.001       | 모드 적중 둘 + enable 적중                                                                                                                                                                                   |
| `setPower` 500 ms가 지난 뒤                                                                            | 3C + 1H                                                                                                                                                                                                                                                                                                                               | 같음                  | LastKnown이 낡아 다시 보냄                                                                                                                                                                                   |
| `getPower`                                                                                             | 2H(신선)                                                                                                                                                                                                                                                                                                                              | package-info          | LastKnown이 없으면 모드 읽기 + 1C(`LynxGet…`)                                                                                                                                                                |
| `setMode`(신선·같은 모드)                                                                              | 1H                                                                                                                                                                                                                                                                                                                                    |                       |                                                                                                                                                                                                              |
| `setMode`(다른 모드)                                                                                   | 이전 power 읽기(LastKnown 값이 있으면 신선도를 보지 않는 `getNonTimedValue`라 비용 없음, 없으면 `internalGetMotorPower`: 모드 읽기 H 또는 1C + 목표 속도·정전력 읽기 1C) + zero power 읽기(H 또는 1C) + 모드 명령 1C + 강제 power 재전송(모드 적중 H + power 1C + enable H 또는 1C, power LastKnown이 같은 값이면 비교에서 H 하나 더) |                       | 순서는 코드 그대로. `STOP_AND_RESET_ENCODER`는 power 0 쓰기 + `LynxResetMotorEncoderCommand` 1C이고, 그 뒤 강제 power 재전송은 모드가 `STOP_AND_RESET_ENCODER`라 허브에 보내는 것이 없다(LastKnown 적중 H만) |
| `setZeroPowerBehavior`(같음)                                                                           | 1H                                                                                                                                                                                                                                                                                                                                    |                       | 다르면 모드 읽기(H 또는 1C) + 1C                                                                                                                                                                             |
| `setMotorEnable`/`Disable`                                                                             | 같은 값(신선) 1H, 다르면 1C                                                                                                                                                                                                                                                                                                           |                       | RUN_TO_POSITION에서 목표 위치를 받은 적 없이 enable하면 `TargetPositionNotSetException`(§8.5)                                                                                                                |
| `setTargetPosition`                                                                                    | 늘 1C                                                                                                                                                                                                                                                                                                                                 | 1.5, 두 번 불러도 1.5 | 캐시하지 않음. **위험한 명령**(§8.2)                                                                                                                                                                         |
| `getTargetPosition`                                                                                    | 1C                                                                                                                                                                                                                                                                                                                                    |                       |                                                                                                                                                                                                              |
| `getCurrentPosition`                                                                                   | OFF: 1C. AUTO·MANUAL: §6                                                                                                                                                                                                                                                                                                              | OFF 1.5               |                                                                                                                                                                                                              |
| `getVelocity`                                                                                          | OFF에서도 B 1개. AUTO·MANUAL: §6                                                                                                                                                                                                                                                                                                      | OFF 2.0               | 속도는 캐시가 꺼져 있어도 bulk read로만 읽는다                                                                                                                                                               |
| `isBusy`                                                                                               | 캐시 모드면 §6. OFF면 모드 묻기(H 또는 1C) + RUN_TO_POSITION일 때만 1C(`LynxIsMotorAtTargetCommand`), 아니면 0                                                                                                                                                                                                                        |                       |                                                                                                                                                                                                              |
| `isOverCurrent`                                                                                        | OFF: B 1개. 캐시: §6                                                                                                                                                                                                                                                                                                                  |                       |                                                                                                                                                                                                              |
| `getCurrent`(허브 ADC)                                                                                 | 1C                                                                                                                                                                                                                                                                                                                                    |                       | 캐시하지 않는다                                                                                                                                                                                              |
| `setPIDFCoefficients`·`setVelocityPIDFCoefficients`·`setPositionPIDFCoefficients`·`setPIDCoefficients` | 그 포트·모드의 첫 쓰기: 원래 계수 읽기 1C + 쓰기 1C = 2C. 그 뒤 쓰기(같은 값이어도) 1C                                                                                                                                                                                                                                                | 2 × 1.5, 그 뒤 1.5    | LastKnown 없음. PIDF 알고리즘의 RUN_TO_POSITION에 I·D·F를 주면 보내지 않고 `UnsupportedOperationException`                                                                                                   |
| `getPIDFCoefficients`                                                                                  | 1C                                                                                                                                                                                                                                                                                                                                    | 1.5                   |                                                                                                                                                                                                              |
| `getPIDCoefficients`                                                                                   | F가 0이면 1C, 아니면 허브가 NACK해 PIDF로 다시 물어 2C                                                                                                                                                                                                                                                                                | 1.5 / 2 × 1.5         |                                                                                                                                                                                                              |
| `setMotorCurrentAlert`                                                                                 | 1C                                                                                                                                                                                                                                                                                                                                    |                       |                                                                                                                                                                                                              |
| `getMotorCurrentAlert`                                                                                 | 신선하면 H, 아니면 1C                                                                                                                                                                                                                                                                                                                 |                       |                                                                                                                                                                                                              |

### 5.2 서보(`SimServoController`, 포트 0–5; 서보·CR 서보·SPARK Mini·Blinkin이 같은 컨트롤러)

| 호출                          | 청구                                                    | 시험         | 비고                           |
| ----------------------------- | ------------------------------------------------------- | ------------ | ------------------------------ |
| `setPosition` 처음            | 2C                                                      | 2 × 1.5      | 펄스 폭 + PWM enable           |
| `setPosition` 다른 위치       | 1C + 1H                                                 | 1.5 + 0.001  | PWM enable은 LastKnown 적중    |
| `setPosition` 같은 위치(신선) | 1H                                                      | package-info |                                |
| `setPulseWidth`               | 펄스 폭 1C + PWM enable(H 또는 1C)                      |              | 위치 LastKnown을 무효화        |
| `getPosition`                 | 신선하면 H, 아니면 펄스 폭 읽기 1C                      |              |                                |
| PWM enable/disable            | 같은 값(신선) 1H, 아니면 1C                             |              | enable(true)은 **위험한 명령** |
| `setServoPwmRange`            | 범위가 다를 때만 1C(`LynxSetServoConfigurationCommand`) |              |                                |

위치 범위 [0, 1], 허브 펄스 폭 범위 [1, 65535] µs(`PULSE_WIDTH_FIRST`·`LAST`, `LynxSetServoPulseWidthCommand` 범위), 펄스 폭 = `Range.scale(position, 0, 1, usPulseLower, usPulseUpper)`를 [1, 65535]로 자른 정수.

서보 포트 장치의 기본 펄스 범위(`SandbotHardware.SERVO_TYPES`, 주석: "범위는 각 형식의 `@ServoType`과 같다". `PwmRange(usPulseLower, usPulseUpper, usFrame)`, µs):

| 구성 태그                 | SimDevice 종류 | usPulseLower | usPulseUpper | usFrame |
| ------------------------- | -------------- | ------------ | ------------ | ------- |
| `Servo`                   | `servo`        | 600          | 2400         | 20000   |
| `ServoFullRange`          | `servo`        | 500          | 2500         | 20000   |
| `ContinuousRotationServo` | `crServo`      | 600          | 2400         | 20000   |
| `RevSPARKMini`            | `sparkMini`    | 500          | 2500         | 5500    |
| `RevBlinkinLedDriver`     | `blinkin`      | 500          | 2500         | 20000   |

`initializeHardware`(구성 읽기와 OpMode마다)가 이 기본 범위로 되돌리고 PWM을 끈다. `setServoPwmRange`는 `usFrame`만 허브에 간다(1C, 범위가 다를 때만).

### 5.3 디지털·아날로그·전압·허브(`LynxModule`)

| 호출                                                                                                                    | 청구                                                            | 시험                    |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------- |
| 디지털 `getMode`                                                                                                        | 신선하면 H, 아니면 1C                                           |                         |
| 디지털 `setMode`                                                                                                        | 모드 읽기(H) + 1C(`LynxSetDIODirectionCommand`)                 | 1.5 + 0.001             |
| 디지털 `setState`(출력 모드)                                                                                            | 모드 읽기 H + 1C. 같은 값도 늘 보냄                             | 1.5 + 0.001, 두 번 같음 |
| 디지털 `getState` 입력 모드                                                                                             | 모드 H + OFF: 1C / 캐시: §6                                     | 터치 센서 1.5 + 0.001   |
| 디지털 `getState` 출력 모드                                                                                             | 모드 H만(SDK가 마지막으로 쓴 값을 돌려줌, 허브에 묻지 않음)     |                         |
| 아날로그 `getVoltage`                                                                                                   | OFF: 1C. 캐시: §6                                               | 1.5                     |
| `VoltageSensor.getVoltage`                                                                                              | 늘 1C(bulk로 대신하지 않음)                                     | 1.5                     |
| `LynxModule.getInputVoltage`·`getAuxiliaryVoltage`·`getTemperature`·`getCurrent`·`getGpioBusCurrent`·`getI2cBusCurrent` | 각 1C(`LynxGetADCCommand`)                                      |                         |
| `getFirmwareVersionString`·`getNullableFirmwareVersionString`, `getRevProductNumber`                                    | 각 1C                                                           |                         |
| `getImuType`                                                                                                            | 1C(`getRevProductNumber`가 먼저). 그 뒤 I2C 칩 찾기는 세지 않음 |                         |
| LED `setPattern`·`setConstant`                                                                                          | 1C                                                              |                         |
| 팀 코드의 `failSafe`·`enablePhoneCharging`·`isPhoneChargingEnabled`·`setDebug`                                          | 각 1C                                                           |                         |
| `getBulkData`                                                                                                           | 늘 B 1개(§6)                                                    | 2.0 / 3.0               |

### 5.4 I2C(`SimI2cDeviceSynch`)

장치 드라이버(실제 소스 그대로)가 부르는 `I2cDeviceSynch` 읽기·쓰기 한 번 = I 1개. 끊긴 스레드는 보내지 않는다(§8.4). 칩이 정한 개수(주석·시험):

| 호출                                                      | I2C 트랜잭션                         | 추가 대기            | 위치·근거                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BHI260AP `initialize`                                     | 13                                   | 0                    | `SimImu.Chip.BHI260AP`, 시험 13 × 2.5 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| BNO055 `IMU` 인터페이스 `initialize`                      | 18                                   | 40 ms                | `SimImu.Chip.BNO055`, 시험 18 × 3.5 + 40(Expansion)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 옛 `BNO055IMU.initialize`                                 | 24                                   | 780 ms               | `SimBNO055IMU.resetChip`: 25 + 400 + 4 × 60 + 100 + 15 ms(칩 리셋 뒤 650 ms 안에 CHIP_ID가 응답하지 않아 60 ms씩 다시 읽음). BNO055 POR 650 ms(`RESET_NANOS`)는 데이터시트 값이라고 주석이 적음(데이터시트 원문은 저장소에 없음, §17). 준비 판정(`now − resetAt ≥ RESET_NANOS`)은 읽기를 보내기 전 시각으로 하고 읽기 사이를 `delay(60)`으로 채운다. 계산값: Control Hub(2.5 ms)는 읽기가 리셋 뒤 400·462.5·525·587.5·650.0 ms라 다섯째에서(정확히 650 ms, `≥`), Expansion Hub(3.5 ms)는 400·463.5·527·590.5·654 ms라 다섯째에서 성공하므로 두 허브 모두 다시 읽기 4번(4 × 60 ms)이고 트랜잭션은 1 + 2 + 1 + 5 + 14 + 1 = 24 |
| IMU 방향 읽기, 각속도 읽기, `resetYaw`                    | 각 1                                 | -                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Pinpoint `update`                                         | 1(처음은 펌웨어 버전 읽기 1 더)      | -                    | 시험 2 × 2.5 → 2.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pinpoint `setOffsets`                                     | 2(레지스터 쓰기 둘)                  | -                    | 시험 2 × 2.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| VL53L0X `getDistance`                                     | 3(새 측정을 기다리는 상태 읽기 포함) | 측정 주기까지 기다림 | 시험                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 옛 `BNO055IMU`의 `getCalibrationStatus`·`isXxxCalibrated` | 각 1(CALIB_STAT)                     | -                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

## 6. BulkCachingMode

실제 `LynxModule`의 `recordBulkCachingCommandIntent`·`getBulkData`·`clearBulkCache`와 같은 규칙이다(`SimHub`). 상태: `bulkCachingMode`(기본 OFF), `bulkCachingHistory`(태그 → 이미 읽은 명령 목록), `lastBulkData`(Snapshot). OpMode마다 OFF로 돌아간다(`beforeInit`).

| 모드            | 규칙                                                                                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OFF             | 엔코더·디지털·아날로그·busy 읽기마다 C 1개. 속도·과전류는 OFF에서도 bulk read(B 1개)                                                                                                                                                                                                                                               |
| AUTO            | 읽을 때 `command`(명령 종류와 포트를 합친 글자)가 그 `tag`의 기록에 이미 있으면 캐시를 비우고(`clearBulkCache`: 모든 태그의 기록과 `lastBulkData`를 지움), 캐시가 없으면(`lastBulkData == null`) `getBulkData()`로 B 1개를 채운다. 그다음 명령을 기록에 더한다. 그래서 루프마다 같은 엔코더를 다시 읽으면 읽을 때마다 새 bulk read |
| MANUAL          | `clearBulkCache()` 뒤 첫 읽기에서 B 1개. 그 뒤는 캐시만(`recordBulkCachingCommandIntent`가 기록은 하지 않음)                                                                                                                                                                                                                       |
| `getBulkData()` | 모드와 관계없이 늘 B 1개(캐시를 새로 채움)                                                                                                                                                                                                                                                                                         |

`setBulkCachingMode(OFF)`는 캐시를 비운다(MANUAL ↔ AUTO 사이는 캐시를 지킴). 모드는 허브 SimDevice 출력 `bulkCachingMode`로 보인다.

명령·태그 이름(코드):

| 읽기                 | command                       | tag                       |
| -------------------- | ----------------------------- | ------------------------- |
| `getCurrentPosition` | `getMotorEncoderPosition:<z>` | `""`                      |
| `isBusy`             | `isMotorAtTarget:<z>`         | `""`                      |
| `getVelocity`        | `getBulkInputData`            | `motorVelocity<z>`        |
| `isMotorOverCurrent` | `getBulkInputData`            | `motorOverCurrent<motor>` |
| 디지털 입력          | `getSingleDIOInput:<pin>`     | `""`                      |
| 아날로그             | `getADC:user<port>`           | `""`                      |

bulk 스냅샷(`SimHub.Snapshot`): 모터 4개의 위치(정수)·속도·busy·과전류, 디지털 8핀, 아날로그 4포트(V). 속도는 `(short)` int16으로 감아 돌려준다(§9.4).

---

## 7. LastKnown(500 ms)

| 항목                                | 값                                                | 위치                                | 상태·근거                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 신선도                              | 500 ms                                            | `SimLastKnown.DEFAULT_MS_FRESHNESS` | 주석: 실제 `com.qualcomm.robotcore.util.LastKnown`과 같은 의미(기본 신선도 500 ms)                                                                                                                                       |
| 유효 판정                           | `valid ∧ (now − setNanos) / 10⁶ ≤ 500`            | `isValid`                           | 코드 값. 경계 포함(≤)                                                                                                                                                                                                    |
| 적중 비용                           | CLOCK_READ(0.001 ms) 한 번                        | `chargeHit`                         | 실제 `LastKnown.isValid`가 신선도를 보려고 읽는 `ElapsedTime`(System.nanoTime) 한 번. SandBot은 캐시가 답할 때만(`isValue`가 true, `getValue`가 값을 냄) 청구한다. 청구는 `Sim.installed() ∧ SimHub.isCharging()`일 때만 |
| 캐시가 답하지 못해 허브로 가는 경로 | 따로 청구하지 않음                                |                                     | **[가정/근사]** 허브 명령 비용(실측 근사)이 SDK 안의 일(신선도를 보거나 값을 기억하는 시계 읽기 포함)을 포함한다고 봄. assumptions.md "허브 명령 비용에 든 SDK 안 일"                                                    |
| `getNonTimedValue`                  | 신선도를 보지 않고 시계를 읽지 않으므로 비용 없음 |                                     | 실제 `getNonTimedValue`와 같음                                                                                                                                                                                           |

규칙(실제 컨트롤러와 같음): 같은 값을 쓰려 하면(`updateValue`/`isValue`) 허브에 보내지 않고 H만 청구한다. 값이 다르거나 신선하지 않으면 값을 기억하고 허브로 보낸다. 그래서 캐시로만 답하는 루프(STOP을 무시하고 같은 power만 쓰는 루프)도 가상 시간이 흘러 START·STOP이 적용되고, 500 ms마다 신선도가 지나 다시 보내며, STOP 뒤에는 `stuckInStop`으로 끝난다(§8.1의 5). 허브 fail safe·`initializeHardware`가 `forgetLastKnown`으로 캐시를 지운다.

---

## 8. STOP·fail safe·끊긴 스레드

### 8.1 STOP 흐름(시간순)

1. STOP의 출처: 호스트가 tickReply의 `events`에 `'stop'`을 실어 보냄(렌더러 STOP, Autonomous 30초 자동 정지), 또는 팀 코드의 `requestOpModeStop`(`stopRequestedByOpMode`), 또는 OpMode 본문이 스스로 끝남(`endOpMode` → `applyStop(false)`), 또는 비상 정지(`emergencyStopRequested`).
2. `OpModeRunner.onTick`(틱 경계의 일): `pendingEvents`를 처리해 `applyStop(true)`(DS STOP) → `stopRequestedByOpMode`면 `applyStop(false)` → `emergencyStopRequested`면 `applyStop(false)`. START는 `!stopApplied ∧ phase == init`일 때만 적용된다.
3. `applyStop`: `stopApplied = true`, `stopTimeNanos = now`, `state stopping` 전송. `opMode`가 준비된 뒤라면 **먼저** `hooks.stopRequested(hardwareMap)`(= `SandbotHardware.stopRequested`: 청구를 끄고 위험한 명령 막기 켜기 → 모든 허브에 fail safe), **그다음** `SandbotOpModeBridge.stop(opMode)`(= `internalStop` → LinearOpMode는 OpMode 스레드에 끼어듦, 반복 OpMode는 `stopRequested = true`). 실제 `OpModeManagerImpl.callActiveOpModeStop`의 순서다.
4. 이후 OpMode가 `stop()`을 부르고 끝나면 `endOpMode` → (끊김 지우기 `Thread.interrupted()`) → Dashboard `postStop` → 수명 알림 `notifyPostStop` → `state stopping` → `finish(reason)`.
5. STOP 뒤 OpMode가 900 ms(가상) 안에 끝나지 않으면(`clock.peekNanos() − stopTimeNanos > STUCK_IN_STOP_NANOS`) error `stuckInStop` → `notifyPostStop` → `finish("stuck")`. 검사는 틱 경계 끝에서 한다.
6. `finish`: `afterStop`(청구 끔 + 허브 fail safe) → Dashboard 남은 패킷 flush → 팀 출력 남은 줄 flush → `endTicks()` → 마지막 `tick`(답을 기다리지 않음) → (Road Runner 튜닝 결과 notice) → `finished` → `Runtime.halt(0)`.

### 8.2 "위험한 명령"과 막기

STOP 뒤 다음 INIT 전까지 `OpModeManagerImpl.shouldPreventDangerousHardwareAccess()`가 true다(상태는 실제처럼 `OpModeManagerImpl`의 정적 필드 하나. `stopRequested`가 fail safe 전에 켜고 `beforeInit`이 끈다). 이 동안 `SimHub.lynxCommand(dangerous = true)`는 보내지 않고 false를 돌려주며, 컨트롤러는 그 명령을 조용히 버린다(실제는 `CANCELLED_FOR_SAFETY` NACK이고 컨트롤러의 예외 처리가 조용히 버린다).

| 위험한 명령(`lynxCommand(true)`)                  | 조건                                            | 위치                                        |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| 모터 정전력(RUN_WITHOUT_ENCODER)                  | `(int) hubPower ≠ 0`(hubPower = power × 32 767) | `internalSetMotorPower`                     |
| 모터 목표 속도(RUN_USING_ENCODER·RUN_TO_POSITION) | `(int) 속도 ≠ 0`                                | `internalSetMotorPower`, `setMotorVelocity` |
| 모터 목표 위치                                    | 늘                                              | `setMotorTargetPosition`                    |
| 서보 펄스 폭                                      | 늘                                              | `internalSetPulseWidth`                     |
| 서보 PWM 켜기                                     | `enable == true`                                | `internalSetPwmEnable`                      |

위험하지 않은 것(STOP 뒤에도 허브에 감): power 0·목표 속도 0, 모터 enable/disable, 모드·zero power·PIDF 쓰기, 디지털 출력, 서보 PWM 끄기, 모든 읽기, I2C, LED.

취소된 명령도 실제 `send()`가 안전 검사 전에 잡은 네트워크 잠금 한 번의 비용으로 CLOCK_READ를 청구한다(허브 명령 비용이 아님). 그래서 끊김을 지우고 STOP을 무시한 채 위험한 명령만 부르는 루프도 가상 시간이 흘러 `stuckInStop`으로 끝난다.

### 8.3 fail safe가 하는 일과 하지 않는 일

`SimHub.failSafe()` → `applyFailSafe()`: 모터를 멈추고 끄고(정전력 0·목표 속도 0·`enabled = false`), 서보 PWM을 끄고(`enabled = false`), 컨트롤러의 LastKnown을 잊는다(`forgetLastKnown`: 모터 모드·power·zero power·enable, 서보 위치·enable·펄스 폭, 디지털 모드·상태).

fail safe가 지우지 않는 것: 모터 모드·zero power·목표 위치(`targetPositionSet`)·허용 오차·PIDF, 서보 펄스 폭, 엔코더 리셋 기준. 그래서 STOP 뒤 RUN_TO_POSITION 모터에 `setPower(0)`을 해도 `TargetPositionNotSetException`이 나지 않는다.

근거(코드 주석, **[가정: 펌웨어 추론]**): 펌웨어 명세가 공개되지 않았다. SDK 10.1.1까지 `initializeHardware`는 OpMode INIT마다 `floatHardware()`(setPower 0 → 켜기)를 `runWithoutEncoders()`보다 먼저 불렀다. fail safe가 목표 위치를 지웠다면 RUN_TO_POSITION 오토 뒤 TeleOp을 INIT한 모든 팀이 이 예외를 봤을 것인데 보고된 것은 목표 위치를 한 번도 주지 않은 경우뿐이고(FtcRobotController 이슈 #913·#1345), 10.2가 순서를 `runWithoutEncoders` → `floatHardware`로 바꿔 고쳤다. SDK 12.0은 새 순서다(`initializeHardware`). 한계: SandBot은 실행마다 사이드카(허브)를 새로 만들므로 목표 위치의 수명은 실행 하나다(실제는 허브 전원을 끌 때까지).

호출 경로별:

| 경로                                          | 청구                                                          | 설명                                                              |
| --------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| 런타임의 STOP 처리(`stopRequested`)           | 없음(청구 끔)                                                 | 위험한 명령 막기 켜기 + 허브마다 `attemptFailSafeAndIgnoreErrors` |
| 끝내기(`afterStop`)                           | 없음                                                          | 청구 끄기 + 허브마다 fail safe                                    |
| 팀 코드가 부른 `failSafe()`                   | 1C                                                            | 끊긴 스레드면 보내지 않고 false(허브 상태·LastKnown 그대로)       |
| `SimDcMotorController.close()`·서보 `close()` | `floatHardware`(모터 4개 power 0·켜기 / 서보 PWM 끄기)의 비용 | 모터는 `keepFailSafeLast`로 감쌈                                  |

### 8.4 끊긴 스레드(`acquireNetworkLock`)

실제 Lynx 명령은 보내기 전에 `MessageKeyedLock.acquire`(lockInterruptibly)를 거친다. 그래서 끊긴(interrupt) 스레드의 명령은 허브에 가지 않고 컨트롤러는 `InterruptedException`을 `handleException`(스레드를 다시 끊음)으로 넘긴 뒤 쓰기는 버리고 읽기는 실제 자리값을 돌려준다. LinearOpMode는 STOP을 받으면 OpMode 스레드를 끊으므로(`internalOnStopRequested`) 팀이 끊김을 지우지 않는 한 STOP 뒤의 허브 명령은 모두 이렇다.

SandBot 구현: `SimHub.acquireNetworkLock()` — `charging ∧ Thread.currentThread().isInterrupted()`이면 LYNX_COMMAND·BULK_READ·I2C_TRANSACTION 대신 CLOCK_READ 한 번만 청구하고 false를 돌려준다(끊김 표시는 지우지 않는다: 실제는 lockInterruptibly가 지우고 handleException이 다시 세우므로 결과가 같다). 팀 코드가 돌지 않을 때(`charging == false`)는 막지 않는다. LastKnown 캐시는 잠금을 잡지 않으므로 끊긴 스레드에서도 답하고 H를 청구한다.

자리값(실제 `catch` 블록이 돌려주는 값):

| 대상                                                                                | 자리값                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 모터 엔코더·목표 위치·속도·전류·아날로그·배터리                                     | 0                                                                                                                                                                                                                                 |
| 모터 모드 / zero power / power                                                      | `RUN_WITHOUT_ENCODER` / `BRAKE` / 0                                                                                                                                                                                               |
| 모터 enable·서보 PWM enable                                                         | true                                                                                                                                                                                                                              |
| `isBusy`(비캐시)                                                                    | false                                                                                                                                                                                                                             |
| bulk read(`getBulkData`)                                                            | 가짜 값 `Snapshot.placeholder()`: 엔코더·속도·아날로그·디지털·과전류 모두 0/false, **busy는 모터 넷 모두 true**. `lastBulkData`로 캐시에 들어가 MANUAL에서는 `clearBulkCache`까지, AUTO에서는 같은 명령을 다시 읽을 때까지 남는다 |
| 디지털 모드·입력                                                                    | `INPUT`·false                                                                                                                                                                                                                     |
| 서보 펄스 폭                                                                        | 0                                                                                                                                                                                                                                 |
| `LynxModule` 전압·전류·온도                                                         | 0.0(단위 변환 없음, `getTemperature(FARENHEIT)`도 0.0)                                                                                                                                                                            |
| 펌웨어 문자열                                                                       | null → "firmware version unavailable"                                                                                                                                                                                             |
| I2C 읽기                                                                            | 칩을 부르지 않고 모두 0인 creg 바이트(`TimestampedI2cData.makeFakeData`) + 클라이언트마다 "placeholder: readTimestamped" 오류 로그 한 번(보낸 읽기가 되살림). 쓰기는 버림                                                         |
| `LynxModule`의 `failSafe`·`enablePhoneCharging`·`isPhoneChargingEnabled`·`setDebug` | `InterruptedException`을 던지고 끊김이 지워짐(lockInterruptibly)                                                                                                                                                                  |
| `attemptFailSafeAndIgnoreErrors`·`getRevProductNumber`                              | 끊김을 지운 채 돌아옴(그 뒤 명령은 다시 감, 실제와 같음)                                                                                                                                                                          |

IMU·옛 `BNO055IMU`의 자리값 처리(주석): IMU 인터페이스(BHI260AP·BNO055)는 0 쿼터니언을 거절해 `QuaternionBasedImuHelper` 경고와 단위 사원수(요·피치·롤 0), `resetYaw`는 시간 제한(BNO055 100 ms, BHI260 50 ms)까지 다시 읽고 마지막 방향을 쓰며, 각속도 0, `initialize`는 칩 확인 읽기가 0이라 실패한다. 옛 `BNO055IMU`는 Euler 0(heading −0), 단위 사원수, 각속도 −0·−0·0, 중력·가속도 0, 온도 0, 상태 IDLE, 보정 상태 0이고 `initialize`는 CHIP_ID 0으로 실패해 이전 매개변수를 지킨다.

### 8.5 모터 enable와 목표 위치 규칙

RUN_TO_POSITION에서 모터를 켜려면(`LynxSetMotorChannelEnableCommand`) 목표 위치를 먼저 받아야 한다. 아니면 펌웨어가 `MOTOR_NOT_CONFIG_BEFORE_ENABLED`로 NACK하고 SDK가 `TargetPositionNotSetException`을 던진다. 실제 `LynxDcMotorController`처럼 `lastKnownEnable`은 `updateValue`가 둔 `true` 그대로 둔다(되돌리지 않음): 신선한 동안(500 ms) 다시 켜기는 보내지 않아 던지지 않고 모터는 꺼진 채다. 출력 `targetPosition`은 목표를 받은 적이 없으면 null.

### 8.6 STOP과 진행 중인 명령(`failSafes`·`keepFailSafeLast`)

틱 경계는 비용 청구(`Sim.charge`) 안에서 처리되므로 STOP을 싣는 경계가 허브 명령의 비용 안(명령을 보내고 응답을 기다리는 사이)에 떨어지면 fail safe가 컨트롤러가 그 명령의 상태를 쓰기 전에 돈다. 실제(`callActiveOpModeStop`, `LynxModule` 네트워크 잠금)는 그 명령이 이미 전선 위에 있고 fail safe가 잠금을 기다려 그 뒤에 가므로 fail safe가 마지막이다.

SandBot 규칙:

- `SimHub.failSafes`: 이 허브의 **Lynx 명령 비용 안**(`commandInFlight == this`)에서 간 fail safe 수(OpMode 스레드만 씀). LastKnown 적중의 CLOCK_READ나 끊긴 스레드의 잠금 시도 안에서 온 fail safe는 세지 않는다.
- fail safe가 덮는 출력을 쓰는 컨트롤러 호출(모터 power·속도·켜기·끄기·모드·`close`, 서보 펄스·PWM 켜기)은 시작할 때 `failSafes()`를 읽어 두고 `finally`에서 `keepFailSafeLast(since)`를 부른다. 그사이 수가 바뀌었으면 `applyFailSafe()`를 비용 없이 다시 놓는다(돌아온 호출이 쓴 정전력·목표 속도·켜기와 LastKnown을 fail safe가 남긴 것으로 되돌림).
- fail safe가 지우지 않는 값(모드·엔코더 리셋·목표 위치·펄스 폭·PIDF)은 그 호출이 쓴 그대로 남는다.
- 명령 시도와 비용은 그대로라 이 경쟁이 없는 실행의 출력은 바뀌지 않는다. 그 호출의 뒤따르는 명령(power 뒤 켜기, 모드 뒤 power 다시 보내기)은 fail safe 뒤의 규칙(끊긴 스레드·위험한 명령)으로 시도하고 청구하며, 보냈더라도 효과는 fail safe가 덮는다(실제는 잠금 순서에 따라 fail safe 앞에 갈 수도 있음).
- STOP 뒤의 새 호출은 이 규칙과 관계없다(끊김을 지운 스레드나 반복 OpMode의 power 0·켜기는 실제처럼 허브에 감).

### 8.7 수명 알림 순서와 그 청구

`callActiveOpModeInit/Start/Stop`의 순서: FTC Dashboard 대체(있으면, 앱 시작 때 등록한 리스너처럼 먼저) → `OpModeManagerImpl.registerListener`로 등록한 리스너(등록 순서) → `hardwareMap`의 Notifications 장치(BNO055 드라이버 등). `preInit`의 예외는 init의 예외와 같고(`endOpMode`), `preStart`·`postStop`의 예외는 error `exception`으로 알리고 계속한다. postStop·장치 정리는 실제로 끊기지 않은 이벤트 루프 스레드가 하므로 OpMode 스레드의 끊김을 먼저 지운다(`Thread.interrupted()`).

---

## 9. 장치 출력·입력 키, 단위, 부호 규약

기준 문서는 `sidecar/sdk/org/sandbot/sdk/devices/package-info.java`다. 장치마다 `SimDevice`(구성 이름 하나, `Sim.devices()`에 구성에 넣은 순서로 등록)가 있고, **출력**은 가짜 SDK가 허브에 보낸 명령의 결과(허브 펌웨어가 보는 값)로 사이드카가 틱마다 호스트로 보내고, **입력**은 시뮬레이터가 넣는 측정값으로 장치가 읽는다(없으면 기본값). 물리는 없다. 값은 Number·Boolean·String·null과 유한 수의 List(출력만, 모터 PIDF 계수 등)만 쓴다. 단위는 따로 적지 않으면 SI(m, rad, s, V, A)다. 같은 구성 이름을 쓰는 모터·데드휠은 장치 하나를 함께 쓴다.

### 9.1 허브 방향 규약

허브 모터 값은 허브 방향이다: SDK가 모터 형식의 회전 방향(CCW 형식은 FORWARD에서 반대, 실제 `DcMotorImpl`)과 `setDirection`을 적용한 뒤의 값이다. 그래서 goBILDA 모터(CCW 형식)에 FORWARD로 `setPower(0.5)`를 하면 출력 `power`는 −0.5다. 시뮬레이터는 출력 `power`의 부호대로 돌리고 같은 부호로 `position`을 센다. 팀 코드의 `getPower`가 돌려줄 값은 `apiPower`로 따로 내보내지만 시뮬레이터는 쓰지 않는다(표시용). 인스펙터의 모터 방향이 "+power면 바퀴가 앞으로 구르는 방향"이라는 규약은 `drivetrain.md`가 맡는다.

### 9.2 장치 종류별 출력·입력(kind 표)

| kind(구성 태그)                                               | 출력 키                                                                                                                                                                                                                                  | 입력 키                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hub`(LynxModule, 이름은 구성의 허브 이름)                    | `bulkCachingMode`(OFF·AUTO·MANUAL), `led`(한 색이면 `#RRGGBB`, 여러 단계면 `pattern`, 없으면 null)                                                                                                                                       | `voltage`(배터리 V, 기본 12.5), `current`·`gpioCurrent`·`i2cCurrent`(A, 기본 0), `auxVoltage`(V, 기본 5), `temperature`(°C, 기본 25). 시뮬레이터는 `voltage`만 보낸다(`world.ts`)                                                                                 |
| `motor`(모터 태그 전부, 데드휠의 Motor 태그)                  | `apiPower`, `motorType`, `mode`, `power`, `velocity`, `enabled`, `zeroPower`, `targetPosition`, `targetTolerance`, `encoderOffset`, `encoderResets`, `velocityPidf`, `positionPidf`, `velocityAlgorithm`, `positionAlgorithm`(아래 §9.3) | `position`(원시 허브 엔코더 틱, 정수), `velocity`(틱/s, 정수), `current`(A), `overCurrent`(boolean, 없으면 `current` > 경보 값). 시뮬레이터는 모든 모터에 `current`(단자 전류의 크기, 허브 전류 감지가 크기만 본다고 가정)를 보내고 `overCurrent`는 보내지 않는다 |
| `servo`(Servo, ServoFullRange)                                | `position`(0..1, PWM이 꺼져 있으면 null), `pulseUs`(µs 또는 null), `pwm`(boolean, 처음과 fail safe 뒤 false)                                                                                                                             | -                                                                                                                                                                                                                                                                 |
| `crServo`(ContinuousRotationServo), `sparkMini`(RevSPARKMini) | `power`(−1..1 또는 null: `position·2 − 1`), `pulseUs`, `pwm`                                                                                                                                                                             | -                                                                                                                                                                                                                                                                 |
| `blinkin`(RevBlinkinLedDriver)                                | `pattern`(BlinkinPattern 이름 또는 null: 서수 = `round((position − 505·0.0005) / (10·0.0005))`가 0 이상 패턴 수 미만일 때), `pulseUs`, `pwm`                                                                                             | -                                                                                                                                                                                                                                                                 |
| `digital`(DigitalDevice)                                      | `mode`(INPUT·OUTPUT), `state`(출력 모드에서 쓴 값, 입력 모드면 null)                                                                                                                                                                     | `state`(boolean, 기본 true: 풀업)                                                                                                                                                                                                                                 |
| `touch`(RevTouchSensor)                                       | `mode`, `state`                                                                                                                                                                                                                          | `pressed`(boolean, 기본 false; 누르면 핀이 LOW)                                                                                                                                                                                                                   |
| `led`(Led)                                                    | `on`(출력 모드에서 핀이 LOW면 true, 입력 모드면 null; 실제 SDK처럼 핀을 출력으로 바꾸지 않음)                                                                                                                                            | -                                                                                                                                                                                                                                                                 |
| `analog`(AnalogInput)                                         | -                                                                                                                                                                                                                                        | `voltage`(V, 0..3.3, 1 mV 단위로 읽힘, 최대 3.3 V)                                                                                                                                                                                                                |
| `imu`(ControlHubImuBHI260AP, LynxEmbeddedIMU)                 | `chip`(BHI260AP·BNO055)                                                                                                                                                                                                                  | `yaw`·`pitch`·`roll`(rad, 로봇 방향: SDK IMU 좌표 X 오른쪽·Y 앞·Z 위, 내재 ZXY), `yawRate`·`pitchRate`·`rollRate`(rad/s). 장치가 구성한 허브 장착 방향으로 바꿔 보고한다                                                                                          |
| `distance`(REV_VL53L0X_RANGE_SENSOR)                          | -                                                                                                                                                                                                                                        | `distance`(m 또는 null: null·없음은 범위 밖 8190 mm)                                                                                                                                                                                                              |
| `color`(RevColorSensorV3)                                     | -                                                                                                                                                                                                                                        | `red`·`green`·`blue`(정수 0..65535, SDK 기본 3×·25 ms 기준 칩 원래 값), `proximity`(0..2047). `ir`·`distance`(시험용)는 시뮬레이터가 보내지 않음                                                                                                                  |
| `huskyLens`                                                   | `algorithm`(고른 알고리즘 이름 또는 null)                                                                                                                                                                                                | -(1단계는 블록·화살표 0개)                                                                                                                                                                                                                                        |
| `pinpoint`(goBILDAPinpoint)                                   | `xOffsetMm`(X 포드의 옆 위치, 왼쪽 +), `yOffsetMm`(Y 포드의 앞 위치, 앞 +), `ticksPerMm`(정하지 않았으면 null), `xDirection`·`yDirection`(FORWARD·REVERSED), `yawScalar`                                                                 | `x`·`y`(mm, 전원 켠 때의 로봇 틀: X 앞·Y 왼쪽), `heading`(rad, **감지 않음**), `vx`·`vy`(mm/s), `headingVelocity`(rad/s), `encoderX`·`encoderY`(정수 틱, 포드가 세는 원시 방향 = 장치의 방향 적용 전), `pitch`·`roll`(rad), `loopTime`(µs, 기본 667)              |
| `otos`(SparkFunOTOS)                                          | `offsetX`·`offsetY`(m), `offsetH`(rad), `linearScalar`, `angularScalar`                                                                                                                                                                  | `x`·`y`(m), `h`(rad), `vx`·`vy`(m/s), `vh`(rad/s), `ax`·`ay`(m/s²), `ah`(rad/s²). 틀은 팀이 쓴 오프셋이 정한다: SDK 샘플 규약(X 오른쪽·Y 앞·반시계 +) 또는 Road Runner식(X 앞·Y 왼쪽, 오프셋 h −90°)                                                              |
| `octoQuad`(OctoQuadFTC)                                       | `directions`(비트 i = 채널 i 반대), `channelBankConfig`                                                                                                                                                                                  | `position0..7`(틱, 방향 적용 전), `velocity0..7`(틱/표본 간격), 로컬라이저 `x`·`y`(mm), `h`(rad), `vx`·`vy`(mm/s), `vh`(rad/s)                                                                                                                                    |
| `webcam`(Webcam)                                              | `serialNumber`, `state`, `streaming`, `width`·`height`, `aprilTag`, `family`, `decimation`, `fps`, `exposureMs`, `gain`(이 순서, 틱마다 다 보냄)                                                                                         | `model`(문자열, 처음 한 번), `frameNanos`·`frameWidth`·`frameHeight`(정수), `tags`(숫자 배열: 태그마다 9칸 `[id, x0, y0, …, x3, y3]`, apriltag 3 픽셀 좌표 = OpenCV 좌표 + 0.5, id 오름차순, 최대 64장)                                                           |
| `limelight`(EthernetDevice)                                   | `running`, `pollRateHz`, `pipeline`, `robotYaw`(°)                                                                                                                                                                                       | -(1단계는 결과 없음, 연결 안 됨)                                                                                                                                                                                                                                  |

오도메트리(Pinpoint·OTOS·OctoQuad 로컬라이저)의 입력은 "켜진 뒤 한 번도 재설정하지 않았을 때의 값"이고 장치가 재설정·자세 쓰기·스칼라를 그 위에 얹는다(`SimTrackedPose`). Pinpoint 자세는 시뮬레이터가 펌웨어처럼 포드 틱과 이 장치의 출력(ticksPerMm·방향·오프셋)과 내장 IMU 요로 적분한 값이라 팀이 오프셋을 틀리게 쓰면 실제처럼 결과가 틀어진다. IMU 요는 시작 대비 반시계 + 로 감아 `wrapAngle`한 값이고(`world.ts`: `yaw = poseNow.yaw − start`), Pinpoint `heading`은 감지 않는다. OTOS 가속도 레지스터 범위: 선가속 ±16·g, 각가속 ±1000π rad/s²로 자른다(`world.ts` `OTOS_MAX_LINEAR_ACCEL = 16 · GRAVITY`, `OTOS_MAX_ANGULAR_ACCEL = 1000 · π`; 주석: SparkFun OTOS 드라이버의 int16 변환 상수).

### 9.3 모터 출력 키의 정의

| 키                                      | 값과 단위                                                                    | 정의(`SimDcMotorController.Channel.publish`)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                                  | RUN_WITHOUT_ENCODER·RUN_USING_ENCODER·RUN_TO_POSITION·STOP_AND_RESET_ENCODER | 마지막으로 `setMotorMode`로 보낸 모드(`commandedMode`)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `power`                                 | −1..1(허브 부호)                                                             | 엔코더 없음(`mode == RUN_WITHOUT_ENCODER`): `constantPower / 32 767`. 엔코더 모드: `clip(targetVelocity / maxTicksPerSecond, −1, 1)`(`maxTicksPerSecond` = 형식의 `getAchieveableMaxTicksPerSecondRounded`, 0 이하면 0). `commandedMode == STOP_AND_RESET_ENCODER`이면 0. 꺼짐(`enabled == false`)은 `enabled`가 따로 알린다(package-info는 "꺼져 있거나 리셋이면 0"이라고 적었으나 코드의 `publish`는 리셋일 때만 0으로 만들고, fail safe는 `constantPower`·`targetVelocity`를 0으로 만든다) |
| `apiPower`                              | −1..1(팀 코드 기준)                                                          | RUN_TO_POSITION이면 `abs(power)`, 아니면 실제 방향(`operationalDirection`)이 REVERSE일 때 `−power`. −0은 0.0                                                                                                                                                                                                                                                                                                                                                                                  |
| `velocity`                              | 틱/s 또는 null                                                               | `RUN_WITHOUT_ENCODER`면 null, 아니면 목표 속도 `targetVelocity`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `enabled`                               | boolean                                                                      | 허브가 모터를 켰는가                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `zeroPower`                             | BRAKE·FLOAT                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `targetPosition`                        | 허브 틱 또는 null                                                            | 목표 위치를 받은 적이 없으면 null. 한 번 받으면 fail safe·OpMode 사이에도 남는다(실행 하나 동안)                                                                                                                                                                                                                                                                                                                                                                                              |
| `targetTolerance`                       | 틱, 기본 5                                                                   | `DEFAULT_TARGET_POSITION_TOLERANCE`(주석: `LynxConstants.DEFAULT_TARGET_POSITION_TOLERANCE`)                                                                                                                                                                                                                                                                                                                                                                                                  |
| `encoderOffset`                         | 정수                                                                         | 마지막 `STOP_AND_RESET_ENCODER` 때의 원시 `position`(처음 0, 늘 보냄, OpMode 사이에도 그대로). 팀 코드의 엔코더 = `position − encoderOffset`, RUN_TO_POSITION의 원시 목표 = `targetPosition + encoderOffset`                                                                                                                                                                                                                                                                                  |
| `encoderResets`                         | 정수                                                                         | `STOP_AND_RESET_ENCODER` 횟수(리셋마다 1씩, 늘 보냄). 원시 position이 그대로라 offset이 같아도, 한 루프에서 리셋 → RUN_TO_POSITION을 해 틱 경계의 mode가 리셋을 보이지 않아도 리셋을 알 수 있게                                                                                                                                                                                                                                                                                               |
| `velocityPidf`·`positionPidf`           | `[p, i, d, f]`(숫자 4개, 늘 보냄)                                            | 허브에 저장된 계수를 16.16 고정소수점에서 되돌린 값(`getPIDFCoefficients`와 같음). OpMode마다 SDK가 처음 쓰기 전 값으로 되돌림                                                                                                                                                                                                                                                                                                                                                                |
| `velocityAlgorithm`·`positionAlgorithm` | LegacyPID·PIDF·Unknown                                                       | 기본·`setPIDCoefficients`는 LegacyPID, `setVelocityPIDFCoefficients`·`setPositionPIDFCoefficients`는 PIDF                                                                                                                                                                                                                                                                                                                                                                                     |

허브 값 변환(코드 값):

| 항목                                  | 값                                                                                    | 위치                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 정전력 → 허브                         | `hub = (int)(Range.scale(power, −1, 1, −32 767, 32 767))`(0 방향 절단)                | `internalSetMotorPower`, `HUB_POWER_LAST = 32 767` |
| 엔코더 모드 power → 목표 속도         | `(int)(sign(p) · Range.scale(abs(p), 0, 1, 0, maxTicksPerSecond))`                    | 같음                                               |
| `setVelocity(ticksPerSecond)`         | `clip(round(v), −32 767, 32 767)`                                                     | `HUB_VELOCITY_LAST = 32 767`                       |
| 각속도 단위 `setVelocity(rate, unit)` | `ticks/s = ticksPerRev · (°/s ÷ 360)`                                                 |                                                    |
| PIDF 내부 값                          | `internal = (int)(abs(c) · 65 536 + 0.5) · sign(c)`, `external = internal / 65 536.0` | `internalCoefficientFromExternal`                  |
| 허브 펌웨어 기본 PIDF                 | 속도 `[10, 3, 0, 0]`, 위치 `[10, 0.05, 0, 0]`, 둘 다 LegacyPID                        | `DEFAULT_VELOCITY_PIDF`·`DEFAULT_POSITION_PIDF`    |
| 포트                                  | 모터 0–3, 서보 0–5, 디지털 핀 0–7, 아날로그 포트 0–3                                  | `API_*_FIRST/LAST`                                 |

0.05의 고정소수점: `⌊0.05 · 65 536 + 0.5⌋ = 3277`, `3277 / 65 536 = 0.0500030517578125`(package-info가 같은 값을 적음).

상태: 허브 기본 PIDF는 **[가정]** — 주석: "SDK 12.0에서 계수를 정한 형식은 Core Hex 하나이고(`RevRoboticsCoreHexMotor`의 `@ExpansionHubMotorControllerVelocityParams(P=10, I=3, D=0)`·`PositionParams(P=10, I=0.05, D=0)`, LegacyPID), 나머지는 펌웨어 기본값을 쓴다. FTC SDK 6.0 릴리스 노트는 REV 모터 기본값을 2018-19 시즌의 기본 PID로 되돌려 모든 모터와 같게 했다고 쓰지만 그 숫자는 공개되지 않았다". 실측 필요(assumptions.md): 실제 허브에서 모터 형식마다 전원을 켠 뒤 `getPIDFCoefficients(RUN_USING_ENCODER)`·`(RUN_TO_POSITION)`을 읽는다.

### 9.4 정수 키와 엔코더 속도

정수로 보내는 입력 키: `position`·`velocity`·`encoderX`·`encoderY`·`red`·`green`·`blue`·`proximity`·`frameNanos`·`frameWidth`·`frameHeight`. 바뀐 키만 보낸다(처음에는 전부, null 포함, 같은 null은 다시 보내지 않음).

모터 `velocity` 입력(허브처럼 50 ms 창, `src/shared/sim/encoderVelocity.ts`):

```
velocity(t) = ( ⌊raw(t)⌋ − ⌊raw(t − 50 ms)⌋ ) × 20          (틱/s, 정수)
```

`raw`는 원시 허브 틱(소수), 창은 틱마다 미끄러진다고 본다([가정: 펌웨어가 50 ms마다 한 번만 새로 재는지는 공개 자료로 확인하지 못했다. 20의 배수인 것은 같다]). `raw(t − 50 ms)`는 하위 단계마다 기록한 값 사이를 선형 보간하고 첫 기록 전이면 첫 값을 쓴다(그래서 시작 틱의 속도는 0, 그 뒤 50 ms는 시작부터 센 틱 × 20). 상수: `HUB_VELOCITY_WINDOW_NANOS = 50 000 000`, `HUB_VELOCITY_SCALE = 10⁹ / 50 000 000 = 20`. 값이 늘 20의 배수이고 약 25 ms 늦다. 이 성질을 Road Runner `OverflowEncoder`가 기대한다(주석). 시뮬레이터는 int16으로 감기 전 값을 보내고, 가짜 SDK `SimDcMotorController.Channel.encoderVelocity()`가 실제 bulk read의 `short`처럼 `(short)`로 감아 부호 확장해 돌려준다(32 767을 넘는 빠른 데드휠은 실제처럼 감긴 값을 읽음). 데드휠(엔코더 포트의 포드)은 같은 장치 이름의 `position`·`velocity`가 포드 값이고 부호는 포드 엔코더가 세는 원시 방향(인스펙터 `reversed`, DcMotor 방향을 적용하기 전)이다. 허브 `voltage` 입력은 세계의 `batteryVoltage`다(`world.ts`: 모든 허브에 `put(hub, 'voltage', batteryVoltage)`).

### 9.5 허브 ADC 읽기의 반올림(`LynxModule`)

| 읽기                | 변환                                      | 기본값                                 | 위치                                                                                              |
| ------------------- | ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 배터리 전압         | `mV = round(V · 1000)` → 요청 단위로 환산 | 12.5 V(`SimHub.DEFAULT_BATTERY_VOLTS`) | `getInputVoltage`, `SimVoltageSensor.getVoltage`(`mv · 0.001`)                                    |
| 5 V 레일            | `mV = round(auxVoltage · 1000)`           | 5.0 V                                  | `getAuxiliaryVoltage`                                                                             |
| 전류(허브·GPIO·I2C) | `mA = round(A · 1000)`                    | 0 A                                    | `readAdcMilli`                                                                                    |
| 온도                | `deciC = round(°C · 10)`, `deciC / 10.0`  | 25 °C                                  | `getTemperature`                                                                                  |
| 모터 전류           | `current · 1000` mA                       | 0                                      | `Channel.currentMilliamps`                                                                        |
| 허브 펌웨어 문자열  | `"HW: 20, Maj: 1, Min: 8, Eng: 2"`        |                                        | `LynxModule.getNullableFirmwareVersionString` (주석: "지금 REV 허브 펌웨어(1.8.2)의 문자열 모양") |
| 제품 번호           | 3 215 698                                 |                                        | `getRevProductNumber`(주석: `LynxConstants.EXPANSION_HUB_PRODUCT_NUMBER`)                         |

배터리 전압 기본 12.5 V의 근거: assumptions.md "배터리 전압 — 실행 동안 일정, 기본 12.5 V, 전압 강하 모델이 없다(3b·3c 한계)", 상태 근사. 설정 범위는 §15.

### 9.6 옛 `BNO055IMU` 드라이버(`SimBNO055IMU`)의 고정 값

허브 내장 BNO055(구성 태그 `LynxEmbeddedIMU`)를 옛 `BNO055IMU` 인터페이스로 꺼낼 때의 값이다. 시뮬레이터 입력이 없는 값은 상수다(칩 측정 물리는 `sensors-vision.md`).

| 항목                   | 값                                                                      | 위치                                         | 상태·근거                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 중력 가속도            | 9.80665 m/s², 칩 축으로 돌린 (0, 0, 9.80665)(칩 쿼터니언의 켤레로 돌림) | `SimBNO055IMU.GRAVITY`, `gravity()`          | 코드 값. 선형 가속도는 시뮬레이터 입력이 없어 0                                                                             |
| 자기장                 | 0                                                                       | 같음                                         | 코드 주석("시뮬레이션 근사")                                                                                                |
| 온도                   | 25 °C                                                                   | 같음                                         | 코드 주석("시뮬레이션 근사"). 허브 온도 입력 기본 25 °C(§9.2)와 별개의 상수                                                 |
| 보정 상태              | 모두 완료(0xFF)                                                         | 같음                                         | 코드 주석("시뮬레이션 근사"). 끊긴 스레드에서는 0이라 `isXxxCalibrated`가 false(§8.4)                                       |
| 칩 리셋 뒤 응답        | 650 ms                                                                  | `SimBNO055IMU.RESET_NANOS`                   | 주석: BNO055 데이터시트의 POR 시간(원문은 저장소에 없음). 실제 `imuIsPresent`도 칩이 없으면 650 ms 기다림                   |
| 짐벌 잠금 문턱         | `cos(둘째 각) < 1e-5`                                                   | `SimBNO055IMU.GIMBAL_LOCK`                   | 주석: float 쿼터니언의 반올림 오차(1e-7 수준)보다 충분히 큼. 잠금이면 셋째 각을 0으로 두고 회전을 첫째(heading)에 모두 실음 |
| `resetYaw` 재시도 한도 | BNO055 100 ms, BHI260AP 50 ms                                           | `SimImu`(`helper.resetYaw`의 시간 제한 인자) | 코드 값. 시간 제한까지 다시 읽고 마지막 방향을 씀(§8.4)                                                                     |

---

## 10. OpMode 실행 흐름(런타임)

### 10.1 `Main`

`hello` 전송(런타임 소스 해시 또는 "dev", `java.version`) → stdin 읽기 스레드 시작 → 첫 메시지 `run`/`list`/그 밖(프로토콜 오류) → (run) `RunRequest.parse` → 라이브러리 열기·링크 검사 → 컴파일(`compiled`) → `HubTiming`·`VirtualClock`·팀 클래스 로더·Dashboard 다리·`OpModeRunner` 만들기 → `Sim.installFirstFolder`·(팀 보정 있으면 `installCameraCalibrations`)·`Sim.install(clock, timing, runner)`·`clock.setBoundary(runner)` → OpMode 스레드(`OpModeThread`, 컨텍스트 클래스 로더 = 팀 로더)와 감시 시작. 기본 지역은 `Locale.US`(Control Hub처럼, PC 지역 설정과 관계없이 같은 결과). 컴파일 옵션: `-source 8 -target 8 -bootclasspath <플랫폼 jar>`(비면 `--release 8`, 시험만) `-g -proc:none -encoding UTF-8 -Xlint:-options -implicit:class -Xmaxerrs 100 -Xmaxwarns 100 -sourcepath <sourceRoots> -classpath <compileClasspath>`, 진단은 `Locale.ENGLISH`. 컴파일은 `javax.tools`로 메모리에만 한다(TeamCode에 쓰지 않음).

JVM 인자(`src/main/sidecar/launch.ts` `javaArgs`): `-Xlog:disable -Xlog:all=warning:stderr -XX:+DisplayVMOutputToStderr -Xss4m -XX:+UseSerialGC -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Djava.awt.headless=true -cp <runtime jar>;<sdk jar> org.sandbot.runtime.Main`(구분자는 Windows `;`, 그 밖 `:`). 주석: 스택은 깊은 재귀(팀 코드·javac)를 위해 늘리고, 직렬 GC는 작은 힙에 맞고, 통합 로깅·tty 출력이 stdout에 섞이면 프로토콜 오류가 되므로 stderr로 보낸다. JDK는 17 이상(`MIN_JDK_MAJOR`), 사이드카 소스는 SDK `--release 8`·런타임 `--release 17`.

### 10.2 `OpModeRunner.runInner` 순서

0. FTC Dashboard 대체(있으면) 시작 → 1. 등록기 실행(요청의 모든 등록기, OpMode를 고르기 전에) → Road Runner 튜닝 폴더 준비 → 2. 구성 읽기(`SandbotHardware.create(configXml)`, 실패하면 error `config` + finished `loadFailed`) → 3. OpMode 클래스 확인(`load` 오류) → 4. `state init` → `clock.beginTicks()`(tick 0) → 5. OpMode 만들기(정적 초기화·생성자도 이 스레드) → `SandbotOpModeBridge.attach` → `hooks.beforeInit`(허브·컨트롤러 → 장치 순 `resetDeviceConfigurationForOpMode`, 위험한 명령 막기 해제, 청구 켜기) → `resetRuntime` → 수명 알림 `preInit` → `internalInit` → `runOpModeOnThisThread` → `endOpMode`.

### 10.3 틱 경계의 일(`OpModeRunner.onTick(k)`)

`tNanos = k · tickNanos`.

1. Dashboard 패킷 묶음·바뀐 설정 트리 전송(`beforeTick`, tick보다 먼저: 호스트가 일시 정지로 답을 미뤄도 이미 가 있게).
2. `tick` 전송(`phase`, `loops`, 모든 장치 출력).
3. `waitingHost = true`로 `HostInput.take()`(호스트 답이 올 때까지, 끼어들기에도 끝나지 않음). `tickReply`가 아니거나 `tick` 번호가 k와 다르면 프로토콜 오류로 끝낸다.
4. 입력 적용(`applyInputs`): 장치 이름 → 키 → 값. 모르는 장치는 무시. 값은 null·Number·Boolean·String 또는 `isTagsInput`을 만족하는 `tags` 배열만 받고 다른 배열은 버린다(`SimDevice.checkValue`가 OpMode 스레드에서 던지지 않게). 장치 입력 훅(`InputHook.beforeInputs(tNanos)`)이 옛 입력 상태에서 경계 시각을 받는다(§9.4, 칩 측정 시각).
5. 틱 경계 듣기(`Sim.fireBoundary(tNanos)`: 입력을 넣은 바로 뒤, Dashboard·DS 사건 앞, INIT 전 경계 포함. 듣는 쪽은 `charge`·`nanoTime`·`sleep`·`awaitNextTick`을 부르지 않는다. VisionPortal이 쓴다).
6. DS 사건(`events`)을 쌓는다(`"start"`·`"stop"` 외에는 프로토콜 오류). 게임패드(`gamepads`는 길이 2 배열이어야 하고 아니면 둘 다 연결 안 됨): 앞 상태와 다르면 `SandbotGamepads.fromState(state, user, uptimeMillis)`로 최신 자료를 만든다.
7. Dashboard Config 적용(`configSet`)과 바뀐 트리 전송.
8. OpMode가 준비되지 않았거나 사용자 코드가 돌지 않으면 여기서 끝(INIT 전 경계·끝난 뒤).
9. DS 사건 처리: `start`(`!stopApplied ∧ phase == init`이면 `state running`, Dashboard `preStart` → 리스너·장치 `preStart` → `internalStart`), `stop`(`applyStop(true)`). `stopRequestedByOpMode`·`emergencyStopRequested`면 `applyStop(false)`.
10. 게임패드 새 자료(`gamepadsChanged ∨ 아직 한 번도 넘기지 않음`이면 INIT 뒤 첫 경계에서 지금 상태를 한 번) → `newGamepadDataAvailable`.
11. 이벤트 루프 한 바퀴(`internalOnEventLoopIteration`: LinearOpMode의 `time = getRuntime()`, `runningNotifier.notifyAll`, 텔레메트리 `tryUpdateIfDirty`).
12. STOP 뒤 정지 대기 감시(§8.1의 5).

### 10.4 끝내기

| 종료              | `finished.reason`                                           | 조건                                                                                      |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 정상              | `stopped`(DS STOP 뒤) / `returned`(STOP 전에 OpMode 스스로) | `endOpMode(null)`                                                                         |
| 비상 정지         | `exception`                                                 | `emergencyStopRequested`(카메라 스레드 예외, EOCV `emulateEStop`의 대응)                  |
| 강제 종료         | `terminated`                                                | `SimExit`, `terminateOpModeNow`의 `ForceStopException`                                    |
| 오류              | `exception`                                                 | 팀 코드 예외·`SimThreadError`·미지원 SDK(error kind가 `exception`·`thread`·`unsupported`) |
| 정지 시간 초과    | `stuck`                                                     | 900 ms(가상)                                                                              |
| 구성·로드 실패    | `loadFailed`                                                | error `config`·`load`                                                                     |
| 컴파일 실패       | `compileFailed`                                             | `compiled.ok == false`(finished tNanos 0)                                                 |
| 호스트가 shutdown | `shutdown`                                                  |                                                                                           |
| 목록 요청         | `listed`                                                    | `ListRunner`                                                                              |

`Session.beginFinish()`로 끝내기는 한 번만 일어나고, `finished`를 쓴 뒤 `Protocol`은 아무것도 쓰지 않는다(`closed`). 끝내면 `Runtime.halt(0)`.

---

## 11. 프로토콜(버전 4)

줄 하나 = JSON 객체 하나(UTF-8, `\n`). 사이드카 stdout은 프로토콜 전용이다. 팀 코드의 `System.out`·`System.err`는 사이드카가 가로채 `log`로 보낸다. stderr는 JVM 자체 출력(진단용). 주석 근거: "한 줄에 JSON 객체 하나… stderr는 JVM 자체 출력(시작 안내, 치명적 오류)이라 진단용으로만 모은다".

### 11.1 버전

`SIDECAR_PROTOCOL_VERSION = 4`(`src/shared/sidecarProtocol.ts`), `RunRequest.PROTOCOL = 4`(Java). `sidecar.json`의 `protocol`, `hello.protocol`, `run`의 `protocol`이 정확히 같은 판이어야 한다(아니면 `noSidecar`·프로토콜 오류·`loadFailed`). 4의 변경: 웹캠 입력 `tags`(이 판의 유일한 입력 배열), `RunRequest.teamCalibrations`, 비전 notice 여덟. CLAUDE.md의 서술: 프로토콜 2는 라이브러리 L1(`bootClasspath`·`compileClasspath`·`libraryClasspath`), 3은 L2(등록기·`firstFolder`·`list`·`registered`·`dash`·`dashConfig`·`notice`·`configSet`)에서 더해졌다. 판 1·2·3의 정확한 변경 목록은 원본 명세가 없어 이 문서에서 코드로 확인하지 못했다(§17).

### 11.2 호스트 → 사이드카

| 메시지      | 필드                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 한도·규칙                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`       | `type`, `protocol`(4), `clock`(`'virtual'`), `tickNanos`(양수 정수), `sourceRoots`(문자열[]), `opModeSource`(비지 않은 문자열), `opModeClass`·`registeredName`(**정확히 하나만** 문자열, 나머지 null), `registrars`(`{className, source}`[]), `firstFolder`, `bootClasspath`·`compileClasspath`·`libraryClasspath`(문자열[]), `configXml`(문자열 또는 null), `timing`(키 → ms), `jitter`, `seed`(정수), `startEpochMillis`(정수), `stallMillis`(양수 정수), `teamCalibrations`(문자열 또는 null) | 정수는 Long 또는 `\|d\| ≤ 9 007 199 254 740 991`인 정수 값 Double. 틀리면 `RunRequest.Invalid`(영어) → error `internal` + finished `loadFailed` |
| `list`      | `type`, `protocol`, `clock`, `tickNanos`, `sourceRoots`, `registrars`(**하나 이상**), `bootClasspath`, `compileClasspath`, `libraryClasspath`, `firstFolder`, `startEpochMillis`, `stallMillis`                                                                                                                                                                                                                                                                                                  | hardwareMap·틱 교환 없음(틱 경계에서 호스트를 기다리지 않음). 결과 `registered` + `finished listed`                                             |
| `tickReply` | `tick`(보낸 tick 번호와 같아야 함), `events`(`'start'`·`'stop'`[]), `gamepads`(길이 2, 각 `GamepadState` 또는 null), `inputs`(장치 이름 → 키 → 값, 보낸 키만 바꿈), `configSet`(`{path, value}`[])                                                                                                                                                                                                                                                                                               | `configSet`은 한 답에 256개까지(호스트 `MAX_PENDING_CONFIG`). 경로 깊이 ≤ 16, 글자 ≤ 8192(`parseCommand`)                                       |
| `shutdown`  | `type`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 큐를 거치지 않고 읽기 스레드에서 바로 처리. 사이드카는 `finished shutdown`을 보내고 끝낸다                                                      |

`GamepadState`: 실수 키 `left_stick_x`·`left_stick_y`·`right_stick_x`·`right_stick_y`(−1..1, **스틱 y는 위로 밀면 음수**, SDK와 같음)·`left_trigger`·`right_trigger`(0..1), 버튼 `dpad_up`·`dpad_down`·`dpad_left`·`dpad_right`·`a`·`b`·`x`·`y`·`guide`·`start`·`back`·`left_bumper`·`right_bumper`·`left_stick_button`·`right_stick_button`·`touchpad`. PS 이름(cross·circle·square·triangle·share·options·ps)은 SDK가 같은 값을 보이므로 따로 보내지 않는다. 메인이 렌더러의 게임패드를 믿지 않고 `sanitizeGamepad`로 정해진 필드만 담는다(스틱 [−1, 1]·트리거 [0, 1]로 자름, 수가 아니면 0, 버튼은 `=== true`만 true). 사이드카는 NaN을 0으로, `float`로 바꾼다. 게임패드 사용자·id는 1·2(`setUser`, `setGamepadId`), 타임스탬프는 가상 uptime ms다. 연결되지 않은 게임패드(null)는 모든 값 0, `id = ID_UNASSOCIATED`.

입력 배열(`isTagsInput`, 세계·호스트 `mergeInputs`·사이드카 `applyInputs`가 같은 규칙): 키가 `'tags'`, 배열, 길이가 `TAG_INPUT_STRIDE`(9)의 배수이고 `9 · MAX_TAG_DETECTIONS`(64 → 576) 이하, 모든 원소가 유한 수, 칸 0(id)이 0 이상의 안전한 정수. 아니면 그 키를 버린다. `MAX_TAG_DETECTIONS = 64`는 [결정: BIOBUZZ 16장과 팀 라이브러리를 넉넉히 넘는 수, spec-4d §1.5].

### 11.3 사이드카 → 호스트

| 메시지       | 필드                                                                                                                                                                 | 보내는 때·규칙                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `hello`      | `protocol`, `runtime`(소스 해시, 없으면 `"dev"`), `java`                                                                                                             | 가장 먼저 한 번. 호스트가 30 s 안에 못 받으면 프로토콜 오류               |
| `compiled`   | `ok`, `diagnostics`(`kind`(error·warning·note), `file`(절대 경로 또는 null), `line`(1부터, 모르면 0), `column`, `message`(영어), `code`), `millis`(컴파일 벽시계 ms) | run·list 뒤                                                               |
| `linkReport` | `warnings`(`jar`, `kind`(missingClass·missingMember·unsupported), `from`, `target`)                                                                                  | `libraryClasspath`가 있을 때 hello 뒤·compiled 전 한 번. 실행을 막지 않음 |
| `state`      | `tNanos`, `phase`(init·running·stopping)                                                                                                                             | INIT 시작, START(`running`), STOP·끝(`stopping`)                          |
| `tick`       | `tick`, `tNanos`(= tick × tickNanos, 끝내기의 마지막 tick만 그때의 `now`), `phase`, `loops`(지금까지의 루프 표시 수), `outputs`(장치 이름 → 값)                      | 틱 경계마다. 호스트의 Step이 `loops`로 "루프 하나가 지날 때까지"를 정한다 |
| `telemetry`  | `tNanos`, `frame`(`lines`, `log`, `format`: classic·monospace·html)                                                                                                  | `telemetry.update`가 실제로 보냈을 때                                     |
| `log`        | `tNanos`, `stream`(out·err·robotLog), `text`                                                                                                                         | 가로챈 `System.out`·`err`·`RobotLog`·`android.util.Log`                   |
| `error`      | `tNanos`, `kind`, `message`(영어), `exception`(클래스 이름 또는 null), `stack`(`className`, `method`, `file`, `line`, `source`), `thread`                            | §11.4                                                                     |
| `registered` | `opModes`(`name`, `group`, `flavor`, `className`, `instance`, `registrar`, `transitionTarget`)                                                                       | 목록 모드의 결과                                                          |
| `dash`       | `tNanos`, `cleared`, `data`(`[키, 값]`[]), `log`(문자열[] 또는 null), `ops`(op[] 또는 null)                                                                          | Dashboard 패킷 묶음(§12)                                                  |
| `dashConfig` | `tNanos`, `root`(설정 트리 전체)                                                                                                                                     | 시작 뒤 한 번, 바뀔 때, `configSet` 뒤                                    |
| `notice`     | `tNanos`, `code`, `params`(문자열 → 문자열)                                                                                                                          | §11.6                                                                     |
| `finished`   | `tNanos`, `reason`                                                                                                                                                   | 한 번. 이 뒤에는 아무것도 쓰지 않음                                       |

호스트가 쓰는 순서 규칙: `hello` 전에 다른 메시지가 오면, 또는 두 번째 `hello`가 오면 프로토콜 오류. 순서가 중요한 이벤트(phase·compiled·error·simNotice·finished) 전에는 호스트가 모아 둔 `log`를 먼저 렌더러로 보낸다.

종료 시 사이드카가 보내는 순서: (오류 `error`) → `state stopping` → 마지막 `tick`(답 없음) → (`notice rrTuningSaved`) → `finished`. `finished`의 `tNanos`는 마지막 tick의 `now`다.

### 11.4 `error`의 kind

| kind          | 뜻                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exception`   | 팀 코드가 던진 예외(OpMode는 끝남), 또는 카메라 스레드 비상 정지                                                                                                          |
| `unsupported` | 사이드카가 아직 지원하지 않는 SDK API(가짜 SDK 껍데기가 `SimUnsupportedException`을 던짐)                                                                                 |
| `thread`      | OpMode 스레드가 아닌 스레드가 가상 시계·하드웨어를 씀(1단계는 한 스레드만)                                                                                                |
| `stall`       | OpMode 스레드가 `stallMillis` 동안 가상 시계를 진행시키지 않음(무한 루프 등). 정체 한 번에 한 번만 보내고, 가상 시간이 다시 흐르면 초기화되어 다시 멈출 때 또 보낸다(§14) |
| `stuckInStop` | STOP 뒤 SDK의 정지 대기 시간(900 ms 가상) 안에 끝나지 않음                                                                                                                |
| `load`        | OpMode 클래스를 찾거나 만들지 못함(OpMode가 아님, abstract, public 아님, 비정적 중첩 클래스, 인수 없는 public 생성자 없음)                                                |
| `config`      | 로봇 구성 XML을 읽지 못했거나 지원하지 않는 장치가 있음                                                                                                                   |
| `registrar`   | `@OpModeRegistrar` 메서드가 던짐(그 등록기만 건너뜀)                                                                                                                      |
| `internal`    | 사이드카 자체 오류(프로토콜 오류 포함)                                                                                                                                    |

### 11.5 `finished`의 reason과 단계

`stopped`·`returned`·`terminated`·`exception`·`compileFailed`·`loadFailed`·`stuck`·`shutdown`·`listed`(뜻은 §10.4). 호스트는 이것 말고 `killed`(호스트가 JVM을 끝냄: `stopTimeout`·`stalled`·`shutdownTimeout`)·`crashed`(사이드카가 `finished` 없이 끝남, detail에 stderr 끝부분)를 렌더러 이벤트로 더한다. 사이드카가 보는 OpMode 단계는 `init`(INIT 뒤 START 전)·`running`(START 뒤)·`stopping`(STOP·종료 요청 뒤 끝날 때까지)이고, 호스트 단계(`PlayPhase`)는 `preparing`·`compiling`·`init`·`running`·`stopping`·`finished`다.

### 11.6 `notice` 코드와 필수 params

호스트가 코드마다 params 키가 **정확히** 이 집합인지 확인한다(빠지거나 남으면 프로토콜 오류). 같은 code·params는 호스트가 실행마다 한 번만 simNotice로 보인다.

| code                         | params 키   | 뜻                                                                                                                                                                                    |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashCamera`                 | (없음)      | Dashboard 카메라 스트림은 시뮬레이션하지 않음                                                                                                                                         |
| `dashImage`                  | (없음)      | Dashboard `sendImage`는 보이지 않음                                                                                                                                                   |
| `rrTuningSaved`              | `path`      | Road Runner 튜닝 OpMode가 결과 JSON을 모의 저장소에 씀(`firstFolder` 기준 상대 경로). 호스트가 안전하면 절대 경로 `file`을 더한다(사이드카가 `file`을 보내면 남는 키라 프로토콜 오류) |
| `visionProcessorUnsupported` | `processor` | AprilTag 처리기가 아닌 처리기는 프레임을 받지 않음                                                                                                                                    |
| `aprilTagNoFieldPose`        | `cluster`   | 묶음 metadata의 필드 자세가 0이라 robotPose가 묶음 틀 기준                                                                                                                            |
| `visionSolverSubstituted`    | `solver`    | SQPNP·APRILTAG_BUILTIN 단일 태그를 ITERATIVE로 대신 풂                                                                                                                                |
| `visionSolverStop`           | `solver`    | 그 풀이가 묶음을 풀지 못해 OpenCV 예외로 OpMode가 멈춤(error 바로 앞)                                                                                                                 |
| `visionMultipleAprilTag`     | (없음)      | 한 포털에 AprilTag 처리기가 둘 이상 켜져 있음                                                                                                                                         |
| `visionFrameCapture`         | `method`    | 프레임 저장은 영상이 없어 아무것도 하지 않음                                                                                                                                          |
| `visionResumeNullFormat`     | (없음)      | 스트림 형식 없이 `resumeStreaming`을 불러 STARTING_STREAM에 머뭄                                                                                                                      |
| `visionCalibrationSkipped`   | `detail`    | `teamwebcamcalibrations.xml`의 보정 하나를 SDK 규칙대로 버림(영어 한 줄)                                                                                                              |

값은 팀 파일·팀 코드의 글자를 담을 수 있어 런타임이 null을 `"null"`로 바꾸고 4096자(`MAX_NOTICE_CHARS`)로 자른다("…" 포함).

### 11.7 JSON 규칙(`Json.java`)

읽기: 객체 → `LinkedHashMap`(키 순서 유지, 같은 키는 마지막 값), 배열 → `ArrayList`, 소수점·지수가 없고 long에 들어가는 수는 Long, 아니면 Double(long을 넘는 정수도 Double: JavaScript Number와 같은 정밀도), `"-0"`은 Long 0, 중첩 깊이 ≤ 256(`MAX_DEPTH`). 쓰기: Map → 객체, List·배열 → 배열, 정수형 → 정수, Double·Float → 유한하면 Java의 가장 짧은 표기(`Double.toString`), **NaN·무한대는 null**(호스트가 장치 값의 null이 아닌 자리에서는 프로토콜 오류), 문자열은 `"`·`\`·제어 문자(U+0000–U+001F)를 이스케이프하고 짝이 없는 서로게이트도 `\uXXXX`로 쓴다. 출력에 줄바꿈 글자가 없다.

### 11.8 호스트 쪽 모양 확인(`src/main/sidecar/protocol.ts`)

사이드카는 우리가 빌드했지만 팀 코드가 같은 JVM에서 돌아 예상하지 못한 출력(네이티브 코드·JNI)이 섞일 수 있으므로 모든 모양을 확인하고 틀리면 `ProtocolError`로 실행을 끝낸다(`crashed`, detail "protocol error: …"). 장치 출력 값(`deviceValues`): 스칼라(null·boolean·string·유한 수)이거나 **유한 수 배열**(길이 `MAX_DEVICE_ARRAY` = 16까지, 복사해 둠). 그 밖은 `tick.outputs` 오류.

---

## 12. 메시지·텍스트·줄 한도 모음

| 항목                                                    | 값                                                                                                                                                                                                                                                 | 단위                         | 위치                                                                                                            | 비고                                                                                                                                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 호스트가 읽는 한 줄                                     | 4 194 304(4 · 1024 · 1024)                                                                                                                                                                                                                         | 글자                         | `protocol.ts` `MAX_LINE_CHARS`                                                                                  | 넘으면 `ProtocolError("line too long")`. 틱·텔레메트리·오류 스택이 가장 큰데 보통 수 KB(주석)                                                                                                                              |
| 사이드카가 읽는 한 줄                                   | 16 777 216(16 · 1024 · 1024)                                                                                                                                                                                                                       | 글자                         | `HostInput.MAX_LINE`                                                                                            | 넘으면 프로토콜 오류 "host message too long"                                                                                                                                                                               |
| 사이드카 로그 글자 하나(log 줄·오류 문장·텔레메트리 줄) | 65 536(64 · 1024)                                                                                                                                                                                                                                  | UTF-16 글자(붙이는 "…" 포함) | `Protocol.MAX_TEXT_CHARS`                                                                                       | 호스트의 log 한도와 같음. 서로게이트 짝을 가르지 않음                                                                                                                                                                      |
| 호스트 log 글자 하나                                    | 65 536                                                                                                                                                                                                                                             | 글자                         | `session.ts` `MAX_LOG_TEXT`                                                                                     | 넘으면 앞 65 536자 뒤에 "…"를 붙임(결과 65 537자. 사이드카의 자르기는 "…"를 포함해 65 536자)                                                                                                                               |
| 로그 줄 속도                                            | 가상 1초(정수 초 구간)에 500줄                                                                                                                                                                                                                     | 줄                           | `Protocol.MAX_LOG_LINES_PER_SECOND`                                                                             | 넘는 log는 버리고 다음 구간 첫 log·tick 앞이나 finished 앞에서 "… N lines dropped"를 한 번(그 구간 마지막으로 버린 줄의 stream) 보냄. 가상 시간 기준이라 결정적                                                            |
| 팀 출력 한 줄                                           | 64 KiB(65 536 바이트)                                                                                                                                                                                                                              | 바이트                       | `OutputCapture.MAX_LINE_BYTES`                                                                                  | 넘으면 끊음(UTF-8 글자 하나를 가르지 않음)                                                                                                                                                                                 |
| 텔레메트리 한 번(lines + log)                           | 524 288(512 · 1024)                                                                                                                                                                                                                                | 글자                         | `Protocol.MAX_FRAME_CHARS`                                                                                      | 줄마다 자르고(`MAX_TEXT_CHARS`), 줄 비용 = 길이 + 3(null이면 4)을 남은 글자 수에서 빼며 다 쓰면 그 뒤 줄을 버리고 `"…"` 한 줄을 둠. lines와 log가 같은 예산                                                                |
| 스택 프레임 수                                          | 100                                                                                                                                                                                                                                                | 개                           | `StackFrames.MAX_FRAMES`                                                                                        | 맨 위의 `org.sandbot.sim`·`org.sandbot.runtime` 프레임과 맨 아래의 런타임 프레임은 뺌                                                                                                                                      |
| 예외 설명의 원인 사슬                                   | 5                                                                                                                                                                                                                                                  | 개                           | `StackFrames.describe`                                                                                          |                                                                                                                                                                                                                            |
| 컴파일 오류·경고                                        | 각 100                                                                                                                                                                                                                                             | 개                           | `TeamCompiler.MAX_ERRORS`, `-Xmaxwarns 100`                                                                     |                                                                                                                                                                                                                            |
| notice params 수                                        | 16                                                                                                                                                                                                                                                 | 개                           | `protocol.ts` `MAX_NOTICE_PARAMS`                                                                               |                                                                                                                                                                                                                            |
| notice 글자                                             | 4 096                                                                                                                                                                                                                                              | 글자                         | `MAX_NOTICE_TEXT`(호스트), `Protocol.MAX_NOTICE_CHARS`(사이드카)                                                | 같은 값이어야 함. 넘으면 호스트가 프로토콜 오류                                                                                                                                                                            |
| 장치 출력 배열 길이                                     | 16                                                                                                                                                                                                                                                 | 개                           | `MAX_DEVICE_ARRAY`                                                                                              |                                                                                                                                                                                                                            |
| 등록기 OpMode                                           | 1 000개, 이름 1–200자(제어 문자 없음), group·transitionTarget 0–200자, 클래스 이름 1–1024자                                                                                                                                                        |                              | `MAX_REGISTERED_OPMODES`, `ListRunner.MAX_LISTED/MAX_NAME/MAX_CLASS_NAME`                                       | 넘으면 사이드카가 경고 로그를 남기고 뺌                                                                                                                                                                                    |
| Dashboard op 수 / 점 수 / data 키 / 글자 / log 줄       | 2 000 / 20 000 / 500 / 8 192 / 200                                                                                                                                                                                                                 | 개·글자                      | `src/shared/dashboard.ts` `MAX_DASH_OPS`·`MAX_DASH_POINTS`·`MAX_DASH_DATA`·`MAX_DASH_TEXT`·`MAX_DASH_LOG_LINES` | 넘으면 사이드카가 자르고 한 번 경고. 호스트에서 넘으면 프로토콜 오류                                                                                                                                                       |
| Dashboard 설정 트리                                     | 노드 5 000, 깊이 16                                                                                                                                                                                                                                |                              | `MAX_DASH_CONFIG_NODES`·`MAX_DASH_CONFIG_DEPTH`                                                                 |                                                                                                                                                                                                                            |
| Dashboard 패킷 버퍼                                     | `pendingTelemetry.size() > 100`이면 새 패킷을 버림(주석: 실제 `DashboardCore.sendTelemetryPacket`을 옮긴 것이고 원래의 "circular buffer가 낫겠다"는 TODO 주석이 남아 있음), 전송 간격 기본 100 ms(가상, `DEFAULT_TELEMETRY_TRANSMISSION_INTERVAL`) |                              | `sidecar/libs/dashboard/.../FtcDashboard.java`                                                                  | 사이드카의 Dashboard 대체                                                                                                                                                                                                  |
| 웹캠 태그                                               | 한 칸 9, 프레임당 64장                                                                                                                                                                                                                             |                              | `TAG_INPUT_STRIDE`, `MAX_TAG_DETECTIONS`                                                                        |                                                                                                                                                                                                                            |
| Config 값 바꾸기 대기                                   | 256                                                                                                                                                                                                                                                | 개                           | `session.ts` `MAX_PENDING_CONFIG`                                                                               | 넘으면 버림                                                                                                                                                                                                                |
| 한 실행의 simNotice                                     | 64                                                                                                                                                                                                                                                 | 개                           | `session.ts` `MAX_SIM_NOTICES`                                                                                  | 같은 code·params는 한 번                                                                                                                                                                                                   |
| 로그 묶음                                               | 500줄 또는 50 ms                                                                                                                                                                                                                                   |                              | `LOG_BATCH_MAX`, `LOG_FLUSH_MS`                                                                                 |                                                                                                                                                                                                                            |
| 세계 자세의 관절 수                                     | 16                                                                                                                                                                                                                                                 |                              | `worldSpec.ts` `MAX_WORLD_JOINTS`                                                                               | 넘으면 그 자세를 버림                                                                                                                                                                                                      |
| 공 표시 상태                                            | 공마다 정수 7칸 `[x, y, z, qw, qx, qy, qz] × 10⁴`(`GAME_POSE_STRIDE = 7`, `GAME_POSE_SCALE = 10⁴`), 표식 비트(1 잠듦 `ELEMENT_FLAG_ASLEEP`, 2 필드 밖 `ELEMENT_FLAG_OUT`)                                                                          |                              | `elements/gameState.ts`                                                                                         | 공 수는 실행의 첫 상태와 같아야 함                                                                                                                                                                                         |
| 링크 검사 경고                                          | 500개                                                                                                                                                                                                                                              | 개                           | `LinkCheck.MAX_WARNINGS`                                                                                        | 넘으면 거기서 멈춤(`linkReport`의 `warnings`)                                                                                                                                                                              |
| 컴파일 진단                                             | `compiled.diagnostics`는 오류 100·경고 100까지(`-Xmaxerrs 100`·`-Xmaxwarns 100`)                                                                                                                                                                   | 개                           | `TeamCompiler.MAX_ERRORS`                                                                                       | 호스트 `protocol.ts`는 진단 개수에 한도를 두지 않는다(줄 한도 4 MiB만)                                                                                                                                                     |
| 목록 요청 결과의 오류 수                                | 100                                                                                                                                                                                                                                                | 개                           | `listSession.ts` `MAX_ERRORS`                                                                                   | 등록기마다 하나라 보통 몇 개                                                                                                                                                                                               |
| 모의 저장소 경로 글자                                   | 4 096                                                                                                                                                                                                                                              | 글자                         | `simFiles.ts` `MAX_SIM_PATH`                                                                                    | `simFilePath`(`rrTuningSaved`의 상대 `path`): 빈 글자·4 096자 초과·NUL·역슬래시·`:`·절대 경로·빈 세그먼트·`.`·`..`이면 `null`(절대 경로 `file`을 더하지 않음). `revealSimFile`의 `file`: 절대 경로, 4 096자 이하, NUL 없음 |
| 허브 LED 패턴 단계                                      | 16                                                                                                                                                                                                                                                 | 단계                         | `LynxModule.MAX_LED_STEPS`(`getBlinkerPatternMaxLength`)                                                        | 실제 소스에서 출발한 손 구현(BSD 머리말)의 `Constants` 블록 값. 이 상수만의 출처 문구는 없음(출처 기록 없음)                                                                                                               |
| Dashboard `@Config` 후보 제외 접두어                    | `java`, `android`, `com.sun`, `com.vuforia`, `com.google`, `kotlin`                                                                                                                                                                                | 접두어 6개                   | `DashboardBridge.IGNORED_PREFIXES`                                                                              | 이 접두어 클래스는 `@Config` 후보로 읽지 않음(이름은 `@Config` 값 또는 단순 이름)                                                                                                                                          |
| 스택 프레임에서 빼는 런타임 프레임                      | 맨 위: `org.sandbot.sim.*`·`org.sandbot.runtime.*`·`Thread.getStackTrace`·`java.lang.Throwable` / 맨 아래: `org.sandbot.runtime.*`·`java.lang.Thread`·`jdk.internal.reflect.*`·`java.lang.reflect.*`·`java.lang.invoke.*`                          |                              | `StackFrames.isSimulatorFrame`·`isRuntimeBottom`                                                                | 위쪽은 `skipSimulatorTop`일 때만, 전부 런타임 프레임이면 자르지 않음                                                                                                                                                       |

---

## 13. 호스트 세션: 페이스·일시 정지·Step·종료

### 13.1 상태

`SidecarSession`: `preparing` ─(hello)→ `compiling` ─(state init)→ `init` ─(state running)→ `running` ─(state stopping)→ `stopping` ─(finished)→ `finished`. 사이드카가 보내는 `state`가 단계를 정한다. 어느 단계에서든 `finished`·프로세스 종료로 `finished`가 된다. START는 `phase == init ∧ ¬startQueued ∧ ¬stopRequested`일 때만 받는다(일시 정지 중이면 일시 정지를 푼다). STOP은 일시 정지를 푼다. `preparing`·`compiling`의 STOP은 `shutdown`을 보낸다.

### 13.2 페이스(실행 속도)

틱 k(가상 `tNanos`)에 답하는 벽시계 시각:

```
due(ms) = anchor.wall + (tick.tNanos − anchor.virt) / (10⁶ · speed)
```

- 기준점 `anchor = {wall, virt}`: 첫 틱, 속도를 바꿀 때(`setSpeed` → `reanchor`), 일시 정지를 풀 때 다시 잡는다(`reanchor`: `{wall: now, virt: lastRepliedNanos}`). 그동안 흐른 실제 시간을 따라잡지 않는다.
- `due ≤ now`(늦음)이면 바로 답한다. `now − due > MAX_LAG_MS`(100 ms)이면 그 틱에서 기준점을 `{now, tick.tNanos}`로 다시 잡는다(긴 GC·느린 init 뒤에 빨리 감기처럼 몰아서 돌지 않게. 주석: Unity의 Maximum Allowed Timestep과 같은 생각).
- `speed == 'max'`이면 기다리지 않고 바로 답한다.
- 속도 선택지(`PLAY_SPEEDS`): 0.25, 0.5, 1, 2, 4, `'max'`. `isValidSpeed`: 유한한 양수 또는 `'max'`. 기본 1.

### 13.3 일시 정지·Step

- 일시 정지: 받은 틱에 답하지 않고 둔다(사이드카는 그 틱 경계에서 멈춰 있음). 멈출 때 `poseThrottle.flush()`로 멈춘 자리(둔 틱의 자세·공)를 바로 보인다.
- Step(일시 정지 중에만): `step = {baseLoops, deadline}`, `deadline = from + STEP_MAX_NANOS`(1 000 000 000 ns = 가상 1 s, `from`은 둔 틱·마지막 답한 틱·최신 시각 순). 둔 틱에 답하고 그 뒤 틱은 바로 답하다가 `tick.loops > baseLoops`인 틱 또는 `tick.tNanos ≥ deadline`인 틱에서 다시 멈춘다. Step의 단위는 틱 경계다(틱 5 ms보다 짧은 루프는 한 틱 안에서 여러 번 돌 수 있음).
- 렌더러 단축키 Ctrl+P(실행 버튼)·Ctrl+Shift+P(일시 정지)·Ctrl+Alt+P(Step)는 Unity와 같다(CLAUDE.md).

### 13.4 START·STOP·Autonomous 자동 정지

- START·STOP은 다음 `tickReply.events`에 싣는다. `startNanos` = START를 실은 틱의 `tNanos`.
- Autonomous: `flavor == 'Autonomous' ∧ autoStopAutonomous ∧ startNanos ≠ null ∧ tick.tNanos − startNanos ≥ 30 · 10⁹` ns(`AUTONOMOUS_SECONDS = 30`)인 틱의 답에 STOP을 싣는다(일시 정지는 풀지 않음).
- STOP 뒤 kill 시간: `stopKillMs` 5000 ms(실제). 일시 정지로 틱을 두고 있는 동안은 세지 않는다(`holding = paused ∧ pending ≠ null ∧ step == null`). 안에 `finished`가 없으면 JVM을 끝낸다(`killed`, `stopTimeout`). stall 오류를 받은 뒤 STOP이면 바로 `killNow('stalled')`.

### 13.5 세계(시뮬레이터) 단계

틱이 **도착할 때** `world.step(tNanos, outputs)`를 부르고 돌려받은 입력을 `pendingInputs`(다음 답에 실음, 답 없이 넘긴 틱의 입력은 합침)와 `inputState`(누적, devices 이벤트)에 모은다. 그래서 답을 늦추거나(속도·일시 정지) 답하지 못한 틱(끝)도 적분은 틱 순서대로 한 번씩 결정적으로 하고, 일시 정지 중의 자세는 둔 틱의 것이다. 세계의 예외는 실행을 멈추지 않는다: simNotice `worldError`(detail)를 한 번 보내고 사이드카는 이전 입력을 계속 쓴다. 끝나면(`finished`·프로세스 종료, 받은 틱이 있을 때) 마지막 틱의 출력으로 한 틱(`tickNanos`) 더 돌린다(`settleWorld`): 세계는 [앞 틱, 이 틱] 구간을 앞 틱의 출력으로 적분하므로, 사이드카 finish의 마지막 tick(STOP fail safe 뒤 출력)은 다음 틱이 와야 입력에 보이는데 끝난 실행에는 다음 틱이 없다. 그러지 않으면 장치 탭에 `enabled = false`, `power = 0` 옆에 STOP 전 명령으로 잰 입력(모터 전류 등)이 남는다. 답은 보내지 않고 `latestNanos`도 옮기지 않는다(끝 시각은 사이드카의 것).

세계가 소비하는 입력/출력 해석: 출력 키 해석은 `readMotorOutputs`(모양이 틀리면 꺼진 모터), 사용하는 입력 키는 §9.2. 세계(`PhysicsWorld.step`): `dt = tNanos − tPrev`(첫 호출은 0), 이전 틱 출력으로 `[tPrev, tNanos]`를 하위 단계로 적분(`SUBSTEP_NANOS = 1 000 000` = 1 ms, 0 ns부터의 절대 격자와 구간 끝에서 끊음, 한 번에 `MAX_SUBSTEPS = 10 000`을 넘지 않게 격자를 10배씩 넓힘, 허브 제어 표본 10 ms는 이 격자 위), 그 틱 경계에서 입력을 만든다. 하위 단계의 물리는 `motors-joints.md`·`drivetrain.md`·`collision.md`가 맡는다.

### 13.6 렌더러 이벤트의 빈도

| 이벤트               | 간격·규칙                                                                                                                                                                                                                                                | 상수                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`             | 100 ms마다와 바뀔 때(`realtime`·일시 정지·속도·`startedNanos`)                                                                                                                                                                                           | `STATUS_INTERVAL_MS = 100`                                                                                                                     |
| `telemetry`          | 최신만, 34 ms 이하 간격(≈ 30 Hz). STOP 뒤(`stopping`·`finished`)에 온 프레임은 버려 STOP 전 마지막 프레임이 남는다(실제 DS는 곧 "Robot is stopped"로 바꾸고 끊긴 스레드의 하드웨어 읽기는 자리값이라 마지막 화면이 0으로 남으면 위치를 잃은 것처럼 보임) | `TELEMETRY_INTERVAL_MS = 34`                                                                                                                   |
| `dash`·`dashConfig`  | 같은 34 ms throttle(묶음 사이도 사이드카와 같은 규칙으로 합침)                                                                                                                                                                                           |                                                                                                                                                |
| `devices`            | 20 Hz, 바뀔 때(출력과 누적 입력의 JSON 키로 비교)                                                                                                                                                                                                        | `DEVICES_INTERVAL_MS = 50`                                                                                                                     |
| `pose` + `gameState` | 같은 throttle 하나로 약 60 Hz(16 ms), 일시 정지·Step 멈춤·끝에 바로                                                                                                                                                                                      | `POSE_INTERVAL_MS = 16`. 따로 두면 공이 쉬다 움직이기 시작할 때 gameState만 새 박자로 나가 실려 가는 공이 로봇과 다른 틱으로 그려졌다(6a 리뷰) |
| `log`                | 50 ms 묶음 또는 500줄                                                                                                                                                                                                                                    | `LOG_FLUSH_MS`, `LOG_BATCH_MAX`                                                                                                                |
| `simNotice`          | 같은 code·params는 한 번, 실행당 64개까지                                                                                                                                                                                                                | `MAX_SIM_NOTICES`                                                                                                                              |

`realtime`(최근 실제 속도, 가상 ÷ 실제): 샘플을 20 ms 간격(`SAMPLE_GAP_MS`)으로 쌓고 1000 ms(`REALTIME_WINDOW_MS`)보다 오래된 것을 버린다(하나는 남김). 잴 만큼 쌓이지 않았으면(`span < 200 ms`, `REALTIME_MIN_SPAN_MS`) 설정한 속도(`'max'`면 0), 일시 정지 중이면 0, 아니면 `round((lastRepliedNanos − first.virt) / 10⁶ / span · 1000) / 1000`.

### 13.7 호스트 타임아웃(`DEFAULT_TIMEOUTS`)

| 항목                                     | 값(ms, 실제)        | 의미                                                                                          |
| ---------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `stopKillMs`                             | 5 000               | STOP 뒤 이 안에 `finished`가 없으면 JVM을 끝냄                                                |
| `shutdownGraceMs`                        | 1 000               | `shutdown`(창 닫기·앱 종료·다른 실행) 뒤 기다리는 시간                                        |
| `exitAfterFinishedMs`                    | 2 000               | `finished` 뒤 프로세스가 스스로 끝나기를 기다리는 시간(사이드카는 `Runtime.halt`로 바로 끝남) |
| `helloMs`                                | 30 000              | JVM이 `hello`를 보내기까지                                                                    |
| 앱 종료 시 사이드카 정리 대기            | 3 000               | `index.ts` `QUIT_WAIT_MS`                                                                     |
| 등록기 목록 요청의 `helloMs`             | 30 000              | `listSession.ts` `DEFAULT_LIST_TIMEOUTS`                                                      | 실행 요청과 같은 값                                                                                                               |
| 등록기 목록 요청의 `totalMs`             | 120 000             | 같음                                                                                          | 요청을 보낸 뒤 `finished`까지(컴파일 포함). 넘으면 "listing did not finish in 120 s"로 실패                                       |
| 등록기 목록 요청의 `exitAfterFinishedMs` | 2 000               | 같음                                                                                          |                                                                                                                                   |
| 사이드카 작업 폴더 청소                  | 24 h(86 400 000 ms) | `index.ts` `STALE_RUN_MS`                                                                     | `userData/sidecar-run/run-*`(실행마다 빈 폴더를 만들고 끝나면 지움). 비정상 종료로 남은 것은 앱이 시작할 때 하루가 지난 것만 지움 |

stderr: 끝 30줄(`STDERR_TAIL_LINES`)만 모으고 줄당 2000자(`DETAIL_LIMIT`)로 자르며, `Picked up JAVA_TOOL_OPTIONS:`류 JVM 안내 줄은 뺀다. `crashed`의 detail은 머리줄(종료 코드·신호·"truncated output"·프로토콜 오류) + stderr 끝부분이고, 2000자를 넘으면 맨 앞에 "…"를 붙여 뒤쪽 2000자만 남긴다(`detail`).

### 13.8 렌더러로 가는 simNotice 코드(`src/shared/play.ts` `SimNoticeCode`)

`simNotice` 이벤트는 `{runId, tNanos, code, params}`이고 Console 경고 한 줄로 번역된다. 같은 code·params는 실행마다 한 번이고 한 실행에 64개까지다(`MAX_SIM_NOTICES`). 사이드카의 notice 11개(§11.6)가 그대로 이 목록에 들어오고(`rrTuningSaved`는 호스트가 `file`을 더할 수 있음), 호스트·시뮬레이터가 만드는 것은 아래다(뜻은 `play.ts` 주석, 물리 값은 해당 기준 문서).

| code                   | params           | 뜻                                                                                                                                                                                                                                       |
| ---------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharedEncoderMode`    | `device`         | 데드휠과 포트를 함께 쓰는 모터를 엔코더 모드로 돌림(실제로는 포드 엔코더로 제어되지만 시뮬레이터는 축 엔코더로 제어한다고 가정)                                                                                                          |
| `worldError`           | `detail`         | 시뮬레이터 계산 중 오류(이전 센서 값을 계속 보냄). 몸체 충돌의 비유한 행은 `collision <짝 토큰>`(예 `collision j1k0/w3`)이고 그 짝의 행만 빠진다                                                                                         |
| `tipping`              | 없음             | 바닥이 받쳐야 할 모멘트가 바퀴 접점 밖(넘어질 상황, 시뮬레이터는 넘어지지 않음)                                                                                                                                                          |
| `wheelLift`            | 없음             | 바퀴 하나 이상이 하중 0(뜸)인 채 0.1 s 넘게 이어짐                                                                                                                                                                                       |
| `collisionOverlap`     | `body`, `target` | 몸체 충돌 짝의 겹침이 실행 시작(t = 0) 겹침보다 1 mm 넘게 깊어짐(실행마다 첫 짝 한 번). `body`는 `'-1'`(섀시) 또는 세계 설명 관절 순번, `target`은 `wall:x+`·`wall:x-`·`wall:y+`·`wall:y-`·`structure:<순번>`·`floor`·`body:<몸체 번호>` |
| `collisionLimit`       | 없음             | 한 하위 단계의 충돌 행이 한도를 넘어 일부 짝을 뺌                                                                                                                                                                                        |
| `collisionLift`        | 없음             | 메커니즘이 로봇 무게보다 세게 바닥·벽 윗면을 누른 상태가 0.1 s 이어짐                                                                                                                                                                    |
| `elementOutOfField`    | `kind`           | 공이 필드 밖으로 나가 물리에서 뺌(`kind`는 `pollen`·`nectarRed`·`nectarBlue`)                                                                                                                                                            |
| `elementReentered`     | `kind`           | 경기 요원이 나간 공을 가까운 LOADING ZONE에 다시 넣음                                                                                                                                                                                    |
| `elementCrushed`       | 없음             | 공이 딱딱한 심 깊이까지 눌림(그 접촉은 강체로 풂)                                                                                                                                                                                        |
| `elementCouplingLimit` | 없음             | 로봇에 닿은 공 행이 결합 한도를 넘어 일부 공을 한쪽으로만 풂                                                                                                                                                                             |
| `elementIslandLarge`   | 없음             | 공 더미가 커서 근사 반복(PGS)으로 풂                                                                                                                                                                                                     |

0.1 s는 `play.ts` 주석의 값이고 상수는 시뮬레이터 쪽(`SUPPORT_NOTICE_DELAY`)이다.

---

## 14. 감시(Watchdog)와 stall

250 ms(`PERIOD_MILLIS`)마다 OpMode 스레드를 본다.

- 호스트 답을 기다리지 않는데(`waitingHost == false`) `stallMillis`(실제 ms, 기본 `DEFAULT_STALL_MILLIS = 2000`) 동안 `peekNanos()`(가상 시간)가 바뀌지 않으면 error `stall`(그 스레드의 스택)을 한 번 보낸다. 시계를 부르기만 하고 시간을 보내지 않는 루프(비용 없는 시계 읽기, 비용을 0으로 덮어쓴 청구)도 멈춘 것이다: 틱 경계에 닿지 못해 STOP이 적용되지 않는다. 다시 시간이 흐르면 초기화(다시 멈추면 또 알림). 호스트를 기다리는 동안(일시 정지)은 세지 않는다. 가상 시간의 진행을 보는 것이지 시계 호출 수가 아니다.
- 다른 스레드가 시계를 써서 OpMode를 멈추라고 했는데(`fatalMessage`) OpMode 스레드가 2초(실제, `FATAL_GRACE_NANOS`) 안에 끝나지 않으면 `forceFinish("exception")`.
- 목록 요청(틱 교환 없음)은 멈추면 기다릴 호스트 STOP이 없으므로 stall을 알린 뒤 바로 끝낸다(finished `exception`).
- 벽시계는 여기서만 쓴다(팀 코드·프로토콜의 시간에는 들어가지 않는다).

호스트 쪽: error `stall`을 받으면 `stalled = true`이고 STOP이 이미 요청되었다면 바로 kill한다. 다음 `tick`이 오면 stall이 풀린다.

---

## 15. 실행 설정과 요청 검증

### 15.1 개인 실행 설정(`PlaySettings`, 렌더러 localStorage `sandbot:playSettings`)

| 키                   | 기본                              | 범위·검증                                                                                         | 위치                                          |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `speed`              | 1                                 | `PLAY_SPEEDS` 중 하나                                                                             | `playSettings.ts`                             |
| `jitter`             | 0                                 | [0, 0.5](렌더러), [0, 1)(메인·사이드카)                                                           | §4.2                                          |
| `seed`               | 1                                 | 정수 ±(2³¹ − 1)                                                                                   | §4.2                                          |
| `autoStopAutonomous` | true                              | boolean                                                                                           | Autonomous는 DS처럼 START 뒤 30 s에 자동 정지 |
| `batteryVoltage`     | 12.5 V(`DEFAULT_BATTERY_VOLTAGE`) | [9, 14.5] V(`MIN_BATTERY_VOLTAGE`·`MAX_BATTERY_VOLTAGE`), 밖이면 기본값(렌더러) / 요청 거부(메인) | `src/shared/play.ts`                          |

렌더러 전용 `hiveState`·`sensorNoise`·`gameElements`는 `runSettings`가 빼고 공유 다섯 키만 보낸다. 사이드카 기본 배터리 전압 12.5 V(`SimHub.DEFAULT_BATTERY_VOLTS`)와 `DEFAULT_BATTERY_VOLTAGE`는 같아야 한다(주석). 모터 무부하 속도는 `전압 ÷ 12`로 환산된다(`NOMINAL_VOLTAGE = 12`, `motorOutputs.ts`: 형식의 maxRPM은 12 V 무부하 값). 배터리 전압의 9–14.5 V 범위의 출처 기록 없음.

### 15.2 요청 검증(`launch.ts` `validateRequest`)

렌더러가 보낸 `PlayInitRequest`는 믿지 않는 입력이다. `runId`는 `^[A-Za-z0-9_-]{1,64}$`, `configHash`는 14자리 16진수(`^[0-9a-f]{14}$`, `generatedFiles.ts` cyrb53), 구성 경로는 `res/xml/sandbot_*.xml`의 허용 규칙을 만족하고 `configHash`가 있으면 `configPath`도 있어야 한다. `settings`는 §15.1을 확인하고, `world`는 `parseWorldSpec`(모양·유한 수·한도·이름 참조)을 통과해야 한다(틀리면 `world: …`로 거부). OpMode 이름(`registeredName`)은 1–200자·제어 문자 없음. 팀 웹캠 보정 파일 한도 `MAX_TEAM_CALIBRATIONS_BYTES = 256 · 1024`(링크를 푼 위치도 TeamCode 안의 보통 파일일 때만 `teamCalibrations`로 넘김).

### 15.3 `RunRequest` 기본값(`buildRunRequest`)

`clock: 'virtual'`, `tickNanos: 5 000 000`, `timing: {}`, `jitter`·`seed`는 설정 그대로, `startEpochMillis: Date.now()`, `stallMillis: 2000`. 배터리 전압·속도·`autoStopAutonomous`는 사이드카가 아니라 호스트(세계·세션)가 쓴다. `teamCalibrations`는 `prepareRun`이 확인한 경로 또는 null.

---

## 16. 설계 결정·Unity 대응·임시 편차

| 결정                                                                                         | 이유·근거                                                                                                                                              | 표기                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| 가상 시계 + Hub 타이밍(Unity의 FixedUpdate처럼)                                              | 팀 코드가 보는 시간은 사이드카가 정하고, 하드웨어 호출마다 비용표만큼 흐른다. PC 성능과 관계없이 실제 로봇과 비슷한 루프 시간이 나오고 결정적이다      | CLAUDE.md 설계 결정 |
| 실시간 실행은 구현하지 않고 길만 열어 둠                                                     | `SimClock` 인터페이스와 `RunRequest.clock` 값만 더하면 가짜 SDK·패처·프로토콜은 바뀌지 않는다                                                          | CLAUDE.md           |
| 포트·서버 없이 stdio JSON 줄로 통신                                                          | 팀 코드의 `System.out`이 섞여도 보호하려고 stdout은 프로토콜 전용, 팀 출력은 `log`로 감쌈                                                              | CLAUDE.md           |
| JDK는 번들하지 않고 찾는다(환경 설정 → Android Studio `jbr` → `JAVA_HOME` → `PATH`, 17 이상) | 없으면 안내                                                                                                                                            | CLAUDE.md           |
| 1단계는 OpMode 스레드 하나만 시계·하드웨어를 씀                                              | 다른 스레드가 쓰면 error `thread`로 알리고 실행을 멈춘다. 여러 스레드는 라이브러리 단계의 스케줄러로(미구현). 비전은 스레드 없이 틱 경계 듣기에서 처리 | CLAUDE.md           |
| 같은 입력 → 바이트 단위로 같은 메시지(시드가 같으면 오차도 같음)                             | 벽시계·HashMap 순서가 프로토콜 메시지에 들어가면 안 됨 → 패처가 해시 순서 컬렉션을 삽입 순서 구현으로 바꿈                                             | CLAUDE.md           |
| 틱 = 이벤트 루프 한 바퀴, 시계 호출 안에서 처리                                              | 이벤트 루프 스레드를 따로 두지 않고 OpMode 스레드가 시계 호출 안에서 호스트와 틱을 주고받아 DS 사건·게임패드·센서 값을 적용                            | CLAUDE.md           |
| STOP·fail safe는 실제 `callActiveOpModeStop` 순서, 위험한 명령은 막음                        | 실제 SDK의 `preventDangerousHardwareAccess`와 같은 상태(정적 필드 하나)                                                                                | CLAUDE.md, 주석     |
| 끊긴 스레드의 허브 명령은 보내지 않고 CLOCK_READ만 청구                                      | STOP을 무시하고 하드웨어만 부르는 루프도 가상 시간이 흘러 `stuckInStop`으로 끝남                                                                       | 주석                |
| LastKnown 적중도 CLOCK_READ 청구                                                             | 캐시로만 답하는 루프도 가상 시간이 흘러 START·STOP이 적용되고 신선도가 지나 다시 보냄                                                                  | 주석                |
| STOP이 명령 비용 안에 떨어지면 fail safe가 마지막                                            | 실제는 진행 중이던 명령이 먼저 허브에 가고 fail safe가 잠금을 기다려 그 뒤에 감                                                                        | 주석                |
| 가짜 SDK는 세 층(손 구현 > 들여온 실제 클래스 > stub)이고 실제 SDK 12.0의 API 표면을 따름    | 같은 소스가 Android Studio와 사이드카에서 수정 없이 컴파일돼야 함(`ApiCheck`가 빌드를 막음)                                                            | CLAUDE.md           |
| 프로토콜 버전을 sidecar.json·hello·RunRequest가 정확히 같은 판으로                           | 어긋나면 실행하지 않음                                                                                                                                 | CLAUDE.md           |
| 사이드카는 TeamCode에 쓰지 않음(javax.tools로 메모리에 컴파일)                               |                                                                                                                                                        | CLAUDE.md           |
| 팀 코드는 Android Studio처럼 Java 8 문법·compileSdk의 Android API로 컴파일                   | SDK가 없으면 실행하지 않고 안내                                                                                                                        | CLAUDE.md           |
| 프로젝트 코드는 사용자가 동의한 뒤에만 실행                                                  | INIT(사용자가 누름)과 등록기 OpMode 목록. 동의는 프로젝트마다 `userData/code-trust.json`                                                               | CLAUDE.md           |
| 센서 값은 실제 장치 규약(축·부호·단위)을 따름                                                | Pinpoint X 앞·Y 왼쪽·mm·heading 감지 않음, OTOS는 SDK 샘플 축, IMU 요는 시작 대비 반시계 +로 감음, 데드휠·포드 `reversed`는 DcMotor 방향 전 원시 값    | CLAUDE.md           |

Unity 대응(CLAUDE.md의 비유): Unity FixedUpdate ↔ 가상 시계·틱 경계, Unity `Time.timeScale`·Pause·Step ↔ 호스트 페이스·일시 정지·Step, Unity Maximum Allowed Timestep ↔ `MAX_LAG_MS`(100 ms), Unity Console ↔ Console(`log`·`error`). 이 영역의 코드 주석·CLAUDE.md에는 "임시 편차"라고 적은 항목이 없다(Autonomous 30초 자동 정지는 DS 동작을 따른 설정이고 환경 설정에서 끌 수 있다).

---

## 17. 원본 조사 자료 상태

이 영역의 조사·명세 문서는 저장소 밖 작업 폴더(scratchpad)에 있었고 git에 들어가지 않아 사라졌다. 코드·CLAUDE.md·`docs/assumptions.md`가 인용하는 아래 자료는 이 저장소에서 읽을 수 없다.

| 사라진 자료(주석이 인용하는 이름)                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 이 문서에서 거기에 기댄 것                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 사이드카 1단계 명세(`spec §2.3` 시간 API 패처, `spec §2.4`·`§2.5` 가상 시계·틱 경계, `spec §R-1` 진입점 흐름, `spec §R-7` 감시), 라이브러리 L1 명세(`§D-3` 결정성 패처)                                                                                                                                                                                                                                                                                                                 | §2·§3의 설계 이유 중 절 번호가 붙은 것, 틱 길이 5 ms·stall 2000 ms의 근거                                                                                                                                       |
| 4d 비전 명세(`spec-4d §0`, `§1.5`·`§1.8`·`§1.9`·`§1.10`·`§1.12`·`§1.13`·`§1.14`, `§3.2`)                                                                                                                                                                                                                                                                                                                                                                                                | 경계 듣기, 비상 정지, `tags` 입력, notice 규칙의 절 번호                                                                                                                                                        |
| 6a 공 물리 명세(`spec-6a §5`)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `gameState` 이벤트의 모양                                                                                                                                                                                       |
| 허브 타이밍의 측정 자료                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 없음. 기본 비용표는 처음부터 "FTC 커뮤니티 근사치"로 적혀 있고 측정 기록이 없다                                                                                                                                 |
| 데이터시트·소스 원문: gm0 "Bulk Reads"(하드웨어 호출 하나 약 2–3 ms), FTC SDK 12.0 `LynxModule`·`LynxDcMotorController`·`LynxServoController`·`LynxDigitalChannelController`·`LynxAnalogInputController`·`LastKnown`·`OpModeManagerImpl`·`OpModeInternal`·`LinearOpMode`·`BNO055IMUImpl`, FtcRobotController 이슈 #913·#1345, SDK 6.0 릴리스 노트, SDK 10.1.1·10.2의 `initializeHardware` 순서(코드 주석은 버전과 순서만 적고 릴리스 노트라고 하지 않음), BNO055 데이터시트(POR 650 ms) | 주석의 인용. SDK 소스는 `pnpm fetch:ftc-sdk`가 받는 해시 고정 자료에 있으므로 다시 확인할 수 있지만(손 구현은 실제 소스에서 출발해 `// SandBot:` 줄을 둠), gm0·이슈·릴리스 노트·데이터시트 원문은 저장소에 없다 |

따라서 다음은 이 문서에서 일차 출처까지 추적되지 않는다.

- Hub 타이밍 기본 비용표의 아홉 숫자(1.5/2.5/2.0/3.0/2.5/3.5/0.001/0.005/0.2 ms). 코드·assumptions.md 모두 "근사치, 실측 필요"로 적었고 숫자별 근거는 없다. 특히 Expansion Hub가 Control Hub보다 1.0 ms(명령)·1.0 ms(bulk)·1.0 ms(I2C) 더 든다는 차이의 출처 기록 없음.
- 틱 길이 5 ms, stall 2000 ms, 호스트 kill 5000 ms, 호스트 throttle 간격(34·50·16·100 ms)의 값 선택 근거 기록 없음.
- 허브 기본 PIDF `[10, 3, 0, 0]`·`[10, 0.05, 0, 0]`: Core Hex 형식 주석을 옮긴 [가정].
- fail safe가 모드·목표 위치를 지우지 않는다는 규칙: 이슈 번호와 SDK 순서 변경(10.1.1 → 10.2)에서 추론한 [가정: 펌웨어 추론].
- 모든 `[확인]`에 가까운 서술(실제 SDK의 동작을 옮겼다는 주석)은 이 세션에서 SDK 소스를 다시 대조하지 않았다.
- 프로토콜 판 1·2·3의 변경 목록 세부.

저장소에 남아 있는 관련 자료: `docs/assumptions.md`("사이드카: 시간·장치" 표), CLAUDE.md(설계 결정과 불변 조건), 코드 주석, `sidecar/sdk/org/sandbot/sdk/devices/package-info.java`, 시험(`HubCostTest`, `DeviceBehaviorTest`, `sidecar/tests/runtime.test.ts`·`sim.test.ts`·`devices.test.ts`, 호스트 `session.test.ts`·`protocol.test.ts`·`launch.test.ts`).

---

## 18. 알려진 한계·남은 일

- **Hub 타이밍 비용표는 실측이 아니다**(근사). 루프 시간이 실제 로봇과 다를 수 있다. 팀 칸으로 덮어쓸 수 있는 경로(`RunRequest.timing`)는 프로토콜·사이드카에 있지만 앱은 늘 `{}`를 보내고 환경 설정에 비용표 칸이 없다(오차·시드 칸만 있음).
- **오차(jitter)는 비용마다 균등 분포**이고 기본은 끔이다. 실제 루프 시간 분포(최소·최대)로 정한 값이 아니다.
- **허브 명령 비용이 SDK 안의 일을 포함한다고 봄**: LastKnown 캐시가 답하지 못하는 경로의 시계 읽기·내부 일은 따로 청구하지 않는다.
- **STOP은 틱 경계에서만 온다**: 실제의 `stopRequested`와 끊기 사이의 경쟁 창은 없다(한 경계에서 fail safe → stopRequested → 끊기). 명령 비용 안에 STOP이 떨어지는 경우는 §8.6의 규칙으로 흉내 낸다. 진행 중이던 호출의 뒤따르는 명령은 실제에서는 잠금 순서에 따라 fail safe 앞에 갈 수도 있다.
- **목표 위치의 수명은 실행 하나**(실제는 허브 전원을 끌 때까지).
- **IMU 초기화 도중에 끊기면** 남은 트랜잭션은 자리값이고 초기화는 실패로 보며 실제의 단계별 기다림·로그는 흉내 내지 않는다. 초기화 실패 로그의 클래스 이름은 SandBot 클래스다(`SimImu` 등).
- **결정성 밖**: `new Date()`, 시간 없는 `wait()`·`join()`, JDK 동시성 도구의 시간 제한 대기, `Math.random`, JDK 안에서 만드는 `HashMap`, `IdentityHashMap`·`WeakHashMap`·`ConcurrentHashMap`·`Hashtable`, `Object.hashCode`·기본 `toString`. 클래스패스가 userData 절대 경로라 결정성은 한 PC 안에서만이다. `System.currentTimeMillis`의 절댓값은 `startEpochMillis`(= 실행 요청을 만든 벽시계)라 실행마다 다르다(차이는 결정적). `compiled.millis`는 벽시계 측정값이다.
- **한 스레드만**: 팀 코드가 스레드를 만들어 하드웨어·시계를 쓰면 error `thread`로 끝난다(FTCLib 낡은 `command.old.CommandOpMode` 등). 여러 스레드 지원은 라이브러리 단계의 스케줄러로 남아 있다.
- **프로토콜 한도**: 호스트가 읽는 줄 4 MiB, 텔레메트리 한 번 512 K글자, log 줄은 가상 1초당 500줄이다. 큰 `tags`·긴 텔레메트리는 잘릴 수 있다.
- **STOP 뒤 텔레메트리**는 호스트가 버려 STOP 전 마지막 프레임이 남는다(실제 DS는 곧 "Robot is stopped"로 바꿈).
- **Dashboard 패킷 버퍼 100개**를 넘는 패킷은 버려진다(실제 구현의 TODO 주석과 같은 동작).
- 코드가 적은 한계 목록의 나머지(센서 칩·비전·충돌·공 물리)는 각 기준 문서(`sensors-vision.md` 등)가 맡는다.

---

## 19. 시험이 고정한 값

| 시험                                                                                           | 고정한 값                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidecar/tests/java/org/sandbot/sdk/devices/HubCostTest.java`                                  | Control 명령 1.5·bulk 2.0·I2C 2.5 ms, Expansion 2.5·3.0·3.5 ms. `setPower` 처음 3 × 1.5 + HIT, 다른 power 1.5 + 3 × HIT, 500 ms 뒤 다시 3 × 1.5 + HIT. `setTargetPosition` 늘 1.5. PIDF 2 × 1.5 → 1.5 → `getPIDCoefficients` F 0이면 1.5, 아니면 2 × 1.5. OFF 엔코더 1.5·속도 2.0·디지털 1.5 + HIT·아날로그 1.5·배터리 1.5. AUTO/MANUAL 첫 읽기 2.0, AUTO 반복 읽기 새 bulk read 2.0. 서보 처음 2 × 1.5, 다른 위치 1.5 + HIT. 디지털 출력 1.5 + HIT(같은 값도 늘 보냄). BHI260AP `initialize` 13 × 2.5, BNO055 `initialize` 18 × 3.5 + 40(Expansion), 옛 BNO055IMU `initialize` 24 × 3.5 + 780(Expansion), Pinpoint `update` 2 × 2.5 → 2.5, `setOffsets` 2 × 2.5, VL53L0X 새 측정 3 × 2.5 |
| 같은 파일 `testLastKnownHitsAdvanceTheClock`                                                   | 캐시 적중만 500 ms 부르면 낡아 다시 3 × 1.5 + HIT 전송, 다시 보내는 시점은 500 ms 초과 500 ms + 2 × HIT 이하                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sidecar/tests/runtime.test.ts`, `sim.test.ts`, `devices.test.ts`                              | 런타임 흐름·STOP·stuckInStop·stall·결정성(같은 입력 → 같은 출력 바이트), 가짜 SDK의 장치 동작                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/main/sidecar/session.test.ts`, `protocol.test.ts`, `launch.test.ts`, `controller.test.ts` | 페이스·일시 정지·Step·START/STOP·kill·simNotice·게임패드 sanitize, 프로토콜 모양·한도·notice 키, 요청 검증·JVM 인자                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/renderer/src/play/playSettings.test.ts`                                                   | 설정 읽기·자르기(jitter 0..0.5, 배터리 9..14.5, seed 범위)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/shared/sim/worldGolden.test.ts`                                                           | 세계 기준 해시(틱 순서·입력 바이트): 사이드카 출력열이 같으면 입력열이 바이트 단위로 같다                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
