package org.sandbot.sdk.devices;

import org.sandbot.sim.SimDevice;

/**
 * STMicroelectronics VL53L0X(REV 2m 거리 센서)의 I2C 레지스터 흉내. 실제 드라이버(VL53L0X)의 초기화가 읽는 레지스터는 칩의
 * 리셋 값(모델 ID 0xEE·0xAA·0x10, VCSEL 주기 등)으로, 쓰는 레지스터는 그대로 기억한다(0xFF로 고르는 페이지별).
 * 연속 측정(SYSRANGE_START = 0x02)을 시작하면 {@value #MEASUREMENT_MS} ms(기본 측정 시간 예산)마다 측정이 끝나
 * RESULT_INTERRUPT_STATUS에 '새 값' 비트가 서고, SYSTEM_INTERRUPT_CLEAR를 쓰면 지워진다. 드라이버는 이 비트를 기다리므로
 * 측정 주기보다 자주 읽으면 실제처럼 기다린다(그동안의 상태 읽기도 I2C 트랜잭션).
 *
 * <p>입력: distance(m 또는 null: null·없음은 범위 밖 {@value #OUT_OF_RANGE_MM} mm. 연속 측정은 {@value #MEASUREMENT_MS} ms마다
 * 끝나며 그 끝의 값을 잡는다).
 *
 * <p>측정 시각 [가정: ToF는 측정 끝 표본, 명세 4c §1.8]: 연속 측정 k(≥ 1)는 시작 + k·{@value #MEASUREMENT_MS} ms에 끝나고 그때의
 * distance 입력을 잡는다. RESULT_RANGE는 마지막으로 끝난 측정의 값이다(첫 측정 전은 {@value #OUT_OF_RANGE_MM}). 입력은 틱 경계에서만
 * 바뀌므로, 입력 훅(경계 b)은 끝 시각 &lt; b인 측정을 옛 입력으로, 레지스터 읽기(지금 = now)는 끝 시각 ≤ now인 측정을 지금 입력으로
 * 잡는다(정수 나노초). 칩은 광자를 적분할 뿐 거리를 평균하지 않고 범위 밖(null)이 섞이면 평균은 뜻이 없어 창 평균은 하지 않는다
 * (1.5 m/s면 33 ms 사이에 5 cm, 한계). 단일 측정(SYSRANGE_START 0x01)은 읽는 때의 입력이다(드라이버가 쓰지 않음).
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
    /** 마지막으로 잡은 연속 측정 순번(0 = 이번 연속 측정에서 아직 없음)과 그 값(mm) */
    private long latchedIndex = 0;
    private int latchedMm = OUT_OF_RANGE_MM;

    VL53L0XChip(SimDevice device) {
        this.device = device;
        device.setInputHook(this::beforeInputs);
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

    private static final long MEASUREMENT_NANOS = MEASUREMENT_MS * 1_000_000L;

    private long completedMeasurements() {
        if (!continuous) return 0;
        return Math.max(0, SimLastKnown.now() - continuousStartNanos) / MEASUREMENT_NANOS;
    }

    /**
     * 끝 시각이 t보다 앞(inclusive면 t 포함)인 연속 측정까지 잡는다. 잡는 값은 지금 입력이다(부르는 쪽이 그 측정 끝에 유효한 입력일 때만
     * 부른다: 훅은 경계 전의 옛 입력, 읽기는 지금 입력). 마지막 측정만 기억한다.
     */
    private void latchUpTo(long t, boolean inclusive) {
        if (!continuous) return;
        long span = t - continuousStartNanos - (inclusive ? 0 : 1);
        if (span < MEASUREMENT_NANOS) return;
        long index = span / MEASUREMENT_NANOS;
        if (index <= latchedIndex) return;
        latchedIndex = index;
        latchedMm = rangeMm();
    }

    /** 입력 훅: 경계 b 전에 끝난 측정을 옛 입력으로 잡는다. 시계를 부르지 않는다. */
    private void beforeInputs(long boundaryNanos) {
        latchUpTo(boundaryNanos, false);
    }

    /** 시험용: 마지막으로 잡은 연속 측정의 값(mm). 시계를 읽지 않는다. */
    int latchedRangeMm() {
        return latchedMm;
    }

    /** RESULT_RANGE: 연속 측정이면 마지막으로 끝난 측정, 아니면(단일 측정) 지금 입력 */
    private int resultMm() {
        if (!continuous) return rangeMm();
        latchUpTo(SimLastKnown.now(), true);
        return latchedMm;
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
        int range = resultMm();
        for (int i = 0; i < count; i++) {
            int r = (start + i) & 0xFF;
            if (page == 0 && r == RESULT_INTERRUPT_STATUS) out[i] = (byte) (ready() ? 0x04 : 0x00);
            else if (page == 0 && r == RESULT_RANGE_MM) out[i] = (byte) (range >> 8);
            else if (page == 0 && r == RESULT_RANGE_MM + 1) out[i] = (byte) range;
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
                // 설정을 바꾸기 전에 지금까지 끝난 측정을 잡는다(옛 설정의 결과, RESULT_RANGE에 남는다)
                latchUpTo(SimLastKnown.now(), true);
                if ((value & 0x02) != 0) {
                    continuous = true;
                    continuousStartNanos = SimLastKnown.now();
                    consumedMeasurements = 0;
                    latchedIndex = 0;
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
