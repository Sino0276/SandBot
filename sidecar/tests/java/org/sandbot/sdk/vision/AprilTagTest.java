package org.sandbot.sdk.vision;

import com.qualcomm.robotcore.hardware.HardwareMap;

import org.firstinspires.ftc.robotcore.external.matrices.VectorF;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.CameraCalibration;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.VendorProductCalibrationIdentity;
import org.firstinspires.ftc.vision.VisionPortal;
import org.firstinspires.ftc.vision.apriltag.AprilTagClusterDetection;
import org.firstinspires.ftc.vision.apriltag.AprilTagClusterMemberMetadata;
import org.firstinspires.ftc.vision.apriltag.AprilTagClusterMetadata;
import org.firstinspires.ftc.vision.apriltag.AprilTagDetection;
import org.firstinspires.ftc.vision.apriltag.AprilTagGameDatabase;
import org.firstinspires.ftc.vision.apriltag.AprilTagLibrary;
import org.firstinspires.ftc.vision.apriltag.AprilTagProcessor;
import org.firstinspires.ftc.vision.apriltag.AprilTagSingleDetection;
import org.opencv.core.CvException;
import org.sandbot.sdk.devices.SandbotCameraCalibrations;
import org.sandbot.testing.Check;

import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** AprilTagProcessorImpl: 렌즈 값 대체·묶음·순서·값·정지·팀 보정(spec-4d B6·B7·B8·B14) */
public final class AprilTagTest {
    private AprilTagTest() {}

    static double[] appendixCorners;

    /** 부록 B 장면(빨강 관중석 묶음 34–37, C920 640×480)의 apriltag 3 좌표 꼭짓점(기준값 고정물) */
    @SuppressWarnings("unchecked")
    static synchronized double[] appendixCorners() {
        if (appendixCorners == null) {
            try {
                for (Map<String, Object> c : PnpTest.cases()) {
                    if (c.get("name").equals("appendixB apriltag cluster ITERATIVE")) appendixCorners = PnpTest.doubles(c.get("image"));
                }
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
        return appendixCorners;
    }

    static VisionHarness.Tags appendixTags() {
        return (t, w, h, d) -> VisionHarness.tags(new int[] {34, 35, 36, 37}, appendixCorners());
    }

    /** ids 중 일부만 보이는 프레임(부록 B 꼭짓점에서 고른다; 모르는 id는 그 태그 자리를 빌린다) */
    static VisionHarness.Tags someTags(int[] ids, int[] fromSlots) {
        double[] all = appendixCorners();
        double[] corners = new double[ids.length * 8];
        for (int i = 0; i < ids.length; i++) System.arraycopy(all, fromSlots[i] * 8, corners, i * 8, 8);
        return (t, w, h, d) -> VisionHarness.tags(ids, corners);
    }

    static VisionPortal streaming(VisionHarness.Camera cam, HardwareMap map, AprilTagProcessor tag, int w, int h) {
        VisionPortal portal = new VisionPortal.Builder().setCamera(map.get(org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName.class, cam.device))
                .enableLiveView(false).setCameraResolution(new android.util.Size(w, h)).addProcessor(tag).build();
        VisionPortalTest.waitFor(portal, VisionPortal.CameraState.STREAMING, 2);
        return portal;
    }

    static ArrayList<AprilTagDetection> nextDetections(AprilTagProcessor tag) {
        tag.getFreshDetections();
        for (int i = 0; i < 100; i++) {
            VisionHarness.advance(0.005);
            ArrayList<AprilTagDetection> fresh = tag.getFreshDetections();
            if (fresh != null) return fresh;
        }
        throw new AssertionError("no fresh detections");
    }

    static double field(Object processor, String name) throws Exception {
        Field f = org.firstinspires.ftc.vision.apriltag.AprilTagProcessorImpl.class.getDeclaredField(name);
        f.setAccessible(true);
        return f.getDouble(processor);
    }

    static void close(VisionPortal portal) {
        portal.close();
        VisionHarness.advance(0.4);
    }

    // ---- B7 렌즈 값 대체 ----

    static List<String> initWarnings(String model, int w, int h, AprilTagProcessor tag, double[] lens) throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, model);
        cam.tags = appendixTags();
        int logs = VisionHarness.HOST.logs.size();
        VisionPortal portal = streaming(cam, map[0], tag, w, h);
        nextDetections(tag);
        if (lens != null) {
            lens[0] = field(tag, "fx");
            lens[1] = field(tag, "fy");
            lens[2] = field(tag, "cx");
            lens[3] = field(tag, "cy");
        }
        close(portal);
        return VisionHarness.warningsSince(logs);
    }

    public static void testLensFallbacks() throws Exception {
        double[] lens = new double[4];
        Check.equal(new ArrayList<String>(), initWarnings("logitechC920", 640, 480, new AprilTagProcessor.Builder().build(), lens), "exact: no warning");
        Check.equal((double) 622.000977f, lens[0], "C920 640×480 fx");
        // 넷 모두 주면 그것(경고 없음), 하나라도 0이면 보정
        Check.equal(new ArrayList<String>(), initWarnings("lifecamHd3000", 1280, 720,
                new AprilTagProcessor.Builder().setLensIntrinsics(1000, 1001, 640, 360).build(), lens), "user lens");
        Check.equal(1000.0, lens[0], "user fx");
        initWarnings("logitechC920", 640, 480, new AprilTagProcessor.Builder().setLensIntrinsics(1000, 1001, 640, 0).build(), lens);
        Check.equal((double) 622.000977f, lens[0], "one zero → calibration");
        List<String> scaled = initWarnings("logitechC920", 1280, 720, new AprilTagProcessor.Builder().build(), lens);
        Check.equal(Arrays.asList("Camera has not been calibrated for [1280x720]; applying a scaled calibration from [1920x1080]."), scaled, "scaled warning");
        Check.equal((double) 923.946716f, lens[0], "scaled fx");
        List<String> placeholder = initWarnings("lifecamHd3000", 1280, 720, new AprilTagProcessor.Builder().build(), lens);
        Check.equal(Arrays.asList("Camera has not been calibrated for [1280x720]. Pose estimates will likely be inaccurate. However, there are built in calibrations for resolutions: [640x480],"), placeholder, "placeholder warning");
        Check.equal(578.272, lens[0], "fallback fx");
        Check.equal(640.0, lens[2], "cx w/2");
        Check.equal(360.0, lens[3], "cy h/2");
        VisionPortalTest.CountingInitTag counting = new VisionPortalTest.CountingInitTag();
        List<String> none = initWarnings(null, 640, 480, counting, lens);
        Check.equal(Arrays.asList("User did not provide a camera calibration, nor was a built-in calibration found for this camera. Pose estimates will likely be inaccurate."), none, "no model");
        Check.equal(null, counting.lastCalibration, "init calibration null without a model");
        Check.equal(new ArrayList<String>(), initWarnings("lifecamHd3000", 1280, 720,
                new AprilTagProcessor.Builder().setSuppressCalibrationWarnings(true).build(), lens), "suppressed");
    }

    // ---- B8 묶음·순서·값 ----

    public static void testClustersSinglesAndValues() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        // 모르는 id 5(라이브러리에 없음), 단일 태그 id 3(샘플 라이브러리에 있는지와 관계없이 자리를 빌림), 묶음 35·36
        cam.tags = someTags(new int[] {5, 35, 36}, new int[] {0, 1, 2});
        AprilTagProcessor tag = new AprilTagProcessor.Builder().build();
        Check.equal(0, tag.getPerTagAvgPoseSolveTime(), "no samples → 0");
        Check.isTrue(tag.getFreshDetections() != null, "fresh starts as the initial empty list");
        int n0 = VisionHarness.HOST.notices.size();
        VisionPortal portal = streaming(cam, map[0], tag, 640, 480);
        ArrayList<AprilTagDetection> dets = nextDetections(tag);
        Check.equal(2, dets.size(), "one cluster + one single");
        Check.isTrue(dets.get(0) instanceof AprilTagClusterDetection, "cluster first");
        AprilTagClusterDetection cluster = (AprilTagClusterDetection) dets.get(0);
        Check.equal("RED AUDIENCE", cluster.metadata.name, "cluster name");
        Check.equal(50, cluster.percentClusterFound, "2 of 4");
        AprilTagSingleDetection single = (AprilTagSingleDetection) dets.get(1);
        Check.equal(5, single.id, "unknown single");
        Check.equal(null, single.metadata, "no metadata");
        Check.equal(null, single.ftcPose, "no pose");
        Check.equal(0, single.hamming, "hamming 0");
        // center = 대각선 교점(꼭짓점 평균과 다름), decisionMargin = min(100, 2·짧은 변)
        double[] c = Arrays.copyOfRange(appendixCorners(), 0, 8);
        double mean = (c[0] + c[2] + c[4] + c[6]) / 4;
        Check.isTrue(Math.abs(single.center.x - mean) > 1e-6, "center is not the mean");
        double cross1 = (c[4] - c[0]) * (single.center.y - c[1]) - (c[5] - c[1]) * (single.center.x - c[0]);
        double cross2 = (c[6] - c[2]) * (single.center.y - c[3]) - (c[7] - c[3]) * (single.center.x - c[2]);
        Check.isTrue(Math.abs(cross1) < 1e-6 && Math.abs(cross2) < 1e-6, "center on both diagonals");
        double shortSide = Double.MAX_VALUE;
        for (int k = 0; k < 4; k++) shortSide = Math.min(shortSide, Math.hypot(c[(2 * k + 2) % 8] - c[2 * k], c[(2 * k + 3) % 8] - c[2 * k + 1]));
        Check.equal((float) Math.min(100, 2 * shortSide), single.decisionMargin, "decision margin");
        // ftcPose RBE = XYZ 식
        Check.near(Math.hypot(cluster.ftcPose.x, cluster.ftcPose.y), cluster.ftcPose.range, 1e-9, "range");
        Check.near(Math.toDegrees(Math.atan2(-cluster.ftcPose.x, cluster.ftcPose.y)), cluster.ftcPose.bearing, 1e-9, "bearing");
        Check.near(Math.toDegrees(Math.atan2(cluster.ftcPose.z, cluster.ftcPose.y)), cluster.ftcPose.elevation, 1e-9, "elevation");
        Check.isTrue(VisionHarness.noticesSince(n0).contains("aprilTagNoFieldPose {cluster=RED AUDIENCE}"), "no field pose notice");
        int count = 0;
        for (String n : VisionHarness.noticesSince(n0)) if (n.startsWith("aprilTagNoFieldPose")) count++;
        nextDetections(tag);
        int count2 = 0;
        for (String n : VisionHarness.noticesSince(n0)) if (n.startsWith("aprilTagNoFieldPose")) count2++;
        Check.equal(count, count2, "notice once per cluster");
        // percent 25·75·100
        cam.tags = someTags(new int[] {34}, new int[] {0});
        Check.equal(25, ((AprilTagClusterDetection) nextDetections(tag).get(0)).percentClusterFound, "25");
        cam.tags = someTags(new int[] {34, 35, 37}, new int[] {0, 1, 3});
        Check.equal(75, ((AprilTagClusterDetection) nextDetections(tag).get(0)).percentClusterFound, "75");
        cam.tags = appendixTags();
        AprilTagClusterDetection full = (AprilTagClusterDetection) nextDetections(tag).get(0);
        Check.equal(100, full.percentClusterFound, "100");
        Check.isTrue(full.frameAcquisitionNanoTime == cam.frames.get(cam.frames.size() - 1)
                || cam.frames.contains(full.frameAcquisitionNanoTime), "acquisition time = frame time");
        // 처리기를 끄면 목록이 그대로다
        portal.setProcessorEnabled(tag, false);
        ArrayList<AprilTagDetection> kept = tag.getDetections();
        VisionHarness.advance(0.3);
        Check.isTrue(tag.getDetections() == kept, "disabled keeps the list");
        portal.setProcessorEnabled(tag, true);
        close(portal);

        // 현재 게임 라이브러리에 같은 id 묶음은 setAllowOverwrite(true)여도 더할 수 없다(실제 문구)
        ArrayList<AprilTagClusterMemberMetadata> members = new ArrayList<>();
        for (int i = 0; i < 4; i++) members.add(new AprilTagClusterMemberMetadata(34 + i, new VectorF(i, 0, 0), 3.25));
        AprilTagClusterMetadata redAudience = new AprilTagClusterMetadata(members, "RED AUDIENCE", "RA",
                new VectorF(0, 0, 0), DistanceUnit.INCH, Quaternion.identityQuaternion());
        RuntimeException clash = Check.throwsType(RuntimeException.class, () -> new AprilTagLibrary.Builder()
                .addLibrary(AprilTagGameDatabase.getCurrentGameTagLibrary()).setAllowOverwrite(true).addCluster(redAudience), "clash");
        Check.equal("You attempted to add a tag cluster to the library that has clashing tag ids with another cluster in the library", clash.getMessage(), "message");
    }

    // ---- B6 정지·대체 solver ----

    static final String BUILTIN_MESSAGE = "cv::Exception: OpenCV(4.10.0) /home/ci/opencv/modules/calib3d/src/solvepnp.cpp:1044: error: (-5:Bad argument) The flags argument must be one of SOLVEPNP_ITERATIVE, SOLVEPNP_P3P, SOLVEPNP_EPNP, SOLVEPNP_DLS, SOLVEPNP_UPNP, SOLVEPNP_AP3P, SOLVEPNP_IPPE, SOLVEPNP_IPPE_SQUARE or SOLVEPNP_SQPNP in function 'solvePnPGeneric'\n";
    static final String SQUARE_MESSAGE = "cv::Exception: OpenCV(4.10.0) /home/ci/opencv/modules/calib3d/src/solvepnp.cpp:939: error: (-215:Assertion failed) npoints == 4 in function 'solvePnPGeneric'\n";

    static void expectStop(AprilTagProcessor.PoseSolver solver, VisionHarness.Tags tags, String message) {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        cam.tags = tags;
        AprilTagProcessor tag = new AprilTagProcessor.Builder().build();
        tag.setPoseSolver(solver);
        int n0 = VisionHarness.HOST.notices.size();
        int s0 = VisionHarness.HOST.stops.size();
        VisionPortal portal = streaming(cam, map[0], tag, 640, 480);
        ArrayList<AprilTagDetection> before = tag.getDetections();
        for (int i = 0; i < 40 && VisionHarness.HOST.stops.size() == s0; i++) VisionHarness.advance(0.005);
        Check.isTrue(VisionHarness.HOST.stops.size() > s0, "emergency stop for " + solver);
        Throwable cause = VisionHarness.HOST.stops.get(s0);
        Check.isTrue(cause instanceof CvException, "CvException");
        Check.equal(message, cause.getMessage(), "message");
        Check.isTrue(cause.toString().startsWith("CvException [org.opencv.core.CvException: cv::Exception: "), "toString " + cause);
        Check.isTrue(VisionHarness.noticesSince(n0).contains("visionSolverStop {solver=" + solver.name() + "}"), "stop notice");
        Check.isTrue(tag.getDetections() == before, "detections unchanged");
        close(portal);
    }

    public static void testSolverStops() throws Exception {
        expectStop(AprilTagProcessor.PoseSolver.APRILTAG_BUILTIN, appendixTags(), BUILTIN_MESSAGE);
        expectStop(AprilTagProcessor.PoseSolver.OPENCV_IPPE_SQUARE, someTags(new int[] {34, 35}, new int[] {0, 1}), SQUARE_MESSAGE);
        // IPPE_SQUARE + 멤버 하나는 멈추지 않는다(틀린 값)
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        cam.tags = someTags(new int[] {35}, new int[] {1});
        AprilTagProcessor tag = new AprilTagProcessor.Builder().build();
        tag.setPoseSolver(AprilTagProcessor.PoseSolver.OPENCV_IPPE_SQUARE);
        int s0 = VisionHarness.HOST.stops.size();
        VisionPortal portal = streaming(cam, map[0], tag, 640, 480);
        Check.equal(1, nextDetections(tag).size(), "one cluster detection");
        Check.equal(s0, VisionHarness.HOST.stops.size(), "no stop");
        close(portal);
    }

    public static void testSolverSubstitutionNotices() throws Exception {
        HardwareMap[] map = new HardwareMap[1];
        VisionHarness.Camera cam = VisionHarness.webcam(map, "logitechC920");
        // 샘플 라이브러리의 단일 태그(id 583) 자리에 부록 B 태그 35의 꼭짓점
        cam.tags = someTags(new int[] {583}, new int[] {1});
        AprilTagProcessor tag = new AprilTagProcessor.Builder().setTagLibrary(AprilTagGameDatabase.getSampleTagLibrary()).build();
        tag.setPoseSolver(AprilTagProcessor.PoseSolver.APRILTAG_BUILTIN);
        int n0 = VisionHarness.HOST.notices.size();
        VisionPortal portal = streaming(cam, map[0], tag, 640, 480);
        AprilTagSingleDetection single = (AprilTagSingleDetection) nextDetections(tag).get(0);
        Check.isTrue(single.ftcPose != null, "builtin single solved by ITERATIVE");
        tag.setPoseSolver(AprilTagProcessor.PoseSolver.OPENCV_SQPNP);
        nextDetections(tag);
        List<String> notices = VisionHarness.noticesSince(n0);
        Check.isTrue(notices.contains("visionSolverSubstituted {solver=APRILTAG_BUILTIN}"), "builtin notice " + notices);
        Check.isTrue(notices.contains("visionSolverSubstituted {solver=OPENCV_SQPNP}"), "sqpnp notice");
        Check.equal(0, tag.getPerTagAvgPoseSolveTime(), "0 ms per tag");
        close(portal);
    }

    // ---- B14 팀 보정 ----

    static File teamXml(String body) throws Exception {
        File file = Files.createTempFile("teamwebcamcalibrations", ".xml").toFile();
        file.deleteOnExit();
        Files.write(file.toPath(), body.getBytes(StandardCharsets.UTF_8));
        return file;
    }

    static CameraCalibration lookup(int vid, int pid, int w, int h) {
        return SandbotCameraCalibrations.getCalibration(new VendorProductCalibrationIdentity(vid, pid), w, h);
    }

    static String sizes(int vid, int pid) {
        StringBuilder s = new StringBuilder();
        for (CameraCalibration c : SandbotCameraCalibrations.calibrationsFor(new VendorProductCalibrationIdentity(vid, pid)))
            s.append(c.getSize().getWidth()).append('x').append(c.getSize().getHeight()).append(' ');
        return s.toString().trim();
    }

    public static void testTeamCalibrations() throws Exception {
        try {
            int n0 = VisionHarness.HOST.notices.size();
            VisionHarness.install();
            String eight = "1, 2, 3, 4, 5, 6, 7, 8";
            SandbotCameraCalibrations.reloadForTest(teamXml("<?xml version='1.0' encoding='utf-8'?>\n"
                    + "<CalibrationRoot>\n"
                    // 같은 크기 덮음 → 목록 끝으로(동점·Placeholder 목록 순서가 바뀐다)
                    + "  <CameraDevice VID=\"Logitech\" Pid=\"0x082D\">\n"
                    + "    <Calibration size=\"640 480\" focal_length=\"700f, 700f\" principal_point=\"320, 240\" distortion_coefficients=\"" + eight + "\" />\n"
                    + "    <Calibration size=\"640 360\" remove=\"true\" />\n"
                    // 5계수 왜곡 → 그 Calibration만 버림
                    + "    <Calibration size=\"320 180\" focalLength=\"300 300\" principalPoint=\"160 90\" distortionCoefficients=\"1 2 3 4 5\" />\n"
                    // 앞 공백 → 그 요소 버림
                    + "    <Calibration size=\" 160 120\" focalLength=\"150 150\" principalPoint=\"80 60\" />\n"
                    + "  </CameraDevice>\n"
                    + "  <Camera vid=\"Ausdom\" pid=\"0x1234\">\n"
                    + "    <Calibration size=\"640 480\" focalLength=\"500 500\" principalPoint=\"320 240\" />\n"
                    + "  </Camera>\n"
                    + "  <Camera vid=\"3034\" pid=\"0x1235\">\n"
                    + "    <Calibration size=\"640 480\" focalLength=\"501 501\" principalPoint=\"320 240\" />\n"
                    + "  </Camera>\n"
                    // 8진수 실패 → 그 Camera 버림(뒤의 Camera도 Calibrations가 일찍 끝나 무시된다, 실제와 같음)
                    + "  <Camera vid=\"Logitech\" pid=\"0825\" />\n"
                    + "</CalibrationRoot>\n"));
            Check.near(700.0, lookup(0x046D, 0x082D, 640, 480).focalLengthX, 1e-6, "overridden 640x480");
            Check.equal("800x600 1920x1080 800x448 864x480 640x480", sizes(0x046D, 0x082D), "moved to the end, 640x360 removed");
            Check.near(500.0, lookup(3034, 0x1234, 640, 480).focalLengthX, 1e-6, "vid by UsbConstants name");
            Check.near(501.0, lookup(3034, 0x1235, 640, 480).focalLengthX, 1e-6, "vid by number");
            List<String> notices = VisionHarness.noticesSince(n0);
            String all = String.join("\n", notices);
            Check.isTrue(all.contains("distortionCoefficients has 5 values (expected 8)"), "5 coefficients " + all);
            Check.isTrue(all.contains("size value \"\" is not an integer (leading whitespace?)"), "leading space " + all);
            Check.isTrue(all.contains("pid \"0825\" is not a valid number"), "octal pid " + all);

            // 문법 오류: 앞까지 남고 RobotLog.ee + notice
            int n1 = VisionHarness.HOST.notices.size();
            int l1 = VisionHarness.HOST.logs.size();
            SandbotCameraCalibrations.reloadForTest(teamXml("<Calibrations><Camera vid=\"Logitech\" pid=\"0x0825\">"
                    + "<Calibration size=\"640 480\" focalLength=\"900 900\" principalPoint=\"320 240\" /></Camera><Camera <<<"));
            Check.near(900.0, lookup(0x046D, 0x0825, 640, 480).focalLengthX, 1e-6, "kept before the syntax error");
            Check.isTrue(String.join("\n", VisionHarness.noticesSince(n1)).contains("XML syntax error"), "syntax notice");
            Check.isTrue(String.join("\n", VisionHarness.HOST.logs.subList(l1, VisionHarness.HOST.logs.size()))
                    .contains("failure parsing external camera calibrations XML; ignoring this calibration"), "RobotLog.ee");

            // DOCTYPE: 파일 거부
            int n2 = VisionHarness.HOST.notices.size();
            SandbotCameraCalibrations.reloadForTest(teamXml("<?xml version='1.0'?>\n<!DOCTYPE x [<!ENTITY e \"x\">]>\n"
                    + "<Calibrations><Camera vid=\"Logitech\" pid=\"0x0825\"><Calibration size=\"640 480\" focalLength=\"900 900\" principalPoint=\"320 240\" /></Camera></Calibrations>"));
            Check.near(822.317017, lookup(0x046D, 0x0825, 640, 480).focalLengthX, 1e-3, "builtin only");
            Check.isTrue(VisionHarness.noticesSince(n2).contains("visionCalibrationSkipped {detail=DOCTYPE is not allowed}"), "doctype notice");

            // 메인이 확인한 뒤 256 KB를 넘게 된 파일: 읽을 때 다시 보고 쓰지 않는다(내장만)
            int n3 = VisionHarness.HOST.notices.size();
            StringBuilder big = new StringBuilder("<Calibrations><Camera vid=\"Logitech\" pid=\"0x0825\">"
                    + "<Calibration size=\"640 480\" focalLength=\"900 900\" principalPoint=\"320 240\" /></Camera>");
            while (big.length() <= 256 * 1024) big.append("<!-- padding padding padding padding padding padding -->\n");
            big.append("</Calibrations>");
            SandbotCameraCalibrations.reloadForTest(teamXml(big.toString()));
            Check.near(822.317017, lookup(0x046D, 0x0825, 640, 480).focalLengthX, 1e-3, "too large: builtin only");
            Check.isTrue(String.join("\n", VisionHarness.noticesSince(n3)).contains("is not a regular file of at most 262144 bytes"),
                    "too large notice");
        } finally {
            SandbotCameraCalibrations.reloadForTest(null);
        }
    }
}
