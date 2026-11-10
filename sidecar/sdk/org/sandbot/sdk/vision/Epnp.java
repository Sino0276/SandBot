// OpenCV 4.10.0 modules/calib3d/src/epnp.cpp·epnp.h(sha256 3845c2e9…c8a6·25158a37…5116). 이 파일에는 머리말이 없고 OpenCV
// 4.x의 LICENSE(Apache License 2.0, http://opencv.org/license.html)를 따른다. EPnP: V. Lepetit, F. Moreno-Noguer, P. Fua,
// "EPnP: An Accurate O(n) Solution to the PnP Problem", IJCV 2009.
// SandBot: 그대로 옮겼다(spec-4d §1.12). 평면 4점에서는 조건이 나빠 실제 OpenCV도 자주 크게 틀리므로 ITERATIVE로 대신하지 않는다.
// SVD·역행렬·선형계는 OpenCV의 cvSVD·cvInvert(CV_SVD)·cvSolve(CV_SVD)와 같은 Jacobi 루틴(Lapack)이다.
package org.sandbot.sdk.vision;

/** OpenCV epnp(SOLVEPNP_EPNP). */
final class Epnp {
    private final double uc;
    private final double vc;
    private final double fu;
    private final double fv;
    private final double[] pws;
    private final double[] us;
    private final double[] alphas;
    private final double[] pcs;
    private final int numberOfCorrespondences;
    private final double[][] cws = new double[4][3];
    private final double[][] ccs = new double[4][3];

    /** cameraMatrix(double): fx·fy·cx·cy, opoints: float 3n, ipoints: 정규화 좌표 float 2n(undistortPoints 출력) */
    Epnp(double fx, double fy, double cx, double cy, float[] opoints, float[] ipoints, int n) {
        uc = cx;
        vc = cy;
        fu = fx;
        fv = fy;
        numberOfCorrespondences = n;
        pws = new double[3 * n];
        us = new double[2 * n];
        for (int i = 0; i < n; i++) {
            pws[3 * i] = opoints[3 * i];
            pws[3 * i + 1] = opoints[3 * i + 1];
            pws[3 * i + 2] = opoints[3 * i + 2];
            us[2 * i] = ipoints[2 * i] * fu + uc;
            us[2 * i + 1] = ipoints[2 * i + 1] * fv + vc;
        }
        alphas = new double[4 * n];
        pcs = new double[3 * n];
    }

    private void chooseControlPoints() {
        // Take C0 as the reference points centroid:
        cws[0][0] = cws[0][1] = cws[0][2] = 0;
        for (int i = 0; i < numberOfCorrespondences; i++)
            for (int j = 0; j < 3; j++) cws[0][j] += pws[3 * i + j];
        for (int j = 0; j < 3; j++) cws[0][j] /= numberOfCorrespondences;
        // Take C1, C2, and C3 from PCA on the reference points:
        double[] PW0 = new double[numberOfCorrespondences * 3];
        for (int i = 0; i < numberOfCorrespondences; i++)
            for (int j = 0; j < 3; j++) PW0[3 * i + j] = pws[3 * i + j] - cws[0][j];
        double[] pw0tpw0 = Lapack.mulTransposedAtA(PW0, numberOfCorrespondences, 3);
        // cvSVD(PW0tPW0, DC, UCt, 0, CV_SVD_MODIFY_A | CV_SVD_U_T): uct의 행 = 왼쪽 특이 벡터
        Lapack.Svd s = Lapack.svd(pw0tpw0, 3, 3);
        double[] dc = s.w;
        for (int i = 1; i < 4; i++) {
            double k = StrictMath.sqrt(dc[i - 1] / numberOfCorrespondences);
            for (int j = 0; j < 3; j++) cws[i][j] = cws[0][j] + k * s.u[j * 3 + (i - 1)];
        }
    }

    private void computeBarycentricCoordinates() {
        double[] cc = new double[9];
        for (int i = 0; i < 3; i++) for (int j = 1; j < 4; j++) cc[3 * i + j - 1] = cws[j][i] - cws[0][i];
        double[] ci = Lapack.invertSvd(cc, 3);
        for (int i = 0; i < numberOfCorrespondences; i++) {
            int pi = 3 * i;
            int a = 4 * i;
            for (int j = 0; j < 3; j++) {
                alphas[a + 1 + j] = ci[3 * j] * (pws[pi] - cws[0][0]) + ci[3 * j + 1] * (pws[pi + 1] - cws[0][1])
                        + ci[3 * j + 2] * (pws[pi + 2] - cws[0][2]);
            }
            alphas[a] = 1.0f - alphas[a + 1] - alphas[a + 2] - alphas[a + 3];
        }
    }

    private void fillM(double[] M, int row, int as, double u, double v) {
        int m1 = row * 12;
        int m2 = m1 + 12;
        for (int i = 0; i < 4; i++) {
            M[m1 + 3 * i] = alphas[as + i] * fu;
            M[m1 + 3 * i + 1] = 0.0;
            M[m1 + 3 * i + 2] = alphas[as + i] * (uc - u);
            M[m2 + 3 * i] = 0.0;
            M[m2 + 3 * i + 1] = alphas[as + i] * fv;
            M[m2 + 3 * i + 2] = alphas[as + i] * (vc - v);
        }
    }

    private void computeCcs(double[] betas, double[] ut) {
        for (int i = 0; i < 4; i++) ccs[i][0] = ccs[i][1] = ccs[i][2] = 0.0f;
        for (int i = 0; i < 4; i++) {
            int v = 12 * (11 - i);
            for (int j = 0; j < 4; j++) for (int k = 0; k < 3; k++) ccs[j][k] += betas[i] * ut[v + 3 * j + k];
        }
    }

    private void computePcs() {
        for (int i = 0; i < numberOfCorrespondences; i++) {
            int a = 4 * i;
            int pc = 3 * i;
            for (int j = 0; j < 3; j++)
                pcs[pc + j] = alphas[a] * ccs[0][j] + alphas[a + 1] * ccs[1][j] + alphas[a + 2] * ccs[2][j]
                        + alphas[a + 3] * ccs[3][j];
        }
    }

    /** epnp::compute_pose: {R(3×3 행 우선), t(3)} */
    double[][] computePose() {
        chooseControlPoints();
        computeBarycentricCoordinates();
        double[] M = new double[2 * numberOfCorrespondences * 12];
        for (int i = 0; i < numberOfCorrespondences; i++) fillM(M, 2 * i, 4 * i, us[2 * i], us[2 * i + 1]);
        double[] mtm = Lapack.mulTransposedAtA(M, 2 * numberOfCorrespondences, 12);
        // cvSVD(MtM, D, Ut, 0, CV_SVD_MODIFY_A | CV_SVD_U_T): ut의 행 = 왼쪽 특이 벡터
        Lapack.Svd s = Lapack.svd(mtm, 12, 12);
        double[] ut = new double[144];
        for (int i = 0; i < 12; i++) for (int j = 0; j < 12; j++) ut[i * 12 + j] = s.u[j * 12 + i];
        double[] l6x10 = new double[60];
        double[] rho = new double[6];
        computeL6x10(ut, l6x10);
        computeRho(rho);
        double[][] betas = new double[4][4];
        double[] repErrors = new double[4];
        double[][][] Rs = new double[4][3][3];
        double[][] ts = new double[4][3];
        findBetasApprox1(l6x10, rho, betas[1]);
        gaussNewton(l6x10, rho, betas[1]);
        repErrors[1] = computeRAndT(ut, betas[1], Rs[1], ts[1]);
        findBetasApprox2(l6x10, rho, betas[2]);
        gaussNewton(l6x10, rho, betas[2]);
        repErrors[2] = computeRAndT(ut, betas[2], Rs[2], ts[2]);
        findBetasApprox3(l6x10, rho, betas[3]);
        gaussNewton(l6x10, rho, betas[3]);
        repErrors[3] = computeRAndT(ut, betas[3], Rs[3], ts[3]);
        int N = 1;
        if (repErrors[2] < repErrors[1]) N = 2;
        if (repErrors[3] < repErrors[N]) N = 3;
        double[] R = new double[9];
        for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) R[i * 3 + j] = Rs[N][i][j];
        return new double[][] {R, ts[N].clone()};
    }

    private static double dist2(double[] p1, double[] p2) {
        return (p1[0] - p2[0]) * (p1[0] - p2[0]) + (p1[1] - p2[1]) * (p1[1] - p2[1]) + (p1[2] - p2[2]) * (p1[2] - p2[2]);
    }

    private static double dot(double[] v1, int o1, double[] v2, int o2) {
        return v1[o1] * v2[o2] + v1[o1 + 1] * v2[o2 + 1] + v1[o1 + 2] * v2[o2 + 2];
    }

    private void estimateRAndT(double[][] R, double[] t) {
        double[] pc0 = new double[3];
        double[] pw0 = new double[3];
        for (int i = 0; i < numberOfCorrespondences; i++) {
            for (int j = 0; j < 3; j++) {
                pc0[j] += pcs[3 * i + j];
                pw0[j] += pws[3 * i + j];
            }
        }
        for (int j = 0; j < 3; j++) {
            pc0[j] /= numberOfCorrespondences;
            pw0[j] /= numberOfCorrespondences;
        }
        double[] abt = new double[9];
        for (int i = 0; i < numberOfCorrespondences; i++) {
            int pc = 3 * i;
            int pw = 3 * i;
            for (int j = 0; j < 3; j++) {
                abt[3 * j] += (pcs[pc + j] - pc0[j]) * (pws[pw] - pw0[0]);
                abt[3 * j + 1] += (pcs[pc + j] - pc0[j]) * (pws[pw + 1] - pw0[1]);
                abt[3 * j + 2] += (pcs[pc + j] - pc0[j]) * (pws[pw + 2] - pw0[2]);
            }
        }
        // cvSVD(ABt, D, U, V, MODIFY_A): abt_u = U(열이 왼쪽 벡터), abt_v = V(= vtᵀ)
        Lapack.Svd s = Lapack.svd(abt, 3, 3);
        double[] abtU = s.u;
        double[] abtV = new double[9];
        for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) abtV[i * 3 + j] = s.vt[j * 3 + i];
        for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) R[i][j] = dot(abtU, 3 * i, abtV, 3 * j);
        final double det = R[0][0] * R[1][1] * R[2][2] + R[0][1] * R[1][2] * R[2][0] + R[0][2] * R[1][0] * R[2][1]
                - R[0][2] * R[1][1] * R[2][0] - R[0][1] * R[1][0] * R[2][2] - R[0][0] * R[1][2] * R[2][1];
        if (det < 0) {
            R[2][0] = -R[2][0];
            R[2][1] = -R[2][1];
            R[2][2] = -R[2][2];
        }
        t[0] = pc0[0] - dot(R[0], 0, pw0, 0);
        t[1] = pc0[1] - dot(R[1], 0, pw0, 0);
        t[2] = pc0[2] - dot(R[2], 0, pw0, 0);
    }

    private void solveForSign() {
        if (pcs[2] < 0.0) {
            for (int i = 0; i < 4; i++) for (int j = 0; j < 3; j++) ccs[i][j] = -ccs[i][j];
            for (int i = 0; i < numberOfCorrespondences; i++) {
                pcs[3 * i] = -pcs[3 * i];
                pcs[3 * i + 1] = -pcs[3 * i + 1];
                pcs[3 * i + 2] = -pcs[3 * i + 2];
            }
        }
    }

    private double computeRAndT(double[] ut, double[] betas, double[][] R, double[] t) {
        computeCcs(betas, ut);
        computePcs();
        solveForSign();
        estimateRAndT(R, t);
        return reprojectionError(R, t);
    }

    private double reprojectionError(double[][] R, double[] t) {
        double sum2 = 0.0;
        for (int i = 0; i < numberOfCorrespondences; i++) {
            int pw = 3 * i;
            double Xc = dot(R[0], 0, pws, pw) + t[0];
            double Yc = dot(R[1], 0, pws, pw) + t[1];
            double invZc = 1.0 / (dot(R[2], 0, pws, pw) + t[2]);
            double ue = uc + fu * Xc * invZc;
            double ve = vc + fv * Yc * invZc;
            double u = us[2 * i];
            double v = us[2 * i + 1];
            sum2 += StrictMath.sqrt((u - ue) * (u - ue) + (v - ve) * (v - ve));
        }
        return sum2 / numberOfCorrespondences;
    }

    // betas10        = [B11 B12 B22 B13 B23 B33 B14 B24 B34 B44]
    // betas_approx_1 = [B11 B12     B13         B14]
    private void findBetasApprox1(double[] l6x10, double[] rho, double[] betas) {
        double[] l6x4 = new double[24];
        for (int i = 0; i < 6; i++) {
            l6x4[i * 4] = l6x10[i * 10];
            l6x4[i * 4 + 1] = l6x10[i * 10 + 1];
            l6x4[i * 4 + 2] = l6x10[i * 10 + 3];
            l6x4[i * 4 + 3] = l6x10[i * 10 + 6];
        }
        double[] b4 = Lapack.solveSvd(l6x4, 6, 4, rho, 1);
        if (b4[0] < 0) {
            betas[0] = StrictMath.sqrt(-b4[0]);
            betas[1] = -b4[1] / betas[0];
            betas[2] = -b4[2] / betas[0];
            betas[3] = -b4[3] / betas[0];
        } else {
            betas[0] = StrictMath.sqrt(b4[0]);
            betas[1] = b4[1] / betas[0];
            betas[2] = b4[2] / betas[0];
            betas[3] = b4[3] / betas[0];
        }
    }

    // betas_approx_2 = [B11 B12 B22                            ]
    private void findBetasApprox2(double[] l6x10, double[] rho, double[] betas) {
        double[] l6x3 = new double[18];
        for (int i = 0; i < 6; i++) {
            l6x3[i * 3] = l6x10[i * 10];
            l6x3[i * 3 + 1] = l6x10[i * 10 + 1];
            l6x3[i * 3 + 2] = l6x10[i * 10 + 2];
        }
        double[] b3 = Lapack.solveSvd(l6x3, 6, 3, rho, 1);
        if (b3[0] < 0) {
            betas[0] = StrictMath.sqrt(-b3[0]);
            betas[1] = (b3[2] < 0) ? StrictMath.sqrt(-b3[2]) : 0.0;
        } else {
            betas[0] = StrictMath.sqrt(b3[0]);
            betas[1] = (b3[2] > 0) ? StrictMath.sqrt(b3[2]) : 0.0;
        }
        if (b3[1] < 0) betas[0] = -betas[0];
        betas[2] = 0.0;
        betas[3] = 0.0;
    }

    // betas_approx_3 = [B11 B12 B22 B13 B23                    ]
    private void findBetasApprox3(double[] l6x10, double[] rho, double[] betas) {
        double[] l6x5 = new double[30];
        for (int i = 0; i < 6; i++) for (int j = 0; j < 5; j++) l6x5[i * 5 + j] = l6x10[i * 10 + j];
        double[] b5 = Lapack.solveSvd(l6x5, 6, 5, rho, 1);
        if (b5[0] < 0) {
            betas[0] = StrictMath.sqrt(-b5[0]);
            betas[1] = (b5[2] < 0) ? StrictMath.sqrt(-b5[2]) : 0.0;
        } else {
            betas[0] = StrictMath.sqrt(b5[0]);
            betas[1] = (b5[2] > 0) ? StrictMath.sqrt(b5[2]) : 0.0;
        }
        if (b5[1] < 0) betas[0] = -betas[0];
        betas[2] = b5[3] / betas[0];
        betas[3] = 0.0;
    }

    private static void computeL6x10(double[] ut, double[] l6x10) {
        int[] v = {12 * 11, 12 * 10, 12 * 9, 12 * 8};
        double[][][] dv = new double[4][6][3];
        for (int i = 0; i < 4; i++) {
            int a = 0;
            int b = 1;
            for (int j = 0; j < 6; j++) {
                dv[i][j][0] = ut[v[i] + 3 * a] - ut[v[i] + 3 * b];
                dv[i][j][1] = ut[v[i] + 3 * a + 1] - ut[v[i] + 3 * b + 1];
                dv[i][j][2] = ut[v[i] + 3 * a + 2] - ut[v[i] + 3 * b + 2];
                b++;
                if (b > 3) {
                    a++;
                    b = a + 1;
                }
            }
        }
        for (int i = 0; i < 6; i++) {
            int row = 10 * i;
            l6x10[row] = dot(dv[0][i], 0, dv[0][i], 0);
            l6x10[row + 1] = 2.0f * dot(dv[0][i], 0, dv[1][i], 0);
            l6x10[row + 2] = dot(dv[1][i], 0, dv[1][i], 0);
            l6x10[row + 3] = 2.0f * dot(dv[0][i], 0, dv[2][i], 0);
            l6x10[row + 4] = 2.0f * dot(dv[1][i], 0, dv[2][i], 0);
            l6x10[row + 5] = dot(dv[2][i], 0, dv[2][i], 0);
            l6x10[row + 6] = 2.0f * dot(dv[0][i], 0, dv[3][i], 0);
            l6x10[row + 7] = 2.0f * dot(dv[1][i], 0, dv[3][i], 0);
            l6x10[row + 8] = 2.0f * dot(dv[2][i], 0, dv[3][i], 0);
            l6x10[row + 9] = dot(dv[3][i], 0, dv[3][i], 0);
        }
    }

    private void computeRho(double[] rho) {
        rho[0] = dist2(cws[0], cws[1]);
        rho[1] = dist2(cws[0], cws[2]);
        rho[2] = dist2(cws[0], cws[3]);
        rho[3] = dist2(cws[1], cws[2]);
        rho[4] = dist2(cws[1], cws[3]);
        rho[5] = dist2(cws[2], cws[3]);
    }

    private static void computeAAndBGaussNewton(double[] l6x10, double[] rho, double[] betas, double[] A, double[] b) {
        for (int i = 0; i < 6; i++) {
            int rowL = i * 10;
            int rowA = i * 4;
            double[] L = l6x10;
            A[rowA] = 2 * L[rowL] * betas[0] + L[rowL + 1] * betas[1] + L[rowL + 3] * betas[2] + L[rowL + 6] * betas[3];
            A[rowA + 1] = L[rowL + 1] * betas[0] + 2 * L[rowL + 2] * betas[1] + L[rowL + 4] * betas[2]
                    + L[rowL + 7] * betas[3];
            A[rowA + 2] = L[rowL + 3] * betas[0] + L[rowL + 4] * betas[1] + 2 * L[rowL + 5] * betas[2]
                    + L[rowL + 8] * betas[3];
            A[rowA + 3] = L[rowL + 6] * betas[0] + L[rowL + 7] * betas[1] + L[rowL + 8] * betas[2]
                    + 2 * L[rowL + 9] * betas[3];
            b[i] = rho[i] - (L[rowL] * betas[0] * betas[0] + L[rowL + 1] * betas[0] * betas[1]
                    + L[rowL + 2] * betas[1] * betas[1] + L[rowL + 3] * betas[0] * betas[2]
                    + L[rowL + 4] * betas[1] * betas[2] + L[rowL + 5] * betas[2] * betas[2]
                    + L[rowL + 6] * betas[0] * betas[3] + L[rowL + 7] * betas[1] * betas[3]
                    + L[rowL + 8] * betas[2] * betas[3] + L[rowL + 9] * betas[3] * betas[3]);
        }
    }

    private void gaussNewton(double[] l6x10, double[] rho, double[] betas) {
        final int iterationsNumber = 5;
        double[] a = new double[24];
        double[] b = new double[6];
        double[] x = new double[4];
        for (int k = 0; k < iterationsNumber; k++) {
            computeAAndBGaussNewton(l6x10, rho, betas, a, b);
            qrSolve(a, 6, 4, b, x);
            for (int i = 0; i < 4; i++) betas[i] += x[i];
        }
    }

    /** epnp::qr_solve(A nr×nc 행 우선, b nr; A·b를 바꾼다) */
    private static void qrSolve(double[] A, int nr, int nc, double[] b, double[] X) {
        if (nc <= 0 || nr <= 0) return;
        double[] A1 = new double[nr];
        double[] A2 = new double[nr];
        int ppAkk = 0;
        for (int k = 0; k < nc; k++) {
            int ppAik1 = ppAkk;
            double eta = StrictMath.abs(A[ppAik1]);
            for (int i = k + 1; i < nr; i++) {
                double elt = StrictMath.abs(A[ppAik1]);
                if (eta < elt) eta = elt;
                ppAik1 += nc;
            }
            if (eta == 0) {
                A1[k] = A2[k] = 0.0;
                // "God damnit, A is singular, this shouldn't happen." — 실제는 X를 건드리지 않고 돌아간다
                return;
            }
            int ppAik2 = ppAkk;
            double sum2 = 0.0;
            double invEta = 1. / eta;
            for (int i = k; i < nr; i++) {
                A[ppAik2] *= invEta;
                sum2 += A[ppAik2] * A[ppAik2];
                ppAik2 += nc;
            }
            double sigma = StrictMath.sqrt(sum2);
            if (A[ppAkk] < 0) sigma = -sigma;
            A[ppAkk] += sigma;
            A1[k] = sigma * A[ppAkk];
            A2[k] = -eta * sigma;
            for (int j = k + 1; j < nc; j++) {
                int ppAik = ppAkk;
                double sum = 0;
                for (int i = k; i < nr; i++) {
                    sum += A[ppAik] * A[ppAik + j - k];
                    ppAik += nc;
                }
                double tau = sum / A1[k];
                ppAik = ppAkk;
                for (int i = k; i < nr; i++) {
                    A[ppAik + j - k] -= tau * A[ppAik];
                    ppAik += nc;
                }
            }
            ppAkk += nc + 1;
        }
        // b <- Qt b
        int ppAjj = 0;
        for (int j = 0; j < nc; j++) {
            int ppAij = ppAjj;
            double tau = 0;
            for (int i = j; i < nr; i++) {
                tau += A[ppAij] * b[i];
                ppAij += nc;
            }
            tau /= A1[j];
            ppAij = ppAjj;
            for (int i = j; i < nr; i++) {
                b[i] -= tau * A[ppAij];
                ppAij += nc;
            }
            ppAjj += nc + 1;
        }
        // X = R-1 b
        X[nc - 1] = b[nc - 1] / A2[nc - 1];
        for (int i = nc - 2; i >= 0; i--) {
            int ppAij = i * nc + (i + 1);
            double sum = 0;
            for (int j = i + 1; j < nc; j++) {
                sum += A[ppAij] * X[j];
                ppAij++;
            }
            X[i] = (b[i] - sum) / A2[i];
        }
    }
}
