package org.sandbot.sdk.devices;

import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.TouchSensor;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.sandbot.testing.Check;

import static org.sandbot.sdk.devices.SimTestSupport.CLOCK;
import static org.sandbot.sdk.devices.SimTestSupport.create;
import static org.sandbot.sdk.devices.SimTestSupport.elapsed;
import static org.sandbot.sdk.devices.SimTestSupport.ms;
import static org.sandbot.sdk.devices.SimTestSupport.prefix;
import static org.sandbot.sdk.devices.SimTestSupport.robotXml;

/**
 * 허브 비용: 호출마다 실제 SDK가 보내는 Lynx 명령·bulk read·I2C 트랜잭션 수 × HubTiming 기본값.
 * Control Hub(부모 모듈)는 명령 1.5 ms·bulk 2.0 ms·I2C 2.5 ms, Expansion Hub는 2.5·3.0·3.5 ms.
 */
public final class HubCostTest {
    private HubCostTest() {}

    static final String CONTROL =
            "            <goBILDA5202SeriesMotor name=\"m0\" port=\"0\" />\n"
            + "            <goBILDA5202SeriesMotor name=\"m1\" port=\"1\" />\n"
            + "            <Servo name=\"servo\" port=\"0\" />\n"
            + "            <RevTouchSensor name=\"touch\" port=\"1\" />\n"
            + "            <DigitalDevice name=\"digital\" port=\"2\" />\n"
            + "            <AnalogInput name=\"analog\" port=\"0\" />\n"
            + "            <ControlHubImuBHI260AP name=\"imu\" port=\"0\" bus=\"0\" />\n"
            + "            <REV_VL53L0X_RANGE_SENSOR name=\"distance\" port=\"0\" bus=\"1\" />\n"
            + "            <goBILDAPinpoint name=\"pinpoint\" port=\"1\" bus=\"1\" />\n";
    static final String EXPANSION =
            "            <goBILDA5202SeriesMotor name=\"e0\" port=\"0\" />\n"
            + "            <LynxEmbeddedIMU name=\"imu2\" port=\"0\" bus=\"0\" />\n";

    static final class Bot {
        final String p = prefix();
        final HardwareMap map = create(robotXml(p, EXPANSION, CONTROL, null));
        final LynxModule control = map.get(LynxModule.class, p + "Control Hub");
        final LynxModule expansion = map.get(LynxModule.class, p + "Expansion Hub 2");

        Bot() {
            SandbotHardware.beforeInit(map);
        }

        <T> T get(Class<T> type, String name) {
            return map.get(type, p + name);
        }

        void stop() {
            SandbotHardware.afterStop(map);
        }
    }

    public static void testMotorCommandsUseLastKnown() {
        Bot bot = new Bot();
        DcMotorEx m0 = bot.get(DcMotorEx.class, "m0");
        // 처음: 모드 묻기(LastKnown 없음) + power + enable
        Check.equal(ms(3 * 1.5), elapsed(() -> m0.setPower(0.5)), "first setPower");
        Check.equal(0L, elapsed(() -> m0.setPower(0.5)), "same power again sends nothing");
        Check.equal(ms(1.5), elapsed(() -> m0.setPower(0.25)), "new power is one command");
        Check.equal(0L, elapsed(() -> m0.getPower()), "getPower from LastKnown");
        // 500 ms가 지나면 LastKnown이 무효가 되어 모드·power·enable을 다시 보낸다
        CLOCK.nanos += ms(600);
        Check.equal(ms(3 * 1.5), elapsed(() -> m0.setPower(0.25)), "stale LastKnown resends");
        Check.equal(ms(1.5), elapsed(() -> m0.setTargetPosition(100)), "target position is always sent");
        Check.equal(ms(1.5), elapsed(() -> m0.setTargetPosition(100)), "target position is not cached");
        bot.stop();
    }

    public static void testExpansionHubCostsMore() {
        Bot bot = new Bot();
        DcMotorEx e0 = bot.get(DcMotorEx.class, "e0");
        Check.equal(ms(3 * 2.5), elapsed(() -> e0.setPower(0.5)), "first setPower on expansion");
        Check.equal(ms(2.5), elapsed(() -> e0.setPower(-0.5)), "new power on expansion");
        Check.equal(ms(2.5), elapsed(() -> e0.getCurrentPosition()), "encoder read on expansion (OFF)");
        Check.equal(ms(3.0), elapsed(() -> e0.getVelocity()), "velocity is a bulk read on expansion");
        bot.expansion.setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL);
        Check.equal(ms(3.0), elapsed(() -> bot.expansion.getBulkData()), "getBulkData on expansion");
        bot.stop();
    }

    public static void testBulkCachingOff() {
        Bot bot = new Bot();
        DcMotorEx m0 = bot.get(DcMotorEx.class, "m0");
        DcMotorEx m1 = bot.get(DcMotorEx.class, "m1");
        Check.equal(LynxModule.BulkCachingMode.OFF, bot.control.getBulkCachingMode(), "default mode");
        Check.equal(ms(1.5), elapsed(() -> m0.getCurrentPosition()), "encoder: one command");
        Check.equal(ms(1.5), elapsed(() -> m0.getCurrentPosition()), "encoder again: one command");
        Check.equal(ms(1.5), elapsed(() -> m1.getCurrentPosition()), "other encoder: one command");
        Check.equal(ms(2.0), elapsed(() -> m0.getVelocity()), "velocity: LynxGetBulkInputDataCommand");
        Check.equal(ms(1.5), elapsed(() -> bot.get(TouchSensor.class, "touch").isPressed()), "digital: one command");
        Check.equal(ms(1.5), elapsed(() -> bot.get(AnalogInput.class, "analog").getVoltage()), "analog: one command");
        Check.equal(ms(1.5), elapsed(() -> bot.get(VoltageSensor.class, "Control Hub").getVoltage()), "battery: one command");
        bot.stop();
    }

    public static void testBulkCachingAuto() {
        Bot bot = new Bot();
        DcMotorEx m0 = bot.get(DcMotorEx.class, "m0");
        DcMotorEx m1 = bot.get(DcMotorEx.class, "m1");
        TouchSensor touch = bot.get(TouchSensor.class, "touch");
        AnalogInput analog = bot.get(AnalogInput.class, "analog");
        Check.equal(0L, elapsed(() -> bot.control.setBulkCachingMode(LynxModule.BulkCachingMode.AUTO)), "setting the mode is free");
        Check.equal(ms(2.0), elapsed(() -> m0.getCurrentPosition()), "first read: bulk read");
        Check.equal(0L, elapsed(() -> m1.getCurrentPosition()), "other encoder from the cache");
        Check.equal(0L, elapsed(() -> touch.isPressed()), "digital from the cache");
        Check.equal(0L, elapsed(() -> analog.getVoltage()), "analog from the cache");
        Check.equal(0L, elapsed(() -> m0.getVelocity()), "velocity (own tag) from the cache");
        Check.equal(0L, elapsed(() -> m0.isBusy()), "busy from the cache");
        // 같은 명령을 다시 읽으면 캐시를 비우고 새로 읽는다
        Check.equal(ms(2.0), elapsed(() -> m0.getCurrentPosition()), "repeated read: new bulk read");
        Check.equal(0L, elapsed(() -> m1.getCurrentPosition()), "after refresh, other encoder cached");
        Check.equal(ms(2.0), elapsed(() -> m1.getCurrentPosition()), "repeat m1: new bulk read");
        // 캐시를 비우면 모든 태그의 기록도 지운다(실제 clearBulkCache): 속도 태그는 다시 처음부터
        Check.equal(0L, elapsed(() -> m0.getVelocity()), "velocity history was cleared with the cache");
        Check.equal(ms(2.0), elapsed(() -> m0.getVelocity()), "repeated velocity: new bulk read");
        // 배터리 전압은 bulk read에 없다
        Check.equal(ms(1.5), elapsed(() -> bot.get(VoltageSensor.class, "Control Hub").getVoltage()), "battery is not cached");
        // 다른 허브의 캐시와는 따로다
        Check.equal(ms(2.5), elapsed(() -> bot.get(DcMotor.class, "e0").getCurrentPosition()), "expansion still OFF");
        bot.stop();
    }

    public static void testBulkCachingManual() {
        Bot bot = new Bot();
        DcMotorEx m0 = bot.get(DcMotorEx.class, "m0");
        bot.control.setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL);
        Check.equal(ms(2.0), elapsed(() -> m0.getCurrentPosition()), "first read: bulk read");
        Check.equal(0L, elapsed(() -> {
            for (int i = 0; i < 10; i++) m0.getCurrentPosition();
        }), "repeated reads from the cache");
        SimTestSupport.input(bot.p + "m0", "position", 1234L);
        Check.equal(0, m0.getCurrentPosition(), "cache keeps the old value");
        Check.equal(0L, elapsed(() -> bot.control.clearBulkCache()), "clearBulkCache is free");
        Check.equal(ms(2.0), elapsed(() -> m0.getCurrentPosition()), "after clear: bulk read");
        // goBILDA 모터는 CCW 형식이라 FORWARD에서 SDK가 허브 엔코더의 부호를 바꾼다(실제 DcMotorImpl)
        Check.equal(-1234, m0.getCurrentPosition(), "new value after clear");
        Check.equal(ms(2.0), elapsed(() -> bot.control.getBulkData()), "getBulkData always reads");
        // OFF로 돌아가면 캐시를 버린다
        bot.control.setBulkCachingMode(LynxModule.BulkCachingMode.OFF);
        Check.equal(ms(1.5), elapsed(() -> m0.getCurrentPosition()), "OFF again: one command");
        bot.stop();
    }

    public static void testBeforeInitResetsBulkCachingAndCharging() {
        Bot bot = new Bot();
        bot.control.setBulkCachingMode(LynxModule.BulkCachingMode.AUTO);
        bot.stop();
        DcMotorEx m0 = bot.get(DcMotorEx.class, "m0");
        Check.equal(0L, elapsed(() -> m0.setPower(0.3)), "no cost after stop");
        SandbotHardware.beforeInit(bot.map);
        Check.equal(LynxModule.BulkCachingMode.OFF, bot.control.getBulkCachingMode(), "OpMode reset sets OFF");
        Check.equal(ms(1.5), elapsed(() -> m0.getCurrentPosition()), "charging again after beforeInit");
        bot.stop();
    }

    public static void testServoCosts() {
        Bot bot = new Bot();
        Servo servo = bot.get(Servo.class, "servo");
        // 펄스 + PWM 켜기
        Check.equal(ms(2 * 1.5), elapsed(() -> servo.setPosition(0.5)), "first position: pulse + enable");
        Check.equal(0L, elapsed(() -> servo.setPosition(0.5)), "same position again");
        Check.equal(ms(1.5), elapsed(() -> servo.setPosition(0.7)), "new position");
        Check.equal(0L, elapsed(() -> servo.getPosition()), "position from LastKnown");
        bot.stop();
    }

    public static void testDigitalOutputCosts() {
        Bot bot = new Bot();
        DigitalChannel digital = bot.get(DigitalChannel.class, "digital");
        Check.equal(ms(1.5), elapsed(() -> digital.setMode(DigitalChannel.Mode.OUTPUT)), "direction command");
        Check.equal(ms(1.5), elapsed(() -> digital.setState(true)), "output command");
        Check.equal(ms(1.5), elapsed(() -> digital.setState(true)), "output is always sent (real controller)");
        Check.equal(0L, elapsed(() -> digital.getState()), "output state from LastKnown");
        bot.stop();
    }

    public static void testImuI2cCosts() {
        Bot bot = new Bot();
        IMU imu = bot.get(IMU.class, "imu");
        IMU.Parameters parameters = new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.UP, RevHubOrientationOnRobot.UsbFacingDirection.FORWARD));
        Check.equal(ms(13 * 2.5), elapsed(() -> imu.initialize(parameters)), "BHI260AP initialize: 13 transactions");
        Check.equal(ms(2.5), elapsed(() -> imu.getRobotYawPitchRollAngles()), "orientation: one transaction");
        Check.equal(ms(2.5), elapsed(() -> imu.getRobotAngularVelocity(AngleUnit.DEGREES)), "angular velocity: one transaction");
        IMU imu2 = bot.get(IMU.class, "imu2");
        Check.equal(ms(18 * 3.5 + 40), elapsed(() -> imu2.initialize(parameters)), "BNO055 on expansion: 18 transactions + 40 ms");
        Check.equal(ms(3.5), elapsed(() -> imu2.getRobotYawPitchRollAngles()), "expansion orientation");
        bot.stop();
    }

    public static void testPinpointUpdateIsOneTransaction() {
        Bot bot = new Bot();
        GoBildaPinpointDriver pinpoint = bot.get(GoBildaPinpointDriver.class, "pinpoint");
        Check.equal(ms(2 * 2.5), elapsed(() -> pinpoint.update()), "first update reads the firmware version, then bulk");
        Check.equal(ms(2.5), elapsed(() -> pinpoint.update()), "bulk update: one transaction");
        Check.equal(ms(2 * 2.5), elapsed(() -> pinpoint.setOffsets(-84, -168, DistanceUnit.MM)), "offsets: two register writes");
        bot.stop();
    }

    public static void testDistanceSensorWaitsForMeasurement() {
        Bot bot = new Bot();
        DistanceSensor distance = bot.get(DistanceSensor.class, "distance");
        distance.getDistance(DistanceUnit.MM);
        long second = elapsed(() -> distance.getDistance(DistanceUnit.MM));
        Check.isTrue(second >= ms(VL53L0XChip.MEASUREMENT_MS - 1), "reading faster than the measurement period waits: " + second);
        CLOCK.nanos += ms(100);
        // 드라이버의 ElapsedTime(들여온 클래스) 시계 읽기 비용이 조금 더해진다
        Check.near(ms(3 * 2.5), elapsed(() -> distance.getDistance(DistanceUnit.MM)), ms(0.05), "fresh measurement: 3 transactions");
        bot.stop();
    }
}
