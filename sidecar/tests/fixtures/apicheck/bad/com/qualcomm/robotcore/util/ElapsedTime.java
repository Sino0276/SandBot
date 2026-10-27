// SandBot 테스트 픽스처: 상수 값과 enum 상수 순서가 실제와 다른 ElapsedTime(ApiCheck가 잡아야 한다).
package com.qualcomm.robotcore.util;

import java.util.concurrent.TimeUnit;

public class ElapsedTime {
    // 실제는 1000000000L
    public static final long SECOND_IN_NANO = 1000000001L;
    public static final long MILLIS_IN_NANO = 1000000L;

    protected volatile long nsStartTime;
    protected final double resolution;

    // 실제 순서는 SECONDS, MILLISECONDS
    public enum Resolution {
        MILLISECONDS,
        SECONDS
    }

    public ElapsedTime() {
        resolution = 1;
    }

    public ElapsedTime(long startTime) {
        resolution = 1;
    }

    public ElapsedTime(Resolution resolution) {
        this.resolution = 1;
    }

    protected long nsNow() {
        return 0;
    }

    public long now(TimeUnit unit) {
        return 0;
    }

    public void reset() {}

    public double startTime() {
        return 0;
    }

    public long startTimeNanoseconds() {
        return 0;
    }

    public double time() {
        return 0;
    }

    public long time(TimeUnit unit) {
        return 0;
    }

    public double seconds() {
        return 0;
    }

    public double milliseconds() {
        return 0;
    }

    public long nanoseconds() {
        return 0;
    }

    public Resolution getResolution() {
        return Resolution.SECONDS;
    }

    public void log(String label) {}

    @Override
    public String toString() {
        return "";
    }
}
