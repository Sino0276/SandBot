package org.sandbot.sdk.devices;

import com.qualcomm.hardware.rev.RevBlinkinLedDriver;
import com.qualcomm.robotcore.hardware.PwmControl;
import com.qualcomm.robotcore.hardware.RobotCoreLynxController;
import com.qualcomm.robotcore.hardware.ServoControllerEx;
import com.qualcomm.robotcore.hardware.configuration.typecontainers.ServoConfigurationType;
import com.qualcomm.robotcore.util.Range;

import org.sandbot.sim.Sim;
import org.sandbot.sim.SimDevice;

/**
 * 허브의 서보 컨트롤러(실제 com.qualcomm.hardware.lynx.LynxServoController를 옮긴 것). 서보·CR 서보·SPARK Mini·Blinkin이
 * 같은 서보 포트를 쓴다.
 *
 * <p>위치는 LastKnown으로 기억해 같은 위치를 다시 쓰면 명령을 보내지 않는다. 펄스 폭을 보낼 때마다 PWM을 켠다
 * (internalSetPwmEnable, 이미 켜져 있으면 보내지 않음). 펌웨어 쪽 PWM은 처음에 꺼져 있다.
 */
public final class SimServoController implements ServoControllerEx, RobotCoreLynxController {
    static final int API_SERVO_FIRST = 0;
    static final int API_SERVO_LAST = 5;
    static final double API_POSITION_FIRST = 0.0;
    static final double API_POSITION_LAST = 1.0;
    /** LynxSetServoPulseWidthCommand.apiPulseWidthFirst/Last */
    static final int PULSE_WIDTH_FIRST = 1;
    static final int PULSE_WIDTH_LAST = 65535;

    /** 서보 포트 장치 종류 */
    public static final String KIND_SERVO = "servo";
    public static final String KIND_CR_SERVO = "crServo";
    public static final String KIND_SPARK_MINI = "sparkMini";
    public static final String KIND_BLINKIN = "blinkin";

    final SimHub hub;

    private final SimLastKnown<Double>[] lastKnownCommandedPosition;
    private final SimLastKnown<Boolean>[] lastKnownEnabled;
    private final SimLastKnown<Integer>[] lastKnownPulseWidthMicroseconds;
    private final PwmControl.PwmRange[] pwmRanges = new PwmControl.PwmRange[6];
    private final PwmControl.PwmRange[] defaultPwmRanges = new PwmControl.PwmRange[6];

    /** 펌웨어 쪽 서보 채널 */
    static final class Channel {
        SimDevice device;
        String kind;
        boolean enabled = false;
        /** 마지막 펄스 폭(µs). 한 번도 보내지 않았으면 0. */
        int pulseWidth = 0;
        int frameUs = (int) PwmControl.PwmRange.usFrameDefault;
        /** SDK가 마지막으로 보낸 위치(펄스로 바꾸기 전, 0..1). 펄스 폭을 직접 쓰면 null. */
        Double commandedPosition = null;

        void publish() {
            if (device == null) return;
            Double position = enabled ? commandedPosition : null;
            switch (kind) {
                case KIND_CR_SERVO:
                case KIND_SPARK_MINI:
                    device.output("power", position == null ? null : (Object) (position * 2 - 1));
                    break;
                case KIND_BLINKIN: {
                    String pattern = null;
                    if (position != null) {
                        int ordinal = (int) Math.round((position - 505 * 0.0005) / (10 * 0.0005));
                        RevBlinkinLedDriver.BlinkinPattern[] patterns = RevBlinkinLedDriver.BlinkinPattern.values();
                        if (ordinal >= 0 && ordinal < patterns.length) pattern = patterns[ordinal].name();
                    }
                    device.output("pattern", pattern);
                    break;
                }
                default:
                    device.output("position", position);
            }
            device.output("pwm", enabled);
            device.output("pulseUs", enabled && pulseWidth != 0 ? (Object) pulseWidth : null);
        }
    }

    private final Channel[] channels = new Channel[6];

    @SuppressWarnings("unchecked")
    SimServoController(SimHub hub) {
        this.hub = hub;
        hub.servos = this;
        lastKnownCommandedPosition = new SimLastKnown[6];
        lastKnownEnabled = new SimLastKnown[6];
        lastKnownPulseWidthMicroseconds = new SimLastKnown[6];
        for (int i = 0; i < 6; i++) {
            lastKnownCommandedPosition[i] = new SimLastKnown<>();
            lastKnownEnabled[i] = new SimLastKnown<>();
            lastKnownPulseWidthMicroseconds[i] = new SimLastKnown<>();
            pwmRanges[i] = PwmControl.PwmRange.defaultRange;
            defaultPwmRanges[i] = PwmControl.PwmRange.defaultRange;
            channels[i] = new Channel();
        }
    }

    /**
     * 구성의 장치를 포트에 연결하고 형식의 기본 펄스 범위를 정한다(실제 setServoType과 같은 일: ServoConfigurationType의
     * usPulseLower·usPulseUpper·usFrame). 이 시뮬레이터에서는 ServoConfigurationType을 만들 수 없어서 범위를 직접 받는다.
     */
    SimDevice attach(int port, String name, String kind, PwmControl.PwmRange defaultRange) {
        Channel c = channels[port];
        c.kind = kind;
        c.device = Sim.devices().add(name, kind);
        defaultPwmRanges[port] = defaultRange;
        setServoPwmRange(port, defaultRange);
        c.publish();
        return c.device;
    }

    /** 구성 읽기 때와 OpMode마다(LynxServoController.initializeHardware): 기본 펄스 범위로 되돌리고 PWM을 끈다 */
    void initializeHardware() {
        for (int servo = API_SERVO_FIRST; servo <= API_SERVO_LAST; servo++) {
            pwmRanges[servo - API_SERVO_FIRST] = null; // setServoPwmRange가 항상 보내게
            setServoPwmRange(servo, defaultPwmRanges[servo - API_SERVO_FIRST]);
        }
        floatHardware();
        forgetLastKnown();
    }

    void floatHardware() {
        pwmDisable();
    }

    void forgetLastKnown() {
        for (int i = 0; i < 6; i++) {
            lastKnownCommandedPosition[i].invalidate();
            lastKnownEnabled[i].invalidate();
            lastKnownPulseWidthMicroseconds[i].invalidate();
        }
    }

    /** LynxFailSafeCommand: 모든 서보 PWM을 끈다 */
    void hubFailSafe() {
        for (Channel c : channels) {
            c.enabled = false;
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
        return "Expansion Hub Servo Controller";
    }

    @Override public String getConnectionInfo() {
        return hub.module.getConnectionInfo();
    }

    @Override public int getVersion() {
        return 1;
    }

    @Override public void resetDeviceConfigurationForOpMode() {
        initializeHardware();
    }

    @Override public synchronized void close() {
        floatHardware();
    }

    // ---------------------------------------------------------------------------------------------
    // ServoController
    // ---------------------------------------------------------------------------------------------

    public synchronized void forgetLastKnownPosition(int servo) {
        validateServo(servo);
        lastKnownCommandedPosition[servo - API_SERVO_FIRST].invalidate();
    }

    @Override public synchronized void pwmEnable() {
        for (int servoZ = 0; servoZ < 6; servoZ++) internalSetPwmEnable(servoZ, true);
    }

    @Override public synchronized void pwmDisable() {
        for (int servoZ = 0; servoZ < 6; servoZ++) internalSetPwmEnable(servoZ, false);
    }

    @Override public synchronized PwmStatus getPwmStatus() {
        Boolean enabled = null;
        for (int servoZ = 0; servoZ < 6; servoZ++) {
            boolean local = internalGetPwmEnable(servoZ);
            if (enabled == null) enabled = local;
            else if (enabled != local) return PwmStatus.MIXED;
        }
        return enabled ? PwmStatus.ENABLED : PwmStatus.DISABLED;
    }

    @Override public synchronized void setServoPwmEnable(int servo) {
        validateServo(servo);
        internalSetPwmEnable(servo - API_SERVO_FIRST, true);
    }

    @Override public synchronized void setServoPwmDisable(int servo) {
        validateServo(servo);
        internalSetPwmEnable(servo - API_SERVO_FIRST, false);
    }

    @Override public synchronized boolean isServoPwmEnabled(int servo) {
        validateServo(servo);
        return internalGetPwmEnable(servo - API_SERVO_FIRST);
    }

    /**
     * 실제는 servoType의 펄스 범위를 기본값으로 삼는다. 이 시뮬레이터의 ServoConfigurationType은 껍데기라 만들 수 없으므로
     * (구성 형식의 범위는 {@link #attach}가 정함) null이면 아무것도 하지 않는다.
     */
    @Override public void setServoType(int servo, ServoConfigurationType servoType) {
        validateServo(servo);
        if (servoType == null) return;
        PwmControl.PwmRange range = new PwmControl.PwmRange(servoType.getUsPulseLower(), servoType.getUsPulseUpper(), servoType.getUsFrame());
        defaultPwmRanges[servo - API_SERVO_FIRST] = range;
        setServoPwmRange(servo, range);
    }

    private void internalSetPwmEnable(int servoZ, boolean enable) {
        if (lastKnownEnabled[servoZ].updateValue(enable)) {
            if (!enable) {
                lastKnownCommandedPosition[servoZ].invalidate();
                lastKnownPulseWidthMicroseconds[servoZ].invalidate();
            }
            if (hub.cancelledForSafety(enable)) return; // STOP 뒤에는 PWM을 다시 켜지 않는다(LastKnown은 실제처럼 이미 바뀜)
            hub.lynxCommand(); // LynxSetServoEnableCommand
            channels[servoZ].enabled = enable;
            channels[servoZ].publish();
        }
    }

    private boolean internalGetPwmEnable(int servoZ) {
        Boolean result = lastKnownEnabled[servoZ].getValue();
        if (result != null) return result;
        hub.lynxCommand(); // LynxGetServoEnableCommand
        result = channels[servoZ].enabled;
        lastKnownEnabled[servoZ].setValue(result);
        return result;
    }

    @Override public synchronized void setServoPosition(int servo, double position) {
        validateServo(servo);
        int servoZ = servo - API_SERVO_FIRST;
        validateApiServoPosition(position);
        if (lastKnownCommandedPosition[servoZ].updateValue(position)) {
            double pwm = Range.scale(position, API_POSITION_FIRST, API_POSITION_LAST, pwmRanges[servoZ].usPulseLower, pwmRanges[servoZ].usPulseUpper);
            pwm = Range.clip(pwm, PULSE_WIDTH_FIRST, PULSE_WIDTH_LAST);
            channels[servoZ].commandedPosition = position;
            internalSetPulseWidth(servoZ, (int) pwm);
        }
    }

    @Override public synchronized double getServoPosition(int servo) {
        validateServo(servo);
        int servoZ = servo - API_SERVO_FIRST;
        Double result = lastKnownCommandedPosition[servoZ].getValue();
        if (result != null) return result;
        int pwm = internalGetPulseWidth(servoZ);
        if (pwm != 0) {
            result = Range.scale(pwm, pwmRanges[servoZ].usPulseLower, pwmRanges[servoZ].usPulseUpper, API_POSITION_FIRST, API_POSITION_LAST);
            result = Range.clip(result, API_POSITION_FIRST, API_POSITION_LAST);
            lastKnownCommandedPosition[servoZ].setValue(result);
            return result;
        }
        return 0;
    }

    // ---------------------------------------------------------------------------------------------
    // ServoControllerEx
    // ---------------------------------------------------------------------------------------------

    @Override public synchronized void setServoPwmRange(int servo, PwmControl.PwmRange range) {
        validateServo(servo);
        int servoZ = servo - API_SERVO_FIRST;
        if (!range.equals(pwmRanges[servoZ])) {
            pwmRanges[servoZ] = range;
            hub.lynxCommand(); // LynxSetServoConfigurationCommand(frame)
            channels[servoZ].frameUs = (int) range.usFrame;
        }
    }

    @Override public synchronized PwmControl.PwmRange getServoPwmRange(int servo) {
        validateServo(servo);
        return pwmRanges[servo - API_SERVO_FIRST];
    }

    @Override public synchronized void setPulseWidth(int servo, double usWidth) {
        validateServo(servo);
        int servoZ = servo - API_SERVO_FIRST;
        lastKnownCommandedPosition[servoZ].invalidate();
        PwmControl.PwmRange range = pwmRanges[servoZ];
        channels[servoZ].commandedPosition = Range.clip(
                Range.scale((int) usWidth, range.usPulseLower, range.usPulseUpper, API_POSITION_FIRST, API_POSITION_LAST),
                API_POSITION_FIRST, API_POSITION_LAST);
        internalSetPulseWidth(servoZ, (int) usWidth);
    }

    @Override public synchronized double getPulseWidth(int servo) {
        validateServo(servo);
        return internalGetPulseWidth(servo - API_SERVO_FIRST);
    }

    private void internalSetPulseWidth(int servoZ, int usWidth) {
        lastKnownPulseWidthMicroseconds[servoZ].updateValue(usWidth);
        // STOP 뒤의 펄스 폭은 보내지 않는다. 실제처럼 그 뒤 PWM 켜기는 부른다(그것도 위험한 명령이라 보내지 않음)
        if (!hub.cancelledForSafety(true)) {
            hub.lynxCommand(); // LynxSetServoPulseWidthCommand
            channels[servoZ].pulseWidth = usWidth;
            channels[servoZ].publish();
        }
        internalSetPwmEnable(servoZ, true);
    }

    private int internalGetPulseWidth(int servoZ) {
        Integer result = lastKnownPulseWidthMicroseconds[servoZ].getValue();
        if (result != null) return result;
        hub.lynxCommand(); // LynxGetServoPulseWidthCommand
        int pulseWidthUs = channels[servoZ].pulseWidth;
        lastKnownPulseWidthMicroseconds[servoZ].setValue(pulseWidthUs);
        return pulseWidthUs;
    }

    private static void validateServo(int servo) {
        if (servo < API_SERVO_FIRST || servo > API_SERVO_LAST)
            throw new IllegalArgumentException(String.format("Servo %d is invalid; valid servos are %d..%d", servo, API_SERVO_FIRST, API_SERVO_LAST));
    }

    private static void validateApiServoPosition(double position) {
        if (!(API_POSITION_FIRST <= position && position <= API_POSITION_LAST))
            throw new IllegalArgumentException(String.format("illegal servo position %f; must be in interval [%f,%f]", position, API_POSITION_FIRST, API_POSITION_LAST));
    }
}
