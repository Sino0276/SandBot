package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: START 전에 runOpMode가 돌아온다 → finished returned(waitForStart를 잊었다는 전역 경고) */
@TeleOp(name = "Returns Early")
public class ReturnsEarly extends LinearOpMode {
    @Override
    public void runOpMode() {
        telemetry.addData("status", "done");
        telemetry.update();
    }
}
