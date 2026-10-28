package org.sandbot.runtime;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.SandbotOpModeBridge;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.robocol.TelemetryMessage;

import org.firstinspires.ftc.robotcore.internal.opmode.OpModeServices;
import org.sandbot.sdk.core.SandbotGamepads;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimDevice;
import org.sandbot.sim.SimExit;
import org.sandbot.sim.SimHost;
import org.sandbot.sim.SimThreadError;
import org.sandbot.sim.SimUnsupportedException;
import org.sandbot.sim.TelemetryFrame;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * OpMode 하나를 실행한다(spec §2.4). 실제 SDK의 OpModeManagerImpl(이벤트 루프 스레드)과 OpModeInternal(executor)이 하던 일을
 * OpMode 스레드 하나에서 한다:
 *
 * <ol>
 *   <li>구성 읽기(SandbotHardware.create) → OpMode 클래스 확인 → {@code state init} → tick 0 교환
 *   <li>OpMode 만들기(정적 초기화·생성자도 이 스레드) → beforeInit → resetRuntime → internalInit → OpMode 본문
 *       (init/init_loop/start/loop/stop 또는 runOpMode)
 *   <li>틱 경계마다({@link #onTick}, 시계 호출 안): tick 보내기 → tickReply 받기 → 센서 입력 → DS 사건(start·stop) →
 *       게임패드 → 이벤트 루프 한 바퀴(LinearOpMode의 time·waitForStart·텔레메트리) → STOP 뒤 정지 대기 감시
 *   <li>끝: error(있으면) → state stopping → afterStop → 마지막 tick(답을 기다리지 않음) → finished → halt
 * </ol>
 */
final class OpModeRunner implements VirtualClock.Boundary, SimHost, OpModeServices {
    /** 실제 OpModeInternal.MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED(가상 시간) */
    static final long STUCK_IN_STOP_NANOS = OpMode.MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED * 1_000_000L;

    private final Main.Session session;
    private final Protocol protocol;
    private final VirtualClock clock;
    private final HostInput input;
    private final RunRequest request;
    private final ClassLoader loader;
    private final Map<String, String> sources;
    private final HardwareHooks hooks;

    // OpMode 스레드만 쓴다
    private String phase = "init";
    private boolean ticksStarted;
    private HardwareMap hardwareMap;
    private OpMode opMode;
    private boolean opModeReady;
    private boolean userCodeRunning;
    private final Gamepad gamepad1 = new Gamepad();
    private final Gamepad gamepad2 = new Gamepad();
    private Object lastState1;
    private Object lastState2;
    private boolean gamepadsDelivered;
    private Gamepad latest1 = new Gamepad();
    private Gamepad latest2 = new Gamepad();
    private final List<String> pendingEvents = new ArrayList<>();
    private boolean stopApplied;
    private boolean dsStop;
    private long stopTimeNanos;

    private volatile long loops;
    /** requestOpModeStop(어느 스레드든) */
    private volatile boolean stopRequestedByOpMode;

    OpModeRunner(Main.Session session, VirtualClock clock, HostInput input, RunRequest request, ClassLoader loader,
            Map<String, String> sources, HardwareHooks hooks) {
        this.session = session;
        this.protocol = session.protocol;
        this.clock = clock;
        this.input = input;
        this.request = request;
        this.loader = loader;
        this.sources = sources;
        this.hooks = hooks;
    }

    // ---- OpMode 스레드 ----

    void run() {
        try {
            runInner();
        } catch (Throwable t) {
            // 런타임 자체의 잘못(여기까지 오면 안 된다)
            internalError("sidecar runtime failure: " + StackFrames.describe(t), t);
            finish("exception");
        } finally {
            // finish는 돌아오지 않는다. 그래도 여기 오면(끝내기 중 오류) JVM이 남지 않게
            Main.halt();
        }
    }

    private void runInner() {
        // 1. 로봇 구성
        try {
            hardwareMap = hooks.create(request.configXml);
        } catch (HardwareHooks.ConfigFailure e) {
            protocol.error(clock.peekNanos(), "config", e.getMessage(),
                    e.cause == null ? null : e.cause.getClass().getName(),
                    e.cause == null ? new ArrayList<>() : StackFrames.of(e.cause.getStackTrace(), sources, false),
                    Thread.currentThread().getName());
            finish("loadFailed");
            return;
        }
        if (!hooks.available() && request.configXml != null) {
            log("robotLog", "W/SandBot: device support (" + HardwareHooks.CLASS_NAME
                    + ") is not in this build; the OpMode runs with an empty hardwareMap");
        }

        // 2. OpMode 클래스(아직 초기화하지 않는다)
        Constructor<?> constructor = loadOpModeClass();
        if (constructor == null) {
            finish("loadFailed");
            return;
        }

        // 3. INIT: state → tick 0
        protocol.state(clock.peekNanos(), phase);
        ticksStarted = true;
        clock.beginTicks();

        // 4. OpMode 만들기(정적 초기화·생성자는 팀 코드)
        OpMode created;
        try {
            created = (OpMode) constructor.newInstance();
        } catch (InvocationTargetException e) {
            endOpMode(e.getCause() == null ? e : e.getCause());
            return;
        } catch (ExceptionInInitializerError e) {
            endOpMode(e.getCause() == null ? e : e.getCause());
            return;
        } catch (ReflectiveOperationException e) {
            protocol.error(clock.peekNanos(), "load", "Could not create the OpMode " + request.opModeClass + ": "
                    + StackFrames.describe(e), e.getClass().getName(), new ArrayList<>(), Thread.currentThread().getName());
            endPhase();
            finish("loadFailed");
            return;
        } catch (Throwable t) {
            endOpMode(t);
            return;
        }
        opMode = created;

        // 5. INIT(OpModeManagerImpl.runActiveOpMode의 callToInitNeeded)
        SandbotOpModeBridge.attach(opMode, gamepad1, gamepad2, hardwareMap, this);
        try {
            hooks.beforeInit(hardwareMap);
        } catch (Throwable t) {
            if (t instanceof SimExit || t instanceof SimThreadError) {
                endOpMode(t);
            } else {
                internalError("preparing the hardware for INIT failed: " + StackFrames.describe(t), t);
                endPhase();
                finish("exception");
            }
            return;
        }
        Throwable thrown = null;
        try {
            opMode.resetRuntime();
            SandbotOpModeBridge.init(opMode);
            opModeReady = true;
            userCodeRunning = true;
            SandbotOpModeBridge.runOpModeOnThisThread(opMode);
        } catch (Throwable t) {
            thrown = t;
        }
        userCodeRunning = false;
        if (thrown == null) thrown = SandbotOpModeBridge.exception(opMode);
        endOpMode(thrown);
    }

    /** OpMode 클래스를 찾아 확인한다. 안 되면 error load를 보내고 null. */
    private Constructor<?> loadOpModeClass() {
        String name = request.opModeClass;
        Class<?> type;
        try {
            type = Class.forName(name, false, loader);
        } catch (ClassNotFoundException e) {
            loadError("The OpMode class " + name + " was not found in the compiled TeamCode", e);
            return null;
        } catch (LinkageError e) {
            loadError("The OpMode class " + name + " could not be loaded: " + StackFrames.describe(e), e);
            return null;
        }
        if (!OpMode.class.isAssignableFrom(type)) {
            loadError(name + " is not an OpMode (it must extend OpMode or LinearOpMode)", null);
            return null;
        }
        int modifiers = type.getModifiers();
        if (Modifier.isAbstract(modifiers) || type.isInterface()) {
            loadError(name + " is abstract and cannot be run", null);
            return null;
        }
        if (!Modifier.isPublic(modifiers)) {
            loadError(name + " must be public to be run as an OpMode", null);
            return null;
        }
        if (type.getEnclosingClass() != null && !Modifier.isStatic(modifiers)) {
            loadError(name + " is an inner (non-static) class; OpModes must be top-level or static nested classes", null);
            return null;
        }
        try {
            return type.getConstructor();
        } catch (NoSuchMethodException e) {
            loadError(name + " has no public constructor without arguments", null);
            return null;
        } catch (LinkageError e) {
            loadError("The OpMode class " + name + " could not be loaded: " + StackFrames.describe(e), e);
            return null;
        }
    }

    private void loadError(String message, Throwable cause) {
        protocol.error(clock.peekNanos(), "load", message, cause == null ? null : cause.getClass().getName(),
                new ArrayList<>(), Thread.currentThread().getName());
    }

    /** OpMode 본문이 끝났다(정상이면 thrown은 null) */
    private void endOpMode(Throwable thrown) {
        clock.setFinishing();
        userCodeRunning = false;
        String reason;
        if (thrown == null) {
            reason = dsStop ? "stopped" : "returned";
        } else if (thrown instanceof SimExit || SandbotOpModeBridge.isForceStop(thrown)) {
            reason = "terminated";
        } else if (thrown instanceof SimThreadError) {
            if (!((SimThreadError) thrown).reported()) reportThrowable("thread", thrown);
            reason = "exception";
        } else {
            reportThrowable(isUnsupported(thrown) ? "unsupported" : "exception", thrown);
            reason = "exception";
        }
        // 실제 SDK는 OpMode가 끝나면 정지 처리를 한다(requestOpModeStop → stopActiveOpMode → internalStop).
        // LinearOpMode가 waitForStart 없이 끝났을 때의 경고도 여기서 나온다.
        if (opMode != null && opModeReady && !stopApplied) applyStop(false);
        endPhase();
        // 정지 처리의 끼어들기가 장치 정리(afterStop)에 남지 않게
        Thread.interrupted();
        finish(reason);
    }

    private static boolean isUnsupported(Throwable t) {
        for (int i = 0; t != null && i < 10; i++, t = t.getCause()) {
            if (t instanceof SimUnsupportedException) return true;
        }
        return false;
    }

    private void reportThrowable(String kind, Throwable t) {
        // SimUnsupportedException이 원인 사슬 안에 있으면 그 문장을 앞에 둔다
        Throwable shown = t;
        if (kind.equals("unsupported")) {
            for (Throwable c = t; c != null; c = c.getCause()) {
                if (c instanceof SimUnsupportedException) {
                    shown = c;
                    break;
                }
            }
        }
        String message = shown == t ? StackFrames.describe(t) : shown.getMessage();
        protocol.error(clock.peekNanos(), kind, message, shown.getClass().getName(),
                StackFrames.of(shown.getStackTrace(), sources, kind.equals("thread")), Thread.currentThread().getName());
    }

    private void internalError(String message, Throwable t) {
        protocol.error(clock.peekNanos(), "internal", message, t == null ? null : t.getClass().getName(),
                t == null ? new ArrayList<>() : StackFrames.of(t.getStackTrace(), sources, false),
                Thread.currentThread().getName());
    }

    private void endPhase() {
        if (ticksStarted) setPhase("stopping");
    }

    private void setPhase(String next) {
        if (next.equals(phase)) return;
        phase = next;
        protocol.state(clock.peekNanos(), next);
    }

    /** STOP 처리(DS STOP 또는 requestOpModeStop) */
    private void applyStop(boolean fromDs) {
        if (stopApplied) return;
        stopApplied = true;
        dsStop = fromDs;
        stopTimeNanos = clock.peekNanos();
        setPhase("stopping");
        if (opMode != null && opModeReady) {
            // 실제 OpModeManagerImpl.callActiveOpModeStop처럼 OpMode에 알리기 전에 허브를 fail safe로(위험한 명령은 끝날 때까지 막힌다)
            if (hardwareMap != null) {
                try {
                    hooks.stopRequested(hardwareMap);
                } catch (Throwable t) {
                    internalError("stopping the hardware failed: " + StackFrames.describe(t), t);
                }
            }
            SandbotOpModeBridge.stop(opMode);
        }
    }

    /**
     * 끝내기: afterStop → 출력 남은 것 → 마지막 tick(답을 기다리지 않음) → finished → halt. OpMode 스레드에서. 돌아오지 않는다.
     */
    void finish(String reason) {
        if (!session.beginFinish()) Main.parkForever();
        clock.setFinishing();
        if (hardwareMap != null) {
            try {
                hooks.afterStop(hardwareMap);
            } catch (Throwable t) {
                internalError("stopping the hardware failed: " + StackFrames.describe(t), t);
            }
        }
        session.flushOutput();
        long tNanos = clock.peekNanos();
        if (ticksStarted) {
            long k = clock.endTicks();
            tNanos = clock.peekNanos();
            protocol.tick(k, tNanos, phase, loops, outputs());
        }
        protocol.finished(tNanos, reason);
        Main.halt();
    }

    // ---- 틱 경계(OpMode 스레드, 시계 호출 안) ----

    @Override
    public void onTick(long k) {
        long tNanos = k * clock.tickNanos();
        protocol.tick(k, tNanos, phase, loops, outputs());
        clock.setWaitingHost(true);
        HostInput.Message reply = input.take();
        clock.setWaitingHost(false);
        if (!"tickReply".equals(reply.type)) {
            session.protocolError("expected tickReply for tick " + k + " but got " + reply.type);
            Main.parkForever();
        }
        Object replyTick = reply.body.get("tick");
        if (!(replyTick instanceof Long) || (Long) replyTick != k) {
            session.protocolError("expected tickReply for tick " + k + " but got tick " + replyTick);
            Main.parkForever();
        }
        applyInputs(reply.body.get("inputs"));
        Object events = reply.body.get("events");
        if (events instanceof List) {
            for (Object e : (List<?>) events) {
                if (!"start".equals(e) && !"stop".equals(e)) {
                    session.protocolError("unknown DS event " + Json.write(e));
                    Main.parkForever();
                }
                pendingEvents.add((String) e);
            }
        }
        Object gamepads = reply.body.get("gamepads");
        Object state1 = null;
        Object state2 = null;
        if (gamepads instanceof List && ((List<?>) gamepads).size() == 2) {
            state1 = ((List<?>) gamepads).get(0);
            state2 = ((List<?>) gamepads).get(1);
        }
        boolean gamepadsChanged = !Objects.equals(state1, lastState1) || !Objects.equals(state2, lastState2);
        if (gamepadsChanged) {
            long uptimeMillis = clock.peekNanos() / 1_000_000L;
            latest1 = SandbotGamepads.fromState(asMap(state1), 1, uptimeMillis);
            latest2 = SandbotGamepads.fromState(asMap(state2), 2, uptimeMillis);
            lastState1 = state1;
            lastState2 = state2;
        }
        if (!opModeReady || !userCodeRunning) return;

        // DS 사건(OpModeManagerImpl: startActiveOpMode → callActiveOpModeStart, stopActiveOpMode → callActiveOpModeStop)
        for (String e : pendingEvents) {
            if (e.equals("start")) {
                if (!stopApplied && phase.equals("init")) {
                    setPhase("running");
                    SandbotOpModeBridge.start(opMode);
                }
            } else {
                applyStop(true);
            }
        }
        pendingEvents.clear();
        if (stopRequestedByOpMode) applyStop(false);

        // 게임패드(runActiveOpMode: 새 자료가 오면 newGamepadDataAvailable). INIT 뒤 첫 경계에서 지금 상태를 한 번 넘긴다.
        if (gamepadsChanged || !gamepadsDelivered) {
            gamepadsDelivered = true;
            SandbotOpModeBridge.newGamepadData(opMode, latest1, latest2);
        }

        // 이벤트 루프 한 바퀴(checkOnActiveOpMode → internalOnEventLoopIteration)
        SandbotOpModeBridge.eventLoopIteration(opMode);

        // STOP 뒤 정지 대기 감시(OpModeStuckCodeMonitor, 가상 시간)
        if (stopApplied && userCodeRunning && clock.peekNanos() - stopTimeNanos > STUCK_IN_STOP_NANOS) stuckInStop();
    }

    private void stuckInStop() {
        userCodeRunning = false;
        protocol.error(clock.peekNanos(), "stuckInStop",
                "The OpMode did not stop within " + OpMode.MS_BEFORE_FORCE_STOP_AFTER_STOP_REQUESTED
                        + " ms (virtual time) after STOP was requested",
                null, StackFrames.of(Thread.currentThread().getStackTrace(), sources, true),
                Thread.currentThread().getName());
        finish("stuck");
    }

    private void applyInputs(Object inputs) {
        if (!(inputs instanceof Map)) return;
        for (Map.Entry<?, ?> e : ((Map<?, ?>) inputs).entrySet()) {
            SimDevice device = Sim.devices().get((String) e.getKey());
            if (device == null || !(e.getValue() instanceof Map)) continue;
            Map<String, Object> values = new LinkedHashMap<>();
            for (Map.Entry<?, ?> v : ((Map<?, ?>) e.getValue()).entrySet()) {
                Object value = v.getValue();
                if (value == null || value instanceof Number || value instanceof Boolean || value instanceof String)
                    values.put((String) v.getKey(), value);
            }
            device.applyInputs(values);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, ?> asMap(Object state) {
        return state instanceof Map ? (Map<String, ?>) state : null;
    }

    private Map<String, Object> outputs() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (SimDevice device : Sim.devices().all()) out.put(device.name(), new LinkedHashMap<>(device.outputs()));
        return out;
    }

    // ---- SimHost ----

    @Override
    public void telemetry(TelemetryFrame frame) {
        protocol.telemetry(clock.peekNanos(), frame.lines, frame.log, frame.format);
    }

    @Override
    public void log(String stream, String text) {
        protocol.log(clock.peekNanos(), stream, text);
    }

    @Override
    public void loopMarker() {
        loops++;
    }

    // ---- OpModeServices ----

    @Override
    public void refreshUserTelemetry(TelemetryMessage telemetry, double sInterval) {
        throw new SimUnsupportedException(
                "com.qualcomm.robotcore.eventloop.opmode.OpMode#internalUpdateTelemetryNow(com.qualcomm.robotcore.robocol.TelemetryMessage)");
    }

    @Override
    public void requestOpModeStop(OpMode opModeToStopIfActive) {
        if (opModeToStopIfActive != null && opModeToStopIfActive == opMode) stopRequestedByOpMode = true;
    }

    // ---- 다른 스레드에서 알림 ----

    /** 다른 스레드가 시계를 썼다(VirtualClock.Violation) */
    void reportForeignThread(Thread thread, String message, StackTraceElement[] stack) {
        protocol.error(clock.peekNanos(), "thread", message + threadHint(thread.getName(), stack),
                SimThreadError.class.getName(), StackFrames.of(stack, sources, true), thread.getName());
    }

    /** FTCLib의 낡은 command.old.CommandOpMode는 스레드 풀(Executors)에서 명령을 돌린다: 지금 것을 쓰라고 덧붙인다 */
    static String threadHint(String threadName, StackTraceElement[] stack) {
        if (!threadName.startsWith("pool-")) return "";
        for (StackTraceElement e : stack) {
            if (e.getClassName().startsWith("com.arcrobotics.ftclib.command.old.")) {
                return ". The deprecated FTCLib com.arcrobotics.ftclib.command.old.CommandOpMode runs commands on a "
                        + "thread pool; use com.arcrobotics.ftclib.command.CommandOpMode (CommandScheduler) instead";
            }
        }
        return "";
    }

    /** 감시: OpMode 스레드가 stallMillis 동안 시계를 쓰지 않았다 */
    void reportStall(Thread thread, long stallMillis) {
        protocol.error(clock.peekNanos(), "stall",
                "The OpMode thread has not used the simulator clock or hardware for " + stallMillis
                        + " ms of real time (an infinite loop that never calls the SDK?)",
                null, StackFrames.of(thread.getStackTrace(), sources, false), thread.getName());
    }

    String phase() {
        return phase;
    }
}
