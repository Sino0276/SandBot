package org.sandbot.sim;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 시뮬레이터가 보는 장치 하나(구성 이름 하나). 가짜 SDK의 장치 구현이 만들어 {@link SimDevices}에 넣는다.
 *
 * <p>outputs는 장치가 내보내는 값(모터 power·mode, 서보 position 등)이고 런타임이 틱마다 호스트로 보낸다.
 * inputs는 호스트가 보낸 센서 값(엔코더 position, IMU 각도 등)이고 장치가 읽는다(없으면 기본값).
 * 값은 Number·Boolean·String·null만 쓴다(JSON). 키는 장치 종류(kind)마다 org.sandbot.sdk.devices가 정하고 문서로 남긴다.
 */
public final class SimDevice {
    private final String name;
    private final String kind;
    private final Map<String, Object> outputs = new LinkedHashMap<>();
    private final Map<String, Object> inputs = new LinkedHashMap<>();

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

    /** 호스트가 보낸 값을 합친다(보낸 키만 바꾼다). 런타임이 틱 경계에서 부른다. */
    public synchronized void applyInputs(Map<String, Object> values) {
        for (Map.Entry<String, Object> e : values.entrySet()) inputs.put(e.getKey(), checkValue(e.getValue()));
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
        throw new IllegalArgumentException("device values must be Number, Boolean, String or null: " + value.getClass());
    }
}
