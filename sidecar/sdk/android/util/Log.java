// SandBot: Android의 android.util.Log와 같은 API(android-4.1.1.4.jar의 공개 서명)를 사이드카에 맞게 새로 쓴 것.
// logcat 대신 시뮬레이터 호스트의 robotLog로 보낸다. 줄 모양은 logcat brief 형식 "<수준>/<태그>: <메시지>"(수준 V·D·I·W·E·A).
package android.util;

import org.sandbot.sim.Sim;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;

public final class Log {
    public static final int VERBOSE = 2;
    public static final int DEBUG = 3;
    public static final int INFO = 4;
    public static final int WARN = 5;
    public static final int ERROR = 6;
    public static final int ASSERT = 7;

    Log() {}

    public static int v(String tag, String msg) {
        return println(VERBOSE, tag, msg);
    }

    public static int v(String tag, String msg, Throwable tr) {
        return println(VERBOSE, tag, msg + '\n' + getStackTraceString(tr));
    }

    public static int d(String tag, String msg) {
        return println(DEBUG, tag, msg);
    }

    public static int d(String tag, String msg, Throwable tr) {
        return println(DEBUG, tag, msg + '\n' + getStackTraceString(tr));
    }

    public static int i(String tag, String msg) {
        return println(INFO, tag, msg);
    }

    public static int i(String tag, String msg, Throwable tr) {
        return println(INFO, tag, msg + '\n' + getStackTraceString(tr));
    }

    public static int w(String tag, String msg) {
        return println(WARN, tag, msg);
    }

    public static int w(String tag, String msg, Throwable tr) {
        return println(WARN, tag, msg + '\n' + getStackTraceString(tr));
    }

    /** Android 기본처럼 INFO 이상만 기록 대상으로 본다(이 구현은 수준과 관계없이 모두 보낸다) */
    public static boolean isLoggable(String tag, int level) {
        return level >= INFO;
    }

    public static int w(String tag, Throwable tr) {
        return println(WARN, tag, getStackTraceString(tr));
    }

    public static int e(String tag, String msg) {
        return println(ERROR, tag, msg);
    }

    public static int e(String tag, String msg, Throwable tr) {
        return println(ERROR, tag, msg + '\n' + getStackTraceString(tr));
    }

    public static int wtf(String tag, String msg) {
        return println(ASSERT, tag, msg);
    }

    public static int wtf(String tag, Throwable tr) {
        return println(ASSERT, tag, getStackTraceString(tr));
    }

    public static int wtf(String tag, String msg, Throwable tr) {
        return println(ASSERT, tag, msg + '\n' + getStackTraceString(tr));
    }

    /** Android와 같이: null이면 "", 원인 사슬에 UnknownHostException이 있으면 ""(네트워크 없음 로그를 줄이려는 Android 동작) */
    public static String getStackTraceString(Throwable tr) {
        if (tr == null) return "";
        for (Throwable t = tr; t != null; t = t.getCause()) {
            if (t instanceof UnknownHostException) return "";
        }
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        tr.printStackTrace(pw);
        pw.flush();
        String text = sw.toString();
        // 끝 줄바꿈은 한 메시지 안에서 의미가 없다
        return text.endsWith("\n") ? text.substring(0, text.length() - 1) : text;
    }

    /** @return 쓴 바이트 수(Android처럼 양수) */
    public static int println(int priority, String tag, String msg) {
        if (msg == null) throw new NullPointerException("println needs a message");
        String line = level(priority) + "/" + tag + ": " + msg;
        if (Sim.installed()) {
            Sim.host().log("robotLog", line);
        } else {
            // 사이드카 밖(가짜 SDK 단위 테스트 등)
            System.err.println(line);
        }
        return line.getBytes(StandardCharsets.UTF_8).length;
    }

    private static char level(int priority) {
        switch (priority) {
            case VERBOSE:
                return 'V';
            case DEBUG:
                return 'D';
            case INFO:
                return 'I';
            case WARN:
                return 'W';
            case ERROR:
                return 'E';
            case ASSERT:
                return 'A';
            default:
                return '?';
        }
    }
}
