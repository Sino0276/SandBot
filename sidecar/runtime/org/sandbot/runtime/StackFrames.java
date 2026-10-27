package org.sandbot.runtime;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 스택 추적 → 프로토콜 StackFrame 목록(팀 코드 프레임에는 소스의 절대 경로) */
final class StackFrames {
    static final int MAX_FRAMES = 100;

    private StackFrames() {}

    /**
     * @param sources 바이너리 클래스 이름 → 소스 절대 경로(이번에 컴파일한 팀 클래스)
     * @param skipSimulatorTop 맨 위의 org.sandbot.sim·org.sandbot.runtime 프레임(시계·대리 함수 안)을 뺀다
     */
    static List<Map<String, Object>> of(StackTraceElement[] stack, Map<String, String> sources, boolean skipSimulatorTop) {
        int start = 0;
        if (skipSimulatorTop) {
            while (start < stack.length && isSimulatorFrame(stack[start])) start++;
            if (start == stack.length) start = 0;
        }
        // 맨 아래의 런타임 프레임(OpModeRunner, Thread.run 등)은 팀에게 의미가 없다
        int end = stack.length;
        while (end > start && isRuntimeBottom(stack[end - 1])) end--;
        List<Map<String, Object>> frames = new ArrayList<>();
        for (int i = start; i < end && frames.size() < MAX_FRAMES; i++) {
            StackTraceElement e = stack[i];
            frames.add(Json.obj("className", e.getClassName(), "method", e.getMethodName(), "file", e.getFileName(),
                    "line", (long) e.getLineNumber(), "source", sources.get(e.getClassName())));
        }
        return frames;
    }

    private static boolean isSimulatorFrame(StackTraceElement e) {
        String c = e.getClassName();
        return c.startsWith("org.sandbot.sim.") || c.startsWith("org.sandbot.runtime.") || c.equals("java.lang.Thread")
                && e.getMethodName().equals("getStackTrace") || c.equals("java.lang.Throwable");
    }

    private static boolean isRuntimeBottom(StackTraceElement e) {
        String c = e.getClassName();
        return c.startsWith("org.sandbot.runtime.") || c.equals("java.lang.Thread")
                || c.startsWith("jdk.internal.reflect.") || c.startsWith("java.lang.reflect.")
                || c.startsWith("java.lang.invoke.");
    }

    /** 예외의 사람이 읽는 문장: "IllegalStateException: msg" + 원인 사슬(최대 5개) */
    static String describe(Throwable t) {
        StringBuilder out = new StringBuilder(simple(t));
        Throwable cause = t.getCause();
        for (int i = 0; cause != null && cause != t && i < 5; i++, cause = cause.getCause()) {
            out.append("\nCaused by: ").append(simple(cause));
        }
        return out.toString();
    }

    private static String simple(Throwable t) {
        String message = t.getMessage();
        String name = t.getClass().getSimpleName();
        if (name.isEmpty()) name = t.getClass().getName();
        return message == null ? name : name + ": " + message;
    }
}
