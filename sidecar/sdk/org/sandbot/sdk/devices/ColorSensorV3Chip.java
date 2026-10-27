package org.sandbot.sdk.devices;

import org.sandbot.sim.SimDevice;

/**
 * REV Color Sensor V3(Broadcom APDS-9151)의 I2C 레지스터 흉내. 레지스터 번호는 실제 드라이버(BroadcomColorSensor.Register)와 같다.
 * 빛 센서는 LS_MEAS_RATE의 주기(기본 100 ms)마다 새 값을 내고, MAIN_STATUS를 읽으면 '새 값' 비트(LS_DATA_STATUS)가 지워진다
 * (드라이버는 이 비트가 있을 때만 색을 다시 읽는다).
 *
 * <p>입력: red·green·blue·ir(칩의 원래 측정값, 0–65535, 드라이버의 보정 곱 전), distance(m, 근접 센서가 보는 물체까지:
 * RevColorSensorV3의 거리 공식을 거꾸로 써서 PS 값을 만든다) 또는 proximity(PS 원래 값 0–2047). 기본은 모두 0(물체 없음, 6 in).
 */
final class ColorSensorV3Chip implements SimI2cChip {
    static final String KIND = "color";

    private static final int MAIN_CTRL = 0x00, LS_MEAS_RATE = 0x04, PART_ID = 0x06, MAIN_STATUS = 0x07, PS_DATA = 0x08;
    private static final int LS_DATA_IR = 0x0A, LS_DATA_GREEN = 0x0D, LS_DATA_BLUE = 0x10, LS_DATA_RED = 0x13, LAST = 0x27;
    private static final int LS_DATA_STATUS = 0x08, PS_DATA_STAT = 0x01;
    private static final int[] LS_RATE_MS = {25, 50, 100, 200, 500, 1000, 2000, 2000};

    // RevColorSensorV3의 거리 공식 매개변수
    private static final double A_PARAM = 325.961, BINV_PARAM = -0.75934, C_PARAM = 26.980;

    private final SimDevice device;
    private final byte[] registers = new byte[LAST + 1];
    private long enabledNanos = 0;
    private long lastSeenMeasurement = -1;

    ColorSensorV3Chip(SimDevice device) {
        this.device = device;
        registers[PART_ID] = (byte) 0xC2;
        registers[LS_MEAS_RATE] = 0x22; // 칩 기본값: 18비트, 100 ms
    }

    private long measurementIndex() {
        int periodMs = LS_RATE_MS[registers[LS_MEAS_RATE] & 0x07];
        return (SimLastKnown.now() - enabledNanos) / (periodMs * 1_000_000L);
    }

    private int proximity() {
        Object distance = device.input("distance");
        if (distance instanceof Number) {
            double inches = ((Number) distance).doubleValue() / 0.0254;
            if (inches <= 0) return 2047;
            double raw = A_PARAM * Math.pow(inches, 1 / BINV_PARAM) + C_PARAM;
            return (int) Math.max(0, Math.min(2047, Math.round(raw)));
        }
        return (int) Math.max(0, Math.min(2047, device.inputLong("proximity", 0)));
    }

    private void put24(int reg, String key) {
        long v = Math.max(0, Math.min(0xFFFFF, device.inputLong(key, 0)));
        registers[reg] = (byte) (v & 0xFF);
        registers[reg + 1] = (byte) ((v >> 8) & 0xFF);
        registers[reg + 2] = (byte) ((v >> 16) & 0x0F);
    }

    @Override public byte[] read(int reg, int count) {
        int start = reg == NO_REGISTER ? 0 : reg;
        int ps = proximity();
        registers[PS_DATA] = (byte) (ps & 0xFF);
        registers[PS_DATA + 1] = (byte) ((ps >> 8) & 0x07);
        put24(LS_DATA_IR, "ir");
        put24(LS_DATA_GREEN, "green");
        put24(LS_DATA_BLUE, "blue");
        put24(LS_DATA_RED, "red");
        boolean lightEnabled = (registers[MAIN_CTRL] & 0x02) != 0;
        long measurement = measurementIndex();
        int status = PS_DATA_STAT;
        if (lightEnabled && measurement > lastSeenMeasurement) status |= LS_DATA_STATUS;
        registers[MAIN_STATUS] = (byte) status;
        byte[] out = new byte[count];
        for (int i = 0; i < count && start + i <= LAST; i++) out[i] = registers[start + i];
        if (start <= MAIN_STATUS && MAIN_STATUS < start + count && lightEnabled) lastSeenMeasurement = measurement;
        return out;
    }

    @Override public void write(int reg, byte[] data) {
        int start = reg == NO_REGISTER ? 0 : reg;
        for (int i = 0; i < data.length && start + i <= LAST; i++) {
            int r = start + i;
            if (r == PART_ID || r == MAIN_STATUS || (r >= PS_DATA && r < 0x16)) continue;
            if (r == MAIN_CTRL && (registers[MAIN_CTRL] & 0x02) == 0 && (data[i] & 0x02) != 0) {
                enabledNanos = SimLastKnown.now();
                lastSeenMeasurement = 0; // 켜고 첫 측정이 끝나야 새 값이 생긴다
            }
            registers[r] = data[i];
        }
    }
}
