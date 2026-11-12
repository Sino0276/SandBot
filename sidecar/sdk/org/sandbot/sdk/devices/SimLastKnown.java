package org.sandbot.sdk.devices;

import org.sandbot.sim.Sim;
import org.sandbot.sim.SimCost;

/**
 * 실제 SDK의 com.qualcomm.robotcore.util.LastKnown과 같은 의미(기본 신선도 500 ms)를 가상 시계로 쓴다.
 * Lynx 컨트롤러는 마지막으로 보낸 값을 이것으로 기억해, 같은 값이면 허브에 명령을 다시 보내지 않는다
 * (LynxDcMotorController·LynxServoController·LynxDigitalChannelController와 같은 규칙).
 *
 * <p>비용: 실제 LastKnown.isValid는 신선도를 보려고 ElapsedTime(System.nanoTime)을 읽는다. SandBot은 캐시가 답할 때
 * ({@link #isValue}가 true, {@link #getValue}가 값을 냄: 같은 값 쓰기를 건너뛰거나 신선한 값을 읽음) 그 시계 읽기 한 번으로
 * CLOCK_READ를 청구한다. 그래서 캐시로만 답하는 루프(STOP을 무시하고 같은 power만 쓰는 루프 등)도 가상 시간이 흘러 틱 경계의
 * START·STOP이 적용되고, 500 ms 뒤에는 실제처럼 다시 보내며, STOP 뒤에는 stuckInStop으로 끝난다(isStarted·isStopRequested의
 * CLOCK_READ, 취소된 명령의 잠금 CLOCK_READ와 같은 생각). 캐시가 답하지 못해 허브로 가는 경로(신선도를 보거나 값을 기억하는 시계
 * 읽기 포함)는 허브 명령 비용(실측 근사)이 SDK 안의 일을 포함한다고 보아 따로 청구하지 않는다. 청구는 팀 코드가 도는 동안
 * (SimHub charging: beforeInit ~ afterStop)만이고, 런타임의 fail safe·구성 읽기는 청구하지 않는다.
 *
 * <p>시계 읽기 자체({@link #now()})는 비용 없는 {@link Sim#nanoTime()}이다(칩도 쓴다. 칩의 입력 훅은 시계를 부르지 않는다).
 * 시뮬레이터가 없으면 시각 0으로 본다.
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

    /** 캐시가 답했다: 실제 isValid가 읽은 시계 한 번(팀 코드가 도는 동안만) */
    private static void chargeHit() {
        if (Sim.installed() && SimHub.isCharging()) Sim.charge(SimCost.CLOCK_READ);
    }

    void invalidate() {
        isValid = false;
    }

    /** 값이 있고 아직 신선한가(신선도가 지나면 저절로 무효가 된다). 비용 없음(청구는 isValue·getValue가 답할 때). */
    boolean isValid() {
        return isValid && (now() - setNanos) / 1e6 <= msFreshness;
    }

    /** 신선한 값(없으면 null). 값을 내면 CLOCK_READ 하나. */
    T getValue() {
        if (!isValid()) return null;
        // 청구하는 동안 틱 경계(STOP의 fail safe가 forgetLastKnown)가 와도 캐시가 이미 답한 값을 돌려준다
        T result = value;
        chargeHit();
        return result;
    }

    /** 신선도를 보지 않은 값(실제 getNonTimedValue: 시계를 읽지 않아 비용 없음) */
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

    /** 신선한 값이 query와 같은가. 같으면(캐시가 답함) CLOCK_READ 하나. */
    boolean isValue(T query) {
        boolean hit = isValid() && value.equals(query);
        if (hit) chargeHit();
        return hit;
    }

    /** 값이 다르거나 신선하지 않으면 바꾸고 true(허브에 보내야 함). 같으면 false이고 CLOCK_READ 하나(isValue). */
    boolean updateValue(T query) {
        if (isValue(query)) return false;
        setValue(query);
        return true;
    }
}
