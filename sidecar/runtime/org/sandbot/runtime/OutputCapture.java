package org.sandbot.runtime;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/**
 * 팀 코드의 System.out·System.err를 가로채 줄 단위 log 메시지로 보낸다(stream "out"·"err"). 줄 끝의 \r은 뺀다.
 * 줄바꿈 없이 남은 글자는 {@link #flushPartial}(끝낼 때) 때 보낸다. 아주 긴 줄은 {@link #MAX_LINE_BYTES}마다 끊는다.
 */
final class OutputCapture extends OutputStream {
    interface Sink {
        void line(String stream, String text);
    }

    static final int MAX_LINE_BYTES = 64 * 1024;

    private final String stream;
    private final Sink sink;
    private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();

    OutputCapture(String stream, Sink sink) {
        this.stream = stream;
        this.sink = sink;
    }

    static PrintStream printStream(String stream, Sink sink) {
        try {
            return new PrintStream(new OutputCapture(stream, sink), true, StandardCharsets.UTF_8.name());
        } catch (java.io.UnsupportedEncodingException e) {
            throw new AssertionError(e);
        }
    }

    @Override
    public synchronized void write(int b) {
        if (b == '\n') {
            emit();
            return;
        }
        buffer.write(b);
        if (buffer.size() >= MAX_LINE_BYTES) emit();
    }

    @Override
    public synchronized void write(byte[] b, int off, int len) {
        for (int i = off; i < off + len; i++) write(b[i]);
    }

    synchronized void flushPartial() {
        if (buffer.size() > 0) emit();
    }

    private void emit() {
        String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        buffer.reset();
        if (text.endsWith("\r")) text = text.substring(0, text.length() - 1);
        sink.line(stream, text);
    }
}
