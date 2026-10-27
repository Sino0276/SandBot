package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: STOP을 무시한다(LinearOpMode.sleep이 끼어들기를 삼킨다) → error stuckInStop → finished stuck */
@TeleOp(name = "Stuck In Stop")
public class StuckInStop extends LinearOpMode {
    @Override
    public void runOpMode() {
        waitForStart();
        while (true) {
            sleep(10);
        }
    }
}
