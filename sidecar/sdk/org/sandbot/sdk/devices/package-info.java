/**
 * 가짜 SDK의 장치 연결: 구성 XML → hardwareMap, 허브(Lynx)·장치 시뮬레이션, 허브 비용.
 *
 * <h2>런타임과의 접점</h2>
 * {@link org.sandbot.sdk.devices.SandbotHardware}: {@code create(File)}(구성 XML, null이면 빈 맵; 틀리면
 * {@link org.sandbot.sdk.devices.SandbotConfigException}, 영어 메시지), {@code beforeInit(map)}(실제
 * OpModeManagerImpl.resetHardwareForOpMode: 허브 → 컨트롤러 → 장치 순으로 resetDeviceConfigurationForOpMode, 그 뒤부터 비용 청구),
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
 *         targetPosition(허브 틱, 받은 적 없으면 null), targetTolerance(틱, 기본 5)</td>
 *     <td>position(허브 엔코더 틱), velocity(틱/s), current(A), overCurrent(boolean, 없으면 current &gt; 경보 값)</td></tr>
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
 *         장치가 구성한 허브 장착 방향으로 바꿔 보고한다</td></tr>
 * <tr><td>distance(REV_VL53L0X_RANGE_SENSOR)</td><td>-</td><td>distance(m, 없으면 범위 밖 8190 mm; 33 ms마다 새 측정)</td></tr>
 * <tr><td>color(RevColorSensorV3)</td><td>-</td>
 *     <td>red·green·blue·ir(칩 원래 값 0..65535, 드라이버가 red에 1.07, blue에 1.55를 곱한다), distance(m) 또는 proximity(0..2047)</td></tr>
 * <tr><td>huskyLens(HuskyLens)</td><td>algorithm(고른 알고리즘 이름 또는 null)</td><td>-(1단계는 블록·화살표 0개)</td></tr>
 * <tr><td>pinpoint(goBILDAPinpoint)</td>
 *     <td>xOffsetMm, yOffsetMm, ticksPerMm(정하지 않았으면 null), xDirection·yDirection(FORWARD·REVERSED), yawScalar</td>
 *     <td>켜진 뒤 재설정하지 않았을 때 보고할 값: x·y(mm), heading(rad), vx·vy(mm/s), headingVelocity(rad/s),
 *         encoderX·encoderY(틱, 방향 적용 전), pitch·roll(rad), loopTime(µs, 기본 667)</td></tr>
 * <tr><td>otos(SparkFunOTOS)</td><td>offsetX·offsetY(m), offsetH(rad), linearScalar, angularScalar</td>
 *     <td>켜진 뒤 재설정하지 않았을 때 보고할 로봇 중심 자세(오프셋 적용 뒤): x·y(m), h(rad), vx·vy(m/s), vh(rad/s),
 *         ax·ay(m/s²), ah(rad/s²)</td></tr>
 * <tr><td>octoQuad(OctoQuadFTC)</td><td>directions(비트 i = 채널 i 반대), channelBankConfig</td>
 *     <td>position0..7(틱, 방향 적용 전), velocity0..7(틱/표본 간격), 로컬라이저 x·y(mm), h(rad), vx·vy(mm/s), vh(rad/s)</td></tr>
 * <tr><td>webcam(Webcam)</td><td>serialNumber</td><td>-(영상 없음)</td></tr>
 * <tr><td>limelight(EthernetDevice)</td><td>running, pollRateHz, pipeline, robotYaw(°)</td><td>-(1단계는 결과 없음, 연결 안 됨)</td></tr>
 * </table>
 *
 * <p>오도메트리(Pinpoint·OTOS·OctoQuad 로컬라이저)의 입력은 "켜진 뒤 한 번도 재설정하지 않았을 때의 값"이고, 장치가 재설정·자세
 * 쓰기·스칼라를 그 위에 얹는다({@link org.sandbot.sdk.devices.SimTrackedPose}).
 *
 * <h2>허브 비용(가상 시간, HubTiming)</h2>
 * Control Hub(구성에서 parentModuleAddress인 허브)는 HubKind.CONTROL, 나머지는 RS-485를 거치는 EXPANSION이다.
 * 비용은 beforeInit부터 afterStop까지만 청구한다(구성 읽기는 팀 코드가 보는 시간 밖이다). 규칙은 실제 SDK 소스를 따랐다.
 * <ul>
 *   <li>LYNX_COMMAND: 허브에 가는 명령 하나(쓰기, 또는 캐시 없이 읽기). 컨트롤러는 마지막으로 보낸 값을 LastKnown(500 ms 신선)으로
 *       기억해 같은 값이면 보내지 않는다(LynxDcMotorController·LynxServoController·LynxDigitalChannelController). 예: 처음
 *       setPower = 모드 묻기 + power + enable = 명령 3개, 같은 power 다시 = 0개, 다른 power = 1개. setTargetPosition과
 *       디지털 출력 쓰기는 늘 보낸다. 배터리 전압·모터 전류는 늘 명령 하나다.</li>
 *   <li>BULK_READ: LynxGetBulkInputDataCommand. BulkCachingMode(LynxModule)를 따른다: OFF는 엔코더·디지털·아날로그·busy 읽기마다
 *       명령 하나(속도·과전류는 OFF에서도 bulk read), AUTO는 캐시가 없거나 같은 명령(태그 안에서 명령·포트가 같음)을 다시 읽을 때
 *       bulk read(캐시를 비우면 모든 태그의 기록도 지운다), MANUAL은 clearBulkCache() 뒤 첫 읽기, getBulkData()는 늘.
 *       OpMode마다 OFF로 돌아간다.</li>
 *   <li>I2C_TRANSACTION: 장치 드라이버(실제 소스 그대로)가 부르는 I2cDeviceSynch read·write 한 번. 예: BHI260AP initialize 13번,
 *       BNO055 18번 + 40 ms, 방향·각속도 읽기 1번, Pinpoint update 1번(처음은 펌웨어 버전 읽기 1번 더), VL53L0X getDistance 3번
 *       (새 측정을 기다리는 상태 읽기 포함).</li>
 * </ul>
 */
package org.sandbot.sdk.devices;
