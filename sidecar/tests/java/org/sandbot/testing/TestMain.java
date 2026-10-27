package org.sandbot.testing;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/**
 * 사이드카 Java 테스트 실행기. 인수로 받은 클래스마다 public static void test*() 메서드를 이름 순서로 부른다.
 * 한 줄에 하나씩 "PASS 클래스#메서드" 또는 "FAIL 클래스#메서드 …(스택)"을 쓰고, 실패가 있으면 종료 코드 1이다.
 * 메서드 하나만: 클래스#메서드. vitest 감싸개(sidecar/tests/*.test.ts)가 이 출력을 읽는다.
 */
public final class TestMain {
    public static void main(String[] args) throws Exception {
        int failures = 0;
        int count = 0;
        for (String arg : args) {
            String className = arg;
            String only = null;
            int hash = arg.indexOf('#');
            if (hash >= 0) {
                className = arg.substring(0, hash);
                only = arg.substring(hash + 1);
            }
            Class<?> type = Class.forName(className);
            List<Method> methods = new ArrayList<>(Arrays.asList(type.getDeclaredMethods()));
            methods.sort(Comparator.comparing(Method::getName));
            for (Method method : methods) {
                int m = method.getModifiers();
                if (!method.getName().startsWith("test") || !Modifier.isStatic(m) || !Modifier.isPublic(m)) continue;
                if (method.getParameterCount() != 0) continue;
                if (only != null && !only.equals(method.getName())) continue;
                count++;
                String id = type.getName() + "#" + method.getName();
                try {
                    method.invoke(null);
                    System.out.println("PASS " + id);
                } catch (InvocationTargetException e) {
                    failures++;
                    System.out.println("FAIL " + id + " " + describe(e.getCause()));
                }
                System.out.flush();
            }
        }
        System.out.println("DONE tests=" + count + " failures=" + failures);
        System.exit(failures == 0 && count > 0 ? 0 : 1);
    }

    private static String describe(Throwable t) {
        java.io.StringWriter out = new java.io.StringWriter();
        t.printStackTrace(new java.io.PrintWriter(out));
        return out.toString().replace("\r", "").replace("\n", "\n    ");
    }
}
