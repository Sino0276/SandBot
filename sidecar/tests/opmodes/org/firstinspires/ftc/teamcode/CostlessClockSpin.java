package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * 사이드카 테스트: 시계만 읽는 바쁜 루프. runtime.test.ts가 Hub 타이밍의 clockRead를 0으로 덮어써 돌리므로 시계를 불러도 가상 시간이
 * 흐르지 않는다. 감시는 시계 호출이 아니라 가상 시간의 진행을 보므로 error stall(이 스레드의 스택)을 보낸다.
 */
@TeleOp(name = "Costless Clock Spin")
public class CostlessClockSpin extends LinearOpMode {
    public static volatile long counter;

    @Override
    public void runOpMode() {
        waitForStart();
        spin();
    }

    private static void spin() {
        while (true) counter += System.nanoTime();
    }
}
