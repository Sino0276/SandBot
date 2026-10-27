package org.sandbot.runtime;

import com.qualcomm.robotcore.hardware.HardwareMap;

import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * 장치 연결(D의 org.sandbot.sdk.devices.SandbotHardware) 호출 지점:
 * {@code create(File configXmlOrNull) → HardwareMap}(실패하면 SandbotConfigException), INIT 전 {@code beforeInit(map)},
 * 끝난 뒤 {@code afterStop(map)}.
 *
 * <p>SandbotHardware는 같은 가짜 SDK jar에 있지만 R·D가 따로 만들기 때문에 리플렉션으로 찾는다. 없으면(장치 구현이 없는 빌드)
 * 장치 없는 {@code new HardwareMap(null, null)}을 쓰고, 구성 파일을 받았으면 경고 한 줄을 보낸다. 통합 뒤에도 그대로 써도 되고
 * (호출 비용은 실행마다 세 번), 직접 호출로 바꿔도 된다.
 */
final class HardwareHooks {
    static final String CLASS_NAME = "org.sandbot.sdk.devices.SandbotHardware";
    static final String CONFIG_EXCEPTION = "org.sandbot.sdk.devices.SandbotConfigException";

    /** 구성을 읽지 못했다(error kind config). 메시지는 영어. */
    static final class ConfigFailure extends Exception {
        final Throwable cause;

        ConfigFailure(String message, Throwable cause) {
            super(message);
            this.cause = cause;
        }
    }

    private final Method create;
    private final Method beforeInit;
    private final Method afterStop;

    private HardwareHooks(Method create, Method beforeInit, Method afterStop) {
        this.create = create;
        this.beforeInit = beforeInit;
        this.afterStop = afterStop;
    }

    static HardwareHooks load(ClassLoader loader) {
        try {
            Class<?> type = Class.forName(CLASS_NAME, true, loader);
            return new HardwareHooks(type.getMethod("create", File.class), type.getMethod("beforeInit", HardwareMap.class),
                    type.getMethod("afterStop", HardwareMap.class));
        } catch (ClassNotFoundException | NoSuchMethodException e) {
            return new HardwareHooks(null, null, null);
        }
    }

    boolean available() {
        return create != null;
    }

    HardwareMap create(String configXml) throws ConfigFailure {
        if (create == null) return new HardwareMap(null, null);
        try {
            Object map = create.invoke(null, configXml == null ? null : new File(configXml));
            if (!(map instanceof HardwareMap)) throw new ConfigFailure("SandbotHardware.create returned no hardwareMap", null);
            return (HardwareMap) map;
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause != null && cause.getClass().getName().equals(CONFIG_EXCEPTION))
                throw new ConfigFailure(String.valueOf(cause.getMessage()), null);
            throw new ConfigFailure("Reading the robot configuration failed: " + StackFrames.describe(cause), cause);
        } catch (IllegalAccessException e) {
            throw new ConfigFailure("SandbotHardware.create is not accessible: " + e.getMessage(), e);
        }
    }

    void beforeInit(HardwareMap map) throws Throwable {
        call(beforeInit, map);
    }

    void afterStop(HardwareMap map) throws Throwable {
        call(afterStop, map);
    }

    private static void call(Method method, HardwareMap map) throws Throwable {
        if (method == null) return;
        try {
            method.invoke(null, map);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }
}
