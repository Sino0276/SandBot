package org.sandbot.sim;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 시뮬레이터가 보는 장치 하나(구성 이름 하나). 가짜 SDK의 장치 구현이 만들어 {@link SimDevices}에 넣는다.
 *
 * <p>outputs는 장치가 내보내는 값(모터 power·mode, 서보 position 등)이고 런타임이 틱마다 호스트로 보낸다.
 * inputs는 호스트가 보낸 센서 값(엔코더 position, IMU 각도 등)이고 장치가 읽는다(없으면 기본값).
 * 값은 Number·Boolean·String·null과 유한 수의 List(JSON 배열, 출력만: 모터 PIDF 계수 [p, i, d, f], 호스트는 16개까지 받는다)만
 * 쓴다(JSON). List는 넣을 때 복사해 바꿀 수 없게 둔다. 키는 장치 종류(kind)마다 org.sandbot.sdk.devices가 정하고 문서로 남긴다.
 *
 * <p>입력 훅({@link InputHook}): 측정 시각이 있는 칩(VL53L0X·APDS-9151)이 입력이 바뀌기 직전에 그 틱 경계 시각을 받아, 그 전에 끝난
 * 측정을 옛 입력으로 잡는다. 경계 시각은 인자로 받는다: 가상 시계는 charge로 시간을 더한 뒤 넘은 경계를 처리하므로 경계 일 안의
 * 지금 시각은 경계보다 최대 한 트랜잭션 늦고, 한 charge가 여러 경계를 넘으면 모두 같은 끝 시각을 본다(VirtualClock.charge·process).
 */
public final class SimDevice {
    private final String name;
    private final String kind;
    private final Map<String, Object> outputs = new LinkedHashMap<>();
    private final Map<String, Object> inputs = new LinkedHashMap<>();
    private InputHook inputHook;

    /**
     * 입력이 바뀌기 직전에 부르는 훅. 장치마다 하나다. 훅은 시계를 부르지 않는다(charge·{@code Sim.nanoTime()} 모두: 경계 일 안에서
     * charge하면 팀 코드가 보는 루프 시간이 바뀌고, 지금 시각은 경계 시각이 아니다).
     */
    public interface InputHook {
        /** boundaryNanos: 이번 입력이 적용되는 틱 경계의 가상 시각(ns). 입력은 아직 옛 값이다. */
        void beforeInputs(long boundaryNanos);
    }

    public SimDevice(String name, String kind) {
        this.name = name;
        this.kind = kind;
    }

    /** 구성 이름(hardwareMap 이름) */
    public String name() {
        return name;
    }

    /** 장치 종류(motor, servo, imu …, org.sandbot.sdk.devices 문서) */
    public String kind() {
        return kind;
    }

    public synchronized void output(String key, Object value) {
        outputs.put(key, checkValue(value));
    }

    /** 지금 출력의 복사본(넣은 순서) */
    public synchronized Map<String, Object> outputs() {
        return Collections.unmodifiableMap(new LinkedHashMap<>(outputs));
    }

    /** 입력 훅을 둔다(장치당 하나, 다시 부르면 바꾼다. null이면 없앤다). 장치 구현(칩)이 만들 때 부른다. */
    public synchronized void setInputHook(InputHook hook) {
        this.inputHook = hook;
    }

    /**
     * 호스트가 보낸 값을 합친다(보낸 키만 바꾼다). 경계 시각은 지금 시각으로 본다: 시험 지원처럼 손으로 맞춘 시계라 지금이 곧 경계일
     * 때만 쓴다. 런타임은 {@link #applyInputs(Map, long)}을 부른다.
     */
    public void applyInputs(Map<String, Object> values) {
        applyInputs(values, Sim.installed() ? Sim.nanoTime() : 0);
    }

    /**
     * 호스트가 보낸 값을 합친다(보낸 키만 바꾼다). 런타임이 틱 경계에서 부른다. 값을 바꾸기 전에 입력 훅에 경계 시각을 넘긴다
     * (훅 안에서 {@link #input}은 옛 값을 돌려준다).
     */
    public void applyInputs(Map<String, Object> values, long boundaryNanos) {
        InputHook hook;
        synchronized (this) {
            hook = inputHook;
        }
        if (hook != null) hook.beforeInputs(boundaryNanos);
        synchronized (this) {
            for (Map.Entry<String, Object> e : values.entrySet()) inputs.put(e.getKey(), checkValue(e.getValue()));
        }
    }

    public synchronized Object input(String key) {
        return inputs.get(key);
    }

    public synchronized double inputDouble(String key, double fallback) {
        Object v = inputs.get(key);
        return v instanceof Number ? ((Number) v).doubleValue() : fallback;
    }

    public synchronized long inputLong(String key, long fallback) {
        Object v = inputs.get(key);
        return v instanceof Number ? ((Number) v).longValue() : fallback;
    }

    public synchronized boolean inputBoolean(String key, boolean fallback) {
        Object v = inputs.get(key);
        return v instanceof Boolean ? (Boolean) v : fallback;
    }

    public synchronized String inputString(String key, String fallback) {
        Object v = inputs.get(key);
        return v instanceof String ? (String) v : fallback;
    }

    private static Object checkValue(Object value) {
        if (value == null || value instanceof Number || value instanceof Boolean || value instanceof String) return value;
        if (value instanceof List) {
            List<Object> copy = new ArrayList<>((List<?>) value);
            for (Object item : copy) {
                // JSON에는 NaN·무한대가 없다(Json.write가 null로 쓰면 호스트가 프로토콜 오류로 끝낸다)
                if (!(item instanceof Number) || !Double.isFinite(((Number) item).doubleValue()))
                    throw new IllegalArgumentException("device value lists must hold finite numbers: " + item);
            }
            return Collections.unmodifiableList(copy);
        }
        throw new IllegalArgumentException("device values must be Number, Boolean, String, a list of numbers or null: " + value.getClass());
    }
}
