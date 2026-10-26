package org.sandbot.testing;

import java.util.Objects;

/** 사이드카 Java 테스트의 확인 함수(JUnit 없이). 실패하면 AssertionError를 던진다. */
public final class Check {
    private Check() {}

    public static void isTrue(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void equal(Object expected, Object actual, String message) {
        if (!Objects.equals(expected, actual))
            throw new AssertionError(message + ": expected <" + expected + "> but was <" + actual + ">");
    }

    public static void near(double expected, double actual, double tolerance, String message) {
        if (!(Math.abs(expected - actual) <= tolerance))
            throw new AssertionError(message + ": expected " + expected + " ± " + tolerance + " but was " + actual);
    }

    public interface Body {
        void run() throws Throwable;
    }

    /** body가 type(또는 그 하위) 예외를 던져야 한다. 던진 예외를 돌려준다. */
    public static <T extends Throwable> T throwsType(Class<T> type, Body body, String message) {
        try {
            body.run();
        } catch (Throwable t) {
            if (type.isInstance(t)) return type.cast(t);
            throw new AssertionError(message + ": expected " + type.getName() + " but got " + t, t);
        }
        throw new AssertionError(message + ": expected " + type.getName() + " but nothing was thrown");
    }
}
