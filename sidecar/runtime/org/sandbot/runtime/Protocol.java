package org.sandbot.runtime;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 사이드카 → 호스트 메시지 쓰기(src/shared/sidecarProtocol.ts의 SidecarMessage). 원래 stdout은 이 클래스만 쓴다.
 * 한 메시지 = JSON 한 줄이고 줄 단위로 동기화한다(여러 스레드가 써도 줄이 섞이지 않는다). finished를 쓴 뒤에는 아무것도 쓰지 않는다.
 *
 * <p>로그 줄 제한: 가상 시간 1초(정수 초 구간)에 {@link #MAX_LOG_LINES_PER_SECOND}줄을 넘는 log는 버리고, 다음 구간의 첫 log 앞이나
 * finished 앞에서 "… N lines dropped"를 한 번 보낸다(그 구간에서 마지막으로 버린 줄의 stream으로). 가상 시간 기준이라 결정적이다.
 */
final class Protocol {
    static final int MAX_LOG_LINES_PER_SECOND = 500;

    private final OutputStream out;
    private boolean closed;

    // 로그 제한(가상 초 구간)
    private long logWindow = Long.MIN_VALUE;
    private int logCount;
    private long dropped;
    private String droppedStream;

    Protocol(OutputStream out) {
        this.out = out;
    }

    synchronized void send(Map<String, Object> message) {
        if (closed) return;
        boolean finished = "finished".equals(message.get("type"));
        if (finished) flushDropped(asLong(message.get("tNanos")));
        writeLine(message);
        if (finished) closed = true;
    }

    synchronized boolean isClosed() {
        return closed;
    }

    private void writeLine(Map<String, Object> message) {
        byte[] line = (Json.write(message) + "\n").getBytes(StandardCharsets.UTF_8);
        try {
            out.write(line);
            out.flush();
        } catch (IOException e) {
            // 호스트가 없어졌다(파이프 닫힘): 더 할 일이 없다
            Runtime.getRuntime().halt(0);
        }
    }

    // ---- 메시지 ----

    void hello(String runtimeHash, String javaVersion) {
        send(Json.obj("type", "hello", "protocol", 1, "runtime", runtimeHash, "java", javaVersion));
    }

    void compiled(boolean ok, List<Map<String, Object>> diagnostics, long millis) {
        send(Json.obj("type", "compiled", "ok", ok, "diagnostics", diagnostics, "millis", millis));
    }

    void state(long tNanos, String phase) {
        send(Json.obj("type", "state", "tNanos", tNanos, "phase", phase));
    }

    void tick(long tick, long tNanos, String phase, long loops, Map<String, Object> outputs) {
        send(Json.obj("type", "tick", "tick", tick, "tNanos", tNanos, "phase", phase, "loops", loops, "outputs",
                outputs));
    }

    void telemetry(long tNanos, List<String> lines, List<String> log, String format) {
        send(Json.obj("type", "telemetry", "tNanos", tNanos, "frame",
                Json.obj("lines", new ArrayList<>(lines), "log", new ArrayList<>(log), "format", format)));
    }

    /** stream: "out"·"err"·"robotLog" */
    synchronized void log(long tNanos, String stream, String text) {
        if (closed) return;
        long window = Math.floorDiv(tNanos, 1_000_000_000L);
        if (window != logWindow) {
            flushDropped(tNanos);
            logWindow = window;
            logCount = 0;
        }
        if (logCount >= MAX_LOG_LINES_PER_SECOND) {
            dropped++;
            droppedStream = stream;
            return;
        }
        logCount++;
        writeLine(Json.obj("type", "log", "tNanos", tNanos, "stream", stream, "text", text));
    }

    private void flushDropped(long tNanos) {
        if (dropped == 0) return;
        writeLine(Json.obj("type", "log", "tNanos", tNanos, "stream", droppedStream, "text",
                "… " + dropped + " lines dropped"));
        dropped = 0;
    }

    void error(long tNanos, String kind, String message, String exception, List<Map<String, Object>> stack,
            String thread) {
        send(Json.obj("type", "error", "tNanos", tNanos, "kind", kind, "message", message, "exception", exception,
                "stack", stack, "thread", thread));
    }

    void finished(long tNanos, String reason) {
        send(Json.obj("type", "finished", "tNanos", tNanos, "reason", reason));
    }

    private static long asLong(Object v) {
        return v instanceof Number ? ((Number) v).longValue() : 0;
    }
}
