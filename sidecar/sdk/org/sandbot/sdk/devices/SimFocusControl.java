package org.sandbot.sdk.devices;

import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.FocusControl;

/**
 * 웹캠 초점 제어(spec-4d §1.10) [가정: 카메라 제어 범위 — 모드 Auto·Fixed(UVC 자동 초점 모드 대응, 처음 Auto), 초점 [0, 250],
 * 처음 0]. 기록만 한다.
 */
final class SimFocusControl implements FocusControl {
    private static final double MIN = 0;
    private static final double MAX = 250;

    private Mode mode = Mode.Auto;
    private double focus = 0;

    @Override public synchronized Mode getMode() {
        return mode;
    }

    @Override public synchronized boolean setMode(Mode mode) {
        if (!isModeSupported(mode)) return false;
        this.mode = mode;
        return true;
    }

    @Override public boolean isModeSupported(Mode mode) {
        return mode == Mode.Auto || mode == Mode.Fixed;
    }

    @Override public double getMinFocusLength() {
        return MIN;
    }

    @Override public double getMaxFocusLength() {
        return MAX;
    }

    @Override public synchronized double getFocusLength() {
        return focus;
    }

    @Override public synchronized boolean setFocusLength(double focus) {
        if (!(focus >= MIN && focus <= MAX)) return false;
        this.focus = focus;
        return true;
    }

    @Override public boolean isFocusLengthSupported() {
        return true;
    }
}
