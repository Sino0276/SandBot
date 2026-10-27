package org.sandbot.sdk.devices;

import com.qualcomm.robotcore.hardware.HardwareMap;

import org.sandbot.testing.Check;

import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * SandBot이 만든 하드웨어 클래스(javaCodegen.ts)와 구성 XML(configXml.ts)을 OpMode처럼 돌린다:
 * 구성 읽기 → beforeInit(OpMode 사이 초기화) → new 생성클래스(hardwareMap)(생성 초기화 순서) → afterStop.
 * sidecar/tests/devices.test.ts가 로봇마다 이 도구를 부르는 테스트 클래스를 만들어 따로 JVM에서 돌린다(장치 이름이 겹치므로).
 */
public final class GeneratedInit {
    private GeneratedInit() {}

    private static HardwareMap map;

    /**
     * 생성자를 실행하고, 공개 필드가 모두 null이 아닌지 본다(중첩 그룹 클래스의 필드까지). nullable은 구성에 없어 tryGet으로
     * null이 되어도 되는 필드 이름이다(시리얼이 없는 웹캠·Limelight).
     */
    public static Object construct(String configXml, String className, String... nullable) throws Throwable {
        SimTestSupport.install();
        map = SandbotHardware.create(new File(configXml));
        SandbotHardware.beforeInit(map);
        Class<?> type = Class.forName(className);
        Object robot;
        try {
            robot = type.getConstructor(HardwareMap.class).newInstance(map);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
        checkFields(type, robot, type.getSimpleName(), new HashSet<>(Arrays.asList(nullable)));
        return robot;
    }

    private static void checkFields(Class<?> type, Object value, String path, Set<String> nullable) throws IllegalAccessException {
        for (Field field : type.getFields()) {
            if (Modifier.isStatic(field.getModifiers())) continue;
            Object fieldValue = field.get(value);
            String fieldPath = path + "." + field.getName();
            if (fieldValue == null) {
                Check.isTrue(nullable.contains(field.getName()), fieldPath + " is null");
                continue;
            }
            Check.isTrue(!nullable.contains(field.getName()), fieldPath + " should be null (not in the configuration)");
            // 메커니즘 그룹(생성 클래스 안의 중첩 클래스)
            if (field.getType().getEnclosingClass() != null && field.getType().getName().startsWith(type.getName().split("\\$")[0]))
                checkFields(field.getType(), fieldValue, fieldPath, nullable);
        }
    }

    /** 시뮬레이터 출력 하나가 기대한 값인지(수는 1e-5 안: 장치가 float로 받는 값이 있다) */
    public static void expectOutput(String device, String key, Object expected) {
        Object actual = SimTestSupport.output(device, key);
        String message = device + " output " + key;
        if (expected instanceof Number && actual instanceof Number)
            Check.near(((Number) expected).doubleValue(), ((Number) actual).doubleValue(), 1e-5, message);
        else
            Check.equal(expected, actual, message);
    }

    /** 구성의 장치마다 시뮬레이터 장치가 있는지와 그 종류 */
    public static void expectDevices(Map<String, String> kinds) {
        for (Map.Entry<String, String> e : kinds.entrySet())
            Check.equal(e.getValue(), SimTestSupport.device(e.getKey()).kind(), e.getKey() + " kind");
    }

    /** OpMode가 끝난 뒤처럼 fail safe */
    public static void stop() {
        SandbotHardware.afterStop(map);
    }
}
