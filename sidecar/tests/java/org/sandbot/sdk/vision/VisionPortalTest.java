package org.sandbot.sdk.vision;

import android.util.Size;

import com.qualcomm.robotcore.hardware.HardwareMap;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.ExposureControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.FocusControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.GainControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.PtzControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.WhiteBalanceControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.CameraControl;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.CameraCalibration;
import org.firstinspires.ftc.vision.VisionPortal;
import org.firstinspires.ftc.vision.VisionProcessor;
import org.firstinspires.ftc.vision.apriltag.AprilTagDetection;
import org.firstinspires.ftc.vision.apriltag.AprilTagProcessor;
import org.opencv.core.Mat;
import org.sandbot.testing.Check;

import android.graphics.Canvas;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** VisionPortalImpl 가상 시간 상태 기계·처리 시간·FPS·카메라 제어(spec-4d B3·B4·B11·B12·B15) */
public final class VisionPortalTest {
    private VisionPortalTest() {}

    static VisionPortal.Builder builder(VisionHarness.Camera cam, HardwareMap map) {
        return new VisionPortal.Builder()
                .setCamera(map.get(WebcamName.class, cam.device))
                .enableLiveView(false);
    }

    static String state(VisionHarness.Camera cam) {
        return (String) VisionHarness.outputs(cam).get("state");
    }

    /** 상태가 바뀌는 경계 시각(ns)을 기다린다: 바뀐 첫 경계를 돌려준다 */
    static long waitFor(VisionPortal portal, VisionPortal.CameraState state, double maxSeconds) {
        long end = VisionHarness.CLOCK.nanos + Math.round(maxSeconds * 1e9);
        while (portal.getCameraState() != state) {
            if (VisionHarness.CLOCK.nanos >= end) throw new AssertionError("state " + portal.getCameraState() + " (wanted " + state + ")");
            VisionHarness.CLOCK.advanceTo(VisionHarness.CLOCK.nanos + VisionHarness.TICK);
        }
        return VisionHarness.CLOCK.nanos;
    }

    public static void testStateMachineTimeline() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        AprilTagProcessor tag = new AprilTagProcessor.Builder().build();
        VisionHarness.advanceTo((VisionHarness.CLOCK.nanos / VisionHarness.TICK + 1) * VisionHarness.TICK);
        long t0 = VisionHarness.CLOCK.nanos;
        VisionPortal portal = builder(cam, map[0]).addProcessor(tag).build();
        Check.equal(VisionPortal.CameraState.OPENING_CAMERA_DEVICE, portal.getCameraState(), "opening");
        Check.equal("OPENING_CAMERA_DEVICE", state(cam), "output state");
        // 경계마다 상태를 본다: READY는 경계에서 보이지 않는다(autoStart는 같은 콜백에서 STARTING_STREAM)
        List<VisionPortal.CameraState> seen = new ArrayList<>();
        long starting = -1;
        long streaming = -1;
        while (portal.getCameraState() != VisionPortal.CameraState.STREAMING) {
            VisionHarness.advance(0.005);
            VisionPortal.CameraState s = portal.getCameraState();
            if (seen.isEmpty() || seen.get(seen.size() - 1) != s) seen.add(s);
            if (s == VisionPortal.CameraState.STARTING_STREAM && starting < 0) starting = VisionHarness.CLOCK.nanos;
            if (s == VisionPortal.CameraState.STREAMING) streaming = VisionHarness.CLOCK.nanos;
        }
        Check.isTrue(!seen.contains(VisionPortal.CameraState.CAMERA_DEVICE_READY), "READY at a boundary: " + seen);
        Check.equal(t0 + 1_000_000_000L, starting, "open 1.0 s");
        Check.equal(t0 + 1_500_000_000L, streaming, "start 0.5 s");
        Check.equal(Boolean.TRUE, VisionHarness.outputs(cam).get("streaming"), "streaming output");
        Check.equal(640, VisionHarness.outputs(cam).get("width"), "width");
        Check.equal("TAG_36h11", VisionHarness.outputs(cam).get("family"), "family");
        Check.equal(3.0, VisionHarness.outputs(cam).get("decimation"), "decimation");

        // 카메라 제어(B11): STREAMING에서만
        ExposureControl exposure = portal.getCameraControl(ExposureControl.class);
        Check.equal(ExposureControl.Mode.AperturePriority, exposure.getMode(), "exposure mode");
        Check.isTrue(exposure.isModeSupported(ExposureControl.Mode.Manual), "manual supported");
        Check.isTrue(!exposure.isModeSupported(ExposureControl.Mode.Auto), "auto unsupported");
        Check.equal(0L, exposure.getMinExposure(TimeUnit.MILLISECONDS), "min ms truncates");
        Check.equal(300L, exposure.getMinExposure(TimeUnit.MICROSECONDS), "min us");
        Check.equal(204L, exposure.getMaxExposure(TimeUnit.MILLISECONDS), "max ms");
        Check.equal(33L, exposure.getExposure(TimeUnit.MILLISECONDS), "initial 33.3 ms");
        Check.equal(null, VisionHarness.outputs(cam).get("exposureMs"), "exposureMs null unless manual");
        Check.isTrue(exposure.setMode(ExposureControl.Mode.Manual), "manual");
        Check.isTrue(exposure.setExposure(6, TimeUnit.MILLISECONDS), "set 6 ms");
        Check.isTrue(exposure.setExposure(1234, TimeUnit.MICROSECONDS), "set 1.234 ms");
        Check.equal(1200L, exposure.getExposure(TimeUnit.MICROSECONDS), "100 us floor");
        Check.isTrue(!exposure.setExposure(100, TimeUnit.MICROSECONDS), "below range");
        Check.near(1.2, ((Number) VisionHarness.outputs(cam).get("exposureMs")).doubleValue(), 1e-12, "exposureMs");
        GainControl gain = portal.getCameraControl(GainControl.class);
        Check.equal(0, gain.getMinGain(), "gain min");
        Check.equal(255, gain.getMaxGain(), "gain max");
        Check.isTrue(gain.setGain(77), "gain");
        Check.isTrue(!gain.setGain(256), "gain range");
        Check.equal(77, VisionHarness.outputs(cam).get("gain"), "gain output");
        Check.isTrue(portal.getCameraControl(FocusControl.class).setFocusLength(100), "focus");
        Check.equal(4000, portal.getCameraControl(WhiteBalanceControl.class).getWhiteBalanceTemperature(), "wb");
        Check.equal(100, portal.getCameraControl(PtzControl.class).getZoom(), "zoom");
        Check.isTrue(portal.getCameraControl(ExposureControl.class) == exposure, "one control per webcam");
        Check.equal(null, portal.getCameraControl(CameraControl.class), "unknown control type");

        // stop 0.3 s → READY, resume(형식 없음) → STARTING_STREAM에 머문다 + notice
        long stopAt = VisionHarness.CLOCK.nanos;
        portal.stopStreaming();
        Check.equal(VisionPortal.CameraState.STOPPING_STREAM, portal.getCameraState(), "stopping");
        long ready = waitFor(portal, VisionPortal.CameraState.CAMERA_DEVICE_READY, 1);
        Check.isTrue(ready - stopAt >= 300_000_000L && ready - stopAt < 305_000_000L, "stop 0.3 s: " + (ready - stopAt));
        Check.throwsType(IllegalStateException.class, () -> portal.getCameraControl(GainControl.class), "controls need STREAMING");
        int n0 = VisionHarness.HOST.notices.size();
        portal.resumeStreaming();
        Check.equal(VisionPortal.CameraState.STARTING_STREAM, portal.getCameraState(), "starting");
        VisionHarness.advance(2.0);
        Check.equal(VisionPortal.CameraState.STARTING_STREAM, portal.getCameraState(), "stays STARTING_STREAM without a format");
        Check.equal(Boolean.FALSE, VisionHarness.outputs(cam).get("streaming"), "no streaming");
        Check.isTrue(VisionHarness.noticesSince(n0).contains("visionResumeNullFormat"), "notice " + VisionHarness.noticesSince(n0));
        int frames = cam.frames.size();
        VisionHarness.advance(0.5);
        Check.equal(frames, cam.frames.size(), "no frames while stuck");
        portal.stopStreaming();
        Check.equal(VisionPortal.CameraState.STOPPING_STREAM, portal.getCameraState(), "stop from STARTING_STREAM");
        waitFor(portal, VisionPortal.CameraState.CAMERA_DEVICE_READY, 1);

        // close 0.3 s: 웹캠은 CLOSED에서 놓는다, 닫힌 뒤 close는 그대로, getFps 0, setProcessorEnabled → NPE
        long closeAt = VisionHarness.CLOCK.nanos;
        portal.close();
        Check.equal(VisionPortal.CameraState.CLOSING_CAMERA_DEVICE, portal.getCameraState(), "closing");
        Check.equal("CLOSING_CAMERA_DEVICE", state(cam), "still owned while closing");
        long closed = waitFor(portal, VisionPortal.CameraState.CAMERA_DEVICE_CLOSED, 1);
        Check.isTrue(closed - closeAt >= 300_000_000L && closed - closeAt < 305_000_000L, "close 0.3 s");
        Check.equal(null, state(cam), "released");
        portal.close();
        Check.equal(VisionPortal.CameraState.CAMERA_DEVICE_CLOSED, portal.getCameraState(), "close again");
        Check.equal(0f, portal.getFps(), "fps 0 when closed");
        Check.throwsType(NullPointerException.class, () -> portal.setProcessorEnabled(tag, false), "NPE after close");
        RuntimeException e = Check.throwsType(RuntimeException.class, portal::stopStreaming, "closed stop");
        Check.equal("Illegal CameraState CAMERA_DEVICE_CLOSED when calling stopStreaming()", e.getMessage(), "message");
        e = Check.throwsType(RuntimeException.class, portal::resumeStreaming, "closed resume");
        Check.equal("Illegal CameraState CAMERA_DEVICE_CLOSED when calling resumeStreaming()", e.getMessage(), "message");
    }

    /**
     * 처리 중에 close: 1920×1080 데시메이션 1은 처리 675 ms(100 ms × 6.75)로 닫기 0.3 s보다 길다. 닫힘은 그 프레임의 결과를 낸 뒤다
     * (EOCV closeCameraDevice가 프레임 작업을 끝낸다, spec-4d §1.10). 예전에는 닫힐 때 경계 듣기를 떼어 결과를 잃었다
     */
    public static void testCloseFinishesInFlightFrame() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        cam.tags = AprilTagTest.appendixTags();
        AprilTagProcessor tag = new AprilTagProcessor.Builder().build();
        tag.setDecimation(1);
        VisionPortal portal = builder(cam, map[0]).setCameraResolution(new Size(1920, 1080)).addProcessor(tag).build();
        waitFor(portal, VisionPortal.CameraState.STREAMING, 2);
        tag.getFreshDetections(); // 처음 빈 목록을 비운다
        int first = cam.frames.size();
        while (cam.frames.size() == first) VisionHarness.advance(0.005);
        long frameNanos = cam.frames.get(first);
        Check.equal(null, tag.getFreshDetections(), "still processing");
        long closeAt = VisionHarness.CLOCK.nanos;
        portal.close();
        long closed = waitFor(portal, VisionPortal.CameraState.CAMERA_DEVICE_CLOSED, 2);
        Check.isTrue(closed >= frameNanos + 675_000_000L,
                "closed after the frame finished: " + (closed - frameNanos));
        Check.isTrue(closed - closeAt >= 300_000_000L, "close at least 0.3 s");
        ArrayList<AprilTagDetection> fresh = tag.getFreshDetections();
        Check.isTrue(fresh != null && !fresh.isEmpty(), "in-flight frame published before CLOSED: " + fresh);
        Check.equal(frameNanos, fresh.get(0).frameAcquisitionNanoTime, "from that frame");
        Check.equal(null, state(cam), "released");
    }

    public static void testResumeWithFormatAndWaiting() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        VisionPortal portal = builder(cam, map[0]).setStreamFormat(VisionPortal.StreamFormat.YUY2)
                .addProcessor(new AprilTagProcessor.Builder().build()).build();
        // 열리는 중의 stop은 진행 중 전이(열기 → 스트림 시작)가 끝날 때까지 기다린다(세마포어), 끼어들기 플래그는 되살린다
        long called = VisionHarness.CLOCK.nanos;
        Thread.currentThread().interrupt();
        portal.stopStreaming();
        Check.isTrue(Thread.interrupted(), "interrupt flag restored");
        Check.isTrue(VisionHarness.CLOCK.nanos - called >= 1_500_000_000L, "waited for STREAMING");
        Check.equal(VisionPortal.CameraState.STOPPING_STREAM, portal.getCameraState(), "then stopping");
        waitFor(portal, VisionPortal.CameraState.CAMERA_DEVICE_READY, 1);
        long resumeAt = VisionHarness.CLOCK.nanos;
        portal.resumeStreaming();
        long streaming = waitFor(portal, VisionPortal.CameraState.STREAMING, 1);
        Check.isTrue(streaming - resumeAt >= 500_000_000L && streaming - resumeAt < 505_000_000L, "resume 0.5 s");
        portal.close();
        waitFor(portal, VisionPortal.CameraState.CAMERA_DEVICE_CLOSED, 1);
    }

    /** 같은 웹캠을 닫고 새 포털로 다시 열면 입력에 남은 이전 프레임을 처리하지 않는다(STREAMING 전에 본 프레임은 버린다, 새 스트림의 프레임부터) */
    public static void testReopenIgnoresStaleFrame() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        cam.tags = AprilTagTest.appendixTags();
        VisionPortal first = builder(cam, map[0]).addProcessor(new AprilTagProcessor.Builder().build()).build();
        waitFor(first, VisionPortal.CameraState.STREAMING, 2);
        VisionHarness.advance(0.2);
        Check.isTrue(!cam.frames.isEmpty(), "frames while the first portal streams");
        long staleFrame = cam.frames.get(cam.frames.size() - 1);
        first.close();
        waitFor(first, VisionPortal.CameraState.CAMERA_DEVICE_CLOSED, 1);
        CountingInitTag tag = new CountingInitTag();
        VisionPortal second = builder(cam, map[0]).addProcessor(tag).build();
        waitFor(second, VisionPortal.CameraState.STREAMING, 2);
        Check.equal(0f, second.getFps(), "no frame processed at the STREAMING boundary");
        Check.equal(0, tag.inits, "not initialised from the stale frame");
        ArrayList<AprilTagDetection> dets = AprilTagTest.nextDetections(tag);
        Check.isTrue(!dets.isEmpty() && dets.get(0).frameAcquisitionNanoTime > staleFrame, "first detections come from a new frame");
        Check.isTrue(second.getFps() > 0, "fps from new frames: " + second.getFps());
        second.close();
        VisionHarness.advance(0.4);
    }

    public static void testSameWebcamTwiceIsError() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        VisionPortal first = builder(cam, map[0]).build();
        VisionPortal second = builder(cam, map[0]).build();
        int logs = VisionHarness.HOST.logs.size();
        waitFor(second, VisionPortal.CameraState.ERROR, 2);
        Check.isTrue(String.join("\n", VisionHarness.HOST.logs.subList(logs, VisionHarness.HOST.logs.size())).contains("Camera opening failed."), "RobotLog.ee");
        RuntimeException e = Check.throwsType(RuntimeException.class, second::stopStreaming, "stop in ERROR");
        Check.equal("Illegal CameraState ERROR when calling stopStreaming()", e.getMessage(), "message");
        e = Check.throwsType(RuntimeException.class, second::resumeStreaming, "resume in ERROR");
        Check.equal("Illegal CameraState ERROR when calling resumeStreaming()", e.getMessage(), "message");
        waitFor(first, VisionPortal.CameraState.STREAMING, 2);
        Check.equal("STREAMING", state(cam), "first portal owns the webcam");
        first.close();
        second.close();
        waitFor(first, VisionPortal.CameraState.CAMERA_DEVICE_CLOSED, 1);
    }

    public static void testViewIds() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        HardwareMap m1 = map[0];
        VisionHarness.Camera cam2 = VisionHarness.webcam(map, "logitechC920");
        HardwareMap m = map[0];
        Check.equal(0x7F0A0000, VisionPortal.DEFAULT_VIEW_CONTAINER_ID, "default view id");
        VisionPortal a = new VisionPortal.Builder().setCamera(m.get(WebcamName.class, cam2.device)).build();
        IllegalStateException e = Check.throwsType(IllegalStateException.class,
                () -> new VisionPortal.Builder().setCamera(m.get(WebcamName.class, cam2.device)).build(), "default twice");
        Check.equal("When using multiple vision portals, you MUST use setLiveViewContainerId(int), NOT enableLiveView(bool)", e.getMessage(), "message");
        a.close(); // 뷰 id는 close를 부른 즉시 푼다
        VisionPortal b = new VisionPortal.Builder().setCamera(m1.get(WebcamName.class, cam.device)).build();
        b.close();
        IllegalArgumentException one = Check.throwsType(IllegalArgumentException.class,
                () -> VisionPortal.makeMultiPortalView(1, VisionPortal.MultiPortalLayout.VERTICAL), "n 1");
        Check.equal("Layout requested to be split for <2 viewports!", one.getMessage(), "n<2");
        Check.throwsType(NullPointerException.class, () -> VisionPortal.makeMultiPortalView(2, null), "layout null");
        int[] ids = VisionPortal.makeMultiPortalView(2, VisionPortal.MultiPortalLayout.HORIZONTAL);
        Check.equal(2, ids.length, "two ids");
        Check.isTrue(ids[0] != 0 && ids[1] != 0 && ids[0] != ids[1] && ids[0] != VisionPortal.DEFAULT_VIEW_CONTAINER_ID, "ids");
        RuntimeException twice = Check.throwsType(RuntimeException.class,
                () -> VisionPortal.makeMultiPortalView(2, VisionPortal.MultiPortalLayout.VERTICAL), "twice");
        Check.equal("Viewport container specified by user is not empty!", twice.getMessage(), "twice message");
        VisionHarness.advance(0.4);
    }

    /** 처리기 init 횟수를 센다 */
    static final class CountingProcessor implements VisionProcessor {
        int inits;
        int frames;

        @Override public void init(int width, int height, CameraCalibration calibration) {
            inits++;
        }

        @Override public Object processFrame(Mat frame, long captureTimeNanos) {
            frames++;
            return null;
        }

        @Override public void onDrawFrame(Canvas canvas, int onscreenWidth, int onscreenHeight, float scaleBmpPxToCanvasPx,
                float scaleCanvasDensity, Object userContext) {
        }
    }

    /** 결과가 처음 바뀐 경계 − 프레임 시각, 정상 상태 FPS(B4) */
    static double[] latencyAndFps(String model, int width, int height, float decimation, boolean enabled) {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, model);
        cam.tags = AprilTagTest.appendixTags();
        AprilTagProcessor tag = new AprilTagProcessor.Builder().build();
        if (decimation != 3) tag.setDecimation(decimation);
        VisionPortal portal = builder(cam, map[0]).setCameraResolution(new Size(width, height)).addProcessor(tag).build();
        if (!enabled) portal.setProcessorEnabled(tag, false);
        waitFor(portal, VisionPortal.CameraState.STREAMING, 2);
        ArrayList<AprilTagDetection> initial = tag.getDetections();
        long latency = -1;
        int first = cam.frames.size();
        for (int i = 0; i < 200 && latency < 0; i++) {
            VisionHarness.advance(0.005);
            if (tag.getDetections() != initial && cam.frames.size() > first) latency = VisionHarness.CLOCK.nanos - cam.frames.get(first);
        }
        VisionHarness.advance(3.0);
        double fps = portal.getFps();
        portal.close();
        VisionHarness.advance(0.4);
        return new double[] {latency / 1e6, fps};
    }

    public static void testProcessingTimeAndFps() throws Exception {
        double[] d3 = latencyAndFps("logitechC920", 640, 480, 3, true);
        Check.equal(25.0, d3[0], "d 3: 22 ms → next 5 ms boundary");
        Check.near(30.0, d3[1], 0.5, "d 3 FPS");
        double[] d2 = latencyAndFps("logitechC920", 640, 480, 2, true);
        Check.near(22.2, d2[1], 0.6, "d 2 FPS");
        double[] d1 = latencyAndFps("logitechC920", 640, 480, 1, true);
        Check.near(10.0, d1[1], 0.3, "d 1 FPS");
        double[] hd = latencyAndFps("logitechC920", 1280, 720, 3, true);
        Check.equal(70.0, hd[0], "1280×720 d 3: 66 ms → 70 ms boundary");
        Check.near(15.0, hd[1], 0.4, "1280×720 FPS");
        double[] off = latencyAndFps("logitechC920", 640, 480, 3, false);
        Check.equal(-1.0, off[0] < 0 ? -1.0 : off[0], "disabled processor keeps its list");
        Check.near(30.0, off[1], 0.5, "no AprilTag processor: frame rate");
        System.out.println("RESULT d3=" + d3[1] + " d2=" + d2[1] + " d1=" + d1[1] + " hd=" + hd[1]);
    }

    public static void testFpsRampAndInitOnce() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        CountingProcessor counting = new CountingProcessor();
        CountingInitTag tag = new CountingInitTag();
        int n0 = VisionHarness.HOST.notices.size();
        VisionPortal portal = builder(cam, map[0]).setStreamFormat(VisionPortal.StreamFormat.MJPEG)
                .addProcessors(tag, counting).build();
        Check.isTrue(VisionHarness.noticesSince(n0).contains("visionProcessorUnsupported {processor=" + CountingProcessor.class.getName() + "}"),
                "unsupported processor notice " + VisionHarness.noticesSince(n0));
        Check.equal(0f, portal.getFps(), "fps 0 before first frame");
        waitFor(portal, VisionPortal.CameraState.STREAMING, 2);
        int first = cam.frames.size();
        while (cam.frames.size() < first + 10) VisionHarness.advance(0.005);
        VisionHarness.advance(0.005);
        float after10 = portal.getFps();
        while (cam.frames.size() < first + 31) VisionHarness.advance(0.005);
        VisionHarness.advance(0.005);
        float after31 = portal.getFps();
        Check.isTrue(after10 > 8 && after10 < 16, "ramp after 10 frames: " + after10);
        Check.near(30.0, after31, 1.0, "after 31 frames");
        Check.equal(1, tag.inits, "init once");
        portal.stopStreaming();
        waitFor(portal, VisionPortal.CameraState.CAMERA_DEVICE_READY, 1);
        portal.resumeStreaming();
        waitFor(portal, VisionPortal.CameraState.STREAMING, 1);
        VisionHarness.advance(0.3);
        Check.equal(1, tag.inits, "init not again after resume");
        Check.equal(0, counting.inits + counting.frames, "other processors get nothing");
        int n1 = VisionHarness.HOST.notices.size();
        portal.saveNextFrameRaw("x");
        Check.isTrue(VisionHarness.noticesSince(n1).contains("visionFrameCapture {method=saveNextFrameRaw}"), "frame capture notice");
        portal.close();
        VisionHarness.advance(0.4);
    }

    /** AprilTag 처리기의 init 횟수를 센다 */
    static final class CountingInitTag extends org.firstinspires.ftc.vision.apriltag.AprilTagProcessorImpl {
        int inits;
        CameraCalibration lastCalibration;

        CountingInitTag() {
            this(org.firstinspires.ftc.vision.apriltag.AprilTagGameDatabase.getCurrentGameTagLibrary(), 0, 0, 0, 0, false);
        }

        CountingInitTag(org.firstinspires.ftc.vision.apriltag.AprilTagLibrary library, double fx, double fy, double cx, double cy,
                boolean suppress) {
            super(org.firstinspires.ftc.robotcore.external.matrices.OpenGLMatrix.identityMatrix(), fx, fy, cx, cy,
                    org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit.INCH,
                    org.firstinspires.ftc.robotcore.external.navigation.AngleUnit.DEGREES, library, true, false, true, true,
                    TagFamily.TAG_36h11, 3, suppress);
        }

        @Override public void init(int width, int height, CameraCalibration calibration) {
            inits++;
            lastCalibration = calibration;
            super.init(width, height, calibration);
        }
    }

    public static void testMultipleAprilTagProcessorsNotice() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        int n0 = VisionHarness.HOST.notices.size();
        VisionPortal portal = builder(cam, map[0]).addProcessors(new AprilTagProcessor.Builder().build(),
                new AprilTagProcessor.Builder().setTagFamily(AprilTagProcessor.TagFamily.TAG_25h9).build()).build();
        Check.isTrue(VisionHarness.noticesSince(n0).contains("visionMultipleAprilTag"), "notice");
        Map<String, Object> out = VisionHarness.outputs(cam);
        Check.equal("TAG_36h11", out.get("family"), "first processor family");
        portal.close();
        VisionHarness.advance(1.5);
    }
}
