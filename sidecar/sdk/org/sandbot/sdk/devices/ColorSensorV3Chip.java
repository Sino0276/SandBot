package org.sandbot.sdk.devices;

import org.sandbot.sim.SimDevice;

import java.util.ArrayList;
import java.util.List;

/**
 * REV Color Sensor V3(Broadcom APDS-9151)의 I2C 레지스터 흉내. 레지스터 번호는 실제 드라이버(BroadcomColorSensor.Register)와 같다.
 * MAIN_STATUS를 읽으면 '새 값' 비트(LS_DATA_STATUS, PS_DATA_STATUS)가 지워진다(드라이버는 LS 비트가 있을 때만 색을 다시 읽는다).
 *
 * <p>입력: red·green·blue·ir(SDK 기본 3×·25 ms 기준 칩 원래 값. 칩이 LS_GAIN·적분으로 DS 표 비율만큼 척도를 바꾸고 해상도로 포화,
 * 측정 k는 t_ls + t_int + k·max(주기, t_int)에 끝나며 적분 창의 시간 평균을 잡는다; 드라이버가 red에 1.07, blue에 1.55를 곱한다),
 * proximity(0..2047, PS 주기마다 그 순간 값) 또는 distance(m, 시험용: RevColorSensorV3의 거리 공식을 거꾸로 써서 PS). 시뮬레이터는
 * red·green·blue·proximity만 보낸다. 없으면 0이다.
 *
 * <p>칩 시각과 척도(APDS-9151 데이터시트, 명세 4c §1.8):
 * <ul>
 *   <li>해상도·적분(DS p.20 LS_MEAS_RATE[6:4]): 20·19·18·17·16·13비트 = 400·200·100·50·25·3.125 ms(110·111은 예약, 13비트로 둔다).
 *       LS_DATA는 2^비트 − 1에서 포화한다. SDK 드라이버는 아래 16비트만 읽으므로(BroadcomColorSensorImpl.updateColors) 16비트보다 높은
 *       해상도는 실제처럼 감긴다.</li>
 *   <li>척도(DS p.8–9 lux/count 표): 칩 값 = round(입력 × 1.1834 / res(gain, t_int)). 입력은 3×·25 ms(1.1834 lux/count) 기준이다.</li>
 *   <li>LS 측정 시각(DS p.10 상태도, p.20): 실제 주기 P = max(LS_MEAS_RATE[2:0] 주기, t_int)("repeat rate will be lower than
 *       programmed"). 위상 기준 t_ls는 LS_EN 0 → 1과 LS_MEAS_RATE·LS_GAIN 쓰기 중 나중 것("Writing to this register resets LS state
 *       machine"). 변환이 먼저라 측정 k(≥ 0)는 t_ls + t_int + k·P에 끝난다. LS_DATA는 마지막으로 끝난 측정 값이다(첫 측정 전 0).</li>
 *   <li>LS 값 [가정: LS는 적분 창 평균]: 측정 k의 값은 [끝 − t_int, 끝] 안 입력의 시간 가중 평균이다. 입력은 틱 경계에서만 바뀌므로
 *       입력 훅이 쌓은 구간으로 정확히 더한다. 평균 → 척도 → 반올림 → 포화 순서다.</li>
 *   <li>PS 측정 시각(DS p.18–19) [가정: PS는 순간]: 주기 PS_MEAS_RATE[2:0] = 6.25(000은 예약, 6.25로 둔다)·6.25·12.5·25·50·100·200·
 *       400 ms. 위상 기준 t_ps는 PS_EN 0 → 1과 PS_LED·PS_PULSES·PS_MEAS_RATE 쓰기 중 나중 것. 32펄스 변환(약 0.5 ms)은 0으로 보아
 *       측정 k(≥ 0)는 t_ps + k·P_ps에 끝나고 그 순간의 PS를 잡는다. PS_DATA는 마지막 PS 측정 값이다(첫 측정 전 0). PS 넘침 비트는
 *       세우지 않는다(드라이버가 0x7FF로 가린다). PS는 SDK 기본 설정 기준이다(펄스·전류·해상도를 바꿔도 같은 값, 한계).</li>
 * </ul>
 * 잡기 규칙(정수 나노초): 입력 훅(경계 b)은 끝 &lt; b인 측정을 옛 입력으로, 레지스터 읽기(지금 = now)와 설정 레지스터 쓰기 직전은
 * 끝 ≤ now인 측정을 지금 입력으로 잡는다. 마지막으로 잡은 측정만 기억한다.
 */
final class ColorSensorV3Chip implements SimI2cChip {
    static final String KIND = "color";

    private static final int MAIN_CTRL = 0x00, PS_LED = 0x01, PS_PULSES = 0x02, PS_MEAS_RATE = 0x03, LS_MEAS_RATE = 0x04;
    private static final int LS_GAIN = 0x05, PART_ID = 0x06, MAIN_STATUS = 0x07, PS_DATA = 0x08;
    private static final int LS_DATA_IR = 0x0A, LS_DATA_GREEN = 0x0D, LS_DATA_BLUE = 0x10, LS_DATA_RED = 0x13, LAST = 0x27;
    // MAIN_CTRL 비트(BroadcomColorSensor.MainControl), MAIN_STATUS 비트(DS p.21)
    private static final int PS_EN = 0x01, LS_EN = 0x02;
    private static final int LS_DATA_STATUS = 0x08, PS_DATA_STATUS = 0x01;

    /** LS_MEAS_RATE[2:0] 주기(ms, DS p.20) */
    private static final long[] LS_RATE_NANOS = {25_000_000L, 50_000_000L, 100_000_000L, 200_000_000L, 500_000_000L,
            1_000_000_000L, 2_000_000_000L, 2_000_000_000L};
    /** LS_MEAS_RATE[6:4] → 해상도 비트(DS p.20, 110·111 예약은 13비트로 둔다 [가정: 예약 값은 가장 짧은 적분]) */
    private static final int[] LS_RESOLUTION_BITS = {20, 19, 18, 17, 16, 13, 13, 13};
    /** LS_MEAS_RATE[6:4] → 적분 시간(ns, DS p.20) */
    private static final long[] LS_INTEGRATION_NANOS = {400_000_000L, 200_000_000L, 100_000_000L, 50_000_000L, 25_000_000L,
            3_125_000L, 3_125_000L, 3_125_000L};
    /** LS_MEAS_RATE[6:4] → 아래 lux/count 표의 열(3.125, 25, 50, 100, 200, 400 ms 순) */
    private static final int[] LS_INTEGRATION_COLUMN = {5, 4, 3, 2, 1, 0, 0, 0};
    /** DS p.8–9 "ALS Gain and Resolution Settings"의 res(lux/ct): 행 = 이득 1×·3×·6×·9×·18×, 열 = 3.125·25·50·100·200·400 ms */
    private static final double[][] LUX_PER_COUNT = {
            {28.8288, 3.6036, 1.8018, 0.9009, 0.4505, 0.2252},
            {9.4675, 1.1834, 0.5917, 0.2959, 0.1479, 0.0740},
            {4.7267, 0.5908, 0.2954, 0.1477, 0.0739, 0.0369},
            {3.1189, 0.3899, 0.1949, 0.0975, 0.0487, 0.0244},
            {1.5459, 0.1932, 0.0966, 0.0483, 0.0242, 0.0121}};
    /** 입력의 기준: 3×·25 ms(DS p.9의 1.1834 lux/count, SDK 기본 설정) */
    private static final double REFERENCE_LUX_PER_COUNT = 1.1834;
    /** PS_MEAS_RATE[2:0] 주기(ns, DS p.19; 000은 예약이라 001과 같은 6.25 ms로 둔다) */
    private static final long[] PS_RATE_NANOS = {6_250_000L, 6_250_000L, 12_500_000L, 25_000_000L, 50_000_000L,
            100_000_000L, 200_000_000L, 400_000_000L};
    private static final String[] LS_KEYS = {"red", "green", "blue", "ir"};
    private static final int[] LS_REGISTERS = {LS_DATA_RED, LS_DATA_GREEN, LS_DATA_BLUE, LS_DATA_IR};

    // RevColorSensorV3의 거리 공식 매개변수
    private static final double A_PARAM = 325.961, BINV_PARAM = -0.75934, C_PARAM = 26.980;

    /** 입력이 변하지 않은 구간 [start, end)와 그 동안의 red·green·blue·ir 입력 */
    private static final class Segment {
        final long start;
        final long end;
        final double[] values;

        Segment(long start, long end, double[] values) {
            this.start = start;
            this.end = end;
            this.values = values;
        }
    }

    private final SimDevice device;
    private final byte[] registers = new byte[LAST + 1];

    /** 닫힌 입력 구간(오래된 것부터). 가장 이른 구간은 앞으로 늘린다(첫 경계 앞을 덮는 창). */
    private final List<Segment> history = new ArrayList<>();
    /** 지금 입력이 시작된 경계(첫 경계 전이면 Long.MIN_VALUE) */
    private long currentStart = Long.MIN_VALUE;

    private long lsPhaseNanos = 0;
    private long lsLatchedIndex = -1;
    private long lsSeenIndex = -1;
    private long psPhaseNanos = 0;
    private long psLatchedIndex = -1;
    private long psSeenIndex = -1;

    ColorSensorV3Chip(SimDevice device) {
        this.device = device;
        // 리셋 값(DS p.17–20)
        registers[PS_LED] = 0x36;
        registers[PS_PULSES] = 0x08;
        registers[PS_MEAS_RATE] = 0x05;
        registers[LS_MEAS_RATE] = 0x22;
        registers[LS_GAIN] = 0x01;
        registers[PART_ID] = (byte) 0xC2;
        device.setInputHook(this::beforeInputs);
    }

    // ---- 설정 ----

    private boolean lightEnabled() {
        return (registers[MAIN_CTRL] & LS_EN) != 0;
    }

    private boolean proximityEnabled() {
        return (registers[MAIN_CTRL] & PS_EN) != 0;
    }

    private int resolutionCode() {
        return (registers[LS_MEAS_RATE] >> 4) & 0x07;
    }

    private long integrationNanos() {
        return LS_INTEGRATION_NANOS[resolutionCode()];
    }

    private long lsPeriodNanos() {
        return Math.max(LS_RATE_NANOS[registers[LS_MEAS_RATE] & 0x07], integrationNanos());
    }

    private long psPeriodNanos() {
        return PS_RATE_NANOS[registers[PS_MEAS_RATE] & 0x07];
    }

    /** 입력(3×·25 ms 기준)에서 칩 값으로의 비율 r = 1.1834 / res(gain, t_int). 이득 코드가 표 밖이면 3×(DS 기본) */
    private double scale() {
        int gain = registers[LS_GAIN] & 0x07;
        if (gain > 4) gain = 1;
        return REFERENCE_LUX_PER_COUNT / LUX_PER_COUNT[gain][LS_INTEGRATION_COLUMN[resolutionCode()]];
    }

    // ---- 측정 잡기 ----

    /** 끝 시각 phase + offset + k·period가 t보다 앞(inclusive면 t 포함)인 가장 큰 k(없으면 −1) */
    private static long lastIndex(long t, long phase, long offset, long period, boolean inclusive) {
        long span = t - phase - offset - (inclusive ? 0 : 1);
        if (span < 0) return -1;
        return span / period;
    }

    /**
     * 끝 시각이 t보다 앞(inclusive면 t 포함)인 측정까지 잡는다. 지금 입력은 currentStart부터 무한히 이어진다고 본다(부르는 쪽이 잡는
     * 측정의 끝까지 지금 입력이 유효할 때만 부른다).
     */
    private void latchUpTo(long t, boolean inclusive) {
        if (lightEnabled()) {
            long tInt = integrationNanos();
            long index = lastIndex(t, lsPhaseNanos, tInt, lsPeriodNanos(), inclusive);
            if (index > lsLatchedIndex) {
                lsLatchedIndex = index;
                long end = lsPhaseNanos + tInt + index * lsPeriodNanos();
                storeLight(end - tInt, end);
            }
        }
        if (proximityEnabled()) {
            long index = lastIndex(t, psPhaseNanos, 0, psPeriodNanos(), inclusive);
            if (index > psLatchedIndex) {
                psLatchedIndex = index;
                int ps = proximity();
                registers[PS_DATA] = (byte) (ps & 0xFF);
                registers[PS_DATA + 1] = (byte) ((ps >> 8) & 0x07);
            }
        }
    }

    /** 창 [from, to]의 입력 시간 가중 평균 → 척도 → 반올림 → 포화를 LS_DATA에 쓴다 */
    private void storeLight(long from, long to) {
        double[] sums = new double[LS_KEYS.length];
        double[] current = currentLight();
        for (int i = 0; i <= history.size(); i++) {
            boolean isCurrent = i == history.size();
            long start = isCurrent ? currentStart : history.get(i).start;
            long end = isCurrent ? Long.MAX_VALUE : history.get(i).end;
            double[] values = isCurrent ? current : history.get(i).values;
            if (i == 0) start = Long.MIN_VALUE; // 가장 이른 구간은 앞으로 늘린다
            long a = Math.max(start, from);
            long b = Math.min(end, to);
            if (b <= a) continue;
            for (int c = 0; c < sums.length; c++) sums[c] += values[c] * (double) (b - a);
        }
        double scale = scale();
        long max = (1L << LS_RESOLUTION_BITS[resolutionCode()]) - 1;
        double width = (double) (to - from);
        for (int c = 0; c < LS_KEYS.length; c++) {
            long v = Math.round(sums[c] / width * scale);
            put24(LS_REGISTERS[c], Math.max(0, Math.min(max, v)));
        }
        prune();
    }

    /** 다음에 잡을 측정의 창 시작보다 앞에서 끝난 구간을 버린다(LS가 꺼져 있으면 닫힌 구간을 모두) */
    private void prune() {
        long keepFrom = Long.MAX_VALUE;
        if (lightEnabled()) {
            long tInt = integrationNanos();
            keepFrom = lsPhaseNanos + tInt + (lsLatchedIndex + 1) * lsPeriodNanos() - tInt;
        }
        while (!history.isEmpty() && history.get(0).end <= keepFrom) history.remove(0);
    }

    private double[] currentLight() {
        double[] values = new double[LS_KEYS.length];
        for (int c = 0; c < LS_KEYS.length; c++) values[c] = device.inputDouble(LS_KEYS[c], 0);
        return values;
    }

    /** 입력 훅: 경계 b 전에 끝난 측정을 옛 입력으로 잡고, 옛 입력 구간을 닫는다. 시계를 부르지 않는다. */
    private void beforeInputs(long boundaryNanos) {
        latchUpTo(boundaryNanos, false);
        if (boundaryNanos > currentStart) {
            history.add(new Segment(currentStart, boundaryNanos, currentLight()));
            currentStart = boundaryNanos;
        }
        prune();
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

    private void put24(int reg, long v) {
        registers[reg] = (byte) (v & 0xFF);
        registers[reg + 1] = (byte) ((v >> 8) & 0xFF);
        registers[reg + 2] = (byte) ((v >> 16) & 0x0F);
    }

    // ---- 레지스터 ----

    @Override public byte[] read(int reg, int count) {
        int start = reg == NO_REGISTER ? 0 : reg;
        latchUpTo(SimLastKnown.now(), true);
        int status = 0;
        if (lightEnabled() && lsLatchedIndex > lsSeenIndex) status |= LS_DATA_STATUS;
        if (proximityEnabled() && psLatchedIndex > psSeenIndex) status |= PS_DATA_STATUS;
        registers[MAIN_STATUS] = (byte) status;
        byte[] out = new byte[count];
        for (int i = 0; i < count && start + i <= LAST; i++) out[i] = registers[start + i];
        if (start <= MAIN_STATUS && MAIN_STATUS < start + count) {
            lsSeenIndex = lsLatchedIndex;
            psSeenIndex = psLatchedIndex;
        }
        return out;
    }

    @Override public void write(int reg, byte[] data) {
        int start = reg == NO_REGISTER ? 0 : reg;
        for (int i = 0; i < data.length && start + i <= LAST; i++) {
            int r = start + i;
            if (r == PART_ID || r == MAIN_STATUS || (r >= PS_DATA && r < 0x16)) continue;
            long now = SimLastKnown.now();
            boolean resetsLight = r == LS_MEAS_RATE || r == LS_GAIN;
            boolean resetsProximity = r == PS_LED || r == PS_PULSES || r == PS_MEAS_RATE;
            if (r == MAIN_CTRL || resetsLight || resetsProximity) {
                // 설정을 바꾸기 전에 지금까지 끝난 측정을 옛 설정으로 잡는다
                latchUpTo(now, true);
            }
            boolean lightWasOn = lightEnabled();
            boolean proximityWasOn = proximityEnabled();
            registers[r] = data[i];
            if (r == MAIN_CTRL) {
                resetsLight = !lightWasOn && lightEnabled();
                resetsProximity = !proximityWasOn && proximityEnabled();
            }
            if (resetsLight) {
                lsPhaseNanos = now;
                lsLatchedIndex = -1;
                lsSeenIndex = -1;
                prune();
            }
            if (resetsProximity) {
                psPhaseNanos = now;
                psLatchedIndex = -1;
                psSeenIndex = -1;
            }
        }
    }
}
