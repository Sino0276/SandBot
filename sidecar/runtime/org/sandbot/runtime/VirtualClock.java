package org.sandbot.runtime;

import org.sandbot.sim.SimClock;
import org.sandbot.sim.SimThreadError;

/**
 * 가상 시계(SimClock 구현, spec §2.4·§2.5). 팀 코드가 보는 시간은 이 시계가 정한다: 하드웨어 비용 청구(charge)·sleep·
 * 시계 읽기 비용만큼 흐르고, 벽시계와 관계없다. 그래서 같은 입력이면 결과가 같다.
 *
 * <p>틱 경계: 가상 시간이 k × tickNanos를 처음 지날 때 경계 k의 일({@link Boundary#onTick})을 OpMode 스레드가 그 시계 호출 안에서
 * 한다(호스트와 틱 교환 → DS 사건 → 게임패드 → 이벤트 루프 한 바퀴). 한 번의 charge가 여러 경계를 넘으면 경계마다 차례로 한다.
 * 경계의 일 안에서 시계를 다시 부르면(텔레메트리의 ElapsedTime 등) 시간만 더하고 경계를 다시 처리하지 않는다(그 일이 끝난 뒤
 * 넘은 경계를 이어서 처리한다). tick 0은 런타임이 {@link #beginTicks}로 연다.
 *
 * <p>끼어들기(interrupt): sleep·awaitNextTick은 들어올 때 끼어들기가 있으면 바로, 기다리는 중이면 경계의 일(STOP이 LinearOpMode
 * 스레드에 끼어든다)이 끝난 그 경계에서 플래그를 지우고 InterruptedException을 던진다. charge는 끼어들기를 보지 않는다.
 *
 * <p>스레드: 1단계는 OpMode 스레드 하나만 쓸 수 있다. 다른 스레드가 쓰면 처음 한 번 {@link Violation#report}로 알리고 그 스레드에
 * SimThreadError를 던진다. 그 뒤 OpMode 스레드도 다음 시계 호출에서 SimThreadError(이미 알림)를 받아 끝난다.
 */
final class VirtualClock implements SimClock {
    /** 틱 경계의 일. OpMode 스레드가 시계 호출 안에서 부른다. */
    interface Boundary {
        void onTick(long tick);
    }

    /** 다른 스레드가 시계를 썼다(처음 한 번). stack은 그 스레드의 호출 위치. */
    interface Violation {
        void report(Thread thread, String message, StackTraceElement[] stack);
    }

    private final long tickNanos;
    private final long startEpochMillis;
    private final Violation violation;
    private Boundary boundary;

    /** 실행 시작부터의 가상 나노초. 다른 스레드(로그·감시)는 {@link #peekNanos}로만 읽는다. */
    private volatile long now;
    /** 다음에 처리할 경계 번호 */
    private long nextTick;
    private boolean ticking;
    private boolean inBoundary;
    private volatile Thread owner;

    // 감시(Watchdog)용
    private volatile long activity;
    private volatile boolean waitingHost;

    // 다른 스레드가 시계를 썼다(처음 한 번 정함)
    private boolean violationClaimed;
    private volatile String fatalMessage;
    private volatile long fatalAtRealNanos;
    /** 런타임이 끝내는 중: OpMode 스레드에서도 fatal을 다시 던지지 않는다(afterStop 등) */
    private volatile boolean finishing;

    VirtualClock(long tickNanos, long startEpochMillis, Violation violation) {
        if (tickNanos <= 0) throw new IllegalArgumentException("tickNanos must be positive");
        this.tickNanos = tickNanos;
        this.startEpochMillis = startEpochMillis;
        this.violation = violation;
    }

    void setOwner(Thread thread) {
        this.owner = thread;
    }

    Thread owner() {
        return owner;
    }

    void setBoundary(Boundary boundary) {
        this.boundary = boundary;
    }

    /** tick 0을 교환하고 경계 처리를 시작한다(OpMode 스레드에서) */
    void beginTicks() {
        check();
        ticking = true;
        process();
    }

    /** 경계 처리를 멈춘다(끝낼 때). 마지막 tick 번호(다음 경계)를 돌려주고 그 시각으로 옮긴다. */
    long endTicks() {
        ticking = false;
        long k = nextTick;
        long t = k * tickNanos;
        if (now < t) now = t;
        return k;
    }

    void setFinishing() {
        finishing = true;
    }

    long peekNanos() {
        return now;
    }

    long nextTick() {
        return nextTick;
    }

    long activity() {
        return activity;
    }

    boolean waitingHost() {
        return waitingHost;
    }

    void setWaitingHost(boolean waiting) {
        waitingHost = waiting;
    }

    String fatalMessage() {
        return fatalMessage;
    }

    long fatalAtRealNanos() {
        return fatalAtRealNanos;
    }

    boolean inBoundary() {
        return inBoundary;
    }

    // ---- SimClock ----

    @Override
    public long nanoTime() {
        check();
        return now;
    }

    @Override
    public long currentTimeMillis() {
        check();
        return startEpochMillis + now / 1_000_000L;
    }

    @Override
    public void charge(long nanos) {
        check();
        if (nanos < 0) throw new IllegalArgumentException("negative charge: " + nanos);
        now = saturatingAdd(now, nanos);
        process();
    }

    @Override
    public void sleep(long nanos) throws InterruptedException {
        check();
        if (Thread.interrupted()) throw new InterruptedException("sleep interrupted");
        if (nanos <= 0) return;
        advanceTo(saturatingAdd(now, nanos));
    }

    @Override
    public void awaitNextTick() throws InterruptedException {
        check();
        if (Thread.interrupted()) throw new InterruptedException("sleep interrupted");
        if (!ticking || inBoundary) return;
        advanceTo(nextTick * tickNanos);
    }

    @Override
    public long tickNanos() {
        return tickNanos;
    }

    // ---- 내부 ----

    private void advanceTo(long target) throws InterruptedException {
        if (inBoundary || !ticking) {
            // 경계의 일 안(또는 틱 전)에서는 기다리지 않는다: 시간만 보낸다
            if (target > now) now = target;
            return;
        }
        for (;;) {
            long b = nextTick * tickNanos;
            if (b > target) break;
            if (now < b) now = b;
            process();
            if (Thread.interrupted()) throw new InterruptedException("sleep interrupted");
            if (!ticking) break;
        }
        if (now < target) now = target;
    }

    private void process() {
        if (inBoundary || !ticking) return;
        while (ticking && now >= nextTick * tickNanos) {
            long k = nextTick++;
            inBoundary = true;
            try {
                boundary.onTick(k);
            } finally {
                inBoundary = false;
            }
        }
    }

    private void check() {
        Thread t = Thread.currentThread();
        if (t != owner) foreign(t);
        activity++;
        String fatal = fatalMessage;
        if (fatal != null && !finishing) throw new SimThreadError(fatal, true);
    }

    private void foreign(Thread t) {
        String message = "Thread \"" + t.getName() + "\" used the simulator clock or hardware, but only the OpMode "
                + "thread may do so in this version of SandBot (other threads are not supported yet)";
        boolean first = false;
        synchronized (this) {
            if (!violationClaimed) {
                violationClaimed = true;
                first = true;
            }
        }
        if (first) {
            // 알린 뒤에 OpMode 스레드를 멈춘다(먼저 멈추면 finished가 이 error보다 먼저 나갈 수 있다)
            violation.report(t, message, new Throwable().getStackTrace());
            fatalAtRealNanos = System.nanoTime();
            fatalMessage = "The OpMode was stopped because " + message.substring(0, 1).toLowerCase()
                    + message.substring(1);
        }
        throw new SimThreadError(message, true);
    }

    private static long saturatingAdd(long a, long b) {
        long r = a + b;
        return ((a ^ r) & (b ^ r)) < 0 ? Long.MAX_VALUE : r;
    }
}
