package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.util.ElapsedTime;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.LockSupport;
import java.util.function.LongSupplier;

/**
 * 사이드카 테스트: 팀 코드가 보는 시간 API가 모두 가상 시계인지. INIT 안에서 재고 "RESULT 이름=밀리초"로 쓴다.
 * 시계 읽기 비용(1 µs)이 있어 값은 기다린 시간보다 아주 조금 크다(밀리초로 내리면 같다).
 */
@Autonomous(name = "Time APIs")
public class TimeApis extends LinearOpMode {
    private final Object lock = new Object();

    @Override
    public void runOpMode() throws InterruptedException {
        long a = System.nanoTime();
        sleep(1000);
        result("linearSleep", System.nanoTime() - a);

        a = System.nanoTime();
        Thread.sleep(250);
        result("threadSleep", System.nanoTime() - a);

        a = System.nanoTime();
        Thread.sleep(20, 500000);
        result("threadSleepNanos", System.nanoTime() - a);

        ElapsedTime timer = new ElapsedTime();
        Thread.sleep(300);
        System.out.println("RESULT elapsedTime=" + (long) timer.milliseconds());

        long m = System.currentTimeMillis();
        Thread.sleep(40);
        System.out.println("RESULT currentTimeMillis=" + (System.currentTimeMillis() - m));

        a = System.nanoTime();
        synchronized (lock) {
            lock.wait(100);
        }
        result("objectWait", System.nanoTime() - a);

        a = System.nanoTime();
        synchronized (lock) {
            lock.wait(30, 1);
        }
        result("objectWaitNanos", System.nanoTime() - a);

        a = System.nanoTime();
        TimeUnit.MILLISECONDS.sleep(70);
        result("timeUnitSleep", System.nanoTime() - a);

        a = System.nanoTime();
        LockSupport.parkNanos(60_000_000L);
        result("parkNanos", System.nanoTime() - a);

        a = System.nanoTime();
        LockSupport.parkUntil(System.currentTimeMillis() + 90);
        result("parkUntil", System.nanoTime() - a);

        Instant i0 = Instant.now();
        Thread.sleep(80);
        System.out.println("RESULT instantNow=" + Duration.between(i0, Instant.now()).toMillis());

        // 메서드 참조(System::nanoTime)도 가상 시계
        LongSupplier clock = System::nanoTime;
        a = clock.getAsLong();
        Thread.sleep(15);
        result("methodRef", clock.getAsLong() - a);

        // 람다 안
        Runnable r = () -> {
            try {
                Thread.sleep(35);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
        a = System.nanoTime();
        r.run();
        result("lambda", System.nanoTime() - a);

        // Thread 하위 클래스의 정적 호출(javac가 Worker.sleep으로 적는다)
        a = System.nanoTime();
        Worker.pause();
        result("subclassSleep", System.nanoTime() - a);

        // OpMode 시계(getRuntime)
        double r0 = getRuntime();
        sleep(500);
        System.out.println("RESULT runtime=" + Math.round((getRuntime() - r0) * 1000));

        // 실제 Thread.join: 끝난 스레드는 바로 돌아온다
        Thread done = new Thread(() -> { });
        done.join(1000);
        System.out.println("RESULT joinNotStarted=ok");
    }

    private static void result(String name, long nanos) {
        System.out.println("RESULT " + name + "=" + nanos / 1_000_000L);
    }

    static class Worker extends Thread {
        static void pause() throws InterruptedException {
            sleep(45);
        }
    }
}
