package com.qualcomm.robotcore.hardware;

// SDK 껍데기
public interface DcMotor extends DcMotorSimple {
    enum RunMode { RUN_WITHOUT_ENCODER, RUN_USING_ENCODER, RUN_TO_POSITION, STOP_AND_RESET_ENCODER }

    enum ZeroPowerBehavior { BRAKE, FLOAT }

    void setMode(RunMode mode);

    void setZeroPowerBehavior(ZeroPowerBehavior behavior);

    int getCurrentPosition();

    void setTargetPosition(int position);
}
