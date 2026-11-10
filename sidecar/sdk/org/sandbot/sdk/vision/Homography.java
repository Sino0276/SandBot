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
// Copyright (C) 2000, Intel Corporation, all rights reserved.
// Copyright (C) 2013, OpenCV Foundation, all rights reserved.
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
// SandBot: OpenCV 4.10.0 modules/calib3d/src/fundam.cpp(sha256 10f8c9f3…8ff1)의 findHomography(method 0)와
// HomographyEstimatorCallback::runKernel(정규화 DLT, cv::eigen)·HomographyRefineCallback, compat_ptsetreg.cpp의
// cvFindHomography(C 래퍼: method 0, threshold 3, maxIters 2000, 결과가 비면 H를 0으로)를 옮겼다(spec-4d §1.12). 두 점 집합은
// CV_32F로 바꾼 뒤 푼다(fundam.cpp:391). LM 다듬기 10회는 점이 4개보다 많을 때만이다(:413).
package org.sandbot.sdk.vision;

/** OpenCV findHomography(method 0)와 C 래퍼. */
final class Homography {
    private Homography() {}

    /** fundam.cpp:52 scaleFor(double) */
    private static double scaleFor(double x) {
        return StrictMath.abs(x) > Lapack.FLT_EPSILON ? 1. / x : 1.;
    }

    /**
     * cvFindHomography(src 2n, dst 2n, double): H(3×3 행 우선). runKernel이 실패하면(점이 한 축으로 퍼지지 않음) 0으로 채운다.
     */
    static double[] cvFindHomography(double[] src, double[] dst, int npoints) {
        // p.reshape(2, npoints).convertTo(m, CV_32F)
        float[] M = new float[2 * npoints];
        float[] m = new float[2 * npoints];
        for (int i = 0; i < 2 * npoints; i++) {
            M[i] = (float) src[i];
            m[i] = (float) dst[i];
        }
        double[] H = runKernel(M, m, npoints);
        if (H == null) return new double[9];
        if (npoints > 4) {
            // compressElems(마스크가 모두 1이라 그대로) → LMSolver(HomographyRefineCallback, 10) → H·scaleFor(H22)
            LevMarq.run((x, err, J) -> refine(M, m, npoints, x, err, J), H, npoints * 2, 10);
            double s = scaleFor(H[8]);
            for (int i = 0; i < 9; i++) H[i] = H[i] * s;
        }
        return H;
    }

    /** fundam.cpp HomographyEstimatorCallback::runKernel: 정규화 DLT. 실패하면 null */
    private static double[] runKernel(float[] M, float[] m, int count) {
        double cmx = 0;
        double cmy = 0;
        double cMx = 0;
        double cMy = 0;
        for (int i = 0; i < count; i++) {
            cmx += m[2 * i];
            cmy += m[2 * i + 1];
            cMx += M[2 * i];
            cMy += M[2 * i + 1];
        }
        cmx /= count;
        cmy /= count;
        cMx /= count;
        cMy /= count;
        double smx = 0;
        double smy = 0;
        double sMx = 0;
        double sMy = 0;
        for (int i = 0; i < count; i++) {
            smx += StrictMath.abs(m[2 * i] - cmx);
            smy += StrictMath.abs(m[2 * i + 1] - cmy);
            sMx += StrictMath.abs(M[2 * i] - cMx);
            sMy += StrictMath.abs(M[2 * i + 1] - cMy);
        }
        if (StrictMath.abs(smx) < Lapack.DBL_EPSILON || StrictMath.abs(smy) < Lapack.DBL_EPSILON
                || StrictMath.abs(sMx) < Lapack.DBL_EPSILON || StrictMath.abs(sMy) < Lapack.DBL_EPSILON)
            return null;
        smx = count / smx;
        smy = count / smy;
        sMx = count / sMx;
        sMy = count / sMy;
        double[] invHnorm = {1. / smx, 0, cmx, 0, 1. / smy, cmy, 0, 0, 1};
        double[] Hnorm2 = {sMx, 0, -cMx * sMx, 0, sMy, -cMy * sMy, 0, 0, 1};
        double[] LtL = new double[81];
        for (int i = 0; i < count; i++) {
            double x = (m[2 * i] - cmx) * smx;
            double y = (m[2 * i + 1] - cmy) * smy;
            double X = (M[2 * i] - cMx) * sMx;
            double Y = (M[2 * i + 1] - cMy) * sMy;
            double[] Lx = {X, Y, 1, 0, 0, 0, -x * X, -x * Y, -x};
            double[] Ly = {0, 0, 0, X, Y, 1, -y * X, -y * Y, -y};
            for (int j = 0; j < 9; j++)
                for (int k = j; k < 9; k++) LtL[j * 9 + k] += Lx[j] * Lx[k] + Ly[j] * Ly[k];
        }
        // completeSymm(위 → 아래)
        for (int j = 0; j < 9; j++) for (int k = 0; k < j; k++) LtL[j * 9 + k] = LtL[k * 9 + j];
        double[] W = new double[9];
        double[] V = new double[81];
        Lapack.jacobi(LtL, 9, W, V);
        double[] H0 = new double[9];
        System.arraycopy(V, 72, H0, 0, 9);
        double[] Htemp = Lapack.mul(invHnorm, H0, 3, 3, 3);
        H0 = Lapack.mul(Htemp, Hnorm2, 3, 3, 3);
        double s = scaleFor(H0[8]);
        for (int i = 0; i < 9; i++) H0[i] = H0[i] * s;
        return H0;
    }

    /** fundam.cpp HomographyRefineCallback::compute */
    private static void refine(float[] M, float[] m, int count, double[] h, double[] err, double[] J) {
        for (int i = 0; i < count; i++) {
            double Mx = M[2 * i];
            double My = M[2 * i + 1];
            double ww = h[6] * Mx + h[7] * My + h[8];
            ww = StrictMath.abs(ww) > Lapack.DBL_EPSILON ? 1. / ww : 0;
            double xi = (h[0] * Mx + h[1] * My + h[2]) * ww;
            double yi = (h[3] * Mx + h[4] * My + h[5]) * ww;
            err[i * 2] = xi - m[2 * i];
            err[i * 2 + 1] = yi - m[2 * i + 1];
            if (J != null) {
                int o = i * 18;
                for (int k = 0; k < 18; k++) J[o + k] = 0;
                J[o] = Mx * ww;
                J[o + 1] = My * ww;
                J[o + 2] = ww;
                J[o + 6] = -Mx * ww * xi;
                J[o + 7] = -My * ww * xi;
                J[o + 8] = -ww * xi;
                J[o + 12] = Mx * ww;
                J[o + 13] = My * ww;
                J[o + 14] = ww;
                J[o + 15] = -Mx * ww * yi;
                J[o + 16] = -My * ww * yi;
                J[o + 17] = -ww * yi;
            }
        }
    }
}
