/**
 * 가짜 SDK의 장치 연결: 구성 XML → hardwareMap, 허브(Lynx)·장치 시뮬레이션, 허브 비용.
 *
 * <h2>런타임과의 접점</h2>
 * {@link org.sandbot.sdk.devices.SandbotHardware}: {@code create(File)}(구성 XML, null이면 빈 맵; 틀리면
 * {@link org.sandbot.sdk.devices.SandbotConfigException}, 영어 메시지), {@code beforeInit(map)}(실제
 * OpModeManagerImpl.resetHardwareForOpMode: 허브 → 컨트롤러 → 장치 순으로 resetDeviceConfigurationForOpMode, 그 뒤부터 비용 청구),
 * {@code stopRequested(map)}(STOP을 받았을 때, OpMode에 알리기 전: 허브마다 fail safe, 그 뒤 OpMode가 끝날 때까지 위험한 명령 —
 * 0이 아닌 모터 power·속도, 목표 위치, 서보 펄스·PWM 켜기 — 은 보내지 않는다. 실제 OpModeManagerImpl.callActiveOpModeStop과
 * preventDangerousHardwareAccess. fail safe는 모터를 멈추고 끌 뿐 모드·목표 위치를 지우지 않으므로(펌웨어 추론,
 * SimDcMotorController.Channel.targetPositionSet) STOP 뒤 RUN_TO_POSITION 모터에 setPower(0)을 해도 던지지 않는다),
 * {@code afterStop(map)}(비용 청구를 끄고 허브마다 fail safe: 모터 멈춤·끔, 서보 PWM 끔).
 *
 * <h2>시뮬레이터 장치(SimDevice)</h2>
 * 구성 이름마다 하나({@code Sim.devices()}, 구성에 넣은 순서). 출력은 가짜 SDK가 허브에 보낸 명령의 결과(허브 펌웨어가 보는 값)이고,
 * 입력은 시뮬레이터가 넣는 측정값이다. 물리는 없다. 단위는 따로 적지 않으면 SI(m, rad, s, V, A)다.
 * 허브 모터 값은 허브 방향이다: SDK가 모터 형식의 회전 방향(CCW 형식은 FORWARD에서 반대, 실제 DcMotorImpl)과
 * setDirection을 적용한 뒤의 값이므로, 시뮬레이터는 출력 power의 부호대로 돌리고 같은 부호로 position을 세면 된다.
 * 그래서 goBILDA 모터(CCW)에 FORWARD로 setPower(0.5)를 하면 power는 −0.5다. 장치 표에서 팀 코드의 값과 헷갈리지 않게
 * 모터는 첫 출력으로 apiPower(팀 코드의 getPower가 돌려줄 값)를 함께 보인다. 시뮬레이터는 apiPower를 쓰지 않는다.
 *
 * <table border="1">
 * <caption>종류(kind) · 출력 · 입력</caption>
 * <tr><th>kind(구성 태그)</th><th>출력</th><th>입력</th></tr>
 * <tr><td>hub(LynxModule, 이름은 구성의 허브 이름)</td>
 *     <td>bulkCachingMode(OFF·AUTO·MANUAL), led(한 색이면 "#RRGGBB", 여러 단계면 "pattern", 없으면 null)</td>
 *     <td>voltage(배터리 V, 기본 12.5), current·gpioCurrent·i2cCurrent(A, 기본 0), auxVoltage(V, 기본 5), temperature(°C, 기본 25)</td></tr>
 * <tr><td>motor(모터 태그 전부, 데드휠의 Motor 태그)</td>
 *     <td>apiPower(−1..1, 팀 코드 기준: 허브 power에 이 포트 DcMotor의 실제 방향을 되돌려 적용한 값 = getPower가 LastKnown 없이
 *         돌려줄 값, RUN_TO_POSITION이면 |power|; 표시용), motorType(구성 태그), mode(RUN_WITHOUT_ENCODER·RUN_USING_ENCODER·RUN_TO_POSITION·STOP_AND_RESET_ENCODER),
 *         power(−1..1: 엔코더 없음이면 정전력 값, 엔코더 모드면 목표 속도 ÷ 형식의 최대 틱/s, 꺼져 있거나 리셋이면 0),
 *         velocity(엔코더 모드의 목표 속도 틱/s, 아니면 null), enabled, zeroPower(BRAKE·FLOAT),
 *         targetPosition(허브 틱, 받은 적 없으면 null. 한 번 받으면 fail safe·OpMode 사이에도 남는다: 실제 허브는 전원을 끌 때까지(추론),
 *         SandBot은 실행 하나 동안), targetTolerance(틱, 기본 5),
 *         encoderOffset(마지막 STOP_AND_RESET_ENCODER 때의 원시 position, 정수, 처음 0, 늘 보냄, OpMode 사이에도 그대로:
 *         팀 코드의 엔코더 = position − encoderOffset, RUN_TO_POSITION의 원시 목표 = targetPosition + encoderOffset),
 *         encoderResets(허브에 보낸 STOP_AND_RESET_ENCODER 횟수, 정수, 처음 0, 리셋마다 1씩, 늘 보냄, OpMode 사이에도 그대로:
 *         원시 position이 그대로여서 encoderOffset이 같아도, 한 루프에서 리셋 → RUN_TO_POSITION을 해 틱 경계의 mode가
 *         STOP_AND_RESET_ENCODER를 보이지 않아도 리셋을 알 수 있다. 데드휠과 포트를 함께 쓰면 시뮬레이터가 이것으로 축 기준을 잡는다),
 *         velocityPidf·positionPidf(숫자 4개 배열 [p, i, d, f], 늘 보냄: 허브 펌웨어에 저장된 RUN_USING_ENCODER 속도 루프·RUN_TO_POSITION
 *         위치 루프 계수. 팀 코드의 setPIDFCoefficients·setVelocityPIDFCoefficients·setPositionPIDFCoefficients·setPIDCoefficients와
 *         모터 형식 주석(Core Hex)이 실제 허브 명령처럼 바꾸고, 받은 적 없으면 펌웨어 기본값 속도 [10, 3, 0, 0]·위치 [10, 0.05, 0, 0]
 *         (가정, SimDcMotorController). 값은 허브가 저장하는 16.16 고정소수점에서 되돌린 것이라 getPIDFCoefficients와 같다(0.05는
 *         3277/65536 = 0.0500030517578125). OpMode마다 SDK가 처음 쓰기 전 계수로 되돌린다(실제 resetDeviceConfigurationForOpMode)),
 *         velocityAlgorithm·positionAlgorithm(그 계수의 MotorControlAlgorithm: LegacyPID·PIDF·Unknown. 기본과 setPIDCoefficients는
 *         LegacyPID, DcMotorEx의 setVelocityPIDFCoefficients·setPositionPIDFCoefficients는 PIDF)</td>
 *     <td>position(원시 허브 엔코더 틱: 리셋을 빼기 전 값, 정수), velocity(틱/s, 정수: 허브 펌웨어처럼 지난 50 ms 동안의
 *         원시 position 변화 × 20이라 늘 20의 배수이고 약 25 ms 늦다. 실행 시작 뒤 처음 50 ms는 시작 position부터 센다. int16으로
 *         감기 전 값이고, 가짜 SDK가 실제 bulk read의 short처럼 감아 부호 확장한다: 32767을 넘는 빠른 데드휠은 실제처럼 감긴 값을
 *         읽고, Road Runner OverflowEncoder는 20의 배수라는 성질로 되돌린다), current(A),
 *         overCurrent(boolean, 없으면 current &gt; 경보 값). 데드휠(엔코더 포트의 포드)은 같은 장치 이름의 position·velocity가
 *         포드 값이고, 그 부호는 포드 엔코더가 세는 원시 방향(인스펙터 reversed, DcMotor 방향을 적용하기 전)이다</td></tr>
 * <tr><td>servo(Servo, ServoFullRange)</td><td>position(0..1, 펄스로 바꾸기 전 컨트롤러 위치; PWM이 꺼져 있으면 null),
 *     pulseUs(µs 또는 null), pwm(boolean, 처음과 fail safe 뒤 false)</td><td>-</td></tr>
 * <tr><td>crServo(ContinuousRotationServo), sparkMini(RevSPARKMini)</td><td>power(−1..1 또는 null), pulseUs, pwm</td><td>-</td></tr>
 * <tr><td>blinkin(RevBlinkinLedDriver)</td><td>pattern(BlinkinPattern 이름 또는 null), pulseUs, pwm</td><td>-</td></tr>
 * <tr><td>digital(DigitalDevice)</td><td>mode(INPUT·OUTPUT), state(출력 모드에서 쓴 값, 입력 모드면 null)</td>
 *     <td>state(boolean, 기본 true: 풀업)</td></tr>
 * <tr><td>touch(RevTouchSensor)</td><td>mode, state</td><td>pressed(boolean, 기본 false; 누르면 핀이 LOW)</td></tr>
 * <tr><td>led(Led)</td><td>on(출력 모드에서 핀이 LOW면 true, 입력 모드면 null; 실제 SDK처럼 핀을 출력으로 바꾸지 않는다)</td><td>-</td></tr>
 * <tr><td>analog(AnalogInput)</td><td>-</td><td>voltage(V, 0..3.3, 1 mV 단위로 읽힘)</td></tr>
 * <tr><td>imu(ControlHubImuBHI260AP, LynxEmbeddedIMU)</td><td>chip(BHI260AP·BNO055)</td>
 *     <td>yaw·pitch·roll(rad, 로봇 방향: SDK IMU 좌표 X 오른쪽·Y 앞·Z 위, 내재 ZXY), yawRate·pitchRate·rollRate(rad/s);
 *         장치가 구성한 허브 장착 방향으로 바꿔 보고한다. 옛 BNO055IMU의 initialize는 칩을 리셋해 칩이 그 자리에서 전원을 켠
 *         것처럼 heading을 그때부터 센다(피치·롤은 그대로, 같은 칩의 IMU 인터페이스도). 옛 getAngularOrientation은 칩 축 내재 ZYX
 *         (둘째 ±90° 안, 칩 X가 수직이면 셋째 0)</td></tr>
 * <tr><td>distance(REV_VL53L0X_RANGE_SENSOR)</td><td>-</td>
 *     <td>distance(m 또는 null: null·없음은 범위 밖 8190 mm. 연속 측정은 33 ms마다 끝나며 그 끝의 값을 잡는다)</td></tr>
 * <tr><td>color(RevColorSensorV3)</td><td>-</td>
 *     <td>red·green·blue·ir(SDK 기본 3×·25 ms 기준 칩 원래 값. 칩이 LS_GAIN·적분으로 DS 표 비율만큼 척도를 바꾸고 해상도로 포화,
 *         측정 k는 t_ls + t_int + k·max(주기, t_int)에 끝나며 적분 창의 시간 평균을 잡는다; 드라이버가 red에 1.07, blue에 1.55를
 *         곱한다), proximity(0..2047, PS 주기마다 그 순간 값) 또는 distance(m, 시험용: 역공식으로 PS). 시뮬레이터는
 *         red·green·blue·proximity만 보낸다</td></tr>
 * <tr><td>huskyLens(HuskyLens)</td><td>algorithm(고른 알고리즘 이름 또는 null)</td><td>-(1단계는 블록·화살표 0개)</td></tr>
 * <tr><td>pinpoint(goBILDAPinpoint)</td>
 *     <td>xOffsetMm(X 포드의 옆 위치, 왼쪽 +), yOffsetMm(Y 포드의 앞 위치, 앞 +), ticksPerMm(정하지 않았으면 null),
 *         xDirection·yDirection(FORWARD·REVERSED), yawScalar</td>
 *     <td>켜진 뒤 재설정하지 않았을 때 보고할 값(전원 켠 때의 로봇 틀: X 앞·Y 왼쪽): x·y(mm), heading(rad, 감지 않음 —
 *         getHeading(UnnormalizedAngleUnit)이 그대로 돌려준다), vx·vy(mm/s, 같은 원시 틀), headingVelocity(rad/s),
 *         encoderX·encoderY(정수 틱, 포드가 세는 원시 방향 = 장치의 xDirection·yDirection 적용 전), pitch·roll(rad),
 *         loopTime(µs, 기본 667)</td></tr>
 * <tr><td>otos(SparkFunOTOS)</td><td>offsetX·offsetY(m), offsetH(rad), linearScalar, angularScalar</td>
 *     <td>켜진 뒤 재설정하지 않았을 때 보고할 로봇 중심 자세(오프셋 적용 뒤, 원시 틀): x·y(m), h(rad), vx·vy(m/s), vh(rad/s),
 *         ax·ay(m/s²), ah(rad/s²). 틀의 축은 팀이 쓴 오프셋이 정한다: SDK 샘플 규약(X 오른쪽·Y 앞·반시계 +)이면 그 축,
 *         Road Runner식(X 앞·Y 왼쪽, 오프셋 h −90°)이면 그 축이다</td></tr>
 * <tr><td>octoQuad(OctoQuadFTC)</td><td>directions(비트 i = 채널 i 반대), channelBankConfig</td>
 *     <td>position0..7(틱, 방향 적용 전), velocity0..7(틱/표본 간격), 로컬라이저 x·y(mm), h(rad), vx·vy(mm/s), vh(rad/s)</td></tr>
 * <tr><td>webcam(Webcam)</td><td>serialNumber, state(VisionPortal.CameraState 이름, 포털이 없으면 null),
 *     streaming(state = STREAMING), width·height(포털 해상도 px, 포털이 없으면 null), aprilTag(켜진 AprilTag 처리기가 있음),
 *     family(첫 켜진 AprilTag 처리기의 TagFamily 이름 또는 null), decimation(그 처리기가 다음 프레임에 쓸 데시메이션, 처음 3,
 *     없으면 null), fps(getFps, float → double), exposureMs(ExposureControl이 Manual이면 노출 ms, 아니면 null),
 *     gain(GainControl 값)(이 순서, 틱마다 다 보냄, spec-4d §1.10)</td>
 *     <td>model(문자열: 렌즈·SDK 보정의 카메라 모델 id, 처음 한 번), frameNanos·frameWidth·frameHeight(정수: 프레임이 있는
 *     틱의 틱 경계 시각 ns와 해상도 px), tags(숫자 배열: 태그마다 9칸 [id, x0, y0, …, x3, y3], apriltag 3 픽셀 좌표 = OpenCV
 *     좌표 + 0.5, id 오름차순, 최대 64장; 영상은 없다, spec-4d §1.5·§3.2)</td></tr>
 * <tr><td>limelight(EthernetDevice)</td><td>running, pollRateHz, pipeline, robotYaw(°)</td><td>-(1단계는 결과 없음, 연결 안 됨)</td></tr>
 * </table>
 *
 * <p>오도메트리(Pinpoint·OTOS·OctoQuad 로컬라이저)의 입력은 "켜진 뒤 한 번도 재설정하지 않았을 때의 값"이고, 장치가 재설정·자세
 * 쓰기·스칼라를 그 위에 얹는다({@link org.sandbot.sdk.devices.SimTrackedPose}).
 *
 * <p>입력을 만드는 쪽은 메인 프로세스의 운동학 시뮬레이터(src/shared/sim/world.ts)다. 틱마다 바뀐 키만 보내고(처음에는 전부),
 * 정수 키(position·velocity·encoderX·encoderY·red·green·blue·proximity·frameNanos·frameWidth·frameHeight)는 정수로 보낸다.
 * 문자열 입력은 웹캠 model 하나이고, 숫자 배열 입력은 웹캠 tags 하나다(키가 tags이고 길이가 9의 배수·576 이하, 모든 원소가
 * 유한 수, 칸 0(id)이 0 이상 정수일 때만. 아니면 런타임이 그 키를 버린다, src/shared/sidecarProtocol.ts isTagsInput). 측정 시각이 있는 칩(VL53L0X·
 * APDS-9151)은 입력 훅({@link org.sandbot.sim.SimDevice.InputHook})으로 틱 경계 시각을 인자로 받아 그 전에 끝난 측정을 옛 입력으로
 * 잡는다(훅은 시계를 부르지 않는다). 모터 포트의 velocity 측정 규칙은 src/shared/sim/encoderVelocity.ts다.
 * Pinpoint 자세는 시뮬레이터가 펌웨어처럼 포드 틱과 이 장치의 출력(ticksPerMm·방향·오프셋)과 내장 IMU 요로 적분한 값이다(그래서
 * 팀이 오프셋을 틀리게 쓰면 실제처럼 결과가 틀어진다).
 *
 * <h2>허브 비용(가상 시간, HubTiming)</h2>
 * Control Hub(구성에서 parentModuleAddress인 허브)는 HubKind.CONTROL, 나머지는 RS-485를 거치는 EXPANSION이다.
 * 비용은 beforeInit부터 afterStop까지만 청구한다(구성 읽기는 팀 코드가 보는 시간 밖이다). 규칙은 실제 SDK 소스를 따랐다.
 * <ul>
 *   <li>LYNX_COMMAND: 허브에 가는 명령 하나(쓰기, 또는 캐시 없이 읽기). 컨트롤러는 마지막으로 보낸 값을 LastKnown(500 ms 신선)으로
 *       기억해 같은 값이면 보내지 않는다(LynxDcMotorController·LynxServoController·LynxDigitalChannelController). 예: 처음
 *       setPower = 모드 묻기 + power + enable = 명령 3개, 같은 power 다시 = 0개, 다른 power = 1개. setTargetPosition과
 *       디지털 출력 쓰기는 늘 보낸다. 배터리 전압·모터 전류는 늘 명령 하나다. PIDF 계수도 LastKnown이 없어 쓰기·읽기마다 보낸다:
 *       그 포트·모드의 첫 쓰기는 원래 계수 읽기 + 쓰기 = 2개, 그 뒤 쓰기(같은 값이어도)와 getPIDFCoefficients는 1개,
 *       getPIDCoefficients는 F가 0이면 1개, 아니면 허브가 NACK해 PIDF로 다시 물어 2개. PIDF 알고리즘의 RUN_TO_POSITION에 I·D·F를 주면
 *       보내지 않고 UnsupportedOperationException(첫 번째면 원래 계수 읽기 1개).</li>
 *   <li>BULK_READ: LynxGetBulkInputDataCommand. BulkCachingMode(LynxModule)를 따른다: OFF는 엔코더·디지털·아날로그·busy 읽기마다
 *       명령 하나(속도·과전류는 OFF에서도 bulk read), AUTO는 캐시가 없거나 같은 명령(태그 안에서 명령·포트가 같음)을 다시 읽을 때
 *       bulk read(캐시를 비우면 모든 태그의 기록도 지운다), MANUAL은 clearBulkCache() 뒤 첫 읽기, getBulkData()는 늘.
 *       OpMode마다 OFF로 돌아간다.</li>
 *   <li>I2C_TRANSACTION: 장치 드라이버(실제 소스 그대로)가 부르는 I2cDeviceSynch read·write 한 번. 예: BHI260AP initialize 13번,
 *       BNO055 18번 + 40 ms(옛 BNO055IMU initialize는 칩 리셋과 CHIP_ID 다시 묻기까지라 기본 비용표에서 24번 + 780 ms), 방향·각속도
 *       읽기 1번, Pinpoint update 1번(처음은 펌웨어 버전 읽기 1번 더), VL53L0X getDistance 3번(새 측정을 기다리는 상태 읽기 포함).</li>
 * </ul>
 *
 * <h3>끊긴 스레드</h3>
 * 실제 Lynx 명령은 보내기 전에 MessageKeyedLock.acquire(lockInterruptibly)를 거친다. 그래서 끊긴(interrupt) 스레드의 명령은
 * 허브에 가지 않고, 컨트롤러는 InterruptedException을 handleException(스레드를 다시 끊음)으로 넘긴 뒤 쓰기는 버리고 읽기는 실제
 * 자리값을 돌려준다(LastKnown에 넣지 않는다. 보내기 전에 한 LastKnown.updateValue는 남는다). STOP은 LinearOpMode 스레드를
 * 끊으므로 팀이 끊김을 지우지 않는 한 STOP 뒤의 허브 명령이 모두 이렇다. 끊김을 지워도 위험한 명령은 STOP 뒤 계속 취소된다.
 * SandBot은 팀 코드가 도는 동안(beforeInit ~ afterStop) 끊긴 스레드의 LYNX_COMMAND·BULK_READ·I2C_TRANSACTION 대신 잠금 시도
 * 한 번으로 CLOCK_READ만 청구한다(SimHub.acquireNetworkLock, STOP을 무시하고 하드웨어만 부르는 루프도 가상 시간이 흘러
 * stuckInStop이 된다). 끊김 표시는 그대로 둔다. Lynx 컨트롤러(모터·서보·디지털·아날로그·배터리)의 자리값 예: 엔코더·목표 위치·
 * 속도·전류·아날로그·배터리 0, 모드 RUN_WITHOUT_ENCODER, zero power BRAKE, power 0, 모터 켜짐·서보 PWM true, isBusy false,
 * 디지털 모드 INPUT·입력 false, 서보 펄스 폭 0. bulk read는 실제처럼 가짜 값
 * (모두 0, 그래서 모터 넷 모두 busy true)을 캐시에 넣어 MANUAL에서는 clearBulkCache까지 남는다. 런타임의 fail safe(stopRequested·
 * afterStop)와 수명 알림 postStop은 실제로 끊기지 않는 이벤트 루프 스레드의 일이라 막히지 않는다.
 */
package org.sandbot.sdk.devices;
