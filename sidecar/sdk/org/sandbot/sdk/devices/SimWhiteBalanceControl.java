package org.sandbot.sdk.devices;

import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.WhiteBalanceControl;

/**
 * 웹캠 화이트밸런스 제어(spec-4d §1.10) [가정: 카메라 제어 범위 — AUTO·MANUAL(처음 AUTO), [2000, 6500] K, 처음 4000]. 기록만 한다.
 */
final class SimWhiteBalanceControl implements WhiteBalanceControl {
    private static final int MIN = 2000;
    private static final int MAX = 6500;

    private Mode mode = Mode.AUTO;
    private int temperature = 4000;

    @Override public synchronized Mode getMode() {
        return mode;
    }

    @Override public synchronized boolean setMode(Mode mode) {
        if (mode != Mode.AUTO && mode != Mode.MANUAL) return false;
        this.mode = mode;
        return true;
    }

    @Override public int getMinWhiteBalanceTemperature() {
        return MIN;
    }

    @Override public int getMaxWhiteBalanceTemperature() {
        return MAX;
    }

    @Override public synchronized int getWhiteBalanceTemperature() {
        return temperature;
    }

    @Override public synchronized boolean setWhiteBalanceTemperature(int temperature) {
        if (temperature < MIN || temperature > MAX) return false;
        this.temperature = temperature;
        return true;
    }
}
