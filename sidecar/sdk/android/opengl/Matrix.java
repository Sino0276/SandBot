package android.opengl;

/**
 * SandBot: 안드로이드 android.opengl.Matrix(API 16)의 순수 Java 구현. FTC SDK의 OpenGLMatrix·Orientation 계산이 쓴다.
 * 행렬은 실제와 같이 열 우선(column-major) float[16]이고, 결과 행렬을 offset부터 쓴다. 실제의 multiplyMM·multiplyMV는
 * 네이티브 메서드라 이 구현만 수식어 native가 없다(같은 계산).
 */
public class Matrix {
    /** rotateM이 쓰는 임시 공간(실제처럼 공유, 한 스레드만 쓴다) */
    private static final float[] sTemp = new float[32];

    public Matrix() {
    }

    private static void check(String name, float[] array, int offset, int count) {
        if (array == null) throw new IllegalArgumentException(name + " == null");
        if (offset < 0) throw new IllegalArgumentException(name + "Offset < 0");
        if (array.length - offset < count) throw new IllegalArgumentException("length - " + name + "Offset < " + count);
    }

    /** result = lhs × rhs(4×4). 결과가 입력과 겹쳐도 된다. */
    public static void multiplyMM(float[] result, int resultOffset, float[] lhs, int lhsOffset, float[] rhs, int rhsOffset) {
        check("result", result, resultOffset, 16);
        check("lhs", lhs, lhsOffset, 16);
        check("rhs", rhs, rhsOffset, 16);
        float[] r = new float[16];
        for (int i = 0; i < 4; i++) {
            for (int j = 0; j < 4; j++) {
                float sum = 0;
                for (int k = 0; k < 4; k++) sum += lhs[lhsOffset + i + 4 * k] * rhs[rhsOffset + k + 4 * j];
                r[i + 4 * j] = sum;
            }
        }
        System.arraycopy(r, 0, result, resultOffset, 16);
    }

    /** resultVec = lhsMat × rhsVec(4×4 × 4) */
    public static void multiplyMV(float[] resultVec, int resultVecOffset, float[] lhsMat, int lhsMatOffset, float[] rhsVec, int rhsVecOffset) {
        check("resultVec", resultVec, resultVecOffset, 4);
        check("lhsMat", lhsMat, lhsMatOffset, 16);
        check("rhsVec", rhsVec, rhsVecOffset, 4);
        float[] r = new float[4];
        for (int i = 0; i < 4; i++) {
            float sum = 0;
            for (int k = 0; k < 4; k++) sum += lhsMat[lhsMatOffset + i + 4 * k] * rhsVec[rhsVecOffset + k];
            r[i] = sum;
        }
        System.arraycopy(r, 0, resultVec, resultVecOffset, 4);
    }

    public static void transposeM(float[] mTrans, int mTransOffset, float[] m, int mOffset) {
        for (int i = 0; i < 4; i++) {
            int mBase = i * 4 + mOffset;
            mTrans[i + mTransOffset] = m[mBase];
            mTrans[i + 4 + mTransOffset] = m[mBase + 1];
            mTrans[i + 8 + mTransOffset] = m[mBase + 2];
            mTrans[i + 12 + mTransOffset] = m[mBase + 3];
        }
    }

    /** 역행렬(여인수 전개). 행렬식이 0이면 false이고 결과를 쓰지 않는다. */
    public static boolean invertM(float[] mInv, int mInvOffset, float[] m, int mOffset) {
        float[] a = new float[16];
        System.arraycopy(m, mOffset, a, 0, 16);
        float[] inv = new float[16];
        inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
        inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
        inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
        inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
        inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
        inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
        inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
        inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
        inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
        inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
        inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
        inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
        inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
        inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
        inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
        inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
        float det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
        if (det == 0.0f) return false;
        float invdet = 1.0f / det;
        for (int i = 0; i < 16; i++) mInv[mInvOffset + i] = inv[i] * invdet;
        return true;
    }

    public static void orthoM(float[] m, int mOffset, float left, float right, float bottom, float top, float near, float far) {
        if (left == right) throw new IllegalArgumentException("left == right");
        if (bottom == top) throw new IllegalArgumentException("bottom == top");
        if (near == far) throw new IllegalArgumentException("near == far");
        final float rWidth = 1.0f / (right - left);
        final float rHeight = 1.0f / (top - bottom);
        final float rDepth = 1.0f / (far - near);
        final float x = 2.0f * (rWidth);
        final float y = 2.0f * (rHeight);
        final float z = -2.0f * (rDepth);
        final float tx = -(right + left) * rWidth;
        final float ty = -(top + bottom) * rHeight;
        final float tz = -(far + near) * rDepth;
        m[mOffset + 0] = x;
        m[mOffset + 5] = y;
        m[mOffset + 10] = z;
        m[mOffset + 12] = tx;
        m[mOffset + 13] = ty;
        m[mOffset + 14] = tz;
        m[mOffset + 15] = 1.0f;
        m[mOffset + 1] = 0.0f;
        m[mOffset + 2] = 0.0f;
        m[mOffset + 3] = 0.0f;
        m[mOffset + 4] = 0.0f;
        m[mOffset + 6] = 0.0f;
        m[mOffset + 7] = 0.0f;
        m[mOffset + 8] = 0.0f;
        m[mOffset + 9] = 0.0f;
        m[mOffset + 11] = 0.0f;
    }

    public static void frustumM(float[] m, int offset, float left, float right, float bottom, float top, float near, float far) {
        if (left == right) throw new IllegalArgumentException("left == right");
        if (top == bottom) throw new IllegalArgumentException("top == bottom");
        if (near == far) throw new IllegalArgumentException("near == far");
        if (near <= 0.0f) throw new IllegalArgumentException("near <= 0.0f");
        if (far <= 0.0f) throw new IllegalArgumentException("far <= 0.0f");
        final float rWidth = 1.0f / (right - left);
        final float rHeight = 1.0f / (top - bottom);
        final float rDepth = 1.0f / (near - far);
        final float x = 2.0f * (near * rWidth);
        final float y = 2.0f * (near * rHeight);
        final float a = (right + left) * rWidth;
        final float b = (top + bottom) * rHeight;
        final float c = (far + near) * rDepth;
        final float d = 2.0f * (far * near * rDepth);
        m[offset + 0] = x;
        m[offset + 5] = y;
        m[offset + 8] = a;
        m[offset + 9] = b;
        m[offset + 10] = c;
        m[offset + 14] = d;
        m[offset + 11] = -1.0f;
        m[offset + 1] = 0.0f;
        m[offset + 2] = 0.0f;
        m[offset + 3] = 0.0f;
        m[offset + 4] = 0.0f;
        m[offset + 6] = 0.0f;
        m[offset + 7] = 0.0f;
        m[offset + 12] = 0.0f;
        m[offset + 13] = 0.0f;
        m[offset + 15] = 0.0f;
    }

    public static void perspectiveM(float[] m, int offset, float fovy, float aspect, float zNear, float zFar) {
        float f = 1.0f / (float) Math.tan(fovy * (Math.PI / 360.0));
        float rangeReciprocal = 1.0f / (zNear - zFar);
        m[offset + 0] = f / aspect;
        m[offset + 1] = 0.0f;
        m[offset + 2] = 0.0f;
        m[offset + 3] = 0.0f;
        m[offset + 4] = 0.0f;
        m[offset + 5] = f;
        m[offset + 6] = 0.0f;
        m[offset + 7] = 0.0f;
        m[offset + 8] = 0.0f;
        m[offset + 9] = 0.0f;
        m[offset + 10] = (zFar + zNear) * rangeReciprocal;
        m[offset + 11] = -1.0f;
        m[offset + 12] = 0.0f;
        m[offset + 13] = 0.0f;
        m[offset + 14] = 2.0f * zFar * zNear * rangeReciprocal;
        m[offset + 15] = 0.0f;
    }

    public static float length(float x, float y, float z) {
        return (float) Math.sqrt(x * x + y * y + z * z);
    }

    public static void setIdentityM(float[] sm, int smOffset) {
        for (int i = 0; i < 16; i++) sm[smOffset + i] = 0;
        for (int i = 0; i < 16; i += 5) sm[smOffset + i] = 1.0f;
    }

    public static void scaleM(float[] sm, int smOffset, float[] m, int mOffset, float x, float y, float z) {
        for (int i = 0; i < 4; i++) {
            int smi = smOffset + i;
            int mi = mOffset + i;
            sm[smi] = m[mi] * x;
            sm[4 + smi] = m[4 + mi] * y;
            sm[8 + smi] = m[8 + mi] * z;
            sm[12 + smi] = m[12 + mi];
        }
    }

    public static void scaleM(float[] m, int mOffset, float x, float y, float z) {
        for (int i = 0; i < 4; i++) {
            int mi = mOffset + i;
            m[mi] *= x;
            m[4 + mi] *= y;
            m[8 + mi] *= z;
        }
    }

    public static void translateM(float[] tm, int tmOffset, float[] m, int mOffset, float x, float y, float z) {
        for (int i = 0; i < 12; i++) tm[tmOffset + i] = m[mOffset + i];
        for (int i = 0; i < 4; i++) {
            int tmi = tmOffset + i;
            int mi = mOffset + i;
            tm[12 + tmi] = m[mi] * x + m[4 + mi] * y + m[8 + mi] * z + m[12 + mi];
        }
    }

    public static void translateM(float[] m, int mOffset, float x, float y, float z) {
        for (int i = 0; i < 4; i++) {
            int mi = mOffset + i;
            m[12 + mi] += m[mi] * x + m[4 + mi] * y + m[8 + mi] * z;
        }
    }

    /** rm = m × R(a도, 축 x·y·z) */
    public static void rotateM(float[] rm, int rmOffset, float[] m, int mOffset, float a, float x, float y, float z) {
        synchronized (sTemp) {
            setRotateM(sTemp, 0, a, x, y, z);
            multiplyMM(rm, rmOffset, m, mOffset, sTemp, 0);
        }
    }

    public static void rotateM(float[] m, int mOffset, float a, float x, float y, float z) {
        synchronized (sTemp) {
            setRotateM(sTemp, 0, a, x, y, z);
            multiplyMM(sTemp, 16, m, mOffset, sTemp, 0);
            System.arraycopy(sTemp, 16, m, mOffset, 16);
        }
    }

    /** 축 (x, y, z)에 대한 a도 회전 */
    public static void setRotateM(float[] rm, int rmOffset, float a, float x, float y, float z) {
        rm[rmOffset + 3] = 0;
        rm[rmOffset + 7] = 0;
        rm[rmOffset + 11] = 0;
        rm[rmOffset + 12] = 0;
        rm[rmOffset + 13] = 0;
        rm[rmOffset + 14] = 0;
        rm[rmOffset + 15] = 1;
        a *= (float) (Math.PI / 180.0f);
        float s = (float) Math.sin(a);
        float c = (float) Math.cos(a);
        if (1.0f == x && 0.0f == y && 0.0f == z) {
            rm[rmOffset + 5] = c;
            rm[rmOffset + 10] = c;
            rm[rmOffset + 6] = s;
            rm[rmOffset + 9] = -s;
            rm[rmOffset + 1] = 0;
            rm[rmOffset + 2] = 0;
            rm[rmOffset + 4] = 0;
            rm[rmOffset + 8] = 0;
            rm[rmOffset + 0] = 1;
        } else if (0.0f == x && 1.0f == y && 0.0f == z) {
            rm[rmOffset + 0] = c;
            rm[rmOffset + 10] = c;
            rm[rmOffset + 8] = s;
            rm[rmOffset + 2] = -s;
            rm[rmOffset + 1] = 0;
            rm[rmOffset + 4] = 0;
            rm[rmOffset + 6] = 0;
            rm[rmOffset + 9] = 0;
            rm[rmOffset + 5] = 1;
        } else if (0.0f == x && 0.0f == y && 1.0f == z) {
            rm[rmOffset + 0] = c;
            rm[rmOffset + 5] = c;
            rm[rmOffset + 1] = s;
            rm[rmOffset + 4] = -s;
            rm[rmOffset + 2] = 0;
            rm[rmOffset + 6] = 0;
            rm[rmOffset + 8] = 0;
            rm[rmOffset + 9] = 0;
            rm[rmOffset + 10] = 1;
        } else {
            float len = length(x, y, z);
            if (1.0f != len) {
                float recipLen = 1.0f / len;
                x *= recipLen;
                y *= recipLen;
                z *= recipLen;
            }
            float nc = 1.0f - c;
            float xy = x * y;
            float yz = y * z;
            float zx = z * x;
            float xs = x * s;
            float ys = y * s;
            float zs = z * s;
            rm[rmOffset + 0] = x * x * nc + c;
            rm[rmOffset + 4] = xy * nc - zs;
            rm[rmOffset + 8] = zx * nc + ys;
            rm[rmOffset + 1] = xy * nc + zs;
            rm[rmOffset + 5] = y * y * nc + c;
            rm[rmOffset + 9] = yz * nc - xs;
            rm[rmOffset + 2] = zx * nc - ys;
            rm[rmOffset + 6] = yz * nc + xs;
            rm[rmOffset + 10] = z * z * nc + c;
        }
    }

    /** 오일러 각(도) x·y·z 회전 */
    public static void setRotateEulerM(float[] rm, int rmOffset, float x, float y, float z) {
        x *= (float) (Math.PI / 180.0f);
        y *= (float) (Math.PI / 180.0f);
        z *= (float) (Math.PI / 180.0f);
        float cx = (float) Math.cos(x);
        float sx = (float) Math.sin(x);
        float cy = (float) Math.cos(y);
        float sy = (float) Math.sin(y);
        float cz = (float) Math.cos(z);
        float sz = (float) Math.sin(z);
        float cxsy = cx * sy;
        float sxsy = sx * sy;
        rm[rmOffset + 0] = cy * cz;
        rm[rmOffset + 1] = -cy * sz;
        rm[rmOffset + 2] = sy;
        rm[rmOffset + 3] = 0.0f;
        rm[rmOffset + 4] = cxsy * cz + cx * sz;
        rm[rmOffset + 5] = -cxsy * sz + cx * cz;
        rm[rmOffset + 6] = -sx * cy;
        rm[rmOffset + 7] = 0.0f;
        rm[rmOffset + 8] = -sxsy * cz + sx * sz;
        rm[rmOffset + 9] = sxsy * sz + sx * cz;
        rm[rmOffset + 10] = cx * cy;
        rm[rmOffset + 11] = 0.0f;
        rm[rmOffset + 12] = 0.0f;
        rm[rmOffset + 13] = 0.0f;
        rm[rmOffset + 14] = 0.0f;
        rm[rmOffset + 15] = 1.0f;
    }

    public static void setLookAtM(float[] rm, int rmOffset, float eyeX, float eyeY, float eyeZ,
            float centerX, float centerY, float centerZ, float upX, float upY, float upZ) {
        float fx = centerX - eyeX;
        float fy = centerY - eyeY;
        float fz = centerZ - eyeZ;
        float rlf = 1.0f / length(fx, fy, fz);
        fx *= rlf;
        fy *= rlf;
        fz *= rlf;
        float sx = fy * upZ - fz * upY;
        float sy = fz * upX - fx * upZ;
        float sz = fx * upY - fy * upX;
        float rls = 1.0f / length(sx, sy, sz);
        sx *= rls;
        sy *= rls;
        sz *= rls;
        float ux = sy * fz - sz * fy;
        float uy = sz * fx - sx * fz;
        float uz = sx * fy - sy * fx;
        rm[rmOffset + 0] = sx;
        rm[rmOffset + 1] = ux;
        rm[rmOffset + 2] = -fx;
        rm[rmOffset + 3] = 0.0f;
        rm[rmOffset + 4] = sy;
        rm[rmOffset + 5] = uy;
        rm[rmOffset + 6] = -fy;
        rm[rmOffset + 7] = 0.0f;
        rm[rmOffset + 8] = sz;
        rm[rmOffset + 9] = uz;
        rm[rmOffset + 10] = -fz;
        rm[rmOffset + 11] = 0.0f;
        rm[rmOffset + 12] = 0.0f;
        rm[rmOffset + 13] = 0.0f;
        rm[rmOffset + 14] = 0.0f;
        rm[rmOffset + 15] = 1.0f;
        translateM(rm, rmOffset, -eyeX, -eyeY, -eyeZ);
    }
}
