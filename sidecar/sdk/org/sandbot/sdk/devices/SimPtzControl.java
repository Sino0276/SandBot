package org.sandbot.sdk.devices;

import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.PtzControl;

/** 웹캠 팬·틸트·줌 제어(spec-4d §1.10) [가정: 카메라 제어 범위 — 팬·틸트 [0, 0], 줌 [100, 500], 처음 100]. 기록만 한다. */
final class SimPtzControl implements PtzControl {
    private static final int MIN_ZOOM = 100;
    private static final int MAX_ZOOM = 500;

    private int zoom = MIN_ZOOM;

    @Override public PanTiltHolder getPanTilt() {
        return new PanTiltHolder();
    }

    @Override public boolean setPanTilt(PanTiltHolder panTiltHolder) {
        return panTiltHolder != null && panTiltHolder.pan == 0 && panTiltHolder.tilt == 0;
    }

    @Override public PanTiltHolder getMinPanTilt() {
        return new PanTiltHolder();
    }

    @Override public PanTiltHolder getMaxPanTilt() {
        return new PanTiltHolder();
    }

    @Override public synchronized int getZoom() {
        return zoom;
    }

    @Override public synchronized boolean setZoom(int zoom) {
        if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) return false;
        this.zoom = zoom;
        return true;
    }

    @Override public int getMinZoom() {
        return MIN_ZOOM;
    }

    @Override public int getMaxZoom() {
        return MAX_ZOOM;
    }
}
