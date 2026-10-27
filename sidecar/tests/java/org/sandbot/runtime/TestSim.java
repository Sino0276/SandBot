package org.sandbot.runtime;

import org.sandbot.sim.HubTiming;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimClock;
import org.sandbot.sim.SimHost;
import org.sandbot.sim.TelemetryFrame;

import java.util.ArrayList;
import java.util.List;

/**
 * Java 테스트용 시뮬레이터. Sim.install은 JVM에 한 번뿐이라 위임 시계를 한 번 넣고, 테스트마다 {@link #fresh}로 새 VirtualClock
 * (테스트 스레드가 주인, 틱 경계는 기록만)을 꽂는다. Hub 타이밍은 기본값(시계 읽기 1 µs, 루프 표시 5 µs, 텔레메트리 0.2 ms).
 */
public final class TestSim {
    private TestSim() {}

    public static final long TICK = 5_000_000L;
    public static final long START_EPOCH = 1_700_000_000_000L;

    private static volatile VirtualClock current;
    public static final List<Long> ticks = new ArrayList<>();
    public static final List<TelemetryFrame> frames = new ArrayList<>();
    public static final List<String> logs = new ArrayList<>();
    public static final List<String> violations = new ArrayList<>();
    public static long loops;
    public interface TickHook {
        void onTick(long tick);
    }

    /** 틱 경계마다 부를 일(테스트가 정한다) */
    public static volatile TickHook onTick;

    private static final SimClock DELEGATE = new SimClock() {
        @Override
        public long nanoTime() {
            return current.nanoTime();
        }

        @Override
        public long currentTimeMillis() {
            return current.currentTimeMillis();
        }

        @Override
        public void charge(long nanos) {
            current.charge(nanos);
        }

        @Override
        public void sleep(long nanos) throws InterruptedException {
            current.sleep(nanos);
        }

        @Override
        public void awaitNextTick() throws InterruptedException {
            current.awaitNextTick();
        }

        @Override
        public long tickNanos() {
            return current.tickNanos();
        }
    };

    private static final SimHost HOST = new SimHost() {
        @Override
        public void telemetry(TelemetryFrame frame) {
            frames.add(frame);
        }

        @Override
        public void log(String stream, String text) {
            logs.add(text);
        }

        @Override
        public void loopMarker() {
            loops++;
        }
    };

    /** 지금 시계의 가상 시간(나노초) */
    public static long nanos() {
        return current.peekNanos();
    }

    /** 다른 패키지의 테스트용: 새 시계로 바꾼다 */
    public static void reset() {
        fresh();
    }

    /** 새 가상 시계(지금 스레드가 주인, tick 0 처리됨)와 빈 기록 */
    static synchronized VirtualClock fresh() {
        java.util.Locale.setDefault(java.util.Locale.US);
        VirtualClock clock = new VirtualClock(TICK, START_EPOCH, (thread, message, stack) -> violations.add(thread.getName() + ": " + message));
        clock.setOwner(Thread.currentThread());
        clock.setBoundary(k -> {
            ticks.add(k);
            TickHook extra = onTick;
            if (extra != null) extra.onTick(k);
        });
        current = clock;
        ticks.clear();
        frames.clear();
        logs.clear();
        violations.clear();
        loops = 0;
        onTick = null;
        if (!Sim.installed()) Sim.install(DELEGATE, HubTiming.defaults(), HOST);
        clock.beginTicks();
        return clock;
    }
}
