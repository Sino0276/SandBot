package org.sandbot.sdk.vision;

import org.opencv.core.CvException;
import org.sandbot.runtime.Json;
import org.sandbot.testing.Check;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * PnP 이식 대 OpenCV 4.10.0(spec-4d 시험 B5·B16): sidecar/tests/fixtures/vision/pnp-reference.json(scripts/vision-pnp-oracle.py가
 * 실제 OpenCV로 만든 기준값)의 모든 경우를 같은 입력으로 푼다. 작업 폴더는 저장소 루트(support.ts runProcess).
 */
public final class PnpTest {
    private PnpTest() {}

    private static final String FIXTURE = "sidecar/tests/fixtures/vision/pnp-reference.json";
    /** 이동 허용 오차(in, 같은 단위: METER·MM 경우는 그 단위) — spec-4d B5 */
    private static final double T_TOL = 1e-4;
    /** R 원소 허용 오차 — spec-4d B5 */
    private static final double R_TOL = 1e-5;

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> cases() throws Exception {
        String text = new String(Files.readAllBytes(Paths.get(FIXTURE)), StandardCharsets.UTF_8);
        Map<String, Object> root = (Map<String, Object>) Json.parse(text);
        return (List<Map<String, Object>>) root.get("cases");
    }

    static float[] floats(Object list) {
        List<?> l = (List<?>) list;
        float[] out = new float[l.size()];
        for (int i = 0; i < out.length; i++) out[i] = ((Number) l.get(i)).floatValue();
        return out;
    }

    static double[] doubles(Object list) {
        List<?> l = (List<?>) list;
        double[] out = new double[l.size()];
        // null = NaN(IPPE 묶음에서 OpenCV rot2vec의 acos가 정의역 밖이면 rvec가 NaN이다)
        for (int i = 0; i < out.length; i++) out[i] = l.get(i) == null ? Double.NaN : ((Number) l.get(i)).doubleValue();
        return out;
    }

    /** 차이(둘 다 NaN이면 0, 하나만 NaN이면 무한대) */
    static double diff(double a, double b) {
        if (Double.isNaN(a) && Double.isNaN(b)) return 0;
        if (Double.isNaN(a) || Double.isNaN(b)) return Double.POSITIVE_INFINITY;
        return Math.abs(a - b);
    }

    private static double scale(double[] t) {
        return Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]);
    }

    @SuppressWarnings("unchecked")
    public static void testAllReferenceCases() throws Exception {
        List<String> failures = new ArrayList<>();
        int matched = 0;
        int epnpBad = 0;
        int errors = 0;
        int noSolution = 0;
        for (Map<String, Object> c : cases()) {
            String name = (String) c.get("name");
            String kind = (String) c.get("kind");
            int flags = ((Number) c.get("flags")).intValue();
            float[] obj = floats(c.get("object"));
            float[] img = floats(c.get("image"));
            float[] cam = floats(c.get("camera"));
            float[] rvec = new float[3];
            float[] tvec = new float[3];
            boolean ok;
            try {
                ok = Pnp.solvePnP(obj, img, cam, flags, rvec, tvec);
            } catch (CvException e) {
                if (!kind.equals("error")) {
                    failures.add(name + ": unexpected " + e.getMessage());
                    continue;
                }
                // 파이썬 cv2.error 문구 → OpenCV Java 래퍼(안드로이드 .so 경로) 문구
                String python = (String) c.get("error");
                String expected = "cv::Exception: " + python.replace("/io/opencv/", "/home/ci/opencv/");
                if (!expected.equals(e.getMessage())) failures.add(name + ": message\n" + e.getMessage() + "\nexpected\n" + expected);
                errors++;
                continue;
            }
            if (kind.equals("error")) {
                failures.add(name + ": expected an OpenCV error");
                continue;
            }
            if (kind.equals("noSolution")) {
                if (ok) failures.add(name + ": expected no solution");
                else noSolution++;
                continue;
            }
            if (!ok) {
                failures.add(name + ": no solution");
                continue;
            }
            float[] R = Pnp.rodrigues(rvec);
            if (kind.equals("epnpBad")) {
                double[] truth = doubles(((Map<String, Object>) c.get("truth")).get("t"));
                double err = 0;
                for (int i = 0; i < 3; i++) err = Math.max(err, Math.abs(tvec[i] - truth[i]));
                if (!(err / scale(truth) > 0.01)) failures.add(name + ": EPnP should be off by more than 1 % (" + err + ")");
                else epnpBad++;
                continue;
            }
            double[] et = doubles(c.get("tvec"));
            double[] eR = doubles(c.get("R"));
            double dt = 0;
            double dR = 0;
            double[] er = doubles(c.get("rvec"));
            for (int i = 0; i < 3; i++) dt = Math.max(dt, diff(tvec[i], et[i]));
            // rvec는 NaN 여부만 같아야 한다(값은 R로 본다)
            for (int i = 0; i < 3; i++) if (Double.isNaN(er[i]) != Double.isNaN(rvec[i])) dR = Double.POSITIVE_INFINITY;
            for (int i = 0; i < 9; i++) dR = Math.max(dR, diff(R[i], eR[i]));
            if (dt > T_TOL || dR > R_TOL) {
                failures.add(name + ": t " + Arrays.toString(tvec) + " vs " + Arrays.toString(et) + " (" + dt + "), R " + dR);
                continue;
            }
            if (kind.equals("ippeWrong") && c.containsKey("truth")) {
                double[] truth = doubles(((Map<String, Object>) c.get("truth")).get("t"));
                double err = 0;
                for (int i = 0; i < 3; i++) err = Math.max(err, Math.abs(tvec[i] - truth[i]));
                if (!(err / scale(truth) > 0.01)) failures.add(name + ": IPPE should reproduce the wrong OpenCV value");
            }
            matched++;
        }
        Check.isTrue(failures.isEmpty(), failures.size() + " failures:\n" + String.join("\n", failures));
        Check.isTrue(matched >= 150, "matched " + matched);
        Check.isTrue(epnpBad >= 10, "epnpBad " + epnpBad);
        Check.isTrue(errors >= 4, "errors " + errors);
        Check.isTrue(noSolution >= 1, "noSolution " + noSolution);
        System.out.println("RESULT pnp matched=" + matched + " epnpBad=" + epnpBad + " errors=" + errors
                + " noSolution=" + noSolution);
    }

    /** 결과는 float(CV_32F rvec·tvec에 convertTo)이고 Rodrigues 결과도 float다(spec-4d B5 float 자르기) */
    public static void testFloatTruncation() throws Exception {
        Map<String, Object> c = cases().get(0);
        float[] rvec = new float[3];
        float[] tvec = new float[3];
        Check.isTrue(Pnp.solvePnP(floats(c.get("object")), floats(c.get("image")), floats(c.get("camera")), 0, rvec, tvec),
                "solved");
        double[] et = doubles(c.get("tvec"));
        double[] er = doubles(c.get("rvec"));
        // 기준값은 float32 값을 double로 쓴 것이다: 같은 값이면 비트로 같다
        int same = 0;
        for (int i = 0; i < 3; i++) {
            if (Float.floatToIntBits(tvec[i]) == Float.floatToIntBits((float) et[i])) same++;
            if (Float.floatToIntBits(rvec[i]) == Float.floatToIntBits((float) er[i])) same++;
            Check.isTrue((double) (float) et[i] == et[i], "fixture values are float32");
        }
        System.out.println("RESULT bitIdentical=" + same + "/6");
    }

    /** B16: 묶음 ITERATIVE 16점·EPNP 4점 풀이 1000번의 중앙값(기록만) */
    @SuppressWarnings("unchecked")
    public static void testPerformance() throws Exception {
        Map<String, Object> cluster = null;
        Map<String, Object> single = null;
        for (Map<String, Object> c : cases()) {
            String name = (String) c.get("name");
            if (name.equals("appendixB apriltag cluster ITERATIVE")) cluster = c;
            if (name.equals("appendixB apriltag single35 EPNP")) single = c;
        }
        Check.isTrue(cluster != null && single != null, "performance cases");
        double iter = median(cluster, 0);
        double epnp = median(single, 1);
        System.out.println("RESULT perfIterative16Ms=" + iter + " perfEpnp4Ms=" + epnp);
        // CI 상한(관대): 기록이 목적이다
        Check.isTrue(iter < 50 && epnp < 50, "PnP too slow: " + iter + " / " + epnp);
    }

    private static double median(Map<String, Object> c, int flags) {
        float[] obj = floats(c.get("object"));
        float[] img = floats(c.get("image"));
        float[] cam = floats(c.get("camera"));
        float[] r = new float[3];
        float[] t = new float[3];
        for (int i = 0; i < 100; i++) Pnp.solvePnP(obj, img, cam, flags, r, t);
        double[] ms = new double[1000];
        for (int i = 0; i < ms.length; i++) {
            long start = System.nanoTime();
            Pnp.solvePnP(obj, img, cam, flags, r, t);
            ms[i] = (System.nanoTime() - start) / 1e6;
        }
        Arrays.sort(ms);
        return ms[ms.length / 2];
    }
}
