package org.sandbot.sdk.devices;

import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.hardware.I2cDeviceSynchDeviceWithParameters;
import com.qualcomm.robotcore.hardware.I2cDeviceSynchSimple;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.QuaternionBasedImuHelper;

import org.firstinspires.ftc.robotcore.external.matrices.VectorF;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.AngularVelocity;
import org.firstinspires.ftc.robotcore.external.navigation.AxesOrder;
import org.firstinspires.ftc.robotcore.external.navigation.AxesReference;
import org.firstinspires.ftc.robotcore.external.navigation.Orientation;
import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimDevice;

/**
 * 허브 내장 IMU(구성 태그 ControlHubImuBHI260AP = BHI260AP, LynxEmbeddedIMU = BNO055). 팀 코드는 IMU 인터페이스로만 쓴다
 * (실제 BHI260IMU·LynxEmbeddedBNO055IMUNew 클래스는 칩 펌웨어·GPIO에 묶여 있어 같은 이름으로 두지 않는다).
 *
 * <p>방향 계산은 실제 드라이버와 같은 QuaternionBasedImuHelper(들여온 실제 클래스)가 한다: resetYaw, 허브 장착 방향
 * (RevHubOrientationOnRobot), 요·피치·롤 순서가 실제와 같다. 시뮬레이터 입력은 로봇의 실제 방향(SDK IMU 좌표: X 오른쪽, Y 앞, Z 위)
 * yaw·pitch·roll(rad, 내재 ZXY)과 yawRate·pitchRate·rollRate(rad/s)이고, 장치는 이를 구성한 장착 방향으로 칩 좌표로 바꿔
 * 보고한다(그래서 resetYaw 전에는 입력 그대로 보인다).
 *
 * <p>I2C 트랜잭션 수(실제 드라이버 소스로 셈): 초기화(hardwareMap.get의 지연 초기화, initialize(Parameters)) BHI260AP 13번,
 * BNO055 18번 + 모드 전환 대기 40 ms. 방향 읽기 1번(쿼터니언 8바이트), 각속도 읽기 1번. resetYaw는 방향 읽기 1번.
 */
public final class SimImu extends I2cDeviceSynchDeviceWithParameters<I2cDeviceSynchSimple, IMU.Parameters> implements IMU {
    public static final String KIND = "imu";

    /** 칩 종류 */
    public enum Chip {
        BHI260AP("REV internal IMU (BHI260AP)", 13, 0),
        BNO055("REV internal IMU (BNO055)", 18, 40);

        final String deviceName;
        final int initTransactions;
        final int initSleepMs;

        Chip(String deviceName, int initTransactions, int initSleepMs) {
            this.deviceName = deviceName;
            this.initTransactions = initTransactions;
            this.initSleepMs = initSleepMs;
        }
    }

    private final Chip chip;
    private final SimDevice device;
    private final QuaternionBasedImuHelper helper;

    SimImu(I2cDeviceSynchSimple deviceClient, Chip chip, SimDevice device) {
        super(deviceClient, true, new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.UP,
                RevHubOrientationOnRobot.UsbFacingDirection.FORWARD)));
        this.chip = chip;
        this.device = device;
        this.helper = new QuaternionBasedImuHelper(parameters.imuOrientationOnRobot);
        // 실제 드라이버는 만들 때 초기화하고 yaw를 0으로 둔다(로봇을 켤 때라 팀 코드의 시간 밖, 비용 없음)
        this.isInitialized = true;
        publish();
    }

    private void transactions(int count) {
        for (int i = 0; i < count; i++) deviceClient.read(0, 1);
    }

    @Override protected boolean internalInitialize(IMU.Parameters parameters) {
        parameters = parameters.copy();
        this.parameters = parameters;
        helper.setImuOrientationOnRobot(parameters.imuOrientationOnRobot);
        transactions(chip.initTransactions);
        if (chip.initSleepMs > 0) {
            try {
                Sim.sleepMillis(chip.initSleepMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        publish();
        return true;
    }

    private void publish() {
        device.output("chip", chip.name());
    }

    /** 칩 좌표의 방향(실제 getRawQuaternion). 입력 로봇 방향을 장착 방향으로 거꾸로 바꾼다. */
    private Quaternion getRawQuaternion() {
        deviceClient.read(0, 8); // 쿼터니언 읽기 한 번
        long now = SimLastKnown.now();
        double yaw = device.inputDouble("yaw", 0), pitch = device.inputDouble("pitch", 0), roll = device.inputDouble("roll", 0);
        Quaternion qz = new Quaternion((float) Math.cos(yaw / 2), 0, 0, (float) Math.sin(yaw / 2), now);
        Quaternion qx = new Quaternion((float) Math.cos(pitch / 2), (float) Math.sin(pitch / 2), 0, 0, now);
        Quaternion qy = new Quaternion((float) Math.cos(roll / 2), 0, (float) Math.sin(roll / 2), 0, now);
        Quaternion robot = qz.multiply(qx, now).multiply(qy, now).normalized();
        Quaternion m = parameters.imuOrientationOnRobot.imuCoordinateSystemOrientationFromPerspectiveOfRobot();
        Quaternion offset = parameters.imuOrientationOnRobot.imuRotationOffset();
        Quaternion raw = m.inverse().multiply(robot.multiply(offset.inverse(), now), now).multiply(m, now).normalized();
        return new Quaternion(raw.w, raw.x, raw.y, raw.z, now);
    }

    private AngularVelocity getRawAngularVelocity() {
        deviceClient.read(0, 6); // 각속도 읽기 한 번
        long now = SimLastKnown.now();
        VectorF robot = new VectorF(
                (float) Math.toDegrees(device.inputDouble("pitchRate", 0)),
                (float) Math.toDegrees(device.inputDouble("rollRate", 0)),
                (float) Math.toDegrees(device.inputDouble("yawRate", 0)));
        VectorF raw = parameters.imuOrientationOnRobot.angularVelocityTransform().inverse().applyToVector(robot);
        return new AngularVelocity(AngleUnit.DEGREES, raw.get(0), raw.get(1), raw.get(2), now);
    }

    // ---- 같은 칩의 옛 BNO055IMU 드라이버(SimBNO055IMU)가 쓰는 칩 좌표 값(같은 상태, 같은 I2C 비용) ----

    Chip chip() {
        return chip;
    }

    /** 칩 좌표의 방향(쿼터니언 읽기 한 번) */
    Quaternion chipQuaternion() {
        return getRawQuaternion();
    }

    /** 칩 좌표의 각속도(°/s, 각속도 읽기 한 번) */
    AngularVelocity chipAngularVelocity() {
        return getRawAngularVelocity();
    }

    // ---- IMU ----

    @Override public void resetYaw() {
        helper.resetYaw(chip.name(), this::getRawQuaternion, chip == Chip.BNO055 ? 100 : 50);
    }

    @Override public YawPitchRollAngles getRobotYawPitchRollAngles() {
        return helper.getRobotYawPitchRollAngles(chip.name(), this::getRawQuaternion);
    }

    @Override public Orientation getRobotOrientation(AxesReference reference, AxesOrder order, AngleUnit angleUnit) {
        return helper.getRobotOrientation(chip.name(), this::getRawQuaternion, reference, order, angleUnit);
    }

    @Override public Quaternion getRobotOrientationAsQuaternion() {
        return helper.getRobotOrientationAsQuaternion(chip.name(), this::getRawQuaternion, true);
    }

    @Override public AngularVelocity getRobotAngularVelocity(AngleUnit angleUnit) {
        return helper.getRobotAngularVelocity(getRawAngularVelocity(), angleUnit);
    }

    // ---- HardwareDevice ----

    @Override public Manufacturer getManufacturer() {
        return Manufacturer.Lynx;
    }

    @Override public String getDeviceName() {
        return chip.deviceName;
    }

    @Override public String getConnectionInfo() {
        return chip == Chip.BHI260AP ? String.format("BHI260 IMU on %s", deviceClient.getConnectionInfo()) : deviceClient.getConnectionInfo();
    }
}
