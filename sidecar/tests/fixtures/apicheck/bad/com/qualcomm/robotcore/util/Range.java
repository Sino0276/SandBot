// SandBot 테스트 픽스처: 실제 Range와 API가 다른 손 구현(ApiCheck가 각각을 잡아야 한다, build.test.ts).
package com.qualcomm.robotcore.util;

public class Range {
    private Range() {}

    // static이 빠졌다
    public double scale(double n, double x1, double x2, double y1, double y2) {
        return 0;
    }

    public static double clip(double number, double min, double max) {
        return number;
    }

    public static float clip(float number, float min, float max) {
        return number;
    }

    public static int clip(int number, int min, int max) {
        return number;
    }

    public static short clip(short number, short min, short max) {
        return number;
    }

    // clip(byte, byte, byte)이 없다

    // throws가 빠졌다
    public static void throwIfRangeIsInvalid(double number, double min, double max) {}

    public static void throwIfRangeIsInvalid(int number, int min, int max) throws IllegalArgumentException {}

    // 실제 API에 없는 public 메서드
    public static int extra() {
        return 0;
    }
}
