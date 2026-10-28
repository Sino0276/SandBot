package org.sandbot.sdk.devices;

import com.qualcomm.hardware.dfrobot.HuskyLens;
import com.qualcomm.hardware.digitalchickenlabs.OctoQuadImpl;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.hardware.limelightvision.Limelight3A;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.rev.Rev2mDistanceSensor;
import com.qualcomm.hardware.rev.RevBlinkinLedDriver;
import com.qualcomm.hardware.rev.RevColorSensorV3;
import com.qualcomm.hardware.rev.RevTouchSensor;
import com.qualcomm.hardware.sparkfun.SparkFunOTOS;
import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.CRServoImplEx;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorImplEx;
import com.qualcomm.robotcore.hardware.DigitalChannelImpl;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.I2cAddr;
import com.qualcomm.robotcore.hardware.LED;
import com.qualcomm.robotcore.hardware.LynxModuleImuType;
import com.qualcomm.robotcore.hardware.PwmControl;
import com.qualcomm.robotcore.hardware.RobotCoreLynxController;
import com.qualcomm.robotcore.hardware.RobotCoreLynxModule;
import com.qualcomm.robotcore.hardware.Servo;
import com.qualcomm.robotcore.hardware.ServoImplEx;
import com.qualcomm.robotcore.hardware.configuration.typecontainers.MotorConfigurationType;

import org.sandbot.sim.Sim;
import org.sandbot.sim.SimDevice;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.SAXException;

import java.io.File;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;

/**
 * 로봇 구성 XML(Driver Station에서 활성화하는 구성, SandBot은 TeamCode/src/main/res/xml/sandbot_*.xml로 만든다)로 실제 SDK의
 * HardwareFactory·HardwareDeviceManager가 만드는 것과 같은 hardwareMap을 만들고, OpMode 앞뒤에 실제 OpModeManagerImpl이
 * 하드웨어에 하는 일을 한다. 런타임(org.sandbot.runtime)이 부른다.
 *
 * <p>hardwareMap 내용(실제와 같음): 허브마다 LynxModule(구성 이름), DC 모터 컨트롤러·서보 컨트롤러·전압 센서(dcMotorController·
 * servoController·voltageSensor 묶음)·아날로그 입력·디지털 채널 컨트롤러(모두 허브 이름), 모터는 DcMotorImplEx(dcMotor 묶음),
 * 서보는 ServoImplEx, CR 서보·SPARK Mini는 CRServoImplEx, 나머지는 실제 장치 클래스. 웹캠·Limelight는 구성에 있을 때만.
 * LynxUsbDevice("Control Hub Portal")는 넣지 않는다(팀 코드가 쓰지 않는 USB 장치).
 */
public final class SandbotHardware {
    private SandbotHardware() {}

    /** create가 만든 장치(만든 순서). beforeInit의 재설정 순서를 실행마다 같게 한다. */
    private static final Map<HardwareMap, List<HardwareDevice>> BUILT = new WeakHashMap<>();

    // ---- 구성 태그(FTC SDK 12.0 소스의 @DeviceProperties xmlTag) ----

    private static final Map<String, String> MOTOR_CLASSES = new HashMap<>();

    static {
        MOTOR_CLASSES.put("goBILDA5201SeriesMotor", "com.qualcomm.hardware.motors.GoBILDA5201Series");
        MOTOR_CLASSES.put("goBILDA5202SeriesMotor", "com.qualcomm.hardware.motors.GoBILDA5202Series");
        MOTOR_CLASSES.put("Matrix12vMotor", "com.qualcomm.hardware.motors.Matrix12vMotor");
        MOTOR_CLASSES.put("NeveRest20Gearmotor", "com.qualcomm.hardware.motors.NeveRest20Gearmotor");
        MOTOR_CLASSES.put("NeveRest3.7v1Gearmotor", "com.qualcomm.hardware.motors.NeveRest3_7GearmotorV1");
        MOTOR_CLASSES.put("NeveRest40Gearmotor", "com.qualcomm.hardware.motors.NeveRest40Gearmotor");
        MOTOR_CLASSES.put("NeveRest60Gearmotor", "com.qualcomm.hardware.motors.NeveRest60Gearmotor");
        MOTOR_CLASSES.put("RevRobotics20HDHexMotor", "com.qualcomm.hardware.motors.RevRobotics20HdHexMotor");
        MOTOR_CLASSES.put("RevRobotics40HDHexMotor", "com.qualcomm.hardware.motors.RevRobotics40HdHexMotor");
        // ConfigurationTypeManager가 예전 태그를 40:1 HD Hex로 읽는다
        MOTOR_CLASSES.put("RevRoboticsHDHexMotor", "com.qualcomm.hardware.motors.RevRobotics40HdHexMotor");
        MOTOR_CLASSES.put("RevRoboticsCoreHexMotor", "com.qualcomm.hardware.motors.RevRoboticsCoreHexMotor");
        MOTOR_CLASSES.put("RevRoboticsUltraplanetaryHDHexMotor", "com.qualcomm.hardware.motors.RevRoboticsUltraPlanetaryHdHexMotor");
        MOTOR_CLASSES.put("StudicaMaverick", "com.qualcomm.hardware.motors.StudicaMaverickMotor");
        MOTOR_CLASSES.put("TetrixMotor", "com.qualcomm.hardware.motors.TetrixMotor");
        MOTOR_CLASSES.put("Motor", "com.qualcomm.robotcore.hardware.configuration.UnspecifiedMotor");
    }

    /** 서보 포트 장치: 태그 → (SimDevice 종류, 펄스 범위). 범위는 각 형식의 @ServoType과 같다. */
    private static final Map<String, Object[]> SERVO_TYPES = new HashMap<>();

    static {
        SERVO_TYPES.put("Servo", new Object[] {SimServoController.KIND_SERVO, new PwmControl.PwmRange(600, 2400, 20000)});
        SERVO_TYPES.put("ServoFullRange", new Object[] {SimServoController.KIND_SERVO, new PwmControl.PwmRange(500, 2500, 20000)});
        SERVO_TYPES.put("ContinuousRotationServo", new Object[] {SimServoController.KIND_CR_SERVO, new PwmControl.PwmRange(600, 2400, 20000)});
        SERVO_TYPES.put("RevSPARKMini", new Object[] {SimServoController.KIND_SPARK_MINI, new PwmControl.PwmRange(500, 2500, 5500)});
        SERVO_TYPES.put("RevBlinkinLedDriver", new Object[] {SimServoController.KIND_BLINKIN, new PwmControl.PwmRange(500, 2500, 20000)});
    }

    private static final Set<String> DIGITAL_TAGS = new HashSet<>();
    private static final Set<String> I2C_TAGS = new HashSet<>();

    static {
        DIGITAL_TAGS.add("DigitalDevice");
        DIGITAL_TAGS.add("RevTouchSensor");
        DIGITAL_TAGS.add("Led");
        I2C_TAGS.add("ControlHubImuBHI260AP");
        I2C_TAGS.add("LynxEmbeddedIMU");
        I2C_TAGS.add("REV_VL53L0X_RANGE_SENSOR");
        I2C_TAGS.add("RevColorSensorV3");
        I2C_TAGS.add("HuskyLens");
        I2C_TAGS.add("goBILDAPinpoint");
        I2C_TAGS.add("SparkFunOTOS");
        I2C_TAGS.add("OctoQuadFTC");
    }

    // ---------------------------------------------------------------------------------------------
    // 구성 읽기
    // ---------------------------------------------------------------------------------------------

    /**
     * 구성 XML로 hardwareMap을 만든다. null이면 장치가 없는 hardwareMap(구성 없는 로봇). 모르는 태그·형식 오류·
     * 겹치는 이름이나 포트는 SandbotConfigException이다. 비용은 청구하지 않는다(로봇을 켤 때의 일).
     */
    public static HardwareMap create(File configXmlOrNull) throws SandbotConfigException {
        HardwareMap map = new HardwareMap(null, null);
        List<HardwareDevice> built = new ArrayList<>();
        synchronized (BUILT) {
            BUILT.put(map, built);
        }
        if (configXmlOrNull == null) return map;
        boolean charging = SimHub.isCharging();
        SimHub.setCharging(false);
        try {
            build(map, built, parse(configXmlOrNull).getDocumentElement());
        } finally {
            SimHub.setCharging(charging);
        }
        return map;
    }

    private static void build(HardwareMap map, List<HardwareDevice> built, Element robot) throws SandbotConfigException {
        if (!"Robot".equals(robot.getTagName()))
            throw new SandbotConfigException("Robot configuration must start with <Robot>, found <" + robot.getTagName() + ">");
        Builder builder = new Builder(map, built);
        for (Element child : children(robot)) {
            switch (child.getTagName()) {
                case "LynxUsbDevice":
                    builder.lynxUsbDevice(child);
                    break;
                case "Webcam":
                    builder.webcam(child);
                    break;
                case "EthernetDevice":
                    builder.ethernetDevice(child);
                    break;
                default:
                    throw new SandbotConfigException("Unsupported device <" + child.getTagName() + "> in the robot configuration");
            }
        }
    }

    private static Document parse(File file) throws SandbotConfigException {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setExpandEntityReferences(false);
            factory.setNamespaceAware(false);
            DocumentBuilder documentBuilder = factory.newDocumentBuilder();
            documentBuilder.setErrorHandler(null);
            return documentBuilder.parse(file);
        } catch (ParserConfigurationException e) {
            throw new SandbotConfigException("XML parser is not available: " + e.getMessage(), e);
        } catch (SAXException e) {
            throw new SandbotConfigException("Robot configuration " + file.getName() + " is not valid XML: " + e.getMessage(), e);
        } catch (IOException e) {
            throw new SandbotConfigException("Cannot read robot configuration " + file.getPath() + ": " + e.getMessage(), e);
        }
    }

    private static List<Element> children(Element parent) {
        List<Element> result = new ArrayList<>();
        for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) {
            if (n.getNodeType() == Node.ELEMENT_NODE) result.add((Element) n);
        }
        return result;
    }

    private static String name(Element e) throws SandbotConfigException {
        if (!e.hasAttribute("name")) throw new SandbotConfigException("<" + e.getTagName() + "> has no name attribute");
        String name = e.getAttribute("name").trim();
        if (name.isEmpty()) throw new SandbotConfigException("<" + e.getTagName() + "> has an empty name");
        return name;
    }

    private static int intAttribute(Element e, String attribute) throws SandbotConfigException {
        if (!e.hasAttribute(attribute))
            throw new SandbotConfigException("<" + e.getTagName() + " name=\"" + e.getAttribute("name") + "\"> has no " + attribute + " attribute");
        try {
            return Integer.parseInt(e.getAttribute(attribute).trim());
        } catch (NumberFormatException ex) {
            throw new SandbotConfigException("<" + e.getTagName() + " name=\"" + e.getAttribute("name") + "\"> has an invalid " + attribute
                    + " \"" + e.getAttribute(attribute) + "\"");
        }
    }

    /** 구성 하나를 읽는 동안의 상태 */
    private static final class Builder {
        final HardwareMap map;
        final List<HardwareDevice> built;
        final Set<String> names = new LinkedHashSet<>();

        Builder(HardwareMap map, List<HardwareDevice> built) {
            this.map = map;
            this.built = built;
        }

        void claimName(String name) throws SandbotConfigException {
            if (!names.add(name) || Sim.devices().get(name) != null)
                throw new SandbotConfigException("Duplicate device name \"" + name + "\" in the robot configuration");
        }

        void lynxUsbDevice(Element usb) throws SandbotConfigException {
            int parentAddress = usb.hasAttribute("parentModuleAddress") ? intAttribute(usb, "parentModuleAddress") : 173;
            for (Element module : children(usb)) {
                if (!"LynxModule".equals(module.getTagName()))
                    throw new SandbotConfigException("Unsupported module <" + module.getTagName() + "> in <LynxUsbDevice>");
                lynxModule(module, parentAddress);
            }
        }

        void lynxModule(Element element, int parentAddress) throws SandbotConfigException {
            String name = name(element);
            int address = intAttribute(element, "port");
            if (address < 1 || address > 254)
                throw new SandbotConfigException("Hub \"" + name + "\" has an invalid address " + address);
            claimName(name);
            SimHub hub = new SimHub(name, address, address == parentAddress);
            LynxModule module = hub.module;
            map.put(name, module);
            built.add(module);

            // 컨트롤러(실제 mapLynxModuleComponents와 같은 순서)
            SimDcMotorController motors = new SimDcMotorController(hub);
            map.dcMotorController.put(name, motors);
            SimServoController servos = new SimServoController(hub);
            map.servoController.put(name, servos);
            SimVoltageSensor voltage = new SimVoltageSensor(hub);
            map.voltageSensor.put(name, voltage);
            SimAnalogInputController analog = new SimAnalogInputController(hub);
            map.put(name, analog);
            SimDigitalChannelController digital = new SimDigitalChannelController(hub);
            map.put(name, digital);
            built.add(motors);
            built.add(servos);
            built.add(voltage);
            built.add(analog);
            built.add(digital);
            // 허브와 연결될 때의 초기화(LynxController.hook → initializeHardware)
            motors.initializeHardware();
            servos.initializeHardware();
            digital.initializeHardware();

            Set<String> ports = new HashSet<>();
            for (Element device : children(element)) {
                String tag = device.getTagName();
                if (MOTOR_CLASSES.containsKey(tag)) motor(hub, device, ports);
                else if (SERVO_TYPES.containsKey(tag)) servo(hub, device, ports);
                else if (DIGITAL_TAGS.contains(tag)) digital(hub, device, ports);
                else if ("AnalogInput".equals(tag)) analog(hub, device, ports);
                else if (I2C_TAGS.contains(tag)) i2c(hub, device);
                else throw new SandbotConfigException("Unsupported device type <" + tag + " name=\"" + device.getAttribute("name")
                        + "\"> on hub \"" + name + "\"");
            }
        }

        int port(Element device, String kind, int count, Set<String> ports) throws SandbotConfigException {
            int port = intAttribute(device, "port");
            if (port < 0 || port >= count)
                throw new SandbotConfigException("<" + device.getTagName() + " name=\"" + device.getAttribute("name") + "\"> has an invalid "
                        + kind + " port " + port + " (valid ports are 0.." + (count - 1) + ")");
            if (!ports.add(kind + port))
                throw new SandbotConfigException("Two devices use " + kind + " port " + port + " (\"" + device.getAttribute("name") + "\")");
            return port;
        }

        void addUserDevice(String name, HardwareDevice device) {
            map.put(name, device);
            for (HardwareMap.DeviceMapping<? extends HardwareDevice> mapping : map.allDeviceMappings) addToMapping(mapping, name, device);
            built.add(device);
        }

        void motor(SimHub hub, Element device, Set<String> ports) throws SandbotConfigException {
            String name = name(device);
            int port = port(device, "motor", 4, ports);
            claimName(name);
            MotorConfigurationType type = motorType(device.getTagName());
            hub.motors.attach(port, name, device.getTagName());
            DcMotor motor = new DcMotorImplEx(hub.motors, port, DcMotor.Direction.FORWARD, type);
            map.dcMotor.put(name, motor);
            built.add(motor);
        }

        void servo(SimHub hub, Element device, Set<String> ports) throws SandbotConfigException {
            String name = name(device);
            int port = port(device, "servo", 6, ports);
            claimName(name);
            Object[] type = SERVO_TYPES.get(device.getTagName());
            String kind = (String) type[0];
            hub.servos.attach(port, name, kind, (PwmControl.PwmRange) type[1]);
            HardwareDevice result;
            switch (kind) {
                case SimServoController.KIND_SERVO:
                    // ServoConfigurationType은 껍데기라 만들 수 없다: 펄스 범위는 attach가 이미 정했다
                    result = new ServoImplEx(hub.servos, port, Servo.Direction.FORWARD, null);
                    break;
                case SimServoController.KIND_BLINKIN:
                    result = new RevBlinkinLedDriver(hub.servos, port);
                    break;
                default:
                    result = new CRServoImplEx(hub.servos, port, DcMotor.Direction.FORWARD, null);
            }
            addUserDevice(name, result);
        }

        void digital(SimHub hub, Element device, Set<String> ports) throws SandbotConfigException {
            String name = name(device);
            int port = port(device, "digital", 8, ports);
            claimName(name);
            switch (device.getTagName()) {
                case "RevTouchSensor":
                    hub.digital.attach(port, name, SimDigitalChannelController.KIND_TOUCH);
                    addUserDevice(name, new RevTouchSensor(hub.digital, port));
                    break;
                case "Led":
                    hub.digital.attach(port, name, SimDigitalChannelController.KIND_LED);
                    addUserDevice(name, new LED(hub.digital, port));
                    break;
                default:
                    hub.digital.attach(port, name, SimDigitalChannelController.KIND_DIGITAL);
                    addUserDevice(name, new DigitalChannelImpl(hub.digital, port));
            }
        }

        void analog(SimHub hub, Element device, Set<String> ports) throws SandbotConfigException {
            String name = name(device);
            int port = port(device, "analog", 4, ports);
            claimName(name);
            hub.analog.attach(port, name);
            addUserDevice(name, new AnalogInput(hub.analog, port));
        }

        void i2c(SimHub hub, Element device) throws SandbotConfigException {
            String name = name(device);
            int bus = intAttribute(device, "bus");
            if (bus < 0 || bus > 3)
                throw new SandbotConfigException("<" + device.getTagName() + " name=\"" + name + "\"> has an invalid I2C bus " + bus);
            claimName(name);
            String tag = device.getTagName();
            HardwareDevice result;
            switch (tag) {
                case "ControlHubImuBHI260AP":
                case "LynxEmbeddedIMU": {
                    boolean bhi = "ControlHubImuBHI260AP".equals(tag);
                    SimDevice sim = Sim.devices().add(name, SimImu.KIND);
                    SimI2cDeviceSynch client = new SimI2cDeviceSynch(hub, bus, I2cAddr.create7bit(0x28), name, new SilentChip());
                    SimImu imu = new SimImu(client, bhi ? SimImu.Chip.BHI260AP : SimImu.Chip.BNO055, sim);
                    if (bus == 0) hub.imuType = bhi ? LynxModuleImuType.BHI260 : LynxModuleImuType.BNO055;
                    if (!bhi) {
                        // 실제 SDK처럼 한 구성 항목에 두 드라이버(IMU와 옛 BNO055IMU, 같은 칩): HardwareFactory.addUserDevicesToMap
                        List<HardwareDevice> drivers = new ArrayList<>();
                        drivers.add(imu);
                        drivers.add(new SimBNO055IMU(client, imu));
                        for (HardwareDevice driver : drivers) addUserDevice(name, driver);
                        map.put(name, drivers);
                        return;
                    }
                    result = imu;
                    break;
                }
                case "REV_VL53L0X_RANGE_SENSOR": {
                    SimDevice sim = Sim.devices().add(name, VL53L0XChip.KIND);
                    result = new Rev2mDistanceSensor(new SimI2cDeviceSynch(hub, bus, I2cAddr.create7bit(0x29), name, new VL53L0XChip(sim)), true);
                    break;
                }
                case "RevColorSensorV3": {
                    SimDevice sim = Sim.devices().add(name, ColorSensorV3Chip.KIND);
                    result = new RevColorSensorV3(new SimI2cDeviceSynch(hub, bus, I2cAddr.create7bit(0x52), name, new ColorSensorV3Chip(sim)), true);
                    break;
                }
                case "HuskyLens": {
                    SimDevice sim = Sim.devices().add(name, HuskyLensChip.KIND);
                    result = new HuskyLens(new SimI2cDeviceSynch(hub, bus, I2cAddr.create7bit(0x32), name, new HuskyLensChip(sim)));
                    break;
                }
                case "goBILDAPinpoint": {
                    SimDevice sim = Sim.devices().add(name, PinpointChip.KIND);
                    result = new GoBildaPinpointDriver(new SimI2cDeviceSynch(hub, bus, I2cAddr.create7bit(0x31), name, new PinpointChip(sim)), true);
                    break;
                }
                case "SparkFunOTOS": {
                    SimDevice sim = Sim.devices().add(name, OtosChip.KIND);
                    result = new SparkFunOTOS(new SimI2cDeviceSynch(hub, bus, I2cAddr.create7bit(0x17), name, new OtosChip(sim)));
                    break;
                }
                case "OctoQuadFTC": {
                    SimDevice sim = Sim.devices().add(name, OctoQuadChip.KIND);
                    result = new OctoQuadImpl(new SimI2cDeviceSynch(hub, bus, I2cAddr.create7bit(0x30), name, new OctoQuadChip(sim)), true);
                    break;
                }
                default:
                    throw new SandbotConfigException("Unsupported I2C device <" + tag + ">");
            }
            addUserDevice(name, result);
        }

        void webcam(Element element) throws SandbotConfigException {
            String name = name(element);
            claimName(name);
            String serial = element.getAttribute("serialNumber").trim();
            if (serial.isEmpty()) throw new SandbotConfigException("Webcam \"" + name + "\" has no serial number");
            SimDevice sim = Sim.devices().add(name, SimWebcamName.KIND);
            addUserDevice(name, new SimWebcamName(serial, sim));
        }

        void ethernetDevice(Element element) throws SandbotConfigException {
            String name = name(element);
            claimName(name);
            String ip = element.getAttribute("ipAddress").trim();
            if (!ip.matches("\\d{1,3}(\\.\\d{1,3}){3}"))
                throw new SandbotConfigException("Ethernet device \"" + name + "\" has an invalid IP address \"" + ip + "\"");
            InetAddress address;
            try {
                address = InetAddress.getByName(ip);
            } catch (UnknownHostException e) {
                throw new SandbotConfigException("Ethernet device \"" + name + "\" has an invalid IP address \"" + ip + "\"", e);
            }
            Sim.devices().add(name, "limelight");
            addUserDevice(name, new Limelight3A(null, name, address));
        }
    }

    private static <T extends HardwareDevice> void addToMapping(HardwareMap.DeviceMapping<T> mapping, String name, HardwareDevice device) {
        if (mapping.getDeviceTypeClass().isInstance(device) && !mapping.contains(name)) mapping.putLocal(name, mapping.cast(device));
    }

    private static MotorConfigurationType motorType(String tag) {
        if ("Motor".equals(tag)) return MotorConfigurationType.getUnspecifiedMotorType();
        try {
            MotorConfigurationType type = MotorConfigurationType.getMotorType(Class.forName(MOTOR_CLASSES.get(tag)));
            return type != null ? type : MotorConfigurationType.getUnspecifiedMotorType();
        } catch (ClassNotFoundException e) {
            return MotorConfigurationType.getUnspecifiedMotorType();
        }
    }

    /** 내용을 흉내 낼 필요 없이 트랜잭션 수만 세는 I2C 칩(내장 IMU: 방향 값은 SimImu가 직접 만든다) */
    private static final class SilentChip implements SimI2cChip {
        @Override public byte[] read(int register, int count) {
            return new byte[count];
        }

        @Override public void write(int register, byte[] data) {
        }
    }

    // ---------------------------------------------------------------------------------------------
    // OpMode 앞뒤
    // ---------------------------------------------------------------------------------------------

    private static List<HardwareDevice> devicesOf(HardwareMap map) {
        synchronized (BUILT) {
            List<HardwareDevice> built = BUILT.get(map);
            if (built != null) {
                List<HardwareDevice> result = new ArrayList<>(built);
                // 팀 코드가 나중에 넣은 장치도(드묾)
                for (HardwareDevice device : map.unsafeIterable()) if (!result.contains(device)) result.add(device);
                return result;
            }
        }
        List<HardwareDevice> result = new ArrayList<>();
        for (HardwareDevice device : map.unsafeIterable()) result.add(device);
        return result;
    }

    /**
     * INIT 전(실제 OpModeManagerImpl.resetHardwareForOpMode): 허브와 Lynx 컨트롤러를 먼저, 그다음 나머지 장치를
     * resetDeviceConfigurationForOpMode로 되돌린다(BulkCachingMode OFF, 모터 RUN_WITHOUT_ENCODER·FLOAT·0, 서보 PWM 끔·기본 범위,
     * 디지털 입력, 모터·서보 방향 FORWARD·scaleRange 0..1, I2C 장치는 다음 hardwareMap.get에서 다시 초기화). 그 뒤부터 하드웨어 비용을 청구한다.
     */
    public static void beforeInit(HardwareMap map) {
        SimHub.setCharging(false);
        SimHub.setPreventDangerousHardwareAccess(false);
        List<HardwareDevice> devices = devicesOf(map);
        List<HardwareDevice> first = new ArrayList<>();
        for (HardwareDevice device : devices) if (device instanceof RobotCoreLynxModule) first.add(device);
        for (HardwareDevice device : devices) if (device instanceof RobotCoreLynxController) first.add(device);
        for (HardwareDevice device : first) device.resetDeviceConfigurationForOpMode();
        for (HardwareDevice device : devices) if (!first.contains(device)) device.resetDeviceConfigurationForOpMode();
        SimHub.setCharging(true);
    }

    /**
     * STOP을 받았을 때(DS STOP 또는 requestOpModeStop, 실제 OpModeManagerImpl.callActiveOpModeStop의 앞부분 — OpMode에 정지를
     * 알리기 전): 위험한 하드웨어 명령을 막고(preventDangerousHardwareAccess) 허브마다 fail safe를 보낸다. 그 뒤 OpMode가 끝날 때까지
     * 팀 코드가 보내는 0이 아닌 모터 power·속도, 목표 위치, 서보 펄스·PWM 켜기는 허브에 가지 않는다(실제는 CANCELLED_FOR_SAFETY).
     * 이 일은 이벤트 루프가 하므로 팀 코드의 시간(비용)에 넣지 않는다. 다음 beforeInit이 막은 것을 푼다.
     */
    public static void stopRequested(HardwareMap map) {
        boolean charging = SimHub.isCharging();
        SimHub.setCharging(false);
        try {
            SimHub.setPreventDangerousHardwareAccess(true);
            for (LynxModule module : map.getAll(LynxModule.class)) module.attemptFailSafeAndIgnoreErrors();
        } finally {
            SimHub.setCharging(charging);
        }
    }

    /**
     * OpMode가 끝난 뒤(실제 OpModeManagerImpl.callActiveOpModeStop): 허브마다 fail safe(모든 모터 정지·꺼짐, 서보 PWM 끔).
     * 비용은 더 청구하지 않는다(팀 코드가 보는 시간이 끝났다).
     */
    public static void afterStop(HardwareMap map) {
        SimHub.setCharging(false);
        for (LynxModule module : map.getAll(LynxModule.class)) module.attemptFailSafeAndIgnoreErrors();
    }
}
