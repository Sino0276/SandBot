package org.sandbot.sim;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.concurrent.TimeUnit;

/**
 * 패치한 코드가 부르는 시간 API 대리 함수들. 런타임의 ClassPatcher(org.sandbot.runtime.patch)가 팀 코드와 들여온 SDK 클래스의
 * System.nanoTime·Thread.sleep 같은 호출을 이 클래스의 같은 뜻의 정적 메서드로 바꾼다(대응 표는 ClassPatcher.TARGETS).
 *
 * <p>규칙:
 * <ul>
 *   <li>원래 정적 메서드는 같은 이름·서술자를 쓴다(nanoTime()J 등). 이름이 겹치는 것(now())은 다른 이름을 쓴다.
 *   <li>원래 인스턴스 메서드는 수신 객체를 첫 인수로 받는다(wait(Object, long) 등).
 *   <li>인수 검사·끼어들기(interrupt)의 뜻은 JDK의 원래 메서드와 같다. 다른 것은 시간이 가상이라는 것뿐이다.
 *   <li>시계 읽기는 SimCost.CLOCK_READ를 청구한다(바쁜 대기 루프에서도 가상 시간이 흐르게).
 * </ul>
 * 1단계는 OpMode 스레드 하나만 부를 수 있다(다른 스레드면 SimClock 구현이 SimThreadError를 던진다).
 */
public final class TimeRedirects {
    private TimeRedirects() {}

    private static final long NANOS_PER_MILLI = 1_000_000L;

    // ---- System ----

    public static long nanoTime() {
        Sim.charge(SimCost.CLOCK_READ);
        return Sim.clock().nanoTime();
    }

    public static long currentTimeMillis() {
        Sim.charge(SimCost.CLOCK_READ);
        return Sim.clock().currentTimeMillis();
    }

    /** System.exit(int) */
    public static void exit(int status) {
        throw new SimExit("System.exit", status);
    }

    /** Runtime.exit(int) */
    public static void runtimeExit(Runtime runtime, int status) {
        if (runtime == null) throw new NullPointerException();
        throw new SimExit("Runtime.exit", status);
    }

    /** Runtime.halt(int) */
    public static void runtimeHalt(Runtime runtime, int status) {
        if (runtime == null) throw new NullPointerException();
        throw new SimExit("Runtime.halt", status);
    }

    // ---- Thread.sleep ----

    public static void sleep(long millis) throws InterruptedException {
        if (millis < 0) throw new IllegalArgumentException("timeout value is negative");
        Sim.clock().sleep(millisToNanos(millis));
    }

    public static void sleep(long millis, int nanos) throws InterruptedException {
        if (millis < 0) throw new IllegalArgumentException("timeout value is negative");
        if (nanos < 0 || nanos > 999999) throw new IllegalArgumentException("nanosecond timeout value out of range");
        long total = millisToNanos(millis);
        total += Math.min(Long.MAX_VALUE - total, nanos);
        Sim.clock().sleep(total);
    }

    /** Thread.sleep(Duration)(JDK 19+): 음수면 끼어들기도 보지 않고 바로 돌아온다(JDK와 같음) */
    public static void sleep(Duration duration) throws InterruptedException {
        long nanos;
        try {
            nanos = duration.toNanos();
        } catch (ArithmeticException e) {
            nanos = duration.isNegative() ? Long.MIN_VALUE : Long.MAX_VALUE;
        }
        if (nanos < 0) return;
        Sim.clock().sleep(nanos);
    }

    /** TimeUnit.sleep(long): 0 이하면 아무것도 하지 않는다(JDK와 같음, 끼어들기도 보지 않음) */
    public static void sleep(TimeUnit unit, long timeout) throws InterruptedException {
        if (unit == null) throw new NullPointerException();
        if (timeout > 0) Sim.clock().sleep(unit.toNanos(timeout));
    }

    // ---- Object.wait ----

    /**
     * Object.wait(long). 모니터를 갖고 있는지 확인한 뒤 가상으로 기다린다. 1단계는 다른 스레드가 없어 notify가 올 수 없으므로
     * 시간이 다 되거나 끼어들기가 있을 때 돌아온다(0이면 끼어들기까지). 기다리는 동안 모니터를 놓지 않는다(한 스레드라 차이가 없다).
     */
    public static void wait(Object target, long timeoutMillis) throws InterruptedException {
        if (target == null) throw new NullPointerException();
        if (timeoutMillis < 0) throw new IllegalArgumentException("timeout value is negative");
        if (!Thread.holdsLock(target)) throw new IllegalMonitorStateException("current thread is not owner");
        if (timeoutMillis == 0) waitForever();
        else Sim.clock().sleep(millisToNanos(timeoutMillis));
    }

    public static void wait(Object target, long timeoutMillis, int nanos) throws InterruptedException {
        if (target == null) throw new NullPointerException();
        if (timeoutMillis < 0) throw new IllegalArgumentException("timeout value is negative");
        if (nanos < 0 || nanos > 999999) throw new IllegalArgumentException("nanosecond timeout value out of range");
        if (nanos > 0 && timeoutMillis < Long.MAX_VALUE) timeoutMillis++;
        wait(target, timeoutMillis);
    }

    // ---- Thread.join ----

    /**
     * Thread.join(long). 대상이 끝났으면(또는 시작하지 않았으면) 바로 돌아온다. 자기 자신이면 가상으로 기다린다.
     * 살아 있는 다른 스레드를 기다리는 것은 1단계에서 지원하지 않는다(SimThreadError → error kind "thread").
     */
    public static void join(Thread thread, long millis) throws InterruptedException {
        if (thread == null) throw new NullPointerException();
        if (millis < 0) throw new IllegalArgumentException("timeout value is negative");
        if (!thread.isAlive()) return;
        if (thread != Thread.currentThread()) {
            throw new SimThreadError("Thread.join() on the running thread \"" + thread.getName()
                    + "\" is not supported yet: the simulator runs the OpMode thread only");
        }
        if (millis == 0) waitForever();
        else Sim.clock().sleep(millisToNanos(millis));
    }

    public static void join(Thread thread, long millis, int nanos) throws InterruptedException {
        if (thread == null) throw new NullPointerException();
        if (millis < 0) throw new IllegalArgumentException("timeout value is negative");
        if (nanos < 0 || nanos > 999999) throw new IllegalArgumentException("nanosecond timeout value out of range");
        if (nanos > 0 && millis < Long.MAX_VALUE) millis++;
        join(thread, millis);
    }

    // ---- LockSupport ----

    /** LockSupport.parkNanos: 끼어들기가 있으면(있었거나 기다리는 중에 생기면) 플래그를 그대로 두고 돌아온다 */
    public static void parkNanos(long nanos) {
        if (nanos <= 0 || Thread.currentThread().isInterrupted()) return;
        try {
            Sim.clock().sleep(nanos);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public static void parkNanos(Object blocker, long nanos) {
        parkNanos(nanos);
    }

    /** LockSupport.parkUntil(deadline): deadline은 System.currentTimeMillis 기준 절대 시각(밀리초) */
    public static void parkUntil(long deadline) {
        if (Thread.currentThread().isInterrupted()) return;
        SimClock clock = Sim.clock();
        long millis = deadline - clock.currentTimeMillis();
        if (millis <= 0) return;
        // 밀리초 경계에 맞춘다: currentTimeMillis가 deadline에 닿는 첫 가상 시각까지
        long nanos = millisToNanos(millis) - clock.nanoTime() % NANOS_PER_MILLI;
        parkNanos(nanos);
    }

    public static void parkUntil(Object blocker, long deadline) {
        parkUntil(deadline);
    }

    // ---- java.time ----

    public static Instant instantNow() {
        return Instant.now(virtualClock(ZoneOffset.UTC));
    }

    public static Clock clockSystemUTC() {
        return virtualClock(ZoneOffset.UTC);
    }

    public static Clock clockSystemDefaultZone() {
        return virtualClock(ZoneId.systemDefault());
    }

    public static LocalDateTime localDateTimeNow() {
        return LocalDateTime.now(virtualClock(ZoneId.systemDefault()));
    }

    public static LocalDate localDateNow() {
        return LocalDate.now(virtualClock(ZoneId.systemDefault()));
    }

    public static LocalTime localTimeNow() {
        return LocalTime.now(virtualClock(ZoneId.systemDefault()));
    }

    public static ZonedDateTime zonedDateTimeNow() {
        return ZonedDateTime.now(virtualClock(ZoneId.systemDefault()));
    }

    public static OffsetDateTime offsetDateTimeNow() {
        return OffsetDateTime.now(virtualClock(ZoneId.systemDefault()));
    }

    /** 가상 시계 기반 java.time.Clock(instant()마다 CLOCK_READ 청구) */
    public static Clock virtualClock(ZoneId zone) {
        return new VirtualJavaClock(zone);
    }

    // ---- 내부 ----

    private static long millisToNanos(long millis) {
        return millis >= Long.MAX_VALUE / NANOS_PER_MILLI ? Long.MAX_VALUE : millis * NANOS_PER_MILLI;
    }

    /** 끼어들기가 올 때까지 틱마다 기다린다(시간 제한 없는 wait·join). 끼어들기가 오면 InterruptedException. */
    private static void waitForever() throws InterruptedException {
        SimClock clock = Sim.clock();
        for (;;) clock.awaitNextTick();
    }

    private static final class VirtualJavaClock extends Clock {
        private final ZoneId zone;

        VirtualJavaClock(ZoneId zone) {
            if (zone == null) throw new NullPointerException("zone");
            this.zone = zone;
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return zone.equals(this.zone) ? this : new VirtualJavaClock(zone);
        }

        @Override
        public Instant instant() {
            Sim.charge(SimCost.CLOCK_READ);
            SimClock clock = Sim.clock();
            // currentTimeMillis = 시작 시각 + floor(nanoTime / 1e6)이므로 나머지 나노초를 더하면 정확한 시각이다
            long nanos = clock.nanoTime();
            return Instant.ofEpochMilli(clock.currentTimeMillis()).plusNanos(nanos % NANOS_PER_MILLI);
        }

        @Override
        public boolean equals(Object obj) {
            return obj instanceof VirtualJavaClock && ((VirtualJavaClock) obj).zone.equals(zone);
        }

        @Override
        public int hashCode() {
            return zone.hashCode() + 1;
        }

        @Override
        public String toString() {
            return "SandBotVirtualClock[" + zone + "]";
        }
    }
}
