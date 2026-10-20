package com.qualcomm.robotcore.hardware;

// SDK 껍데기
public interface DcMotorEx extends DcMotor {
    void setVelocity(double angularRate);

    double getVelocity();
}
