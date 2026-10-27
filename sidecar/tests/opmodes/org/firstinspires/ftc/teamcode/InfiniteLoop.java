package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: SDK를 부르지 않는 무한 루프 → error stall */
@TeleOp(name = "Infinite Loop")
public class InfiniteLoop extends LinearOpMode {
    public static volatile long counter;

    @Override
    public void runOpMode() {
        waitForStart();
        spin();
    }

    private static void spin() {
        while (true) counter++;
    }
}
