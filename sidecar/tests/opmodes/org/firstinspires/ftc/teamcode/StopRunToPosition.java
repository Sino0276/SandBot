package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: RUN_TO_POSITION으로 돌던 LinearOpMode가 STOP 뒤 루프 다음의 정리 코드에서 setPower(0)을 한다. 허브 fail safe는
 * 목표 위치를 지우지 않으므로(펌웨어 추론) 실제 로봇처럼 TargetPositionNotSetException 없이 끝난다. 구성은 runtime.test.ts가
 * 만든다(모터 "drive").
 */
@TeleOp(name = "Stop Run To Position")
public class StopRunToPosition extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        drive.setTargetPosition(1000);
        drive.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        waitForStart();
        drive.setPower(0.5);
        while (opModeIsActive()) {
            idle();
        }
        drive.setPower(0);
    }
}
