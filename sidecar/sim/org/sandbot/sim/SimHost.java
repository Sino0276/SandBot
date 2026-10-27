package org.sandbot.sim;

/** 가짜 SDK가 런타임(호스트 쪽)에 알리는 것. 런타임이 구현해 {@link Sim#install}로 넣는다. OpMode 스레드에서 부른다. */
public interface SimHost {
    /** telemetry.update가 실제로 보냈다(DS 화면 한 번) */
    void telemetry(TelemetryFrame frame);

    /** 로그 한 줄. stream: "out"·"err"(가로챈 System.out·err), "robotLog"(RobotLog·android.util.Log) */
    void log(String stream, String text);

    /** 루프 표시(LinearOpMode.opModeIsActive·opModeInInit·idle, 반복 OpMode의 init_loop·loop 한 번) */
    void loopMarker();
}
