/*M///////////////////////////////////////////////////////////////////////////////////////
 //
 //  IMPORTANT: READ BEFORE DOWNLOADING, COPYING, INSTALLING OR USING.
 //
 //  By downloading, copying, installing or using the software you agree to this license.
 //  If you do not agree to this license, do not download, install,
 //  copy or use the software.
 //
 //
 //                           License Agreement
 //                For Open Source Computer Vision Library
 //
 // Copyright (C) 2000-2008, Intel Corporation, all rights reserved.
 // Copyright (C) 2009, Willow Garage Inc., all rights reserved.
 // Third party copyrights are property of their respective owners.
 //
 // Redistribution and use in source and binary forms, with or without modification,
 // are permitted provided that the following conditions are met:
 //
 //   * Redistribution's of source code must retain the above copyright notice,
 //     this list of conditions and the following disclaimer.
 //
 //   * Redistribution's in binary form must reproduce the above copyright notice,
 //     this list of conditions and the following disclaimer in the documentation
 //     and/or other materials provided with the distribution.
 //
 //   * The name of the copyright holders may not be used to endorse or promote products
 //     derived from this software without specific prior written permission.
 //
 // This software is provided by the copyright holders and contributors "as is" and
 // any express or implied warranties, including, but not limited to, the implied
 // warranties of merchantability and fitness for a particular purpose are disclaimed.
 // In no event shall the Intel Corporation or contributors be liable for any direct,
 // indirect, incidental, special, exemplary, or consequential damages
 // (including, but not limited to, procurement of substitute goods or services;
 // loss of use, data, or profits; or business interruption) however caused
 // and on any theory of liability, whether in contract, strict liability,
 // or tort (including negligence or otherwise) arising in any way out of
 // the use of this software, even if advised of the possibility of such damage.
 //
 //M*/
// SandBot: OpenCV 4.10.0 modules/calib3d/src/solvepnp.cpp의 solvePnP·solvePnPGeneric(:805)과
// modules/calib3d/src/undistort.dispatch.cpp(sha256 ea1431c7…5358)의 undistortPoints(왜곡 없음: (u − cx)·(1/fx), 출력은 입력과
// 같은 float)를 옮겼다(spec-4d §1.12). SDK AprilTagProcessorImpl이 부르는 꼴(MatOfPoint3f·MatOfPoint2f·CV_32F 카메라 행렬·빈
// 왜곡·CV_32F rvec/tvec·useExtrinsicGuess false)만 다룬다. 결과 rvec·tvec는 미리 만든 CV_32F에 convertTo하므로 float로 자른다
// (:131–134). 오류는 OpenCV Java 래퍼처럼 org.opencv.core.CvException("cv::Exception: " + what())이다. 줄 번호는 4.10.0
// 소스의 줄이고 경로는 안드로이드 .so에 박힌 /home/ci/opencv/…다 [가정: OpenCV 오류 문구의 줄 번호, spec-4d §0].
// SQPNP는 ITERATIVE로 대신한다 [가정: 대체 solver, spec-4d §0](잡음이 없으면 같은 값, 알림은 AprilTagProcessorImpl이 낸다).
package org.sandbot.sdk.vision;

import org.opencv.core.CvException;
import org.sandbot.sim.SimUnsupportedException;

/** SDK가 쓰는 Calib3d.solvePnP·Rodrigues의 순수 Java 판(OpenCV 4.10.0을 옮김). */
public final class Pnp {
    private Pnp() {}

    /** Calib3d.SOLVEPNP_*(OpenCV 4.10.0 calib3d.hpp SolvePnPMethod) */
    public static final int SOLVEPNP_ITERATIVE = 0;
    public static final int SOLVEPNP_EPNP = 1;
    public static final int SOLVEPNP_P3P = 2;
    public static final int SOLVEPNP_DLS = 3;
    public static final int SOLVEPNP_UPNP = 4;
    public static final int SOLVEPNP_AP3P = 5;
    public static final int SOLVEPNP_IPPE = 6;
    public static final int SOLVEPNP_IPPE_SQUARE = 7;
    public static final int SOLVEPNP_SQPNP = 8;

    /** 안드로이드 libopencv_java4.so에 박힌 소스 경로(글자로 확인, spec-4d §1.12) */
    private static final String SOURCE_ROOT = "/home/ci/opencv/modules/";

    /** cv::Exception::formatMessage 꼴의 what()을 OpenCV Java 래퍼처럼 CvException("cv::Exception: " + what())으로 */
    static CvException cvException(String file, int line, int code, String codeName, String message, String function) {
        return new CvException("cv::Exception: OpenCV(4.10.0) " + SOURCE_ROOT + file + ":" + line + ": error: (" + code
                + ":" + codeName + ") " + message + " in function '" + function + "'\n");
    }

    /**
     * Calib3d.solvePnP(MatOfPoint3f, MatOfPoint2f, cameraMatrix CV_32F, 빈 MatOfDouble, rvec CV_32F, tvec CV_32F, false, flags).
     *
     * @param objectPoints 물체 점 3n(float, MatOfPoint3f)
     * @param imagePoints 영상 점 2n(float, MatOfPoint2f)
     * @param camera fx·fy·cx·cy(float, CV_32F 카메라 행렬)
     * @param rvec 결과(3, 해가 있을 때만 쓴다)
     * @param tvec 결과(3, 해가 있을 때만 쓴다)
     * @return 해가 있는가(solvePnP의 반환값)
     * @throws CvException OpenCV가 던지는 예외(같은 문구)
     */
    public static boolean solvePnP(float[] objectPoints, float[] imagePoints, float[] camera, int flags, float[] rvec,
            float[] tvec) {
        int npoints = objectPoints.length / 3;
        if (!((npoints >= 4 || (npoints >= 3 && flags == SOLVEPNP_SQPNP)) && npoints == imagePoints.length / 2)) {
            throw cvException("calib3d/src/solvepnp.cpp", 823, -215, "Assertion failed",
                    "( (npoints >= 4) || (npoints == 3 && flags == SOLVEPNP_ITERATIVE && useExtrinsicGuess) || "
                            + "(npoints >= 3 && flags == SOLVEPNP_SQPNP) ) && npoints == std::max(ipoints.checkVector(2, "
                            + "CV_32F), ipoints.checkVector(2, CV_64F))",
                    "solvePnPGeneric");
        }
        // Mat cameraMatrix = Mat_<double>(cameraMatrix0)
        double fx = camera[0];
        double fy = camera[1];
        double cx = camera[2];
        double cy = camera[3];
        double[] r = null;
        double[] t = null;
        if (flags == SOLVEPNP_EPNP || flags == SOLVEPNP_DLS || flags == SOLVEPNP_UPNP) {
            // DLS·UPNP는 OpenCV가 EPnP로 대신한다(:850–857)
            float[] undistorted = undistortPoints(imagePoints, fx, fy, cx, cy);
            double[][] pose = new Epnp(fx, fy, cx, cy, objectPoints, undistorted, npoints).computePose();
            r = Calibration.rodriguesToVector(pose[0]);
            t = pose[1];
        } else if (flags == SOLVEPNP_P3P || flags == SOLVEPNP_AP3P) {
            throw new SimUnsupportedException("org.opencv.calib3d.Calib3d#solvePnP (SOLVEPNP_P3P/AP3P)");
        } else if (flags == SOLVEPNP_ITERATIVE || flags == SOLVEPNP_SQPNP) {
            double[] M = new double[3 * npoints];
            for (int i = 0; i < M.length; i++) M[i] = objectPoints[i];
            double[] m = new double[2 * npoints];
            for (int i = 0; i < m.length; i++) m[i] = imagePoints[i];
            double[] param;
            try {
                param = Calibration.findExtrinsicCameraParams(M, m, npoints, fx, fy, cx, cy);
            } catch (Calibration.TooFewPointsForDlt e) {
                throw checkFailed("calib3d/src/calibration.cpp", 1280,
                        "void cvFindExtrinsicCameraParams2(const CvMat*, const CvMat*, const CvMat*, const CvMat*, CvMat*, "
                                + "CvMat*, int)'\n> DLT algorithm needs at least 6 points for pose estimation from 3D-2D "
                                + "point correspondences. (expected: 'count >= 6'), where\n>     'count' is " + e.count
                                + "\n> must be greater than or equal to\n>     '6' is 6\n");
            }
            r = new double[] {param[0], param[1], param[2]};
            t = new double[] {param[3], param[4], param[5]};
        } else if (flags == SOLVEPNP_IPPE || flags == SOLVEPNP_IPPE_SQUARE) {
            if (flags == SOLVEPNP_IPPE_SQUARE && npoints != 4) {
                throw cvException("calib3d/src/solvepnp.cpp", 939, -215, "Assertion failed", "npoints == 4",
                        "solvePnPGeneric");
            }
            float[] undistorted = undistortPoints(imagePoints, fx, fy, cx, cy);
            try {
                Ippe.Result res = flags == SOLVEPNP_IPPE ? Ippe.solveGeneric(objectPoints, undistorted, npoints)
                        : Ippe.solveSquare(objectPoints, undistorted, npoints);
                // solvePnPGeneric: reprojErr1 < reprojErr2면 1이 먼저, 아니면(같아도) 2가 먼저
                if (res.err1 < res.err2) {
                    r = res.r1;
                    t = res.t1;
                } else {
                    r = res.r2;
                    t = res.t2;
                }
            } catch (Ippe.IppeError e) {
                // catch (...) {}: 해 0개
                return false;
            }
        } else {
            throw cvException("calib3d/src/solvepnp.cpp", 1044, -5, "Bad argument",
                    "The flags argument must be one of SOLVEPNP_ITERATIVE, SOLVEPNP_P3P, SOLVEPNP_EPNP, SOLVEPNP_DLS, "
                            + "SOLVEPNP_UPNP, SOLVEPNP_AP3P, SOLVEPNP_IPPE, SOLVEPNP_IPPE_SQUARE or SOLVEPNP_SQPNP",
                    "solvePnPGeneric");
        }
        // rvecs[0].convertTo(rvec, CV_32F)
        for (int i = 0; i < 3; i++) {
            rvec[i] = (float) r[i];
            tvec[i] = (float) t[i];
        }
        return true;
    }

    /** CV_CheckGE 꼴 문구(cv::detail::check_failed_*: 함수 이름 뒤에 줄바꿈과 설명이 붙는다) */
    private static CvException checkFailed(String file, int line, String functionAndDetail) {
        return new CvException("cv::Exception: OpenCV(4.10.0) " + SOURCE_ROOT + file + ":" + line
                + ": error: (-2:Unspecified error) in function '" + functionAndDetail);
    }

    /** undistortPoints(왜곡 없음, R·P 없음): x = (u − cx)·(1/fx), 출력은 입력과 같은 float(undistort.dispatch.cpp:385·597) */
    static float[] undistortPoints(float[] src, double fx, double fy, double cx, double cy) {
        double ifx = 1. / fx;
        double ify = 1. / fy;
        float[] dst = new float[src.length];
        for (int i = 0; i < src.length / 2; i++) {
            double x = src[2 * i];
            double y = src[2 * i + 1];
            x = (x - cx) * ifx;
            y = (y - cy) * ify;
            // RR = I: xx = 1*x + 0*y + 0, ww = 1/(0*x + 0*y + 1)
            double xx = 1 * x + 0 * y + 0;
            double yy = 0 * x + 1 * y + 0;
            double ww = 1. / (0 * x + 0 * y + 1);
            dst[2 * i] = (float) (xx * ww);
            dst[2 * i + 1] = (float) (yy * ww);
        }
        return dst;
    }

    /**
     * Calib3d.Rodrigues(rvec CV_32F 3×1 → R CV_32F 3×3): double로 계산해 float로 자른다(cv::Rodrigues가 dst를 src 깊이로 만들고
     * cvRodrigues2가 Mat(R).convertTo).
     */
    public static float[] rodrigues(float[] rvec) {
        double[] R = Calibration.rodriguesToMatrix(new double[] {rvec[0], rvec[1], rvec[2]}, null);
        float[] out = new float[9];
        for (int i = 0; i < 9; i++) out[i] = (float) R[i];
        return out;
    }
}
