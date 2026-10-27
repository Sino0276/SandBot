package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: STOP을 받으면 OpMode에 알리기 전에 허브가 fail safe로 가고(실제 callActiveOpModeStop), 그 뒤 팀 코드가 보내는
 * 0이 아닌 power는 OpMode가 끝날 때까지 허브에 가지 않는다. 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop Fail Safe")
public class StopFailSafe extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        waitForStart();
        while (opModeIsActive()) {
            drive.setPower(0.5);
            sleep(10);
        }
        // STOP 뒤에도 잠시 모터를 돌리려 한다(끼어들기를 지워 sleep이 가상 시간을 보내게)
        for (int i = 0; i < 5; i++) {
            drive.setPower(0.8);
            Thread.interrupted();
            sleep(20);
        }
    }
}
