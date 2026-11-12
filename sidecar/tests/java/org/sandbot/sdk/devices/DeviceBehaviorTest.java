package org.sandbot.sdk.devices;

import com.qualcomm.hardware.bosch.BNO055IMU;
import com.qualcomm.hardware.broadcom.BroadcomColorSensor;
import com.qualcomm.hardware.dfrobot.HuskyLens;
import com.qualcomm.hardware.digitalchickenlabs.OctoQuad;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.limelightvision.Limelight3A;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.rev.RevBlinkinLedDriver;
import com.qualcomm.hardware.rev.RevColorSensorV3;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.hardware.sparkfun.SparkFunOTOS;
import com.qualcomm.robotcore.exception.TargetPositionNotSetException;
import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.Gyroscope;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.NormalizedRGBA;
import com.qualcomm.robotcore.hardware.MotorControlAlgorithm;
import com.qualcomm.robotcore.hardware.PIDCoefficients;
import com.qualcomm.robotcore.hardware.PIDFCoefficients;
import com.qualcomm.robotcore.hardware.PwmControl;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.ServoController;
import com.qualcomm.robotcore.hardware.TouchSensor;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.external.navigation.Acceleration;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.AngularVelocity;
import org.firstinspires.ftc.robotcore.external.navigation.AxesOrder;
import org.firstinspires.ftc.robotcore.external.navigation.AxesReference;
import org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Orientation;
import org.firstinspires.ftc.robotcore.external.navigation.Position;
import org.firstinspires.ftc.robotcore.external.navigation.UnnormalizedAngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Velocity;
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;
import org.sandbot.sim.HubKind;
import org.sandbot.sim.HubTiming;
import org.sandbot.sim.SimCost;
import org.sandbot.sim.SimDevice;
import org.sandbot.sim.SimUnsupportedException;
import org.sandbot.testing.Check;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import static org.sandbot.sdk.devices.SimTestSupport.CLOCK;
import static org.sandbot.sdk.devices.SimTestSupport.create;
import static org.sandbot.sdk.devices.SimTestSupport.input;
import static org.sandbot.sdk.devices.SimTestSupport.ms;
import static org.sandbot.sdk.devices.SimTestSupport.output;
import static org.sandbot.sdk.devices.SimTestSupport.prefix;
import static org.sandbot.sdk.devices.SimTestSupport.robotXml;

/** 장치 의미: 실제 SDK와 같은 방향·스케일·상태, 시뮬레이터 출력·입력 키 */
public final class DeviceBehaviorTest {
    private DeviceBehaviorTest() {}

    static final class Bot {
        final String p = prefix();
        final HardwareMap map;

        Bot(String expansion, String control, String usb) {
            map = create(robotXml(p, expansion, control, usb));
            SandbotHardware.beforeInit(map);
        }

        <T> T get(Class<T> type, String name) {
            return map.get(type, p + name);
        }

        Object out(String name, String key) {
            return output(p + name, key);
        }

        org.sandbot.sim.SimDevice device(String name) {
            return SimTestSupport.device(p + name);
        }

        void in(String name, String key, Object value) {
            input(p + name, key, value);
        }
    }

    static double num(Object value) {
        return ((Number) value).doubleValue();
    }

    // ---------------------------------------------------------------------------------------------
    // 모터
    // ---------------------------------------------------------------------------------------------

    static final String MOTORS =
            "            <goBILDA5202SeriesMotor name=\"gobilda\" port=\"0\" />\n"
            + "            <TetrixMotor name=\"tetrix\" port=\"1\" />\n"
            + "            <RevRobotics20HDHexMotor name=\"hex\" port=\"2\" />\n";

    public static void testMotorDirectionFollowsMotorOrientation() {
        Bot bot = new Bot(null, MOTORS, null);
        DcMotor gobilda = bot.get(DcMotor.class, "gobilda");
        DcMotor tetrix = bot.get(DcMotor.class, "tetrix");
        Check.equal("RUN_WITHOUT_ENCODER", bot.out("gobilda", "mode"), "OpMode starts without encoders");
        Check.equal("FLOAT", bot.out("gobilda", "zeroPower"), "OpMode starts floating");
        Check.equal(0.0, bot.out("gobilda", "power"), "OpMode starts at zero power");
        Check.equal("goBILDA5202SeriesMotor", bot.out("gobilda", "motorType"), "motor type output");

        // goBILDA는 CCW 형식: FORWARD에서 허브 power의 부호가 바뀐다. Tetrix는 CW.
        gobilda.setPower(0.5);
        tetrix.setPower(0.5);
        Check.near(-0.5, num(bot.out("gobilda", "power")), 1e-4, "goBILDA FORWARD hub power");
        Check.near(0.5, num(bot.out("tetrix", "power")), 1e-4, "Tetrix FORWARD hub power");
        Check.equal(true, bot.out("gobilda", "enabled"), "power enables the motor");
        Check.near(0.5, gobilda.getPower(), 1e-4, "getPower is the API power");
        gobilda.setDirection(DcMotorSimple.Direction.REVERSE);
        gobilda.setPower(0.5);
        Check.near(0.5, num(bot.out("gobilda", "power")), 1e-4, "goBILDA REVERSE hub power");

        // 엔코더: 입력 position은 허브가 세는 값
        bot.in("tetrix", "position", 100L);
        bot.in("gobilda", "position", 100L);
        Check.equal(100, tetrix.getCurrentPosition(), "Tetrix encoder");
        Check.equal(100, gobilda.getCurrentPosition(), "goBILDA REVERSE encoder (inverted twice)");
        gobilda.setDirection(DcMotorSimple.Direction.FORWARD);
        Check.equal(-100, gobilda.getCurrentPosition(), "goBILDA FORWARD encoder");

        gobilda.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        Check.equal("BRAKE", bot.out("gobilda", "zeroPower"), "zero power behavior");
        Check.equal(DcMotor.ZeroPowerBehavior.BRAKE, gobilda.getZeroPowerBehavior(), "zero power read back");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testApiPowerIsWhatGetPowerReturns() {
        Bot bot = new Bot(null, MOTORS, null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        DcMotor tetrix = bot.get(DcMotor.class, "tetrix");
        // 장치 표의 첫 키는 팀 코드가 보는 값(getPower), 허브 값 power는 그 뒤
        Check.equal("apiPower", bot.device("gobilda").outputs().keySet().iterator().next(), "apiPower is listed first");
        Check.equal(0.0, bot.out("gobilda", "apiPower"), "OpMode starts at zero power");
        gobilda.setPower(0.5);
        tetrix.setPower(0.5);
        Check.near(0.5, num(bot.out("gobilda", "apiPower")), 1e-4, "goBILDA FORWARD: apiPower is the API power");
        Check.near(-0.5, num(bot.out("gobilda", "power")), 1e-4, "goBILDA FORWARD: power is the hub power");
        Check.near(0.5, num(bot.out("tetrix", "apiPower")), 1e-4, "Tetrix FORWARD apiPower");
        Check.near(gobilda.getPower(), num(bot.out("gobilda", "apiPower")), 1e-4, "apiPower equals getPower");
        gobilda.setDirection(DcMotorSimple.Direction.REVERSE);
        Check.near(-0.5, num(bot.out("gobilda", "apiPower")), 1e-4, "setDirection flips what getPower returns");
        Check.near(gobilda.getPower(), num(bot.out("gobilda", "apiPower")), 1e-4, "apiPower equals getPower after setDirection");
        gobilda.setPower(-0.25);
        Check.near(-0.25, num(bot.out("gobilda", "apiPower")), 1e-4, "goBILDA REVERSE apiPower");
        Check.near(-0.25, num(bot.out("gobilda", "power")), 1e-4, "goBILDA REVERSE hub power");
        // RUN_USING_ENCODER: 목표 속도의 비율(getPower가 LastKnown이 없을 때 돌려주는 값)
        gobilda.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        Check.near(-0.25, num(bot.out("gobilda", "apiPower")), 1e-3, "RUN_USING_ENCODER apiPower");
        // RUN_TO_POSITION: getPower는 |power|
        gobilda.setTargetPosition(10);
        gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        gobilda.setPower(-0.5);
        Check.near(0.5, num(bot.out("gobilda", "apiPower")), 1e-3, "RUN_TO_POSITION apiPower is |power|");
        Check.near(gobilda.getPower(), num(bot.out("gobilda", "apiPower")), 1e-3, "apiPower equals getPower (RUN_TO_POSITION)");
        gobilda.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        Check.equal(0.0, bot.out("gobilda", "apiPower"), "reset stops the motor");
        SandbotHardware.afterStop(bot.map);
        Check.equal(0.0, bot.out("gobilda", "apiPower"), "fail safe stops motors");
    }

    public static void testStopBlocksDangerousCommands() {
        // 실제 OpModeManagerImpl.callActiveOpModeStop: STOP을 받으면 곧바로 허브 fail safe, 그 뒤 위험한 명령(0이 아닌 power·
        // 속도, 목표 위치, 서보 펄스·PWM 켜기)은 CANCELLED_FOR_SAFETY로 버려진다(팀 코드가 아직 돌아도 모터가 다시 돌지 않는다)
        Bot bot = new Bot(null, MOTORS + "            <Servo name=\"servo\" port=\"0\" />\n", null);
        DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
        Servo servo = bot.get(Servo.class, "servo");
        tetrix.setPower(0.5);
        servo.setPosition(0.5);
        Check.near(0.5, num(bot.out("tetrix", "power")), 1e-4, "running before STOP");
        SandbotHardware.stopRequested(bot.map);
        Check.equal(0.0, bot.out("tetrix", "power"), "STOP fail safe stops the motor at once");
        Check.equal(false, bot.out("tetrix", "enabled"), "STOP fail safe disables the motor");
        Check.equal(false, bot.out("servo", "pwm"), "STOP fail safe turns servo PWM off");
        long before = SimTestSupport.now();
        tetrix.setPower(0.8);
        servo.setPosition(0.9);
        // 실제 send()는 LynxModule.sendCommand의 안전 검사 전에 네트워크 잠금을 잡는다: 취소된 명령은 허브 명령 비용이 아니라
        // 잠금 한 번(CLOCK_READ)이다
        attemptsRun(1, () -> tetrix.setTargetPosition(100), "a cancelled target position");
        tetrix.setVelocity(300);
        Check.equal(0.0, bot.out("tetrix", "power"), "power after STOP is cancelled");
        Check.equal(false, bot.out("servo", "pwm"), "servo PWM stays off after STOP");
        Check.equal(null, bot.out("tetrix", "targetPosition"), "target position after STOP is cancelled");
        Check.isTrue(SimTestSupport.now() - before < ms(1.5 * 6), "cancelled commands are not sent (no hub time)");
        tetrix.setPower(0);
        Check.equal(0.0, bot.out("tetrix", "power"), "zero power is not dangerous");
        SandbotHardware.afterStop(bot.map);

        // 다음 OpMode(beforeInit)부터는 다시 보낸다
        Bot next = new Bot(null, MOTORS, null);
        next.get(DcMotor.class, "tetrix").setPower(0.5);
        Check.near(0.5, num(next.out("tetrix", "power")), 1e-4, "commands work again after beforeInit");
        SandbotHardware.afterStop(next.map);
    }

    public static void testStopAndResetEncoder() {
        Bot bot = new Bot(null, MOTORS, null);
        DcMotor tetrix = bot.get(DcMotor.class, "tetrix");
        bot.in("tetrix", "position", 500L);
        tetrix.setPower(0.4);
        tetrix.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        Check.equal("STOP_AND_RESET_ENCODER", bot.out("tetrix", "mode"), "reset mode output");
        Check.equal(0.0, bot.out("tetrix", "power"), "reset stops the motor");
        Check.equal(0, tetrix.getCurrentPosition(), "encoder is zero after reset");
        bot.in("tetrix", "position", 620L);
        Check.equal(120, tetrix.getCurrentPosition(), "encoder counts from the reset");
        Check.equal(DcMotor.RunMode.STOP_AND_RESET_ENCODER, tetrix.getMode(), "mode stays STOP_AND_RESET_ENCODER");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testRunToPosition() {
        Bot bot = new Bot(null, MOTORS, null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        // 목표 위치 없이 RUN_TO_POSITION으로 켜면 펌웨어가 거부한다(실제 TargetPositionNotSetException). 꺼 둔 모터로 시작해
        // 거부된 켜기가 허브 상태를 바꾸지 않는 것을 본다.
        gobilda.setMotorDisable();
        Check.throwsType(TargetPositionNotSetException.class, () -> gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION),
                "RUN_TO_POSITION before a target");
        Check.equal(false, bot.out("gobilda", "enabled"), "the hub refused to enable");
        // 실제 LynxDcMotorController는 NACK 뒤 lastKnownEnable을 되돌리지 않는다(updateValue가 둔 true 그대로). 그래서 신선한
        // 동안(500 ms) 다시 켜기를 보내지 않아 던지지 않고, 목표 위치를 준 뒤에도 모터는 꺼진 채다. 신선도가 지나면 다시 보낸다.
        gobilda.setPower(0.3);
        Check.equal(false, bot.out("gobilda", "enabled"), "no enable resent while the NACKed cache value is fresh");
        gobilda.setTargetPosition(50);
        gobilda.setPower(0.4);
        Check.equal(false, bot.out("gobilda", "enabled"), "still off: the SDK believes the motor is enabled");
        CLOCK.nanos += ms(501);
        gobilda.setPower(0.5);
        Check.equal(true, bot.out("gobilda", "enabled"), "enable is resent once the cache is stale");
        SandbotHardware.afterStop(bot.map);

        Bot bot2 = new Bot(null, MOTORS, null);
        DcMotorEx motor = bot2.get(DcMotorEx.class, "gobilda");
        motor.setTargetPosition(100);
        Check.equal(-100, bot2.out("gobilda", "targetPosition"), "goBILDA FORWARD target is inverted at the hub");
        Check.equal(100, motor.getTargetPosition(), "target read back in API direction");
        motor.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        motor.setPower(-0.5);
        Check.equal("RUN_TO_POSITION", bot2.out("gobilda", "mode"), "mode output");
        double maxTicks = motor.getMotorType().getAchieveableMaxTicksPerSecondRounded();
        Check.near(0.5 * maxTicks, num(bot2.out("gobilda", "velocity")), 1.0, "RUN_TO_POSITION uses |power| as velocity");
        Check.near(0.5, num(bot2.out("gobilda", "power")), 1e-3, "power output is the velocity fraction");
        Check.isTrue(motor.isBusy(), "busy before reaching the target");
        bot2.in("gobilda", "position", -97L);
        Check.isTrue(!motor.isBusy(), "within tolerance 5");
        motor.setTargetPositionTolerance(2);
        Check.equal(5, bot2.out("gobilda", "targetTolerance"), "tolerance is sent with the next target (real DcMotorImplEx)");
        motor.setTargetPosition(100);
        Check.equal(2, bot2.out("gobilda", "targetTolerance"), "tolerance output");
        Check.isTrue(motor.isBusy(), "outside the new tolerance");
        SandbotHardware.afterStop(bot2.map);
        Check.equal(false, bot2.out("gobilda", "enabled"), "fail safe disables motors");
        Check.equal(0.0, bot2.out("gobilda", "power"), "fail safe stops motors");
    }

    public static void testFailSafeKeepsTargetPosition() {
        // 허브 fail safe는 모터를 멈추고 끌 뿐 모드·목표 위치를 지우지 않는다(펌웨어 추론, SimDcMotorController의
        // Channel.targetPositionSet). RUN_TO_POSITION으로 돌던 LinearOpMode가 STOP 뒤 루프 다음에 setPower(0)을 해도 실제
        // 로봇처럼 TargetPositionNotSetException이 나지 않는다.
        Bot bot = new Bot(null, MOTORS, null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        gobilda.setTargetPosition(100);
        gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        gobilda.setPower(0.5);
        Check.equal(true, bot.out("gobilda", "enabled"), "running before STOP");
        SandbotHardware.stopRequested(bot.map);
        Check.equal(false, bot.out("gobilda", "enabled"), "STOP fail safe disables the motor");
        Check.equal(0.0, bot.out("gobilda", "power"), "STOP fail safe stops the motor");
        Check.equal("RUN_TO_POSITION", bot.out("gobilda", "mode"), "fail safe keeps the mode");
        Check.equal(-100, bot.out("gobilda", "targetPosition"), "fail safe keeps the target position");
        // 끊김이 없는 스레드: 목표 속도 0과 켜기는 위험하지 않아 보낸다(실제 isDangerous false)
        gobilda.setPower(0);
        Check.equal(0.0, bot.out("gobilda", "power"), "zero power after STOP");
        Check.equal(true, bot.out("gobilda", "enabled"), "re-enabling with the kept target does not throw");
        // 위험한 명령은 여전히 취소된다
        gobilda.setPower(0.8);
        gobilda.setTargetPosition(300);
        Check.equal(0.0, bot.out("gobilda", "power"), "nonzero power after STOP is still cancelled");
        Check.equal(-100, bot.out("gobilda", "targetPosition"), "a new target after STOP is still cancelled");
        Check.equal(100, gobilda.getTargetPosition(), "the hub still has the old target");

        // 다음 OpMode(afterStop → beforeInit): 목표 위치는 허브에 남아 새 목표 없이 RUN_TO_POSITION으로 켜도 던지지 않는다
        SandbotHardware.afterStop(bot.map);
        SandbotHardware.beforeInit(bot.map);
        Check.equal("RUN_WITHOUT_ENCODER", bot.out("gobilda", "mode"), "the next OpMode starts without encoders");
        Check.equal(-100, bot.out("gobilda", "targetPosition"), "the target survives to the next OpMode");
        gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        gobilda.setPower(0.5);
        Check.equal(true, bot.out("gobilda", "enabled"), "RUN_TO_POSITION enables with the kept target");
        Check.near(0.5, num(bot.out("gobilda", "power")), 1e-3, "the motor runs to the kept target");
        SandbotHardware.afterStop(bot.map);
    }

    // ---------------------------------------------------------------------------------------------
    // 끊긴 OpMode 스레드(실제 MessageKeyedLock.acquire의 lockInterruptibly)
    // ---------------------------------------------------------------------------------------------

    /** 잠금 시도 한 번의 비용(SimHub.acquireNetworkLock) */
    static final long CLOCK_READ = HubTiming.defaults().baseNanos(SimCost.CLOCK_READ, HubKind.CONTROL);

    /** body가 허브 명령을 하나도 보내지 않고 잠금 시도만 n번 했는지(가상 시간 = n × CLOCK_READ) 보고 결과를 돌려준다 */
    static <T> T attempts(int n, Supplier<T> body, String message) {
        Object[] result = new Object[1];
        long elapsed = SimTestSupport.elapsed(() -> result[0] = body.get());
        Check.equal((long) n * CLOCK_READ, elapsed, message + ": " + n + " lock attempt(s), nothing sent");
        @SuppressWarnings("unchecked")
        T value = (T) result[0];
        return value;
    }

    static void attemptsRun(int n, Runnable body, String message) {
        attempts(n, () -> {
            body.run();
            return null;
        }, message);
    }

    static Map<String, Object> outputsOf(Bot bot, String... names) {
        Map<String, Object> all = new LinkedHashMap<>();
        for (String name : names) all.put(name, new LinkedHashMap<>(bot.device(name).outputs()));
        return all;
    }

    public static void testInterruptedThreadDropsHubTransactions() {
        // STOP을 받은 LinearOpMode의 스레드는 끊긴다. 실제 Lynx 명령은 보내기 전에 MessageKeyedLock.acquire(lockInterruptibly)를
        // 거치므로 끊긴 스레드에서는 InterruptedException이 나고, 컨트롤러는 handleException(다시 끊음) 뒤 쓰기는 버리고 읽기는
        // 자리값(LynxUsbUtil.makePlaceholderValue 등)을 돌려준다. 값은 실제 12.0 Lynx 컨트롤러의 catch 다음 줄이다.
        Bot bot = new Bot(null, MOTORS + "            <Servo name=\"servo\" port=\"0\" />\n" + IO, null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
        DcMotorEx hex = bot.get(DcMotorEx.class, "hex");
        Servo servo = bot.get(Servo.class, "servo");
        DigitalChannel digital = bot.get(DigitalChannel.class, "digital");
        VoltageSensor battery = bot.get(VoltageSensor.class, "Control Hub");
        SimHub hub = SimHub.of(bot.get(LynxModule.class, "Control Hub"));
        SimDcMotorController motors = hub.motors;
        SimServoController servos = hub.servos;
        SimDigitalChannelController dio = hub.digital;

        // 실제 값이 자리값과 다르게 준비한다
        tetrix.setPower(0.5);
        tetrix.setCurrentAlert(5, CurrentUnit.AMPS);
        bot.in("tetrix", "position", 100L);
        bot.in("tetrix", "velocity", 40L);
        bot.in("tetrix", "current", 6.0);
        gobilda.setTargetPosition(100);
        gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        gobilda.setPower(0.5);
        hex.setMotorDisable();
        servo.setPosition(0.3);
        digital.setMode(DigitalChannel.Mode.OUTPUT);
        digital.setState(true);
        bot.in("analog", "voltage", 1.2);
        bot.in("Control Hub", "voltage", 11.8);
        Check.isTrue(motors.isMotorOverCurrent(1), "the real hub reports over current");
        // LastKnown이 모두 신선도(500 ms)를 넘겨 읽기가 허브에 묻게 한다
        CLOCK.nanos += ms(501);
        String[] names = {"gobilda", "tetrix", "hex", "servo", "digital", "touch", "led", "analog", "Control Hub"};
        Map<String, Object> before = outputsOf(bot, names);

        Thread.currentThread().interrupt();
        try {
            // 모터 읽기(LynxDcMotorController)
            Check.equal(0, attempts(1, () -> motors.getMotorCurrentPosition(1), "encoder"), "encoder placeholder 0");
            Check.equal(0.0, attempts(1, () -> motors.getMotorVelocity(1), "velocity"), "velocity placeholder 0");
            Check.equal(false, attempts(1, () -> motors.isMotorOverCurrent(1), "over current"), "over current placeholder false");
            Check.equal(0.0, attempts(1, () -> motors.getMotorCurrent(1, CurrentUnit.AMPS), "current"), "current placeholder 0.0");
            Check.equal(0.0, attempts(1, () -> motors.getMotorCurrentAlert(1, CurrentUnit.AMPS), "current alert"),
                    "current alert placeholder 0.0");
            Check.equal(0, attempts(1, () -> motors.getMotorTargetPosition(0), "target"), "target placeholder 0");
            Check.equal(DcMotor.RunMode.RUN_WITHOUT_ENCODER, attempts(1, () -> motors.getMotorMode(0), "mode"),
                    "mode placeholder RUN_WITHOUT_ENCODER");
            Check.equal(DcMotor.ZeroPowerBehavior.BRAKE, attempts(1, () -> motors.getMotorZeroPowerBehavior(0), "zero power"),
                    "zero power placeholder BRAKE");
            // 모드 읽기(자리값 RUN_WITHOUT_ENCODER) 다음 정전력 읽기
            Check.equal(0.0, attempts(2, () -> motors.getMotorPower(1), "power"), "power placeholder 0");
            Check.equal(true, attempts(1, () -> motors.isMotorEnabled(2), "enabled"), "enabled placeholder true");
            // 모드 자리값이 RUN_WITHOUT_ENCODER라 at-target을 묻지 않는다
            Check.equal(false, attempts(1, () -> motors.isBusy(0), "busy"), "busy without a cached mode is false");
            PIDFCoefficients pidf = attempts(1, () -> motors.getPIDFCoefficients(0, DcMotor.RunMode.RUN_USING_ENCODER), "PIDF");
            Check.equal(Arrays.asList(0.0, 0.0, 0.0, 0.0, MotorControlAlgorithm.PIDF),
                    Arrays.<Object>asList(pidf.p, pidf.i, pidf.d, pidf.f, pidf.algorithm), "PIDF placeholder new PIDFCoefficients()");
            PIDCoefficients pid = attempts(1, () -> motors.getPIDCoefficients(0, DcMotor.RunMode.RUN_USING_ENCODER), "PID");
            Check.equal(Arrays.asList(0.0, 0.0, 0.0), Arrays.asList(pid.p, pid.i, pid.d), "PID placeholder new PIDCoefficients()");

            // 모터 쓰기: 모두 버린다(보내기 전 LastKnown.updateValue는 실제처럼 남는다)
            attemptsRun(2, () -> motors.setMotorPower(1, 0.9), "set power (mode read + send)");
            attemptsRun(1, () -> motors.setMotorTargetPosition(0, 500), "set target");
            attemptsRun(2, () -> motors.setMotorZeroPowerBehavior(1, DcMotor.ZeroPowerBehavior.BRAKE), "set zero power (mode read + send)");
            attemptsRun(1, () -> motors.setMotorEnable(2), "enable");
            // prevPower는 위 setMotorPower가 남긴 LastKnown 0.9: power 0(모드 읽기 + 보내기) → 리셋 보내기
            attemptsRun(3, () -> motors.setMotorMode(1, DcMotor.RunMode.STOP_AND_RESET_ENCODER), "reset encoder");
            // 모드 읽기 → setMotorMode(RUN_USING_ENCODER)(zero power 읽기 + 보내기) → 목표 속도 보내기
            attemptsRun(4, () -> motors.setMotorVelocity(0, 300), "set velocity");
            // 처음 바꾸는 계수: 원래 계수 읽기(자리값) + 보내기. 실제 handleException이 true(지원함)라 던지지 않는다
            attemptsRun(2, () -> motors.setPIDFCoefficients(1, DcMotor.RunMode.RUN_USING_ENCODER, new PIDFCoefficients(1, 2, 3, 4)),
                    "set PIDF");
            attemptsRun(1, () -> motors.setMotorCurrentAlert(1, 9, CurrentUnit.AMPS), "set current alert");
            // 위험한 명령이 아니어도 버린다(끊김은 STOP과 관계없는 규칙). hex의 power LastKnown은 신선하지 않아 다시 보내려 한다
            attemptsRun(2, () -> motors.setMotorPower(2, 0), "zero power is dropped too");

            // 서보(LynxServoController)
            Check.equal(0.0, attempts(1, () -> servos.getServoPosition(0), "servo position"),
                    "servo position: the pulse width read returns 0, so the position is 0");
            Check.equal(true, attempts(1, () -> servos.isServoPwmEnabled(1), "servo PWM"), "servo PWM placeholder true");
            Check.equal(ServoController.PwmStatus.ENABLED, attempts(6, servos::getPwmStatus, "PWM status"),
                    "PWM status from six placeholders (the hub is MIXED)");
            attemptsRun(2, () -> servos.setServoPosition(0, 0.8), "set servo position (pulse + PWM enable)");
            Check.equal(2040.0, attempts(0, () -> servos.getPulseWidth(0), "pulse width"),
                    "the unsent pulse width is cached (LastKnown.updateValue before send)");
            PwmControl.PwmRange range = new PwmControl.PwmRange(1000, 2000);
            attemptsRun(1, () -> servos.setServoPwmRange(0, range), "set PWM range");
            Check.equal(range, servos.getServoPwmRange(0), "the PWM range is remembered before the send");
            attemptsRun(1, () -> servos.setServoPwmDisable(0), "PWM disable");

            // 디지털(LynxDigitalChannelController)
            Check.equal(DigitalChannel.Mode.INPUT, attempts(1, () -> dio.getDigitalChannelMode(0), "DIO mode"),
                    "DIO mode placeholder INPUT (the pin is an output)");
            // 모드 자리값 INPUT 다음 입력 읽기(풀업이라 실제는 true)
            Check.equal(false, attempts(2, () -> dio.getDigitalChannelState(1), "DIO input"), "DIO input placeholder false");
            // 모드 자리값이 INPUT이라 출력을 쓰지 않는다
            attemptsRun(1, () -> dio.setDigitalChannelState(0, false), "DIO output");

            // 아날로그·배터리(LynxAnalogInputController·LynxVoltageSensor)
            Check.equal(0.0, attempts(1, () -> hub.analog.getAnalogInputVoltage(3), "analog"), "analog placeholder 0.0");
            Check.equal(0.0, attempts(1, battery::getVoltage, "battery"), "battery placeholder 0.0");

            Check.equal(before, outputsOf(bot, names), "nothing reached the hub");
            Check.isTrue(Thread.currentThread().isInterrupted(), "the interrupt is not cleared (real: cleared and re-set)");

            // 신선한 모드 캐시가 있으면 그다음 명령에서 막힌다
            Thread.interrupted();
            Check.equal(DcMotor.RunMode.RUN_TO_POSITION, gobilda.getMode(), "the hub kept RUN_TO_POSITION");
            Check.equal(DigitalChannel.Mode.OUTPUT, digital.getMode(), "the pin is an output");
            Thread.currentThread().interrupt();
            Check.equal(false, attempts(1, () -> motors.isBusy(0), "at target"),
                    "at-target placeholder false (\"better to unstick wait loops\"; the motor is busy)");
            attemptsRun(1, () -> dio.setDigitalChannelState(0, false), "DIO output with a cached mode");
            Check.equal(true, bot.out("digital", "state"), "the output was not written");
            // 실제 catch 블록이 출력 캐시를 잊으므로 출력 핀 읽기는 실제처럼 null을 언박싱한다
            Check.throwsType(NullPointerException.class, () -> dio.getDigitalChannelState(0), "output state after a dropped write");
            Check.isTrue(Thread.currentThread().isInterrupted(), "still interrupted");
        } finally {
            Thread.interrupted();
        }
        SandbotHardware.afterStop(bot.map);
    }

    public static void testInterruptedThreadGetsFakeBulkData() {
        // 실제 LynxModule.getBulkData: sendReceive가 던지면 가짜 BulkData(new LynxGetBulkInputDataResponse(this), fake true)를
        // lastBulkData로 둔다. 새 응답은 모두 0이라 at-target 비트도 0이고 isMotorBusy(= !isAtTarget)는 모두 true다.
        Bot bot = new Bot(null, MOTORS + IO, null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
        LynxModule module = bot.get(LynxModule.class, "Control Hub");
        SimHub hub = SimHub.of(module);
        SimDcMotorController motors = hub.motors;
        tetrix.setPower(0.5);
        bot.in("tetrix", "position", 100L);
        bot.in("tetrix", "velocity", 40L);
        gobilda.setTargetPosition(100);
        gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        gobilda.setPower(0.5);
        bot.in("gobilda", "position", -100L);
        bot.in("analog", "voltage", 1.2);
        module.setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL);
        CLOCK.nanos += ms(501);

        Thread.currentThread().interrupt();
        try {
            Check.equal(0, attempts(1, () -> motors.getMotorCurrentPosition(1), "first cached read"), "fake encoder 0");
            // 가짜 값이 캐시에 남아 다음 읽기는 묻지 않는다
            Check.equal(true, attempts(0, () -> motors.isBusy(0), "busy"), "fake busy true (the motor is at its target)");
            Check.equal(true, attempts(0, () -> motors.isBusy(1), "busy"), "fake busy true for a motor not in RUN_TO_POSITION");
            Check.equal(0.0, attempts(0, () -> motors.getMotorVelocity(1), "velocity"), "fake velocity 0");
            Check.equal(false, attempts(0, () -> motors.isMotorOverCurrent(1), "over current"), "fake over current false");
            Check.equal(0.0, attempts(0, () -> hub.analog.getAnalogInputVoltage(3), "analog"), "fake analog 0");
            // 모드 읽기(자리값 INPUT) 다음 캐시의 가짜 디지털 입력
            Check.equal(false, attempts(1, () -> hub.digital.getDigitalChannelState(1), "DIO"), "fake digital input false");

            SimHub.Snapshot fake = attempts(1, hub::getBulkData, "getBulkData");
            Check.isTrue(fake.fake, "getBulkData marks the fake data");
            Check.equal("[true, true, true, true]", Arrays.toString(fake.motorBusy), "fake motor busy");
            Check.equal("[0, 0, 0, 0]", Arrays.toString(fake.motorPositions), "fake encoders");
            Check.equal("[0, 0, 0, 0]", Arrays.toString(fake.motorVelocities), "fake velocities");
            Check.equal("[false, false, false, false]", Arrays.toString(fake.motorOverCurrent), "fake over current");
            Check.equal("[false, false, false, false, false, false, false, false]", Arrays.toString(fake.digitalInputs),
                    "fake digital inputs");
            Check.equal("[0.0, 0.0, 0.0, 0.0]", Arrays.toString(fake.analogVolts), "fake analog inputs");
            LynxModule.BulkData data = attempts(1, module::getBulkData, "LynxModule.getBulkData");
            Check.isTrue(data.isMotorBusy(2) && data.getMotorCurrentPosition(1) == 0, "LynxModule.getBulkData reads the fake data");
            Check.isTrue(Thread.currentThread().isInterrupted(), "still interrupted");
        } finally {
            Thread.interrupted();
        }
        // MANUAL: 가짜 값은 clearBulkCache까지 남는다(실제 lastBulkData)
        Check.equal(0, attempts(0, () -> motors.getMotorCurrentPosition(1), "cached fake"), "the fake data stays cached");
        module.clearBulkCache();
        long bulkRead = HubTiming.defaults().baseNanos(SimCost.BULK_READ, HubKind.CONTROL);
        Check.equal(bulkRead, SimTestSupport.elapsed(() -> Check.equal(100, motors.getMotorCurrentPosition(1), "real encoder")),
                "after clearBulkCache the next read is a real bulk read");
        Check.isTrue(!motors.isBusy(0), "real data: at the target");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testClearedInterruptSendsOnlySafeCommands() {
        // FTC SDK 8.2 노트: 팀 코드가 끊김을 지워도 STOP 뒤 위험한 명령은 계속 취소된다(preventDangerousHardwareAccess).
        // 끊김을 지운 스레드의 안전한 명령(power 0·켜기·zero power·읽기)은 실제처럼 허브에 간다.
        Bot bot = new Bot(null, MOTORS + "            <Servo name=\"servo\" port=\"0\" />\n", null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
        Servo servo = bot.get(Servo.class, "servo");
        gobilda.setTargetPosition(100);
        gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        gobilda.setPower(0.5);
        tetrix.setPower(0.5);
        servo.setPosition(0.3);
        SandbotHardware.stopRequested(bot.map);
        Thread.currentThread().interrupt(); // LinearOpMode.internalOnStopRequested
        try {
            // 루프 다음의 정리 코드: getMode(자리값) → setMotorPower(모드 읽기 + 보내기). 던지지 않는다
            attemptsRun(3, () -> gobilda.setPower(0), "cleanup setPower(0) on the interrupted thread");
            Check.equal(false, bot.out("gobilda", "enabled"), "the dropped cleanup does not re-enable the motor");

            Thread.interrupted(); // 팀 코드가 끊김을 지운다
            gobilda.setPower(0);
            Check.equal(0.0, bot.out("gobilda", "power"), "zero power is sent");
            Check.equal(true, bot.out("gobilda", "enabled"), "enabling is not dangerous (kept target)");
            tetrix.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
            Check.equal("BRAKE", bot.out("tetrix", "zeroPower"), "zero power behavior is sent");
            bot.in("tetrix", "position", 77L);
            Check.equal(77, tetrix.getCurrentPosition(), "reads reach the hub again");

            tetrix.setPower(0.7);
            // 취소도 실제 send()처럼 먼저 잡은 잠금 한 번(CLOCK_READ)이 걸린다. 그래서 끊김을 지우고 STOP을 무시한 채 위험한 명령만
            // 부르는 루프도 가상 시간이 흘러 stuckInStop으로 끝난다
            attemptsRun(1, () -> gobilda.setTargetPosition(300), "a cancelled target on the cleared thread");
            gobilda.setVelocity(200);
            servo.setPosition(0.9);
            Check.equal(0.0, bot.out("tetrix", "power"), "nonzero power stays cancelled");
            Check.equal(-100, bot.out("gobilda", "targetPosition"), "a new target stays cancelled");
            Check.equal(0, bot.out("gobilda", "velocity"), "nonzero velocity stays cancelled");
            Check.equal(false, bot.out("servo", "pwm"), "servo pulse and PWM enable stay cancelled");
        } finally {
            Thread.interrupted();
        }
        SandbotHardware.afterStop(bot.map);
    }

    public static void testRuntimeFailSafeIgnoresInterrupt() {
        // 런타임의 fail safe(stopRequested·afterStop)는 실제로 끊기지 않는 이벤트 루프 스레드의 일이라, 부르는 스레드가 끊겨
        // 있어도 허브에 간다(비용 청구를 끈 채 돌아 잠금을 보지 않는다)
        Bot bot = new Bot(null, MOTORS + "            <Servo name=\"servo\" port=\"0\" />\n", null);
        DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
        Servo servo = bot.get(Servo.class, "servo");
        tetrix.setPower(0.5);
        servo.setPosition(0.3);
        Thread.currentThread().interrupt();
        try {
            Check.equal(0L, SimTestSupport.elapsed(() -> SandbotHardware.stopRequested(bot.map)), "fail safe costs no team time");
            Check.equal(0.0, bot.out("tetrix", "power"), "stopRequested fail safe stops the motor");
            Check.equal(false, bot.out("tetrix", "enabled"), "stopRequested fail safe disables the motor");
            Check.equal(false, bot.out("servo", "pwm"), "stopRequested fail safe turns servo PWM off");
            Check.isTrue(Thread.currentThread().isInterrupted(), "the fail safe leaves the interrupt");
            // 팀 코드로 돌아오면 다시 막힌다(charging을 되돌렸다)
            Check.equal(0, attempts(1, tetrix::getCurrentPosition, "team read after stopRequested"), "blocked again");

            Thread.interrupted();
            tetrix.setPower(0); // 안전한 명령: 다시 켠다
            Check.equal(true, bot.out("tetrix", "enabled"), "re-enabled before afterStop");
            Thread.currentThread().interrupt();
            SandbotHardware.afterStop(bot.map);
            Check.equal(false, bot.out("tetrix", "enabled"), "afterStop fail safe disables the motor");
        } finally {
            Thread.interrupted();
        }
    }

    // ---------------------------------------------------------------------------------------------
    // STOP과 진행 중인 명령(STOP을 싣는 틱 경계가 허브 명령의 비용 안에 떨어질 때)
    // ---------------------------------------------------------------------------------------------

    static final String SERVO = "            <Servo name=\"servo\" port=\"0\" />\n";

    /**
     * 런타임의 STOP(OpModeRunner.applyStop)을 앞으로 nth번째 charge 안에서 한다: 허브 fail safe(SandbotHardware.stopRequested),
     * 그다음 LinearOpMode면 OpMode 스레드를 끊는다(internalOnStopRequested). 반복 OpMode의 스레드는 끊기지 않는다.
     */
    static void stopDuringCharge(Bot bot, int nth, boolean linear) {
        CLOCK.duringCharge(nth, () -> {
            SandbotHardware.stopRequested(bot.map);
            if (linear) Thread.currentThread().interrupt();
        });
    }

    /** body가 흘린 가상 시간. STOP이 정말 그 안에서 왔는지도 본다. */
    static long elapsedWithStop(Runnable body, String message) {
        long elapsed = SimTestSupport.elapsed(body);
        Check.isTrue(!CLOCK.duringChargePending(), message + ": STOP came inside the call");
        return elapsed;
    }

    static String flavor(boolean linear) {
        return linear ? "LinearOpMode" : "iterative OpMode";
    }

    public static void testStopInsidePowerCommand() {
        // 실제는 진행 중인 명령이 이미 전선 위에 있고 fail safe는 그 뒤에 간다(OpModeManagerImpl.callActiveOpModeStop,
        // MessageKeyedLock). 그래서 fail safe가 마지막이다: 모터는 멈추고 꺼지며 LastKnown은 잊혀 있다. 명령 시도와 비용은 그대로다:
        // power 명령, 그 뒤 fail safe가 잊은 켜기(끊긴 LinearOpMode 스레드는 잠금 시도, 반복 OpMode 스레드는 위험하지 않아 보낸다).
        for (boolean linear : new boolean[] {true, false}) {
            String f = flavor(linear);
            Bot bot = new Bot(null, MOTORS, null);
            DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
            SimDcMotorController motors = SimHub.of(bot.get(LynxModule.class, "Control Hub")).motors;
            tetrix.setPower(0.5);
            try {
                stopDuringCharge(bot, 1, linear);
                Check.equal(ms(1.5) + (linear ? CLOCK_READ : ms(1.5)), elapsedWithStop(() -> tetrix.setPower(0.25), f),
                        f + ": the same commands as without the race");
                Check.equal(0.0, bot.out("tetrix", "power"), f + ": the fail safe stops the motor last");
                Check.equal(0.0, bot.out("tetrix", "apiPower"), f + ": apiPower after the fail safe");
                Check.equal(false, bot.out("tetrix", "enabled"), f + ": the fail safe disables the motor last");
                Thread.interrupted();
                // fail safe가 마지막이라 켜짐의 LastKnown도 잊혀 있어 허브에 묻는다
                Check.equal(ms(1.5), SimTestSupport.elapsed(
                        () -> Check.equal(false, motors.isMotorEnabled(1), f + ": the hub motor is disabled")),
                        f + ": lastKnownEnable is forgotten");
            } finally {
                Thread.interrupted();
                CLOCK.clearDuringCharge();
            }
            SandbotHardware.afterStop(bot.map);
        }
    }

    public static void testStopInsideEnableCommand() {
        // LastKnown이 신선도를 넘겨 setPower가 모드 묻기 → power → 켜기를 보내고, STOP은 켜기 명령 안에서 온다
        for (boolean linear : new boolean[] {true, false}) {
            String f = flavor(linear);
            Bot bot = new Bot(null, MOTORS, null);
            DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
            tetrix.setPower(0.5);
            CLOCK.nanos += ms(501);
            try {
                stopDuringCharge(bot, 3, linear);
                Check.equal(ms(3 * 1.5), elapsedWithStop(() -> tetrix.setPower(0.25), f),
                        f + ": mode read, power and enable as without the race");
                Check.equal(false, bot.out("tetrix", "enabled"), f + ": the enable in flight does not outlast the fail safe");
                Check.equal(0.0, bot.out("tetrix", "power"), f + ": the motor is stopped");
            } finally {
                Thread.interrupted();
                CLOCK.clearDuringCharge();
            }
            SandbotHardware.afterStop(bot.map);
        }
    }

    public static void testStopInsideVelocityCommand() {
        for (boolean linear : new boolean[] {true, false}) {
            String f = flavor(linear);
            Bot bot = new Bot(null, MOTORS, null);
            DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
            tetrix.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
            tetrix.setVelocity(200);
            Check.equal(200, bot.out("tetrix", "velocity"), f + ": running at the target velocity");
            try {
                stopDuringCharge(bot, 1, linear);
                Check.equal(ms(1.5) + (linear ? CLOCK_READ : ms(1.5)), elapsedWithStop(() -> tetrix.setVelocity(300), f),
                        f + ": velocity, then the enable the fail safe forgot");
                Check.equal(0, bot.out("tetrix", "velocity"), f + ": the target velocity in flight does not outlast the fail safe");
                Check.equal(0.0, bot.out("tetrix", "power"), f + ": the motor is stopped");
                Check.equal(false, bot.out("tetrix", "enabled"), f + ": the motor is disabled");
            } finally {
                Thread.interrupted();
                CLOCK.clearDuringCharge();
            }
            SandbotHardware.afterStop(bot.map);
        }
    }

    public static void testStopInsideModeCommandKeepsTheMode() {
        // fail safe는 모드를 지우지 않으므로 진행 중이던 모드 명령은 허브에 남는다. setMotorMode가 이어서 다시 보내는 power 0·켜기는
        // 같은 호출이라 fail safe가 덮는다(반복 OpMode 스레드는 그 명령을 보내도 모터가 다시 켜지지 않는다).
        for (boolean linear : new boolean[] {true, false}) {
            String f = flavor(linear);
            Bot bot = new Bot(null, MOTORS, null);
            DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
            SimDcMotorController motors = SimHub.of(bot.get(LynxModule.class, "Control Hub")).motors;
            tetrix.setPower(0);
            Check.equal(true, bot.out("tetrix", "enabled"), f + ": enabled at zero power");
            try {
                // zero power 묻기(1) → 모드 명령(2) 안에서 STOP → 목표 속도 0(끊긴 스레드는 잠금 시도) → 켜기
                stopDuringCharge(bot, 2, linear);
                Check.equal(ms(2 * 1.5) + (linear ? CLOCK_READ : ms(2 * 1.5)),
                        elapsedWithStop(() -> tetrix.setMode(DcMotor.RunMode.RUN_USING_ENCODER), f),
                        f + ": the same commands as without the race");
                Check.equal("RUN_USING_ENCODER", bot.out("tetrix", "mode"), f + ": the mode in flight reached the hub");
                Check.equal(0.0, bot.out("tetrix", "power"), f + ": the motor is stopped");
                Check.equal(false, bot.out("tetrix", "enabled"), f + ": the power re-sent by setMode does not re-enable the motor");
                Thread.interrupted();
                Check.equal(ms(1.5), SimTestSupport.elapsed(() -> Check.equal(DcMotor.RunMode.RUN_USING_ENCODER,
                        motors.getMotorMode(1), f + ": the hub kept the new mode")), f + ": lastKnownMode is forgotten");
            } finally {
                Thread.interrupted();
                CLOCK.clearDuringCharge();
            }
            SandbotHardware.afterStop(bot.map);
        }
    }

    public static void testStopInsideServoCommands() {
        for (boolean linear : new boolean[] {true, false}) {
            String f = flavor(linear);
            // PWM 켜기 명령 안에서 STOP: 켜기가 먼저 허브에 갔고 fail safe가 PWM을 끈다
            Bot bot = new Bot(null, SERVO, null);
            Servo servo = bot.get(Servo.class, "servo");
            SimServoController servos = SimHub.of(bot.get(LynxModule.class, "Control Hub")).servos;
            servo.setPosition(0.3);
            servos.setServoPwmDisable(0);
            try {
                stopDuringCharge(bot, 1, linear);
                Check.equal(ms(1.5), elapsedWithStop(() -> servos.setServoPwmEnable(0), f), f + ": one PWM enable");
                Check.equal(false, bot.out("servo", "pwm"), f + ": the PWM enable in flight does not outlast the fail safe");
                Check.equal(null, bot.out("servo", "position"), f + ": no position while PWM is off");
            } finally {
                Thread.interrupted();
                CLOCK.clearDuringCharge();
            }
            SandbotHardware.afterStop(bot.map);

            // 펄스 폭 명령 안에서 STOP: fail safe는 PWM만 끄므로 펄스 폭은 허브에 남고, 뒤따르는 PWM 켜기는 STOP 뒤의 규칙으로
            // 보내지 않는다(끊김 또는 위험한 명령, 잠금 시도 한 번)
            Bot next = new Bot(null, SERVO, null);
            Servo servo2 = next.get(Servo.class, "servo");
            SimServoController servos2 = SimHub.of(next.get(LynxModule.class, "Control Hub")).servos;
            servo2.setPosition(0.3);
            try {
                stopDuringCharge(next, 1, linear);
                Check.equal(ms(1.5) + CLOCK_READ, elapsedWithStop(() -> servo2.setPosition(0.6), f),
                        f + ": the pulse, then a cancelled PWM enable");
                Check.equal(false, next.out("servo", "pwm"), f + ": PWM stays off");
                Thread.interrupted();
                Check.equal(1680.0, servos2.getPulseWidth(0), f + ": the pulse width in flight reached the hub");
            } finally {
                Thread.interrupted();
                CLOCK.clearDuringCharge();
            }
            SandbotHardware.afterStop(next.map);
        }
    }

    /** 지금까지 남은 RobotLog 줄 수(가짜 호스트) */
    static int logCount() {
        return ((SimTestSupport.FakeHost) org.sandbot.sim.Sim.host()).logs.size();
    }

    /** from번째 줄부터의 RobotLog 줄 */
    static List<String> logsSince(int from) {
        List<String> logs = ((SimTestSupport.FakeHost) org.sandbot.sim.Sim.host()).logs;
        synchronized (logs) {
            return new ArrayList<>(logs.subList(from, logs.size()));
        }
    }

    /** body가 실제 lockInterruptibly처럼 InterruptedException을 던지고 끊김을 지웠는지(잠금 시도 한 번) */
    static void throwsInterrupted(Check.Body body, String message) {
        Thread.currentThread().interrupt();
        long start = CLOCK.nanos;
        Check.throwsType(InterruptedException.class, body, message);
        Check.equal(CLOCK_READ, CLOCK.nanos - start, message + ": one lock attempt");
        Check.isTrue(!Thread.currentThread().isInterrupted(), message + ": the interrupt is cleared (lockInterruptibly)");
    }

    public static void testInterruptedThreadLynxModule() {
        // 실제 LynxModule(12.0)의 catch 블록: ADC 읽기는 handleException(다시 끊음) 뒤 LynxUsbUtil.makePlaceholderValue(0.0)
        // (단위를 바꾸지 않은 0.0), 펌웨어 문자열은 null, LED 패턴은 버림. throws InterruptedException인 failSafe·
        // enablePhoneCharging·isPhoneChargingEnabled·setDebug는 send()의 InterruptedException을 그대로 넘기고(끊김은 지워진다),
        // getRevProductNumber는 그것을 잡아 로그를 남기고 EXPANSION_HUB_PRODUCT_NUMBER를 돌려준다(끊김은 지워진 채).
        Bot bot = new Bot(null, MOTORS, null);
        LynxModule module = bot.get(LynxModule.class, "Control Hub");
        DcMotorEx tetrix = bot.get(DcMotorEx.class, "tetrix");
        tetrix.setPower(0.5);
        bot.in("Control Hub", "voltage", 11.8);
        bot.in("Control Hub", "current", 3.0);
        bot.in("Control Hub", "temperature", 30.0);
        module.setConstant(0xFF00FF00);
        String[] names = {"Control Hub", "gobilda", "tetrix", "hex"};
        Map<String, Object> before = outputsOf(bot, names);

        Thread.currentThread().interrupt();
        try {
            Check.equal(0.0, attempts(1, () -> module.getInputVoltage(org.firstinspires.ftc.robotcore.external.navigation.VoltageUnit.VOLTS),
                    "battery"), "battery voltage placeholder 0.0");
            Check.equal(0.0, attempts(1, () -> module.getCurrent(CurrentUnit.AMPS), "current"), "hub current placeholder 0.0");
            Check.equal(0.0, attempts(1, () -> module.getGpioBusCurrent(CurrentUnit.AMPS), "GPIO"), "GPIO current placeholder 0.0");
            Check.equal(0.0, attempts(1, () -> module.getI2cBusCurrent(CurrentUnit.AMPS), "I2C"), "I2C current placeholder 0.0");
            Check.equal(0.0, attempts(1, () -> module.getAuxiliaryVoltage(org.firstinspires.ftc.robotcore.external.navigation.VoltageUnit.VOLTS),
                    "5 V"), "5 V rail placeholder 0.0");
            Check.equal(0.0, attempts(1, () -> module.getTemperature(org.firstinspires.ftc.robotcore.external.navigation.TempUnit.FARENHEIT),
                    "temperature"), "temperature placeholder is 0.0 in any unit (not 32 °F)");
            Check.equal(null, attempts(1, module::getNullableFirmwareVersionString, "firmware"), "firmware version null");
            Check.equal("firmware version unavailable", attempts(1, module::getFirmwareVersionString, "firmware string"),
                    "firmware version unavailable");
            attemptsRun(1, () -> module.setConstant(0xFFFF0000), "LED pattern");
            Check.equal(1, module.getPattern().size(), "the pattern is remembered before the send");
            Check.isTrue(attempts(1, module::getBulkData, "bulk").isFake(), "LynxModule.getBulkData is fake");
            Check.equal(before, outputsOf(bot, names), "nothing reached the hub");
            Check.isTrue(Thread.currentThread().isInterrupted(), "handleException re-interrupts");
        } finally {
            Thread.interrupted();
        }

        Object power = bot.out("tetrix", "power");
        throwsInterrupted(module::failSafe, "team failSafe");
        Check.equal(power, bot.out("tetrix", "power"), "the team fail safe was not sent");
        throwsInterrupted(() -> module.enablePhoneCharging(true), "enablePhoneCharging");
        throwsInterrupted(module::isPhoneChargingEnabled, "isPhoneChargingEnabled");
        throwsInterrupted(() -> module.setDebug(LynxModule.DebugGroup.MOTOR0, LynxModule.DebugVerbosity.HIGH), "setDebug");

        // attemptFailSafeAndIgnoreErrors는 InterruptedException을 삼켜 끊김이 지워진다(실제와 같다)
        Thread.currentThread().interrupt();
        Check.equal(CLOCK_READ, SimTestSupport.elapsed(module::attemptFailSafeAndIgnoreErrors), "attemptFailSafeAndIgnoreErrors: one attempt");
        Check.isTrue(!Thread.currentThread().isInterrupted(), "attemptFailSafeAndIgnoreErrors swallows the interrupt");
        Check.equal(power, bot.out("tetrix", "power"), "the fail safe was not sent");

        int logs = logCount();
        Thread.currentThread().interrupt();
        Check.equal(3215698, attempts(1, module::getRevProductNumber, "product number"), "EXPANSION_HUB_PRODUCT_NUMBER");
        Check.isTrue(!Thread.currentThread().isInterrupted(), "getRevProductNumber catches the InterruptedException");
        List<String> lines = logsSince(logs);
        Check.isTrue(!lines.isEmpty() && lines.get(0).equals("robotLog: E/LynxModule: Failed to determine the REV product number"),
                "getRevProductNumber logs the failure: " + lines);
        // getImuType은 먼저 getRevProductNumber를 묻는다: 끊김이 지워져 다음 명령은 간다
        Thread.currentThread().interrupt();
        Check.equal(com.qualcomm.robotcore.hardware.LynxModuleImuType.NONE, attempts(1, module::getImuType, "IMU type"),
                "IMU type from the configuration");
        Check.isTrue(!Thread.currentThread().isInterrupted(), "getImuType clears the interrupt through getRevProductNumber");
        bot.in("Control Hub", "voltage", 12.2);
        Check.near(12.2, module.getInputVoltage(org.firstinspires.ftc.robotcore.external.navigation.VoltageUnit.VOLTS), 1e-9,
                "commands reach the hub again");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testInterruptedThreadI2cPlaceholders() {
        // 실제 LynxI2cDeviceSynch(V2): 끊긴 스레드의 읽기는 TimestampedI2cData.makeFakeData(모두 0)이고
        // readTimeStampedPlaceholder가 "placeholder: readTimestamped"를 한 번만 남긴다(보낸 읽기가 되살림). 쓰기는 버린다.
        // 옮긴 실제 드라이버는 그 0을 받아 로봇에서와 같이 동작한다.
        Bot bot = new Bot(null, I2C, null);
        DistanceSensor distance = bot.get(DistanceSensor.class, "distance");
        RevColorSensorV3 color = bot.get(RevColorSensorV3.class, "color");
        SparkFunOTOS otos = bot.get(SparkFunOTOS.class, "otos");
        OctoQuad octoquad = bot.get(OctoQuad.class, "octoquad");
        GoBildaPinpointDriver pinpoint = bot.get(GoBildaPinpointDriver.class, "pinpoint");
        SimI2cDeviceSynch client = (SimI2cDeviceSynch) ((com.qualcomm.robotcore.hardware.I2cDeviceSynchDevice<?>) distance).getDeviceClient();
        bot.in("distance", "distance", 0.5);
        bot.in("color", "red", 4000L);
        bot.in("color", "distance", 0.05);
        CLOCK.nanos += ms(200);
        Check.near(500, distance.getDistance(DistanceUnit.MM), 1e-9, "a real reading first");
        String[] names = {"distance", "color", "otos", "octoquad", "pinpoint"};
        Map<String, Object> before = outputsOf(bot, names);

        int logs = logCount();
        Thread.currentThread().interrupt();
        try {
            byte[] bytes = attempts(1, () -> client.read(0x14, 12), "register read");
            Check.equal(Arrays.toString(new byte[12]), Arrays.toString(bytes), "makeFakeData: creg zero bytes");
            Check.isTrue(client.lastReadWasPlaceholder(), "the read was a placeholder");
            Check.equal(Arrays.toString(new byte[3]), Arrays.toString(attempts(1, () -> client.read(3), "plain read")),
                    "non-register read: zero bytes");
            com.qualcomm.robotcore.hardware.TimestampedData stamped = attempts(1, () -> client.readTimeStamped(0x14, 2), "timestamped");
            Check.equal(CLOCK.nanos, stamped.nanoTime, "fake data time is the time of the failed read");
            attemptsRun(1, () -> client.write8(0x00, 0x01), "write");
            Check.equal(Arrays.asList("robotLog: E/LynxI2cDeviceSynch: placeholder: readTimestamped"), logsSince(logs),
                    "the placeholder is logged once");

            // VL53L0X: 0인 상태 레지스터에 끊긴 스레드라 FAKE_DISTANCE_MM(65535)
            Check.near(65535, distance.getDistance(DistanceUnit.MM), 1e-9, "VL53L0X fails fast on an interrupted thread");
            // Color Sensor V3: 0 바이트라 색 0, 근접 0이라 최대 거리 6 in
            Check.equal(0, color.red(), "color red 0");
            Check.near(6.0, color.getDistance(DistanceUnit.INCH), 1e-9, "proximity 0 is the 6 in maximum");
            Check.isTrue(!otos.isConnected(), "OTOS product id reads 0");
            Check.equal((byte) 0, octoquad.getChipId(), "OctoQuad chip id reads 0");
            // 쓰기는 버린다
            otos.setLinearScalar(1.05);
            pinpoint.setOffsets(10, 20, DistanceUnit.MM);
            Check.equal(before, outputsOf(bot, names), "no write reached a chip");
            Check.isTrue(Thread.currentThread().isInterrupted(), "still interrupted");
        } finally {
            Thread.interrupted();
        }
        // 보낸 읽기가 자리값 로그를 되살린다
        Check.isTrue(client.read(0x14, 2) != null && !client.lastReadWasPlaceholder(), "a real read");
        logs = logCount();
        Thread.currentThread().interrupt();
        try {
            client.read(0x14, 2);
            client.read(0x14, 2);
        } finally {
            Thread.interrupted();
        }
        Check.equal(Arrays.asList("robotLog: E/LynxI2cDeviceSynch: placeholder: readTimestamped"), logsSince(logs),
                "logged again once after a real read");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testInterruptedThreadImu() {
        // 실제 BHI260IMU·BNO055IMUNew: 모두 0인 쿼터니언은 FailedToRetrieveQuaternionException이고 QuaternionBasedImuHelper가
        // 경고와 단위 사원수를 낸다(요·피치·롤 0). 각속도는 0 바이트 그대로 0. resetYaw는 시간 제한까지 다시 읽고 마지막 방향을 쓴다.
        // initialize는 칩 확인 읽기가 0이라 실패한다.
        Bot bot = new Bot("            <LynxEmbeddedIMU name=\"imu2\" port=\"0\" bus=\"0\" />\n",
                "            <ControlHubImuBHI260AP name=\"imu\" port=\"0\" bus=\"0\" />\n", null);
        IMU bhi = bot.get(IMU.class, "imu");
        IMU bno = bot.get(IMU.class, "imu2");
        bot.in("imu", "yaw", Math.toRadians(30));
        bot.in("imu", "pitch", Math.toRadians(10));
        bot.in("imu", "yawRate", 1.0);
        bot.in("imu2", "yaw", Math.toRadians(-40));
        Check.near(30, bhi.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-3, "a real yaw first");

        int logs = logCount();
        Thread.currentThread().interrupt();
        try {
            YawPitchRollAngles angles = attempts(1, bhi::getRobotYawPitchRollAngles, "BHI260 orientation");
            Check.near(0, Math.abs(angles.getYaw(AngleUnit.DEGREES)) + Math.abs(angles.getPitch(AngleUnit.DEGREES))
                    + Math.abs(angles.getRoll(AngleUnit.DEGREES)), 0, "identity quaternion: yaw, pitch, roll 0");
            Check.equal(0L, angles.getAcquisitionTime(), "the identity quaternion has acquisition time 0");
            Check.near(0, attempts(1, () -> bno.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), "BNO055 yaw"), 0,
                    "BNO055 yaw 0");
            Check.equal(0.0f, attempts(1, () -> bhi.getRobotAngularVelocity(AngleUnit.DEGREES), "rate").zRotationRate,
                    "angular velocity from zero bytes");
            Check.equal(Arrays.asList(
                    "robotLog: E/LynxI2cDeviceSynch: placeholder: readTimestamped",
                    "robotLog: W/BHI260IMU: getRobotOrientationAsQuaternion(): Failed to retrieve valid quaternion from IMU. Returning the identity quaternion.",
                    "robotLog: E/LynxI2cDeviceSynch: placeholder: readTimestamped",
                    "robotLog: W/BNO055IMU (new): getRobotOrientationAsQuaternion(): Failed to retrieve valid quaternion from IMU. Returning the identity quaternion."),
                    logsSince(logs), "placeholder log per client and helper warnings with the real tags");

            // resetYaw: 50 ms까지 다시 읽고 경고 뒤 마지막(30°)으로 오프셋을 정한다
            long start = CLOCK.nanos;
            logs = logCount();
            bhi.resetYaw();
            Check.isTrue(CLOCK.nanos - start >= ms(50), "resetYaw retries until its timeout");
            Check.equal("robotLog: W/BHI260IMU: Failed to retrieve valid quaternion for resetYaw(). Using stale orientation to compute yaw offset.",
                    logsSince(logs).get(logsSince(logs).size() - 1), "resetYaw warns");

            // initialize: 칩 확인 읽기가 0
            logs = logCount();
            Check.isTrue(!attempts(1, () -> bhi.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                    RevHubOrientationOnRobot.LogoFacingDirection.UP, RevHubOrientationOnRobot.UsbFacingDirection.FORWARD))), "BHI260 init"),
                    "BHI260 initialize fails");
            Check.equal("robotLog: E/BHI260IMU: Could not find Control Hub IMU (BHI260AP)", logsSince(logs).get(0), "BHI260 init log");
            logs = logCount();
            Check.isTrue(!attempts(2, () -> bno.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                    RevHubOrientationOnRobot.LogoFacingDirection.UP, RevHubOrientationOnRobot.UsbFacingDirection.FORWARD))), "BNO055 init"),
                    "BNO055 initialize fails after the retry read");
            Check.equal("robotLog: E/BNO055IMU (new): Failed to initialize BNO055 IMU", logsSince(logs).get(0), "BNO055 init log");
            Check.isTrue(Thread.currentThread().isInterrupted(), "still interrupted");
        } finally {
            Thread.interrupted();
        }
        // resetYaw가 마지막 방향(30°)으로 오프셋을 정했다
        bot.in("imu", "yaw", Math.toRadians(50));
        Check.near(20, bhi.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-3, "the stale orientation set the offset");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testInterruptedThreadLegacyBno055() {
        // 실제 BNO055IMUImpl은 0 바이트를 그대로 해석한다: Euler 0이라 heading −0, 0 쿼터니언은 단위 사원수, 각속도 X·Y는 부호를
        // 바꿔 −0, 중력 0, 온도 0, 보정 상태 0, 상태 IDLE. initialize는 CHIP_ID가 0이라 실패하고 매개변수를 되돌린다.
        Bot bot = new Bot(null, BNO055, null);
        BNO055IMU legacy = bot.get(BNO055IMU.class, "imu");
        BNO055IMU.Parameters parameters = new BNO055IMU.Parameters();
        parameters.angleUnit = BNO055IMU.AngleUnit.DEGREES;
        parameters.loggingEnabled = true;
        parameters.loggingTag = "legacy";
        Check.isTrue(legacy.initialize(parameters), "initialize");
        bot.in("imu", "yaw", Math.toRadians(30));
        bot.in("imu", "yawRate", 1.0);
        Check.isTrue(legacy.isGyroCalibrated(), "calibrated on a live thread");

        int logs = logCount();
        Thread.currentThread().interrupt();
        try {
            Orientation o = attempts(1, legacy::getAngularOrientation, "orientation");
            Check.equal(Arrays.asList(-0.0f, 0.0f, 0.0f), Arrays.asList(o.firstAngle, o.secondAngle, o.thirdAngle),
                    "Euler zeros: heading is -0");
            org.firstinspires.ftc.robotcore.external.navigation.Quaternion q = attempts(1, legacy::getQuaternionOrientation, "quaternion");
            Check.equal(Arrays.asList(1.0f, 0.0f, 0.0f, 0.0f, 0L), Arrays.<Object>asList(q.w, q.x, q.y, q.z, q.acquisitionTime),
                    "identity quaternion");
            AngularVelocity rates = attempts(1, legacy::getAngularVelocity, "rates");
            Check.equal(Arrays.asList(-0.0f, -0.0f, 0.0f), Arrays.asList(rates.xRotationRate, rates.yRotationRate, rates.zRotationRate),
                    "X and Y are negated zeros");
            Acceleration gravity = attempts(1, legacy::getGravity, "gravity");
            Check.equal(Arrays.asList(0.0, 0.0, 0.0), Arrays.asList(gravity.xAccel, gravity.yAccel, gravity.zAccel), "gravity zeros");
            Check.equal(0.0, attempts(1, legacy::getTemperature, "temperature").temperature, "temperature 0");
            Check.equal(BNO055IMU.SystemStatus.IDLE, attempts(1, legacy::getSystemStatus, "status"), "status IDLE");
            Check.equal(false, attempts(1, legacy::isGyroCalibrated, "calibrated"), "CALIB_STAT 0: not calibrated");
            Check.equal(0, (int) attempts(1, legacy::getCalibrationStatus, "calibration").calibrationStatus, "calibration status 0");
            Check.equal(Arrays.asList(
                    "robotLog: E/LynxI2cDeviceSynch: placeholder: readTimestamped",
                    "robotLog: W/legacy: Failed to retrieve valid quaternion. Returning identity quaternion."),
                    logsSince(logs), "one placeholder log and the loggingEnabled warning");

            logs = logCount();
            BNO055IMU.Parameters other = parameters.clone();
            other.angleUnit = BNO055IMU.AngleUnit.RADIANS;
            Check.isTrue(!attempts(2, () -> legacy.initialize(other), "initialize"), "initialize fails: CHIP_ID reads 0 twice");
            Check.equal(BNO055IMU.AngleUnit.DEGREES, legacy.getParameters().angleUnit, "the previous parameters stay");
            Check.equal(Arrays.asList("robotLog: E/legacy: IMU appears to not be present", "robotLog: E/legacy: IMU initialization failed"),
                    logsSince(logs).subList(0, 2), "loggingEnabled initialization logs");
        } finally {
            Thread.interrupted();
        }
        // 실패한 initialize는 칩을 리셋하지 않았다(heading 그대로)
        Check.near(30, legacy.getAngularOrientation().firstAngle, 1e-3, "the chip was not reset");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testEncoderOffsetGivesRawRunToPositionTarget() {
        // 시뮬레이터는 원시 엔코더 틱(position 입력)으로 모터를 돌리므로 RUN_TO_POSITION의 원시 목표를 targetPosition +
        // encoderOffset으로 만든다. 팀 코드가 한 루프에서 리셋 → 목표 → RUN_TO_POSITION을 해도(틱 하나 안) 맞아야 한다.
        Bot bot = new Bot(null, MOTORS, null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        Check.equal(0L, bot.out("gobilda", "encoderOffset"), "encoder offset starts at 0 and is always sent");
        Check.equal(0L, bot.out("tetrix", "encoderOffset"), "every motor port sends its offset");
        bot.in("gobilda", "position", 700L);
        gobilda.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        gobilda.setTargetPosition(300);
        gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        gobilda.setPower(0.5);
        Check.equal(700L, bot.out("gobilda", "encoderOffset"), "offset is the raw position at the reset");
        Check.equal(0, gobilda.getCurrentPosition(), "team code sees zero after the reset");
        // goBILDA(CCW) FORWARD: 허브 목표는 −300, 원시 목표 = −300 + 700 = 400
        long rawTarget = ((Number) bot.out("gobilda", "targetPosition")).longValue()
                + ((Number) bot.out("gobilda", "encoderOffset")).longValue();
        Check.equal(400L, rawTarget, "raw target = targetPosition + encoderOffset");
        Check.isTrue(gobilda.isBusy(), "busy before the raw target");
        bot.in("gobilda", "position", rawTarget);
        Check.isTrue(!gobilda.isBusy(), "not busy at the raw target");
        Check.equal(300, gobilda.getCurrentPosition(), "team code sees its target");
        // 다음 OpMode의 초기화(resetDeviceConfigurationForOpMode)는 오프셋을 지우지 않는다(허브 엔코더는 계속 센다)
        SandbotHardware.afterStop(bot.map);
        SandbotHardware.beforeInit(bot.map);
        Check.equal(700L, bot.out("gobilda", "encoderOffset"), "offset survives the next OpMode");
        Check.equal(300, gobilda.getCurrentPosition(), "encoder keeps counting from the reset");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testEncoderResetsCountEveryReset() {
        // 데드휠과 포트를 함께 쓰면 position은 포드 값이라 로봇이 서 있으면 리셋해도 encoderOffset이 같다. 한 루프에서
        // 리셋 → RUN_TO_POSITION을 하면 틱 경계의 mode도 STOP_AND_RESET_ENCODER를 보이지 않으므로 리셋 횟수를 늘 보낸다.
        Bot bot = new Bot(null, MOTORS, null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        Check.equal(0L, bot.out("gobilda", "encoderResets"), "reset count starts at 0 and is always sent");
        Check.equal(0L, bot.out("tetrix", "encoderResets"), "every motor port sends its reset count");
        for (long n = 1; n <= 2; n++) {
            gobilda.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            gobilda.setTargetPosition(300);
            gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION);
            gobilda.setPower(0.5);
            Check.equal("RUN_TO_POSITION", bot.out("gobilda", "mode"), "the reset is no longer visible in mode");
            Check.equal(0L, bot.out("gobilda", "encoderOffset"), "raw position unchanged: same offset");
            Check.equal(n, bot.out("gobilda", "encoderResets"), "every reset counts");
        }
        Check.equal(0L, bot.out("tetrix", "encoderResets"), "other ports do not count");
        SandbotHardware.afterStop(bot.map);
        SandbotHardware.beforeInit(bot.map);
        Check.equal(2L, bot.out("gobilda", "encoderResets"), "count survives the next OpMode");
        gobilda.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        Check.equal(3L, bot.out("gobilda", "encoderResets"), "a reset in the next OpMode counts on");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testVelocityControlAndPidf() {
        Bot bot = new Bot(null, MOTORS, null);
        DcMotorEx hex = bot.get(DcMotorEx.class, "hex");
        // REV HD Hex도 CCW 형식이라 FORWARD에서 허브 값의 부호가 바뀐다
        hex.setVelocity(300);
        Check.equal("RUN_USING_ENCODER", bot.out("hex", "mode"), "setVelocity switches to RUN_USING_ENCODER");
        Check.equal(-300, bot.out("hex", "velocity"), "target velocity output (hub ticks/s)");
        hex.setVelocity(1, AngleUnit.RADIANS);
        double ticksPerRev = hex.getMotorType().getTicksPerRev();
        Check.equal(-(int) Math.round(ticksPerRev / (2 * Math.PI)), bot.out("hex", "velocity"), "angular velocity");
        bot.in("hex", "velocity", 250L);
        Check.equal(-250.0, hex.getVelocity(), "measured velocity input (hub ticks/s)");
        hex.setPIDFCoefficients(DcMotor.RunMode.RUN_USING_ENCODER, new PIDFCoefficients(12, 1.5, 0.25, 13));
        PIDFCoefficients pidf = hex.getPIDFCoefficients(DcMotor.RunMode.RUN_USING_ENCODER);
        Check.near(12, pidf.p, 1e-4, "p");
        Check.near(1.5, pidf.i, 1e-4, "i");
        Check.near(13, pidf.f, 1e-4, "f");
        bot.in("hex", "current", 2.5);
        Check.near(2500, hex.getCurrent(org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit.MILLIAMPS), 1e-6, "current");
        hex.setCurrentAlert(2, org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit.AMPS);
        Check.isTrue(hex.isOverCurrent(), "over the current alert");
        SandbotHardware.afterStop(bot.map);
    }

    static final String PIDF_MOTORS =
            "            <goBILDA5202SeriesMotor name=\"gobilda\" port=\"0\" />\n"
            + "            <RevRoboticsCoreHexMotor name=\"coreHex\" port=\"1\" />\n";

    /** 허브 고정소수점(×65536 반올림)으로 보낸 뒤 읽힌 계수(실제 LynxSetMotorPIDControlLoopCoefficientsCommand) */
    static List<Double> hubPidf(double p, double i, double d, double f) {
        List<Double> result = new ArrayList<>();
        for (double c : new double[] {p, i, d, f})
            result.add(SimDcMotorController.externalCoefficientFromInternal(SimDcMotorController.internalCoefficientFromExternal(c)));
        return result;
    }

    public static void testPidfOutputs() {
        Bot bot = new Bot(null, PIDF_MOTORS, null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        DcMotorEx coreHex = bot.get(DcMotorEx.class, "coreHex");
        // 받은 적 없으면 펌웨어 기본값(LegacyPID 속도 P10 I3, 위치 P10 I0.05). 0.05는 3277/65536으로 읽힌다.
        Check.equal(hubPidf(10, 3, 0, 0), bot.out("gobilda", "velocityPidf"), "default velocity coefficients are always sent");
        Check.equal(hubPidf(10, 0.05, 0, 0), bot.out("gobilda", "positionPidf"), "default position coefficients are always sent");
        Check.equal(0.0500030517578125, ((List<?>) bot.out("gobilda", "positionPidf")).get(1), "hub fixed point");
        Check.equal("LegacyPID", bot.out("gobilda", "velocityAlgorithm"), "default velocity algorithm");
        Check.equal("LegacyPID", bot.out("gobilda", "positionAlgorithm"), "default position algorithm");
        // Core Hex 형식 주석(@ExpansionHubMotorControllerVelocityParams·PositionParams)이 setMotorType 때 보낸 값
        Check.equal(hubPidf(10, 3, 0, 0), bot.out("coreHex", "velocityPidf"), "Core Hex type velocity params");
        Check.equal(hubPidf(10, 0.05, 0, 0), bot.out("coreHex", "positionPidf"), "Core Hex type position params");
        // DcMotorEx.setVelocityPIDFCoefficients: RUN_USING_ENCODER, PIDF 알고리즘
        gobilda.setVelocityPIDFCoefficients(1.17, 0.117, 0, 11.7);
        Check.equal(hubPidf(1.17, 0.117, 0, 11.7), bot.out("gobilda", "velocityPidf"), "team velocity PIDF");
        Check.equal("PIDF", bot.out("gobilda", "velocityAlgorithm"), "setVelocityPIDFCoefficients uses PIDF");
        PIDFCoefficients read = gobilda.getPIDFCoefficients(DcMotor.RunMode.RUN_USING_ENCODER);
        Check.equal(hubPidf(1.17, 0.117, 0, 11.7), Arrays.asList(read.p, read.i, read.d, read.f),
                "getPIDFCoefficients returns what the hub stored");
        Check.equal(hubPidf(10, 0.05, 0, 0), bot.out("gobilda", "positionPidf"), "position untouched");
        Check.equal(hubPidf(10, 3, 0, 0), bot.out("coreHex", "velocityPidf"), "other ports untouched");
        // DcMotorEx.setPositionPIDFCoefficients: RUN_TO_POSITION P만, PIDF 알고리즘
        gobilda.setPositionPIDFCoefficients(5);
        Check.equal(hubPidf(5, 0, 0, 0), bot.out("gobilda", "positionPidf"), "team position P");
        Check.equal("PIDF", bot.out("gobilda", "positionAlgorithm"), "setPositionPIDFCoefficients uses PIDF");
        // setPIDCoefficients는 F 0의 LegacyPID, 옛 모드 이름(RUN_USING_ENCODERS)도 받는다
        coreHex.setPIDCoefficients(DcMotor.RunMode.RUN_USING_ENCODERS, new PIDCoefficients(2, 0.5, 0.25));
        Check.equal(hubPidf(2, 0.5, 0.25, 0), bot.out("coreHex", "velocityPidf"), "setPIDCoefficients");
        Check.equal("LegacyPID", bot.out("coreHex", "velocityAlgorithm"), "setPIDCoefficients is LegacyPID");
        // setPIDFCoefficients 그대로, 음수도 부호를 지킨다
        coreHex.setPIDFCoefficients(DcMotor.RunMode.RUN_TO_POSITION, new PIDFCoefficients(-4, 0, 0, 0, MotorControlAlgorithm.LegacyPID));
        Check.equal(hubPidf(-4, 0, 0, 0), bot.out("coreHex", "positionPidf"), "setPIDFCoefficients");
        // PIDF 알고리즘의 RUN_TO_POSITION에 I·D·F를 주면 실제 SDK처럼 거부하고 허브 값은 그대로다
        boolean refused = false;
        try {
            gobilda.setPIDFCoefficients(DcMotor.RunMode.RUN_TO_POSITION, new PIDFCoefficients(5, 1, 0, 0));
        } catch (UnsupportedOperationException e) {
            refused = true;
        }
        Check.isTrue(refused, "unreasonable RUN_TO_POSITION coefficients are refused");
        Check.equal(hubPidf(5, 0, 0, 0), bot.out("gobilda", "positionPidf"), "refused coefficients are not sent");
        boolean badMode = false;
        try {
            gobilda.setPIDFCoefficients(DcMotor.RunMode.RUN_WITHOUT_ENCODER, new PIDFCoefficients(1, 0, 0, 0));
        } catch (IllegalArgumentException e) {
            badMode = true;
        }
        Check.isTrue(badMode, "RUN_WITHOUT_ENCODER is not a PID mode");
        // 다음 OpMode: SDK가 처음 쓰기 전의 계수(originalPIDParams)를 다시 보낸다(실제 resetDeviceConfigurationForOpMode)
        SandbotHardware.afterStop(bot.map);
        Check.equal(hubPidf(1.17, 0.117, 0, 11.7), bot.out("gobilda", "velocityPidf"), "fail safe keeps the hub coefficients");
        SandbotHardware.beforeInit(bot.map);
        Check.equal(hubPidf(10, 3, 0, 0), bot.out("gobilda", "velocityPidf"), "next OpMode restores the original velocity coefficients");
        Check.equal(hubPidf(10, 0.05, 0, 0), bot.out("gobilda", "positionPidf"), "next OpMode restores the original position coefficients");
        Check.equal("LegacyPID", bot.out("gobilda", "velocityAlgorithm"), "original algorithm restored");
        Check.equal(hubPidf(10, 3, 0, 0), bot.out("coreHex", "velocityPidf"), "Core Hex type params again");
        Check.equal(hubPidf(10, 0.05, 0, 0), bot.out("coreHex", "positionPidf"), "Core Hex type position params again");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testPidfNullAlgorithm() {
        // 알고리즘이 null이면 실제 SDK(InternalMotorControlAlgorithm.fromExternal의 switch)처럼 보내기 전에 던지고 허브 값·출력은
        // 그대로다. 실제 SDK는 그 계수를 desiredPIDParams에 남겨 다음 OpMode의 초기화에서도 던지므로 여기서 끝낸다.
        Bot bot = new Bot(null, PIDF_MOTORS, null);
        DcMotorEx gobilda = bot.get(DcMotorEx.class, "gobilda");
        boolean refused = false;
        try {
            gobilda.setPIDFCoefficients(DcMotor.RunMode.RUN_USING_ENCODER, new PIDFCoefficients(1, 0, 0, 0, null));
        } catch (NullPointerException e) {
            refused = true;
        }
        Check.isTrue(refused, "null algorithm is refused");
        Check.equal("LegacyPID", bot.out("gobilda", "velocityAlgorithm"), "hub algorithm unchanged");
        Check.equal(hubPidf(10, 3, 0, 0), bot.out("gobilda", "velocityPidf"), "hub coefficients unchanged");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testMeasuredVelocityIsBulkDataShort() {
        // 실제 LynxGetBulkInputDataResponse의 속도는 int16_t(short[] velocities)이고 getVelocity가 부호 확장해 돌려준다.
        // 캐시 없이(OFF) 읽어도 LynxGetBulkInputDataCommand라 같은 값이다(LynxDcMotorController.internalGetMotorTicksPerSecond).
        Bot bot = new Bot(null, MOTORS, null);
        DcMotorEx hex = bot.get(DcMotorEx.class, "hex");
        LynxModule hub = bot.get(LynxModule.class, "Control Hub");
        // REV HD Hex는 CCW 형식이라 FORWARD에서 팀 코드의 값은 허브 값의 반대다
        // 시뮬레이터 입력(감기 전) → 허브가 보고하는 short
        long[][] cases = {
            {32767, 32767}, {32768, -32768}, {40000, -25536}, {65560, 24}, {-40000, 25536}, {-32769, 32767}
        };
        for (long[] c : cases) {
            bot.in("hex", "velocity", c[0]);
            String label = "velocity input " + c[0];
            Check.equal((double) -c[1], hex.getVelocity(), label + " (OFF)");
            Check.near(Math.toDegrees(-c[1] / hex.getMotorType().getTicksPerRev() * 2 * Math.PI),
                    hex.getVelocity(AngleUnit.DEGREES), 1e-6, label + " (degrees)");
            hub.setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL);
            hub.clearBulkCache();
            Check.equal((int) c[1], hub.getBulkData().getMotorVelocity(2), label + " (bulk data)");
            Check.equal((double) -c[1], hex.getVelocity(), label + " (MANUAL)");
            hub.setBulkCachingMode(LynxModule.BulkCachingMode.OFF);
        }
        SandbotHardware.afterStop(bot.map);
    }

    // ---------------------------------------------------------------------------------------------
    // 서보 포트
    // ---------------------------------------------------------------------------------------------

    static final String SERVOS =
            "            <Servo name=\"servo\" port=\"0\" />\n"
            + "            <ContinuousRotationServo name=\"cr\" port=\"1\" />\n"
            + "            <RevSPARKMini name=\"spark\" port=\"2\" />\n"
            + "            <RevBlinkinLedDriver name=\"blinkin\" port=\"3\" />\n"
            + "            <ServoFullRange name=\"full\" port=\"4\" />\n";

    public static void testServoScaleDirectionAndPulse() {
        Bot bot = new Bot(null, SERVOS, null);
        Servo servo = bot.get(Servo.class, "servo");
        Check.equal(false, bot.out("servo", "pwm"), "PWM is off until the first position");
        Check.equal(null, bot.out("servo", "position"), "no position before the first command");
        servo.scaleRange(0.2, 0.8);
        servo.setDirection(Servo.Direction.REVERSE);
        servo.setPosition(0.25);
        Check.near(0.65, num(bot.out("servo", "position")), 1e-9, "scaled and reversed position");
        Check.equal(1770, bot.out("servo", "pulseUs"), "pulse 600 + 0.65 * 1800");
        Check.equal(true, bot.out("servo", "pwm"), "PWM on after a position");
        Check.near(0.25, servo.getPosition(), 1e-9, "getPosition in API terms");

        Servo full = bot.get(Servo.class, "full");
        full.setPosition(1);
        Check.equal(2500, bot.out("full", "pulseUs"), "full range servo pulse");

        servo.getController().pwmDisable();
        Check.equal(false, bot.out("servo", "pwm"), "pwmDisable");
        Check.equal(null, bot.out("servo", "position"), "no position while PWM is off");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testContinuousServosAndBlinkin() {
        Bot bot = new Bot(null, SERVOS, null);
        CRServo cr = bot.get(CRServo.class, "cr");
        cr.setPower(0.5);
        Check.near(0.5, num(bot.out("cr", "power")), 1e-9, "CR servo power");
        Check.equal(1950, bot.out("cr", "pulseUs"), "CR pulse");
        cr.setDirection(DcMotorSimple.Direction.REVERSE);
        cr.setPower(0.5);
        Check.near(-0.5, num(bot.out("cr", "power")), 1e-9, "reversed CR servo");

        DcMotorSimple spark = bot.get(DcMotorSimple.class, "spark");
        spark.setPower(-1);
        Check.near(-1.0, num(bot.out("spark", "power")), 1e-9, "SPARK Mini power");
        Check.equal(500, bot.out("spark", "pulseUs"), "SPARK Mini pulse");

        RevBlinkinLedDriver blinkin = bot.get(RevBlinkinLedDriver.class, "blinkin");
        blinkin.setPattern(RevBlinkinLedDriver.BlinkinPattern.RED);
        Check.equal("RED", bot.out("blinkin", "pattern"), "Blinkin pattern");
        blinkin.setPattern(RevBlinkinLedDriver.BlinkinPattern.RAINBOW_RAINBOW_PALETTE);
        Check.equal("RAINBOW_RAINBOW_PALETTE", bot.out("blinkin", "pattern"), "first pattern");

        SandbotHardware.afterStop(bot.map);
        Check.equal(false, bot.out("cr", "pwm"), "fail safe turns servo PWM off");
        Check.equal(null, bot.out("cr", "power"), "no CR power without PWM");
    }

    // ---------------------------------------------------------------------------------------------
    // 디지털·아날로그·전압
    // ---------------------------------------------------------------------------------------------

    static final String IO =
            "            <DigitalDevice name=\"digital\" port=\"0\" />\n"
            + "            <RevTouchSensor name=\"touch\" port=\"1\" />\n"
            + "            <Led name=\"led\" port=\"2\" />\n"
            + "            <AnalogInput name=\"analog\" port=\"3\" />\n";

    public static void testDigitalAnalogAndVoltage() {
        Bot bot = new Bot(null, IO, null);
        DigitalChannel digital = bot.get(DigitalChannel.class, "digital");
        Check.equal(DigitalChannel.Mode.INPUT, digital.getMode(), "pins start as inputs");
        Check.equal(true, digital.getState(), "pull-up reads HIGH");
        bot.in("digital", "state", false);
        Check.equal(false, digital.getState(), "state input");
        digital.setMode(DigitalChannel.Mode.OUTPUT);
        digital.setState(true);
        Check.equal("OUTPUT", bot.out("digital", "mode"), "mode output");
        Check.equal(true, bot.out("digital", "state"), "state output");

        TouchSensor touch = bot.get(TouchSensor.class, "touch");
        Check.isTrue(!touch.isPressed(), "not pressed by default");
        bot.in("touch", "pressed", true);
        Check.isTrue(touch.isPressed(), "pressed input");

        AnalogInput analog = bot.get(AnalogInput.class, "analog");
        bot.in("analog", "voltage", 1.2344);
        Check.near(1.234, analog.getVoltage(), 1e-9, "analog voltage in whole millivolts");
        Check.near(3.3, analog.getMaxVoltage(), 1e-9, "max voltage");

        VoltageSensor battery = bot.get(VoltageSensor.class, "Control Hub");
        Check.near(SimHub.DEFAULT_BATTERY_VOLTS, battery.getVoltage(), 1e-9, "default battery voltage");
        bot.in("Control Hub", "voltage", 11.8);
        Check.near(11.8, battery.getVoltage(), 1e-9, "battery voltage input");

        LynxModule hub = bot.get(LynxModule.class, "Control Hub");
        hub.setConstant(0xFF00FF00);
        Check.equal("#00FF00", bot.out("Control Hub", "led"), "hub LED color");
        hub.setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL);
        Check.equal("MANUAL", bot.out("Control Hub", "bulkCachingMode"), "bulk caching mode output");
        SandbotHardware.afterStop(bot.map);
    }

    // ---------------------------------------------------------------------------------------------
    // IMU
    // ---------------------------------------------------------------------------------------------

    public static void testImuYawResetAndMounting() {
        Bot bot = new Bot("            <LynxEmbeddedIMU name=\"imu2\" port=\"0\" bus=\"0\" />\n",
                "            <ControlHubImuBHI260AP name=\"imu\" port=\"0\" bus=\"0\" />\n", null);
        IMU imu = bot.get(IMU.class, "imu");
        Check.equal("BHI260AP", bot.out("imu", "chip"), "chip output");
        Check.equal("BNO055", bot.out("imu2", "chip"), "expansion chip output");
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.UP, RevHubOrientationOnRobot.UsbFacingDirection.FORWARD)));
        bot.in("imu", "yaw", Math.toRadians(30));
        Check.near(30, imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-3, "yaw before reset is the input");
        imu.resetYaw();
        Check.near(0, imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-3, "yaw after reset");
        bot.in("imu", "yaw", Math.toRadians(75));
        Check.near(45, imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-3, "yaw relative to the reset");
        bot.in("imu", "pitch", Math.toRadians(10));
        Check.near(10, imu.getRobotYawPitchRollAngles().getPitch(AngleUnit.DEGREES), 1e-3, "pitch");
        bot.in("imu", "yawRate", 1.0);
        Check.near(Math.toDegrees(1), imu.getRobotAngularVelocity(AngleUnit.DEGREES).zRotationRate, 1e-3, "yaw rate");

        // 허브를 옆으로 세워 달아도 로봇 기준 값은 같다(실제 RevHubOrientationOnRobot)
        IMU imu2 = bot.get(IMU.class, "imu2");
        imu2.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.LEFT, RevHubOrientationOnRobot.UsbFacingDirection.UP)));
        bot.in("imu2", "yaw", Math.toRadians(-20));
        bot.in("imu2", "pitch", Math.toRadians(5));
        Check.near(-20, imu2.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-2, "mounted hub yaw");
        Check.near(5, imu2.getRobotYawPitchRollAngles().getPitch(AngleUnit.DEGREES), 1e-2, "mounted hub pitch");
        SandbotHardware.afterStop(bot.map);
    }

    static final String BNO055 = "            <LynxEmbeddedIMU name=\"imu\" port=\"0\" bus=\"0\" />\n";

    public static void testLegacyBno055InitializeResetsHeading() {
        // 실제 BNO055IMUImpl.initialize는 칩을 리셋(SYS_TRIGGER 0x20)해 IMU 모드 융합을 다시 시작한다: heading은 그때부터 0이고
        // 피치·롤은 중력 기준이라 그대로다. 같은 칩을 읽는 IMU 인터페이스도 리셋된 칩 값을 본다.
        Bot bot = new Bot(null, BNO055, null);
        BNO055IMU legacy = bot.get(BNO055IMU.class, "imu");
        IMU imu = bot.get(IMU.class, "imu");
        BNO055IMU.Parameters parameters = new BNO055IMU.Parameters();
        parameters.angleUnit = BNO055IMU.AngleUnit.DEGREES;
        Check.isTrue(legacy.initialize(parameters), "initialize");
        bot.in("imu", "yaw", Math.toRadians(30));
        bot.in("imu", "pitch", Math.toRadians(10));
        Orientation before = legacy.getAngularOrientation();
        Check.near(30, before.firstAngle, 1e-3, "heading before the second initialize");
        // 로봇 피치는 칩 축의 둘째·셋째 각에 나뉜다(허브 안 칩 축 방향)
        Check.near(10, Math.hypot(before.secondAngle, before.thirdAngle), 1e-3, "chip tilt before");
        Check.near(30, imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-3, "IMU yaw before");

        Check.isTrue(legacy.initialize(parameters), "initialize again");
        Orientation after = legacy.getAngularOrientation();
        Check.near(0, after.firstAngle, 1e-3, "heading restarts at 0");
        Check.near(before.secondAngle, after.secondAngle, 1e-3, "tilt is gravity-referenced and stays (second)");
        Check.near(before.thirdAngle, after.thirdAngle, 1e-3, "tilt is gravity-referenced and stays (third)");
        Check.near(0, imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-3, "IMU view of the same chip");
        Check.near(10, imu.getRobotYawPitchRollAngles().getPitch(AngleUnit.DEGREES), 1e-3, "IMU pitch stays");
        bot.in("imu", "yaw", Math.toRadians(50));
        Check.near(20, legacy.getAngularOrientation().firstAngle, 1e-3, "heading counts from the reset");
        Check.near(20, imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-3, "IMU yaw counts from the reset");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testLegacyBno055AngularVelocitySigns() {
        // 실제 BNO055IMUImpl.getAngularVelocity는 레지스터 값(BNO055Util.getRawAngularVelocity)의 X·Y 부호를 바꾸고 Z는 그대로
        // 준다(IMU 인터페이스의 BNO055IMUNew는 바꾸지 않는다). 허브를 세워 달면 로봇 요 속도가 칩 X·Y 축에 나온다.
        Bot bot = new Bot(null, BNO055, null);
        BNO055IMU legacy = bot.get(BNO055IMU.class, "imu");
        SimImu imu = (SimImu) bot.get(IMU.class, "imu");
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.LEFT, RevHubOrientationOnRobot.UsbFacingDirection.UP)));
        BNO055IMU.Parameters parameters = new BNO055IMU.Parameters();
        parameters.angleUnit = BNO055IMU.AngleUnit.DEGREES;
        Check.isTrue(legacy.initialize(parameters), "initialize");
        bot.in("imu", "yawRate", 1.0);
        AngularVelocity raw = imu.chipAngularVelocity(imu.getDeviceClient()).toAngleUnit(AngleUnit.DEGREES);
        Check.isTrue(Math.abs(raw.xRotationRate) + Math.abs(raw.yRotationRate) > 30, "the yaw rate shows on a chip X/Y axis");
        AngularVelocity rates = legacy.getAngularVelocity();
        Check.near(-raw.xRotationRate, rates.xRotationRate, 1e-4, "legacy X is the negated register value");
        Check.near(-raw.yRotationRate, rates.yRotationRate, 1e-4, "legacy Y is the negated register value");
        Check.near(raw.zRotationRate, rates.zRotationRate, 1e-4, "legacy Z is the register value");
        AngularVelocity gyro = ((Gyroscope) legacy).getAngularVelocity(AngleUnit.DEGREES);
        Check.near(rates.xRotationRate, gyro.xRotationRate, 1e-4, "Gyroscope view X");
        Check.near(rates.yRotationRate, gyro.yRotationRate, 1e-4, "Gyroscope view Y");
        // IMU 인터페이스는 부호를 바꾸지 않은 레지스터 값으로 로봇 요 속도를 낸다
        Check.near(Math.toDegrees(1), imu.getRobotAngularVelocity(AngleUnit.DEGREES).zRotationRate, 1e-2, "IMU robot yaw rate");
        SandbotHardware.afterStop(bot.map);
    }

    /** from에서 to까지의 각도 차(°, (-180, 180]) */
    static double angleBetween(double from, double to) {
        double d = (to - from) % 360;
        if (d > 180) d -= 360;
        if (d <= -180) d += 360;
        return d;
    }

    public static void testLegacyBno055ResetOnEveryHubMount() {
        // 옛 initialize의 칩 리셋은 칩이 그 자리에서 전원을 켠 것과 같다. 허브를 세워 칩 X가 수직이어도
        // (칩 축 ZYX의 짐벌 잠금), 뒤집어도, 로봇이 기울어도 같은 칩을 읽는 IMU 인터페이스의 요는 0부터
        // 로봇 yaw를 그대로 따르고 피치·롤은 그대로다. 옛 heading(칩 축 ZYX의 첫째 각)은 리셋한 자리에서
        // 다시 세어 로봇 yaw만큼 돌고(허브 장착에 로봇이 수평이면 0부터), 기울기(둘째·셋째 각)는 그대로다.
        List<Object[]> mounts = new ArrayList<>(); // {이름, 장착, 허브 장착(로고·USB)인지, 칩 X가 수직인지}
        for (RevHubOrientationOnRobot.LogoFacingDirection logo : RevHubOrientationOnRobot.LogoFacingDirection.values()) {
            for (RevHubOrientationOnRobot.UsbFacingDirection usb : RevHubOrientationOnRobot.UsbFacingDirection.values()) {
                try {
                    // USB가 위·아래면 칩 X가 수직이다(팀은 SDK 변환이 잠기지 않는 ZXY로 바꿔 읽기도 한다)
                    boolean chipXVertical = usb == RevHubOrientationOnRobot.UsbFacingDirection.UP
                            || usb == RevHubOrientationOnRobot.UsbFacingDirection.DOWN;
                    mounts.add(new Object[] {logo + "/" + usb, new RevHubOrientationOnRobot(logo, usb), true, chipXVertical});
                } catch (IllegalArgumentException e) {
                    // 로고와 USB가 같은 축을 향하는 조합은 SDK가 받지 않는다
                }
            }
        }
        Check.equal(24, mounts.size(), "every valid hub mount");
        // 칩이 로봇에 기울어 달린 사용자 장착: 수평 로봇에서도 옛 heading이 0이 아닐 수 있지만 로봇 yaw만큼 돈다
        mounts.add(new Object[] {"xyz(180, 0, 45)",
                new RevHubOrientationOnRobot(RevHubOrientationOnRobot.xyzOrientation(180, 0, 45)), false, false});
        mounts.add(new Object[] {"xyz(30, 20, 10)",
                new RevHubOrientationOnRobot(RevHubOrientationOnRobot.xyzOrientation(30, 20, 10)), false, false});

        Bot bot = new Bot(null, BNO055, null);
        BNO055IMU legacy = bot.get(BNO055IMU.class, "imu");
        IMU imu = bot.get(IMU.class, "imu");
        BNO055IMU.Parameters parameters = new BNO055IMU.Parameters();
        parameters.angleUnit = BNO055IMU.AngleUnit.DEGREES;
        Check.isTrue(legacy.initialize(parameters), "first legacy initialize");
        for (Object[] mount : mounts) {
            boolean hubMount = (Boolean) mount[2], chipXVertical = (Boolean) mount[3];
            imu.initialize(new IMU.Parameters((RevHubOrientationOnRobot) mount[1]));
            for (double heading : new double[] {0, 40, 143, -100}) {
                for (double[] tilt : new double[][] {{0, 0}, {7, -4}}) { // 로봇 피치·롤(°)
                    boolean level = tilt[0] == 0 && tilt[1] == 0;
                    String where = " (" + mount[0] + ", heading " + heading + ", tilt " + tilt[0] + "/" + tilt[1] + ")";
                    bot.in("imu", "yaw", Math.toRadians(heading));
                    bot.in("imu", "pitch", Math.toRadians(tilt[0]));
                    bot.in("imu", "roll", Math.toRadians(tilt[1]));
                    YawPitchRollAngles imuBefore = imu.getRobotYawPitchRollAngles();
                    Orientation chipBefore = legacy.getAngularOrientation();

                    Check.isTrue(legacy.initialize(parameters), "legacy initialize" + where);
                    YawPitchRollAngles imuReset = imu.getRobotYawPitchRollAngles();
                    Check.near(0, imuReset.getYaw(AngleUnit.DEGREES), 1e-3, "IMU yaw restarts at 0" + where);
                    Check.near(imuBefore.getPitch(AngleUnit.DEGREES), imuReset.getPitch(AngleUnit.DEGREES), 1e-3,
                            "IMU pitch stays" + where);
                    Check.near(imuBefore.getRoll(AngleUnit.DEGREES), imuReset.getRoll(AngleUnit.DEGREES), 1e-3,
                            "IMU roll stays" + where);
                    Orientation chipReset = legacy.getAngularOrientation();
                    Check.near(0, angleBetween(chipBefore.secondAngle, chipReset.secondAngle), 1e-3,
                            "legacy tilt stays (second)" + where);
                    Check.near(0, angleBetween(chipBefore.thirdAngle, chipReset.thirdAngle), 1e-3,
                            "legacy tilt stays (third)" + where);
                    float zxyReset = legacy.getAngularOrientation(
                            AxesReference.INTRINSIC, AxesOrder.ZXY, AngleUnit.DEGREES).firstAngle;
                    if (hubMount && level) {
                        Check.near(0, chipReset.firstAngle, 1e-3, "legacy heading restarts at 0" + where);
                        if (chipXVertical) Check.near(0, zxyReset, 1e-3, "legacy ZXY heading restarts at 0" + where);
                    }

                    bot.in("imu", "yaw", Math.toRadians(heading + 30));
                    Check.near(30, imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES), 1e-3,
                            "IMU yaw counts from the reset" + where);
                    Orientation chipTurned = legacy.getAngularOrientation();
                    Check.near(30, angleBetween(chipReset.firstAngle, chipTurned.firstAngle), 1e-3,
                            "legacy heading follows the robot yaw" + where);
                    Check.near(0, angleBetween(chipReset.secondAngle, chipTurned.secondAngle), 1e-3,
                            "legacy second angle stays" + where);
                    Check.near(0, angleBetween(chipReset.thirdAngle, chipTurned.thirdAngle), 1e-3,
                            "legacy third angle stays" + where);
                    if (chipXVertical) {
                        float zxyTurned = legacy.getAngularOrientation(
                                AxesReference.INTRINSIC, AxesOrder.ZXY, AngleUnit.DEGREES).firstAngle;
                        Check.near(30, angleBetween(zxyReset, zxyTurned), 1e-3,
                                "legacy ZXY heading follows the robot yaw" + where);
                    }
                }
            }
        }
        SandbotHardware.afterStop(bot.map);
    }

    /** 첫 update 전에는 null을 주는 팀 적분기 */
    private static final class NullUntilUpdate implements BNO055IMU.AccelerationIntegrator {
        @Override public void initialize(BNO055IMU.Parameters parameters, Position initialPosition, Velocity initialVelocity) {
        }

        @Override public Position getPosition() {
            return null;
        }

        @Override public Velocity getVelocity() {
            return null;
        }

        @Override public Acceleration getAcceleration() {
            return null;
        }

        @Override public void update(Acceleration linearAcceleration) {
        }
    }

    public static void testLegacyBno055IntegrationValuesAreNeverNull() {
        // 실제 BNO055IMUImpl.getAcceleration·getVelocity·getPosition은 적분기가 null을 주면 새 0 값을 준다
        // (기본 NaiveAccelerationIntegrator의 가속도는 첫 update 전 null)
        Bot bot = new Bot(null, BNO055, null);
        BNO055IMU legacy = bot.get(BNO055IMU.class, "imu");
        legacy.initialize(new BNO055IMU.Parameters());
        Check.isTrue(legacy.getAcceleration() != null, "acceleration before integration starts");
        legacy.startAccelerationIntegration(new Position(), new Velocity(), 1000);
        Acceleration acceleration = legacy.getAcceleration();
        Check.isTrue(acceleration != null, "acceleration after integration starts");
        Check.near(0, acceleration.xAccel + acceleration.yAccel + acceleration.zAccel, 0, "no linear acceleration");
        Check.isTrue(legacy.getVelocity() != null && legacy.getPosition() != null, "velocity and position");

        BNO055IMU.Parameters custom = new BNO055IMU.Parameters();
        custom.accelerationIntegrationAlgorithm = new NullUntilUpdate();
        legacy.initialize(custom);
        legacy.startAccelerationIntegration(new Position(), new Velocity(), 100);
        Check.isTrue(legacy.getAcceleration() != null, "team integrator acceleration");
        Check.isTrue(legacy.getVelocity() != null, "team integrator velocity");
        Check.isTrue(legacy.getPosition() != null, "team integrator position");
        SandbotHardware.afterStop(bot.map);
    }

    // ---------------------------------------------------------------------------------------------
    // I2C 센서
    // ---------------------------------------------------------------------------------------------

    static final String I2C =
            "            <REV_VL53L0X_RANGE_SENSOR name=\"distance\" port=\"0\" bus=\"1\" />\n"
            + "            <RevColorSensorV3 name=\"color\" port=\"0\" bus=\"2\" />\n"
            + "            <HuskyLens name=\"huskyLens\" port=\"0\" bus=\"3\" />\n"
            + "            <goBILDAPinpoint name=\"pinpoint\" port=\"1\" bus=\"1\" />\n"
            + "            <SparkFunOTOS name=\"otos\" port=\"1\" bus=\"2\" />\n"
            + "            <OctoQuadFTC name=\"octoquad\" port=\"1\" bus=\"3\" />\n";

    public static void testDistanceAndColorSensors() {
        Bot bot = new Bot(null, I2C, null);
        DistanceSensor distance = bot.get(DistanceSensor.class, "distance");
        Check.near(VL53L0XChip.OUT_OF_RANGE_MM, distance.getDistance(DistanceUnit.MM), 1e-9, "nothing in range");
        bot.in("distance", "distance", 0.5);
        CLOCK.nanos += ms(100);
        Check.near(500, distance.getDistance(DistanceUnit.MM), 1e-9, "distance input in meters");
        Check.near(50, distance.getDistance(DistanceUnit.CM), 1e-9, "distance in cm");

        RevColorSensorV3 color = bot.get(RevColorSensorV3.class, "color");
        bot.in("color", "red", 4000L);
        bot.in("color", "green", 1000L);
        bot.in("color", "blue", 500L);
        CLOCK.nanos += ms(200);
        NormalizedRGBA rgba = color.getNormalizedColors();
        Check.isTrue(rgba.red > rgba.green && rgba.green > rgba.blue, "normalized colors keep the order: " + rgba.red + " " + rgba.green + " " + rgba.blue);
        Check.equal(4280, color.red(), "red with the driver's 1.07 factor");
        bot.in("color", "distance", 0.05);
        // PS는 측정 시각(100 ms 주기)에 잡으므로 한 주기를 흘린다(실제 칩도 그렇다)
        CLOCK.nanos += ms(100);
        Check.near(5.0, color.getDistance(DistanceUnit.CM), 0.3, "proximity distance");
        SandbotHardware.afterStop(bot.map);
    }

    // ---- 칩 측정 시각·척도(명세 4c §1.8): 칩을 직접 만들고 가짜 시계를 손으로 옮긴다 ----

    private static final int VL_RESULT_RANGE = 0x14 + 10, VL_SYSRANGE_START = 0x00;

    private static int vlRange(VL53L0XChip chip) {
        byte[] b = chip.read(VL_RESULT_RANGE, 2);
        return ((b[0] & 0xFF) << 8) | (b[1] & 0xFF);
    }

    /** 틱 경계 b의 입력(런타임처럼 경계 시각을 인자로). 시계는 그대로 둔다. */
    private static void boundary(SimDevice device, long b, String key, Object value) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put(key, value);
        device.applyInputs(values, b);
    }

    public static void testChipVl53l0xLatchesAtMeasurementEnd() {
        SimTestSupport.install();
        SimDevice device = new SimDevice("chip.vl", "distance");
        VL53L0XChip chip = new VL53L0XChip(device);
        long t0 = CLOCK.nanos;
        chip.write(VL_SYSRANGE_START, new byte[] {0x02});
        boundary(device, t0, "distance", 0.5);
        CLOCK.nanos = t0 + ms(20);
        Check.equal(VL53L0XChip.OUT_OF_RANGE_MM, vlRange(chip), "before the first measurement: 8190");
        CLOCK.nanos = t0 + ms(40);
        boundary(device, t0 + ms(40), "distance", 0.3);
        CLOCK.nanos = t0 + ms(50);
        Check.equal(500, vlRange(chip), "t 50 ms: the measurement ending at 33 ms holds 0.5 m");
        CLOCK.nanos = t0 + ms(70);
        Check.equal(300, vlRange(chip), "t 70 ms: the measurement ending at 66 ms holds 0.3 m");

        // 경계 b = 98 ms, 시계 now = 100 ms: 99 ms에 끝난 측정은 경계 뒤라 새 입력을 잡는다(시계를 읽었다면 옛 0.3)
        CLOCK.nanos = t0 + ms(100);
        boundary(device, t0 + ms(98), "distance", 0.7);
        Check.equal(700, vlRange(chip), "a measurement ending between the boundary and now holds the new input");

        // 한 charge가 경계 셋을 넘음: 경계마다 그 전에 끝난 측정을 옛 입력으로 잡는다(132·165·198 ms에 끝남)
        CLOCK.nanos = t0 + ms(200);
        boundary(device, t0 + ms(135), "distance", 0.1);
        Check.equal(700, chip.latchedRangeMm(), "measurement ending at 132 ms holds the input before the 135 ms boundary");
        boundary(device, t0 + ms(170), "distance", 0.2);
        Check.equal(100, chip.latchedRangeMm(), "measurement ending at 165 ms holds the 135 ms input");
        boundary(device, t0 + ms(200), "distance", 0.3);
        Check.equal(200, chip.latchedRangeMm(), "measurement ending at 198 ms holds the 170 ms input");
        Check.equal(200, vlRange(chip), "reading at 200 ms: the last finished measurement, not the newest input");

        // null(범위 밖)은 8190, 8.19 m 넘음도 8190
        boundary(device, t0 + ms(205), "distance", null);
        CLOCK.nanos = t0 + ms(240);
        Check.equal(VL53L0XChip.OUT_OF_RANGE_MM, vlRange(chip), "null input is out of range");
        boundary(device, t0 + ms(245), "distance", 9.0);
        CLOCK.nanos = t0 + ms(270);
        Check.equal(VL53L0XChip.OUT_OF_RANGE_MM, vlRange(chip), "beyond 8.19 m clamps to 8190");
    }

    private static final int CS_MAIN_CTRL = 0x00, CS_PS_MEAS_RATE = 0x03, CS_LS_MEAS_RATE = 0x04, CS_LS_GAIN = 0x05;
    private static final int CS_MAIN_STATUS = 0x07, CS_PS_DATA = 0x08, CS_GREEN = 0x0D;

    private static long cs24(ColorSensorV3Chip chip, int reg) {
        byte[] b = chip.read(reg, 3);
        return (b[0] & 0xFF) | ((b[1] & 0xFF) << 8) | ((long) (b[2] & 0x0F) << 16);
    }

    private static int csPs(ColorSensorV3Chip chip) {
        byte[] b = chip.read(CS_PS_DATA, 2);
        return (b[0] & 0xFF) | ((b[1] & 0x07) << 8);
    }

    private static int csNewLight(ColorSensorV3Chip chip) {
        return chip.read(CS_MAIN_STATUS, 1)[0] & 0x08;
    }

    public static void testChipColorSaturationAndScale() {
        Bot bot = new Bot(null, I2C, null);
        RevColorSensorV3 color = bot.get(RevColorSensorV3.class, "color");
        bot.in("color", "red", 70000L);
        bot.in("color", "green", 1000L);
        CLOCK.nanos += ms(200);
        Check.equal(65535, color.red(), "SDK default 16-bit saturates at 65535");
        Check.equal(1000, color.green(), "3x 25 ms is the input scale");

        BroadcomColorSensor.LSResolution saved = BroadcomColorSensor.Parameters.lightSensorResolution;
        try {
            // 13비트(3.125 ms): 척도 1.1834/9.4675 = 0.125, 8191에서 포화(드라이버 red는 × 1.07)
            BroadcomColorSensor.Parameters.lightSensorResolution = BroadcomColorSensor.LSResolution.R13BIT;
            color.initialize(color.getParameters());
            CLOCK.nanos += ms(200);
            Check.equal((int) (1.07 * 8191), color.red(), "13-bit saturates at 8191");
            Check.equal(125, color.green(), "13-bit scale 0.125");

            // 이득 9×, 16비트·25 ms: 1.1834/0.3899 = 3.0352
            BroadcomColorSensor.Parameters.lightSensorResolution = BroadcomColorSensor.LSResolution.R16BIT;
            BroadcomColorSensor.Parameters gain9 = color.getParameters();
            gain9.gain = BroadcomColorSensor.Gain.GAIN_9;
            color.initialize(gain9);
            CLOCK.nanos += ms(200);
            Check.equal((int) Math.round(1000 * 1.1834 / 0.3899), color.green(), "gain 9 scale from the datasheet table");

            // 18비트(100 ms), 3×: 1.1834/0.2959 = 3.9993. 17500 → 69988 → 드라이버는 아래 16비트 69988 − 65536 = 4452
            BroadcomColorSensor.Parameters.lightSensorResolution = BroadcomColorSensor.LSResolution.R18BIT;
            BroadcomColorSensor.Parameters gain3 = color.getParameters();
            gain3.gain = BroadcomColorSensor.Gain.GAIN_3;
            color.initialize(gain3);
            bot.in("color", "green", 17500L);
            CLOCK.nanos += ms(250);
            Check.equal(69988 - 65536, color.green(), "18-bit value wraps in the driver's 16-bit read");
        } finally {
            BroadcomColorSensor.Parameters.lightSensorResolution = saved;
        }
        SandbotHardware.afterStop(bot.map);
    }

    public static void testChipColorLightTimingAndWindowAverage() {
        SimTestSupport.install();
        SimDevice device = new SimDevice("chip.ls", "color");
        ColorSensorV3Chip chip = new ColorSensorV3Chip(device);
        long t0 = CLOCK.nanos;
        // SDK 드라이버의 initialize 순서(BroadcomColorSensorImpl: 이득 3× → LS 16비트·100 ms → 켜기)
        chip.write(CS_LS_GAIN, new byte[] {0x01});
        chip.write(CS_LS_MEAS_RATE, new byte[] {0x42});
        boundary(device, t0, "green", 1000L);
        chip.write(CS_MAIN_CTRL, new byte[] {0x07});
        CLOCK.nanos = t0 + ms(24.999);
        Check.equal(0L, cs24(chip, CS_GREEN), "no light data before the first 25 ms integration");
        Check.equal(0, csNewLight(chip), "no new light data yet");
        CLOCK.nanos = t0 + ms(25);
        Check.equal(0x08, csNewLight(chip), "first light data at 25 ms");
        Check.equal(1000L, cs24(chip, CS_GREEN), "first light value");
        Check.equal(0, csNewLight(chip), "status read clears the new-data bit");

        // 측정 끝 사이에 바꾼 입력은 다음 측정 끝(125 ms)까지 보이지 않는다
        CLOCK.nanos = t0 + ms(50);
        boundary(device, t0 + ms(50), "green", 2000L);
        CLOCK.nanos = t0 + ms(124);
        Check.equal(1000L, cs24(chip, CS_GREEN), "input change between measurements waits for the next end");
        Check.equal(0, csNewLight(chip), "no new data before 125 ms");
        // 창 [100, 125] ms 안에서 경계마다 0 ↔ 1000: 1000이 10 ms → 평균 400
        for (int i = 0; i < 5; i++) boundary(device, t0 + ms(100 + 5 * i), "green", i % 2 == 0 ? 0L : 1000L);
        CLOCK.nanos = t0 + ms(125);
        Check.equal(400L, cs24(chip, CS_GREEN), "window time average of the boundary inputs");
        // [200, 212.5) 1, [212.5, 225] 0 → 0.5 → 반올림 1
        boundary(device, t0 + ms(200), "green", 1L);
        boundary(device, t0 + ms(212.5), "green", 0L);
        CLOCK.nanos = t0 + ms(225);
        Check.equal(1L, cs24(chip, CS_GREEN), "average rounds half up");

        // LS_MEAS_RATE 다시 쓰기: 위상이 다시 시작된다(쓴 뒤 25 ms에 첫 값)
        boundary(device, t0 + ms(230), "green", 3000L);
        CLOCK.nanos = t0 + ms(260);
        chip.write(CS_LS_MEAS_RATE, new byte[] {0x42});
        CLOCK.nanos = t0 + ms(284);
        Check.equal(1L, cs24(chip, CS_GREEN), "phase restarted: no new value before write + 25 ms");
        CLOCK.nanos = t0 + ms(285);
        Check.equal(3000L, cs24(chip, CS_GREEN), "phase restarted: value at write + 25 ms");

        // 20비트(400 ms) + 주기 100 ms → 실제 주기 400 ms(DS: repeat rate는 적분 시간보다 짧을 수 없다)
        chip.write(CS_LS_MEAS_RATE, new byte[] {0x02});
        long tw = CLOCK.nanos;
        CLOCK.nanos = tw + ms(399);
        csNewLight(chip);
        Check.equal(3000L, cs24(chip, CS_GREEN), "20-bit integration: nothing before 400 ms");
        CLOCK.nanos = tw + ms(400);
        Check.equal(0x08, csNewLight(chip), "20-bit first value at 400 ms");
        Check.equal(Math.round(3000 * 1.1834 / 0.0740), cs24(chip, CS_GREEN), "20-bit 400 ms scale");
        CLOCK.nanos = tw + ms(799);
        Check.equal(0, csNewLight(chip), "repeat rate is at most the integration time");
        CLOCK.nanos = tw + ms(800);
        Check.equal(0x08, csNewLight(chip), "next value 400 ms later");
    }

    public static void testChipColorProximityTiming() {
        SimTestSupport.install();
        SimDevice device = new SimDevice("chip.ps", "color");
        ColorSensorV3Chip chip = new ColorSensorV3Chip(device);
        long t0 = CLOCK.nanos;
        boundary(device, t0, "proximity", 300L);
        chip.write(CS_PS_MEAS_RATE, new byte[] {0x1D});
        Check.equal(0, csPs(chip), "PS before enabling is 0");
        chip.write(CS_MAIN_CTRL, new byte[] {0x07});
        Check.equal(300, csPs(chip), "first PS right after enabling");
        CLOCK.nanos = t0 + ms(30);
        boundary(device, t0 + ms(30), "proximity", 500L);
        CLOCK.nanos = t0 + ms(99);
        Check.equal(300, csPs(chip), "new proximity waits for the next PS measurement");
        CLOCK.nanos = t0 + ms(100);
        Check.equal(500, csPs(chip), "PS measurement on the 100 ms grid");
        CLOCK.nanos = t0 + ms(150);
        boundary(device, t0 + ms(150), "proximity", 700L);
        chip.write(CS_PS_MEAS_RATE, new byte[] {0x1D});
        Check.equal(700, csPs(chip), "PS_MEAS_RATE write restarts the phase with an immediate measurement");
        CLOCK.nanos = t0 + ms(200);
        boundary(device, t0 + ms(200), "proximity", 900L);
        CLOCK.nanos = t0 + ms(249);
        Check.equal(700, csPs(chip), "next PS at write + 100 ms");
        CLOCK.nanos = t0 + ms(250);
        Check.equal(900, csPs(chip), "PS at write + 100 ms");
    }

    public static void testPinpoint() {
        Bot bot = new Bot(null, I2C, null);
        GoBildaPinpointDriver pinpoint = bot.get(GoBildaPinpointDriver.class, "pinpoint");
        pinpoint.setOffsets(-84.0, -168.0, DistanceUnit.MM);
        pinpoint.setEncoderResolution(GoBildaPinpointDriver.GoBildaOdometryPods.goBILDA_4_BAR_POD);
        pinpoint.setEncoderDirections(GoBildaPinpointDriver.EncoderDirection.FORWARD, GoBildaPinpointDriver.EncoderDirection.REVERSED);
        Check.near(-84.0, num(bot.out("pinpoint", "xOffsetMm")), 1e-4, "x pod offset output");
        Check.near(-168.0, num(bot.out("pinpoint", "yOffsetMm")), 1e-4, "y pod offset output");
        Check.near(19.89436789, num(bot.out("pinpoint", "ticksPerMm")), 1e-4, "4-bar pod resolution output");
        Check.equal("REVERSED", bot.out("pinpoint", "yDirection"), "y direction output");

        bot.in("pinpoint", "x", 100.0);
        bot.in("pinpoint", "heading", 0.5);
        pinpoint.update();
        Check.near(100, pinpoint.getPosX(DistanceUnit.MM), 1e-3, "x before reset is the input");
        Check.near(0.5, pinpoint.getHeading(AngleUnit.RADIANS), 1e-5, "heading before reset");

        pinpoint.resetPosAndIMU();
        pinpoint.update();
        Check.equal(GoBildaPinpointDriver.DeviceStatus.CALIBRATING, pinpoint.getDeviceStatus(), "calibrating after reset");
        Check.near(0, pinpoint.getPosX(DistanceUnit.MM), 1e-3, "x after reset");
        CLOCK.nanos += ms(PinpointChip.CALIBRATION_MS + 1);
        // 리셋한 뒤 로봇이 자기 방향(0.5 rad)으로 50 mm 갔다
        bot.in("pinpoint", "x", 100.0 + 50 * Math.cos(0.5));
        bot.in("pinpoint", "y", 50 * Math.sin(0.5));
        pinpoint.update();
        Check.equal(GoBildaPinpointDriver.DeviceStatus.READY, pinpoint.getDeviceStatus(), "ready after calibration");
        Check.near(50, pinpoint.getPosX(DistanceUnit.MM), 1e-3, "x in the reset frame");
        Check.near(0, pinpoint.getPosY(DistanceUnit.MM), 1e-3, "y in the reset frame");

        bot.in("pinpoint", "encoderY", 1000L);
        pinpoint.update();
        Check.equal(-1000, pinpoint.getEncoderY(), "reversed y encoder");
        Check.equal(PinpointChip.DEFAULT_LOOP_TIME_US, pinpoint.getLoopTime(), "loop time");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testOtos() {
        Bot bot = new Bot(null, I2C, null);
        SparkFunOTOS otos = bot.get(SparkFunOTOS.class, "otos");
        Check.isTrue(otos.isConnected(), "product id");
        otos.setLinearUnit(DistanceUnit.INCH);
        otos.setAngularUnit(AngleUnit.DEGREES);
        otos.setOffset(new SparkFunOTOS.Pose2D(1, -2, 90));
        Check.near(0.0254, num(bot.out("otos", "offsetX")), 1e-3, "offset x output (m)");
        Check.near(Math.PI / 2, num(bot.out("otos", "offsetH")), 1e-3, "offset h output (rad)");
        otos.setLinearScalar(1.05);
        Check.near(1.05, num(bot.out("otos", "linearScalar")), 1e-9, "linear scalar output");
        otos.resetTracking();
        bot.in("otos", "x", 0.254);
        bot.in("otos", "h", Math.toRadians(30));
        SparkFunOTOS.Pose2D pose = otos.getPosition();
        Check.near(10 * 1.05, pose.x, 0.01, "x in inches after reset, scaled");
        Check.near(30, pose.h, 0.01, "heading in degrees");
        SandbotHardware.afterStop(bot.map);
    }

    public static void testOctoQuadAndHuskyLens() {
        Bot bot = new Bot(null, I2C, null);
        OctoQuad octoquad = bot.get(OctoQuad.class, "octoquad");
        Check.equal(OctoQuad.OCTOQUAD_CHIP_ID, octoquad.getChipId(), "chip id");
        bot.in("octoquad", "position3", 4321L);
        // 드라이버의 AUTO 캐시: 같은 채널을 두 번째 읽을 때 새로 읽는다(실제 OctoQuadImpl)
        Check.equal(0, octoquad.readSinglePosition(3), "first read returns the empty cache");
        Check.equal(4321, octoquad.readSinglePosition(3), "second read refreshes");
        octoquad.setSingleEncoderDirection(3, OctoQuad.EncoderDirection.REVERSE);
        octoquad.refreshCache();
        Check.equal(-4321, octoquad.readSinglePosition(3), "reversed encoder 3");
        Check.equal(1 << 3, bot.out("octoquad", "directions"), "direction bits output (bit i = channel i reversed)");
        octoquad.resetSinglePosition(3);
        octoquad.refreshCache();
        Check.equal(0, octoquad.readSinglePosition(3), "reset encoder 3");

        HuskyLens husky = bot.get(HuskyLens.class, "huskyLens");
        Check.isTrue(husky.knock(), "knock");
        husky.selectAlgorithm(HuskyLens.Algorithm.TAG_RECOGNITION);
        Check.equal("TAG_RECOGNITION", bot.out("huskyLens", "algorithm"), "algorithm output");
        Check.equal(0, husky.blocks().length, "no blocks in phase 1");
        SandbotHardware.afterStop(bot.map);
    }

    // ---------------------------------------------------------------------------------------------
    // USB·이더넷
    // ---------------------------------------------------------------------------------------------

    public static void testWebcamAndLimelight() {
        Bot bot = new Bot(null, "",
                "    <Webcam name=\"Webcam 1\" serialNumber=\"A1B2C3\" />\n"
                + "    <EthernetDevice name=\"limelight\" serialNumber=\"EthernetOverUsb:eth1:172.29.0.29\" ipAddress=\"172.29.0.1\" />\n");
        WebcamName webcam = bot.get(WebcamName.class, "Webcam 1");
        Check.isTrue(webcam.isWebcam() && webcam.isAttached(), "webcam is attached");
        Check.equal("A1B2C3", bot.out("Webcam 1", "serialNumber"), "webcam serial output");

        Limelight3A limelight = bot.get(Limelight3A.class, "limelight");
        Check.equal(false, bot.out("limelight", "running"), "not running before start");
        limelight.setPollRateHz(50);
        limelight.start();
        Check.equal(true, bot.out("limelight", "running"), "running");
        Check.equal(50, bot.out("limelight", "pollRateHz"), "poll rate");
        limelight.pipelineSwitch(2);
        Check.equal(2, bot.out("limelight", "pipeline"), "pipeline output");
        limelight.updateRobotOrientation(90);
        Check.equal(90.0, bot.out("limelight", "robotYaw"), "robot yaw output");
        Check.isTrue(!limelight.isConnected(), "no results in phase 1");
        // 실제 SDK처럼 응답 없는 카메라의 기본값(빈 JSON으로 만든 무효 결과, 기본 상태)
        com.qualcomm.hardware.limelightvision.LLResult result = limelight.getLatestResult();
        Check.isTrue(result != null && !result.isValid(), "latest result is an invalid default");
        Check.isTrue(result == limelight.getLatestResult(), "latest result is cached");
        Check.equal(0, result.getFiducialResults().size(), "no fiducials");
        Check.isTrue(limelight.getStatus() != null, "default status");
        Check.isTrue(limelight.getCalDefault() != null, "default calibration");
        SandbotHardware.afterStop(bot.map);
    }

    // ---------------------------------------------------------------------------------------------
    // 그 밖
    // ---------------------------------------------------------------------------------------------

    public static void testOrgJsonRoundTrip() throws Exception {
        org.json.JSONObject o = new org.json.JSONObject("{\"a\": 1, \"b\": [1.5, \"x\", true, null], \"c\": {\"d\": \"e\\n\"}}");
        Check.equal(1, o.optInt("a"), "int");
        Check.near(1.5, o.optJSONArray("b").optDouble(0), 0, "array double");
        Check.equal("x", o.getJSONArray("b").getString(1), "array string");
        Check.isTrue(o.getJSONArray("b").isNull(3), "array null");
        Check.equal("e\n", o.getJSONObject("c").getString("d"), "nested string escape");
        Check.isTrue(Double.isNaN(o.optDouble("missing")), "optDouble default NaN");
        Check.equal("", o.optString("missing"), "optString default");
        Check.isTrue(o.optJSONArray("a") == null, "optJSONArray on wrong type");
        Check.throwsType(org.json.JSONException.class, () -> o.get("missing"), "get missing throws");
        Check.throwsType(org.json.JSONException.class, () -> new org.json.JSONObject("{"), "bad json throws");
        Check.throwsType(org.json.JSONException.class, () -> new org.json.JSONObject().put("n", Double.NaN), "NaN rejected");
        Check.equal("[1,2.5,\"s\"]", new org.json.JSONArray(new double[] {1, 2.5}).put("s").toString(), "array toString");
        Check.equal("{\"k\":\"v\"}", new org.json.JSONObject().put("k", "v").toString(), "object toString");
    }

    public static void testUnnormalizedHeadingVelocity() {
        Bot bot = new Bot(null, I2C, null);
        GoBildaPinpointDriver pinpoint = bot.get(GoBildaPinpointDriver.class, "pinpoint");
        bot.in("pinpoint", "headingVelocity", 2.0);
        pinpoint.update();
        Check.near(2.0, pinpoint.getHeadingVelocity(UnnormalizedAngleUnit.RADIANS), 1e-5, "heading velocity");
        SandbotHardware.afterStop(bot.map);
    }
}
