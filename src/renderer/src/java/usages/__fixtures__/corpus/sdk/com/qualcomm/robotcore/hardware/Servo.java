package com.qualcomm.robotcore.hardware;

// SDK 껍데기
public interface Servo {
    enum Direction { FORWARD, REVERSE }

    void setDirection(Direction direction);

    void setPosition(double position);

    double getPosition();
}
