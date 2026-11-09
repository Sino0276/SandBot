package org.sandbot.sdk.devices;

import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.ExposureControl;
import org.firstinspires.ftc.robotcore.internal.collections.MutableReference;

import java.util.concurrent.TimeUnit;

/**
 * 웹캠 노출 제어(spec-4d §1.10) [가정: 카메라 제어 범위 — 모든 모델이 같은 범위]. 값은 기록만 하고 시뮬레이터 영상에 영향이 없다.
 * 노출은 UVC 절대 노출 단위(100 µs)로 3–2047(300 µs–204.7 ms, C920 꼴)이고, 읽는 값은 실제 UvcApiExposureControl처럼
 * resultUnit.convert(ns, NANOSECONDS)라 버림이다(그래서 getMinExposure(MILLISECONDS)는 0이다). 처음 값 333 단위(33.3 ms),
 * 지원 모드는 Manual·AperturePriority(처음 AperturePriority).
 */
final class SimExposureControl implements ExposureControl {
    /** UVC 절대 노출 단위(ns): 100 µs */
    private static final long UNIT_NANOS = 100_000L;
    /** 최소·최대·처음 노출(100 µs 단위) [가정: 카메라 제어 범위, C920 꼴] */
    private static final long MIN_UNITS = 3;
    private static final long MAX_UNITS = 2047;
    private static final long INITIAL_UNITS = 333;

    private final SimCamera camera;
    private Mode mode = Mode.AperturePriority;
    private long units = INITIAL_UNITS;
    private boolean aePriority = false;

    SimExposureControl(SimCamera camera) {
        this.camera = camera;
    }

    @Override public synchronized Mode getMode() {
        return mode;
    }

    @Override public boolean setMode(Mode mode) {
        if (!isModeSupported(mode)) return false;
        synchronized (this) {
            this.mode = mode;
        }
        camera.controlsChanged();
        return true;
    }

    @Override public boolean isModeSupported(Mode mode) {
        return mode == Mode.Manual || mode == Mode.AperturePriority;
    }

    @Override public long getMinExposure(TimeUnit resultUnit) {
        return resultUnit.convert(MIN_UNITS * UNIT_NANOS, TimeUnit.NANOSECONDS);
    }

    @Override public long getMaxExposure(TimeUnit resultUnit) {
        return resultUnit.convert(MAX_UNITS * UNIT_NANOS, TimeUnit.NANOSECONDS);
    }

    @Override public synchronized long getExposure(TimeUnit resultUnit) {
        return resultUnit.convert(units * UNIT_NANOS, TimeUnit.NANOSECONDS);
    }

    @Override public long getCachedExposure(TimeUnit resultUnit, MutableReference<Boolean> refreshed,
            long permittedStaleness, TimeUnit permittedStalenessUnit) {
        // 카메라와 주고받는 시간이 없어 늘 지금 값이다(새로 읽지 않았다)
        if (refreshed != null) refreshed.setValue(false);
        return getExposure(resultUnit);
    }

    @Override public boolean setExposure(long duration, TimeUnit durationUnit) {
        long requested = durationUnit.toNanos(duration) / UNIT_NANOS; // 100 µs 단위로 내림
        if (requested < MIN_UNITS || requested > MAX_UNITS) return false;
        synchronized (this) {
            units = requested;
        }
        camera.controlsChanged();
        return true;
    }

    @Override public boolean isExposureSupported() {
        return true;
    }

    @Override public synchronized boolean getAePriority() {
        return aePriority;
    }

    @Override public synchronized boolean setAePriority(boolean priority) {
        aePriority = priority;
        return true;
    }

    /** 출력 exposureMs: Manual이면 노출(ms), 아니면 null */
    synchronized Double exposureMs() {
        return mode == Mode.Manual ? units / 10.0 : null; // 100 µs 단위 → ms(나눗셈이라 33.3처럼 가장 가까운 double)
    }
}
