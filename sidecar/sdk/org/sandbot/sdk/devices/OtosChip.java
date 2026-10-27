package org.sandbot.sdk.devices;

import org.sandbot.sim.SimDevice;

/**
 * SparkFun OTOS(광학 추적 오도메트리 센서)의 I2C 레지스터 흉내. 레지스터 번호·스케일은 실제 드라이버(SparkFunOTOS)와 같다:
 * 위치는 int16(±10 m), 각도 int16(±π), 속도 int16(±5 m/s, ±2000 °/s), 가속도 int16(±16 g, ±1000π rad/s²), 리틀 엔디언.
 * 여러 바이트 읽기는 다음 레지스터로 이어진다.
 *
 * <p>입력(장치가 켜진 뒤 재설정하지 않았을 때 보고할 로봇 중심 자세, 오프셋 적용 뒤): x·y(m), h(rad), vx·vy(m/s), vh(rad/s),
 * ax·ay(m/s²), ah(rad/s²). 선형·각도 스칼라는 재설정 뒤의 이동에 곱한다. IMU 보정은 표본 하나에 2.4 ms(실제 데이터시트)가 걸린다.
 */
final class OtosChip implements SimI2cChip {
    static final String KIND = "otos";
    private static final double MS_PER_CALIBRATION_SAMPLE = 2.4;

    private static final int REG_PRODUCT_ID = 0x00, REG_HW_VERSION = 0x01, REG_FW_VERSION = 0x02;
    private static final int REG_SCALAR_LINEAR = 0x04, REG_SCALAR_ANGULAR = 0x05, REG_IMU_CALIB = 0x06, REG_RESET = 0x07;
    private static final int REG_SIGNAL_PROCESS = 0x0E, REG_SELF_TEST = 0x0F, REG_OFF_XL = 0x10, REG_STATUS = 0x1F;
    private static final int REG_POS_XL = 0x20, REG_VEL_XL = 0x26, REG_ACC_XL = 0x2C, REG_POS_STD_XL = 0x32;
    private static final int REG_LAST = 0x43;

    private static final double METER_TO_INT16 = 32768.0 / 10.0;
    private static final double MPS_TO_INT16 = 32768.0 / 5.0;
    private static final double MPSS_TO_INT16 = 32768.0 / (16.0 * 9.80665);
    private static final double RAD_TO_INT16 = 32768.0 / Math.PI;
    private static final double RPS_TO_INT16 = 32768.0 / (2000.0 * Math.PI / 180.0);
    private static final double RPSS_TO_INT16 = 32768.0 / (Math.PI * 1000.0);

    private final SimDevice device;
    private final SimTrackedPose pose = new SimTrackedPose();
    private byte linearScalar = 0;
    private byte angularScalar = 0;
    private byte signalProcess = 0x0F;
    private byte selfTest = 0;
    private final short[] offset = new short[3];
    private long calibrationStartNanos = 0;
    private int calibrationSamples = 0;

    OtosChip(SimDevice device) {
        this.device = device;
        publish();
    }

    private double in(String key) {
        return device.inputDouble(key, 0);
    }

    private static short int16(double value) {
        return (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, value));
    }

    /** 레지스터 한 바이트(읽는 순간의 값) */
    private byte registerByte(int reg, short[] pos, short[] vel, short[] acc) {
        if (reg >= REG_OFF_XL && reg < REG_OFF_XL + 6) return word(offset, reg - REG_OFF_XL);
        if (reg >= REG_POS_XL && reg < REG_POS_XL + 6) return word(pos, reg - REG_POS_XL);
        if (reg >= REG_VEL_XL && reg < REG_VEL_XL + 6) return word(vel, reg - REG_VEL_XL);
        if (reg >= REG_ACC_XL && reg < REG_ACC_XL + 6) return word(acc, reg - REG_ACC_XL);
        if (reg >= REG_POS_STD_XL && reg <= REG_LAST) return 0;
        switch (reg) {
            case REG_PRODUCT_ID: return 0x5F;
            case REG_HW_VERSION: return 0x10;
            case REG_FW_VERSION: return 0x11;
            case REG_SCALAR_LINEAR: return linearScalar;
            case REG_SCALAR_ANGULAR: return angularScalar;
            case REG_IMU_CALIB: return (byte) remainingCalibrationSamples();
            case REG_SIGNAL_PROCESS: return signalProcess;
            case REG_SELF_TEST: return selfTest;
            case REG_STATUS: return 0;
            default: return 0;
        }
    }

    private static byte word(short[] values, int byteIndex) {
        short v = values[byteIndex / 2];
        return (byte) ((byteIndex % 2 == 0 ? v : v >> 8) & 0xFF);
    }

    private int remainingCalibrationSamples() {
        if (calibrationSamples == 0) return 0;
        double elapsedMs = (SimLastKnown.now() - calibrationStartNanos) / 1e6;
        int done = (int) (elapsedMs / MS_PER_CALIBRATION_SAMPLE);
        return Math.max(0, calibrationSamples - done);
    }

    @Override public byte[] read(int reg, int count) {
        double[] p = pose.reported(in("x"), in("y"), in("h"));
        double[] v = pose.rotate(in("vx"), in("vy"));
        double[] a = pose.rotate(in("ax"), in("ay"));
        short[] pos = {int16(p[0] * METER_TO_INT16), int16(p[1] * METER_TO_INT16), int16(Math.IEEEremainder(p[2], 2 * Math.PI) * RAD_TO_INT16)};
        short[] vel = {int16(v[0] * MPS_TO_INT16), int16(v[1] * MPS_TO_INT16), int16(in("vh") * pose.angularScale * RPS_TO_INT16)};
        short[] acc = {int16(a[0] * MPSS_TO_INT16), int16(a[1] * MPSS_TO_INT16), int16(in("ah") * pose.angularScale * RPSS_TO_INT16)};
        int start = reg == NO_REGISTER ? 0 : reg;
        byte[] out = new byte[count];
        for (int i = 0; i < count; i++) out[i] = registerByte(start + i, pos, vel, acc);
        return out;
    }

    @Override public void write(int reg, byte[] data) {
        if (reg == NO_REGISTER || data.length == 0) return;
        double rawX = in("x"), rawY = in("y"), rawH = in("h");
        double[] p = pose.reported(rawX, rawY, rawH);
        switch (reg) {
            case REG_SCALAR_LINEAR:
                pose.set(rawX, rawY, rawH, p[0], p[1], p[2]);
                linearScalar = data[0];
                pose.linearScale = linearScalar * 0.001 + 1.0;
                break;
            case REG_SCALAR_ANGULAR:
                pose.set(rawX, rawY, rawH, p[0], p[1], p[2]);
                angularScalar = data[0];
                pose.angularScale = angularScalar * 0.001 + 1.0;
                break;
            case REG_IMU_CALIB:
                calibrationSamples = data[0] & 0xFF;
                calibrationStartNanos = SimLastKnown.now();
                break;
            case REG_RESET:
                if ((data[0] & 0x01) != 0) pose.set(rawX, rawY, rawH, 0, 0, 0);
                break;
            case REG_SIGNAL_PROCESS:
                signalProcess = data[0];
                break;
            case REG_SELF_TEST:
                // 시작(0x01)하면 곧바로 통과(0x04)로 보인다
                selfTest = (data[0] & 0x01) != 0 ? (byte) 0x04 : data[0];
                break;
            case REG_OFF_XL:
                for (int i = 0; i < 3 && 2 * i + 1 < data.length; i++)
                    offset[i] = (short) ((data[2 * i] & 0xFF) | (data[2 * i + 1] << 8));
                break;
            case REG_POS_XL:
                if (data.length >= 6) {
                    short x = (short) ((data[0] & 0xFF) | (data[1] << 8));
                    short y = (short) ((data[2] & 0xFF) | (data[3] << 8));
                    short h = (short) ((data[4] & 0xFF) | (data[5] << 8));
                    pose.set(rawX, rawY, rawH, x / METER_TO_INT16, y / METER_TO_INT16, h / RAD_TO_INT16);
                }
                break;
            default:
                break;
        }
        publish();
    }

    private void publish() {
        device.output("offsetX", offset[0] / METER_TO_INT16);
        device.output("offsetY", offset[1] / METER_TO_INT16);
        device.output("offsetH", offset[2] / RAD_TO_INT16);
        device.output("linearScalar", linearScalar * 0.001 + 1.0);
        device.output("angularScalar", angularScalar * 0.001 + 1.0);
    }
}
