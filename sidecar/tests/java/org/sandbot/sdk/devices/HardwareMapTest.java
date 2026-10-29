package org.sandbot.sdk.devices;

import com.qualcomm.hardware.bosch.BNO055IMU;
import com.qualcomm.hardware.dfrobot.HuskyLens;
import com.qualcomm.hardware.digitalchickenlabs.OctoQuad;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.limelightvision.Limelight3A;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.rev.Rev2mDistanceSensor;
import com.qualcomm.hardware.rev.RevBlinkinLedDriver;
import com.qualcomm.hardware.rev.RevColorSensorV3;
import com.qualcomm.hardware.rev.RevTouchSensor;
import com.qualcomm.hardware.sparkfun.SparkFunOTOS;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.ColorSensor;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorController;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.Gyroscope;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.I2cAddrConfig;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.IntegratingGyroscope;
import com.qualcomm.robotcore.hardware.LED;
import com.qualcomm.robotcore.hardware.NormalizedColorSensor;
import com.qualcomm.robotcore.hardware.OrientationSensor;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.ServoController;
import com.qualcomm.robotcore.hardware.TouchSensor;
import com.qualcomm.robotcore.hardware.VoltageSensor;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.sandbot.testing.Check;

import java.io.File;

import static org.sandbot.sdk.devices.SimTestSupport.create;
import static org.sandbot.sdk.devices.SimTestSupport.prefix;
import static org.sandbot.sdk.devices.SimTestSupport.robotXml;

/** 구성 XML → hardwareMap(실제 HardwareFactory와 같은 이름·형식·묶음) */
public final class HardwareMapTest {
    private HardwareMapTest() {}

    static final String CONTROL =
            "            <goBILDA5202SeriesMotor name=\"motor\" port=\"0\" />\n"
            + "            <Motor name=\"deadWheel\" port=\"3\" />\n"
            + "            <Servo name=\"servo\" port=\"0\" />\n"
            + "            <ContinuousRotationServo name=\"crServo\" port=\"1\" />\n"
            + "            <RevSPARKMini name=\"sparkMini\" port=\"2\" />\n"
            + "            <RevBlinkinLedDriver name=\"blinkin\" port=\"3\" />\n"
            + "            <DigitalDevice name=\"digital\" port=\"0\" />\n"
            + "            <RevTouchSensor name=\"touch\" port=\"1\" />\n"
            + "            <Led name=\"led\" port=\"2\" />\n"
            + "            <AnalogInput name=\"analog\" port=\"0\" />\n"
            + "            <ControlHubImuBHI260AP name=\"imu\" port=\"0\" bus=\"0\" />\n"
            + "            <REV_VL53L0X_RANGE_SENSOR name=\"distance\" port=\"0\" bus=\"1\" />\n"
            + "            <RevColorSensorV3 name=\"color\" port=\"1\" bus=\"1\" />\n"
            + "            <HuskyLens name=\"huskyLens\" port=\"2\" bus=\"1\" />\n"
            + "            <goBILDAPinpoint name=\"pinpoint\" port=\"3\" bus=\"1\" />\n"
            + "            <SparkFunOTOS name=\"otos\" port=\"4\" bus=\"1\" />\n"
            + "            <OctoQuadFTC name=\"octoquad\" port=\"5\" bus=\"1\" />\n";
    static final String EXPANSION =
            "            <TetrixMotor name=\"liftLeft\" port=\"0\" />\n"
            + "            <ServoFullRange name=\"wrist\" port=\"0\" />\n"
            + "            <LynxEmbeddedIMU name=\"imu2\" port=\"0\" bus=\"0\" />\n";
    static final String USB =
            "    <Webcam name=\"Webcam 1\" serialNumber=\"A1B2C3\" />\n"
            + "    <EthernetDevice name=\"limelight\" serialNumber=\"EthernetOverUsb:eth1:172.29.0.29\" ipAddress=\"172.29.0.1\" />\n";

    public static void testNullConfigIsEmpty() throws Exception {
        SimTestSupport.install();
        HardwareMap map = SandbotHardware.create(null);
        Check.equal(0, map.size(), "devices");
        Check.equal(0, map.getAll(LynxModule.class).size(), "modules");
    }

    public static void testEveryCatalogDevice() {
        String p = prefix();
        HardwareMap map = create(robotXml(p, EXPANSION, CONTROL, USB));

        Check.equal(2, map.getAll(LynxModule.class).size(), "LynxModule per hub");
        LynxModule control = map.get(LynxModule.class, p + "Control Hub");
        LynxModule expansion = map.get(LynxModule.class, p + "Expansion Hub 2");
        Check.equal(173, control.getModuleAddress(), "control address");
        Check.isTrue(control.isParent(), "control hub is parent");
        Check.equal(2, expansion.getModuleAddress(), "expansion address");
        Check.isTrue(!expansion.isParent(), "expansion hub is not parent");
        Check.equal(SimHub.of(control).kind(), org.sandbot.sim.HubKind.CONTROL, "control kind");
        Check.equal(SimHub.of(expansion).kind(), org.sandbot.sim.HubKind.EXPANSION, "expansion kind");

        // 허브마다 전압 센서·컨트롤러(허브 이름)
        Check.equal(2, map.voltageSensor.size(), "voltage sensors");
        Check.isTrue(map.get(VoltageSensor.class, p + "Control Hub") != null, "voltage sensor by hub name");
        Check.isTrue(map.get(DcMotorController.class, p + "Expansion Hub 2") != null, "motor controller by hub name");
        Check.isTrue(map.servoController.get(p + "Control Hub") instanceof ServoController, "servo controller mapping");

        // 장치(생성 코드의 get 형식)
        DcMotorEx motor = map.get(DcMotorEx.class, p + "motor");
        Check.equal("com.qualcomm.robotcore.hardware.DcMotorImplEx", motor.getClass().getName(), "motor class");
        Check.equal("goBILDA5202SeriesMotor", motor.getMotorType().getXmlTag(), "motor type tag");
        Check.equal(2786.0, motor.getMotorType().getTicksPerRev(), "5202 ticks per rev");
        Check.equal("Motor", map.get(DcMotorEx.class, p + "deadWheel").getMotorType().getXmlTag(), "dead wheel motor entry");
        Check.equal("TetrixMotor", map.get(DcMotor.class, p + "liftLeft").getMotorType().getXmlTag(), "expansion motor");
        Check.isTrue(map.dcMotor.contains(p + "motor"), "dcMotor mapping");
        Check.isTrue(map.get(Servo.class, p + "servo") != null, "servo");
        Check.isTrue(map.servo.contains(p + "wrist"), "servo mapping");
        Check.isTrue(map.get(CRServo.class, p + "crServo") != null, "cr servo");
        Check.isTrue(map.get(DcMotorSimple.class, p + "sparkMini") instanceof CRServo, "SPARK Mini is a CR servo");
        Check.isTrue(map.crservo.contains(p + "sparkMini"), "crservo mapping has SPARK Mini");
        Check.isTrue(map.get(RevBlinkinLedDriver.class, p + "blinkin") != null, "blinkin");
        Check.isTrue(map.get(DigitalChannel.class, p + "digital") != null, "digital");
        Check.isTrue(map.digitalChannel.contains(p + "digital"), "digitalChannel mapping");
        Check.isTrue(map.get(TouchSensor.class, p + "touch") instanceof RevTouchSensor, "touch");
        Check.isTrue(map.touchSensor.contains(p + "touch"), "touchSensor mapping");
        Check.isTrue(map.get(LED.class, p + "led") != null, "led");
        Check.isTrue(map.led.contains(p + "led"), "led mapping");
        Check.isTrue(map.get(AnalogInput.class, p + "analog") != null, "analog");
        Check.isTrue(map.analogInput.contains(p + "analog"), "analogInput mapping");
        IMU imu = map.get(IMU.class, p + "imu");
        Check.equal("REV internal IMU (BHI260AP)", imu.getDeviceName(), "BHI260AP name");
        Check.equal("REV internal IMU (BNO055)", map.get(IMU.class, p + "imu2").getDeviceName(), "BNO055 name");
        Check.isTrue(map.get(DistanceSensor.class, p + "distance") instanceof Rev2mDistanceSensor, "2m distance");
        Check.isTrue(map.get(NormalizedColorSensor.class, p + "color") instanceof RevColorSensorV3, "color");
        Check.isTrue(map.get(DistanceSensor.class, p + "color") != null, "color sensor is also a distance sensor");
        Check.isTrue(map.colorSensor.contains(p + "color") && map.opticalDistanceSensor.contains(p + "color") && map.lightSensor.contains(p + "color"),
                "color sensor mappings");
        Check.isTrue(map.get(HuskyLens.class, p + "huskyLens") != null, "huskylens");
        Check.isTrue(map.get(GoBildaPinpointDriver.class, p + "pinpoint") != null, "pinpoint");
        Check.isTrue(map.get(SparkFunOTOS.class, p + "otos") != null, "otos");
        Check.isTrue(map.get(OctoQuad.class, p + "octoquad") != null, "octoquad");
        Check.isTrue(map.get(WebcamName.class, p + "Webcam 1") != null, "webcam");
        Check.isTrue(map.get(Limelight3A.class, p + "limelight") != null, "limelight");

        // 실제 HardwareMap 의미: 없는 이름은 tryGet null, get은 IllegalArgumentException
        Check.isTrue(map.tryGet(DcMotorEx.class, p + "nothing") == null, "tryGet missing");
        Check.isTrue(map.tryGet(Servo.class, p + "motor") == null, "tryGet wrong type");
        Check.throwsType(IllegalArgumentException.class, () -> map.get(DcMotor.class, p + "nothing"), "get missing");
        Check.isTrue(map.getAll(ColorSensor.class).size() == 1, "getAll by interface");
        Check.isTrue(map.getNamesOf(motor).contains(p + "motor"), "getNamesOf");
    }

    public static void testLegacyBno055DriverHasTheRealInterfaces() {
        // 실제 LynxEmbeddedIMU(BNO055IMUImpl)는 BNO055IMU·Gyroscope·IntegratingGyroscope·I2cAddrConfig·
        // OpModeManagerNotifier.Notifications다. 같은 구성 항목의 다른 드라이버(IMU)는 IMU뿐이라 이 형식들은 옛 드라이버를 준다.
        String p = prefix();
        HardwareMap map = create(robotXml(p, EXPANSION, CONTROL, null));
        BNO055IMU legacy = map.get(BNO055IMU.class, p + "imu2");
        Check.isTrue(map.get(Gyroscope.class, p + "imu2") == legacy, "Gyroscope");
        Check.isTrue(map.get(IntegratingGyroscope.class, p + "imu2") == legacy, "IntegratingGyroscope");
        Check.isTrue(map.get(OrientationSensor.class, p + "imu2") == legacy, "OrientationSensor");
        Check.isTrue(map.get(I2cAddrConfig.class, p + "imu2") == legacy, "I2cAddrConfig");
        Check.isTrue(legacy instanceof OpModeManagerNotifier.Notifications, "OpModeManagerNotifier.Notifications");
        Check.equal(0x28, ((I2cAddrConfig) legacy).getI2cAddress().get7Bit(), "default I2C address");
        Check.equal("[X, Y, Z]", ((Gyroscope) legacy).getAngularVelocityAxes().toString(), "angular velocity axes");
        Check.equal("[X, Y, Z]", ((OrientationSensor) legacy).getAngularOrientationAxes().toString(), "orientation axes");
        // BHI260AP의 실제 드라이버(BHI260IMU)는 IMU뿐이다
        Check.throwsType(IllegalArgumentException.class, () -> map.get(Gyroscope.class, p + "imu"), "BHI260AP is not a Gyroscope");
    }

    private static boolean bhi260Warning() {
        return RobotLog.getGlobalWarningMessage().message.contains(
                "You attempted to use the BNO055 interface when only a BHI260AP IMU is configured.");
    }

    public static void testBno055InterfaceOnBhi260OnlyRobotWarns() {
        // 실제 HardwareMap.tryGet: BNO055IMU를 찾지 못했고 장치 클래스 이름에 BHI260만 있으면(BNO055 드라이버 없음) 고치는 법을 알린다
        String p = prefix();
        HardwareMap map = create(robotXml(p, null, "            <ControlHubImuBHI260AP name=\"imu\" port=\"0\" bus=\"0\" />\n", null));
        RobotLog.clearGlobalWarningMsg();
        try {
            Check.isTrue(map.tryGet(BNO055IMU.class, p + "imu") == null, "no legacy driver on a BHI260AP");
            Check.isTrue(bhi260Warning(), "BHI260AP guidance: " + RobotLog.getGlobalWarningMessage().message);
            RobotLog.clearGlobalWarningMsg();
            // 다른 허브에 BNO055 드라이버가 있으면 알리지 않는다(실제와 같은 판단: 지도 전체의 클래스 이름)
            HardwareMap both = create(robotXml(p + "b.", EXPANSION, "            <ControlHubImuBHI260AP name=\"imu\" port=\"0\" bus=\"0\" />\n", null));
            Check.isTrue(both.tryGet(BNO055IMU.class, p + "b.imu") == null, "still no legacy driver on the BHI260AP");
            Check.isTrue(!bhi260Warning(), "no guidance while a BNO055 driver exists");
        } finally {
            RobotLog.clearGlobalWarningMsg();
        }
    }

    public static void testWebcamAndLimelightOnlyWhenConfigured() {
        String p = prefix();
        HardwareMap map = create(robotXml(p, null, "", null));
        Check.isTrue(map.tryGet(WebcamName.class, p + "Webcam 1") == null, "no webcam without config entry");
        Check.isTrue(map.tryGet(Limelight3A.class, p + "limelight") == null, "no limelight without config entry");
    }

    private static SandbotConfigException configError(String xml) {
        return Check.throwsType(SandbotConfigException.class, () -> SandbotHardware.create(SimTestSupport.writeXml(xml)), "config error");
    }

    public static void testUnknownTagIsConfigError() {
        String p = prefix();
        SandbotConfigException e = configError(robotXml(p, null, "            <SomeFancyThing name=\"x\" port=\"0\" />\n", null));
        Check.isTrue(e.getMessage().contains("SomeFancyThing"), "message names the tag: " + e.getMessage());
    }

    public static void testInvalidXmlIsConfigError() {
        SimTestSupport.install();
        configError("<Robot><LynxUsbDevice>");
        configError("<NotARobot />");
        Check.throwsType(SandbotConfigException.class, () -> SandbotHardware.create(new File("/nonexistent/sandbot_none.xml")), "missing file");
    }

    public static void testDuplicateNameOrPortIsConfigError() {
        String p = prefix();
        configError(robotXml(p, null, "            <Servo name=\"a\" port=\"0\" />\n            <Servo name=\"a\" port=\"1\" />\n", null));
        String q = prefix();
        configError(robotXml(q, null, "            <Servo name=\"a\" port=\"0\" />\n            <Servo name=\"b\" port=\"0\" />\n", null));
        String r = prefix();
        configError(robotXml(r, null, "            <Servo name=\"a\" port=\"6\" />\n", null));
    }
}
