package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: STOP 뒤 끊김을 지우고 안전한 같은 값(power 0)을 쓰고 읽기만 하는 루프. STOP의 fail safe가 LastKnown을 잊으므로 첫
 * 쓰기만 허브에 가고, 그 뒤 setPower(0.0)·getPower()는 LastKnown이 답한다. 캐시가 답할 때마다 CLOCK_READ만큼 가상 시간이 흘러
 * stuckInStop으로 끝난다(전에는 가상 시간이 멈춰 stuckInStop도 stall도 아니었다). 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop Cleared Interrupt Cached Loop")
public class StopClearedInterruptCachedLoop extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        waitForStart();
        while (opModeIsActive()) {
            idle();
        }
        Thread.interrupted();
        while (true) {
            drive.setPower(0.0);
            drive.getPower();
        }
    }
}
