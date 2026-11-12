package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: STOP을 받은 LinearOpMode의 스레드는 끊긴다(internalOnStopRequested). 실제 Lynx 명령은 보내기 전에
 * MessageKeyedLock.acquire(lockInterruptibly)를 거치므로 루프 다음의 하드웨어 호출은 보내지 않고 자리값을 돌려준다(isBusy는
 * false). 팀 코드가 끊김을 지우면 다시 허브에 간다(isBusy true). 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop Interrupted Hardware")
public class StopInterruptedHardware extends LinearOpMode {
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
        boolean interrupted = Thread.currentThread().isInterrupted();
        boolean busyInterrupted = drive.isBusy();
        drive.setPower(0);
        boolean stillInterrupted = Thread.currentThread().isInterrupted();
        Thread.interrupted();
        boolean busyCleared = drive.isBusy();
        System.out.println("RESULT interrupted=" + interrupted + " busyInterrupted=" + busyInterrupted
                + " stillInterrupted=" + stillInterrupted + " busyCleared=" + busyCleared);
    }
}
