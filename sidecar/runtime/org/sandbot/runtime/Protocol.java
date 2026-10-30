package org.sandbot.runtime;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 사이드카 → 호스트 메시지 쓰기(src/shared/sidecarProtocol.ts의 SidecarMessage). 원래 stdout은 이 클래스만 쓴다.
 * 한 메시지 = JSON 한 줄이고 줄 단위로 동기화한다(여러 스레드가 써도 줄이 섞이지 않는다). finished를 쓴 뒤에는 아무것도 쓰지 않는다.
 *
 * <p>로그 줄 제한: 가상 시간 1초(정수 초 구간)에 {@link #MAX_LOG_LINES_PER_SECOND}줄을 넘는 log는 버리고, 다음 구간의 첫 log·tick 앞이나
 * finished 앞에서 "… N lines dropped"를 한 번 보낸다(그 구간에서 마지막으로 버린 줄의 stream으로). 가상 시간 기준이라 결정적이다.
 */
final class Protocol {
    static final int MAX_LOG_LINES_PER_SECOND = 500;
    /** 글자 하나(log 줄, 오류 문장, 텔레메트리 줄)의 최대 길이(UTF-16 글자, 붙이는 "…" 포함). 호스트의 log 한도와 같다. */
    static final int MAX_TEXT_CHARS = 64 * 1024;
    /** 텔레메트리 한 번(lines + log)의 최대 글자 수 */
    static final int MAX_FRAME_CHARS = 512 * 1024;

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
        send(Json.obj("type", "hello", "protocol", RunRequest.PROTOCOL, "runtime", runtimeHash, "java", javaVersion));
    }

    /** 라이브러리 링크 검사(LinkCheck, hello 뒤·compiled 전) */
    void linkReport(List<Map<String, Object>> warnings) {
        send(Json.obj("type", "linkReport", "warnings", warnings));
    }

    void compiled(boolean ok, List<Map<String, Object>> diagnostics, long millis) {
        send(Json.obj("type", "compiled", "ok", ok, "diagnostics", diagnostics, "millis", millis));
    }

    void state(long tNanos, String phase) {
        send(Json.obj("type", "state", "tNanos", tNanos, "phase", phase));
    }

    synchronized void tick(long tick, long tNanos, String phase, long loops, Map<String, Object> outputs) {
        // 버린 줄이 있는 구간이 지났으면 지금 알린다(출력이 멈춘 뒤 다음 log나 끝을 기다리지 않게)
        if (!closed && dropped > 0 && Math.floorDiv(tNanos, 1_000_000_000L) != logWindow) flushDropped(tNanos);
        send(Json.obj("type", "tick", "tick", tick, "tNanos", tNanos, "phase", phase, "loops", loops, "outputs",
                outputs));
    }

    void telemetry(long tNanos, List<String> lines, List<String> log, String format) {
        int[] budget = {MAX_FRAME_CHARS};
        send(Json.obj("type", "telemetry", "tNanos", tNanos, "frame",
                Json.obj("lines", clipLines(lines, budget), "log", clipLines(log, budget), "format", format)));
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
        writeLine(Json.obj("type", "log", "tNanos", tNanos, "stream", stream, "text", clip(text)));
    }

    private void flushDropped(long tNanos) {
        if (dropped == 0) return;
        writeLine(Json.obj("type", "log", "tNanos", tNanos, "stream", droppedStream, "text",
                "… " + dropped + " lines dropped"));
        dropped = 0;
    }

    void error(long tNanos, String kind, String message, String exception, List<Map<String, Object>> stack,
            String thread) {
        send(Json.obj("type", "error", "tNanos", tNanos, "kind", kind, "message", clip(message), "exception", exception,
                "stack", stack, "thread", thread));
    }

    /** 등록기가 등록한 OpMode(목록 요청, sidecarProtocol RegisteredMessage). 항목은 RegistrarRunner.Registration.toJson. */
    void registered(List<Map<String, Object>> opModes) {
        send(Json.obj("type", "registered", "opModes", opModes));
    }

    /** 사이드카 안내(sidecarProtocol NoticeMessage). params는 키 이름순으로 쓴다(결정성). */
    void notice(long tNanos, String code, Map<String, String> params) {
        send(Json.obj("type", "notice", "tNanos", tNanos, "code", code, "params", new TreeMap<>(params)));
    }

    void finished(long tNanos, String reason) {
        send(Json.obj("type", "finished", "tNanos", tNanos, "reason", reason));
    }

    /** {@link #MAX_TEXT_CHARS}보다 길면 자르고 "…"를 붙인다(서로게이트 짝을 가르지 않는다) */
    static String clip(String text) {
        if (text == null || text.length() <= MAX_TEXT_CHARS) return text;
        int end = MAX_TEXT_CHARS - 1;
        if (Character.isLowSurrogate(text.charAt(end)) && Character.isHighSurrogate(text.charAt(end - 1))) end--;
        return text.substring(0, end) + "…";
    }

    /** 줄마다 자르고, 남은 글자 수(budget[0])를 다 쓰면 그 뒤 줄은 버리고 "…" 한 줄을 둔다 */
    private static List<String> clipLines(List<String> lines, int[] budget) {
        List<String> out = new ArrayList<>();
        for (String line : lines) {
            String clipped = clip(line);
            int cost = clipped == null ? 4 : clipped.length() + 3;
            if (cost > budget[0]) {
                // 버린 줄이 있다는 표시
                out.add("…");
                budget[0] = 0;
                break;
            }
            budget[0] -= cost;
            out.add(clipped);
        }
        return out;
    }

    private static long asLong(Object v) {
        return v instanceof Number ? ((Number) v).longValue() : 0;
    }
}
