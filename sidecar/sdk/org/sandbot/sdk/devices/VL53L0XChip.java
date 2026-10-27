package org.sandbot.sdk.devices;

import org.sandbot.sim.SimDevice;

/**
 * STMicroelectronics VL53L0X(REV 2m 거리 센서)의 I2C 레지스터 흉내. 실제 드라이버(VL53L0X)의 초기화가 읽는 레지스터는 칩의
 * 리셋 값(모델 ID 0xEE·0xAA·0x10, VCSEL 주기 등)으로, 쓰는 레지스터는 그대로 기억한다(0xFF로 고르는 페이지별).
 * 연속 측정(SYSRANGE_START = 0x02)을 시작하면 {@value #MEASUREMENT_MS} ms(기본 측정 시간 예산)마다 측정이 끝나
 * RESULT_INTERRUPT_STATUS에 '새 값' 비트가 서고, SYSTEM_INTERRUPT_CLEAR를 쓰면 지워진다. 드라이버는 이 비트를 기다리므로
 * 측정 주기보다 자주 읽으면 실제처럼 기다린다(그동안의 상태 읽기도 I2C 트랜잭션).
 *
 * <p>입력: distance(m, 센서 앞 물체까지). 없으면 물체가 범위 밖일 때 칩이 내는 {@value #OUT_OF_RANGE_MM} mm.
 */
final class VL53L0XChip implements SimI2cChip {
    static final String KIND = "distance";
    static final int MEASUREMENT_MS = 33;
    static final int OUT_OF_RANGE_MM = 8190;

    private static final int SYSRANGE_START = 0x00, SYSTEM_INTERRUPT_CLEAR = 0x0B, RESULT_INTERRUPT_STATUS = 0x13;
    private static final int RESULT_RANGE_MM = 0x14 + 10, PAGE_SELECT = 0xFF;

    private final SimDevice device;
    private final java.util.Map<Integer, byte[]> pages = new java.util.HashMap<>();
    private int page = 0;
    private boolean continuous = false;
    private long continuousStartNanos = 0;
    private long consumedMeasurements = 0;
    private boolean singleShotReady = false;

    VL53L0XChip(SimDevice device) {
        this.device = device;
        byte[] p0 = page(0);
        p0[0xC0] = (byte) 0xEE;
        p0[0xC1] = (byte) 0xAA;
        p0[0xC2] = 0x10;
        p0[0x50] = 0x06; // PRE_RANGE_CONFIG_VCSEL_PERIOD 리셋 값(14 PCLK)
        p0[0x70] = 0x04; // FINAL_RANGE_CONFIG_VCSEL_PERIOD 리셋 값(10 PCLK)
        p0[0x83] = 0x01; // SPAD 정보 준비됨
        p0[0x92] = (byte) 0x8A; // 참조 SPAD 수·종류
    }

    private byte[] page(int index) {
        byte[] registers = pages.get(index);
        if (registers == null) {
            registers = new byte[256];
            pages.put(index, registers);
        }
        return registers;
    }

    private long completedMeasurements() {
        if (!continuous) return 0;
        return (SimLastKnown.now() - continuousStartNanos) / (MEASUREMENT_MS * 1_000_000L);
    }

    private boolean ready() {
        return singleShotReady || completedMeasurements() > consumedMeasurements;
    }

    private int rangeMm() {
        Object distance = device.input("distance");
        if (!(distance instanceof Number)) return OUT_OF_RANGE_MM;
        long mm = Math.round(((Number) distance).doubleValue() * 1000);
        return (int) Math.max(0, Math.min(OUT_OF_RANGE_MM, mm));
    }

    @Override public byte[] read(int reg, int count) {
        int start = reg == NO_REGISTER ? 0 : reg & 0xFF;
        byte[] out = new byte[count];
        for (int i = 0; i < count; i++) {
            int r = (start + i) & 0xFF;
            if (page == 0 && r == RESULT_INTERRUPT_STATUS) out[i] = (byte) (ready() ? 0x04 : 0x00);
            else if (page == 0 && r == RESULT_RANGE_MM) out[i] = (byte) (rangeMm() >> 8);
            else if (page == 0 && r == RESULT_RANGE_MM + 1) out[i] = (byte) rangeMm();
            else if (r == 0x83 || r == 0x92) out[i] = page(0)[r]; // SPAD 정보(페이지 6·7에서 읽는다)
            else out[i] = page(page)[r];
        }
        return out;
    }

    @Override public void write(int reg, byte[] data) {
        int start = reg == NO_REGISTER ? 0 : reg & 0xFF;
        for (int i = 0; i < data.length; i++) {
            int r = (start + i) & 0xFF;
            int value = data[i] & 0xFF;
            if (r == PAGE_SELECT) {
                page = value;
                continue;
            }
            if (page == 0 && r == SYSRANGE_START) {
                if ((value & 0x02) != 0) {
                    continuous = true;
                    continuousStartNanos = SimLastKnown.now();
                    consumedMeasurements = 0;
                } else if ((value & 0x01) != 0) {
                    singleShotReady = true;
                } else if (value == 0) {
                    continuous = false;
                }
            } else if (page == 0 && r == SYSTEM_INTERRUPT_CLEAR) {
                singleShotReady = false;
                consumedMeasurements = Math.max(consumedMeasurements, completedMeasurements());
            }
            if (!(r == 0x83 || r == 0x92)) page(page)[r] = data[i];
        }
    }
}
