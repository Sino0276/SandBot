package org.sandbot.sdk.devices;

import com.qualcomm.robotcore.exception.TargetPositionNotSetException;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorControllerEx;
import com.qualcomm.robotcore.hardware.MotorControlAlgorithm;
import com.qualcomm.robotcore.hardware.PIDCoefficients;
import com.qualcomm.robotcore.hardware.PIDFCoefficients;
import com.qualcomm.robotcore.hardware.RobotCoreLynxController;
import com.qualcomm.robotcore.hardware.configuration.ExpansionHubMotorControllerParamsState;
import com.qualcomm.robotcore.hardware.configuration.typecontainers.MotorConfigurationType;
import com.qualcomm.robotcore.util.Range;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit;
import org.firstinspires.ftc.robotcore.external.navigation.UnnormalizedAngleUnit;
import org.sandbot.sim.SimDevice;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 허브의 DC 모터 컨트롤러(실제 com.qualcomm.hardware.lynx.LynxDcMotorController를 옮긴 것).
 *
 * <p>SDK 쪽 캐시(LastKnown: 마지막으로 보낸 power·mode·zero power·enable·목표 위치)와 허브 펌웨어 쪽 상태({@link Channel})를
 * 실제처럼 나눈다. 캐시가 같은 값이라고 하면 명령을 보내지 않고(비용 없음), 캐시가 없거나 500 ms가 지나면 허브에 다시 묻는다
 * (Lynx 명령 비용). 엔코더·속도·busy·과전류 읽기는 허브의 BulkCachingMode를 따른다.
 */
public final class SimDcMotorController implements DcMotorControllerEx, RobotCoreLynxController {
    /** 모터 포트(0–3)의 SimDevice 종류 */
    public static final String KIND = "motor";

    static final int API_MOTOR_FIRST = 0;
    static final int API_MOTOR_LAST = 3;
    static final double API_POWER_FIRST = -1.0;
    static final double API_POWER_LAST = 1.0;
    /** LynxSetMotorConstantPowerCommand.apiPowerFirst/Last */
    static final int HUB_POWER_LAST = 32767;
    /** LynxSetMotorTargetVelocityCommand.apiVelocityFirst/Last */
    static final int HUB_VELOCITY_LAST = 32767;
    /** LynxConstants.DEFAULT_TARGET_POSITION_TOLERANCE */
    static final int DEFAULT_TARGET_POSITION_TOLERANCE = 5;

    // 펌웨어의 PID 기본값(측정값이 아닌 근사: REV Core Hex 형식 주석의 값과 같게 둔다)
    static final PIDFCoefficients DEFAULT_VELOCITY_PIDF = new PIDFCoefficients(10, 3, 0, 0, MotorControlAlgorithm.LegacyPID);
    static final PIDFCoefficients DEFAULT_POSITION_PIDF = new PIDFCoefficients(10, 0.05, 0, 0, MotorControlAlgorithm.LegacyPID);

    final SimHub hub;

    /** SDK 쪽 상태(실제 LynxDcMotorController.MotorProperties) */
    private static final class MotorProperties {
        final SimLastKnown<Double> lastKnownPower = new SimLastKnown<>();
        final SimLastKnown<DcMotor.RunMode> lastKnownMode = new SimLastKnown<>();
        final SimLastKnown<DcMotor.ZeroPowerBehavior> lastKnownZeroPowerBehavior = new SimLastKnown<>();
        final SimLastKnown<Boolean> lastKnownEnable = new SimLastKnown<>();
        final SimLastKnown<Double> lastKnownCurrentAlert = new SimLastKnown<>();
        MotorConfigurationType motorType = MotorConfigurationType.getUnspecifiedMotorType();
        MotorConfigurationType internalMotorType = null;
        final Map<DcMotor.RunMode, ExpansionHubMotorControllerParamsState> desiredPIDParams = new ConcurrentHashMap<>();
        final Map<DcMotor.RunMode, ExpansionHubMotorControllerParamsState> originalPIDParams = new ConcurrentHashMap<>();
    }

    /** 허브 펌웨어 쪽 모터 채널 상태와 시뮬레이터 장치 */
    static final class Channel {
        final int port;
        SimDevice device;
        DcMotor.RunMode mode = DcMotor.RunMode.RUN_WITHOUT_ENCODER;
        /** 마지막으로 setMotorMode로 보낸 모드(STOP_AND_RESET_ENCODER 포함, 출력 표시용) */
        DcMotor.RunMode commandedMode = DcMotor.RunMode.RUN_WITHOUT_ENCODER;
        DcMotor.ZeroPowerBehavior zeroPowerBehavior = DcMotor.ZeroPowerBehavior.BRAKE;
        int constantPower = 0;
        int targetVelocity = 0;
        boolean enabled = false;
        int targetPosition = 0;
        int targetTolerance = DEFAULT_TARGET_POSITION_TOLERANCE;
        /** 펌웨어 규칙: RUN_TO_POSITION에서 켜려면 목표 위치를 먼저 받아야 한다(fail safe로 초기화) */
        boolean targetPositionSet = false;
        boolean targetPositionEverSet = false;
        long encoderOffset = 0;
        final int[][] pidf = new int[2][4];
        final MotorControlAlgorithm[] algorithm = new MotorControlAlgorithm[2];
        double currentAlertMilliamps = 0;
        double maxTicksPerSecond;

        Channel(int port) {
            this.port = port;
            storePidf(DcMotor.RunMode.RUN_USING_ENCODER, DEFAULT_VELOCITY_PIDF);
            storePidf(DcMotor.RunMode.RUN_TO_POSITION, DEFAULT_POSITION_PIDF);
        }

        static int pidIndex(DcMotor.RunMode mode) {
            return mode == DcMotor.RunMode.RUN_TO_POSITION ? 1 : 0;
        }

        void storePidf(DcMotor.RunMode mode, PIDFCoefficients c) {
            int[] values = pidf[pidIndex(mode)];
            values[0] = internalCoefficientFromExternal(c.p);
            values[1] = internalCoefficientFromExternal(c.i);
            values[2] = internalCoefficientFromExternal(c.d);
            values[3] = internalCoefficientFromExternal(c.f);
            algorithm[pidIndex(mode)] = c.algorithm;
        }

        PIDFCoefficients readPidf(DcMotor.RunMode mode) {
            int[] values = pidf[pidIndex(mode)];
            return new PIDFCoefficients(
                    externalCoefficientFromInternal(values[0]),
                    externalCoefficientFromInternal(values[1]),
                    externalCoefficientFromInternal(values[2]),
                    externalCoefficientFromInternal(values[3]),
                    algorithm[pidIndex(mode)]);
        }

        long rawPosition() {
            return device == null ? 0 : device.inputLong("position", 0);
        }

        int encoderPosition() {
            return (int) (rawPosition() - encoderOffset);
        }

        int encoderVelocity() {
            return device == null ? 0 : (int) device.inputLong("velocity", 0);
        }

        double currentMilliamps() {
            return device == null ? 0 : device.inputDouble("current", 0) * 1000.0;
        }

        boolean isOverCurrent() {
            if (device != null && device.input("overCurrent") instanceof Boolean) return device.inputBoolean("overCurrent", false);
            return currentAlertMilliamps > 0 && currentMilliamps() > currentAlertMilliamps;
        }

        boolean isAtTarget() {
            return Math.abs((long) targetPosition - encoderPosition()) <= targetTolerance;
        }

        /** 허브가 RUN_TO_POSITION 목표에 아직 가지 못했는가(bulk read의 at-target 비트의 반대) */
        boolean isBusy() {
            return mode == DcMotor.RunMode.RUN_TO_POSITION && !isAtTarget();
        }

        void publish() {
            if (device == null) return;
            device.output("mode", commandedMode.name());
            Double power;
            switch (mode) {
                case RUN_WITHOUT_ENCODER:
                    power = constantPower / (double) HUB_POWER_LAST;
                    break;
                default:
                    power = maxTicksPerSecond > 0
                            ? Range.clip(targetVelocity / maxTicksPerSecond, API_POWER_FIRST, API_POWER_LAST)
                            : 0.0;
            }
            if (commandedMode == DcMotor.RunMode.STOP_AND_RESET_ENCODER) power = 0.0;
            device.output("power", power);
            device.output("velocity", mode == DcMotor.RunMode.RUN_WITHOUT_ENCODER ? null : (Object) targetVelocity);
            device.output("enabled", enabled);
            device.output("zeroPower", zeroPowerBehavior.name());
            device.output("targetPosition", targetPositionEverSet ? (Object) targetPosition : null);
            device.output("targetTolerance", targetTolerance);
        }
    }

    private final MotorProperties[] motors = new MotorProperties[4];
    private final Channel[] channels = new Channel[4];

    SimDcMotorController(SimHub hub) {
        this.hub = hub;
        hub.motors = this;
        for (int i = 0; i < 4; i++) {
            motors[i] = new MotorProperties();
            channels[i] = new Channel(i);
        }
    }

    /** 이 포트에 구성된 장치(모터·데드휠)를 연결한다 */
    SimDevice attach(int port, String name, String motorTypeTag) {
        Channel channel = channels[port];
        channel.device = org.sandbot.sim.Sim.devices().add(name, KIND);
        channel.device.output("motorType", motorTypeTag);
        channel.publish();
        return channel.device;
    }

    Channel channel(int motorZ) {
        return channels[motorZ];
    }

    /** 구성 읽기 때 실제 하드웨어 초기화(LynxController.hook → initializeHardware)와 같은 일을 한다 */
    void initializeHardware() {
        runWithoutEncoders();
        floatHardware();
        forgetLastKnown();
        for (int motor = 0; motor <= API_MOTOR_LAST - API_MOTOR_FIRST; motor++) updateMotorParams(motor);
    }

    void forgetLastKnown() {
        for (MotorProperties motor : motors) {
            motor.lastKnownMode.invalidate();
            motor.lastKnownPower.invalidate();
            motor.lastKnownZeroPowerBehavior.invalidate();
            motor.lastKnownEnable.invalidate();
        }
    }

    /** LynxFailSafeCommand: 허브가 모든 모터를 멈추고 끈다 */
    void hubFailSafe() {
        for (Channel c : channels) {
            c.constantPower = 0;
            c.targetVelocity = 0;
            c.enabled = false;
            c.targetPositionSet = false;
            c.publish();
        }
    }

    // ---------------------------------------------------------------------------------------------
    // HardwareDevice
    // ---------------------------------------------------------------------------------------------

    @Override public Manufacturer getManufacturer() {
        return Manufacturer.Lynx;
    }

    @Override public String getDeviceName() {
        return "Expansion Hub DC Motor Controller";
    }

    @Override public String getConnectionInfo() {
        return hub.module.getConnectionInfo();
    }

    @Override public int getVersion() {
        return 1;
    }

    /** LynxController.resetDeviceConfigurationForOpMode → initializeHardware */
    @Override public void resetDeviceConfigurationForOpMode() {
        initializeHardware();
    }

    @Override public synchronized void close() {
        floatHardware();
    }

    // ---------------------------------------------------------------------------------------------
    // DcMotorControllerEx
    // ---------------------------------------------------------------------------------------------

    @Override public synchronized void setMotorEnable(int motor) {
        validateMotor(motor);
        internalSetMotorEnable(motor - API_MOTOR_FIRST, true);
    }

    @Override public synchronized void setMotorDisable(int motor) {
        validateMotor(motor);
        internalSetMotorEnable(motor - API_MOTOR_FIRST, false);
    }

    void internalSetMotorEnable(int motorZ, boolean enable) {
        if (motors[motorZ].lastKnownEnable.updateValue(enable)) {
            hub.lynxCommand(); // LynxSetMotorChannelEnableCommand
            Channel c = channels[motorZ];
            if (enable && c.mode == DcMotor.RunMode.RUN_TO_POSITION && !c.targetPositionSet) {
                // 펌웨어 NACK MOTOR_NOT_CONFIG_BEFORE_ENABLED
                motors[motorZ].lastKnownEnable.invalidate();
                throw new TargetPositionNotSetException();
            }
            c.enabled = enable;
            c.publish();
        }
    }

    @Override public synchronized boolean isMotorEnabled(int motor) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        Boolean result = motors[motorZ].lastKnownEnable.getValue();
        if (result != null) return result;
        hub.lynxCommand(); // LynxGetMotorChannelEnableCommand
        result = channels[motorZ].enabled;
        motors[motorZ].lastKnownEnable.setValue(result);
        return result;
    }

    // ---------------------------------------------------------------------------------------------
    // DcMotorController
    // ---------------------------------------------------------------------------------------------

    @Override public synchronized void resetDeviceConfigurationForOpMode(int motor) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        MotorProperties m = motors[motorZ];
        m.desiredPIDParams.remove(DcMotor.RunMode.RUN_TO_POSITION);
        m.desiredPIDParams.remove(DcMotor.RunMode.RUN_USING_ENCODER);
        if (m.originalPIDParams.containsKey(DcMotor.RunMode.RUN_TO_POSITION))
            m.desiredPIDParams.put(DcMotor.RunMode.RUN_TO_POSITION, m.originalPIDParams.get(DcMotor.RunMode.RUN_TO_POSITION));
        if (m.originalPIDParams.containsKey(DcMotor.RunMode.RUN_USING_ENCODER))
            m.desiredPIDParams.put(DcMotor.RunMode.RUN_USING_ENCODER, m.originalPIDParams.get(DcMotor.RunMode.RUN_USING_ENCODER));
        if (m.internalMotorType != null) setMotorType(motor, m.internalMotorType);
        else updateMotorParams(motorZ);
    }

    @Override public synchronized MotorConfigurationType getMotorType(int motor) {
        validateMotor(motor);
        return motors[motor - API_MOTOR_FIRST].motorType;
    }

    @Override public synchronized void setMotorType(int motor, MotorConfigurationType motorType) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        MotorProperties m = motors[motorZ];
        m.motorType = motorType;
        if (m.internalMotorType == null) m.internalMotorType = motorType;
        channels[motorZ].maxTicksPerSecond = motorType.getAchieveableMaxTicksPerSecondRounded();
        if (motorType.hasExpansionHubVelocityParams()) rememberPIDParams(motorZ, motorType.getHubVelocityParams());
        if (motorType.hasExpansionHubPositionParams()) rememberPIDParams(motorZ, motorType.getHubPositionParams());
        updateMotorParams(motorZ);
        channels[motorZ].publish();
    }

    private void rememberPIDParams(int motorZ, ExpansionHubMotorControllerParamsState params) {
        motors[motorZ].desiredPIDParams.put(params.mode, params);
    }

    private void updateMotorParams(int motorZ) {
        for (ExpansionHubMotorControllerParamsState params : motors[motorZ].desiredPIDParams.values()) {
            if (!params.isDefault()) internalSetPIDFCoefficients(motorZ, params.mode, params.getPidfCoefficients());
        }
    }

    private int getDefaultMaxMotorSpeed(int motorZ) {
        return motors[motorZ].motorType.getAchieveableMaxTicksPerSecondRounded();
    }

    @Override public synchronized void setMotorMode(int motor, DcMotor.RunMode mode) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        MotorProperties m = motors[motorZ];
        if (!m.lastKnownMode.isValue(mode)) {
            Double prevPower = m.lastKnownPower.getNonTimedValue();
            if (prevPower == null) prevPower = internalGetMotorPower(motorZ);
            Channel c = channels[motorZ];
            if (mode == DcMotor.RunMode.STOP_AND_RESET_ENCODER) {
                internalSetMotorPower(motorZ, 0);
                hub.lynxCommand(); // LynxResetMotorEncoderCommand
                c.encoderOffset = c.rawPosition();
            } else {
                DcMotor.ZeroPowerBehavior zeroPowerBehavior = internalGetZeroPowerBehavior(motorZ);
                hub.lynxCommand(); // LynxSetMotorChannelModeCommand
                c.mode = mode;
                c.zeroPowerBehavior = zeroPowerBehavior;
            }
            c.commandedMode = mode;
            c.publish();
            m.lastKnownMode.setValue(mode);
            internalSetMotorPower(motorZ, prevPower, true);
        }
    }

    @Override public synchronized DcMotor.RunMode getMotorMode(int motor) {
        validateMotor(motor);
        return internalGetPublicMotorMode(motor - API_MOTOR_FIRST);
    }

    private DcMotor.RunMode internalGetPublicMotorMode(int motorZ) {
        MotorProperties m = motors[motorZ];
        DcMotor.RunMode result = m.lastKnownMode.getValue();
        if (result != null) return result;
        if (m.lastKnownMode.getNonTimedValue() == DcMotor.RunMode.STOP_AND_RESET_ENCODER)
            return DcMotor.RunMode.STOP_AND_RESET_ENCODER;
        hub.lynxCommand(); // LynxGetMotorChannelModeCommand
        result = channels[motorZ].mode;
        m.lastKnownMode.setValue(result);
        return result;
    }

    /** 실제 internalGetMotorChannelMode: LynxSetMotorChannelModeCommand에 넣을 수 있는 모드(캐시를 갱신하지 않음) */
    private DcMotor.RunMode internalGetMotorChannelMode(int motorZ) {
        DcMotor.RunMode result = motors[motorZ].lastKnownMode.getValue();
        if (result != null && result != DcMotor.RunMode.STOP_AND_RESET_ENCODER) return result;
        hub.lynxCommand(); // LynxGetMotorChannelModeCommand
        return channels[motorZ].mode;
    }

    @Override public synchronized void setMotorPower(int motor, double apiMotorPower) {
        validateMotor(motor);
        internalSetMotorPower(motor - API_MOTOR_FIRST, apiMotorPower);
    }

    @Override public synchronized double getMotorPower(int motor) {
        validateMotor(motor);
        return internalGetMotorPower(motor - API_MOTOR_FIRST);
    }

    private DcMotor.ZeroPowerBehavior internalGetZeroPowerBehavior(int motorZ) {
        DcMotor.ZeroPowerBehavior result = motors[motorZ].lastKnownZeroPowerBehavior.getValue();
        if (result != null) return result;
        hub.lynxCommand(); // LynxGetMotorChannelModeCommand
        result = channels[motorZ].zeroPowerBehavior;
        motors[motorZ].lastKnownZeroPowerBehavior.setValue(result);
        return result;
    }

    private void internalSetZeroPowerBehavior(int motorZ, DcMotor.ZeroPowerBehavior behavior) {
        if (motors[motorZ].lastKnownZeroPowerBehavior.updateValue(behavior)) {
            DcMotor.RunMode runMode = internalGetMotorChannelMode(motorZ);
            hub.lynxCommand(); // LynxSetMotorChannelModeCommand
            Channel c = channels[motorZ];
            c.mode = runMode;
            c.zeroPowerBehavior = behavior;
            c.publish();
        }
    }

    private void internalSetMotorPower(int motorZ, double apiPower) {
        internalSetMotorPower(motorZ, apiPower, false);
    }

    private void internalSetMotorPower(int motorZ, double apiPower, boolean forceUpdate) {
        double power = Range.clip(apiPower, API_POWER_FIRST, API_POWER_LAST);
        if (motors[motorZ].lastKnownPower.updateValue(power) || forceUpdate) {
            DcMotor.RunMode mode = internalGetPublicMotorMode(motorZ);
            Channel c = channels[motorZ];
            switch (mode) {
                case RUN_TO_POSITION:
                case RUN_USING_ENCODER: {
                    power = Math.signum(power) * Range.scale(Math.abs(power), 0, API_POWER_LAST, 0, getDefaultMaxMotorSpeed(motorZ));
                    hub.lynxCommand(); // LynxSetMotorTargetVelocityCommand
                    c.targetVelocity = (int) power;
                    c.publish();
                    internalSetMotorEnable(motorZ, true);
                    break;
                }
                case RUN_WITHOUT_ENCODER: {
                    power = Range.scale(power, API_POWER_FIRST, API_POWER_LAST, -HUB_POWER_LAST, HUB_POWER_LAST);
                    hub.lynxCommand(); // LynxSetMotorConstantPowerCommand
                    c.constantPower = (int) power;
                    c.publish();
                    internalSetMotorEnable(motorZ, true);
                    break;
                }
                case STOP_AND_RESET_ENCODER:
                default:
                    // 이 모드에서는 power를 보내지 않는다
                    break;
            }
        }
    }

    private double internalGetMotorPower(int motorZ) {
        Double result = motors[motorZ].lastKnownPower.getValue();
        if (result != null) return result;
        DcMotor.RunMode mode = internalGetPublicMotorMode(motorZ);
        Channel c = channels[motorZ];
        switch (mode) {
            case RUN_TO_POSITION:
            case RUN_USING_ENCODER: {
                hub.lynxCommand(); // LynxGetMotorTargetVelocityCommand
                int iVelocity = c.targetVelocity;
                result = Math.signum(iVelocity) * Range.scale(Math.abs(iVelocity), 0, getDefaultMaxMotorSpeed(motorZ), 0, API_POWER_LAST);
                break;
            }
            case RUN_WITHOUT_ENCODER:
            default: {
                hub.lynxCommand(); // LynxGetMotorConstantPowerCommand
                result = Range.scale(c.constantPower, -HUB_POWER_LAST, HUB_POWER_LAST, API_POWER_FIRST, API_POWER_LAST);
            }
        }
        result = Range.clip(result, API_POWER_FIRST, API_POWER_LAST);
        motors[motorZ].lastKnownPower.setValue(result);
        return result;
    }

    @Override public synchronized boolean isBusy(int motor) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        if (hub.isBulkCaching()) {
            return hub.recordBulkCachingCommandIntent("isMotorAtTarget:" + motorZ, "").motorBusy[motorZ];
        }
        // RUN_TO_POSITION이 아닌 모터에 isBusy를 물으면 NAK 로그가 쌓이므로 묻지 않는다
        if (internalGetMotorChannelMode(motorZ) != DcMotor.RunMode.RUN_TO_POSITION) return false;
        hub.lynxCommand(); // LynxIsMotorAtTargetCommand
        return !channels[motorZ].isAtTarget();
    }

    @Override public synchronized void setMotorZeroPowerBehavior(int motor, DcMotor.ZeroPowerBehavior zeroPowerBehavior) {
        validateMotor(motor);
        if (zeroPowerBehavior == DcMotor.ZeroPowerBehavior.UNKNOWN)
            throw new IllegalArgumentException("zeroPowerBehavior may not be UNKNOWN");
        internalSetZeroPowerBehavior(motor - API_MOTOR_FIRST, zeroPowerBehavior);
    }

    @Override public synchronized DcMotor.ZeroPowerBehavior getMotorZeroPowerBehavior(int motor) {
        validateMotor(motor);
        return internalGetZeroPowerBehavior(motor - API_MOTOR_FIRST);
    }

    private synchronized void setMotorPowerFloat(int motor) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        internalSetZeroPowerBehavior(motorZ, DcMotor.ZeroPowerBehavior.FLOAT);
        internalSetMotorPower(motorZ, 0);
    }

    @Override public synchronized boolean getMotorPowerFloat(int motor) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        return internalGetZeroPowerBehavior(motorZ) == DcMotor.ZeroPowerBehavior.FLOAT && internalGetMotorPower(motorZ) == 0;
    }

    @Override public synchronized void setMotorTargetPosition(int motor, int position) {
        setMotorTargetPosition(motor, position, DEFAULT_TARGET_POSITION_TOLERANCE);
    }

    @Override public synchronized void setMotorTargetPosition(int motor, int position, int tolerance) {
        validateMotor(motor);
        hub.lynxCommand(); // LynxSetMotorTargetPositionCommand(목표 위치를 캐시하지 않으므로 부를 때마다 보낸다)
        Channel c = channels[motor - API_MOTOR_FIRST];
        c.targetPosition = position;
        c.targetTolerance = tolerance;
        c.targetPositionSet = true;
        c.targetPositionEverSet = true;
        c.publish();
    }

    @Override public synchronized int getMotorTargetPosition(int motor) {
        validateMotor(motor);
        hub.lynxCommand(); // LynxGetMotorTargetPositionCommand
        return channels[motor - API_MOTOR_FIRST].targetPosition;
    }

    @Override public synchronized int getMotorCurrentPosition(int motor) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        if (hub.isBulkCaching()) {
            return hub.recordBulkCachingCommandIntent("getMotorEncoderPosition:" + motorZ, "").motorPositions[motorZ];
        }
        hub.lynxCommand(); // LynxGetMotorEncoderPositionCommand
        return channels[motorZ].encoderPosition();
    }

    @Override public synchronized void setMotorVelocity(int motor, double ticksPerSecond) {
        switch (getMotorMode(motor)) {
            case RUN_USING_ENCODER:
            case RUN_TO_POSITION:
                break;
            default:
                setMotorMode(motor, DcMotor.RunMode.RUN_USING_ENCODER);
        }
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        int iTicksPerSecond = Range.clip((int) Math.round(ticksPerSecond), -HUB_VELOCITY_LAST, HUB_VELOCITY_LAST);
        hub.lynxCommand(); // LynxSetMotorTargetVelocityCommand
        Channel c = channels[motorZ];
        c.targetVelocity = iTicksPerSecond;
        c.publish();
        internalSetMotorEnable(motorZ, true);
    }

    @Override public synchronized void setMotorVelocity(int motor, double angularRate, AngleUnit unit) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        double degreesPerSecond = UnnormalizedAngleUnit.DEGREES.fromUnit(unit.getUnnormalized(), angularRate);
        double revolutionsPerSecond = degreesPerSecond / 360.0;
        double ticksPerSecond = motors[motorZ].motorType.getTicksPerRev() * revolutionsPerSecond;
        setMotorVelocity(motor, ticksPerSecond);
    }

    @Override public synchronized double getMotorVelocity(int motor) {
        validateMotor(motor);
        return internalGetMotorTicksPerSecond(motor - API_MOTOR_FIRST);
    }

    @Override public synchronized double getMotorVelocity(int motor, AngleUnit unit) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        int ticksPerSecond = internalGetMotorTicksPerSecond(motorZ);
        double revsPerSecond = ticksPerSecond / motors[motorZ].motorType.getTicksPerRev();
        return unit.getUnnormalized().fromDegrees(revsPerSecond * 360.0);
    }

    private int internalGetMotorTicksPerSecond(int motorZ) {
        if (hub.isBulkCaching()) {
            return hub.recordBulkCachingCommandIntent("getBulkInputData", "motorVelocity" + motorZ).motorVelocities[motorZ];
        }
        hub.bulkReadCommand(); // 캐시가 꺼져 있어도 속도는 LynxGetBulkInputDataCommand로 읽는다
        return channels[motorZ].encoderVelocity();
    }

    @Override public void setPIDCoefficients(int motor, DcMotor.RunMode mode, PIDCoefficients pidCoefficients) {
        setPIDFCoefficients(motor, mode, new PIDFCoefficients(pidCoefficients));
    }

    @Override public synchronized void setPIDFCoefficients(int motor, DcMotor.RunMode mode, PIDFCoefficients pidfCoefficients) {
        if (!mode.isPIDMode())
            throw new IllegalArgumentException(String.format("motor %d: mode %s is invalid as PID Mode", motor, mode));
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        mode = mode.migrate();
        rememberPIDParams(motorZ, new ExpansionHubMotorControllerParamsState(mode, pidfCoefficients));
        if (!internalSetPIDFCoefficients(motorZ, mode, pidfCoefficients)) {
            throw new UnsupportedOperationException(String.format("setting of pidf coefficents not supported: motor=%d mode=%s pidf=%s",
                    motor, mode, pidfCoefficients));
        }
    }

    private boolean internalSetPIDFCoefficients(int motorZ, DcMotor.RunMode mode, PIDFCoefficients pidfCoefficients) {
        MotorProperties m = motors[motorZ];
        if (!m.originalPIDParams.containsKey(mode)) {
            PIDFCoefficients originalCoefficients = getPIDFCoefficients(motorZ + API_MOTOR_FIRST, mode);
            m.originalPIDParams.put(mode, new ExpansionHubMotorControllerParamsState(mode, originalCoefficients));
        }
        if (mode == DcMotor.RunMode.RUN_TO_POSITION && pidfCoefficients.algorithm != MotorControlAlgorithm.LegacyPID) {
            // 위치 루프 안의 속도 루프가 이중 적분되지 않게 막는다(실제와 같음)
            if (pidfCoefficients.i != 0 || pidfCoefficients.d != 0 || pidfCoefficients.f != 0) return false;
        }
        hub.lynxCommand(); // LynxSetMotorPIDFControlLoopCoefficientsCommand
        channels[motorZ].storePidf(mode, pidfCoefficients);
        return true;
    }

    @Override public synchronized PIDCoefficients getPIDCoefficients(int motor, DcMotor.RunMode mode) {
        PIDFCoefficients pidf = getPIDFCoefficients(motor, mode);
        return new PIDCoefficients(pidf.p, pidf.i, pidf.d);
    }

    @Override public synchronized PIDFCoefficients getPIDFCoefficients(int motor, DcMotor.RunMode mode) {
        validateMotor(motor);
        hub.lynxCommand(); // LynxGetMotorPIDFControlLoopCoefficientsCommand
        return channels[motor - API_MOTOR_FIRST].readPidf(mode);
    }

    @Override public double getMotorCurrent(int motor, CurrentUnit unit) {
        validateMotor(motor);
        hub.lynxCommand(); // LynxGetADCCommand(motorCurrent)
        return unit.convert(channels[motor - API_MOTOR_FIRST].currentMilliamps(), CurrentUnit.MILLIAMPS);
    }

    @Override public double getMotorCurrentAlert(int motor, CurrentUnit unit) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        Double cached = motors[motorZ].lastKnownCurrentAlert.getValue();
        if (cached != null) return unit.convert(cached, CurrentUnit.MILLIAMPS);
        hub.lynxCommand(); // LynxGetMotorChannelCurrentAlertLevelCommand
        double limit = channels[motorZ].currentAlertMilliamps;
        motors[motorZ].lastKnownCurrentAlert.setValue(limit);
        return unit.convert(limit, CurrentUnit.MILLIAMPS);
    }

    @Override public void setMotorCurrentAlert(int motor, double current, CurrentUnit unit) {
        validateMotor(motor);
        hub.lynxCommand(); // LynxSetMotorChannelCurrentAlertLevelCommand
        channels[motor - API_MOTOR_FIRST].currentAlertMilliamps = Math.round(unit.toMilliAmps(current));
    }

    @Override public boolean isMotorOverCurrent(int motor) {
        validateMotor(motor);
        int motorZ = motor - API_MOTOR_FIRST;
        if (hub.isBulkCaching()) {
            return hub.recordBulkCachingCommandIntent("getBulkInputData", "motorOverCurrent" + motor).motorOverCurrent[motorZ];
        }
        hub.bulkReadCommand(); // LynxGetBulkInputDataCommand
        return channels[motorZ].isOverCurrent();
    }

    // ---------------------------------------------------------------------------------------------
    // 도움
    // ---------------------------------------------------------------------------------------------

    void floatHardware() {
        for (int motor = API_MOTOR_FIRST; motor <= API_MOTOR_LAST; motor++) setMotorPowerFloat(motor);
    }

    private void runWithoutEncoders() {
        for (int motor = API_MOTOR_FIRST; motor <= API_MOTOR_LAST; motor++) setMotorMode(motor, DcMotor.RunMode.RUN_WITHOUT_ENCODER);
    }

    private static void validateMotor(int motor) {
        if (motor < API_MOTOR_FIRST || motor > API_MOTOR_LAST)
            throw new IllegalArgumentException(String.format("motor %d is invalid; valid motors are %d..%d", motor, API_MOTOR_FIRST, API_MOTOR_LAST));
    }

    /** LynxSetMotorPIDControlLoopCoefficientsCommand.internalCoefficientFromExternal */
    static int internalCoefficientFromExternal(double coefficient) {
        return (int) (Math.abs(coefficient) * 65536.0 + 0.5) * (int) Math.signum(coefficient);
    }

    static double externalCoefficientFromInternal(int coefficient) {
        return ((double) coefficient) / 65536.0;
    }
}
