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
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.TouchSensor;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.external.navigation.Acceleration;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.AngularVelocity;
import org.firstinspires.ftc.robotcore.external.navigation.AxesOrder;
import org.firstinspires.ftc.robotcore.external.navigation.AxesReference;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Orientation;
import org.firstinspires.ftc.robotcore.external.navigation.Position;
import org.firstinspires.ftc.robotcore.external.navigation.UnnormalizedAngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Velocity;
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;
import org.sandbot.sim.SimDevice;
import org.sandbot.sim.SimUnsupportedException;
import org.sandbot.testing.Check;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
        tetrix.setTargetPosition(100);
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
        AngularVelocity raw = imu.chipAngularVelocity().toAngleUnit(AngleUnit.DEGREES);
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
