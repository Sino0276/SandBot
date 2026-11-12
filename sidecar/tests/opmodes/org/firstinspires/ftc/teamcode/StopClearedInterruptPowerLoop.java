package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: STOP 뒤 끊김을 지우고(빈 catch(InterruptedException)·Thread.interrupted()처럼) 0이 아닌 power만 번갈아 쓰는
 * 루프. 끊김이 없으니 잠금은 잡히지만 STOP 뒤의 위험한 명령이라 실제 LynxModule.sendCommand처럼 취소된다(8.2 규칙). 실제 send()는
 * 그 안전 검사 전에 네트워크 잠금을 잡으므로 취소마다 CLOCK_READ만큼 가상 시간이 흘러 stuckInStop으로 끝난다(실제는
 * OpModeStuckCodeMonitor가 잠금을 잡으려는 이 루프를 강제로 멈춘다). 구성은 runtime.test.ts가 만든다(모터 "drive").
 */
@TeleOp(name = "Stop Cleared Interrupt Power Loop")
public class StopClearedInterruptPowerLoop extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        waitForStart();
        while (opModeIsActive()) {
            idle();
        }
        Thread.interrupted();
        double power = 0.5;
        while (true) {
            drive.setPower(power);
            power = 0.75 - power;
        }
    }
}
