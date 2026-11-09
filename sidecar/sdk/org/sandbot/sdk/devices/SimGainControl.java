package org.sandbot.sdk.devices;

import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.GainControl;

/** 웹캠 게인 제어(spec-4d §1.10) [가정: 카메라 제어 범위 [0, 255], 처음 0]. 기록만 한다. */
final class SimGainControl implements GainControl {
    private static final int MIN = 0;
    private static final int MAX = 255;

    private final SimCamera camera;
    private int gain = 0;

    SimGainControl(SimCamera camera) {
        this.camera = camera;
    }

    @Override public int getMinGain() {
        return MIN;
    }

    @Override public int getMaxGain() {
        return MAX;
    }

    @Override public synchronized int getGain() {
        return gain;
    }

    @Override public boolean setGain(int gain) {
        if (gain < MIN || gain > MAX) return false;
        synchronized (this) {
            this.gain = gain;
        }
        camera.controlsChanged();
        return true;
    }
}
