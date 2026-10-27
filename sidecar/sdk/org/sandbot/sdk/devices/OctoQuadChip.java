package org.sandbot.sdk.devices;

import org.sandbot.sim.SimDevice;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Digital Chicken Labs OctoQuad(엔코더 8개 + 로컬라이저)의 I2C 레지스터 흉내. 레지스터 지도·명령·매개변수 번호는
 * 실제 드라이버(OctoQuadImpl)와 같고, 데이터 묶음의 CRC16은 드라이버와 같은 CRC-16/PROFIBUS다. 펌웨어는 3.1.0으로 보인다.
 *
 * <p>입력: position0…position7(틱, 방향 적용 전), velocity0…velocity7(틱/표본 간격), 로컬라이저 x·y(mm)·h(rad)·vx·vy(mm/s)·vh(rad/s)
 * (켜진 뒤 재설정하지 않았을 때 보고할 값). 로컬라이저는 처음에 NOT_INITIALIZED이고, resetLocalizerAndCalibrateIMU 뒤
 * {@value #IMU_CALIBRATION_MS} ms 동안 CALIBRATING_IMU, 그 뒤 RUNNING(요 축 Z)이다(근사).
 */
final class OctoQuadChip implements SimI2cChip {
    static final String KIND = "octoQuad";
    static final int IMU_CALIBRATION_MS = 1000;

    private static final int CHIP_ID = 0x00, FW_MAJ = 0x01, COMMAND = 0x04, COMMAND_DAT_0 = 0x05;
    private static final int LOCALIZER_YAW_AXIS = 0x0C, LOCALIZER_STATUS = 0x0D, LOCALIZER_X = 0x14, LOCALIZER_H = 0x18;
    private static final int ENCODER_0_POSITION = 0x1C, ENCODER_0_VELOCITY = 0x3C, ENCODER_DATA_CRC16 = 0x4C, LAST = 0x4D;

    private static final int CMD_SET_PARAM = 1, CMD_READ_PARAM = 2, CMD_WRITE_PARAMS_TO_FLASH = 3;
    private static final int CMD_RESET_EVERYTHING = 20, CMD_RESET_ENCODERS = 21, CMD_RESET_LOCALIZER = 40;
    private static final int PARAM_ENCODER_DIRECTIONS = 0, PARAM_I2C_RECOVERY_MODE = 1, PARAM_CHANNEL_BANK_CONFIG = 2;
    private static final int PARAM_CHANNEL_VEL_INTVL = 3, PARAM_CHANNEL_PULSE_WIDTH_MIN_MAX = 4, PARAM_CHANNEL_PULSE_WIDTH_TRACKS_WRAP = 5;
    private static final int PARAM_UPTIME_MS = 200, PARAM_IMU_DIAG = 201;

    private static final float SCALAR_LOCALIZER_HEADING_VELOCITY = 1 / 600f;
    private static final float SCALAR_LOCALIZER_HEADING = 1 / 5000f;

    // LocalizerStatus·LocalizerYawAxis 코드
    private static final int STATUS_NOT_INITIALIZED = 1, STATUS_CALIBRATING_IMU = 3, STATUS_RUNNING = 4;
    private static final int YAW_UNDECIDED = 0, YAW_Z = 5;

    private final SimDevice device;
    private final SimTrackedPose pose = new SimTrackedPose();
    private final byte[] commandData = new byte[7];
    private byte directions = 0;
    private byte i2cRecoveryMode = 0;
    private byte channelBankConfig = 0;
    private byte tracksWrap = 0;
    private final int[] velocityIntervalMs = {50, 50, 50, 50, 50, 50, 50, 50};
    private final int[] pulseMin = new int[8];
    private final int[] pulseMax = {1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024};
    private final long[] encoderOffset = new long[8];
    private boolean localizerStarted = false;
    private long localizerResetNanos = 0;

    OctoQuadChip(SimDevice device) {
        this.device = device;
        publish();
    }

    private double in(String key) {
        return device.inputDouble(key, 0);
    }

    private int position(int i) {
        long raw = device.inputLong("position" + i, 0) - encoderOffset[i];
        return (int) (((directions >> i) & 1) != 0 ? -raw : raw);
    }

    private short velocity(int i) {
        long raw = device.inputLong("velocity" + i, 0);
        return (short) (((directions >> i) & 1) != 0 ? -raw : raw);
    }

    private int localizerStatus() {
        if (!localizerStarted) return STATUS_NOT_INITIALIZED;
        return SimLastKnown.now() - localizerResetNanos < IMU_CALIBRATION_MS * 1_000_000L ? STATUS_CALIBRATING_IMU : STATUS_RUNNING;
    }

    /** 지금 레지스터 파일 전체(0x00–0x4D) */
    private byte[] registers() {
        ByteBuffer b = ByteBuffer.allocate(LAST + 1).order(ByteOrder.LITTLE_ENDIAN);
        b.put(CHIP_ID, (byte) 0x51);
        b.put(FW_MAJ, (byte) 3).put(FW_MAJ + 1, (byte) 1).put(FW_MAJ + 2, (byte) 0);
        for (int i = 0; i < commandData.length; i++) b.put(COMMAND_DAT_0 + i, commandData[i]);
        int status = localizerStatus();
        b.put(LOCALIZER_YAW_AXIS, (byte) (status == STATUS_RUNNING ? YAW_Z : YAW_UNDECIDED));
        b.put(LOCALIZER_STATUS, (byte) status);
        double[] p = pose.reported(in("x"), in("y"), in("h"));
        double[] v = pose.rotate(in("vx"), in("vy"));
        b.putShort(0x0E, (short) Math.round(v[0]));
        b.putShort(0x10, (short) Math.round(v[1]));
        b.putShort(0x12, (short) (in("vh") / SCALAR_LOCALIZER_HEADING_VELOCITY));
        b.putShort(0x14, (short) Math.round(p[0]));
        b.putShort(0x16, (short) Math.round(p[1]));
        b.putShort(0x18, (short) (Math.IEEEremainder(p[2], 2 * Math.PI) / SCALAR_LOCALIZER_HEADING));
        byte[] all = b.array();
        b.putShort(0x1A, crc16Profibus(all, LOCALIZER_STATUS, 13));
        for (int i = 0; i < 8; i++) {
            b.putInt(ENCODER_0_POSITION + 4 * i, position(i));
            b.putShort(ENCODER_0_VELOCITY + 2 * i, velocity(i));
        }
        b.putShort(ENCODER_DATA_CRC16, crc16Profibus(all, ENCODER_0_POSITION, ENCODER_DATA_CRC16 - ENCODER_0_POSITION));
        return all;
    }

    @Override public byte[] read(int reg, int count) {
        byte[] all = registers();
        int start = reg == NO_REGISTER ? 0 : reg;
        byte[] out = new byte[count];
        for (int i = 0; i < count && start + i < all.length; i++) out[i] = all[start + i];
        return out;
    }

    @Override public void write(int reg, byte[] data) {
        if (reg == COMMAND && data.length > 0) {
            command(data);
        } else if (reg == LOCALIZER_X && data.length >= 6) {
            ByteBuffer b = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
            pose.set(in("x"), in("y"), in("h"), b.getShort(0), b.getShort(2), b.getShort(4) * SCALAR_LOCALIZER_HEADING);
        } else if (reg == LOCALIZER_H && data.length >= 2) {
            double[] p = pose.reported(in("x"), in("y"), in("h"));
            short h = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).getShort(0);
            pose.set(in("x"), in("y"), in("h"), p[0], p[1], h * SCALAR_LOCALIZER_HEADING);
        }
        publish();
    }

    private void command(byte[] data) {
        ByteBuffer b = ByteBuffer.wrap(java.util.Arrays.copyOf(data, 8)).order(ByteOrder.LITTLE_ENDIAN);
        int cmd = data[0] & 0xFF;
        switch (cmd) {
            case CMD_SET_PARAM: {
                int param = b.get(1) & 0xFF;
                switch (param) {
                    case PARAM_ENCODER_DIRECTIONS: directions = b.get(2); break;
                    case PARAM_I2C_RECOVERY_MODE: i2cRecoveryMode = b.get(2); break;
                    case PARAM_CHANNEL_BANK_CONFIG: channelBankConfig = b.get(2); break;
                    case PARAM_CHANNEL_VEL_INTVL: velocityIntervalMs[b.get(2) & 7] = b.get(3) & 0xFF; break;
                    case PARAM_CHANNEL_PULSE_WIDTH_MIN_MAX:
                        pulseMin[b.get(2) & 7] = b.getShort(3) & 0xFFFF;
                        pulseMax[b.get(2) & 7] = b.getShort(5) & 0xFFFF;
                        break;
                    case PARAM_CHANNEL_PULSE_WIDTH_TRACKS_WRAP: tracksWrap = b.get(2); break;
                    default: break; // 로컬라이저 매개변수(50–57)는 1단계에서 보고 값에 영향을 주지 않는다
                }
                break;
            }
            case CMD_READ_PARAM: {
                int param = b.get(1) & 0xFF;
                ByteBuffer result = ByteBuffer.allocate(7).order(ByteOrder.LITTLE_ENDIAN);
                switch (param) {
                    case PARAM_ENCODER_DIRECTIONS: result.put(0, directions); break;
                    case PARAM_I2C_RECOVERY_MODE: result.put(0, i2cRecoveryMode); break;
                    case PARAM_CHANNEL_BANK_CONFIG: result.put(0, channelBankConfig); break;
                    case PARAM_CHANNEL_VEL_INTVL: result.put(0, (byte) velocityIntervalMs[b.get(2) & 7]); break;
                    case PARAM_CHANNEL_PULSE_WIDTH_MIN_MAX:
                        result.putShort(0, (short) pulseMin[b.get(2) & 7]);
                        result.putShort(2, (short) pulseMax[b.get(2) & 7]);
                        break;
                    case PARAM_CHANNEL_PULSE_WIDTH_TRACKS_WRAP: result.put(0, tracksWrap); break;
                    case PARAM_UPTIME_MS: result.putInt(0, (int) (SimLastKnown.now() / 1_000_000L)); break;
                    case PARAM_IMU_DIAG: result.putInt(0, 0); break;
                    default: break;
                }
                System.arraycopy(result.array(), 0, commandData, 0, 7);
                break;
            }
            case CMD_RESET_ENCODERS: {
                int mask = b.get(1) & 0xFF;
                for (int i = 0; i < 8; i++) if (((mask >> i) & 1) != 0) encoderOffset[i] = device.inputLong("position" + i, 0);
                break;
            }
            case CMD_RESET_EVERYTHING:
                for (int i = 0; i < 8; i++) encoderOffset[i] = device.inputLong("position" + i, 0);
                directions = 0;
                break;
            case CMD_RESET_LOCALIZER:
                localizerStarted = true;
                localizerResetNanos = SimLastKnown.now();
                pose.set(in("x"), in("y"), in("h"), 0, 0, 0);
                break;
            case CMD_WRITE_PARAMS_TO_FLASH:
            default:
                break;
        }
    }

    private void publish() {
        device.output("directions", directions & 0xFF);
        device.output("channelBankConfig", channelBankConfig & 0xFF);
    }

    /** CRC-16/PROFIBUS(다항식 0x1DCF, 초기값 0xFFFF, 결과 XOR 0xFFFF, 반사 없음): OctoQuadImpl.calc_crc16_profibus와 같다 */
    static short crc16Profibus(byte[] data, int offset, int length) {
        int crc = 0xFFFF;
        for (int i = 0; i < length; i++) {
            crc ^= (data[offset + i] & 0xFF) << 8;
            for (int bit = 0; bit < 8; bit++) {
                crc = (crc & 0x8000) != 0 ? ((crc << 1) ^ 0x1DCF) : (crc << 1);
                crc &= 0xFFFF;
            }
        }
        return (short) (crc ^ 0xFFFF);
    }
}
