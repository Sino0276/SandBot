package org.sandbot.runtime;

/**
 * 실제 시간 감시(spec §R-7). 250 ms마다 OpMode 스레드를 본다:
 * <ul>
 *   <li>호스트 답을 기다리지 않는데 stallMillis(실제 밀리초) 동안 가상 시계 호출이 없으면 error stall(그 스레드의 스택)을 한 번
 *       보낸다. 다시 시계를 쓰면 초기화(다시 멈추면 또 알린다). 호스트를 기다리는 동안(일시 정지)은 세지 않는다.
 *   <li>다른 스레드가 시계를 써서 OpMode를 멈추라고 했는데(VirtualClock.fatalMessage) OpMode 스레드가 2초(실제) 안에 끝나지 않으면
 *       (시계를 다시 부르지 않는 대기 등) 런타임이 finished exception으로 끝낸다.
 * </ul>
 * 벽시계는 여기서만 쓴다(팀 코드·프로토콜의 시간에는 들어가지 않는다).
 */
final class Watchdog extends Thread {
    static final long PERIOD_MILLIS = 250;
    static final long FATAL_GRACE_NANOS = 2_000_000_000L;

    private final VirtualClock clock;
    private final OpModeRunner runner;
    private final Main.Session session;
    private final long stallNanos;
    private final long stallMillis;

    Watchdog(VirtualClock clock, OpModeRunner runner, Main.Session session, long stallMillis) {
        super("SandBotWatchdog");
        setDaemon(true);
        this.clock = clock;
        this.runner = runner;
        this.session = session;
        this.stallMillis = stallMillis;
        this.stallNanos = stallMillis * 1_000_000L;
    }

    @Override
    public void run() {
        long lastActivity = -1;
        long lastChange = System.nanoTime();
        boolean reported = false;
        for (;;) {
            try {
                Thread.sleep(PERIOD_MILLIS);
            } catch (InterruptedException e) {
                return;
            }
            Thread thread = clock.owner();
            if (thread == null || !thread.isAlive()) continue;
            long now = System.nanoTime();
            long fatalAt = clock.fatalAtRealNanos();
            if (clock.fatalMessage() != null && now - fatalAt > FATAL_GRACE_NANOS) {
                session.forceFinish("exception");
                return;
            }
            long activity = clock.activity();
            if (clock.waitingHost() || activity != lastActivity) {
                lastActivity = activity;
                lastChange = now;
                reported = false;
                continue;
            }
            if (!reported && now - lastChange >= stallNanos) {
                reported = true;
                runner.reportStall(thread, stallMillis);
            }
        }
    }
}
