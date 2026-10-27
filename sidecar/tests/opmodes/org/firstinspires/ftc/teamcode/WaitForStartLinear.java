package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: waitForStart가 START까지 기다리고, opModeIsActive가 STOP 뒤 false인지. */
@TeleOp(name = "Wait For Start")
public class WaitForStartLinear extends LinearOpMode {
    @Override
    public void runOpMode() {
        System.out.println("RESULT init=" + Math.round(getRuntime() * 1000));
        waitForStart();
        System.out.println("RESULT started=" + Math.round(getRuntime() * 1000) + " active=" + opModeIsActive());
        int loops = 0;
        while (opModeIsActive()) {
            loops++;
            sleep(10);
        }
        System.out.println("RESULT stopped=" + Math.round(getRuntime() * 1000) + " loops=" + loops
                + " active=" + opModeIsActive() + " stopRequested=" + isStopRequested());
    }
}
