package org.firstinspires.ftc.robotcore.external;

// SDK 껍데기
public interface Telemetry {
    Object addData(String caption, Object value);

    Object addLine(String lineCaption);

    boolean update();
}
