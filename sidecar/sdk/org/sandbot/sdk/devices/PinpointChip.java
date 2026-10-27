package org.sandbot.sdk.devices;

import org.sandbot.sim.SimDevice;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * goBILDA Pinpoint 오도메트리 컴퓨터의 I2C 레지스터 흉내(펌웨어 버전 3: 고를 수 있는 bulk read, CRC, 쿼터니언·pitch·roll).
 * 레지스터 번호·형식은 실제 드라이버(GoBildaPinpointDriver.Register)와 같다. 4바이트 값은 리틀 엔디언이고,
 * 4의 배수보다 1바이트 더 읽으면 마지막 바이트는 드라이버와 같은 CRC8(초기값 0x90, 다항식 0x31)이다.
 *
 * <p>입력(장치가 켜진 뒤 재설정하지 않았을 때 보고할 값): x·y(mm), heading(rad), vx·vy(mm/s), headingVelocity(rad/s),
 * encoderX·encoderY(틱, 방향 적용 전), pitch·roll(rad), loopTime(µs, 기본 {@value #DEFAULT_LOOP_TIME_US}).
 * resetPosAndIMU·recalibrateIMU 뒤 {@value #CALIBRATION_MS} ms 동안 상태는 CALIBRATING이다.
 */
final class PinpointChip implements SimI2cChip {
    static final String KIND = "pinpoint";
    static final int DEFAULT_LOOP_TIME_US = 667;
    static final int CALIBRATION_MS = 250;

    // GoBildaPinpointDriver.Register
    private static final int DEVICE_ID = 1, DEVICE_VERSION = 2, DEVICE_STATUS = 3, DEVICE_CONTROL = 4, LOOP_TIME = 5;
    private static final int X_ENCODER_VALUE = 6, Y_ENCODER_VALUE = 7, X_POSITION = 8, Y_POSITION = 9, H_ORIENTATION = 10;
    private static final int X_VELOCITY = 11, Y_VELOCITY = 12, H_VELOCITY = 13, MM_PER_TICK = 14, X_POD_OFFSET = 15;
    private static final int Y_POD_OFFSET = 16, YAW_SCALAR = 17, BULK_READ = 18, QUATERNION_W = 19, QUATERNION_X = 20;
    private static final int QUATERNION_Y = 21, QUATERNION_Z = 22, PITCH = 23, ROLL = 24, SET_BULK_READ = 25;

    // GoBildaPinpointDriver.DeviceControl
    private static final int RECALIBRATE_IMU = 1, RESET_POS_AND_IMU = 1 << 1, SET_Y_ENCODER_REVERSED = 1 << 2;
    private static final int SET_Y_ENCODER_FORWARD = 1 << 3, SET_X_ENCODER_REVERSED = 1 << 4, SET_X_ENCODER_FORWARD = 1 << 5;
    // GoBildaPinpointDriver.DeviceStatus
    private static final int READY = 1, CALIBRATING = 1 << 1;

    private final SimDevice device;
    private final SimTrackedPose pose = new SimTrackedPose();
    private float mmPerTick = 0;
    private float xPodOffset = 0;
    private float yPodOffset = 0;
    private float yawScalar = 1;
    private boolean xReversed = false;
    private boolean yReversed = false;
    private long calibratingUntilNanos = Long.MIN_VALUE;
    private int[] bulkScope = {DEVICE_STATUS, LOOP_TIME, X_ENCODER_VALUE, Y_ENCODER_VALUE, X_POSITION, Y_POSITION,
            H_ORIENTATION, X_VELOCITY, Y_VELOCITY, H_VELOCITY};

    PinpointChip(SimDevice device) {
        this.device = device;
        publish();
    }

    private double in(String key) {
        return device.inputDouble(key, 0);
    }

    private double[] reportedPose() {
        return pose.reported(in("x"), in("y"), in("heading"));
    }

    /** 레지스터 하나의 4바이트 값 */
    private byte[] register(int reg) {
        ByteBuffer b = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN);
        double[] p;
        switch (reg) {
            case DEVICE_ID: return b.putInt(0, 2).array();
            case DEVICE_VERSION: return b.putInt(0, 3).array();
            case DEVICE_STATUS: return b.putInt(0, SimLastKnown.now() < calibratingUntilNanos ? CALIBRATING : READY).array();
            case LOOP_TIME: return b.putInt(0, (int) device.inputLong("loopTime", DEFAULT_LOOP_TIME_US)).array();
            case X_ENCODER_VALUE: return b.putInt(0, (int) device.inputLong("encoderX", 0) * (xReversed ? -1 : 1)).array();
            case Y_ENCODER_VALUE: return b.putInt(0, (int) device.inputLong("encoderY", 0) * (yReversed ? -1 : 1)).array();
            case X_POSITION: p = reportedPose(); return b.putFloat(0, (float) p[0]).array();
            case Y_POSITION: p = reportedPose(); return b.putFloat(0, (float) p[1]).array();
            case H_ORIENTATION: p = reportedPose(); return b.putFloat(0, (float) p[2]).array();
            case X_VELOCITY: return b.putFloat(0, (float) pose.rotate(in("vx"), in("vy"))[0]).array();
            case Y_VELOCITY: return b.putFloat(0, (float) pose.rotate(in("vx"), in("vy"))[1]).array();
            case H_VELOCITY: return b.putFloat(0, (float) (in("headingVelocity") * pose.angularScale)).array();
            case MM_PER_TICK: return b.putFloat(0, mmPerTick).array();
            case X_POD_OFFSET: return b.putFloat(0, xPodOffset).array();
            case Y_POD_OFFSET: return b.putFloat(0, yPodOffset).array();
            case YAW_SCALAR: return b.putFloat(0, yawScalar).array();
            case QUATERNION_W: return b.putFloat(0, (float) quaternion()[0]).array();
            case QUATERNION_X: return b.putFloat(0, (float) quaternion()[1]).array();
            case QUATERNION_Y: return b.putFloat(0, (float) quaternion()[2]).array();
            case QUATERNION_Z: return b.putFloat(0, (float) quaternion()[3]).array();
            case PITCH: return b.putFloat(0, (float) in("pitch")).array();
            case ROLL: return b.putFloat(0, (float) in("roll")).array();
            default: return new byte[4];
        }
    }

    /** heading(Z)·pitch·roll로 만든 쿼터니언 [w, x, y, z] */
    private double[] quaternion() {
        double yaw = reportedPose()[2] / 2, pitch = in("pitch") / 2, roll = in("roll") / 2;
        double cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
        return new double[] {
            cr * cp * cy + sr * sp * sy,
            sr * cp * cy - cr * sp * sy,
            cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy
        };
    }

    @Override public byte[] read(int reg, int count) {
        byte[] data;
        if (reg == BULK_READ) {
            ByteBuffer b = ByteBuffer.allocate(bulkScope.length * 4);
            for (int r : bulkScope) b.put(register(r));
            data = b.array();
        } else {
            data = register(reg);
        }
        byte[] out = Arrays.copyOf(data, count);
        if (count == data.length + 1) out[count - 1] = crc8(data);
        return out;
    }

    @Override public void write(int reg, byte[] data) {
        ByteBuffer b = ByteBuffer.wrap(Arrays.copyOf(data, Math.max(4, data.length))).order(ByteOrder.LITTLE_ENDIAN);
        double[] p = reportedPose();
        double rawX = in("x"), rawY = in("y"), rawH = in("heading");
        switch (reg) {
            case DEVICE_CONTROL: {
                int bits = b.getInt(0);
                if ((bits & RESET_POS_AND_IMU) != 0) {
                    pose.set(rawX, rawY, rawH, 0, 0, 0);
                    calibrate();
                }
                if ((bits & RECALIBRATE_IMU) != 0) calibrate();
                if ((bits & SET_X_ENCODER_REVERSED) != 0) xReversed = true;
                if ((bits & SET_X_ENCODER_FORWARD) != 0) xReversed = false;
                if ((bits & SET_Y_ENCODER_REVERSED) != 0) yReversed = true;
                if ((bits & SET_Y_ENCODER_FORWARD) != 0) yReversed = false;
                break;
            }
            case X_POSITION: pose.set(rawX, rawY, rawH, b.getFloat(0), p[1], p[2]); break;
            case Y_POSITION: pose.set(rawX, rawY, rawH, p[0], b.getFloat(0), p[2]); break;
            case H_ORIENTATION: pose.set(rawX, rawY, rawH, p[0], p[1], b.getFloat(0)); break;
            case MM_PER_TICK: mmPerTick = b.getFloat(0); break;
            case X_POD_OFFSET: xPodOffset = b.getFloat(0); break;
            case Y_POD_OFFSET: yPodOffset = b.getFloat(0); break;
            case YAW_SCALAR:
                pose.set(rawX, rawY, rawH, p[0], p[1], p[2]);
                yawScalar = b.getFloat(0);
                pose.angularScale = yawScalar;
                break;
            case SET_BULK_READ: {
                List<Integer> scope = new ArrayList<>();
                for (byte r : data) scope.add(r & 0xFF);
                bulkScope = new int[scope.size()];
                for (int i = 0; i < bulkScope.length; i++) bulkScope[i] = scope.get(i);
                break;
            }
            default:
                break;
        }
        publish();
    }

    private void calibrate() {
        calibratingUntilNanos = SimLastKnown.now() + CALIBRATION_MS * 1_000_000L;
    }

    private void publish() {
        device.output("xOffsetMm", (double) xPodOffset);
        device.output("yOffsetMm", (double) yPodOffset);
        device.output("ticksPerMm", mmPerTick == 0 ? null : (Object) (double) mmPerTick);
        device.output("xDirection", xReversed ? "REVERSED" : "FORWARD");
        device.output("yDirection", yReversed ? "REVERSED" : "FORWARD");
        device.output("yawScalar", (double) yawScalar);
    }

    /** GoBildaPinpointDriver.computeCRC8과 같은 계산 */
    static byte crc8(byte[] data) {
        byte crc = (byte) 0x90;
        for (byte b : data) {
            crc ^= b;
            for (int i = 0; i < 8; i++) {
                if ((crc & 0x80) != 0) crc = (byte) ((crc << 1) ^ 0x31);
                else crc <<= 1;
            }
        }
        return crc;
    }
}
