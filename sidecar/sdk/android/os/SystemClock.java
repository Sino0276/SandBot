// SandBot: Android의 android.os.SystemClock과 같은 API(android-4.1.1.4.jar의 공개 서명)를 가상 시계로 새로 쓴 것.
// uptimeMillis·elapsedRealtime은 실행 시작부터의 가상 시간(로봇이 잠들지 않으므로 둘이 같다)이고 시계 읽기 비용을 청구한다.
package android.os;

import org.sandbot.sim.Sim;
import org.sandbot.sim.SimCost;

public final class SystemClock {
    SystemClock() {}

    /**
     * Android와 같이 끼어들기로 끝나지 않는다: 기다리는 동안 끼어들기가 오면 끝까지 기다린 뒤 끼어들기 플래그를 다시 세운다.
     */
    public static void sleep(long ms) {
        long start = uptimeNanos();
        long duration = ms * 1_000_000L;
        boolean interrupted = false;
        for (;;) {
            long remaining = start + duration - uptimeNanos();
            if (remaining <= 0) break;
            try {
                Sim.clock().sleep(remaining);
            } catch (InterruptedException e) {
                interrupted = true;
            }
        }
        if (interrupted) Thread.currentThread().interrupt();
    }

    /** 앱은 시스템 시계를 바꿀 수 없다(권한 없음) */
    public static boolean setCurrentTimeMillis(long millis) {
        return false;
    }

    public static long uptimeMillis() {
        Sim.charge(SimCost.CLOCK_READ);
        return uptimeNanos() / 1_000_000L;
    }

    public static long elapsedRealtime() {
        Sim.charge(SimCost.CLOCK_READ);
        return uptimeNanos() / 1_000_000L;
    }

    /** 스레드 CPU 시간: 한 스레드이므로 가상 시간과 같다 */
    public static long currentThreadTimeMillis() {
        Sim.charge(SimCost.CLOCK_READ);
        return uptimeNanos() / 1_000_000L;
    }

    private static long uptimeNanos() {
        return Sim.clock().nanoTime();
    }
}
