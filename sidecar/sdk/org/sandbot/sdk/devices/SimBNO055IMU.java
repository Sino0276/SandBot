package org.sandbot.sdk.devices;

import com.qualcomm.hardware.bosch.BNO055IMU;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.hardware.Gyroscope;
import com.qualcomm.robotcore.hardware.I2cAddr;
import com.qualcomm.robotcore.hardware.I2cAddrConfig;
import com.qualcomm.robotcore.hardware.I2cDeviceSynchDeviceWithParameters;
import com.qualcomm.robotcore.hardware.I2cDeviceSynchSimple;
import com.qualcomm.robotcore.hardware.IntegratingGyroscope;

import org.firstinspires.ftc.robotcore.external.navigation.Acceleration;
import org.firstinspires.ftc.robotcore.external.navigation.AngularVelocity;
import org.firstinspires.ftc.robotcore.external.navigation.AxesOrder;
import org.firstinspires.ftc.robotcore.external.navigation.AxesReference;
import org.firstinspires.ftc.robotcore.external.navigation.Axis;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.MagneticFlux;
import org.firstinspires.ftc.robotcore.external.navigation.Orientation;
import org.firstinspires.ftc.robotcore.external.navigation.Position;
import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;
import org.firstinspires.ftc.robotcore.external.navigation.Temperature;
import org.firstinspires.ftc.robotcore.external.navigation.Velocity;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimUnsupportedException;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 허브 내장 BNO055(구성 태그 LynxEmbeddedIMU)의 옛 {@link BNO055IMU} 인터페이스 드라이버. 실제 SDK는 이 태그에 두 드라이버
 * (LynxEmbeddedIMU = BNO055IMUImpl → BNO055IMU, LynxEmbeddedBNO055IMUNew → IMU)를 두어 같은 구성 이름에서
 * {@code hardwareMap.get(BNO055IMU.class, …)}와 {@code get(IMU.class, …)}가 같은 칩을 준다. 여기서는 IMU 쪽이 {@link SimImu}이고
 * 이 클래스는 그 칩 상태(시뮬레이터 입력, 허브 장착 방향, 리셋 뒤 heading, I2C 버스·비용)를 같이 쓴다. BHI260AP
 * (ControlHubImuBHI260AP)는 실제처럼 BNO055IMU로 꺼낼 수 없다. 클래스 이름에 BNO055가 있어야 HardwareMap의 "BHI260만 있음" 경고
 * 판단(클래스 이름)과 맞는다.
 *
 * <p>실제 BNO055IMUImpl과 같은 것: 같은 인터페이스(BNO055IMU, Gyroscope, IntegratingGyroscope, I2cAddrConfig,
 * OpModeManagerNotifier.Notifications)라 그 형식으로 hardwareMap.get·형 변환이 된다. 만들 때는 DISABLED 매개변수라
 * {@code initialize(Parameters)} 전에 값을 읽으면 예외("The IMU was not initialized", 실제 형식 ImuNotInitializedException은
 * 껍데기라 IllegalStateException), CONFIG 모드로 초기화하면 IllegalArgumentException, OpMode가 바뀌어도 초기화와 매개변수를
 * 지킨다(resetDeviceConfigurationForOpMode). {@code initialize}는 할 때마다 칩을 리셋(SYS_TRIGGER)해 칩이 그 자리에서 전원을 켠
 * 것처럼 heading을 그때부터 센다(피치·롤은 그대로, 같은 칩의 IMU 인터페이스도 리셋된 값을 본다). {@code getAngularOrientation()}은
 * 칩 축의 내재 ZYX(첫째 = 칩 기준 틀 Z(위) 둘레 반시계 +, 둘째 Y, 셋째 X)를 {@code Parameters.angleUnit}으로 정규화해 준다
 * ({@link #chipEulerZyx}). 허브 장착 방향을 모르는 옛 API라 로봇 축이 아니라 칩 축이다(허브 로고 위·USB 앞이면 로봇 축과 같다).
 * 적분기가 null을 주면 getAcceleration·getVelocity·getPosition은 새 0 값을 준다.
 *
 * <p>시뮬레이션 근사: 각속도는 칩 축 레지스터 값(실제처럼 X·Y 부호를 바꿔서), 중력 가속도는 칩 축으로 돌린 (0, 0, 9.80665) m/s²(선형 가속도는 시뮬레이터 입력이
 * 없어 0), 자기장 0, 온도 25 °C, 보정 상태는 모두 완료(0xFF). 가속도 적분은 실제와 달리 따로 스레드를 돌리지 않고(사이드카는
 * OpMode 스레드 하나) 적분기에 시작 위치·속도만 넣는다(선형 가속도가 0이라 그대로다, 팀 적분기의 update는 부르지 않는다).
 * 레지스터 직접 읽기·쓰기는 지원하지 않는다. I2C 비용: 초기화는 실제 internalInitializeOnce의 트랜잭션·기다림({@link #resetChip}),
 * 방향·각속도·중력·상태·온도 읽기는 한 번씩.
 */
public final class SimBNO055IMU extends I2cDeviceSynchDeviceWithParameters<I2cDeviceSynchSimple, BNO055IMU.Parameters>
        implements BNO055IMU, Gyroscope, IntegratingGyroscope, I2cAddrConfig, OpModeManagerNotifier.Notifications {
    private static final double GRAVITY = 9.80665;
    /**
     * SYS_TRIGGER 리셋 뒤 칩이 다시 I2C에 답하기까지(BNO055 데이터시트의 POR 시간 650 ms, 실제 BNO055Util.imuIsPresent도 칩이 없으면
     * 650 ms를 기다려 다시 묻는다)
     */
    private static final long RESET_NANOS = 650_000_000L;
    /**
     * cos(내재 ZYX의 둘째 각)이 이보다 작으면 칩 X가 수직(둘째 각 ±90°, 짐벌 잠금)으로 본다. float 쿼터니언의 반올림 오차(1e-7 수준)보다
     * 충분히 크고, 잠금으로 볼 때 세 각이 나타내는 회전은 이 값(rad)보다 덜 틀어진다.
     */
    private static final double GIMBAL_LOCK = 1e-5;

    private final SimImu chip;
    private AccelerationIntegrator accelerationAlgorithm = new StillIntegrator();

    SimBNO055IMU(I2cDeviceSynchSimple deviceClient, SimImu chip) {
        // 같은 I2C 클라이언트(SimImu가 가진다)
        super(deviceClient, false, disabledParameters());
        this.chip = chip;
    }

    private static Parameters disabledParameters() {
        Parameters parameters = new Parameters();
        parameters.mode = SensorMode.DISABLED;
        return parameters;
    }

    private void transactions(int count) {
        for (int i = 0; i < count; i++) deviceClient.read(0, 1);
    }

    private void throwIfNotInitialized() {
        if (parameters.mode == SensorMode.DISABLED) throw new IllegalStateException("The IMU was not initialized");
    }

    @Override protected boolean internalInitialize(Parameters parameters) {
        if (parameters.mode == SensorMode.DISABLED) return true;
        if (parameters.mode == SensorMode.CONFIG)
            throw new IllegalArgumentException("SensorMode.CONFIG illegal for use as initialization mode");
        Parameters copy = parameters.clone();
        if (copy.accelerationIntegrationAlgorithm != null) accelerationAlgorithm = copy.accelerationIntegrationAlgorithm;
        try {
            resetChip();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        // 리셋한 칩은 IMU 모드로 들어가며 융합을 다시 시작한다(heading 0부터)
        chip.restartFusion();
        this.parameters = copy;
        this.isInitialized = true;
        return true;
    }

    /**
     * 실제 BNO055IMUImpl.internalInitializeOnce의 I2C 트랜잭션과 기다림(칩은 이미 융합 모드다: 허브를 켤 때 IMU 드라이버가 초기화한다).
     * imuIsPresent의 CHIP_ID 읽기, setSensorMode(CONFIG)의 OPR_MODE 읽기·쓰기와 25 ms, SYS_TRIGGER = 0x20(RST_SYS) 쓰기, delay(400),
     * 칩이 리셋에서 나올 때까지 CHIP_ID 읽기와 delayExtra(10)(= 60 ms), delayLoreExtra(50)(= 100 ms), BNO055Util.sharedInit(레지스터
     * 쓰기 12번, setSensorMode의 읽기·쓰기와 15 ms), getSystemStatus의 SYS_STAT 읽기.
     */
    private void resetChip() throws InterruptedException {
        transactions(1 + 2);
        Sim.sleepMillis(25);
        transactions(1);
        long resetAt = Sim.nanoTime();
        Sim.sleepMillis(400);
        while (true) {
            // 리셋 중의 CHIP_ID 읽기는 I2C 실패(0)라 다시 읽는다
            boolean ready = Sim.nanoTime() - resetAt >= RESET_NANOS;
            transactions(1);
            if (ready) break;
            Sim.sleepMillis(60);
        }
        Sim.sleepMillis(100);
        transactions(12 + 2);
        Sim.sleepMillis(15);
        transactions(1);
    }

    @Override public void resetDeviceConfigurationForOpMode() {
        // 실제처럼 OpMode가 바뀌어도 칩은 초기화된 채로 둔다
        Parameters keep = this.parameters;
        boolean initialized = this.isInitialized;
        stopAccelerationIntegration();
        super.resetDeviceConfigurationForOpMode();
        this.parameters = keep;
        this.isInitialized = initialized;
    }

    // ---- 방향 ----

    @Override public synchronized Orientation getAngularOrientation() {
        throwIfNotInitialized();
        Quaternion q = chip.chipQuaternion();
        org.firstinspires.ftc.robotcore.external.navigation.AngleUnit unit = parameters.angleUnit.toAngleUnit();
        double[] zyx = chipEulerZyx(q);
        return new Orientation(AxesReference.INTRINSIC, AxesOrder.ZYX, unit, unit.normalize((float) unit.fromRadians(zyx[0])),
                unit.normalize((float) unit.fromRadians(zyx[1])), unit.normalize((float) unit.fromRadians(zyx[2])), q.acquisitionTime);
    }

    /**
     * 칩 방향의 내재 ZYX 각(rad, 첫째·둘째·셋째). 실제 칩이 주는 Euler 레지스터처럼 둘째 각(칩 Y 둘레, 실제 roll)은 ±90° 안이다. SDK의
     * Quaternion.toOrientation은 둘째 각을 asin으로 구하고 두 각 묶음 중 크기가 작은 쪽을 골라, 허브를 세워 칩 X가 수직이면 반올림
     * 오차로 NaN이나 아무 값이 되고 로고를 아래로 단 칩은 heading에 따라 첫째 각이 180° 뛴다. 여기서는 둘째 각을 atan2로 구하고, 잠금
     * ({@link #GIMBAL_LOCK})에서는 셋째를 0으로 두어 중력 둘레 회전을 모두 첫째(heading)에 싣는다. 셋째는 정한 첫째에 맞춰 구하므로 세
     * 각은 늘 같은 회전을 나타낸다(팀이 toAxesOrder로 다른 축 순서로 바꿔도 맞다).
     */
    private static double[] chipEulerZyx(Quaternion q) {
        double n = Math.sqrt((double) q.w * q.w + (double) q.x * q.x + (double) q.y * q.y + (double) q.z * q.z);
        double w = q.w / n, x = q.x / n, y = q.y / n, z = q.z / n;
        // 회전 행렬 R = Rz(첫째)·Ry(둘째)·Rx(셋째)의 성분
        double r00 = 1 - 2 * (y * y + z * z), r10 = 2 * (x * y + w * z), r20 = 2 * (x * z - w * y);
        double r01 = 2 * (x * y - w * z), r11 = 1 - 2 * (x * x + z * z);
        double r02 = 2 * (x * z + w * y), r12 = 2 * (y * z - w * x);
        double cosSecond = Math.hypot(r00, r10);
        double second = Math.atan2(-r20, cosSecond);
        double first = cosSecond < GIMBAL_LOCK ? Math.atan2(-r01, r11) : Math.atan2(r10, r00);
        double sin = Math.sin(first), cos = Math.cos(first);
        double third = Math.atan2(sin * r02 - cos * r12, cos * r11 - sin * r01);
        return new double[] {first, second, third};
    }

    @Override public Orientation getAngularOrientation(AxesReference reference, AxesOrder order,
            org.firstinspires.ftc.robotcore.external.navigation.AngleUnit angleUnit) {
        return getAngularOrientation().toAxesReference(reference).toAxesOrder(order).toAngleUnit(angleUnit);
    }

    @Override public synchronized Quaternion getQuaternionOrientation() {
        throwIfNotInitialized();
        return chip.chipQuaternion();
    }

    @Override public synchronized AngularVelocity getAngularVelocity() {
        throwIfNotInitialized();
        return getAngularVelocity(parameters.angleUnit.toAngleUnit());
    }

    @Override public synchronized AngularVelocity getAngularVelocity(org.firstinspires.ftc.robotcore.external.navigation.AngleUnit unit) {
        throwIfNotInitialized();
        // 실제 BNO055IMUImpl처럼 레지스터 값의 X·Y 부호를 바꾼다(IMU 인터페이스의 BNO055IMUNew는 바꾸지 않는다)
        AngularVelocity raw = chip.chipAngularVelocity().toAngleUnit(unit);
        return new AngularVelocity(unit, -raw.xRotationRate, -raw.yRotationRate, raw.zRotationRate,
                raw.acquisitionTime);
    }

    /** 실제처럼 X·Y·Z(실제는 HashSet, 여기서는 결정성을 위해 넣은 순서) */
    private static Set<Axis> allAxes() {
        Set<Axis> axes = new LinkedHashSet<>();
        axes.add(Axis.X);
        axes.add(Axis.Y);
        axes.add(Axis.Z);
        return axes;
    }

    @Override public Set<Axis> getAngularVelocityAxes() {
        return allAxes();
    }

    @Override public Set<Axis> getAngularOrientationAxes() {
        return allAxes();
    }

    // ---- 가속도·중력·자기장·온도 ----

    /** 칩 축의 중력 반작용(위 방향 +g): 세계 (0, 0, g)를 칩 방향의 역으로 돌린 것 */
    private Acceleration gravity() {
        Quaternion q = chip.chipQuaternion().normalized();
        // v' = q* v q (q의 켤레로 돌림)
        double w = q.w, x = -q.x, y = -q.y, z = -q.z;
        double gx = 2 * (x * z + w * y) * GRAVITY;
        double gy = 2 * (y * z - w * x) * GRAVITY;
        double gz = (1 - 2 * (x * x + y * y)) * GRAVITY;
        return new Acceleration(DistanceUnit.METER, gx, gy, gz, q.acquisitionTime);
    }

    @Override public synchronized Acceleration getOverallAcceleration() {
        throwIfNotInitialized();
        return gravity();
    }

    @Override public synchronized Acceleration getLinearAcceleration() {
        throwIfNotInitialized();
        transactions(1);
        return new Acceleration(DistanceUnit.METER, 0, 0, 0, SimLastKnown.now());
    }

    @Override public synchronized Acceleration getGravity() {
        throwIfNotInitialized();
        return gravity();
    }

    @Override public synchronized MagneticFlux getMagneticFieldStrength() {
        throwIfNotInitialized();
        transactions(1);
        return new MagneticFlux(0, 0, 0, SimLastKnown.now());
    }

    @Override public synchronized Temperature getTemperature() {
        throwIfNotInitialized();
        transactions(1);
        return new Temperature(org.firstinspires.ftc.robotcore.external.navigation.TempUnit.CELSIUS, 25, SimLastKnown.now())
                .toUnit(parameters.temperatureUnit.toTempUnit());
    }

    // ---- 가속도 적분(스레드 없이) ----

    @Override public Position getPosition() {
        Position position = accelerationAlgorithm.getPosition();
        return position != null ? position : new Position();
    }

    @Override public Velocity getVelocity() {
        Velocity velocity = accelerationAlgorithm.getVelocity();
        return velocity != null ? velocity : new Velocity();
    }

    @Override public Acceleration getAcceleration() {
        Acceleration acceleration = accelerationAlgorithm.getAcceleration();
        return acceleration != null ? acceleration : new Acceleration();
    }

    @Override public void startAccelerationIntegration(Position initialPosition, Velocity initialVelocity, int msPollInterval) {
        throwIfNotInitialized();
        accelerationAlgorithm.initialize(parameters, initialPosition, initialVelocity);
    }

    @Override public void stopAccelerationIntegration() {
        // 적분 스레드가 없다
    }

    // ---- 상태·보정 ----

    @Override public synchronized SystemStatus getSystemStatus() {
        transactions(1);
        if (parameters.mode == SensorMode.DISABLED) return SystemStatus.IDLE;
        return parameters.mode.isFusionMode() ? SystemStatus.RUNNING_FUSION : SystemStatus.RUNNING_NO_FUSION;
    }

    @Override public synchronized SystemError getSystemError() {
        transactions(1);
        return SystemError.NO_ERROR;
    }

    @Override public synchronized CalibrationStatus getCalibrationStatus() {
        transactions(1);
        return new CalibrationStatus(0xFF);
    }

    @Override public boolean isSystemCalibrated() {
        return true;
    }

    @Override public boolean isGyroCalibrated() {
        return true;
    }

    @Override public boolean isAccelerometerCalibrated() {
        return true;
    }

    @Override public boolean isMagnetometerCalibrated() {
        return true;
    }

    @Override public CalibrationData readCalibrationData() {
        transactions(2);
        return new CalibrationData();
    }

    @Override public void writeCalibrationData(CalibrationData data) {
        transactions(2);
    }

    // ---- 레지스터 직접 접근(칩 레지스터는 흉내 내지 않는다) ----

    @Override public byte read8(Register register) {
        throw new SimUnsupportedException("com.qualcomm.hardware.bosch.BNO055IMU#read8(com.qualcomm.hardware.bosch.BNO055IMU$Register)");
    }

    @Override public byte[] read(Register register, int cb) {
        throw new SimUnsupportedException("com.qualcomm.hardware.bosch.BNO055IMU#read(com.qualcomm.hardware.bosch.BNO055IMU$Register,int)");
    }

    @Override public void write8(Register register, int bVal) {
        throw new SimUnsupportedException("com.qualcomm.hardware.bosch.BNO055IMU#write8(com.qualcomm.hardware.bosch.BNO055IMU$Register,int)");
    }

    @Override public void write(Register register, byte[] data) {
        throw new SimUnsupportedException("com.qualcomm.hardware.bosch.BNO055IMU#write(com.qualcomm.hardware.bosch.BNO055IMU$Register,byte[])");
    }

    /**
     * 기본 적분기(실제 NaiveAccelerationIntegrator는 패키지 밖에서 만들 수 없다): 선형 가속도 입력이 없으므로 시작 위치·속도를 그대로
     * 돌려준다(update는 기록만).
     */
    private static final class StillIntegrator implements AccelerationIntegrator {
        private Position position = new Position();
        private Velocity velocity = new Velocity();
        private Acceleration acceleration;

        @Override public void initialize(Parameters parameters, Position initialPosition, Velocity initialVelocity) {
            position = initialPosition != null ? initialPosition : position;
            velocity = initialVelocity != null ? initialVelocity : velocity;
            acceleration = null;
        }

        @Override public Position getPosition() {
            return position;
        }

        @Override public Velocity getVelocity() {
            return velocity;
        }

        @Override public Acceleration getAcceleration() {
            return acceleration;
        }

        @Override public void update(Acceleration linearAcceleration) {
            acceleration = linearAcceleration;
        }
    }

    // ---- I2C 주소·OpMode 알림(실제 BNO055IMUImpl) ----

    @Override public I2cAddr getI2cAddress() {
        return parameters.i2cAddr;
    }

    @Override public void setI2cAddress(I2cAddr newAddress) {
        parameters.i2cAddr = newAddress;
        deviceClient.setI2cAddress(newAddress);
    }

    @Override public void onOpModePreInit(OpMode opMode) {
    }

    @Override public void onOpModePreStart(OpMode opMode) {
    }

    @Override public void onOpModePostStop(OpMode opMode) {
        stopAccelerationIntegration();
    }

    // ---- HardwareDevice ----

    @Override public void close() {
        stopAccelerationIntegration();
        super.close();
    }

    @Override public Manufacturer getManufacturer() {
        return Manufacturer.Lynx;
    }

    @Override public String getDeviceName() {
        return SimImu.Chip.BNO055.deviceName;
    }
}
