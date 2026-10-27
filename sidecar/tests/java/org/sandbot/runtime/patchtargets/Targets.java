package org.sandbot.runtime.patchtargets;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;
import java.util.function.LongSupplier;

/**
 * ClassPatcherTest가 패치해서 부르는 코드: 바꿔야 할 시간 API 호출(spec §2.3 표의 모든 항목)과 바꾸지 말아야 할 비슷한 호출.
 * 테스트는 이 클래스를 패치한 사본을 따로 정의해 부르고 가상 시계가 얼마나 흘렀는지 본다.
 */
public class Targets {
    /** 정적 초기화 안의 호출 */
    public static final long STATIC_INIT_NANOS = System.nanoTime();

    /** 생성자 안의 호출 */
    public final long constructedNanos;

    public Targets() throws InterruptedException {
        Thread.sleep(7);
        constructedNanos = System.nanoTime();
    }

    // ---- System ----

    public static long nanoTime() {
        return System.nanoTime();
    }

    public static long currentTimeMillis() {
        return System.currentTimeMillis();
    }

    public static void exit() {
        System.exit(5);
    }

    public static void runtimeExit() {
        Runtime.getRuntime().exit(6);
    }

    public static void runtimeHalt() {
        Runtime.getRuntime().halt(7);
    }

    // ---- Thread.sleep ----

    public static void threadSleep(long millis) throws InterruptedException {
        Thread.sleep(millis);
    }

    public static void threadSleepNanos(long millis, int nanos) throws InterruptedException {
        Thread.sleep(millis, nanos);
    }

    @SuppressWarnings("static-access")
    public static void sleepThroughInstance() throws InterruptedException {
        // 인스턴스로 부른 정적 메서드(javac는 Thread.sleep으로 적는다)
        Thread.currentThread().sleep(3);
    }

    public static void timeUnitSleep() throws InterruptedException {
        TimeUnit.MILLISECONDS.sleep(12);
    }

    public static void timeUnitSleepZero() throws InterruptedException {
        TimeUnit.SECONDS.sleep(0);
    }

    // ---- Object.wait(어느 수신 형식이든) ----

    public static void objectWait(Object lock, long millis) throws InterruptedException {
        synchronized (lock) {
            lock.wait(millis);
        }
    }

    public static void objectWaitNanos(Object lock, long millis, int nanos) throws InterruptedException {
        synchronized (lock) {
            lock.wait(millis, nanos);
        }
    }

    public static void waitWithoutMonitor(Object lock) throws InterruptedException {
        lock.wait(5);
    }

    public void thisWait() throws InterruptedException {
        synchronized (this) {
            wait(5);
        }
    }

    public interface Lockable {}

    public static final class LockableImpl implements Lockable {}

    public static void interfaceWait(Lockable lockable) throws InterruptedException {
        synchronized (lockable) {
            lockable.wait(6);
        }
    }

    public static void arrayWait(int[] array) throws InterruptedException {
        synchronized (array) {
            array.wait(4);
        }
    }

    public static class Subclass extends Targets {
        public Subclass() throws InterruptedException {
            super();
        }

        public void superWait() throws InterruptedException {
            synchronized (this) {
                super.wait(2);
            }
        }
    }

    // ---- Thread.join ----

    public static void joinNotStarted() throws InterruptedException {
        new Thread(() -> { }).join(50);
    }

    public static void joinSelf() throws InterruptedException {
        Thread.currentThread().join(9);
    }

    public static void joinSelfNanos() throws InterruptedException {
        Thread.currentThread().join(9, 5);
    }

    public static void joinWorkerNotStarted() throws InterruptedException {
        Worker w = new Worker();
        w.join(20);
    }

    // ---- LockSupport ----

    public static void parkNanos() {
        LockSupport.parkNanos(3_000_000L);
    }

    public static void parkNanosBlocker() {
        LockSupport.parkNanos(new Object(), 3_000_000L);
    }

    public static void parkUntil(long deadline) {
        LockSupport.parkUntil(deadline);
    }

    public static void parkUntilBlocker(long deadline) {
        LockSupport.parkUntil(new Object(), deadline);
    }

    // ---- java.time ----

    public static Instant instantNow() {
        return Instant.now();
    }

    public static Clock clockUTC() {
        return Clock.systemUTC();
    }

    public static Clock clockDefaultZone() {
        return Clock.systemDefaultZone();
    }

    public static LocalDateTime localDateTimeNow() {
        return LocalDateTime.now();
    }

    public static LocalDate localDateNow() {
        return LocalDate.now();
    }

    public static LocalTime localTimeNow() {
        return LocalTime.now();
    }

    public static ZonedDateTime zonedDateTimeNow() {
        return ZonedDateTime.now();
    }

    public static OffsetDateTime offsetDateTimeNow() {
        return OffsetDateTime.now();
    }

    // ---- 메서드 참조·람다 ----

    public interface SleepFn {
        void sleep(long millis) throws InterruptedException;
    }

    public interface WaitFn {
        void await(long millis) throws InterruptedException;
    }

    public interface JoinFn {
        void join(Thread thread, long millis) throws InterruptedException;
    }

    public static long methodRefNanoTime() {
        LongSupplier clock = System::nanoTime;
        return clock.getAsLong();
    }

    public static void methodRefSleep() throws InterruptedException {
        SleepFn f = Thread::sleep;
        f.sleep(11);
    }

    public static void boundMethodRefWait(Object lock) throws InterruptedException {
        WaitFn f = lock::wait;
        synchronized (lock) {
            f.await(8);
        }
    }

    public static void unboundMethodRefJoin() throws InterruptedException {
        JoinFn f = Thread::join;
        f.join(Thread.currentThread(), 13);
    }

    public static void lambdaSleep() {
        Runnable r = () -> {
            try {
                Thread.sleep(14);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
        r.run();
    }

    // ---- 하위 클래스로 부른 정적 메서드 ----

    public static final class Worker extends Thread {
        static void pause() throws InterruptedException {
            sleep(15);
        }
    }

    public static void workerSleep() throws InterruptedException {
        Worker.pause();
    }

    /** sleep(long)을 스스로 선언(숨김)한 하위 클래스: 바꾸면 안 된다 */
    public static final class Hider extends Thread {
        public static boolean called;

        public static void sleep(long millis) {
            called = true;
        }
    }

    public static boolean hiderSleep() {
        Hider.called = false;
        Hider.sleep(16);
        return Hider.called;
    }

    /** Thread가 아닌 클래스의 join(long): 바꾸면 안 된다 */
    public static final class Joiner {
        public long joined;

        public void join(long millis) {
            joined = millis;
        }
    }

    public static long unrelatedJoin() {
        Joiner j = new Joiner();
        j.join(17);
        return j.joined;
    }

    // ---- 바꾸지 않는 호출(부르지 않고 바이트코드만 본다) ----

    public static void notTargets(Object o) throws InterruptedException {
        Thread.currentThread();
        System.identityHashCode(o);
        Instant.ofEpochMilli(0);
        Instant.now(Clock.fixed(Instant.EPOCH, java.time.ZoneOffset.UTC));
        System.getProperty("x");
        TimeUnit.SECONDS.toNanos(1);
        synchronized (o) {
            o.wait();
        }
        o.notifyAll();
        new Thread(() -> { }).join();
    }
}
