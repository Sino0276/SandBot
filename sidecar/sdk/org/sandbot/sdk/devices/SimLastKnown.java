package org.sandbot.sdk.devices;

import org.sandbot.sim.Sim;

/**
 * 실제 SDK의 com.qualcomm.robotcore.util.LastKnown과 같은 의미(기본 신선도 500 ms)를 가상 시계로 쓴다.
 * Lynx 컨트롤러는 마지막으로 보낸 값을 이것으로 기억해, 같은 값이면 허브에 명령을 다시 보내지 않는다
 * (LynxDcMotorController·LynxServoController·LynxDigitalChannelController와 같은 규칙).
 *
 * <p>실제 LastKnown은 ElapsedTime(System.nanoTime)을 쓰지만, 여기서는 비용 없는 {@link Sim#nanoTime()}을 쓴다
 * (가짜 SDK 내부의 시계 읽기가 팀 코드의 CLOCK_READ 비용을 늘리지 않게). 시뮬레이터가 없으면 시각 0으로 본다.
 */
final class SimLastKnown<T> {
    private static final double DEFAULT_MS_FRESHNESS = 500;

    private T value;
    private boolean isValid;
    private long setNanos;
    private final double msFreshness;

    SimLastKnown() {
        this(DEFAULT_MS_FRESHNESS);
    }

    SimLastKnown(double msFreshness) {
        this.msFreshness = msFreshness;
    }

    static long now() {
        return Sim.installed() ? Sim.nanoTime() : 0;
    }

    void invalidate() {
        isValid = false;
    }

    /** 값이 있고 아직 신선한가(신선도가 지나면 저절로 무효가 된다) */
    boolean isValid() {
        return isValid && (now() - setNanos) / 1e6 <= msFreshness;
    }

    T getValue() {
        return isValid() ? value : null;
    }

    /** 신선도를 보지 않은 값(실제 getNonTimedValue) */
    T getNonTimedValue() {
        return isValid ? value : null;
    }

    T setValue(T newValue) {
        T previous = value;
        value = newValue;
        isValid = true;
        if (newValue == null) invalidate();
        else setNanos = now();
        return previous;
    }

    boolean isValue(T query) {
        return isValid() && value.equals(query);
    }

    /** 값이 다르거나 신선하지 않으면 바꾸고 true(허브에 보내야 함) */
    boolean updateValue(T query) {
        if (isValue(query)) return false;
        setValue(query);
        return true;
    }
}
