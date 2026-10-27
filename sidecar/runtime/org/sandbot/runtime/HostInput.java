package org.sandbot.runtime;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * 호스트 → 사이드카 메시지 읽기(src/shared/sidecarProtocol.ts의 HostMessage). stdin 읽기 스레드가 줄마다 JSON을 파싱해 큐에 넣는다.
 * shutdown은 큐를 거치지 않고 바로 처리한다. 잘못된 줄·모르는 type은 프로토콜 오류, 입력이 끝나면(호스트가 없어짐) 끝낸다.
 */
final class HostInput {
    interface Handler {
        /** shutdown을 받았다(읽기 스레드에서) */
        void shutdown();

        /** 프로토콜 오류(읽기 스레드에서). 메시지는 영어. */
        void protocolError(String message);

        /** 입력이 끝났다(호스트가 없어짐) */
        void endOfInput();
    }

    /** 큐에 넣는 메시지(run 또는 tickReply) */
    static final class Message {
        final String type;
        final Map<String, Object> body;

        Message(String type, Map<String, Object> body) {
            this.type = type;
            this.body = body;
        }
    }

    private static final int MAX_LINE = 16 * 1024 * 1024;

    private final LinkedBlockingQueue<Message> queue = new LinkedBlockingQueue<>();
    private final InputStream in;
    private final Handler handler;

    HostInput(InputStream in, Handler handler) {
        this.in = in;
        this.handler = handler;
    }

    void start() {
        Thread t = new Thread(this::readLoop, "SandBotHostInput");
        t.setDaemon(true);
        t.start();
    }

    /** 다음 메시지(run·tickReply)를 기다린다. 끼어들기에 끝나지 않는다(호스트가 답을 늦추는 것은 일시 정지다). */
    Message take() {
        boolean interrupted = false;
        try {
            for (;;) {
                try {
                    return queue.take();
                } catch (InterruptedException e) {
                    interrupted = true;
                }
            }
        } finally {
            if (interrupted) Thread.currentThread().interrupt();
        }
    }

    private void readLoop() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            for (;;) {
                String line = reader.readLine();
                if (line == null) {
                    handler.endOfInput();
                    return;
                }
                if (line.isEmpty()) continue;
                if (line.length() > MAX_LINE) {
                    handler.protocolError("host message too long");
                    return;
                }
                Object parsed;
                try {
                    parsed = Json.parse(line);
                } catch (Json.JsonException e) {
                    handler.protocolError("invalid JSON from host: " + e.getMessage());
                    return;
                }
                if (!(parsed instanceof Map)) {
                    handler.protocolError("host message is not a JSON object");
                    return;
                }
                @SuppressWarnings("unchecked")
                Map<String, Object> body = (Map<String, Object>) parsed;
                Object type = body.get("type");
                if ("shutdown".equals(type)) {
                    handler.shutdown();
                    return;
                }
                if ("run".equals(type) || "tickReply".equals(type)) {
                    queue.add(new Message((String) type, body));
                } else {
                    handler.protocolError("unknown host message type: " + type);
                    return;
                }
            }
        } catch (IOException e) {
            handler.endOfInput();
        }
    }
}
