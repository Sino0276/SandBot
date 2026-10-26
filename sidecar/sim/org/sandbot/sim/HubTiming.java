package org.sandbot.sim;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.SplittableRandom;

/**
 * Hub 타이밍 표: 작업 하나가 쓰는 가상 시간. 실제 Control Hub에서 팀 코드의 루프 시간이 대부분 하드웨어 호출에서 나오므로,
 * 호출마다 이 비용을 청구하면 PC 성능과 관계없이 실제 로봇과 비슷한 루프 시간이 나온다.
 *
 * <p>기본값은 FTC 커뮤니티에서 흔히 쓰는 근사치다(gm0 "Bulk Reads": 하드웨어 호출 하나 약 2–3 ms, bulk read 하나로
 * 모든 엔코더·디지털·아날로그 입력). 팀이 측정해 덮어쓸 수 있다(RunRequest.timing, 밀리초).
 *
 * <p>오차(jitter)를 켜면 비용마다 [1 − jitter, 1 + jitter] 배를 고르게 뽑는다. 같은 seed·같은 호출 순서면 같은 값이다.
 * OpMode 스레드 하나만 부른다(1단계).
 */
public final class HubTiming {
    /** 덮어쓰기 키(밀리초). sidecarProtocol.ts의 HUB_TIMING_KEYS와 같은 순서·이름. */
    public static final String[] KEYS = {
        "lynxCommandControl",
        "lynxCommandExpansion",
        "bulkReadControl",
        "bulkReadExpansion",
        "i2cControl",
        "i2cExpansion",
        "clockRead",
        "loopMarker",
        "telemetryUpdate"
    };

    private static final Map<String, Double> DEFAULT_MILLIS;

    static {
        Map<String, Double> m = new LinkedHashMap<>();
        m.put("lynxCommandControl", 1.5);
        m.put("lynxCommandExpansion", 2.5);
        m.put("bulkReadControl", 2.0);
        m.put("bulkReadExpansion", 3.0);
        m.put("i2cControl", 2.5);
        m.put("i2cExpansion", 3.5);
        m.put("clockRead", 0.001);
        m.put("loopMarker", 0.005);
        m.put("telemetryUpdate", 0.2);
        DEFAULT_MILLIS = Collections.unmodifiableMap(m);
    }

    private final Map<String, Long> nanos = new LinkedHashMap<>();
    private final double jitter;
    private final SplittableRandom random;

    /**
     * @param overridesMillis 덮어쓸 비용(밀리초, 키는 KEYS). 모르는 키·음수·NaN은 IllegalArgumentException.
     * @param jitter 0이면 오차 없음. 0 이상 1 미만.
     */
    public HubTiming(Map<String, Double> overridesMillis, double jitter, long seed) {
        if (!(jitter >= 0 && jitter < 1)) throw new IllegalArgumentException("jitter must be in [0, 1): " + jitter);
        for (Map.Entry<String, Double> e : DEFAULT_MILLIS.entrySet()) nanos.put(e.getKey(), toNanos(e.getValue()));
        for (Map.Entry<String, Double> e : overridesMillis.entrySet()) {
            if (!DEFAULT_MILLIS.containsKey(e.getKey()))
                throw new IllegalArgumentException("unknown hub timing key: " + e.getKey());
            Double v = e.getValue();
            if (v == null || !(v >= 0) || Double.isInfinite(v))
                throw new IllegalArgumentException("invalid hub timing for " + e.getKey() + ": " + v);
            nanos.put(e.getKey(), toNanos(v));
        }
        this.jitter = jitter;
        this.random = new SplittableRandom(seed);
    }

    /** 기본값만(오차 없음) */
    public static HubTiming defaults() {
        return new HubTiming(Collections.<String, Double>emptyMap(), 0, 0);
    }

    public static Map<String, Double> defaultMillis() {
        return DEFAULT_MILLIS;
    }

    private static long toNanos(double millis) {
        return Math.round(millis * 1_000_000.0);
    }

    /** 오차를 넣기 전의 비용(나노초) */
    public long baseNanos(SimCost cost, HubKind hub) {
        return nanos.get(key(cost, hub));
    }

    /** 이번 호출의 비용(나노초). 오차가 켜져 있으면 뽑을 때마다 다르다. */
    public long nanos(SimCost cost, HubKind hub) {
        long base = baseNanos(cost, hub);
        if (jitter == 0 || base == 0) return base;
        double factor = 1 + jitter * (random.nextDouble() * 2 - 1);
        return Math.max(0, Math.round(base * factor));
    }

    static String key(SimCost cost, HubKind hub) {
        boolean expansion = hub == HubKind.EXPANSION;
        switch (cost) {
            case LYNX_COMMAND:
                return expansion ? "lynxCommandExpansion" : "lynxCommandControl";
            case BULK_READ:
                return expansion ? "bulkReadExpansion" : "bulkReadControl";
            case I2C_TRANSACTION:
                return expansion ? "i2cExpansion" : "i2cControl";
            case CLOCK_READ:
                return "clockRead";
            case LOOP_MARKER:
                return "loopMarker";
            case TELEMETRY_UPDATE:
                return "telemetryUpdate";
            default:
                throw new IllegalArgumentException(String.valueOf(cost));
        }
    }
}
