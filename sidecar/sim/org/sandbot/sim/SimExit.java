package org.sandbot.sim;

/**
 * 팀 코드가 System.exit·Runtime.exit·Runtime.halt를 불렀다. 패치한 코드가 JVM을 끝내는 대신 이 오류를 던지고,
 * 런타임은 OpMode를 끝낸 것으로 본다(finished terminated). Error라서 팀 코드의 catch (Exception)이 삼키지 않는다.
 */
public final class SimExit extends Error {
    private final int status;

    public SimExit(String api, int status) {
        super(api + "(" + status + ") was called; the OpMode is terminated");
        this.status = status;
    }

    public int status() {
        return status;
    }
}
