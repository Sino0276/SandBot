package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 사이드카 테스트: 가상 1초에 500줄을 넘는 출력은 버리고 "… N lines dropped"를 한 번 보낸다. 줄바꿈 없는 끝도 보낸다. */
@TeleOp(name = "Spammer")
public class Spammer extends LinearOpMode {
    @Override
    public void runOpMode() {
        for (int i = 0; i < 2000; i++) {
            System.out.println("line " + i);
        }
        sleep(1100);
        System.out.println("after");
        System.err.println("err\r");
        System.out.print("partial");
    }
}
