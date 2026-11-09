package org.sandbot.sdk.vision;

import com.qualcomm.robotcore.hardware.HardwareMap;

import org.sandbot.sdk.devices.SandbotHardware;
import org.sandbot.sim.HubTiming;
import org.sandbot.sim.Sim;
import org.sandbot.sim.SimClock;
import org.sandbot.sim.SimDevice;
import org.sandbot.sim.SimHost;
import org.sandbot.sim.TelemetryFrame;

import java.io.File;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 비전 시험 도구(spec-4d B3·B4·B6–B8·B11–B15): 틱 경계(5 ms)마다 런타임처럼 웹캠 입력을 넣고 Sim.fireBoundary를 부르는 가짜 시계와,
 * 30 fps 정수 격자(g_k = floor(k·1e9/30))에 맞는 경계에서 웹캠 출력이 streaming이면 프레임을 만드는 작은 세계. 시험 스레드가 곧
 * OpMode 스레드다. Sim.install은 JVM마다 한 번이라 비전 시험 클래스만 한 JVM에서 돈다(vision.test.ts).
 */
final class VisionHarness {
    private VisionHarness() {}

    static final long TICK = 5_000_000L;

    /** 프레임 하나에 실을 태그(시험이 정한다): 해상도·출력 데시메이션을 받아 [id, x0, y0, …] 평평한 목록 */
    interface Tags {
        List<Object> at(long frameNanos, int width, int height, double decimation);
    }

    static final class Camera {
        final String device;
        String model;
        Tags tags = (t, w, h, d) -> Collections.emptyList();
        boolean modelSent;
        final List<Long> frames = new ArrayList<>();

        Camera(String device) {
            this.device = device;
        }
    }

    static final List<Camera> cameras = new ArrayList<>();

    static final class Clock implements SimClock {
        long nanos;

        @Override public long nanoTime() {
            return nanos;
        }

        @Override public long currentTimeMillis() {
            return 1_700_000_000_000L + nanos / 1_000_000L;
        }

        @Override public void charge(long n) {
            advanceTo(nanos + n);
        }

        @Override public void sleep(long n) throws InterruptedException {
            if (Thread.interrupted()) throw new InterruptedException();
            if (n > 0) advanceTo(nanos + n);
        }

        @Override public void awaitNextTick() throws InterruptedException {
            if (Thread.interrupted()) throw new InterruptedException();
            advanceTo((nanos / TICK + 1) * TICK);
        }

        @Override public long tickNanos() {
            return TICK;
        }

        void advanceTo(long target) {
            for (long b = (nanos / TICK + 1) * TICK; b <= target; b += TICK) {
                nanos = b;
                boundary(b);
            }
            nanos = target;
        }
    }

    static final class Host implements SimHost {
        final List<String> logs = new ArrayList<>();
        final List<String> notices = new ArrayList<>();
        final List<Throwable> stops = new ArrayList<>();

        @Override public void telemetry(TelemetryFrame frame) {
        }

        @Override public void log(String stream, String text) {
            logs.add(stream + ": " + text);
        }

        @Override public void loopMarker() {
        }

        @Override public void notice(String code, Map<String, String> params) {
            notices.add(params.isEmpty() ? code : code + " " + params);
        }

        @Override public void emergencyStop(Throwable cause) {
            stops.add(cause);
        }
    }

    static final Clock CLOCK = new Clock();
    static final Host HOST = new Host();
    private static int counter = 0;
    private static long lastBoundary = -1;

    static synchronized void install() {
        if (Sim.installed()) return;
        try {
            // AppUtil(뷰 id 등록이 부르는 OpModeManagerImpl·AppUtil.getInstance)이 모의 저장소를 읽는다
            Sim.installFirstFolder(Files.createTempDirectory("sandbot-vision-first").toFile());
        } catch (java.io.IOException e) {
            throw new RuntimeException(e);
        }
        Sim.install(CLOCK, HubTiming.defaults(), HOST);
    }

    /** 30 fps 격자 g_k = floor(k·1e9/30) [가정: 30 fps 격자, spec-4d §1.4] */
    static long grid(long k) {
        return k * 1_000_000_000L / 30;
    }

    /** ∃k: prev < g_k ≤ t */
    static boolean frameDue(long prev, long t) {
        if (prev < 0) return false;
        long k = t * 30 / 1_000_000_000L;
        while (grid(k + 1) <= t) k++;
        while (k > 0 && grid(k) > t) k--;
        return grid(k) > prev && grid(k) <= t;
    }

    private static void boundary(long b) {
        long prev = lastBoundary;
        lastBoundary = b;
        for (Camera c : cameras) {
            SimDevice d = Sim.devices().get(c.device);
            if (d == null) continue;
            Map<String, Object> in = new LinkedHashMap<>();
            if (!c.modelSent && c.model != null) {
                in.put("model", c.model);
                c.modelSent = true;
            }
            Map<String, Object> out = d.outputs();
            if (Boolean.TRUE.equals(out.get("streaming")) && frameDue(prev, b)) {
                int w = ((Number) out.get("width")).intValue();
                int h = ((Number) out.get("height")).intValue();
                Object dec = out.get("decimation");
                double decimation = dec instanceof Number ? ((Number) dec).doubleValue() : 3;
                in.put("frameNanos", b);
                in.put("frameWidth", (long) w);
                in.put("frameHeight", (long) h);
                in.put("tags", Boolean.TRUE.equals(out.get("aprilTag")) && "TAG_36h11".equals(out.get("family"))
                        ? c.tags.at(b, w, h, decimation) : Collections.emptyList());
                c.frames.add(b);
            }
            if (!in.isEmpty()) d.applyInputs(in, b);
        }
        Sim.fireBoundary(b);
    }

    /** 웹캠 하나가 든 구성으로 hardwareMap을 만든다(장치 이름은 JVM 안에서 겹치지 않게 번호를 붙인다) */
    static Camera webcam(HardwareMap[] mapOut, String model) {
        install();
        String name = "Webcam " + (++counter);
        String xml = "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n"
                + "<Robot type=\"FirstInspires-FTC\" name=\"Vision Bot\">\n"
                + "    <LynxUsbDevice name=\"Control Hub Portal\" serialNumber=\"(embedded)\" parentModuleAddress=\"173\">\n"
                + "        <LynxModule name=\"Hub " + counter + "\" port=\"173\">\n"
                + "        </LynxModule>\n"
                + "    </LynxUsbDevice>\n"
                + "    <Webcam name=\"" + name + "\" serialNumber=\"SN" + counter + "\" />\n"
                + "</Robot>\n";
        try {
            File file = Files.createTempFile("sandbot-vision", ".xml").toFile();
            file.deleteOnExit();
            try (Writer w = new OutputStreamWriter(Files.newOutputStream(file.toPath()), StandardCharsets.UTF_8)) {
                w.write(xml);
            }
            mapOut[0] = SandbotHardware.create(file);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        Camera c = new Camera(name);
        c.model = model;
        cameras.add(c);
        return c;
    }

    static Map<String, Object> outputs(Camera c) {
        return Sim.devices().get(c.device).outputs();
    }

    static void advance(double seconds) {
        CLOCK.advanceTo(CLOCK.nanos + Math.round(seconds * 1e9));
    }

    static void advanceTo(long nanos) {
        if (nanos > CLOCK.nanos) CLOCK.advanceTo(nanos);
    }

    /** 평평한 tags 목록(ids 순서, 태그마다 꼭짓점 8개) */
    static List<Object> tags(int[] ids, double[] corners) {
        List<Object> out = new ArrayList<>();
        for (int i = 0; i < ids.length; i++) {
            out.add((long) ids[i]);
            for (int k = 0; k < 8; k++) out.add(corners[i * 8 + k]);
        }
        return out;
    }

    static List<String> noticesSince(int start) {
        return new ArrayList<>(HOST.notices.subList(start, HOST.notices.size()));
    }

    static List<String> warningsSince(int start) {
        List<String> out = new ArrayList<>();
        for (String l : HOST.logs.subList(start, HOST.logs.size())) if (l.contains("W/GlobalWarning: ")) out.add(l.substring(l.indexOf("W/GlobalWarning: ") + 17));
        return out;
    }
}
