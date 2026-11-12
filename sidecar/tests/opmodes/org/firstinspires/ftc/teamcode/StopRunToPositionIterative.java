package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: RUN_TO_POSITION 모터를 쓰는 반복 OpMode가 stop()에서 setPower(0)을 한다. stop()은 허브 fail safe 뒤에
 * 불리지만(실제 callActiveOpModeStop) fail safe는 목표 위치를 지우지 않으므로(펌웨어 추론) 실제 로봇처럼 던지지 않는다.
 * 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop Run To Position Iterative")
public class StopRunToPositionIterative extends OpMode {
    private DcMotor drive;

    @Override
    public void init() {
        drive = hardwareMap.get(DcMotor.class, "drive");
        drive.setTargetPosition(1000);
        drive.setMode(DcMotor.RunMode.RUN_TO_POSITION);
    }

    @Override
    public void start() {
        drive.setPower(0.5);
    }

    @Override
    public void loop() {
    }

    @Override
    public void stop() {
        drive.setPower(0);
    }
}
