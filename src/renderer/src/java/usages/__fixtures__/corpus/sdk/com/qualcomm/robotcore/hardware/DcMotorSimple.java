package com.qualcomm.robotcore.hardware;

// SDK 껍데기
public interface DcMotorSimple {
    enum Direction { FORWARD, REVERSE }

    void setDirection(Direction direction);

    void setPower(double power);

    double getPower();
}
