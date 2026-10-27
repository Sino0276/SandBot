package org.sandbot.runtime;

import android.os.SystemClock;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.SandbotOpModeBridge;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.HardwareDevice;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.robotcore.external.Telemetry;
import org.firstinspires.ftc.robotcore.internal.opmode.OpModeServices;
import org.sandbot.sdk.core.SandbotGamepads;
import org.sandbot.sim.TelemetryFrame;
import org.sandbot.testing.Check;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/** 핵심 SDK 손 구현: TelemetryImpl, Gamepad(+SandbotGamepads), HardwareMap, RobotLog·android.util.Log, SystemClock, OpMode 다리 */
public final class SdkCoreTest {
    private SdkCoreTest() {}

    private static final long MS = 1_000_000L;

    /** 텔레메트리 주인이 될 OpMode */
    public static final class Probe extends LinearOpMode {
        @Override
        public void runOpMode() {}
    }

    private static VirtualClock clock;

    /** 새 시계와 그 시계에서 만든 OpMode의 텔레메트리 */
    private static Telemetry telemetry() {
        clock = TestSim.fresh();
        return new Probe().telemetry;
    }

    private static TelemetryFrame lastFrame() {
        return TestSim.frames.get(TestSim.frames.size() - 1);
    }

    // ---- 텔레메트리 ----

    public static void testTelemetryLinesLikeDriverStation() {
        Telemetry t = telemetry();
        clock.charge(300 * MS); // 첫 전송 간격(250 ms)이 지나게
        t.addData("count", 3);
        t.addData("pi", "%.3f", Math.PI);
        t.addData("ratio", 0.5);
        t.addData("float", 2.25f);
        t.addData("big", 1234567.891234);
        t.addLine("pose ").addData("x", 1).addData("y", 2);
        t.addLine();
        Check.isTrue(t.update(), "update transmitted");
        TelemetryFrame f = lastFrame();
        Check.equal(Arrays.asList("count : 3", "pi : 3.142", "ratio : 0.5", "float : 2.25", "big : 1234567.8912",
                "pose x : 1 | y : 2", ""), f.lines, "DS lines");
        Check.equal(Collections.emptyList(), f.log, "no log");
        Check.equal("classic", f.format, "format");
    }

    public static void testTelemetryTransmissionInterval() {
        Telemetry t = telemetry();
        t.addData("a", 1);
        Check.isTrue(!t.update(), "first update within 250 ms of creation is not sent");
        Check.equal(0, TestSim.frames.size(), "nothing sent");
        clock.charge(251 * MS);
        t.addData("a", 2);
        Check.isTrue(t.update(), "sent after the interval");
        Check.equal(Arrays.asList("a : 2"), lastFrame().lines, "auto clear after update");
        t.addData("a", 3);
        Check.isTrue(!t.update(), "too soon");
        // 보내지 못한 update는 다음 IFDIRTY(이벤트 루프)에서 나간다
        clock.charge(251 * MS);
        Check.isTrue(((org.firstinspires.ftc.robotcore.internal.opmode.TelemetryInternal) t).tryUpdateIfDirty(),
                "dirty update sent from the event loop");
        Check.equal(Arrays.asList("a : 3"), lastFrame().lines, "pending lines");
        t.setMsTransmissionInterval(0);
        t.addData("b", 1);
        Check.isTrue(t.update(), "interval 0 sends at once");
        Check.equal(250, new Probe().telemetry.getMsTransmissionInterval(), "default interval 250 ms");
    }

    public static void testTelemetryLogRetainedAndSeparators() {
        Telemetry t = telemetry();
        t.setMsTransmissionInterval(0);
        t.log().add("one");
        t.log().add("two %d", 2);
        Check.equal(Arrays.asList("one", "two 2"), lastFrame().log, "log update sends at once (LOG reason)");
        t.log().setDisplayOrder(Telemetry.Log.DisplayOrder.NEWEST_FIRST);
        t.log().setCapacity(1);
        t.addData("x", 1);
        t.update();
        Check.equal(Arrays.asList("two 2"), lastFrame().log, "capacity prunes oldest");
        int[] counter = {0};
        t.addData("produced", () -> ++counter[0]);
        t.addData("plain", 5);
        t.update();
        Check.equal(Arrays.asList("produced : 1", "plain : 5"), lastFrame().lines, "producer evaluated on update");
        t.addData("next", 1);
        t.update();
        Check.equal(Arrays.asList("produced : 2", "next : 1"), lastFrame().lines,
                "the next add clears plain items but keeps value producers");
        t.setAutoClear(false);
        t.setCaptionValueSeparator("=");
        t.setItemSeparator(", ");
        t.addLine("l ").addData("a", 1).addData("b", 2);
        t.update();
        Check.equal(Arrays.asList("produced=3", "l a=1, b=2"), lastFrame().lines, "separators");
        t.addData("kept", 1);
        t.update();
        Check.equal(Arrays.asList("produced=4", "l a=1, b=2", "kept=1"), lastFrame().lines, "no auto clear");
        t.clearAll();
        t.setDisplayFormat(Telemetry.DisplayFormat.HTML);
        t.addData("h", "<b>x</b>");
        t.update();
        Check.equal("html", lastFrame().format, "display format");
        int before = TestSim.frames.size();
        t.speak("hello");
        Check.equal(before, TestSim.frames.size(), "speak is ignored");
    }

    public static void testTelemetryUpdateCharges() {
        Telemetry t = telemetry();
        t.setMsTransmissionInterval(0);
        t.addData("a", 1);
        long before = clock.peekNanos();
        t.update();
        // 전송 간격 타이머 읽기와 다시 맞추기(시계 읽기 1 µs씩) + 전송(0.2 ms)
        Check.equal(200_000L + 2_000L, clock.peekNanos() - before, "telemetry update cost");
    }

    // ---- 게임패드 ----

    private static Map<String, Object> state(Object... keyValues) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) m.put((String) keyValues[i], keyValues[i + 1]);
        return m;
    }

    public static void testGamepadFromStateAndCopy() {
        TestSim.fresh();
        Gamepad latest = SandbotGamepads.fromState(state("a", true, "left_stick_y", -0.75, "right_trigger", 0.6,
                "dpad_up", true, "back", true, "guide", true), 1, 1234);
        Check.equal(1, latest.getGamepadId(), "id");
        Check.equal(1234L, latest.timestamp, "timestamp");
        Gamepad g = new Gamepad();
        g.copy(latest);
        Check.isTrue(g.a && g.cross, "a and its PS alias cross");
        Check.isTrue(g.back && g.share && g.guide && g.ps, "aliases");
        Check.equal(-0.75f, g.left_stick_y, "stick");
        Check.isTrue(g.right_trigger_pressed && !g.left_trigger_pressed, "trigger pressed with threshold 0.5");
        Check.isTrue(g.aWasPressed(), "edge: pressed");
        Check.isTrue(!g.aWasPressed(), "edge reported once");
        Check.isTrue(g.dpadUpWasPressed() && g.crossWasPressed(), "other edges");
        g.copy(SandbotGamepads.fromState(state(), 1, 1300));
        Check.isTrue(g.aWasReleased() && !g.aWasReleased(), "release edge once");
        Gamepad none = SandbotGamepads.fromState(null, 2, 0);
        Check.equal(Gamepad.ID_UNASSOCIATED, none.getGamepadId(), "disconnected gamepad");
        Check.isTrue(none.atRest(), "at rest");
        g.setTriggerThreshold(0.7f);
        g.copy(latest);
        Check.isTrue(!g.right_trigger_pressed, "threshold applies on copy");
    }

    public static void testGamepadRumbleUsesVirtualTime() {
        VirtualClock c = TestSim.fresh();
        Gamepad g = new Gamepad();
        g.rumble(500);
        Check.isTrue(g.isRumbling(), "rumbling");
        c.charge(600 * MS);
        Check.isTrue(!g.isRumbling(), "finished after the virtual duration (+ overhead)");
        g.rumble(Gamepad.RUMBLE_DURATION_CONTINUOUS);
        Check.isTrue(g.isRumbling(), "continuous");
        g.stopRumble();
        Check.isTrue(!g.isRumbling(), "stopped");
        g.setLedColor(1, 0, 0, 100);
        Check.isTrue(g.ledQueue.size() == 1, "LED effect is queued only");
    }

    // ---- HardwareMap ----

    public interface Gyroish extends HardwareDevice {}

    static final class Fake implements Gyroish, DcMotorSimple {
        final String name;
        double power;

        Fake(String name) {
            this.name = name;
        }

        @Override
        public Manufacturer getManufacturer() {
            return Manufacturer.Other;
        }

        @Override
        public String getDeviceName() {
            return "Fake " + name;
        }

        @Override
        public String getConnectionInfo() {
            return "nowhere";
        }

        @Override
        public int getVersion() {
            return 1;
        }

        @Override
        public void resetDeviceConfigurationForOpMode() {}

        @Override
        public void close() {}

        @Override
        public void setDirection(Direction direction) {}

        @Override
        public Direction getDirection() {
            return Direction.FORWARD;
        }

        @Override
        public void setPower(double power) {
            this.power = power;
        }

        @Override
        public double getPower() {
            return power;
        }
    }

    public static void testHardwareMapLookups() {
        TestSim.fresh();
        HardwareMap map = new HardwareMap(null, null);
        Fake left = new Fake("left");
        Fake right = new Fake("right");
        map.put("left", left);
        map.put(" right ", right);
        Check.isTrue(map.get(DcMotorSimple.class, "left") == left, "typed get");
        Check.isTrue(map.get(Gyroish.class, " right") == right, "names are trimmed");
        Check.isTrue(map.get("left") == left, "untyped get");
        Check.isTrue(map.tryGet(DcMotorSimple.class, "nope") == null, "tryGet null");
        IllegalArgumentException e = Check.throwsType(IllegalArgumentException.class,
                () -> map.get(DcMotorSimple.class, "nope"), "missing device");
        Check.equal("Unable to find a hardware device with name \"nope\" and type DcMotorSimple", e.getMessage(),
                "SDK error text");
        e = Check.throwsType(IllegalArgumentException.class, () -> map.get("nope"), "missing untyped");
        Check.equal("Unable to find a hardware device with name \"nope\"", e.getMessage(), "SDK error text");
        Check.equal(2, map.size(), "size");
        Check.equal(new LinkedHashSet<>(Collections.singletonList("left")), map.getNamesOf(left), "names of");
        Check.equal(2, map.getAll(Gyroish.class).size(), "getAll");
        Check.equal(new java.util.TreeSet<>(Arrays.asList("left", "right")), map.getAllNames(Gyroish.class), "all names");
        Check.isTrue(map.remove("left", left), "remove");
        Check.isTrue(map.tryGet(DcMotorSimple.class, "left") == null, "removed");
    }

    public static void testDeviceMappingAndDeterministicOrder() {
        TestSim.fresh();
        HardwareMap map = new HardwareMap(null, null);
        List<String> names = new ArrayList<>();
        for (int i = 0; i < 20; i++) names.add("motor" + i);
        Check.equal(22, map.allDeviceMappings.size(), "all device mappings like the SDK");
        IllegalArgumentException e = Check.throwsType(IllegalArgumentException.class, () -> map.dcMotor.get("x"),
                "missing in mapping");
        Check.equal("Unable to find a hardware device with the name \"x\"", e.getMessage(), "DeviceMapping error text");
        List<String> first = new ArrayList<>();
        HardwareMap a = new HardwareMap(null, null);
        for (String n : names) a.put(n, new Fake(n));
        for (HardwareDevice d : a.unsafeIterable()) first.add(((Fake) d).name);
        List<String> second = new ArrayList<>();
        HardwareMap b = new HardwareMap(null, null);
        for (String n : names) b.put(n, new Fake(n));
        for (HardwareDevice d : b.unsafeIterable()) second.add(((Fake) d).name);
        Check.equal(first, second, "iteration order does not depend on identity hash codes");
    }

    // ---- 로그 ----

    public static void testRobotLogLines() {
        TestSim.fresh();
        RobotLog.d("debug %d", 1);
        RobotLog.ii("Tag", "info");
        RobotLog.ee("Tag", new IllegalStateException("bad"), "with stack");
        android.util.Log.w("W", "warn");
        android.util.Log.wtf("A", "assert");
        RobotLog.addGlobalWarningMessage("careful");
        Check.equal("D/RobotCore: debug 1", TestSim.logs.get(0), "debug");
        Check.equal("I/Tag: info", TestSim.logs.get(1), "info with tag");
        Check.equal("E/Tag: with stack", TestSim.logs.get(2), "error");
        Check.isTrue(TestSim.logs.get(3).startsWith("E/Tag: java.lang.IllegalStateException: bad\n\tat "),
                "stack trace as one message: " + TestSim.logs.get(3));
        Check.equal("W/W: warn", TestSim.logs.get(4), "android.util.Log.w");
        Check.equal("A/A: assert", TestSim.logs.get(5), "wtf");
        Check.equal("W/GlobalWarning: careful", TestSim.logs.get(6), "global warning");
        Check.isTrue(RobotLog.getGlobalWarningMessage().message.contains("careful"), "global warning kept");
        RobotLog.clearGlobalWarningMsg();
        Check.equal("", RobotLog.getGlobalWarningMessage().message, "cleared");
        Check.equal("", android.util.Log.getStackTraceString(null), "null stack");
        Check.isTrue(android.util.Log.isLoggable("x", android.util.Log.INFO), "INFO loggable");
    }

    // ---- SystemClock ----

    public static void testSystemClockIsVirtualAndUninterruptible() {
        VirtualClock c = TestSim.fresh();
        c.charge(42 * MS);
        Check.equal(42L, SystemClock.uptimeMillis(), "uptime");
        Thread.currentThread().interrupt();
        long before = c.peekNanos();
        SystemClock.sleep(30);
        Check.isTrue(c.peekNanos() - before >= 30 * MS, "slept the full time despite the interrupt");
        Check.isTrue(Thread.interrupted(), "interrupt restored");
        Check.isTrue(!SystemClock.setCurrentTimeMillis(0), "cannot set the clock");
    }

    // ---- 기다리는 시간 API의 한 스레드 규칙 ----

    public static void testJoinOnRunningThreadIsThreadError() throws Exception {
        TestSim.fresh();
        Object gate = new Object();
        Thread other = new Thread(() -> {
            synchronized (gate) {
                try {
                    gate.wait(); // 테스트 코드는 패치하지 않으므로 진짜 대기
                } catch (InterruptedException e) {
                    // 끝
                }
            }
        }, "Blocked");
        other.setDaemon(true);
        other.start();
        org.sandbot.sim.SimThreadError e = Check.throwsType(org.sandbot.sim.SimThreadError.class,
                () -> org.sandbot.sim.TimeRedirects.join(other, 10), "join on a running thread");
        Check.isTrue(!e.reported(), "the runner reports it as kind thread");
        Check.isTrue(e.getMessage().contains("\"Blocked\""), e.getMessage());
        other.interrupt();
        other.join();
        org.sandbot.sim.TimeRedirects.join(other, 10); // 끝난 스레드는 바로 돌아온다
    }

    // ---- OpMode 다리 ----

    static final class Services implements OpModeServices {
        int stops;

        @Override
        public void refreshUserTelemetry(com.qualcomm.robotcore.robocol.TelemetryMessage telemetry, double s) {}

        @Override
        public void requestOpModeStop(OpMode opMode) {
            stops++;
        }
    }

    public static final class Order extends OpMode {
        final StringBuilder calls = new StringBuilder();
        boolean looped;
        boolean initLooped;

        @Override
        public void init() {
            calls.append("init ");
        }

        @Override
        public void init_loop() {
            if (!initLooped) calls.append("init_loop ");
            initLooped = true;
        }

        @Override
        public void start() {
            calls.append("start ");
        }

        @Override
        public void loop() {
            if (!looped) calls.append("loop ");
            looped = true;
        }

        @Override
        public void stop() {
            calls.append("stop");
        }
    }

    public static void testIterativeOpModeThroughBridge() {
        VirtualClock c = TestSim.fresh();
        Order op = new Order();
        Services services = new Services();
        SandbotOpModeBridge.attach(op, new Gamepad(), new Gamepad(), new HardwareMap(null, null), services);
        SandbotOpModeBridge.init(op);
        TestSim.onTick = k -> {
            if (k == 4) SandbotOpModeBridge.start(op);
            if (k == 10) SandbotOpModeBridge.stop(op);
        };
        SandbotOpModeBridge.runOpModeOnThisThread(op);
        Check.equal("init init_loop start loop stop", op.calls.toString(), "callback order");
        Check.isTrue(SandbotOpModeBridge.isFinished(op), "finished");
        Check.isTrue(SandbotOpModeBridge.exception(op) == null, "no exception");
        Check.isTrue(TestSim.loops > 2, "loop markers for init_loop and loop");
        Check.isTrue(c.peekNanos() >= 10 * TestSim.TICK, "ran until the stop boundary");
        Check.equal(0, services.stops, "no stop request");
    }

    public static final class Linear extends LinearOpMode {
        String result = "";

        @Override
        public void runOpMode() throws InterruptedException {
            waitForStart();
            result += "started@" + Math.round(getRuntime() * 1000) + " ";
            while (opModeIsActive()) {
                sleep(1);
            }
            result += "stopped";
            Thread.sleep(1); // 끼어든 상태에서 InterruptedException
            result += " unreachable";
        }
    }

    public static void testLinearOpModeWaitForStartAndInterruptOnStop() {
        TestSim.fresh();
        Linear op = new Linear();
        Services services = new Services();
        SandbotOpModeBridge.attach(op, new Gamepad(), new Gamepad(), new HardwareMap(null, null), services);
        op.resetRuntime();
        SandbotOpModeBridge.init(op);
        TestSim.onTick = k -> {
            if (k == 6) SandbotOpModeBridge.start(op);
            if (k == 20) SandbotOpModeBridge.stop(op);
            SandbotOpModeBridge.eventLoopIteration(op);
        };
        SandbotOpModeBridge.runOpModeOnThisThread(op);
        Check.equal("started@30 stopped", op.result, "waitForStart until start; interrupted after stop");
        Check.equal(1, services.stops, "InterruptedException asks to stop the OpMode (like the SDK)");
        Check.isTrue(!Thread.currentThread().isInterrupted(), "flag consumed by the InterruptedException");
    }

    public static void testTerminateOpModeNowIsForceStop() {
        TestSim.fresh();
        OpMode op = new OpMode() {
            @Override
            public void init() {
                terminateOpModeNow();
            }

            @Override
            public void loop() {}
        };
        SandbotOpModeBridge.attach(op, new Gamepad(), new Gamepad(), new HardwareMap(null, null), new Services());
        SandbotOpModeBridge.init(op);
        SandbotOpModeBridge.runOpModeOnThisThread(op);
        Check.isTrue(SandbotOpModeBridge.isForceStop(SandbotOpModeBridge.exception(op)), "ForceStopException recorded");
    }
}
