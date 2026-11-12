package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: STOP을 무시하고 하드웨어만 부르는 루프. 끊긴 스레드의 허브 명령은 보내지 않지만 잠금 시도마다 CLOCK_READ만큼
 * 가상 시간이 흐르므로 stall이 아니라 stuckInStop으로 끝난다. 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop Ignored Hardware Loop")
public class StopIgnoredHardwareLoop extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        waitForStart();
        while (true) {
            drive.getCurrentPosition();
        }
    }
}
