package com.qualcomm.robotcore.eventloop.opmode;

// SDK 껍데기
public abstract class LinearOpMode extends OpMode {
    public abstract void runOpMode() throws InterruptedException;

    public void waitForStart() {
    }

    public boolean opModeIsActive() {
        return false;
    }

    @Override
    public final void init() {
    }

    @Override
    public final void loop() {
    }
}
