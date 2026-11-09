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
// SandBot: OpenCV 4.10.0 modules/core/src/lapack.cpp(sha256 8cb4d606…18ac)의 double 경로를 옮겼다(spec-4d §1.12): JacobiImpl_
// (cv::eigen, HAVE_EIGEN 없는 빌드), JacobiSVDImpl_(cv::SVD·cvSVD), SVBkSbImpl_(cv::solve DECOMP_SVD·EIG, SVD::backSubst),
// cv::invert(DECOMP_SVD·EIG), determinant(3×3). EPnP의 실패와 평면 판정이 OpenCV와 같으려면 특이 벡터의 부호·순서가 같아야 해서
// 루틴을 그대로 옮긴다. 행렬은 행 우선 double[]이다. 새로 쓴 줄은 StrictMath(spec-4d §0).
package org.sandbot.sdk.vision;

/** OpenCV lapack.cpp의 Jacobi 고유값·특이값 분해와 그것으로 푸는 선형계(double만). */
final class Lapack {
    private Lapack() {}

    /** DBL_EPSILON(float.h) */
    static final double DBL_EPSILON = 2.220446049250313e-16;
    /** DBL_MIN(float.h) */
    static final double DBL_MIN = Double.MIN_NORMAL;
    /** FLT_EPSILON(float.h) */
    static final double FLT_EPSILON = 1.1920928955078125e-7;

    /** lapack.cpp:96 hypot(템플릿, 넘침을 피하는 꼴) */
    static double hypot(double a, double b) {
        a = StrictMath.abs(a);
        b = StrictMath.abs(b);
        if (a > b) {
            b /= a;
            return a * StrictMath.sqrt(1 + b * b);
        }
        if (b > 0) {
            a /= b;
            return b * StrictMath.sqrt(1 + a * a);
        }
        return 0;
    }

    /**
     * lapack.cpp:114 JacobiImpl_: 대칭 n×n 행렬 A(행 우선, 바뀜)의 고유값 W(내림차순)와 고유 벡터 V(행마다 하나, null이면 계산
     * 안 함).
     */
    static void jacobi(double[] A, int n, double[] W, double[] V) {
        final double eps = DBL_EPSILON;
        int astep = n;
        int vstep = n;
        if (V != null) {
            for (int i = 0; i < n; i++) {
                for (int j = 0; j < n; j++) V[i * vstep + j] = 0;
                V[i * vstep + i] = 1;
            }
        }
        int iters;
        int maxIters = n * n * 30;
        int[] indR = new int[n];
        int[] indC = new int[n];
        double mv;
        for (int k = 0; k < n; k++) {
            W[k] = A[(astep + 1) * k];
            if (k < n - 1) {
                int m = k + 1;
                mv = StrictMath.abs(A[astep * k + m]);
                for (int i = k + 2; i < n; i++) {
                    double val = StrictMath.abs(A[astep * k + i]);
                    if (mv < val) {
                        mv = val;
                        m = i;
                    }
                }
                indR[k] = m;
            }
            if (k > 0) {
                int m = 0;
                mv = StrictMath.abs(A[k]);
                for (int i = 1; i < k; i++) {
                    double val = StrictMath.abs(A[astep * i + k]);
                    if (mv < val) {
                        mv = val;
                        m = i;
                    }
                }
                indC[k] = m;
            }
        }
        if (n > 1) {
            for (iters = 0; iters < maxIters; iters++) {
                // find index (k,l) of pivot p
                int k = 0;
                mv = StrictMath.abs(A[indR[0]]);
                for (int i = 1; i < n - 1; i++) {
                    double val = StrictMath.abs(A[astep * i + indR[i]]);
                    if (mv < val) {
                        mv = val;
                        k = i;
                    }
                }
                int l = indR[k];
                for (int i = 1; i < n; i++) {
                    double val = StrictMath.abs(A[astep * indC[i] + i]);
                    if (mv < val) {
                        mv = val;
                        k = indC[i];
                        l = i;
                    }
                }
                double p = A[astep * k + l];
                if (StrictMath.abs(p) <= eps) break;
                double y = (W[l] - W[k]) * 0.5;
                double t = StrictMath.abs(y) + hypot(p, y);
                double s = hypot(p, t);
                double c = t / s;
                s = p / s;
                t = (p / t) * p;
                if (y < 0) {
                    s = -s;
                    t = -t;
                }
                A[astep * k + l] = 0;
                W[k] -= t;
                W[l] += t;
                // rotate rows and columns k and l
                for (int i = 0; i < k; i++) rotate(A, astep * i + k, astep * i + l, c, s);
                for (int i = k + 1; i < l; i++) rotate(A, astep * k + i, astep * i + l, c, s);
                for (int i = l + 1; i < n; i++) rotate(A, astep * k + i, astep * l + i, c, s);
                // rotate eigenvectors
                if (V != null) for (int i = 0; i < n; i++) rotate(V, vstep * k + i, vstep * l + i, c, s);
                for (int j = 0; j < 2; j++) {
                    int idx = j == 0 ? k : l;
                    if (idx < n - 1) {
                        int m = idx + 1;
                        mv = StrictMath.abs(A[astep * idx + m]);
                        for (int i = idx + 2; i < n; i++) {
                            double val = StrictMath.abs(A[astep * idx + i]);
                            if (mv < val) {
                                mv = val;
                                m = i;
                            }
                        }
                        indR[idx] = m;
                    }
                    if (idx > 0) {
                        int m = 0;
                        mv = StrictMath.abs(A[idx]);
                        for (int i = 1; i < idx; i++) {
                            double val = StrictMath.abs(A[astep * i + idx]);
                            if (mv < val) {
                                mv = val;
                                m = i;
                            }
                        }
                        indC[idx] = m;
                    }
                }
            }
        }
        // sort eigenvalues & eigenvectors
        for (int k = 0; k < n - 1; k++) {
            int m = k;
            for (int i = k + 1; i < n; i++) if (W[m] < W[i]) m = i;
            if (k != m) {
                double tw = W[m];
                W[m] = W[k];
                W[k] = tw;
                if (V != null) {
                    for (int i = 0; i < n; i++) {
                        double tv = V[vstep * m + i];
                        V[vstep * m + i] = V[vstep * k + i];
                        V[vstep * k + i] = tv;
                    }
                }
            }
        }
    }

    // #define rotate(v0, v1) a0 = v0, b0 = v1, v0 = a0*c - b0*s, v1 = a0*s + b0*c
    private static void rotate(double[] a, int i0, int i1, double c, double s) {
        double a0 = a[i0];
        double b0 = a[i1];
        a[i0] = a0 * c - b0 * s;
        a[i1] = a0 * s + b0 * c;
    }

    /** cv::RNG(state).next()(core/include/opencv2/core/operations.hpp, CV_RNG_COEFF 4164903690U) */
    private static final class Rng {
        long state;

        Rng(long seed) {
            state = seed != 0 ? seed : 0xffffffffL;
        }

        int next() {
            state = (state & 0xffffffffL) * 4164903690L + (state >>> 32);
            return (int) state;
        }
    }

    /**
     * lapack.cpp:362 JacobiSVDImpl_(double, minval DBL_MIN, eps DBL_EPSILON*10 — hal::SVD64f :581). At: n행 × m열(행마다 원래
     * 행렬의 열), 결과 At의 행 = 왼쪽 특이 벡터, W(n) 내림차순, Vt(n×n, null 가능) 행 = 오른쪽 특이 벡터. n1: 만들 왼쪽 벡터 수.
     */
    static void jacobiSvd(double[] At, int astep, double[] _W, double[] Vt, int vstep, int m, int n, int n1) {
        final double minval = DBL_MIN;
        final double eps = DBL_EPSILON * 10;
        double[] W = new double[n];
        int maxIter = Math.max(m, 30);
        double c;
        double s;
        double sd;
        for (int i = 0; i < n; i++) {
            sd = 0;
            for (int k = 0; k < m; k++) {
                double t = At[i * astep + k];
                sd += t * t;
            }
            W[i] = sd;
            if (Vt != null) {
                for (int k = 0; k < n; k++) Vt[i * vstep + k] = 0;
                Vt[i * vstep + i] = 1;
            }
        }
        for (int iter = 0; iter < maxIter; iter++) {
            boolean changed = false;
            for (int i = 0; i < n - 1; i++) {
                for (int j = i + 1; j < n; j++) {
                    int ai = i * astep;
                    int aj = j * astep;
                    double a = W[i];
                    double p = 0;
                    double b = W[j];
                    for (int k = 0; k < m; k++) p += At[ai + k] * At[aj + k];
                    if (StrictMath.abs(p) <= eps * StrictMath.sqrt(a * b)) continue;
                    p *= 2;
                    double beta = a - b;
                    double gamma = hypot(p, beta);
                    if (beta < 0) {
                        double delta = (gamma - beta) * 0.5;
                        s = StrictMath.sqrt(delta / gamma);
                        c = p / (gamma * s * 2);
                    } else {
                        c = StrictMath.sqrt((gamma + beta) / (gamma * 2));
                        s = p / (gamma * c * 2);
                    }
                    a = 0;
                    b = 0;
                    for (int k = 0; k < m; k++) {
                        double t0 = c * At[ai + k] + s * At[aj + k];
                        double t1 = -s * At[ai + k] + c * At[aj + k];
                        At[ai + k] = t0;
                        At[aj + k] = t1;
                        a += t0 * t0;
                        b += t1 * t1;
                    }
                    W[i] = a;
                    W[j] = b;
                    changed = true;
                    if (Vt != null) {
                        // VBLAS<double>::givens(SIMD)와 아래 스칼라 줄은 같은 값이다(t1 = b*c - a*s = -s*a + c*b)
                        int vi = i * vstep;
                        int vj = j * vstep;
                        for (int k = 0; k < n; k++) {
                            double t0 = c * Vt[vi + k] + s * Vt[vj + k];
                            double t1 = -s * Vt[vi + k] + c * Vt[vj + k];
                            Vt[vi + k] = t0;
                            Vt[vj + k] = t1;
                        }
                    }
                }
            }
            if (!changed) break;
        }
        for (int i = 0; i < n; i++) {
            sd = 0;
            for (int k = 0; k < m; k++) {
                double t = At[i * astep + k];
                sd += t * t;
            }
            W[i] = StrictMath.sqrt(sd);
        }
        for (int i = 0; i < n - 1; i++) {
            int j = i;
            for (int k = i + 1; k < n; k++) if (W[j] < W[k]) j = k;
            if (i != j) {
                double tw = W[i];
                W[i] = W[j];
                W[j] = tw;
                if (Vt != null) {
                    for (int k = 0; k < m; k++) {
                        double t = At[i * astep + k];
                        At[i * astep + k] = At[j * astep + k];
                        At[j * astep + k] = t;
                    }
                    for (int k = 0; k < n; k++) {
                        double t = Vt[i * vstep + k];
                        Vt[i * vstep + k] = Vt[j * vstep + k];
                        Vt[j * vstep + k] = t;
                    }
                }
            }
        }
        for (int i = 0; i < n; i++) _W[i] = W[i];
        if (Vt == null) return;
        Rng rng = new Rng(0x12345678L);
        for (int i = 0; i < n1; i++) {
            sd = i < n ? W[i] : 0;
            for (int ii = 0; ii < 100 && sd <= minval; ii++) {
                // if we got a zero singular value, then in order to get the corresponding left singular vector
                // we generate a random vector, project it to the previously computed left singular vectors,
                // subtract the projection and normalize the difference.
                final double val0 = 1. / m;
                for (int k = 0; k < m; k++) {
                    double val = (rng.next() & 256) != 0 ? val0 : -val0;
                    At[i * astep + k] = val;
                }
                for (int iter = 0; iter < 2; iter++) {
                    for (int j = 0; j < i; j++) {
                        sd = 0;
                        for (int k = 0; k < m; k++) sd += At[i * astep + k] * At[j * astep + k];
                        double asum = 0;
                        for (int k = 0; k < m; k++) {
                            double t = At[i * astep + k] - sd * At[j * astep + k];
                            At[i * astep + k] = t;
                            asum += StrictMath.abs(t);
                        }
                        asum = asum > eps * 100 ? 1 / asum : 0;
                        for (int k = 0; k < m; k++) At[i * astep + k] *= asum;
                    }
                }
                sd = 0;
                for (int k = 0; k < m; k++) {
                    double t = At[i * astep + k];
                    sd += t * t;
                }
                sd = StrictMath.sqrt(sd);
            }
            s = sd > minval ? 1 / sd : 0.;
            for (int k = 0; k < m; k++) At[i * astep + k] *= s;
        }
    }

    /** 특이값 분해 결과(cv::SVD): src = u·diag(w)·vt. u는 rows×nm(열이 왼쪽 벡터), vt는 nm×cols(행이 오른쪽 벡터). */
    static final class Svd {
        final double[] w;
        final double[] u;
        final double[] vt;
        final int rows;
        final int cols;
        final int nm;

        Svd(double[] w, double[] u, double[] vt, int rows, int cols, int nm) {
            this.w = w;
            this.u = u;
            this.vt = vt;
            this.rows = rows;
            this.cols = cols;
            this.nm = nm;
        }
    }

    /** lapack.cpp:1405 _SVDcompute(FULL_UV 없음): rows×cols 행렬(행 우선)의 특이값 분해 */
    static Svd svd(double[] src, int rows, int cols) {
        int m = rows;
        int n = cols;
        boolean at = false;
        if (m < n) {
            int t = m;
            m = n;
            n = t;
            at = true;
        }
        // temp_a: n행 × m열
        double[] a = new double[n * m];
        if (!at) {
            for (int i = 0; i < rows; i++) for (int j = 0; j < cols; j++) a[j * m + i] = src[i * cols + j];
        } else {
            System.arraycopy(src, 0, a, 0, n * m);
        }
        double[] w = new double[n];
        double[] v = new double[n * n];
        jacobiSvd(a, m, w, v, n, m, n, n);
        double[] u;
        double[] vt;
        if (!at) {
            // U = transpose(temp_u)(m×n), Vt = temp_v
            u = new double[m * n];
            for (int i = 0; i < n; i++) for (int k = 0; k < m; k++) u[k * n + i] = a[i * m + k];
            vt = v;
        } else {
            // U = transpose(temp_v)(n×n), Vt = temp_u(n×m)
            u = new double[n * n];
            for (int i = 0; i < n; i++) for (int k = 0; k < n; k++) u[k * n + i] = v[i * n + k];
            vt = a;
        }
        return new Svd(w, u, vt, rows, cols, n);
    }

    /**
     * lapack.cpp:612 SVBkSbImpl_(double, eps DBL_EPSILON*2). u: uT면 행 i가 i번째 왼쪽 벡터, 아니면 열 i. v도 vT로 같은 규칙.
     * b가 null이면 nb = m이고 역행렬을 만든다. 결과 x: n×nb.
     */
    static void svbksb(int m, int n, double[] w, double[] u, int ldu, boolean uT, double[] v, int ldv, boolean vT,
            double[] b, int ldb, int nb, double[] x, int ldx) {
        final double eps = DBL_EPSILON * 2;
        double threshold = 0;
        int udelta0 = uT ? ldu : 1;
        int udelta1 = uT ? 1 : ldu;
        int vdelta0 = vT ? ldv : 1;
        int vdelta1 = vT ? 1 : ldv;
        int nm = Math.min(m, n);
        if (b == null) nb = m;
        double[] buffer = new double[nb];
        for (int i = 0; i < n; i++) for (int j = 0; j < nb; j++) x[i * ldx + j] = 0;
        for (int i = 0; i < nm; i++) threshold += w[i];
        threshold *= eps;
        // v * inv(w) * uT * b
        int uo = 0;
        int vo = 0;
        for (int i = 0; i < nm; i++, uo += udelta0, vo += vdelta0) {
            double wi = w[i];
            if (StrictMath.abs(wi) <= threshold) continue;
            wi = 1 / wi;
            if (nb == 1) {
                double s = 0;
                if (b != null) {
                    for (int j = 0; j < m; j++) s += u[uo + j * udelta1] * b[j * ldb];
                } else {
                    s = u[uo];
                }
                s *= wi;
                for (int j = 0; j < n; j++) x[j * ldx] = x[j * ldx] + s * v[vo + j * vdelta1];
            } else {
                if (b != null) {
                    for (int j = 0; j < nb; j++) buffer[j] = 0;
                    // MatrAXPY(m, nb, b, ldb, u, udelta1, buffer, 0)
                    for (int r = 0; r < m; r++) {
                        double s = u[uo + r * udelta1];
                        for (int j = 0; j < nb; j++) buffer[j] = buffer[j] + s * b[r * ldb + j];
                    }
                    for (int j = 0; j < nb; j++) buffer[j] *= wi;
                } else {
                    for (int j = 0; j < nb; j++) buffer[j] = u[uo + j * udelta1] * wi;
                }
                // MatrAXPY(n, nb, buffer, 0, v, vdelta1, x, ldx)
                for (int r = 0; r < n; r++) {
                    double s = v[vo + r * vdelta1];
                    for (int j = 0; j < nb; j++) x[r * ldx + j] = x[r * ldx + j] + s * buffer[j];
                }
            }
        }
    }

    /** lapack.cpp:1032 cv::solve(DECOMP_SVD, 정규 방정식 아님): src m×n(m ≥ n), b m×nb → x n×nb */
    static double[] solveSvd(double[] src, int m, int n, double[] b, int nb) {
        double[] a = new double[n * m];
        for (int i = 0; i < m; i++) for (int j = 0; j < n; j++) a[j * m + i] = src[i * n + j];
        double[] w = new double[n];
        double[] v = new double[n * n];
        jacobiSvd(a, m, w, v, n, m, n, n);
        double[] x = new double[n * nb];
        svbksb(m, n, w, a, m, true, v, n, true, b, nb, nb, x, nb);
        return x;
    }

    /** lapack.cpp:1032 cv::solve(DECOMP_EIG): 대칭 n×n src, b n×nb → x n×nb */
    static double[] solveEig(double[] src, int n, double[] b, int nb) {
        double[] a = src.clone();
        double[] w = new double[n];
        double[] v = new double[n * n];
        jacobi(a, n, w, v);
        double[] x = new double[n * nb];
        svbksb(n, n, w, v, n, true, v, n, true, b, nb, nb, x, nb);
        return x;
    }

    /** lapack.cpp:793 cv::invert(DECOMP_SVD): SVD::compute → SVD::backSubst(빈 rhs) */
    static double[] invertSvd(double[] src, int n) {
        Svd s = svd(src, n, n);
        double[] x = new double[n * n];
        svbksb(n, n, s.w, s.u, s.nm, false, s.vt, n, true, null, 0, n, x, n);
        return x;
    }

    /** lapack.cpp:828 cv::invert(DECOMP_EIG): eigen → u = vt의 전치 → SVD::backSubst(빈 rhs) */
    static double[] invertEig(double[] src, int n) {
        double[] a = src.clone();
        double[] w = new double[n];
        double[] vt = new double[n * n];
        jacobi(a, n, w, vt);
        double[] u = new double[n * n];
        for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) u[i * n + j] = vt[j * n + i];
        double[] x = new double[n * n];
        svbksb(n, n, w, u, n, false, vt, n, true, null, 0, n, x, n);
        return x;
    }

    /** lapack.cpp:690 det3 */
    static double det3(double[] m) {
        return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6])
                + m[2] * (m[3] * m[7] - m[4] * m[6]);
    }

    // ---- 작은 행렬 도구(cv::gemm·mulTransposed의 차례대로 더하기) ----

    /** a(r×k)·b(k×c) */
    static double[] mul(double[] a, double[] b, int r, int k, int c) {
        double[] out = new double[r * c];
        for (int i = 0; i < r; i++) {
            for (int j = 0; j < c; j++) {
                double s = 0;
                for (int t = 0; t < k; t++) s += a[i * k + t] * b[t * c + j];
                out[i * c + j] = s;
            }
        }
        return out;
    }

    /** cv::mulTransposed(src, dst, aTa = true): src(r×c)ᵀ·src → c×c(위 삼각을 계산해 아래로 채움) */
    static double[] mulTransposedAtA(double[] src, int r, int c) {
        double[] out = new double[c * c];
        for (int i = 0; i < c; i++) {
            for (int j = i; j < c; j++) {
                double s = 0;
                for (int k = 0; k < r; k++) s += src[k * c + i] * src[k * c + j];
                out[i * c + j] = s;
                out[j * c + i] = s;
            }
        }
        return out;
    }

    /** aᵀ(r×c → c×r)·b(r×nb) */
    static double[] mulAt(double[] a, double[] b, int r, int c, int nb) {
        double[] out = new double[c * nb];
        for (int i = 0; i < c; i++) {
            for (int j = 0; j < nb; j++) {
                double s = 0;
                for (int k = 0; k < r; k++) s += a[k * c + i] * b[k * nb + j];
                out[i * nb + j] = s;
            }
        }
        return out;
    }

    /** cv::norm(NORM_L2) */
    static double norm(double[] v) {
        double s = 0;
        for (double x : v) s += x * x;
        return StrictMath.sqrt(s);
    }
}
