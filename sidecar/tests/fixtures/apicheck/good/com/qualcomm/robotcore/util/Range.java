// SandBot 테스트 픽스처: 실제 Range와 public API가 같은 손 구현(ApiCheck가 통과시켜야 한다). 본문은 확인과 관계없다.
package com.qualcomm.robotcore.util;

public class Range {
    private Range() {}

    public static double scale(double n, double x1, double x2, double y1, double y2) {
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

    public static byte clip(byte number, byte min, byte max) {
        return number;
    }

    public static void throwIfRangeIsInvalid(double number, double min, double max) throws IllegalArgumentException {}

    public static void throwIfRangeIsInvalid(int number, int min, int max) throws IllegalArgumentException {}

    // 패키지-private 이하는 자유
    static int helper() {
        return 1;
    }
}
