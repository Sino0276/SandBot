package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: System.exit → finished terminated(JVM은 그대로) */
@TeleOp(name = "Exit")
public class CallsExit extends LinearOpMode {
    @Override
    public void runOpMode() {
        sleep(10);
        try {
            System.exit(3);
        } catch (Exception e) {
            // SimExit는 Error라 여기서 잡히지 않는다
            System.out.println("RESULT caught=" + e);
        }
        System.out.println("RESULT afterExit=reached");
    }
}
