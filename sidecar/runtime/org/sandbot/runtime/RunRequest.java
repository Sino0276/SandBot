package org.sandbot.runtime;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 호스트의 run 메시지(src/shared/sidecarProtocol.ts의 RunRequest)를 검사해 읽은 것 */
final class RunRequest {
    static final int PROTOCOL = 3;

    /** TeamCode의 @OpModeRegistrar 메서드가 있는 클래스(sidecarProtocol RegistrarRef) */
    static final class Registrar {
        final String className;
        /** 소스 파일 절대 경로(컴파일 시작 파일에 더한다) */
        final String source;

        Registrar(String className, String source) {
            this.className = className;
            this.source = source;
        }
    }

    /** 받을 수 없는 요청(메시지는 영어, error kind internal) */
    static final class Invalid extends Exception {
        Invalid(String message) {
            super(message);
        }
    }

    final long tickNanos;
    final List<String> sourceRoots;
    final String opModeSource;
    /** @TeleOp·@Autonomous 클래스(registeredName이면 null) */
    final String opModeClass;
    /** @OpModeRegistrar가 등록한 OpMode의 DS 이름(opModeClass면 null) */
    final String registeredName;
    /** TeamCode의 모든 등록기(실제 SDK처럼 OpMode를 고르기 전에 모두 실행한다) */
    final List<Registrar> registrars;
    /** AppUtil.ROOT_FOLDER(프로젝트마다의 모의 저장소, 호스트가 만든 절대 경로) */
    final String firstFolder;
    /** javac -bootclasspath(Android 플랫폼 API). 비면 --release 8(시험만). */
    final List<String> bootClasspath;
    /** javac -classpath(sandbot-sdk.jar + 컴파일용 라이브러리 jar) */
    final List<String> compileClasspath;
    /** 실행 때 LibraryClassLoader가 시간 API를 패치해 읽는 라이브러리 jar */
    final List<String> libraryClasspath;
    final String configXml;
    final Map<String, Double> timing;
    final double jitter;
    final long seed;
    final long startEpochMillis;
    final long stallMillis;

    private RunRequest(Map<String, Object> m) throws Invalid {
        checkProtocolAndClock(m);
        tickNanos = positiveLong(m, "tickNanos");
        sourceRoots = stringList(m, "sourceRoots");
        opModeSource = string(m, "opModeSource");
        opModeClass = nullableString(m, "opModeClass");
        registeredName = nullableString(m, "registeredName");
        if ((opModeClass == null) == (registeredName == null))
            throw new Invalid("exactly one of opModeClass and registeredName must be set");
        registrars = registrars(m);
        firstFolder = string(m, "firstFolder");
        bootClasspath = stringList(m, "bootClasspath");
        compileClasspath = stringList(m, "compileClasspath");
        libraryClasspath = stringList(m, "libraryClasspath");
        Object config = m.get("configXml");
        if (config != null && !(config instanceof String)) throw new Invalid("configXml must be a string or null");
        configXml = (String) config;
        Object t = m.get("timing");
        if (!(t instanceof Map)) throw new Invalid("timing must be an object");
        Map<String, Double> overrides = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : ((Map<?, ?>) t).entrySet()) {
            if (!(e.getValue() instanceof Number)) throw new Invalid("timing." + e.getKey() + " must be a number");
            overrides.put((String) e.getKey(), ((Number) e.getValue()).doubleValue());
        }
        timing = Collections.unmodifiableMap(overrides);
        Object j = m.get("jitter");
        if (!(j instanceof Number)) throw new Invalid("jitter must be a number");
        jitter = ((Number) j).doubleValue();
        seed = integer(m, "seed");
        startEpochMillis = integer(m, "startEpochMillis");
        stallMillis = positiveLong(m, "stallMillis");
    }

    static RunRequest parse(Map<String, Object> message) throws Invalid {
        return new RunRequest(message);
    }

    /** run·list 공통: 프로토콜 버전과 시계 종류 */
    static void checkProtocolAndClock(Map<String, Object> m) throws Invalid {
        Object protocol = m.get("protocol");
        if (!(protocol instanceof Long) || (Long) protocol != PROTOCOL)
            throw new Invalid("unsupported protocol " + protocol + " (this sidecar speaks protocol " + PROTOCOL + ")");
        Object clock = m.get("clock");
        if (!"virtual".equals(clock))
            throw new Invalid("unsupported clock " + Json.write(clock) + " (this sidecar supports \"virtual\" only)");
    }

    /** 등록기 클래스 이름들(요청 순서) */
    static List<String> registrarClasses(List<Registrar> registrars) {
        List<String> out = new ArrayList<>();
        for (Registrar r : registrars) out.add(r.className);
        return out;
    }

    /** 컴파일 시작 파일: 먼저 first(있으면), 그다음 등록기 소스(같은 파일은 TeamCompiler가 한 번만 넣는다) */
    static List<String> startFiles(String first, List<Registrar> registrars) {
        List<String> out = new ArrayList<>();
        if (first != null) out.add(first);
        for (Registrar r : registrars) out.add(r.source);
        return out;
    }

    static String string(Map<String, Object> m, String key) throws Invalid {
        Object v = m.get(key);
        if (!(v instanceof String) || ((String) v).isEmpty()) throw new Invalid(key + " must be a non-empty string");
        return (String) v;
    }

    static String nullableString(Map<String, Object> m, String key) throws Invalid {
        Object v = m.get(key);
        if (v == null) return null;
        if (!(v instanceof String) || ((String) v).isEmpty())
            throw new Invalid(key + " must be a non-empty string or null");
        return (String) v;
    }

    static List<Registrar> registrars(Map<String, Object> m) throws Invalid {
        Object v = m.get("registrars");
        if (!(v instanceof List)) throw new Invalid("registrars must be an array");
        List<Registrar> out = new ArrayList<>();
        for (Object item : (List<?>) v) {
            if (!(item instanceof Map)) throw new Invalid("registrars must be an array of objects");
            @SuppressWarnings("unchecked")
            Map<String, Object> registrar = (Map<String, Object>) item;
            out.add(new Registrar(string(registrar, "className"), string(registrar, "source")));
        }
        return Collections.unmodifiableList(out);
    }

    static List<String> stringList(Map<String, Object> m, String key) throws Invalid {
        Object v = m.get(key);
        if (!(v instanceof List)) throw new Invalid(key + " must be an array of strings");
        List<String> out = new ArrayList<>();
        for (Object item : (List<?>) v) {
            if (!(item instanceof String)) throw new Invalid(key + " must be an array of strings");
            out.add((String) item);
        }
        return Collections.unmodifiableList(out);
    }

    /** JSON 정수(JavaScript가 1.0처럼 보낸 정수 값도 받는다) */
    static long integer(Map<String, Object> m, String key) throws Invalid {
        Object v = m.get(key);
        if (v instanceof Long) return (Long) v;
        if (v instanceof Double) {
            double d = (Double) v;
            if (d == Math.rint(d) && Math.abs(d) <= 9.007199254740991E15) return (long) d;
        }
        throw new Invalid(key + " must be an integer");
    }

    static long positiveLong(Map<String, Object> m, String key) throws Invalid {
        long v = integer(m, key);
        if (v <= 0) throw new Invalid(key + " must be positive");
        return v;
    }
}
