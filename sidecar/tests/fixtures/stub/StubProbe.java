import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.sandbot.sim.SimUnsupportedException;

/**
 * stub 확인(build.test.ts): 인수 파일에 적힌 stub 클래스마다
 * <ul>
 *   <li>정적 초기화가 던지지 않는다(stub 자신의 정적 초기화 안에서 난 예외만 실패로 센다).
 *   <li>선언한 public·protected 정적 메서드와 (추상이 아닌 클래스의) 생성자가 기본값 인수로 불렀을 때
 *       SimUnsupportedException("바이너리 이름#메서드(인수 형식)")을 던진다. 생성자는 먼저 상위 생성자를 부르므로
 *       상위도 stub이면 상위 생성자 이름이 나온다(그것도 맞다). 상위가 실제 코드(손 구현·들여옴)면 기본값 인수로
 *       그 코드가 다른 예외를 던질 수 있어 건너뛴다.
 * </ul>
 * 줄마다 "FAIL …"이고, 끝 줄은 "CHECKED classes=… methods=… constructors=… skipped=…".
 */
public final class StubProbe {
    private static int failures;

    public static void main(String[] args) throws Exception {
        List<String> names = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);
        Set<String> stubs = new HashSet<>(names);
        int classes = 0, methods = 0, constructors = 0, skipped = 0;
        for (String name : names) {
            if (name.isEmpty()) continue;
            Class<?> type;
            try {
                type = Class.forName(name, true, StubProbe.class.getClassLoader());
            } catch (ExceptionInInitializerError e) {
                if (thrownInStub(e.getCause(), stubs)) fail(name + ": static initializer threw " + e.getCause());
                else skipped++; // 손 구현 상위 클래스 등 stub 밖의 초기화(시뮬레이터가 없어서)
                continue;
            } catch (LinkageError e) {
                fail(name + ": cannot load: " + e);
                continue;
            }
            classes++;
            for (Method m : type.getDeclaredMethods()) {
                int mod = m.getModifiers();
                if (!Modifier.isStatic(mod) || m.isSynthetic() || m.isBridge()) continue;
                if (!Modifier.isPublic(mod) && !Modifier.isProtected(mod)) continue;
                if (type.isEnum() && (m.getName().equals("values") || m.getName().equals("valueOf"))) continue;
                m.setAccessible(true);
                if (expectUnsupported(type, m.getName(), m.getParameterTypes(), 0, stubs,
                        () -> m.invoke(null, defaults(m.getParameterTypes())))) methods++;
                else skipped++;
            }
            if (Modifier.isAbstract(type.getModifiers()) || type.isInterface() || type.isEnum()) continue;
            for (Constructor<?> c : type.getDeclaredConstructors()) {
                int mod = c.getModifiers();
                if (c.isSynthetic() || (!Modifier.isPublic(mod) && !Modifier.isProtected(mod))) continue;
                c.setAccessible(true);
                // 내부(비정적) 클래스의 첫 인수는 바깥 인스턴스(API 글자에는 없다)
                boolean inner = type.getEnclosingClass() != null && !Modifier.isStatic(type.getModifiers());
                if (expectUnsupported(type, "<init>", c.getParameterTypes(), inner ? 1 : 0, stubs,
                        () -> c.newInstance(defaults(c.getParameterTypes())))) constructors++;
                else skipped++;
            }
        }
        System.out.println("CHECKED classes=" + classes + " methods=" + methods + " constructors=" + constructors
                + " skipped=" + skipped);
        System.exit(failures == 0 ? 0 : 1);
    }

    interface Call {
        Object run() throws Exception;
    }

    /** 확인했으면 true, 건너뛰었으면 false */
    private static boolean expectUnsupported(Class<?> type, String method, Class<?>[] params, int skip,
            Set<String> stubs, Call call) {
        StringBuilder api = new StringBuilder(type.getName()).append('#').append(method).append('(');
        for (int i = skip; i < params.length; i++) {
            if (i > skip) api.append(',');
            api.append(params[i].getTypeName());
        }
        api.append(')');
        boolean constructor = method.equals("<init>");
        try {
            call.run();
            fail(api + ": returned normally");
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause instanceof SimUnsupportedException) {
                String got = ((SimUnsupportedException) cause).api();
                if (got.equals(api.toString())) return true;
                if (constructor && namesSuperConstructor(type, got)) return true;
                // 실제 코드인 상위 생성자가 이 클래스의 (stub) 메서드를 불렀다
                if (constructor && got.startsWith(type.getName() + "#")) return true;
                fail(api + ": SimUnsupportedException names " + got);
            } else if (cause instanceof ExceptionInInitializerError) {
                return false; // 정적 초기화는 위에서 셌다
            } else if (constructor && !stubs.contains(type.getSuperclass().getName())) {
                return false; // 실제 코드인 상위 생성자가 기본값 인수로 던졌다
            } else {
                fail(api + ": threw " + cause);
            }
        } catch (Exception e) {
            fail(api + ": cannot call: " + e);
        }
        return true;
    }

    private static boolean namesSuperConstructor(Class<?> type, String api) {
        for (Class<?> s = type.getSuperclass(); s != null; s = s.getSuperclass())
            if (api.startsWith(s.getName() + "#<init>(")) return true;
        return false;
    }

    private static boolean thrownInStub(Throwable t, Set<String> stubs) {
        if (t == null) return false;
        StackTraceElement[] trace = t.getStackTrace();
        return trace.length > 0 && stubs.contains(trace[0].getClassName());
    }

    private static Object[] defaults(Class<?>[] params) {
        Object[] values = new Object[params.length];
        for (int i = 0; i < params.length; i++) {
            Class<?> p = params[i];
            if (!p.isPrimitive()) continue;
            if (p == boolean.class) values[i] = false;
            else if (p == char.class) values[i] = (char) 0;
            else if (p == byte.class) values[i] = (byte) 0;
            else if (p == short.class) values[i] = (short) 0;
            else if (p == int.class) values[i] = 0;
            else if (p == long.class) values[i] = 0L;
            else if (p == float.class) values[i] = 0f;
            else values[i] = 0d;
        }
        return values;
    }

    private static void fail(String message) {
        failures++;
        System.out.println("FAIL " + message);
    }
}
