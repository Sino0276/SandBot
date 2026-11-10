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

/*
   This is a translation to C++ from the Matlab's LMSolve package by Miroslav Balda.
   Here is the original copyright:
   ============================================================================

   Copyright (c) 2007, Miroslav Balda
   All rights reserved.

   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions are
   met:

       * Redistributions of source code must retain the above copyright
         notice, this list of conditions and the following disclaimer.
       * Redistributions in binary form must reproduce the above copyright
         notice, this list of conditions and the following disclaimer in
         the documentation and/or other materials provided with the distribution

   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
   ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
   LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
   CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
   SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
   INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
   CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
   ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
   POSSIBILITY OF SUCH DAMAGE.
*/
// SandBot: OpenCV 4.10.0 modules/calib3d/src/compat_ptsetreg.cpp(sha256 24e348b2…3f19)의 CvLevMarq(옛 LM, mask 모두 1,
// DECOMP_SVD)와 levmarq.cpp(sha256 b772e923…f6e2)의 LMSolverImpl(호모그래피 다듬기, DECOMP_EIG)을 옮겼다(spec-4d §1.12).
package org.sandbot.sdk.vision;

/** OpenCV의 두 Levenberg–Marquardt(CvLevMarq: cvFindExtrinsicCameraParams2, LMSolver: findHomography 다듬기). */
final class LevMarq {
    private LevMarq() {}

    /** CvLevMarq::update 한 번의 결과(J·err가 null이 아니면 호출한 쪽이 채운다) */
    static final class Update {
        boolean proceed;
        double[] param;
        double[] J;
        double[] err;
    }

    /** compat_ptsetreg.cpp CvLevMarq(completeSymmFlag는 err가 있어 쓰지 않는다) */
    static final class CvLevMarq {
        private static final int STARTED = 1;
        private static final int CALC_J = 2;
        private static final int CHECK_ERR = 3;
        private static final int DONE = 0;

        final double[] param;
        private final double[] prevParam;
        private final double[] J;
        private final double[] err;
        private double[] JtJ;
        private double[] JtErr;
        private final int nparams;
        private final int nerrs;
        private int lambdaLg10;
        private int state;
        private int iters;
        private final int maxIter;
        private final double epsilon;
        private double errNorm;
        private double prevErrNorm;

        /** criteria: CV_TERMCRIT_EPS + CV_TERMCRIT_ITER(maxIter, epsilon) */
        CvLevMarq(int nparams, int nerrs, int maxIter, double epsilon) {
            this.nparams = nparams;
            this.nerrs = nerrs;
            param = new double[nparams];
            prevParam = new double[nparams];
            J = new double[nerrs * nparams];
            err = new double[nerrs];
            errNorm = prevErrNorm = Double.MAX_VALUE;
            lambdaLg10 = -3;
            this.maxIter = Math.min(Math.max(maxIter, 1), 1000);
            this.epsilon = Math.max(epsilon, 0);
            state = STARTED;
            iters = 0;
        }

        Update update() {
            Update u = new Update();
            if (state == DONE) {
                u.param = param;
                u.proceed = false;
                return u;
            }
            if (state == STARTED) {
                u.param = param;
                java.util.Arrays.fill(J, 0);
                java.util.Arrays.fill(err, 0);
                u.J = J;
                u.err = err;
                state = CALC_J;
                u.proceed = true;
                return u;
            }
            if (state == CALC_J) {
                JtJ = Lapack.mulTransposedAtA(J, nerrs, nparams);
                JtErr = Lapack.mulAt(J, err, nerrs, nparams, 1);
                System.arraycopy(param, 0, prevParam, 0, nparams);
                step();
                if (iters == 0) prevErrNorm = Lapack.norm(err);
                u.param = param;
                java.util.Arrays.fill(err, 0);
                u.err = err;
                state = CHECK_ERR;
                u.proceed = true;
                return u;
            }
            errNorm = Lapack.norm(err);
            if (errNorm > prevErrNorm) {
                if (++lambdaLg10 <= 16) {
                    step();
                    u.param = param;
                    java.util.Arrays.fill(err, 0);
                    u.err = err;
                    state = CHECK_ERR;
                    u.proceed = true;
                    return u;
                }
            }
            lambdaLg10 = Math.max(lambdaLg10 - 1, -16);
            if (++iters >= maxIter || relativeL2(param, prevParam) < epsilon) {
                u.param = param;
                state = DONE;
                u.proceed = true;
                return u;
            }
            prevErrNorm = errNorm;
            u.param = param;
            java.util.Arrays.fill(J, 0);
            u.J = J;
            u.err = err;
            state = CALC_J;
            u.proceed = true;
            return u;
        }

        /** CvLevMarq::step(mask 모두 1): (JᵀJ의 대각 × (1 + λ))·d = Jᵀe를 SVD로 풀고 param = prev − d */
        private void step() {
            final double LOG10 = StrictMath.log(10.);
            double lambda = StrictMath.exp(lambdaLg10 * LOG10);
            double[] A = JtJ.clone();
            for (int i = 0; i < nparams; i++) A[i * nparams + i] *= 1. + lambda;
            double[] d = Lapack.solveSvd(A, nparams, nparams, JtErr, 1);
            for (int i = 0; i < nparams; i++) param[i] = prevParam[i] - d[i];
        }
    }

    /** cv::norm(a, b, NORM_RELATIVE | NORM_L2) = ‖a − b‖ / (‖b‖ + DBL_EPSILON) */
    static double relativeL2(double[] a, double[] b) {
        double s = 0;
        for (int i = 0; i < a.length; i++) {
            double d = a[i] - b[i];
            s += d * d;
        }
        return StrictMath.sqrt(s) / (Lapack.norm(b) + Lapack.DBL_EPSILON);
    }

    /** LMSolver::Callback: x에서 오차 r(필수)과 야코비 J(null이면 계산 안 함)를 채운다 */
    interface Callback {
        void compute(double[] x, double[] r, double[] J);
    }

    /**
     * levmarq.cpp LMSolverImpl::run(epsx = epsf = FLT_EPSILON). x(lx개)를 바꾸고 반복 수를 돌려준다(maxIters에 닿으면 음수).
     * nerr: 오차 개수.
     */
    static int run(Callback cb, double[] param0, int nerr, int maxIters) {
        final double eps = Lapack.FLT_EPSILON;
        int lx = param0.length;
        double[] x = param0.clone();
        double[] r = new double[nerr];
        double[] J = new double[nerr * lx];
        cb.compute(x, r, J);
        double S = sqNorm(r);
        double[] A = Lapack.mulTransposedAtA(J, nerr, lx);
        double[] v = Lapack.mulAt(J, r, nerr, lx, 1);
        double[] D = new double[lx];
        for (int i = 0; i < lx; i++) D[i] = A[i * lx + i];
        final double Rlo = 0.25;
        final double Rhi = 0.75;
        double lambda = 1;
        double lc = 0.75;
        int iter = 0;
        double[] xd = new double[lx];
        double[] rd = new double[nerr];
        for (;;) {
            double[] Ap = A.clone();
            for (int i = 0; i < lx; i++) Ap[i * lx + i] += lambda * D[i];
            double[] d = Lapack.solveEig(Ap, lx, v, 1);
            for (int i = 0; i < lx; i++) xd[i] = x[i] - d[i];
            cb.compute(xd, rd, null);
            double Sd = sqNorm(rd);
            // gemm(A, d, -1, v, 2, temp_d)
            double[] tempD = new double[lx];
            for (int i = 0; i < lx; i++) {
                double s = 0;
                for (int k = 0; k < lx; k++) s += A[i * lx + k] * d[k];
                tempD[i] = s * -1 + v[i] * 2;
            }
            double dS = dot(d, tempD);
            double R = (S - Sd) / (StrictMath.abs(dS) > Lapack.DBL_EPSILON ? dS : 1);
            if (R > Rhi) {
                lambda *= 0.5;
                if (lambda < lc) lambda = 0;
            } else if (R < Rlo) {
                // find new nu if R too low
                double t = dot(d, v);
                double nu = (Sd - S) / (StrictMath.abs(t) > Lapack.DBL_EPSILON ? t : 1) + 2;
                nu = Math.min(Math.max(nu, 2.), 10.);
                if (lambda == 0) {
                    double[] inv = Lapack.invertEig(A, lx);
                    double maxval = Lapack.DBL_EPSILON;
                    for (int i = 0; i < lx; i++) maxval = Math.max(maxval, StrictMath.abs(inv[i * lx + i]));
                    lambda = lc = 1. / maxval;
                    nu *= 0.5;
                }
                lambda *= nu;
            }
            if (Sd < S) {
                S = Sd;
                double[] tmp = x;
                x = xd;
                xd = tmp;
                cb.compute(x, r, J);
                A = Lapack.mulTransposedAtA(J, nerr, lx);
                v = Lapack.mulAt(J, r, nerr, lx, 1);
            }
            iter++;
            boolean proceed = iter < maxIters && infNorm(d) >= eps && infNorm(r) >= eps;
            if (!proceed) break;
        }
        System.arraycopy(x, 0, param0, 0, lx);
        if (iter == maxIters) iter = -iter;
        return iter;
    }

    private static double sqNorm(double[] v) {
        double s = 0;
        for (double x : v) s += x * x;
        return s;
    }

    private static double dot(double[] a, double[] b) {
        double s = 0;
        for (int i = 0; i < a.length; i++) s += a[i] * b[i];
        return s;
    }

    private static double infNorm(double[] v) {
        double m = 0;
        for (double x : v) m = Math.max(m, StrictMath.abs(x));
        return m;
    }
}
