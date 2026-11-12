package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

/**
 * 사이드카 테스트: {@link StopPostStopListener}의 리스너를 등록하고 STOP을 무시한다. stuckInStop으로 강제로 멈춘 뒤에도 실제처럼
 * postStop을 알리고, 리스너(실제는 끊기지 않은 이벤트 루프 스레드)의 허브 명령은 자리값이 아니다. 구성·입력은 runtime.test.ts가
 * 만든다(모터 "drive", 엔코더 321틱).
 */
@TeleOp(name = "Stop PostStop Listener Stuck")
public class StopPostStopListenerStuck extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor drive = hardwareMap.get(DcMotor.class, "drive");
        drive.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        StopPostStopListener.Probe.register(drive, hardwareMap.get(LynxModule.class, "Control Hub"));
        waitForStart();
        while (true) {
            drive.getCurrentPosition();
        }
    }
}
