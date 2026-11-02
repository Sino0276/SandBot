package org.sandbot.runtime;

import org.sandbot.sim.SimExit;
import org.sandbot.sim.SimHost;
import org.sandbot.sim.SimThreadError;
import org.sandbot.sim.TelemetryFrame;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 등록기 OpMode 목록(ListRequest). OpMode 스레드에서 등록기를 모두 부르고(RegistrarRunner, 실행 때와 같은 규칙) registered →
 * finished listed. hardwareMap·틱 교환은 없다: 시계는 틱을 열지 않으므로(beginTicks 없음) sleep은 시간만 보내고 호스트를
 * 기다리지 않는다. 등록기가 멈추면 감시(Watchdog)가 stall을 알리고 끝낸다.
 *
 * <p>목록에 넣는 등록: 호스트가 실행할 수 있는 이름(1–200자, 제어 문자 없음)·group(200자 이하)·transitionTarget(200자 이하)이고
 * 앞의 {@link #MAX_LISTED}개. 나머지는 경고 로그를 남기고 뺀다(호스트 src/main/sidecar/protocol.ts의 한도와 같다).
 */
final class ListRunner implements SimHost, Watchdog.Stall {
    static final int MAX_LISTED = 1000;
    static final int MAX_NAME = 200;
    static final int MAX_CLASS_NAME = 1024;

    private final Main.Session session;
    private final Protocol protocol;
    private final VirtualClock clock;
    private final ListRequest request;
    private final ClassLoader loader;
    private final Map<String, String> sources;

    ListRunner(Main.Session session, VirtualClock clock, ListRequest request, ClassLoader loader,
            Map<String, String> sources) {
        this.session = session;
        this.protocol = session.protocol;
        this.clock = clock;
        this.request = request;
        this.loader = loader;
        this.sources = sources;
    }

    void run() {
        try {
            runInner();
        } catch (Throwable t) {
            protocol.error(clock.peekNanos(), "internal", "sidecar runtime failure: " + StackFrames.describe(t),
                    t.getClass().getName(), StackFrames.of(t.getStackTrace(), sources, false),
                    Thread.currentThread().getName());
            finish("exception");
        } finally {
            Main.halt();
        }
    }

    private void runInner() {
        RegistrarRunner registrars = new RegistrarRunner(clock);
        try {
            registrars.runAll(RunRequest.registrarClasses(request.registrars), loader, this::registrarFailed);
        } catch (SimExit e) {
            finish("terminated");
            return;
        } catch (SimThreadError e) {
            if (!e.reported())
                protocol.error(clock.peekNanos(), "thread", e.getMessage(), SimThreadError.class.getName(),
                        StackFrames.of(e.getStackTrace(), sources, true), Thread.currentThread().getName());
            finish("exception");
            return;
        }
        List<Map<String, Object>> listed = new ArrayList<>();
        for (RegistrarRunner.Registration r : registrars.registrations()) {
            String problem = unlistable(r);
            if (problem != null) {
                log("robotLog", "W/SandBot: the registered OpMode " + RegistrarRunner.quote(r.meta.name)
                        + " is not listed: " + problem);
            } else if (listed.size() >= MAX_LISTED) {
                log("robotLog", "W/SandBot: only the first " + MAX_LISTED + " registered OpModes are listed");
                break;
            } else {
                listed.add(r.toJson());
            }
        }
        protocol.registered(listed);
        finish("listed");
    }

    /** 호스트가 받지 않는 등록이면 이유(영어), 아니면 null */
    static String unlistable(RegistrarRunner.Registration r) {
        String name = r.meta.name;
        if (name.isEmpty() || name.length() > MAX_NAME) return "the name must be 1 to " + MAX_NAME + " characters";
        if (hasControl(name)) return "the name contains control characters";
        if (r.meta.group.length() > MAX_NAME) return "the group is longer than " + MAX_NAME + " characters";
        String target = r.meta.autoTransition;
        if (target != null && target.length() > MAX_NAME)
            return "the transition target is longer than " + MAX_NAME + " characters";
        if (r.className().length() > MAX_CLASS_NAME || r.registrar.length() > MAX_CLASS_NAME)
            return "the class name is too long";
        return null;
    }

    private static boolean hasControl(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c < 0x20 || c == 0x7f) return true;
        }
        return false;
    }

    private void registrarFailed(String registrar, String message, Throwable thrown) {
        protocol.error(clock.peekNanos(), "registrar", message, thrown == null ? null : thrown.getClass().getName(),
                thrown == null ? new ArrayList<>() : StackFrames.of(thrown.getStackTrace(), sources, false),
                Thread.currentThread().getName());
    }

    /** 끝내기(OpMode 스레드). 돌아오지 않는다. */
    private void finish(String reason) {
        if (!session.beginFinish()) Main.parkForever();
        clock.setFinishing();
        session.flushOutput();
        protocol.finished(clock.peekNanos(), reason);
        Main.halt();
    }

    // ---- SimHost ----

    @Override
    public void telemetry(TelemetryFrame frame) {
        // 목록에는 Driver Station 화면이 없다
    }

    @Override
    public void log(String stream, String text) {
        protocol.log(clock.peekNanos(), stream, text);
    }

    @Override
    public void loopMarker() {
        // 루프가 없다
    }

    // ---- 다른 스레드에서 알림 ----

    void reportForeignThread(Thread thread, String message, StackTraceElement[] stack) {
        protocol.error(clock.peekNanos(), "thread", message, SimThreadError.class.getName(),
                StackFrames.of(stack, sources, true), thread.getName());
    }

    @Override
    public void reportStall(Thread thread, long stallMillis) {
        protocol.error(clock.peekNanos(), "stall",
                "An @OpModeRegistrar method has not used the simulator clock for " + stallMillis
                        + " ms of real time (an infinite loop?)",
                null, StackFrames.of(thread.getStackTrace(), sources, false), thread.getName());
    }
}
