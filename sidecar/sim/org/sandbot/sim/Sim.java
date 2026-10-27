package org.sandbot.sim;

/**
 * 가짜 SDK와 패치한 코드가 쓰는 시뮬레이터 서비스. 런타임이 실행마다(JVM 하나에 한 번) {@link #install}로 넣는다.
 * 넣기 전에 부르면 IllegalStateException이다(사이드카 밖에서 가짜 SDK를 쓴 것).
 */
public final class Sim {
    private static volatile SimClock clock;
    private static volatile HubTiming timing;
    private static volatile SimHost host;
    private static final SimDevices DEVICES = new SimDevices();

    private Sim() {}

    /** 런타임만 부른다. 한 번만. */
    public static synchronized void install(SimClock clock, HubTiming timing, SimHost host) {
        if (Sim.clock != null) throw new IllegalStateException("simulator already installed");
        if (clock == null || timing == null || host == null) throw new NullPointerException();
        Sim.timing = timing;
        Sim.host = host;
        Sim.clock = clock;
    }

    public static boolean installed() {
        return clock != null;
    }

    public static SimClock clock() {
        SimClock c = clock;
        if (c == null) throw new IllegalStateException("SandBot simulator is not running");
        return c;
    }

    public static HubTiming timing() {
        HubTiming t = timing;
        if (t == null) throw new IllegalStateException("SandBot simulator is not running");
        return t;
    }

    public static SimHost host() {
        SimHost h = host;
        if (h == null) throw new IllegalStateException("SandBot simulator is not running");
        return h;
    }

    public static SimDevices devices() {
        return DEVICES;
    }

    /** 허브 작업 하나의 비용만큼 가상 시간을 보낸다 */
    public static void charge(SimCost cost, HubKind hub) {
        clock().charge(timing().nanos(cost, hub));
    }

    /** 허브와 관계없는 비용(CLOCK_READ·LOOP_MARKER·TELEMETRY_UPDATE) */
    public static void charge(SimCost cost) {
        charge(cost, HubKind.CONTROL);
    }

    /** 루프 표시: 호스트에 알리고 그 비용을 청구한다 */
    public static void loopMarker() {
        host().loopMarker();
        charge(SimCost.LOOP_MARKER);
    }

    /** 시계만 읽는다(비용 없음). 가짜 SDK 내부용. 팀 코드의 시계 읽기는 패치가 CLOCK_READ를 청구한다. */
    public static long nanoTime() {
        return clock().nanoTime();
    }

    public static void sleepMillis(long millis) throws InterruptedException {
        clock().sleep(millis * 1_000_000L);
    }
}
