// This file is part of OpenCV project.
// It is subject to the license terms in the LICENSE file found in the top-level directory
// of this distribution and at http://opencv.org/license.html

// This file is based on file issued with the following license:

/*============================================================================

Copyright 2017 Toby Collins
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may
   be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
// SandBot: OpenCV 4.10.0 modules/calib3d/src/ippe.cpp를 버그까지 그대로 옮겼다(spec-4d §1.12). 특히 rotateVec2ZAxis(:735)의
// 반평행 갈래는 회전이 아니라 반사 diag(1, 1, −1)이고, 첫 세 물체 점의 법선이 정확히 −z인 BIOBUZZ 묶음(z ≠ 0)에서는 두 해가 모두
// 틀린다(실제 OpenCV·실제 로봇도 같다). solveSquare는 원점 중심 정사각형의 H와 오프셋이 든 점의 이동 풀이를 섞는다. 오류는
// IppeError(실제 CV_Error StsNoConv)이고 solvePnPGeneric이 삼킨다.
package org.sandbot.sdk.vision;

/** OpenCV IPPE::PoseSolver와 HomographyHO. */
final class Ippe {
    private Ippe() {}

    /** ippe.cpp:41 IPPE_SMALL */
    private static final double IPPE_SMALL = 1e-3;

    /** CV_Error(StsNoConv, …)·CV_Assert(실제는 cv::Exception, solvePnPGeneric의 catch (...)가 삼킨다) */
    static final class IppeError extends RuntimeException {
        private static final long serialVersionUID = 1L;

        IppeError(String message) {
            super(message);
        }
    }

    /** 두 해(정렬됨): r1·t1이 재투영 오차가 작은 쪽 */
    static final class Result {
        double[] r1;
        double[] t1;
        float err1;
        double[] r2;
        double[] t2;
        float err2;
    }

    /**
     * ippe.cpp:44 solveGeneric(objectPoints CV_32FC3, imagePoints CV_32FC2(정규화 좌표)). obj: 3n(float 값), img: 2n(float 값).
     */
    static Result solveGeneric(float[] obj, float[] img, int n) {
        double[] normalized = new double[2 * n];
        for (int i = 0; i < 2 * n; i++) normalized[i] = img[i];
        double[] objD = new double[3 * n];
        for (int i = 0; i < 3 * n; i++) objD[i] = obj[i];
        if (n < 4) throw new IppeError("_objectPoints.rows() >= 4 || _objectPoints.cols() >= 4");
        double[] canonical = new double[2 * n];
        double[] mModelToCanonical = makeCanonicalObjectPoints(objD, n, canonical);
        double[] H = homographyHO(canonical, normalized, n);
        double[][] canon = solveCanonicalForm(canonical, normalized, n, H);
        double[] Ma = Lapack.mul(canon[0], mModelToCanonical, 4, 4, 4);
        double[] Mb = Lapack.mul(canon[1], mModelToCanonical, 4, 4, 4);
        return sorted(obj, normalized, n, Ma, Mb);
    }

    /** ippe.cpp:154 solveSquare(objectPoints CV_32FC3, imagePoints CV_32FC2) */
    static Result solveSquare(float[] obj, float[] img, int n) {
        double[] objectPoints2D = new double[8];
        for (int i = 0; i < 4; i++) {
            objectPoints2D[2 * i] = obj[3 * i];
            objectPoints2D[2 * i + 1] = obj[3 * i + 1];
        }
        // float 연산(Vec3f 원소끼리 빼고 곱하고 더한 뒤 sqrt(float))
        float dx = obj[3] - obj[0];
        float dy = obj[4] - obj[1];
        double squareLength = (float) StrictMath.sqrt((float) (dx * dx + dy * dy));
        double[] normalized = new double[2 * n];
        for (int i = 0; i < 2 * n; i++) normalized[i] = img[i];
        double[] H = homographyFromSquarePoints(normalized, squareLength / 2.0);
        double[][] canon = solveCanonicalForm(objectPoints2D, normalized, 4, H);
        return sorted(obj, normalized, n, canon[0], canon[1]);
    }

    private static Result sorted(float[] obj, double[] normalized, int n, double[] Ma, double[] Mb) {
        // sortPosesByReprojError
        float erra = evalReprojError(obj, normalized, n, Ma);
        float errb = evalReprojError(obj, normalized, n, Mb);
        double[] M1;
        double[] M2;
        Result r = new Result();
        if (erra < errb) {
            r.err1 = erra;
            M1 = Ma;
            r.err2 = errb;
            M2 = Mb;
        } else {
            r.err1 = errb;
            M1 = Mb;
            r.err2 = erra;
            M2 = Ma;
        }
        r.r1 = rot2vec(M1);
        r.r2 = rot2vec(M2);
        r.t1 = new double[] {M1[3], M1[7], M1[11]};
        r.t2 = new double[] {M2[3], M2[7], M2[11]};
        return r;
    }

    /** ippe.cpp:224 solveCanonicalForm: {Ma, Mb}(4×4 행 우선) */
    private static double[][] solveCanonicalForm(double[] canonicalObjPoints, double[] normalizedInputPoints, int n,
            double[] H) {
        double[] Ma = new double[16];
        double[] Mb = new double[16];
        Ma[15] = 1;
        Mb[15] = 1;
        // Compute the Jacobian J of the homography at (0,0):
        double j00 = H[0] - H[6] * H[2];
        double j01 = H[1] - H[7] * H[2];
        double j10 = H[3] - H[6] * H[5];
        double j11 = H[4] - H[7] * H[5];
        // Compute the transformation of (0,0) into the image:
        double v0 = H[2];
        double v1 = H[5];
        double[][] R = computeRotations(j00, j01, j10, j11, v0, v1);
        double[] ta = computeTranslation(canonicalObjPoints, normalizedInputPoints, n, R[0]);
        double[] tb = computeTranslation(canonicalObjPoints, normalizedInputPoints, n, R[1]);
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) {
                Ma[i * 4 + j] = R[0][i * 3 + j];
                Mb[i * 4 + j] = R[1][i * 3 + j];
            }
            Ma[i * 4 + 3] = ta[i];
            Mb[i * 4 + 3] = tb[i];
        }
        return new double[][] {Ma, Mb};
    }

    /** ippe.cpp:290 rot2vec(M의 왼쪽 위 3×3) */
    private static double[] rot2vec(double[] M) {
        double r00 = M[0];
        double r11 = M[5];
        double r22 = M[10];
        double trace = r00 + r11 + r22;
        double wNorm = StrictMath.acos((trace - 1.0) / 2.0);
        double eps = Lapack.FLT_EPSILON;
        double d = 1 / (2 * StrictMath.sin(wNorm)) * wNorm;
        double[] rvec = new double[3];
        if (wNorm < eps) {
            // rotation is the identity
            return rvec;
        }
        double c0 = M[9] - M[6];
        double c1 = M[2] - M[8];
        double c2 = M[4] - M[1];
        rvec[0] = d * c0;
        rvec[1] = d * c1;
        rvec[2] = d * c2;
        return rvec;
    }

    /** ippe.cpp:326 computeTranslation(objectPoints 2n, normalizedImgPoints 2n, R 3×3) */
    private static double[] computeTranslation(double[] objectPoints, double[] imgPoints, int n, double[] R) {
        double ATA00 = n;
        double ATA02 = 0;
        double ATA11 = n;
        double ATA12 = 0;
        double ATA20 = 0;
        double ATA21 = 0;
        double ATA22 = 0;
        double ATb0 = 0;
        double ATb1 = 0;
        double ATb2 = 0;
        for (int i = 0; i < n; i++) {
            double ox = objectPoints[2 * i];
            double oy = objectPoints[2 * i + 1];
            double rx = R[0] * ox + R[1] * oy;
            double ry = R[3] * ox + R[4] * oy;
            double rz = R[6] * ox + R[7] * oy;
            double a2 = -imgPoints[2 * i];
            double b2 = -imgPoints[2 * i + 1];
            ATA02 = ATA02 + a2;
            ATA12 = ATA12 + b2;
            ATA20 = ATA20 + a2;
            ATA21 = ATA21 + b2;
            ATA22 = ATA22 + a2 * a2 + b2 * b2;
            double bx = -a2 * rz - rx;
            double by = -b2 * rz - ry;
            ATb0 = ATb0 + bx;
            ATb1 = ATb1 + by;
            ATb2 = ATb2 + a2 * bx + b2 * by;
        }
        double detAInv = 1.0 / (ATA00 * ATA11 * ATA22 - ATA00 * ATA12 * ATA21 - ATA02 * ATA11 * ATA20);
        double S00 = ATA11 * ATA22 - ATA12 * ATA21;
        double S01 = ATA02 * ATA21;
        double S02 = -ATA02 * ATA11;
        double S10 = ATA12 * ATA20;
        double S11 = ATA00 * ATA22 - ATA02 * ATA20;
        double S12 = -ATA00 * ATA12;
        double S20 = -ATA11 * ATA20;
        double S21 = -ATA00 * ATA21;
        double S22 = ATA00 * ATA11;
        return new double[] {detAInv * (S00 * ATb0 + S01 * ATb1 + S02 * ATb2),
            detAInv * (S10 * ATb0 + S11 * ATb1 + S12 * ATb2), detAInv * (S20 * ATb0 + S21 * ATb1 + S22 * ATb2)};
    }

    /** ippe.cpp:405 computeRotations: {R1, R2} */
    private static double[][] computeRotations(double j00, double j01, double j10, double j11, double p, double q) {
        double[] Ra = rotateVec2ZAxis(p, q, 1);
        // Rv = Rv.t()
        double[] Rv = {Ra[0], Ra[3], Ra[6], Ra[1], Ra[4], Ra[7], Ra[2], Ra[5], Ra[8]};
        double rv00 = Rv[0];
        double rv01 = Rv[1];
        double rv02 = Rv[2];
        double rv10 = Rv[3];
        double rv11 = Rv[4];
        double rv12 = Rv[5];
        double rv20 = Rv[6];
        double rv21 = Rv[7];
        double rv22 = Rv[8];
        double b00 = rv00 - p * rv20;
        double b01 = rv01 - p * rv21;
        double b10 = rv10 - q * rv20;
        double b11 = rv11 - q * rv21;
        double dtinv = 1.0 / ((b00 * b11 - b01 * b10));
        double binv00 = dtinv * b11;
        double binv01 = -dtinv * b01;
        double binv10 = -dtinv * b10;
        double binv11 = dtinv * b00;
        double a00 = binv00 * j00 + binv01 * j10;
        double a01 = binv00 * j01 + binv01 * j11;
        double a10 = binv10 * j00 + binv11 * j10;
        double a11 = binv10 * j01 + binv11 * j11;
        // compute the largest singular value of A:
        double ata00 = a00 * a00 + a01 * a01;
        double ata01 = a00 * a10 + a01 * a11;
        double ata11 = a10 * a10 + a11 * a11;
        double gamma2 = 0.5 * (ata00 + ata11
                + StrictMath.sqrt((ata00 - ata11) * (ata00 - ata11) + 4.0 * ata01 * ata01));
        if (gamma2 < 0) throw new IppeError("gamma2 is negative.");
        double gamma = StrictMath.sqrt(gamma2);
        if (StrictMath.abs(gamma) < Lapack.FLT_EPSILON) throw new IppeError("gamma is zero.");
        // reconstruct the full rotation matrices:
        double rtilde00 = a00 / gamma;
        double rtilde01 = a01 / gamma;
        double rtilde10 = a10 / gamma;
        double rtilde11 = a11 / gamma;
        double rtilde00_2 = rtilde00 * rtilde00;
        double rtilde01_2 = rtilde01 * rtilde01;
        double rtilde10_2 = rtilde10 * rtilde10;
        double rtilde11_2 = rtilde11 * rtilde11;
        double b0 = StrictMath.sqrt(-rtilde00_2 - rtilde10_2 + 1);
        double b1 = StrictMath.sqrt(-rtilde01_2 - rtilde11_2 + 1);
        double sp = (-rtilde00 * rtilde01 - rtilde10 * rtilde11);
        if (sp < 0) b1 = -b1;
        double[] R1 = new double[9];
        double[] R2 = new double[9];
        R1[0] = (rtilde00) * rv00 + (rtilde10) * rv01 + (b0) * rv02;
        R1[1] = (rtilde01) * rv00 + (rtilde11) * rv01 + (b1) * rv02;
        R1[2] = (b1 * rtilde10 - b0 * rtilde11) * rv00 + (b0 * rtilde01 - b1 * rtilde00) * rv01
                + (rtilde00 * rtilde11 - rtilde01 * rtilde10) * rv02;
        R1[3] = (rtilde00) * rv10 + (rtilde10) * rv11 + (b0) * rv12;
        R1[4] = (rtilde01) * rv10 + (rtilde11) * rv11 + (b1) * rv12;
        R1[5] = (b1 * rtilde10 - b0 * rtilde11) * rv10 + (b0 * rtilde01 - b1 * rtilde00) * rv11
                + (rtilde00 * rtilde11 - rtilde01 * rtilde10) * rv12;
        R1[6] = (rtilde00) * rv20 + (rtilde10) * rv21 + (b0) * rv22;
        R1[7] = (rtilde01) * rv20 + (rtilde11) * rv21 + (b1) * rv22;
        R1[8] = (b1 * rtilde10 - b0 * rtilde11) * rv20 + (b0 * rtilde01 - b1 * rtilde00) * rv21
                + (rtilde00 * rtilde11 - rtilde01 * rtilde10) * rv22;
        R2[0] = (rtilde00) * rv00 + (rtilde10) * rv01 + (-b0) * rv02;
        R2[1] = (rtilde01) * rv00 + (rtilde11) * rv01 + (-b1) * rv02;
        R2[2] = (b0 * rtilde11 - b1 * rtilde10) * rv00 + (b1 * rtilde00 - b0 * rtilde01) * rv01
                + (rtilde00 * rtilde11 - rtilde01 * rtilde10) * rv02;
        R2[3] = (rtilde00) * rv10 + (rtilde10) * rv11 + (-b0) * rv12;
        R2[4] = (rtilde01) * rv10 + (rtilde11) * rv11 + (-b1) * rv12;
        R2[5] = (b0 * rtilde11 - b1 * rtilde10) * rv10 + (b1 * rtilde00 - b0 * rtilde01) * rv11
                + (rtilde00 * rtilde11 - rtilde01 * rtilde10) * rv12;
        R2[6] = (rtilde00) * rv20 + (rtilde10) * rv21 + (-b0) * rv22;
        R2[7] = (rtilde01) * rv20 + (rtilde11) * rv21 + (-b1) * rv22;
        R2[8] = (b0 * rtilde11 - b1 * rtilde10) * rv20 + (b1 * rtilde00 - b0 * rtilde01) * rv21
                + (rtilde00 * rtilde11 - rtilde01 * rtilde10) * rv22;
        return new double[][] {R1, R2};
    }

    /** ippe.cpp:529 homographyFromSquarePoints(double 점) */
    private static double[] homographyFromSquarePoints(double[] pts, double halfLength) {
        double p1x = -pts[0];
        double p1y = -pts[1];
        double p2x = -pts[2];
        double p2y = -pts[3];
        double p3x = -pts[4];
        double p3y = -pts[5];
        double p4x = -pts[6];
        double p4y = -pts[7];
        // analytic solution:
        double det = (halfLength * (p1x * p2y - p2x * p1y - p1x * p4y + p2x * p3y - p3x * p2y + p4x * p1y + p3x * p4y
                - p4x * p3y));
        if (StrictMath.abs(det) < 1e-9) throw new IppeError("Determinant is zero!");
        double detsInv = -1 / det;
        double[] H = new double[9];
        H[0] = detsInv * (p1x * p3x * p2y - p2x * p3x * p1y - p1x * p4x * p2y + p2x * p4x * p1y - p1x * p3x * p4y
                + p1x * p4x * p3y + p2x * p3x * p4y - p2x * p4x * p3y);
        H[1] = detsInv * (p1x * p2x * p3y - p1x * p3x * p2y - p1x * p2x * p4y + p2x * p4x * p1y + p1x * p3x * p4y
                - p3x * p4x * p1y - p2x * p4x * p3y + p3x * p4x * p2y);
        H[2] = detsInv * halfLength * (p1x * p2x * p3y - p2x * p3x * p1y - p1x * p2x * p4y + p1x * p4x * p2y
                - p1x * p4x * p3y + p3x * p4x * p1y + p2x * p3x * p4y - p3x * p4x * p2y);
        H[3] = detsInv * (p1x * p2y * p3y - p2x * p1y * p3y - p1x * p2y * p4y + p2x * p1y * p4y - p3x * p1y * p4y
                + p4x * p1y * p3y + p3x * p2y * p4y - p4x * p2y * p3y);
        H[4] = detsInv * (p2x * p1y * p3y - p3x * p1y * p2y - p1x * p2y * p4y + p4x * p1y * p2y + p1x * p3y * p4y
                - p4x * p1y * p3y - p2x * p3y * p4y + p3x * p2y * p4y);
        H[5] = detsInv * halfLength * (p1x * p2y * p3y - p3x * p1y * p2y - p2x * p1y * p4y + p4x * p1y * p2y
                - p1x * p3y * p4y + p3x * p1y * p4y + p2x * p3y * p4y - p4x * p2y * p3y);
        H[6] = -detsInv * (p1x * p3y - p3x * p1y - p1x * p4y - p2x * p3y + p3x * p2y + p4x * p1y + p2x * p4y - p4x * p2y);
        H[7] = detsInv * (p1x * p2y - p2x * p1y - p1x * p3y + p3x * p1y + p2x * p4y - p4x * p2y - p3x * p4y + p4x * p3y);
        H[8] = 1.0;
        return H;
    }

    /** ippe.cpp:582 makeCanonicalObjectPoints: canonical(2n)을 채우고 MmodelPoints2Canonical(4×4)을 돌려준다 */
    private static double[] makeCanonicalObjectPoints(double[] obj, int n, double[] canonical) {
        double[] UZero = new double[3 * n];
        double xBar = 0;
        double yBar = 0;
        double zBar = 0;
        boolean isOnZPlane = true;
        for (int i = 0; i < n; i++) {
            double x = obj[3 * i];
            double y = obj[3 * i + 1];
            double z = obj[3 * i + 2];
            if (StrictMath.abs(z) > IPPE_SMALL) isOnZPlane = false;
            xBar += x;
            yBar += y;
            zBar += z;
            UZero[i] = x;
            UZero[n + i] = y;
            UZero[2 * n + i] = z;
        }
        xBar = xBar / n;
        yBar = yBar / n;
        zBar = zBar / n;
        for (int i = 0; i < n; i++) {
            UZero[i] -= xBar;
            UZero[n + i] -= yBar;
            UZero[2 * n + i] -= zBar;
        }
        double[] MCenter = {1, 0, 0, -xBar, 0, 1, 0, -yBar, 0, 0, 1, -zBar, 0, 0, 0, 1};
        if (isOnZPlane) {
            for (int i = 0; i < n; i++) {
                canonical[2 * i] = UZero[i];
                canonical[2 * i + 1] = UZero[n + i];
            }
            return MCenter;
        }
        // rotation that rotates objectPoints to the plane z=0
        double[] R = computeObjextSpaceR3Pts(obj);
        if (R == null) {
            // we could not compute R, probably because there is a duplicate point in {objectPoints(0),objectPoints(1),
            // objectPoints(2)}. So we compute it with the SVD (which is slower):
            R = computeObjextSpaceRSvD(UZero, n);
        }
        double[] UZeroAligned = Lapack.mul(R, UZero, 3, 3, n);
        for (int i = 0; i < n; i++) {
            canonical[2 * i] = UZeroAligned[i];
            canonical[2 * i + 1] = UZeroAligned[n + i];
            if (StrictMath.abs(UZeroAligned[2 * n + i]) > IPPE_SMALL)
                throw new IppeError("Cannot transform object points to the plane z=0!");
        }
        double[] MRot = new double[16];
        MRot[15] = 1;
        for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) MRot[i * 4 + j] = R[i * 3 + j];
        return Lapack.mul(MRot, MCenter, 4, 4, 4);
    }

    /** ippe.cpp:690 evalReprojError: K = I, 왜곡 0으로 projectPoints(float 출력) 뒤 float로 RMS */
    private static float evalReprojError(float[] obj, double[] img, int n, double[] M) {
        double[] r = rot2vec(M);
        double[] t = {M[3], M[7], M[11]};
        double[] objD = new double[3 * n];
        for (int i = 0; i < 3 * n; i++) objD[i] = obj[i];
        double[] projected = Calibration.projectPoints(objD, n, r, t, 1, 1, 0, 0, null, null);
        float err = 0;
        for (int i = 0; i < n; i++) {
            // 물체 점이 CV_32F라 projectPoints의 출력도 CV_32F(double로 계산해 float로 바꾼다)
            float dx = (float) projected[2 * i] - (float) img[2 * i];
            float dy = (float) projected[2 * i + 1] - (float) img[2 * i + 1];
            err += dx * dx + dy * dy;
        }
        return (float) StrictMath.sqrt(err / (2.0f * n));
    }

    /** ippe.cpp:735 rotateVec2ZAxis: 반평행이면 반사 diag(1, 1, −1)(실제 그대로) */
    private static double[] rotateVec2ZAxis(double ax, double ay, double az) {
        double nrm = StrictMath.sqrt(ax * ax + ay * ay + az * az);
        ax = ax / nrm;
        ay = ay / nrm;
        az = az / nrm;
        double c = az;
        double[] Ra = new double[9];
        if (StrictMath.abs(1.0 + c) < Lapack.FLT_EPSILON) {
            Ra[0] = 1.0;
            Ra[4] = 1.0;
            Ra[8] = -1.0;
        } else {
            double d = 1.0 / (1.0 + c);
            double ax2 = ax * ax;
            double ay2 = ay * ay;
            double axay = ax * ay;
            Ra[0] = -ax2 * d + 1.0;
            Ra[1] = -axay * d;
            Ra[2] = -ax;
            Ra[3] = -axay * d;
            Ra[4] = -ay2 * d + 1.0;
            Ra[5] = -ay;
            Ra[6] = ax;
            Ra[7] = ay;
            Ra[8] = 1.0 - (ax2 + ay2) * d;
        }
        return Ra;
    }

    /** ippe.cpp:782 computeObjextSpaceR3Pts: 첫 세 점의 법선을 z축으로(못 하면 null) */
    private static double[] computeObjextSpaceR3Pts(double[] obj) {
        double p1x = obj[0];
        double p1y = obj[1];
        double p1z = obj[2];
        double p2x = obj[3];
        double p2y = obj[4];
        double p2z = obj[5];
        double p3x = obj[6];
        double p3y = obj[7];
        double p3z = obj[8];
        double nx = (p1y - p2y) * (p1z - p3z) - (p1y - p3y) * (p1z - p2z);
        double ny = (p1x - p3x) * (p1z - p2z) - (p1x - p2x) * (p1z - p3z);
        double nz = (p1x - p2x) * (p1y - p3y) - (p1x - p3x) * (p1y - p2y);
        double nrm = StrictMath.sqrt(nx * nx + ny * ny + nz * nz);
        if (nrm > IPPE_SMALL) {
            nx = nx / nrm;
            ny = ny / nrm;
            nz = nz / nrm;
            return rotateVec2ZAxis(nx, ny, nz);
        }
        return null;
    }

    /** ippe.cpp:833 computeObjextSpaceRSvD */
    private static double[] computeObjextSpaceRSvD(double[] UZero, int n) {
        // SVD of UZero·UZeroᵀ(3×3)
        double[] UUt = new double[9];
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) {
                double s = 0;
                for (int k = 0; k < n; k++) s += UZero[i * n + k] * UZero[j * n + k];
                UUt[i * 3 + j] = s;
            }
        }
        Lapack.Svd s = Lapack.svd(UUt, 3, 3);
        double s3 = s.w[2];
        double s2 = s.w[1];
        // check if points are coplanar:
        if (!(s3 / s2 < IPPE_SMALL)) throw new IppeError("s3 / s2 < IPPE_SMALL");
        double[] R = new double[9];
        for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) R[i * 3 + j] = s.u[j * 3 + i];
        if (Lapack.det3(R) < 0) {
            // this ensures R is a rotation matrix and not a general unitary matrix:
            R[6] = -R[6];
            R[7] = -R[7];
            R[8] = -R[8];
        }
        return R;
    }

    /** ippe.cpp:862 HomographyHO::normalizeDataIsotropic: {DataN(2×n), T(3×3), Ti(3×3)} */
    private static double[][] normalizeDataIsotropic(double[] data, int numPoints) {
        double xm = 0;
        double ym = 0;
        for (int i = 0; i < numPoints; i++) {
            xm = xm + data[2 * i];
            ym = ym + data[2 * i + 1];
        }
        xm = xm / numPoints;
        ym = ym / numPoints;
        double kappa = 0;
        double[] DataN = new double[2 * numPoints];
        for (int i = 0; i < numPoints; i++) {
            double xh = data[2 * i] - xm;
            double yh = data[2 * i + 1] - ym;
            DataN[i] = xh;
            DataN[numPoints + i] = yh;
            kappa = kappa + xh * xh + yh * yh;
        }
        double beta = StrictMath.sqrt(2 * numPoints / kappa);
        for (int i = 0; i < 2 * numPoints; i++) DataN[i] = DataN[i] * beta;
        double[] T = new double[9];
        double[] Ti = new double[9];
        T[0] = 1.0 / beta;
        T[4] = 1.0 / beta;
        T[2] = xm;
        T[5] = ym;
        T[8] = 1;
        Ti[0] = beta;
        Ti[4] = beta;
        Ti[2] = -beta * xm;
        Ti[5] = -beta * ym;
        Ti[8] = 1;
        return new double[][] {DataN, T, Ti};
    }

    /** ippe.cpp:957 HomographyHO::homographyHO(src 2n, target 2n) */
    private static double[] homographyHO(double[] src, double[] targ, int count) {
        double[][] a = normalizeDataIsotropic(src, count);
        double[][] b = normalizeDataIsotropic(targ, count);
        double[] DataA = a[0];
        double[] TAi = a[2];
        double[] DataB = b[0];
        double[] TB = b[1];
        int n = count;
        double[] C1 = new double[n];
        double[] C2 = new double[n];
        double[] C3 = new double[n];
        double[] C4 = new double[n];
        double mC1 = 0;
        double mC2 = 0;
        double mC3 = 0;
        double mC4 = 0;
        for (int i = 0; i < n; i++) {
            C1[i] = -DataB[i] * DataA[i];
            C2[i] = -DataB[i] * DataA[n + i];
            C3[i] = -DataB[n + i] * DataA[i];
            C4[i] = -DataB[n + i] * DataA[n + i];
            mC1 += C1[i];
            mC2 += C2[i];
            mC3 += C3[i];
            mC4 += C4[i];
        }
        mC1 /= n;
        mC2 /= n;
        mC3 /= n;
        mC4 /= n;
        double[] Mx = new double[n * 3];
        double[] My = new double[n * 3];
        for (int i = 0; i < n; i++) {
            Mx[i * 3] = C1[i] - mC1;
            Mx[i * 3 + 1] = C2[i] - mC2;
            Mx[i * 3 + 2] = -DataB[i];
            My[i * 3] = C3[i] - mC3;
            My[i * 3 + 1] = C4[i] - mC4;
            My[i * 3 + 2] = -DataB[n + i];
        }
        double[] DataAT = new double[n * 2];
        for (int i = 0; i < n; i++) {
            DataAT[i * 2] = DataA[i];
            DataAT[i * 2 + 1] = DataA[n + i];
        }
        double[] DataADataAT = Lapack.mul(DataA, DataAT, 2, n, 2);
        double dt = DataADataAT[0] * DataADataAT[3] - DataADataAT[1] * DataADataAT[2];
        double[] DataADataATi = {DataADataAT[3] / dt, -DataADataAT[1] / dt, -DataADataAT[2] / dt, DataADataAT[0] / dt};
        double[] Pp = Lapack.mul(DataADataATi, DataA, 2, 2, n);
        double[] Bx = Lapack.mul(Pp, Mx, 2, n, 3);
        double[] By = Lapack.mul(Pp, My, 2, n, 3);
        double[] Ex = Lapack.mul(DataAT, Bx, n, 2, 3);
        double[] Ey = Lapack.mul(DataAT, By, n, 2, 3);
        double[] D = new double[2 * n * 3];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < 3; j++) {
                D[i * 3 + j] = Mx[i * 3 + j] - Ex[i * 3 + j];
                D[(i + n) * 3 + j] = My[i * 3 + j] - Ey[i * 3 + j];
            }
        }
        double[] DDT = Lapack.mulAt(D, D, 2 * n, 3, 3);
        double[] S = new double[3];
        double[] U = new double[9];
        Lapack.jacobi(DDT, 3, S, U);
        double[] h789 = {U[6], U[7], U[8]};
        double[] h12 = Lapack.mul(Bx, h789, 2, 3, 1);
        double[] h45 = Lapack.mul(By, h789, 2, 3, 1);
        double h3 = -(mC1 * h789[0] + mC2 * h789[1]);
        double h6 = -(mC3 * h789[0] + mC4 * h789[1]);
        double[] H = {-h12[0], -h12[1], h3, -h45[0], -h45[1], h6, h789[0], h789[1], h789[2]};
        H = Lapack.mul(Lapack.mul(TB, H, 3, 3, 3), TAi, 3, 3, 3);
        double h22Inv = 1 / H[8];
        for (int i = 0; i < 9; i++) H[i] = H[i] * h22Inv;
        return H;
    }
}
