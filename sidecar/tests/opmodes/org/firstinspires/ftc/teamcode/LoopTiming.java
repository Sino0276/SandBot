package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: 루프 시간(Hub 타이밍 비용과 오차). 루프 표시·상태 읽기 비용만으로 루프 10000번의 가상 시간을 잰다. */
@TeleOp(name = "Loop Timing")
public class LoopTiming extends LinearOpMode {
    @Override
    public void runOpMode() {
        long a = System.nanoTime();
        for (int i = 0; i < 10000; i++) {
            opModeInInit();
        }
        System.out.println("RESULT loopNanos=" + (System.nanoTime() - a));
    }
}
