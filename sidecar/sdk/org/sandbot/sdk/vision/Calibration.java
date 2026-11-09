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
// SandBot: OpenCV 4.10.0 modules/calib3d/src/calibration.cpp(sha256 fbbd22d1…fe30)에서 SDK solvePnP가 쓰는 것만 옮겼다
// (spec-4d §1.12): cvRodrigues2(:252, 야코비 포함), cvProjectPoints2Internal(:522, 왜곡 계수가 모두 0인 경로 — SDK는 빈
// MatOfDouble을 넘기고 projectPoints는 0 다섯 개로 채운다), cvFindExtrinsicCameraParams2(:1152, 평면 호모그래피·비평면 DLT
// 초기값과 CvLevMarq 다듬기). 왜곡이 0이면 왜곡·기울기 항은 정확히 더하기 0·곱하기 1이라 값이 같은 식으로 줄였다.
package org.sandbot.sdk.vision;

/** OpenCV calibration.cpp의 Rodrigues·투영·외부 파라미터 추정(double). */
final class Calibration {
    private Calibration() {}

    /**
     * cvRodrigues2(:252) 벡터 → 행렬. r(3) → R(3×3 행 우선). jacobian(3×9, null 가능): 행 i = dR/dr_i(R 원소 행 우선).
     */
    static double[] rodriguesToMatrix(double[] rv, double[] jacobian) {
        double[] R = new double[9];
        double[] J = new double[27];
        double rx = rv[0];
        double ry = rv[1];
        double rz = rv[2];
        double theta = StrictMath.sqrt(rx * rx + ry * ry + rz * rz);
        if (theta < Lapack.DBL_EPSILON) {
            R[0] = R[4] = R[8] = 1;
            if (jacobian != null) {
                J[5] = J[15] = J[19] = -1;
                J[7] = J[11] = J[21] = 1;
            }
        } else {
            double c = StrictMath.cos(theta);
            double s = StrictMath.sin(theta);
            double c1 = 1. - c;
            double itheta = theta != 0 ? 1. / theta : 0.;
            rx *= itheta;
            ry *= itheta;
            rz *= itheta;
            double[] rrt = {rx * rx, rx * ry, rx * rz, rx * ry, ry * ry, ry * rz, rx * rz, ry * rz, rz * rz};
            double[] r_x = {0, -rz, ry, rz, 0, -rx, -ry, rx, 0};
            // R = cos(theta)*I + (1 - cos(theta))*r*rT + sin(theta)*[r_x]
            double[] I = {1, 0, 0, 0, 1, 0, 0, 0, 1};
            for (int k = 0; k < 9; k++) R[k] = c * I[k] + c1 * rrt[k] + s * r_x[k];
            if (jacobian != null) {
                double[] drrt = {rx + rx, ry, rz, ry, 0, 0, rz, 0, 0,
                    0, rx, 0, rx, ry + ry, rz, 0, rz, 0,
                    0, 0, rx, 0, 0, ry, rx, ry, rz + rz};
                double[] d_r_x_ = {0, 0, 0, 0, 0, -1, 0, 1, 0,
                    0, 0, 1, 0, 0, 0, -1, 0, 0,
                    0, -1, 0, 1, 0, 0, 0, 0, 0};
                for (int i = 0; i < 3; i++) {
                    double ri = i == 0 ? rx : i == 1 ? ry : rz;
                    double a0 = -s * ri;
                    double a1 = (s - 2 * c1 * itheta) * ri;
                    double a2 = c1 * itheta;
                    double a3 = (c - s * itheta) * ri;
                    double a4 = s * itheta;
                    for (int k = 0; k < 9; k++)
                        J[i * 9 + k] = a0 * I[k] + a1 * rrt[k] + a2 * drrt[i * 9 + k] + a3 * r_x[k] + a4 * d_r_x_[i * 9 + k];
                }
            }
        }
        if (jacobian != null) System.arraycopy(J, 0, jacobian, 0, 27);
        return R;
    }

    /** cvRodrigues2(:252) 행렬 → 벡터(야코비 없이). 범위 밖([-100, 100] 밖·비유한)이면 0 벡터(cvRodrigues2가 0을 돌려줌). */
    static double[] rodriguesToVector(double[] src) {
        for (double v : src) {
            // checkRange(R, true, NULL, -100, 100)
            if (!(v >= -100 && v < 100)) return new double[3];
        }
        Lapack.Svd svd = Lapack.svd(src, 3, 3);
        double[] R = Lapack.mul(svd.u, svd.vt, 3, 3, 3);
        double rx = R[7] - R[5];
        double ry = R[2] - R[6];
        double rz = R[3] - R[1];
        double s = StrictMath.sqrt((rx * rx + ry * ry + rz * rz) * 0.25);
        double c = (R[0] + R[4] + R[8] - 1) * 0.5;
        c = c > 1. ? 1. : c < -1. ? -1. : c;
        double theta = StrictMath.acos(c);
        if (s < 1e-5) {
            double t;
            if (c > 0) {
                rx = ry = rz = 0;
            } else {
                t = (R[0] + 1) * 0.5;
                rx = StrictMath.sqrt(Math.max(t, 0.));
                t = (R[4] + 1) * 0.5;
                ry = StrictMath.sqrt(Math.max(t, 0.)) * (R[1] < 0 ? -1. : 1.);
                t = (R[8] + 1) * 0.5;
                rz = StrictMath.sqrt(Math.max(t, 0.)) * (R[2] < 0 ? -1. : 1.);
                if (StrictMath.abs(rx) < StrictMath.abs(ry) && StrictMath.abs(rx) < StrictMath.abs(rz)
                        && (R[5] > 0) != (ry * rz > 0))
                    rz = -rz;
                theta /= StrictMath.sqrt(rx * rx + ry * ry + rz * rz);
                rx *= theta;
                ry *= theta;
                rz *= theta;
            }
        } else {
            double vth = 1 / (2 * s);
            vth *= theta;
            rx *= vth;
            ry *= vth;
            rz *= vth;
        }
        return new double[] {rx, ry, rz};
    }

    /**
     * cvProjectPoints2Internal(:522)의 double 경로(왜곡 0, 화면비 고정 없음). M: 물체 점(3n), r·t, K: fx·fy·cx·cy. 결과 m(2n),
     * dpdr·dpdt(2n×3 행 우선, null 가능: 행 2i = x, 2i+1 = y).
     */
    static double[] projectPoints(double[] M, int count, double[] rvec, double[] tvec, double fx, double fy, double cx,
            double cy, double[] dpdr, double[] dpdt) {
        double[] dRdr = new double[27];
        double[] R = rodriguesToMatrix(rvec, dRdr);
        double[] t = tvec;
        double[] m = new double[2 * count];
        for (int i = 0; i < count; i++) {
            double X = M[3 * i];
            double Y = M[3 * i + 1];
            double Z = M[3 * i + 2];
            double x = R[0] * X + R[1] * Y + R[2] * Z + t[0];
            double y = R[3] * X + R[4] * Y + R[5] * Z + t[1];
            double z = R[6] * X + R[7] * Y + R[8] * Z + t[2];
            z = z != 0 ? 1. / z : 1;
            x *= z;
            y *= z;
            // 왜곡 0: cdist = icdist2 = 1, xd = x, yd = y, 기울기 행렬은 단위(값이 바뀌지 않는다)
            m[2 * i] = x * fx + cx;
            m[2 * i + 1] = y * fy + cy;
            if (dpdt != null) {
                double[] dxdt = {z, 0, -x * z};
                double[] dydt = {0, z, -y * z};
                for (int j = 0; j < 3; j++) {
                    dpdt[(2 * i) * 3 + j] = fx * dxdt[j];
                    dpdt[(2 * i + 1) * 3 + j] = fy * dydt[j];
                }
            }
            if (dpdr != null) {
                double[] dx0dr = {X * dRdr[0] + Y * dRdr[1] + Z * dRdr[2], X * dRdr[9] + Y * dRdr[10] + Z * dRdr[11],
                    X * dRdr[18] + Y * dRdr[19] + Z * dRdr[20]};
                double[] dy0dr = {X * dRdr[3] + Y * dRdr[4] + Z * dRdr[5], X * dRdr[12] + Y * dRdr[13] + Z * dRdr[14],
                    X * dRdr[21] + Y * dRdr[22] + Z * dRdr[23]};
                double[] dz0dr = {X * dRdr[6] + Y * dRdr[7] + Z * dRdr[8], X * dRdr[15] + Y * dRdr[16] + Z * dRdr[17],
                    X * dRdr[24] + Y * dRdr[25] + Z * dRdr[26]};
                for (int j = 0; j < 3; j++) {
                    double dxdr = z * (dx0dr[j] - x * dz0dr[j]);
                    double dydr = z * (dy0dr[j] - y * dz0dr[j]);
                    dpdr[(2 * i) * 3 + j] = fx * dxdr;
                    dpdr[(2 * i + 1) * 3 + j] = fy * dydr;
                }
            }
        }
        return m;
    }

    /** CV_CheckGE(count, 6, …)(:1280) 실패 */
    static final class TooFewPointsForDlt extends RuntimeException {
        private static final long serialVersionUID = 1L;
        final int count;

        TooFewPointsForDlt(int count) {
            this.count = count;
        }
    }

    /**
     * cvFindExtrinsicCameraParams2(:1152, useExtrinsicGuess 없음, 왜곡 없음). M: 물체 점 3n(double), mImg: 영상 점 2n(double),
     * K: fx·fy·cx·cy. 결과 {rx, ry, rz, tx, ty, tz}.
     */
    static double[] findExtrinsicCameraParams(double[] M, double[] mImg, int count, double fx, double fy, double cx,
            double cy) {
        final int maxIter = 20;
        double[] param = new double[6];
        // normalize image points(cvUndistortPoints(_m, _mn, A, 0, 0, Ar = I): 왜곡 없음 → (u − cx)·(1/fx), P = I)
        double ifx = 1. / fx;
        double ify = 1. / fy;
        double[] mn = new double[2 * count];
        for (int i = 0; i < count; i++) {
            double x = (mImg[2 * i] - cx) * ifx;
            double y = (mImg[2 * i + 1] - cy) * ify;
            // RR = PP·RR = I: xx = 1*x + 0*y + 0, ww = 1/(0*x + 0*y + 1)
            double xx = 1 * x + 0 * y + 0;
            double yy = 0 * x + 1 * y + 0;
            double ww = 1. / (0 * x + 0 * y + 1);
            mn[2 * i] = xx * ww;
            mn[2 * i + 1] = yy * ww;
        }
        // Mc = cvAvg(matM): 채널마다 합 × (1/count)(cv::mean)
        double[] Mc = new double[3];
        for (int i = 0; i < count; i++) for (int j = 0; j < 3; j++) Mc[j] += M[3 * i + j];
        double scale = 1. / count;
        for (int j = 0; j < 3; j++) Mc[j] *= scale;
        // cvMulTransposed(matM, MM, 1, Mc): (M − Mc)ᵀ(M − Mc)
        double[] MM = new double[9];
        for (int i = 0; i < 3; i++) {
            for (int j = i; j < 3; j++) {
                double s = 0;
                for (int k = 0; k < count; k++) s += (M[3 * k + i] - Mc[i]) * (M[3 * k + j] - Mc[j]);
                MM[i * 3 + j] = s;
                MM[j * 3 + i] = s;
            }
        }
        // cvSVD(MM, W, 0, V, MODIFY_A + V_T): V = vt
        Lapack.Svd svdMM = Lapack.svd(MM, 3, 3);
        double[] W = svdMM.w;
        double[] V = svdMM.vt.clone();
        double[] R = new double[9];
        if (W[2] / W[1] < 1e-3) {
            // a planar structure case (all M's lie in the same plane)
            double[] Rt = V;
            if (V[2] * V[2] + V[5] * V[5] < 1e-10) {
                for (int k = 0; k < 9; k++) Rt[k] = k % 4 == 0 ? 1 : 0;
            }
            if (Lapack.det3(Rt) < 0) for (int k = 0; k < 9; k++) Rt[k] *= -1;
            // T = −R·Mcᵀ(cvGEMM(R, Mc, -1, 0, 0, T, B_T))
            double[] T = new double[3];
            for (int i = 0; i < 3; i++) T[i] = -1 * (Rt[3 * i] * Mc[0] + Rt[3 * i + 1] * Mc[1] + Rt[3 * i + 2] * Mc[2]);
            double[] Mxy = new double[2 * count];
            for (int i = 0; i < count; i++) {
                double s0 = M[3 * i];
                double s1 = M[3 * i + 1];
                double s2 = M[3 * i + 2];
                Mxy[2 * i] = Rt[0] * s0 + Rt[1] * s1 + Rt[2] * s2 + T[0];
                Mxy[2 * i + 1] = Rt[3] * s0 + Rt[4] * s1 + Rt[5] * s2 + T[1];
            }
            double[] h = Homography.cvFindHomography(Mxy, mn, count);
            boolean finite = true;
            for (double v : h) if (Double.isNaN(v) || Double.isInfinite(v)) finite = false;
            if (finite) {
                double h1Norm = StrictMath.sqrt(h[0] * h[0] + h[3] * h[3] + h[6] * h[6]);
                double h2Norm = StrictMath.sqrt(h[1] * h[1] + h[4] * h[4] + h[7] * h[7]);
                double s1 = 1. / Math.max(h1Norm, Lapack.DBL_EPSILON);
                double s2 = 1. / Math.max(h2Norm, Lapack.DBL_EPSILON);
                double s3 = 2. / Math.max(h1Norm + h2Norm, Lapack.DBL_EPSILON);
                for (int i = 0; i < 3; i++) {
                    h[3 * i] *= s1;
                    h[3 * i + 1] *= s2;
                }
                double[] tt = {h[2] * s3, h[5] * s3, h[8] * s3};
                // cvCrossProduct(h1, h2, h3)
                h[2] = h[3] * h[7] - h[6] * h[4];
                h[5] = h[6] * h[1] - h[0] * h[7];
                h[8] = h[0] * h[4] - h[3] * h[1];
                double[] r = rodriguesToVector(h);
                double[] H = rodriguesToMatrix(r, null);
                // cvMatMulAdd(H, T, t, t): t = H·T + t
                for (int i = 0; i < 3; i++) tt[i] = (H[3 * i] * T[0] + H[3 * i + 1] * T[1] + H[3 * i + 2] * T[2]) + tt[i];
                R = Lapack.mul(H, Rt, 3, 3, 3);
                param[3] = tt[0];
                param[4] = tt[1];
                param[5] = tt[2];
            } else {
                R[0] = R[4] = R[8] = 1;
                param[3] = param[4] = param[5] = 0;
            }
            double[] r = rodriguesToVector(R);
            param[0] = r[0];
            param[1] = r[1];
            param[2] = r[2];
        } else {
            // non-planar structure. Use DLT method
            if (count < 6) throw new TooFewPointsForDlt(count);
            double[] L = new double[2 * count * 12];
            for (int i = 0; i < count; i++) {
                int o = i * 24;
                double x = -mn[2 * i];
                double y = -mn[2 * i + 1];
                double Mx = M[3 * i];
                double My = M[3 * i + 1];
                double Mz = M[3 * i + 2];
                L[o] = L[o + 16] = Mx;
                L[o + 1] = L[o + 17] = My;
                L[o + 2] = L[o + 18] = Mz;
                L[o + 3] = L[o + 19] = 1.;
                L[o + 8] = x * Mx;
                L[o + 9] = x * My;
                L[o + 10] = x * Mz;
                L[o + 11] = x;
                L[o + 20] = y * Mx;
                L[o + 21] = y * My;
                L[o + 22] = y * Mz;
                L[o + 23] = y;
            }
            double[] LL = Lapack.mulTransposedAtA(L, 2 * count, 12);
            Lapack.Svd svdL = Lapack.svd(LL, 12, 12);
            double[] RRt = new double[12];
            System.arraycopy(svdL.vt, 11 * 12, RRt, 0, 12);
            double[] RR = {RRt[0], RRt[1], RRt[2], RRt[4], RRt[5], RRt[6], RRt[8], RRt[9], RRt[10]};
            double[] tt = {RRt[3], RRt[7], RRt[11]};
            if (Lapack.det3(RR) < 0) {
                for (int k = 0; k < 9; k++) RR[k] *= -1;
                for (int k = 0; k < 3; k++) tt[k] *= -1;
            }
            double sc = Lapack.norm(RR);
            if (!(StrictMath.abs(sc) > Lapack.DBL_EPSILON)) throw new IllegalStateException("fabs(sc) > DBL_EPSILON");
            // cvSVD(RR, W, U, V, MODIFY_A + U_T + V_T) → matR = Uᵀᵀ·V... cvGEMM(U, V, 1, 0, 0, R, A_T): R = (Uᵀ)ᵀ·Vt = U·Vt
            Lapack.Svd svdR = Lapack.svd(RR, 3, 3);
            R = Lapack.mul(svdR.u, svdR.vt, 3, 3, 3);
            double k = Lapack.norm(R) / sc;
            param[3] = tt[0] * k;
            param[4] = tt[1] * k;
            param[5] = tt[2] * k;
            double[] r = rodriguesToVector(R);
            param[0] = r[0];
            param[1] = r[1];
            param[2] = r[2];
        }

        // refine extrinsic parameters using iterative algorithm
        LevMarq.CvLevMarq solver = new LevMarq.CvLevMarq(6, count * 2, maxIter, Lapack.FLT_EPSILON);
        System.arraycopy(param, 0, solver.param, 0, 6);
        double[] dpdr = new double[2 * count * 3];
        double[] dpdt = new double[2 * count * 3];
        for (;;) {
            LevMarq.Update u = solver.update();
            System.arraycopy(u.param, 0, param, 0, 6);
            if (!u.proceed || u.err == null) break;
            double[] r = {param[0], param[1], param[2]};
            double[] t = {param[3], param[4], param[5]};
            double[] proj;
            if (u.J != null) {
                proj = projectPoints(M, count, r, t, fx, fy, cx, cy, dpdr, dpdt);
                for (int i = 0; i < 2 * count; i++) {
                    for (int j = 0; j < 3; j++) {
                        u.J[i * 6 + j] = dpdr[i * 3 + j];
                        u.J[i * 6 + 3 + j] = dpdt[i * 3 + j];
                    }
                }
            } else {
                proj = projectPoints(M, count, r, t, fx, fy, cx, cy, null, null);
            }
            for (int i = 0; i < 2 * count; i++) u.err[i] = proj[i] - mImg[i];
        }
        System.arraycopy(solver.param, 0, param, 0, 6);
        return param;
    }
}
