package org.sandbot.runtime;

import org.sandbot.sim.SimThreadError;
import org.sandbot.testing.Check;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/** 가상 시계: 틱 경계 교환 순서, 끼어들기 의미, 경계 안의 재진입, 다른 스레드 확인(spec §2.4·§2.5·§R-6) */
public final class VirtualClockTest {
    private VirtualClockTest() {}

    private static final long TICK = 5_000_000L;

    private static final class Recorder implements VirtualClock.Boundary {
        final List<Long> ticks = new ArrayList<>();
        final List<Long> times = new ArrayList<>();
        VirtualClock clock;
        VirtualClock.Boundary extra;

        @Override
        public void onTick(long tick) {
            ticks.add(tick);
            times.add(clock.peekNanos());
            if (extra != null) extra.onTick(tick);
        }
    }

    private static Recorder recorder;
    private static List<String> violations;

    private static VirtualClock clock() {
        recorder = new Recorder();
        violations = new ArrayList<>();
        VirtualClock clock = new VirtualClock(TICK, 1_000L, (t, m, s) -> violations.add(t.getName()));
        recorder.clock = clock;
        clock.setOwner(Thread.currentThread());
        clock.setBoundary(recorder);
        return clock;
    }

    public static void testTickZeroOnlyAfterBegin() {
        VirtualClock c = clock();
        c.charge(12 * TICK);
        Check.equal(Arrays.asList(), recorder.ticks, "no boundaries before beginTicks");
        c = clock();
        c.beginTicks();
        Check.equal(Arrays.asList(0L), recorder.ticks, "tick 0 at begin");
        Check.equal(0L, c.peekNanos(), "time 0");
    }

    public static void testChargeCrossingSeveralBoundaries() {
        VirtualClock c = clock();
        c.beginTicks();
        c.charge(TICK - 1);
        Check.equal(Arrays.asList(0L), recorder.ticks, "not yet at boundary 1");
        c.charge(1);
        Check.equal(Arrays.asList(0L, 1L), recorder.ticks, "exactly at boundary 1");
        c.charge(3 * TICK + 7);
        Check.equal(Arrays.asList(0L, 1L, 2L, 3L, 4L), recorder.ticks, "each crossed boundary in order");
        Check.equal(4 * TICK + 7, c.peekNanos(), "time");
        Check.throwsType(IllegalArgumentException.class, () -> c.charge(-1), "negative charge");
    }

    public static void testChargeInsideBoundaryDoesNotRecurse() {
        VirtualClock c = clock();
        recorder.extra = k -> {
            if (k == 1) {
                Check.isTrue(c.inBoundary(), "in boundary");
                c.charge(2 * TICK); // 경계 일 안의 비용: 시간만 더한다
                Check.equal(Arrays.asList(1L), recorder.ticks.subList(1, recorder.ticks.size()), "no nested boundary");
            }
        };
        c.beginTicks();
        c.charge(TICK);
        Check.equal(Arrays.asList(0L, 1L, 2L, 3L), recorder.ticks, "boundaries crossed by boundary work follow");
        Check.equal(3 * TICK, c.peekNanos(), "time includes boundary work");
    }

    public static void testSleepAndAwaitNextTick() throws InterruptedException {
        VirtualClock c = clock();
        c.beginTicks();
        c.charge(1_000);
        c.sleep(2 * TICK);
        Check.equal(2 * TICK + 1_000, c.peekNanos(), "sleep end");
        Check.equal(Arrays.asList(0L, 1L, 2L), recorder.ticks, "boundaries while sleeping");
        Check.equal(Arrays.asList(0L, TICK, 2 * TICK), recorder.times, "boundary times");
        c.awaitNextTick();
        Check.equal(3 * TICK, c.peekNanos(), "next boundary");
        c.awaitNextTick();
        Check.equal(4 * TICK, c.peekNanos(), "at a boundary, the following one");
        c.sleep(0);
        c.sleep(-5);
        Check.equal(4 * TICK, c.peekNanos(), "sleep(0) takes no time");
    }

    public static void testInterruptSemantics() throws InterruptedException {
        VirtualClock c = clock();
        c.beginTicks();
        Thread.currentThread().interrupt();
        Check.throwsType(InterruptedException.class, () -> c.sleep(10 * TICK), "interrupted before sleep");
        Check.isTrue(!Thread.currentThread().isInterrupted(), "flag cleared");
        Check.equal(0L, c.peekNanos(), "no time passed");
        Thread.currentThread().interrupt();
        Check.throwsType(InterruptedException.class, () -> c.sleep(0), "sleep(0) checks the flag");
        // 경계의 일이 끼어들면 그 경계에서 깬다(STOP → LinearOpMode)
        recorder.extra = k -> {
            if (k == 2) Thread.currentThread().interrupt();
        };
        Check.throwsType(InterruptedException.class, () -> c.sleep(10 * TICK), "interrupted at boundary 2");
        Check.equal(2 * TICK, c.peekNanos(), "woke at boundary 2");
        Check.isTrue(!Thread.currentThread().isInterrupted(), "flag cleared");
        // charge는 끼어들기를 보지 않는다
        Thread.currentThread().interrupt();
        c.charge(TICK);
        Check.isTrue(Thread.interrupted(), "charge keeps the flag");
        Thread.currentThread().interrupt();
        Check.throwsType(InterruptedException.class, c::awaitNextTick, "awaitNextTick checks the flag");
    }

    public static void testCurrentTimeMillis() {
        VirtualClock c = clock();
        c.beginTicks();
        Check.equal(1_000L, c.currentTimeMillis(), "start epoch");
        c.charge(1_999_999);
        Check.equal(1_001L, c.currentTimeMillis(), "floor of virtual millis");
        c.charge(1);
        Check.equal(1_002L, c.currentTimeMillis(), "next milli");
    }

    public static void testOtherThreadIsStopped() throws Exception {
        VirtualClock c = clock();
        c.beginTicks();
        AtomicReference<Throwable> thrown = new AtomicReference<>();
        Thread other = new Thread(() -> {
            try {
                c.sleep(TICK);
            } catch (Throwable t) {
                thrown.set(t);
            }
        }, "Helper");
        other.start();
        other.join();
        Check.isTrue(thrown.get() instanceof SimThreadError, "foreign thread gets SimThreadError: " + thrown.get());
        Check.isTrue(((SimThreadError) thrown.get()).reported(), "already reported");
        Check.equal(Arrays.asList("Helper"), violations, "reported once with the thread name");
        Check.isTrue(c.fatalMessage() != null, "the run must stop");
        // 주인 스레드도 다음 시계 호출에서 멈춘다
        SimThreadError e = Check.throwsType(SimThreadError.class, c::nanoTime, "owner stops at next clock call");
        Check.isTrue(e.reported(), "no second report");
        Thread second = new Thread(() -> {
            try {
                c.charge(1);
            } catch (Throwable t) {
                thrown.set(t);
            }
        }, "Helper2");
        second.start();
        second.join();
        Check.equal(Arrays.asList("Helper"), violations, "only the first violation is reported");
        // 끝내는 중에는 주인 스레드가 시계를 쓸 수 있다(afterStop)
        c.setFinishing();
        c.charge(1);
    }

    public static void testWaitingHostAndActivity() {
        VirtualClock c = clock();
        long before = c.activity();
        c.nanoTime();
        c.charge(1);
        Check.isTrue(c.activity() >= before + 2, "clock calls count as activity");
        c.setWaitingHost(true);
        Check.isTrue(c.waitingHost(), "waiting host");
        c.setWaitingHost(false);
    }

    public static void testEndTicksMovesToNextBoundary() {
        VirtualClock c = clock();
        c.beginTicks();
        c.charge(TICK + 3);
        long k = c.endTicks();
        Check.equal(2L, k, "final tick number");
        Check.equal(2 * TICK, c.peekNanos(), "time moved to the boundary");
        c.charge(10 * TICK);
        Check.equal(Arrays.asList(0L, 1L), recorder.ticks, "no exchanges after endTicks");
    }
}
