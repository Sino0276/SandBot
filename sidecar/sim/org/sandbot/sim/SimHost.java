package org.sandbot.sim;

/** 가짜 SDK가 런타임(호스트 쪽)에 알리는 것. 런타임이 구현해 {@link Sim#install}로 넣는다. OpMode 스레드에서 부른다. */
public interface SimHost {
    /** telemetry.update가 실제로 보냈다(DS 화면 한 번) */
    void telemetry(TelemetryFrame frame);

    /** 로그 한 줄. stream: "out"·"err"(가로챈 System.out·err), "robotLog"(RobotLog·android.util.Log) */
    void log(String stream, String text);

    /** 루프 표시(LinearOpMode.opModeIsActive·opModeInInit·idle, 반복 OpMode의 init_loop·loop 한 번) */
    void loopMarker();

    /**
     * 사이드카 안내(프로토콜 notice, src/shared/sidecarProtocol.ts의 SidecarNoticeCode, spec-4d §1.14). 호스트가 같은
     * code·params는 실행마다 한 번 보인다. 기본은 아무것도 하지 않는다(시험 호스트가 깨지지 않게, Java 8 default).
     */
    default void notice(String code, java.util.Map<String, String> params) {}

    /**
     * 카메라 스레드의 예외로 OpMode를 멈춘다(EOCV emulateEStop의 대응, spec-4d §1.12). 런타임이 오류를 바로 보내고
     * 정지는 DS STOP과 같은 자리에서 적용한다. 기본은 받지 않는다(이 호스트는 비상 정지를 모른다).
     */
    default void emergencyStop(Throwable cause) {
        throw new IllegalStateException("this host does not support emergencyStop", cause);
    }
}
