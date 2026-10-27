package org.sandbot.sdk.devices;

import android.graphics.Color;
import android.opengl.Matrix;

import org.firstinspires.ftc.robotcore.external.matrices.OpenGLMatrix;
import org.firstinspires.ftc.robotcore.external.matrices.VectorF;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.AxesOrder;
import org.firstinspires.ftc.robotcore.external.navigation.AxesReference;
import org.firstinspires.ftc.robotcore.external.navigation.Orientation;
import org.sandbot.testing.Check;

/** android.graphics.Color·android.opengl.Matrix 순수 구현(안드로이드와 같은 값) */
public final class AndroidMathTest {
    private AndroidMathTest() {}

    public static void testColorComponents() {
        int c = Color.argb(0x80, 0x12, 0x34, 0x56);
        Check.equal(0x80123456, c, "argb");
        Check.equal(0x80, Color.alpha(c), "alpha");
        Check.equal(0x12, Color.red(c), "red");
        Check.equal(0x34, Color.green(c), "green");
        Check.equal(0x56, Color.blue(c), "blue");
        Check.equal(0xFF123456, Color.rgb(0x12, 0x34, 0x56), "rgb");
        Check.equal(0xFF00FF00, Color.parseColor("#00FF00"), "parse #RRGGBB");
        Check.equal(0x1200FF00, Color.parseColor("#1200FF00"), "parse #AARRGGBB");
        Check.equal(Color.MAGENTA, Color.parseColor("Fuchsia"), "parse name");
        Check.throwsType(IllegalArgumentException.class, () -> Color.parseColor("#123"), "bad length");
        Check.throwsType(IllegalArgumentException.class, () -> Color.parseColor("orange"), "unknown name");
    }

    public static void testHsvMatchesAndroid() {
        float[] hsv = new float[3];
        Color.RGBToHSV(255, 0, 0, hsv);
        Check.near(0, hsv[0], 1e-6, "red hue");
        Check.near(1, hsv[1], 1e-6, "red saturation");
        Check.near(1, hsv[2], 1e-6, "red value");
        Color.colorToHSV(0xFF3366CC, hsv);
        Check.near(220, hsv[0], 1e-3, "blue-ish hue");
        Check.near(0.75, hsv[1], 1e-3, "saturation");
        Check.near(0.8, hsv[2], 1e-3, "value");
        Color.RGBToHSV(10, 200, 30, hsv);
        int back = Color.HSVToColor(hsv);
        Check.equal(Color.rgb(10, 200, 30), back, "round trip");
        Check.equal(0x7FFFFF00, Color.HSVToColor(0x7F, new float[] {60, 1, 1}), "yellow with alpha");
        Check.equal(Color.rgb(128, 128, 128), Color.HSVToColor(new float[] {123, 0, 128 / 255f}), "gray (no saturation)");
        Color.RGBToHSV(0, 0, 0, hsv);
        Check.near(0, hsv[0] + hsv[1] + hsv[2], 1e-9, "black");
    }

    static void near(float[] expected, float[] actual, String message) {
        for (int i = 0; i < expected.length; i++) Check.near(expected[i], actual[i], 1e-5, message + "[" + i + "]");
    }

    public static void testMatrixIsColumnMajor() {
        float[] m = new float[16];
        Matrix.setIdentityM(m, 0);
        Matrix.translateM(m, 0, 1, 2, 3);
        // 열 우선: 이동은 12·13·14번 칸
        near(new float[] {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1}, m, "translation in the last column");
        float[] v = new float[4];
        Matrix.multiplyMV(v, 0, m, 0, new float[] {1, 1, 1, 1}, 0);
        near(new float[] {2, 3, 4, 1}, v, "translate point");

        float[] r = new float[16];
        Matrix.setRotateM(r, 0, 90, 0, 0, 1);
        Matrix.multiplyMV(v, 0, r, 0, new float[] {1, 0, 0, 1}, 0);
        near(new float[] {0, 1, 0, 1}, v, "rotate x to y about z");

        float[] rt = new float[16];
        Matrix.multiplyMM(rt, 0, m, 0, r, 0);
        Matrix.multiplyMV(v, 0, rt, 0, new float[] {1, 0, 0, 1}, 0);
        near(new float[] {1, 3, 3, 1}, v, "translate after rotate");

        float[] inv = new float[16];
        Check.isTrue(Matrix.invertM(inv, 0, rt, 0), "invertible");
        float[] id = new float[16];
        Matrix.multiplyMM(id, 0, inv, 0, rt, 0);
        float[] identity = new float[16];
        Matrix.setIdentityM(identity, 0);
        near(identity, id, "inverse");
        Check.isTrue(!Matrix.invertM(inv, 0, new float[16], 0), "zero matrix is not invertible");

        float[] t = new float[16];
        Matrix.transposeM(t, 0, m, 0);
        Check.near(1, t[3], 1e-6, "transpose moves translation to the last column of rows");
        Check.near(Math.sqrt(14), Matrix.length(1, 2, 3), 1e-6, "length");

        float[] s = new float[16];
        Matrix.setIdentityM(s, 0);
        Matrix.scaleM(s, 0, 2, 3, 4);
        Matrix.multiplyMV(v, 0, s, 0, new float[] {1, 1, 1, 1}, 0);
        near(new float[] {2, 3, 4, 1}, v, "scale");
    }

    public static void testMatrixProjections() {
        float[] o = new float[16];
        Matrix.orthoM(o, 0, -2, 2, -1, 1, 0.5f, 10);
        float[] v = new float[4];
        Matrix.multiplyMV(v, 0, o, 0, new float[] {2, 1, -10, 1}, 0);
        near(new float[] {1, 1, 1, 1}, v, "ortho corner");
        float[] p = new float[16];
        Matrix.perspectiveM(p, 0, 90, 1, 1, 100);
        Matrix.multiplyMV(v, 0, p, 0, new float[] {1, 1, -1, 1}, 0);
        near(new float[] {1, 1, -1, 1}, v, "perspective near corner");
        float[] f = new float[16];
        Matrix.frustumM(f, 0, -1, 1, -1, 1, 1, 100);
        near(p, f, "frustum equals perspective");
        float[] look = new float[16];
        Matrix.setLookAtM(look, 0, 0, 0, 5, 0, 0, 0, 0, 1, 0);
        Matrix.multiplyMV(v, 0, look, 0, new float[] {0, 0, 0, 1}, 0);
        near(new float[] {0, 0, -5, 1}, v, "look at origin");
    }

    /** FTC의 OpenGLMatrix(실제 들여온 클래스)가 Matrix를 거쳐 맞게 돈다 */
    public static void testOpenGLMatrixUsesMatrix() {
        OpenGLMatrix m = OpenGLMatrix.translation(10, 0, 0)
                .multiplied(Orientation.getRotationMatrix(AxesReference.EXTRINSIC, AxesOrder.XYZ, AngleUnit.DEGREES, 0, 0, 90));
        VectorF v = m.transform(new VectorF(1, 0, 0));
        Check.near(10, v.get(0), 1e-5, "x");
        Check.near(1, v.get(1), 1e-5, "y");
        OpenGLMatrix inv = m.inverted();
        VectorF back = inv.transform(v);
        Check.near(1, back.get(0), 1e-5, "inverse x");
        Check.near(0, back.get(1), 1e-5, "inverse y");
        Orientation o = Orientation.getOrientation(m, AxesReference.EXTRINSIC, AxesOrder.XYZ, AngleUnit.DEGREES);
        Check.near(90, o.thirdAngle, 1e-3, "orientation from matrix");
    }
}
