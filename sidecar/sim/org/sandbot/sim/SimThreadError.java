package org.sandbot.sim;

/**
 * 1단계는 OpMode 스레드 하나만 가상 시계·하드웨어를 쓴다. 다른 스레드가 쓰면(또는 OpMode 스레드가 살아 있는 다른 스레드를
 * 기다리면) 이 오류를 던져 그 스레드를 멈춘다. 런타임은 error kind "thread"로 알리고 OpMode를 끝낸다.
 * Error라서 팀 코드의 catch (Exception)이 삼키지 않는다.
 */
public final class SimThreadError extends Error {
    /** true면 이 오류는 이미 호스트에 알렸다(다른 스레드에서 알리고 OpMode 스레드를 멈출 때) */
    private final boolean reported;

    public SimThreadError(String message) {
        this(message, false);
    }

    public SimThreadError(String message, boolean reported) {
        super(message);
        this.reported = reported;
    }

    public boolean reported() {
        return reported;
    }
}
