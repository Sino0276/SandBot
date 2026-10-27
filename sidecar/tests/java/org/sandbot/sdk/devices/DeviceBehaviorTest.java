package org.sandbot.sdk.devices;

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
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.NormalizedRGBA;
import com.qualcomm.robotcore.hardware.PIDFCoefficients;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.TouchSensor;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.UnnormalizedAngleUnit;
import org.sandbot.sim.SimUnsupportedException;
import org.sandbot.testing.Check;

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
        // 목표 위치 없이 RUN_TO_POSITION으로 켜면 펌웨어가 거부한다(실제 TargetPositionNotSetException)
        Check.throwsType(TargetPositionNotSetException.class, () -> gobilda.setMode(DcMotor.RunMode.RUN_TO_POSITION),
                "RUN_TO_POSITION before a target");

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
        Check.near(5.0, color.getDistance(DistanceUnit.CM), 0.3, "proximity distance");
        SandbotHardware.afterStop(bot.map);
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
        Check.throwsType(SimUnsupportedException.class, limelight::getLatestResult, "results are unsupported");
        SandbotHardware.afterStop(bot.map);
    }

    // ---------------------------------------------------------------------------------------------
    // 그 밖
    // ---------------------------------------------------------------------------------------------

    public static void testUnnormalizedHeadingVelocity() {
        Bot bot = new Bot(null, I2C, null);
        GoBildaPinpointDriver pinpoint = bot.get(GoBildaPinpointDriver.class, "pinpoint");
        bot.in("pinpoint", "headingVelocity", 2.0);
        pinpoint.update();
        Check.near(2.0, pinpoint.getHeadingVelocity(UnnormalizedAngleUnit.RADIANS), 1e-5, "heading velocity");
        SandbotHardware.afterStop(bot.map);
    }
}
